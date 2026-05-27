import type { SupabaseClient } from "@supabase/supabase-js";
import { fantasyPointsFromResult, resolveScoringRules } from "@/lib/scoring-rules";

/**
 * For each (team, week) pair in the league, sum the fantasy_points of the
 * team's starters whose division+pick contributed to that week. Returns a
 * map: teamId -> week -> points.
 *
 * Today's lineup is the only thing we record per team — there's no per-week
 * snapshot — so weekly totals are an approximation based on the current
 * starter set. Good enough for standings and projections; if you want truer
 * per-week scoring you'd need a snapshot at lineup-lock time.
 */
export async function getTeamWeeklyTotals(
  supabase: SupabaseClient,
  leagueId: number,
): Promise<Map<number, Map<number, number>>> {
  // tournament_id -> week
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, week");
  const weekByTournament = new Map<number, number>();
  (tournaments ?? []).forEach((t: any) => weekByTournament.set(t.id, t.week));

  // Starters in this league: team_id, player_id
  const { data: starters } = await supabase
    .from("rosters")
    .select("team_id, player_id")
    .eq("league_id", leagueId)
    .eq("is_starter", true);
  const startersByTeam = new Map<number, number[]>();
  (starters ?? []).forEach((r: any) => {
    const list = startersByTeam.get(r.team_id) ?? [];
    list.push(r.player_id);
    startersByTeam.set(r.team_id, list);
  });

  // Pull raw result fields so we can apply this league's custom rules.
  const { data: league } = await supabase
    .from("leagues")
    .select("scoring_rules")
    .eq("id", leagueId)
    .single();
  const rules = resolveScoringRules((league as any)?.scoring_rules);

  const { data: results } = await supabase
    .from("tournament_results")
    .select("player_id, tournament_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)");
  const ptsByPlayerTournament = new Map<string, number>();
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

  // Aggregate
  const byTeam = new Map<number, Map<number, number>>();
  for (const [teamId, playerIds] of startersByTeam) {
    const byWeek = new Map<number, number>();
    for (const playerId of playerIds) {
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

/**
 * Compute W-L records from weekly totals using the league's scoring mode.
 *   head_to_head — left to the matchups table; this function returns zeros.
 *   all_play     — each week, +1 win for every team you beat, +1 loss per loss.
 *   median       — each week, +1 win if you scored above league median; +1
 *                  loss if below; ties give 0.5/0.5.
 */
export function computeAltRecords(
  weekly: Map<number, Map<number, number>>,
  mode: "head_to_head" | "all_play" | "median",
): Map<number, { wins: number; losses: number }> {
  const out = new Map<number, { wins: number; losses: number }>();
  for (const teamId of weekly.keys()) out.set(teamId, { wins: 0, losses: 0 });
  if (mode === "head_to_head") return out;

  // Build week -> team -> points
  const weeks = new Set<number>();
  for (const byWeek of weekly.values()) for (const w of byWeek.keys()) weeks.add(w);

  for (const week of weeks) {
    const scores: Array<{ teamId: number; points: number }> = [];
    for (const [teamId, byWeek] of weekly) {
      if (byWeek.has(week)) scores.push({ teamId, points: byWeek.get(week)! });
    }
    if (scores.length < 2) continue;

    if (mode === "all_play") {
      for (const a of scores) {
        for (const b of scores) {
          if (a.teamId === b.teamId) continue;
          const rec = out.get(a.teamId)!;
          if (a.points > b.points) rec.wins += 1;
          else if (a.points < b.points) rec.losses += 1;
        }
      }
    } else if (mode === "median") {
      const sorted = [...scores].map((s) => s.points).sort((a, b) => a - b);
      const mid = sorted.length / 2;
      const median = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[Math.floor(mid)];
      for (const s of scores) {
        const rec = out.get(s.teamId)!;
        if (s.points > median) rec.wins += 1;
        else if (s.points < median) rec.losses += 1;
      }
    }
  }
  return out;
}
