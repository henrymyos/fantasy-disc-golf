import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeWeekScoresCore } from "@/lib/scoring-finalize";

// Admin maintenance endpoint: recompute stored matchup scores for a range of
// already-finalized weeks under each league's current scoring rules. Used after
// a backfill of tournament results (e.g. birdie/bogey data) so standings pick
// up the corrected scores. Notifications and recap regeneration are suppressed
// so re-finalizing the past doesn't spam owners.
//
// Gated by CRON_SECRET. Call: GET /api/refinalize?fromWeek=1&toWeek=8

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const fromWeek = Number(url.searchParams.get("fromWeek") ?? "1");
  const toWeek = Number(url.searchParams.get("toWeek") ?? "999");
  if (!Number.isFinite(fromWeek) || !Number.isFinite(toWeek) || fromWeek < 1 || toWeek < fromWeek) {
    return NextResponse.json({ error: "Invalid week range" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: leagues } = await admin.from("leagues").select("id");

  const refinalized: string[] = [];
  for (const league of leagues ?? []) {
    const leagueId = (league as any).id as number;
    // Only weeks that actually have finalized matchups for this league.
    const { data: weeks } = await admin
      .from("matchups")
      .select("week")
      .eq("league_id", leagueId)
      .eq("is_final", true)
      .gte("week", fromWeek)
      .lte("week", toWeek);
    const uniqueWeeks = Array.from(new Set((weeks ?? []).map((w: any) => w.week as number))).sort((a, b) => a - b);
    for (const week of uniqueWeeks) {
      await finalizeWeekScoresCore(admin, leagueId, week, { notify: false, recap: false });
      refinalized.push(`${leagueId}:${week}`);
    }
  }

  return NextResponse.json({ ok: true, fromWeek, toWeek, refinalized });
}
