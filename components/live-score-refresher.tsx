"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mounted on pages that show team scores during an active tournament. Every
 * `intervalMs` it hits /api/refresh-scores (which is server-side cooldown-
 * gated to once a minute) then refreshes the server component tree so any
 * updated tournament_results flow through.
 */
export function LiveScoreRefresher({
  tournamentName,
  intervalMs = 180_000,
}: {
  tournamentName: string;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const r = await fetch("/api/refresh-scores", { method: "POST" });
      if (r.ok) {
        setLastUpdated(new Date());
        router.refresh();
      }
    } catch {
      // ignore — next tick will retry
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return (
    <div className="bg-[#36D7B7]/10 border border-[#36D7B7]/30 rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="w-2 h-2 rounded-full bg-[#36D7B7] animate-pulse" />
      <div className="min-w-0 flex-1">
        <p className="text-[#36D7B7] font-semibold text-sm">{tournamentName} is live</p>
        <p className="text-gray-400 text-xs mt-0.5">
          Scores refresh every {Math.round(intervalMs / 60_000)} min
          {lastUpdated && (
            <> · last update {lastUpdated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="text-xs text-[#36D7B7] border border-[#36D7B7]/40 hover:border-[#36D7B7] px-3 py-1.5 rounded-full transition disabled:opacity-40"
      >
        {refreshing ? "Updating..." : "Refresh now"}
      </button>
    </div>
  );
}
