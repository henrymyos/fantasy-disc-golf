"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Player = {
  id: number;
  name: string;
  division: "MPO" | "FPO";
  worldRanking: number | null;
  overallRank: number | null;
};

type Pick = {
  pickNumber: number;     // 1-based overall pick number
  round: number;          // 1-based
  teamIndex: number;      // 0-based team index
  playerId: number | null;
};

type Phase = "setup" | "drafting" | "complete";

type Tab = "all" | "mpo" | "fpo";

const BOT_PICK_DELAY_MS = 1000;

/** Snake order: returns the 0-based team index for a given 0-based pick index. */
function teamIndexForPick(pickIndex: number, numTeams: number): number {
  const round = Math.floor(pickIndex / numTeams); // 0-based round
  const slot = pickIndex % numTeams;
  return round % 2 === 0 ? slot : numTeams - 1 - slot;
}

/** Builds the per-team pick numbers for a snake draft. */
function pickNumberFor(round: number, draftPosition: number, numTeams: number): number {
  // round is 1-based, draftPosition is 1-based
  const isReversed = round % 2 === 0;
  return (round - 1) * numTeams + (isReversed ? numTeams - draftPosition + 1 : draftPosition);
}

type Props = {
  leagueId: string;
  leagueName: string;
  numTeams: number;
  rosterSize: number;
  mpoStarters: number;
  fpoStarters: number;
  players: Player[];
};

