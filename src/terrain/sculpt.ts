// Sculpting the terrain (Stage 8, D98). A brush stroke is kept as a stamp: the tool, the path it was
// drawn along (longitude, latitude), its size and strength, a seed for its noise, and when it holds:
// always (the base world) or from a date on (a change in history). The heights a map shows at a moment
// are its base heights (Earth's, or a planet's) with every stamp holding then applied in the order
// drawn, so strokes are as light to store as their paths and every change can be undone.
//
// The quick generator's drawing tools (Stage 15.7, D169): an outline that becomes land or sea (its coast ragged, the
// land rising inland or the sea deepening away from it), a river drawn from its source to its mouth (a valley falling
// all the way, so the water the map works out follows it), and biomes painted over the land's colours (kept with the
// strokes, but changing no heights: see cover.ts).
import type { ElevationGrid } from './grid.ts';
import { simplex3 } from './planet.ts';
import { BIOMES, type Biome } from './biomes.ts';
import type { Instant } from '../core-time/index.ts';

export type SculptTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'roughen' | 'mountains' | 'valley' | 'crater' | 'island' | 'land' | 'sea' | 'erode' | 'coast-land' | 'coast-sea' | 'river' | 'biome';

export const SCULPT_TOOLS: Array<{ id: SculptTool; name: string; hint: string; strength: number }> = [
  { id: 'raise', name: 'Raise', hint: 'Lift the ground along the stroke', strength: 500 },
  { id: 'lower', name: 'Lower', hint: 'Sink the ground along the stroke', strength: 500 },
  { id: 'mountains', name: 'Mountain range', hint: 'A range of peaks and ridges along the stroke', strength: 3000 },
  { id: 'valley', name: 'Valley', hint: 'A valley or trench cut along the stroke', strength: 1200 },
  { id: 'smooth', name: 'Smooth', hint: 'Even out bumps under the stroke', strength: 0 },
  { id: 'flatten', name: 'Flatten', hint: 'Bring the ground to the height where the stroke starts', strength: 0 },
  { id: 'roughen', name: 'Roughen', hint: 'Add hills and hollows under the stroke', strength: 400 },
  { id: 'erode', name: 'Erode', hint: 'Wear steep slopes down as weather would', strength: 0 },
  { id: 'crater', name: 'Crater', hint: 'A crater where you click: a bowl with a raised rim', strength: 1500 },
  { id: 'island', name: 'Island', hint: 'Raise land out of the sea where you click or draw', strength: 800 },
  { id: 'land', name: 'Paint land', hint: 'Make land of what is under the stroke (low land, a little above the sea)', strength: 40 },
  { id: 'sea', name: 'Paint sea', hint: 'Flood what is under the stroke (shallow sea)', strength: 60 },
  { id: 'coast-land', name: 'Draw land (outline)', hint: 'Draw round a shape: inside becomes land, rising inland to the height set; the size sets how ragged its coast is', strength: 400 },
  { id: 'coast-sea', name: 'Draw sea (outline)', hint: 'Draw round a shape: inside becomes sea, deepening away from its coast to the depth set; the size sets how ragged its coast is', strength: 3000 },
  { id: 'river', name: 'River', hint: 'Draw from a river\'s source to its mouth: a valley falling all the way, so the water follows it', strength: 120 },
  { id: 'biome', name: 'Paint a biome', hint: 'Paint what grows there, as the satellite look shows it (generated and simulated planets)', strength: 0 },
];
/** Tools whose stroke is an outline (closed by the map). */
export const OUTLINE_TOOLS: readonly SculptTool[] = ['coast-land', 'coast-sea'];
/** Whether a stroke changes the heights (painted biomes change only the land's colours). */
export const changesHeights = (s: Pick<TerrainStamp, 'tool'>) => s.tool !== 'biome';
export const isSculptTool = (v: unknown): v is SculptTool => typeof v === 'string' && SCULPT_TOOLS.some((t) => t.id === v);

