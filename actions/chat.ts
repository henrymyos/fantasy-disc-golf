"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildLeagueSystemFeed, type SystemEvent } from "@/lib/chat-feed";

/** Post a chat message in this league. recipientMemberId === null is a
 *  league-wide broadcast; otherwise it's a 1:1 DM. */
export async function sendChatMessage(
  leagueId: number,
  body: string,
  recipientMemberId: number | null,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const trimmed = (body ?? "").trim().slice(0, 2000);
  if (trimmed.length === 0) return;

  const admin = createAdminClient();
  const { data: sender } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!sender) return;

  if (recipientMemberId != null) {
    // Recipient must be in the same league.
    const { data: rcpt } = await admin
      .from("league_members")
      .select("id")
      .eq("id", recipientMemberId)
      .eq("league_id", leagueId)
      .maybeSingle();
    if (!rcpt) return;
  }

  await admin.from("chat_messages").insert({
    league_id: leagueId,
    sender_member_id: sender.id,
    recipient_member_id: recipientMemberId,
    body: trimmed,
  });

  revalidatePath(`/league/${leagueId}`);
}

/** Trade + roster-move events for the league chat's system messages. Only
 *  league members can read them (RLS on the underlying tables). */
export async function getLeagueSystemFeed(leagueId: number): Promise<SystemEvent[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  return buildLeagueSystemFeed(supabase, leagueId);
}
