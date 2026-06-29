"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { regenerateLeagueMatchups } from "@/actions/matchups";
import { resolvePickOwnerId, buildPickOwnerOverrides } from "@/lib/draft-pick-owners";

export async function startDraft(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.commissioner_id !== user.id) return;

  const { data: draftRow } = await admin
    .from("drafts")
    .select("type, auction_budget")
    .eq("league_id", leagueId)
    .single();

  const { data: members } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .order("joined_at");

  if (!members || members.length < 2) return;

  // Only randomize draft positions if they haven't already been set (so the
  // commissioner's manual order — set via the pre-draft Randomize button —
  // doesn't get overwritten if they click Start without re-randomizing).
  const { data: existingPositions } = await admin
    .from("league_members")
    .select("id, draft_position")
    .eq("league_id", leagueId);
  const allSet = (existingPositions ?? []).every((m: any) => m.draft_position != null);
  if (!allSet) {
    const shuffled = [...members].sort(() => Math.random() - 0.5);
    await Promise.all(
      shuffled.map((m, i) =>
        admin.from("league_members").update({ draft_position: i + 1 }).eq("id", m.id)
      )
    );
  }

  // Seed auction budgets if this is an auction draft.
  if ((draftRow as any)?.type === "auction") {
    const budget = (draftRow as any)?.auction_budget ?? 200;
    await admin
      .from("league_members")
      .update({ auction_budget_remaining: budget })
      .eq("league_id", leagueId);
  }

  const nominatorTeam = (draftRow as any)?.type === "auction"
    ? (await admin
        .from("league_members")
        .select("id")
        .eq("league_id", leagueId)
        .eq("draft_position", 1)
        .single()).data
    : null;

  await admin
    .from("drafts")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      current_pick: 1,
      current_pick_started_at: new Date().toISOString(),
      auction_nominator_team_id: (nominatorTeam as any)?.id ?? null,
      auction_current_player_id: null,
      auction_current_bid: null,
      auction_high_bidder_team_id: null,
      auction_ends_at: null,
    })
    .eq("league_id", leagueId);

  await admin.from("leagues").update({ draft_status: "in_progress" }).eq("id", leagueId);

  revalidatePath(`/league/${leagueId}/draft`);
}

// Commissioner-only: assign a random draft_position to each member.
// Only allowed before the draft starts.
export async function randomizeDraftOrder(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("id, status")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "pending") return;

  const { data: members } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .order("joined_at");
  if (!members || members.length === 0) return;

  const shuffled = [...members].sort(() => Math.random() - 0.5);
  for (let i = 0; i < shuffled.length; i++) {
    await admin
      .from("league_members")
      .update({ draft_position: i + 1 })
      .eq("id", shuffled[i].id);
  }

  // Changing the order changes which slots belong to whom, so any current-draft
  // pick trades made under the old order are voided (back to snake default).
  await admin.from("current_draft_pick_owners").delete().eq("draft_id", (draft as any).id);
  await admin.from("trade_current_picks").delete().eq("draft_id", (draft as any).id);

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}`);
}

// Commissioner-only: schedule (or clear) the draft start time.
export async function scheduleDraft(leagueId: number, scheduledAtIso: string | null): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("id, status")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "pending") return;

  // Reject past times (allow null to clear).
  if (scheduledAtIso) {
    const ms = Date.parse(scheduledAtIso);
    if (!Number.isFinite(ms) || ms <= Date.now()) return;
  }

  await admin
    .from("drafts")
    .update({ scheduled_at: scheduledAtIso })
    .eq("id", draft.id);

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}`);
}

export async function pauseDraft(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  await admin.from("drafts").update({ status: "paused" }).eq("league_id", leagueId);
  revalidatePath(`/league/${leagueId}/draft`);
}

export async function resumeDraft(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  // Restart the per-pick clock from now. Without this, the on-clock team's
  // timer keeps counting from before the pause, so any pause longer than
  // seconds_per_pick makes the pick read as already expired the moment the
  // board loads and the on-clock team is instantly auto-picked. (undoPick does
  // the same reset.)
  await admin
    .from("drafts")
    .update({ status: "in_progress", current_pick_started_at: new Date().toISOString() })
    .eq("league_id", leagueId);
  revalidatePath(`/league/${leagueId}/draft`);
}