/** A stroke of the sculpting brush (or a click: a path of one point). */
export interface TerrainStamp {
  id: string;
  tool: SculptTool;
  /** [longitude, latitude] in degrees. */
  path: Array<[number, number]>;
  /** The brush's radius in kilometres, and how strong it was (metres; unused by smooth, flatten and erode). */
  radiusKm: number;
  strength: number;
  seed: number;
  /** From when it holds: null for the base world (always). */
  from: { day: number; ms: number } | null;
  /** For a painted biome: which. */
  biome?: Biome;
}

/** Stamps as stored, checked (anything broken left out). */
export function cleanStamps(raw: unknown): TerrainStamp[] {
  if (!Array.isArray(raw)) return [];
  const out: TerrainStamp[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const s = r as Partial<TerrainStamp>;
    if (typeof s.id !== 'string' || !isSculptTool(s.tool) || !Array.isArray(s.path) || !s.path.length) continue;
    const path = s.path.filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90);
    if (!path.length || !(Number(s.radiusKm) > 0) || !Number.isFinite(Number(s.strength))) continue;
    const from = s.from && Number.isFinite(s.from.day) ? { day: s.from.day, ms: Number.isFinite(s.from.ms) ? s.from.ms : 0 } : null;
    if (s.tool === 'biome' && !(typeof s.biome === 'string' && s.biome in BIOMES)) continue;
    out.push({
      id: s.id, tool: s.tool, path, radiusKm: Math.min(5000, Number(s.radiusKm)), strength: Math.max(0, Math.min(10000, Number(s.strength))), seed: Number.isFinite(s.seed) ? Number(s.seed) : 1, from,
      ...(s.tool === 'biome' ? { biome: s.biome } : {}),
    });
  }
  return out;
}

/** The stamps holding at a moment: the base world's always, a dated one from its date on. */
export function stampsAt(stamps: readonly TerrainStamp[], t: Instant): TerrainStamp[] {
  return stamps.filter((s) => !s.from || t.day > s.from.day || (t.day === s.from.day && t.ms >= s.from.ms));
}

/** A name for a set of stamps applied to some heights (what the result is kept by). */
export const stampsKey = (baseKey: string, stamps: readonly TerrainStamp[]) => (stamps.length ? `${baseKey}+${stamps.map((s) => s.id).join(',')}` : baseKey);

/** The base heights with the stamps applied, in order, and the cells they touched (null when none). */
export interface Sculpted { grid: ElevationGrid; touched: Uint8Array | null }

const RAD = Math.PI / 180;

/**
 * Applies stamps to a copy of the heights. `radiusKm` is the planet's (distances along the ground are
 * measured on it). Cells a stamp changed are marked in `touched` (so that on Earth the coastline drawn
 * gives way to the terrain there).
 */
export function applyStamps(base: ElevationGrid, all: readonly TerrainStamp[], radiusKm: number): Sculpted {
  const stamps = all.filter(changesHeights);
  if (!stamps.length) return { grid: base, touched: null };
  const { width: W, height: H, step } = base;
  const e = new Float32Array(W * H);
  for (let k = 0; k < e.length; k++) e[k] = base.data[k] * step;
  const touched = new Uint8Array(W * H);
  for (const s of stamps) {
    if (OUTLINE_TOOLS.includes(s.tool)) applyOutline(e, touched, W, H, s, radiusKm);
    else if (s.tool === 'river') applyRiver(e, touched, W, H, s, radiusKm);
    else applyStamp(e, touched, W, H, s, radiusKm);
  }
  const data = new Int16Array(W * H);
  for (let k = 0; k < data.length; k++) data[k] = Math.max(-32768, Math.min(32767, Math.round(e[k] / step)));
  return { grid: { width: W, height: H, step, data }, touched };
}

/** Unit vector of a place. */
const vec = (lon: number, lat: number): [number, number, number] => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];

