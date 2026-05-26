"use client";

import { useMemo, useState, useTransition } from "react";
import { commissionerSetPlayerTeam } from "@/actions/rosters";

type Team = { id: number; teamName: string };

type RosteredPlayer = {
  playerId: number;
  playerName: string;
  division: "MPO" | "FPO";
  teamId: number;
  isStarter: boolean;
};

type FreeAgent = {
  playerId: number;
  playerName: string;
  division: "MPO" | "FPO";
};

export function CommissionerRostersEditor({
  leagueId,
  teams,
  rostered,
  freeAgents,
}: {
  leagueId: number;
  teams: Team[];
  rostered: RosteredPlayer[];
  freeAgents: FreeAgent[];
}) {
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function setTeam(playerId: number, newTeamId: number | null) {
    const key = `${playerId}:${newTeamId ?? "drop"}`;
    setBusyKey(key);
    startTransition(async () => {
      await commissionerSetPlayerTeam(leagueId, playerId, newTeamId);
      setBusyKey(null);
    });
  }

  return (
    <div className="space-y-5">
      {teams.map((team) => {
        const teamRoster = rostered
          .filter((p) => p.teamId === team.id)
          .sort((a, b) => {
            // MPO before FPO, then by player name.
            if (a.division !== b.division) return a.division === "MPO" ? -1 : 1;
            return a.playerName.localeCompare(b.playerName);
          });
        return (
          <TeamCard
            key={team.id}
            team={team}
            otherTeams={teams.filter((t) => t.id !== team.id)}
            roster={teamRoster}
            freeAgents={freeAgents}
            onMove={setTeam}
            pending={pending}
            busyKey={busyKey}
          />
        );
      })}
    </div>
  );
}

function TeamCard({
  team,
  otherTeams,
  roster,
  freeAgents,
  onMove,
  pending,
  busyKey,
}: {
  team: Team;
  otherTeams: Team[];
  roster: RosteredPlayer[];
  freeAgents: FreeAgent[];
  onMove: (playerId: number, newTeamId: number | null) => void;
  pending: boolean;
  busyKey: string | null;
}) {
  const [addPlayerId, setAddPlayerId] = useState<number | "">("");
  const sortedFAs = useMemo(
    () => [...freeAgents].sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [freeAgents],
  );

  return (
    <div className="bg-[#1a1d23] rounded-2xl border border-white/5">
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-white font-bold text-base">{team.teamName}</h3>
        <span className="text-gray-400 text-xs">{roster.length} player{roster.length !== 1 ? "s" : ""}</span>
      </div>

      <ul className="divide-y divide-white/5">
        {roster.length === 0 && (
          <li className="px-5 py-4 text-gray-400 text-sm">No players on this team.</li>
        )}
        {roster.map((p) => {
          const accent = p.division === "MPO" ? "#4B3DFF" : "#36D7B7";
          const rowBusy = pending && busyKey?.startsWith(`${p.playerId}:`);
          return (
            <li key={p.playerId} className="flex items-center gap-3 px-5 py-3">
              <span
                className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                style={{ color: accent, background: `${accent}20` }}
              >
                {p.division}
              </span>
              <span className="text-white text-sm font-medium flex-1 truncate">{p.playerName}</span>
              <select
                disabled={rowBusy}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v === "drop") onMove(p.playerId, null);
                  else onMove(p.playerId, Number(v));
                  e.target.value = "";
                }}
                className="text-xs bg-[#0f1117] border border-white/10 hover:border-white/30 rounded-lg px-2 py-1.5 text-gray-300 cursor-pointer disabled:opacity-50"
              >
                <option value="">Move…</option>
                {otherTeams.map((t) => (
                  <option key={t.id} value={t.id}>{t.teamName}</option>
                ))}
                <option value="drop">Drop to free agents</option>
              </select>
            </li>
          );
        })}
      </ul>

      <div className="px-5 py-3 border-t border-white/5 flex items-center gap-2">
        <select
          value={addPlayerId}
          onChange={(e) => setAddPlayerId(e.target.value ? Number(e.target.value) : "")}
          className="flex-1 text-xs bg-[#0f1117] border border-white/10 hover:border-white/30 rounded-lg px-2 py-2 text-gray-300 cursor-pointer"
          disabled={pending || sortedFAs.length === 0}
        >
          <option value="">
            {sortedFAs.length === 0 ? "No free agents" : "Add free agent…"}
          </option>
          {sortedFAs.map((p) => (
            <option key={p.playerId} value={p.playerId}>
              {p.playerName} ({p.division})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!addPlayerId || pending}
          onClick={() => {
            if (typeof addPlayerId === "number") {
              onMove(addPlayerId, team.id);
              setAddPlayerId("");
            }
          }}
          className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
