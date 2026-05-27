// Syncs our players' world_ranking / overall_rank columns to the latest
// official PDGA World Rankings (https://www.pdga.com/world-rankings).
//
// PDGA publishes a fresh dated page per division (e.g.
// /mpo-world-rankings-may-13-2026) roughly every other Wednesday after an
// Elite event. We scrape the rankings index to discover the most recent dated
// page for each division, parse the ordered name list, then re-sort our fixed
// player pool to match:
//   - world_ranking: dense 1..N within each division (MPO 1..70, FPO 1..30)
//   - overall_rank:  the existing cross-division interleave slot pattern,
//                    refilled from the freshly sorted per-division lists.
// Players who have dropped out of PDGA's current top 100 keep their prior
// relative order and sink to the bottom of their division.

import type { SupabaseClient } from "@supabase/supabase-js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// DB spelling -> PDGA spelling, for names that differ between sources.
const NAME_ALIASES: Record<string, string> = {
  "ricky wysocki": "richard wysocki",
};

type PlayerRow = {
  id: number;
  name: string;
  division: "MPO" | "FPO";
  world_ranking: number | null;
  overall_rank: number | null;
};

function norm(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
  });
  if (!res.ok) throw new Error(`PDGA fetch ${url} returned HTTP ${res.status}`);
  return res.text();
}

// Pick the newest dated ranking page for a division from the index HTML.
function latestPageSlug(indexHtml: string, division: "mpo" | "fpo"): string {
  const re = new RegExp(`${division}-world-rankings-([a-z]+)-(\\d+)-(\\d+)`, "g");
  let best: { slug: string; key: number } | null = null;
  for (const m of indexHtml.matchAll(re)) {
    const month = MONTHS.indexOf(m[1]);
    if (month < 0) continue;
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const key = year * 10000 + month * 100 + day;
    if (!best || key > best.key) best = { slug: m[0], key };
  }
  if (!best) throw new Error(`No ${division.toUpperCase()} ranking page found on PDGA index`);
  return best.slug;
}

// Parse "<rank>. <name>" rows out of a PDGA ranking table page.
function parseRankings(html: string): string[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const ranked: { rank: number; name: string }[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&[a-z]+;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length < 2) continue;
    const rankMatch = cells[0].match(/(\d+)\s*$/); // trailing number (after the arrow/change text)
    if (!rankMatch) continue;
    const name = cells[1];
    if (!name) continue;
    ranked.push({ rank: parseInt(rankMatch[1], 10), name });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.name);
}

function rankInList(list: string[], name: string): number | null {
  const target = NAME_ALIASES[norm(name)] ?? norm(name);
  let i = list.findIndex((p) => norm(p) === target);
  if (i >= 0) return i + 1;
  // Fallback: same last name + matching first initial.
  const parts = target.split(" ");
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  i = list.findIndex((p) => {
    const pn = norm(p).split(" ");
    return pn.slice(1).join(" ") === last && pn[0]?.[0] === first?.[0];
  });
  return i >= 0 ? i + 1 : null;
}

function sortDivision(pool: PlayerRow[], rankList: string[]) {
  return [...pool]
    .map((p) => ({ player: p, rank: rankInList(rankList, p.name) }))
    .sort((a, b) => {
      const ar = a.rank ?? Infinity;
      const br = b.rank ?? Infinity;
      if (ar !== br) return ar - br;
      // Stable for unmatched players: keep prior relative order.
      return (a.player.world_ranking ?? 9999) - (b.player.world_ranking ?? 9999);
    })
    .map((x) => x.player);
}

export type RankingsSyncResult = {
  ok: true;
  pages: { mpo: string; fpo: string };
  unmatched: { mpo: string[]; fpo: string[] };
  updated: number;
  movers: { name: string; division: string; from: number | null; to: number }[];
};

export async function runRankingsSync(
  supabase: SupabaseClient,
): Promise<RankingsSyncResult> {
  const indexHtml = await fetchHtml("https://www.pdga.com/world-rankings");
  const mpoSlug = latestPageSlug(indexHtml, "mpo");
  const fpoSlug = latestPageSlug(indexHtml, "fpo");

  const [mpoHtml, fpoHtml] = await Promise.all([
    fetchHtml(`https://www.pdga.com/${mpoSlug}`),
    fetchHtml(`https://www.pdga.com/${fpoSlug}`),
  ]);
  const mpoList = parseRankings(mpoHtml);
  const fpoList = parseRankings(fpoHtml);
  if (mpoList.length === 0 || fpoList.length === 0) {
    throw new Error("Failed to parse PDGA ranking tables (empty list)");
  }

  const { data, error } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank");
  if (error) throw new Error(error.message);
  const players = (data ?? []) as PlayerRow[];

  const mpoSorted = sortDivision(players.filter((p) => p.division === "MPO"), mpoList);
  const fpoSorted = sortDivision(players.filter((p) => p.division === "FPO"), fpoList);

  const newWorldRank = new Map<number, number>();
  mpoSorted.forEach((p, i) => newWorldRank.set(p.id, i + 1));
  fpoSorted.forEach((p, i) => newWorldRank.set(p.id, i + 1));

  // Refill overall_rank using the existing division sequence, so the
  // cross-division interleave methodology is preserved exactly.
  const sequence = [...players]
    .sort((a, b) => (a.overall_rank ?? 0) - (b.overall_rank ?? 0))
    .map((p) => p.division);
  const newOverall = new Map<number, number>();
  let mi = 0;
  let fi = 0;
  sequence.forEach((div, idx) => {
    const next = div === "MPO" ? mpoSorted[mi++] : fpoSorted[fi++];
    if (next) newOverall.set(next.id, idx + 1);
  });

  const movers: RankingsSyncResult["movers"] = [];
  let updated = 0;
  for (const p of players) {
    const wr = newWorldRank.get(p.id);
    const or = newOverall.get(p.id);
    if (wr == null || or == null) continue;
    if (wr === p.world_ranking && or === p.overall_rank) continue;
    const { error: upErr } = await supabase
      .from("players")
      .update({ world_ranking: wr, overall_rank: or })
      .eq("id", p.id);
    if (upErr) throw new Error(`Update failed for ${p.name}: ${upErr.message}`);
    updated++;
    if (wr !== p.world_ranking) {
      movers.push({ name: p.name, division: p.division, from: p.world_ranking, to: wr });
    }
  }

  const unmatched = {
    mpo: mpoSorted.filter((p) => rankInList(mpoList, p.name) == null).map((p) => p.name),
    fpo: fpoSorted.filter((p) => rankInList(fpoList, p.name) == null).map((p) => p.name),
  };

  return { ok: true, pages: { mpo: mpoSlug, fpo: fpoSlug }, unmatched, updated, movers };
}
