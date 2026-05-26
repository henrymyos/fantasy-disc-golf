"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { regenerateLeagueMatchups } from "@/actions/matchups";

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
    .select("status")
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
