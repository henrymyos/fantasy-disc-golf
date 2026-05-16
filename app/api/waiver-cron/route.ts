import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resetWaiverPriority,
  runWaiverProcessing,
} from "@/actions/rosters";

// Daily Vercel cron. Two responsibilities:
//   1. When a tournament starts today, lock waivers for every league and reset
//      each league's waiver priority to reverse-of-standings.
//   2. On Wednesdays, after a tournament has finished, process any locked
//      waivers (the action handles unlocking).
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

  // 2) Wednesday → process locked waivers (skip leagues where a tournament is still in progress)
  const processed: number[] = [];
  if (isWednesday) {
    const { data: activeTournaments } = await admin
      .from("tournaments")
      .select("id")
      .lte("start_date", today)
      .gte("end_date", today);
    const tournamentInProgress = (activeTournaments?.length ?? 0) > 0;

    if (!tournamentInProgress) {
      const { data: lockedLeagues } = await admin
        .from("leagues")
        .select("id")
        .eq("waivers_locked", true);
      for (const league of lockedLeagues ?? []) {
        await runWaiverProcessing((league as any).id);
        processed.push((league as any).id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    today,
    isWednesday,
    startingToday: (startingToday ?? []).map((t: any) => t.name),
    lockedLeagueIds: locked,
    processedLeagueIds: processed,
  });
}
