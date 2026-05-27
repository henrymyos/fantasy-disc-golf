"use client";

import { BONUS_POINTS } from "@/lib/scoring-constants";
import {
  defaultMpoTable,
  defaultFpoTable,
  type ScoringRules as RulesType,
} from "@/lib/scoring-rules";

const MPO_EDITABLE_COUNT = 32;
const FPO_EDITABLE_COUNT = 25;
const MPO_TAIL = { label: "33rd+", pts: 1 };
const FPO_TAIL = { label: "26th+", pts: 2 };

export function ScoringRules({
  mpoStarters = 4,
  fpoStarters = 2,
  rules,
}: {
  mpoStarters?: number;
  fpoStarters?: number;
  rules?: RulesType;
}) {
  const bonus = rules?.bonusPoints ?? BONUS_POINTS;
  const mpoTable = mergeTable(defaultMpoTable(), rules?.mpoPositionPoints);
  const fpoTable = mergeTable(defaultFpoTable(), rules?.fpoPositionPoints);

  const mpoRows = groupByValue(mpoTable, MPO_EDITABLE_COUNT, MPO_TAIL);
  const fpoRows = groupByValue(fpoTable, FPO_EDITABLE_COUNT, FPO_TAIL);

  const total = mpoStarters + fpoStarters;
  return (
    <div className="space-y-6">
      {/* Lineup structure */}
      <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5">
        <p className="text-sm text-gray-300 font-medium mb-2">Lineup Structure</p>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-sm font-bold text-[#4B3DFF]">{mpoStarters}</span>
            <span className="text-[#4B3DFF] text-sm font-semibold">MPO starters</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#36D7B7]/20 border border-[#36D7B7]/30 flex items-center justify-center text-sm font-bold text-[#36D7B7]">{fpoStarters}</span>
            <span className="text-[#36D7B7] text-sm font-semibold">FPO starters</span>
          </div>
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-white/10">
            <span className="text-gray-400 text-sm">{total} total starters</span>
          </div>
        </div>
      </div>

      {/* Bonus points */}
      <div>
        <p className="text-sm font-medium text-gray-300 mb-3">Bonus Points</p>
        <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-3">
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">🔥</div>
            <div className="text-white font-bold text-xl tabular-nums">+{bonus.hotRound}</div>
            <div className="text-gray-400 text-xs mt-1">Hot Round</div>
            <div className="text-gray-400 text-xs mt-0.5">Best score in a round</div>
          </div>
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">✅</div>
            <div className="text-white font-bold text-xl tabular-nums">+{bonus.bogeyFree}</div>
            <div className="text-gray-400 text-xs mt-1">Bogey-Free Round</div>
            <div className="text-gray-400 text-xs mt-0.5">Per round, no bogeys</div>
          </div>
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">🎯</div>
            <div className="text-white font-bold text-xl tabular-nums">+{bonus.ace}</div>
            <div className="text-gray-400 text-xs mt-1">Ace</div>
            <div className="text-gray-400 text-xs mt-0.5">Hole-in-one</div>
          </div>
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">🟢</div>
            <div className="text-white font-bold text-xl tabular-nums">+{bonus.birdie}</div>
            <div className="text-gray-400 text-xs mt-1">Birdie</div>
            <div className="text-gray-400 text-xs mt-0.5">Per stroke under par</div>
          </div>
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">🔴</div>
            <div className="text-white font-bold text-xl tabular-nums">−{bonus.bogey}</div>
            <div className="text-gray-400 text-xs mt-1">Bogey</div>
            <div className="text-gray-400 text-xs mt-0.5">Per stroke over par</div>
          </div>
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">🦅</div>
            <div className="text-white font-bold text-xl tabular-nums">+{bonus.eagle}</div>
            <div className="text-gray-400 text-xs mt-1">Eagle</div>
            <div className="text-gray-400 text-xs mt-0.5">Per hole 2+ under par</div>
          </div>
        </div>
        <p className="text-gray-400 text-xs mt-2">Each tied player earns the full bonus — bonuses are not shared. Bonuses stack per round. Birdie/bogey points count every stroke under or over par (eagles and double bogeys count twice).</p>
      </div>

      {/* Placement tables side by side */}
      <p className="text-gray-400 text-xs">Tied finishes each earn the full points for the position they tied for.</p>
      <div style={{ display: "flex", flexDirection: "row", gap: "16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="text-sm font-medium text-[#4B3DFF] mb-3 flex items-center gap-2">
            MPO Placement
            <span className="text-xs text-gray-400 font-normal">{mpoStarters} starters</span>
          </p>
          <div className="space-y-0">
            {mpoRows.map((row, i) => (
              <div key={i} className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
                <span className="text-gray-400 text-xs">{row.label}</span>
                <span className="text-white font-medium text-xs tabular-nums">{row.pts}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="text-sm font-medium text-[#36D7B7] mb-3 flex items-center gap-2">
            FPO Placement
            <span className="text-xs text-gray-400 font-normal">{fpoStarters} starters</span>
          </p>
          <div className="space-y-0">
            {fpoRows.map((row, i) => (
              <div key={i} className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
                <span className="text-gray-400 text-xs">{row.label}</span>
                <span className="text-[#36D7B7] font-medium text-xs tabular-nums">{row.pts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function mergeTable(
  defaults: Record<number, number>,
  override: Record<number, number> | null | undefined,
): Record<number, number> {
  if (!override) return defaults;
  return { ...defaults, ...override };
}

/** Collapses consecutive positions with the same point value into a single
 *  label like "19th–20th". Appends a tail row for everything beyond the
 *  editable range. */
function groupByValue(
  table: Record<number, number>,
  upTo: number,
  tail: { label: string; pts: number },
): Array<{ label: string; pts: number }> {
  const rows: Array<{ label: string; pts: number }> = [];
  let runStart = 1;
  let runValue = table[1] ?? 0;
  for (let p = 2; p <= upTo; p++) {
    const v = table[p] ?? 0;
    if (v === runValue) continue;
    rows.push({ label: rangeLabel(runStart, p - 1), pts: runValue });
    runStart = p;
    runValue = v;
  }
  rows.push({ label: rangeLabel(runStart, upTo), pts: runValue });
  rows.push(tail);
  return rows;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function rangeLabel(a: number, b: number): string {
  return a === b ? ordinal(a) : `${ordinal(a)}–${ordinal(b)}`;
}
