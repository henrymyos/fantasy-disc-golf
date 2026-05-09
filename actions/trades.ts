"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function proposeTrade(
  leagueId: number,
  receiverTeamId: number,
  offerPlayerIds: number[],
  requestPlayerIds: number[],
  message: string
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: proposer } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  if (!proposer) return;

  const { data: trade, error } = await admin
    .from("trades")
    .insert({
      league_id: leagueId,
      proposer_id: proposer.id,
      receiver_id: receiverTeamId,
      message: message || null,
    })
    .select()
    .single();

  if (error || !trade) return;

  const tradePlayers = [
    ...offerPlayerIds.map((pid) => ({
      trade_id: trade.id,
      player_id: pid,
      from_team_id: proposer.id,
      to_team_id: receiverTeamId,
    })),
    ...requestPlayerIds.map((pid) => ({
      trade_id: trade.id,
      player_id: pid,
      from_team_id: receiverTeamId,
      to_team_id: proposer.id,
    })),
  ];

  await admin.from("trade_players").insert(tradePlayers);
  revalidatePath(`/league/${leagueId}/trades`);
}

export async function respondToTrade(tradeId: number, accept: boolean): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: trade } = await admin
    .from("trades")
    .select("id, league_id, proposer_id, receiver_id, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.status !== "pending") return;

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", trade.league_id)
    .eq("user_id", user.id)
    .single();

  if (!member || member.id !== trade.receiver_id) return;

  if (!accept) {
    await admin.from("trades").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", tradeId);
    revalidatePath(`/league/${trade.league_id}/trades`);
    return;
  }

  const { data: tradePlayers } = await admin.from("trade_players").select("player_id, from_team_id, to_team_id").eq("trade_id", tradeId);

  for (const tp of tradePlayers ?? []) {
    await admin.from("rosters").update({ team_id: tp.to_team_id })
      .eq("league_id", trade.league_id)
      .eq("player_id", tp.player_id)
      .eq("team_id", tp.from_team_id);
  }

  await admin.from("trades").update({ status: "accepted", resolved_at: new Date().toISOString() }).eq("id", tradeId);
  revalidatePath(`/league/${trade.league_id}/trades`);
  revalidatePath(`/league/${trade.league_id}/lineups`);
}

export async function cancelTrade(tradeId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: trade } = await admin.from("trades").select("league_id, proposer_id").eq("id", tradeId).single();
  if (!trade) return;

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", trade.league_id)
    .eq("user_id", user.id)
    .single();

  if (!member || member.id !== trade.proposer_id) return;

  await admin.from("trades").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", tradeId);
  revalidatePath(`/league/${trade.league_id}/trades`);
}
