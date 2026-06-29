// Shared standings ranking with deterministic tiebreakers and strength of
// schedule, used by the league dashboard, playoffs seeding, and commissioner
// dashboard so every surface orders teams identically.

export type TeamRecord = { wins: number; losses: number; ties?: number; points: number };

export type StandingEntry = {
  teamId: number;
  wins: number;
  losses: number;
  ties: number;
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

/** Win percentage with ties counted as half a game, 0 when no games played. */
function winPctOf(r: TeamRecord | undefined): number {
  if (!r) return 0;
  const t = r.ties ?? 0;
  const games = r.wins + r.losses + t;
  return games > 0 ? (r.wins + 0.5 * t) / games : 0;
}

/**
 * Ranks teams by win percentage (ties = half a win), then — among teams with an
 * identical record — by head-to-head, then points for, then strength of
 * schedule, then team id for a stable order. Returns entries in ranked order,
 * each annotated with its strength of schedule.
 *
 * Head-to-head is resolved over the whole tied GROUP (each team's record
 * against the others in the tie), not pairwise inside the sort comparator — a
 * pairwise comparator is non-transitive for a 3+ team cycle (A>B>C>A) and
 * produces order-dependent, undefined results.
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

  const sos = (teamId: number): number => {
    const opps = opponents.get(teamId) ?? [];
    if (opps.length === 0) return -1;
    let sum = 0;
    for (const o of opps) sum += winPctOf(recMap.get(o));
    return sum / opps.length;
  };

  const winPct = new Map<number, number>();
  const entries: StandingEntry[] = Array.from(recMap.entries()).map(([teamId, r]) => {
    winPct.set(teamId, winPctOf(r));
    return {
      teamId,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties ?? 0,
      points: r.points,
      strengthOfSchedule: sos(teamId),
    };
  });

  // Deterministic baseline order (no pairwise head-to-head).
  const baseCompare = (a: StandingEntry, b: StandingEntry): number => {
    const wpA = winPct.get(a.teamId) ?? 0;
    const wpB = winPct.get(b.teamId) ?? 0;
    if (wpB !== wpA) return wpB - wpA;
    if (b.points !== a.points) return b.points - a.points;
    if (b.strengthOfSchedule !== a.strengthOfSchedule) return b.strengthOfSchedule - a.strengthOfSchedule;
    return a.teamId - b.teamId;
  };
  entries.sort(baseCompare);

  if (!headToHead) return entries;

  // Reorder each run of teams tied on win pct using head-to-head computed within
  // the tied group (wins against the other tied teams), then fall back through
  // points → SOS → teamId. This keeps the ordering transitive for any group.
  for (let i = 0; i < entries.length; ) {
    let j = i + 1;
    const wp = winPct.get(entries[i].teamId) ?? 0;
    while (j < entries.length && (winPct.get(entries[j].teamId) ?? 0) === wp) j++;
    if (j - i >= 2) {
      const group = entries.slice(i, j);
      const groupIds = new Set(group.map((e) => e.teamId));
      const h2hWins = (teamId: number): number => {
        const inner = h2h.get(teamId);
        if (!inner) return 0;
        let w = 0;
        for (const other of groupIds) if (other !== teamId) w += inner.get(other) ?? 0;
        return w;
      };
      group.sort((a, b) => {
        const ha = h2hWins(a.teamId);
        const hb = h2hWins(b.teamId);
        if (hb !== ha) return hb - ha;
        if (b.points !== a.points) return b.points - a.points;
        if (b.strengthOfSchedule !== a.strengthOfSchedule) return b.strengthOfSchedule - a.strengthOfSchedule;
        return a.teamId - b.teamId;
      });
      for (let k = 0; k < group.length; k++) entries[i + k] = group[k];
    }
    i = j;
  }

  return entries;
}
