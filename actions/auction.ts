"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { regenerateLeagueMatchups } from "@/actions/matchups";

const ANTI_SNIPE_THRESHOLD_SEC = 10;
const ANTI_SNIPE_RESET_SEC = 10;

type DraftRow = {
  id: number;
  status: string;
  type: string;
  current_pick: number;
  total_rounds: number;
  seconds_per_pick: number;
  auction_budget: number;
  auction_current_player_id: number | null;
  auction_current_bid: number | null;
  auction_high_bidder_team_id: number | null;
  auction_nominator_team_id: number | null;
  auction_ends_at: string | null;
};

async function loadAuctionContext(leagueId: number) {
  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("drafts")
    .select(
      "id, status, type, current_pick, total_rounds, seconds_per_pick, auction_budget, auction_current_player_id, auction_current_bid, auction_high_bidder_team_id, auction_nominator_team_id, auction_ends_at",
    )
    .eq("league_id", leagueId)
    .single();
  const { data: members } = await admin
    .from("league_members")
    .select("id, user_id, draft_position, auction_budget_remaining")
    .eq("league_id", leagueId)
    .order("draft_position");
  return { admin, draft: draft as DraftRow | null, members: members ?? [] };
}

function currentNominator(members: any[], currentPick: number): any | null {
  const ordered = members.filter((m) => m.draft_position != null);
  const n = ordered.length;
  if (n === 0) return null;
  const round = Math.ceil(currentPick / n);
  const positionInRound = currentPick - (round - 1) * n;
  const isReversed = round % 2 === 0;
  const slot = isReversed ? n - positionInRound + 1 : positionInRound;
  return ordered.find((m) => m.draft_position === slot) ?? null;
}

/** Caller's max bid given the per-team minimum-$1-per-remaining-spot rule. */
async function maxBidFor(
  leagueId: number,
  teamId: number,
  draft: DraftRow,
): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("rosters")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("team_id", teamId);
  const owned = count ?? 0;
  const remainingSpots = Math.max(0, draft.total_rounds - owned);
  if (remainingSpots === 0) return 0;
  // Need to reserve $1 for each *future* spot beyond this one.
  const reserve = remainingSpots - 1;
  const { data: member } = await admin
    .from("league_members")
    .select("auction_budget_remaining")
    .eq("id", teamId)
    .single();
  const budget = (member as any)?.auction_budget_remaining ?? 0;
  return Math.max(0, budget - reserve);
}

export async function nominatePlayer(
  leagueId: number,
  playerId: number,
  openingBid: number,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { admin, draft, members } = await loadAuctionContext(leagueId);
  if (!draft || draft.status !== "in_progress" || draft.type !== "auction") return;
  if (draft.auction_current_player_id != null) return; // a nomination is already live

  const caller = members.find((m) => (m as any).user_id === user.id);
  if (!caller) return;

  const nominator = currentNominator(members, draft.current_pick);
  if (!nominator || (nominator as any).id !== (caller as any).id) return;

  const { data: existing } = await admin
    .from("rosters")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (existing) return;

  const bid = Math.max(1, Math.round(openingBid));
  const max = await maxBidFor(leagueId, (caller as any).id, draft);
  if (bid > max) return;

  const endsAt = new Date(Date.now() + draft.seconds_per_pick * 1000).toISOString();
  await admin
    .from("drafts")
    .update({
      auction_current_player_id: playerId,
      auction_current_bid: bid,
      auction_high_bidder_team_id: (caller as any).id,
      auction_nominator_team_id: (caller as any).id,
      auction_ends_at: endsAt,
    })
    .eq("id", draft.id);

  revalidatePath(`/league/${leagueId}/draft`);
}

export async function placeBid(leagueId: number, amount: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { admin, draft, members } = await loadAuctionContext(leagueId);
  if (!draft || draft.status !== "in_progress" || draft.type !== "auction") return;
  if (draft.auction_current_player_id == null || !draft.auction_ends_at) return;

  // Bidding closed once the timer is past.
  const endsMs = Date.parse(draft.auction_ends_at);
  if (Number.isFinite(endsMs) && Date.now() >= endsMs) return;

  const caller = members.find((m) => (m as any).user_id === user.id);
  if (!caller) return;
  if ((caller as any).id === draft.auction_high_bidder_team_id) return; // can't outbid self

  const bid = Math.round(amount);
  if (bid <= (draft.auction_current_bid ?? 0)) return;
  const max = await maxBidFor(leagueId, (caller as any).id, draft);
  if (bid > max) return;

  // Anti-snipe: if less than 10s remain when this bid lands, reset to 10s.
  const remainingSec = (endsMs - Date.now()) / 1000;
  const nextEnds = remainingSec < ANTI_SNIPE_THRESHOLD_SEC
    ? new Date(Date.now() + ANTI_SNIPE_RESET_SEC * 1000).toISOString()
    : draft.auction_ends_at;

  await admin
    .from("drafts")
    .update({
      auction_current_bid: bid,
      auction_high_bidder_team_id: (caller as any).id,
      auction_ends_at: nextEnds,
    })
    .eq("id", draft.id);

  revalidatePath(`/league/${leagueId}/draft`);
}