export function MockDraft({
  leagueId,
  leagueName,
  numTeams,
  rosterSize,
  players,
}: Props) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [myDraftPosition, setMyDraftPosition] = useState<number>(1); // 1-based
  const [picks, setPicks] = useState<Pick[]>([]);
  const [currentPickIndex, setCurrentPickIndex] = useState<number>(0);
  const [tab, setTab] = useState<Tab>("all");
  const boardRef = useRef<HTMLDivElement | null>(null);
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPicks = numTeams * rosterSize;

  // Build a sorted master list of players by overallRank (then fallback worldRanking, then name)
  const sortedAll = useMemo(() => {
    const copy = [...players];
    copy.sort((a, b) => {
      const ar = a.overallRank ?? Number.POSITIVE_INFINITY;
      const br = b.overallRank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      const aw = a.worldRanking ?? Number.POSITIVE_INFINITY;
      const bw = b.worldRanking ?? Number.POSITIVE_INFINITY;
      if (aw !== bw) return aw - bw;
      return a.name.localeCompare(b.name);
    });
    return copy;
  }, [players]);

  const playerById = useMemo(() => {
    const m: Record<number, Player> = {};
    for (const p of players) m[p.id] = p;
    return m;
  }, [players]);

  const takenIds = useMemo(() => {
    const s = new Set<number>();
    for (const p of picks) if (p.playerId != null) s.add(p.playerId);
    return s;
  }, [picks]);

  const availableSorted = useMemo(
    () => sortedAll.filter((p) => !takenIds.has(p.id)),
    [sortedAll, takenIds]
  );

  const myTeamIndex = myDraftPosition - 1;
  const onClockTeamIndex = phase === "drafting" ? teamIndexForPick(currentPickIndex, numTeams) : -1;
  const isMyTurn = phase === "drafting" && onClockTeamIndex === myTeamIndex;
  const currentRound = Math.floor(currentPickIndex / numTeams) + 1;

  function start() {
    // Build empty pick slots
    const empty: Pick[] = [];
    for (let i = 0; i < totalPicks; i++) {
      empty.push({
        pickNumber: i + 1,
        round: Math.floor(i / numTeams) + 1,
        teamIndex: teamIndexForPick(i, numTeams),
        playerId: null,
      });
    }
    setPicks(empty);
    setCurrentPickIndex(0);
    setPhase("drafting");
  }

  function makePick(playerId: number) {
    if (phase !== "drafting") return;
    if (currentPickIndex >= totalPicks) return;
    setPicks((prev) => {
      const next = [...prev];
      if (next[currentPickIndex].playerId != null) return prev;
      next[currentPickIndex] = { ...next[currentPickIndex], playerId };
      return next;
    });
    setCurrentPickIndex((idx) => idx + 1);
  }

  // Bot picking loop
  useEffect(() => {
    if (phase !== "drafting") return;
    if (currentPickIndex >= totalPicks) {
      setPhase("complete");
      return;
    }
    if (onClockTeamIndex === myTeamIndex) return; // user's turn

    botTimer.current = setTimeout(() => {
      const top = availableSorted[0];
      if (top) makePick(top.id);
    }, BOT_PICK_DELAY_MS);

    return () => {
      if (botTimer.current) clearTimeout(botTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentPickIndex, onClockTeamIndex, myTeamIndex, availableSorted, totalPicks]);

  // Scroll the board to keep the current row in view
  useEffect(() => {
    if (phase !== "drafting" || !boardRef.current) return;
    const row = boardRef.current.querySelector<HTMLDivElement>(`[data-round="${currentRound}"]`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentRound, phase]);

  function reset() {
    if (botTimer.current) clearTimeout(botTimer.current);
    setPicks([]);
    setCurrentPickIndex(0);
    setPhase("setup");
  }

  // ── SETUP PHASE ───────────────────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <Link
            href={`/league/${leagueId}`}
            className="text-gray-400 hover:text-white text-sm transition inline-block mb-4"
          >
            ← {leagueName}
          </Link>
          <h2 className="text-white font-bold text-xl">Mock Draft</h2>
          <p className="text-gray-500 text-sm mt-1">
            {numTeams} teams · {rosterSize} rounds · snake order · bots take {(BOT_PICK_DELAY_MS / 1000).toFixed(0)}s per pick
          </p>
        </div>

        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-4">
          <div>
            <p className="text-white font-semibold text-sm mb-2">Choose your draft position</p>
            <p className="text-gray-500 text-xs mb-4">
              Pick 1 goes first overall; pick {numTeams} goes last. Snake reverses each round.
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {Array.from({ length: numTeams }, (_, i) => i + 1).map((pos) => {
                const selected = pos === myDraftPosition;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setMyDraftPosition(pos)}
                    className={`py-3 rounded-lg text-sm font-bold transition border ${
                      selected
                        ? "bg-[#4B3DFF] border-[#4B3DFF] text-white"
                        : "bg-[#0f1117] border-white/10 text-gray-300 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={start}
            className="w-full bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold py-3 rounded-lg transition"
          >
            Start Draft
          </button>
        </div>
      </div>
    );
  }

  // ── DRAFTING & COMPLETE PHASES ────────────────────────────────────────────
  const myPicks = picks.filter((p) => p.teamIndex === myTeamIndex && p.playerId != null);

  return (
    <div className="space-y-4 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link
            href={`/league/${leagueId}`}
            className="text-gray-400 hover:text-white text-sm transition inline-block mb-1"
          >
            ← {leagueName}
          </Link>
          <h2 className="text-white font-bold text-lg">
            Mock Draft {phase === "complete" && <span className="text-[#36D7B7] text-sm font-semibold">· Complete</span>}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs bg-white/5 px-3 py-1.5 rounded-full">
            Your pick: <span className="text-white font-semibold">#{myDraftPosition}</span>
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-gray-400 hover:text-white text-xs border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-full transition"
          >
            Reset
          </button>
        </div>
      </div>

      {/* On the clock banner */}
      {phase === "drafting" && (
        <div
          className={`rounded-xl px-4 py-3 border ${
            isMyTurn
              ? "bg-[#36D7B7]/15 border-[#36D7B7]/40"
              : "bg-[#0f1117] border-white/10"
          }`}
        >
          <p className="text-xs uppercase tracking-wider font-semibold text-gray-500">
            Round {currentRound} · Pick {currentPickIndex + 1} of {totalPicks}
          </p>
          <p className="text-base font-bold mt-0.5">
            {isMyTurn ? (
              <span className="text-[#36D7B7]">You&apos;re on the clock</span>
            ) : (
              <span className="text-white">
                Team {onClockTeamIndex + 1} is picking…
              </span>
            )}
          </p>
        </div>
      )}

      {/* Draft board grid */}
      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        <div
          ref={boardRef}
          className="overflow-x-auto overflow-y-auto max-h-[60vh]"
        >
          {/* Column header (team labels) */}
          <div
            className="grid sticky top-0 z-10 bg-[#1a1d23] border-b border-white/10"
            style={{
              gridTemplateColumns: `48px repeat(${numTeams}, minmax(120px, 1fr))`,
            }}
          >
            <div className="text-[10px] font-bold uppercase text-gray-600 px-2 py-2">Rd</div>
            {Array.from({ length: numTeams }, (_, i) => {
              const isMine = i === myTeamIndex;
              return (
                <div
                  key={i}
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-2 text-center truncate ${
                    isMine ? "text-[#36D7B7]" : "text-gray-500"
                  }`}
                >
                  {isMine ? "You" : `Team ${i + 1}`}
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {Array.from({ length: rosterSize }, (_, roundIdx) => {
            const round = roundIdx + 1;
            return (
              <div
                key={round}
                data-round={round}
                className="grid border-b border-white/5 last:border-0"
                style={{
                  gridTemplateColumns: `48px repeat(${numTeams}, minmax(120px, 1fr))`,
                }}
              >
                <div className="text-xs font-bold text-gray-600 px-2 py-2 flex items-center">
                  R{round}
                </div>
                {Array.from({ length: numTeams }, (_, teamIdx) => {
                  // Find the pick belonging to this (round, teamIdx)
                  const pickNumber = pickNumberFor(round, teamIdx + 1, numTeams);
                  const pick = picks[pickNumber - 1];
                  const isCurrent = phase === "drafting" && pick && currentPickIndex === pickNumber - 1;
                  const isMine = teamIdx === myTeamIndex;
                  const player = pick?.playerId ? playerById[pick.playerId] : null;
                  const isMpo = player?.division === "MPO";
                  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";

                  return (
                    <div
                      key={teamIdx}
                      className={`px-2 py-1.5 min-h-[58px] flex flex-col justify-center text-xs border-l border-white/5 ${
                        isCurrent ? "bg-[#36D7B7]/10" : ""
                      } ${isMine ? "bg-[#36D7B7]/5" : ""}`}
                      style={
                        player
                          ? { background: `${accentColor}18` }
                          : {}
                      }
                    >
                      <div className="text-[10px] text-gray-600 font-mono">
                        #{pickNumber}
                      </div>
                      {player ? (
                        <div className="min-w-0">
                          <div
                            className="text-white font-semibold text-xs truncate"
                            title={player.name}
                          >
                            {player.name}
                          </div>
                          <div
                            className="text-[10px] font-bold uppercase tracking-wider"
                            style={{ color: accentColor }}
                          >
                            {player.division}
                          </div>
                        </div>
                      ) : (
                        <div className={`text-[10px] ${isCurrent ? "text-[#36D7B7]" : "text-gray-700"}`}>
                          {isCurrent ? "On clock" : "—"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* My team summary */}
      {myPicks.length > 0 && (
        <div className="bg-[#1a1d23] rounded-2xl border border-white/5 p-4">
          <p className="text-white font-semibold text-sm mb-3">Your team ({myPicks.length})</p>
          <div className="flex flex-wrap gap-2">
            {myPicks.map((p) => {
              const player = playerById[p.playerId!];
              const isMpo = player.division === "MPO";
              const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";
              return (
                <div
                  key={p.pickNumber}
                  className="text-xs border rounded-lg px-2 py-1 flex items-center gap-2"
                  style={{ borderColor: `${accentColor}40`, background: `${accentColor}10` }}
                >
                  <span className="text-gray-500 font-mono">#{p.pickNumber}</span>
                  <span className="text-white font-medium">{player.name}</span>
                  <span className="font-bold uppercase text-[10px]" style={{ color: accentColor }}>
                    {player.division}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Player picker (only when it's user's turn) */}
      {phase === "drafting" && isMyTurn && (
        <div className="fixed bottom-0 left-0 md:left-14 lg:left-56 right-0 z-40 bg-[#0f1117]/95 backdrop-blur-sm border-t border-white/5 px-4 lg:px-6 py-3">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[#36D7B7] font-bold text-sm">
                Pick a player (round {currentRound})
              </p>
              <div className="flex gap-1 bg-[#1a1d23] border border-white/5 rounded-lg p-0.5">
                {(["all", "mpo", "fpo"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${
                      t === tab
                        ? t === "mpo"
                          ? "bg-[#4B3DFF] text-white"
                          : t === "fpo"
                          ? "bg-[#36D7B7] text-black"
                          : "bg-white/10 text-white"
                        : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {availableSorted
                .filter((p) => tab === "all" || (tab === "mpo" ? p.division === "MPO" : p.division === "FPO"))
                .slice(0, 20)
                .map((player) => {
                  const isMpo = player.division === "MPO";
                  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";
                  const rank = tab === "all" ? player.overallRank : player.worldRanking;
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => makePick(player.id)}
                      className="shrink-0 border rounded-xl px-3 py-2 flex flex-col gap-0.5 hover:bg-white/5 hover:border-white/30 transition text-left"
                      style={{ borderColor: `${accentColor}40`, background: `${accentColor}10` }}
                    >
                      <span className="text-gray-500 text-[10px] font-mono">
                        {rank != null ? `#${rank}` : "—"}
                      </span>
                      <span className="text-white text-sm font-semibold whitespace-nowrap">
                        {player.name}
                      </span>
                      <span className="text-[10px] font-bold uppercase" style={{ color: accentColor }}>
                        {player.division}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {phase === "complete" && (
        <div className="bg-[#36D7B7]/10 border border-[#36D7B7]/30 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-[#36D7B7] font-bold">Mock draft complete</p>
            <p className="text-gray-400 text-xs mt-1">
              You drafted {myPicks.length} players across {rosterSize} rounds.
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="bg-[#4B3DFF] hover:bg-[#3a2eff] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            Run another
          </button>
        </div>
      )}
    </div>
  );
}
