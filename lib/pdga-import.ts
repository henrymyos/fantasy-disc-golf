// Importer used by both the CLI script and the /api/sync-pdga cron route.
// Scrapes the PDGA tournament HTML pages, matches results against our players
// table, computes fantasy_points, and refreshes tournament_results.
// Tied players each receive the full points for their finishing position.

import type { SupabaseClient } from "@supabase/supabase-js";
// Relative (not "@/") so the standalone tsx import scripts resolve it too.
import { DGPT_2026_SCHEDULE } from "./dgpt-2026-schedule";

const MPO_PLACEMENT_POINTS: Record<number, number> = {
  1: 82,  2: 70,  3: 60,  4: 53,  5: 47,  6: 42,  7: 38,  8: 35,  9: 32,  10: 29,
  11: 26, 12: 24, 13: 22, 14: 20, 15: 19, 16: 18, 17: 17, 18: 16, 19: 16, 20: 15,
  21: 13, 22: 12, 23: 11, 24: 11, 25: 10, 26: 10, 27: 9,  28: 9,  29: 9,  30: 9,
  31: 8,  32: 8,
  33: 6,  34: 6,  35: 6,  36: 6,  37: 6,  38: 6,  39: 6,  40: 6,
  41: 4,  42: 4,  43: 4,  44: 4,  45: 4,  46: 4,  47: 4,  48: 4,  49: 4,  50: 4,
};
const FPO_PLACEMENT_POINTS: Record<number, number> = {
  1: 54,  2: 46,  3: 40,  4: 35,  5: 31,  6: 28,  7: 25,  8: 23,
  9: 21,  10: 18, 11: 17, 12: 15, 13: 14, 14: 13, 15: 12, 16: 11,
  17: 9,  18: 9,  19: 9,  20: 9,  21: 9,  22: 9,  23: 9,  24: 9,  25: 9,
  26: 6,  27: 6,  28: 6,  29: 6,  30: 6,  31: 6,  32: 6,  33: 6,  34: 6,  35: 6,
  36: 4,  37: 4,  38: 4,  39: 4,  40: 4,  41: 4,  42: 4,  43: 4,  44: 4,  45: 4,
};

function pointsFor(position: number, division: "MPO" | "FPO"): number {
  const isFPO = division === "FPO";
  const table = isFPO ? FPO_PLACEMENT_POINTS : MPO_PLACEMENT_POINTS;
  if (position <= (isFPO ? 45 : 50)) return table[position] ?? 1;
  if (position <= 60) return isFPO ? 2 : 3;
  return 1;
}

// Per-round bonus points must match lib/scoring-constants.ts.
const BONUS_POINTS = { hotRound: 10, bogeyFree: 5, ace: 20, birdie: 0.2, bogey: 0.1, eagle: 2 } as const;

// `bogey` here is the bogey-FREE round count (legacy name); `under`/`over` are
// cumulative strokes relative to par across the player's rounds in the event;
// `eagle` is the count of holes played 2+ under par.
type RoundBonus = { hot: number; bogey: number; ace: number; under: number; over: number; eagle: number };

// Venue location (country + US state) keyed by PDGA event id, sourced from the
// hardcoded schedule. Used to pick a sane UTC offset for tee times below.
const LOCATION_BY_PDGA_ID = new Map<number, { country: string; state: string | null }>(
  DGPT_2026_SCHEDULE.filter((e) => e.pdgaEventId != null).map((e) => [
    e.pdgaEventId as number,
    { country: e.country, state: e.state },
  ]),
);

// Standard-time (winter) UTC offset in hours per US state — the tour only
// visits these four zones in 2026. DST is added separately below.
const US_STATE_STD_OFFSET: Record<string, number> = {
  // Eastern (UTC-5 standard)
  FL: -5, NC: -5, VA: -5, MI: -5, KY: -5, VT: -5, MA: -5, SC: -5, OH: -5, GA: -5, PA: -5, NY: -5,
  // Central (UTC-6 standard)
  LA: -6, AR: -6, MO: -6, TX: -6, IL: -6, IA: -6, MN: -6, WI: -6, KS: -6, OK: -6, TN: -6,
  // Mountain (UTC-7 standard)
  CO: -7, NM: -7, UT: -7, MT: -7, WY: -7,
  // Pacific (UTC-8 standard)
  CA: -8, OR: -8, WA: -8, NV: -8,
};

