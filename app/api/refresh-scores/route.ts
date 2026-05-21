import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPdgaImport } from "@/lib/pdga-import";

// Logged-in users can trigger a PDGA re-import (the same logic the cron runs).
// Used by the client-side live-scoring poller during active tournaments so
// fresh round scores flow without waiting for the next scheduled cron.
//
// Rate-limited per process via an in-memory cooldown — if multiple users
// poll in quick succession, only the first one actually hits PDGA.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let lastRunAt = 0;
let lastResult: any = null;
const COOLDOWN_MS = 60_000; // at most one PDGA sync per minute

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Must belong to at least one league.
  const { data: membership } = await supabase
    .from("league_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Not a league member" }, { status: 403 });
  }

  const now = Date.now();
  if (now - lastRunAt < COOLDOWN_MS && lastResult) {
    return NextResponse.json({ ok: true, cached: true, ...lastResult });
  }

  try {
    const admin = createAdminClient();
    const result = await runPdgaImport(admin);
    lastRunAt = now;
    lastResult = result;
    return NextResponse.json({ ok: true, cached: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
