// DB-free checks for playoff bracket sizing and simulation. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { playoffBracketSize, playoffRoundCount, simulatePlayoffs, type Seed } from "@/lib/playoffs";

test("bracket size: 6 with byes for 8+ teams and 3 events, else a power of two", () => {
  assert.equal(playoffBracketSize(3, 10), 6);
  assert.equal(playoffBracketSize(2, 10), 4);
  assert.equal(playoffBracketSize(3, 4), 4);
  assert.equal(playoffBracketSize(1, 8), 2);
  assert.equal(playoffBracketSize(5, 5), 4);
  assert.equal(playoffBracketSize(0, 8), 0);
  assert.equal(playoffBracketSize(2, 1), 0);
  assert.deepEqual([6, 4, 2, 1].map(playoffRoundCount), [3, 2, 1, 0]);
});

const seeds: Seed[] = [1, 2, 3, 4, 5, 6].map((n) => ({ teamId: n, teamName: `T${n}`, username: null, seed: n }));
const scores: Record<number, Record<number, number | null>> = {
  1: { 3: 90, 6: 100, 4: 80, 5: 80 }, // 6 upsets 3; 4-5 tie goes to seed 4
  2: { 1: 70, 6: 75, 2: null, 4: 10 }, // missing score in a finished event counts as 0
  3: { 4: 50, 6: 40 },
};
const scoreFor = (teamId: number, week: number | null) => scores[week ?? 0]?.[teamId] ?? null;
const round = (week: number, complete = true) => ({ name: `R${week}`, week, complete });

test("6-team bracket: byes, upsets, seed wins ties, reseeding to a champion", () => {
  const res = simulatePlayoffs(seeds, [round(1), round(2), round(3)], scoreFor);
  assert.deepEqual(res.rounds[0].matches.map((m) => [m.isBye ?? false, m.winnerTeamId]), [[true, 1], [true, 2], [false, 6], [false, 4]]);
  assert.deepEqual(res.rounds[1].matches.map((m) => [m.a?.teamId, m.b?.teamId, m.winnerTeamId]), [[1, 6, 6], [2, 4, 4]]);
  assert.equal(res.rounds[1].matches[1].a?.score, 0);
  assert.equal(res.championTeamId, 4);
});

test("an unfinished round stops the bracket with no champion", () => {
  const res = simulatePlayoffs(seeds, [round(1), round(2, false), round(3)], scoreFor);
  assert.equal(res.rounds.length, 2);
  assert.ok(res.rounds[1].matches.every((m) => !m.decided && m.winnerTeamId === null));
  assert.equal(res.championTeamId, null);
});
