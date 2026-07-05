import { getPlayoffSlugs, playoffCountForTeams, type DgptEvent } from "@/lib/dgpt-2026-schedule";

/**
 * Number of regular-season weeks for a league: total selected events minus the
 * playoff slate at the end (sized to the league — see playoffCountForTeams).
 * Falls back to 14 when the selection looks empty so users always get a
 * schedule. Shared so the scheduler and the week-advancer agree on where the
 * regular season ends (playoff-event weeks must NOT get round-robin matchups —
 * their results drive the bracket, not standings).
 */
export function regularSeasonWeekCount(
  selectedSlugs: string[],
  events: DgptEvent[],
  teamCount?: number | null,
): number {
  if (!selectedSlugs || selectedSlugs.length === 0) return 14;
  const playoffs = new Set(getPlayoffSlugs(selectedSlugs, playoffCountForTeams(teamCount), events));
  return Math.max(1, selectedSlugs.length - playoffs.size);
}
