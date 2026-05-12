"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDraft, pauseDraft, resumeDraft, makeDraftPick } from "@/actions/drafts";

type DraftInfo = { id: number; status: string; currentPick: number; totalRounds: number };
type Member = { id: number; teamName: string; draftPosition: number };
type PickInfo = { pickNumber: number; teamId: number; playerName: string; playerDivision: string };
type AvailablePlayer = { id: number; name: string; division: string; worldRanking: number | null; overallRank: number | null };
type Tab = "all" | "mpo" | "fpo";
type BottomTab = "available" | "team";
type PanelSize = "small" | "medium" | "large";

const PANEL_HEIGHTS: Record<PanelSize, number> = { small: 140, medium: 240, large: 460 };
const PANEL_ORDER: PanelSize[] = ["small", "medium", "large"];

type Props = {
  leagueId: number;
  draft: DraftInfo | null;
  members: Member[];
  picks: PickInfo[];
  availablePlayers: AvailablePlayer[];
  myMemberId: number | null;
  isCommissioner: boolean;
  readOnly?: boolean;
};

function getPickNumber(round: number, draftPosition: number, numTeams: number): number {
  const isReversed = round % 2 === 0;
  return (round - 1) * numTeams + (isReversed ? numTeams - draftPosition + 1 : draftPosition);
}

function divColor(division: string) {
  return division === "MPO" ? "text-[#4B3DFF]" : "text-[#36D7B7]";
}

