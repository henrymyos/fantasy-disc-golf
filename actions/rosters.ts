"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLineupLocked, isFreeAgencyLocked, getActiveTournament } from "@/lib/lineup-lock";

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
    .single();

  if (existing) return;

  // IR slots don't count toward the roster size cap.
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

  await admin.from("waiver_claims").insert({
    league_id: leagueId,
    team_id: member.id,
    player_id: playerId,
    drop_player_id: dropPlayerId ?? null,
    priority: (member as any).waiver_priority ?? null,
    status: "pending",
  });

  revalidatePath(`/league/${leagueId}/free-agency`);
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

  await admin
    .from("waiver_claims")
    .update({ status: "cancelled", processed_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("team_id", member.id)
    .eq("status", "pending");

  revalidatePath(`/league/${leagueId}/free-agency`);
}

export type WaiverOrderMode = "reverse_standings" | "reverse_last_add";

/**
 * Recomputes each team's waiver_priority for a new waiver cycle, using the
 * mode configured on the league:
 *   reverse_standings — worst record claims first (ties by lower total points)
 *   reverse_last_add  — team that hasn't added a player in longest gets first
 *                       pick (teams with no add history beat teams that just
 *                       added)
 */
export async function resetWaiverPriority(leagueId: number): Promise<void> {
  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("waiver_order_mode")
    .eq("id", leagueId)
    .single();
  const mode = (((league as any)?.waiver_order_mode ?? "reverse_standings") as WaiverOrderMode);

  const { data: members } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId);
  if (!members || members.length === 0) return;

  let ordered: { id: number }[] = [];

  if (mode === "reverse_standings") {
    const wins: Record<number, number> = {};
    const points: Record<number, number> = {};
    members.forEach((m) => { wins[m.id] = 0; points[m.id] = 0; });

    const { data: matchups } = await admin
      .from("matchups")
      .select("team1_id, team2_id, team1_score, team2_score, is_final")
      .eq("league_id", leagueId)
      .eq("is_final", true);

    (matchups ?? []).forEach((m: any) => {
      points[m.team1_id] = (points[m.team1_id] ?? 0) + Number(m.team1_score);
      points[m.team2_id] = (points[m.team2_id] ?? 0) + Number(m.team2_score);
      if (m.team1_score > m.team2_score) wins[m.team1_id] = (wins[m.team1_id] ?? 0) + 1;
      else if (m.team2_score > m.team1_score) wins[m.team2_id] = (wins[m.team2_id] ?? 0) + 1;
    });

    ordered = [...members].sort((a, b) => {
      const wDiff = (wins[a.id] ?? 0) - (wins[b.id] ?? 0);
      if (wDiff !== 0) return wDiff;
      return (points[a.id] ?? 0) - (points[b.id] ?? 0);
    });
  } else if (mode === "reverse_last_add") {
    const { data: adds } = await admin
      .from("roster_transactions")
      .select("team_id, created_at")
      .eq("league_id", leagueId)
      .eq("action", "add")
      .order("created_at", { ascending: false });

    const lastAdd = new Map<number, string>();
    (adds ?? []).forEach((row: any) => {
      if (!lastAdd.has(row.team_id)) lastAdd.set(row.team_id, row.created_at);
    });

    // Teams with no add history get earliest sort key so they go first.
    ordered = [...members].sort((a, b) => {
      const aTs = lastAdd.get(a.id) ?? "";
      const bTs = lastAdd.get(b.id) ?? "";
      if (aTs === bTs) return a.id - b.id;
      return aTs.localeCompare(bTs);
    });
  }

  for (let i = 0; i < ordered.length; i++) {
    await admin
      .from("league_members")
      .update({ waiver_priority: i + 1 })
      .eq("id", ordered[i].id);
  }
}

/** Back-compat alias for the previous export name. */
export const resetWaiverPriorityToReverseStandings = resetWaiverPriority;

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

/** Core waiver-processing routine, shared between the commissioner action and
 *  the scheduled cron. Uses the admin client; no auth checks. */
export async function runWaiverProcessing(leagueId: number): Promise<void> {
  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("roster_size, current_week")
    .eq("id", leagueId)
    .single();
  if (!league) return;

  const { data: claims } = await admin
    .from("waiver_claims")
    .select("id, team_id, player_id, drop_player_id, submitted_at, league_members!inner(waiver_priority)")
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (!claims || claims.length === 0) return;

  // Group claims by team, sorted by team waiver priority, then by submission.
  const byTeam = new Map<number, any[]>();
  for (const c of claims) {
    const list = byTeam.get(c.team_id) ?? [];
    list.push(c);
    byTeam.set(c.team_id, list);
  }
  const teamsByPriority = [...byTeam.keys()].sort((a, b) => {
    const aP = (byTeam.get(a)![0] as any).league_members?.waiver_priority ?? 9999;
    const bP = (byTeam.get(b)![0] as any).league_members?.waiver_priority ?? 9999;
    return aP - bP;
  });

  const grantedTeams: number[] = [];

  for (const teamId of teamsByPriority) {
    const teamClaims = byTeam.get(teamId)!;
    let granted = false;
    for (const claim of teamClaims) {
      if (granted) {
        await admin
          .from("waiver_claims")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", claim.id);
        continue;
      }

      // Player must still be unrostered.
      const { data: stillFA } = await admin
        .from("rosters")
        .select("id")
        .eq("league_id", leagueId)
        .eq("player_id", claim.player_id)
        .maybeSingle();
      if (stillFA) {
        await admin
          .from("waiver_claims")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", claim.id);
        continue;
      }

      const { count } = await admin
        .from("rosters")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .eq("team_id", teamId);
      const rosterCount = count ?? 0;
      const needsDrop = rosterCount >= (league as any).roster_size;

      if (needsDrop && !claim.drop_player_id) {
        await admin
          .from("waiver_claims")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", claim.id);
        continue;
      }

      if (claim.drop_player_id) {
        await admin
          .from("rosters")
          .delete()
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", claim.drop_player_id);
      }

      await admin.from("rosters").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: claim.player_id,
        acquired_week: (league as any).current_week,
      });

      await admin.from("roster_transactions").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: claim.player_id,
        action: "add",
        dropped_player_id: claim.drop_player_id ?? null,
      });

      await admin
        .from("waiver_claims")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", claim.id);

      granted = true;
      grantedTeams.push(teamId);
    }
  }

  // Push every team that won a claim to the back of the waiver queue.
  if (grantedTeams.length > 0) {
    const { data: allMembers } = await admin
      .from("league_members")
      .select("id, waiver_priority")
      .eq("league_id", leagueId);
    const ordered = [...(allMembers ?? [])].sort(
      (a, b) => ((a as any).waiver_priority ?? 9999) - ((b as any).waiver_priority ?? 9999),
    );
    const grantedSet = new Set(grantedTeams);
    const losers = ordered.filter((m) => !grantedSet.has(m.id));
    const winners = ordered.filter((m) => grantedSet.has(m.id));
    const reordered = [...losers, ...winners];
    for (let i = 0; i < reordered.length; i++) {
      await admin
        .from("league_members")
        .update({ waiver_priority: i + 1 })
        .eq("id", reordered[i].id);
    }
  }

  // Auto-unlock waivers so free agency reopens.
  await admin.from("leagues").update({ waivers_locked: false }).eq("id", leagueId);
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
