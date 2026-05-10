"use client";

import { useState } from "react";
import Link from "next/link";

type RosterTx = {
  id: number;
  action: "add" | "drop";
  createdAt: string;
  playerName: string;
  playerDivision: string;
  droppedName: string | null;
  droppedDivision: string | null;
};

type CompletedTrade = {
  id: number;
  status: "accepted" | "rejected";
  resolvedAt: string;
  otherTeam: string;
  received: string[];
  gave: string[];
};

type Props = {
  leagueId: number;
  myTeamId: number;
  rosterTxs: RosterTx[];
  completedTrades: CompletedTrade[];
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

export function TeamActionsPanel({ leagueId, myTeamId, rosterTxs, completedTrades }: Props) {
  const [showTx, setShowTx] = useState(false);

  const hasActivity = rosterTxs.length > 0 || completedTrades.length > 0;

  // Merge and sort all activity by date descending
  type Activity =
    | { kind: "tx"; item: RosterTx }
    | { kind: "trade"; item: CompletedTrade };

  const activity: Activity[] = [
    ...rosterTxs.map((t) => ({ kind: "tx" as const, item: t })),
    ...completedTrades.map((t) => ({ kind: "trade" as const, item: t })),
  ].sort((a, b) => {
    const dateA = a.kind === "tx" ? a.item.createdAt : a.item.resolvedAt;
    const dateB = b.kind === "tx" ? b.item.createdAt : b.item.resolvedAt;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      <div className="flex gap-2">
        <Link
          href={`/league/${leagueId}/trades`}
          className="flex-1 text-center bg-[#1a1d23] hover:bg-[#23262e] border border-white/5 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition"
        >
          Trade
        </Link>
        <button
          onClick={() => setShowTx((v) => !v)}
          className={`flex-1 text-sm font-semibold px-4 py-2.5 rounded-xl border transition ${
            showTx
              ? "bg-[#4B3DFF]/20 border-[#4B3DFF]/40 text-[#a09aff]"
              : "bg-[#1a1d23] hover:bg-[#23262e] border-white/5 text-white"
          }`}
        >
          Transactions
        </button>
      </div>

      {/* Transactions panel */}
      {showTx && (
        <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
          {!hasActivity ? (
            <p className="text-gray-600 text-sm text-center py-8">No recent transactions</p>
          ) : (
            <div className="divide-y divide-white/5">
              {activity.map((entry, i) => {
                if (entry.kind === "tx") {
                  const t = entry.item;
                  const isAdd = t.action === "add";
                  const isSwap = isAdd && t.droppedName != null;
                  return (
                    <div key={`tx-${t.id}`} className="flex items-center gap-3 px-4 py-3">
                      {isSwap ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-[#4B3DFF]/20 text-[#a09aff]">
                          SWAP
                        </span>
                      ) : (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            isAdd
                              ? "bg-[#36D7B7]/15 text-[#36D7B7]"
                              : "bg-red-500/15 text-red-400"
                          }`}
                        >
                          {isAdd ? "ADD" : "DROP"}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        {isSwap ? (
                          <p className="text-white text-sm truncate">
                            <span className="text-[#36D7B7]">+</span> {t.playerName}
                            <span className="text-gray-600 mx-1.5">/</span>
                            <span className="text-red-400">−</span> {t.droppedName}
                          </p>
                        ) : (
                          <p className="text-white text-sm truncate">{t.playerName}</p>
                        )}
                        {!isSwap && <p className="text-gray-600 text-xs">{t.playerDivision}</p>}
                      </div>
                      <span className="text-gray-600 text-xs shrink-0">{timeAgo(t.createdAt)}</span>
                    </div>
                  );
                }

                const t = entry.item;
                const accepted = t.status === "accepted";
                return (
                  <div key={`trade-${t.id}`} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-gray-400 text-xs">Trade w/ {t.otherTeam}</span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            accepted
                              ? "bg-[#36D7B7]/15 text-[#36D7B7]"
                              : "bg-red-500/15 text-red-400"
                          }`}
                        >
                          {accepted ? "ACCEPTED" : "REJECTED"}
                        </span>
                        <span className="text-gray-600 text-xs">{timeAgo(t.resolvedAt)}</span>
                      </div>
                    </div>
                    {t.received.length > 0 && (
                      <p className="text-xs text-gray-400">
                        <span className="text-[#36D7B7]">Got:</span>{" "}
                        {t.received.join(", ")}
                      </p>
                    )}
                    {t.gave.length > 0 && (
                      <p className="text-xs text-gray-400">
                        <span className="text-red-400">Gave:</span>{" "}
                        {t.gave.join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
