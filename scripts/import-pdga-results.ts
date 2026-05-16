// One-off / manual importer. The Vercel cron at /api/sync-pdga runs the same
// logic on a schedule, but use this when you want to refresh results from
// your laptop right now.
//   pnpm tsx scripts/import-pdga-results.ts
//   (or: npx tsx scripts/import-pdga-results.ts)
//
// Add --dry to skip the DB write and just print what would happen.

import { createClient } from "@supabase/supabase-js";
import { runPdgaImport } from "../lib/pdga-import";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  if (process.argv.includes("--dry")) {
    console.log("Dry-run flag is no longer supported by the shared importer; it always wipes + rebuilds tournament_results.");
    console.log("Run without --dry to actually sync.");
    return;
  }
  const result = await runPdgaImport(supabase);
  for (const e of result.events) {
    console.log(`→ ${e.name} (PDGA ${e.pdgaId}): ${e.mpoRows} MPO + ${e.fpoRows} FPO rows`);
  }
  console.log(`\nInserted ${result.insertedRows} result rows.`);
  console.log(`Unmatched PDGA rows: ${result.unmatchedRows}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