function divBg(division: string): string {
  return division === "MPO" ? "rgba(75,61,255,0.32)" : "rgba(54,215,183,0.22)";
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(" ");
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export function DraftBoard({ leagueId, draft, members, picks, availablePlayers, myMemberId, isCommissioner, readOnly }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [bottomTab, setBottomTab] = useState<BottomTab>("available");
  const [search, setSearch] = useState("");
  const [panelSize, setPanelSize] = useState<PanelSize>("medium");
  const [, startTransition] = useTransition();
  const panelIdx = PANEL_ORDER.indexOf(panelSize);
  const canEnlarge = panelIdx < PANEL_ORDER.length - 1;
  const canShrink = panelIdx > 0;
  const panelHeight = PANEL_HEIGHTS[panelSize];

  // Poll when draft is live (skip in read-only view)
  useEffect(() => {
    if (readOnly || draft?.status !== "in_progress") return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [readOnly, draft?.status, router]);

  const N = members.length;
  const totalRounds = draft?.totalRounds ?? 0;
  const currentPick = draft?.currentPick ?? 1;

  // Compute whose turn it is
  let currentPickTeamId: number | null = null;
  let currentRound = 1;
  if (draft && (draft.status === "in_progress" || draft.status === "paused") && N > 0) {
    currentRound = Math.ceil(currentPick / N);
    const posInRound = currentPick - (currentRound - 1) * N;
    const isReversed = currentRound % 2 === 0;
    const slot = isReversed ? N - posInRound + 1 : posInRound;
    currentPickTeamId = members.find((m) => m.draftPosition === slot)?.id ?? null;
  }
  const isMyPick = draft?.status === "in_progress" && currentPickTeamId !== null && currentPickTeamId === myMemberId;

  // Build pick lookup
  const pickMap = new Map<number, PickInfo>();
  picks.forEach((p) => pickMap.set(p.pickNumber, p));

  // Filter + sort available players
  const filtered = availablePlayers
    .filter((p) => (tab === "all" ? true : tab === "mpo" ? p.division === "MPO" : p.division !== "MPO"))
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (tab === "all") return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
      return (a.worldRanking ?? 9999) - (b.worldRanking ?? 9999);
    });

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
        className={`px-2 py-3 text-center rounded-lg ${isOnClock ? "bg-[#36D7B7]/15" : "bg-[#0f1117]"}`}
      >
        <p className={`text-xs font-bold truncate leading-tight ${isMe ? "text-white" : "text-gray-300"}`}>
          {m.teamName}
        </p>
        <p className="text-gray-600 text-[10px] mt-0.5">#{m.draftPosition}</p>
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
        className={`bg-[#0f1117] rounded-lg flex items-center justify-center sticky left-0 z-10 ${isCurrentRound ? "text-white font-bold" : "text-gray-600"}`}
      >
        <span className="text-xs font-mono">R{round}</span>
      </div>
    );

    // Pick cells for each team
    members.forEach((m) => {
      const pickNum = getPickNumber(round, m.draftPosition, N);
      const isReversed = round % 2 === 0;
      const posInRound = isReversed ? N - m.draftPosition + 1 : m.draftPosition;
      const pickLabel = `${round}.${posInRound}`;
      const pick = pickMap.get(pickNum);
      const isCurrent =
        pickNum === currentPick && (draft?.status === "in_progress" || draft?.status === "paused");

      if (pick) {
        const { first, last } = splitName(pick.playerName);
        gridCells.push(
          <div
            key={`${round}-${m.id}`}
            style={{ background: divBg(pick.playerDivision) }}
            className="flex flex-col p-2 min-h-[80px] rounded-lg overflow-hidden"
          >
            <div className="flex justify-between items-center">
              <span className="text-white/50 text-[10px] font-semibold">{pick.playerDivision}</span>
              <span className="text-white/40 text-[10px] font-mono">{pickLabel}</span>
            </div>
            <div className="flex-1 flex flex-col justify-end mt-1">
              {first && <p className="text-white/70 text-[11px] leading-tight truncate">{first}</p>}
              <p className="text-white font-bold text-sm leading-tight truncate">{last}</p>
            </div>
          </div>
        );
      } else if (isCurrent) {
        gridCells.push(
          <div
            key={`${round}-${m.id}`}
            className="flex flex-col items-center justify-center p-2 min-h-[80px] rounded-lg bg-[#36D7B7]/10 ring-2 ring-[#36D7B7] ring-inset"
          >
            <span className="text-[#36D7B7] text-[10px] font-mono">{pickLabel}</span>
            <span className="text-[#36D7B7] text-xs font-semibold animate-pulse mt-1">on the clock</span>
          </div>
        );
      } else {
        gridCells.push(
          <div
            key={`${round}-${m.id}`}
            className="flex flex-col p-2 min-h-[80px] rounded-lg bg-[#1a1d23]"
          >
            <div className="flex justify-end">
              <span className="text-white/20 text-[10px] font-mono">{pickLabel}</span>
            </div>
          </div>
        );
      }
    });
  }

  const drafted = draft?.status === "in_progress" || draft?.status === "paused" || draft?.status === "complete";

  // My team — picks where teamId === myMemberId, sorted by pickNumber
  const myPicks = myMemberId == null
    ? []
    : picks.filter((p) => p.teamId === myMemberId).sort((a, b) => a.pickNumber - b.pickNumber);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 152px)" }}>

      {/* Status bar */}
      <div className="flex items-center justify-between px-1 py-2 shrink-0">
        <div className="flex items-center gap-3">
          {draft?.status === "pending" && <span className="text-gray-400 text-sm">Draft has not started</span>}
          {draft?.status === "in_progress" && (
            <span className="text-white text-sm font-semibold">Round {currentRound} · Pick {currentPick} of {N * totalRounds}</span>
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
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            {isCommissioner && draft?.status === "pending" && (
              <form action={startDraft.bind(null, leagueId)}>
                <button className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-5 py-1.5 rounded-lg text-sm transition">
                  Start Draft
                </button>
              </form>
            )}
            {isCommissioner && draft?.status === "in_progress" && (
              <form action={pauseDraft.bind(null, leagueId)}>
                <button className="border border-yellow-500/40 text-yellow-400 hover:bg-yellow-400/10 px-4 py-1.5 rounded-lg text-sm font-semibold transition">
                  Pause
                </button>
              </form>
            )}
            {isCommissioner && draft?.status === "paused" && (
              <form action={resumeDraft.bind(null, leagueId)}>
                <button className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-5 py-1.5 rounded-lg text-sm transition">
                  Resume
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Board grid */}
      <div className="flex-1 overflow-auto rounded-xl border border-white/5">
        {N === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-600 text-sm">
            No teams have joined yet
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `44px repeat(${N}, minmax(130px, 180px))`,
              gap: "4px",
              minWidth: `${44 + N * 134}px`,
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
                className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed leading-none"
                title="Enlarge"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                onClick={() => canShrink && setPanelSize(PANEL_ORDER[panelIdx - 1])}
                disabled={!canShrink}
                className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed leading-none"
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
                My Team ({myPicks.length})
              </button>
            </div>

            {bottomTab === "available" && (
              <>
                <div className="flex gap-1 bg-[#0f1117] rounded-lg p-0.5 ml-auto">
                  {(["all", "mpo", "fpo"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
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
                  className="bg-[#0f1117] border border-white/10 rounded-lg px-3 py-1 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] w-36"
                />
              </>
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
                <p className="text-gray-600 text-xs text-center py-6">No players found</p>
              ) : (
                filtered.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-3 px-3 py-2 border-b border-white/5 hover:bg-white/5 transition"
                  >
                    {isMyPick && draft?.status === "in_progress" ? (
                      <form
                        action={makeDraftPick.bind(null, leagueId, player.id)}
                        onSubmit={() => startTransition(() => { setTimeout(() => router.refresh(), 300); })}
                        className="shrink-0 -mr-2"
                      >
                        <button
                          type="submit"
                          className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-full transition"
                        >
                          Draft
                        </button>
                      </form>
                    ) : (
                      <span className="w-[60px] shrink-0 -mr-2" />
                    )}
                    <span className="text-gray-600 text-xs font-mono w-7 text-right shrink-0">
                      {tab === "all"
                        ? player.overallRank != null ? `#${player.overallRank}` : ""
                        : player.worldRanking != null ? `#${player.worldRanking}` : ""}
                    </span>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-white text-sm truncate min-w-0">{player.name}</span>
                      <span className={`text-xs font-semibold shrink-0 ${divColor(player.division)}`}>
                        {player.division}
                      </span>
                    </div>
                  </div>
                ))
              )
            ) : myPicks.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-6">No picks yet</p>
            ) : (
              myPicks.map((p) => (
                <div
                  key={p.pickNumber}
                  className="flex items-center gap-3 px-3 py-2 border-b border-white/5"
                >
                  <span className="text-gray-600 text-xs font-mono w-12 text-right shrink-0">
                    #{p.pickNumber}
                  </span>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-white text-sm truncate min-w-0">{p.playerName}</span>
                    <span className={`text-xs font-semibold shrink-0 ${divColor(p.playerDivision)}`}>
                      {p.playerDivision}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
