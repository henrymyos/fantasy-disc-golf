// Adds the top N MPO + top M FPO players currently missing from our players
// table, in PDGA World Rankings order. Newly-inserted rows get a
// world_ranking equal to the PDGA rank. overall_rank is appended at the
// bottom of the existing sequence — the next runRankingsSync will
// re-interleave everyone properly.
//
// Run: npx tsx --env-file=.env.local scripts/add-top-missing-players.ts

import { createClient } from "@supabase/supabase-js";

const ADD_MPO = 20;
const ADD_FPO = 10;

const UA = "Mozilla/5.0 DiscFantasyOneOff";
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } },
);

function norm(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function latestSlug(html: string, division: "mpo" | "fpo"): string {
  const re = new RegExp(`${division}-world-rankings-([a-z]+)-(\\d+)-(\\d+)`, "g");
  let best: { slug: string; key: number } | null = null;
  for (const m of html.matchAll(re)) {
    const month = MONTHS.indexOf(m[1]);
    if (month < 0) continue;
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const key = year * 10000 + month * 100 + day;
    if (!best || key > best.key) best = { slug: m[0], key };
  }
  if (!best) throw new Error(`No ${division.toUpperCase()} rankings page found`);
  return best.slug;
}

function parseRankings(html: string): Array<{ rank: number; name: string }> {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const ranked: Array<{ rank: number; name: string }> = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&[a-z]+;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length < 2) continue;
    const rankMatch = cells[0].match(/(\d+)\s*$/);
    if (!rankMatch) continue;
    const name = cells[1];
    if (!name) continue;
    ranked.push({ rank: parseInt(rankMatch[1], 10), name });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked;
}

async function lookupPdgaNumber(name: string): Promise<number | null> {
  try {
    const parts = name.split(" ");
    const first = parts[0];
    const last = parts.slice(-1)[0];
    const url = `https://www.pdga.com/players?LastName=${encodeURIComponent(last)}&FirstName=${encodeURIComponent(first)}`;
    const html = await fetchHtml(url);
    const m = html.match(/\/player\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

async function findMissing(
  rankings: Array<{ rank: number; name: string }>,
  ourNorms: Set<string>,
  count: number,
): Promise<Array<{ rank: number; name: string }>> {
  const missing: Array<{ rank: number; name: string }> = [];
  for (const r of rankings) {
    if (missing.length >= count) break;
    if (!ourNorms.has(norm(r.name))) missing.push(r);
  }
  return missing;
}

async function addPlayers(
  division: "MPO" | "FPO",
  picks: Array<{ rank: number; name: string }>,
  startOverallRank: number,
): Promise<number> {
  let inserted = 0;
  let overall = startOverallRank;
  for (const p of picks) {
    const pdga = await lookupPdgaNumber(p.name);
    const { error } = await s.from("players").insert({
      name: p.name,
      division,
      world_ranking: p.rank,
      overall_rank: overall++,
      pdga_number: pdga ? String(pdga) : null,
    });
    if (error) {
      console.error(`  ! failed ${p.name}: ${error.message}`);
      continue;
    }
    inserted++;
    console.log(`  + ${division} #${p.rank}  ${p.name.padEnd(28)}  pdga=${pdga ?? "—"}`);
  }
  return inserted;
}

async function main() {
  console.log("Fetching PDGA World Rankings index…");
  const indexHtml = await fetchHtml("https://www.pdga.com/world-rankings");
  const mpoSlug = latestSlug(indexHtml, "mpo");
  const fpoSlug = latestSlug(indexHtml, "fpo");
  console.log("MPO page:", mpoSlug);
  console.log("FPO page:", fpoSlug);

  const [mpoHtml, fpoHtml] = await Promise.all([
    fetchHtml(`https://www.pdga.com/${mpoSlug}`),
    fetchHtml(`https://www.pdga.com/${fpoSlug}`),
  ]);
  const mpoRankings = parseRankings(mpoHtml);
  const fpoRankings = parseRankings(fpoHtml);
  console.log(`Parsed ${mpoRankings.length} MPO, ${fpoRankings.length} FPO rankings.`);

  const { data: ourPlayers } = await s.from("players").select("name, division, overall_rank");
  const mpoNorms = new Set((ourPlayers ?? []).filter((p: any) => p.division === "MPO").map((p: any) => norm(p.name)));
  const fpoNorms = new Set((ourPlayers ?? []).filter((p: any) => p.division === "FPO").map((p: any) => norm(p.name)));
  console.log(`Current pool: ${mpoNorms.size} MPO, ${fpoNorms.size} FPO.`);

  const mpoMissing = await findMissing(mpoRankings, mpoNorms, ADD_MPO);
  const fpoMissing = await findMissing(fpoRankings, fpoNorms, ADD_FPO);
  console.log(`\nTop ${ADD_MPO} missing MPO and top ${ADD_FPO} missing FPO:`);

  // Next available overall_rank slots — appended at the bottom.
  let nextOverall = (Math.max(0, ...((ourPlayers ?? []).map((p: any) => p.overall_rank ?? 0) as number[])) + 1) || 1;

  console.log("\nInserting MPO additions…");
  const mpoCount = await addPlayers("MPO", mpoMissing, nextOverall);
  nextOverall += mpoCount;
  console.log("\nInserting FPO additions…");
  const fpoCount = await addPlayers("FPO", fpoMissing, nextOverall);

  console.log(`\nDone. Inserted ${mpoCount} MPO + ${fpoCount} FPO = ${mpoCount + fpoCount} new players.`);
  console.log("Run the next scheduled runRankingsSync to re-interleave overall_rank.");
}

main().catch((e) => { console.error(e); process.exit(1); });
