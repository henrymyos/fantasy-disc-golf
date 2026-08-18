// One place that turns raw tournament_results rows into a league's fantasy
// points for a player.
//
// Two rules every surface has to follow, and each used to be re-implemented
// per page (with drift both ways):
//   1. Score under the LEAGUE's rules (resolveScoringRules + the raw stat
//      columns), never the stored `fantasy_points` column — that column is
//      scored under the DEFAULT rules, so a league with custom bonuses or a
//      custom placement table read different numbers depending on the page.
//   2. Page the query. A plain select is capped at 1000 rows, and
//      tournament_results outgrew that during the season (see selectAllRows).

import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/supabase/select-all";
import { applyProjectionVariance } from "@/lib/projections";
import {
  fantasyPointsFromResult,
  resolveScoringRules,
  type ScoringRules,
} from "@/lib/scoring-rules";

const RESULT_COLUMNS =
  "player_id, tournament_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)";

export type PlayerEventPoints = {
  tournamentId: number;
  points: number;
  finishingPosition: number | null;
};

export type PlayerPointsIndex = {
  rules: ScoringRules;
  /** Every scored event for a player (unordered — sort by event date if needed). */
  eventsOf: (playerId: number) => PlayerEventPoints[];
  /** Points at one tournament (or the sum across several); null when unplayed. */
  pointsAt: (playerId: number, tournamentIds: number | number[] | null) => number | null;
  /** Season total under the league's rules. */
  totalFor: (playerId: number) => number;
  /** Events with a result. */
  eventCountFor: (playerId: number) => number;
  /** Season average with the deterministic per-player variance; null if unplayed. */
  projectionFor: (playerId: number, range?: number) => number | null;
  /** True when any result was loaded at all (i.e. the season has started). */
  hasResults: boolean;
  /** Distinct tournaments represented in the loaded rows. */
  tournamentIds: Set<number>;
};

export async function loadPlayerPoints(
  supabase: SupabaseClient,
  opts: {
    /** Resolve scoring rules from this league (skipped when `rules` is given). */
    leagueId?: number;
    /** Pre-resolved rules, or the raw league.scoring_rules value. */
    rules?: ScoringRules | unknown;
    /** Restrict to these players (omit for every player). */
    playerIds?: number[];
    /** Restrict to these tournaments (omit for the whole season). */
    tournamentIds?: number[];
  } = {},
): Promise<PlayerPointsIndex> {
  let rules: ScoringRules;
  if (opts.rules !== undefined) {
    rules = resolveScoringRules(opts.rules);
  } else if (opts.leagueId != null) {
    const { data } = await supabase
      .from("leagues")
      .select("scoring_rules")
      .eq("id", opts.leagueId)
      .maybeSingle();
    rules = resolveScoringRules((data as any)?.scoring_rules);
  } else {
    rules = resolveScoringRules(null);
  }

  const emptyFilter =
    (opts.playerIds != null && opts.playerIds.length === 0) ||
    (opts.tournamentIds != null && opts.tournamentIds.length === 0);

  const rows = emptyFilter
    ? []
    : await selectAllRows<any>(() => {
        let q = supabase.from("tournament_results").select(RESULT_COLUMNS);
        if (opts.playerIds) q = q.in("player_id", opts.playerIds);
        if (opts.tournamentIds) q = q.in("tournament_id", opts.tournamentIds);
        return q as any;
      });

  const byPlayer = new Map<number, PlayerEventPoints[]>();
  const totals = new Map<number, number>();
  const tournamentIds = new Set<number>();
  for (const r of rows) {
    const points = fantasyPointsFromResult(rules, {
      finishing_position: r.finishing_position,
      hot_round_count: r.hot_round_count,
      bogey_free_count: r.bogey_free_count,
      ace_count: r.ace_count,
      under_par_strokes: r.under_par_strokes,
      over_par_strokes: r.over_par_strokes,
      eagle_count: r.eagle_count,
      division: r.players?.division ?? "MPO",
    });
    const pid = r.player_id as number;
    const list = byPlayer.get(pid) ?? [];
    list.push({
      tournamentId: r.tournament_id as number,
      points,
      finishingPosition: (r.finishing_position as number | null) ?? null,
    });
    byPlayer.set(pid, list);
    totals.set(pid, (totals.get(pid) ?? 0) + points);
    tournamentIds.add(r.tournament_id as number);
  }

  const eventsOf = (playerId: number) => byPlayer.get(playerId) ?? [];

  return {
    rules,
    eventsOf,
    pointsAt: (playerId, ids) => {
      if (ids == null) return null;
      const wanted = Array.isArray(ids) ? new Set(ids) : new Set([ids]);
      let sum = 0;
      let found = false;
      for (const e of eventsOf(playerId)) {
        if (!wanted.has(e.tournamentId)) continue;
        sum += e.points;
        found = true;
      }
      return found ? Math.round(sum * 10) / 10 : null;
    },
    totalFor: (playerId) => totals.get(playerId) ?? 0,
    eventCountFor: (playerId) => eventsOf(playerId).length,
    projectionFor: (playerId, range = 3) => {
      const list = eventsOf(playerId);
      if (list.length === 0) return null;
      return applyProjectionVariance((totals.get(playerId) ?? 0) / list.length, playerId, range);
    },
    hasResults: rows.length > 0,
    tournamentIds,
  };
}
