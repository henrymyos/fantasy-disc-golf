import type { DgptEvent } from "@/lib/dgpt-2026-schedule";

/**
 * The season is "over" once every selected event has finished — i.e. the latest
 * end date among the league's selected events is in the past. Returns false when
 * there are no selected events (can't tell yet).
 */
export function isSeasonOver(
  events: DgptEvent[],
  selectedSlugs: Iterable<string>,
  now: Date = new Date(),
): boolean {
  const selected = new Set(selectedSlugs);
  const ends = events.filter((e) => selected.has(e.slug)).map((e) => e.endDate);
  if (ends.length === 0) return false;
  const latest = ends.reduce((a, b) => (b > a ? b : a));
  const today = now.toISOString().slice(0, 10);
  return today > latest;
}
