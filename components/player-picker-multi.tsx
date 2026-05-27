"use client";

import { useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";

type PlayerOpt = { id: number; name: string; division: "MPO" | "FPO" };

export function PlayerPickerMulti({
  players,
  selectedIds,
}: {
  players: PlayerOpt[];
  selectedIds: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Set<number>>(new Set(selectedIds));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.name.toLowerCase().includes(q));
  }, [players, query]);

  function toggle(id: number) {
    const next = new Set(draft);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraft(next);
  }

  function apply() {
    const ids = Array.from(draft);
    const qs = ids.length > 0 ? `?players=${ids.join(",")}` : "";
    router.push(`${pathname}${qs}`);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(new Set(selectedIds));
          setOpen(true);
        }}
        className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
      >
        {selectedIds.length > 0 ? "Edit selection" : "Pick players"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[#1a1d23] border border-white/10 rounded-2xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="text-white font-bold">Choose players ({draft.size})</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="bg-[#0f1117] border-b border-white/5 px-4 py-2 text-white text-sm focus:outline-none"
            />
            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {filtered.map((p) => {
                const checked = draft.has(p.id);
                const color = p.division === "MPO" ? "#4B3DFF" : "#36D7B7";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${
                      checked ? "bg-[#4B3DFF]/10" : "hover:bg-white/5"
                    }`}
                  >
                    <span
                      className={`shrink-0 w-4 h-4 rounded border ${checked ? "bg-[#4B3DFF] border-[#4B3DFF]" : "border-white/30"}`}
                    >
                      {checked && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    <span className="text-white text-sm flex-1 truncate">{p.name}</span>
                    <span
                      className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                      style={{ color, background: `${color}20` }}
                    >
                      {p.division}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-white/5 px-4 py-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setDraft(new Set())}
                className="text-gray-400 hover:text-white text-sm"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={draft.size === 0}
                className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
              >
                Compare {draft.size > 0 ? `(${draft.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
