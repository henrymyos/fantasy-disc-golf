"use client";

import { useState } from "react";
import Link from "next/link";
import { DraftBoard } from "@/components/draft-board";

type BoardProps = Omit<React.ComponentProps<typeof DraftBoard>, "onExit">;

// The draft "lobby": two launch buttons. "Draft Board" opens the board as a
// full-screen overlay (the board is full-screen only now); its ✕ closes it.
export function DraftRoom({
  board,
  isLive,
  mockDraftHref,
}: {
  board: BoardProps;
  isLive: boolean;
  mockDraftHref: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left rounded-2xl border border-[#4B3DFF]/40 bg-[#4B3DFF]/10 hover:bg-[#4B3DFF]/20 hover:border-[#4B3DFF]/60 p-5 transition"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-bold text-white">Draft Board</span>
            {isLive && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[#36D7B7] bg-[#36D7B7]/15 px-2.5 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-[#36D7B7] animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-1">
            {isLive ? "The draft is live — jump in." : "Open the full-screen draft board."}
          </p>
        </button>
        <Link
          href={mockDraftHref}
          className="block text-left rounded-2xl border border-white/10 bg-[#1a1d23] hover:border-white/20 hover:bg-white/5 p-5 transition"
        >
          <span className="text-lg font-bold text-white">Mock Draft</span>
          <p className="text-gray-400 text-sm mt-1">Run a solo practice draft.</p>
        </Link>
      </div>
      {open && <DraftBoard {...board} onExit={() => setOpen(false)} />}
    </>
  );
}
