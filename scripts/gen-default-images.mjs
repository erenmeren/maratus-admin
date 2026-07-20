// Generates the bundled default decorative PNGs used by branding "image"
// objects that don't have a user-uploaded image yet (check, wifi-off).
//
// Run: node scripts/gen-default-images.mjs
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dir = require
  .resolve("lucide-static/package.json")
  .replace(/package\.json$/, "icons/");

mkdirSync("public/defaults", { recursive: true });

for (const [out, file] of [
  ["check", "circle-check"],
  ["wifi-off", "wifi-off"],
]) {
  const svg = readFileSync(`${dir}${file}.svg`, "utf8")
    .replace(/stroke="currentColor"/g, 'stroke="#111827"')
    .replace(/stroke-width="[^"]*"/g, 'stroke-width="2"');
  const png = await sharp(Buffer.from(svg))
    .resize(256, 256, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  writeFileSync(`public/defaults/${out}.png`, png);
  console.log(`wrote public/defaults/${out}.png (${png.length} bytes)`);
}
