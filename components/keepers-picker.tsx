"use client";

import { useState, useTransition } from "react";
import { setKeepers } from "@/actions/keepers";

type Player = { id: number; name: string; division: string };

export function KeepersPicker({
  leagueId,
  seasonYear,
  limit,
  roster,
  initialIds,
}: {
  leagueId: number;
  seasonYear: number;
  limit: number;
  roster: Player[];
  initialIds: number[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(initialIds));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < limit) next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      await setKeepers(leagueId, seasonYear, [...selected]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  const remaining = limit - selected.size;

  return (
    <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-white text-sm">
          {selected.size}/{limit} selected
          {remaining > 0 && (
            <span className="text-gray-500"> · {remaining} slot{remaining !== 1 ? "s" : ""} left</span>
          )}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold px-3 py-1.5 rounded-full transition disabled:opacity-40"
        >
          {pending ? "Saving..." : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      <div className="space-y-1.5">
        {roster.map((p) => {
          const isSelected = selected.has(p.id);
          const accent = p.division === "MPO" ? "#4B3DFF" : "#36D7B7";
          const disabledByLimit = !isSelected && selected.size >= limit;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              disabled={disabledByLimit}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition text-left disabled:opacity-40 ${
                isSelected
                  ? "border-[#36D7B7]/40 bg-[#36D7B7]/5"
                  : "border-white/5 bg-[#0f1117] hover:border-white/15"
              }`}
            >
              <span
                className="text-[10px] font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                style={{ color: accent, background: `${accent}20` }}
              >
                {p.division}
              </span>
              <span className="text-white text-sm flex-1 truncate">{p.name}</span>
              {isSelected && <span className="text-[#36D7B7] text-xs font-semibold">Kept</span>}
            </button>
          );
        })}
        {roster.length === 0 && <p className="text-gray-600 text-sm">No players on your roster yet.</p>}
      </div>
    </div>
  );
}