/** Angular distance (radians) from a point to a path of points joined by great-circle arcs. */
function distanceToPath(x: number, y: number, z: number, pts: Array<[number, number, number]>, normals: Array<[number, number, number] | null>): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const da = Math.acos(Math.max(-1, Math.min(1, x * a[0] + y * a[1] + z * a[2])));
    if (da < best) best = da;
    const n = normals[i];
    if (!n || i + 1 >= pts.length) continue;
    const b = pts[i + 1];
    // The point's foot on the arc's great circle lies within the arc when it is on the inner side of both
    // ends: (a × f)·n and (f × b)·n both at least 0, written here as (a × n)·f and (n × b)·f at most 0.
    const dn = x * n[0] + y * n[1] + z * n[2];
    const fx = x - dn * n[0], fy = y - dn * n[1], fz = z - dn * n[2];
    const ca = (a[1] * n[2] - a[2] * n[1]) * fx + (a[2] * n[0] - a[0] * n[2]) * fy + (a[0] * n[1] - a[1] * n[0]) * fz;
    const cb = (n[1] * b[2] - n[2] * b[1]) * fx + (n[2] * b[0] - n[0] * b[2]) * fy + (n[0] * b[1] - n[1] * b[0]) * fz;
    if (ca <= 0 && cb <= 0) { const d = Math.asin(Math.min(1, Math.abs(dn))); if (d < best) best = d; }
  }
  return best;
}

