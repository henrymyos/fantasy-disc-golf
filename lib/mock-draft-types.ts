// Shared types + helpers for mock drafts. Kept out of the "use server" action
// file so we can export plain (non-async) values.

/** A single human-claimed seat in a shared mock draft. */
export type MockSeat = {
  userId: string;
  name: string;
  isHost?: boolean;
};

/** Map of teamIndex (as a string key) -> the human occupying that seat.
 *  Any team index not present is drafted by a bot. */
export type MockSeats = Record<string, MockSeat>;

export type MockDraftStatus = "lobby" | "in_progress" | "complete";

/** Whether a 1-based round runs in reverse snake order. Rounds 1–2 are always
 *  normal; with third-round reversal on, rounds 3+ invert. Mirrors the board's
 *  isRoundReversed in components/mock-draft.tsx and lib/snake-order.ts. */
export function mockRoundReversed(round: number, thirdRoundReversal: boolean): boolean {
  let reversed = round % 2 === 0;
  if (thirdRoundReversal && round >= 3) reversed = !reversed;
  return reversed;
}

/**
 * Snake order: returns the 0-based team index that owns a given 0-based overall
 * pick index. Mirrors the client board's teamIndexForPick so the server and the
 * UI always agree on who is on the clock.
 */
export function mockTeamIndexForPick(
  pickIndex: number,
  numTeams: number,
  thirdRoundReversal = false,
): number {
  const round = Math.floor(pickIndex / numTeams) + 1; // 1-based
  const slot = pickIndex % numTeams;
  return mockRoundReversed(round, thirdRoundReversal) ? numTeams - 1 - slot : slot;
}
