// Downloads Natural Earth I (land cover, 16,200 × 8,100 pixels) and makes the land colours of the
// Earth's satellite look (D100): data/terrain/earth-cover-4096.webp, laid like the elevation grid
// (4096 × 2048 cells, from the north-west corner). The file is committed, so the app never needs the
// network; run this only to rebuild it.
//
//   node scripts/fetch-land-cover.mjs [--from <NE1_LR_LC.zip or NE1_LR_LC.tif>]
//
// 1. Each cell is the mean of the land pixels it covers (Natural Earth I leaves the sea, and the
//    largest lakes, pure white).
// 2. Natural Earth I's colours are light, made to be printed under other things. They are recoloured
//    to the colours land has from space (the biome colours planets use, src/terrain/biomes.ts): each
//    of its colours is matched to the colours of its kinds of cover (ice, rock, tundra, steppe, arid
//    land, desert, grass and crops, grass and woods, woods, forest), weighted by how close it is, and
//    given theirs. Grass is savanna in the tropics; forest is rainforest in the tropics and northern
//    forest in the north; the palest ground is ice towards the poles.
// 3. The sea takes the colour of the nearest land, so land the sea leaves when it falls (D96), or
//    sculpted out of it (D98), has the colour of the coast beside it.
// 4. Saved as WebP (quality 90) by the browser that runs the interface tests.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIOMES } from '../src/terrain/biomes.ts';

const URL = 'https://naturalearth.s3.amazonaws.com/10m_raster/NE1_LR_LC.zip';
const WIDTH = 4096, HEIGHT = 2048;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

// --- The TIFF, out of its zip ---
let sourceHash = null;
async function tiff() {
  let from = arg('--from');
  if (!from) {
    const dir = join(tmpdir(), 'mapmaker-land-cover');
    mkdirSync(dir, { recursive: true });
    from = join(dir, 'NE1_LR_LC.zip');
    if (!existsSync(from)) {
      console.log(`downloading ${URL}`);
      const res = await fetch(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(from, Buffer.from(await res.arrayBuffer()));
    }
  }
  const buf = readFileSync(from);
  sourceHash = { file: from.endsWith('.zip') ? 'NE1_LR_LC.zip' : 'NE1_LR_LC.tif', sha256: createHash('sha256').update(buf).digest('hex') };
  if (!from.endsWith('.zip')) return buf;
  // The zip's central directory: find the .tif and inflate it.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  let p = buf.readUInt32LE(eocd + 16);
  for (let e = buf.readUInt16LE(eocd + 10); e > 0; e--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.endsWith('.tif')) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('no .tif in the zip');
}

/** An uncompressed, chunky RGB TIFF: its size and each row's pixels. */
function readTiff(b) {
  const le = b.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd = u32(4), tags = new Map();
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const o = ifd + 2 + i * 12, type = u16(o + 2), count = u32(o + 4);
    if (type !== 3 && type !== 4) continue; // (only whole-number tags are needed)
    const size = type === 3 ? 2 : 4, at = count * size > 4 ? u32(o + 8) : o + 8;
    tags.set(u16(o), Array.from({ length: count }, (_, k) => (size === 2 ? u16(at + k * 2) : u32(at + k * 4))));
  }
  const width = tags.get(256)[0], height = tags.get(257)[0], spp = tags.get(277)?.[0] ?? 1;
  if ((tags.get(259)?.[0] ?? 1) !== 1 || spp < 3 || (tags.get(284)?.[0] ?? 1) !== 1) throw new Error('expected an uncompressed, chunky RGB TIFF');
  const offsets = tags.get(273), perStrip = tags.get(278)?.[0] ?? height;
  const row = (y) => { const s = Math.floor(y / perStrip), o = offsets[s] + (y - s * perStrip) * width * spp; return b.subarray(o, o + width * spp); };
  return { width, height, spp, row };
}

