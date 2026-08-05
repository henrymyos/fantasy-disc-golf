"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { addFreeAgent, placeWaiverClaim } from "@/actions/rosters";

type RosterPlayer = {
  player_id: number;
  /** Projected points for the upcoming event (0 = not registered/playing). */
  projection?: number | null;
  players: { id: number; name: string; division: string } | null;
};

export function AddWithDropModal({
  leagueId,
  addPlayer,
  myRoster,
  openSpots,
  mode = "add",
}: {
  leagueId: number;
  addPlayer: { id: number; name: string; division: string };
  myRoster: RosterPlayer[];
  openSpots: number;
  mode?: "add" | "waiver";
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const isWaiver = mode === "waiver";
  const rosterFull = openSpots === 0;

  // While the popup is open, lock scrolling on the page behind it — only the
  // roster list inside the popup scrolls. iOS Safari ignores overflow:hidden
  // on body for touch scrolling, so pin the body with position:fixed instead
  // and restore the scroll position on close.
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  function handleConfirm() {
    if (rosterFull && selected == null) return;
    startTransition(async () => {
      if (isWaiver) {
        await placeWaiverClaim(leagueId, addPlayer.id, selected ?? undefined);
      } else {
        await addFreeAgent(leagueId, addPlayer.id, selected ?? undefined);
      }
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
        className={`text-xs py-2 rounded-full font-medium transition shrink-0 ml-2 w-16 text-center min-h-[40px] md:min-h-0 md:py-1.5 inline-flex items-center justify-center ${
          isWaiver
            ? "bg-yellow-400 hover:bg-yellow-300 text-black"
            : "bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white"
        }`}
      >
        {isWaiver ? "Claim" : "Add"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overscroll-contain touch-none"
          onClick={() => { setOpen(false); setSelected(null); }}
        >
          <div
            className="bg-[#1a1d23] border border-white/10 rounded-2xl w-full max-w-sm max-h-[85vh] shadow-xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-white/5">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1">
                {isWaiver ? "Claiming" : "Adding"}
              </p>
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
                <p className="text-gray-400 text-xs mt-2">
                  Your roster is full. Pick a player to drop {isWaiver ? "if this claim is granted." : "."}
                </p>
              ) : (
                <p className="text-[#36D7B7] text-xs font-medium mt-2 bg-[#36D7B7]/10 border border-[#36D7B7]/20 rounded-lg px-3 py-1.5">
                  You have {openSpots} open spot{openSpots !== 1 ? "s" : ""}. Optionally drop a player.
                </p>
              )}
            </div>

            {/* Roster list — the only scrollable region while the popup is open */}
            <div className="px-3 py-3 space-y-1.5 max-h-72 overflow-y-auto overscroll-contain touch-pan-y">
              {myRoster.map((spot) => {
                const p = spot.players;
                if (!p) return null;
                const isSelected = selected === spot.player_id;
                const div = p.division;
                const color = div === "MPO" ? "#4B3DFF" : "#36D7B7";
                const toggle = () => setSelected(isSelected ? null : spot.player_id);
                return (
                  // A div (not a button) so the player-name link can nest
                  // inside; clicking anywhere else still toggles selection.
                  <div
                    key={spot.player_id}
                    role="button"
                    tabIndex={0}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition text-left cursor-pointer select-none ${
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
                    <span className="flex-1 min-w-0">
                      <Link
                        href={`/league/${leagueId}/player/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-sm font-medium hover:underline ${isSelected ? "text-red-300" : "text-white"}`}
                      >
                        {p.name}
                      </Link>
                    </span>
                    {isSelected ? (
                      <span className="text-red-400 text-xs font-semibold shrink-0">Drop</span>
                    ) : (
                      <span className="text-right shrink-0 leading-tight">
                        <span className="block text-sm text-gray-200 font-semibold">
                          {spot.projection != null ? spot.projection.toFixed(1) : "—"}
                        </span>
                        <span className="block text-[10px] text-gray-500">proj</span>
                      </span>
                    )}
                  </div>
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
                {pending ? (isWaiver ? "Claiming..." : "Adding...") : isWaiver ? "Place claim" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
