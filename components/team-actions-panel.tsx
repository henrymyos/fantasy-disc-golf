"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { reorderWaiverClaims, cancelWaiverClaim } from "@/actions/rosters";

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

type PendingClaim = {
  id: number;
  addName: string;
  addDivision: string;
  dropName: string | null;
  dropDivision: string | null;
};

type Props = {
  leagueId: number;
  myTeamId: number;
  rosterTxs: RosterTx[];
  completedTrades: CompletedTrade[];
  pendingClaims?: PendingClaim[];
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

export function TeamActionsPanel({ leagueId, myTeamId, rosterTxs, completedTrades, pendingClaims = [] }: Props) {
  const [showTx, setShowTx] = useState(false);
  const [order, setOrder] = useState<PendingClaim[]>(pendingClaims);
  const [pending, startTransition] = useTransition();

  // Re-sync local order when the set of claims changes (added/cancelled), but
  // not on every render (which would clobber an in-flight reorder).
  const claimKey = pendingClaims.map((c) => c.id).join(",");
  useEffect(() => {
    setOrder(pendingClaims);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimKey]);

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    startTransition(() => reorderWaiverClaims(leagueId, next.map((c) => c.id)));
  }

  function cancel(claim: PendingClaim) {
    if (!window.confirm(`Cancel your waiver claim for ${claim.addName}?`)) return;
    setOrder((prev) => prev.filter((c) => c.id !== claim.id));
    startTransition(() => cancelWaiverClaim(leagueId, claim.id));
  }

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
          className={`flex-1 text-sm font-semibold px-4 py-2.5 rounded-xl border transition inline-flex items-center justify-center gap-2 ${
            showTx
              ? "bg-[#4B3DFF]/20 border-[#4B3DFF]/40 text-[#a09aff]"
              : "bg-[#1a1d23] hover:bg-[#23262e] border-white/5 text-white"
          }`}
        >
          Transactions
          {order.length > 0 && (
            <span className="bg-yellow-400 text-black text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-full">
              {order.length}
            </span>
          )}
        </button>
      </div>

      {/* Transactions panel */}
      {showTx && (
        <div className="space-y-3">
          {/* Pending waiver claims — own block, reorderable; #1 is attempted first */}
          {order.length > 0 && (
            <div className="bg-[#1a1d23] rounded-2xl border border-yellow-400/20 overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between bg-yellow-400/5">
                <p className="text-yellow-300 text-[11px] font-bold uppercase tracking-wide">Waiver claims pending</p>
                <span className="text-gray-500 text-[10px]">#1 is attempted first</span>
              </div>
              <div className="divide-y divide-white/5">
                {order.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2.5">
                    <span className="text-gray-400 text-xs font-mono w-4 text-center shrink-0">{i + 1}</span>
                    <div className="flex flex-col -my-1 shrink-0 text-gray-400">
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        onClick={() => move(i, -1)}
                        aria-label="Move up"
                        className="hover:text-white disabled:opacity-25 disabled:cursor-not-allowed leading-none"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === order.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="Move down"
                        className="hover:text-white disabled:opacity-25 disabled:cursor-not-allowed leading-none"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                    </div>
                    <p className="flex-1 min-w-0 text-white text-sm truncate">
                      <span className="text-[#36D7B7]">+</span> {c.addName}
                      {c.dropName && (
                        <>
                          <span className="text-gray-500 mx-1.5">/</span>
                          <span className="text-red-400">−</span> {c.dropName}
                        </>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => cancel(c)}
                      disabled={pending}
                      aria-label="Cancel claim"
                      className="text-gray-400 hover:text-red-400 text-lg leading-none px-1 shrink-0 transition"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
          {!hasActivity ? (
            <p className="text-gray-400 text-sm text-center py-8">No recent transactions</p>
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
                            <span className="text-gray-400 mx-1.5">/</span>
                            <span className="text-red-400">−</span> {t.droppedName}
                          </p>
                        ) : (
                          <p className="text-white text-sm truncate">{t.playerName}</p>
                        )}
                        {!isSwap && <p className="text-gray-400 text-xs">{t.playerDivision}</p>}
                      </div>
                      <span className="text-gray-400 text-xs shrink-0">{timeAgo(t.createdAt)}</span>
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
                        <span className="text-gray-400 text-xs">{timeAgo(t.resolvedAt)}</span>
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
        </div>
      )}
    </div>
  );
}
