/**
 * Seeds the 6 real 2025/2026 disc golf tournaments and their results
 * into every existing league.
 *
 * Run: node scripts/seed-tournaments.mjs
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://cagyuhuzvannojeqkmun.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhZ3l1aHV6dmFubm9qZXFrbXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODI3ODM5MCwiZXhwIjoyMDkzODU0MzkwfQ.myAmFAs8UIv6PMiO9LwdUinlCW4Xgt1iY-1uBlVUeXc"
);

// ─── Scoring tables ───────────────────────────────────────────────────────────

function mpoPoints(pos) {
  if (pos === 1) return 82;
  if (pos === 2) return 70;
  if (pos === 3) return 60;
  if (pos === 4) return 53;
  if (pos === 5) return 47;
  if (pos === 6) return 42;
  if (pos === 7) return 38;
  if (pos === 8) return 35;
  if (pos === 9) return 32;
  if (pos === 10) return 29;
  if (pos === 11) return 26;
  if (pos === 12) return 24;
  if (pos === 13) return 22;
  if (pos === 14) return 20;
  if (pos === 15) return 19;
  if (pos === 16) return 18;
  if (pos === 17) return 17;
  if (pos === 18) return 16;
  if (pos <= 20) return 15;
  if (pos === 21) return 13;
  if (pos === 22) return 12;
  if (pos <= 24) return 11;
  if (pos <= 26) return 10;
  if (pos <= 30) return 9;
  if (pos <= 32) return 8;
  if (pos <= 40) return 6;
  if (pos <= 50) return 4;
  if (pos <= 60) return 3;
  return 1;
}

function fpoPoints(pos) {
  if (pos === 1) return 54;
  if (pos === 2) return 46;
  if (pos === 3) return 40;
  if (pos === 4) return 35;
  if (pos === 5) return 31;
  if (pos === 6) return 28;
  if (pos === 7) return 25;
  if (pos === 8) return 23;
  if (pos === 9) return 21;
  if (pos === 10) return 18;
  if (pos === 11) return 17;
  if (pos === 12) return 15;
  if (pos === 13) return 14;
  if (pos === 14) return 13;
  if (pos === 15) return 12;
  if (pos === 16) return 11;
  if (pos <= 25) return 9;
  if (pos <= 35) return 6;
  if (pos <= 45) return 4;
  return 2;
}

/** Average points across a tied range, rounded to nearest integer. */
function tiedPts(startPos, endPos, divFn) {
  let total = 0;
  for (let p = startPos; p <= endPos; p++) total += divFn(p);
  return Math.round(total / (endPos - startPos + 1));
}

// ─── Tournament data ──────────────────────────────────────────────────────────
// Each entry: { name, start, end } where start/end are tie-range positions.
// For solo placements start === end.

