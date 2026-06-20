"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTeamSettings } from "@/actions/team";

type PlayerRow = { id: number; name: string; division: string; nickname: string };

export function EditTeamForm({
  leagueId,
  initialName,
  players,
}: {
  leagueId: number;
  initialName: string;
  players: PlayerRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [nicknames, setNicknames] = useState<Record<number, string>>(
    () => Object.fromEntries(players.map((p) => [p.id, p.nickname])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startSave(async () => {
      try {
        const fd = new FormData();
        fd.set("teamName", name);
        for (const p of players) fd.set(`nickname_${p.id}`, nicknames[p.id] ?? "");
        const res = await updateTeamSettings(leagueId, fd);
        if (res?.error) setError(res.error);
        else {
          setSaved(true);
          router.refresh();
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Team name */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">
          Team name
        </label>
        <input
          type="text"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#4B3DFF]"
        />
      </div>

      {/* Player nicknames */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">
          Player nicknames
        </p>
        {players.length === 0 ? (
          <p className="text-gray-400 text-sm">
            No players on your team yet. Draft or add players, then come back to nickname them.
          </p>
        ) : (
          <div className="space-y-3">
            {players.map((p) => {
              const color = p.division === "MPO" ? "#4B3DFF" : "#36D7B7";
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{p.name}</p>
                    <span
                      className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{ color, background: `${color}20` }}
                    >
                      {p.division}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={nicknames[p.id] ?? ""}
                    maxLength={24}
                    placeholder="Nickname"
                    onChange={(e) =>
                      setNicknames((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    className="w-40 shrink-0 bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF]"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || name.trim().length === 0}
          className="bg-[#4B3DFF] hover:bg-[#3a2eff] disabled:bg-white/10 disabled:text-gray-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && !saving && <span className="text-[#36D7B7] text-sm">Saved</span>}
      </div>
    </div>
  );
}
