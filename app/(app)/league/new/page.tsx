"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createLeague, type LeagueActionState } from "@/actions/leagues";

const ROSTER_OPTIONS = [6, 8, 10, 12, 15];
const STARTER_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10];

export default function NewLeaguePage() {
  const [state, action, pending] = useActionState<LeagueActionState, FormData>(createLeague, null);
  const [rosterSize, setRosterSize] = useState(10);
  const [startersCount, setStartersCount] = useState(6);

  function handleRosterChange(val: number) {
    setRosterSize(val);
    if (startersCount > val) setStartersCount(val);
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

          <div className="grid grid-cols-3 gap-4">
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
                onChange={(e) => handleRosterChange(Number(e.target.value))}
                className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF] transition"
              >
                {ROSTER_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}{n === 10 ? " ★" : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Starters</label>
              <select
                name="startersCount"
                value={startersCount}
                onChange={(e) => setStartersCount(Number(e.target.value))}
                className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF] transition"
              >
                {STARTER_OPTIONS.filter(n => n <= rosterSize).map(n => (
                  <option key={n} value={n}>{n}{n === 6 ? " ★" : ""}</option>
                ))}
              </select>
            </div>
          </div>

          {state?.message && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{state.message}</p>
          )}

          <button
            type="submit"
            disabled={pending}
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
