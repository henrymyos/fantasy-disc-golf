/**
 * Fantasy Disc Golf — Placement-Based Scoring Simulation
 * Queen City Classic 2026 MPO — 8-Team Snake Draft
 *
 * Run with:
 *   npx tsx scripts/simulate-scoring.ts
 *   npx ts-node --project tsconfig.json scripts/simulate-scoring.ts
 */

// ---------------------------------------------------------------------------
// 1. Scoring Table
// ---------------------------------------------------------------------------

function buildScoringTable(): Map<number, number> {
  const table = new Map<number, number>();
  const exact: [number, number][] = [
    [1, 110], [2, 92], [3, 78], [4, 68], [5, 60], [6, 54],
    [7, 49],  [8, 45], [9, 41], [10, 38],
    [11, 35], [12, 32], [13, 30], [14, 28], [15, 26], [16, 24],
    [17, 23], [18, 21], [19, 20], [20, 19],
    [21, 18], [22, 17], [23, 16], [24, 16], [25, 15], [26, 14],
    [27, 14], [28, 13], [29, 13], [30, 12],
  ];
  exact.forEach(([pos, pts]) => table.set(pos, pts));

  for (let i = 31; i <= 35; i++) table.set(i, 11);
  for (let i = 36; i <= 40; i++) table.set(i, 10);
  for (let i = 41; i <= 45; i++) table.set(i, 8);
  for (let i = 46; i <= 50; i++) table.set(i, 7);
  for (let i = 51; i <= 60; i++) table.set(i, 5);
  for (let i = 61; i <= 70; i++) table.set(i, 3);
  // 71+ gets 2 pts — we cap the table at 80
  for (let i = 71; i <= 80; i++) table.set(i, 2);

  return table;
}

const SCORING_TABLE = buildScoringTable();

function getRawPoints(position: number): number {
  return SCORING_TABLE.get(position) ?? 2;
}

// ---------------------------------------------------------------------------
// 2. Verify sum for positions 1–48 (should be ~1200)
// ---------------------------------------------------------------------------

function verifyScoringSum(): void {
  let total = 0;
  for (let i = 1; i <= 48; i++) total += getRawPoints(i);
  const avg = total / 48;
  console.log("=".repeat(60));
  console.log("SCORING TABLE VERIFICATION");
  console.log("=".repeat(60));
  console.log(`Sum of pts for positions 1–48 : ${total}`);
  console.log(`Average pts per position      : ${avg.toFixed(2)}`);
  console.log(`Expected 6-starter team avg   : ${(avg * 6).toFixed(2)} pts`);
  console.log(
    `Validation: sum ≈ 1200? ${Math.abs(total - 1200) < 50 ? "YES ✓" : "CHECK"}`
  );
  console.log();
}

// ---------------------------------------------------------------------------
// 3. Player Field
// ---------------------------------------------------------------------------

interface Player {
  name: string;
  finishingPosition: number;
  fantasyPoints: number;
}

// Tied players share averaged points of their shared positions.
// ties: array of [position, groupSize] — positions that are tied.
// If a player's finishingPosition equals the start of a tie group, they share
// average points across that group.
interface TieGroup {
  startPos: number;
  size: number;
}

