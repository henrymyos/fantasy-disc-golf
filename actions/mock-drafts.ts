"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mockTeamIndexForPick, type MockSeats } from "@/lib/mock-draft-types";

type SavedPick = {
  pickNumber: number;
  teamIndex: number;
  playerId: number | null;
  /** Auction only: price the winning team paid. */
  price?: number;
};

type MockStatus = "lobby" | "in_progress" | "complete";
type MockDraftType = "snake" | "auction";

export async function saveMockDraft(
  leagueId: string,
  payload: {
    myDraftPosition: number;
    numTeams: number;
    rosterSize: number;
    picks: SavedPick[];
    status?: MockStatus;
    id?: number;
    draftType?: MockDraftType;
    auctionBudget?: number | null;
    thirdRoundReversal?: boolean;
  }
): Promise<{ id: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Confirm membership in this league
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!member) throw new Error("Not a member of this league");

  const status: MockStatus = payload.status ?? "complete";

  if (payload.id) {
    // Update an existing draft (e.g. auto-save during drafting).
    const { data: existing } = await admin
      .from("mock_drafts")
      .select("user_id")
      .eq("id", payload.id)
      .single();
    if (!existing || existing.user_id !== user.id) {
      throw new Error("Not authorized");
    }
    const { error: updateError } = await admin
      .from("mock_drafts")
      .update({
        my_draft_position: payload.myDraftPosition,
        num_teams: payload.numTeams,
        roster_size: payload.rosterSize,
        picks: payload.picks,
        status,
        draft_type: payload.draftType ?? "snake",
        auction_budget: payload.auctionBudget ?? null,
        third_round_reversal: payload.thirdRoundReversal ?? false,
      })
      .eq("id", payload.id);
    if (updateError) throw new Error(updateError.message);
    revalidatePath(`/league/${leagueId}/mock-draft`);
    return { id: payload.id };
  }

  const { data, error } = await admin
    .from("mock_drafts")
    .insert({
      user_id: user.id,
      league_id: Number(leagueId),
      my_draft_position: payload.myDraftPosition,
      num_teams: payload.numTeams,
      roster_size: payload.rosterSize,
      picks: payload.picks,
      status,
      draft_type: payload.draftType ?? "snake",
      auction_budget: payload.auctionBudget ?? null,
      third_round_reversal: payload.thirdRoundReversal ?? false,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}/mock-draft`);
  return { id: data.id };
}

export async function deleteMockDraft(leagueId: string, mockDraftId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Only the owner can delete
  const { data: row } = await admin
    .from("mock_drafts")
    .select("user_id")
    .eq("id", mockDraftId)
    .single();
  if (!row || row.user_id !== user.id) throw new Error("Not authorized");

  await admin.from("mock_drafts").delete().eq("id", mockDraftId);

  revalidatePath(`/league/${leagueId}/mock-draft`);
}

// ── Shared / multiplayer mock drafts ─────────────────────────────────────────
// A shared mock draft is a normal mock_drafts row with is_shared = true and a
// `seats` map of teamIndex -> the human who claimed it. Any unclaimed seat is
// drafted by a bot (driven from the host's browser). Clients subscribe to the
// row over Supabase Realtime, so every mutation here just writes the row and
// the change fans out automatically.

type AdminClient = ReturnType<typeof createAdminClient>;

/** Best-effort display name for a user: their team name in this league, else a
 *  metadata name, else the local-part of their email. */
async function resolveDisplayName(
  admin: AdminClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  leagueId: string,
): Promise<string> {
  const { data: member } = await admin
    .from("league_members")
    .select("team_name")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  const teamName = (member as { team_name?: string | null } | null)?.team_name;
  if (teamName) return teamName;
  const metaName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (typeof metaName === "string" && metaName.trim()) return metaName.trim();
  if (user.email) return user.email.split("@")[0];
  return "Player";
}

/** Index of the first pick slot still open (the team on the clock), or -1. */
function firstOpenPick(picks: SavedPick[]): number {
  return picks.findIndex((p) => p.playerId == null);
}

/**
 * Promote a mock draft to a shareable, multiplayer lobby. Creates the row if it
 * doesn't exist yet (the lobby starts before anything is auto-saved). The host
 * occupies `hostSeatIndex`; everyone else joins via the share link.
 */
export async function shareMockDraft(
  leagueId: string,
  payload: {
    id?: number;
    numTeams: number;
    rosterSize: number;
    hostSeatIndex: number;
    thirdRoundReversal?: boolean;
  },
): Promise<{ id: number }> {
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
  if (!member) throw new Error("Not a member of this league");

  const { numTeams, rosterSize, hostSeatIndex } = payload;
  if (hostSeatIndex < 0 || hostSeatIndex >= numTeams) {
    throw new Error("Invalid host seat");
  }

  const hostName = await resolveDisplayName(admin, user, leagueId);
  const seats: MockSeats = {
    [String(hostSeatIndex)]: { userId: user.id, name: hostName, isHost: true },
  };

  // An empty board so joiners can see the slots before the draft starts. The
  // teamIndex is baked into each slot here (honouring 3RR) so later pick logic
  // never has to recompute snake order.
  const thirdRoundReversal = !!payload.thirdRoundReversal;
  const totalPicks = numTeams * rosterSize;
  const picks: SavedPick[] = Array.from({ length: totalPicks }, (_, i) => ({
    pickNumber: i + 1,
    teamIndex: mockTeamIndexForPick(i, numTeams, thirdRoundReversal),
    playerId: null,
  }));

  if (payload.id) {
    const { data: existing } = await admin
      .from("mock_drafts")
      .select("user_id, picks, status")
      .eq("id", payload.id)
      .single();
    if (!existing || existing.user_id !== user.id) throw new Error("Not authorized");
    // Don't wipe a board that's already mid-draft.
    const keepPicks =
      (existing as { status?: string }).status !== "lobby" &&
      Array.isArray((existing as { picks?: unknown }).picks) &&
      ((existing as { picks: SavedPick[] }).picks.some((p) => p.playerId != null));
    const { error } = await admin
      .from("mock_drafts")
      .update({
        is_shared: true,
        status: "lobby",
        seats,
        my_draft_position: hostSeatIndex + 1,
        num_teams: numTeams,
        roster_size: rosterSize,
        draft_type: "snake",
        third_round_reversal: thirdRoundReversal,
        ...(keepPicks ? {} : { picks }),
      })
      .eq("id", payload.id);
    if (error) throw new Error(error.message);
    revalidatePath(`/league/${leagueId}/mock-draft`);
    return { id: payload.id };
  }

  const { data, error } = await admin
    .from("mock_drafts")
    .insert({
      user_id: user.id,
      league_id: Number(leagueId),
      my_draft_position: hostSeatIndex + 1,
      num_teams: numTeams,
      roster_size: rosterSize,
      picks,
      status: "lobby",
      is_shared: true,
      seats,
      draft_type: "snake",
      third_round_reversal: thirdRoundReversal,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}/mock-draft`);
  return { id: data.id };
}

