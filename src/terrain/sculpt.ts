// Sculpting the terrain (Stage 8, D98). A brush stroke is kept as a stamp: the tool, the path it was
// drawn along (longitude, latitude), its size and strength, a seed for its noise, and when it holds:
// always (the base world) or from a date on (a change in history). The heights a map shows at a moment
// are its base heights (Earth's, or a planet's) with every stamp holding then applied in the order
// drawn, so strokes are as light to store as their paths and every change can be undone.
import type { ElevationGrid } from './grid.ts';
import { simplex3 } from './planet.ts';
import type { Instant } from '../core-time/index.ts';

export type SculptTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'roughen' | 'mountains' | 'valley' | 'crater' | 'island' | 'land' | 'sea' | 'erode';

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
];
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
    out.push({ id: s.id, tool: s.tool, path, radiusKm: Math.min(5000, Number(s.radiusKm)), strength: Math.max(0, Math.min(10000, Number(s.strength))), seed: Number.isFinite(s.seed) ? Number(s.seed) : 1, from });
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
export function applyStamps(base: ElevationGrid, stamps: readonly TerrainStamp[], radiusKm: number): Sculpted {
  if (!stamps.length) return { grid: base, touched: null };
  const { width: W, height: H, step } = base;
  const e = new Float32Array(W * H);
  for (let k = 0; k < e.length; k++) e[k] = base.data[k] * step;
  const touched = new Uint8Array(W * H);
  for (const s of stamps) applyStamp(e, touched, W, H, s, radiusKm);
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
