"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeDraftCompletion } from "@/lib/draft-postpone";
import { pickBestAvailableForTeam, runExpiredSnakePick } from "@/lib/draft-timer";

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
    await finalizeDraftCompletion(admin, leagueId);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
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

  // The shared core re-validates the draft state + expiry and does the actual
  // auto-pick (also used by the unattended /api/draft-cron backstop).
  const picked = await runExpiredSnakePick(admin, leagueId);
  if (!picked) return;

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
}
