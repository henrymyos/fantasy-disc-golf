"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import { buildLeagueSystemFeed, type SystemEvent } from "@/lib/chat-feed";
import { CHAT_REACTION_EMOJIS } from "@/lib/chat-reactions";

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
    .select("id, team_name")
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

  const { data: inserted } = await admin
    .from("chat_messages")
    .insert({
      league_id: leagueId,
      sender_member_id: sender.id,
      recipient_member_id: recipientMemberId,
      body: trimmed,
    })
    .select("id")
    .single();

  // Push the message: a DM goes to the recipient only; a league message goes to
  // every other member. Best-effort — never block sending on push.
  try {
    let recipientUserIds: string[] = [];
    if (recipientMemberId != null) {
      const { data: r } = await admin
        .from("league_members")
        .select("user_id")
        .eq("id", recipientMemberId)
        .single();
      if ((r as any)?.user_id) recipientUserIds = [(r as any).user_id];
    } else {
      const { data: mems } = await admin
        .from("league_members")
        .select("user_id")
        .eq("league_id", leagueId)
        .neq("id", sender.id);
      recipientUserIds = (mems ?? [])
        .map((m: any) => m.user_id)
        .filter((uid: string | null): uid is string => !!uid);
    }
    const senderName = (sender as any).team_name ?? "New message";
    const tag = `chat-${leagueId}-${(inserted as any)?.id ?? "x"}`;
    await Promise.all(
      Array.from(new Set(recipientUserIds)).map((uid) =>
        sendPushToUser(admin, uid, {
          title: recipientMemberId != null ? `${senderName} · DM` : senderName,
          body: trimmed,
          url: `/league/${leagueId}`,
          tag,
        }),
      ),
    );
  } catch (e) {
    console.warn("chat push failed", e);
  }

  revalidatePath(`/league/${leagueId}`);
}

export type ChatMessage = {
  id: number;
  body: string;
  created_at: string;
  sender_member_id: number;
  recipient_member_id: number | null;
};

/** Messages the current user is allowed to see in this league: every league
 *  broadcast plus only the DMs they personally sent or received. Filtered
 *  server-side (by the viewer's own member id) so other members' private DMs
 *  never reach the client — the previous client-side fetch shipped every DM in
 *  the league to every browser. Returns the most recent 200, oldest-first. */
export async function getVisibleChatMessages(leagueId: number): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return [];

  const { data } = await admin
    .from("chat_messages")
    .select("id, body, created_at, sender_member_id, recipient_member_id")
    .eq("league_id", leagueId)
    .or(
      `recipient_member_id.is.null,sender_member_id.eq.${member.id},recipient_member_id.eq.${member.id}`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return ((data ?? []) as ChatMessage[]).reverse();
}

export type ChatReaction = {
  message_id: number;
  member_id: number;
  emoji: string;
};

/** Toggle the caller's emoji reaction on a chat message they can see. */
export async function toggleChatReaction(
  leagueId: number,
  messageId: number,
  emoji: string,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(CHAT_REACTION_EMOJIS as readonly string[]).includes(emoji)) return { ok: false };

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { ok: false };

  // The message must be in this league and visible to the caller (a league
  // broadcast, or a DM they're a party to).
  const { data: msg } = await admin
    .from("chat_messages")
    .select("id, sender_member_id, recipient_member_id")
    .eq("id", messageId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!msg) return { ok: false };
  const visible =
    (msg as any).recipient_member_id == null ||
    (msg as any).sender_member_id === member.id ||
    (msg as any).recipient_member_id === member.id;
  if (!visible) return { ok: false };

  try {
    const { data: existing, error: selErr } = await admin
      .from("chat_reactions")
      .select("id")
      .eq("message_id", messageId)
      .eq("member_id", member.id)
      .eq("emoji", emoji)
      .maybeSingle();
    if (selErr) return { ok: false };
    if (existing) {
      await admin.from("chat_reactions").delete().eq("id", (existing as any).id);
    } else {
      const { error } = await admin.from("chat_reactions").insert({
        league_id: leagueId,
        message_id: messageId,
        member_id: member.id,
        emoji,
      });
      if (error) return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** All reactions on this league's messages that the caller can see. */
export async function getChatReactions(leagueId: number): Promise<ChatReaction[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return [];

  try {
    // Same visibility filter as getVisibleChatMessages, applied through the
    // reaction's message join so DM reactions stay between the two parties.
    const { data, error } = await admin
      .from("chat_reactions")
      .select("message_id, member_id, emoji, chat_messages!inner(sender_member_id, recipient_member_id)")
      .eq("league_id", leagueId)
      .or(
        `recipient_member_id.is.null,sender_member_id.eq.${member.id},recipient_member_id.eq.${member.id}`,
        { referencedTable: "chat_messages" },
      )
      .limit(2000);
    if (error) return [];
    return ((data ?? []) as any[]).map((r) => ({
      message_id: r.message_id as number,
      member_id: r.member_id as number,
      emoji: r.emoji as string,
    }));
  } catch {
    return [];
  }
}

/** Trade + roster-move events for the league chat's system messages. Only
 *  league members can read them. The membership check below is the gate (it
 *  mirrors getVisibleChatMessages / sendChatMessage); RLS on the underlying
 *  tables is just a backstop. */
export async function getLeagueSystemFeed(leagueId: number): Promise<SystemEvent[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return [];

  // Membership is verified above, so read the feed with the admin client — the
  // derivations touch tables (matchups, waiver_claims, drafts) whose RLS may not
  // grant plain member reads. Every query is league-scoped.
  return buildLeagueSystemFeed(admin, leagueId);
}
