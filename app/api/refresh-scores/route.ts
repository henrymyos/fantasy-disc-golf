import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPdgaImport } from "@/lib/pdga-import";

// Logged-in users can trigger a PDGA re-import (the same logic the cron runs).
// Used by the client-side live-scoring poller during active tournaments so
// fresh round scores flow without waiting for the next scheduled cron.
//
// Rate-limited GLOBALLY via a single-row claim in pdga_import_state. The old
// in-memory cooldown was per function instance, so under Fluid Compute (many
// concurrent instances) every instance would run its own PDGA scrape. The
// conditional UPDATE below is atomic at the row level — only the caller whose
// update actually flips last_run_at gets to hit PDGA; everyone else in the
// window returns the cached result. A tiny per-instance fast-path avoids a DB
// round-trip on rapid back-to-back polls from the same instance.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COOLDOWN_MS = 60_000; // at most one PDGA sync per minute, globally

let localLastAttempt = 0;
let localCached: any = null;

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

  // Fast-path: this instance ran (or saw a run) within the cooldown — skip the DB.
  if (now - localLastAttempt < COOLDOWN_MS && localCached) {
    return NextResponse.json({ ok: true, cached: true, ...localCached });
  }

  const admin = createAdminClient();

  // Atomically claim the cooldown slot. The UPDATE only matches when no run has
  // happened in the last minute; concurrent callers on other instances find the
  // row already stamped and fall through to the cached result. (Setting
  // last_run_at at claim time also prevents a second run while this one is still
  // scraping.)
  const threshold = new Date(now - COOLDOWN_MS).toISOString();
  const { data: claimed } = await admin
    .from("pdga_import_state")
    .update({ last_run_at: new Date(now).toISOString() })
    .eq("id", 1)
    .or(`last_run_at.is.null,last_run_at.lt.${threshold}`)
    .select("id")
    .maybeSingle();

  if (!claimed) {
    const { data: state } = await admin
      .from("pdga_import_state")
      .select("last_result")
      .eq("id", 1)
      .maybeSingle();
    const cached = ((state as any)?.last_result ?? null) as any;
    localLastAttempt = now;
    localCached = cached;
    return NextResponse.json({ ok: true, cached: true, ...(cached ?? {}) });
  }

  try {
    const result = await runPdgaImport(admin);
    await admin.from("pdga_import_state").update({ last_result: result as any }).eq("id", 1);
    localLastAttempt = now;
    localCached = result;
    return NextResponse.json({ ok: true, cached: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
