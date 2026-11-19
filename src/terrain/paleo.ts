// Earth through geological time (D134): the PALEOMAP PaleoDEMs (C. R. Scotese and N. Wright, 2018, CC BY 4.0),
// the heights of the Earth's surface, land and sea floor, at 109 moments from today back 540 million years
// (every 5 million years, two in the Devonian a little off), each relative to the sea of its time, in cells
// of one degree. Between two of them the heights are blended, so that coasts and mountains change steadily
// from one map to the next.
//
// Between two maps the crust moves (D135): how far each cell's crust goes from one map to the next older one,
// worked out from the PALEOMAP plate model, and the heights are blended along that motion, so that continents
// slide from one place to the next rather than fade from one to the other.
//
// File format "MMP1" (little-endian):
//   0  "MMP1"            4  count (uint32)     8  width (uint32)     12  height (uint32)     16  metres per step (float32)
//   20 length of the description (uint32), then the description: JSON { ages: million years ago, youngest first; labels }
//   then a zlib stream of every map's residual planes in turn, each as a terrain file has them (grid.ts).
// Format "MMP2", with the motion: as "MMP1" to byte 24, then the lengths of the two zlib streams (uint32 each), the
//   description, the maps' stream, and a stream of the motion from each map to the next older one: for each pair,
//   every cell's move east, then every cell's move north, in tenths of a degree of arc (int8), cells as in the maps.
import { terrainPlanes, gridFromPlanes, inflateInBrowser, type ElevationGrid } from './grid.ts';
import type { Instant } from '../core-time/index.ts';

export interface PaleoSet {
  /** Million years ago, youngest first. */
  ages: number[];
  /** The name of each moment ("Late Eocene"). */
  labels: string[];
  grids: ElevationGrid[];
  /** For each map but the oldest, how its crust moves to the next older map's (D135): east then north, tenths of a degree of arc, per cell; absent: blended in place. */
  motion?: Int8Array[];
}

export const PALEO_MAGIC = 'MMP1', PALEO_MAGIC_MOTION = 'MMP2';

/** A set of maps as an "MMP1" file (`deflate`: a zlib compressor). */
export function encodePaleo(p: PaleoSet, deflate: (b: Uint8Array) => Uint8Array): Uint8Array {
  const g0 = p.grids[0];
  if (!g0 || p.ages.length !== p.grids.length || p.labels.length !== p.grids.length) throw new Error('A map for every age.');
  for (let i = 1; i < p.ages.length; i++) if (!(p.ages[i] > p.ages[i - 1])) throw new Error('Ages youngest first, each its own.');
  const meta = new TextEncoder().encode(JSON.stringify({ ages: p.ages, labels: p.labels }));
  const planes = new Uint8Array(p.grids.length * 2 * g0.width * g0.height);
  p.grids.forEach((g, i) => {
    if (g.width !== g0.width || g.height !== g0.height || g.step !== g0.step) throw new Error('Every map the same size.');
    planes.set(terrainPlanes(g), i * 2 * g0.width * g0.height);
  });
  const z = deflate(planes), n = g0.width * g0.height;
  const header = (magic: string, size: number) => {
    const out = new Uint8Array(size), v = new DataView(out.buffer);
    for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i);
    v.setUint32(4, p.grids.length, true); v.setUint32(8, g0.width, true); v.setUint32(12, g0.height, true); v.setFloat32(16, g0.step, true);
    v.setUint32(20, meta.length, true);
    return { out, v };
  };
  if (!p.motion) {
    const { out } = header(PALEO_MAGIC, 24 + meta.length + z.length);
    out.set(meta, 24); out.set(z, 24 + meta.length);
    return out;
  }
  if (p.motion.length !== p.grids.length - 1 || p.motion.some((m) => m.length !== 2 * n)) throw new Error('A motion for every pair of maps.');
  const moves = new Int8Array(p.motion.length * 2 * n);
  p.motion.forEach((m, i) => moves.set(m, i * 2 * n));
  const zm = deflate(new Uint8Array(moves.buffer));
  const { out, v } = header(PALEO_MAGIC_MOTION, 32 + meta.length + z.length + zm.length);
  v.setUint32(24, z.length, true); v.setUint32(28, zm.length, true);
  out.set(meta, 32); out.set(z, 32 + meta.length); out.set(zm, 32 + meta.length + z.length);
  return out;
}