const TOURNAMENTS = [
  {
    name: "Supreme Flight Open",
    week: 1,
    start_date: "2025-03-02",
    mpo: [
      { name: "Ezra Robinson",    start: 1,  end: 1  },
      { name: "Anthony Barela",   start: 2,  end: 2  },
      { name: "Paul McBeth",      start: 3,  end: 3  },
      { name: "Ricky Wysocki",    start: 4,  end: 4  },
      { name: "Calvin Heimburg",  start: 5,  end: 5  },
      { name: "Kyle Klein",       start: 6,  end: 8  }, // T6 3-way
      { name: "Simon Lizotte",    start: 6,  end: 8  },
      { name: "Jake Monn",        start: 6,  end: 8  },
      { name: "Adam Hammes",      start: 9,  end: 10 }, // T9 2-way
      { name: "Austin Turner",    start: 9,  end: 10 },
      { name: "Chris Dickerson",  start: 11, end: 11 },
      { name: "Corey Ellis",      start: 15, end: 16 }, // T15 2-way
      { name: "Aaron Gossage",    start: 15, end: 16 },
      { name: "Luke Taylor",      start: 19, end: 20 }, // T20 2-way
    ],
    fpo: [
      { name: "Ella Hansen",      start: 1, end: 1  },
      { name: "Eveliina Salonen", start: 2, end: 3  }, // T2 after 3-way playoff
      { name: "Holyn Handley",    start: 2, end: 3  },
      { name: "Kat Mertsch",      start: 4, end: 4  },
      { name: "Silva Saarinen",   start: 6, end: 7  }, // T6 2-way
      { name: "Ohn Scoggins",     start: 8, end: 8  },
    ],
  },
  {
    name: "Jonesboro Open",
    week: 2,
    start_date: "2025-03-29",
    mpo: [
      { name: "Benjamin Callaway", start: 1, end: 1 },
      { name: "Aaron Gossage",     start: 2, end: 2 },
      // 3rd Väinö Mäkelä not in DB
      { name: "Jesse Nieminen",    start: 4, end: 4 },
      // 5th Joona Heinänen, 6th Braeden Sides not in DB
      { name: "Corey Ellis",       start: 7, end: 7 },
      { name: "Jakub Semerád",     start: 8, end: 8 },
    ],
    fpo: [
      { name: "Kristin Lätt",    start: 1, end: 1 },
      { name: "Silva Saarinen",  start: 2, end: 2 },
      { name: "Rebecca Cox",     start: 3, end: 3 },
      { name: "Catrina Allen",   start: 4, end: 4 },
      { name: "Kat Mertsch",     start: 5, end: 5 },
    ],
  },
  {
    name: "Kansas City Wide Open",
    week: 3,
    start_date: "2025-04-20",
    mpo: [
      { name: "Gannon Buhr",      start: 1,  end: 1  },
      { name: "Ricky Wysocki",    start: 2,  end: 2  },
      { name: "Paul McBeth",      start: 3,  end: 3  },
      // 4th Gavin Rathbun not in DB
      { name: "Kyle Klein",       start: 5,  end: 5  },
      { name: "Chris Dickerson",  start: 6,  end: 8  }, // T6 3-way
      { name: "Calvin Heimburg",  start: 6,  end: 8  },
      { name: "Isaac Robinson",   start: 6,  end: 8  },
      { name: "Eagle McMahon",    start: 9,  end: 10 }, // T9 2-way (Joey Buckets not in DB)
      { name: "Ezra Aderhold",    start: 11, end: 14 }, // T11 4-way
      { name: "Harry Chace",      start: 11, end: 14 },
      { name: "Sullivan Tipton",  start: 11, end: 14 },
      { name: "Bradley Williams", start: 11, end: 14 },
      { name: "Anthony Barela",   start: 15, end: 15 },
      { name: "Joel Freeman",     start: 16, end: 18 }, // T16 3-way
      { name: "Jesse Nieminen",   start: 16, end: 18 },
      { name: "Matthew Orum",     start: 16, end: 18 },
      { name: "Aaron Gossage",    start: 19, end: 23 }, // T19 5-way
      { name: "Paul Krans",       start: 19, end: 23 },
      { name: "Austin Turner",    start: 19, end: 23 },
      { name: "Paul Ulibarri",    start: 19, end: 23 },
      { name: "Casey White",      start: 19, end: 23 },
      { name: "Cole Redalen",     start: 24, end: 28 }, // T24 5-way (others not in DB)
      { name: "Ezra Robinson",    start: 24, end: 28 },
      { name: "Mason Ford",       start: 24, end: 28 },
      { name: "Andrew Presnell",  start: 29, end: 31 }, // T29 3-way
      { name: "Luke Taylor",      start: 29, end: 31 },
      { name: "Gavin Babcock",    start: 34, end: 42 }, // T34 9-way
      { name: "Parker Welck",     start: 34, end: 42 },
      { name: "Silas Schultz",    start: 43, end: 45 }, // T43 3-way
      { name: "Jake Monn",        start: 46, end: 50 }, // T46 5-way
      { name: "Zachary Nash",     start: 46, end: 50 },
    ],
    fpo: [
      { name: "Holyn Handley",      start: 1,  end: 1  },
      { name: "Cadence Burge",      start: 2,  end: 2  },
      { name: "Ella Hansen",        start: 3,  end: 3  },
      { name: "Missy Gannon",       start: 4,  end: 4  },
      { name: "Ohn Scoggins",       start: 5,  end: 5  },
      { name: "Kat Mertsch",        start: 6,  end: 6  },
      { name: "Hanna Huynh",        start: 7,  end: 8  }, // T7 2-way
      { name: "Valerie Mandujano",  start: 7,  end: 8  },
      // 9th Jessica Weese, 11th Natalie Ryan not in DB
      { name: "Hailey King",        start: 10, end: 10 },
      { name: "Jennifer Allen",     start: 12, end: 12 },
      { name: "Rebecca Cox",        start: 13, end: 13 },
      // 14th Heidi Laine, 15th Raven Klein not in DB
      { name: "Catrina Allen",      start: 16, end: 16 },
      // 17th-18th not in DB
      { name: "Alexis Mandujano",   start: 19, end: 19 },
      { name: "Lisa Fajkus",        start: 34, end: 34 },
    ],
  },
  {
    name: "Champions Cup",
    week: 4,
    start_date: "2025-05-04",
    mpo: [
      { name: "Isaac Robinson",   start: 1, end: 1 },
      { name: "Anthony Barela",   start: 2, end: 2 },
      { name: "Andrew Marwede",   start: 3, end: 3 },
      { name: "Gannon Buhr",      start: 4, end: 4 },
      { name: "Adam Hammes",      start: 5, end: 7 }, // T5 3-way
      { name: "Ricky Wysocki",    start: 5, end: 7 },
      { name: "Sullivan Tipton",  start: 5, end: 7 },
      { name: "Calvin Heimburg",  start: 8, end: 8 },
    ],
    fpo: [
      { name: "Missy Gannon",                 start: 1, end: 1 },
      { name: "Kristin Lätt",                 start: 2, end: 2 },
      { name: "Paige Pierce",                 start: 3, end: 3 },
      { name: "Silva Saarinen",               start: 4, end: 4 },
      { name: "Holyn Handley",                start: 5, end: 5 },
      { name: "Eveliina Salonen",             start: 6, end: 6 },
      { name: "Anniken Kristiansen Steen",    start: 7, end: 7 },
      { name: "Catrina Allen",                start: 8, end: 8 },
    ],
  },
  {
    name: "Big Easy Open",
    week: 5,
    start_date: "2026-03-15",
    mpo: [
      { name: "Gannon Buhr",     start: 1, end: 1 },
      { name: "Ricky Wysocki",   start: 2, end: 2 },
      { name: "Isaac Robinson",  start: 3, end: 3 },
      { name: "Luke Taylor",     start: 4, end: 4 },
      { name: "Joseph Anderson", start: 5, end: 5 },
      { name: "Chris Dickerson", start: 6, end: 6 },
      // 7th Ty Love not in DB
      { name: "Aaron Gossage",   start: 8, end: 8 },
    ],
    fpo: [
      { name: "Holyn Handley",     start: 1,  end: 1  },
      { name: "Valerie Mandujano", start: 2,  end: 3  }, // T2 2-way
      { name: "Lisa Fajkus",       start: 2,  end: 3  },
      { name: "Ohn Scoggins",      start: 4,  end: 5  }, // T4 2-way
      { name: "Missy Gannon",      start: 4,  end: 5  },
      { name: "Jessica Gurthie",   start: 6,  end: 7  }, // T6 2-way
      { name: "Kat Mertsch",       start: 6,  end: 7  },
      { name: "Cadence Burge",     start: 16, end: 16 },
    ],
  },
  {
    name: "Queen City Classic",
    week: 6,
    start_date: "2026-03-29",
    mpo: [
      { name: "Gannon Buhr",   start: 1, end: 1 },
      { name: "Raven Newsom",  start: 2, end: 3 }, // T2 2-way
      { name: "Evan Smith",    start: 2, end: 3 },
      { name: "Jake Monn",     start: 4, end: 4 },
      // 5th Harper Thompson not in DB
      { name: "Casey White",   start: 6, end: 7 }, // T6 2-way
      { name: "Joel Freeman",  start: 6, end: 7 },
      { name: "Kyle Klein",    start: 8, end: 8 },
    ],
    fpo: [
      { name: "Jessica Gurthie",                start: 1, end: 1 },
      { name: "Ohn Scoggins",                   start: 2, end: 2 },
      { name: "Holyn Handley",                  start: 3, end: 5 }, // T3 3-way
      { name: "Anniken Kristiansen Steen",      start: 3, end: 5 },
      { name: "Kat Mertsch",                    start: 3, end: 5 },
      { name: "Silva Saarinen",                 start: 6, end: 7 }, // T6 2-way
      { name: "Missy Gannon",                   start: 6, end: 7 },
      { name: "Valerie Mandujano",              start: 8, end: 8 },
    ],
  },
];

