"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNextSeason } from "@/actions/season";

export function SeasonRollover({
  leagueId,
  currentYear,
  nextYear,
  keepersPerTeam,
  keeperReadyCount,
  memberCount,
  nextScheduleExists,
}: {
  leagueId: number;
  currentYear: number;
  nextYear: number;
  keepersPerTeam: number;
  keeperReadyCount: number;
  memberCount: number;
  nextScheduleExists: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const armed = confirm.trim() === String(nextYear);

  function run() {
    if (!armed) return;
    setError(null);
    startTransition(async () => {
      const res = await startNextSeason(leagueId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.push(`/league/${leagueId}`);
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link href={`/league/${leagueId}/settings`} className="text-gray-400 hover:text-white text-sm transition inline-block mb-4">
          ← Settings
        </Link>
        <h1 className="text-xl font-bold text-white">Start the {nextYear} season</h1>
        <p className="text-gray-400 text-sm mt-1">
          Closes out {currentYear} and sets the league up for a fresh {nextYear} draft.
        </p>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h2 className="font-bold text-white mb-3">What this does</h2>
        <ul className="space-y-2 text-sm text-gray-300">
          <li className="flex gap-2"><span className="text-[#36D7B7]">✓</span> Archives the {currentYear} standings, rosters, and draft to the league archive</li>
          <li className="flex gap-2"><span className="text-[#36D7B7]">✓</span> {keepersPerTeam > 0
            ? `Keeps each team's selected keepers (up to ${keepersPerTeam}) and clears the rest of their roster`
            : "Clears every roster for a full redraft"}</li>
          <li className="flex gap-2"><span className="text-[#36D7B7]">✓</span> Resets matchups, trades, and waivers</li>
          <li className="flex gap-2"><span className="text-[#36D7B7]">✓</span> Resets the draft to “not started” ({keepersPerTeam > 0 ? `${keepersPerTeam} fewer rounds` : "full rounds"}) so you can set the order and draft again</li>
          <li className="flex gap-2"><span className="text-[#36D7B7]">✓</span> Rolls the league to {nextYear} and reopens the schedule for selection</li>
        </ul>
      </div>

      {keepersPerTeam > 0 && (
        <div className={`rounded-2xl p-4 border ${keeperReadyCount < memberCount ? "border-yellow-400/30 bg-yellow-400/5" : "border-[#36D7B7]/30 bg-[#36D7B7]/5"}`}>
          <p className="text-sm text-white font-medium">
            Keepers for {nextYear}: {keeperReadyCount} of {memberCount} teams have set them
          </p>
          {keeperReadyCount < memberCount && (
            <p className="text-gray-400 text-xs mt-1">
              Teams that haven't set keepers will start {nextYear} with an empty roster and fill it in the draft.{" "}
              <Link href={`/league/${leagueId}/settings/keepers`} className="text-[#a09aff] hover:text-white">Manage keepers →</Link>
            </p>
          )}
        </div>
      )}

      {!nextScheduleExists && (
        <div className="rounded-2xl p-4 border border-yellow-400/30 bg-yellow-400/5">
          <p className="text-sm text-white font-medium">No {nextYear} schedule yet</p>
          <p className="text-gray-400 text-xs mt-1">
            The {nextYear} DGPT schedule isn't loaded, so there will be no events to select after rollover until it's
            added. An admin can add it (or clone {currentYear}) from the schedule admin. You can still roll over now and
            pick events once the schedule exists.
          </p>
        </div>
      )}

      <div className="border border-red-500/30 rounded-2xl p-5 bg-red-500/5">
        <h2 className="text-red-400 font-semibold mb-1">This can't be undone</h2>
        <p className="text-gray-400 text-sm mb-4">
          The {currentYear} season is archived first, but live rosters, matchups, and the draft are reset. Type{" "}
          <span className="text-white font-mono font-semibold">{nextYear}</span> to confirm.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={String(nextYear)}
            className="w-32 bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-red-400 transition"
          />
          <button
            onClick={run}
            disabled={!armed || pending}
            className="bg-red-600 hover:bg-red-700 disabled:bg-white/10 disabled:text-gray-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:cursor-not-allowed"
          >
            {pending ? "Starting…" : `Start ${nextYear} season`}
          </button>
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </div>
    </div>
  );
}
