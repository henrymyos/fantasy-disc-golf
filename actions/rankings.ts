"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { regenerateLeagueMatchups } from "@/actions/matchups";

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

  const pickedPlayerId = await pickBestAvailableForUser(admin, leagueId, user.id);
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
 * Best available player for `forUserId`: walks their personal ranking list
 * first, then falls back to global overall_rank. Returns null if every player
 * we considered is already drafted in this league.
 */
async function pickBestAvailableForUser(
  admin: ReturnType<typeof createAdminClient>,
  leagueId: number,
  forUserId: string | null,
): Promise<number | null> {
  const { data: drafted } = await admin
    .from("rosters")
    .select("player_id")
    .eq("league_id", leagueId);
  const draftedIds = new Set((drafted ?? []).map((r: any) => r.player_id));

  if (forUserId) {
    const { data: rankings } = await admin
      .from("user_player_rankings")
      .select("player_id, rank")
      .eq("user_id", forUserId)
      .eq("league_id", leagueId)
      .order("rank", { ascending: true });
    for (const r of rankings ?? []) {
      if (!draftedIds.has(r.player_id)) return r.player_id;
    }
  }

  const { data: players } = await admin
    .from("players")
    .select("id, overall_rank")
    .order("overall_rank", { ascending: true, nullsFirst: false })
    .limit(500);
  for (const p of players ?? []) {
    if (!draftedIds.has(p.id)) return p.id;
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
    .select("status, current_pick, seconds_per_pick, current_pick_started_at")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "in_progress") return;
  if (!draft.current_pick_started_at) return;

  const startedMs = Date.parse(draft.current_pick_started_at);
  const elapsedSec = (Date.now() - startedMs) / 1000;
  if (elapsedSec < (draft.seconds_per_pick ?? 90)) return;

  // Find the on-clock team to pick FOR.
  const { data: members } = await admin
    .from("league_members")
    .select("id, user_id, draft_position")
    .eq("league_id", leagueId)
    .not("draft_position", "is", null)
    .order("draft_position");
  const numTeams = members?.length ?? 0;
  if (numTeams === 0) return;

  const pick = draft.current_pick;
  const round = Math.ceil(pick / numTeams);
  const positionInRound = pick - (round - 1) * numTeams;
  const isReversed = round % 2 === 0;
  const draftSlot = isReversed ? numTeams - positionInRound + 1 : positionInRound;
  const onClock = members?.find((m: any) => m.draft_position === draftSlot);
  if (!onClock) return;

  const pickedPlayerId = await pickBestAvailableForUser(
    admin,
    leagueId,
    (onClock as any).user_id ?? null,
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
