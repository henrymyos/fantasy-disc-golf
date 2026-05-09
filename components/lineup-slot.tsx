"use client";

import { useState, useTransition } from "react";
import { swapStarter, toggleStarter } from "@/actions/rosters";
import { ConfirmDropButton } from "@/components/confirm-drop-button";

type RosterSpot = {
  id: number;
  player_id: number;
  players: { name: string; division: string } | null;
};

function divColor(div: string) {
  return div === "MPO" ? "#4B3DFF" : "#36D7B7";
}

// ── Starter slot row ─────────────────────────────────────────────────────────

export function LineupSlot({
  leagueId,
  division,
  slotIndex,
  occupant,
  benchPlayers,
  otherStarters,
}: {
  leagueId: number;
  division: "MPO" | "FPO";
  slotIndex: number;
  occupant: RosterSpot | null;
  benchPlayers: RosterSpot[];
  otherStarters: RosterSpot[];
}) {
  const [open, setOpen] = useState(false);
  const color = divColor(division);
  const isMpo = division === "MPO";
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
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg transition hover:opacity-80 active:scale-95"
          style={{ color, background: `${color}20` }}
        >
          {division}
        </button>

        {occupant?.players ? (
          <p className="flex-1 text-white text-sm font-medium truncate">{occupant.players.name}</p>
        ) : (
          <p className="flex-1 text-gray-600 text-sm italic">Empty</p>
        )}

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

      {open && (
        <StarterPickerModal
          leagueId={leagueId}
          division={division}
          slotIndex={slotIndex}
          occupant={occupant}
          benchPlayers={benchPlayers}
          otherStarters={otherStarters}
          color={color}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StarterPickerModal({
  leagueId,
  division,
  slotIndex,
  occupant,
  benchPlayers,
  otherStarters,
  color,
  onClose,
}: {
  leagueId: number;
  division: string;
  slotIndex: number;
  occupant: RosterSpot | null;
  benchPlayers: RosterSpot[];
  otherStarters: RosterSpot[];
  color: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [loadingId, setLoadingId] = useState<number | null>(null);

  function pick(spot: RosterSpot) {
    setLoadingId(spot.id);
    startTransition(async () => {
      // For bench→slot: bench the occupant, start the bench player
      // For starter→slot: bench the occupant only (the other starter stays starter)
      await swapStarter(leagueId, spot.id, occupant?.id);
      onClose();
    });
  }

  const hasBench = benchPlayers.length > 0;
  const hasOtherStarters = otherStarters.length > 0;

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
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-bold uppercase px-2 py-0.5 rounded"
              style={{ color, background: `${color}20` }}
            >
              {division}
            </span>
            <span className="text-white font-bold">Slot {slotIndex}</span>
            {occupant?.players && (
              <span className="text-gray-500 text-xs">· {occupant.players.name}</span>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none transition ml-3">×</button>
        </div>

        <div className="px-3 pt-3 pb-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Other starters of same division */}
          {hasOtherStarters && (
            <section>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">Starting</p>
              <div className="space-y-1.5">
                {otherStarters.map((spot, i) => (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => pick(spot)}
                    disabled={pending}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5 transition disabled:opacity-50 text-left"
                  >
                    <span
                      className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                      style={{ color, background: `${color}20` }}
                    >
                      {division}
                    </span>
                    <span className="flex-1 text-sm font-medium text-white truncate">
                      {loadingId === spot.id ? "Moving..." : spot.players?.name}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">Slot {slotIndex <= i + 1 ? i + 2 : i + 1}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Bench players */}
          {hasBench ? (
            <section>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">Bench</p>
              <div className="space-y-1.5">
                {benchPlayers.map((spot) => (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => pick(spot)}
                    disabled={pending}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5 transition disabled:opacity-50 text-left"
                  >
                    <span
                      className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                      style={{ color, background: `${color}20` }}
                    >
                      {division}
                    </span>
                    <span className="flex-1 text-sm font-medium text-white truncate">
                      {loadingId === spot.id ? "Moving..." : spot.players?.name}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">→ Slot {slotIndex}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : !hasOtherStarters ? (
            <p className="text-gray-600 text-sm text-center py-4">
              No {division} players available — visit Free Agency to add more.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Bench row ─────────────────────────────────────────────────────────────────

export function BenchSlot({
  leagueId,
  benchSpot,
  starterSlots,
}: {
  leagueId: number;
  benchSpot: RosterSpot;
  starterSlots: (RosterSpot | null)[];
}) {
  const [open, setOpen] = useState(false);
  const player = benchSpot.players;
  const div: "MPO" | "FPO" = (player?.division as any) ?? "MPO";
  const color = divColor(div);
  const slotsFull = starterSlots.every((s) => s !== null);

  return (
    <>
      <div className="flex items-center gap-3 p-3 rounded-xl bg-[#0f1117] border border-white/5 group">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg transition hover:opacity-80 active:scale-95"
          style={{ color, background: `${color}20` }}
        >
          {div}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{player?.name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition">
          {!slotsFull && (
            <form action={toggleStarter.bind(null, leagueId, benchSpot.id, true)}>
              <button
                type="submit"
                className="text-xs font-semibold px-3 py-1 rounded-full border transition"
                style={{ color, borderColor: `${color}50` }}
              >
                Start
              </button>
            </form>
          )}
          <ConfirmDropButton
            leagueId={leagueId}
            playerId={benchSpot.player_id}
            playerName={player?.name ?? "Player"}
          />
        </div>
      </div>

      {open && (
        <BenchPickerModal
          leagueId={leagueId}
          benchSpot={benchSpot}
          starterSlots={starterSlots}
          color={color}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BenchPickerModal({
  leagueId,
  benchSpot,
  starterSlots,
  color,
  onClose,
}: {
  leagueId: number;
  benchSpot: RosterSpot;
  starterSlots: (RosterSpot | null)[];
  color: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const player = benchSpot.players;
  const div = player?.division ?? "MPO";

  function pickSlot(slotIdx: number, occupant: RosterSpot | null) {
    setLoadingIdx(slotIdx);
    startTransition(async () => {
      await swapStarter(leagueId, benchSpot.id, occupant?.id ?? undefined);
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
        {/* Header — show who's being moved */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
          <div>
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1">Moving to lineup</p>
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-bold uppercase px-2 py-0.5 rounded"
                style={{ color, background: `${color}20` }}
              >
                {div}
              </span>
              <span className="text-white font-bold">{player?.name}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none transition ml-3">×</button>
        </div>

        {/* Starter slots */}
        <div className="px-3 pt-3 pb-4 space-y-1.5 max-h-72 overflow-y-auto">
          <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">Choose a slot</p>
          {starterSlots.map((occupant, i) => {
            const isLoading = loadingIdx === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => pickSlot(i, occupant)}
                disabled={pending}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition disabled:opacity-50 text-left ${
                  occupant
                    ? "bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5"
                    : "border-dashed hover:bg-white/5"
                }`}
                style={!occupant ? { borderColor: `${color}40` } : {}}
              >
                <span
                  className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                  style={{ color, background: `${color}20` }}
                >
                  {div}
                </span>
                <span className="flex-1 text-sm font-medium truncate" style={{ color: occupant ? undefined : color }}>
                  {isLoading ? "Moving..." : occupant ? occupant.players?.name : "Empty slot"}
                </span>
                <span className="text-xs text-gray-500 shrink-0">Slot {i + 1}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
