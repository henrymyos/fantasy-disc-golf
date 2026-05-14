"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { data: members } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .order("joined_at");

  if (!members || members.length < 2) return;

  const shuffled = [...members].sort(() => Math.random() - 0.5);
  await Promise.all(
    shuffled.map((m, i) =>
      admin.from("league_members").update({ draft_position: i + 1 }).eq("id", m.id)
    )
  );

  await admin
    .from("drafts")
    .update({ status: "in_progress", started_at: new Date().toISOString(), current_pick: 1 })
    .eq("league_id", leagueId);

  await admin.from("leagues").update({ draft_status: "in_progress" }).eq("id", leagueId);

  revalidatePath(`/league/${leagueId}/draft`);
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

  await admin.from("drafts").update({ status: "in_progress" }).eq("league_id", leagueId);
  revalidatePath(`/league/${leagueId}/draft`);
}

export async function makeDraftPick(leagueId: number, playerId: number): Promise<void> {
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
  const currentTeam = members?.find((m) => m.draft_position === draftSlot);

  if (!currentTeam || currentTeam.id !== member.id) return;

  const { data: alreadyPicked } = await admin
    .from("rosters")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .single();

  if (alreadyPicked) return;

  // Auto-fill starter slot in pick order. Earlier picks within a division fill
  // the starter slots first; once full, subsequent picks land on the bench.
  const { data: player } = await admin
    .from("players")
    .select("division")
    .eq("id", playerId)
    .single();

  const { data: leagueSlots } = await admin
    .from("leagues")
    .select("mpo_starters, fpo_starters")
    .eq("id", leagueId)
    .single();

  const slotLimit =
    player?.division === "MPO"
      ? (leagueSlots as any)?.mpo_starters ?? 4
      : (leagueSlots as any)?.fpo_starters ?? 2;

  const { data: divStarters } = await admin
    .from("rosters")
    .select("lineup_order, players!inner(division)")
    .eq("league_id", leagueId)
    .eq("team_id", member.id)
    .eq("is_starter", true)
    .eq("players.division", player?.division ?? "MPO");

  const takenOrders = new Set(
    (divStarters ?? []).map((r: any) => r.lineup_order).filter((o: number | null) => o != null),
  );

  let assignedOrder: number | null = null;
  for (let i = 1; i <= slotLimit; i++) {
    if (!takenOrders.has(i)) {
      assignedOrder = i;
      break;
    }
  }

  await admin.from("rosters").insert({
    league_id: leagueId,
    team_id: member.id,
    player_id: playerId,
    acquired_week: 1,
    is_starter: assignedOrder !== null,
    lineup_order: assignedOrder,
  });

  await admin.from("draft_picks").insert({
    draft_id: draft.id,
    pick_number: pick,
    round,
    team_id: member.id,
    player_id: playerId,
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