function applyStamp(e: Float32Array, touched: Uint8Array, W: number, H: number, s: TerrainStamp, radiusKm: number): void {
  const r = s.radiusKm / radiusKm; // radians
  const reach = s.tool === 'crater' ? r * 1.6 : r;
  const pts = s.tool === 'crater' ? [vec(s.path[0][0], s.path[0][1])] : s.path.map(([lon, lat]) => vec(lon, lat));
  const normals = pts.map((a, i) => {
    const b = pts[i + 1];
    if (!b) return null;
    const n: [number, number, number] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    return len > 1e-12 ? ([n[0] / len, n[1] / len, n[2] / len] as [number, number, number]) : null;
  });
  // The cells the stamp can reach: rows by latitude, columns by longitude (all of them near a pole).
  const lats = s.path.map((p) => p[1]), lons = s.path.map((p) => p[0]);
  const reachDeg = reach / RAD;
  const lat0 = Math.max(-90, Math.min(...lats) - reachDeg), lat1 = Math.min(90, Math.max(...lats) + reachDeg);
  const j0 = Math.max(0, Math.floor(((90 - lat1) / 180) * H)), j1 = Math.min(H - 1, Math.ceil(((90 - lat0) / 180) * H));
  const maxAbsLat = Math.max(Math.abs(lat0), Math.abs(lat1));
  const lonReach = maxAbsLat > 89 ? 180 : Math.min(180, reachDeg / Math.cos(maxAbsLat * RAD));
  // (A path across the 180th meridian is taken with its longitudes made continuous.)
  const unwrapped: number[] = [];
  for (const lon of lons) { const prev = unwrapped[unwrapped.length - 1]; unwrapped.push(prev === undefined ? lon : prev + ((((lon - prev) % 360) + 540) % 360) - 180); }
  const spanLon = Math.max(...unwrapped) - Math.min(...unwrapped) + 2 * lonReach;
  const fullRows = spanLon >= 360;
  const lonStart = Math.min(...unwrapped) - lonReach;
  const cols = fullRows ? W : Math.min(W, Math.ceil((spanLon / 360) * W) + 2);
  const i0 = fullRows ? 0 : Math.floor(((lonStart + 180) / 360) * W);
  const noise = simplex3(s.seed);
  const cellsAcross = Math.max(1, (r / (Math.PI / H)));
  // The weight of each reached cell (0 outside the brush), worked out once.
  const n = (j1 - j0 + 1) * cols, weight = new Float32Array(n), index = new Int32Array(n), dist = new Float32Array(n);
  let m = 0;
  for (let j = j0; j <= j1; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180, cl = Math.cos(lat * RAD), z = Math.sin(lat * RAD);
    for (let c = 0; c < cols; c++) {
      const i = (((i0 + c) % W) + W) % W, lon = -180 + ((i + 0.5) / W) * 360;
      const x = cl * Math.cos(lon * RAD), y = cl * Math.sin(lon * RAD);
      const d = distanceToPath(x, y, z, pts, normals);
      if (d >= reach) continue;
      const u = d / r;
      weight[m] = u < 1 ? (1 - u * u) * (1 - u * u) : 0;
      dist[m] = u;
      index[m] = j * W + i;
      m++;
    }
  }
  if (!m) return;
  const strength = s.strength;
  const noiseAt = (k: number, scale: number) => {
    const j = Math.floor(k / W), i = k % W;
    const lat = (90 - ((j + 0.5) / H) * 180) * RAD, lon = (-180 + ((i + 0.5) / W) * 360) * RAD;
    const f = scale / Math.max(r, 1e-4);
    return noise(Math.cos(lat) * Math.cos(lon) * f, Math.cos(lat) * Math.sin(lon) * f, Math.sin(lat) * f);
  };
  const mark = (k: number) => { touched[k] = 1; };
  switch (s.tool) {
    case 'raise': case 'lower': {
      const sign = s.tool === 'raise' ? 1 : -1;
      for (let q = 0; q < m; q++) { const k = index[q]; e[k] += sign * strength * weight[q]; mark(k); }
      break;
    }
    case 'mountains': {
      for (let q = 0; q < m; q++) {
        const k = index[q], w = weight[q];
        if (!w) continue;
        const ridged = 1 - Math.abs(noiseAt(k, 3) * 0.7 + noiseAt(k, 9) * 0.3);
        e[k] += strength * Math.pow(w, 1.5) * (0.45 + 0.55 * ridged * ridged);
        mark(k);
      }
      break;
    }
    case 'valley': {
      for (let q = 0; q < m; q++) { const k = index[q], w = weight[q]; if (!w) continue; e[k] -= strength * w * w; mark(k); }
      break;
    }
    case 'roughen': {
      for (let q = 0; q < m; q++) { const k = index[q], w = weight[q]; if (!w) continue; e[k] += strength * w * (0.65 * noiseAt(k, 4) + 0.35 * noiseAt(k, 11)); mark(k); }
      break;
    }
    case 'crater': {
      for (let q = 0; q < m; q++) {
        const k = index[q], u = dist[q];
        e[k] += u < 1 ? strength * (u * u - 1) + 0.25 * strength : 0.25 * strength * Math.exp(-(((u - 1) / 0.25) ** 2));
        mark(k);
      }
      break;
    }
    case 'island': {
      for (let q = 0; q < m; q++) {
        const k = index[q], w = weight[q];
        if (!w) continue;
        const top = strength * w * (0.75 + 0.25 * noiseAt(k, 5)) + (w > 0.05 ? 20 : 0);
        if (top > e[k]) { e[k] = top; mark(k); }
      }
      break;
    }
    case 'land': case 'sea': {
      // Land a little above the sea, or sea a little below it, blended in over the brush's edge.
      for (let q = 0; q < m; q++) {
        const k = index[q], w = Math.min(1, weight[q] * 2.5);
        if (!w) continue;
        const target = s.tool === 'land' ? Math.max(e[k], strength + 15 * noiseAt(k, 6)) : Math.min(e[k], -strength - 10 * Math.abs(noiseAt(k, 6)));
        e[k] += (target - e[k]) * w;
        mark(k);
      }
      break;
    }
    case 'flatten': {
      const [lon, lat] = s.path[0];
      const ji = Math.max(0, Math.min(H - 1, Math.floor(((90 - lat) / 180) * H))), ii = (((Math.floor(((lon + 180) / 360) * W)) % W) + W) % W;
      const target = e[ji * W + ii];
      for (let q = 0; q < m; q++) { const k = index[q], w = weight[q]; if (!w) continue; e[k] += (target - e[k]) * Math.min(1, w * 1.5); mark(k); }
      break;
    }
    case 'smooth': {
      // A few passes of averaging with the four neighbours, each place by its weight.
      const passes = Math.min(12, Math.max(2, Math.round(cellsAcross / 2)));
      const next = new Float32Array(m);
      for (let p = 0; p < passes; p++) {
        for (let q = 0; q < m; q++) {
          const k = index[q], j = Math.floor(k / W), i = k % W;
          const left = j * W + ((i - 1 + W) % W), right = j * W + ((i + 1) % W), up = Math.max(0, j - 1) * W + i, down = Math.min(H - 1, j + 1) * W + i;
          const mean = (e[left] + e[right] + e[up] + e[down]) / 4;
          next[q] = e[k] + (mean - e[k]) * weight[q] * 0.9;
        }
        for (let q = 0; q < m; q++) e[index[q]] = next[q];
      }
      for (let q = 0; q < m; q++) if (weight[q]) mark(index[q]);
      break;
    }
    case 'erode': {
      // Thermal erosion: where the ground falls more than a little to a neighbour (0.3% across a cell:
      // seen from map scales, slopes steeper than that are the mountains' own), some of it slides down.
      const cellM = (radiusKm * 1000 * Math.PI) / H, talus = 0.003 * cellM;
      const passes = Math.min(40, Math.max(8, Math.round(cellsAcross)));
      for (let p = 0; p < passes; p++) {
        for (let q = 0; q < m; q++) {
          const k = index[q], w = weight[q];
          if (!w) continue;
          const j = Math.floor(k / W), i = k % W;
          const around = [j * W + ((i - 1 + W) % W), j * W + ((i + 1) % W), Math.max(0, j - 1) * W + i, Math.min(H - 1, j + 1) * W + i];
          let low = k, drop = 0;
          for (const a of around) { const d = e[k] - e[a]; if (d > drop) { drop = d; low = a; } }
          if (drop > talus) { const move = 0.25 * (drop - talus) * w; e[k] -= move; e[low] += move; }
        }
      }
      for (let q = 0; q < m; q++) if (weight[q]) mark(index[q]);
      break;
    }
  }
}


