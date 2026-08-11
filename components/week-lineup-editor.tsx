"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { saveWeekLineupPlan } from "@/actions/lineup-plans";
import type { PlannedStarter } from "@/lib/lineup-plans";
import { PlayerPhoto, WeekPointsBadge, type WeekPoints } from "@/components/lineup-slot";

export type EditorPlayer = {
  playerId: number;
  name: string;
  division: "MPO" | "FPO";
  avatarUrl: string | null;
  nickname: string | null;
  points: WeekPoints;
};

function divColor(div: string) {
  return div === "MPO" ? "#4B3DFF" : "#36D7B7";
}

type SlotKey = string; // "MPO1", "FPO2", ...

/**
 * Editable lineup for a FUTURE week. All state lives client-side as a map of
 * slot → player; every change saves the whole plan via saveWeekLineupPlan.
 * Unlike the live lineup this is never locked — the plan only becomes the
 * real roster when the week arrives.
 */
export function WeekLineupEditor({
  leagueId,
  week,
  mpoSlots,
  fpoSlots,
  players,
  initialStarters,
  canSave,
}: {
  leagueId: number;
  week: number;
  mpoSlots: number;
  fpoSlots: number;
  players: EditorPlayer[];
  initialStarters: PlannedStarter[];
  canSave: boolean;
}) {
  const playerById = useMemo(
    () => new Map(players.map((p) => [p.playerId, p])),
    [players],
  );

  const [slots, setSlots] = useState<Record<SlotKey, number | null>>(() => {
    const init: Record<SlotKey, number | null> = {};
    for (let i = 1; i <= mpoSlots; i++) init[`MPO${i}`] = null;
    for (let i = 1; i <= fpoSlots; i++) init[`FPO${i}`] = null;
    for (const s of initialStarters) {
      const key = `${s.slot}${s.order}`;
      const p = playerById.get(s.player_id);
      if (key in init && init[key] === null && p && p.division === s.slot) {
        init[key] = s.player_id;
      }
    }
    return init;
  });
  const [openSlot, setOpenSlot] = useState<SlotKey | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, startTransition] = useTransition();
  const saveSeq = useRef(0);

  const startedIds = new Set(Object.values(slots).filter((v): v is number => v != null));
  const benchFor = (div: "MPO" | "FPO") =>
    players
      .filter((p) => p.division === div && !startedIds.has(p.playerId))
      .sort((a, b) => (b.points?.projected ?? -1) - (a.points?.projected ?? -1));
  const bench = [...benchFor("MPO"), ...benchFor("FPO")];

  function commit(nextSlots: Record<SlotKey, number | null>) {
    setSlots(nextSlots);
    if (!canSave) return;
    const starters: PlannedStarter[] = [];
    for (const [key, pid] of Object.entries(nextSlots)) {
      if (pid == null) continue;
      const slot = key.startsWith("FPO") ? "FPO" : "MPO";
      starters.push({ player_id: pid, slot, order: Number(key.slice(3)) });
    }
    const seq = ++saveSeq.current;
    setStatus("saving");
    startTransition(async () => {
      const res = await saveWeekLineupPlan(leagueId, week, starters);
      if (seq !== saveSeq.current) return; // a newer save superseded this one
      setStatus(res.ok ? "saved" : "error");
    });
  }

  function assign(slotKey: SlotKey, playerId: number | null) {
    const next = { ...slots };
    // If the player already occupies another slot, vacate it (swap-style).
    if (playerId != null) {
      for (const k of Object.keys(next)) {
        if (next[k] === playerId) next[k] = slots[slotKey] ?? null;
      }
    }
    next[slotKey] = playerId;
    commit(next);
    setOpenSlot(null);
  }

  const slotKeysFor = (div: "MPO" | "FPO") =>
    Array.from({ length: div === "MPO" ? mpoSlots : fpoSlots }, (_, i) => `${div}${i + 1}`);

  const renderSlotRow = (slotKey: SlotKey) => {
    const div: "MPO" | "FPO" = slotKey.startsWith("FPO") ? "FPO" : "MPO";
    const color = divColor(div);
    const isMpo = div === "MPO";
    const pid = slots[slotKey];
    const p = pid != null ? playerById.get(pid) ?? null : null;
    return (
      <div
        key={slotKey}
        className="flex items-center gap-3 p-3 rounded-xl border"
        style={{
          background: p ? (isMpo ? "var(--mpo-fill)" : "var(--fpo-fill)") : "rgba(255,255,255,0.02)",
          borderColor: p
            ? isMpo ? "var(--mpo-fill-border)" : "var(--fpo-fill-border)"
            : "rgba(255,255,255,0.06)",
        }}
      >
        <button
          type="button"
          onClick={() => setOpenSlot(slotKey)}
          className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg transition hover:opacity-80 active:scale-95"
          style={{ color, background: `${color}20` }}
        >
          {div}
        </button>
        {p ? (
          <>
            <PlayerPhoto player={{ name: p.name, avatar_url: p.avatarUrl }} />
            <div className="flex-1 min-w-0">
              <Link
                href={`/league/${leagueId}/player/${p.playerId}`}
                className="block text-white text-sm font-medium truncate hover:underline"
              >
                {p.name}
              </Link>
              {p.nickname && <p className="text-gray-400 text-xs truncate">({p.nickname})</p>}
            </div>
            <WeekPointsBadge wp={p.points} />
          </>
        ) : (
          <p className="flex-1 text-gray-400 text-sm italic">Empty</p>
        )}
      </div>
    );
  };

  const openDiv: "MPO" | "FPO" | null = openSlot ? (openSlot.startsWith("FPO") ? "FPO" : "MPO") : null;
  const openOccupant = openSlot ? (slots[openSlot] != null ? playerById.get(slots[openSlot]!) ?? null : null) : null;

  return (
    <>
      {!canSave && (
        <p className="text-xs text-yellow-300/80 bg-yellow-400/10 border border-yellow-400/20 rounded-xl px-4 py-2.5 mb-4">
          Future-week lineups can&apos;t be saved yet — the commissioner needs to run the
          latest database migration.
        </p>
      )}
      <div className="space-y-2 mb-6">
        {slotKeysFor("MPO").map(renderSlotRow)}
        {slotKeysFor("FPO").map(renderSlotRow)}
      </div>

      {bench.length > 0 && (
        <>
          <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">Bench</h3>
          <div className="space-y-2">
            {bench.map((p) => {
              const color = divColor(p.division);
              const firstEmpty = slotKeysFor(p.division).find((k) => slots[k] == null);
              return (
                <div key={p.playerId} className="flex items-center gap-3 p-3 rounded-xl bg-[#0f1117] border border-white/5 group">
                  <button
                    type="button"
                    onClick={() => {
                      const target = firstEmpty ?? slotKeysFor(p.division)[0];
                      if (target) setOpenSlot(target);
                    }}
                    className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg transition hover:opacity-80 active:scale-95"
                    style={{ color, background: `${color}20` }}
                  >
                    {p.division}
                  </button>
                  <PlayerPhoto player={{ name: p.name, avatar_url: p.avatarUrl }} />
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/league/${leagueId}/player/${p.playerId}`}
                      className="text-white text-sm font-medium truncate hover:underline block"
                    >
                      {p.name}
                    </Link>
                    {p.nickname && <p className="text-gray-400 text-xs truncate">({p.nickname})</p>}
                  </div>
                  <WeekPointsBadge wp={p.points} />
                  {firstEmpty && (
                    <button
                      type="button"
                      onClick={() => assign(firstEmpty, p.playerId)}
                      className="shrink-0 text-xs font-semibold px-3 py-1 rounded-full border transition opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      style={{ color, borderColor: `${color}50` }}
                    >
                      Start
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="text-right text-[11px] mt-3 h-4">
        {status === "saving" && <span className="text-gray-400">Saving…</span>}
        {status === "saved" && <span className="text-[#36D7B7]">Saved for week {week} ✓</span>}
        {status === "error" && <span className="text-red-400">Couldn&apos;t save — try again</span>}
      </p>

      {openSlot && openDiv && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4"
          onClick={() => setOpenSlot(null)}
        >
          <div
            className="bg-[#1a1d23] border border-white/10 rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="text-xs font-bold uppercase px-2 py-0.5 rounded shrink-0"
                  style={{ color: divColor(openDiv), background: `${divColor(openDiv)}20` }}
                >
                  {openDiv}
                </span>
                <span className="text-white font-bold shrink-0">Slot {openSlot.slice(3)}</span>
                {openOccupant && (
                  <span className="text-gray-400 text-xs truncate">· {openOccupant.name}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpenSlot(null)}
                className="text-gray-400 hover:text-white text-xl leading-none transition ml-3"
              >
                ×
              </button>
            </div>

            <div className="px-3 pt-3 pb-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Other starters in this division — swap */}
              {(() => {
                const others = slotKeysFor(openDiv)
                  .filter((k) => k !== openSlot && slots[k] != null)
                  .map((k) => ({ key: k, p: playerById.get(slots[k]!)! }));
                if (others.length === 0) return null;
                return (
                  <section>
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold px-1 mb-1.5">
                      {openOccupant ? "Swap with starter" : "Move to this slot"}
                    </p>
                    <div className="space-y-1.5">
                      {others.map(({ key, p }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => assign(openSlot, p.playerId)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5 transition text-left"
                        >
                          <span
                            className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                            style={{ color: divColor(openDiv), background: `${divColor(openDiv)}20` }}
                          >
                            {openDiv}
                          </span>
                          <PlayerPhoto player={{ name: p.name, avatar_url: p.avatarUrl }} />
                          <span className="flex-1 text-sm font-medium text-white truncate">{p.name}</span>
                          <WeekPointsBadge wp={p.points} />
                          <span className="text-xs text-gray-400 shrink-0">
                            {openOccupant ? `${key.slice(3)} ⇄ ${openSlot.slice(3)}` : `Slot ${key.slice(3)} → ${openSlot.slice(3)}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })()}

              {/* Bench players of this division */}
              {(() => {
                const options = benchFor(openDiv);
                if (options.length === 0) return null;
                return (
                  <section>
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold px-1 mb-1.5">
                      {openOccupant ? "Move from bench" : "Available"}
                    </p>
                    <div className="space-y-1.5">
                      {options.map((p) => (
                        <button
                          key={p.playerId}
                          type="button"
                          onClick={() => assign(openSlot, p.playerId)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-[#0f1117] border-white/5 hover:border-white/20 hover:bg-white/5 transition text-left"
                        >
                          <span
                            className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded"
                            style={{ color: divColor(openDiv), background: `${divColor(openDiv)}20` }}
                          >
                            {openDiv}
                          </span>
                          <PlayerPhoto player={{ name: p.name, avatar_url: p.avatarUrl }} />
                          <span className="flex-1 text-sm font-medium text-white truncate">{p.name}</span>
                          <WeekPointsBadge wp={p.points} />
                          <span className="text-xs text-gray-400 shrink-0">→ Slot {openSlot.slice(3)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })()}

              {openOccupant && (
                <section>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold px-1 mb-1.5">
                    Send to bench
                  </p>
                  <button
                    type="button"
                    onClick={() => assign(openSlot, null)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed border-white/15 hover:border-white/30 hover:bg-white/5 transition text-left"
                  >
                    <span className="text-xs font-bold uppercase w-10 shrink-0 text-center py-0.5 rounded text-gray-400 bg-white/5">
                      —
                    </span>
                    <span className="flex-1 text-sm italic text-gray-400">Empty bench spot</span>
                    <span className="text-xs text-gray-400 shrink-0">Bench</span>
                  </button>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
