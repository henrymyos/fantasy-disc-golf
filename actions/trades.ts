"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueNotification } from "@/lib/notifications";
import { resolvePickOwnerId } from "@/lib/draft-pick-owners";

export type TradeMovement = {
  playerId: number;
  fromTeamId: number;
  toTeamId: number;
};

export type PickMovement = {
  seasonYear: number;
  round: number;
  originalTeamId: number;
  fromTeamId: number;
  toTeamId: number;
};

/** A slot of the CURRENT draft being traded (identified by overall pick). */
export type CurrentPickMovement = {
  overallPick: number;
  fromTeamId: number;
  toTeamId: number;
};

export async function proposeTrade(
  leagueId: number,
  receiverTeamIds: number[],
  movements: TradeMovement[],
  message: string,
  pickMovements: PickMovement[] = [],
  currentPickMovements: CurrentPickMovement[] = [],
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
  if (receiverTeamIds.length === 0) return;
  // A trade must move at least one player or pick.
  const filtered = movements.filter((m) => m.fromTeamId !== m.toTeamId);
  const filteredPicks = pickMovements.filter((p) => p.fromTeamId !== p.toTeamId);
  let filteredCurrentPicks = currentPickMovements.filter((p) => p.fromTeamId !== p.toTeamId);

  // Current-draft pick slots can only be traded while the draft hasn't started.
  let currentDraftId: number | null = null;
  if (filteredCurrentPicks.length > 0) {
    const { data: draftRow } = await admin
      .from("drafts")
      .select("id, status")
      .eq("league_id", leagueId)
      .single();
    if (!draftRow || (draftRow as any).status !== "pending") {
      filteredCurrentPicks = [];
    } else {
      currentDraftId = (draftRow as any).id;
    }
  }
  if (filtered.length === 0 && filteredPicks.length === 0 && filteredCurrentPicks.length === 0) return;

  // Authorization: a client supplies these movements verbatim, so verify them
  // server-side before persisting anything.
  //  - the proposer must actually be one of the involved teams;
  //  - every from/to team across players + picks must be in the participant
  //    set (the proposer plus the receiving teams);
  //  - each moved player must currently be owned by its stated from-team.
  // Any failure aborts without inserting the trade.
  const participantSet = new Set<number>([proposer.id, ...receiverTeamIds]);
  const legTeamIds: number[] = [];
  for (const m of filtered) legTeamIds.push(m.fromTeamId, m.toTeamId);
  for (const p of filteredPicks) legTeamIds.push(p.fromTeamId, p.toTeamId);
  for (const p of filteredCurrentPicks) legTeamIds.push(p.fromTeamId, p.toTeamId);
  if (!legTeamIds.includes(proposer.id)) return;
  if (legTeamIds.some((id) => !participantSet.has(id))) return;
  for (const m of filtered) {
    const { data: owns } = await admin
      .from("rosters")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", m.playerId)
      .eq("team_id", m.fromTeamId)
      .maybeSingle();
    if (!owns) return;
  }

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

  if (filtered.length > 0) {
    await admin.from("trade_players").insert(
      filtered.map((m) => ({
        trade_id: trade.id,
        player_id: m.playerId,
        from_team_id: m.fromTeamId,
        to_team_id: m.toTeamId,
      })),
    );
  }

  if (filteredPicks.length > 0) {
    await admin.from("trade_picks").insert(
      filteredPicks.map((p) => ({
        trade_id: trade.id,
        season_year: p.seasonYear,
        round: p.round,
        original_team_id: p.originalTeamId,
        from_team_id: p.fromTeamId,
        to_team_id: p.toTeamId,
      })),
    );
  }

  if (filteredCurrentPicks.length > 0 && currentDraftId != null) {
    await admin.from("trade_current_picks").insert(
      filteredCurrentPicks.map((p) => ({
        trade_id: trade.id,
        draft_id: currentDraftId,
        overall_pick: p.overallPick,
        from_team_id: p.fromTeamId,
        to_team_id: p.toTeamId,
      })),
    );
  }

  await admin.from("trade_participants").insert(
    receiverTeamIds.map((teamId) => ({
      trade_id: trade.id,
      team_id: teamId,
      status: "pending" as const,
    })),
  );

  // Notify the owner of every receiving team that a trade is waiting on them.
  const { data: proposerInfo } = await admin
    .from("league_members")
    .select("team_name")
    .eq("id", proposer.id)
    .single();
  const proposerName = (proposerInfo as any)?.team_name ?? "Another team";
  const { data: receivers } = await admin
    .from("league_members")
    .select("id, user_id")
    .in("id", receiverTeamIds);
  for (const r of receivers ?? []) {
    if ((r as any).user_id) {
      await enqueueNotification(admin, {
        userId: (r as any).user_id,
        leagueId,
        kind: "trade_proposed",
        body: `${proposerName} proposed a trade.`,
        link: `/league/${leagueId}/trades`,
      });
    }
  }

  revalidatePath(`/league/${leagueId}/trades`);
}

