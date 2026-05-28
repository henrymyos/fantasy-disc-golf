"use client";

import { useEffect, useId, useRef, useState } from "react";

// 16 fixed durations for the per-pick draft timer. Values are seconds.
const DURATIONS: { label: string; seconds: number }[] = [
  { label: "10 sec", seconds: 10 },
  { label: "30 sec", seconds: 30 },
  { label: "1 min", seconds: 60 },
  { label: "2 min", seconds: 2 * 60 },
  { label: "5 min", seconds: 5 * 60 },
  { label: "10 min", seconds: 10 * 60 },
  { label: "30 min", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "2 hours", seconds: 2 * 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "12 hours", seconds: 12 * 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "2 days", seconds: 2 * 24 * 60 * 60 },
  { label: "3 days", seconds: 3 * 24 * 60 * 60 },
  { label: "5 days", seconds: 5 * 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

function labelFor(seconds: number): string {
  const match = DURATIONS.find((d) => d.seconds === seconds);
  if (match) return match.label;
  // Fallback for legacy values that aren't on the dial — show "Xs" / "Xm" / "Xh"
  // so the trigger isn't blank if a league sits on an old custom value.
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr`;
  return `${Math.round(seconds / 86400)} day`;
}

/**
 * Dark-themed dropdown for picking a draft pick-timer duration. Renders a
 * trigger button styled like the rest of the app, plus a popover panel below
 * with the fixed duration choices. Posts the chosen value via a hidden input
 * so it plugs into the existing server-action form on the draft page.
 */
export function DurationPicker({
  name,
  defaultSeconds,
}: {
  name: string;
  defaultSeconds: number;
}) {
  const [seconds, setSeconds] = useState<number>(defaultSeconds);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <input type="hidden" name={name} value={seconds} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`bg-[#0f1117] border rounded-lg px-3 py-2 text-white text-sm transition inline-flex items-center gap-2 min-w-[120px] justify-between ${
          open
            ? "border-[#4B3DFF]/60"
            : "border-white/10 hover:border-white/30"
        }`}
      >
        <span className="tabular-nums">{labelFor(seconds)}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="absolute left-0 top-full mt-2 z-30 w-44 max-h-72 overflow-y-auto bg-[#1a1d23] border border-white/10 rounded-xl shadow-xl p-1"
        >
          {DURATIONS.map((d) => {
            const selected = d.seconds === seconds;
            return (
              <button
                key={d.seconds}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setSeconds(d.seconds);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between ${
                  selected
                    ? "bg-[#4B3DFF]/15 text-white"
                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="tabular-nums">{d.label}</span>
                {selected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#4B3DFF"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
