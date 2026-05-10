/**
 * Updates hot_round_count, bogey_free_count, and ace_count on existing
 * tournament_results rows based on verified real-world data.
 *
 * Run: node scripts/update-tournament-bonuses.mjs
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://cagyuhuzvannojeqkmun.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhZ3l1aHV6dmFubm9qZXFrbXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODI3ODM5MCwiZXhwIjoyMDkzODU0MzkwfQ.myAmFAs8UIv6PMiO9LwdUinlCW4Xgt1iY-1uBlVUeXc"
);

// ─── Bonus data ───────────────────────────────────────────────────────────────
// Keyed by tournament name → array of { player, hot, clean, ace }
// hot/clean/ace = number of rounds with that bonus

const BONUSES = {
  "Supreme Flight Open": [
    // MPO: R1 Barela, R2 McBeth+Wysocki (tie), R3 E.Robinson
    { player: "Anthony Barela",   hot: 1 },
    { player: "Paul McBeth",      hot: 1 },
    { player: "Ricky Wysocki",    hot: 1 },
    { player: "Ezra Robinson",    hot: 1 },
    // FPO: R1 Handley, R2 Hansen, R3 Mertsch
    { player: "Holyn Handley",    hot: 1 },
    { player: "Ella Hansen",      hot: 1 },
    { player: "Kat Mertsch",      hot: 1 },
  ],

  "Jonesboro Open": [
    // Per-round hot round data unavailable (A-Tier, no public round splits)
    // Confirmed: Kristin Lätt had at least 1 bogey-free round
    { player: "Kristin Lätt",     clean: 1 },
  ],

  "Kansas City Wide Open": [
    // MPO: R1 Buhr, R2 Wysocki+McBeth+Dickerson (3-way tie), R3 Wysocki
    { player: "Gannon Buhr",      hot: 1 },
    { player: "Ricky Wysocki",    hot: 2 }, // R2 + R3
    { player: "Paul McBeth",      hot: 1 },
    { player: "Chris Dickerson",  hot: 1 },
    // FPO: R1 Handley, R2 Handley+Burge (tie), R3 Burge
    { player: "Holyn Handley",    hot: 2 }, // R1 + R2
    { player: "Cadence Burge",    hot: 2 }, // R2 + R3
  ],

  "Champions Cup": [
    // MPO: R1 McBeth (not in our seeded results), R2 Barela+Wysocki (tie),
    //       R3 Tipton, R4 Heimburg
    { player: "Anthony Barela",               hot: 1 },
    { player: "Ricky Wysocki",                hot: 1 },
    { player: "Sullivan Tipton",              hot: 1 },
    { player: "Calvin Heimburg",              hot: 1 },
    // FPO: R1 Saarinen, R2 Gannon+Lätt+Pierce (3-way tie),
    //       R3 Gannon, R4 Anniken
    { player: "Silva Saarinen",               hot: 1 },
    { player: "Missy Gannon",                 hot: 2 }, // R2 + R3
    { player: "Kristin Lätt",                 hot: 1 },
    { player: "Paige Pierce",                 hot: 1 },
    { player: "Anniken Kristiansen Steen",    hot: 1 },
  ],

  "Big Easy Open": [
    // MPO: R1 Ty Love (not in DB), R2 Wysocki, R3 Buhr+Dickerson (tie)
    { player: "Ricky Wysocki",    hot: 1 },
    { player: "Gannon Buhr",      hot: 1 },
    { player: "Chris Dickerson",  hot: 1 },
    // FPO: R1 Handley, R2 Gannon, R3 Gurthie
    { player: "Holyn Handley",    hot: 1 },
    { player: "Missy Gannon",     hot: 1 },
    { player: "Jessica Gurthie",  hot: 1 },
    // Ace: Luke Taylor hole 9, 382 ft
    { player: "Luke Taylor",      ace: 1 },
  ],

  "Queen City Classic": [
    // MPO: R1 E.Smith+C.White (tie), R2 Buhr, R3 Klein
    { player: "Evan Smith",       hot: 1 },
    { player: "Casey White",      hot: 1 },
    { player: "Gannon Buhr",      hot: 1 },
    { player: "Kyle Klein",       hot: 1 },
    // FPO: R1 Anniken, R2 Mertsch, R3 Saarinen
    { player: "Anniken Kristiansen Steen",  hot: 1 },
    { player: "Kat Mertsch",                hot: 1 },
    { player: "Silva Saarinen",             hot: 1 },
    // Ace: Jessica Gurthie hole 2 R2, 321 ft
    { player: "Jessica Gurthie",  ace: 1 },
  ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load players
  const { data: players, error: pErr } = await supabase
    .from("players").select("id, name");
  if (pErr) throw pErr;
  const nameToId = Object.fromEntries(players.map((p) => [p.name, p.id]));

  // Load tournaments (all leagues — same name→id per league)
  const { data: tournaments, error: tErr } = await supabase
    .from("tournaments").select("id, name, league_id");
  if (tErr) throw tErr;
  // Group by name
  const byName = {};
  for (const t of tournaments) {
    (byName[t.name] ??= []).push(t);
  }

  for (const [tournamentName, bonuses] of Object.entries(BONUSES)) {
    const tRows = byName[tournamentName];
    if (!tRows?.length) {
      console.log(`[skip] tournament not found: ${tournamentName}`);
      continue;
    }

    console.log(`\n── ${tournamentName}`);

    for (const bonus of bonuses) {
      const playerId = nameToId[bonus.player];
      if (!playerId) {
        console.log(`  [skip] unknown player: ${bonus.player}`);
        continue;
      }

      const updates = {};
      if (bonus.hot)   updates.hot_round_count  = bonus.hot;
      if (bonus.clean) updates.bogey_free_count  = bonus.clean;
      if (bonus.ace)   updates.ace_count         = bonus.ace;

      // Apply to every league's tournament with this name
      for (const t of tRows) {
        const { error } = await supabase
          .from("tournament_results")
          .update(updates)
          .eq("tournament_id", t.id)
          .eq("player_id", playerId);

        if (error) {
          console.log(`  [error] ${bonus.player}: ${error.message}`);
        } else {
          const label = [
            bonus.hot   && `${bonus.hot} hot`,
            bonus.clean && `${bonus.clean} clean`,
            bonus.ace   && `${bonus.ace} ace`,
          ].filter(Boolean).join(", ");
          console.log(`  ✓ ${bonus.player}: ${label}`);
        }
      }
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
