"use client";

import { useState } from "react";
import Link from "next/link";
import { AddWithDropModal } from "@/components/add-with-drop-modal";

type Player = {
  id: number;
  name: string;
  division: string;
  worldRanking: number | null;
  overallRank: number | null;
};

type RosterPlayer = {
  player_id: number;
  players: { id: number; name: string; division: string } | null;
};

type Tab = "all" | "mpo" | "fpo";

type Props = {
  leagueId: number;
  freeAgents: Player[];
  myRoster: RosterPlayer[];
  openSpots: number;
  overLimit: boolean;
};

export function FreeAgencyList({ leagueId, freeAgents, myRoster, openSpots, overLimit }: Props) {
  const [tab, setTab] = useState<Tab>("all");

  const filtered = freeAgents
    .filter((p) => tab === "all" || (tab === "mpo" ? p.division === "MPO" : p.division === "FPO"))
    .sort((a, b) => {
      if (tab === "all") {
        return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
      }
      if (a.worldRanking == null && b.worldRanking == null) return a.name.localeCompare(b.name);
      if (a.worldRanking == null) return 1;
      if (b.worldRanking == null) return -1;
      return a.worldRanking - b.worldRanking;
    });

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-1 bg-[#1a1d23] border border-white/5 rounded-xl p-1 w-fit">
        {(["all", "mpo", "fpo"] as Tab[]).map((t) => (
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

      {/* Player list */}
      {filtered.length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-600 text-sm">No free agents in this division.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((player) => {
            const rank = tab === "all" ? player.overallRank : player.worldRanking;
            const isMpo = player.division === "MPO";
            const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";

            return (
              <div
                key={player.id}
                className="bg-[#1a1d23] border border-white/5 rounded-xl px-3 py-2.5 flex items-center gap-3"
              >
                {/* Add button — left */}
                {overLimit ? (
                  <span className="text-xs text-gray-600 px-3 py-1.5 shrink-0">Add</span>
                ) : (
                  <AddWithDropModal
                    leagueId={leagueId}
                    addPlayer={{ id: player.id, name: player.name, division: player.division }}
                    myRoster={myRoster}
                    openSpots={openSpots}
                  />
                )}

                {/* Ranking */}
                <span className="text-white font-bold text-sm font-mono w-8 shrink-0 text-right">
                  {rank != null ? `#${rank}` : "—"}
                </span>

                {/* Name */}
                <Link
                  href={`/league/${leagueId}/player/${player.id}`}
                  className="text-white font-medium text-sm flex-1 min-w-0 truncate hover:underline"
                >
                  {player.name}
                </Link>

                {/* Division badge */}
                <span
                  className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                  style={{ color: accentColor, background: `${accentColor}20` }}
                >
                  {player.division}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
