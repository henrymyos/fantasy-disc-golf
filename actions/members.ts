"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

/** True once the draft has started or finished — removal is blocked then, since
 *  it would orphan matchups/picks (the DB's FK constraints enforce this too). */
async function draftLocked(admin: AdminClient, leagueId: number): Promise<boolean> {
  const { data: draft } = await admin
    .from("drafts")
    .select("status")
    .eq("league_id", leagueId)
    .maybeSingle();
  const status = (draft as any)?.status;
  return status === "in_progress" || status === "paused" || status === "complete";
}

/** Re-number the remaining members' draft positions to a contiguous 1..N so a
 *  removed slot doesn't leave a gap that breaks snake order. */
async function resequenceDraftPositions(admin: AdminClient, leagueId: number) {
  const { data: members } = await admin
    .from("league_members")
    .select("id, draft_position")
    .eq("league_id", leagueId)
    .not("draft_position", "is", null)
    .order("draft_position", { ascending: true });
  let pos = 1;
  for (const m of members ?? []) {
    await admin.from("league_members").update({ draft_position: pos }).eq("id", (m as any).id);
    pos++;
  }
}

/** Commissioner-only: hand the commissioner role to another member. */
export async function transferCommissioner(leagueId: number, newMemberId: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || (league as any).commissioner_id !== user.id) return { error: "Only the commissioner can do that." };

  const { data: target } = await admin
    .from("league_members")
    .select("id, user_id")
    .eq("id", newMemberId)
    .eq("league_id", leagueId)
    .single();
  if (!target || !(target as any).user_id) return { error: "That team has no owner to hand off to." };

  await admin.from("leagues").update({ commissioner_id: (target as any).user_id }).eq("id", leagueId);
  // Keep the per-member flag in sync.
  await admin.from("league_members").update({ is_commissioner: false }).eq("league_id", leagueId);
  await admin.from("league_members").update({ is_commissioner: true }).eq("id", newMemberId);

  revalidatePath(`/league/${leagueId}/settings/members`);
  revalidatePath(`/league/${leagueId}`);
  return {};
}

/** Commissioner-only: remove another member (pre-draft only). */
export async function removeMember(leagueId: number, memberId: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || (league as any).commissioner_id !== user.id) return { error: "Only the commissioner can remove members." };

  const { data: target } = await admin
    .from("league_members")
    .select("id, user_id")
    .eq("id", memberId)
    .eq("league_id", leagueId)
    .single();
  if (!target) return { error: "Member not found." };
  if ((target as any).user_id === user.id) return { error: "You can't remove yourself. Transfer the commissioner role first." };

  if (await draftLocked(admin, leagueId)) {
    return { error: "Members can't be removed once the draft has started. Removal is only available before the draft." };
  }

  const { error } = await admin.from("league_members").delete().eq("id", memberId);
  if (error) return { error: "Couldn't remove that member while they still have league history." };

  await resequenceDraftPositions(admin, leagueId);
  revalidatePath(`/league/${leagueId}/settings/members`);
  revalidatePath(`/league/${leagueId}`);
  return {};
}

/** A member removes themselves (pre-draft, non-commissioner). */
export async function leaveLeague(leagueId: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league) return { error: "League not found." };
  if ((league as any).commissioner_id === user.id) {
    return { error: "As commissioner, transfer the role to someone else first, then you can leave." };
  }

  const { data: me } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!me) return { error: "You're not in this league." };

  if (await draftLocked(admin, leagueId)) {
    return { error: "You can't leave once the draft has started." };
  }

  const { error } = await admin.from("league_members").delete().eq("id", (me as any).id);
  if (error) return { error: "Couldn't leave while you still have league history." };

  await resequenceDraftPositions(admin, leagueId);
  redirect("/dashboard");
}
