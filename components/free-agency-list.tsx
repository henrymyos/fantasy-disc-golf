"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AddWithDropModal } from "@/components/add-with-drop-modal";

type Player = {
  id: number;
  name: string;
  division: string;
  worldRanking: number | null;
  overallRank: number | null;
};

type FreeAgent = Player & { totalPoints: number };

type LeaderboardPlayer = Player & {
  totalPoints: number;
  ownerTeamId: number | null;
  ownerTeamName: string | null;
};

type RosterPlayer = {
  player_id: number;
  players: { id: number; name: string; division: string } | null;
};

type DivisionTab = "all" | "mpo" | "fpo";
type ViewTab = "available" | "leaders";

type Props = {
  leagueId: number;
  freeAgents: FreeAgent[];
  leaderboard: LeaderboardPlayer[];
  myRoster: RosterPlayer[];
  openSpots: number;
  overLimit: boolean;
  addsDisabled?: boolean;
  myTeamId: number;
  seasonStarted: boolean;
};

export function FreeAgencyList({
  leagueId,
  freeAgents,
  leaderboard,
  myRoster,
  openSpots,
  overLimit,
  addsDisabled = false,
  myTeamId,
  seasonStarted,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view: ViewTab = searchParams.get("view") === "leaders" ? "leaders" : "available";
  const divParam = searchParams.get("div");
  const tab: DivisionTab = divParam === "mpo" || divParam === "fpo" ? divParam : "all";

  function pushParams(next: { view?: ViewTab; tab?: DivisionTab }) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next.view !== undefined) {
      if (next.view === "available") sp.delete("view");
      else sp.set("view", next.view);
    }
    if (next.tab !== undefined) {
      if (next.tab === "all") sp.delete("div");
      else sp.set("div", next.tab);
    }
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  function setView(next: ViewTab) {
    if (next === view) return;
    pushParams({ view: next });
  }
  function setTab(next: DivisionTab) {
    if (next === tab) return;
    pushParams({ tab: next });
  }

  const divisionFilter = (p: { division: string }) =>
    tab === "all" || (tab === "mpo" ? p.division === "MPO" : p.division === "FPO");

  const filteredAgents = freeAgents.filter(divisionFilter).sort((a, b) => {
    if (seasonStarted) return b.totalPoints - a.totalPoints;
    if (tab === "all") return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
    if (a.worldRanking == null && b.worldRanking == null) return a.name.localeCompare(b.name);
    if (a.worldRanking == null) return 1;
    if (b.worldRanking == null) return -1;
    return a.worldRanking - b.worldRanking;
  });

  const filteredLeaders = leaderboard.filter(divisionFilter);

  return (
    <div className="space-y-3">
      {/* View toggle */}
      <div className="flex gap-1 bg-[#1a1d23] border border-white/5 rounded-xl p-1 w-fit">
        <button
          onClick={() => setView("available")}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
            view === "available" ? "bg-[#4B3DFF] text-white" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Free Agents
        </button>
        <button
          onClick={() => setView("leaders")}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
            view === "leaders" ? "bg-[#4B3DFF] text-white" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Points Leaders
        </button>
      </div>

      {/* Division filter */}
      <div className="flex gap-1 bg-[#1a1d23] border border-white/5 rounded-xl p-1 w-fit">
        {(["all", "mpo", "fpo"] as DivisionTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
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

      {/* Body */}
      {view === "available" ? (
        filteredAgents.length === 0 ? (
          <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
            <p className="text-gray-600 text-sm">No free agents in this division.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredAgents.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                leagueId={leagueId}
                rank={seasonStarted
                  ? player.totalPoints.toFixed(1)
                  : (tab === "all"
                      ? (player.overallRank != null ? `#${player.overallRank}` : null)
                      : (player.worldRanking != null ? `#${player.worldRanking}` : null))}
                rightSlot={null}
                addControl={
                  overLimit || addsDisabled ? (
                    <span
                      className="text-xs text-gray-600 px-3 py-1.5 shrink-0"
                      title={addsDisabled ? "Adds locked until draft completes" : undefined}
                    >
                      Add
                    </span>
                  ) : (
                    <AddWithDropModal
                      leagueId={leagueId}
                      addPlayer={{ id: player.id, name: player.name, division: player.division }}
                      myRoster={myRoster}
                      openSpots={openSpots}
                    />
                  )
                }
              />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-1">
          {filteredLeaders.map((player) => {
            const isFreeAgent = player.ownerTeamId == null;
            const isMine = player.ownerTeamId === myTeamId;

            const addControl = isFreeAgent ? (
              overLimit || addsDisabled ? (
                <span
                  className="text-xs text-gray-600 py-1.5 shrink-0 ml-2 w-16 text-center"
                  title={addsDisabled ? "Adds locked until draft completes" : undefined}
                >
                  Add
                </span>
              ) : (
                <AddWithDropModal
                  leagueId={leagueId}
                  addPlayer={{ id: player.id, name: player.name, division: player.division }}
                  myRoster={myRoster}
                  openSpots={openSpots}
                />
              )
            ) : isMine ? (
              <span className="shrink-0 ml-2 w-16" />
            ) : (
              <Link
                href={`/league/${leagueId}/trades?with=${player.ownerTeamId}&want=${player.id}`}
                className="text-xs bg-[#36D7B7] hover:bg-[#2bc4a6] text-black py-1.5 rounded-full font-medium transition shrink-0 ml-2 w-16 text-center"
                title={player.ownerTeamName ? `Trade with ${player.ownerTeamName}` : "Propose a trade"}
              >
                Trade
              </Link>
            );

            const rightSlot = (
              <span className="text-white font-bold text-sm tabular-nums w-12 text-right shrink-0">
                {player.totalPoints.toFixed(1)}
              </span>
            );

            return (
              <PlayerRow
                key={player.id}
                player={player}
                leagueId={leagueId}
                rank={null}
                addControl={addControl}
                rightSlot={rightSlot}
                ownerName={isFreeAgent ? null : player.ownerTeamName}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  leagueId,
  rank,
  addControl,
  rightSlot,
  ownerName = null,
}: {
  player: Player;
  leagueId: number;
  rank: string | null;
  addControl: React.ReactNode;
  rightSlot: React.ReactNode;
  ownerName?: string | null;
}) {
  const isMpo = player.division === "MPO";
  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";

  return (
    <div className="bg-[#1a1d23] border border-white/5 rounded-xl px-3 py-2.5 flex items-center gap-3">
      {addControl}

      {rank != null && (
        <span className="text-white font-bold text-sm font-mono w-12 shrink-0 text-right">
          {rank}
        </span>
      )}

      <div className="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
        <Link
          href={`/league/${leagueId}/player/${player.id}`}
          className="text-white font-medium text-sm truncate hover:underline"
        >
          {player.name}
        </Link>
        {ownerName && (
          <span className="text-gray-500 text-xs truncate">→ {ownerName}</span>
        )}
      </div>

      <span
        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
        style={{ color: accentColor, background: `${accentColor}20` }}
      >
        {player.division}
      </span>

      {rightSlot}
    </div>
  );
}
