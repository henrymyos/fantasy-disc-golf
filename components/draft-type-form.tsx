"use client";

import { useState, useTransition, useEffect, useRef, useId } from "react";
import { setDraftConfig } from "@/actions/draft-config";

type DraftType = "snake" | "auction";
const DRAFT_TYPES: { value: DraftType; label: string }[] = [
  { value: "snake", label: "Snake" },
  { value: "auction", label: "Auction" },
];

export function DraftTypeForm({
  leagueId,
  initialType,
  initialBudget,
  initialThirdRoundReversal = false,
}: {
  leagueId: number;
  initialType: DraftType;
  initialBudget: number;
  initialThirdRoundReversal?: boolean;
}) {
  const [type, setType] = useState<DraftType>(initialType);
  const [budget, setBudget] = useState(initialBudget);
  const [thirdRoundReversal, setThirdRoundReversal] = useState(initialThirdRoundReversal);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    startTransition(async () => {
      await setDraftConfig(leagueId, type, budget, thirdRoundReversal);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-white/5">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Draft type</label>
        <DraftTypePicker value={type} onChange={setType} />
      </div>
      {type === "auction" && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">Auction budget ($)</label>
          <input
            type="number"
            min={50}
            max={1000}
            step={10}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-32"
          />
        </div>
      )}
      {type === "snake" && (
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer w-full">
          <input
            type="checkbox"
            checked={thirdRoundReversal}
            onChange={(e) => setThirdRoundReversal(e.target.checked)}
            className="w-4 h-4 accent-[#4B3DFF]"
          />
          Third-round reversal
        </label>
      )}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
      >
        {pending ? "Saving..." : saved ? "Saved ✓" : "Save draft type"}
      </button>
      {type === "auction" && (
        <p className="text-gray-400 text-xs w-full">
          Each team starts with ${budget} to spend across the entire roster. Teams take turns nominating in draft order; the highest bidder wins. Last-second bids extend the timer to 10 seconds.
        </p>
      )}
      {type === "snake" && thirdRoundReversal && (
        <p className="text-gray-400 text-xs w-full">
          Rounds 1 and 2 stay normal. From round 3 onwards the standard snake direction inverts — a team that picks first in round 1 picks first again in rounds 4, 6, 8 (instead of 3, 5, 7) and last in rounds 2, 3, 5, 7.
        </p>
      )}
    </div>
  );
}

function DraftTypePicker({
  value,
  onChange,
}: {
  value: DraftType;
  onChange: (next: DraftType) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedLabel = DRAFT_TYPES.find((t) => t.value === value)?.label ?? "Snake";

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`bg-[#0f1117] border rounded-lg px-3 py-2 text-white text-sm transition inline-flex items-center gap-2 min-w-[120px] justify-between ${
          open ? "border-[#4B3DFF]/60" : "border-white/10 hover:border-white/30"
        }`}
      >
        <span>{selectedLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="absolute left-0 top-full mt-2 z-30 w-44 bg-[#1a1d23] border border-white/10 rounded-xl shadow-xl p-1"
        >
          {DRAFT_TYPES.map((t) => {
            const selected = t.value === value;
            return (
              <button
                key={t.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(t.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between ${
                  selected
                    ? "bg-[#4B3DFF]/15 text-white"
                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{t.label}</span>
                {selected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#4B3DFF"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
