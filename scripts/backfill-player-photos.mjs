// Backfills players.avatar_url with headshots from each player's PDGA profile
// page (keyed by pdga_number, same source lib/ratings-sync.ts scrapes for
// ratings). Only fills missing avatars unless --force is passed.
//
//   node --env-file=.env.local scripts/backfill-player-photos.mjs [--force]

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const force = process.argv.includes("--force");

// Uploaded profile photos live under /pictures/picture-…; PDGA default/stock
// images don't match this pattern, so a miss means "no real photo".
const PHOTO_RE = /https:\/\/www\.pdga\.com\/files\/styles\/[a-z_]+\/public\/pictures\/picture-[^"'\s]+/;

async function photoFor(pdgaNumber) {
  const res = await fetch(`https://www.pdga.com/player/${pdgaNumber}`, {
    headers: { "User-Agent": "Mozilla/5.0 (fantasy-disc-golf avatar backfill)" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(PHOTO_RE);
  if (!m) return null;
  // Normalize to the "large" style variant and unescape ampersands.
  return m[0].replace(/\/styles\/[a-z_]+\//, "/styles/large/").replace(/&amp;/g, "&");
}

const { data: players, error } = await supabase
  .from("players")
  .select("id, name, pdga_number, avatar_url")
  .order("id");
if (error) throw error;

const targets = players.filter((p) => p.pdga_number && (force || !p.avatar_url));
console.log(`${players.length} players, ${targets.length} to backfill`);

const misses = [];
for (const p of targets) {
  try {
    const url = await photoFor(p.pdga_number);
    if (url) {
      const { error: upErr } = await supabase
        .from("players")
        .update({ avatar_url: url })
        .eq("id", p.id);
      if (upErr) throw upErr;
      console.log(`ok    ${p.name}`);
    } else {
      misses.push(p);
      console.log(`MISS  ${p.name} (#${p.pdga_number})`);
    }
  } catch (e) {
    misses.push(p);
    console.log(`ERR   ${p.name}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300)); // be polite to pdga.com
}

console.log(`\ndone: ${targets.length - misses.length} updated, ${misses.length} without a photo`);
if (misses.length) console.log(misses.map((p) => `- ${p.name} (#${p.pdga_number})`).join("\n"));
