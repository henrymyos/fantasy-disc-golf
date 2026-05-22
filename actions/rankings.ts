"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, draft_position")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!member) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("id, current_pick, total_rounds, status")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "in_progress") return;

  const { data: members } = await admin
    .from("league_members")
    .select("id, draft_position")
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
  const currentTeam = members?.find((m: any) => m.draft_position === draftSlot);
  if (!currentTeam || currentTeam.id !== member.id) return;

  // Gather already-drafted player ids.
  const { data: drafted } = await admin
    .from("rosters")
    .select("player_id")
    .eq("league_id", leagueId);
  const draftedIds = new Set((drafted ?? []).map((r: any) => r.player_id));

  // Try user's ranking list first.
  const { data: rankings } = await admin
    .from("user_player_rankings")
    .select("player_id, rank")
    .eq("user_id", user.id)
    .eq("league_id", leagueId)
    .order("rank", { ascending: true });
  let pickedPlayerId: number | null = null;
  for (const r of rankings ?? []) {
    if (!draftedIds.has(r.player_id)) {
      pickedPlayerId = r.player_id;
      break;
    }
  }

  // Fall back to global best-available by overall_rank.
  if (pickedPlayerId == null) {
    const { data: players } = await admin
      .from("players")
      .select("id, overall_rank")
      .order("overall_rank", { ascending: true, nullsFirst: false })
      .limit(500);
    for (const p of players ?? []) {
      if (!draftedIds.has(p.id)) {
        pickedPlayerId = p.id;
        break;
      }
    }
  }
  if (pickedPlayerId == null) return;

  // Reuse the regular makeDraftPick by calling it directly through Supabase.
  // (Easier to just inline the same insert + advance logic.)
  await admin.from("rosters").insert({
    league_id: leagueId,
    team_id: member.id,
    player_id: pickedPlayerId,
    acquired_week: 1,
  });
  await admin.from("draft_picks").insert({
    draft_id: draft.id,
    pick_number: pick,
    round,
    team_id: member.id,
    player_id: pickedPlayerId,
  });

  const nextPick = pick + 1;
  const totalPicks = numTeams * draft.total_rounds;
  if (nextPick > totalPicks) {
    await admin.from("drafts").update({ status: "complete", current_pick: nextPick }).eq("id", draft.id);
    await admin.from("leagues").update({ draft_status: "complete" }).eq("id", leagueId);
  } else {
    await admin.from("drafts").update({ current_pick: nextPick }).eq("id", draft.id);
  }

  revalidatePath(`/league/${leagueId}/draft`);
  revalidatePath(`/league/${leagueId}/lineups`);
}
