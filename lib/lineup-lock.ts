import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lineup is locked whenever a tournament is currently in progress — today
 * falls between any tournament's start_date and end_date. Tournaments are
 * global (shared across leagues), so the lock applies league-wide.
 */
export async function getActiveTournament(
  supabase: SupabaseClient,
): Promise<{ id: number; name: string; start_date: string; end_date: string } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("tournaments")
    .select("id, name, start_date, end_date")
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
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
