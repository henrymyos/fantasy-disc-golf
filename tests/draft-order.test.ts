// DB-free checks for draft order. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { snakeSlot } from "@/lib/snake-order";
import { resolvePickOwnerId, buildPickOwnerOverrides } from "@/lib/draft-pick-owners";
import { currentNominator } from "@/lib/draft-timer";

const slots = (n: number, teams: number, trr: boolean) =>
  Array.from({ length: n }, (_, i) => snakeSlot(i + 1, teams, trr).slot);

test("snake order, 6 teams", () => {
  assert.deepEqual(slots(6, 6, false), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(slots(12, 6, false).slice(6), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(slots(18, 6, false).slice(12), [1, 2, 3, 4, 5, 6]);
});

test("third-round reversal flips rounds 3+", () => {
  assert.deepEqual(slots(12, 6, true).slice(6), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(slots(18, 6, true).slice(12), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(slots(24, 6, true).slice(18), [1, 2, 3, 4, 5, 6]);
});

test("traded pick overrides the snake owner", () => {
  const members = [1, 2, 3, 4, 5, 6].map((i) => ({ id: 100 + i, draftPosition: i }));
  const overrides = buildPickOwnerOverrides([{ overall_pick: 5, owner_team_id: 101 }]);
  assert.equal(resolvePickOwnerId(5, members, false, null), 105);
  assert.equal(resolvePickOwnerId(5, members, false, overrides), 101);
  assert.equal(resolvePickOwnerId(6, members, false, overrides), 106);
  assert.equal(resolvePickOwnerId(13, members, true, null), 106);
  assert.equal(resolvePickOwnerId(1, [{ id: 1, draftPosition: null }], false, null), null);
});

test("auction nominator rotates in snake order", () => {
  const am = [1, 2, 3, 4, 5, 6].map((i) => ({ id: 200 + i, draft_position: i }));
  assert.equal(currentNominator(am, 1)?.id, 201);
  assert.equal(currentNominator(am, 7)?.id, 206);
  assert.equal(currentNominator(am, 13)?.id, 201);
  assert.equal(currentNominator([], 1), null);
});
