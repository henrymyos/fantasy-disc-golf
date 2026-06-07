import type { SupabaseClient } from "@supabase/supabase-js";
import { fantasyPointsFromResult, resolveScoringRules } from "@/lib/scoring-rules";
import { generateWeeklyRecap } from "@/lib/weekly-recap";
import { enqueueNotification } from "@/lib/notifications";

/** Round-robin pairing for a given week (used when next week's matchups don't
 *  already exist). */
export function generateMatchups(teamIds: number[], week: number): [number, number][] {
  const pairs: [number, number][] = [];
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(-1);
  const half = teams.length / 2;
  const fixed = teams[0];
  const rotating = teams.slice(1);
  const shift = (week - 1) % rotating.length;
  const newRotating = [...rotating.slice(shift), ...rotating.slice(0, shift)];
  const schedule = [fixed, ...newRotating];
  for (let i = 0; i < half; i++) {
    const t1 = schedule[i];
    const t2 = schedule[schedule.length - 1 - i];
    if (t1 !== -1 && t2 !== -1) pairs.push([t1, t2]);
  }
  return pairs;
}

/**
 * Computes each team's score for `week` under the league's rules, writes the
 * matchup results (is_final), generates the recap, and notifies owners. No
 * auth — callers (the commissioner action or the auto-finalize cron) must gate
 * appropriately. Uses the service-role `admin` client.
 */
export async function finalizeWeekScoresCore(
  admin: SupabaseClient,
  leagueId: number,
  week: number,
  opts: { notify?: boolean; recap?: boolean } = {},
): Promise<void> {
  const notify = opts.notify ?? true;
  const recap = opts.recap ?? true;
  const { data: league } = await admin
    .from("leagues")
    .select("scoring_rules")
    .eq("id", leagueId)
    .single();
  const rules = resolveScoringRules((league as any)?.scoring_rules);

  const { data: tournaments } = await admin.from("tournaments").select("id").eq("week", week);
  const tournamentIds = (tournaments ?? []).map((t) => t.id);
  if (tournamentIds.length === 0) return;

  const { data: results } = await admin
    .from("tournament_results")
    .select("player_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)")
    .in("tournament_id", tournamentIds);

  const playerPoints: Record<number, number> = {};
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
    playerPoints[r.player_id] = (playerPoints[r.player_id] ?? 0) + pts;
  });

  const { data: starters } = await admin
    .from("rosters")
    .select("team_id, player_id")
    .eq("league_id", leagueId)
    .eq("is_starter", true);

  const teamScores: Record<number, number> = {};
  (starters ?? []).forEach((s: any) => {
    teamScores[s.team_id] = (teamScores[s.team_id] ?? 0) + (playerPoints[s.player_id] ?? 0);
  });

  const { data: matchups } = await admin
    .from("matchups")
    .select("id, team1_id, team2_id")
    .eq("league_id", leagueId)
    .eq("week", week);

  for (const m of matchups ?? []) {
    await admin.from("matchups").update({
      team1_score: teamScores[(m as any).team1_id] ?? 0,
      team2_score: teamScores[(m as any).team2_id] ?? 0,
      is_final: true,
    }).eq("id", (m as any).id);
  }

  if (recap) await generateWeeklyRecap(admin, leagueId, week);

  if (!notify) return;

  const { data: teamMembers } = await admin
    .from("league_members")
    .select("id, team_name, user_id")
    .eq("league_id", leagueId);
  const teamUserMap = new Map<number, string | null>(
    (teamMembers ?? []).map((m: any) => [m.id, m.user_id ?? null]),
  );
  const nameById = new Map<number, string>(
    (teamMembers ?? []).map((m: any) => [m.id, m.team_name as string]),
  );

  for (const m of matchups ?? []) {
    const s1 = teamScores[(m as any).team1_id] ?? 0;
    const s2 = teamScores[(m as any).team2_id] ?? 0;
    const u1 = teamUserMap.get((m as any).team1_id);
    const u2 = teamUserMap.get((m as any).team2_id);
    const t1Name = nameById.get((m as any).team1_id) ?? "Team 1";
    const t2Name = nameById.get((m as any).team2_id) ?? "Team 2";
    const link = `/league/${leagueId}/matchups/${(m as any).id}`;
    if (u1) {
      const verdict = s1 === s2 ? "tied with" : s1 > s2 ? "won against" : "lost to";
      await enqueueNotification(admin, {
        userId: u1,
        leagueId,
        kind: "weekly_result",
        body: `Week ${week}: you ${verdict} ${t2Name} ${s1.toFixed(1)}-${s2.toFixed(1)}.`,
        link,
      });
    }
    if (u2) {
      const verdict = s2 === s1 ? "tied with" : s2 > s1 ? "won against" : "lost to";
      await enqueueNotification(admin, {
        userId: u2,
        leagueId,
        kind: "weekly_result",
        body: `Week ${week}: you ${verdict} ${t1Name} ${s2.toFixed(1)}-${s1.toFixed(1)}.`,
        link,
      });
    }
  }
}

/** Advances the league to the next week, creating its matchups if missing. */
export async function advanceWeekCore(admin: SupabaseClient, leagueId: number): Promise<void> {
  const { data: league } = await admin
    .from("leagues")
    .select("current_week")
    .eq("id", leagueId)
    .single();
  if (!league) return;
  const nextWeek = (league as any).current_week + 1;

  const { data: members } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .order("joined_at");
  if (!members || members.length < 2) return;

  const { count: existing } = await admin
    .from("matchups")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("week", nextWeek);
  if ((existing ?? 0) === 0) {
    const pairs = generateMatchups(members.map((m: any) => m.id), nextWeek);
    await admin.from("matchups").insert(
      pairs.map(([t1, t2]) => ({
        league_id: leagueId,
        week: nextWeek,
        team1_id: t1,
        team2_id: t2,
        team1_score: 0,
        team2_score: 0,
      })),
    );
  }

  await admin.from("leagues").update({ current_week: nextWeek }).eq("id", leagueId);
}