/**
 * An outline that becomes land or sea (D169). The outline (closed from its last point to its first) is the coast,
 * made ragged by noise as wide as the brush (the stroke's radius); inside it, land rises from 10 m at the coast to the
 * height set (its own hills and hollows on it, a quarter either way; higher ground is kept), or the sea deepens from
 * 20 m at the coast to the depth set (a tenth either way; deeper sea is kept), over four brush widths; outside it,
 * the shore: a shelf rising from the sea floor to 20 m deep at the new land, or land falling to 10 m at the new sea. (Inside by
 * crossings along each row; the distance to the coast by a distance transform over the outline's box, so the work
 * grows with its area alone.)
 */
function applyOutline(e: Float32Array, touched: Uint8Array, W: number, H: number, s: TerrainStamp, radiusKm: number): void {
  if (s.path.length < 3) return;
  // Longitudes made continuous along the outline (one crossing the 180th meridian stays one shape).
  const ring: Array<[number, number]> = [];
  for (const [lon, lat] of s.path) {
    const prev = ring[ring.length - 1];
    ring.push([prev ? prev[0] + ((((lon - prev[0]) % 360) + 540) % 360) - 180 : lon, lat]);
  }
  const r = s.radiusKm / radiusKm, ramp = 4 * r; // radians
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  // (The box reaches past the coast as far as its shores are shaped.)
  const reachDeg = (r + ramp) / RAD, cellLat = Math.PI / H, cellLon = (2 * Math.PI) / W;
  const lat0 = Math.max(-90, Math.min(...lats) - reachDeg), lat1 = Math.min(90, Math.max(...lats) + reachDeg);
  const j0 = Math.max(0, Math.floor(((90 - lat1) / 180) * H)), j1 = Math.min(H - 1, Math.ceil(((90 - lat0) / 180) * H));
  const widest = Math.max(Math.abs(lat0), Math.abs(lat1));
  const lonPad = Math.min(180, reachDeg / Math.max(0.05, Math.cos(Math.min(89, widest) * RAD)));
  const cFrom = Math.floor(((Math.min(...lons) - lonPad + 180) / 360) * W), cTo = Math.min(cFrom + W - 1, Math.ceil(((Math.max(...lons) + lonPad + 180) / 360) * W));
  const R = j1 - j0 + 1, C = cTo - cFrom + 1;
  // Inside: an odd number of the ring's crossings of the row lie west of the cell.
  const inside = new Uint8Array(R * C);
  for (let jj = 0; jj < R; jj++) {
    const lat = 90 - ((j0 + jj + 0.5) / H) * 180, xs: number[] = [];
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a], [xb, yb] = ring[b];
      if ((ya > lat) !== (yb > lat)) xs.push(xa + ((lat - ya) * (xb - xa)) / (yb - ya));
    }
    xs.sort((p, q) => p - q);
    let q = 0;
    for (let cc = 0; cc < C; cc++) {
      const lon = -180 + ((cFrom + cc + 0.5) / W) * 360;
      while (q < xs.length && xs[q] < lon) q++;
      inside[jj * C + cc] = q & 1;
    }
  }
  // The distance to the coast (radians): zero on cells beside the other side, then two passes over the box.
  const dist = new Float64Array(R * C).fill(Infinity), dx = new Float64Array(R);
  for (let jj = 0; jj < R; jj++) dx[jj] = cellLon * Math.max(0.01, Math.cos((90 - ((j0 + jj + 0.5) / H) * 180) * RAD));
  for (let jj = 0; jj < R; jj++) for (let cc = 0; cc < C; cc++) {
    const k = jj * C + cc, v = inside[k];
    if ((cc > 0 && inside[k - 1] !== v) || (cc + 1 < C && inside[k + 1] !== v) || (jj > 0 && inside[k - C] !== v) || (jj + 1 < R && inside[k + C] !== v)) dist[k] = 0;
  }
  const relax = (k: number, from: number, step: number) => { const d = dist[from] + step; if (d < dist[k]) dist[k] = d; };
  for (let jj = 0; jj < R; jj++) for (let cc = 0; cc < C; cc++) {
    const k = jj * C + cc;
    if (cc > 0) relax(k, k - 1, dx[jj]);
    if (jj > 0) { relax(k, k - C, cellLat); const dg = Math.hypot(dx[jj], cellLat); if (cc > 0) relax(k, k - C - 1, dg); if (cc + 1 < C) relax(k, k - C + 1, dg); }
  }
  for (let jj = R - 1; jj >= 0; jj--) for (let cc = C - 1; cc >= 0; cc--) {
    const k = jj * C + cc;
    if (cc + 1 < C) relax(k, k + 1, dx[jj]);
    if (jj + 1 < R) { relax(k, k + C, cellLat); const dg = Math.hypot(dx[jj], cellLat); if (cc + 1 < C) relax(k, k + C + 1, dg); if (cc > 0) relax(k, k + C - 1, dg); }
  }
  const noise = simplex3(s.seed), f = 1 / Math.max(r, 1e-4), land = s.tool === 'coast-land';
  for (let jj = 0; jj < R; jj++) {
    const lat = 90 - ((j0 + jj + 0.5) / H) * 180, cl = Math.cos(lat * RAD), z = Math.sin(lat * RAD);
    for (let cc = 0; cc < C; cc++) {
      const q = jj * C + cc, d = Number.isFinite(dist[q]) ? dist[q] : ramp + r, isIn = inside[q] === 1;
      if (!isIn && d >= r + ramp) continue;
      const lon = -180 + ((cFrom + cc + 0.5) / W) * 360, x = cl * Math.cos(lon * RAD), y = cl * Math.sin(lon * RAD);
      // The coast moved by its noise, ragged at the brush's scale (only near it can it change the side).
      const ragged = d < r ? r * (0.65 * noise(x * 2 * f, y * 2 * f, z * 2 * f) + 0.35 * noise(x * 6 * f, y * 6 * f, z * 6 * f)) : 0;
      const signed = (isIn ? d : -d) + ragged;
      const k = (j0 + jj) * W + (((cFrom + cc) % W) + W) % W;
      if (signed <= 0) {
        // Beyond the coast, its shore: the sea floor rising to 20 m deep at new land (a shelf), or the land falling to
        // 10 m at a new sea, from as it was four brush widths away.
        const u = Math.min(1, -signed / ramp), keep = u * u * (3 - 2 * u);
        const shore = land ? -20 + (e[k] + 20) * keep : 10 + (e[k] - 10) * keep;
        if (land ? shore > e[k] : shore < e[k]) { e[k] = shore; touched[k] = 1; }
        continue;
      }
      const u = Math.min(1, signed / ramp), rise = u * u * (3 - 2 * u);
      const hills = noise(x * 4 * f, y * 4 * f, z * 4 * f);
      if (land) {
        const target = 10 + (s.strength - 10) * rise * (1 + 0.25 * hills) + 30 * Math.abs(hills);
        if (target > e[k]) { e[k] = target; touched[k] = 1; }
      } else {
        const target = -(20 + (s.strength - 20) * rise * (1 + 0.1 * hills));
        if (target < e[k]) { e[k] = target; touched[k] = 1; }
      }
    }
  }
}

