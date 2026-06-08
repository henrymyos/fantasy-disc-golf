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

function nextPowerOfTwo(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(2, n))));
}

/**
 * How many teams make the playoff bracket: the next power of two at or above
 * (playoff events + 1), capped at the number of teams. Mirrors the seeding on
 * the playoffs page so the season review agrees with it.
 */
export function playoffBracketSize(playoffEventCount: number, teamCount: number): number {
  return Math.min(
    Math.max(2, nextPowerOfTwo(Math.max(2, playoffEventCount + 1))),
    teamCount,
  );
}