// --- Natural Earth I's colours, by kind of cover, and the colours they are given ---
const mix = (a, b, t) => a.map((v, q) => v + (b[q] - v) * t);
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const grassAt = (lat) => mix(BIOMES.savanna, BIOMES.grass, smooth(Math.abs(lat), 16, 28));
const forestAt = (lat) => { const a = Math.abs(lat); return a < 30 ? mix(BIOMES.rainforest, BIOMES.forest, smooth(a, 12, 28)) : mix(BIOMES.forest, BIOMES.boreal, smooth(a, 46, 56)); };
const KINDS = [
  { colours: [[240, 243, 250], [231, 238, 248], [236, 240, 248], [248, 248, 250], [224, 232, 244]], to: () => BIOMES.ice },
  { colours: [[227, 230, 231], [220, 222, 224]], to: () => BIOMES.rock },
  { colours: [[226, 225, 216], [220, 219, 210], [232, 231, 222]], to: () => BIOMES.tundra },
  { colours: [[232, 225, 198], [228, 216, 189], [223, 207, 187], [230, 213, 187]], to: () => BIOMES.steppe },
  { colours: [[229, 215, 204], [232, 217, 203]], to: () => mix(BIOMES.desert, BIOMES.steppe, 0.5) },
  { colours: [[243, 232, 215], [246, 242, 219], [246, 221, 201], [248, 240, 224], [250, 249, 237], [251, 251, 242], [253, 252, 246]], to: (lat) => mix(BIOMES.desert, BIOMES.ice, smooth(Math.abs(lat), 50, 60)) },
  { colours: [[235, 237, 192], [238, 239, 193], [233, 235, 193], [241, 241, 194], [240, 235, 202], [234, 232, 191]], to: grassAt },
  { colours: [[224, 229, 188], [219, 227, 190], [224, 230, 192], [210, 220, 184]], to: (lat) => mix(grassAt(lat), forestAt(lat), 0.45) },
  { colours: [[202, 216, 180], [190, 208, 176], [190, 209, 177]], to: (lat) => mix(grassAt(lat), forestAt(lat), 0.75) },
  { colours: [[172, 202, 175], [171, 196, 169], [169, 195, 168], [160, 192, 162]], to: forestAt },
];
const anchors = KINDS.flatMap((k, i) => k.colours.map((c) => ({ c, kind: i })));

/** The satellite colour of a Natural Earth I colour at a latitude. */
function recolour(r, g, b, lat, targets) {
  let w = 0, R = 0, G = 0, B = 0;
  for (const a of anchors) {
    const d2 = (r - a.c[0]) ** 2 + (g - a.c[1]) ** 2 + (b - a.c[2]) ** 2, wt = 1 / (d2 + 4) ** 2, t = targets[a.kind];
    w += wt; R += wt * t[0]; G += wt * t[1]; B += wt * t[2];
  }
  return [R / w, G / w, B / w];
}

