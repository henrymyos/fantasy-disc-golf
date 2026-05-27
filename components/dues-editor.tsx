"use client";

import { useState, useTransition } from "react";
import { saveDuesConfig, setTeamDuesPaid } from "@/actions/dues";
import type { PayoutSplit } from "@/lib/dues-types";

type Member = {
  id: number;
  team_name: string;
  dues_paid: boolean;
  dues_paid_at: string | null;
};

export function DuesEditor({
  leagueId,
  initialDuesAmount,
  initialPayoutSplits,
  members,
  standings,
}: {
  leagueId: number;
  initialDuesAmount: number;
  initialPayoutSplits: PayoutSplit[];
  members: Member[];
  standings: Array<{ teamId: number; teamName: string; wins: number; points: number }>;
}) {
  const [duesAmount, setDuesAmount] = useState(initialDuesAmount);
  const [splits, setSplits] = useState<PayoutSplit[]>(
    initialPayoutSplits.length > 0 ? initialPayoutSplits : [{ place: 1, pct: 100 }],
  );
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const totalPaid = members.filter((m) => m.dues_paid).length;
  const totalCollected = totalPaid * duesAmount;
  const totalExpected = members.length * duesAmount;

  function saveConfig() {
    startTransition(async () => {
      await saveDuesConfig(leagueId, duesAmount, splits);
      setSavedAt(new Date());
    });
  }

  function togglePaid(teamId: number, currentlyPaid: boolean) {
    startTransition(async () => {
      await setTeamDuesPaid(leagueId, teamId, !currentlyPaid);
    });
  }

  function updateSplit(idx: number, patch: Partial<PayoutSplit>) {
    setSplits(splits.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function addSplit() {
    const nextPlace = (splits[splits.length - 1]?.place ?? 0) + 1;
    setSplits([...splits, { place: nextPlace, pct: 0 }]);
  }
  function removeSplit(idx: number) {
    setSplits(splits.filter((_, i) => i !== idx));
  }

  const totalPct = splits.reduce((acc, s) => acc + (Number(s.pct) || 0), 0);
  const pctValid = totalPct === 100;

  return (
    <div className="space-y-6">
      {/* Config */}
      <section className="space-y-4">
        <div>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400 text-xs uppercase tracking-wider">Dues per team</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">$</span>
              <input
                type="number"
                value={duesAmount}
                onChange={(e) => setDuesAmount(Number(e.target.value))}
                className="bg-[#0f1117] border border-white/10 hover:border-white/30 focus:border-[#4B3DFF] rounded-lg px-3 py-2 text-white text-sm tabular-nums focus:outline-none w-32"
              />
            </div>
          </label>
        </div>

        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Payout splits</p>
          <div className="space-y-2">
            {splits.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-gray-400 text-xs w-16">Place</span>
                <input
                  type="number"
                  min={1}
                  value={s.place}
                  onChange={(e) => updateSplit(i, { place: Number(e.target.value) })}
                  className="w-16 bg-[#0f1117] border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm tabular-nums focus:outline-none"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={s.pct}
                  onChange={(e) => updateSplit(i, { pct: Number(e.target.value) })}
                  className="w-20 bg-[#0f1117] border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm tabular-nums focus:outline-none"
                />
                <span className="text-gray-400 text-xs">% (≈ ${formatCurrency(((Number(s.pct) || 0) / 100) * duesAmount * members.length)})</span>
                <button
                  type="button"
                  onClick={() => removeSplit(i)}
                  className="ml-auto text-gray-400 hover:text-red-400 text-xs px-2 py-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={addSplit}
              className="text-xs text-gray-300 border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-lg"
            >
              + Add place
            </button>
            <span className={`text-xs ${pctValid ? "text-gray-400" : "text-yellow-400"}`}>
              Total: {totalPct}% {pctValid ? "" : "(should equal 100)"}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          {savedAt && (
            <span className="text-gray-400 text-xs">
              Saved {savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={saveConfig}
            disabled={pending}
            className="ml-auto bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
          >
            {pending ? "Saving..." : "Save dues config"}
          </button>
        </div>
      </section>

      {/* Summary */}
      <section className="grid grid-cols-3 gap-3">
        <SummaryCard label="Collected" value={`$${formatCurrency(totalCollected)}`} />
        <SummaryCard label="Outstanding" value={`$${formatCurrency(totalExpected - totalCollected)}`} />
        <SummaryCard label="Total pot" value={`$${formatCurrency(totalExpected)}`} />
      </section>

      {/* Per-team paid status */}
      <section>
        <h3 className="text-white font-semibold text-sm mb-3">Paid status</h3>
        <ul className="bg-[#0f1117] border border-white/5 rounded-xl divide-y divide-white/5">
          {members.map((m) => (
            <li key={m.id} className="px-4 py-3 flex items-center gap-3">
              <span className="text-white text-sm flex-1 truncate">{m.team_name}</span>
              {m.dues_paid && m.dues_paid_at && (
                <span className="text-gray-400 text-xs">
                  {new Date(m.dues_paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
              <button
                type="button"
                onClick={() => togglePaid(m.id, m.dues_paid)}
                disabled={pending}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full transition disabled:opacity-40 ${
                  m.dues_paid
                    ? "bg-[#36D7B7]/15 text-[#36D7B7] border border-[#36D7B7]/30"
                    : "border border-white/10 hover:border-white/30 text-gray-300"
                }`}
              >
                {m.dues_paid ? "Paid" : "Unpaid"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Projected payouts */}
      {splits.length > 0 && standings.length > 0 && pctValid && (
        <section>
          <h3 className="text-white font-semibold text-sm mb-3">Projected payouts (current standings)</h3>
          <ul className="bg-[#0f1117] border border-white/5 rounded-xl divide-y divide-white/5">
            {splits.map((s) => {
              const team = standings[s.place - 1];
              const amount = (s.pct / 100) * totalExpected;
              return (
                <li key={s.place} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <span className="text-gray-400 w-12">#{s.place}</span>
                  <span className="text-white flex-1 truncate">{team?.teamName ?? "TBD"}</span>
                  <span className="text-white tabular-nums font-semibold">${formatCurrency(amount)}</span>
                  <span className="text-gray-400 text-xs">{s.pct}%</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0f1117] border border-white/5 rounded-xl p-4">
      <p className="text-gray-400 text-[10px] uppercase tracking-wider">{label}</p>
      <p className="text-white font-bold text-lg tabular-nums mt-1">{value}</p>
    </div>
  );
}

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}
