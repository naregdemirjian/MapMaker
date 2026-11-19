// Downloads the picture of the whole Earth for the satellite look (D138): Sentinel-2 cloudless 2016 by EOX
// (CC BY 4.0, https://s2maps.eu), level 3 of its tiles in longitude and latitude (16 by 8 tiles of 256 pixels),
// laid side by side into data/terrain/earth-photo-4096.webp (4096 by 2048 pixels from the north-west corner,
// like the elevation grid). The file is committed, so the app never needs the network for it; run this only to
// rebuild it.
//
//   node scripts/fetch-earth-photo.mjs [--tiles <folder to keep the downloaded tiles in>]
//
// (Tiles already in the folder, named <level>-<row>-<column>.jpg, are not downloaded again: where Node cannot
// reach the internet itself, behind a proxy say, download them into it first.)
//
// Saved as WebP (quality 0.9) by the browser that runs the interface tests; nothing else is changed.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless/default/WGS84';
const LEVEL = 3, TILE = 256, COLS = 2 ** (LEVEL + 1), ROWS = 2 ** LEVEL;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const dir = arg('--tiles') ?? join(tmpdir(), 'mapmaker-earth-photo');
mkdirSync(dir, { recursive: true });

// 1. The tiles (kept in the folder, so a second run downloads nothing).
const tiles = [];
const hash = createHash('sha256');
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const file = join(dir, `${LEVEL}-${r}-${c}.jpg`);
  if (!existsSync(file)) {
    const res = await fetch(`${SOURCE}/${LEVEL}/${r}/${c}.jpg`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Tile ${LEVEL}/${r}/${c}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const bytes = readFileSync(file);
  hash.update(bytes);
  tiles.push({ r, c, b64: bytes.toString('base64') });
}
console.log(`${tiles.length} tiles in ${dir}`);

// 2. Laid side by side and saved as WebP by the browser.
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
const webp = await page.evaluate(async ({ tiles, TILE, COLS, ROWS }) => {
  const canvas = new OffscreenCanvas(COLS * TILE, ROWS * TILE), ctx = canvas.getContext('2d');
  for (const t of tiles) {
    const bin = atob(t.b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { colorSpaceConversion: 'none' });
    ctx.drawImage(bitmap, t.c * TILE, t.r * TILE);
    bitmap.close();
  }
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  const out = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
}, { tiles, TILE, COLS, ROWS });
await browser.close();
const file = join(root, 'data', 'terrain', 'earth-photo-4096.webp');
writeFileSync(file, Buffer.from(webp, 'base64'));
console.log(`wrote ${file}: ${Math.round(Buffer.from(webp, 'base64').length / 1024)} KB`);

// 3. Its record among the data sources: where it came from, its licence, the credit its makers ask for.
const datasetsFile = join(root, 'data', 'datasets.json');
const all = JSON.parse(readFileSync(datasetsFile, 'utf8'));
const record = {
  id: 's2cloudless',
  name: 'Sentinel-2 cloudless 2016 (EOX)',
  version: '2016; tiles in longitude and latitude, level 3 bundled, levels 4 to 13 downloaded as needed',
  source: 'https://s2maps.eu (tiles from https://tiles.maps.eox.at)',
  licence: 'Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/)',
  credit: 'Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)',
  usedFor: "The satellite look of maps of the Earth: the planet as photographed. A picture of the whole Earth ships with the app (data/terrain/earth-photo-4096.webp, about 10 km a pixel); close in, the photographs of the region in view (to about 10 m a pixel) are downloaded when needed through the local data service and kept on this computer; can be turned off per map",
  retrieved: new Date().toISOString().slice(0, 10),
  converted: 'The bundled picture: the 128 tiles of level 3 laid side by side and saved as WebP (scripts/fetch-earth-photo.mjs). Close in: tiles laid side by side into a picture of the region in view (src/terrain/photo-cache.ts). Colours unchanged; relief shading and the coast of the moment are drawn over them.',
  sources: [{ file: `level ${LEVEL} tiles (${tiles.length} JPEG files, in row and column order)`, sha256: hash.digest('hex') }],
};
const at = all.findIndex((d) => d.id === record.id);
if (at >= 0) all[at] = record; else all.splice(all.findIndex((d) => d.id === 'terrain-tiles-close') + 1 || all.length, 0, record);
writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
console.log(`updated ${datasetsFile}`);
