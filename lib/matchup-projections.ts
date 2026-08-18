// Single source of truth for a league week's matchup numbers: per-player
// actuals, projections and pace estimates, each team's totals, and the win
// percentage between two teams.
//
// Every surface that shows a matchup — the league dashboard, the matchups
// list, the matchup detail page, Your Matchup, and the gameday snapshot pass —
// must call this, or the same matchup reads differently depending on where you
// look at it (different scoring rules, a different starter set, a different
// pace divisor → different projections and win %).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLeagueNextTournamentId,
  getLeagueSchedule,
  type LeagueSchedule,
} from "@/lib/league-schedule";
import { applyProjectionVariance, winProbability } from "@/lib/projections";
import { selectAllRows } from "@/lib/supabase/select-all";
import { fantasyPointsFromResult, resolveScoringRules } from "@/lib/scoring-rules";

export type MatchupWeekStat = {
  finishing_position: number | null;
  hot_round_count: number;
  bogey_free_count: number;
  ace_count: number;
  under_par_strokes: number;
  over_par_strokes: number;
  eagle_count: number;
};

export type MatchupPlayerRow = {
  rosterId: number;
  playerId: number;
  name: string;
  division: "MPO" | "FPO";
  /** "MPO1", "FPO2", "BN" … */
  slotLabel: string;
  /** Points scored at this week's event, or null if nothing posted yet. */
  actual: number | null;
  /** Pre-event season-average projection (0 when the player is OUT). */
  projected: number | null;
  /** Live pace extrapolation (actual ÷ event progress), only while in progress. */
  paceProjected: number | null;
  isOut: boolean;
  /** Raw week stats behind `actual`, for score breakdowns. */
  weekStat: MatchupWeekStat | null;
};

export type TeamWeekNumbers = {
  /** Slot-ordered starters (null = empty slot), capped at the league's slot counts. */
  starters: (MatchupPlayerRow | null)[];
  bench: MatchupPlayerRow[];
  /** Starter points actually scored this week. */
  actual: number;
  /** Pre-event projection for the starters (no pace, no actuals). */
  projected: number;
  /** Expected final total: pace where live, actuals once settled, else projection. */
  finishing: number;
};

export type WeekProjections = {
  week: number;
  tournamentIds: number[];
  primaryTournamentId: number | null;
  eventName: string | null;
  eventDateLabel: string | null;
  /** Now is between the event's lock/start and its end date. */
  inProgress: boolean;
  /** Now is past the event's end date. */
  ended: boolean;
  /** Ended with scores on the board but not yet finalized — show "Unofficial". */
  settled: boolean;
  /** 0..1 through the event window (0 unless in progress). */
  progressFrac: number;
  /** Event window in epoch ms (null when the week has no imported event). */
  eventStartMs: number | null;
  eventEndMs: number | null;
  /** Any player in scope has points at this week's event. */
  hasActuals: boolean;
  mpoSlots: number;
  fpoSlots: number;
  teamNumbers: (teamId: number) => TeamWeekNumbers;
  /** Win % for team1 given both teams' finishing estimates. */
  winPctFor: (team1Id: number, team2Id: number) => number;
};

// Mirrors cappedStarterIds (lib/lineup-slots.ts), which is what the official
// weekly finalize scores: same players, just kept in slot order for display.
// The unordered tiebreak is player_id there, so it is here too — otherwise a
// team with more flagged starters than slots (all with a null lineup_order)
// could project one player and score a different one.
function buildSlotArray<T extends { lineup_order: number | null; player_id: number }>(
  starters: T[],
  numSlots: number,
): (T | null)[] {
  const result: (T | null)[] = new Array(numSlots).fill(null);
  const unordered: T[] = [];
  for (const s of starters) {
    const o = s.lineup_order;
    if (o != null && o >= 1 && o <= numSlots && result[o - 1] === null) {
      result[o - 1] = s;
    } else {
      unordered.push(s);
    }
  }
  unordered.sort((a, b) => a.player_id - b.player_id);
  let ui = 0;
  for (let i = 0; i < numSlots && ui < unordered.length; i++) {
    if (result[i] === null) result[i] = unordered[ui++];
  }
  return result;
}

function formatDateRange(start?: string | null, end?: string | null): string | null {
  if (!start) return null;
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const s = fmt(start);
  const e = end ? fmt(end) : s;
  return s === e ? s : `${s} – ${e}`;
}

