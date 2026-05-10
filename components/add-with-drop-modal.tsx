"use client";

import { useState, useTransition } from "react";
import { addFreeAgent } from "@/actions/rosters";

type RosterPlayer = {
  player_id: number;
  players: { id: number; name: string; division: string } | null;
};

export function AddWithDropModal({
  leagueId,
  addPlayer,
  myRoster,
  openSpots,
}: {
  leagueId: number;
  addPlayer: { id: number; name: string; division: string };
  myRoster: RosterPlayer[];
  openSpots: number;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const rosterFull = openSpots === 0;

  function handleConfirm() {
    if (rosterFull && selected == null) return;
    startTransition(async () => {
      await addFreeAgent(leagueId, addPlayer.id, selected ?? undefined);
      setOpen(false);
      setSelected(null);
    });
  }

  const isMpo = addPlayer.division === "MPO";
  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-full font-medium transition shrink-0 ml-2"
      >
        Add
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { setOpen(false); setSelected(null); }}
        >
          <div
            className="bg-[#1a1d23] border border-white/10 rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-white/5">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1">Adding</p>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold uppercase px-2 py-0.5 rounded"
                  style={{ color: accentColor, background: `${accentColor}20` }}
                >
                  {addPlayer.division}
                </span>
                <p className="text-white font-bold text-base">{addPlayer.name}</p>
              </div>
              {rosterFull ? (
                <p className="text-gray-500 text-xs mt-2">Your roster is full. Pick a player to drop.</p>
              ) : (
                <p className="text-[#36D7B7] text-xs font-medium mt-2 bg-[#36D7B7]/10 border border-[#36D7B7]/20 rounded-lg px-3 py-1.5">
                  You have {openSpots} open spot{openSpots !== 1 ? "s" : ""}. Optionally drop a player.
                </p>
              )}
            </div>

            {/* Roster list */}
            <div className="px-3 py-3 space-y-1.5 max-h-72 overflow-y-auto">
              {myRoster.map((spot) => {
                const p = spot.players;
                if (!p) return null;
                const isSelected = selected === spot.player_id;
                const div = p.division;
                const color = div === "MPO" ? "#4B3DFF" : "#36D7B7";
                return (
                  <button
                    key={spot.player_id}
                    type="button"
                    onClick={() => setSelected(isSelected ? null : spot.player_id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition text-left ${
                      isSelected
                        ? "bg-red-500/10 border-red-500/40"
                        : "bg-[#0f1117] border-white/5 hover:border-white/15"
                    }`}
                  >
                    <span
                      className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                      style={{ color, background: `${color}20` }}
                    >
                      {div}
                    </span>
                    <span className={`flex-1 text-sm font-medium ${isSelected ? "text-red-300" : "text-white"}`}>
                      {p.name}
                    </span>
                    {isSelected && (
                      <span className="text-red-400 text-xs font-semibold shrink-0">Drop</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/5 flex gap-3">
              <button
                type="button"
                onClick={() => { setOpen(false); setSelected(null); }}
                className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-semibold py-2 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={(rosterFull && selected == null) || pending}
                className="flex-1 bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-40"
              >
                {pending ? "Adding..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
