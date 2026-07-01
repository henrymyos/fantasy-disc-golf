"use client";

import { useState, useEffect, useMemo, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startDraft, pauseDraft, resumeDraft, makeDraftPick, undoLastPick, undoPick, replacePick, commissionerMakePick } from "@/actions/drafts";
import { autoPickFromRankings, autoPickExpired } from "@/actions/rankings";
import { resolvePickOwnerId, type PickOwnerOverrides } from "@/lib/draft-pick-owners";

type DraftInfo = {
  id: number;
  status: string;
  type?: string;
  currentPick: number;
  totalRounds: number;
  secondsPerPick?: number;
  currentPickStartedAt?: string | null;
  thirdRoundReversal?: boolean;
};
type Member = { id: number; teamName: string; draftPosition: number };
type PickInfo = { pickNumber: number; teamId: number; playerId: number | null; playerName: string; playerDivision: string };
type AvailablePlayer = { id: number; name: string; division: string; worldRanking: number | null; overallRank: number | null; pdgaRating?: number | null; totalPoints?: number };
type Tab = "all" | "mpo" | "fpo";
type BottomTab = "available" | "team";
type PanelSize = "small" | "medium" | "large" | "full";

// "full" mode hides the board grid and lets the panel take the remaining
// flex height — the numeric value here isn't used for that case.
const PANEL_HEIGHTS: Record<PanelSize, number> = { small: 140, medium: 240, large: 460, full: 0 };
const PANEL_ORDER: PanelSize[] = ["small", "medium", "large", "full"];

type MyRanking = { playerId: number; rank: number };
type SortMode = "mine" | "default";

type Props = {
  leagueId: number;
  draft: DraftInfo | null;
  members: Member[];
  pickOwnerOverrides?: { overallPick: number; ownerTeamId: number }[];
  picks: PickInfo[];
  availablePlayers: AvailablePlayer[];
  myRankings?: MyRanking[];
  myMemberId: number | null;
  isCommissioner: boolean;
  mpoSlots?: number;
  fpoSlots?: number;
  rosterSize?: number;
  readOnly?: boolean;
};

function isRoundReversed(round: number, thirdRoundReversal: boolean): boolean {
  let reversed = round % 2 === 0;
  // 3RR keeps R1/R2 normal, then inverts the snake direction from R3 onwards
  // (R3 reverse, R4 forward, R5 reverse, R6 forward, …).
  if (thirdRoundReversal && round >= 3) reversed = !reversed;
  return reversed;
}

function getPickNumber(
  round: number,
  draftPosition: number,
  numTeams: number,
  thirdRoundReversal = false,
): number {
  const reversed = isRoundReversed(round, thirdRoundReversal);
  return (round - 1) * numTeams + (reversed ? numTeams - draftPosition + 1 : draftPosition);
}

function divColor(division: string) {
  return division === "MPO" ? "text-[#4B3DFF]" : "text-[#36D7B7]";
}

function divBg(division: string): string {
  return division === "MPO" ? "var(--mpo-fill)" : "var(--fpo-fill)";
}

function DraftLineupRow({
  leagueId,
  division,
  slotIndex,
  pick,
  bench = false,
}: {
  leagueId: number;
  division: "MPO" | "FPO";
  slotIndex?: number;
  pick: PickInfo | null;
  bench?: boolean;
}) {
  const color = division === "MPO" ? "#4B3DFF" : "#36D7B7";
  const bgFilled = division === "MPO" ? "rgba(75,61,255,0.12)" : "rgba(54,215,183,0.10)";
  const borderFilled = division === "MPO" ? "rgba(75,61,255,0.19)" : "rgba(54,215,183,0.16)";
  const filled = pick !== null;
  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-xl border"
      style={{
        background: bench ? "rgba(15,17,23,1)" : filled ? bgFilled : "rgba(255,255,255,0.02)",
        borderColor: bench ? "rgba(255,255,255,0.05)" : filled ? borderFilled : "rgba(255,255,255,0.06)",
      }}
    >
      <span
        className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg"
        style={{ color, background: `${color}20` }}
      >
        {division}
      </span>
      {pick ? (
        pick.playerId != null ? (
          <Link
            href={`/league/${leagueId}/player/${pick.playerId}`}
            className="flex-1 text-white text-sm font-medium truncate hover:underline min-w-0"
            title={`View ${pick.playerName}'s profile`}
          >
            {pick.playerName}
          </Link>
        ) : (
          <span className="flex-1 text-white text-sm font-medium truncate">{pick.playerName}</span>
        )
      ) : (
        <span className="flex-1 text-gray-400 text-sm italic">Empty</span>
      )}
      <span className="text-gray-400 text-xs font-mono shrink-0">
        {pick ? `#${pick.pickNumber}` : slotIndex ? `Slot ${slotIndex}` : ""}
      </span>
    </div>
  );
}

function DraftBenchEmptyRow() {
  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-xl border border-dashed"
      style={{ background: "rgba(15,17,23,0.5)", borderColor: "rgba(255,255,255,0.08)" }}
    >
      <span className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg text-gray-400 bg-white/5">
        —
      </span>
      <span className="flex-1 text-gray-400 text-sm italic">Empty bench</span>
    </div>
  );
}

