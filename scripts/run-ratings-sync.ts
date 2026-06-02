// One-off: refresh every player's pdga_rating from their PDGA profile page.
// Also runs automatically inside the weekly /api/sync-pdga cron.
//
// Run: npx tsx --env-file=.env.local scripts/run-ratings-sync.ts

import { createClient } from "@supabase/supabase-js";
import { runRatingsSync } from "../lib/ratings-sync";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } },
);

async function main() {
  const r = await runRatingsSync(s as any);
  console.log(`Scanned ${r.scanned} players · ${r.updated} updated · ${r.unresolved} unresolved`);
  if (r.movers.length > 0) {
    console.log("\nRating changes:");
    r.movers
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((m) => console.log(`  ${m.name.padEnd(28)} ${m.from ?? "—"} → ${m.to}`));
  }
  if (r.stillMissing.length > 0) {
    console.log(`\nStill no rating (${r.stillMissing.length}): ${r.stillMissing.sort().join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
