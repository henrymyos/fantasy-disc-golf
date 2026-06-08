import type { SupabaseClient } from "@supabase/supabase-js";
import { DGPT_2026_SCHEDULE, type DgptEvent } from "@/lib/dgpt-2026-schedule";

export type { DgptEvent } from "@/lib/dgpt-2026-schedule";

export const DEFAULT_SEASON_YEAR = 2026;

function rowToEvent(r: any): DgptEvent {
  return {
    slug: r.slug,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    city: r.city ?? "",
    state: r.state ?? null,
    country: r.country ?? "USA",
    course: r.course ?? null,
    pdgaEventId: r.pdga_event_id ?? undefined,
  };
}

async function seasonHasEvents(supabase: SupabaseClient, year: number): Promise<boolean> {
  const { count } = await supabase
    .from("schedule_events")
    .select("id", { count: "exact", head: true })
    .eq("season_year", year);
  return (count ?? 0) > 0;
}

/**
 * Resolves which season's schedule to actually show for a requested year. A
 * league's stored season_year may not have a loaded schedule (e.g. older
 * leagues labelled 2025 that play the 2026 slate, or a future year not added
 * yet). Order of preference: the requested year → the current calendar year →
 * the latest available season → the default. This keeps the schedule from ever
 * rendering empty just because the label year has no rows.
 */
export async function resolveScheduleYear(
  supabase: SupabaseClient,
  requestedYear: number = DEFAULT_SEASON_YEAR,
): Promise<number> {
  if (await seasonHasEvents(supabase, requestedYear)) return requestedYear;

  const currentYear = new Date().getUTCFullYear();
  if (currentYear !== requestedYear && (await seasonHasEvents(supabase, currentYear))) {
    return currentYear;
  }

  const { data: latest } = await supabase
    .from("schedule_events")
    .select("season_year")
    .order("season_year", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestYear = (latest as any)?.season_year as number | undefined;
  if (latestYear != null) return latestYear;

  return DEFAULT_SEASON_YEAR;
}

/**
 * Loads the schedule for a season from the data-driven schedule_events table.
 * Resolves the requested year to one that actually has a schedule (see
 * resolveScheduleYear), and falls back to the static 2026 list as a last
 * resort, so the app never renders an empty schedule.
 */
export async function getScheduleEvents(
  supabase: SupabaseClient,
  seasonYear: number = DEFAULT_SEASON_YEAR,
): Promise<DgptEvent[]> {
  const year = await resolveScheduleYear(supabase, seasonYear);
  const { data, error } = await supabase
    .from("schedule_events")
    .select("slug, name, start_date, end_date, city, state, country, course, pdga_event_id, sort_order")
    .eq("season_year", year)
    .order("sort_order", { ascending: true })
    .order("start_date", { ascending: true });

  if (error || !data || data.length === 0) {
    return DGPT_2026_SCHEDULE;
  }
  return data.map(rowToEvent);
}

/** Distinct season years that have a schedule, newest first. */
export async function getScheduleSeasons(supabase: SupabaseClient): Promise<number[]> {
  const { data } = await supabase
    .from("schedule_events")
    .select("season_year")
    .order("season_year", { ascending: false });
  const years = new Set<number>((data ?? []).map((r: any) => r.season_year as number));
  years.add(DEFAULT_SEASON_YEAR);
  return Array.from(years).sort((a, b) => b - a);
}
