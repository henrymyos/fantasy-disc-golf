/**
 * Adds 20 more MPO and 5 more FPO players, ranks 51-70 MPO and 26-30 FPO.
 * Continues overall_rank from 76 using a 2 MPO : 1 FPO interleave.
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://cagyuhuzvannojeqkmun.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhZ3l1aHV6dmFubm9qZXFrbXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODI3ODM5MCwiZXhwIjoyMDkzODU0MzkwfQ.myAmFAs8UIv6PMiO9LwdUinlCW4Xgt1iY-1uBlVUeXc"
);

// New players, interleaved 2 MPO : 1 FPO starting at overall_rank 76.
const NEW_PLAYERS = [
  { name: "Harper Thompson",      division: "MPO", pdga_number: "60259",  world_ranking: 51, overall_rank:  76 },
  { name: "Väinö Mäkelä",         division: "MPO", pdga_number: "59635",  world_ranking: 52, overall_rank:  77 },
  { name: "Madison Walker",       division: "FPO", pdga_number: "59431",  world_ranking: 26, overall_rank:  78 },
  { name: "Cale Leiviska",        division: "MPO", pdga_number: "24341",  world_ranking: 53, overall_rank:  79 },
  { name: "Jonathan Borzick",     division: "MPO", pdga_number: "119794", world_ranking: 54, overall_rank:  80 },
  { name: "Emily Weatherman",     division: "FPO", pdga_number: "111487", world_ranking: 27, overall_rank:  81 },
  { name: "Ty Love",              division: "MPO", pdga_number: "89959",  world_ranking: 55, overall_rank:  82 },
  { name: "Noah Meintsma",        division: "MPO", pdga_number: "56555",  world_ranking: 56, overall_rank:  83 },
  { name: "Raven Klein",          division: "FPO", pdga_number: "138272", world_ranking: 28, overall_rank:  84 },
  { name: "Zach Arlinghaus",      division: "MPO", pdga_number: "65266",  world_ranking: 57, overall_rank:  85 },
  { name: "Braeden Sides",        division: "MPO", pdga_number: "129963", world_ranking: 58, overall_rank:  86 },
  { name: "Kona Star Montgomery", division: "FPO", pdga_number: "27832",  world_ranking: 29, overall_rank:  87 },
  { name: "Clay Edwards",         division: "MPO", pdga_number: "91397",  world_ranking: 59, overall_rank:  88 },
  { name: "James Proctor",        division: "MPO", pdga_number: "34250",  world_ranking: 60, overall_rank:  89 },
  { name: "Sintija Klezberga",    division: "FPO", pdga_number: "229526", world_ranking: 30, overall_rank:  90 },
  { name: "Alden Harris",         division: "MPO", pdga_number: "98091",  world_ranking: 61, overall_rank:  91 },
  { name: "Miio Hämäläinen",      division: "MPO", pdga_number: "201845", world_ranking: 62, overall_rank:  92 },
  { name: "G.T. Hancock",         division: "MPO", pdga_number: "49885",  world_ranking: 63, overall_rank:  93 },
  { name: "Gavin Phillips",       division: "MPO", pdga_number: "119504", world_ranking: 64, overall_rank:  94 },
  { name: "Austen Bates",         division: "MPO", pdga_number: "130724", world_ranking: 65, overall_rank:  95 },
  { name: "Andrew Miranda",       division: "MPO", pdga_number: "118426", world_ranking: 66, overall_rank:  96 },
  { name: "Joona Heinänen",       division: "MPO", pdga_number: "58926",  world_ranking: 67, overall_rank:  97 },
  { name: "Dennis Augustsson",    division: "MPO", pdga_number: "98130",  world_ranking: 68, overall_rank:  98 },
  { name: "Anthony Anselmo",      division: "MPO", pdga_number: "56579",  world_ranking: 69, overall_rank:  99 },
  { name: "Kevin Jones",          division: "MPO", pdga_number: "41760",  world_ranking: 70, overall_rank: 100 },
];

async function main() {
  // Skip any whose name already exists (defensive)
  const { data: existing, error: eErr } = await supabase
    .from("players")
    .select("name");
  if (eErr) throw eErr;
  const existingNames = new Set((existing ?? []).map((p) => p.name));

  const toInsert = NEW_PLAYERS.filter((p) => !existingNames.has(p.name));
  if (toInsert.length === 0) {
    console.log("All players already present.");
    return;
  }

  console.log(`Inserting ${toInsert.length} player(s)...`);
  const { error } = await supabase.from("players").insert(toInsert);
  if (error) throw error;

  for (const p of toInsert) {
    console.log(`  ✓ ${p.division} #${p.world_ranking} ${p.name} (overall #${p.overall_rank})`);
  }
  console.log(`\nDone. Now ${(existing?.length ?? 0) + toInsert.length} total players.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
