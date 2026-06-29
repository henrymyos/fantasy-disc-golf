import type { SupabaseClient } from "@supabase/supabase-js";
import { fantasyPointsFromResult, resolveScoringRules } from "@/lib/scoring-rules";
import { cappedStarterIds, type StarterRow } from "@/lib/lineup-slots";
import { DEFAULT_SEASON_YEAR } from "@/lib/schedule";

/**
 * For each (team, week) pair in the league, sum the fantasy_points of the team's
 * slot-capped starters whose division+pick contributed to that week. Returns a
 * map: teamId -> week -> points. Every league team appears (teams with no
 * starters get an empty inner map) so downstream record math can score an absent
 * team as 0 rather than skipping it.
 *
 * Scoped to the league's season_year, so reusing week numbers across seasons
 * doesn't blend results. Today's lineup is the only thing we record per team —
 * there's no per-week snapshot — so weekly totals are an approximation based on
 * the current starter set.
 */
export async function getTeamWeeklyTotals(
  supabase: SupabaseClient,
  leagueId: number,
): Promise<Map<number, Map<number, number>>> {
  const { data: league } = await supabase
    .from("leagues")
    .select("scoring_rules, season_year, mpo_starters, fpo_starters")
    .eq("id", leagueId)
    .single();
  const rules = resolveScoringRules((league as any)?.scoring_rules);
  const seasonYear = (league as any)?.season_year ?? DEFAULT_SEASON_YEAR;
  const mpoSlots = (league as any)?.mpo_starters ?? 4;
  const fpoSlots = (league as any)?.fpo_starters ?? 2;

  // tournament_id -> week, scoped to this league's season.
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, week")
    .eq("season_year", seasonYear);
  const weekByTournament = new Map<number, number>();
  const tournamentIds: number[] = [];
  (tournaments ?? []).forEach((t: any) => {
    weekByTournament.set(t.id, t.week);
    tournamentIds.push(t.id);
  });

  // Every team in the league, so a team with no starters still appears (scored 0).
  const { data: teamRows } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId);
  const allTeamIds = (teamRows ?? []).map((m: any) => m.id as number);

  // Starters in this league with division + lineup_order so we can slot-cap.
  const { data: starters } = await supabase
    .from("rosters")
    .select("team_id, player_id, lineup_order, players(division)")
    .eq("league_id", leagueId)
    .eq("is_starter", true);
  const rowsByTeam = new Map<number, StarterRow[]>();
  (starters ?? []).forEach((r: any) => {
    const list = rowsByTeam.get(r.team_id) ?? [];
    list.push({
      player_id: r.player_id,
      division: r.players?.division ?? "MPO",
      lineup_order: r.lineup_order ?? null,
    });
    rowsByTeam.set(r.team_id, list);
  });

  // Pull raw result fields (for this season's tournaments) so we can apply this
  // league's custom rules.
  const ptsByPlayerTournament = new Map<string, number>();
  if (tournamentIds.length > 0) {
    const { data: results } = await supabase
      .from("tournament_results")
      .select("player_id, tournament_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)")
      .in("tournament_id", tournamentIds);
    (results ?? []).forEach((r: any) => {
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
      ptsByPlayerTournament.set(`${r.player_id}:${r.tournament_id}`, pts);
    });
  }

  // Aggregate per team over its slot-capped starters.
  const byTeam = new Map<number, Map<number, number>>();
  for (const teamId of allTeamIds) {
    const capped = cappedStarterIds(rowsByTeam.get(teamId) ?? [], mpoSlots, fpoSlots);
    const byWeek = new Map<number, number>();
    for (const playerId of capped) {
      for (const [tournamentId, week] of weekByTournament) {
        const pts = ptsByPlayerTournament.get(`${playerId}:${tournamentId}`);
        if (pts == null) continue;
        byWeek.set(week, (byWeek.get(week) ?? 0) + pts);
      }
    }
    byTeam.set(teamId, byWeek);
  }
  return byTeam;
}

export type AltRecord = { wins: number; losses: number; ties: number };

/**
 * Compute W-L-T records from weekly totals using the league's scoring mode.
 *   head_to_head — left to the matchups table; this function returns zeros.
 *   all_play     — each week, +1 win for every team you outscore, +1 loss per
 *                  team that outscores you, +1 tie per team you exactly match.
 *   median       — each week, +1 win if above the league median, +1 loss if
 *                  below, +1 tie if exactly at it.
 *
 * Every team in `weekly` is scored each week that occurred (an absent team
 * counts as 0 that week, taking the loss) rather than being skipped.
 */
export function computeAltRecords(
  weekly: Map<number, Map<number, number>>,
  mode: "head_to_head" | "all_play" | "median",
): Map<number, AltRecord> {
  const out = new Map<number, AltRecord>();
  for (const teamId of weekly.keys()) out.set(teamId, { wins: 0, losses: 0, ties: 0 });
  if (mode === "head_to_head") return out;

  // Build the set of weeks that actually happened (any team has a total).
  const weeks = new Set<number>();
  for (const byWeek of weekly.values()) for (const w of byWeek.keys()) weeks.add(w);

  const teamIds = [...weekly.keys()];

  for (const week of weeks) {
    // Score EVERY team for this week (0 if they had no total that week).
    const scores = teamIds.map((teamId) => ({ teamId, points: weekly.get(teamId)!.get(week) ?? 0 }));
    if (scores.length < 2) continue;

    if (mode === "all_play") {
      for (const a of scores) {
        for (const b of scores) {
          if (a.teamId === b.teamId) continue;
          const rec = out.get(a.teamId)!;
          if (a.points > b.points) rec.wins += 1;
          else if (a.points < b.points) rec.losses += 1;
          else rec.ties += 1;
        }
      }
    } else if (mode === "median") {
      const sorted = scores.map((s) => s.points).sort((a, b) => a - b);
      const mid = sorted.length / 2;
      const median = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[Math.floor(mid)];
      for (const s of scores) {
        const rec = out.get(s.teamId)!;
        if (s.points > median) rec.wins += 1;
        else if (s.points < median) rec.losses += 1;
        else rec.ties += 1;
      }
    }
  }
  return out;
}