function buildField(): Player[] {
  // Known real players with confirmed/realistic QCC 2026 finishes.
  // Top 20 as provided, with ties at 2nd handled explicitly.
  const knownPlayers: Array<{ name: string; pos: number }> = [
    { name: "Gannon Buhr",        pos: 1  },
    { name: "Raven Newsom",       pos: 2  }, // tied 2nd
    { name: "Evan Smith",         pos: 2  }, // tied 2nd
    { name: "Chris Dickerson",    pos: 4  },
    { name: "Calvin Heimburg",    pos: 5  },
    { name: "Austin Turner",      pos: 6  },
    { name: "Ricky Wysocki",      pos: 7  },
    { name: "Isaac Robinson",     pos: 8  },
    { name: "Adam Hammes",        pos: 9  },
    { name: "Aaron Gossage",      pos: 10 },
    { name: "Ezra Robinson",      pos: 11 },
    { name: "Luke Taylor",        pos: 12 },
    { name: "Anthony Barela",     pos: 13 },
    { name: "Joseph Anderson",    pos: 14 },
    { name: "Chandler Kramer",    pos: 15 },
    { name: "Anthony Anselmo",    pos: 16 },
    { name: "Nathan Queen",       pos: 17 },
    { name: "Joel Freeman",       pos: 18 },
    { name: "Casey White",        pos: 19 },
    { name: "Kyle Klein",         pos: 20 },
    // Fill positions 21–33 with other real DGPT pros
    { name: "Paul McBeth",        pos: 21 },
    { name: "Eagle McMahon",      pos: 22 },
    { name: "Simon Lizotte",      pos: 23 },
    { name: "James Conrad",       pos: 24 },
    { name: "Brodie Smith",       pos: 25 },
    { name: "Nikko Locastro",     pos: 26 },
    { name: "Kevin Jones",        pos: 27 },
    { name: "Nate Sexton",        pos: 28 },
    { name: "Garrett Gurthie",    pos: 29 },
    { name: "Matt Orum",          pos: 30 },
    { name: "Chris Clemons",      pos: 31 },
    { name: "Grady Shue",         pos: 32 },
    { name: "Drew Gibson",        pos: 33 },
  ];

  const players: Player[] = knownPlayers.map((p) => ({
    name: p.name,
    finishingPosition: p.pos,
    fantasyPoints: 0,
  }));

  // Fill remaining positions 34–80 with generic names
  const usedPositions = new Set(knownPlayers.map((p) => p.pos));
  let genericNum = 34;
  for (let pos = 34; pos <= 80; pos++) {
    if (!usedPositions.has(pos)) {
      players.push({ name: `Player ${genericNum}`, finishingPosition: pos, fantasyPoints: 0 });
    }
    genericNum++;
  }

  // Sort by finishing position (stable)
  players.sort((a, b) => a.finishingPosition - b.finishingPosition);

  return players;
}

// ---------------------------------------------------------------------------
// 4. Assign fantasy points with tie-averaging
// ---------------------------------------------------------------------------

