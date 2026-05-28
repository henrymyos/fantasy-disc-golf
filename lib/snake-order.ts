/** Resolves the (round, slot) on the clock for a given snake pick number.
 *  Rounds 1 and 2 stay normal snake. When `thirdRoundReversal` is true,
 *  every round from 3 onwards inverts the standard snake direction — so the
 *  team that picks first in round 1 picks first again in rounds 4, 6, 8…
 *  (instead of the usual 3, 5, 7…) and last in rounds 3, 5, 7… */
export function snakeSlot(
  pick: number,
  numTeams: number,
  thirdRoundReversal = false,
): { round: number; slot: number; isReversed: boolean } {
  const round = Math.ceil(pick / numTeams);
  const positionInRound = pick - (round - 1) * numTeams;
  let isReversed = round % 2 === 0;
  if (thirdRoundReversal && round >= 3) isReversed = !isReversed;
  const slot = isReversed ? numTeams - positionInRound + 1 : positionInRound;
  return { round, slot, isReversed };
}
