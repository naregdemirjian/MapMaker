// Downloads Earth's elevation, sea floor included, and builds the grid Map Maker draws terrain from
// (data/terrain/earth-4096.bin, format in src/terrain/grid.ts). The file is committed, so the app and
// the tests never need the network; run this only to rebuild it.
//
//   node scripts/fetch-terrain.mjs [--cache <folder to keep the downloads in>] [--raw <file>]
//
// --raw also writes the grid as plain int16 values (row by row from the north-west corner), for checking.
//
// 1. The Tilezen (formerly Mapzen) terrain tiles on AWS Open Data, "terrarium" encoding, at zoom 5:
//    1024 Web Mercator tiles of 256 × 256 pixels (GMTED2010 on land and ETOPO1 under the sea at that
//    zoom). Each grid cell is the mean of the pixels it covers, weighted by how much of the cell's
//    latitude each pixel row covers. Beyond the Mercator limit (85.05°) the nearest row is used,
//    smoothed along the parallel more and more towards the pole (no streaks converging on it).
// 2. Those tiles give the rock beneath the Greenland and Antarctic ice sheets (central Greenland near
//    sea level, much of Antarctica below it), not the ice surface a map shows. There, the Copernicus
//    DEM GLO-90 (a surface model: ice, land and ice shelves) replaces them: the smallest overview of
//    each 1° tile south of 60° S and around Greenland (59°-84° N, 74°-10° W), which is 3 to 10 km
//    per pixel, is read with HTTP range requests. A cell that is partly sea takes the sea floor
//    (from step 1, never above sea level) for the part that is sea.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terrainHeader, terrainPlanes } from '../src/terrain/grid.ts';

const ZOOM = 5;
const WIDTH = 4096, HEIGHT = 2048;
const STEP = 1; // metres
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const COPERNICUS = 'https://copernicus-dem-90m.s3.amazonaws.com';
const inIceRegion = (lat, lon) => lat < -60 || (lat >= 59 && lat < 84 && lon >= -74 && lon < -10); // a tile's south-west corner

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const cache = arg('--cache') ?? join(tmpdir(), 'mapmaker-terrain-downloads');
const tilesDir = join(cache, `terrarium-z${ZOOM}`);
mkdirSync(tilesDir, { recursive: true });

async function get(url, range) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, range ? { headers: { range: `bytes=${range[0]}-${range[1]}` } } : {});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}
async function inParallel(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()); }));
}

// --- 1. The terrain tiles ---
const n = 2 ** ZOOM;
const tiles = [];
for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) tiles.push([x, y]);
const tileFile = (x, y) => join(tilesDir, `${ZOOM}-${x}-${y}.png`);
let fetched = 0;
await inParallel(tiles, 8, async ([x, y]) => {
  if (existsSync(tileFile(x, y))) return;
  writeFileSync(tileFile(x, y), await get(`${TERRARIUM}/${ZOOM}/${x}/${y}.png`));
  fetched++;
});
console.log(`terrain tiles: ${tiles.length} (${fetched} downloaded)`);

