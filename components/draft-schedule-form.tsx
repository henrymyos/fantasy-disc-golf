"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { scheduleDraft } from "@/actions/drafts";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const ITEM_HEIGHT = 36;
const VISIBLE_ROWS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const PADDING = (PICKER_HEIGHT - ITEM_HEIGHT) / 2;

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function defaultStart(): Date {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

export function DraftScheduleForm({
  leagueId,
  scheduledAt,
}: {
  leagueId: number;
  scheduledAt: string | null;
}) {
  const initial = useMemo(() => {
    if (scheduledAt) {
      const d = new Date(scheduledAt);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return defaultStart();
  }, [scheduledAt]);

  const thisYear = new Date().getFullYear();

  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth() + 1);
  const [day, setDay] = useState(initial.getDate());
  const [hour12, setHour12] = useState(((initial.getHours() + 11) % 12) + 1);
  const [minute, setMinute] = useState(initial.getMinutes() - (initial.getMinutes() % 5));
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(initial.getHours() < 12 ? "AM" : "PM");
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDay = daysInMonth(year, month);
  const safeDay = Math.min(day, maxDay);

  const selectedDate = useMemo(() => {
    const hour24 = meridiem === "AM"
      ? (hour12 === 12 ? 0 : hour12)
      : (hour12 === 12 ? 12 : hour12 + 12);
    return new Date(year, month - 1, safeDay, hour24, minute, 0, 0);
  }, [year, month, safeDay, hour12, minute, meridiem]);

  const isFuture = selectedDate.getTime() > Date.now();

  function handleSubmit() {
    if (!isFuture) {
      setError("Pick a time in the future.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await scheduleDraft(leagueId, selectedDate.toISOString());
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      try {
        await scheduleDraft(leagueId, null);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to clear");
      }
    });
  }

  const monthItems = useMemo(() => MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m })), []);
  const dayItems = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [maxDay],
  );
  const yearItems = useMemo(
    () => Array.from({ length: 3 }, (_, i) => ({ value: thisYear + i, label: String(thisYear + i) })),
    [thisYear],
  );
  const hourItems = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [],
  );
  const minuteItems = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ value: i * 5, label: (i * 5).toString().padStart(2, "0") })),
    [],
  );
  const meridiemItems = useMemo(
    () => [{ value: "AM" as const, label: "AM" }, { value: "PM" as const, label: "PM" }],
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-gray-400 mb-2">Draft date & time</p>
        <div className="bg-[#0f1117] border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white text-base font-bold">
            {selectedDate.toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          {!isFuture && (
            <p className="text-red-400 text-xs mt-1">That time is in the past — swipe forward.</p>
          )}
        </div>
      </div>

      <div className="bg-[#0f1117] border border-white/10 rounded-2xl p-2 select-none">
        {/* Label row */}
        <div className="grid grid-cols-6 gap-1 px-1 mb-1">
          {["Month", "Day", "Year", "Hour", "Min", "AM/PM"].map((l) => (
            <p
              key={l}
              className="text-[10px] text-gray-500 uppercase tracking-wider text-center"
            >
              {l}
            </p>
          ))}
        </div>
        {/* Wheels row — band lives in here so it lines up perfectly */}
        <div className="relative" style={{ height: PICKER_HEIGHT }}>
          <div
            className="pointer-events-none absolute left-0 right-0 border-y border-white/15 bg-white/[0.04] rounded-md"
            style={{ top: PADDING, height: ITEM_HEIGHT }}
          />
          <div className="grid grid-cols-6 gap-1 h-full">
            <Wheel items={monthItems} value={month} onChange={setMonth} />
            <Wheel items={dayItems} value={safeDay} onChange={setDay} />
            <Wheel items={yearItems} value={year} onChange={setYear} />
            <Wheel items={hourItems} value={hour12} onChange={setHour12} />
            <Wheel items={minuteItems} value={minute} onChange={setMinute} />
            <Wheel
              items={meridiemItems}
              value={meridiem}
              onChange={(v) => setMeridiem(v as "AM" | "PM")}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isFuture || pending}
          className="bg-[#4B3DFF] hover:bg-[#3a2ee0] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2 rounded-lg transition"
        >
          {pending ? "Saving..." : saved ? "Saved ✓" : "Set schedule"}
        </button>
        {scheduledAt && (
          <button
            type="button"
            onClick={handleClear}
            disabled={pending}
            className="border border-white/10 hover:border-white/30 text-gray-300 text-sm px-3 py-2 rounded-lg transition"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

type WheelItem<T> = { value: T; label: string };

function Wheel<T>({
  items,
  value,
  onChange,
}: {
  items: WheelItem<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const index = Math.max(0, items.findIndex((it) => it.value === value));

  // Sync external value → scroll position when it changes from outside (or on
  // first mount). Skip if we're already aligned.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = index * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTop = target;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const raw = el.scrollTop / ITEM_HEIGHT;
      const i = Math.min(items.length - 1, Math.max(0, Math.round(raw)));
      // Snap to exact position.
      const snappedTop = i * ITEM_HEIGHT;
      if (Math.abs(el.scrollTop - snappedTop) > 0.5) {
        el.scrollTo({ top: snappedTop, behavior: "smooth" });
      }
      if (items[i] && items[i].value !== value) {
        onChange(items[i].value);
      }
    }, 90);
  }

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="relative overflow-y-auto no-scrollbar"
      style={{
        height: PICKER_HEIGHT,
        scrollSnapType: "y mandatory",
      }}
    >
      <div style={{ paddingTop: PADDING, paddingBottom: PADDING }}>
        {items.map((it, i) => {
          const distance = Math.abs(i - index);
          const opacity = distance === 0 ? 1 : distance === 1 ? 0.55 : distance === 2 ? 0.3 : 0.15;
          const fontWeight = distance === 0 ? 700 : 500;
          return (
            <div
              key={String(it.value)}
              style={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: "center",
                scrollSnapStop: "always",
                opacity,
                fontWeight,
              }}
              className="flex items-center justify-center text-white text-sm tabular-nums"
              onClick={() => onChange(it.value)}
            >
              {it.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