/** Claim an open seat in a shared draft (lobby only). Any logged-in user may
 *  join — league membership is not required. Moves the user if they already
 *  hold a different seat. */
export async function joinMockDraft(
  mockDraftId: number,
  teamIndex: number,
): Promise<{ ok: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: mock } = await admin
    .from("mock_drafts")
    .select("league_id, num_teams, status, is_shared, seats")
    .eq("id", mockDraftId)
    .single();
  if (!mock || !(mock as { is_shared?: boolean }).is_shared) throw new Error("Draft not found");
  if ((mock as { status?: string }).status !== "lobby") throw new Error("Draft already started");
  if (teamIndex < 0 || teamIndex >= (mock as { num_teams: number }).num_teams) {
    throw new Error("Invalid seat");
  }

  const seats: MockSeats = { ...((mock as { seats?: MockSeats }).seats ?? {}) };
  const target = seats[String(teamIndex)];
  if (target && target.userId !== user.id) throw new Error("Seat already taken");

  // Drop any seat this user already holds, then claim the new one.
  for (const key of Object.keys(seats)) {
    if (seats[key].userId === user.id && !seats[key].isHost) delete seats[key];
  }
  const name = await resolveDisplayName(admin, user, String((mock as { league_id: number }).league_id));
  seats[String(teamIndex)] = { userId: user.id, name };

  const { error } = await admin.from("mock_drafts").update({ seats }).eq("id", mockDraftId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Release the caller's seat (lobby only). The host's seat can't be released. */
export async function leaveMockDraftSeat(mockDraftId: number): Promise<{ ok: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: mock } = await admin
    .from("mock_drafts")
    .select("status, seats")
    .eq("id", mockDraftId)
    .single();
  if (!mock) throw new Error("Draft not found");
  if ((mock as { status?: string }).status !== "lobby") throw new Error("Draft already started");

  const seats: MockSeats = { ...((mock as { seats?: MockSeats }).seats ?? {}) };
  for (const key of Object.keys(seats)) {
    if (seats[key].userId === user.id && !seats[key].isHost) delete seats[key];
  }
  const { error } = await admin.from("mock_drafts").update({ seats }).eq("id", mockDraftId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Host kicks off the shared draft: lobby -> in_progress. */
export async function startSharedMockDraft(mockDraftId: number): Promise<{ ok: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: mock } = await admin
    .from("mock_drafts")
    .select("user_id, status, is_shared")
    .eq("id", mockDraftId)
    .single();
  if (!mock || !(mock as { is_shared?: boolean }).is_shared) throw new Error("Draft not found");
  if ((mock as { user_id: string }).user_id !== user.id) throw new Error("Only the host can start");
  if ((mock as { status?: string }).status !== "lobby") throw new Error("Draft already started");

  const { error } = await admin
    .from("mock_drafts")
    .update({ status: "in_progress" })
    .eq("id", mockDraftId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * Draft a player into the team currently on the clock. The on-clock slot is
 * recomputed server-side, so a stale client can't pick out of turn. A human may
 * only pick on their own seat; the host may pick for any unclaimed (bot) seat.
 * The actual write goes through claim_mock_pick() for an atomic compare-and-set.
 */
export async function makeSharedMockPick(
  mockDraftId: number,
  playerId: number,
): Promise<{ ok: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: mock } = await admin
    .from("mock_drafts")
    .select("user_id, num_teams, status, is_shared, seats, picks")
    .eq("id", mockDraftId)
    .single();
  if (!mock || !(mock as { is_shared?: boolean }).is_shared) throw new Error("Draft not found");
  if ((mock as { status?: string }).status !== "in_progress") throw new Error("Draft is not live");

  const picks = ((mock as { picks?: SavedPick[] }).picks ?? []) as SavedPick[];
  const onClock = firstOpenPick(picks);
  if (onClock === -1) throw new Error("Draft is complete");

  // teamIndex is baked into each slot at share time (honouring 3RR).
  const teamIndex = picks[onClock].teamIndex;
  const seats = (mock as { seats?: MockSeats }).seats ?? {};
  const seat = seats[String(teamIndex)];
  const hostId = (mock as { user_id: string }).user_id;

  if (seat) {
    if (seat.userId !== user.id) throw new Error("It's not your pick");
  } else if (user.id !== hostId) {
    // Unclaimed seat -> bot. Only the host's browser drives bot picks.
    throw new Error("Only the host controls bot picks");
  }

  const { error } = await admin.rpc("claim_mock_pick", {
    p_id: mockDraftId,
    p_pick_index: onClock,
    p_player_id: playerId,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Snapshot of a shared draft for hydration and as a polling backstop to
 *  Realtime. Any logged-in user may read a shared draft. */
export async function getMockDraftState(mockDraftId: number): Promise<{
  id: number;
  hostId: string;
  status: MockStatus;
  isShared: boolean;
  numTeams: number;
  rosterSize: number;
  seats: MockSeats;
  picks: SavedPick[];
} | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: mock } = await admin
    .from("mock_drafts")
    .select("id, user_id, status, is_shared, num_teams, roster_size, seats, picks")
    .eq("id", mockDraftId)
    .single();
  if (!mock || !(mock as { is_shared?: boolean }).is_shared) return null;

  return {
    id: (mock as { id: number }).id,
    hostId: (mock as { user_id: string }).user_id,
    status: ((mock as { status?: string }).status ?? "lobby") as MockStatus,
    isShared: true,
    numTeams: (mock as { num_teams: number }).num_teams,
    rosterSize: (mock as { roster_size: number }).roster_size,
    seats: ((mock as { seats?: MockSeats }).seats ?? {}) as MockSeats,
    picks: ((mock as { picks?: SavedPick[] }).picks ?? []) as SavedPick[],
  };
}
