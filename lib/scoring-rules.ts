import {
  BONUS_POINTS,
  MPO_PLACEMENT_POINTS,
  FPO_PLACEMENT_POINTS,
  getPointsForDivision,
} from "@/lib/scoring-constants";

export type ScoringRules = {
  mpoPositionPoints: Record<number, number> | null;
  fpoPositionPoints: Record<number, number> | null;
  bonusPoints: {
    hotRound: number;
    bogeyFree: number;
    ace: number;
    // Per-stroke-relative-to-par values (birdie = each stroke under par,
    // bogey = each stroke over par).
    birdie: number;
    bogey: number;
    // Flat bonus per eagle (hole 2+ under par).
    eagle: number;
  };
};

export const DEFAULT_SCORING_RULES: ScoringRules = {
  mpoPositionPoints: null,
  fpoPositionPoints: null,
  bonusPoints: { ...BONUS_POINTS },
};

/** Returns the rules object for a league, falling back to defaults when the
 *  league.scoring_rules column is null or partially populated. */
export function resolveScoringRules(stored: unknown): ScoringRules {
  if (!stored || typeof stored !== "object") return DEFAULT_SCORING_RULES;
  const s = stored as Partial<ScoringRules>;
  return {
    mpoPositionPoints: s.mpoPositionPoints ?? null,
    fpoPositionPoints: s.fpoPositionPoints ?? null,
    bonusPoints: {
      hotRound: Number(s.bonusPoints?.hotRound ?? BONUS_POINTS.hotRound),
      bogeyFree: Number(s.bonusPoints?.bogeyFree ?? BONUS_POINTS.bogeyFree),
      ace: Number(s.bonusPoints?.ace ?? BONUS_POINTS.ace),
      birdie: Number(s.bonusPoints?.birdie ?? BONUS_POINTS.birdie),
      bogey: Number(s.bonusPoints?.bogey ?? BONUS_POINTS.bogey),
      eagle: Number(s.bonusPoints?.eagle ?? BONUS_POINTS.eagle),
    },
  };
}

export function pointsForPosition(
  rules: ScoringRules,
  position: number,
  division: string,
): number {
  const isFPO = division?.toUpperCase() === "FPO";
  const override = isFPO ? rules.fpoPositionPoints : rules.mpoPositionPoints;
  if (override && override[position] != null) return Number(override[position]);
  return getPointsForDivision(position, division);
}

/** Compute the fantasy points from raw result fields under the given rules. */
export function fantasyPointsFromResult(
  rules: ScoringRules,
  result: {
    finishing_position: number | null | undefined;
    hot_round_count?: number | null;
    bogey_free_count?: number | null;
    ace_count?: number | null;
    under_par_strokes?: number | null;
    over_par_strokes?: number | null;
    eagle_count?: number | null;
    division: string;
  },
): number {
  const placement = result.finishing_position != null
    ? pointsForPosition(rules, Number(result.finishing_position), result.division)
    : 0;
  const bonus =
    Number(result.hot_round_count ?? 0) * rules.bonusPoints.hotRound +
    Number(result.bogey_free_count ?? 0) * rules.bonusPoints.bogeyFree +
    Number(result.ace_count ?? 0) * rules.bonusPoints.ace +
    Number(result.under_par_strokes ?? 0) * rules.bonusPoints.birdie -
    Number(result.over_par_strokes ?? 0) * rules.bonusPoints.bogey +
    Number(result.eagle_count ?? 0) * rules.bonusPoints.eagle;
  return Math.round((placement + bonus) * 10) / 10;
}

export function defaultMpoTable(): Record<number, number> {
  return { ...MPO_PLACEMENT_POINTS };
}
export function defaultFpoTable(): Record<number, number> {
  return { ...FPO_PLACEMENT_POINTS };
}
