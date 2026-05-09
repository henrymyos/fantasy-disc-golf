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

  await admin.from("rosters").update({ is_starter: isStarter }).eq("id", rosterSpotId);

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

  revalidatePath(`/league/${leagueId}/free-agency`);
  revalidatePath(`/league/${leagueId}/lineups`);
}