/**
 * A river drawn from its source to its mouth (D169): along the stroke the ground is cut to a bed falling steadily
 * from the depth set below the source's ground to just below the sea where the stroke first reaches it (or, ending
 * inland, to the depth set below the ground there), and the valley's sides slope down to it across the brush's width,
 * so the water the map works out runs the way it was drawn.
 */
function applyRiver(e: Float32Array, touched: Uint8Array, W: number, H: number, s: TerrainStamp, radiusKm: number): void {
  if (s.path.length < 2) return;
  const at = (lon: number, lat: number) => {
    const j = Math.max(0, Math.min(H - 1, Math.floor(((90 - lat) / 180) * H))), i = (((Math.floor(((lon + 180) / 360) * W)) % W) + W) % W;
    return j * W + i;
  };
  const pts = s.path.map(([lon, lat]) => vec(lon, lat));
  // How far along the stroke each point lies (radians), and the bed's height there: from the depth set below the
  // source's ground down to the depth set below the mouth's (and below the sea at least), falling all the way.
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.acos(Math.max(-1, Math.min(1, pts[i][0] * pts[i - 1][0] + pts[i][1] * pts[i - 1][1] + pts[i][2] * pts[i - 1][2]))));
  const total = Math.max(1e-9, along[along.length - 1]);
  const [lonA, latA] = s.path[0], [lonB, latB] = s.path[s.path.length - 1];
  if (e[at(lonA, latA)] < 0) return;
  // Its mouth: where the stroke first reaches the sea (the bed falls to just below it there, and the stroke ends);
  // or, drawn to an end inland, there (the bed as far below the ground there as at the source).
  let mouth = 1;
  for (let q = 0; q + 1 < s.path.length && mouth === 1; q++) {
    const [a, b] = [s.path[q], s.path[q + 1]], dLon = ((((b[0] - a[0]) % 360) + 540) % 360) - 180;
    const n = Math.max(1, Math.ceil((Math.hypot(dLon, b[1] - a[1]) / 180) * H * 2));
    for (let k = 1; k <= n; k++) if (e[at(a[0] + (dLon * k) / n, a[1] + ((b[1] - a[1]) * k) / n)] < 0) { mouth = (along[q] + ((along[q + 1] - along[q]) * k) / n) / total; break; }
  }
  const top = e[at(lonA, latA)] - s.strength, bottom = mouth < 1 ? Math.min(-5, top - 1) : Math.min(e[at(lonB, latB)] - s.strength, top - 1);
  const bedAt = (t: number) => top + ((bottom - top) * t) / mouth;
  const r = s.radiusKm / radiusKm, reachDeg = r / RAD;
  const lats = s.path.map((p) => p[1]);
  const unwrapped: number[] = [];
  for (const [lon] of s.path) { const prev = unwrapped[unwrapped.length - 1]; unwrapped.push(prev === undefined ? lon : prev + ((((lon - prev) % 360) + 540) % 360) - 180); }
  const lat0 = Math.max(-90, Math.min(...lats) - reachDeg), lat1 = Math.min(90, Math.max(...lats) + reachDeg);
  const j0 = Math.max(0, Math.floor(((90 - lat1) / 180) * H)), j1 = Math.min(H - 1, Math.ceil(((90 - lat0) / 180) * H));
  const widest = Math.max(Math.abs(lat0), Math.abs(lat1));
  const lonPad = Math.min(180, reachDeg / Math.max(0.05, Math.cos(Math.min(89, widest) * RAD)));
  const cFrom = Math.floor(((Math.min(...unwrapped) - lonPad + 180) / 360) * W), cTo = Math.min(cFrom + W - 1, Math.ceil(((Math.max(...unwrapped) + lonPad + 180) / 360) * W));
  for (let j = j0; j <= j1; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180, cl = Math.cos(lat * RAD), z = Math.sin(lat * RAD);
    for (let cc = cFrom; cc <= cTo; cc++) {
      const i = ((cc % W) + W) % W, lon = -180 + ((i + 0.5) / W) * 360;
      const x = cl * Math.cos(lon * RAD), y = cl * Math.sin(lon * RAD);
      // The nearest point of the stroke: its segment, and how far along.
      let best = Infinity, t = 0;
      for (let q = 0; q + 1 < pts.length; q++) {
        const a = pts[q], b = pts[q + 1];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [x - a[0], y - a[1], z - a[2]];
        const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
        const u = len2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2)) : 0;
        const dx = ap[0] - u * ab[0], dy = ap[1] - u * ab[1], dz = ap[2] - u * ab[2], d = Math.hypot(dx, dy, dz);
        if (d < best) { best = d; t = (along[q] + u * (along[q + 1] - along[q])) / total; }
      }
      if (best >= r || t > mouth) continue;
      const k = j * W + i, w = best / r, bed = bedAt(t);
      // The valley: the bed in the middle, its sides rising to the ground at the brush's edge.
      const side = bed + (e[k] - bed) * w * w;
      if (side < e[k]) { e[k] = side; touched[k] = 1; }
    }
  }
}

