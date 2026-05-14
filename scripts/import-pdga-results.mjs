// One-off importer: scrape PDGA event pages, match to our players table,
// compute fantasy_points, and refresh tournament_results. Tied players all
// receive the full points for their finishing position (no averaging).
// Run with:  node --env-file=.env.local scripts/import-pdga-results.mjs

import { createClient } from "@supabase/supabase-js";

const MPO_PLACEMENT_POINTS = {
  1: 82,  2: 70,  3: 60,  4: 53,  5: 47,  6: 42,  7: 38,  8: 35,  9: 32,  10: 29,
  11: 26, 12: 24, 13: 22, 14: 20, 15: 19, 16: 18, 17: 17, 18: 16, 19: 16, 20: 15,
  21: 13, 22: 12, 23: 11, 24: 11, 25: 10, 26: 10, 27: 9,  28: 9,  29: 9,  30: 9,
  31: 8,  32: 8,
  33: 6,  34: 6,  35: 6,  36: 6,  37: 6,  38: 6,  39: 6,  40: 6,
  41: 4,  42: 4,  43: 4,  44: 4,  45: 4,  46: 4,  47: 4,  48: 4,  49: 4,  50: 4,
};
const FPO_PLACEMENT_POINTS = {
  1: 54,  2: 46,  3: 40,  4: 35,  5: 31,  6: 28,  7: 25,  8: 23,
  9: 21,  10: 18, 11: 17, 12: 15, 13: 14, 14: 13, 15: 12, 16: 11,
  17: 9,  18: 9,  19: 9,  20: 9,  21: 9,  22: 9,  23: 9,  24: 9,  25: 9,
  26: 6,  27: 6,  28: 6,  29: 6,  30: 6,  31: 6,  32: 6,  33: 6,  34: 6,  35: 6,
  36: 4,  37: 4,  38: 4,  39: 4,  40: 4,  41: 4,  42: 4,  43: 4,  44: 4,  45: 4,
};
function pointsFor(position, division) {
  const isFPO = division === "FPO";
  const table = isFPO ? FPO_PLACEMENT_POINTS : MPO_PLACEMENT_POINTS;
  if (position <= (isFPO ? 45 : 50)) return table[position] ?? 1;
  if (position <= 60) return isFPO ? 2 : 3;
  return 1;
}

// (tournament_id in DB, pdgaEventId)
const EVENTS = [
  { dbId: 1, pdgaId: 96401, name: "Supreme Flight Open" },
  { dbId: 5, pdgaId: 96402, name: "Big Easy Open" },
  { dbId: 6, pdgaId: 96403, name: "Queen City Classic" },
  { dbId: 4, pdgaId: 97336, name: "Champions Cup" },
  { dbId: 2, pdgaId: 96404, name: "Jonesboro Open" },
  { dbId: 3, pdgaId: 96407, name: "Kansas City Wide Open" },
  { dbId: 7, pdgaId: 96408, name: "Open at Austin" },
];

async function fetchEventHtml(pdgaId) {
  const r = await fetch(`https://www.pdga.com/tour/event/${pdgaId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!r.ok) throw new Error(`PDGA ${pdgaId} status ${r.status}`);
  return r.text();
}

// Parse one MPO/FPO results table out of the event HTML.
// Returns [{ place, pdgaNumber, name }].
function parseResultsTable(html, tableId) {
  const tableRe = new RegExp(
    `<table[^>]*id="${tableId}"[\\s\\S]*?</table>`,
    "i",
  );
  const tableMatch = html.match(tableRe);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[0];

  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
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

function normalizeName(s) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/\s+jr\.?$|\s+sr\.?$|\s+iii?$/i, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Build player lookup
  const { data: players } = await supabase
    .from("players")
    .select("id, name, division, pdga_number");
  const byPdga = new Map();
  const byName = new Map();
  for (const p of players ?? []) {
    if (p.pdga_number) byPdga.set(String(p.pdga_number), p);
    byName.set(normalizeName(p.name), p);
  }
  console.log(`Loaded ${players?.length ?? 0} players (${byPdga.size} with PDGA#).`);

  const rowsToInsert = [];
  const unmatched = [];

  for (const event of EVENTS) {
    console.log(`\n→ ${event.name} (PDGA ${event.pdgaId}, db tournament_id=${event.dbId})`);
    let html;
    try {
      html = await fetchEventHtml(event.pdgaId);
    } catch (err) {
      console.error(`  FAILED to fetch: ${err.message}`);
      continue;
    }

    const mpo = parseResultsTable(html, "tournament-stats-0");
    const fpo = parseResultsTable(html, "tournament-stats-1");
    console.log(`  Parsed ${mpo.length} MPO + ${fpo.length} FPO rows`);

    const sections = [
      { rows: mpo, division: "MPO" },
      { rows: fpo, division: "FPO" },
    ];

    for (const { rows, division } of sections) {
      // Tied players all get the full points for their finishing position.
      for (const r of rows) {
        const player = byPdga.get(String(r.pdgaNumber)) ?? byName.get(normalizeName(r.name));
        if (!player) {
          unmatched.push({ event: event.name, ...r, division });
          continue;
        }
        rowsToInsert.push({
          tournament_id: event.dbId,
          player_id: player.id,
          finishing_position: r.place,
          hot_round_count: 0,
          bogey_free_count: 0,
          ace_count: 0,
          fantasy_points: pointsFor(r.place, division),
        });
      }
    }
  }

  console.log(`\nTotal result rows to insert: ${rowsToInsert.length}`);
  console.log(`Unmatched PDGA rows (player not in our DB): ${unmatched.length}`);

  if (process.argv.includes("--dry")) {
    console.log("\nDRY RUN — not writing to DB.");
    console.log("Sample inserts:", rowsToInsert.slice(0, 5));
    return;
  }

  console.log("\nDeleting existing tournament_results...");
  const { error: delErr } = await supabase
    .from("tournament_results")
    .delete()
    .neq("id", -1); // delete-all guard
  if (delErr) throw delErr;

  console.log("Inserting new tournament_results...");
  // Insert in batches of 500
  for (let i = 0; i < rowsToInsert.length; i += 500) {
    const chunk = rowsToInsert.slice(i, i + 500);
    const { error } = await supabase.from("tournament_results").insert(chunk);
    if (error) {
      console.error(`Batch ${i / 500} failed:`, error.message);
      throw error;
    }
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
