import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPdgaImport } from "@/lib/pdga-import";
import { runRankingsSync } from "@/lib/rankings-sync";

// Vercel Cron hits this on the schedule defined in vercel.json. The request
// carries an Authorization: Bearer ${CRON_SECRET} header that Vercel adds
// automatically — we verify it so the endpoint isn't open to the internet.
//
// Each run does two things: (1) re-imports PDGA tournament results/scores,
// then (2) re-sorts the player pool to the latest official PDGA World Rankings.
// The rankings sync is best-effort — a scrape failure there is reported but
// does not fail the score import.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const result = await runPdgaImport(supabase);

    let rankings: unknown;
    try {
      rankings = await runRankingsSync(supabase);
    } catch (err) {
      rankings = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    return NextResponse.json({
      ok: true,
      ...result,
      rankings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