// Standard-time UTC offset in hours for the non-US countries the tour visits.
const COUNTRY_STD_OFFSET: Record<string, number> = {
  Sweden: 1,   // CET
  Finland: 2,  // EET
  Estonia: 2,  // EET
  Norway: 1,   // CET
  Germany: 1,  // CET
  Japan: 9,    // JST — no DST
};

// Countries that do NOT observe DST (so we never add the summer hour).
const NO_DST_COUNTRIES = new Set(["Japan"]);

/**
 * Best-effort UTC offset (e.g. "-04:00") for an event's tee times, given its
 * venue and start date. PDGA reports tee times as local wall-clock strings with
 * no timezone, so we map country/US-state to a standard-time offset and add an
 * hour when the date falls inside that region's daylight-saving window. This
 * isn't full IANA tz handling, but it's correct to the hour for every venue on
 * the schedule (e.g. Estonia EEST +3, Sweden CEST +2, a Feb US event in EST -5).
 * Unknown venues fall back to US Eastern Daylight (-04:00), the legacy default.
 */
function teeTimeUtcOffset(country: string | null, state: string | null, startDate: string): string {
  let std: number | null = null;
  let dst = false;

  if (country == null || country === "USA") {
    std = state != null ? (US_STATE_STD_OFFSET[state] ?? null) : null;
    // US DST 2026: Mar 8 – Nov 1 (2nd Sun Mar → 1st Sun Nov).
    if (std != null) dst = startDate >= "2026-03-08" && startDate < "2026-11-01";
  } else {
    std = COUNTRY_STD_OFFSET[country] ?? null;
    // EU summer time 2026: Mar 29 – Oct 25 (last Sun Mar → last Sun Oct).
    if (std != null && !NO_DST_COUNTRIES.has(country)) {
      dst = startDate >= "2026-03-29" && startDate < "2026-10-25";
    }
  }

  if (std == null) return "-04:00"; // unknown venue → legacy US Eastern default

  const total = std + (dst ? 1 : 0);
  const sign = total >= 0 ? "+" : "-";
  const hh = String(Math.abs(total)).padStart(2, "0");
  return `${sign}${hh}:00`;
}

/**
 * Pulls the earliest scheduled tee time for round 1 from PDGA Live (across
 * both divisions). Combined with the tournament's start_date this gives us a
 * concrete lock-at timestamp so lineups freeze the moment players tee off.
 *
 * PDGA returns tee times as local "HH:MM:SS" strings without a timezone, so we
 * derive the venue's UTC offset from the event's country/state (see
 * teeTimeUtcOffset) rather than assuming US Eastern for every event.
 */