/** 8-bit RGB or RGBA PNG, not interlaced. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, type = 0, depth = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp = type === 2 ? 3 : 4, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row + i - bpp] : 0, b = y > 0 ? out[up + i] : 0, c = i >= bpp && y > 0 ? out[up + i - bpp] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row + i] = (raw[src + i] + p) & 255;
    }
  }
  return { w, h, bpp, data: out };
}

// The Mercator mosaic, in metres.
const S = 256 * n;
const merc = new Float32Array(S * S);
for (const [x, y] of tiles) {
  const t = decodePNG(readFileSync(tileFile(x, y)));
  if (t.w !== 256 || t.h !== 256) throw new Error(`tile ${x}/${y} is ${t.w}×${t.h}`);
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
    const k = (py * 256 + px) * t.bpp;
    merc[(y * 256 + py) * S + x * 256 + px] = t.data[k] * 256 + t.data[k + 1] + t.data[k + 2] / 256 - 32768;
  }
}

// Onto the longitude/latitude grid. Mosaic row v covers latitudes latOf(v + 1) to latOf(v).
const latOf = (v) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / S))) * 180) / Math.PI;
const rowLat = Float64Array.from({ length: S + 1 }, (_, v) => latOf(v));
const perCol = S / WIDTH;
const dLat = 180 / HEIGHT;
const metres = new Float64Array(WIDTH * HEIGHT);
const mosaicRow = (v) => { const r = new Float64Array(WIDTH); for (let i = 0; i < WIDTH; i++) { let s = 0; for (let c = 0; c < perCol; c++) s += merc[v * S + i * perCol + c]; r[i] = s / perCol; } return r; };
const edgeRows = { north: mosaicRow(0), south: mosaicRow(S - 1) };
const limit = rowLat[0];
let v0 = 0;
for (let j = 0; j < HEIGHT; j++) {
  const north = 90 - j * dLat, south = north - dLat, out = j * WIDTH;
  let total = 0;
  while (v0 < S - 1 && rowLat[v0 + 1] >= north) v0++;
  for (let v = v0; v < S && rowLat[v] > south; v++) {
    const wgt = Math.min(north, rowLat[v]) - Math.max(south, rowLat[v + 1]);
    if (wgt <= 0) continue;
    total += wgt;
    for (let i = 0; i < WIDTH; i++) {
      let s = 0;
      for (let c = 0; c < perCol; c++) s += merc[v * S + i * perCol + c];
      metres[out + i] += (wgt * s) / perCol;
    }
  }
  if (total > 0) { for (let i = 0; i < WIDTH; i++) metres[out + i] /= total; continue; }
  // Beyond the Mercator limit: the edge row, averaged over a window of longitudes that widens to the
  // whole parallel at the pole.
  const edge = north > 0 ? edgeRows.north : edgeRows.south;
  const t = Math.min(1, (Math.abs((north + south) / 2) - limit) / (90 - limit));
  const half = Math.round(t * t * (WIDTH / 2));
  const prefix = new Float64Array(3 * WIDTH + 1), span = Math.min(2 * half + 1, WIDTH);
  for (let i = 0; i < 3 * WIDTH; i++) prefix[i + 1] = prefix[i] + edge[i % WIDTH];
  for (let i = 0; i < WIDTH; i++) {
    const a = i - half + WIDTH;
    metres[out + i] = (prefix[a + span] - prefix[a]) / span;
  }
}

// --- 2. The ice sheets: Copernicus DEM GLO-90 ---
const binsFile = join(cache, `copernicus-glo90-bins-${WIDTH}x${HEIGHT}.bin`);
let landSum, landCount, count;
if (existsSync(binsFile)) {
  const all = new Float32Array(new Uint8Array(inflateSync(readFileSync(binsFile))).buffer);
  [landSum, landCount, count] = [0, 1, 2].map((p) => all.subarray(p * WIDTH * HEIGHT, (p + 1) * WIDTH * HEIGHT));
  console.log(`ice sheets: from ${binsFile}`);
} else {
  const all = new Float32Array(3 * WIDTH * HEIGHT);
  [landSum, landCount, count] = [0, 1, 2].map((p) => all.subarray(p * WIDTH * HEIGHT, (p + 1) * WIDTH * HEIGHT));
  const names = (await get(`${COPERNICUS}/tileList.txt`)).toString('utf8').split(/\s+/).filter((name) => {
    const m = /_([NS])(\d+)_00_([EW])(\d+)_00_DEM$/.exec(name);
    return m && inIceRegion((m[1] === 'N' ? 1 : -1) * Number(m[2]), (m[3] === 'E' ? 1 : -1) * Number(m[4]));
  });
  let done = 0;
  await inParallel(names, 16, async (name) => {
    const t = await smallestOverview(`${COPERNICUS}/${name}/${name}.tif`);
    for (let y = 0; y < t.h; y++) {
      const lat = t.north - (y + 0.5) * t.dy, j = Math.min(HEIGHT - 1, Math.floor(((90 - lat) / 180) * HEIGHT));
      for (let x = 0; x < t.w; x++) {
        const v = t.values[y * t.w + x];
        if (Number.isNaN(v)) continue;
        const lon = t.west + (x + 0.5) * t.dx, i = (Math.floor(((lon + 180) / 360) * WIDTH) + WIDTH) % WIDTH, k = j * WIDTH + i;
        count[k]++;
        if (v !== 0) { landSum[k] += v; landCount[k]++; } // the sea is exactly 0 in these tiles
      }
    }
    if (++done % 500 === 0) console.log(`  ${done} of ${names.length} Copernicus tiles`);
  });
  writeFileSync(binsFile, deflateSync(Buffer.from(all.buffer)));
  console.log(`ice sheets: ${names.length} Copernicus tiles`);
}

/** Reads the smallest overview of a Copernicus tile (a cloud-optimised GeoTIFF: little-endian, float32,
 *  deflate with the floating-point predictor, the overview in a single tile near the start of the file). */
