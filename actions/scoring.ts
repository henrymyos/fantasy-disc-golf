"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BONUS_POINTS, getPointsForDivision } from "@/lib/scoring-constants";
import { generateWeeklyRecap } from "@/lib/weekly-recap";
import { enqueueNotification } from "@/lib/notifications";

export async function createTournament(leagueId: number, name: string, week: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  await admin.from("tournaments").insert({ name, week });
  revalidatePath(`/league/${leagueId}/scoring`);
}

export type PlayerBonus = {
  playerId: number;
  hotRoundCount: number;
  bogeyFreeCount: number;
  aceCount: number;
};

export async function enterResults(
  leagueId: number,
  tournamentId: number,
  results: { playerId: number; position: number }[],
  bonuses: PlayerBonus[] = []
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  // Look up each player's division so we use the correct scoring table.
  const playerIds = results.map((r) => r.playerId);
  const { data: playerRows } = await admin
    .from("players")
    .select("id, division")
    .in("id", playerIds);
  const divisionMap = new Map<number, string>(
    (playerRows ?? []).map((p) => [p.id, p.division ?? "MPO"])
  );

  // Tied players all get the points for their finishing position (no averaging).
  const bonusMap = new Map<number, PlayerBonus>();
  bonuses.forEach((b) => bonusMap.set(b.playerId, b));

  const rows = results.map((r) => {
    const div = divisionMap.get(r.playerId) ?? "MPO";
    const placementPts = getPointsForDivision(r.position, div);
    const b = bonusMap.get(r.playerId);
    const bonusPts = b
      ? b.hotRoundCount * BONUS_POINTS.hotRound +
        b.bogeyFreeCount * BONUS_POINTS.bogeyFree +
        b.aceCount * BONUS_POINTS.ace
      : 0;
    return {
      tournament_id: tournamentId,
      player_id: r.playerId,
      finishing_position: r.position,
      hot_round_count: b?.hotRoundCount ?? 0,
      bogey_free_count: b?.bogeyFreeCount ?? 0,
      ace_count: b?.aceCount ?? 0,
      fantasy_points: Math.round((placementPts + bonusPts) * 10) / 10,
    };
  });

  await admin.from("tournament_results").upsert(rows, { onConflict: "tournament_id,player_id" });
  revalidatePath(`/league/${leagueId}/scoring`);
}

export async function finalizeWeekScores(leagueId: number, week: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  const { data: tournaments } = await admin.from("tournaments").select("id").eq("week", week);
  const tournamentIds = (tournaments ?? []).map((t) => t.id);
  if (tournamentIds.length === 0) return;

  const { data: results } = await admin.from("tournament_results").select("player_id, fantasy_points").in("tournament_id", tournamentIds);

  const playerPoints: Record<number, number> = {};
  (results ?? []).forEach((r) => {
    playerPoints[r.player_id] = (playerPoints[r.player_id] ?? 0) + r.fantasy_points;
  });

  const { data: starters } = await admin.from("rosters").select("team_id, player_id").eq("league_id", leagueId).eq("is_starter", true);

  const teamScores: Record<number, number> = {};
  (starters ?? []).forEach((s) => {
    teamScores[s.team_id] = (teamScores[s.team_id] ?? 0) + (playerPoints[s.player_id] ?? 0);
  });

  const { data: matchups } = await admin.from("matchups").select("id, team1_id, team2_id").eq("league_id", leagueId).eq("week", week);

  for (const m of matchups ?? []) {
    await admin.from("matchups").update({
      team1_score: teamScores[m.team1_id] ?? 0,
      team2_score: teamScores[m.team2_id] ?? 0,
      is_final: true,
    }).eq("id", m.id);
  }

  // Auto-generate the templated weekly recap once every matchup is final.
  await generateWeeklyRecap(admin, leagueId, week);

  // Notify each team's owner of the win/loss for this week.
  const teamUserMap = new Map<number, string | null>();
  const { data: teamMembers } = await admin
    .from("league_members")
    .select("id, team_name, user_id")
    .eq("league_id", leagueId);
  for (const tm of teamMembers ?? []) {
    teamUserMap.set((tm as any).id, (tm as any).user_id ?? null);
  }
  const nameById = new Map<number, string>(
    (teamMembers ?? []).map((m: any) => [m.id, m.team_name as string]),
  );

  for (const m of matchups ?? []) {
    const s1 = teamScores[m.team1_id] ?? 0;
    const s2 = teamScores[m.team2_id] ?? 0;
    const u1 = teamUserMap.get(m.team1_id);
    const u2 = teamUserMap.get(m.team2_id);
    const t1Name = nameById.get(m.team1_id) ?? "Team 1";
    const t2Name = nameById.get(m.team2_id) ?? "Team 2";
    const link = `/league/${leagueId}/matchups/${m.id}`;
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

  revalidatePath(`/league/${leagueId}/scoring`);
  revalidatePath(`/league/${leagueId}/matchups`);
  revalidatePath(`/league/${leagueId}`);
}

export async function advanceWeek(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id, current_week").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  const nextWeek = league.current_week + 1;

  const { data: members } = await admin.from("league_members").select("id").eq("league_id", leagueId).order("joined_at");
  if (!members || members.length < 2) return;

  // Only generate matchups if none exist yet for next week (the season-wide
  // generator runs on draft completion, so this is just a fallback for old
  // leagues or hand-rolled flows).
  const { count: existing } = await admin
    .from("matchups")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("week", nextWeek);
  if ((existing ?? 0) === 0) {
    const pairs = generateMatchups(members.map((m) => m.id), nextWeek);
    await admin.from("matchups").insert(
      pairs.map(([t1, t2]) => ({
        league_id: leagueId,
        week: nextWeek,
        team1_id: t1,
        team2_id: t2,
        team1_score: 0,
        team2_score: 0,
      }))
    );
  }

  await admin.from("leagues").update({ current_week: nextWeek }).eq("id", leagueId);

  revalidatePath(`/league/${leagueId}/scoring`);
  revalidatePath(`/league/${leagueId}`);
}

function generateMatchups(teamIds: number[], week: number): [number, number][] {
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