/**
 * Finalize the live nomination when the timer expires. Anyone signed in can
 * call this; the server re-validates expiry.
 */
export async function finalizeAuctionPick(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { admin, draft, members } = await loadAuctionContext(leagueId);
  if (!draft || draft.status !== "in_progress" || draft.type !== "auction") return;
  if (draft.auction_current_player_id == null || !draft.auction_ends_at) return;

  const endsMs = Date.parse(draft.auction_ends_at);
  if (!Number.isFinite(endsMs) || Date.now() < endsMs) return; // still bidding

  const winnerTeamId = draft.auction_high_bidder_team_id!;
  const playerId = draft.auction_current_player_id;
  const winningBid = draft.auction_current_bid ?? 0;

  const positionedCount = members.filter((m: any) => m.draft_position != null).length;

  // Award the player — assign an open starter slot in their division (like the
  // snake claim_draft_pick path) so auction winners aren't stuck on the bench
  // scoring nothing until the manager manually builds a lineup.
  const { data: player } = await admin.from("players").select("division").eq("id", playerId).single();
  const division = ((player as any)?.division ?? "MPO") as "MPO" | "FPO";
  const { data: leagueSlots } = await admin
    .from("leagues")
    .select("mpo_starters, fpo_starters")
    .eq("id", leagueId)
    .single();
  const slotLimit = division === "MPO"
    ? ((leagueSlots as any)?.mpo_starters ?? 4)
    : ((leagueSlots as any)?.fpo_starters ?? 2);
  const { data: divStarters } = await admin
    .from("rosters")
    .select("lineup_order, players!inner(division)")
    .eq("league_id", leagueId)
    .eq("team_id", winnerTeamId)
    .eq("is_starter", true)
    .eq("players.division", division);
  const taken = new Set(
    (divStarters ?? []).map((r: any) => r.lineup_order).filter((o: number | null) => o != null),
  );
  let assignedOrder: number | null = null;
  for (let i = 1; i <= slotLimit; i++) { if (!taken.has(i)) { assignedOrder = i; break; } }

  await admin.from("rosters").insert({
    league_id: leagueId,
    team_id: winnerTeamId,
    player_id: playerId,
    acquired_week: 1,
    is_starter: assignedOrder !== null,
    lineup_order: assignedOrder,
  });
  await admin.from("draft_picks").insert({
    draft_id: draft.id,
    pick_number: draft.current_pick,
    round: Math.ceil(draft.current_pick / Math.max(1, positionedCount)),
    team_id: winnerTeamId,
    player_id: playerId,
  });

  // Deduct from the winner's budget.
  const { data: winner } = await admin
    .from("league_members")
    .select("auction_budget_remaining")
    .eq("id", winnerTeamId)
    .single();
  const remaining = ((winner as any)?.auction_budget_remaining ?? 0) - winningBid;
  await admin
    .from("league_members")
    .update({ auction_budget_remaining: Math.max(0, remaining) })
    .eq("id", winnerTeamId);

  // Advance to the next nominator. Skip any team whose roster is already full —
  // a full team can't open a nomination (its max bid is 0), so leaving it on the
  // clock would deadlock the auction. The draft completes once every positioned
  // team is full (not at a fixed pick count, which breaks when a member has no
  // draft_position).
  const { data: rosterRows } = await admin
    .from("rosters")
    .select("team_id")
    .eq("league_id", leagueId);
  const ownedByTeam = new Map<number, number>();
  for (const r of rosterRows ?? []) {
    ownedByTeam.set((r as any).team_id, (ownedByTeam.get((r as any).team_id) ?? 0) + 1);
  }
  const positioned = members.filter((m: any) => m.draft_position != null);
  const allFull =
    positioned.length > 0 &&
    positioned.every((m: any) => (ownedByTeam.get(m.id) ?? 0) >= draft.total_rounds);

  if (allFull) {
    await admin
      .from("drafts")
      .update({
        status: "complete",
        current_pick: draft.current_pick + 1,
        auction_current_player_id: null,
        auction_current_bid: null,
        auction_high_bidder_team_id: null,
        auction_nominator_team_id: null,
        auction_ends_at: null,
        current_pick_started_at: null,
      })
      .eq("id", draft.id);
    await admin.from("leagues").update({ draft_status: "complete" }).eq("id", leagueId);
    await regenerateLeagueMatchups(leagueId);
  } else {
    let np = draft.current_pick + 1;
    let nextNominator = currentNominator(members, np);
    let guard = 0;
    while (
      nextNominator &&
      (ownedByTeam.get((nextNominator as any).id) ?? 0) >= draft.total_rounds &&
      guard++ < 100000
    ) {
      np++;
      nextNominator = currentNominator(members, np);
    }
    await admin
      .from("drafts")
      .update({
        current_pick: np,
        current_pick_started_at: new Date().toISOString(),
        auction_current_player_id: null,
        auction_current_bid: null,
        auction_high_bidder_team_id: null,
        auction_nominator_team_id: nextNominator ? (nextNominator as any).id : null,
        auction_ends_at: null,
      })
      .eq("id", draft.id);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
}
