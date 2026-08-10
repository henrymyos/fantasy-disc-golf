import type { SupabaseClient } from "@supabase/supabase-js";
import { getLeagueSchedule } from "@/lib/league-schedule";

/**
 * How long after an event's UTC end-of-day the score poller keeps running.
 * `end_date` closes at 23:59:59Z (≈8pm ET), but Sunday final-round results
 * often post later in the US evening — without this grace the client poller
 * stops before the last round lands and final scores only arrive with the
 * Monday cron. 12h ends the grace Monday ~noon UTC, right before that cron.
 */
export const LIVE_END_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * The league-schedule tournament the score poller should be refreshing right
 * now: live, or ended within the grace window. Unlike getActiveTournament,
 * this keeps returning the event for a few hours after it ends — do NOT use
 * it for lineup or free-agency locks.
 */
export async function getPollableTournament(
  supabase: SupabaseClient,
  leagueId: number,
): Promise<{ id: number; name: string } | null> {
  const schedule = await getLeagueSchedule(supabase, leagueId);
  if (!schedule) return null;
  const now = Date.now();
  for (const w of schedule.weeks) {
    const startMs = Date.parse(`${w.event.startDate}T00:00:00Z`);
    const endMs = Date.parse(`${w.event.endDate}T23:59:59Z`) + LIVE_END_GRACE_MS;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (now >= startMs && now <= endMs) {
      return { id: w.tournamentIds[0] ?? -1, name: w.event.name };
    }
  }
  return null;
}
