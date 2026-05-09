"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const PLACEMENT_POINTS: Record<number, number> = {
  1: 100, 2: 88, 3: 78, 4: 70, 5: 63, 6: 57, 7: 52,
  8: 47, 9: 43, 10: 39, 11: 36, 12: 33, 13: 30, 14: 28, 15: 26,
  16: 24, 17: 22, 18: 20, 19: 18, 20: 16, 21: 15, 22: 14, 23: 13,
  24: 12, 25: 11, 26: 10, 27: 9, 28: 8, 29: 7, 30: 6,
};

function getPoints(position: number): number {
  return PLACEMENT_POINTS[position] ?? Math.max(1, 5 - Math.floor((position - 30) / 5));
}

export async function createTournament(leagueId: number, name: string, week: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  await admin.from("tournaments").insert({ name, week, league_id: leagueId });
  revalidatePath(`/league/${leagueId}/scoring`);
}

export async function enterResults(
  leagueId: number,
  tournamentId: number,
  results: { playerId: number; position: number }[]
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  const rows = results.map((r) => ({
    tournament_id: tournamentId,
    player_id: r.playerId,
    finishing_position: r.position,
    fantasy_points: getPoints(r.position),
  }));

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

  const { data: tournaments } = await admin.from("tournaments").select("id").eq("league_id", leagueId).eq("week", week);
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
