"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type TournamentOpt = {
  id: number;
  name: string;
  startDate: string;
};

export function TournamentRangePicker({
  tournaments,
  selectedFrom,
  selectedTo,
}: {
  tournaments: TournamentOpt[];
  selectedFrom: number | null;
  selectedTo: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState<number | "">(selectedFrom ?? "");
  const [to, setTo] = useState<number | "">(selectedTo ?? "");

  function apply(nextFrom: number | "", nextTo: number | "") {
    const sp = new URLSearchParams(searchParams.toString());
    if (nextFrom === "") sp.delete("from");
    else sp.set("from", String(nextFrom));
    if (nextTo === "") sp.delete("to");
    else sp.set("to", String(nextTo));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setFromAndApply(v: number | "") {
    setFrom(v);
    apply(v, to);
  }
  function setToAndApply(v: number | "") {
    setTo(v);
    apply(from, v);
  }
  function clear() {
    setFrom("");
    setTo("");
    apply("", "");
  }

  const isFiltered = from !== "" || to !== "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-gray-400 text-[10px] uppercase tracking-wider">From</span>
        <select
          value={from}
          onChange={(e) => setFromAndApply(e.target.value === "" ? "" : Number(e.target.value))}
          className="bg-[#1a1d23] border border-white/10 hover:border-white/30 rounded-lg px-3 py-2 text-white text-sm cursor-pointer focus:outline-none"
        >
          <option value="">Season start</option>
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {formatLabel(t)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-gray-400 text-[10px] uppercase tracking-wider">To</span>
        <select
          value={to}
          onChange={(e) => setToAndApply(e.target.value === "" ? "" : Number(e.target.value))}
          className="bg-[#1a1d23] border border-white/10 hover:border-white/30 rounded-lg px-3 py-2 text-white text-sm cursor-pointer focus:outline-none"
        >
          <option value="">Latest</option>
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {formatLabel(t)}
            </option>
          ))}
        </select>
      </label>

      {isFiltered && (
        <button
          type="button"
          onClick={clear}
          className="text-xs text-gray-300 hover:text-white border border-white/10 hover:border-white/30 px-3 py-2 rounded-lg transition"
        >
          Reset
        </button>
      )}
    </div>
  );
}

function formatLabel(t: TournamentOpt): string {
  const date = t.startDate
    ? new Date(t.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  return date ? `${date} — ${t.name}` : t.name;
}
