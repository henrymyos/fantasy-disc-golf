// Generates the app's PNG icon set into public/ from inline SVG art, so the
// PWA has real raster icons (iOS doesn't reliably use SVG for home-screen /
// maskable icons). Re-run after changing the logo:
//
//   node scripts/generate-icons.mjs
//
// Outputs:
//   icon-192.png / icon-512.png  — full-bleed, purpose "any"
//   maskable-512.png             — logo inside the central safe zone, "maskable"
//   apple-touch-icon.png (180)   — opaque square; iOS applies its own rounding

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const PURPLE = "#4B3DFF";

// Full-bleed rounded-square mark (used for the regular "any" icons).
const fullBleed = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" rx="100" fill="${PURPLE}"/>
  <text x="256" y="368" font-family="sans-serif" font-size="348" font-weight="900" text-anchor="middle" letter-spacing="-16" fill="#fff">DF</text>
</svg>`;

// Maskable / Apple: opaque edge-to-edge square with the mark pulled into the
// central ~70% so platform masks (circles, squircles) never clip it.
const padded = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" fill="${PURPLE}"/>
  <text x="256" y="340" font-family="sans-serif" font-size="248" font-weight="900" text-anchor="middle" letter-spacing="-12" fill="#fff">DF</text>
</svg>`;

const jobs = [
  { svg: fullBleed(192), size: 192, out: "icon-192.png" },
  { svg: fullBleed(512), size: 512, out: "icon-512.png" },
  { svg: padded(512), size: 512, out: "maskable-512.png" },
  { svg: padded(180), size: 180, out: "apple-touch-icon.png" },
];

for (const { svg, size, out } of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(PUBLIC, out));
  console.log(`wrote public/${out} (${size}x${size})`);
}
