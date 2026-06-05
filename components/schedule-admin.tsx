"use client";

import { useState, useTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DgptEvent } from "@/lib/dgpt-2026-schedule";
import {
  upsertScheduleEvent,
  deleteScheduleEvent,
  cloneSeason,
  type ScheduleActionState,
} from "@/actions/schedule";

const EMPTY = {
  slug: "",
  name: "",
  startDate: "",
  endDate: "",
  city: "",
  state: "",
  country: "USA",
  course: "",
  pdgaEventId: "",
  sortOrder: "0",
};

export function ScheduleAdmin({
  seasons,
  year,
  events,
}: {
  seasons: number[];
  year: number;
  events: DgptEvent[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY });
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [state, action, saving] = useActionState<ScheduleActionState, FormData>(upsertScheduleEvent, null);

  // After a successful save, reset the form and refresh the list.
  useEffect(() => {
    if (state?.message === "saved") {
      setForm({ ...EMPTY, sortOrder: String(events.length) });
      setEditingSlug(null);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function editEvent(e: DgptEvent, i: number) {
    setEditingSlug(e.slug);
    setForm({
      slug: e.slug,
      name: e.name,
      startDate: e.startDate,
      endDate: e.endDate,
      city: e.city ?? "",
      state: e.state ?? "",
      country: e.country ?? "USA",
      course: e.course ?? "",
      pdgaEventId: e.pdgaEventId ? String(e.pdgaEventId) : "",
      sortOrder: String(i),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function remove(slug: string) {
    if (!window.confirm(`Delete "${slug}" from ${year}?`)) return;
    startTransition(async () => {
      await deleteScheduleEvent(year, slug);
      router.refresh();
    });
  }

  function clone() {
    if (!window.confirm(`Copy the ${year} schedule forward to ${year + 1} (dates shifted ~1 year)?`)) return;
    startTransition(async () => {
      const r = await cloneSeason(year, year + 1);
      router.push(`/admin/schedule?year=${year + 1}`);
      router.refresh();
      if (r.created === 0) alert(`Nothing to copy — ${year + 1} already has those events.`);
    });
  }

  const field = (k: keyof typeof EMPTY) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  const inputCls =
    "w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] transition";

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">Schedule Admin</h1>
        <div className="flex items-center gap-2">
          {seasons.map((y) => (
            <button
              key={y}
              onClick={() => router.push(`/admin/schedule?year=${y}`)}
              className={`text-sm font-semibold px-3 py-1.5 rounded-lg border transition ${
                y === year
                  ? "border-[#4B3DFF] text-white bg-[#4B3DFF]/15"
                  : "border-white/10 text-gray-300 hover:text-white"
              }`}
            >
              {y}
            </button>
          ))}
          <button
            onClick={clone}
            disabled={pending}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 hover:text-white transition disabled:opacity-50"
          >
            Clone → {year + 1}
          </button>
        </div>
      </div>

      {/* Add / edit form */}
      <form action={action} className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-3">
        <input type="hidden" name="seasonYear" value={year} />
        <h2 className="font-bold text-white">{editingSlug ? `Edit "${editingSlug}"` : "Add event"}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">Slug
            <input name="slug" required {...field("slug")} className={inputCls} placeholder="otb-open" readOnly={!!editingSlug} />
          </label>
          <label className="text-xs text-gray-400">Name
            <input name="name" required {...field("name")} className={inputCls} placeholder="OTB Open" />
          </label>
          <label className="text-xs text-gray-400">Start (YYYY-MM-DD)
            <input name="startDate" required {...field("startDate")} className={inputCls} placeholder="2027-05-21" />
          </label>
          <label className="text-xs text-gray-400">End (YYYY-MM-DD)
            <input name="endDate" required {...field("endDate")} className={inputCls} placeholder="2027-05-24" />
          </label>
          <label className="text-xs text-gray-400">City
            <input name="city" {...field("city")} className={inputCls} placeholder="Stockton" />
          </label>
          <label className="text-xs text-gray-400">State
            <input name="state" {...field("state")} className={inputCls} placeholder="CA" />
          </label>
          <label className="text-xs text-gray-400">Country
            <input name="country" {...field("country")} className={inputCls} placeholder="USA" />
          </label>
          <label className="text-xs text-gray-400">Course
            <input name="course" {...field("course")} className={inputCls} placeholder="Swenson Park" />
          </label>
          <label className="text-xs text-gray-400">PDGA event id
            <input name="pdgaEventId" {...field("pdgaEventId")} className={inputCls} placeholder="96409" />
          </label>
          <label className="text-xs text-gray-400">Sort order
            <input name="sortOrder" {...field("sortOrder")} className={inputCls} placeholder="0" />
          </label>
        </div>
        {state?.errors && (
          <p className="text-red-400 text-xs">
            {Object.entries(state.errors).map(([k, v]) => `${k}: ${v?.[0]}`).join(" · ")}
          </p>
        )}
        {state?.message && state.message !== "saved" && (
          <p className="text-red-400 text-xs">{state.message}</p>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="bg-[#4B3DFF] hover:bg-[#3a2eff] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
            {saving ? "Saving…" : editingSlug ? "Save changes" : "Add event"}
          </button>
          {editingSlug && (
            <button type="button" onClick={() => { setEditingSlug(null); setForm({ ...EMPTY }); }} className="text-sm text-gray-400 hover:text-white px-3 py-2">
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* Event list */}
      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        {events.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No events for {year} yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((e, i) => (
              <div key={e.slug} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{e.name}</p>
                  <p className="text-gray-400 text-xs truncate">
                    {e.startDate} → {e.endDate} · {e.slug}
                  </p>
                </div>
                <button onClick={() => editEvent(e, i)} className="text-xs text-[#a09aff] hover:text-white px-2 py-1">Edit</button>
                <button onClick={() => remove(e.slug)} disabled={pending} className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 disabled:opacity-50">Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