async function fetchFirstTeeTime(pdgaId: number, startDate: string | null): Promise<string | null> {
  if (!startDate) return null;
  const [mpo, fpo] = await Promise.all([
    fetchRoundJson(pdgaId, "MPO", 1),
    fetchRoundJson(pdgaId, "FPO", 1),
  ]);
  const teeTimes: string[] = [];
  for (const data of [mpo, fpo]) {
    for (const s of (data?.scores ?? []) as any[]) {
      if (typeof s?.TeeTime === "string" && /^\d{2}:\d{2}:\d{2}$/.test(s.TeeTime)) {
        teeTimes.push(s.TeeTime);
      }
    }
  }
  if (teeTimes.length === 0) return null;
  teeTimes.sort();
  const earliest = teeTimes[0];
  // Convert the local tee time to UTC using the venue's derived offset.
  const loc = LOCATION_BY_PDGA_ID.get(pdgaId);
  const offset = teeTimeUtcOffset(loc?.country ?? null, loc?.state ?? null, startDate);
  const localIso = `${startDate}T${earliest}${offset}`;
  const ms = Date.parse(localIso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

async function fetchRoundJson(pdgaId: number, division: "MPO" | "FPO", round: number): Promise<any | null> {
  const url = `https://www.pdga.com/apps/tournament/live-api/live_results_fetch_round?TournID=${pdgaId}&Division=${division}&Round=${round}`;
  // Retry transient failures (rate-limit 429 / 5xx / network) with backoff so a
  // full-season import gets complete round data instead of silently dropping
  // bonus stats for throttled events. A 404 means the round doesn't exist —
  // return immediately, no retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 404) return null;
      if (!r.ok) {
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      const data = await r.json();
      return data?.data ?? null;
    } catch {
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * For a single event, walks every (division, round) and computes per-PDGA#
 * counts of hot rounds, bogey-free rounds, and aces.
 *
 * - Hot round  = lowest RoundScore in that division+round. Multiple players
 *                can share it; each gets credit.
 * - Bogey-free = no hole's score exceeds par in that round.
 * - Ace        = a hole scored 1 on a par >= 2 hole.
 */
async function computeBonusesForEvent(pdgaId: number): Promise<{
  bonus: Map<string, RoundBonus>;
  registered: Array<{ pdgaNum: number | null; name: string; division: "MPO" | "FPO" }>;
}> {
  const bonus = new Map<string, RoundBonus>();
  const registeredKeys = new Set<string>();
  const registered: Array<{ pdgaNum: number | null; name: string; division: "MPO" | "FPO" }> = [];

  for (const division of ["MPO", "FPO"] as const) {
    // Fetch rounds sequentially with a small gap instead of a 12-wide burst —
    // PDGA's live API rate-limits concurrent bursts, which silently returns
    // empty bonus data for some events when importing the whole season at once.
    const roundResponses: Array<any | null> = [];
    for (const r of [1, 2, 3, 4, 5, 6]) {
      roundResponses.push(await fetchRoundJson(pdgaId, division, r));
      await new Promise((res) => setTimeout(res, 120));
    }

    for (const data of roundResponses) {
      if (!data?.scores) continue;
      // Anyone appearing in any round JSON counts as registered for the event
      // — they show up even when no scores are posted yet. Capture name so
      // we can fall back to name-matching when pdga_number is unknown.
      for (const s of data.scores as any[]) {
        const pdgaNum = typeof s.PDGANum === "number" && s.PDGANum > 0 ? s.PDGANum : null;
        const name = typeof s.Name === "string" && s.Name.trim()
          ? s.Name.trim()
          : [s.FirstName, s.LastName].filter(Boolean).join(" ").trim();
        if (!pdgaNum && !name) continue;
        // Key the dedup by division too so a name-only fallback can still be
        // resolved within the right division downstream.
        const key = pdgaNum != null ? `p:${pdgaNum}` : `n:${division}:${normalizeName(name)}`;
        if (registeredKeys.has(key)) continue;
        registeredKeys.add(key);
        registered.push({ pdgaNum, name, division });
      }

      const holesInRound = data.layouts?.[0]?.Holes ?? 18;

      // Only count players who actually completed the round.
      const completed = (data.scores as any[]).filter(
        (s) =>
          typeof s.RoundScore === "number" &&
          Array.isArray(s.HoleScores) &&
          s.HoleScores.length === holesInRound &&
          s.HoleScores.every((h: string) => h !== "" && h != null),
      );
      if (completed.length < 5) continue; // round wasn't played for this division

      const minRound = Math.min(...completed.map((s) => s.RoundScore));

      for (const s of completed) {
        if (!s.PDGANum) continue;
        const key = String(s.PDGANum);
        const entry = bonus.get(key) ?? { hot: 0, bogey: 0, ace: 0, under: 0, over: 0, eagle: 0 };

        if (s.RoundScore === minRound) entry.hot += 1;

        const pars = String(s.Pars ?? "").split(",").map((n) => Number(n));
        const holes = (s.HoleScores as string[]).map((n) => Number(n));
        let bogeyFree = holes.length > 0;
        for (let i = 0; i < holes.length; i++) {
          const par = pars[i];
          const score = holes[i];
          if (!Number.isFinite(par) || !Number.isFinite(score)) continue;
          if (score > par) { bogeyFree = false; entry.over += score - par; }
          else if (score < par) {
            entry.under += par - score;
            // A hole 2+ under par is an eagle (an ace on a par 3+ also qualifies).
            if (par - score >= 2) entry.eagle += 1;
          }
        }
        if (bogeyFree) entry.bogey += 1;

        for (let i = 0; i < holes.length; i++) {
          if (holes[i] === 1 && (pars[i] ?? 0) >= 2) entry.ace += 1;
        }

        bonus.set(key, entry);
      }
    }
  }

  return { bonus, registered };
}

type ParsedRow = { place: number; pdgaNumber: number; name: string };

async function fetchEventHtml(pdgaId: number): Promise<string> {
  const r = await fetch(`https://www.pdga.com/tour/event/${pdgaId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`PDGA event ${pdgaId} returned ${r.status}`);
  return r.text();
}

function parseResultsTable(html: string, tableId: string): ParsedRow[] {
  const tableRe = new RegExp(
    `<table[^>]*id="${tableId}"[\\s\\S]*?</table>`,
    "i",
  );
  const tableMatch = html.match(tableRe);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[0];

  const rows: ParsedRow[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const row = m[1];
    const placeMatch = row.match(/<td[^>]*class="place"[^>]*>([^<]*)<\/td>/);
    if (!placeMatch) continue;
    const place = parseInt(placeMatch[1].trim(), 10);
    if (!Number.isFinite(place)) continue;

    const nameMatch = row.match(/<td class="player">.*?<a [^>]*>([^<]+)<\/a>/);
    const pdgaMatch = row.match(/<td class="pdga-number">(\d+)<\/td>/);
    if (!nameMatch || !pdgaMatch) continue;

    rows.push({
      place,
      pdgaNumber: parseInt(pdgaMatch[1], 10),
      name: nameMatch[1].trim(),
    });
  }
  return rows;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+jr\.?$|\s+sr\.?$|\s+iii?$/i, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ImportResult = {
  insertedRows: number;
  unmatchedRows: number;
  unmatchedSample: Array<{ event: string; name: string; pdgaNumber: number; division: "MPO" | "FPO" }>;
  events: Array<{
    name: string;
    pdgaId: number;
    tournamentId: number;
    mpoRows: number;
    fpoRows: number;
  }>;
};

/**
 * Refreshes tournament_results by scraping every tournament whose
 * `pdga_event_id` is set on its DB row. The set of tournaments imported is
 * driven by the DB, not a hardcoded list — add a tournament row with a
 * pdga_event_id and it's automatically picked up.
 */
export async function runPdgaImport(supabase: SupabaseClient): Promise<ImportResult> {
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, name, pdga_event_id, start_date")
    .not("pdga_event_id", "is", null);

  const events = (tournaments ?? []).map((t: any) => ({
    dbId: t.id as number,
    pdgaId: t.pdga_event_id as number,
    name: t.name as string,
    startDate: t.start_date as string | null,
  }));

  const { data: players } = await supabase
    .from("players")
    .select("id, name, division, pdga_number");
  const byPdga = new Map<string, any>();
  // Key name lookups by "division:name" so two players who share a name but
  // play different divisions don't collide (and a result can't be mis-attributed
  // across divisions). pdga_number is still the primary, division-agnostic key.
  const byName = new Map<string, any>();
  for (const p of players ?? []) {
    if (p.pdga_number) byPdga.set(String(p.pdga_number), p);
    byName.set(`${p.division ?? "MPO"}:${normalizeName(p.name)}`, p);
  }

  const rowsToInsert: any[] = [];
  const unmatched: Array<{ event: string; name: string; pdgaNumber: number; division: "MPO" | "FPO" }> = [];
  const eventSummaries: ImportResult["events"] = [];

  for (const event of events) {
    let html: string;
    try {
      html = await fetchEventHtml(event.pdgaId);
    } catch {
      eventSummaries.push({ name: event.name, pdgaId: event.pdgaId, tournamentId: event.dbId, mpoRows: 0, fpoRows: 0 });
      continue;
    }

    const mpo = parseResultsTable(html, "tournament-stats-0");
    const fpo = parseResultsTable(html, "tournament-stats-1");
    eventSummaries.push({
      name: event.name,
      pdgaId: event.pdgaId,
      tournamentId: event.dbId,
      mpoRows: mpo.length,
      fpoRows: fpo.length,
    });

    // Pull per-player hot rounds, bogey-free rounds, aces — and the set of
    // every PDGA# / name that appears in any round (= registered field).
    const { bonus: bonusByPdga, registered } = await computeBonusesForEvent(event.pdgaId);

    // Update the lock-at timestamp from PDGA's round 1 tee times.
    const lockAtIso = await fetchFirstTeeTime(event.pdgaId, event.startDate);
    if (lockAtIso) {
      await supabase
        .from("tournaments")
        .update({ lock_at: lockAtIso })
        .eq("id", event.dbId);
    }

    // Persist the registered players for this event so the UI can mark
    // unregistered players as OUT (projected = 0). Match by pdga# when
    // possible; fall back to normalized name so players in our DB without
    // a stored pdga_number can still be detected.
    if (registered.length > 0) {
      const registeredIdSet = new Set<number>();
      for (const r of registered) {
        const p =
          (r.pdgaNum != null ? byPdga.get(String(r.pdgaNum)) : undefined)
          ?? (r.name ? byName.get(`${r.division}:${normalizeName(r.name)}`) : undefined);
        if (p) registeredIdSet.add(p.id);
      }
      if (registeredIdSet.size > 0) {
        await supabase
          .from("tournaments")
          .update({ registered_player_ids: Array.from(registeredIdSet) })
          .eq("id", event.dbId);
      }
    }

    const sections = [
      { rows: mpo, division: "MPO" as const },
      { rows: fpo, division: "FPO" as const },
    ];

    for (const { rows, division } of sections) {
      for (const r of rows) {
        // Resolve name-only matches within this result's division so same-named
        // players in the other division aren't picked up by mistake.
        const player = byPdga.get(String(r.pdgaNumber)) ?? byName.get(`${division}:${normalizeName(r.name)}`);
        if (!player) {
          unmatched.push({ event: event.name, ...r, division });
          continue;
        }
        const bonus = bonusByPdga.get(String(r.pdgaNumber)) ?? { hot: 0, bogey: 0, ace: 0, under: 0, over: 0, eagle: 0 };
        const placementPts = pointsFor(r.place, division);
        const bonusPts =
          bonus.hot * BONUS_POINTS.hotRound +
          bonus.bogey * BONUS_POINTS.bogeyFree +
          bonus.ace * BONUS_POINTS.ace +
          bonus.under * BONUS_POINTS.birdie -
          bonus.over * BONUS_POINTS.bogey +
          bonus.eagle * BONUS_POINTS.eagle;
        rowsToInsert.push({
          tournament_id: event.dbId,
          player_id: player.id,
          finishing_position: r.place,
          hot_round_count: bonus.hot,
          bogey_free_count: bonus.bogey,
          ace_count: bonus.ace,
          under_par_strokes: bonus.under,
          over_par_strokes: bonus.over,
          eagle_count: bonus.eagle,
          fantasy_points: Math.round((placementPts + bonusPts) * 10) / 10,
        });
      }
    }
  }

  // Graceful, monotonic per-event replace. For each event that produced rows
  // this run, only overwrite the stored results if this scrape is at least as
  // complete (total birdie strokes) as what's already stored. This means:
  //   - an event with no rows at all (PDGA down / not posted) is left untouched;
  //   - a throttled/partial scrape can never degrade good birdie/bogey data;
  //   - a fuller scrape (more rounds fetched) always wins.
  // New events with no stored bonus data always import (existing total = 0).
  const scrapedEventIds = new Set<number>(rowsToInsert.map((r) => r.tournament_id as number));
  for (const tid of scrapedEventIds) {
    const evRows = rowsToInsert.filter((r) => (r.tournament_id as number) === tid);
    const newBirdie = evRows.reduce((s, r) => s + Number(r.under_par_strokes ?? 0), 0);

    const { data: existing } = await supabase
      .from("tournament_results")
      .select("under_par_strokes")
      .eq("tournament_id", tid);
    const existingBirdie = (existing ?? []).reduce((s, r: any) => s + Number(r.under_par_strokes ?? 0), 0);
    if (existingBirdie > 0 && newBirdie < existingBirdie) continue; // keep the fuller data

    // Upsert on the (tournament_id, player_id) unique constraint instead of a
    // delete-then-insert. The old approach blew away every row for the event
    // before re-inserting, so a concurrent read during finalize could see
    // partial or zero scores. Upserting overwrites each player's row in place,
    // so the swap is never a destructive gap. (Results only ever grow between
    // scrapes, so no stale rows are left behind.)
    for (let i = 0; i < evRows.length; i += 500) {
      const { error } = await supabase
        .from("tournament_results")
        .upsert(evRows.slice(i, i + 500), { onConflict: "tournament_id,player_id" });
      if (error) throw error;
    }
  }

  return {
    insertedRows: rowsToInsert.length,
    unmatchedRows: unmatched.length,
    unmatchedSample: unmatched.slice(0, 20),
    events: eventSummaries,
  };
}
