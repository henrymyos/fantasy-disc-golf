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

  // `endDate` is a calendar date with no timezone, so a naive UTC-date compare
  // (today > latest) would flip to "over" at UTC midnight — i.e. mid-afternoon
  // out west, while a final round could still be in progress. We don't store
  // venue tz here, so we conservatively anchor to the end of the latest day in
  // US Pacific (UTC-7 during the season's DST window) — the westernmost zone
  // the tour visits. Venues farther east finish earlier, so this never reports
  // the season over too early; the trade-off is it can report over a few hours
  // late, which is the safe direction. (A precise end timestamp would need a
  // schema/migration change we're avoiding.)
  const overThreshold = Date.parse(latest + "T23:59:59-07:00");
  if (!Number.isFinite(overThreshold)) return false;
  return now.getTime() > overThreshold;
}
