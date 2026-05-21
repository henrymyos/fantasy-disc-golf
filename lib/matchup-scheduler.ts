// Builds a round-robin schedule for an arbitrary number of teams. The circle
// method generates N-1 unique pairings per cycle (each team plays each other
// team exactly once); extra weeks repeat the cycle with another rotation.
//
// Division weighting: if any teams have a division_name, after computing the
// base round-robin we greedily swap pairs week-by-week to favor in-division
// matchups, so teams in the same division play each other more often than
// out-of-division opponents. Heuristic — fine for small leagues; not
// guaranteed optimal.

export type SchedulableTeam = { id: number; divisionName: string | null };

function basePairsForWeek(teamIds: number[], week: number): Array<[number, number]> {
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(-1); // bye placeholder
  const n = teams.length;
  const half = n / 2;
  const fixed = teams[0];
  const rotating = teams.slice(1);
  const shift = (week - 1) % rotating.length;
  const rotated = [...rotating.slice(shift), ...rotating.slice(0, shift)];
  const schedule = [fixed, ...rotated];
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < half; i++) {
    const a = schedule[i];
    const b = schedule[schedule.length - 1 - i];
    if (a !== -1 && b !== -1) pairs.push([a, b]);
  }
  return pairs;
}

function preferInDivision(
  pairs: Array<[number, number]>,
  divisionByTeam: Map<number, string | null>,
): Array<[number, number]> {
  // Greedy local-swap: try every pair of (cross-division match, cross-division
  // match) and swap their second halves if both become in-division.
  const out = pairs.map((p) => [...p] as [number, number]);
  const sameDiv = (a: number, b: number) => {
    const da = divisionByTeam.get(a);
    const db = divisionByTeam.get(b);
    return da != null && db != null && da === db;
  };

  let improved = true;
  let safetyBudget = 64;
  while (improved && safetyBudget-- > 0) {
    improved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const [a1, a2] = out[i];
        const [b1, b2] = out[j];
        if (sameDiv(a1, a2) || sameDiv(b1, b2)) continue;
        // Swap second elements
        if (sameDiv(a1, b2) && sameDiv(b1, a2)) {
          out[i] = [a1, b2];
          out[j] = [b1, a2];
          improved = true;
        }
      }
    }
  }
  return out;
}

export function buildSeasonSchedule(
  teams: SchedulableTeam[],
  numWeeks: number,
): Array<{ week: number; pairs: Array<[number, number]> }> {
  if (teams.length < 2 || numWeeks < 1) return [];
  const teamIds = teams.map((t) => t.id);
  const divisionByTeam = new Map<number, string | null>(
    teams.map((t) => [t.id, t.divisionName ?? null]),
  );
  const hasDivisions = teams.some((t) => t.divisionName != null && t.divisionName !== "");

  const schedule: Array<{ week: number; pairs: Array<[number, number]> }> = [];
  for (let w = 1; w <= numWeeks; w++) {
    let pairs = basePairsForWeek(teamIds, w);
    if (hasDivisions) pairs = preferInDivision(pairs, divisionByTeam);
    schedule.push({ week: w, pairs });
  }
  return schedule;
}
