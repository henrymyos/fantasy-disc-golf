// DB-free checks for fantasy scoring and standings tiebreakers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCORING_RULES,
  resolveScoringRules,
  pointsForPosition,
  fantasyPointsFromResult,
  describeScoreContributions,
} from "@/lib/scoring-rules";
import { getPointsForDivision } from "@/lib/scoring-constants";
import { rankTeams } from "@/lib/standings";

test("placement points by division, past the table and beyond 60", () => {
  assert.equal(getPointsForDivision(1, "MPO"), 82);
  assert.equal(getPointsForDivision(1, "fpo"), 54);
  assert.equal(getPointsForDivision(55, "MPO"), 3);
  assert.equal(getPointsForDivision(50, "FPO"), 2);
  assert.equal(getPointsForDivision(61, "MPO"), 1);
});

test("league overrides win, missing positions fall back to defaults", () => {
  const rules = { ...DEFAULT_SCORING_RULES, mpoPositionPoints: { 1: 100 } };
  assert.equal(pointsForPosition(rules, 1, "MPO"), 100);
  assert.equal(pointsForPosition(rules, 2, "MPO"), 70);
  assert.equal(pointsForPosition(rules, 1, "FPO"), 54);
});

test("resolveScoringRules fills gaps from defaults", () => {
  assert.equal(resolveScoringRules(null), DEFAULT_SCORING_RULES);
  const r = resolveScoringRules({ bonusPoints: { ace: 50 } });
  assert.equal(r.bonusPoints.ace, 50);
  assert.equal(r.bonusPoints.hotRound, 10);
  assert.equal(r.mpoPositionPoints, null);
});

test("fantasy points add placement and bonuses, rounded to 0.1", () => {
  const pts = fantasyPointsFromResult(DEFAULT_SCORING_RULES, {
    finishing_position: 1, hot_round_count: 1, bogey_free_count: 1, ace_count: 0,
    under_par_strokes: 14, over_par_strokes: 3, eagle_count: 1, division: "MPO",
  });
  assert.equal(pts, 101.5); // 82 + 10 + 5 + 2.8 - 0.3 + 2
  assert.equal(fantasyPointsFromResult(DEFAULT_SCORING_RULES, { finishing_position: null, division: "MPO" }), 0);
});

test("score breakdown lists only scored categories", () => {
  assert.equal(
    describeScoreContributions(DEFAULT_SCORING_RULES, {
      finishing_position: 1, hot_round_count: 2, bogey_free_count: 1, under_par_strokes: 14,
    }),
    "1st · 2 hot rounds · 1 clean round · 14 birdies",
  );
  assert.equal(describeScoreContributions(DEFAULT_SCORING_RULES, { finishing_position: 22 }), "22nd");
  assert.equal(describeScoreContributions(DEFAULT_SCORING_RULES, { finishing_position: 13 }), "13th");
  const noAces = { ...DEFAULT_SCORING_RULES, bonusPoints: { ...DEFAULT_SCORING_RULES.bonusPoints, ace: 0 } };
  assert.equal(describeScoreContributions(noAces, { ace_count: 1 }), null);
});

const beat = (w: number, l: number) => ({ team1_id: w, team2_id: l, team1_score: 60, team2_score: 50 });

test("head-to-head breaks a two-team tie before points", () => {
  const records = { 1: { wins: 1, losses: 1, points: 100 }, 2: { wins: 1, losses: 1, points: 200 } };
  assert.deepEqual(rankTeams(records, [beat(1, 2)]).map((e) => e.teamId), [1, 2]);
  assert.deepEqual(rankTeams(records, [beat(1, 2)], { headToHead: false }).map((e) => e.teamId), [2, 1]);
});

test("a three-team head-to-head cycle falls back to points", () => {
  const records = new Map([
    [1, { wins: 2, losses: 1, points: 300 }],
    [2, { wins: 2, losses: 1, points: 310 }],
    [3, { wins: 2, losses: 1, points: 290 }],
    [4, { wins: 0, losses: 3, points: 200 }],
  ]);
  const games = [beat(1, 2), beat(2, 3), beat(3, 1), beat(1, 4), beat(2, 4), beat(3, 4)];
  assert.deepEqual(rankTeams(records, games).map((e) => e.teamId), [2, 1, 3, 4]);
});

test("ties count as half a win; no games means SOS -1", () => {
  const ranked = rankTeams({ 1: { wins: 2, losses: 1, points: 0 }, 2: { wins: 1, losses: 0, ties: 1, points: 0 } }, []);
  assert.deepEqual(ranked.map((e) => e.teamId), [2, 1]);
  assert.equal(ranked[0].strengthOfSchedule, -1);
});
