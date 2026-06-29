export type StarterRow = {
  player_id: number;
  division: string | null;
  lineup_order: number | null;
};

/**
 * The slot-capped starter set for a team: the lowest-lineup_order starters in
 * each division, up to that division's configured slot count.
 *
 * Scoring must use this rather than counting every `is_starter` row — owners can
 * flag more starters than there are slots (the lineup UI hides the overflow on
 * the bench, but the raw rows are still there), so summing all of them makes the
 * official score diverge from the lineup the UI actually shows.
 */
export function cappedStarterIds(rows: StarterRow[], mpoSlots: number, fpoSlots: number): number[] {
  const groups: Record<"MPO" | "FPO", StarterRow[]> = { MPO: [], FPO: [] };
  for (const r of rows) {
    (r.division === "FPO" ? groups.FPO : groups.MPO).push(r);
  }
  const pick = (list: StarterRow[], n: number): number[] =>
    [...list]
      .sort(
        (a, b) =>
          (a.lineup_order ?? Number.POSITIVE_INFINITY) - (b.lineup_order ?? Number.POSITIVE_INFINITY) ||
          a.player_id - b.player_id,
      )
      .slice(0, Math.max(0, n))
      .map((r) => r.player_id);
  return [...pick(groups.MPO, mpoSlots), ...pick(groups.FPO, fpoSlots)];
}
