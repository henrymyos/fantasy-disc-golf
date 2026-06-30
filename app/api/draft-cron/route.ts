import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDueDraftTimers } from "@/lib/draft-timer";

// Frequent Vercel cron backstop for draft timers. Drafts normally advance from
// the browser (the on-clock client fires the auto-pick / auction finalize when
// its timer hits zero), but if nobody has the draft page open the clock would
// stall forever. This sweeps every in_progress draft and fires any timer whose
// deadline has passed. The per-draft cores re-validate the deadline, so racing
// a live client is harmless (it just no-ops).
//
// Gated by CRON_SECRET — same bearer flow as /api/waiver-cron.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runDueDraftTimers(createAdminClient());
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
