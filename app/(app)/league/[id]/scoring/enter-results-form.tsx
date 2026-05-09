"use client";

import { useState } from "react";
import { enterResults } from "@/actions/scoring";
import type { Player } from "@/types";

export function EnterResultsForm({
  leagueId,
  tournamentId,
  players,
}: {
  leagueId: number;
  tournamentId: number;
  players: Player[];
}) {
  const [rows, setRows] = useState<{ playerId: number; position: number }[]>([
    { playerId: 0, position: 1 },
  ]);
  const [saved, setSaved] = useState(false);

  const addRow = () => {
    setRows([...rows, { playerId: 0, position: rows.length + 1 }]);
  };

  const removeRow = (i: number) => {
    setRows(rows.filter((_, idx) => idx !== i));
  };

  const update = (i: number, field: "playerId" | "position", value: number) => {
    const updated = [...rows];
    updated[i] = { ...updated[i], [field]: value };
    setRows(updated);
  };

  const handleSave = async () => {
    const valid = rows.filter((r) => r.playerId > 0 && r.position > 0);
    if (valid.length === 0) return;
    await enterResults(leagueId, tournamentId, valid);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-gray-500 text-sm w-6 text-right">{row.position}</span>
            <select
              value={row.playerId}
              onChange={(e) => update(i, "playerId", Number(e.target.value))}
              className="flex-1 bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#4B3DFF]"
            >
              <option value={0}>Select player...</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.division ?? "MPO"})
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={row.position}
              onChange={(e) => update(i, "position", Number(e.target.value))}
              className="w-16 bg-[#0f1117] border border-white/10 rounded-lg px-2 py-2 text-white text-sm text-center focus:outline-none focus:border-[#4B3DFF]"
            />
            <button
              onClick={() => removeRow(i)}
              className="text-gray-600 hover:text-red-400 transition text-lg px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={addRow}
          className="text-sm text-gray-400 hover:text-white border border-white/10 hover:border-white/20 px-4 py-1.5 rounded-lg transition"
        >
          + Add Player
        </button>
        <button
          onClick={handleSave}
          className={`text-sm font-semibold px-5 py-1.5 rounded-lg transition ${
            saved
              ? "bg-[#36D7B7] text-black"
              : "bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white"
          }`}
        >
          {saved ? "Saved!" : "Save Results"}
        </button>
      </div>
    </div>
  );
}
