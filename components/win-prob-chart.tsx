"use client";

import { useRef, useState } from "react";

export type WinProbPoint = { pct: number; ts: string };

const T1_LINE = "#6A5DFF"; // lightened brand purple — 2px line needs the lift on dark
const T2_COLOR = "#36D7B7";

/**
 * Win-probability swing over the tournament weekend, from
 * matchup_prob_snapshots. One line: team 1's win % (team 2 is its mirror).
 * Direct-labeled on both ends; hover shows the time + both teams' odds.
 */
export function WinProbChart({
  points,
  t1Name,
  t2Name,
}: {
  points: WinProbPoint[];
  t1Name: string;
  t2Name: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (points.length < 2) return null;

  const times = points.map((p) => Date.parse(p.ts));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = Math.max(1, t1 - t0);
  const xFor = (ms: number) => ((ms - t0) / span) * 100;
  const yFor = (pct: number) => 100 - pct;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(times[i]).toFixed(2)},${yFor(p.pct).toFixed(2)}`)
    .join(" ");

  const cur = points[points.length - 1].pct;
  const shown = hover != null ? points[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const targetMs = t0 + frac * span;
    let best = 0;
    for (let i = 1; i < times.length; i++) {
      if (Math.abs(times[i] - targetMs) < Math.abs(times[best] - targetMs)) best = i;
    }
    setHover(best);
  }

  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider mb-1">
        <span className="text-gray-400 font-semibold">Win probability</span>
        {shown ? (
          <span className="text-gray-400 tabular-nums normal-case tracking-normal">
            {fmtTime(shown.ts)} · <span className="text-white font-semibold">{shown.pct}%</span> {t1Name}
          </span>
        ) : (
          <span className="text-gray-500 normal-case tracking-normal">
            {fmtTime(points[0].ts)} → {fmtTime(points[points.length - 1].ts)}
          </span>
        )}
      </div>
      <div className="relative">
        {/* End labels — identity is carried by text + position, not color alone */}
        <div className="absolute left-2 top-1 text-[10px] leading-tight pointer-events-none">
          <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: T1_LINE }} />
          <span className="text-gray-300">{t1Name}</span>{" "}
          <span className="text-white font-semibold tabular-nums">{shown ? shown.pct : cur}%</span>
        </div>
        <div className="absolute left-2 bottom-1 text-[10px] leading-tight pointer-events-none">
          <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: T2_COLOR }} />
          <span className="text-gray-300">{t2Name}</span>{" "}
          <span className="text-white font-semibold tabular-nums">{100 - (shown ? shown.pct : cur)}%</span>
        </div>
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-28 rounded-lg bg-[#0f1117] border border-white/5"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* 50/50 midline */}
          <line x1="0" y1="50" x2="100" y2="50" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={T1_LINE} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          {shown && (
            <line
              x1={xFor(times[hover!])} y1="0" x2={xFor(times[hover!])} y2="100"
              stroke="#ffffff" strokeOpacity="0.25" strokeWidth="1" vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {shown && (
          <span
            className="absolute w-2 h-2 rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2 ring-2 ring-[#0f1117]"
            style={{
              background: T1_LINE,
              left: `${xFor(times[hover!])}%`,
              top: `${(yFor(shown.pct) / 100) * 112}px`,
            }}
          />
        )}
      </div>
    </div>
  );
}
