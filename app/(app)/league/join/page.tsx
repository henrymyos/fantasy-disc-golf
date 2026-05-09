"use client";

import { useActionState } from "react";
import Link from "next/link";
import { joinLeague, type LeagueActionState } from "@/actions/leagues";

export default function JoinLeaguePage() {
  const [state, action, pending] = useActionState<LeagueActionState, FormData>(joinLeague, null);

  return (
    <div className="max-w-md">
      <div className="mb-6">
        <Link href="/dashboard" className="text-gray-500 hover:text-gray-300 text-sm transition">
          ← Back to leagues
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white mb-6">Join a League</h1>

      <div className="bg-[#1a1d23] rounded-2xl p-6 border border-white/5">
        <form action={action} className="space-y-5">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Invite Code</label>
            <input
              name="inviteCode"
              required
              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] transition uppercase tracking-wider font-mono"
              placeholder="AB12CD34"
            />
            {state?.errors?.inviteCode && (
              <p className="text-red-400 text-xs mt-1">{state.errors.inviteCode[0]}</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Your Team Name</label>
            <input
              name="teamName"
              required
              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] transition"
              placeholder="Ace Hunters"
            />
            {state?.errors?.teamName && (
              <p className="text-red-400 text-xs mt-1">{state.errors.teamName[0]}</p>
            )}
          </div>

          {state?.message && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{state.message}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {pending ? "Joining..." : "Join League"}
          </button>
        </form>
      </div>
    </div>
  );
}
