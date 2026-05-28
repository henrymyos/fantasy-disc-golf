// One-off: replace Kristin Lätt (retired) with the highest-ranked FPO player
// not currently in our players table. We keep the same row id so existing
// rosters and historical draft picks stay intact — just rename and rerank.
//
// Run: npx tsx --env-file=.env.local scripts/replace-kristin-latt.ts

import { createClient } from "@supabase/supabase-js";

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

function latestFpoSlug(html: string): string {
  const re = /fpo-world-rankings-([a-z]+)-(\d+)-(\d+)/g;
  let best: { slug: string; key: number } | null = null;
  for (const m of html.matchAll(re)) {
    const month = MONTHS.indexOf(m[1]);
    if (month < 0) continue;
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const key = year * 10000 + month * 100 + day;
    if (!best || key > best.key) best = { slug: m[0], key };
  }
  if (!best) throw new Error("No FPO rankings page found");
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

/** Try the PDGA player search to grab a player's PDGA number by name. */
async function lookupPdgaNumber(name: string): Promise<number | null> {
  try {
    const url = `https://www.pdga.com/players?LastName=${encodeURIComponent(name.split(" ").slice(-1)[0])}&FirstName=${encodeURIComponent(name.split(" ")[0])}`;
    const html = await fetchHtml(url);
    // Each result row is /player/<num>; first hit is usually correct.
    const m = html.match(/\/player\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

async function main() {
  // 1. Get current FPO rankings
  console.log("Fetching FPO rankings from PDGA…");
  const indexHtml = await fetchHtml("https://www.pdga.com/world-rankings");
  const slug = latestFpoSlug(indexHtml);
  console.log("Latest page:", slug);
  const pageHtml = await fetchHtml(`https://www.pdga.com/${slug}`);
  const rankings = parseRankings(pageHtml);
  console.log(`Parsed ${rankings.length} ranked FPO players.`);

  // 2. Load our current FPO pool
  const { data: ourPlayers } = await s
    .from("players")
    .select("id, name")
    .eq("division", "FPO");
  const ourNames = new Set(
    (ourPlayers ?? []).map((p: any) => norm(p.name)),
  );

  // 3. Find the highest-ranked PDGA name NOT in our pool
  let replacement: { rank: number; name: string } | null = null;
  for (const r of rankings) {
    if (!ourNames.has(norm(r.name))) {
      replacement = r;
      break;
    }
  }
  if (!replacement) {
    console.error("Every PDGA-ranked FPO player is already in our pool.");
    process.exit(1);
  }
  console.log(`Replacement: #${replacement.rank} ${replacement.name}`);

  // 4. Look up the replacement's PDGA number (best-effort).
  const pdgaNum = await lookupPdgaNumber(replacement.name);
  console.log("Looked up PDGA number:", pdgaNum);

  // 5. Update Kristin Lätt's row in place so we don't break rosters/draft picks.
  const { data: kristin } = await s
    .from("players")
    .select("id, name, world_ranking, overall_rank, pdga_number")
    .ilike("name", "%Kristin Lätt%")
    .single();
  if (!kristin) {
    console.error("Could not find Kristin Lätt in the players table.");
    process.exit(1);
  }
  console.log("Updating row id", (kristin as any).id, "in place…");
  const { error } = await s
    .from("players")
    .update({
      name: replacement.name,
      world_ranking: replacement.rank,
      pdga_number: pdgaNum ? String(pdgaNum) : null,
    })
    .eq("id", (kristin as any).id);
  if (error) {
    console.error("Update failed:", error.message);
    process.exit(1);
  }
  console.log("Done.");
  console.log(`  Was: ${(kristin as any).name} (WR ${(kristin as any).world_ranking})`);
  console.log(`  Now: ${replacement.name} (WR ${replacement.rank})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
