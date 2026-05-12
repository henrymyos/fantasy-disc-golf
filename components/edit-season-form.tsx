"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setSelectedEvents } from "@/actions/leagues";
import {
  type DgptEvent,
  formatEventDateRange,
  formatEventLocation,
  getPlayoffSlugs,
  PLAYOFF_COUNT,
} from "@/lib/dgpt-2026-schedule";

type Props = {
  leagueId: string;
  events: DgptEvent[];
  initialSelected: string[];
};

export function EditSeasonForm({ leagueId, events, initialSelected }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const initialSet = useMemo(() => new Set(initialSelected), [initialSelected]);
  const dirty = useMemo(() => {
    if (selected.size !== initialSet.size) return true;
    for (const s of selected) if (!initialSet.has(s)) return true;
    return false;
  }, [selected, initialSet]);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(events.map((e) => e.slug)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  function save() {
    startTransition(async () => {
      await setSelectedEvents(leagueId, Array.from(selected));
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  const total = events.length;
  const count = selected.size;
  const playoffSet = useMemo(() => new Set(getPlayoffSlugs(selected)), [selected]);
  const playoffCount = playoffSet.size;
  const regularCount = Math.max(0, count - playoffCount);

  return (
    <div className="max-w-2xl space-y-6 pb-32">
      {/* Header */}
      <div>
        <Link
          href={`/league/${leagueId}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-4"
        >
          ← Settings
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-white font-bold text-lg">Edit Season</h2>
          <span className="text-sm font-mono text-gray-400 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 tabular-nums">
            <span className="text-white font-bold">{count}</span>
            <span className="text-gray-500"> / {total} tournaments</span>
          </span>
        </div>
        <p className="text-gray-500 text-sm mt-2">
          Select which 2026 DGPT events count toward the season. The last {PLAYOFF_COUNT}{" "}
          selected events of the year are marked as <span className="text-[#F5A524] font-semibold">PLAYOFFS</span>.
        </p>
      </div>

      {/* Bulk actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 hover:text-white transition"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 hover:text-white transition"
        >
          Clear all
        </button>
      </div>

      {/* Event list */}
      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        {events.map((event, i) => {
          const isSelected = selected.has(event.slug);
          return (
            <button
              key={event.slug}
              type="button"
              onClick={() => toggle(event.slug)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 text-left transition ${
                i !== 0 ? "border-t border-white/5" : ""
              } ${isSelected ? "hover:bg-white/[0.03]" : "hover:bg-white/[0.03] opacity-50"}`}
            >
              {/* Checkbox */}
              <span
                className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition"
                style={
                  isSelected
                    ? { borderColor: "#36D7B7", background: "#36D7B7" }
                    : { borderColor: "rgba(255,255,255,0.25)", background: "transparent" }
                }
              >
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>

              {/* Event info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white font-medium text-sm truncate">{event.name}</p>
                  {isSelected && playoffSet.has(event.slug) && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 text-[#F5A524] bg-[#F5A524]/15 border border-[#F5A524]/30">
                      Playoff
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-xs mt-0.5 truncate">
                  {formatEventDateRange(event)} · {formatEventLocation(event)}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Sticky save footer */}
      <div className="fixed bottom-0 left-0 md:left-14 lg:left-56 right-0 z-40 bg-[#0f1117]/95 backdrop-blur-sm border-t border-white/5 px-4 lg:px-6 py-4">
        <div className="max-w-2xl flex items-center justify-between gap-3">
          <div className="text-sm">
            <p className="text-white font-semibold">
              {count} of {total} tournaments
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              <span className="text-gray-400">{regularCount} regular</span>
              <span> · </span>
              <span className="text-[#F5A524]">{playoffCount} playoff{playoffCount !== 1 ? "s" : ""}</span>
            </p>
            {savedAt && !dirty && (
              <p className="text-[#36D7B7] text-xs mt-0.5">Saved</p>
            )}
            {dirty && (
              <p className="text-gray-500 text-xs mt-0.5">Unsaved changes</p>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="bg-[#4B3DFF] hover:bg-[#3a2eff] disabled:bg-white/10 disabled:text-gray-500 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:cursor-not-allowed"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