function PickCountdown({
  leagueId,
  secondsPerPick,
  startedAt,
  pickNumber,
}: {
  leagueId: number;
  secondsPerPick: number;
  startedAt: string | null;
  pickNumber: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef<number | null>(null);

  useEffect(() => {
    firedRef.current = null;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pickNumber, startedAt]);

  if (!startedAt) return null;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return null;
  const remaining = Math.max(0, secondsPerPick - Math.floor((now - startedMs) / 1000));

  // Auto-fire the expire action once per pick when the timer hits zero.
  if (remaining === 0 && firedRef.current !== pickNumber) {
    firedRef.current = pickNumber;
    void autoPickExpired(leagueId);
  }

  // Compact countdown that scales: mm:ss under an hour, "2h 15m" under a day,
  // "3d 5h" for multi-day async drafts.
  const display = (() => {
    if (remaining < 3600) {
      const mm = Math.floor(remaining / 60);
      const ss = remaining % 60;
      return `${mm}:${ss.toString().padStart(2, "0")}`;
    }
    if (remaining < 86400) {
      const hh = Math.floor(remaining / 3600);
      const mm = Math.floor((remaining % 3600) / 60);
      return `${hh}h ${mm}m`;
    }
    const dd = Math.floor(remaining / 86400);
    const hh = Math.floor((remaining % 86400) / 3600);
    return `${dd}d ${hh}h`;
  })();
  const tone =
    remaining <= 10 ? "text-red-400" : remaining <= 30 ? "text-yellow-300" : "text-gray-400";
  return (
    <span className={`text-xs font-mono ${tone}`} title="Time remaining on this pick">
      {display}
    </span>
  );
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(" ");
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

// A drafted-pick cell the commissioner can act on: normal tap/click opens the
// player profile, while right-click (desktop) or long-press (touch) surfaces
// the change/undo menu via onMenu. Rendered as a plain div so the long-press
// gesture can suppress the follow-up click without fighting <Link>.
function ManagedPickCell({
  href,
  style,
  className,
  onMenu,
  children,
}: {
  href: string | null;
  style: React.CSSProperties;
  className: string;
  onMenu: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const suppressRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <div
      style={style}
      className={`${className} select-none`}
      title="Tap to view · long-press or right-click for options"
      onClick={() => {
        if (suppressRef.current) {
          suppressRef.current = false;
          return;
        }
        if (href) router.push(href);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        startRef.current = { x: t.clientX, y: t.clientY };
        clearTimer();
        timerRef.current = window.setTimeout(() => {
          suppressRef.current = true;
          if (startRef.current) onMenu(startRef.current.x, startRef.current.y);
        }, 450);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (
          startRef.current &&
          (Math.abs(t.clientX - startRef.current.x) > 8 ||
            Math.abs(t.clientY - startRef.current.y) > 8)
        ) {
          clearTimer();
        }
      }}
      onTouchEnd={clearTimer}
      onTouchCancel={clearTimer}
    >
      {children}
    </div>
  );
}

export function DraftBoard({ leagueId, draft, members, pickOwnerOverrides = [], picks, availablePlayers, myRankings = [], myMemberId, isCommissioner, mpoSlots = 4, fpoSlots = 2, rosterSize = 14, readOnly }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [bottomTab, setBottomTab] = useState<BottomTab>("available");
  const [search, setSearch] = useState("");
  const [panelSize, setPanelSize] = useState<PanelSize>("medium");
  // Full-screen board: covers the sidebar/nav so the grid gets the whole
  // viewport. Defaults on when you land on a live draft; a top exit arrow
  // (and the Full screen button) toggle it.
  const [fullscreen, setFullscreen] = useState<boolean>(
    () => !readOnly && (draft?.status === "in_progress" || draft?.status === "paused"),
  );
  // Settings (gear) menu, the per-card change/undo context menu, and the
  // player picker used to assign the on-clock slot or swap an existing pick.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [cardMenu, setCardMenu] = useState<
    { pickNumber: number; label: string; playerName: string; x: number; y: number } | null
  >(null);
  const [picker, setPicker] = useState<
    { mode: "assign" } | { mode: "change"; pickNumber: number; currentName: string } | null
  >(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerTab, setPickerTab] = useState<Tab>("all");
  const hasMyRankings = myRankings.length > 0;
  // Default to the user's own rankings when they've set any; otherwise the
  // generic points/overall ordering. The user can flip between the two from
  // the panel header.
  const [sortMode, setSortMode] = useState<SortMode>(hasMyRankings ? "mine" : "default");
  const myRankByPlayer = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of myRankings) m.set(r.playerId, r.rank);
    return m;
  }, [myRankings]);
  const [viewingTeamId, setViewingTeamId] = useState<number | null>(myMemberId);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const teamPickerRef = useRef<HTMLDivElement | null>(null);
  const [, startTransition] = useTransition();

  // Close the team picker on outside click / Escape.
  useEffect(() => {
    if (!teamPickerOpen) return;
    function onPointer(e: PointerEvent) {
      if (teamPickerRef.current && !teamPickerRef.current.contains(e.target as Node)) {
        setTeamPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTeamPickerOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [teamPickerOpen]);

  // Sync the default viewing team to mine when myMemberId becomes available.
  useEffect(() => {
    if (viewingTeamId == null && myMemberId != null) setViewingTeamId(myMemberId);
  }, [myMemberId, viewingTeamId]);

  // Close the settings (gear) menu on outside click / Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    function onPointer(e: PointerEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  // Escape closes the card context menu and the player picker.
  useEffect(() => {
    if (!cardMenu && !picker) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCardMenu(null);
        setPicker(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cardMenu, picker]);

  const panelIdx = PANEL_ORDER.indexOf(panelSize);
  const canEnlarge = panelIdx < PANEL_ORDER.length - 1;
  const canShrink = panelIdx > 0;

  // Measure the outer container and status bar so we can compute an actual
  // pixel height for "full" mode — keeping every panel size on the same
  // transitioned `height` property so the animation stays smooth instead of
  // snapping when we switch from a fixed size to a flex-based layout.
  const containerRef = useRef<HTMLDivElement>(null);
  const statusBarRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(0);
  const [statusH, setStatusH] = useState(0);
  useEffect(() => {
    const c = containerRef.current;
    const s = statusBarRef.current;
    if (!c || !s) return;
    const measure = () => {
      setContainerH(c.clientHeight);
      setStatusH(s.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    ro.observe(s);
    return () => ro.disconnect();
  }, []);
  const PANEL_TOP_MARGIN = 8; // matches mt-2 on the panel wrapper
  const fullPanelHeight = Math.max(0, containerH - statusH - PANEL_TOP_MARGIN);
  const panelHeight = panelSize === "full" ? fullPanelHeight : PANEL_HEIGHTS[panelSize];

  // Poll when draft is live (skip in read-only view)
  useEffect(() => {
    if (readOnly || draft?.status !== "in_progress") return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [readOnly, draft?.status, router]);

  const N = members.length;
  const teamNameById = useMemo(() => new Map(members.map((m) => [m.id, m.teamName])), [members]);
  const totalRounds = draft?.totalRounds ?? 0;
  const currentPick = draft?.currentPick ?? 1;

  const pickOwnerMap = useMemo<PickOwnerOverrides>(() => {
    const m = new Map<number, number>();
    for (const o of pickOwnerOverrides) m.set(o.overallPick, o.ownerTeamId);
    return m;
  }, [pickOwnerOverrides]);

  // Compute whose turn it is (honoring any traded pick slots)
  let currentPickTeamId: number | null = null;
  let currentRound = 1;
  const trr = !!draft?.thirdRoundReversal;
  if (draft && (draft.status === "in_progress" || draft.status === "paused") && N > 0) {
    currentRound = Math.ceil(currentPick / N);
    currentPickTeamId = resolvePickOwnerId(currentPick, members, trr, pickOwnerMap);
  }
  const isMyPick = draft?.status === "in_progress" && currentPickTeamId !== null && currentPickTeamId === myMemberId;

  // Build pick lookup
  const pickMap = new Map<number, PickInfo>();
  picks.forEach((p) => pickMap.set(p.pickNumber, p));

  // Filter + sort available players. Primary order is total fantasy points
  // earned so far this season (descending) so the list mirrors the
  // points-leaders view; rank fields are used as tiebreakers and for
  // players with no results yet.
  const filtered = availablePlayers
    .filter((p) => (tab === "all" ? true : tab === "mpo" ? p.division === "MPO" : p.division !== "MPO"))
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    // In "Mine" mode, only show players the user has actually ranked — don't
    // pad the bottom with the default-ranked players.
    .filter((p) => !(sortMode === "mine" && hasMyRankings) || myRankByPlayer.has(p.id))
    .sort((a, b) => {
      if (sortMode === "mine" && hasMyRankings) {
        const ra = myRankByPlayer.get(a.id) ?? 9_999_999;
        const rb = myRankByPlayer.get(b.id) ?? 9_999_999;
        if (ra !== rb) return ra - rb;
        return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
      }
      const pa = a.totalPoints ?? 0;
      const pb = b.totalPoints ?? 0;
      if (pa !== pb) return pb - pa;
      if (tab === "all") return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
      return (a.worldRanking ?? 9999) - (b.worldRanking ?? 9999);
    });

  // Commissioner (in a live, non-read-only board) can manage picks: assign the
  // on-clock slot and change/undo drafted cards.
  const canManage = isCommissioner && !readOnly;

  // Available players for the assign/change picker — its own search + division
  // filter, ordered like the main list (points, then overall rank).
  const pickerFiltered = useMemo(
    () =>
      availablePlayers
        .filter((p) =>
          pickerTab === "all" ? true : pickerTab === "mpo" ? p.division === "MPO" : p.division !== "MPO",
        )
        .filter((p) => !pickerSearch || p.name.toLowerCase().includes(pickerSearch.toLowerCase()))
        .sort((a, b) => {
          const pa = a.totalPoints ?? 0;
          const pb = b.totalPoints ?? 0;
          if (pa !== pb) return pb - pa;
          return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
        }),
    [availablePlayers, pickerTab, pickerSearch],
  );

  // Route a picker selection to the right server action, then refresh.
  const submitPicker = (playerId: number) => {
    const p = picker;
    setPicker(null);
    setPickerSearch("");
    startTransition(() => {
      const run =
        p && p.mode === "change"
          ? replacePick(leagueId, p.pickNumber, playerId)
          : commissionerMakePick(leagueId, playerId);
      void run.then(() => router.refresh());
    });
  };

  // Build flat grid cells
  const gridCells: React.ReactNode[] = [];

  // Corner cell
  gridCells.push(
    <div key="corner" className="bg-[#0f1117] rounded-lg p-2 sticky left-0 z-10" />
  );

  // Team header cells
  members.forEach((m) => {
    const isOnClock = m.id === currentPickTeamId && draft?.status === "in_progress";
    const isMe = m.id === myMemberId;
    gridCells.push(
      <div
        key={`h-${m.id}`}
        className={`px-2 py-2 text-center rounded-lg ${isOnClock ? "bg-[#36D7B7]/15" : "bg-[#0f1117]"}`}
      >
        <p className={`text-xs font-bold truncate leading-tight ${isMe ? "text-white" : "text-gray-300"}`}>
          {m.teamName}
        </p>
        <p className="text-gray-400 text-[10px] mt-0.5">#{m.draftPosition}</p>
        {isOnClock && (
          <p className="text-[10px] text-[#36D7B7] font-semibold animate-pulse mt-1">ON THE CLOCK</p>
        )}
      </div>
    );
  });

  // Round rows
  for (let round = 1; round <= totalRounds; round++) {
    const isCurrentRound = round === currentRound && (draft?.status === "in_progress" || draft?.status === "paused");

    // Round label cell
    gridCells.push(
      <div
        key={`round-${round}`}
        className={`bg-[#0f1117] rounded-lg flex items-center justify-center sticky left-0 z-10 ${isCurrentRound ? "text-white font-bold" : "text-gray-400"}`}
      >
        <span className="text-xs font-mono">R{round}</span>
      </div>
    );

    // Pick cells for each team
    members.forEach((m) => {
      const pickNum = getPickNumber(round, m.draftPosition, N, trr);
      const reversed = isRoundReversed(round, trr);
      const posInRound = reversed ? N - m.draftPosition + 1 : m.draftPosition;
      const pickLabel = `${round}.${posInRound}`;
      // For auctions, pick_number is sequential nomination order (not a snake
      // slot), so a snake-slot lookup would render picks under the wrong team.
      // Only show a pick here when its actual winner is this column's team.
      // Snake drafts — including traded slots, shown via the traded badge — are
      // unaffected.
      const pickRaw = pickMap.get(pickNum);
      const pick = draft?.type === "auction" && pickRaw && pickRaw.teamId !== m.id ? undefined : pickRaw;
      const isCurrent =
        pickNum === currentPick && (draft?.status === "in_progress" || draft?.status === "paused");

      // If this slot was traded, surface who owns it now so everyone can see.
      const tradedOwnerId = pickOwnerMap.get(pickNum);
      const tradedTo =
        tradedOwnerId != null && tradedOwnerId !== m.id ? teamNameById.get(tradedOwnerId) ?? null : null;
      const tradedBadge = tradedTo ? (
        <div
          className="inline-flex items-center gap-0.5 self-start max-w-full text-[9px] font-bold leading-none bg-black/45 text-white px-1 py-0.5 rounded mb-0.5"
          title={`Traded to ${tradedTo}`}
        >
          <span aria-hidden>↗</span>
          <span className="truncate">{tradedTo}</span>
        </div>
      ) : null;

      if (pick) {
        const { first, last } = splitName(pick.playerName);
        const cellStyle = { background: divBg(pick.playerDivision), color: "var(--pick-fg)" } as const;
        const profileHref = pick.playerId != null ? `/league/${leagueId}/player/${pick.playerId}` : null;
        const cardClass =
          "flex flex-col p-1.5 min-h-[60px] rounded-lg transition hover:ring-2 hover:ring-white/30 hover:brightness-110 cursor-pointer";
        const cardBody = (
          <>
            {tradedBadge}
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-mono" style={{ color: "var(--pick-fg-muted)", opacity: 0.7 }}>{pickLabel}</span>
              <span className="text-[10px] font-semibold" style={{ color: "var(--pick-fg-muted)" }}>{pick.playerDivision}</span>
            </div>
            <div className="flex-1 flex flex-col justify-end mt-1">
              {first && <p className="text-[11px] leading-tight break-words" style={{ color: "var(--pick-fg-muted)" }}>{first}</p>}
              <p className="font-bold text-sm leading-tight break-words" style={{ color: "var(--pick-fg)" }}>{last}</p>
            </div>
          </>
        );
        if (canManage) {
          // Tap opens the player profile; right-click / long-press opens the
          // change-or-undo menu (replaces the old ✕ overlay).
          const playerName = pick.playerName;
          gridCells.push(
            <ManagedPickCell
              key={`${round}-${m.id}`}
              href={profileHref}
              style={cellStyle}
              className={cardClass}
              onMenu={(x, y) => setCardMenu({ pickNumber: pickNum, label: pickLabel, playerName, x, y })}
            >
              {cardBody}
            </ManagedPickCell>
          );
        } else {
          gridCells.push(
            <div key={`${round}-${m.id}`}>
              {profileHref ? (
                <Link href={profileHref} style={cellStyle} className={cardClass} title={`View ${pick.playerName}'s profile`}>
                  {cardBody}
                </Link>
              ) : (
                <div style={cellStyle} className="flex flex-col p-1.5 min-h-[60px] rounded-lg">
                  {cardBody}
                </div>
              )}
            </div>
          );
        }
      } else if (isCurrent) {
        const onClockBody = (
          <>
            {tradedBadge}
            <span className="text-[#36D7B7] text-[10px] font-mono">{pickLabel}</span>
            <span className="text-[#36D7B7] text-xs font-semibold animate-pulse mt-1">on the clock</span>
            {canManage && draft?.status === "in_progress" && (
              <span className="text-[#36D7B7]/70 text-[9px] mt-0.5">tap to assign</span>
            )}
          </>
        );
        if (canManage && draft?.status === "in_progress") {
          // Commissioner can fill the on-clock slot directly from the board.
          gridCells.push(
            <button
              key={`${round}-${m.id}`}
              type="button"
              onClick={() => setPicker({ mode: "assign" })}
              className="flex flex-col items-center justify-center p-1.5 min-h-[60px] rounded-lg bg-[#36D7B7]/10 ring-2 ring-[#36D7B7] ring-inset hover:bg-[#36D7B7]/20 transition"
            >
              {onClockBody}
            </button>
          );
        } else {
          gridCells.push(
            <div
              key={`${round}-${m.id}`}
              className="flex flex-col items-center justify-center p-1.5 min-h-[60px] rounded-lg bg-[#36D7B7]/10 ring-2 ring-[#36D7B7] ring-inset"
            >
              {onClockBody}
            </div>
          );
        }
      } else {
        gridCells.push(
          <div
            key={`${round}-${m.id}`}
            className="flex flex-col p-1.5 min-h-[60px] rounded-lg bg-[#1a1d23]"
          >
            {tradedBadge}
            <div className="flex justify-start">
              <span className="text-white/20 text-[10px] font-mono">{pickLabel}</span>
            </div>
          </div>
        );
      }
    });
  }

  // Show the bottom Available/My Team panel in any state where the board is
  // visible (including pending), but only allow actual drafting during
  // in_progress.
  const drafted =
    draft?.status === "pending" ||
    draft?.status === "in_progress" ||
    draft?.status === "paused" ||
    draft?.status === "complete";

  // Team panel state — defaults to my team, can switch via the dropdown.
  const myPicks = myMemberId == null
    ? []
    : picks.filter((p) => p.teamId === myMemberId);
  const effectiveViewingTeamId = viewingTeamId ?? myMemberId;
  const viewingTeamPicks = effectiveViewingTeamId == null
    ? []
    : picks
        .filter((p) => p.teamId === effectiveViewingTeamId)
        .sort((a, b) => a.pickNumber - b.pickNumber);
  const teamsByDraftOrder = [...members].sort(
    (a, b) => (a.draftPosition ?? 9999) - (b.draftPosition ?? 9999),
  );
  const viewingTeam = members.find((m) => m.id === effectiveViewingTeamId) ?? null;
  const viewingIsMine =
    effectiveViewingTeamId != null && effectiveViewingTeamId === myMemberId;

  // Bucket into starter slots (in pick order, by division) then bench.
  const viewMpoPicks = viewingTeamPicks.filter((p) => p.playerDivision === "MPO");
  const viewFpoPicks = viewingTeamPicks.filter((p) => p.playerDivision !== "MPO");
  const mpoStarterPicks = viewMpoPicks.slice(0, mpoSlots);
  const fpoStarterPicks = viewFpoPicks.slice(0, fpoSlots);
  const benchPicks = [
    ...viewMpoPicks.slice(mpoSlots),
    ...viewFpoPicks.slice(fpoSlots),
  ].sort((a, b) => a.pickNumber - b.pickNumber);
  const filledStarters = mpoStarterPicks.length + fpoStarterPicks.length;
  const totalStarterSlots = mpoSlots + fpoSlots;
  const benchCapacity = Math.max(0, rosterSize - totalStarterSlots);
  const emptyBenchCount = Math.max(0, benchCapacity - benchPicks.length);

  // Draft actions available to this viewer/state — shared by the inline status
  // bar and the full-screen gear menu.
  const showAutoPick = !readOnly && isMyPick;
  const showStart = !readOnly && isCommissioner && draft?.status === "pending";
  const showUndoLast =
    !readOnly && isCommissioner &&
    (draft?.status === "in_progress" || draft?.status === "paused" || draft?.status === "complete") &&
    picks.length > 0;
  const showPause = !readOnly && isCommissioner && draft?.status === "in_progress";
  const showResume = !readOnly && isCommissioner && draft?.status === "paused";
  const hasMenuActions = showAutoPick || showStart || showUndoLast || showPause || showResume;

  // Status text (round / pick / countdown / your-pick) shared by both layouts.
  const statusSpans = (
    <>
      {draft?.status === "pending" && <span className="text-gray-400 text-sm">Draft has not started</span>}
      {draft?.status === "in_progress" && (
        <>
          <span className="text-white text-sm font-semibold">Round {currentRound} · Pick {currentPick} of {N * totalRounds}</span>
          <PickCountdown
            leagueId={leagueId}
            secondsPerPick={draft.secondsPerPick ?? 60}
            startedAt={draft.currentPickStartedAt ?? null}
            pickNumber={currentPick}
          />
        </>
      )}
      {draft?.status === "paused" && (
        <span className="text-yellow-400 text-sm font-semibold">Paused — Round {currentRound}, Pick {currentPick}</span>
      )}
      {draft?.status === "complete" && (
        <span className="text-[#36D7B7] text-sm font-semibold">Draft Complete</span>
      )}
      {isMyPick && (
        <span className="text-xs bg-[#36D7B7]/20 text-[#36D7B7] px-2 py-0.5 rounded-full font-semibold animate-pulse">
          YOUR PICK
        </span>
      )}
    </>
  );

  // Full-screen gear-menu items (same server actions as the inline pills).
  const menuItems = (
    <>
      {showAutoPick && (
        <form action={autoPickFromRankings.bind(null, leagueId)} onSubmit={() => setSettingsOpen(false)}>
          <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#36D7B7] hover:bg-white/5 transition">Auto-pick my slot</button>
        </form>
      )}
      {showStart && (
        <form action={startDraft.bind(null, leagueId)} onSubmit={() => setSettingsOpen(false)}>
          <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-white hover:bg-white/5 transition">Start draft</button>
        </form>
      )}
      {showPause && (
        <form action={pauseDraft.bind(null, leagueId)} onSubmit={() => setSettingsOpen(false)}>
          <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-yellow-300 hover:bg-white/5 transition">Pause draft</button>
        </form>
      )}
      {showResume && (
        <form action={resumeDraft.bind(null, leagueId)} onSubmit={() => setSettingsOpen(false)}>
          <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#36D7B7] hover:bg-white/5 transition">Resume draft</button>
        </form>
      )}
      {showUndoLast && (
        <form action={undoLastPick.bind(null, leagueId)} onSubmit={() => setSettingsOpen(false)}>
          <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-200 hover:bg-white/5 transition">Undo last pick</button>
        </form>
      )}
    </>
  );

  return (
    <div
      ref={containerRef}
      className={fullscreen ? "fixed inset-0 z-50 bg-[#0f1117] flex flex-col px-3 sm:px-4" : "flex flex-col"}
      style={fullscreen ? undefined : { height: "calc(100vh - 152px)" }}
    >

      {/* Top bar. Full screen: [✕] · centered status · [⚙ menu]. Inline: status
          on the left, action pills + Full screen button on the right. */}
      <div ref={statusBarRef} className="relative flex items-center justify-between px-1 py-2 shrink-0">
        {fullscreen ? (
          <>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              title="Close full screen"
              aria-label="Close full screen"
              className="relative z-10 text-gray-200 hover:text-white transition p-1.5 -ml-1"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="absolute inset-x-0 flex items-center justify-center gap-2 px-12 pointer-events-none">
              {statusSpans}
            </div>
            {hasMenuActions ? (
              <div ref={settingsRef} className="relative z-10">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((o) => !o)}
                  title="Draft settings"
                  aria-label="Draft settings"
                  className="text-gray-200 hover:text-white transition p-1.5 -mr-1"
                >
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                {settingsOpen && (
                  <div className="absolute right-0 top-full mt-2 z-30 w-52 bg-[#1a1d23] border border-white/10 rounded-xl shadow-xl p-1">
                    {menuItems}
                  </div>
                )}
              </div>
            ) : (
              <span className="inline-block w-8" />
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">{statusSpans}</div>
            <div className="flex items-center gap-2">
              {!readOnly && (
                <div className="flex gap-2">
                  {showAutoPick && (
                    <form action={autoPickFromRankings.bind(null, leagueId)}>
                      <button className="border border-[#36D7B7]/40 hover:bg-[#36D7B7]/10 text-[#36D7B7] hover:text-white font-semibold px-3 py-1.5 rounded-lg text-sm transition">
                        Auto-pick
                      </button>
                    </form>
                  )}
                  {showStart && (
                    <form action={startDraft.bind(null, leagueId)}>
                      <button className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-5 py-1.5 rounded-lg text-sm transition">
                        Start Draft
                      </button>
                    </form>
                  )}
                  {showUndoLast && (
                    <form action={undoLastPick.bind(null, leagueId)}>
                      <button
                        className="border border-white/15 text-gray-300 hover:bg-white/5 hover:text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition"
                        title="Undo the most recent pick"
                      >
                        Undo pick
                      </button>
                    </form>
                  )}
                  {showPause && (
                    <form action={pauseDraft.bind(null, leagueId)}>
                      <button className="border border-yellow-500/40 text-yellow-400 hover:bg-yellow-400/10 px-4 py-1.5 rounded-lg text-sm font-semibold transition">
                        Pause
                      </button>
                    </form>
                  )}
                  {showResume && (
                    <form action={resumeDraft.bind(null, leagueId)}>
                      <button className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-5 py-1.5 rounded-lg text-sm transition">
                        Resume
                      </button>
                    </form>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                title="Expand to full screen"
                aria-label="Expand to full screen"
                className="flex items-center gap-1.5 text-gray-400 hover:text-white transition text-sm px-2 py-1.5 rounded-lg hover:bg-white/5 shrink-0"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                <span className="hidden sm:inline">Full screen</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Board grid. `min-h-0` lets the flex item shrink to 0 height when the
          panel claims all available space (e.g. in full-screen panel mode). */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-white/5">
        {N === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            No teams have joined yet
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `44px repeat(${N}, minmax(112px, 150px))`,
              gap: "4px",
              minWidth: `${44 + N * 116}px`,
            }}
          >
            {gridCells}
          </div>
        )}
      </div>

      {/* Bottom panel: Available / My Team */}
      {drafted && !readOnly && (
        <div
          className="shrink-0 mt-2 rounded-xl border border-white/5 bg-[#1a1d23] flex flex-col transition-[height] duration-200"
          style={{ height: panelHeight }}
        >
          {/* Tab header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0 flex-wrap">
            <div className="flex flex-col -my-1">
              <button
                onClick={() => canEnlarge && setPanelSize(PANEL_ORDER[panelIdx + 1])}
                disabled={!canEnlarge}
                className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed leading-none"
                title="Enlarge"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                onClick={() => canShrink && setPanelSize(PANEL_ORDER[panelIdx - 1])}
                disabled={!canShrink}
                className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed leading-none"
                title="Shrink"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            <div className="flex gap-1 bg-[#0f1117] rounded-lg p-0.5">
              <button
                onClick={() => setBottomTab("available")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                  bottomTab === "available" ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Available ({availablePlayers.length})
              </button>
              <button
                onClick={() => setBottomTab("team")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                  bottomTab === "team" ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Team ({viewingTeamPicks.length})
              </button>
            </div>

            {bottomTab === "available" && (
              <div className="ml-auto flex flex-col-reverse sm:flex-row sm:items-center gap-2">
                {hasMyRankings && (
                  <div className="flex gap-1 bg-[#0f1117] rounded-lg p-0.5 w-48 sm:w-auto">
                    {([
                      { key: "mine", label: "Mine" },
                      { key: "default", label: "Points" },
                    ] as { key: SortMode; label: string }[]).map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setSortMode(opt.key)}
                        className={`flex-1 sm:flex-initial px-3 py-1 rounded-md text-xs font-semibold transition ${
                          sortMode === opt.key ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                        }`}
                        title={
                          opt.key === "mine"
                            ? "Sort by your personal player rankings"
                            : "Sort by total fantasy points / overall rank"
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-1 bg-[#0f1117] rounded-lg p-0.5 w-48 sm:w-auto">
                  {(["all", "mpo", "fpo"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`flex-1 sm:flex-initial px-3 py-1 rounded-md text-xs font-semibold transition ${
                        t === tab ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-[#0f1117] border border-white/10 rounded-lg px-3 py-1 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] w-48 sm:w-36"
                />
              </div>
            )}

            {isMyPick && (
              <span className="ml-auto text-[#36D7B7] font-bold text-xs animate-pulse">
                {bottomTab === "available" ? "YOUR PICK — select a player" : "Switch to Available to draft"}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1">
            {bottomTab === "available" ? (
              filtered.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-6">No players found</p>
              ) : (
                filtered.map((player, idx) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-3 px-3 py-2 border-b border-white/5 hover:bg-white/5 transition"
                  >
                    {draft?.status === "in_progress" && (isMyPick || isCommissioner) ? (
                      <form
                        action={(isMyPick ? makeDraftPick : commissionerMakePick).bind(null, leagueId, player.id)}
                        onSubmit={() => startTransition(() => { setTimeout(() => router.refresh(), 300); })}
                        className="shrink-0 -mr-2"
                      >
                        <button
                          type="submit"
                          className={`text-xs px-3 py-1.5 rounded-full transition text-white ${
                            isMyPick
                              ? "bg-[#4B3DFF] hover:bg-[#3a2ee0]"
                              : "bg-white/10 hover:bg-white/20 border border-white/15"
                          }`}
                          title={isMyPick ? "Draft this player" : "Pick on behalf of the on-clock team"}
                        >
                          {isMyPick ? "Draft" : "Assign"}
                        </button>
                      </form>
                    ) : (
                      <span className="w-[60px] shrink-0 -mr-2" />
                    )}
                    <span
                      className="text-gray-400 text-xs font-mono w-7 text-right shrink-0 tabular-nums"
                      title={
                        sortMode === "mine" && hasMyRankings
                          ? "Order by your personal player rankings"
                          : "Order by total fantasy points this season"
                      }
                    >
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <Link
                        href={`/league/${leagueId}/player/${player.id}`}
                        className="text-white text-sm truncate min-w-0 hover:underline"
                        title={`View ${player.name}'s profile`}
                      >
                        {player.name}
                      </Link>
                      {player.pdgaRating != null && (
                        <span
                          className="text-xs text-gray-400 font-semibold tabular-nums shrink-0"
                          title="Current PDGA Rating"
                        >
                          {player.pdgaRating}
                        </span>
                      )}
                      <span className={`text-xs font-semibold shrink-0 ${divColor(player.division)}`}>
                        {player.division}
                      </span>
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="px-3 py-2 space-y-2">
                {/* Team picker — defaults to you, switches the panel to any
                    team in draft order. */}
                <div ref={teamPickerRef} className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => setTeamPickerOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={teamPickerOpen}
                    className={`inline-flex items-center gap-2 bg-[#0f1117] border rounded-lg px-3 py-2 text-white text-sm transition ${
                      teamPickerOpen
                        ? "border-[#4B3DFF]/60"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    <span className="text-left">
                      {viewingTeam?.teamName ?? "Pick a team"}
                      {viewingIsMine && (
                        <span className="text-gray-400 text-xs ml-1.5">(you)</span>
                      )}
                    </span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`shrink-0 text-gray-400 transition-transform ${teamPickerOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {teamPickerOpen && (
                    <div
                      role="listbox"
                      tabIndex={-1}
                      className="absolute left-0 right-0 top-full mt-2 z-30 max-h-72 overflow-y-auto bg-[#1a1d23] border border-white/10 rounded-xl shadow-xl p-1"
                    >
                      {teamsByDraftOrder.map((t) => {
                        const isMe = t.id === myMemberId;
                        const isSelected = t.id === effectiveViewingTeamId;
                        const teamPickCount = picks.filter((p) => p.teamId === t.id).length;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              setViewingTeamId(t.id);
                              setTeamPickerOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                              isSelected
                                ? "bg-[#4B3DFF]/15 text-white"
                                : "text-gray-300 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            <span className="text-gray-400 text-[10px] font-mono w-5 shrink-0 text-right">
                              {t.draftPosition ?? "—"}
                            </span>
                            <span className="flex-1 truncate">
                              {t.teamName}
                              {isMe && <span className="text-gray-400 text-xs ml-1">(you)</span>}
                            </span>
                            <span className="text-gray-400 text-xs shrink-0 tabular-nums">{teamPickCount}</span>
                            {isSelected && (
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#4B3DFF"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between px-1 pt-1">
                  <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Starters</span>
                  <span className="text-gray-400 text-xs">{filledStarters}/{totalStarterSlots}</span>
                </div>
                <div className="space-y-1.5">
                  {Array.from({ length: mpoSlots }).map((_, i) => (
                    <DraftLineupRow
                      key={`mpo-${i}`}
                      leagueId={leagueId}
                      division="MPO"
                      slotIndex={i + 1}
                      pick={mpoStarterPicks[i] ?? null}
                    />
                  ))}
                  {Array.from({ length: fpoSlots }).map((_, i) => (
                    <DraftLineupRow
                      key={`fpo-${i}`}
                      leagueId={leagueId}
                      division="FPO"
                      slotIndex={i + 1}
                      pick={fpoStarterPicks[i] ?? null}
                    />
                  ))}
                </div>
                {benchCapacity > 0 && (
                  <>
                    <div className="flex items-center justify-between px-1 pt-2">
                      <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Bench</span>
                      <span className="text-gray-400 text-xs">{benchPicks.length}/{benchCapacity}</span>
                    </div>
                    <div className="space-y-1.5">
                      {benchPicks.map((p) => (
                        <DraftLineupRow
                          key={p.pickNumber}
                          leagueId={leagueId}
                          division={p.playerDivision === "MPO" ? "MPO" : "FPO"}
                          pick={p}
                          bench
                        />
                      ))}
                      {Array.from({ length: emptyBenchCount }).map((_, i) => (
                        <DraftBenchEmptyRow key={`bench-empty-${i}`} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Change / undo context menu for a drafted card (commissioner). */}
      {cardMenu && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setCardMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCardMenu(null);
            }}
          />
          <div
            className="fixed z-[61] w-44 bg-[#1a1d23] border border-white/10 rounded-xl shadow-2xl p-1"
            style={{
              top: Math.min(cardMenu.y, window.innerHeight - 140),
              left: Math.min(cardMenu.x, window.innerWidth - 190),
            }}
          >
            <div className="px-3 py-1.5 text-[11px] text-gray-400 truncate border-b border-white/5 mb-1">
              Pick {cardMenu.label} · {cardMenu.playerName}
            </div>
            <button
              type="button"
              onClick={() => {
                setPicker({
                  mode: "change",
                  pickNumber: cardMenu.pickNumber,
                  currentName: cardMenu.playerName,
                });
                setCardMenu(null);
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-200 hover:bg-white/5 transition"
            >
              Change pick
            </button>
            <button
              type="button"
              onClick={() => {
                const { pickNumber, label, playerName } = cardMenu;
                setCardMenu(null);
                if (
                  window.confirm(
                    `Undo pick ${label} (${playerName})? This rewinds the draft to pick ${label} — all later picks will be removed and the team will be back on the clock.`,
                  )
                ) {
                  startTransition(() => {
                    void undoPick(leagueId, pickNumber).then(() => router.refresh());
                  });
                }
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-300 hover:bg-red-500/10 transition"
            >
              Undo pick
            </button>
          </div>
        </>
      )}

      {/* Player picker — assign the on-clock slot or swap an existing pick. */}
      {picker && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 sm:p-4"
          onClick={() => {
            setPicker(null);
            setPickerSearch("");
          }}
        >
          <div
            className="w-full sm:max-w-md bg-[#1a1d23] border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm">
                  {picker.mode === "assign" ? "Assign player" : "Change pick"}
                </p>
                {picker.mode === "change" && (
                  <p className="text-gray-400 text-xs mt-0.5 truncate">Replacing {picker.currentName}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPicker(null);
                  setPickerSearch("");
                }}
                className="text-gray-400 hover:text-white transition p-1 shrink-0"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
              <div className="flex gap-1 bg-[#0f1117] rounded-lg p-0.5">
                {(["all", "mpo", "fpo"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPickerTab(t)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                      t === pickerTab ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              <input
                type="text"
                autoFocus
                placeholder="Search players..."
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                className="flex-1 bg-[#0f1117] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF]"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {pickerFiltered.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-6">No players found</p>
              ) : (
                pickerFiltered.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => submitPicker(player.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-white/5 hover:bg-white/5 text-left transition"
                  >
                    <span className="text-white text-sm flex-1 truncate min-w-0">{player.name}</span>
                    {player.pdgaRating != null && (
                      <span className="text-xs text-gray-400 font-semibold tabular-nums shrink-0">{player.pdgaRating}</span>
                    )}
                    <span className={`text-xs font-semibold shrink-0 ${divColor(player.division)}`}>
                      {player.division}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
