"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AddWithDropModal } from "@/components/add-with-drop-modal";
import { cancelWaiverClaim } from "@/actions/rosters";
import { toggleWatchlist } from "@/actions/watchlist";

type LastEvent = { name: string; pts: number; finish: number | null } | null;

type Player = {
  id: number;
  name: string;
  division: string;
  worldRanking: number | null;
  overallRank: number | null;
  pdgaRating: number | null;
  avatarUrl?: string | null;
  lastEvent?: LastEvent;
  formDelta?: number | null;
  outNext?: boolean;
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
  projection?: number | null;
  players: { id: number; name: string; division: string } | null;
};

type DivisionTab = "all" | "mpo" | "fpo" | "watch";
type ViewTab = "available" | "leaders";
type SortKey = "points" | "projected" | "rank" | "hot";

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
  initialWatchlist?: number[];
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
  initialWatchlist = [],
}: Props) {
  const claimedPlayerIds = new Set(pendingClaims.map((c) => c.playerId));

  // Starred players — optimistic local state, persisted via toggleWatchlist.
  const [starred, setStarred] = useState<Set<number>>(() => new Set(initialWatchlist));
  function toggleStar(playerId: number) {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
    toggleWatchlist(leagueId, playerId).then((res) => {
      if (!res.ok) {
        // Persist failed (e.g. migration not run) — revert the optimistic flip.
        setStarred((prev) => {
          const next = new Set(prev);
          if (next.has(playerId)) next.delete(playerId);
          else next.add(playerId);
          return next;
        });
      }
    });
  }

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
        <AddWithDropModal
          mode="waiver"
          leagueId={leagueId}
          addPlayer={{ id: player.id, name: player.name, division: player.division }}
          myRoster={myRoster}
          openSpots={openSpots}
        />
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
  // View / division / sort only drive client-side filtering of already-loaded
  // data — the server page doesn't read them — so keep them in local state for
  // instant updates instead of a slow router.push that re-renders the whole
  // server page. Initial values still honor a deep link.
  const searchParams = useSearchParams();
  const [view, setView] = useState<ViewTab>(() =>
    searchParams.get("view") === "leaders" ? "leaders" : "available",
  );
  const [tab, setTab] = useState<DivisionTab>(() => {
    const d = searchParams.get("div");
    return d === "mpo" || d === "fpo" ? d : "all";
  });
  // Default to Projected once there's scoring data: season-total points rank
  // players who may not even be playing next week, while the projection is
  // registration-aware for the league's next event. Pre-season there's nothing
  // to project from, so fall back to world ranking.
  const [sort, setSort] = useState<SortKey>(() => {
    const s = searchParams.get("sort");
    return s === "projected" || s === "rank" || s === "points"
      ? s
      : seasonStarted
        ? "projected"
        : "rank";
  });

  const divisionFilter = (p: { division: string; id: number }) =>
    tab === "all"
      ? true
      : tab === "watch"
        ? starred.has(p.id)
        : tab === "mpo"
          ? p.division === "MPO"
          : p.division === "FPO";

  function compareBySort<T extends { totalPoints: number; nextWeekPoints: number | null; overallRank: number | null; worldRanking: number | null; name: string; formDelta?: number | null }>(a: T, b: T): number {
    if (sort === "points") return b.totalPoints - a.totalPoints;
    if (sort === "hot") {
      const av = a.formDelta ?? -999;
      const bv = b.formDelta ?? -999;
      if (av !== bv) return bv - av;
      return b.totalPoints - a.totalPoints;
    }
    if (sort === "projected") {
      const av = a.nextWeekPoints ?? -1;
      const bv = b.nextWeekPoints ?? -1;
      if (av !== bv) return bv - av;
      return b.totalPoints - a.totalPoints;
    }
    // sort === "rank"
    if (tab !== "mpo" && tab !== "fpo") return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
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
          {(["all", "mpo", "fpo", "watch"] as DivisionTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
                t === tab
                  ? t === "mpo"
                    ? "bg-[#4B3DFF] text-white"
                    : t === "fpo"
                    ? "bg-[#36D7B7] text-black"
                    : t === "watch"
                    ? "bg-[#F5A623] text-black"
                    : "bg-white/10 text-white"
                  : "text-gray-400 hover:text-gray-300"
              }`}
              title={t === "watch" ? "Your watchlist" : undefined}
            >
              {t === "watch" ? "★" : t}
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
              { key: "hot", label: "Hot" },
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
            <p className="text-gray-400 text-sm">
              {tab === "watch"
                ? "No starred players yet — tap the ☆ on a player to watch them."
                : "No free agents in this division."}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredAgents.map((player) => {
              const primary = sort === "projected"
                ? (player.nextWeekPoints != null ? player.nextWeekPoints.toFixed(1) : "—")
                : sort === "hot"
                ? (player.formDelta != null
                    ? `${player.formDelta > 0 ? "+" : ""}${player.formDelta.toFixed(1)}`
                    : "—")
                : sort === "rank"
                ? (tab !== "mpo" && tab !== "fpo"
                    ? (player.overallRank != null ? `#${player.overallRank}` : "—")
                    : (player.worldRanking != null ? `#${player.worldRanking}` : "—"))
                : seasonStarted
                ? player.totalPoints.toFixed(1)
                : (tab !== "mpo" && tab !== "fpo"
                    ? (player.overallRank != null ? `#${player.overallRank}` : "—")
                    : (player.worldRanking != null ? `#${player.worldRanking}` : "—"));
              const rightSlot = (
                <div className="flex flex-col items-end shrink-0 w-16 text-right">
                  <span
                    className={`font-bold text-sm tabular-nums leading-tight ${
                      sort === "hot" && player.formDelta != null
                        ? player.formDelta > 0
                          ? "text-[#36D7B7]"
                          : player.formDelta < 0
                            ? "text-red-400"
                            : "text-white"
                        : "text-white"
                    }`}
                  >
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
                  rightSlot={rightSlot}
                  addControl={actionButton(player)}
                  starred={starred.has(player.id)}
                  onToggleStar={() => toggleStar(player.id)}
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
              ? (player.nextWeekPoints != null ? player.nextWeekPoints.toFixed(1) : "—")
              : sort === "hot"
              ? (player.formDelta != null
                  ? `${player.formDelta > 0 ? "+" : ""}${player.formDelta.toFixed(1)}`
                  : "—")
              : sort === "rank"
              ? (tab !== "mpo" && tab !== "fpo"
                  ? (player.overallRank != null ? `#${player.overallRank}` : "—")
                  : (player.worldRanking != null ? `#${player.worldRanking}` : "—"))
              : player.totalPoints.toFixed(1);
            const rightSlot = (
              <div className="flex flex-col items-end shrink-0 w-16 text-right">
                <span
                  className={`font-bold text-sm tabular-nums leading-tight ${
                    sort === "hot" && player.formDelta != null
                      ? player.formDelta > 0
                        ? "text-[#36D7B7]"
                        : player.formDelta < 0
                          ? "text-red-400"
                          : "text-white"
                      : "text-white"
                  }`}
                >
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
                starred={starred.has(player.id)}
                onToggleStar={() => toggleStar(player.id)}
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
  starred = false,
  onToggleStar,
}: {
  player: Player;
  leagueId: number;
  rank: string | null;
  addControl: React.ReactNode;
  rightSlot: React.ReactNode;
  ownerName?: string | null;
  starred?: boolean;
  onToggleStar?: () => void;
}) {
  const isMpo = player.division === "MPO";
  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";
  const lastEvent = player.lastEvent ?? null;

  return (
    <div className="bg-[#1a1d23] border border-white/5 rounded-xl px-3 py-2.5 flex items-center gap-2 sm:gap-3">
      {addControl}

      {rank != null && (
        <span className="text-white font-bold text-sm font-mono w-10 sm:w-12 shrink-0 text-right">
          {rank}
        </span>
      )}

      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatarUrl}
          alt=""
          className="w-8 h-8 rounded-full object-cover shrink-0 bg-white/10"
        />
      ) : (
        <div className="w-8 h-8 rounded-full shrink-0 bg-white/10 flex items-center justify-center text-[11px] font-bold text-gray-300">
          {player.name[0]?.toUpperCase()}
        </div>
      )}

      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <Link
            href={`/league/${leagueId}/player/${player.id}`}
            className="text-white font-medium text-sm truncate hover:underline"
          >
            {player.name}
          </Link>
          {player.pdgaRating != null && (
            <span
              className="text-[11px] font-semibold tabular-nums text-gray-400 shrink-0"
              title="Current PDGA Rating"
            >
              {player.pdgaRating}
            </span>
          )}
          {player.outNext && (
            <span
              className="text-[9px] font-bold uppercase px-1 py-0.5 rounded shrink-0 text-red-400 bg-red-500/15"
              title="Not registered for the upcoming event"
            >
              OUT
            </span>
          )}
          {ownerName && (
            <span className="text-gray-400 text-xs truncate">→ {ownerName}</span>
          )}
        </div>
        {lastEvent && (
          <p className="text-gray-500 text-[11px] truncate leading-tight mt-0.5" title="Last event">
            {lastEvent.finish != null ? `#${lastEvent.finish}` : "DNF"} · {lastEvent.name} ·{" "}
            {lastEvent.pts.toFixed(1)} pts
          </p>
        )}
      </div>

      <span
        className="hidden sm:inline text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
        style={{ color: accentColor, background: `${accentColor}20` }}
      >
        {player.division}
      </span>

      {rightSlot}

      {onToggleStar && (
        <button
          type="button"
          onClick={onToggleStar}
          aria-label={starred ? "Remove from watchlist" : "Add to watchlist"}
          className={`shrink-0 w-7 h-7 -mr-1 flex items-center justify-center rounded-lg text-base transition ${
            starred ? "text-[#F5A623]" : "text-gray-600 hover:text-gray-300"
          }`}
        >
          {starred ? "★" : "☆"}
        </button>
      )}
    </div>
  );
}
