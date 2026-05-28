// Top-up: add 1 MPO + 1 FPO to replace the two duplicates we caught
// (Richard Wysocki == Ricky Wysocki; Kristin Lätt is retired). Same
// algorithm as add-top-missing-players.ts but with an alias map and an
// explicit retired list.

import { createClient } from "@supabase/supabase-js";

const UA = "Mozilla/5.0 DiscFantasyOneOff";
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// PDGA spelling -> our DB spelling.
const PDGA_ALIASES: Record<string, string> = {
  "richard wysocki": "ricky wysocki",
};

// Explicitly excluded from the pool even when PDGA still ranks them.
const EXCLUDE = new Set<string>(["kristin latt"]);

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
function normalizeForLookup(name: string): string {
  const n = norm(name);
  return PDGA_ALIASES[n] ?? n;
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
    const key = parseInt(m[3], 10) * 10000 + month * 100 + parseInt(m[2], 10);
    if (!best || key > best.key) best = { slug: m[0], key };
  }
  if (!best) throw new Error("no slug");
  return best.slug;
}
function parseRankings(html: string): Array<{ rank: number; name: string }> {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const out: Array<{ rank: number; name: string }> = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (cells.length < 2) continue;
    const rm = cells[0].match(/(\d+)\s*$/);
    if (!rm) continue;
    out.push({ rank: parseInt(rm[1], 10), name: cells[1] });
  }
  return out.sort((a, b) => a.rank - b.rank);
}
async function lookupPdga(name: string): Promise<number | null> {
  try {
    const parts = name.split(" ");
    const url = `https://www.pdga.com/players?LastName=${encodeURIComponent(parts.slice(-1)[0])}&FirstName=${encodeURIComponent(parts[0])}`;
    const html = await fetchHtml(url);
    const m = html.match(/\/player\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch { return null; }
}

async function topMissing(div: "MPO" | "FPO", n: number) {
  const indexHtml = await fetchHtml("https://www.pdga.com/world-rankings");
  const slug = latestSlug(indexHtml, div.toLowerCase() as "mpo" | "fpo");
  const html = await fetchHtml(`https://www.pdga.com/${slug}`);
  const rankings = parseRankings(html);
  const { data: ourPlayers } = await s.from("players").select("name, division, overall_rank").eq("division", div);
  const ourNorms = new Set((ourPlayers ?? []).map((p: any) => norm(p.name)));
  const picks: Array<{ rank: number; name: string }> = [];
  for (const r of rankings) {
    const lookupKey = normalizeForLookup(r.name);
    if (ourNorms.has(lookupKey)) continue;
    if (EXCLUDE.has(norm(r.name))) continue;
    picks.push(r);
    if (picks.length >= n) break;
  }
  let nextOverall = ((Math.max(0, ...((ourPlayers ?? []).map((p: any) => p.overall_rank ?? 0) as number[])) + 1) || 1);
  // Append at the very end of the overall sequence (across all players).
  const { data: anyPlayers } = await s.from("players").select("overall_rank");
  nextOverall = (Math.max(0, ...((anyPlayers ?? []).map((p: any) => p.overall_rank ?? 0) as number[])) + 1) || 1;
  for (const p of picks) {
    const pdga = await lookupPdga(p.name);
    const { error } = await s.from("players").insert({
      name: p.name,
      division: div,
      world_ranking: p.rank,
      overall_rank: nextOverall++,
      pdga_number: pdga ? String(pdga) : null,
    });
    console.log(`  + ${div} #${p.rank} ${p.name}  pdga=${pdga ?? "—"}  ${error?.message ?? "ok"}`);
  }
}

async function main() {
  console.log("Adding next-best MPO…");
  await topMissing("MPO", 1);
  console.log("Adding next-best FPO…");
  await topMissing("FPO", 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