export async function makeDraftPick(leagueId: number, playerId: number): Promise<void> {
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

  // Single atomic RPC: locks the draft row, validates on-clock + duplicate,
  // assigns the starter slot, inserts roster + draft_pick, advances pick.
  const { data: result } = await admin.rpc("claim_draft_pick", {
    p_league_id: leagueId,
    p_team_id: member.id,
    p_player_id: playerId,
  });

  if ((result as any)?.complete) {
    await regenerateLeagueMatchups(leagueId);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
}

/**
 * Commissioner-only: rewind the draft to a specific pick. Removes the targeted
 * pick AND every later pick (along with the rosters rows they created), then
 * resets drafts.current_pick to that pick number and restarts the per-pick
 * clock so the on-clock team is back at that slot. If the draft had completed,
 * flips it back to 'paused' (and league.draft_status back to 'in_progress')
 * so the commissioner can replay from the rewind point.
 */
export async function undoPick(leagueId: number, pickNumber: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("id, status")
    .eq("league_id", leagueId)
    .single();
  if (!draft) return;
  if (draft.status !== "in_progress" && draft.status !== "paused" && draft.status !== "complete") {
    return;
  }
  if (!Number.isInteger(pickNumber) || pickNumber < 1) return;

  // Every pick from `pickNumber` onward is rolled back. Pull them so we can
  // delete the corresponding roster rows in one shot.
  const { data: rewindPicks } = await admin
    .from("draft_picks")
    .select("id, team_id, player_id")
    .eq("draft_id", draft.id)
    .gte("pick_number", pickNumber);
  if (!rewindPicks || rewindPicks.length === 0) return;

  const playerIds = rewindPicks.map((p: any) => p.player_id);
  await admin
    .from("rosters")
    .delete()
    .eq("league_id", leagueId)
    .in("player_id", playerIds);

  await admin
    .from("draft_picks")
    .delete()
    .eq("draft_id", draft.id)
    .gte("pick_number", pickNumber);

  const wasComplete = draft.status === "complete";
  await admin
    .from("drafts")
    .update({
      current_pick: pickNumber,
      current_pick_started_at: new Date().toISOString(),
      status: wasComplete ? "paused" : draft.status,
    })
    .eq("id", draft.id);
  if (wasComplete) {
    await admin.from("leagues").update({ draft_status: "in_progress" }).eq("id", leagueId);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
}

/**
 * Convenience wrapper: undo the single most recent pick. Used by the
 * status-bar "Undo pick" button so callers don't have to know the pick number.
 */
export async function undoLastPick(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("drafts")
    .select("id")
    .eq("league_id", leagueId)
    .single();
  if (!draft) return;

  const { data: lastPick } = await admin
    .from("draft_picks")
    .select("pick_number")
    .eq("draft_id", (draft as any).id)
    .order("pick_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastPick) return;

  await undoPick(leagueId, (lastPick as any).pick_number);
}

/**
 * Commissioner-only: make the current pick on behalf of whichever team is on
 * the clock. Reuses the claim_draft_pick RPC by supplying that team's id so
 * all of the draft state (lineup slot assignment, roster insertion, current
 * pick advancement) stays consistent with a normal pick.
 */
export async function commissionerMakePick(leagueId: number, playerId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("id, status, current_pick, third_round_reversal")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "in_progress") return;

  const { data: members } = await admin
    .from("league_members")
    .select("id, draft_position")
    .eq("league_id", leagueId)
    .not("draft_position", "is", null)
    .order("draft_position");
  if (!members || members.length === 0) return;

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
  if (onClockId == null) return;

  const { data: result } = await admin.rpc("claim_draft_pick", {
    p_league_id: leagueId,
    p_team_id: onClockId,
    p_player_id: playerId,
  });

  if ((result as any)?.complete) {
    await regenerateLeagueMatchups(leagueId);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
}
