import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lineup is locked whenever a tournament is currently in progress. When
 * `lock_at` is set on the tournament (PDGA round-1 first tee time), the
 * lock fires at that exact instant; otherwise it falls back to the UTC-date
 * window below. Tournaments are global, so the lock applies league-wide.
 *
 * NOTE ON TIMEZONES: `today` is a UTC calendar date and `start_date`/`end_date`
 * are bare dates with no timezone, so the date *window* can be off by the
 * venue's UTC offset at the day boundaries (e.g. a Pacific event de-selects a
 * few hours early; a European event stays selected a few hours late). The
 * precise `lock_at` gate below removes that skew for the START of the event,
 * which is the side that matters most. There's no precise end timestamp stored
 * (that would need a migration), so the UNLOCK side remains date-only.
 */
export async function getActiveTournament(
  supabase: SupabaseClient,
): Promise<{ id: number; name: string; start_date: string; end_date: string; lock_at: string | null } | null> {
  const today = new Date().toISOString().slice(0, 10); // UTC calendar date
  const { data } = await supabase
    .from("tournaments")
    .select("id, name, start_date, end_date, lock_at")
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  // Precise start gate: if lock_at is set and we haven't reached that absolute
  // instant yet (e.g. tournament starts today but tee-off is still a few hours
  // away — including for non-US venues), the tournament is not actively locked
  // yet, so return null and keep lineup changes allowed.
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
