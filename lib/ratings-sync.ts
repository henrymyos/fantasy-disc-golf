// Syncs our players' pdga_rating column to each player's current official PDGA
// Rating.
//
// Two-pass resolution per player:
//   1. If we have a stored pdga_number, read "Current Rating" off their profile
//      page (https://www.pdga.com/player/N) — fast, one request.
//   2. If that yields nothing (no number on file, or an expired profile that
//      hides the rating), fall back to the PDGA player search, whose results
//      table carries the rating, class and membership directly. We pick the
//      best matching active Pro and adopt both their number and rating.
//
// We only write rows whose value actually changed, and report the movers.
// Per-player failures are skipped rather than failing the whole run, so the
// weekly cron self-heals: a player added without a number gets one filled in
// the next time this runs.

import type { SupabaseClient } from "@supabase/supabase-js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// PDGA rate-limits aggressively (HTTP 429 after a short burst), especially on
// the player-search endpoint. We therefore serialize requests, space them out,
// and back off on 429. Slow but reliable.
const MIN_INTERVAL_MS = 700;
const MAX_ATTEMPTS = 4;

type PlayerRow = {
  id: number;
  name: string;
  pdga_number: string | null;
  pdga_rating: number | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastFetchAt = 0;

/** Fetches HTML through a global throttle, retrying with exponential backoff on
 *  429 / network errors. Returns null only after exhausting all attempts. */
async function fetchHtml(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const wait = lastFetchAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html" },
        cache: "no-store",
      });
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return await res.text();
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

/** Pull the "Current Rating: NNNN" value out of a PDGA player profile page. */
export function parseRating(html: string): number | null {
  const m = html.match(/Current Rating:<\/strong>\s*(\d{3,4})/i);
  if (!m) return null;
  const rating = parseInt(m[1], 10);
  return Number.isFinite(rating) ? rating : null;
}

function norm(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type SearchHit = {
  pdgaNumber: string;
  name: string;
  rating: number | null;
  isPro: boolean;
  current: boolean;
};

// Each result row is: name(link) | PDGA# | Rating | Class | City | State |
// Country | Membership Status. We strip tags and read the cells positionally.
export function parseSearchRows(html: string): SearchHit[] {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const hits: SearchHit[] = [];
  for (const row of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const numMatch = row.match(/\/player\/(\d+)/);
    if (!numMatch) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(),
    );
    // cells: [name, pdgaNum, rating, class, city, state, country, membership]
    const name = cells[0] ?? "";
    const ratingRaw = cells[2] ?? "";
    const klass = cells[3] ?? "";
    const membership = cells[7] ?? cells[cells.length - 1] ?? "";
    const ratingNum = ratingRaw.match(/\d{3,4}/);
    hits.push({
      pdgaNumber: numMatch[1],
      name,
      rating: ratingNum ? parseInt(ratingNum[0], 10) : null,
      isPro: /pro/i.test(klass),
      current: /current/i.test(membership),
    });
  }
  return hits;
}

/**
 * Search PDGA for a player by name and return the best match. Prefers a row
 * that actually has a rating, then an active Pro membership, then the highest
 * rating — which for our pool of touring pros is almost always the right
 * person. Returns null when nothing plausibly matches.
 */
export async function searchBestMatch(
  name: string,
): Promise<{ pdgaNumber: string; rating: number | null } | null> {
  const tokens = name.trim().split(/\s+/);
  const first = tokens[0] ?? "";
  const last = tokens[tokens.length - 1] ?? "";
  if (!first || !last) return null;

  const url = `https://www.pdga.com/players?FirstName=${encodeURIComponent(first)}&LastName=${encodeURIComponent(last)}`;
  const html = await fetchHtml(url);
  if (!html) return null;

  const wantFirst = norm(first);
  const wantLast = norm(last);
  const rows = parseSearchRows(html).filter((h) => {
    const n = norm(h.name);
    return n.includes(wantFirst) && n.includes(wantLast);
  });
  if (rows.length === 0) return null;

  rows.sort((a, b) => {
    // Rated rows first.
    if ((a.rating != null) !== (b.rating != null)) return a.rating != null ? -1 : 1;
    // Then active Pros.
    if (a.isPro !== b.isPro) return a.isPro ? -1 : 1;
    if (a.current !== b.current) return a.current ? -1 : 1;
    // Then highest rating.
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
  const best = rows[0];
  return { pdgaNumber: best.pdgaNumber, rating: best.rating };
}

/**
 * Last-resort rating for players whose membership has lapsed: PDGA hides the
 * current rating on both the profile and search, but the Ratings Detail page
 * still lists each round's rating. We average them (rounded) as a stand-in —
 * close to how PDGA derives the official figure, and good enough to show.
 */
async function fetchRoundsAverage(pdgaNumber: string): Promise<number | null> {
  const html = await fetchHtml(`https://www.pdga.com/player/${pdgaNumber}/details`);
  if (!html) return null;
  const vals = [...html.matchAll(/round-rating">\s*(\d{3,4})\s*</gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n));
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((s, n) => s + n, 0) / vals.length);
}

/** Resolve a single player to { number, rating }, preferring the fast profile
 *  path, then name search, then a round-ratings average for lapsed members. */
async function resolvePlayer(
  p: PlayerRow,
): Promise<{ pdgaNumber: string | null; rating: number | null }> {
  let pdgaNumber = p.pdga_number;
  let rating: number | null = null;

  if (pdgaNumber) {
    const html = await fetchHtml(`https://www.pdga.com/player/${pdgaNumber}`);
    if (html) rating = parseRating(html);
  }

  if (rating == null) {
    const hit = await searchBestMatch(p.name);
    if (hit) {
      if (hit.pdgaNumber) pdgaNumber = hit.pdgaNumber;
      if (hit.rating != null) rating = hit.rating;
    }
  }

  if (rating == null && pdgaNumber) {
    rating = await fetchRoundsAverage(pdgaNumber);
  }

  return { pdgaNumber, rating };
}

export type RatingsSyncResult = {
  ok: true;
  scanned: number;
  updated: number;
  unresolved: number;
  movers: { name: string; from: number | null; to: number }[];
  stillMissing: string[];
};

export async function runRatingsSync(
  supabase: SupabaseClient,
): Promise<RatingsSyncResult> {
  const { data, error } = await supabase
    .from("players")
    .select("id, name, pdga_number, pdga_rating");
  if (error) throw new Error(error.message);
  const players = (data ?? []) as PlayerRow[];

  const movers: RatingsSyncResult["movers"] = [];
  const stillMissing: string[] = [];
  let updated = 0;
  let unresolved = 0;

  // Sequential: the fetch throttle paces requests to stay under PDGA's limit.
  for (const p of players) {
    const { pdgaNumber, rating } = await resolvePlayer(p);
    if (rating == null) {
      unresolved++;
      if (p.pdga_rating == null) stillMissing.push(p.name);
      continue;
    }

    const numChanged = pdgaNumber != null && pdgaNumber !== p.pdga_number;
    const ratingChanged = rating !== p.pdga_rating;
    if (!numChanged && !ratingChanged) continue;

    const patch: { pdga_rating: number; pdga_number?: string } = { pdga_rating: rating };
    if (numChanged) patch.pdga_number = pdgaNumber!;

    const { error: upErr } = await supabase.from("players").update(patch).eq("id", p.id);
    if (upErr) throw new Error(`Update failed for ${p.name}: ${upErr.message}`);
    updated++;
    if (ratingChanged) movers.push({ name: p.name, from: p.pdga_rating, to: rating });
  }

  return { ok: true, scanned: players.length, updated, unresolved, movers, stillMissing };
}
