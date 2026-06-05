"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { getScheduleEvents } from "@/lib/schedule";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) throw new Error("Not authorized");
  return createAdminClient();
}

const EventSchema = z.object({
  seasonYear: z.coerce.number().int().min(2000).max(2100),
  slug: z.string().min(1).max(80).trim().toLowerCase(),
  name: z.string().min(1).max(120).trim(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  city: z.string().max(80).trim().optional().nullable(),
  state: z.string().max(40).trim().optional().nullable(),
  country: z.string().max(60).trim().default("USA"),
  course: z.string().max(160).trim().optional().nullable(),
  pdgaEventId: z.coerce.number().int().positive().optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
});

export type ScheduleActionState = { errors?: Record<string, string[]>; message?: string } | null;

export async function upsertScheduleEvent(
  _state: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const admin = await requireAdmin();

  const raw = {
    seasonYear: formData.get("seasonYear"),
    slug: formData.get("slug"),
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    city: formData.get("city") || null,
    state: formData.get("state") || null,
    country: formData.get("country") || "USA",
    course: formData.get("course") || null,
    pdgaEventId: formData.get("pdgaEventId") || null,
    sortOrder: formData.get("sortOrder") || 0,
  };
  const result = EventSchema.safeParse(raw);
  if (!result.success) return { errors: result.error.flatten().fieldErrors };

  const d = result.data;
  if (d.endDate < d.startDate) {
    return { errors: { endDate: ["End date can't be before the start date"] } };
  }

  const { error } = await admin.from("schedule_events").upsert(
    {
      season_year: d.seasonYear,
      slug: d.slug,
      name: d.name,
      start_date: d.startDate,
      end_date: d.endDate,
      city: d.city,
      state: d.state,
      country: d.country,
      course: d.course,
      pdga_event_id: d.pdgaEventId ?? null,
      sort_order: d.sortOrder,
    },
    { onConflict: "season_year,slug" },
  );
  if (error) return { message: error.message };

  revalidatePath("/admin/schedule");
  return { message: "saved" };
}

export async function deleteScheduleEvent(seasonYear: number, slug: string): Promise<void> {
  const admin = await requireAdmin();
  await admin.from("schedule_events").delete().eq("season_year", seasonYear).eq("slug", slug);
  revalidatePath("/admin/schedule");
}

/**
 * Seeds a new season by copying an existing season's events forward, shifting
 * every date by the given number of days (default 364 ≈ one year, preserving
 * weekday). Skips events whose slug already exists in the target season.
 */
export async function cloneSeason(
  fromYear: number,
  toYear: number,
  dayShift: number = 364,
): Promise<{ created: number }> {
  const admin = await requireAdmin();
  const events = await getScheduleEvents(admin, fromYear);
  if (events.length === 0) return { created: 0 };

  const { data: existing } = await admin
    .from("schedule_events")
    .select("slug")
    .eq("season_year", toYear);
  const have = new Set((existing ?? []).map((r: any) => r.slug));

  const shift = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dayShift);
    return d.toISOString().slice(0, 10);
  };

  const rows = events
    .filter((e) => !have.has(e.slug))
    .map((e, i) => ({
      season_year: toYear,
      slug: e.slug,
      name: e.name,
      start_date: shift(e.startDate),
      end_date: shift(e.endDate),
      city: e.city || null,
      state: e.state,
      country: e.country,
      course: e.course,
      pdga_event_id: null, // new season needs fresh PDGA ids
      sort_order: i,
    }));

  if (rows.length > 0) await admin.from("schedule_events").insert(rows);
  revalidatePath("/admin/schedule");
  return { created: rows.length };
}
