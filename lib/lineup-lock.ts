import type { SupabaseClient } from "@supabase/supabase-js";
import { getLeagueSchedule } from "@/lib/league-schedule";

/**
 * Lineup is locked while a tournament ON THIS LEAGUE'S SCHEDULE is in
 * progress. A live event the league skipped (not one of its selected events)
 * doesn't lock anything — those weeks are simply off-weeks for the league.
 * When `lock_at` is set on the tournament (PDGA round-1 first tee time), the
 * lock fires at that exact instant; otherwise it falls back to the UTC-date
 * window below.
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
  leagueId: number,
): Promise<{ id: number; name: string; start_date: string; end_date: string; lock_at: string | null } | null> {
  const today = new Date().toISOString().slice(0, 10); // UTC calendar date
  const { data } = await supabase
    .from("tournaments")
    .select("id, name, start_date, end_date, lock_at")
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: true });

  // Precise start gate: if lock_at is set and we haven't reached that absolute
  // instant yet (e.g. tournament starts today but tee-off is still a few hours
  // away — including for non-US venues), the tournament is not actively locked
  // yet, so it doesn't count as live.
  const live = (data ?? []).filter((t: any) => {
    if (!t.lock_at) return true;
    const lockMs = Date.parse(t.lock_at);
    return !Number.isFinite(lockMs) || Date.now() >= lockMs;
  });
  if (live.length === 0) return null;

  // Only a tournament that's actually one of this league's selected events
  // locks the league. If the schedule can't be resolved at all, fail closed
  // (locked) rather than allow mid-event edits.
  const schedule = await getLeagueSchedule(supabase, leagueId);
  if (!schedule) return live[0] as any;
  return (live.find((t: any) => schedule.tournamentIdToWeek.has(t.id)) as any) ?? null;
}

export async function isLineupLocked(supabase: SupabaseClient, leagueId: number): Promise<boolean> {
  const t = await getActiveTournament(supabase, leagueId);
  return t !== null;
}

/**
 * Free agency is closed whenever a tournament on the league's schedule is in
 * progress; adds resume after waivers are processed. Used by addFreeAgent +
 * the Players UI.
 */
export async function isFreeAgencyLocked(
  supabase: SupabaseClient,
  leagueId: number,
  waiversLockedFlag: boolean,
): Promise<boolean> {
  if (waiversLockedFlag) return true;
  return (await getActiveTournament(supabase, leagueId)) !== null;
}