async function smallestOverview(url) {
  const head = await get(url, [0, 131071]);
  const u16 = (o) => head.readUInt16LE(o), u32 = (o) => head.readUInt32LE(o);
  const ifds = [];
  for (let off = u32(4); off; ) {
    const tags = {}, entries = u16(off);
    for (let e = 0; e < entries; e++) {
      const at = off + 2 + e * 12, tag = u16(at), type = u16(at + 2), cnt = u32(at + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 })[type] * cnt, vo = size <= 4 ? at + 8 : u32(at + 8);
      tags[tag] = Array.from({ length: cnt }, (_, k) => (type === 3 ? u16(vo + 2 * k) : type === 4 ? u32(vo + 4 * k) : type === 12 ? head.readDoubleLE(vo + 8 * k) : head[vo + k]));
    }
    ifds.push(tags);
    off = u32(off + 2 + entries * 12);
  }
  const full = ifds[0], o = ifds[ifds.length - 1];
  if (head.toString('latin1', 0, 2) !== 'II' || o[259][0] !== 8 || o[317][0] !== 3 || o[339][0] !== 3 || o[258][0] !== 32 || o[324].length !== 1) throw new Error(`${url}: unexpected layout`);
  const w = o[256][0], h = o[257][0], tw = o[322][0], at = o[324][0], len = o[325][0];
  const data = at + len <= head.length ? head.subarray(at, at + len) : await get(url, [at, at + len - 1]);
  const raw = inflateSync(data);
  const values = new Float32Array(w * h), row = new Uint8Array(tw * 4), bytes = new Uint8Array(4), f32 = new Float32Array(bytes.buffer);
  for (let y = 0; y < h; y++) {
    row.set(raw.subarray(y * tw * 4, (y + 1) * tw * 4));
    for (let i = 1; i < row.length; i++) row[i] = (row[i] + row[i - 1]) & 255;
    for (let x = 0; x < w; x++) { bytes[3] = row[x]; bytes[2] = row[tw + x]; bytes[1] = row[2 * tw + x]; bytes[0] = row[3 * tw + x]; values[y * w + x] = f32[0]; }
  }
  const [sx, sy] = full[33550], tie = full[33922];
  return { w, h, values, west: tie[3], north: tie[4], dx: (sx * full[256][0]) / w, dy: (sy * full[257][0]) / h };
}

let patched = 0;
for (let k = 0; k < WIDTH * HEIGHT; k++) {
  if (!landCount[k]) continue;
  const land = landCount[k] / count[k];
  metres[k] = land * (landSum[k] / landCount[k]) + (1 - land) * Math.min(0, metres[k]);
  patched++;
}
console.log(`ice sheets: ${patched} cells from Copernicus`);

// --- 3. Write the grid ---
const grid = { width: WIDTH, height: HEIGHT, step: STEP, data: new Int16Array(WIDTH * HEIGHT) };
for (let k = 0; k < grid.data.length; k++) grid.data[k] = Math.max(-32768, Math.min(32767, Math.round(metres[k] / STEP)));
const outDir = join(root, 'data', 'terrain');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `earth-${WIDTH}.bin`);
const bytes = Buffer.concat([terrainHeader(grid), deflateSync(terrainPlanes(grid), { level: 9, memLevel: 9 })]);
writeFileSync(file, bytes);
let min = Infinity, max = -Infinity;
for (const v of grid.data) { if (v < min) min = v; if (v > max) max = v; }
console.log(`wrote ${file}: ${WIDTH} × ${HEIGHT}, ${(bytes.length / 1048576).toFixed(2)} MB, ${min * STEP} m to ${max * STEP} m`);
if (arg('--raw')) writeFileSync(arg('--raw'), Buffer.from(grid.data.buffer));

// --- 4. Credit the sources ---
const retrieved = new Date().toISOString().slice(0, 10);
const records = [
  {
    id: 'terrain-tiles',
    name: 'Terrain Tiles (Tilezen, formerly Mapzen)',
    version: `terrarium encoding, zoom ${ZOOM}`,
    source: 'https://registry.opendata.aws/terrain-tiles/ (made with https://github.com/tilezen/joerd)',
    licence: 'Open data; each source keeps its own terms (https://github.com/tilezen/joerd/blob/master/docs/attribution.md). At this zoom: ETOPO1 (NOAA) and GMTED2010 (USGS), both public domain.',
    credit: 'Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration; global GMTED2010 terrain data courtesy of the U.S. Geological Survey (via the Mapzen terrain tiles).',
    usedFor: "Earth's terrain and sea floor (data/terrain/earth-4096.bin), outside the ice sheets",
    retrieved,
    converted: `Resampled from Web Mercator onto a ${WIDTH} × ${HEIGHT} longitude/latitude grid (${(360 / WIDTH).toFixed(4)}° cells, about ${(40075 / WIDTH).toFixed(1)} km at the equator) by area-weighted means; rounded to ${STEP} m. Beyond 85.05° the nearest row, smoothed towards the pole.`,
  },
  {
    id: 'copernicus-dem',
    name: 'Copernicus DEM GLO-90',
    version: 'GLO-90 (2021 release), smallest overview of each tile',
    source: 'https://registry.opendata.aws/copernicus-dem/',
    licence: 'Free of charge for any use, including commercial, with the credit below (Copernicus DEM licence for GLO-90)',
    credit: '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
    usedFor: 'The ice surface of Greenland and Antarctica (and the land around Greenland) in data/terrain/earth-4096.bin',
    retrieved,
    converted: `Means of the overview pixels (3 to 10 km) in each ${(360 / WIDTH).toFixed(4)}° cell, south of 60° S and within 59°-84° N, 74°-10° W; a cell partly at sea takes the sea floor of the terrain tiles for that part.`,
  },
];
const datasetsFile = join(root, 'data', 'datasets.json');
const ids = new Set(records.map((r) => r.id));
const all = existsSync(datasetsFile) ? JSON.parse(readFileSync(datasetsFile, 'utf8')).filter((d) => !ids.has(d.id)) : [];
all.push(...records);
writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
console.log(`updated ${datasetsFile}`);
