"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function toggleStarter(leagueId: number, rosterSpotId: number, isStarter: boolean): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  if (!member) return;

  const { data: spot } = await admin
    .from("rosters")
    .select("team_id")
    .eq("id", rosterSpotId)
    .single();

  if (!spot || spot.team_id !== member.id) return;

  await admin
    .from("rosters")
    .update({ is_starter: isStarter, lineup_order: isStarter ? null : null })
    .eq("id", rosterSpotId);

  revalidatePath(`/league/${leagueId}/lineups`);
}

// Move a bench player into a starter slot, optionally displacing the current occupant.
// newOrder: the 1-based slot index the new starter is taking.
export async function swapStarter(
  leagueId: number,
  newStarterSpotId: number,
  displacedSpotId?: number,
  newOrder?: number,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  if (!member) return;

  const ids = [newStarterSpotId, ...(displacedSpotId ? [displacedSpotId] : [])];
  const { data: spots } = await admin
    .from("rosters")
    .select("id, team_id")
    .in("id", ids);

  if (!spots || spots.some((s) => s.team_id !== member.id)) return;

  if (displacedSpotId) {
    await admin
      .from("rosters")
      .update({ is_starter: false, lineup_order: null })
      .eq("id", displacedSpotId);
  }
  await admin
    .from("rosters")
    .update({ is_starter: true, lineup_order: newOrder ?? null })
    .eq("id", newStarterSpotId);

  revalidatePath(`/league/${leagueId}/lineups`);
}

// Swap the slot positions of two existing starters — neither is benched.
export async function swapStarterPositions(
  leagueId: number,
  spotAId: number,
  orderA: number,
  spotBId: number,
  orderB: number,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  if (!member) return;

  const { data: spots } = await admin
    .from("rosters")
    .select("id, team_id")
    .in("id", [spotAId, spotBId]);

  if (!spots || spots.some((s) => s.team_id !== member.id)) return;

  // Exchange lineup_order — both stay as starters
  await admin.from("rosters").update({ lineup_order: orderB }).eq("id", spotAId);
  await admin.from("rosters").update({ lineup_order: orderA }).eq("id", spotBId);

  revalidatePath(`/league/${leagueId}/lineups`);
}

// Move a starter to a different slot (empty or occupied by another starter).
// Just updates lineup_order — is_starter stays true for this player.
export async function moveStarterToSlot(
  leagueId: number,
  spotId: number,
  newOrder: number,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  if (!member) return;

  const { data: spot } = await admin
    .from("rosters")
    .select("id, team_id")
    .eq("id", spotId)
    .single();

  if (!spot || spot.team_id !== member.id) return;

  await admin.from("rosters").update({ lineup_order: newOrder }).eq("id", spotId);

  revalidatePath(`/league/${leagueId}/lineups`);
}

export async function addFreeAgent(leagueId: number, playerId: number, dropPlayerId?: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  if (!member) return;

  const { data: league } = await admin
    .from("leagues")
    .select("roster_size, current_week")
    .eq("id", leagueId)
    .single();

  if (!league) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("status")
    .eq("league_id", leagueId)
    .single();

  if (draft?.status !== "complete") return;

  const { data: existing } = await admin
    .from("rosters")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .single();

  if (existing) return;

  const { count } = await admin
    .from("rosters")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("team_id", member.id);

  if ((count ?? 0) >= league.roster_size && !dropPlayerId) return;

  if (dropPlayerId) {
    await admin
      .from("rosters")
      .delete()
      .eq("league_id", leagueId)
      .eq("team_id", member.id)
      .eq("player_id", dropPlayerId);
  }

  await admin.from("rosters").insert({
    league_id: leagueId,
    team_id: member.id,
    player_id: playerId,
    acquired_week: league.current_week,
  });

  await admin.from("roster_transactions").insert({
    league_id: leagueId,
    team_id: member.id,
    player_id: playerId,
    action: "add",
    dropped_player_id: dropPlayerId ?? null,
  });

  revalidatePath(`/league/${leagueId}/free-agency`);
  revalidatePath(`/league/${leagueId}/lineups`);
}

export async function dropPlayer(leagueId: number, playerId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  if (!member) return;

  await admin
    .from("rosters")
    .delete()
    .eq("league_id", leagueId)
    .eq("team_id", member.id)
    .eq("player_id", playerId);

  await admin.from("roster_transactions").insert({ league_id: leagueId, team_id: member.id, player_id: playerId, action: "drop" });

  revalidatePath(`/league/${leagueId}/free-agency`);
  revalidatePath(`/league/${leagueId}/lineups`);
}
