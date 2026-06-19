"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
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

/**
 * Sleeper-style docked chat: a slim bar pinned to the bottom that previews the
 * most recent message. Tap (or drag up) to expand it into a full-height sheet
 * with channel tabs, scrollable history, and a composer; drag down, tap the
 * chevron, or tap the backdrop to collapse it again.
 */
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
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState<number | null>(null);
  const pathname = usePathname();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef<number>(0);
  const seenIdRef = useRef<number>(0);
  // Pointer-drag bookkeeping (shared by the open-sheet and collapsed-bar gestures).
  const dragStartRef = useRef<{ y: number; moved: boolean } | null>(null);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const otherMembers = useMemo(
    () => members.filter((m) => m.id !== myMemberId),
    [members, myMemberId],
  );

  const fetchMessages = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("chat_messages")
      .select("id, body, created_at, sender_member_id, recipient_member_id")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true })
      .limit(200);
    setMessages((data ?? []) as Message[]);
  }, [leagueId]);

  useEffect(() => {
    fetchMessages();
    const id = setInterval(fetchMessages, 4000);
    return () => clearInterval(id);
  }, [fetchMessages]);

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

  const latest = visible.length > 0 ? visible[visible.length - 1] : null;
  const hasUnread = latest != null && latest.id > seenIdRef.current && !open;

  // Auto-scroll to the bottom when new messages arrive while the sheet is open.
  useEffect(() => {
    if (!open || visible.length === 0) return;
    const newest = visible[visible.length - 1].id;
    if (newest !== lastIdRef.current) {
      lastIdRef.current = newest;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [visible, open]);

  // Opening clears the unread marker and snaps the history to the bottom.
  const expand = useCallback(() => {
    setOpen(true);
    if (latest) seenIdRef.current = latest.id;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [latest]);

  const collapse = useCallback(() => {
    setOpen(false);
    setDragY(null);
  }, []);

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

  // --- Drag-to-dismiss on the open sheet's grab handle ---
  function onSheetPointerDown(e: React.PointerEvent) {
    dragStartRef.current = { y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onSheetPointerMove(e: React.PointerEvent) {
    const start = dragStartRef.current;
    if (!start) return;
    const dy = Math.max(0, e.clientY - start.y);
    if (dy > 4) start.moved = true;
    setDragY(dy);
  }
  function onSheetPointerUp() {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const height = panelRef.current?.offsetHeight ?? 0;
    if (dragY != null && dragY > Math.max(80, height * 0.3)) {
      collapse();
    } else {
      setDragY(null);
    }
    // A tap (no real movement) on the handle also closes.
    if (start && !start.moved) collapse();
  }

  // --- Swipe-up / tap on the collapsed bar to expand ---
  // `barLift` nudges the bar up as the finger drags so the swipe feels live;
  // crossing the threshold (or a flick) opens the sheet.
  const [barLift, setBarLift] = useState(0);
  function onBarPointerDown(e: React.PointerEvent) {
    dragStartRef.current = { y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onBarPointerMove(e: React.PointerEvent) {
    const start = dragStartRef.current;
    if (!start) return;
    const up = start.y - e.clientY; // upward drag is positive
    if (Math.abs(up) > 4) start.moved = true;
    setBarLift(Math.max(0, up));
    if (up > 48) {
      dragStartRef.current = null;
      setBarLift(0);
      expand();
    }
  }
  function onBarPointerUp() {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const lift = barLift;
    setBarLift(0);
    if (!start) return;
    // A tap (no real movement) or a partial swipe-up both open it.
    if (!start.moved || lift > 12) expand();
  }
  function onBarPointerCancel() {
    dragStartRef.current = null;
    setBarLift(0);
  }

  const transform =
    dragY != null ? `translateY(${dragY}px)` : open ? "translateY(0)" : "translateY(110%)";

  const channelLabel =
    channel.kind === "league"
      ? "League Chat"
      : memberById.get(channel.memberId)?.team_name ?? "Direct Message";

  // The chat dock follows the user across league tabs, but settings (and its
  // sub-pages) are a focused admin context — keep it out of the way there.
  if (pathname.includes("/settings")) return null;

  return (
    <>
      {/* Collapsed bar — previews the latest message. */}
      {!open && (
        <div
          role="button"
          tabIndex={0}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerCancel={onBarPointerCancel}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              expand();
            }
          }}
          style={{
            transform: barLift ? `translateY(${-Math.min(barLift, 80)}px)` : undefined,
            transition: barLift ? "none" : "transform 200ms ease-out",
          }}
          className="fixed z-30 left-0 right-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:left-auto md:right-6 md:bottom-6 md:w-[360px] flex items-center gap-2.5 px-4 h-14 bg-[#1a1d23] border-t border-white/10 md:border md:rounded-2xl md:shadow-2xl cursor-pointer select-none touch-none active:bg-[#1f232b] transition-colors after:content-[''] after:absolute after:top-full after:left-0 after:right-0 after:h-24 after:bg-[#1a1d23] md:after:hidden"
        >
          <div className="relative shrink-0 w-8 h-8 rounded-full bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-sm">
            💬
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#4B3DFF] ring-2 ring-[#1a1d23]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {latest ? (
              <p className="text-sm text-gray-200 truncate">
                <span className="font-semibold text-white">
                  {memberById.get(latest.sender_member_id)?.team_name ?? "Team"}:
                </span>{" "}
                {latest.body}
              </p>
            ) : (
              <p className="text-sm text-gray-400 truncate">Tap to chat with your league</p>
            )}
          </div>
          <svg
            className="shrink-0 text-gray-400"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </div>
      )}

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[45] bg-black/50 md:bg-black/30"
          onClick={collapse}
          aria-hidden
        />
      )}

      {/* Expandable sheet */}
      <div
        ref={panelRef}
        className="fixed z-[50] left-0 right-0 bottom-0 h-[82dvh] rounded-t-2xl md:left-auto md:right-6 md:bottom-6 md:w-[380px] md:h-[72vh] md:rounded-2xl bg-[#1a1d23] border border-white/10 shadow-2xl flex flex-col"
        style={{
          transform,
          transition: dragY != null ? "none" : "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        {/* Grab handle + header (drag down / tap to collapse) */}
        <div
          onPointerDown={onSheetPointerDown}
          onPointerMove={onSheetPointerMove}
          onPointerUp={onSheetPointerUp}
          className="shrink-0 pt-2 cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <div className="mx-auto w-10 h-1.5 rounded-full bg-white/15" />
          <div className="flex items-center justify-between px-4 pt-2 pb-2.5">
            <h2 className="font-bold text-white text-sm">{channelLabel}</h2>
            <button
              type="button"
              onClick={collapse}
              aria-label="Collapse chat"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Channel selector */}
        <div className="flex items-center gap-1 px-3 pb-2 border-b border-white/5 overflow-x-auto no-scrollbar shrink-0">
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
                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-snug break-words ${
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
        <div className="border-t border-white/5 p-2 flex items-center gap-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
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
            className="flex-1 min-w-0 bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF]"
          />
          <button
            type="button"
            onClick={send}
            disabled={pending || !body.trim()}
            className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40 shrink-0"
          >
            {pending ? "..." : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}
