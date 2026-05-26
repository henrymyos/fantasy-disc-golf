// One-off: trigger the PDGA import to populate tournament_results for any
// tournaments whose pdga_event_id is set but haven't been scraped yet (e.g.
// newly-backfilled events like the OTB Open).
//
// Run: npx tsx --env-file=.env.local scripts/run-pdga-import.ts

import { createClient } from "@supabase/supabase-js";
import { runPdgaImport } from "../lib/pdga-import";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } },
);

async function main() {
  const r = await runPdgaImport(s as any);
  console.log(`Scraped ${r.events.length} events:`);
  r.events.forEach((e: any) =>
    console.log(`  ${e.name.padEnd(45)}  MPO=${String(e.mpoRows).padStart(3)}  FPO=${String(e.fpoRows).padStart(3)}`),
  );
  if (r.unmatchedSample.length > 0) {
    console.log(`\nUnmatched PDGA entries (${r.unmatchedSample.length} shown):`);
    r.unmatchedSample.forEach((u: any) =>
      console.log(`  ${u.event} :: ${u.division} ${u.name} (#${u.pdgaNumber})`),
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
