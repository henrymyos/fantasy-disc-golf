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