export async function respondToTrade(tradeId: number, accept: boolean): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: trade } = await admin
    .from("trades")
    .select("id, league_id, proposer_id, status, proposed_at")
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

  // Best-effort: tell the other involved teams (at minimum the proposer) how a
  // trade resolved, using the same notification mechanism proposeTrade uses.
  // Never let a notification failure abort the action.
  const tradeLeagueId = trade.league_id;
  const tradeProposerId = trade.proposer_id;
  const myMemberId = member.id;
  async function notifyTradeOutcome(outcome: "accepted" | "rejected") {
    try {
      const { data: parts } = await admin
        .from("trade_participants")
        .select("team_id")
        .eq("trade_id", tradeId);
      const involved = new Set<number>();
      if (tradeProposerId != null) involved.add(tradeProposerId);
      for (const p of parts ?? []) {
        if ((p as any).team_id != null) involved.add((p as any).team_id);
      }
      // The team acting now already knows the outcome.
      involved.delete(myMemberId);
      if (involved.size === 0) return;
      const { data: people } = await admin
        .from("league_members")
        .select("user_id")
        .in("id", Array.from(involved));
      const body =
        outcome === "accepted"
          ? "A trade you were part of was accepted."
          : "A trade you were part of was rejected.";
      for (const person of people ?? []) {
        const uid = (person as any).user_id;
        if (!uid) continue;
        await enqueueNotification(admin, {
          userId: uid,
          leagueId: tradeLeagueId,
          kind: "trade_proposed",
          body,
          link: `/league/${tradeLeagueId}/trades`,
        });
      }
    } catch (e) {
      console.warn("trade outcome notify failed", e);
    }
  }

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

    await notifyTradeOutcome("rejected");
    revalidatePath(`/league/${trade.league_id}/trades`);
    return;
  }

  // Code-side trade expiry (no schema change): a trade older than 7 days can no
  // longer execute. The trades table has no `created_at`; `proposed_at` is the
  // creation timestamp, so age is measured from it. Reject instead of executing.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  if (trade.proposed_at && Date.now() - new Date(trade.proposed_at).getTime() > SEVEN_DAYS_MS) {
    await admin
      .from("trades")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", tradeId);
    await notifyTradeOutcome("rejected");
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

  // Re-validate every player leg before moving ANY of them. A leg can go stale
  // between proposal and final acceptance — the player was dropped, or traded
  // away in another deal that resolved first. The roster move is scoped to
  // from_team_id, so a stale leg silently matches no rows (a no-op) while the
  // opposite leg still runs: one side would give up players and receive
  // nothing. If any leg is invalid, reject the whole trade and move nothing.
  for (const tp of tradePlayers ?? []) {
    const { data: owns } = await admin
      .from("rosters")
      .select("id")
      .eq("league_id", trade.league_id)
      .eq("player_id", tp.player_id)
      .eq("team_id", tp.from_team_id)
      .maybeSingle();
    if (!owns) {
      await admin
        .from("trades")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", tradeId);
      await notifyTradeOutcome("rejected");
      revalidatePath(`/league/${trade.league_id}/trades`);
      return;
    }
  }

  // Roster-size legality: no involved team may end up over leagues.roster_size.
  // Only player legs change roster counts (picks don't), and the ownership
  // re-check above guarantees each leaving player is currently on its from-team,
  // so post = current - leaving + arriving is exact. If any team would overflow,
  // reject the whole trade and move nothing.
  const playerLegs = tradePlayers ?? [];
  if (playerLegs.length > 0) {
    const { data: leagueRow } = await admin
      .from("leagues")
      .select("roster_size")
      .eq("id", trade.league_id)
      .single();
    const rosterSize = (leagueRow as any)?.roster_size ?? 10;

    const involvedTeams = new Set<number>();
    for (const tp of playerLegs) {
      involvedTeams.add(tp.from_team_id);
      involvedTeams.add(tp.to_team_id);
    }
    for (const teamId of involvedTeams) {
      const { count } = await admin
        .from("rosters")
        .select("id", { count: "exact", head: true })
        .eq("league_id", trade.league_id)
        .eq("team_id", teamId);
      const current = count ?? 0;
      const leaving = playerLegs.filter((tp) => tp.from_team_id === teamId).length;
      const arriving = playerLegs.filter((tp) => tp.to_team_id === teamId).length;
      if (current - leaving + arriving > rosterSize) {
        await admin
          .from("trades")
          .update({ status: "rejected", resolved_at: new Date().toISOString() })
          .eq("id", tradeId);
        await notifyTradeOutcome("rejected");
        revalidatePath(`/league/${trade.league_id}/trades`);
        return;
      }
    }
  }

  for (const tp of tradePlayers ?? []) {
    await admin.from("rosters").update({ team_id: tp.to_team_id })
      .eq("league_id", trade.league_id)
      .eq("player_id", tp.player_id)
      .eq("team_id", tp.from_team_id);
  }

  // Execute pick swaps: the to_team_id becomes the current owner of each
  // (season, round, original) entry.
  const { data: tradePicks } = await admin
    .from("trade_picks")
    .select("season_year, round, original_team_id, to_team_id")
    .eq("trade_id", tradeId);
  for (const tp of tradePicks ?? []) {
    await admin.from("traded_draft_picks").upsert(
      {
        league_id: trade.league_id,
        season_year: (tp as any).season_year,
        round: (tp as any).round,
        original_team_id: (tp as any).original_team_id,
        current_team_id: (tp as any).to_team_id,
      },
      { onConflict: "league_id,season_year,round,original_team_id" },
    );
  }

  // Execute current-draft pick-slot swaps — but only while the draft is still
  // pending (slots lock once it starts). The new owner picks at that slot.
  const { data: currentPicks } = await admin
    .from("trade_current_picks")
    .select("draft_id, overall_pick, to_team_id")
    .eq("trade_id", tradeId);
  if ((currentPicks ?? []).length > 0) {
    const { data: draftRow } = await admin
      .from("drafts")
      .select("id, status, third_round_reversal")
      .eq("league_id", trade.league_id)
      .single();
    if (draftRow && (draftRow as any).status === "pending") {
      const { data: membs } = await admin
        .from("league_members")
        .select("id, draft_position")
        .eq("league_id", trade.league_id)
        .not("draft_position", "is", null)
        .order("draft_position");
      const memberSlots = (membs ?? []).map((m: any) => ({ id: m.id, draftPosition: m.draft_position }));
      const trr = !!(draftRow as any).third_round_reversal;
      for (const cp of currentPicks!) {
        // original_team_id = the true snake-default owner (for display/chains).
        const originalOwner = resolvePickOwnerId((cp as any).overall_pick, memberSlots, trr, null);
        await admin.from("current_draft_pick_owners").upsert(
          {
            draft_id: (cp as any).draft_id,
            overall_pick: (cp as any).overall_pick,
            owner_team_id: (cp as any).to_team_id,
            original_team_id: originalOwner ?? (cp as any).to_team_id,
          },
          { onConflict: "draft_id,overall_pick" },
        );
      }
    }
  }

  await admin
    .from("trades")
    .update({ status: "accepted", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  await notifyTradeOutcome("accepted");
  revalidatePath(`/league/${trade.league_id}/trades`);
  revalidatePath(`/league/${trade.league_id}/lineups`);
}

export async function cancelTrade(tradeId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: trade } = await admin.from("trades").select("league_id, proposer_id, status").eq("id", tradeId).single();
  if (!trade) return;

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", trade.league_id)
    .eq("user_id", user.id)
    .single();

  if (!member || member.id !== trade.proposer_id) return;

  // Only a still-pending trade can be cancelled — never flip one that's already
  // been accepted/executed, rejected, or cancelled.
  if (trade.status !== "pending") return;

  await admin.from("trades").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", tradeId);
  revalidatePath(`/league/${trade.league_id}/trades`);
}
