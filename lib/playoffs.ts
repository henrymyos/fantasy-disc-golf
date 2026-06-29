// Single-elimination playoff bracket where each round is one playoff event and
// the higher weekly score advances. Reseeded each round (highest remaining seed
// plays lowest), decided from real scores — so the bracket, not the regular
// season standings, crowns the champion.

export type Seed = { teamId: number; teamName: string; username: string | null; seed: number };

export type RoundInput = {
  name: string;
  week: number | null;
  complete: boolean; // results are in for this round's event
};

export type BracketSlot = (Seed & { score: number | null }) | null;

export type BracketMatch = {
  a: BracketSlot;
  b: BracketSlot;
  winnerTeamId: number | null;
  decided: boolean;
};

export type BracketRound = { name: string; week: number | null; matches: BracketMatch[] };

export type PlayoffResult = { rounds: BracketRound[]; championTeamId: number | null };

/**
 * Bracket size = the largest power of two that fits both the team count and the
 * number of playoff events (one event per round). Returns 0 when a bracket
 * can't be formed.
 */
export function playoffBracketSize(playoffEventCount: number, teamCount: number): number {
  if (teamCount < 2 || playoffEventCount < 1) return 0;
  const maxRoundsByTeams = Math.floor(Math.log2(teamCount));
  const rounds = Math.max(1, Math.min(playoffEventCount, maxRoundsByTeams));
  return Math.pow(2, rounds);
}

export function simulatePlayoffs(
  seeds: Seed[],
  roundsInput: RoundInput[],
  scoreFor: (teamId: number, week: number | null) => number | null,
): PlayoffResult {
  let alive: Seed[] = seeds.map((s) => ({ ...s }));
  const rounds: BracketRound[] = [];
  let championTeamId: number | null = null;

  for (let r = 0; r < roundsInput.length && alive.length > 1; r++) {
    const round = roundsInput[r];
    const sorted = [...alive].sort((x, y) => x.seed - y.seed);
    const matches: BracketMatch[] = [];
    const winners: Seed[] = [];
    let unresolved = false;

    let i = 0;
    let j = sorted.length - 1;
    while (i < j) {
      const a = sorted[i];
      const b = sorted[j];
      const aScore = scoreFor(a.teamId, round.week);
      const bScore = scoreFor(b.teamId, round.week);
      let winnerTeamId: number | null = null;
      let decided = false;
      let aShown = aScore;
      let bShown = bScore;
      if (round.complete) {
        // The event is over, so a missing weekly total means the team simply
        // scored 0 (e.g. every starter was OUT) — not "result pending". Treat
        // null as 0 here; requiring both scores to be non-null would stall the
        // bracket forever on a legitimate zero.
        decided = true;
        const aS = aScore ?? 0;
        const bS = bScore ?? 0;
        aShown = aS;
        bShown = bS;
        // Tie goes to the higher seed (a, since `sorted` is seed-ascending).
        const winner = aS >= bS ? a : b;
        winnerTeamId = winner.teamId;
        winners.push(winner);
      } else {
        unresolved = true;
      }
      matches.push({ a: { ...a, score: aShown }, b: { ...b, score: bShown }, winnerTeamId, decided });
      i++;
      j--;
    }

    rounds.push({ name: round.name, week: round.week, matches });
    if (unresolved) break; // can't advance reliably until every match is decided
    alive = winners;
    if (alive.length === 1) championTeamId = alive[0].teamId;
  }

  return { rounds, championTeamId };
}
