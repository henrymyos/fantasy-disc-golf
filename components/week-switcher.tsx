"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export type WeekTab = {
  week: number;
  eventName: string;
  /** e.g. "Aug 7 – Aug 10" */
  dateLabel: string;
  isPlayoff: boolean;
};

/**
 * Sleeper-style week strip: every league week as a tappable pill, with the
 * selected week's event named underneath. Pills are plain links that set
 * ?week=N on `basePath`, so the server component re-renders for that week.
 */
export function WeekSwitcher({
  basePath,
  weeks,
  selected,
  currentWeek,
}: {
  basePath: string;
  weeks: WeekTab[];
  selected: number;
  currentWeek: number;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLAnchorElement | null>(null);

  // Keep the selected pill centered without scrolling the page itself.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const pill = selectedRef.current;
    if (!scroller || !pill) return;
    const target = pill.offsetLeft - scroller.clientWidth / 2 + pill.clientWidth / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: "instant" as ScrollBehavior });
  }, [selected]);

  const tab = weeks.find((w) => w.week === selected);
  const prev = weeks.filter((w) => w.week < selected).at(-1);
  const next = weeks.find((w) => w.week > selected);

  return (
    <div className="bg-[#1a1d23] rounded-2xl border border-white/5 px-2 pt-2 pb-3">
      <div className="flex items-center gap-1">
        <Link
          href={prev ? `${basePath}?week=${prev.week}` : "#"}
          aria-disabled={!prev}
          className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-lg transition ${
            prev ? "text-gray-300 hover:text-white hover:bg-white/5" : "text-gray-600 pointer-events-none"
          }`}
        >
          ‹
        </Link>
        <div
          ref={scrollerRef}
          className="flex-1 flex gap-1.5 overflow-x-auto scrollbar-none py-1"
          style={{ scrollbarWidth: "none" }}
        >
          {weeks.map((w) => {
            const isSelected = w.week === selected;
            const isCurrent = w.week === currentWeek;
            return (
              <Link
                key={w.week}
                ref={isSelected ? selectedRef : undefined}
                href={`${basePath}?week=${w.week}`}
                className={`relative shrink-0 min-w-[2.5rem] px-2.5 py-1.5 rounded-lg text-center text-sm font-semibold tabular-nums transition ${
                  isSelected
                    ? "bg-[#4B3DFF] text-white"
                    : w.week < currentWeek
                      ? "text-gray-500 hover:text-white hover:bg-white/5"
                      : "text-gray-300 hover:text-white hover:bg-white/5"
                }`}
              >
                {w.isPlayoff ? `P${w.week}` : w.week}
                {isCurrent && (
                  <span
                    className={`absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full ${
                      isSelected ? "bg-white" : "bg-[#36D7B7]"
                    }`}
                  />
                )}
              </Link>
            );
          })}
        </div>
        <Link
          href={next ? `${basePath}?week=${next.week}` : "#"}
          aria-disabled={!next}
          className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-lg transition ${
            next ? "text-gray-300 hover:text-white hover:bg-white/5" : "text-gray-600 pointer-events-none"
          }`}
        >
          ›
        </Link>
      </div>
      {tab && (
        <p className="text-center text-xs text-gray-400 mt-1.5 px-2 truncate">
          Week {tab.week}
          {tab.isPlayoff && <span className="text-[#F5A623]"> · Playoffs</span>}
          <span className="text-gray-300"> · {tab.eventName}</span>
          <span className="text-gray-500"> · {tab.dateLabel}</span>
          {tab.week === currentWeek && <span className="text-[#36D7B7]"> · Current</span>}
        </p>
      )}
    </div>
  );
}
