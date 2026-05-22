"use client";

import { useMemo, useState, useTransition } from "react";
import { setRankings } from "@/actions/rankings";

type PlayerRow = {
  id: number;
  name: string;
  division: string;
  overallRank: number | null;
  worldRanking: number | null;
};

export function RankingsEditor({
  leagueId,
  initialRanked,
  initialUnranked,
}: {
  leagueId: number;
  initialRanked: PlayerRow[];
  initialUnranked: PlayerRow[];
}) {
  const [ranked, setRanked] = useState<PlayerRow[]>(initialRanked);
  const [unranked, setUnranked] = useState<PlayerRow[]>(initialUnranked);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const filteredUnranked = useMemo(
    () => unranked.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())),
    [unranked, filter],
  );

  function add(player: PlayerRow) {
    setUnranked((prev) => prev.filter((p) => p.id !== player.id));
    setRanked((prev) => [...prev, player]);
  }
  function remove(player: PlayerRow) {
    setRanked((prev) => prev.filter((p) => p.id !== player.id));
    setUnranked((prev) =>
      [...prev, player].sort((a, b) => (a.overallRank ?? 9999) - (b.overallRank ?? 9999)),
    );
  }
  function move(index: number, delta: number) {
    setRanked((prev) => {
      const next = [...prev];
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      await setRankings(leagueId, ranked.map((p) => p.id));
      setSavedAt(Date.now());
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Ranked list */}
      <div className="bg-[#1a1d23] rounded-2xl p-4 border border-white/5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-white font-semibold text-sm">Your ranking ({ranked.length})</p>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold px-3 py-1.5 rounded-full transition disabled:opacity-40"
          >
            {pending ? "Saving..." : savedAt ? "Saved ✓" : "Save"}
          </button>
        </div>
        {ranked.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">Click players on the right to add.</p>
        ) : (
          <ol className="space-y-1">
            {ranked.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2 px-2 py-1.5 bg-[#0f1117] border border-white/5 rounded-lg">
                <span className="text-gray-500 text-xs font-mono w-6 text-right">#{i + 1}</span>
                <span className="text-white text-sm flex-1 truncate">{p.name}</span>
                <span
                  className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                  style={{
                    color: p.division === "MPO" ? "#4B3DFF" : "#36D7B7",
                    background: p.division === "MPO" ? "rgba(75,61,255,0.18)" : "rgba(54,215,183,0.15)",
                  }}
                >
                  {p.division}
                </span>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-gray-500 hover:text-white disabled:opacity-30 text-xs px-1"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === ranked.length - 1}
                  className="text-gray-500 hover:text-white disabled:opacity-30 text-xs px-1"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(p)}
                  className="text-red-400 hover:text-red-300 text-xs px-1"
                  title="Remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Unranked pool */}
      <div className="bg-[#1a1d23] rounded-2xl p-4 border border-white/5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-white font-semibold text-sm">Pool</p>
          <input
            type="text"
            placeholder="Search..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-[#0f1117] border border-white/10 rounded-lg px-3 py-1 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] w-40"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto space-y-1">
          {filteredUnranked.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p)}
              className="w-full flex items-center gap-2 px-2 py-1.5 bg-[#0f1117] border border-white/5 hover:border-white/15 rounded-lg text-left transition"
            >
              <span className="text-gray-500 text-xs font-mono w-6 text-right">
                {p.overallRank != null ? `#${p.overallRank}` : ""}
              </span>
              <span className="text-white text-sm flex-1 truncate">{p.name}</span>
              <span
                className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                style={{
                  color: p.division === "MPO" ? "#4B3DFF" : "#36D7B7",
                  background: p.division === "MPO" ? "rgba(75,61,255,0.18)" : "rgba(54,215,183,0.15)",
                }}
              >
                {p.division}
              </span>
            </button>
          ))}
          {filteredUnranked.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-6">No players match.</p>
          )}
        </div>
      </div>
    </div>
  );
}
