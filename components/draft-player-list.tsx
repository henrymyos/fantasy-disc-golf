"use client";

import { useState } from "react";
import { makeDraftPick } from "@/actions/drafts";

type Player = {
  id: number;
  name: string;
  division: string;
  world_ranking: number | null;
  overall_rank: number | null;
};

type Tab = "all" | "mpo" | "fpo";

export function DraftPlayerList({
  leagueId,
  players,
  isMyPick,
}: {
  leagueId: number;
  players: Player[];
  isMyPick: boolean;
}) {
  const [tab, setTab] = useState<Tab>("all");

  const filtered = (() => {
    if (tab === "mpo") return players.filter((p) => p.division === "MPO");
    if (tab === "fpo") return players.filter((p) => p.division !== "MPO");
    return players;
  })();

  const sorted = [...filtered].sort((a, b) => {
    if (tab === "all") {
      const ar = a.overall_rank ?? 9999;
      const br = b.overall_rank ?? 9999;
      return ar - br;
    }
    const ar = a.world_ranking ?? 9999;
    const br = b.world_ranking ?? 9999;
    return ar - br;
  });

  const rankLabel = (p: Player) => {
    if (tab === "all") return p.overall_rank != null ? `#${p.overall_rank}` : "";
    return p.world_ranking != null ? `#${p.world_ranking}` : "";
  };

  return (
    <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Available Players ({players.length})</h3>
        <div className="flex gap-1 bg-[#0f1117] rounded-lg p-1">
          {(["all", "mpo", "fpo"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                tab === t
                  ? "bg-[#4B3DFF] text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {sorted.map((player) => (
          <div
            key={player.id}
            className="flex items-center justify-between p-3 rounded-xl bg-[#0f1117] border border-white/5"
          >
            <div className="flex items-center gap-2">
              <span className="text-gray-600 text-xs font-mono w-6 text-right shrink-0">
                {rankLabel(player)}
              </span>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {player.name[0]?.toUpperCase()}
              </div>
              <div>
                <p className="text-white text-sm font-medium">{player.name}</p>
                <p className={`text-xs font-semibold ${player.division === "MPO" ? "text-[#4B3DFF]" : "text-[#36D7B7]"}`}>
                  {player.division ?? "MPO"}
                </p>
              </div>
            </div>
            {isMyPick && (
              <form action={makeDraftPick.bind(null, leagueId, player.id)}>
                <button
                  type="submit"
                  className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-full transition"
                >
                  Draft
                </button>
              </form>
            )}
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="text-gray-600 text-sm text-center py-4">No players available</p>
        )}
      </div>
    </div>
  );
}