export async function buildWeekProjections(
  supabase: SupabaseClient,
  opts: {
    leagueId: number;
    week: number;
    /** Reuse an already-loaded schedule to skip a refetch. */
    schedule?: LeagueSchedule | null;
    /** Reuse an already-loaded league row (needs mpo_starters, fpo_starters, scoring_rules). */
    league?: { mpo_starters?: number | null; fpo_starters?: number | null; scoring_rules?: unknown } | null;
    /** Limit roster loading to these teams (matchup pages); omit for the whole league. */
    teamIds?: number[];
  },
): Promise<WeekProjections> {
  const { leagueId, week, teamIds } = opts;

  let league = opts.league ?? null;
  if (!league) {
    const { data } = await supabase
      .from("leagues")
      .select("mpo_starters, fpo_starters, scoring_rules")
      .eq("id", leagueId)
      .maybeSingle();
    league = data as typeof league;
  }
  const mpoSlots = league?.mpo_starters ?? 4;
  const fpoSlots = league?.fpo_starters ?? 2;
  const rules = resolveScoringRules(league?.scoring_rules);

  const schedule =
    opts.schedule !== undefined ? opts.schedule : await getLeagueSchedule(supabase, leagueId);
  const scheduleWeek = schedule?.weeks.find((w) => w.week === week) ?? null;
  // A scheduled week whose event simply isn't imported yet has no tournament
  // rows — that's correct (pure projections, nobody OUT). Only a league with no
  // schedule mapping at all falls back to its current/next event.
  let tournamentIds = scheduleWeek?.tournamentIds ?? [];
  if (!scheduleWeek) {
    const fallback = await getLeagueNextTournamentId(supabase, leagueId);
    if (fallback != null) tournamentIds = [fallback];
  }

  const { data: tournamentRows } = tournamentIds.length > 0
    ? await supabase
        .from("tournaments")
        .select("id, name, start_date, end_date, lock_at, registered_player_ids")
        .in("id", tournamentIds)
        .order("start_date", { ascending: true })
    : { data: [] as any[] };
  const weekTournamentIds = new Set((tournamentRows ?? []).map((t: any) => t.id as number));
  const primary = (tournamentRows ?? [])[0] as any | undefined;

  // Event window. `lock_at` is round-1 tee time; `end_date` is the last
  // competition day, treated as ending 23:59:59 UTC.
  let inProgress = false;
  let ended = false;
  let progressFrac = 0;
  let eventStartMs: number | null = null;
  let eventEndMs: number | null = null;
  if (primary) {
    const startMs = primary.lock_at
      ? Date.parse(primary.lock_at)
      : Date.parse(`${primary.start_date}T00:00:00Z`);
    const endMs = Date.parse(`${primary.end_date}T23:59:59Z`);
    eventStartMs = Number.isFinite(startMs) ? startMs : null;
    eventEndMs = Number.isFinite(endMs) ? endMs : null;
    const now = Date.now();
    inProgress =
      Number.isFinite(startMs) && Number.isFinite(endMs) && now >= startMs && now <= endMs;
    ended = Number.isFinite(endMs) && now > endMs;
    const span = endMs - startMs;
    if (inProgress && span > 0) {
      progressFrac = Math.min(1, Math.max(0, (now - startMs) / span));
    }
  }
  // Clamp the pace divisor so a small actual at hour 1 doesn't extrapolate to
  // an absurd finishing total.
  const paceDivisor = Math.max(progressFrac, 0.1);

  // Players not registered for this week's event are OUT (projected 0).
  const regIds = primary?.registered_player_ids as number[] | null | undefined;
  const registeredSet = regIds && regIds.length > 0 ? new Set(regIds) : null;

  let rosterQuery = supabase
    .from("rosters")
    .select("id, team_id, player_id, is_starter, lineup_order, players(name, division)")
    .eq("league_id", leagueId);
  if (teamIds && teamIds.length > 0) rosterQuery = rosterQuery.in("team_id", teamIds);
  const { data: roster } = await rosterQuery
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  const allRoster = (roster ?? []) as any[];

  const playerIds = [...new Set(allRoster.map((r) => r.player_id as number))];
  // Paged: a whole league's rostered players cross the 1000-row select cap
  // partway through a season, and the truncated page comes back without an
  // error — every projection built from it would quietly drift low.
  const results = playerIds.length > 0
    ? await selectAllRows<any>(() =>
        supabase
          .from("tournament_results")
          .select("player_id, tournament_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)")
          .in("player_id", playerIds) as any,
      )
    : [];

  // Season average per player (the projection base) + this week's actuals,
  // both recomputed under the league's own scoring rules — never the stored
  // fantasy_points column, which is scored under the defaults.
  const totals = new Map<number, { sum: number; count: number }>();
  const actuals = new Map<number, number>();
  const weekStats = new Map<number, MatchupWeekStat>();
  results.forEach((r: any) => {
    const pts = fantasyPointsFromResult(rules, {
      finishing_position: r.finishing_position,
      hot_round_count: r.hot_round_count,
      bogey_free_count: r.bogey_free_count,
      ace_count: r.ace_count,
      under_par_strokes: r.under_par_strokes,
      over_par_strokes: r.over_par_strokes,
      eagle_count: r.eagle_count,
      division: r.players?.division ?? "MPO",
    });
    const cur = totals.get(r.player_id) ?? { sum: 0, count: 0 };
    cur.sum += pts;
    cur.count += 1;
    totals.set(r.player_id, cur);
    if (weekTournamentIds.has(r.tournament_id)) {
      actuals.set(r.player_id, (actuals.get(r.player_id) ?? 0) + pts);
      const ws = weekStats.get(r.player_id) ?? {
        finishing_position: null, hot_round_count: 0, bogey_free_count: 0,
        ace_count: 0, under_par_strokes: 0, over_par_strokes: 0, eagle_count: 0,
      };
      ws.finishing_position = r.finishing_position ?? ws.finishing_position;
      ws.hot_round_count += Number(r.hot_round_count ?? 0);
      ws.bogey_free_count += Number(r.bogey_free_count ?? 0);
      ws.ace_count += Number(r.ace_count ?? 0);
      ws.under_par_strokes += Number(r.under_par_strokes ?? 0);
      ws.over_par_strokes += Number(r.over_par_strokes ?? 0);
      ws.eagle_count += Number(r.eagle_count ?? 0);
      weekStats.set(r.player_id, ws);
    }
  });

  // Event over with scores on the board (awaiting the Monday finalize): the
  // finishing totals ARE the actuals, so the win bar tracks the real result.
  const settled = ended && actuals.size > 0;
  const effectiveProgress = settled ? 1 : progressFrac;

  function rowFor(s: any, slotLabel: string): MatchupPlayerRow {
    const t = totals.get(s.player_id);
    const actual = actuals.has(s.player_id)
      ? Math.round(actuals.get(s.player_id)! * 10) / 10
      : null;
    const seasonProjected = t && t.count > 0
      ? applyProjectionVariance(t.sum / t.count, s.player_id, 3)
      : null;
    const isOut = registeredSet != null && !registeredSet.has(s.player_id) && actual == null;
    return {
      rosterId: s.id,
      playerId: s.player_id,
      name: s.players?.name ?? "Unknown",
      division: (s.players?.division as "MPO" | "FPO") ?? "MPO",
      slotLabel,
      actual,
      projected: isOut ? 0 : seasonProjected,
      paceProjected:
        inProgress && actual != null ? Math.round((actual / paceDivisor) * 10) / 10 : null,
      isOut,
      weekStat: weekStats.get(s.player_id) ?? null,
    };
  }

  const finishingFor = (r: MatchupPlayerRow) =>
    r.paceProjected ?? (settled ? (r.actual ?? 0) : (r.projected ?? 0));

  const cache = new Map<number, TeamWeekNumbers>();
  function teamNumbers(teamId: number): TeamWeekNumbers {
    const hit = cache.get(teamId);
    if (hit) return hit;

    const teamRoster = allRoster.filter((r) => r.team_id === teamId);
    const mpoSlotArr = buildSlotArray(
      teamRoster.filter((r) => r.is_starter && r.players?.division === "MPO"),
      mpoSlots,
    );
    const fpoSlotArr = buildSlotArray(
      teamRoster.filter((r) => r.is_starter && r.players?.division === "FPO"),
      fpoSlots,
    );

    const starters: (MatchupPlayerRow | null)[] = [
      ...mpoSlotArr.map((spot, i) => (spot ? rowFor(spot, `MPO${i + 1}`) : null)),
      ...fpoSlotArr.map((spot, i) => (spot ? rowFor(spot, `FPO${i + 1}`) : null)),
    ];

    const starterRosterIds = new Set(
      [...mpoSlotArr, ...fpoSlotArr].filter(Boolean).map((r: any) => r.id),
    );
    const bench: MatchupPlayerRow[] = teamRoster
      .filter((r) => !starterRosterIds.has(r.id))
      .sort((a, b) => {
        // MPO first, then FPO, then by id (preserves the lineup_order/id order).
        const da = a.players?.division === "MPO" ? 0 : 1;
        const db = b.players?.division === "MPO" ? 0 : 1;
        if (da !== db) return da - db;
        return a.id - b.id;
      })
      .map((r) => rowFor(r, "BN"));

    const sum = (pick: (r: MatchupPlayerRow) => number | null) =>
      Math.round(starters.reduce((acc, r) => acc + (r ? (pick(r) ?? 0) : 0), 0) * 10) / 10;

    const out: TeamWeekNumbers = {
      starters,
      bench,
      actual: sum((r) => r.actual),
      projected: sum((r) => r.projected),
      finishing: sum(finishingFor),
    };
    cache.set(teamId, out);
    return out;
  }

  return {
    week,
    tournamentIds: [...weekTournamentIds],
    primaryTournamentId: primary?.id ?? null,
    eventName: primary?.name ?? scheduleWeek?.event.name ?? null,
    eventDateLabel: formatDateRange(
      primary?.start_date ?? scheduleWeek?.event.startDate,
      primary?.end_date ?? scheduleWeek?.event.endDate,
    ),
    inProgress,
    ended,
    settled,
    progressFrac,
    eventStartMs,
    eventEndMs,
    hasActuals: actuals.size > 0,
    mpoSlots,
    fpoSlots,
    teamNumbers,
    winPctFor: (team1Id, team2Id) =>
      winProbability(
        teamNumbers(team1Id).finishing,
        teamNumbers(team2Id).finishing,
        effectiveProgress,
      ),
  };
}
