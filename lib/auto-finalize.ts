import type { SupabaseClient } from "@supabase/supabase-js";
import { runPdgaImport } from "@/lib/pdga-import";
import { finalizeWeekScoresCore, advanceWeekCore } from "@/lib/scoring-finalize";

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

  // Latest end date per week (events share global week numbers).
  const { data: tournaments } = await admin
    .from("tournaments")
    .select("week, end_date")
    .not("end_date", "is", null);
  const endByWeek = new Map<number, string>();
  for (const t of tournaments ?? []) {
    const w = (t as any).week as number;
    const e = (t as any).end_date as string;
    const prev = endByWeek.get(w);
    if (!prev || e > prev) endByWeek.set(w, e);
  }

  let imported = false;
  for (const league of leagues ?? []) {
    if ((league as any).draft_status !== "complete") continue;
    const leagueId = (league as any).id as number;
    let week = (league as any).current_week as number;

    // Bounded catch-up in case several weeks are past due.
    for (let guard = 0; guard < 40; guard++) {
      const endDate = endByWeek.get(week);
      if (!endDate) break; // no event this week — leave it to the commissioner
      if (now < wednesdayAfter(endDate).getTime()) break; // review window still open

      // Score against the freshest results (once per cron run).
      if (!imported) {
        try { await runPdgaImport(admin); } catch { /* fall back to stored results */ }
        imported = true;
      }

      const { data: ms } = await admin
        .from("matchups")
        .select("is_final")
        .eq("league_id", leagueId)
        .eq("week", week);
      const alreadyFinal = (ms ?? []).length > 0 && (ms ?? []).every((m: any) => m.is_final);
      if (!alreadyFinal) {
        await finalizeWeekScoresCore(admin, leagueId, week);
        done.push(`${leagueId}:${week}`);
      }
      await advanceWeekCore(admin, leagueId);
      week += 1;
    }
  }
  return done;
}
