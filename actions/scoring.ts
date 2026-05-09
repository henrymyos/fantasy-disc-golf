"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const BONUS_POINTS = {
  hotRound: 10,      // best score in a single round
  bogeyFree: 5,      // per round with no bogeys
  ace: 20,           // hole-in-one
} as const;

// Calibrated so 6 starters in an 8-team snake-draft league average ~150 pts/tournament.
// Sum of positions 1-48 = 1207, giving 25.1 pts/starter avg.
const PLACEMENT_POINTS: Record<number, number> = {
  1: 110, 2: 92,  3: 78,  4: 68,  5: 60,  6: 54,  7: 49,  8: 45,  9: 41, 10: 38,
  11: 35, 12: 32, 13: 30, 14: 28, 15: 26, 16: 24, 17: 23, 18: 21, 19: 20, 20: 19,
  21: 18, 22: 17, 23: 16, 24: 16, 25: 15, 26: 14, 27: 14, 28: 13, 29: 13, 30: 12,
  31: 11, 32: 11, 33: 11, 34: 11, 35: 11,
  36: 10, 37: 10, 38: 10, 39: 10, 40: 10,
  41: 8,  42: 8,  43: 8,  44: 8,  45: 8,
  46: 7,  47: 7,  48: 7,  49: 7,  50: 7,
};

function getPoints(position: number): number {
  if (position <= 50) return PLACEMENT_POINTS[position];
  if (position <= 60) return 5;
  if (position <= 70) return 3;
  return 2;
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

  // Average points across tied positions so tied players score fairly.
  const tieGroups = new Map<number, number[]>();
  results.forEach((r) => {
    const group = tieGroups.get(r.position) ?? [];
    group.push(r.playerId);
    tieGroups.set(r.position, group);
  });

  const tiedPoints = new Map<number, number>();
  tieGroups.forEach((playerIds, position) => {
    const avg =
      playerIds.reduce((sum, _, i) => sum + getPoints(position + i), 0) / playerIds.length;
    playerIds.forEach((id) => tiedPoints.set(id, Math.round(avg * 10) / 10));
  });

  const bonusMap = new Map<number, PlayerBonus>();
  bonuses.forEach((b) => bonusMap.set(b.playerId, b));

  const rows = results.map((r) => {
    const placementPts = tiedPoints.get(r.playerId) ?? getPoints(r.position);
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
