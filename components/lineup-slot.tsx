"use client";

import { useState, useTransition } from "react";
import { swapStarter, toggleStarter } from "@/actions/rosters";
import { ConfirmDropButton } from "@/components/confirm-drop-button";

type RosterSpot = {
  id: number;
  player_id: number;
  players: { name: string; division: string } | null;
};

export function LineupSlot({
  leagueId,
  division,
  slotIndex,
  occupant,
  benchPlayers,
}: {
  leagueId: number;
  division: "MPO" | "FPO";
  slotIndex: number;
  occupant: RosterSpot | null;
  benchPlayers: RosterSpot[];
}) {
  const [open, setOpen] = useState(false);
  const isMpo = division === "MPO";
  const color = isMpo ? "#4B3DFF" : "#36D7B7";
  const bgFilled = isMpo ? "rgba(75,61,255,0.12)" : "rgba(54,215,183,0.10)";
  const borderFilled = isMpo ? "rgba(75,61,255,0.19)" : "rgba(54,215,183,0.16)";

  return (
    <>
      <div
        className="flex items-center gap-3 p-3 rounded-xl border"
        style={{
          background: occupant ? bgFilled : "rgba(255,255,255,0.02)",
          borderColor: occupant ? borderFilled : "rgba(255,255,255,0.06)",
        }}
      >
        {/* Clickable division badge */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg transition hover:opacity-80 active:scale-95"
          style={{ color, background: `${color}20` }}
          title={`Pick player for ${division} slot ${slotIndex}`}
        >
          {division}
        </button>

        {/* Player name or empty */}
        {occupant?.players ? (
          <p className="flex-1 text-white text-sm font-medium truncate">{occupant.players.name}</p>
        ) : (
          <p className="flex-1 text-gray-600 text-sm italic">Empty</p>
        )}

        {/* Bench / Drop actions for filled slots */}
        {occupant && (
          <div className="flex items-center gap-2 shrink-0">
            <form action={toggleStarter.bind(null, leagueId, occupant.id, false)}>
              <button
                type="submit"
                className="text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1 rounded-full transition"
              >
                Bench
              </button>
            </form>
            <ConfirmDropButton
              leagueId={leagueId}
              playerId={occupant.player_id}
              playerName={occupant.players?.name ?? "Player"}
            />
          </div>
        )}
      </div>

      {/* Picker modal */}
      {open && (
        <SlotPickerModal
          leagueId={leagueId}
          division={division}
          slotIndex={slotIndex}
          occupant={occupant}
          benchPlayers={benchPlayers}
          color={color}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SlotPickerModal({
  leagueId,
  division,
  slotIndex,
  occupant,
  benchPlayers,
  color,
  onClose,
}: {
  leagueId: number;
  division: string;
  slotIndex: number;
  occupant: RosterSpot | null;
  benchPlayers: RosterSpot[];
  color: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [loadingId, setLoadingId] = useState<number | null>(null);

  function pickBenchPlayer(benchSpot: RosterSpot) {
    setLoadingId(benchSpot.id);
    startTransition(async () => {
      await swapStarter(leagueId, benchSpot.id, occupant?.id);
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1d23] border border-white/10 rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className="text-xs font-bold uppercase px-2 py-0.5 rounded"
                style={{ color, background: `${color}20` }}
              >
                {division}
              </span>
              <span className="text-white font-bold">Slot {slotIndex}</span>
            </div>
            <p className="text-gray-500 text-xs">
              {occupant ? `Swapping out ${occupant.players?.name}` : "Pick a player to fill this slot"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-white text-xl leading-none transition ml-4"
          >
            ×
          </button>
        </div>

        {/* Current occupant (if any) — shown at top so user knows who's being replaced */}
        {occupant?.players && (
          <div className="px-3 pt-3">
            <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">Current</p>
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
              style={{ background: `${color}10`, borderColor: `${color}30` }}
            >
              <span
                className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                style={{ color, background: `${color}20` }}
              >
                {division}
              </span>
              <span className="flex-1 text-sm font-medium text-white">{occupant.players.name}</span>
              <span className="text-xs text-gray-500">Slot {slotIndex}</span>
            </div>
          </div>
        )}

        {/* Bench players */}
        <div className="px-3 pt-3 pb-3 max-h-64 overflow-y-auto">
          {benchPlayers.length > 0 ? (
            <>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">
                {occupant ? "Swap in" : "Available"}
              </p>
              <div className="space-y-1.5">
                {benchPlayers.map((spot) => (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => pickBenchPlayer(spot)}
                    disabled={pending}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5 transition disabled:opacity-50 text-left"
                  >
                    <span
                      className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                      style={{ color, background: `${color}20` }}
                    >
                      {division}
                    </span>
                    <span className="flex-1 text-sm font-medium text-white">
                      {loadingId === spot.id ? "Moving..." : spot.players?.name}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">
                      {occupant ? `→ Slot ${slotIndex}` : `Slot ${slotIndex}`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-600 text-sm text-center py-6">
              No {division} players on bench — visit Free Agency to add more.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
