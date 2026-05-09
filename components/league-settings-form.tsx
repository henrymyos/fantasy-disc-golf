"use client";

import { useActionState, useState } from "react";
import { updateLeague, type LeagueActionState } from "@/actions/leagues";

const ROSTER_OPTIONS = [6, 8, 10, 12, 15];
const STARTER_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10];

type Props = {
  leagueId: string;
  initial: {
    name: string;
    maxTeams: number;
    rosterSize: number;
    startersCount: number;
    scoringType: string;
  };
};

export function LeagueSettingsForm({ leagueId, initial }: Props) {
  const boundAction = updateLeague.bind(null, leagueId);
  const [state, action, pending] = useActionState<LeagueActionState, FormData>(boundAction, null);

  const [rosterSize, setRosterSize] = useState(initial.rosterSize);
  const [startersCount, setStartersCount] = useState(initial.startersCount);

  function handleRosterChange(val: number) {
    setRosterSize(val);
    if (startersCount > val) setStartersCount(val);
  }

  const saved = state?.message === "saved";

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="block text-sm text-gray-400 mb-1">League Name</label>
        <input
          name="name"
          defaultValue={initial.name}
          required
          className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] transition"
        />
        {state?.errors?.name && <p className="text-red-400 text-xs mt-1">{state.errors.name[0]}</p>}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Max Teams</label>
          <select
            name="maxTeams"
            defaultValue={initial.maxTeams}
            className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF] transition"
          >
            {[4, 6, 8, 10, 12, 14, 16].map((n) => (
              <option key={n} value={n}>{n}</option>
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
            {ROSTER_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
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
            {STARTER_OPTIONS.filter((n) => n <= rosterSize).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {state?.errors?.startersCount && (
            <p className="text-red-400 text-xs mt-1">{state.errors.startersCount[0]}</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Scoring Type</label>
        <select
          name="scoringType"
          defaultValue={initial.scoringType}
          className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF] transition"
        >
          <option value="placement">Placement (finish position)</option>
          <option value="points">Points (raw score)</option>
        </select>
      </div>

      {state?.message && !saved && (
        <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50"
      >
        {pending ? "Saving..." : saved ? "Saved ✓" : "Save Changes"}
      </button>
    </form>
  );
}