/** Reads an "MMP1" file (`inflate`: a zlib inflater). */
export async function decodePaleo(bytes: Uint8Array, inflate: (z: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<PaleoSet> {
  const magic = bytes.length >= 24 ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) : '';
  if (magic !== PALEO_MAGIC && magic !== PALEO_MAGIC_MOTION) throw new Error('Not a Map Maker file of the Earth through time.');
  const damaged = () => new Error('Damaged file of the Earth through time.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const withMotion = magic === PALEO_MAGIC_MOTION, start = withMotion ? 32 : 24;
  if (bytes.length < start) throw damaged();
  const count = v.getUint32(4, true), width = v.getUint32(8, true), height = v.getUint32(12, true), step = v.getFloat32(16, true), metaLength = v.getUint32(20, true);
  const zLength = withMotion ? v.getUint32(24, true) : bytes.length - start - metaLength, zmLength = withMotion ? v.getUint32(28, true) : 0;
  if (!count || !width || !height || width * height > 1 << 24 || start + metaLength + zLength + zmLength > bytes.length || zLength < 0) throw damaged();
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + metaLength))) as { ages: number[]; labels: string[] };
  if (meta.ages?.length !== count || meta.labels?.length !== count) throw damaged();
  const at = start + metaLength;
  const planes = await inflate(bytes.subarray(at, at + zLength)), n = 2 * width * height;
  if (planes.length !== count * n) throw damaged();
  const grids = Array.from({ length: count }, (_, i) => gridFromPlanes(width, height, step, planes.subarray(i * n, (i + 1) * n)));
  if (!withMotion) return { ages: meta.ages, labels: meta.labels, grids };
  const moves = await inflate(bytes.subarray(at + zLength, at + zLength + zmLength));
  if (moves.length !== (count - 1) * n) throw damaged();
  const all = new Int8Array(moves.buffer, moves.byteOffset, moves.length);
  return { ages: meta.ages, labels: meta.labels, grids, motion: Array.from({ length: count - 1 }, (_, i) => all.subarray(i * n, (i + 1) * n)) };
}

/** The maps on either side of an age (million years ago, kept within the set's span) and how far between them. */
export function paleoBetween(p: Pick<PaleoSet, 'ages'>, age: number): { a: number; b: number; f: number } {
  const ages = p.ages, last = ages.length - 1;
  const t = Math.max(ages[0], Math.min(ages[last], Number.isFinite(age) ? age : age > 0 ? ages[last] : ages[0]));
  let i = 0;
  while (i < last - 1 && ages[i + 1] < t) i++;
  if (last === 0) return { a: 0, b: 0, f: 0 };
  const f = (t - ages[i]) / (ages[i + 1] - ages[i]);
  return f >= 1 ? { a: i + 1, b: i + 1, f: 0 } : { a: i, b: i + 1, f };
}

/** The heights at an age: the two maps either side of it, blended (rounded to a ten-thousandth of a million years). */
export function paleoGridAt(p: PaleoSet, age: number): { grid: ElevationGrid; key: string; age: number } {
  const { a, b, f } = paleoBetween(p, age);
  const at = p.ages[a] + (p.ages[b] - p.ages[a]) * f, key = `paleo:${at.toFixed(4)}`;
  const kept = blends.get(p)?.get(key);
  if (kept) return { grid: kept, key, age: at };
  let grid = p.grids[a];
  if (f > 0 && b !== a) {
    const A = p.grids[a].data, B = p.grids[b].data, out = new Int16Array(A.length), m = p.motion?.[a];
    if (m) morph(p.grids[a], A, B, m, f, out);
    else for (let k = 0; k < A.length; k++) out[k] = Math.round(A[k] + (B[k] - A[k]) * f);
    grid = { ...p.grids[a], data: out };
  }
  let m = blends.get(p);
  if (!m) blends.set(p, (m = new Map()));
  if (m.size > 48) m.delete(m.keys().next().value!);
  m.set(key, grid);
  return { grid, key, age: at };
}
const blends = new WeakMap<PaleoSet, Map<string, ElevationGrid>>();

/**
 * The heights a fraction f of the way from map A to the next older map B, along the crust's motion (D135):
 * the crust at a place then was f of its move away from where it is in A, and the rest of its move from where
 * it is in B (each read between the four nearest cells); the two blended as f says. At f 0: A; at 1: B.
 */
