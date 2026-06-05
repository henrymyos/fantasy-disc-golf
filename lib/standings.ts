// Shared standings ranking with deterministic tiebreakers and strength of
// schedule, used by the league dashboard, playoffs seeding, and commissioner
// dashboard so every surface orders teams identically.

export type TeamRecord = { wins: number; losses: number; points: number };

export type StandingEntry = {
  teamId: number;
  wins: number;
  losses: number;
  points: number;
  /** Average win percentage of opponents faced (0..1). -1 when no games yet. */
  strengthOfSchedule: number;
};

export type FinalMatchup = {
  team1_id: number;
  team2_id: number;
  team1_score: number;
  team2_score: number;
};

function toMap(records: Map<number, TeamRecord> | Record<number, TeamRecord>): Map<number, TeamRecord> {
  if (records instanceof Map) return records;
  return new Map(Object.entries(records).map(([k, v]) => [Number(k), v]));
}

/**
 * Ranks teams by wins, then head-to-head (when applicable), then points for,
 * then strength of schedule, then team id for a stable order. Returns entries
 * in ranked order, each annotated with its strength of schedule.
 */
export function rankTeams(
  records: Map<number, TeamRecord> | Record<number, TeamRecord>,
  finalMatchups: FinalMatchup[],
  opts: { headToHead?: boolean } = {},
): StandingEntry[] {
  const recMap = toMap(records);
  const headToHead = opts.headToHead ?? true;

  // Head-to-head wins: h2h.get(a)?.get(b) = times a beat b.
  const h2h = new Map<number, Map<number, number>>();
  const opponents = new Map<number, number[]>();
  const bump = (a: number, b: number) => {
    if (!h2h.has(a)) h2h.set(a, new Map());
    const inner = h2h.get(a)!;
    inner.set(b, (inner.get(b) ?? 0) + 1);
  };
  const addOpp = (a: number, b: number) => {
    if (!opponents.has(a)) opponents.set(a, []);
    opponents.get(a)!.push(b);
  };

  for (const m of finalMatchups) {
    addOpp(m.team1_id, m.team2_id);
    addOpp(m.team2_id, m.team1_id);
    if (m.team1_score > m.team2_score) bump(m.team1_id, m.team2_id);
    else if (m.team2_score > m.team1_score) bump(m.team2_id, m.team1_id);
  }

  const winPct = (teamId: number): number => {
    const r = recMap.get(teamId);
    if (!r) return 0;
    const g = r.wins + r.losses;
    return g > 0 ? r.wins / g : 0;
  };

  const sos = (teamId: number): number => {
    const opps = opponents.get(teamId) ?? [];
    if (opps.length === 0) return -1;
    let sum = 0;
    for (const o of opps) sum += winPct(o);
    return sum / opps.length;
  };

  const entries: StandingEntry[] = Array.from(recMap.entries()).map(([teamId, r]) => ({
    teamId,
    wins: r.wins,
    losses: r.losses,
    points: r.points,
    strengthOfSchedule: sos(teamId),
  }));

  entries.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (headToHead) {
      const aOverB = h2h.get(a.teamId)?.get(b.teamId) ?? 0;
      const bOverA = h2h.get(b.teamId)?.get(a.teamId) ?? 0;
      if (aOverB !== bOverA) return bOverA - aOverB;
    }
    if (b.points !== a.points) return b.points - a.points;
    if (b.strengthOfSchedule !== a.strengthOfSchedule) return b.strengthOfSchedule - a.strengthOfSchedule;
    return a.teamId - b.teamId;
  });

  return entries;
}