/**
 * Each cell of a W × H grid (equirectangular, from the north-west corner) under a stroke's brush, with the brush's
 * weight there (1 on the stroke, falling to 0 at its radius); `radiusKm` is the planet's (D169: what painted biomes
 * colour).
 */
export function underBrush(W: number, H: number, s: Pick<TerrainStamp, 'path' | 'radiusKm'>, radiusKm: number, visit: (k: number, weight: number) => void): void {
  const r = s.radiusKm / radiusKm, pts = s.path.map(([lon, lat]) => vec(lon, lat));
  const normals = pts.map((a, i) => {
    const b = pts[i + 1];
    if (!b) return null;
    const n: [number, number, number] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    return len > 1e-12 ? ([n[0] / len, n[1] / len, n[2] / len] as [number, number, number]) : null;
  });
  const reachDeg = r / RAD, lats = s.path.map((p) => p[1]);
  const unwrapped: number[] = [];
  for (const [lon] of s.path) { const prev = unwrapped[unwrapped.length - 1]; unwrapped.push(prev === undefined ? lon : prev + ((((lon - prev) % 360) + 540) % 360) - 180); }
  const lat0 = Math.max(-90, Math.min(...lats) - reachDeg), lat1 = Math.min(90, Math.max(...lats) + reachDeg);
  const j0 = Math.max(0, Math.floor(((90 - lat1) / 180) * H)), j1 = Math.min(H - 1, Math.ceil(((90 - lat0) / 180) * H));
  const widest = Math.max(Math.abs(lat0), Math.abs(lat1));
  const lonPad = Math.min(180, reachDeg / Math.max(0.05, Math.cos(Math.min(89, widest) * RAD)));
  const cFrom = Math.floor(((Math.min(...unwrapped) - lonPad + 180) / 360) * W), cTo = Math.min(cFrom + W - 1, Math.ceil(((Math.max(...unwrapped) + lonPad + 180) / 360) * W));
  for (let j = j0; j <= j1; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180, cl = Math.cos(lat * RAD), z = Math.sin(lat * RAD);
    for (let cc = cFrom; cc <= cTo; cc++) {
      const i = ((cc % W) + W) % W, lon = -180 + ((i + 0.5) / W) * 360;
      const d = distanceToPath(cl * Math.cos(lon * RAD), cl * Math.sin(lon * RAD), z, pts, normals);
      if (d >= r) continue;
      const u = d / r;
      visit(j * W + i, (1 - u * u) * (1 - u * u));
    }
  }
}
