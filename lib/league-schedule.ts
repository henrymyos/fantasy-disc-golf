import type { SupabaseClient } from "@supabase/supabase-js";
import {
  effectiveSelection,
  getPlayoffSlugs,
  PLAYOFF_COUNT,
  type DgptEvent,
} from "@/lib/dgpt-2026-schedule";
import { getScheduleEvents, DEFAULT_SEASON_YEAR } from "@/lib/schedule";

export type LeagueWeek = {
  /** 1-based league week index. */
  week: number;
  slug: string;
  event: DgptEvent;
  isPlayoff: boolean;
  /** Imported tournament row(s) for this event — empty if not imported yet. */
  tournamentIds: number[];
  /** Event end date (YYYY-MM-DD), used for review-window timing. */
  endDate: string;
};

export type LeagueSchedule = {
  seasonYear: number;
  /** Number of regular-season weeks (selected events minus the playoff slate). */
  regularWeeks: number;
  /** Selected events as league weeks: regular weeks 1..regularWeeks, then the
   *  playoff weeks. */
  weeks: LeagueWeek[];
  weekToTournamentIds: Map<number, number[]>;
  tournamentIdToWeek: Map<number, number>;
};

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Canonical mapping from a league's 1-based week index to the actual event /
 * tournament that week represents. A league's weeks are its SELECTED events in
 * schedule order — regular-season events first (weeks 1..regularWeeks), then the
 * playoff events. Events are linked to tournament rows by pdga_event_id (event
 * name as a fallback), scoped to the league's season.
 *
 * This deliberately does NOT key off the global `tournaments.week` column, which
 * is an unreliable join key for league scoring: it's a per-import counter (2026
 * events sit at weeks 5-20, not 1-based), some selected events have no tournament
 * row yet, and different leagues select different subsets of the slate. Keying on
 * the league's own selected-event order keeps matchup weeks, standings, the
 * auto-finalizer, recaps, and the playoff bracket all pointing at the same event.
 */
export async function getLeagueSchedule(
  supabase: SupabaseClient,
  leagueId: number,
): Promise<LeagueSchedule | null> {
  const { data: league } = await supabase
    .from("leagues")
    .select("selected_event_slugs, season_year")
    .eq("id", leagueId)
    .single();
  if (!league) return null;
  const seasonYear = (league as any).season_year ?? DEFAULT_SEASON_YEAR;

  const events = await getScheduleEvents(supabase, seasonYear);
  const selectedSlugs = effectiveSelection((league as any).selected_event_slugs, events);
  const selectedSet = new Set(selectedSlugs);
  const playoffSet = new Set(getPlayoffSlugs(selectedSlugs, PLAYOFF_COUNT, events));

  // Selected events in schedule order, regular-season events before playoff ones
  // so league week numbering is: 1..regularWeeks regular, then the playoff weeks.
  const ordered = events.filter((e) => selectedSet.has(e.slug));
  const regular = ordered.filter((e) => !playoffSet.has(e.slug));
  const playoffs = ordered.filter((e) => playoffSet.has(e.slug));
  const sequence = [...regular, ...playoffs];

  // Link each event to its tournament row by pdga_event_id (name as a fallback),
  // scoped to this season.
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, name, pdga_event_id")
    .eq("season_year", seasonYear);
  const byPdga = new Map<number, number>();
  const byName = new Map<string, number>();
  for (const t of tournaments ?? []) {
    if ((t as any).pdga_event_id != null) byPdga.set((t as any).pdga_event_id, (t as any).id);
    if ((t as any).name) byName.set(normalizeName((t as any).name), (t as any).id);
  }

  const weeks: LeagueWeek[] = [];
  const weekToTournamentIds = new Map<number, number[]>();
  const tournamentIdToWeek = new Map<number, number>();
  sequence.forEach((e, i) => {
    const week = i + 1;
    const tid =
      (e.pdgaEventId != null ? byPdga.get(e.pdgaEventId) : undefined) ??
      byName.get(normalizeName(e.name));
    const tournamentIds = tid != null ? [tid] : [];
    weeks.push({
      week,
      slug: e.slug,
      event: e,
      isPlayoff: playoffSet.has(e.slug),
      tournamentIds,
      endDate: e.endDate,
    });
    if (tournamentIds.length > 0) {
      weekToTournamentIds.set(week, tournamentIds);
      for (const id of tournamentIds) tournamentIdToWeek.set(id, week);
    }
  });

  return { seasonYear, regularWeeks: regular.length, weeks, weekToTournamentIds, tournamentIdToWeek };
}
