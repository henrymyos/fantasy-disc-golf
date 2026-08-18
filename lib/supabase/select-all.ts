// PostgREST caps every plain `.select()` at the project's max-rows setting
// (1000 by default) and returns the truncated page WITHOUT an error — so a
// query that outgrows the cap silently drops rows and every total computed
// from it drifts low. `tournament_results` crossed 1000 rows mid-2026 season,
// which is exactly how season points, projections and rankings started
// disagreeing with the per-event math.
//
// Use this for any query whose row count grows with the season (results,
// players, rosters across a whole league) instead of awaiting the builder
// directly.

const PAGE_SIZE = 1000;

/**
 * Runs `makeQuery()` repeatedly with `.range()` until a short page comes back,
 * returning every row. `makeQuery` must build a FRESH query each call —
 * Supabase query builders are single-use.
 */
export async function selectAllRows<T = any>(
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }> },
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) {
      // Match the callers' existing tolerance: a failed page yields what we
      // have rather than throwing inside a page render.
      console.warn("selectAllRows page failed", error);
      break;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