const src = readTiff(await tiff());
console.log(`Natural Earth I: ${src.width} × ${src.height}`);
// 1. Mean of the land pixels of each cell (area-weighted; pure white is the sea).
const sx = src.width / WIDTH, sy = src.height / HEIGHT;
const sum = new Float64Array(WIDTH * 4);
const out = new Uint8Array(WIDTH * HEIGHT * 4);
const land = new Uint8Array(WIDTH * HEIGHT);
let y0 = 0;
for (let j = 0; j < HEIGHT; j++) {
  sum.fill(0);
  const top = j * sy, bottom = (j + 1) * sy;
  for (let y = Math.floor(top); y < Math.min(src.height, Math.ceil(bottom)); y++) {
    const wy = Math.min(bottom, y + 1) - Math.max(top, y), row = src.row(y);
    for (let i = 0; i < WIDTH; i++) {
      const left = i * sx, right = (i + 1) * sx;
      for (let x = Math.floor(left); x < Math.min(src.width, Math.ceil(right)); x++) {
        const o = x * src.spp, r = row[o], g = row[o + 1], b = row[o + 2];
        if (r === 255 && g === 255 && b === 255) continue;
        const wt = wy * (Math.min(right, x + 1) - Math.max(left, x));
        sum[i * 4] += wt * r; sum[i * 4 + 1] += wt * g; sum[i * 4 + 2] += wt * b; sum[i * 4 + 3] += wt;
      }
    }
  }
  // 2. Recoloured.
  const lat = 90 - ((j + 0.5) / HEIGHT) * 180, targets = KINDS.map((k) => k.to(lat));
  for (let i = 0; i < WIDTH; i++) {
    const wt = sum[i * 4 + 3], k = j * WIDTH + i;
    if (wt < 1e-6) continue;
    const c = recolour(sum[i * 4] / wt, sum[i * 4 + 1] / wt, sum[i * 4 + 2] / wt, lat, targets);
    out[k * 4] = Math.round(c[0]); out[k * 4 + 1] = Math.round(c[1]); out[k * 4 + 2] = Math.round(c[2]); out[k * 4 + 3] = 255;
    land[k] = 1;
  }
  if (j - y0 >= 256) { console.log(`row ${j} of ${HEIGHT}`); y0 = j; }
}
// 3. The sea takes the colour of the nearest land: spread from the coasts, cell by cell.
let front = [];
for (let k = 0; k < WIDTH * HEIGHT; k++) if (land[k]) front.push(k);
const seen = land.slice();
const around = (k) => { const j = Math.floor(k / WIDTH), i = k - j * WIDTH; return [j * WIDTH + ((i + 1) % WIDTH), j * WIDTH + ((i + WIDTH - 1) % WIDTH), j > 0 ? k - WIDTH : -1, j < HEIGHT - 1 ? k + WIDTH : -1]; };
while (front.length) {
  const next = [];
  for (const k of front) for (const a of around(k)) if (a >= 0 && !seen[a]) { seen[a] = 1; next.push(a); }
  for (const a of next) {
    let r = 0, g = 0, b = 0, m = 0;
    for (const q of around(a)) if (q >= 0 && out[q * 4 + 3]) { r += out[q * 4]; g += out[q * 4 + 1]; b += out[q * 4 + 2]; m++; }
    out[a * 4] = r / m; out[a * 4 + 1] = g / m; out[a * 4 + 2] = b / m;
  }
  for (const a of next) out[a * 4 + 3] = 255;
  front = next;
}
// 4. Saved as WebP by the browser.
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
const webp = await page.evaluate(async ({ w, h, b64 }) => {
  const bin = atob(b64), px = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, { w: WIDTH, h: HEIGHT, b64: Buffer.from(out).toString('base64') });
await browser.close();
const file = join(root, 'data', 'terrain', 'earth-cover-4096.webp');
writeFileSync(file, Buffer.from(webp, 'base64'));
console.log(`wrote ${file}: ${Math.round(Buffer.from(webp, 'base64').length / 1024)} KB`);
if (arg('--raw')) writeFileSync(arg('--raw'), out);

// The Natural Earth record says what its data is used for, where the raster came from and how it was changed.
const datasetsFile = join(root, 'data', 'datasets.json');
const all = JSON.parse(readFileSync(datasetsFile, 'utf8'));
const ne = all.find((d) => d.id === 'natural-earth');
if (ne) {
  if (!/land cover/.test(ne.usedFor)) ne.usedFor += "; the land's colours in the satellite look (Natural Earth I land cover, recoloured: data/terrain/earth-cover-4096.webp)";
  if (!/raster/.test(ne.source)) ne.source = ne.source.replace(/\)$/, '; raster files from https://naturalearth.s3.amazonaws.com)');
  if (!/Natural Earth I/.test(ne.converted)) ne.converted += ' Natural Earth I (land cover, version 2.0.0, 16,200 × 8,100 pixels): averaged to 4096 × 2048 cells, recoloured to the colours land has from space and spread over the sea (scripts/fetch-land-cover.mjs).';
  ne.sources = (ne.sources ?? []).filter((s) => !s.file.startsWith('NE1_LR_LC'));
  if (sourceHash) ne.sources.push(sourceHash);
  writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
  console.log(`updated ${datasetsFile}`);
}
