// Deterministic per-player noise to keep projections from looking like exact
// pace × season-length output. The variance is seeded by playerId so the
// value is stable across reloads.

function seededFraction(seed: number): number {
  // Cheap LCG-esque scrambler in [0, 1).
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/**
 * Adds ± up to `range` points of noise (default ±5) to `rawProjection`,
 * seeded by playerId so the result is stable per player.
 */
export function applyProjectionVariance(
  rawProjection: number,
  playerId: number,
  range = 5,
): number {
  const offset = (seededFraction(playerId) * 2 - 1) * range;
  // Don't dip below zero — a season projection of -3 looks silly.
  return Math.max(0, Math.round((rawProjection + offset) * 10) / 10);
}

// Standard-normal CDF via Abramowitz & Stegun 7.1.26 approximation.
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Win probability (0–100, rounded) for a team with finishing estimate `projA`
 * against one with `projB`. `progressFrac` (0..1) shrinks the residual
 * variance as the week's event progresses, so live probabilities firm up.
 */
export function winProbability(projA: number, projB: number, progressFrac = 0): number {
  const baseSigma = 28;
  const sigma = baseSigma * Math.sqrt(Math.max(0.05, 1 - progressFrac));
  const z = (projA - projB) / Math.sqrt(2 * sigma * sigma);
  return Math.round(normalCdf(z) * 100);
}