// ─── Name aliases (results use alternate forms of some names in the DB) ───────

const ALIASES = {
  "Richard Wysocki": "Ricky Wysocki",
  "Ben Callaway": "Benjamin Callaway",
  "Matt Orum": "Matthew Orum",
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load all players into a name → id map
  const { data: players, error: pErr } = await supabase
    .from("players")
    .select("id, name, division");
  if (pErr) throw pErr;

  const nameToId = {};
  for (const p of players) {
    nameToId[p.name] = p.id;
    // Add alias reverse lookups
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      if (canonical === p.name) nameToId[alias] = p.id;
    }
  }

  // 2. Load all leagues
  const { data: leagues, error: lErr } = await supabase
    .from("leagues")
    .select("id, name");
  if (lErr) throw lErr;
  console.log(`Found ${leagues.length} league(s): ${leagues.map((l) => l.name).join(", ")}`);

  for (const league of leagues) {
    console.log(`\n── League: ${league.name} (${league.id})`);

    for (const t of TOURNAMENTS) {
      // Check if this tournament already exists for this league
      const { data: existing } = await supabase
        .from("tournaments")
        .select("id")
        .eq("league_id", league.id)
        .eq("name", t.name)
        .maybeSingle();

      let tournamentId;
      if (existing) {
        tournamentId = existing.id;
        console.log(`  [skip] ${t.name} already exists (id=${tournamentId})`);
      } else {
        const { data: inserted, error: tErr } = await supabase
          .from("tournaments")
          .insert({
            league_id: league.id,
            name: t.name,
            week: t.week,
            start_date: t.start_date,
            season_year: new Date(t.start_date).getFullYear(),
          })
          .select("id")
          .single();
        if (tErr) { console.error(`  [error] insert tournament ${t.name}:`, tErr.message); continue; }
        tournamentId = inserted.id;
        console.log(`  [added] ${t.name} (id=${tournamentId})`);
      }

      // Insert results for each division
      const allEntries = [
        ...t.mpo.map((e) => ({ ...e, div: "MPO", pointsFn: mpoPoints })),
        ...t.fpo.map((e) => ({ ...e, div: "FPO", pointsFn: fpoPoints })),
      ];

      for (const entry of allEntries) {
        const playerId = nameToId[entry.name];
        if (!playerId) {
          console.log(`    [skip] unknown player: ${entry.name}`);
          continue;
        }

        const fantasyPoints = tiedPts(entry.start, entry.end, entry.pointsFn);
        const finishingPosition = entry.start; // use tie-start as finishing position

        const { error: rErr } = await supabase
          .from("tournament_results")
          .upsert(
            {
              tournament_id: tournamentId,
              player_id: playerId,
              finishing_position: finishingPosition,
              fantasy_points: fantasyPoints,
              hot_round_count: 0,
              bogey_free_count: 0,
              ace_count: 0,
            },
            { onConflict: "tournament_id,player_id" }
          );

        if (rErr) {
          console.error(`    [error] result for ${entry.name}:`, rErr.message);
        } else {
          console.log(`    ${entry.div} ${entry.start === entry.end ? `#${entry.start}` : `T${entry.start}`} ${entry.name}: ${fantasyPoints} pts`);
        }
      }
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
