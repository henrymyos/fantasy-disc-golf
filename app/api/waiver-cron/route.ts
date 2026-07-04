import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetWaiverPriority, runWaiverProcessing } from "@/lib/waivers";
import { runLineupUnsetCheck } from "@/lib/lineup-unset-check";
import { autoFinalizeDueWeeks, wednesdayAfter } from "@/lib/auto-finalize";
import { runDueDraftTimers } from "@/lib/draft-timer";
import { applyDraftPostponements } from "@/lib/draft-postpone";
import { runDraftReminders } from "@/lib/draft-reminders";

// Daily Vercel cron. Two responsibilities:
//   1. When a tournament starts today, lock waivers for every league and reset
//      each league's waiver priority to reverse-of-standings.
//   2. After a tournament has finished AND its review window has passed, process
//      any locked waivers (the action handles unlocking). Decoupled from the
//      weekday — see the block below.
//
// Gated by CRON_SECRET — same bearer flow as /api/sync-pdga.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const isWednesday = new Date().getUTCDay() === 3;

  // 1) Tournament starting today → lock + reset priorities
  const { data: startingToday } = await admin
    .from("tournaments")
    .select("id, name")
    .eq("start_date", today);

  const locked: number[] = [];
  if (startingToday && startingToday.length > 0) {
    const { data: leagues } = await admin.from("leagues").select("id");
    for (const league of leagues ?? []) {
      await admin.from("leagues").update({ waivers_locked: true }).eq("id", (league as any).id);
      await resetWaiverPriority((league as any).id);
      locked.push((league as any).id);
    }
  }

  // 2) Process locked waivers once the triggering event has ended and its review
  //    window has passed — independent of the weekday.
  //
  //    The old gate required getUTCDay()===3 AND no tournament overlapping today.
  //    An event ENDING on a Wednesday counts as overlapping that day
  //    (start_date <= today <= end_date), so its own review Wednesday was skipped
  //    and waivers stayed locked until the *next* Wednesday — a full extra week.
  //    Requiring Wednesday also meant a single missed/blocked Wednesday cost
  //    another 7 days.
  //
  //    New gate (still conservative):
  //      • Never process while an event is GENUINELY in progress — started
  //        on/before today and ending strictly AFTER today. An event whose
  //        end_date is today has played its final round, so it no longer blocks
  //        (this is the Wednesday-ending fix).
  //      • Otherwise process once the Wednesday-after review window of the most
  //        recently concluded event has passed. This is the same review window
  //        auto-finalize uses, so waivers unlock in lockstep with week scoring —
  //        important because finalization reads live starter rosters.
  const processed: number[] = [];
  const { data: lockedLeagues } = await admin
    .from("leagues")
    .select("id")
    .eq("waivers_locked", true);

  if (lockedLeagues && lockedLeagues.length > 0) {
    const { data: running } = await admin
      .from("tournaments")
      .select("id")
      .lte("start_date", today)
      .gt("end_date", today); // strictly after today: a same-day end no longer blocks
    const eventInProgress = (running?.length ?? 0) > 0;

    const { data: concluded } = await admin
      .from("tournaments")
      .select("end_date")
      .not("end_date", "is", null)
      .lte("end_date", today)
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestEnd = (concluded as any)?.end_date as string | undefined;
    const reviewWindowPassed =
      !!latestEnd && Date.now() >= wednesdayAfter(latestEnd).getTime();

    if (!eventInProgress && reviewWindowPassed) {
      for (const league of lockedLeagues) {
        await runWaiverProcessing((league as any).id);
        processed.push((league as any).id);
      }
    }
  }

  // 3) Auto-finalize any week whose event ended and whose Wednesday review
  //    deadline has passed (then advance the week). Self-gated per league.
  const autoFinalized = await autoFinalizeDueWeeks(admin);

  // 4) Lineup-unset notifications for any tournament within the next 6h.
  const lineupCheck = await runLineupUnsetCheck(admin, 6);

  // 5) Draft-timer backstop: advance any unattended draft whose pick / auction
  //    clock has expired. Folded into this daily cron so the project stays within
  //    the Hobby plan's 2-cron limit (a 3rd */5 cron fails the deploy). The
  //    /api/draft-cron route still exists for manual triggering, or for a
  //    higher-frequency schedule once on a paid plan.
  const draftTimers = await runDueDraftTimers(admin);

  // 6) Draft postponements: if a draft is running late, drop any selected event
  //    whose lineup-lock deadline (1h before first tee) has already passed, so
  //    week 1 doesn't land on an already-started tournament. Draft completion
  //    runs this precisely too; this is the backstop for a draft that stalls
  //    past an event.
  const { data: liveDrafts } = await admin
    .from("drafts")
    .select("league_id")
    .neq("status", "complete");
  const postponed: Record<number, string[]> = {};
  for (const d of liveDrafts ?? []) {
    const dropped = await applyDraftPostponements(admin, (d as any).league_id);
    if (dropped.length > 0) postponed[(d as any).league_id] = dropped;
  }

  // 7) Pre-draft reminders (~1 day / ~1 hour out). Daily backstop only — for
  //    timely 1-hour reminders, /api/draft-reminders is hit more frequently by
  //    an external trigger (the Hobby plan's 2-cron limit rules out a 3rd
  //    frequent Vercel cron). Idempotent via the per-draft reminder flags.
  const draftReminders = await runDraftReminders(admin);

  return NextResponse.json({
    ok: true,
    today,
    isWednesday,
    startingToday: (startingToday ?? []).map((t: any) => t.name),
    lockedLeagueIds: locked,
    processedLeagueIds: processed,
    autoFinalized,
    lineupNotificationsSent: lineupCheck.notificationsSent,
    draftTimers,
    postponed,
    draftReminders,
  });
}
