import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDraftReminders } from "@/lib/draft-reminders";

// Frequent sweep that sends the ~1-day and ~1-hour pre-draft reminders. The
// per-draft flags make it idempotent, so running it often is safe (and needed
// for the 1-hour reminder to be timely). Gated by CRON_SECRET — same bearer
// flow as /api/waiver-cron and /api/draft-cron.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runDraftReminders(createAdminClient());
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
