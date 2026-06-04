"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BONUS_POINTS, getPointsForDivision } from "@/lib/scoring-constants";
import { enqueueNotification } from "@/lib/notifications";
import { finalizeWeekScoresCore, advanceWeekCore } from "@/lib/scoring-finalize";

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
  underParStrokes?: number;
  overParStrokes?: number;
  eagleCount?: number;
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
        b.aceCount * BONUS_POINTS.ace +
        (b.underParStrokes ?? 0) * BONUS_POINTS.birdie -
        (b.overParStrokes ?? 0) * BONUS_POINTS.bogey +
        (b.eagleCount ?? 0) * BONUS_POINTS.eagle
      : 0;
    return {
      tournament_id: tournamentId,
      player_id: r.playerId,
      finishing_position: r.position,
      hot_round_count: b?.hotRoundCount ?? 0,
      bogey_free_count: b?.bogeyFreeCount ?? 0,
      ace_count: b?.aceCount ?? 0,
      under_par_strokes: b?.underParStrokes ?? 0,
      over_par_strokes: b?.overParStrokes ?? 0,
      eagle_count: b?.eagleCount ?? 0,
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
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || (league as any).commissioner_id !== user.id) return;

  await finalizeWeekScoresCore(admin, leagueId, week);

  revalidatePath(`/league/${leagueId}/scoring`);
  revalidatePath(`/league/${leagueId}/matchups`);
  revalidatePath(`/league/${leagueId}`);
}

export async function advanceWeek(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  await advanceWeekCore(admin, leagueId);

  revalidatePath(`/league/${leagueId}/scoring`);
  revalidatePath(`/league/${leagueId}`);
}
