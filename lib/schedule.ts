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

/**
 * Loads the schedule for a season from the data-driven schedule_events table.
 * Falls back to the static 2026 list when the table has no rows for the season
 * (e.g. first deploy before the seed ran), so the app never renders an empty
 * schedule for the current year.
 */
export async function getScheduleEvents(
  supabase: SupabaseClient,
  seasonYear: number = DEFAULT_SEASON_YEAR,
): Promise<DgptEvent[]> {
  const { data, error } = await supabase
    .from("schedule_events")
    .select("slug, name, start_date, end_date, city, state, country, course, pdga_event_id, sort_order")
    .eq("season_year", seasonYear)
    .order("sort_order", { ascending: true })
    .order("start_date", { ascending: true });

  if (error || !data || data.length === 0) {
    return seasonYear === DEFAULT_SEASON_YEAR ? DGPT_2026_SCHEDULE : [];
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
