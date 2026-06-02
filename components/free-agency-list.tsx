"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AddWithDropModal } from "@/components/add-with-drop-modal";
import { cancelWaiverClaim, placeWaiverClaim } from "@/actions/rosters";

type Player = {
  id: number;
  name: string;
  division: string;
  worldRanking: number | null;
  overallRank: number | null;
  pdgaRating: number | null;
};

type FreeAgent = Player & { totalPoints: number; nextWeekPoints: number | null };

type LeaderboardPlayer = Player & {
  totalPoints: number;
  projectedPoints: number | null;
  nextWeekPoints: number | null;
  ownerTeamId: number | null;
  ownerTeamName: string | null;
};

type RosterPlayer = {
  player_id: number;
  players: { id: number; name: string; division: string } | null;
};

type DivisionTab = "all" | "mpo" | "fpo";
type ViewTab = "available" | "leaders";
type SortKey = "points" | "projected" | "rank";

type PendingClaim = {
  id: number;
  playerId: number;
  playerName: string;
  division: string;
  dropPlayerId: number | null;
};

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
  waiversLocked?: boolean;
  pendingClaims?: PendingClaim[];
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
  waiversLocked = false,
  pendingClaims = [],
}: Props) {
  const claimedPlayerIds = new Set(pendingClaims.map((c) => c.playerId));

  function actionButton(player: { id: number; name: string; division: string }) {
    if (overLimit || addsDisabled) {
      return (
        <span
          className="text-xs text-gray-400 py-1.5 shrink-0 ml-2 w-16 text-center"
          title={addsDisabled ? "Adds locked until draft completes" : undefined}
        >
          Add
        </span>
      );
    }
    if (waiversLocked) {
      if (claimedPlayerIds.has(player.id)) {
        const claim = pendingClaims.find((c) => c.playerId === player.id)!;
        return (
          <form action={cancelWaiverClaim.bind(null, leagueId, claim.id)} className="shrink-0 ml-2">
            <button
              type="submit"
              className="text-xs border border-yellow-400/40 text-yellow-300 hover:text-white hover:border-yellow-300 py-2 rounded-full font-medium transition w-16 text-center min-h-[40px] md:min-h-0 md:py-1.5 inline-flex items-center justify-center"
            >
              Pending
            </button>
          </form>
        );
      }
      return (
        <form action={placeWaiverClaim.bind(null, leagueId, player.id, undefined)} className="shrink-0 ml-2">
          <button
            type="submit"
            className="text-xs bg-yellow-400 hover:bg-yellow-300 text-black py-2 rounded-full font-medium transition w-16 text-center min-h-[40px] md:min-h-0 md:py-1.5 inline-flex items-center justify-center"
          >
            Claim
          </button>
        </form>
      );
    }
    return (
      <AddWithDropModal
        leagueId={leagueId}
        addPlayer={{ id: player.id, name: player.name, division: player.division }}
        myRoster={myRoster}
        openSpots={openSpots}
      />
    );
  }
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view: ViewTab = searchParams.get("view") === "leaders" ? "leaders" : "available";
  const divParam = searchParams.get("div");
  const tab: DivisionTab = divParam === "mpo" || divParam === "fpo" ? divParam : "all";
  const sortParam = searchParams.get("sort");
  const sort: SortKey =
    sortParam === "projected" || sortParam === "rank" || sortParam === "points"
      ? sortParam
      : (seasonStarted ? "points" : "rank");

  function pushParams(next: { view?: ViewTab; tab?: DivisionTab; sort?: SortKey }) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next.view !== undefined) {
      if (next.view === "available") sp.delete("view");
      else sp.set("view", next.view);
    }
    if (next.tab !== undefined) {
      if (next.tab === "all") sp.delete("div");
      else sp.set("div", next.tab);
    }
    if (next.sort !== undefined) sp.set("sort", next.sort);
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
  function setSort(next: SortKey) {
    if (next === sort) return;
    pushParams({ sort: next });
  }

  const divisionFilter = (p: { division: string }) =>
    tab === "all" || (tab === "mpo" ? p.division === "MPO" : p.division === "FPO");

  function compareBySort<T extends { totalPoints: number; nextWeekPoints: number | null; overallRank: number | null; worldRanking: number | null; name: string }>(a: T, b: T): number {
    if (sort === "points") return b.totalPoints - a.totalPoints;
    if (sort === "projected") {
      const av = a.nextWeekPoints ?? -1;
      const bv = b.nextWeekPoints ?? -1;
      if (av !== bv) return bv - av;
      return b.totalPoints - a.totalPoints;
    }
    // sort === "rank"
    if (tab === "all") return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
    if (a.worldRanking == null && b.worldRanking == null) return a.name.localeCompare(b.name);
    if (a.worldRanking == null) return 1;
    if (b.worldRanking == null) return -1;
    return a.worldRanking - b.worldRanking;
  }

  const filteredAgents = freeAgents.filter(divisionFilter).sort(compareBySort);
  const filteredLeaders = leaderboard.filter(divisionFilter).sort(compareBySort);

  return (
    <div className="space-y-3">
      {/* View toggle */}
      <div className="flex gap-1 bg-[#1a1d23] border border-white/5 rounded-xl p-1 w-fit">
        <button
          onClick={() => setView("available")}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
            view === "available" ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Free Agents
        </button>
        <button
          onClick={() => setView("leaders")}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
            view === "leaders" ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Leaders
        </button>
      </div>

      {/* Division filter + sort selector */}
      <div className="flex flex-wrap items-center gap-2">
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
                  : "text-gray-400 hover:text-gray-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-400 ml-auto">
          <span className="uppercase tracking-wide font-semibold">Sort</span>
          <div className="flex gap-1 bg-[#1a1d23] border border-white/5 rounded-xl p-1 w-fit">
            {([
              { key: "points", label: "Points" },
              { key: "projected", label: "Projected" },
              { key: "rank", label: "Ranking" },
            ] as { key: SortKey; label: string }[]).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSort(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
                  sort === opt.key
                    ? "bg-[#4B3DFF] text-white"
                    : "text-gray-400 hover:text-gray-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      {view === "available" ? (
        filteredAgents.length === 0 ? (
          <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
            <p className="text-gray-400 text-sm">No free agents in this division.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredAgents.map((player) => {
              let primary: string | null = null;
              if (sort === "projected") {
                primary = player.nextWeekPoints != null
                  ? `~${player.nextWeekPoints.toFixed(1)}`
                  : "—";
              } else if (sort === "rank") {
                primary = tab === "all"
                  ? (player.overallRank != null ? `#${player.overallRank}` : null)
                  : (player.worldRanking != null ? `#${player.worldRanking}` : null);
              } else if (seasonStarted) {
                primary = player.totalPoints.toFixed(1);
              } else {
                primary = tab === "all"
                  ? (player.overallRank != null ? `#${player.overallRank}` : null)
                  : (player.worldRanking != null ? `#${player.worldRanking}` : null);
              }
              return (
                <PlayerRow
                  key={player.id}
                  player={player}
                  leagueId={leagueId}
                  rank={primary}
                  rightSlot={null}
                  addControl={actionButton(player)}
                />
              );
            })}
          </div>
        )
      ) : (
        <div className="space-y-1">
          {filteredLeaders.map((player) => {
            const isFreeAgent = player.ownerTeamId == null;
            const isMine = player.ownerTeamId === myTeamId;

            const addControl = isFreeAgent ? (
              actionButton(player)
            ) : isMine ? (
              <span className="shrink-0 ml-2 w-16" />
            ) : (
              <Link
                href={`/league/${leagueId}/trades?with=${player.ownerTeamId}&want=${player.id}`}
                className="text-xs bg-[#36D7B7] hover:bg-[#2bc4a6] text-black py-2 rounded-full font-medium transition shrink-0 ml-2 w-16 text-center min-h-[40px] md:min-h-0 md:py-1.5 inline-flex items-center justify-center"
                title={player.ownerTeamName ? `Trade with ${player.ownerTeamName}` : "Propose a trade"}
              >
                Trade
              </Link>
            );

            const primary = sort === "projected"
              ? (player.nextWeekPoints != null ? `~${player.nextWeekPoints.toFixed(1)}` : "—")
              : sort === "rank"
              ? (tab === "all"
                  ? (player.overallRank != null ? `#${player.overallRank}` : "—")
                  : (player.worldRanking != null ? `#${player.worldRanking}` : "—"))
              : player.totalPoints.toFixed(1);
            const rightSlot = (
              <div className="flex flex-col items-end shrink-0 w-16 text-right">
                <span className="text-white font-bold text-sm tabular-nums leading-tight">
                  {primary}
                </span>
              </div>
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
    <div className="bg-[#1a1d23] border border-white/5 rounded-xl px-3 py-2.5 flex items-center gap-2 sm:gap-3">
      {addControl}

      {rank != null && (
        <span className="text-white font-bold text-sm font-mono w-10 sm:w-12 shrink-0 text-right">
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
          <span className="text-gray-400 text-xs truncate">→ {ownerName}</span>
        )}
      </div>

      <span
        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
        style={{ color: accentColor, background: `${accentColor}20` }}
      >
        {player.division}
      </span>

      {player.pdgaRating != null && (
        <span
          className="text-[11px] font-semibold tabular-nums text-gray-400 shrink-0 w-9 text-right"
          title="Current PDGA Rating"
        >
          {player.pdgaRating}
        </span>
      )}

      {rightSlot}
    </div>
  );
}
