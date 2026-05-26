"use client";

import { useTransition } from "react";
import { updateMatchupTeams } from "@/actions/matchups";

type Member = { id: number; team_name: string; division_name: string | null };
type Matchup = {
  id: number;
  week: number;
  team1_id: number;
  team2_id: number;
  is_final: boolean;
};

export function MatchupsEditor({
  leagueId,
  currentWeek,
  members,
  matchups,
}: {
  leagueId: number;
  currentWeek: number;
  members: Member[];
  matchups: Matchup[];
}) {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const byWeek = new Map<number, Matchup[]>();
  for (const m of matchups) {
    const arr = byWeek.get(m.week) ?? [];
    arr.push(m);
    byWeek.set(m.week, arr);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  if (weeks.length === 0) {
    return (
      <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
        <p className="text-gray-400 text-sm">
          No matchups generated yet — finish the draft (or click Regenerate in Settings).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {weeks.map((week) => (
        <div key={week} className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">
              Week {week}
              {week === currentWeek && <span className="text-[#36D7B7] text-xs ml-2">• Current</span>}
            </h3>
          </div>
          <div className="space-y-2">
            {byWeek.get(week)!.map((m) => (
              <MatchupRow
                key={m.id}
                leagueId={leagueId}
                matchup={m}
                members={members}
                memberById={memberById}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchupRow({
  leagueId,
  matchup,
  members,
  memberById,
}: {
  leagueId: number;
  matchup: Matchup;
  members: Member[];
  memberById: Map<number, Member>;
}) {
  const [pending, startTransition] = useTransition();

  function change(which: 1 | 2, newTeamId: number) {
    const t1 = which === 1 ? newTeamId : matchup.team1_id;
    const t2 = which === 2 ? newTeamId : matchup.team2_id;
    if (t1 === t2) return;
    startTransition(async () => {
      await updateMatchupTeams(leagueId, matchup.id, t1, t2);
    });
  }

  const t1 = memberById.get(matchup.team1_id);
  const t2 = memberById.get(matchup.team2_id);

  return (
    <div className="flex items-center gap-2 bg-[#0f1117] border border-white/5 rounded-xl p-3">
      <select
        value={matchup.team1_id}
        disabled={matchup.is_final || pending}
        onChange={(e) => change(1, Number(e.target.value))}
        className="flex-1 bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-[#4B3DFF] disabled:opacity-50"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id} disabled={m.id === matchup.team2_id}>
            {m.team_name}
            {m.division_name ? ` · ${m.division_name}` : ""}
          </option>
        ))}
      </select>
      <span className="text-gray-400 text-xs px-1">vs</span>
      <select
        value={matchup.team2_id}
        disabled={matchup.is_final || pending}
        onChange={(e) => change(2, Number(e.target.value))}
        className="flex-1 bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-[#4B3DFF] disabled:opacity-50"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id} disabled={m.id === matchup.team1_id}>
            {m.team_name}
            {m.division_name ? ` · ${m.division_name}` : ""}
          </option>
        ))}
      </select>
      {matchup.is_final && (
        <span className="text-[10px] uppercase tracking-wider text-gray-400 px-2">Final</span>
      )}
      {!t1 || !t2 ? <span className="text-red-400 text-xs">unset</span> : null}
    </div>
  );
}
