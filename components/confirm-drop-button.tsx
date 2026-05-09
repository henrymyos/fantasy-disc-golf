"use client";

import { useState, useTransition } from "react";
import { dropPlayer } from "@/actions/rosters";

export function ConfirmDropButton({
  leagueId,
  playerId,
  playerName,
}: {
  leagueId: number;
  playerId: number;
  playerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      await dropPlayer(leagueId, playerId);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 hover:border-red-400/40 px-3 py-1 rounded-full transition"
      >
        Drop
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[#1a1d23] border border-white/10 rounded-2xl p-6 w-80 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-bold text-base mb-1">Drop Player?</h3>
            <p className="text-gray-400 text-sm mb-5">
              <span className="text-white font-medium">{playerName}</span> will be released to free agency and removed from your roster.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-semibold py-2 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {pending ? "Dropping..." : "Drop"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
