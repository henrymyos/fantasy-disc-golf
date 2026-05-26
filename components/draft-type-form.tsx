"use client";

import { useState, useTransition } from "react";
import { setDraftConfig } from "@/actions/draft-config";

export function DraftTypeForm({
  leagueId,
  initialType,
  initialBudget,
}: {
  leagueId: number;
  initialType: "snake" | "auction";
  initialBudget: number;
}) {
  const [type, setType] = useState<"snake" | "auction">(initialType);
  const [budget, setBudget] = useState(initialBudget);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    startTransition(async () => {
      await setDraftConfig(leagueId, type, budget);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-white/5">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Draft type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "snake" | "auction")}
          className="bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="snake">Snake</option>
          <option value="auction">Auction</option>
        </select>
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
    </div>
  );
}
