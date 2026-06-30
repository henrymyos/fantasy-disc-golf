import type { SupabaseClient } from "@supabase/supabase-js";
import { runPdgaImport } from "@/lib/pdga-import";
import { finalizeWeekScoresCore, advanceWeekCore } from "@/lib/scoring-finalize";
import { getLeagueSchedule } from "@/lib/league-schedule";

/**
 * The lock deadline for a week: the first Wednesday at 00:00 UTC strictly after
 * the event's end date. An event ending Sunday locks the following Wednesday,
 * giving everyone a couple of days to review before the result is official.
 * (The daily cron runs at 08:00 UTC, so the lock actually executes Wed morning.)
 */
export function wednesdayAfter(endDateIso: string): Date {
  const d = new Date(`${endDateIso}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() !== 3); // 3 = Wednesday
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Auto-finalizes any active league whose current week's event has ended and
 * whose Wednesday deadline has passed, then advances the week. Idempotent: once
 * a week is advanced, the new current week's deadline hasn't passed, so nothing
 * re-fires. Commissioners can still re-finalize manually for corrections.
 * Returns the "leagueId:week" pairs it locked.
 */
export async function autoFinalizeDueWeeks(admin: SupabaseClient): Promise<string[]> {
  const now = Date.now();
  const done: string[] = [];

  const { data: leagues } = await admin
    .from("leagues")
    .select("id, current_week, draft_status");

  let imported = false;
  for (const league of leagues ?? []) {
    if ((league as any).draft_status !== "complete") continue;
    const leagueId = (league as any).id as number;
    const week = (league as any).current_week as number;

    // Resolve this league week to its event through the league's own
    // selected-event order — the global tournaments.week is not a reliable
    // per-league index (subset schedules, non-1-based week numbers).
    const schedule = await getLeagueSchedule(admin, leagueId);
    const leagueWeek = schedule?.weeks.find((w) => w.week === week);
    if (!leagueWeek) continue; // no event mapped to this week — leave it to the commissioner
    if (now < wednesdayAfter(leagueWeek.endDate).getTime()) continue; // review window still open

    // A behind league advances at most one week per daily run — avoids a burst
    // of finalized weeks + notifications all at once. It catches up over days.
    const { data: ms } = await admin
      .from("matchups")
      .select("is_final")
      .eq("league_id", leagueId)
      .eq("week", week);
    const hasMatchups = (ms ?? []).length > 0;
    const alreadyFinal = hasMatchups && (ms ?? []).every((m: any) => m.is_final);

    // Don't auto-advance a week that never had matchups (nothing to finalize).
    if (!hasMatchups) continue;

    if (!alreadyFinal) {
      if (!imported) {
        try { await runPdgaImport(admin); } catch { /* fall back to stored results */ }
        imported = true;
      }
      // Graceful degradation: if the week's event still has no results (PDGA
      // hasn't posted them or the import failed), wait rather than locking a
      // bogus 0-0 result for everyone. A later cron run will pick it up once
      // results exist; the commissioner can also finalize manually.
      const weekTids = leagueWeek.tournamentIds;
      let hasResults = false;
      if (weekTids.length > 0) {
        const { count: rc } = await admin
          .from("tournament_results")
          .select("id", { count: "exact", head: true })
          .in("tournament_id", weekTids);
        hasResults = (rc ?? 0) > 0;
      }
      if (!hasResults) continue;

      await finalizeWeekScoresCore(admin, leagueId, week);
      done.push(`${leagueId}:${week}`);
    }
    await advanceWeekCore(admin, leagueId);
  }
  return done;
}
