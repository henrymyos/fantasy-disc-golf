"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sendChatMessage, getLeagueSystemFeed, getVisibleChatMessages } from "@/actions/chat";
import type { SystemEvent, FeedAsset } from "@/lib/chat-feed";

type Member = {
  id: number;
  team_name: string;
  user_id: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
};
type Message = {
  id: number;
  body: string;
  created_at: string;
  sender_member_id: number;
  recipient_member_id: number | null;
};

type Channel = { kind: "league" } | { kind: "dm"; memberId: number };

type TimelineItem =
  | { key: string; ts: string; type: "msg"; message: Message }
  | { key: string; ts: string; type: "sys"; event: SystemEvent };

/**
 * Compact "how long ago" label for a message timestamp: "now", "8m", "2h",
 * then days ("4d", "21d") for anything a day or older. `now` is passed in so a
 * periodic re-render keeps it fresh.
 */
function formatRelativeTime(ts: string, now: number): string {
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.floor(Math.max(0, now - then) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

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
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState<number | null>(null);
  // Members are polled so team-name changes (and new joiners) show in the chat
  // without a full page reload. Seeded from the server-rendered prop.
  const [liveMembers, setLiveMembers] = useState<Member[]>(members);
  // On wide screens the chat lives as an always-open right sidebar; below that
  // it's the bottom dock. Starts false to match SSR, set on mount.
  const [isDesktop, setIsDesktop] = useState(false);
  // Ticks so relative timestamps ("8m", "2h") stay current without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const pathname = usePathname();
  // The chat is hidden on settings routes (rendered as null below). Track it
  // here so the body-scroll lock never engages while nothing is shown.
  const hideOnSettings = pathname.includes("/settings");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastKeyRef = useRef<string>("");
  const seenTsRef = useRef<string>("");
  // Pointer-drag bookkeeping (shared by the open-sheet and collapsed-bar gestures).
  const dragStartRef = useRef<{ y: number; moved: boolean } | null>(null);

  const memberById = useMemo(() => new Map(liveMembers.map((m) => [m.id, m])), [liveMembers]);
  const otherMembers = useMemo(
    () => liveMembers.filter((m) => m.id !== myMemberId),
    [liveMembers, myMemberId],
  );

  // Just the chat messages — fetched through a server action that filters to
  // league broadcasts + this member's own DMs, so other members' private DMs
  // never reach the browser (they used to be queried client-side and filtered
  // in JS). Re-run on every realtime INSERT so the DM filtering stays
  // server-side rather than trusting the realtime payload.
  const refreshMessages = useCallback(async () => {
    const msgs = await getVisibleChatMessages(leagueId).catch(() => [] as Message[]);
    setMessages(msgs as Message[]);
  }, [leagueId]);

  // The rarely-changing bits: the system feed (trades / roster moves) and the
  // member list (team-name edits, new joiners). Polled on a slow interval.
  const refreshFeed = useCallback(async () => {
    const supabase = createClient();
    const [events, { data: memberData }] = await Promise.all([
      getLeagueSystemFeed(leagueId).catch(() => [] as SystemEvent[]),
      supabase
        .from("league_members")
        .select("id, team_name, user_id, profiles(avatar_url, avatar_color)")
        .eq("league_id", leagueId)
        .order("joined_at"),
    ]);
    setSystemEvents(events);
    if (memberData && memberData.length > 0) {
      setLiveMembers(
        (memberData as any[]).map((m) => ({
          id: m.id,
          team_name: m.team_name,
          user_id: m.user_id ?? null,
          avatarUrl: m.profiles?.avatar_url ?? null,
          avatarColor: m.profiles?.avatar_color ?? null,
        })),
      );
    }
  }, [leagueId]);

  useEffect(() => {
    refreshMessages();
    refreshFeed();

    // New chat messages arrive over Supabase Realtime: any INSERT on this
    // league's chat_messages re-runs the server-filtered message fetch (we
    // never read other members' DMs straight off the realtime payload).
    const supabase = createClient();
    const channel = supabase
      .channel(`league_chat_${leagueId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `league_id=eq.${leagueId}` },
        () => {
          refreshMessages();
        },
      )
      .subscribe();

    // Fallback poll for messages in case Realtime isn't enabled for the table
    // (the subscription would then just receive nothing), plus a slower poll
    // for the system feed + member list which change rarely.
    const msgPoll = setInterval(refreshMessages, 15000);
    const feedPoll = setInterval(refreshFeed, 25000);

    return () => {
      clearInterval(msgPoll);
      clearInterval(feedPoll);
      supabase.removeChannel(channel);
    };
  }, [refreshMessages, refreshFeed, leagueId]);

  // Merge chat messages with system events (trades / roster moves) for the
  // league channel, ordered by time; DMs stay message-only.
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    if (channel.kind === "league") {
      for (const m of messages) {
        if (m.recipient_member_id == null) {
          items.push({ key: `m-${m.id}`, ts: m.created_at, type: "msg", message: m });
        }
      }
      for (const e of systemEvents) {
        items.push({ key: e.id, ts: e.ts, type: "sys", event: e });
      }
    } else {
      const other = channel.memberId;
      for (const m of messages) {
        if (
          m.recipient_member_id != null &&
          ((m.sender_member_id === myMemberId && m.recipient_member_id === other) ||
            (m.sender_member_id === other && m.recipient_member_id === myMemberId))
        ) {
          items.push({ key: `m-${m.id}`, ts: m.created_at, type: "msg", message: m });
        }
      }
    }
    items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return items;
  }, [messages, systemEvents, channel, myMemberId]);

  const latestItem = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const hasUnread = latestItem != null && latestItem.ts > seenTsRef.current && !open;

  // Track the desktop breakpoint (matches the xl:pr added to the league layout).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Lock the page behind the open sheet so touch-scrolling stays inside the
  // chat instead of scrolling the background. position:fixed is the reliable
  // way to do this on iOS Safari; the scroll position is restored on close.
  // Desktop's docked sidebar never locks the page.
  useEffect(() => {
    if (!open || hideOnSettings || isDesktop) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [open, hideOnSettings, isDesktop]);

  // Auto-scroll to the bottom when new activity arrives (sheet open, or always
  // on the desktop sidebar).
  useEffect(() => {
    if ((!open && !isDesktop) || timeline.length === 0) return;
    const lastKey = timeline[timeline.length - 1].key;
    if (lastKey !== lastKeyRef.current) {
      lastKeyRef.current = lastKey;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [timeline, open, isDesktop]);

  // Opening clears the unread marker and snaps the history to the bottom.
  const expand = useCallback(() => {
    setOpen(true);
    if (latestItem) seenTsRef.current = latestItem.ts;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [latestItem]);

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
      refreshMessages();
    });
  }

  const preview = previewFor(latestItem, memberById);

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
  if (hideOnSettings) return null;

  return (
    <>
      {/* Collapsed bar — previews the latest message (not on the desktop sidebar). */}
      {!open && !isDesktop && (
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
          className="fixed z-30 left-0 right-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:left-auto md:right-6 md:bottom-6 md:w-[360px] flex items-center gap-2.5 px-4 h-14 pt-1.5 bg-[#1a1d23] border-t border-white/10 md:border md:rounded-2xl md:shadow-2xl cursor-pointer select-none touch-none active:bg-[#1f232b] transition-colors after:content-[''] after:absolute after:top-full after:left-0 after:right-0 after:h-24 after:bg-[#1a1d23] md:after:hidden"
        >
          {/* Grab handle — signals the bar can be swiped up. */}
          <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full bg-white/25" />
          <div className="relative shrink-0 w-8 h-8 rounded-full bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-sm">
            💬
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#4B3DFF] ring-2 ring-[#1a1d23]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {preview ? (
              <p className="text-sm text-gray-200 truncate">
                {preview.sender && (
                  <span className="font-semibold text-white">{preview.sender}: </span>
                )}
                {preview.text}
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

      {/* Backdrop (mobile/tablet sheet only) */}
      {open && !isDesktop && (
        <div
          className="fixed inset-0 z-[45] bg-black/50 md:bg-black/30"
          onClick={collapse}
          aria-hidden
        />
      )}

      {/* Panel: a bottom sheet on mobile/tablet, a fixed full-height right
          sidebar on desktop (always open). */}
      <div
        ref={panelRef}
        className={
          isDesktop
            ? "fixed z-30 top-4 right-4 bottom-4 w-[360px] rounded-2xl overflow-hidden bg-[#1a1d23] border border-white/10 shadow-2xl flex flex-col"
            : "fixed z-[50] left-0 right-0 bottom-0 h-[82dvh] rounded-t-2xl md:left-auto md:right-6 md:bottom-6 md:w-[380px] md:h-[72vh] md:rounded-2xl bg-[#1a1d23] border border-white/10 shadow-2xl flex flex-col"
        }
        style={
          isDesktop
            ? undefined
            : {
                transform,
                transition: dragY != null ? "none" : "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
                pointerEvents: open ? "auto" : "none",
              }
        }
      >
        {/* Mobile only: grab handle + header (drag down / tap to collapse).
            Desktop has no header per the Sleeper-style look. */}
        {!isDesktop && (
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
        )}

        {/* Channel selector */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-white/5 overflow-x-auto no-scrollbar shrink-0">
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-0.5">
          {timeline.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">
              {channel.kind === "league"
                ? "No messages yet. Be the first to say something."
                : "No DMs yet — send a message to start the conversation."}
            </p>
          ) : (
            timeline.map((item, idx) => {
              if (item.type === "sys") {
                return <SystemMessage key={item.key} event={item.event} ts={item.ts} now={now} />;
              }
              const m = item.message;
              const sender = memberById.get(m.sender_member_id);
              const name = sender?.team_name ?? "Team";
              const time = formatRelativeTime(m.created_at, now);
              // Group consecutive messages from the same sender: drop the
              // avatar/name header and just show the text, indented.
              const prev = timeline[idx - 1];
              const grouped = prev?.type === "msg" && prev.message.sender_member_id === m.sender_member_id;
              if (grouped) {
                return (
                  <div key={item.key} className="flex gap-2.5">
                    <div className="w-8 shrink-0" />
                    <p className="min-w-0 flex-1 text-gray-200 text-sm leading-snug break-words whitespace-pre-wrap">
                      {m.body}
                    </p>
                  </div>
                );
              }
              return (
                <div key={item.key} className="flex items-start gap-2.5 pt-2">
                  <MemberAvatar member={sender} name={name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-white text-sm truncate">{name}</span>
                      <span
                        className="text-gray-500 text-[11px] shrink-0"
                        title={new Date(m.created_at).toLocaleString()}
                      >
                        {time}
                      </span>
                    </div>
                    <p className="text-gray-200 text-sm leading-snug break-words whitespace-pre-wrap">
                      {m.body}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer — Sleeper-style rounded pill with a send icon. */}
        <div className="border-t border-white/5 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div className="flex items-center gap-1.5 bg-[#0f1117] border border-white/10 rounded-full pl-3 pr-1.5 py-1 focus-within:border-[#4B3DFF] transition-colors">
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
                  ? "Enter message"
                  : `Message ${memberById.get(channel.memberId)?.team_name ?? ""}…`
              }
              className="flex-1 min-w-0 bg-transparent py-1.5 text-white text-sm placeholder-gray-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={send}
              disabled={pending || !body.trim()}
              aria-label="Send message"
              className="shrink-0 w-8 h-8 rounded-full bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white flex items-center justify-center transition disabled:opacity-40 disabled:hover:bg-[#4B3DFF]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** A chat author's avatar — their profile photo, or a colored initial. */
function MemberAvatar({ member, name }: { member?: Member; name: string }) {
  if (member?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt=""
        className="w-8 h-8 rounded-full object-cover shrink-0 bg-white/10"
      />
    );
  }
  return (
    <div
      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
      style={{ backgroundColor: member?.avatarColor ?? "#4B3DFF" }}
    >
      {name[0]?.toUpperCase()}
    </div>
  );
}

/** Collapsed-bar preview text for the most recent timeline item. */
function previewFor(
  item: TimelineItem | null,
  memberById: Map<number, Member>,
): { sender: string | null; text: string } | null {
  if (!item) return null;
  if (item.type === "msg") {
    return {
      sender: memberById.get(item.message.sender_member_id)?.team_name ?? "Team",
      text: item.message.body,
    };
  }
  const e = item.event;
  return {
    sender: null,
    text: e.kind === "trade" ? "A trade has been completed." : `${e.actor} made a roster move.`,
  };
}

/** Sleeper-style system message for a trade or roster move. */
function SystemMessage({ event, ts, now }: { event: SystemEvent; ts: string; now: number }) {
  const time = formatRelativeTime(ts, now);
  return (
    <div className="flex items-start gap-2.5 py-1">
      <div className="shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-300">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5l8-3z" opacity="0.9" />
          <path d="M12 7.5l1.2 2.4 2.6.4-1.9 1.8.45 2.6L12 13.9l-2.35 1.2.45-2.6-1.9-1.8 2.6-.4L12 7.5z" fill="#1a1d23" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-gray-400 mb-1" title={new Date(ts).toLocaleString()}>{time}</p>
        {event.kind === "trade" ? (
          <>
            <p className="text-sm text-gray-200 font-medium mb-1">A trade has been completed.</p>
            <div className="space-y-2.5">
              {event.teams.map((t, i) => (
                <div key={i} className="border-l-2 border-white/15 pl-3">
                  <p className="text-white text-sm font-semibold mb-1">{t.teamName}&rsquo;s Roster</p>
                  <AssetList gains={t.gains} losses={t.losses} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-200 font-medium mb-1">
              <span className="font-semibold text-white">{event.actor}</span> made a roster move.
            </p>
            <div className="border-l-2 border-white/15 pl-3">
              <AssetList gains={event.gains} losses={event.losses} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AssetList({ gains, losses }: { gains: FeedAsset[]; losses: FeedAsset[] }) {
  return (
    <div className="space-y-1">
      {gains.map((a, i) => (
        <AssetRow key={`g-${i}`} asset={a} sign="+" />
      ))}
      {losses.map((a, i) => (
        <AssetRow key={`l-${i}`} asset={a} sign="-" />
      ))}
    </div>
  );
}

function AssetRow({ asset, sign }: { asset: FeedAsset; sign: "+" | "-" }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`shrink-0 text-base font-black leading-none w-4 text-center ${
          sign === "+" ? "text-[#36D7B7]" : "text-[#f87171]"
        }`}
      >
        {sign === "+" ? "+" : "–"}
      </span>
      {asset.type === "player" ? (
        <div className="flex items-center gap-2 min-w-0">
          {asset.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.avatarUrl}
              alt=""
              className="shrink-0 w-7 h-7 rounded-full object-cover bg-white/10"
            />
          ) : (
            <div className="shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-bold text-gray-300">
              {asset.name[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0 leading-tight">
            <p className="text-white text-sm font-semibold truncate">{asset.name}</p>
            {asset.nickname && (
              <p className="text-gray-400 text-[11px] truncate">({asset.nickname})</p>
            )}
            {asset.division && <p className="text-gray-500 text-[11px]">{asset.division}</p>}
          </div>
        </div>
      ) : (
        <p className="text-white text-sm font-semibold truncate">{asset.label}</p>
      )}
    </div>
  );
}
