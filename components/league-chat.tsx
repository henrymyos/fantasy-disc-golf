"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendChatMessage } from "@/actions/chat";

type Member = { id: number; team_name: string; user_id: string | null };
type Message = {
  id: number;
  body: string;
  created_at: string;
  sender_member_id: number;
  recipient_member_id: number | null;
};

type Channel = { kind: "league" } | { kind: "dm"; memberId: number };

export function LeagueChat({
  leagueId,
  myMemberId,
  members,
}: {
  leagueId: number;
  myMemberId: number;
  members: Member[];
}) {
  const [channel, setChannel] = useState<Channel>({ kind: "league" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef<number>(0);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const otherMembers = useMemo(
    () => members.filter((m) => m.id !== myMemberId),
    [members, myMemberId],
  );

  async function fetchMessages() {
    const supabase = createClient();
    const { data } = await supabase
      .from("chat_messages")
      .select("id, body, created_at, sender_member_id, recipient_member_id")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true })
      .limit(200);
    setMessages((data ?? []) as Message[]);
  }

  useEffect(() => {
    fetchMessages();
    const id = setInterval(fetchMessages, 4000);
    return () => clearInterval(id);
  }, [leagueId]);

  // Filter to the current channel.
  const visible = useMemo(() => {
    if (channel.kind === "league") {
      return messages.filter((m) => m.recipient_member_id == null);
    }
    const other = channel.memberId;
    return messages.filter(
      (m) =>
        m.recipient_member_id != null &&
        ((m.sender_member_id === myMemberId && m.recipient_member_id === other) ||
          (m.sender_member_id === other && m.recipient_member_id === myMemberId)),
    );
  }, [messages, channel, myMemberId]);

  // Auto-scroll to bottom when new messages arrive in the active channel.
  useEffect(() => {
    if (visible.length === 0) return;
    const latest = visible[visible.length - 1].id;
    if (latest !== lastIdRef.current) {
      lastIdRef.current = latest;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [visible]);

  function send() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const recipient = channel.kind === "dm" ? channel.memberId : null;
      await sendChatMessage(leagueId, text, recipient);
      setBody("");
      fetchMessages();
    });
  }

  return (
    <div className="bg-[#1a1d23] rounded-2xl border border-white/5 flex flex-col" style={{ height: 360 }}>
      {/* Channel selector */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-white/5 overflow-x-auto">
        <button
          type="button"
          onClick={() => setChannel({ kind: "league" })}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition shrink-0 ${
            channel.kind === "league"
              ? "bg-[#4B3DFF] text-white"
              : "text-gray-400 hover:text-white bg-white/5"
          }`}
        >
          League
        </button>
        {otherMembers.map((m) => {
          const isActive = channel.kind === "dm" && channel.memberId === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setChannel({ kind: "dm", memberId: m.id })}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition shrink-0 ${
                isActive
                  ? "bg-[#4B3DFF] text-white"
                  : "text-gray-400 hover:text-white bg-white/5"
              }`}
            >
              {m.team_name}
            </button>
          );
        })}
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {visible.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            {channel.kind === "league"
              ? "No messages yet. Be the first to say something."
              : "No DMs yet — send a message to start the conversation."}
          </p>
        ) : (
          visible.map((m) => {
            const isMine = m.sender_member_id === myMemberId;
            const sender = memberById.get(m.sender_member_id);
            return (
              <div
                key={m.id}
                className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
              >
                <span className="text-[10px] text-gray-400 mb-0.5">
                  {sender?.team_name ?? "Team"} ·{" "}
                  {new Date(m.created_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-snug ${
                    isMine
                      ? "bg-[#4B3DFF]/80 text-white rounded-br-md"
                      : "bg-[#0f1117] text-gray-200 border border-white/5 rounded-bl-md"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-white/5 p-2 flex items-center gap-2">
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            channel.kind === "league"
              ? "Message the league..."
              : `DM ${memberById.get(channel.memberId)?.team_name ?? ""}…`
          }
          className="flex-1 bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF]"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !body.trim()}
          className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
        >
          {pending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
