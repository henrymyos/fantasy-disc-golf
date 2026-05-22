import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lineup is locked whenever a tournament is currently in progress. When
 * `lock_at` is set on the tournament (PDGA round-1 first tee time), the
 * lock fires at that moment; otherwise it falls back to midnight on
 * `start_date`. Tournaments are global, so the lock applies league-wide.
 */
export async function getActiveTournament(
  supabase: SupabaseClient,
): Promise<{ id: number; name: string; start_date: string; end_date: string; lock_at: string | null } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("tournaments")
    .select("id, name, start_date, end_date, lock_at")
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  // If lock_at is set and we haven't reached it yet (e.g. tournament starts
  // today but tee-off is still a few hours away), the tournament is not
  // actively locked yet — return null so lineup changes stay allowed.
  if ((data as any).lock_at) {
    const lockMs = Date.parse((data as any).lock_at);
    if (Number.isFinite(lockMs) && Date.now() < lockMs) return null;
  }
  return data as any;
}

export async function isLineupLocked(supabase: SupabaseClient): Promise<boolean> {
  const t = await getActiveTournament(supabase);
  return t !== null;
}

/**
 * Free agency is closed whenever a tournament is in progress; adds resume
 * after waivers are processed. Used by addFreeAgent + the Players UI.
 */
export async function isFreeAgencyLocked(
  supabase: SupabaseClient,
  waiversLockedFlag: boolean,
): Promise<boolean> {
  if (waiversLockedFlag) return true;
  return (await getActiveTournament(supabase)) !== null;
}
