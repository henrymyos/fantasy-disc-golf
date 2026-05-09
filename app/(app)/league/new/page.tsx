"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createLeague, type LeagueActionState } from "@/actions/leagues";

const ROSTER_OPTIONS = [6, 8, 10, 12, 15];

const PRESETS = [
  { mpo: 1, fpo: 1 },
  { mpo: 2, fpo: 1 },
  { mpo: 3, fpo: 1 },
  { mpo: 3, fpo: 2 },
  { mpo: 4, fpo: 2 },
  { mpo: 5, fpo: 2 },
  { mpo: 5, fpo: 3 },
  { mpo: 6, fpo: 3 },
];

export default function NewLeaguePage() {
  const [state, action, pending] = useActionState<LeagueActionState, FormData>(createLeague, null);
  const [rosterSize, setRosterSize] = useState(10);
  const [mpoStarters, setMpoStarters] = useState(4);
  const [fpoStarters, setFpoStarters] = useState(2);

  const total = mpoStarters + fpoStarters;
  const overRoster = total > rosterSize;

  function applyPreset(mpo: number, fpo: number) {
    setMpoStarters(mpo);
    setFpoStarters(fpo);
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <Link href="/dashboard" className="text-gray-500 hover:text-gray-300 text-sm transition">
          ← Back to leagues
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white mb-6">Create a League</h1>

      <div className="bg-[#1a1d23] rounded-2xl p-6 border border-white/5">
        <form action={action} className="space-y-5">
          <Field label="League Name" name="name" placeholder="Ledgestone Fantasy Classic" error={state?.errors?.name?.[0]} />
          <Field label="Your Team Name" name="teamName" placeholder="Chain Gang" error={state?.errors?.teamName?.[0]} />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Teams</label>
              <select name="maxTeams" defaultValue="8" className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF] transition">
                {[4,6,8,10,12,14,16].map(n => (
                  <option key={n} value={n}>{n}{n === 8 ? " ★" : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Roster Size</label>
              <select
                name="rosterSize"
                value={rosterSize}
                onChange={(e) => setRosterSize(Number(e.target.value))}
                className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF] transition"
              >
                {ROSTER_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}{n === 10 ? " ★" : ""}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Lineup split */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Lineup Split</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESETS.map(p => {
                const active = p.mpo === mpoStarters && p.fpo === fpoStarters;
                const recommended = p.mpo === 4 && p.fpo === 2;
                return (
                  <button
                    key={`${p.mpo}+${p.fpo}`}
                    type="button"
                    onClick={() => applyPreset(p.mpo, p.fpo)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                      active
                        ? "bg-[#4B3DFF] border-[#4B3DFF] text-white"
                        : "bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/30"
                    }`}
                  >
                    <span className="text-[#4B3DFF]">{p.mpo} MPO</span>
                    <span className="text-gray-500 mx-1">+</span>
                    <span className="text-[#36D7B7]">{p.fpo} FPO</span>
                    {recommended && <span className="ml-1 text-yellow-400">★</span>}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs text-[#4B3DFF] font-semibold mb-1">MPO Starters</label>
                <input
                  type="number"
                  name="mpoStarters"
                  value={mpoStarters}
                  min={1}
                  max={10}
                  onChange={(e) => setMpoStarters(Math.max(1, Number(e.target.value)))}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF] transition"
                />
              </div>
              <div>
                <label className="block text-xs text-[#36D7B7] font-semibold mb-1">FPO Starters</label>
                <input
                  type="number"
                  name="fpoStarters"
                  value={fpoStarters}
                  min={1}
                  max={10}
                  onChange={(e) => setFpoStarters(Math.max(1, Number(e.target.value)))}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#36D7B7] transition"
                />
              </div>
              <div className="pb-2 text-center">
                <p className="text-xs text-gray-500 mb-1">Total</p>
                <p className={`text-lg font-bold ${overRoster ? "text-red-400" : "text-white"}`}>{total}</p>
              </div>
            </div>
            {overRoster && (
              <p className="text-red-400 text-xs mt-1">Total starters ({total}) exceeds roster size ({rosterSize})</p>
            )}
            {state?.errors?.fpoStarters && (
              <p className="text-red-400 text-xs mt-1">{state.errors.fpoStarters[0]}</p>
            )}
          </div>

          {state?.message && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{state.message}</p>
          )}

          <button
            type="submit"
            disabled={pending || overRoster}
            className="w-full bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {pending ? "Creating..." : "Create League"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, placeholder, error }: { label: string; name: string; placeholder: string; error?: string }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        name={name}
        required
        className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] transition"
        placeholder={placeholder}
      />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}
