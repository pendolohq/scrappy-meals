// Renders the app icons from one SVG. Run after changing the design: node scripts/icons.mjs
import { mkdir, writeFile } from "node:fs/promises";

import sharp from "sharp";

const out = new URL("../public/icons/", import.meta.url);

// A steaming bowl on the app's green. `pad` shrinks the artwork for maskable
// icons, whose outer 20% may be cropped into a circle or squircle.
const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#15803d"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)" fill="none" stroke="#fafaf9" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <path d="M96 248h320a160 136 0 0 1-320 0z" fill="#fafaf9" stroke="none"/>
    <path d="M200 120c-12 28 12 44 0 72M256 104c-12 28 12 44 0 72M312 120c-12 28 12 44 0 72"/>
    <path d="M176 424h160"/>
  </g>
</svg>`;

await mkdir(out, { recursive: true });
await writeFile(new URL("icon.svg", out), svg(0.12).trim() + "\n");
const render = (pad, size, name) =>
  sharp(Buffer.from(svg(pad))).resize(size, size).png({ compressionLevel: 9 }).toFile(new URL(name, out).pathname);

await Promise.all([
  render(0.12, 192, "icon-192.png"),
  render(0.12, 512, "icon-512.png"),
  render(0.3, 512, "maskable-512.png"),
  render(0.12, 180, "apple-touch-icon.png"),
]);
console.log("icons written to public/icons/");
