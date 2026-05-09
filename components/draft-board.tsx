"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDraft, pauseDraft, resumeDraft, makeDraftPick } from "@/actions/drafts";

type DraftInfo = { id: number; status: string; currentPick: number; totalRounds: number };
type Member = { id: number; teamName: string; draftPosition: number };
type PickInfo = { pickNumber: number; teamId: number; playerName: string; playerDivision: string };
type AvailablePlayer = { id: number; name: string; division: string; worldRanking: number | null; overallRank: number | null };
type Tab = "all" | "mpo" | "fpo";

type Props = {
  leagueId: number;
  draft: DraftInfo | null;
  members: Member[];
  picks: PickInfo[];
  availablePlayers: AvailablePlayer[];
  myMemberId: number | null;
  isCommissioner: boolean;
};

function getPickNumber(round: number, draftPosition: number, numTeams: number): number {
  const isReversed = round % 2 === 0;
  return (round - 1) * numTeams + (isReversed ? numTeams - draftPosition + 1 : draftPosition);
}

function divColor(division: string) {
  return division === "MPO" ? "text-[#4B3DFF]" : "text-[#36D7B7]";
}

export function DraftBoard({ leagueId, draft, members, picks, availablePlayers, myMemberId, isCommissioner }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  // Poll when draft is live
  useEffect(() => {
    if (draft?.status !== "in_progress") return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [draft?.status, router]);

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
    <div key="corner" className="bg-[#0f1117] p-2 sticky left-0 z-10" />
  );

  // Team header cells
  members.forEach((m) => {
    const isOnClock = m.id === currentPickTeamId && draft?.status === "in_progress";
    const isMe = m.id === myMemberId;
    gridCells.push(
      <div
        key={`h-${m.id}`}
        className={`bg-[#0f1117] px-2 py-2.5 text-center border-b-2 ${isOnClock ? "border-[#36D7B7]" : "border-transparent"}`}
      >
        <p className={`text-xs font-bold truncate ${isMe ? "text-white" : "text-gray-400"}`}>
          {m.draftPosition}. {m.teamName}
          {isMe && <span className="text-gray-600 font-normal"> (you)</span>}
        </p>
        {isOnClock && (
          <p className="text-[10px] text-[#36D7B7] font-semibold animate-pulse mt-0.5">ON THE CLOCK</p>
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
        className={`bg-[#0f1117] flex items-center justify-center sticky left-0 z-10 ${isCurrentRound ? "text-white font-bold" : "text-gray-600"}`}
      >
        <span className="text-xs font-mono">R{round}</span>
      </div>
    );

    // Pick cells for each team
    members.forEach((m) => {
      const pickNum = getPickNumber(round, m.draftPosition, N);
      const pick = pickMap.get(pickNum);
      const isCurrent =
        pickNum === currentPick && (draft?.status === "in_progress" || draft?.status === "paused");
      const isPast = pickNum < currentPick && draft?.status !== "pending";

      gridCells.push(
        <div
          key={`${round}-${m.id}`}
          className={`relative flex flex-col justify-center px-2 py-2 min-h-[56px] transition-colors ${
            isCurrent
              ? "bg-[#36D7B7]/10 ring-2 ring-[#36D7B7] ring-inset"
              : isPast && !pick
              ? "bg-[#0f1117]/60"
              : "bg-[#1a1d23]"
          }`}
        >
          {pick ? (
            <>
              <span className={`text-[10px] font-bold ${divColor(pick.playerDivision)}`}>
                {pick.playerDivision}
              </span>
              <span className="text-white text-xs font-medium leading-tight mt-0.5 truncate">
                {pick.playerName}
              </span>
            </>
          ) : isCurrent ? (
            <span className="text-[#36D7B7] text-xs text-center animate-pulse">⏳</span>
          ) : (
            <span className="text-gray-700 text-[10px] text-center font-mono">{pickNum}</span>
          )}
        </div>
      );
    });
  }

  const drafted = draft?.status === "in_progress" || draft?.status === "paused" || draft?.status === "complete";

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
              gridTemplateColumns: `44px repeat(${N}, minmax(130px, 1fr))`,
              gap: "1px",
              backgroundColor: "rgba(255,255,255,0.05)",
              minWidth: `${44 + N * 130}px`,
            }}
          >
            {gridCells}
          </div>
        )}
      </div>

      {/* Player picker */}
      {drafted && (
        <div className="shrink-0 mt-2 rounded-xl border border-white/5 bg-[#1a1d23] flex flex-col" style={{ height: "240px" }}>
          {/* Picker header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0">
            <span className={`text-xs font-bold ${isMyPick ? "text-[#36D7B7] animate-pulse" : "text-gray-500"}`}>
              {isMyPick ? "YOUR PICK — select a player" : draft?.status === "complete" ? "Draft complete" : `Available Players (${availablePlayers.length})`}
            </span>
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
          </div>

          {/* Player rows */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <p className="text-gray-600 text-xs text-center py-6">No players found</p>
            )}
            {filtered.map((player) => (
              <div
                key={player.id}
                className="flex items-center gap-2 px-3 py-2 border-b border-white/5 hover:bg-white/5 transition"
              >
                <span className="text-gray-600 text-xs font-mono w-7 text-right shrink-0">
                  {tab === "all"
                    ? player.overallRank != null ? `#${player.overallRank}` : ""
                    : player.worldRanking != null ? `#${player.worldRanking}` : ""}
                </span>
                <span className="flex-1 text-white text-sm truncate">{player.name}</span>
                <span className={`text-xs font-semibold shrink-0 ${divColor(player.division)}`}>
                  {player.division}
                </span>
                {isMyPick && draft?.status === "in_progress" && (
                  <form
                    action={makeDraftPick.bind(null, leagueId, player.id)}
                    onSubmit={() => startTransition(() => { setTimeout(() => router.refresh(), 300); })}
                  >
                    <button
                      type="submit"
                      className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-full transition shrink-0"
                    >
                      Draft
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
