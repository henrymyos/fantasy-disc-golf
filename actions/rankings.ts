"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { regenerateLeagueMatchups } from "@/actions/matchups";
import { resolvePickOwnerId, buildPickOwnerOverrides } from "@/lib/draft-pick-owners";

/** Replace a user's ranking list for this league with the given ordered ids. */
export async function setRankings(leagueId: number, playerIds: number[]): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  // Wipe & re-insert. Keeps things simple; ranking lists are small.
  await admin
    .from("user_player_rankings")
    .delete()
    .eq("user_id", user.id)
    .eq("league_id", leagueId);

  const rows = playerIds.map((pid, i) => ({
    user_id: user.id,
    league_id: leagueId,
    player_id: pid,
    rank: i + 1,
  }));
  if (rows.length > 0) {
    await admin.from("user_player_rankings").insert(rows);
  }
  revalidatePath(`/league/${leagueId}/rankings`);
  revalidatePath(`/league/${leagueId}/draft`);
}

/**
 * Auto-pick using the current user's rankings for the active draft pick. Falls
 * back to overall_rank when the user has no entry for a candidate. Only runs
 * when it's the calling user's turn.
 */
export async function autoPickFromRankings(leagueId: number): Promise<void> {
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

  const pickedPlayerId = await pickBestAvailableForTeam(admin, leagueId, member.id, user.id);
  if (pickedPlayerId == null) return;

  const { data: result } = await admin.rpc("claim_draft_pick", {
    p_league_id: leagueId,
    p_team_id: member.id,
    p_player_id: pickedPlayerId,
  });

  if ((result as any)?.complete) {
    await regenerateLeagueMatchups(leagueId);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
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
async function pickBestAvailableForTeam(
  admin: ReturnType<typeof createAdminClient>,
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

  // Candidate order: user's personal rankings first, then anything missing
  // from those rankings appended in overall_rank order.
  const candidateIds: number[] = [];
  const seen = new Set<number>();
  if (forUserId) {
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
 * Auto-pick when the current pick's timer has expired. Any signed-in league
 * member can call this — it validates that:
 *   - the draft is in_progress,
 *   - the elapsed time since current_pick_started_at exceeds seconds_per_pick.
 *
 * The on-clock team gets the highest-ranked available player from their
 * owner's rankings (falling back to overall_rank).
 */
export async function autoPickExpired(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: caller } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!caller) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("id, status, current_pick, seconds_per_pick, current_pick_started_at, third_round_reversal")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "in_progress") return;
  if (!draft.current_pick_started_at) return;

  const startedMs = Date.parse(draft.current_pick_started_at);
  const elapsedSec = (Date.now() - startedMs) / 1000;
  if (elapsedSec < (draft.seconds_per_pick ?? 60)) return;

  // Find the on-clock team to pick FOR (honoring any traded pick slots).
  const { data: members } = await admin
    .from("league_members")
    .select("id, user_id, draft_position")
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
  const onClock = (members as any[]).find((m) => m.id === onClockId);
  if (!onClock) return;

  const pickedPlayerId = await pickBestAvailableForTeam(
    admin,
    leagueId,
    onClock.id,
    onClock.user_id ?? null,
  );
  if (pickedPlayerId == null) return;

  const { data: result } = await admin.rpc("claim_draft_pick", {
    p_league_id: leagueId,
    p_team_id: onClock.id,
    p_player_id: pickedPlayerId,
  });

  if ((result as any)?.complete) {
    await regenerateLeagueMatchups(leagueId);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
}
