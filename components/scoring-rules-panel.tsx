"use client";

import { useState, useTransition } from "react";
import { saveScoringRules, resetScoringRules } from "@/actions/scoring-rules";
import {
  defaultMpoTable,
  defaultFpoTable,
  type ScoringRules,
} from "@/lib/scoring-rules";
import { ScoringRules as ScoringRulesDisplay } from "@/components/scoring-rules";
import { BONUS_POINTS } from "@/lib/scoring-constants";

const MPO_POSITIONS_EDITABLE = 32;
const FPO_POSITIONS_EDITABLE = 25;

/**
 * Controlled scoring-rules editor. Owns the in-progress edit state and
 * mirrors it into the read-only <ScoringRulesDisplay> above so every
 * change is visible in the graphic before the commissioner hits Save.
 */
export function ScoringRulesPanel({
  leagueId,
  initialRules,
  mpoStarters,
  fpoStarters,
}: {
  leagueId: number;
  initialRules: ScoringRules;
  mpoStarters: number;
  fpoStarters: number;
}) {
  const defMpo = defaultMpoTable();
  const defFpo = defaultFpoTable();

  const [hotRound, setHotRound] = useState(initialRules.bonusPoints.hotRound);
  const [bogeyFree, setBogeyFree] = useState(initialRules.bonusPoints.bogeyFree);
  const [ace, setAce] = useState(initialRules.bonusPoints.ace);
  const [birdie, setBirdie] = useState(initialRules.bonusPoints.birdie);
  const [bogey, setBogey] = useState(initialRules.bonusPoints.bogey);
  const [eagle, setEagle] = useState(initialRules.bonusPoints.eagle);
  const [mpo, setMpo] = useState<Record<number, number>>(() =>
    buildInitialTable(initialRules.mpoPositionPoints, defMpo, MPO_POSITIONS_EDITABLE),
  );
  const [fpo, setFpo] = useState<Record<number, number>>(() =>
    buildInitialTable(initialRules.fpoPositionPoints, defFpo, FPO_POSITIONS_EDITABLE),
  );

  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const liveRules: ScoringRules = {
    bonusPoints: { hotRound, bogeyFree, ace, birdie, bogey, eagle },
    mpoPositionPoints: mpo,
    fpoPositionPoints: fpo,
  };

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
      const mpoDiff = diffFromDefault(mpo, defMpo);
      const fpoDiff = diffFromDefault(fpo, defFpo);
      await saveScoringRules(leagueId, {
        mpoPositionPoints: Object.keys(mpoDiff).length > 0 ? mpoDiff : null,
        fpoPositionPoints: Object.keys(fpoDiff).length > 0 ? fpoDiff : null,
        bonusPoints: { hotRound, bogeyFree, ace, birdie, bogey, eagle },
      });
      setSavedAt(new Date());
    });
  }

  function reset() {
    startTransition(async () => {
      await resetScoringRules(leagueId);
      setHotRound(BONUS_POINTS.hotRound);
      setBogeyFree(BONUS_POINTS.bogeyFree);
      setAce(BONUS_POINTS.ace);
      setBirdie(BONUS_POINTS.birdie);
      setBogey(BONUS_POINTS.bogey);
      setEagle(BONUS_POINTS.eagle);
      setMpo({ ...defMpo });
      setFpo({ ...defFpo });
      setSavedAt(new Date());
    });
  }

  return (
    <div className="space-y-5">
      {/* Live preview that mirrors what's being edited below. */}
      <div className="bg-[#1a1d23] rounded-2xl p-4 sm:p-6 border border-white/5">
        <ScoringRulesDisplay
          mpoStarters={mpoStarters}
          fpoStarters={fpoStarters}
          rules={liveRules}
        />
      </div>

      {/* Editor */}
      <div className="bg-[#1a1d23] rounded-2xl p-4 sm:p-6 border border-white/5 space-y-6">
        <section>
          <h3 className="text-white font-semibold text-sm mb-3">Bonus points</h3>
          <div className="grid grid-cols-3 gap-3">
            <BonusInput label="Hot round" value={hotRound} onChange={setHotRound} />
            <BonusInput label="Bogey-free" value={bogeyFree} onChange={setBogeyFree} />
            <BonusInput label="Ace" value={ace} onChange={setAce} />
            <BonusInput label="Birdie (per under par)" value={birdie} onChange={setBirdie} step={0.1} />
            <BonusInput label="Bogey (per over par)" value={bogey} onChange={setBogey} step={0.1} />
            <BonusInput label="Eagle (per eagle)" value={eagle} onChange={setEagle} step={0.5} />
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-semibold text-sm">MPO position points</h3>
            <span className="text-gray-400 text-[10px] uppercase tracking-wider">
              positions {MPO_POSITIONS_EDITABLE + 1}+ use defaults
            </span>
          </div>
          <PositionGrid table={mpo} onChange={setMpo} count={MPO_POSITIONS_EDITABLE} accent="#4B3DFF" />
        </section>

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
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-400 text-xs">{label}</span>
      <input
        type="number"
        step={step}
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
