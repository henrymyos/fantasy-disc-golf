import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeDraftCompletion } from "@/lib/draft-postpone";
import { resolvePickOwnerId, buildPickOwnerOverrides } from "@/lib/draft-pick-owners";
import { notifyDraftPick } from "@/lib/draft-notify";

// Core draft-timer logic. These intentionally live OUTSIDE any "use server"
// module: they use the admin (service-role) client and perform NO auth checks,
// so exporting them from a server-action file would expose them as
// unauthenticated endpoints any logged-in user could invoke against any league.
// The only callers are the guarded actions in actions/rankings.ts
// (autoPickFromRankings, autoPickExpired) and actions/auction.ts
// (nominatePlayer, placeBid, finalizeAuctionPick), plus the CRON_SECRET-gated
// /api/draft-cron backstop that fires timers when no client has the page open.

type AdminClient = ReturnType<typeof createAdminClient>;

export type DraftRow = {
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

/** Load the auction draft + members for a league, using the supplied admin
 *  client. Shared between the auction server actions and the cron backstop. */
export async function loadAuctionContext(admin: AdminClient, leagueId: number) {
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

/** Team whose turn it is to nominate, given the snake-ordered nomination
 *  sequence. */
export function currentNominator(members: any[], currentPick: number): any | null {
  const ordered = members.filter((m) => m.draft_position != null);
  const n = ordered.length;
  if (n === 0) return null;
  const round = Math.ceil(currentPick / n);
  const positionInRound = currentPick - (round - 1) * n;
  const isReversed = round % 2 === 0;
  const slot = isReversed ? n - positionInRound + 1 : positionInRound;
  return ordered.find((m) => m.draft_position === slot) ?? null;
}

/**
 * Best available player for the given on-clock team, mirroring the mock-draft
 * bot's lineup-aware logic: respect the team's target roster composition
 * (starters + bench split proportionally to the starter ratio) instead of
 * blindly taking the top overall rank. Walks `forUserId`'s personal ranking
 * list first, then global overall_rank as a fallback ordering — within each,
 * skips candidates whose division is already at target on this team. If both
 * divisions are saturated (rounding quirk), falls back to the top undrafted
 * player so the draft still progresses.
 */
export async function pickBestAvailableForTeam(
  admin: AdminClient,
  leagueId: number,
  teamId: number,
  forUserId: string | null,
): Promise<number | null> {
  // League config governs the lineup targets.
  const { data: league } = await admin
    .from("leagues")
    .select("mpo_starters, fpo_starters, roster_size")
    .eq("id", leagueId)
    .single();
  const mpoStarters = Number((league as any)?.mpo_starters ?? 4);
  const fpoStarters = Number((league as any)?.fpo_starters ?? 2);
  const rosterSize = Number((league as any)?.roster_size ?? 10);

  // All drafted players in this league, with each player's division so we can
  // both skip taken players and tally the on-clock team's current MPO/FPO mix.
  const { data: drafted } = await admin
    .from("rosters")
    .select("player_id, team_id, players(division)")
    .eq("league_id", leagueId);
  const draftedIds = new Set((drafted ?? []).map((r: any) => r.player_id));
  let mpoCount = 0;
  let fpoCount = 0;
  for (const r of drafted ?? []) {
    if ((r as any).team_id !== teamId) continue;
    const div = (r as any).players?.division;
    if (div === "MPO") mpoCount++;
    else if (div === "FPO") fpoCount++;
  }

  // Target = starters + bench split in the same MPO:FPO ratio as the starters.
  const totalStarters = mpoStarters + fpoStarters;
  const benchSize = Math.max(0, rosterSize - totalStarters);
  const benchMpo = totalStarters > 0 ? Math.round((benchSize * mpoStarters) / totalStarters) : 0;
  const benchFpo = benchSize - benchMpo;
  const mpoTarget = mpoStarters + benchMpo;
  const fpoTarget = fpoStarters + benchFpo;
  function divisionFits(division: string | undefined | null): boolean {
    if (division === "MPO") return mpoCount < mpoTarget;
    if (division === "FPO") return fpoCount < fpoTarget;
    return false;
  }

  // Player divisions, indexed by id, and a global overall_rank fallback order.
  const { data: allPlayers } = await admin
    .from("players")
    .select("id, division, overall_rank")
    .order("overall_rank", { ascending: true, nullsFirst: false })
    .limit(500);
  const divisionById = new Map<number, string>();
  for (const p of allPlayers ?? []) {
    divisionById.set((p as any).id, (p as any).division ?? "MPO");
  }

  // Candidate order: the user's draft queue first (highest priority), then
  // their personal rankings, then anything missing from both appended in
  // overall_rank order.
  const candidateIds: number[] = [];
  const seen = new Set<number>();
  if (forUserId) {
    const { data: queued } = await admin
      .from("draft_queue")
      .select("player_id, position")
      .eq("user_id", forUserId)
      .eq("league_id", leagueId)
      .order("position", { ascending: true });
    for (const r of queued ?? []) {
      const pid = (r as any).player_id;
      if (!seen.has(pid)) {
        candidateIds.push(pid);
        seen.add(pid);
      }
    }
    const { data: rankings } = await admin
      .from("user_player_rankings")
      .select("player_id, rank")
      .eq("user_id", forUserId)
      .eq("league_id", leagueId)
      .order("rank", { ascending: true });
    for (const r of rankings ?? []) {
      const pid = (r as any).player_id;
      if (!seen.has(pid)) {
        candidateIds.push(pid);
        seen.add(pid);
      }
    }
  }
  for (const p of allPlayers ?? []) {
    const pid = (p as any).id;
    if (!seen.has(pid)) {
      candidateIds.push(pid);
      seen.add(pid);
    }
  }

  // First pass: highest-ranked candidate whose division still has room.
  for (const pid of candidateIds) {
    if (draftedIds.has(pid)) continue;
    if (divisionFits(divisionById.get(pid))) return pid;
  }
  // Fallback: any undrafted candidate (both divisions saturated).
  for (const pid of candidateIds) {
    if (!draftedIds.has(pid)) return pid;
  }
  return null;
}

/**
 * Snake auto-pick core: the on-clock team gets the highest-ranked available
 * player from their owner's rankings (falling back to overall_rank). Re-fetches
 * the draft with the admin client and re-validates that:
 *   - the draft is in_progress,
 *   - the elapsed time since current_pick_started_at exceeds seconds_per_pick.
 *
 * No auth checks — see the file note. Returns true when a pick was made.
 */
export async function runExpiredSnakePick(admin: AdminClient, leagueId: number): Promise<boolean> {
  const { data: draft } = await admin
    .from("drafts")
    .select("id, status, current_pick, seconds_per_pick, current_pick_started_at, third_round_reversal")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "in_progress") return false;
  if (!draft.current_pick_started_at) return false;

  const startedMs = Date.parse(draft.current_pick_started_at);
  const elapsedSec = (Date.now() - startedMs) / 1000;
  if (elapsedSec < (draft.seconds_per_pick ?? 60)) return false;

  // Find the on-clock team to pick FOR (honoring any traded pick slots).
  const { data: members } = await admin
    .from("league_members")
    .select("id, user_id, draft_position")
    .eq("league_id", leagueId)
    .not("draft_position", "is", null)
    .order("draft_position");
  if (!members || members.length === 0) return false;

  const { data: ownerRows } = await admin
    .from("current_draft_pick_owners")
    .select("overall_pick, owner_team_id")
    .eq("draft_id", (draft as any).id);

  const onClockId = resolvePickOwnerId(
    draft.current_pick,
    (members as any[]).map((m) => ({ id: m.id, draftPosition: m.draft_position })),
    (draft as any).third_round_reversal ?? false,
    buildPickOwnerOverrides(ownerRows as any),
  );
  const onClock = (members as any[]).find((m) => m.id === onClockId);
  if (!onClock) return false;

  const pickedPlayerId = await pickBestAvailableForTeam(
    admin,
    leagueId,
    onClock.id,
    onClock.user_id ?? null,
  );
  if (pickedPlayerId == null) return false;

  const { data: result } = await admin.rpc("claim_draft_pick", {
    p_league_id: leagueId,
    p_team_id: onClock.id,
    p_player_id: pickedPlayerId,
  });

  if ((result as any)?.complete) {
    await finalizeDraftCompletion(admin, leagueId);
  }

  try {
    await notifyDraftPick(admin, leagueId);
  } catch (e) {
    console.warn("draft pick push failed", e);
  }

  return true;
}

/**
 * Auction finalize core: awards the live nomination to the high bidder once the
 * timer is past. Re-loads the auction context with the admin client and
 * re-validates that the draft is an in_progress auction with a live nomination
 * whose auction_ends_at is in the past. No auth checks — see the file note.
 * Returns true when a nomination was finalized.
 */
export async function runExpiredAuctionFinalize(admin: AdminClient, leagueId: number): Promise<boolean> {
  const { draft, members } = await loadAuctionContext(admin, leagueId);
  if (!draft || draft.status !== "in_progress" || draft.type !== "auction") return false;
  if (draft.auction_current_player_id == null || !draft.auction_ends_at) return false;

  const endsMs = Date.parse(draft.auction_ends_at);
  if (!Number.isFinite(endsMs) || Date.now() < endsMs) return false; // still bidding

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
    await finalizeDraftCompletion(admin, leagueId);
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

  return true;
}

/**
 * Backstop sweep over every in_progress draft, firing any timer whose deadline
 * has passed. Snake drafts whose current pick has run past seconds_per_pick get
 * an auto-pick; auctions whose nomination timer is past get finalized. The
 * per-draft cores re-validate the deadline, so a draft that is filtered in here
 * but resolved by a client a moment earlier is simply a no-op. Returns a small
 * summary for the cron response.
 */
export async function runDueDraftTimers(
  admin: AdminClient,
): Promise<{ checked: number; snakePicks: number; auctionFinalizes: number }> {
  const { data: drafts } = await admin
    .from("drafts")
    .select("league_id, type, status, seconds_per_pick, current_pick_started_at, auction_ends_at")
    .eq("status", "in_progress");

  let snakePicks = 0;
  let auctionFinalizes = 0;
  const now = Date.now();

  for (const d of drafts ?? []) {
    const draft = d as any;
    if (draft.type === "auction") {
      if (!draft.auction_ends_at) continue;
      const endsMs = Date.parse(draft.auction_ends_at);
      if (!Number.isFinite(endsMs) || now < endsMs) continue;
      if (await runExpiredAuctionFinalize(admin, draft.league_id)) auctionFinalizes++;
    } else {
      if (!draft.current_pick_started_at) continue;
      const startedMs = Date.parse(draft.current_pick_started_at);
      const elapsedSec = (now - startedMs) / 1000;
      if (elapsedSec < (draft.seconds_per_pick ?? 60)) continue;
      if (await runExpiredSnakePick(admin, draft.league_id)) snakePicks++;
    }
  }

  return { checked: drafts?.length ?? 0, snakePicks, auctionFinalizes };
}
