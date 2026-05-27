"use client";

import { useState, useTransition } from "react";
import { saveScoringRules, resetScoringRules } from "@/actions/scoring-rules";
import type { ScoringRules } from "@/lib/scoring-rules";

type Props = {
  leagueId: number;
  rules: ScoringRules;
  defaultMpoTable: Record<number, number>;
  defaultFpoTable: Record<number, number>;
};

const MPO_POSITIONS_EDITABLE = 32; // beyond this, defaults still apply
const FPO_POSITIONS_EDITABLE = 25;

export function ScoringRulesEditor({
  leagueId,
  rules,
  defaultMpoTable,
  defaultFpoTable,
}: Props) {
  const [hotRound, setHotRound] = useState(rules.bonusPoints.hotRound);
  const [bogeyFree, setBogeyFree] = useState(rules.bonusPoints.bogeyFree);
  const [ace, setAce] = useState(rules.bonusPoints.ace);

  const [mpo, setMpo] = useState<Record<number, number>>(() => buildInitialTable(rules.mpoPositionPoints, defaultMpoTable, MPO_POSITIONS_EDITABLE));
  const [fpo, setFpo] = useState<Record<number, number>>(() => buildInitialTable(rules.fpoPositionPoints, defaultFpoTable, FPO_POSITIONS_EDITABLE));

  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function diffFromDefault(
    table: Record<number, number>,
    defaults: Record<number, number>,
  ): Record<number, number> {
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(table)) {
      const pos = Number(k);
      if (defaults[pos] !== v) out[pos] = v;
    }
    return out;
  }

  function save() {
    startTransition(async () => {
      const mpoDiff = diffFromDefault(mpo, defaultMpoTable);
      const fpoDiff = diffFromDefault(fpo, defaultFpoTable);
      await saveScoringRules(leagueId, {
        mpoPositionPoints: Object.keys(mpoDiff).length > 0 ? mpoDiff : null,
        fpoPositionPoints: Object.keys(fpoDiff).length > 0 ? fpoDiff : null,
        bonusPoints: {
          hotRound,
          bogeyFree,
          ace,
          birdie: rules.bonusPoints.birdie,
          bogey: rules.bonusPoints.bogey,
          eagle: rules.bonusPoints.eagle,
        },
      });
      setSavedAt(new Date());
    });
  }

  function reset() {
    startTransition(async () => {
      await resetScoringRules(leagueId);
      setHotRound(10);
      setBogeyFree(5);
      setAce(20);
      setMpo({ ...defaultMpoTable });
      setFpo({ ...defaultFpoTable });
      setSavedAt(new Date());
    });
  }

  return (
    <div className="space-y-6">
      {/* Bonus values */}
      <section>
        <h3 className="text-white font-semibold text-sm mb-3">Bonus points</h3>
        <div className="grid grid-cols-3 gap-3">
          <BonusInput label="Hot round" value={hotRound} onChange={setHotRound} />
          <BonusInput label="Bogey-free" value={bogeyFree} onChange={setBogeyFree} />
          <BonusInput label="Ace" value={ace} onChange={setAce} />
        </div>
      </section>

      {/* MPO position points */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold text-sm">MPO position points</h3>
          <span className="text-gray-400 text-[10px] uppercase tracking-wider">
            positions {MPO_POSITIONS_EDITABLE + 1}+ use defaults
          </span>
        </div>
        <PositionGrid table={mpo} onChange={setMpo} count={MPO_POSITIONS_EDITABLE} accent="#4B3DFF" />
      </section>

      {/* FPO position points */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold text-sm">FPO position points</h3>
          <span className="text-gray-400 text-[10px] uppercase tracking-wider">
            positions {FPO_POSITIONS_EDITABLE + 1}+ use defaults
          </span>
        </div>
        <PositionGrid table={fpo} onChange={setFpo} count={FPO_POSITIONS_EDITABLE} accent="#36D7B7" />
      </section>

      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-lg transition disabled:opacity-40"
        >
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-gray-400 text-xs">
              Saved {savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
          >
            {pending ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildInitialTable(
  override: Record<number, number> | null,
  defaults: Record<number, number>,
  count: number,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 1; i <= count; i++) {
    out[i] = override?.[i] ?? defaults[i] ?? 0;
  }
  return out;
}

function BonusInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-400 text-xs">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-[#0f1117] border border-white/10 hover:border-white/30 focus:border-[#4B3DFF] rounded-lg px-3 py-2 text-white text-sm tabular-nums focus:outline-none"
      />
    </label>
  );
}

function PositionGrid({
  table,
  onChange,
  count,
  accent,
}: {
  table: Record<number, number>;
  onChange: (t: Record<number, number>) => void;
  count: number;
  accent: string;
}) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
      {Array.from({ length: count }, (_, i) => i + 1).map((pos) => (
        <label key={pos} className="flex items-center gap-1.5">
          <span
            className="text-[10px] font-bold w-6 text-right shrink-0"
            style={{ color: accent }}
          >
            {pos}
          </span>
          <input
            type="number"
            value={table[pos] ?? 0}
            onChange={(e) =>
              onChange({ ...table, [pos]: Number(e.target.value) })
            }
            className="w-full bg-[#0f1117] border border-white/10 hover:border-white/30 focus:border-[#4B3DFF] rounded px-2 py-1 text-white text-xs tabular-nums focus:outline-none"
          />
        </label>
      ))}
    </div>
  );
}