function assignPoints(players: Player[]): void {
  // Group players by finishing position
  const byPos = new Map<number, Player[]>();
  for (const p of players) {
    const group = byPos.get(p.finishingPosition) ?? [];
    group.push(p);
    byPos.set(p.finishingPosition, group);
  }

  // For each position group, if >1 player they share average of
  // points for positions they occupy.
  for (const [startPos, group] of byPos.entries()) {
    const size = group.length;
    let ptSum = 0;
    for (let i = 0; i < size; i++) {
      ptSum += getRawPoints(startPos + i);
    }
    const avgPts = ptSum / size;
    for (const p of group) {
      p.fantasyPoints = Math.round(avgPts * 10) / 10; // round to 1 decimal
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Snake Draft
// ---------------------------------------------------------------------------

const TEAM_NAMES = [
  "Chain Gang",
  "Birdie Buccaneers",
  "Hyzer Hurricanes",
  "Disc Demons",
  "Bogey Busters",
  "Eagle Eagles",
  "Birdie Brigade",
  "Turnover Kings",
];

interface Team {
  name: string;
  roster: Player[];
  starters: Player[];
  score: number;
}

function snakeDraft(players: Player[], numTeams: number, rounds: number): Team[] {
  const teams: Team[] = TEAM_NAMES.map((name) => ({
    name,
    roster: [],
    starters: [],
    score: 0,
  }));

  // Players ordered best first (lowest position)
  const draftBoard = [...players].sort(
    (a, b) => a.finishingPosition - b.finishingPosition
  );

  let pickIdx = 0;
  for (let round = 0; round < rounds; round++) {
    const isEven = round % 2 === 0;
    const order = isEven
      ? Array.from({ length: numTeams }, (_, i) => i)       // 0..7
      : Array.from({ length: numTeams }, (_, i) => numTeams - 1 - i); // 7..0

    for (const teamIdx of order) {
      if (pickIdx < draftBoard.length) {
        teams[teamIdx].roster.push(draftBoard[pickIdx]);
        pickIdx++;
      }
    }
  }

  // Assign starters: best 6 by finishing position (lowest number = best)
  for (const team of teams) {
    const sorted = [...team.roster].sort(
      (a, b) => a.finishingPosition - b.finishingPosition
    );
    team.starters = sorted.slice(0, 6);
    team.score = team.starters.reduce((sum, p) => sum + p.fantasyPoints, 0);
  }

  return teams;
}

// ---------------------------------------------------------------------------
// 6. Print helpers
// ---------------------------------------------------------------------------

function pad(str: string, len: number, right = false): string {
  if (right) return str.padStart(len);
  return str.padEnd(len);
}

function printDraftResults(teams: Team[]): void {
  console.log("=".repeat(60));
  console.log("DRAFT RESULTS — 8-TEAM SNAKE DRAFT (10 rounds)");
  console.log("=".repeat(60));
  for (const team of teams) {
    console.log(`\n${team.name}`);
    console.log(pad("Player", 24) + pad("Finish", 8) + pad("Pts", 8) + "Starter?");
    console.log("-".repeat(52));
    const rosterSorted = [...team.roster].sort(
      (a, b) => a.finishingPosition - b.finishingPosition
    );
    const starterNames = new Set(team.starters.map((p) => p.name));
    for (const p of rosterSorted) {
      const isStarter = starterNames.has(p.name) ? "YES" : "-";
      console.log(
        pad(p.name, 24) +
          pad(`T${p.finishingPosition}`, 8) +
          pad(p.fantasyPoints.toFixed(1), 8) +
          isStarter
      );
    }
  }
}

function printStandings(teams: Team[]): void {
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  console.log("\n" + "=".repeat(60));
  console.log("LEAGUE STANDINGS");
  console.log("=".repeat(60));
  console.log(pad("Rank", 6) + pad("Team", 24) + pad("Score", 10) + "Starters");
  console.log("-".repeat(60));
  sorted.forEach((team, idx) => {
    const starterList = team.starters
      .map((p) => `${p.name}(${p.fantasyPoints.toFixed(1)})`)
      .join(", ");
    console.log(
      pad(`${idx + 1}.`, 6) +
        pad(team.name, 24) +
        pad(team.score.toFixed(1), 10) +
        starterList
    );
  });

  const totalScore = teams.reduce((s, t) => s + t.score, 0);
  const avgScore = totalScore / teams.length;
  console.log("\n" + "-".repeat(60));
  console.log(`Total pts across all teams : ${totalScore.toFixed(1)}`);
  console.log(`Average team score         : ${avgScore.toFixed(2)} pts`);
  console.log(
    `Target ~150? ${Math.abs(avgScore - 150) <= 15 ? "YES ✓ (within 15pts)" : "REVIEW — gap: " + Math.abs(avgScore - 150).toFixed(1)}`
  );
}

// ---------------------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------------------

function main(): void {
  verifyScoringSum();

  const players = buildField();
  assignPoints(players);

  // Print scoring table sample
  console.log("=".repeat(60));
  console.log("SCORING TABLE (sample: positions 1–35)");
  console.log("=".repeat(60));
  for (let i = 1; i <= 35; i++) {
    const pts = getRawPoints(i);
    process.stdout.write(`  ${String(i).padStart(2)}: ${String(pts).padStart(3)}pts`);
    if (i % 5 === 0) process.stdout.write("\n");
  }
  console.log();

  // Print field with fantasy pts
  console.log("\n" + "=".repeat(60));
  console.log("QCC 2026 MPO FIELD — FANTASY POINTS");
  console.log("=".repeat(60));
  console.log(pad("Pos", 6) + pad("Player", 26) + "Fantasy Pts");
  console.log("-".repeat(45));
  for (const p of players) {
    console.log(
      pad(`T${p.finishingPosition}`, 6) +
        pad(p.name, 26) +
        p.fantasyPoints.toFixed(1)
    );
  }

  const teams = snakeDraft(players, 8, 10);
  printDraftResults(teams);
  printStandings(teams);
}

main();
