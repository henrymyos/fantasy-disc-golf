"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { swapStarter, swapStarterPositions, moveStarterToSlot, toggleStarter } from "@/actions/rosters";
import { ConfirmDropButton } from "@/components/confirm-drop-button";

type RosterSpot = {
  id: number;
  player_id: number;
  players: { name: string; division: string } | null;
};

// spot is null when the slot is empty
type SlotEntry = { spot: RosterSpot | null; slotIndex: number };

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
  locked = false,
}: {
  leagueId: number;
  division: "MPO" | "FPO";
  slotIndex: number;
  occupant: RosterSpot | null;
  benchPlayers: RosterSpot[];
  otherStarters: SlotEntry[];
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const color = divColor(division);
  const isMpo = division === "MPO";
  const bgFilled = isMpo ? "var(--mpo-fill)" : "var(--fpo-fill)";
  const borderFilled = isMpo ? "var(--mpo-fill-border)" : "var(--fpo-fill-border)";

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
          onClick={() => !locked && setOpen(true)}
          disabled={locked}
          className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg transition hover:opacity-80 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color, background: `${color}20` }}
        >
          {division}
        </button>

        {occupant?.players ? (
          <Link
            href={`/league/${leagueId}/player/${occupant.player_id}`}
            className="flex-1 text-white text-sm font-medium truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {occupant.players.name}
          </Link>
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
  otherStarters: SlotEntry[];
  color: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const filledOthers = otherStarters.filter((e) => e.spot !== null) as { spot: RosterSpot; slotIndex: number }[];
  const emptyOthers  = otherStarters.filter((e) => e.spot === null);

  function pickFilledStarter(entry: { spot: RosterSpot; slotIndex: number }) {
    setLoadingKey(`s-${entry.spot.id}`);
    startTransition(async () => {
      if (occupant) {
        // Both filled — swap positions, no one benched
        await swapStarterPositions(leagueId, occupant.id, slotIndex, entry.spot.id, entry.slotIndex);
      } else {
        // Current slot is empty — move the other starter here
        await moveStarterToSlot(leagueId, entry.spot.id, slotIndex);
      }
      onClose();
    });
  }

  function pickEmptySlot(targetSlotIndex: number) {
    if (!occupant) return;
    setLoadingKey(`e-${targetSlotIndex}`);
    startTransition(async () => {
      await moveStarterToSlot(leagueId, occupant.id, targetSlotIndex);
      onClose();
    });
  }

  function pickBench(spot: RosterSpot) {
    setLoadingKey(`b-${spot.id}`);
    startTransition(async () => {
      await swapStarter(leagueId, spot.id, occupant?.id, slotIndex);
      onClose();
    });
  }

  const hasBench        = benchPlayers.length > 0;
  const hasFilledOthers = filledOthers.length > 0;
  const hasEmptyOthers  = emptyOthers.length > 0 && occupant !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1d23] border border-white/10 rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase px-2 py-0.5 rounded" style={{ color, background: `${color}20` }}>
              {division}
            </span>
            <span className="text-white font-bold">Slot {slotIndex}</span>
            {occupant?.players && <span className="text-gray-500 text-xs">· {occupant.players.name}</span>}
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none transition ml-3">×</button>
        </div>

        <div className="px-3 pt-3 pb-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Other filled starters */}
          {hasFilledOthers && (
            <section>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">
                {occupant ? "Swap with starter" : "Move to this slot"}
              </p>
              <div className="space-y-1.5">
                {filledOthers.map(({ spot, slotIndex: otherIdx }) => (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => pickFilledStarter({ spot, slotIndex: otherIdx })}
                    disabled={pending}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5 transition disabled:opacity-50 text-left"
                  >
                    <span className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded" style={{ color, background: `${color}20` }}>
                      {division}
                    </span>
                    <span className="flex-1 text-sm font-medium text-white truncate">
                      {loadingKey === `s-${spot.id}` ? "Moving..." : spot.players?.name}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">
                      {occupant ? `${otherIdx} ⇄ ${slotIndex}` : `Slot ${otherIdx} → ${slotIndex}`}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Empty slots (only shown when current slot has an occupant to move) */}
          {hasEmptyOthers && (
            <section>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">Move to empty slot</p>
              <div className="space-y-1.5">
                {emptyOthers.map(({ slotIndex: otherIdx }) => (
                  <button
                    key={otherIdx}
                    type="button"
                    onClick={() => pickEmptySlot(otherIdx)}
                    disabled={pending}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed hover:bg-white/5 transition disabled:opacity-50 text-left"
                    style={{ borderColor: `${color}40` }}
                  >
                    <span className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded" style={{ color, background: `${color}20` }}>
                      {division}
                    </span>
                    <span className="flex-1 text-sm italic truncate" style={{ color }}>
                      {loadingKey === `e-${otherIdx}` ? "Moving..." : "Empty slot"}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">Slot {otherIdx}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Bench players */}
          {hasBench && (
            <section>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold px-1 mb-1.5">
                {occupant ? "Move from bench" : "Available"}
              </p>
              <div className="space-y-1.5">
                {benchPlayers.map((spot) => (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => pickBench(spot)}
                    disabled={pending}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5 transition disabled:opacity-50 text-left"
                  >
                    <span className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded" style={{ color, background: `${color}20` }}>
                      {division}
                    </span>
                    <span className="flex-1 text-sm font-medium text-white truncate">
                      {loadingKey === `b-${spot.id}` ? "Moving..." : spot.players?.name}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">→ Slot {slotIndex}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!hasBench && !hasFilledOthers && !hasEmptyOthers && (
            <p className="text-gray-600 text-sm text-center py-4">
              No {division} players available — visit Free Agency to add more.
            </p>
          )}
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
  locked = false,
}: {
  leagueId: number;
  benchSpot: RosterSpot;
  starterSlots: (RosterSpot | null)[];
  locked?: boolean;
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
          onClick={() => !locked && setOpen(true)}
          disabled={locked}
          className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg transition hover:opacity-80 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color, background: `${color}20` }}
        >
          {div}
        </button>
        <div className="flex-1 min-w-0">
          <Link
            href={`/league/${leagueId}/player/${benchSpot.player_id}`}
            className="text-white text-sm font-medium truncate hover:underline block"
            onClick={(e) => e.stopPropagation()}
          >
            {player?.name}
          </Link>
        </div>
        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition">
          {!slotsFull && !locked && (
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
      // slotIdx is 0-based here; pass 1-based as newOrder
      await swapStarter(leagueId, benchSpot.id, occupant?.id ?? undefined, slotIdx + 1);
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
                  {isLoading ? "Moving..." : occupant ? (occupant as any).players?.name : "Empty slot"}
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
