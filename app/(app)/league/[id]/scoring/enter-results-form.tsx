"use client";

import { useState } from "react";
import { enterResults } from "@/actions/scoring";
import { BONUS_POINTS } from "@/lib/scoring-constants";
import type { Player } from "@/types";

type ResultRow = { playerId: number; position: number };
type BonusRow = { playerId: number; hotRoundCount: number; bogeyFreeCount: number; aceCount: number };

export function EnterResultsForm({
  leagueId,
  tournamentId,
  players,
}: {
  leagueId: number;
  tournamentId: number;
  players: Player[];
}) {
  const [rows, setRows] = useState<ResultRow[]>([{ playerId: 0, position: 1 }]);
  const [bonusRows, setBonusRows] = useState<BonusRow[]>([]);
  const [saved, setSaved] = useState(false);

  const addRow = () => setRows([...rows, { playerId: 0, position: rows.length + 1 }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof ResultRow, value: number) => {
    const updated = [...rows];
    updated[i] = { ...updated[i], [field]: value };
    setRows(updated);
  };

  const addBonusRow = () =>
    setBonusRows([...bonusRows, { playerId: 0, hotRoundCount: 0, bogeyFreeCount: 0, aceCount: 0 }]);
  const removeBonusRow = (i: number) => setBonusRows(bonusRows.filter((_, idx) => idx !== i));
  const updateBonus = (i: number, field: keyof BonusRow, value: number) => {
    const updated = [...bonusRows];
    updated[i] = { ...updated[i], [field]: value };
    setBonusRows(updated);
  };

  const handleSave = async () => {
    const valid = rows.filter((r) => r.playerId > 0 && r.position > 0);
    if (valid.length === 0) return;
    const validBonuses = bonusRows.filter(
      (b) => b.playerId > 0 && (b.hotRoundCount > 0 || b.bogeyFreeCount > 0 || b.aceCount > 0)
    );
    await enterResults(leagueId, tournamentId, valid, validBonuses);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const enteredPlayerIds = new Set(rows.filter((r) => r.playerId > 0).map((r) => r.playerId));
  const eligiblePlayers = players.filter((p) => enteredPlayerIds.has(p.id));

  return (
    <div className="space-y-5">
      {/* Finishing positions */}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-gray-500 text-sm w-6 text-right">{row.position}</span>
            <select
              value={row.playerId}
              onChange={(e) => updateRow(i, "playerId", Number(e.target.value))}
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
              onChange={(e) => updateRow(i, "position", Number(e.target.value))}
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

      {/* Bonus points section */}
      <div className="border-t border-white/5 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-300">Bonus Points</p>
          <div className="flex gap-3 text-xs text-gray-500">
            <span>🔥 Hot round +{BONUS_POINTS.hotRound}</span>
            <span>✅ Bogey-free +{BONUS_POINTS.bogeyFree}</span>
            <span>🎯 Ace +{BONUS_POINTS.ace}</span>
          </div>
        </div>

        {bonusRows.length > 0 && (
          <div className="space-y-2 mb-3">
            {bonusRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={row.playerId}
                  onChange={(e) => updateBonus(i, "playerId", Number(e.target.value))}
                  className="flex-1 bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#4B3DFF]"
                >
                  <option value={0}>Select player...</option>
                  {(eligiblePlayers.length > 0 ? eligiblePlayers : players).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                  🔥
                  <input
                    type="number"
                    min={0}
                    max={3}
                    value={row.hotRoundCount}
                    onChange={(e) => updateBonus(i, "hotRoundCount", Number(e.target.value))}
                    className="w-10 bg-[#0f1117] border border-white/10 rounded px-1 py-1 text-white text-sm text-center focus:outline-none focus:border-[#4B3DFF]"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                  ✅
                  <input
                    type="number"
                    min={0}
                    max={3}
                    value={row.bogeyFreeCount}
                    onChange={(e) => updateBonus(i, "bogeyFreeCount", Number(e.target.value))}
                    className="w-10 bg-[#0f1117] border border-white/10 rounded px-1 py-1 text-white text-sm text-center focus:outline-none focus:border-[#4B3DFF]"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                  🎯
                  <input
                    type="number"
                    min={0}
                    max={3}
                    value={row.aceCount}
                    onChange={(e) => updateBonus(i, "aceCount", Number(e.target.value))}
                    className="w-10 bg-[#0f1117] border border-white/10 rounded px-1 py-1 text-white text-sm text-center focus:outline-none focus:border-[#4B3DFF]"
                  />
                </label>
                <button
                  onClick={() => removeBonusRow(i)}
                  className="text-gray-600 hover:text-red-400 transition text-lg px-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={addBonusRow}
          className="text-xs text-gray-500 hover:text-gray-300 border border-white/10 hover:border-white/20 px-3 py-1 rounded-lg transition"
        >
          + Add bonus
        </button>
      </div>

      <div className="flex items-center gap-3 pt-1">
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
