"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLineupLocked, isFreeAgencyLocked, getActiveTournament } from "@/lib/lineup-lock";
import { resetWaiverPriority, runWaiverProcessing } from "@/lib/waivers";

export async function toggleStarter(leagueId: number, rosterSpotId: number, isStarter: boolean): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (await isLineupLocked(supabase)) return;

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
    .update({ is_starter: isStarter, lineup_order: null })
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

  if (await isLineupLocked(supabase)) return;

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

  if (await isLineupLocked(supabase)) return;

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

  if (await isLineupLocked(supabase)) return;

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
    .select("roster_size, current_week, waivers_locked")
    .eq("id", leagueId)
    .single();

  if (!league) return;

  // Free agency is disabled while waivers are locked AND while any tournament
  // is currently in progress — adds during those windows must go through
  // waiver claims so everyone has a shot at hot pickups.
  if (await isFreeAgencyLocked(supabase, (league as any).waivers_locked)) return;

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
    .maybeSingle();

  if (existing) return;

  // IR slots don't count toward the roster size cap.
  const { count } = await admin
    .from("rosters")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("team_id", member.id);
  const atCap = (count ?? 0) >= league.roster_size;

  // At the cap you must drop someone, and that someone must actually be on your
  // roster — otherwise a stale drop (the player is already gone) would let the
  // add push the roster over the cap.
  if (atCap) {
    if (!dropPlayerId) return;
    const { data: dropSpot } = await admin
      .from("rosters")
      .select("id")
      .eq("league_id", leagueId)
      .eq("team_id", member.id)
      .eq("player_id", dropPlayerId)
      .maybeSingle();
    if (!dropSpot) return;
  }

  // Add first: if another team grabbed this player a beat earlier the
  // unique(league_id, player_id) insert fails here and the roster is left
  // untouched — instead of dropping a player and then throwing on the insert
  // (losing a player for nothing) and 500ing the caller.
  const { error: addErr } = await admin.from("rosters").insert({
    league_id: leagueId,
    team_id: member.id,
    player_id: playerId,
    acquired_week: league.current_week,
  });
  if (addErr) return;

  if (dropPlayerId) {
    await admin
      .from("rosters")
      .delete()
      .eq("league_id", leagueId)
      .eq("team_id", member.id)
      .eq("player_id", dropPlayerId);
  }

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

  // Block dropping a current STARTER while lineups are locked (a tournament is
  // underway). Fantasy points aren't floored at zero, so otherwise a manager
  // could dump a player mid-round to erase their negative contribution. Bench
  // players can still be dropped.
  const { data: spot } = await admin
    .from("rosters")
    .select("is_starter")
    .eq("league_id", leagueId)
    .eq("team_id", member.id)
    .eq("player_id", playerId)
    .maybeSingle();
  if ((spot as any)?.is_starter && (await isLineupLocked(supabase))) return;

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

// ── Commissioner roster overrides ───────────────────────────────────────────

/**
 * Commissioner-only: move a player to a different team in this league, or
 * drop them entirely. `newTeamId === null` means "remove from all rosters",
 * any other value means assign or move to that team. No-op when the player
 * is already on the target team.
 *
 * Mirrors the slot-fill logic from claim_draft_pick: when assigned to a team
 * with an open starter slot in the player's division, fills that slot; else
 * lands on the bench.
 */
