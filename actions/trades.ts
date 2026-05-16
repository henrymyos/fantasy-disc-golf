"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type TradeMovement = {
  playerId: number;
  fromTeamId: number;
  toTeamId: number;
};

export async function proposeTrade(
  leagueId: number,
  receiverTeamIds: number[],
  movements: TradeMovement[],
  message: string,
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
  if (receiverTeamIds.length === 0 || movements.length === 0) return;

  // Reject any movement that doesn't actually move a player (same from = to).
  const filtered = movements.filter((m) => m.fromTeamId !== m.toTeamId);
  if (filtered.length === 0) return;

  const { data: trade, error } = await admin
    .from("trades")
    .insert({
      league_id: leagueId,
      proposer_id: proposer.id,
      receiver_id: receiverTeamIds[0] ?? null, // legacy column, first receiver
      message: message || null,
    })
    .select()
    .single();

  if (error || !trade) return;

  await admin.from("trade_players").insert(
    filtered.map((m) => ({
      trade_id: trade.id,
      player_id: m.playerId,
      from_team_id: m.fromTeamId,
      to_team_id: m.toTeamId,
    })),
  );

  await admin.from("trade_participants").insert(
    receiverTeamIds.map((teamId) => ({
      trade_id: trade.id,
      team_id: teamId,
      status: "pending" as const,
    })),
  );

  revalidatePath(`/league/${leagueId}/trades`);
}

export async function respondToTrade(tradeId: number, accept: boolean): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: trade } = await admin
    .from("trades")
    .select("id, league_id, proposer_id, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.status !== "pending") return;

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", trade.league_id)
    .eq("user_id", user.id)
    .single();
  if (!member) return;

  // The current user must be a pending participant on this trade.
  const { data: myParticipant } = await admin
    .from("trade_participants")
    .select("id, status")
    .eq("trade_id", tradeId)
    .eq("team_id", member.id)
    .single();

  if (!myParticipant || myParticipant.status !== "pending") return;

  if (!accept) {
    await admin
      .from("trade_participants")
      .update({ status: "rejected", responded_at: new Date().toISOString() })
      .eq("id", myParticipant.id);

    // A single rejection kills the whole trade.
    await admin
      .from("trades")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", tradeId);

    revalidatePath(`/league/${trade.league_id}/trades`);
    return;
  }

  await admin
    .from("trade_participants")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", myParticipant.id);

  // If every participant has accepted, execute the player moves.
  const { data: allParticipants } = await admin
    .from("trade_participants")
    .select("status")
    .eq("trade_id", tradeId);

  const allAccepted = (allParticipants ?? []).every((p) => p.status === "accepted");
  if (!allAccepted) {
    revalidatePath(`/league/${trade.league_id}/trades`);
    return;
  }

  const { data: tradePlayers } = await admin
    .from("trade_players")
    .select("player_id, from_team_id, to_team_id")
    .eq("trade_id", tradeId);

  for (const tp of tradePlayers ?? []) {
    await admin.from("rosters").update({ team_id: tp.to_team_id })
      .eq("league_id", trade.league_id)
      .eq("player_id", tp.player_id)
      .eq("team_id", tp.from_team_id);
  }

  await admin
    .from("trades")
    .update({ status: "accepted", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

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
