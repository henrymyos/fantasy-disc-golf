// Rebuilds overall_rank by interleaving MPO and FPO based on world_ranking
// so the two divisions are evenly mixed across the whole pool. With 90 MPO
// and 40 FPO, the target FPO frequency is 40/130 ≈ 31% — we use a running
// "expected vs placed" balance to decide which division gets each slot.
//
// Run: npx tsx --env-file=.env.local scripts/reinterleave-overall-rank.ts

import { createClient } from "@supabase/supabase-js";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: players, error } = await s
    .from("players")
    .select("id, name, division, world_ranking");
  if (error) throw error;

  const mpo = (players ?? [])
    .filter((p: any) => p.division === "MPO")
    .sort((a: any, b: any) => (a.world_ranking ?? 9999) - (b.world_ranking ?? 9999));
  const fpo = (players ?? [])
    .filter((p: any) => p.division === "FPO")
    .sort((a: any, b: any) => (a.world_ranking ?? 9999) - (b.world_ranking ?? 9999));

  const total = mpo.length + fpo.length;
  const fpoRatio = fpo.length / total;
  console.log(`Pool: ${mpo.length} MPO + ${fpo.length} FPO = ${total} (FPO target ${(fpoRatio * 100).toFixed(1)}%)`);

  const sequence: Array<{ id: number; name: string; division: string }> = [];
  let mi = 0;
  let fi = 0;
  let placedFpo = 0;
  for (let slot = 1; slot <= total; slot++) {
    const expectedFpo = slot * fpoRatio;
    const chooseFpo = fi < fpo.length && (mi >= mpo.length || placedFpo < expectedFpo - 0.5);
    if (chooseFpo) {
      const p = fpo[fi++];
      sequence.push({ id: p.id, name: p.name, division: p.division });
      placedFpo++;
    } else {
      const p = mpo[mi++];
      sequence.push({ id: p.id, name: p.name, division: p.division });
    }
  }

  console.log("\nPreview of slots 1–15:");
  sequence.slice(0, 15).forEach((p, i) =>
    console.log(` ${String(i + 1).padStart(3)}  ${p.division}  ${p.name}`),
  );
  console.log("\nPreview of slots 86–130:");
  sequence.slice(85).forEach((p, i) =>
    console.log(` ${String(86 + i).padStart(3)}  ${p.division}  ${p.name}`),
  );

  console.log(`\nWriting ${sequence.length} overall_rank values…`);
  for (let i = 0; i < sequence.length; i++) {
    const newRank = i + 1;
    const { error: upErr } = await s
      .from("players")
      .update({ overall_rank: newRank })
      .eq("id", sequence[i].id);
    if (upErr) console.error(`  ! ${sequence[i].name}: ${upErr.message}`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