export async function commissionerSetPlayerTeam(
  leagueId: number,
  playerId: number,
  newTeamId: number | null,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id, mpo_starters, fpo_starters, current_week")
    .eq("id", leagueId)
    .single();
  if (!league || (league as any).commissioner_id !== user.id) return;

  const { data: existing } = await admin
    .from("rosters")
    .select("id, team_id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .maybeSingle();

  // Drop case.
  if (newTeamId == null) {
    if (existing) {
      await admin.from("rosters").delete().eq("id", existing.id);
      await admin.from("roster_transactions").insert({
        league_id: leagueId,
        team_id: (existing as any).team_id,
        player_id: playerId,
        action: "drop",
      });
    }
    revalidatePath(`/league/${leagueId}/settings/rosters`);
    revalidatePath(`/league/${leagueId}/lineups`);
    revalidatePath(`/league/${leagueId}/free-agency`);
    return;
  }

  if (existing && (existing as any).team_id === newTeamId) return;

  // Verify target team is in this league (defense in depth).
  const { data: targetTeam } = await admin
    .from("league_members")
    .select("id")
    .eq("id", newTeamId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!targetTeam) return;

  const { data: player } = await admin
    .from("players")
    .select("division")
    .eq("id", playerId)
    .single();
  const division = ((player as any)?.division ?? "MPO") as "MPO" | "FPO";
  const slotLimit =
    division === "MPO"
      ? (league as any).mpo_starters ?? 4
      : (league as any).fpo_starters ?? 2;

  const { data: divStarters } = await admin
    .from("rosters")
    .select("lineup_order, players!inner(division)")
    .eq("league_id", leagueId)
    .eq("team_id", newTeamId)
    .eq("is_starter", true)
    .eq("players.division", division);
  const taken = new Set(
    (divStarters ?? []).map((r: any) => r.lineup_order).filter((o: number | null) => o != null),
  );
  let assignedOrder: number | null = null;
  for (let i = 1; i <= slotLimit; i++) {
    if (!taken.has(i)) { assignedOrder = i; break; }
  }

  if (existing) {
    await admin
      .from("rosters")
      .update({
        team_id: newTeamId,
        is_starter: assignedOrder !== null,
        lineup_order: assignedOrder,
        acquired_week: (league as any).current_week ?? 1,
      })
      .eq("id", (existing as any).id);
    await admin.from("roster_transactions").insert({
      league_id: leagueId,
      team_id: (existing as any).team_id,
      player_id: playerId,
      action: "drop",
    });
  } else {
    await admin.from("rosters").insert({
      league_id: leagueId,
      team_id: newTeamId,
      player_id: playerId,
      acquired_week: (league as any).current_week ?? 1,
      is_starter: assignedOrder !== null,
      lineup_order: assignedOrder,
    });
  }

  await admin.from("roster_transactions").insert({
    league_id: leagueId,
    team_id: newTeamId,
    player_id: playerId,
    action: "add",
  });

  revalidatePath(`/league/${leagueId}/settings/rosters`);
  revalidatePath(`/league/${leagueId}/lineups`);
  revalidatePath(`/league/${leagueId}/free-agency`);
}

// ── Waivers ─────────────────────────────────────────────────────────────────

export async function placeWaiverClaim(
  leagueId: number,
  playerId: number,
  dropPlayerId?: number,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("league_members")
    .select("id, waiver_priority")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!member) return;

  // Claims only make sense once the draft is complete.
  const { data: claimDraft } = await admin
    .from("drafts")
    .select("status")
    .eq("league_id", leagueId)
    .single();
  if (claimDraft?.status !== "complete") return;

  // If a drop is attached, it must actually be on this team's roster.
  if (dropPlayerId != null) {
    const { data: dropSpot } = await admin
      .from("rosters")
      .select("id")
      .eq("league_id", leagueId)
      .eq("team_id", member.id)
      .eq("player_id", dropPlayerId)
      .maybeSingle();
    if (!dropSpot) return;
  }

  // Reject duplicate pending claims for the same (team, player).
  const { data: existingClaim } = await admin
    .from("waiver_claims")
    .select("id")
    .eq("league_id", leagueId)
    .eq("team_id", member.id)
    .eq("player_id", playerId)
    .eq("status", "pending")
    .maybeSingle();
  if (existingClaim) return;

  // Player must currently be a free agent.
  const { data: rostered } = await admin
    .from("rosters")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (rostered) return;

  // Append to the end of this team's pending-claim queue.
  const { data: existing } = await admin
    .from("waiver_claims")
    .select("claim_order")
    .eq("league_id", leagueId)
    .eq("team_id", member.id)
    .eq("status", "pending");
  const nextOrder =
    (existing ?? []).reduce((max, c) => Math.max(max, (c as any).claim_order ?? 0), 0) + 1;

  await admin.from("waiver_claims").insert({
    league_id: leagueId,
    team_id: member.id,
    player_id: playerId,
    drop_player_id: dropPlayerId ?? null,
    priority: (member as any).waiver_priority ?? null,
    claim_order: nextOrder,
    status: "pending",
  });

  revalidatePath(`/league/${leagueId}/free-agency`);
  revalidatePath(`/league/${leagueId}/lineups`);
}

/** Reorder a member's own pending waiver claims. `orderedClaimIds` is the new
 *  priority order (first = attempted first). */
export async function reorderWaiverClaims(leagueId: number, orderedClaimIds: number[]): Promise<void> {
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

  // Only reorder this member's own pending claims.
  const { data: mine } = await admin
    .from("waiver_claims")
    .select("id")
    .eq("league_id", leagueId)
    .eq("team_id", member.id)
    .eq("status", "pending");
  const mineIds = new Set((mine ?? []).map((c) => (c as any).id as number));

  let order = 1;
  for (const id of orderedClaimIds) {
    if (!mineIds.has(id)) continue;
    await admin.from("waiver_claims").update({ claim_order: order }).eq("id", id);
    order++;
  }

  revalidatePath(`/league/${leagueId}/lineups`);
}

export async function cancelWaiverClaim(leagueId: number, claimId: number): Promise<void> {
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

  // A pending claim is cancelled by removing it. (Setting status:'cancelled'
  // violated the waiver_claims status CHECK constraint — pending/processed/
  // failed — so the update was rejected and the claim stayed pending.)
  await admin
    .from("waiver_claims")
    .delete()
    .eq("id", claimId)
    .eq("team_id", member.id)
    .eq("status", "pending");

  revalidatePath(`/league/${leagueId}/free-agency`);
}

// resetWaiverPriority and runWaiverProcessing now live in lib/waivers.ts — they
// must NOT be exported from this "use server" module, or they'd be callable as
// unauthenticated server-action endpoints against any league. Imported above
// for the guarded wrappers (setWaiversLocked, processWaivers) below.

// Commissioner-only: lock free agency so adds must go through waiver claims.
export async function setWaiversLocked(leagueId: number, locked: boolean): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) return;

  await admin.from("leagues").update({ waivers_locked: locked }).eq("id", leagueId);

  // Starting a waiver cycle resets priority per the league's configured mode.
  if (locked) {
    await resetWaiverPriority(leagueId);
  }

  revalidatePath(`/league/${leagueId}/free-agency`);
  revalidatePath(`/league/${leagueId}/settings`);
  revalidatePath(`/league/${leagueId}`);
}

/** Commissioner-only wrapper around runWaiverProcessing. */
export async function processWaivers(leagueId: number): Promise<void> {
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

  await runWaiverProcessing(leagueId);

  revalidatePath(`/league/${leagueId}/free-agency`);
  revalidatePath(`/league/${leagueId}/lineups`);
  revalidatePath(`/league/${leagueId}/settings`);
  revalidatePath(`/league/${leagueId}`);
}