function morph(g: ElevationGrid, A: Int16Array, B: Int16Array, m: Int8Array, f: number, out: Int16Array): void {
  const W = g.width, H = g.height, n = W * H, sx = W / 360, sy = H / 180;
  const read = (G: Int16Array, lon: number, lat: number) => {
    const x = (lon + 180) * sx - 0.5, y = Math.max(0, Math.min(H - 1, (90 - lat) * sy - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, y1 = Math.min(H - 1, y0 + 1);
    const c0 = ((x0 % W) + W) % W, c1 = (c0 + 1) % W, r0 = y0 * W, r1 = y1 * W;
    return (G[r0 + c0] * (1 - tx) + G[r0 + c1] * tx) * (1 - ty) + (G[r1 + c0] * (1 - tx) + G[r1 + c1] * tx) * ty;
  };
  for (let j = 0; j < H; j++) {
    const lat = 90 - (j + 0.5) / sy, cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i < W; i++) {
      const k = j * W + i, lon = -180 + (i + 0.5) / sx, east = m[k] / 10 / cos, north = m[n + k] / 10;
      const ha = read(A, lon - f * east, lat - f * north), hb = read(B, lon + (1 - f) * east, lat + (1 - f) * north);
      out[k] = Math.round(ha + (hb - ha) * f);
    }
  }
}

/**
 * The name of the time of an age ("Late Eocene"): the nearest map's, except over the last 2.58 million years,
 * where the maps are 5 million years apart: the Holocene (from 11,700 years ago) or the Pleistocene, and in it
 * the Last Glacial Maximum (26,500 to 19,000 years ago).
 */
export function paleoLabelAt(p: Pick<PaleoSet, 'ages' | 'labels'>, age: number): string {
  if (age < 0.0117) return 'Holocene';
  if (age >= 0.019 && age <= 0.0265) return 'Pleistocene, the Last Glacial Maximum';
  if (age < 2.58) return 'Pleistocene';
  const { a, b, f } = paleoBetween(p, age);
  return p.labels[f < 0.5 ? a : b];
}

/** The day of 1 January 2000 (days since 1970), from which ages are counted. */
const PRESENT_DAY = 10957;
const DAYS_PER_YEAR = 365.2425;

/** How long ago an instant is, in million years (0 for today and after). */
export function ageOf(t: Instant): number {
  if (t.day === -Infinity) return Infinity;
  if (!Number.isFinite(t.day)) return 0;
  return Math.max(0, (PRESENT_DAY - (t.day + t.ms / 86_400_000)) / DAYS_PER_YEAR / 1e6);
}

/** The instant an age (million years ago) is. */
export function instantOfAge(ageMa: number): Instant {
  const d = PRESENT_DAY - ageMa * 1e6 * DAYS_PER_YEAR, day = Math.floor(d);
  return { day, ms: Math.round((d - day) * 86_400_000) % 86_400_000 };
}

/**
 * The sea through the last glacial cycle (D134), metres from today's at ages in thousands of years: a smoothed,
 * rounded reconstruction (after K. Lambeck and others, 2014, for the last 35,000 years, and R. M. Spratt and
 * L. E. Lisiecki, 2016, before), good to some tens of metres: the last interglacial a few metres higher than
 * today 125,000 years ago, the seas falling in steps to about 130 metres lower 21,000 years ago, then rising
 * (fastest 14,500 years ago) to today's about 6,000 years ago. Before 128,000 years ago: each map's own sea.
 */
export const GLACIAL_SEA: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [4, 0], [6, -2], [7, -6], [8, -15], [9, -25], [10, -40], [11, -48], [11.7, -60], [12.8, -65], [14.3, -75], [14.7, -96],
  [16.5, -110], [19, -125], [21, -130], [24, -127], [27, -110], [30, -90], [38, -80], [46, -80], [53, -75], [60, -85], [65, -90],
  [71, -75], [77, -50], [82, -25], [87, -45], [92, -45], [100, -25], [106, -40], [111, -45], [116, -20], [119, 0], [122, 6], [125, 6], [128, 0],
];

/** The sea at an age (million years ago), metres from today's: through the last glacial cycle (GLACIAL_SEA), 0 before it. */
export function glacialSeaAt(ageMa: number): number {
  const ka = ageMa * 1000, c = GLACIAL_SEA;
  if (!(ka > 0) || ka >= c[c.length - 1][0]) return 0;
  for (let i = 1; i < c.length; i++) if (ka <= c[i][0]) { const [a0, m0] = c[i - 1], [a1, m1] = c[i]; return m0 + ((m1 - m0) * (ka - a0)) / (a1 - a0); }
  return 0;
}

let earthThroughTime: Promise<PaleoSet> | null = null;

/** The maps of the Earth through time, loaded once from the interface's data folder. */
export function loadPaleo(url = 'data/paleo/paleodem-1deg.bin'): Promise<PaleoSet> {
  if (!earthThroughTime) {
    earthThroughTime = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('The maps of the Earth through time could not be loaded.');
      return decodePaleo(new Uint8Array(await res.arrayBuffer()), inflateInBrowser);
    })();
    earthThroughTime.catch(() => { earthThroughTime = null; });
  }
  return earthThroughTime;
}
