// One-off backfill: inserts any DGPT_2026_SCHEDULE event whose
// pdga_event_id is not already in the `tournaments` table.
//
// Idempotent — re-running only inserts what's still missing. Existing
// rows (including their name, week, and lock_at) are left untouched.
//
// Run with:
//   npx tsx --env-file=.env.local scripts/backfill-tournaments.ts

import { createClient } from "@supabase/supabase-js";
import { DGPT_2026_SCHEDULE } from "../lib/dgpt-2026-schedule";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: existing, error: readErr } = await supabase
    .from("tournaments")
    .select("id, pdga_event_id, name");
  if (readErr) {
    console.error("Read failed:", readErr.message);
    process.exit(1);
  }

  const haveByPdgaId = new Set(
    (existing ?? []).map((t) => t.pdga_event_id).filter((v) => v != null),
  );

  const toInsert: any[] = [];
  DGPT_2026_SCHEDULE.forEach((event, index) => {
    if (!event.pdgaEventId) return;
    if (haveByPdgaId.has(event.pdgaEventId)) return;
    toInsert.push({
      name: event.name,
      week: index + 1,
      season_year: 2026,
      start_date: event.startDate,
      end_date: event.endDate,
      pdga_event_id: event.pdgaEventId,
    });
  });

  if (toInsert.length === 0) {
    console.log(
      `Nothing to insert — all ${DGPT_2026_SCHEDULE.length} schedule events already exist in DB.`,
    );
    return;
  }

  console.log(`Inserting ${toInsert.length} tournaments:`);
  for (const row of toInsert) {
    console.log(`  + ${row.start_date}  ${row.name}  (pdga ${row.pdga_event_id})`);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("tournaments")
    .insert(toInsert)
    .select("id, name, start_date");

  if (insertErr) {
    console.error("Insert failed:", insertErr.message);
    process.exit(1);
  }

  console.log(`\nInserted ${inserted?.length ?? 0} rows.`);
}

main();
