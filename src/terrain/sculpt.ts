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
//
// Rivers (D220) are kept as the points they were drawn through and their settings; their course, tributaries and water
// are worked out from them with the heights (river-course.ts), so they can be moved and changed later.
import type { ElevationGrid } from './grid.ts';
import { simplex3 } from './planet.ts';
import { applyRiverStamp, riverSpecOf, type RiverSpec, type RiverShape } from './river-course.ts';
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
  { id: 'river', name: 'River', hint: 'Draw a river from its source to its mouth, point by point with the pen or in one stroke with the brush: its water shows at any height, with tributaries where the heights gather water; choose it later to move its points or change it', strength: 60 },
  { id: 'biome', name: 'Paint a biome', hint: 'Paint what grows there, as the satellite look shows it (generated and simulated planets)', strength: 0 },
];
/** Tools whose stroke is an outline (closed by the map). */
export const OUTLINE_TOOLS: readonly SculptTool[] = ['coast-land', 'coast-sea'];
/** Whether a stroke changes the heights (painted biomes change only the land's colours). */
export const changesHeights = (s: Pick<TerrainStamp, 'tool'>) => s.tool !== 'biome';
export const isSculptTool = (v: unknown): v is SculptTool => typeof v === 'string' && SCULPT_TOOLS.some((t) => t.id === v);

/**
 * A brush's tip (D218): how it fades toward its edge and what shape it is. Without one, a stroke is soft and round as
 * before. Its long side is `radiusKm` from the middle, its short side `roundness` of that.
 */
export interface BrushTip {
  /** How far toward its edge it stays at full strength (0: it fades all the way from its middle; 0.95: a hard edge). */
  hardness: number;
  /** Its short side against its long one (1: round). */
  roundness: number;
  /** How its long side is turned: degrees counter-clockwise from east, or from the stroke's own direction when `follow`. */
  angle: number;
  follow: boolean;
  /** How ragged its edge is (0: a clean outline; 1: in and out by half its size). */
  ragged: number;
  /** How grainy it is inside (0: even). */
  texture: number;
}
export const ROUND_TIP: BrushTip = { hardness: 0, roundness: 1, angle: 0, follow: false, ragged: 0, texture: 0 };
/** Tips to start from. */
export const TIP_PRESETS: Array<{ id: string; name: string; tip: BrushTip }> = [
  { id: 'soft', name: 'Soft round', tip: ROUND_TIP },
  { id: 'hard', name: 'Hard round', tip: { ...ROUND_TIP, hardness: 0.75 } },
  { id: 'ragged', name: 'Ragged', tip: { ...ROUND_TIP, hardness: 0.25, ragged: 0.6 } },
  { id: 'rocky', name: 'Rocky', tip: { ...ROUND_TIP, hardness: 0.15, ragged: 0.4, texture: 0.55 } },
  { id: 'flat', name: 'Flat, turned', tip: { ...ROUND_TIP, hardness: 0.3, roundness: 0.3, angle: 45 } },
  { id: 'across', name: 'Across the stroke', tip: { ...ROUND_TIP, hardness: 0.2, roundness: 0.35, angle: 90, follow: true, ragged: 0.25 } },
];
/** A tip as kept, made whole and within bounds. */
export function tipOf(v: unknown): BrushTip {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<BrushTip>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
  return {
    hardness: num(o.hardness, 0, 0.95, 0), roundness: num(o.roundness, 0.1, 1, 1), angle: num(o.angle, -180, 180, 0), follow: o.follow === true,
    ragged: num(o.ragged, 0, 1, 0), texture: num(o.texture, 0, 1, 0),
  };
}
/** Whether a brush paints with a tip (D218): all but outlines, rivers and painted biomes. */
export const tipped = (tool: SculptTool) => !OUTLINE_TOOLS.includes(tool) && tool !== 'river' && tool !== 'biome';
/** Whether a tip is the plain soft round one. */
export const isRoundTip = (t: BrushTip | undefined) => !t || (t.hardness === 0 && t.roundness === 1 && t.ragged === 0 && t.texture === 0);
/** How strong a tip is at a distance from its middle (in its own sizes: 1 at its edge), before any texture. */
export function tipWeight(u: number, hardness: number): number {
  if (u >= 1) return 0;
  const t = u <= hardness ? 0 : (u - hardness) / (1 - hardness);
  return (1 - t * t) * (1 - t * t);
}

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
  /** The brush's tip (D218): kept only when not the plain soft round one. */
  tip?: BrushTip;
  /** A river's settings (D220; its path is then the points it was drawn through). None: a river from before (D169). */
  river?: RiverSpec;
  /** How many times it has been changed since it was made (D220: moved points, other settings). */
  rev?: number;
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
    const tip = s.tip ? tipOf(s.tip) : undefined;
    const river = s.tool === 'river' ? riverSpecOf(s.river) : null;
    const rev = Number.isInteger(s.rev) && s.rev! > 0 ? s.rev! : 0;
    out.push({
      id: s.id, tool: s.tool, path, radiusKm: Math.min(5000, Number(s.radiusKm)), strength: Math.max(0, Math.min(10000, Number(s.strength))), seed: Number.isFinite(s.seed) ? Number(s.seed) : 1, from,
      ...(s.tool === 'biome' ? { biome: s.biome } : {}),
      ...(tip && !isRoundTip(tip) ? { tip } : {}),
      ...(river ? { river } : {}),
      ...(rev ? { rev } : {}),
    });
  }
  return out;
}

/** The stamps holding at a moment: the base world's always, a dated one from its date on. */
export function stampsAt(stamps: readonly TerrainStamp[], t: Instant): TerrainStamp[] {
  return stamps.filter((s) => !s.from || t.day > s.from.day || (t.day === s.from.day && t.ms >= s.from.ms));
}

/** A name for a set of stamps applied to some heights (what the result is kept by). */
export const stampsKey = (baseKey: string, stamps: readonly TerrainStamp[]) => (stamps.length ? `${baseKey}+${stamps.map((s) => (s.rev ? `${s.id}.${s.rev}` : s.id)).join(',')}` : baseKey);

/** The base heights with the stamps applied, in order, the cells they touched (null when none), and the rivers drawn (D220). */
export interface Sculpted {
  grid: ElevationGrid; touched: Uint8Array | null; rivers: RiverShape[];
  /** The heights before the stamps (when any changed them): what sculpting did is the difference, laid over finer heights close in. */
  under?: ElevationGrid;
}

const RAD = Math.PI / 180;

/**
 * Applies stamps to a copy of the heights. `radiusKm` is the planet's (distances along the ground are
 * measured on it). Cells a stamp changed are marked in `touched` (so that on Earth the coastline drawn
 * gives way to the terrain there).
 */
export function applyStamps(base: ElevationGrid, all: readonly TerrainStamp[], radiusKm: number): Sculpted {
  const stamps = all.filter(changesHeights);
  if (!stamps.length) return { grid: base, touched: null, rivers: [] };
  const { width: W, height: H, step } = base;
  const e = new Float32Array(W * H);
  for (let k = 0; k < e.length; k++) e[k] = base.data[k] * step;
  const touched = new Uint8Array(W * H);
  const rivers: RiverShape[] = [];
  for (const s of stamps) {
    if (OUTLINE_TOOLS.includes(s.tool)) applyOutline(e, touched, W, H, s, radiusKm);
    else if (s.tool === 'river') { const r = applyRiverStamp(e, touched, W, H, s, radiusKm); if (r) rivers.push(r); }
    else applyStamp(e, touched, W, H, s, radiusKm);
  }
  const data = new Int16Array(W * H);
  for (let k = 0; k < data.length; k++) data[k] = Math.max(-32768, Math.min(32767, Math.round(e[k] / step)));
  return { grid: { width: W, height: H, step, data }, touched, rivers, under: base };
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

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** East and north along the ground at a place (any two at a pole). */
function frameAt(a: V3): { east: V3; north: V3 } {
  const h = Math.hypot(a[0], a[1]);
  if (h < 1e-9) return { east: [0, 1, 0], north: [-1, 0, 0] };
  const east: V3 = [-a[1] / h, a[0] / h, 0];
  return { east, north: [-a[2] * east[1], a[2] * east[0], a[0] * east[1] - a[1] * east[0]] };
}

/**
 * Where a place lies against a stroke (D218), for tips that are not round and for brushes that follow the stroke's
 * course (the mountain range): how far it is in the tip's own sizes (`u`, 1 at the edge), how far along the stroke its
 * nearest point is and how far to the side of it (radians; positive to the left going along). An elongated tip swept
 * along the stroke reaches as far to the side as the tip's width across the stroke's direction there; past its ends
 * and at its bends, the tip's own oval.
 */
interface StrokeGeo { pts: V3[]; normals: Array<V3 | null>; cum: number[]; seg: number[]; frames: Array<{ east: V3; north: V3 }>; dirs: number[] }
function strokeGeo(pts: V3[], normals: Array<V3 | null>): StrokeGeo {
  const seg: number[] = [], cum: number[] = [0], frames = pts.map(frameAt), dirs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const b = pts[i + 1] ?? null, a = pts[i];
    if (b) seg.push(Math.acos(Math.max(-1, Math.min(1, dot(a, b)))));
    if (i > 0) cum.push(cum[i - 1] + seg[i - 1]);
    // The stroke's direction at each point (on toward the next, or on from the one before at the end), from east.
    const prev = pts[i - 1];
    let t: V3 = frames[i].east;
    if (b) { const c = dot(a, b); t = [b[0] - c * a[0], b[1] - c * a[1], b[2] - c * a[2]]; }
    else if (prev) { const c = dot(a, prev); t = [c * a[0] - prev[0], c * a[1] - prev[1], c * a[2] - prev[2]]; }
    dirs.push(Math.atan2(dot(t, frames[i].north), dot(t, frames[i].east)));
  }
  return { pts, normals, cum, seg, frames, dirs };
}
function strokeMeasure(p: V3, g: StrokeGeo, r: number, tip: BrushTip, out: { u: number; along: number; across: number }): void {
  const A = r, B = r * tip.roundness, fixed = (tip.angle * Math.PI) / 180;
  let best = Infinity, along = 0, across = 0;
  for (let i = 0; i < g.pts.length; i++) {
    const a = g.pts[i], f = g.frames[i], dir = g.dirs[i];
    // Its oval round this point of the stroke.
    const d = Math.acos(Math.max(-1, Math.min(1, dot(p, a))));
    const beta = d > 1e-12 ? Math.atan2(dot(p, f.north), dot(p, f.east)) : 0;
    const major = tip.follow ? dir + fixed : fixed;
    const vm = d * Math.cos(beta - major), vn = d * Math.sin(beta - major);
    const uv = Math.sqrt((vm / A) ** 2 + (vn / B) ** 2);
    if (uv < best) { best = uv; along = g.cum[i]; across = d * Math.sin(beta - dir); }
    const n = g.normals[i];
    if (!n || i + 1 >= g.pts.length) continue;
    // Beside the arc to the next point: as wide as the tip reaches across the stroke's direction.
    const b = g.pts[i + 1];
    const dn = dot(p, n);
    const fx = p[0] - dn * n[0], fy = p[1] - dn * n[1], fz = p[2] - dn * n[2];
    const ca = (a[1] * n[2] - a[2] * n[1]) * fx + (a[2] * n[0] - a[0] * n[2]) * fy + (a[0] * n[1] - a[1] * n[0]) * fz;
    const cb = (n[1] * b[2] - n[2] * b[1]) * fx + (n[2] * b[0] - n[0] * b[2]) * fy + (n[0] * b[1] - n[1] * b[0]) * fz;
    if (ca > 0 || cb > 0) continue;
    const side = Math.asin(Math.max(-1, Math.min(1, dn)));
    const alpha = tip.follow ? -fixed : dir - fixed;
    const reachAcross = Math.sqrt((A * Math.sin(alpha)) ** 2 + (B * Math.cos(alpha)) ** 2);
    const us = Math.abs(side) / reachAcross;
    if (us < best) {
      best = us;
      const fl = Math.hypot(fx, fy, fz) || 1, foot: V3 = [fx / fl, fy / fl, fz / fl];
      along = g.cum[i] + Math.acos(Math.max(-1, Math.min(1, dot(a, foot))));
      across = side;
    }
  }
  out.u = best; out.along = along; out.across = across;
}

function applyStamp(e: Float32Array, touched: Uint8Array, W: number, H: number, s: TerrainStamp, radiusKm: number): void {
  const r = s.radiusKm / radiusKm; // radians
  const tip = s.tip ? tipOf(s.tip) : ROUND_TIP;
  // (A ragged edge reaches out up to half as far again.)
  const reach = (s.tool === 'crater' ? r * 1.6 : r) * (1 + 0.5 * tip.ragged);
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
  // The weight of each reached cell (0 outside the brush), worked out once. A tip that is not round, and the
  // mountain range, measure against the stroke's course (D218); the rest by distance alone, as before.
  const framed = !isRoundTip(tip) || s.tool === 'mountains';
  const geo = framed ? strokeGeo(pts, normals) : null, at = { u: 0, along: 0, across: 0 };
  const edgeNoise = tip.ragged > 0 || tip.texture > 0 ? simplex3(s.seed + 7919) : null;
  const n = (j1 - j0 + 1) * cols, weight = new Float32Array(n), index = new Int32Array(n), dist = new Float32Array(n);
  const along = framed ? new Float32Array(n) : null, across = framed ? new Float32Array(n) : null;
  let m = 0;
  for (let j = j0; j <= j1; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180, cl = Math.cos(lat * RAD), z = Math.sin(lat * RAD);
    for (let c = 0; c < cols; c++) {
      const i = (((i0 + c) % W) + W) % W, lon = -180 + ((i + 0.5) / W) * 360;
      const x = cl * Math.cos(lon * RAD), y = cl * Math.sin(lon * RAD);
      let u: number;
      if (geo) { strokeMeasure([x, y, z], geo, r, tip, at); u = at.u; }
      else { const d = distanceToPath(x, y, z, pts, normals); if (d >= reach) continue; u = d / r; }
      // A ragged edge: the tip's size in and out by up to half, in lumps of its own size and smaller.
      if (edgeNoise && tip.ragged > 0) {
        const f = 1.8 / Math.max(r, 1e-4), g = 4.5 / Math.max(r, 1e-4);
        u /= 1 + tip.ragged * 0.5 * (0.75 * edgeNoise(x * f, y * f, z * f) + 0.25 * edgeNoise(x * g + 31, y * g, z * g));
      }
      if (u >= reach / r) continue;
      let w = tipWeight(u, tip.hardness);
      // Grain: the inside in specks of strength and weakness.
      if (edgeNoise && tip.texture > 0 && w > 0) { const f = 14 / Math.max(r, 1e-4); w *= 1 - tip.texture * (0.5 + 0.5 * edgeNoise(x * f + 77, y * f, z * f)); }
      weight[m] = w;
      dist[m] = u;
      index[m] = j * W + i;
      if (along && across) { along[m] = at.along; across[m] = at.across; }
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
      // A range along the stroke (D218): a massif rising to a main crest that wanders a little either side of the
      // stroke, its peaks and saddles along it, then carved by the water running off it, as ranges are: valleys
      // branching down from the crest, deeper and wider where more water has gathered, the ridges between them left
      // standing. (The noise of the massif is laid in the range's own frame, along and across it.)
      for (let q = 0; q < m; q++) {
        const k = index[q], w = weight[q];
        if (!w) continue;
        const a = along![q] / r, x = across![q] / r;
        const crestAt = 0.16 * noise(a * 0.45 + 40, 0.5, 7.7);
        const crest = Math.exp(-(((x - crestAt) / 0.26) ** 2));
        const peaks = 0.5 + 0.5 * (0.5 + 0.5 * noise(a * 1.1 + 90, 0.3, 2.2));
        const rough = 0.55 * noiseAt(k, 2.2) + 0.3 * noiseAt(k, 5) + 0.15 * noiseAt(k, 11);
        e[k] += strength * (Math.pow(w, 0.9) * peaks * (0.4 + 0.6 * crest) + 0.3 * Math.pow(w, 0.7) * rough);
        mark(k);
      }
      carve(e, W, H, index, weight, m, strength, cellsAcross);
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
 * Valleys carved by running water into the cells of a stroke (D218), for the mountain range: where water would run
 * (each cell to its lowest neighbour, hollows filled first so it always finds a way out of the stroke's box), how
 * much gathers in each cell, and a valley cut by it, deeper where more has gathered (up to 45% of the stroke's
 * strength), widened by a little smoothing of the cuts, twice over so the second follows the first's valleys.
 */
function carve(e: Float32Array, W: number, H: number, index: Int32Array, weight: Float32Array, m: number, strength: number, cellsAcross: number): void {
  if (m < 9) return;
  // The stroke's box (columns as offsets from the first, across the 180th meridian if need be).
  let jMin = H, jMax = 0;
  const base = index[0] % W;
  let cMin = 0, cMax = 0;
  for (let q = 0; q < m; q++) {
    const k = index[q], j = Math.floor(k / W), i = k % W, c = ((((i - base) % W) + W + W / 2) % W) - W / 2;
    if (j < jMin) jMin = j; if (j > jMax) jMax = j;
    if (c < cMin) cMin = c; if (c > cMax) cMax = c;
  }
  const bw = cMax - cMin + 3, bh = jMax - jMin + 3;
  if (bw * bh > 4e6) return;
  const at = (bx: number, by: number) => (jMin - 1 + by) * W + ((((base + cMin - 1 + bx) % W) + W) % W);
  const inGrid = (by: number) => jMin - 1 + by >= 0 && jMin - 1 + by < H;
  const wgt = new Float32Array(bw * bh);
  for (let q = 0; q < m; q++) {
    const k = index[q], j = Math.floor(k / W), i = k % W, c = ((((i - base) % W) + W + W / 2) % W) - W / 2;
    wgt[(j - jMin + 1) * bw + (c - cMin + 1)] = weight[q];
  }
  const N = bw * bh, filled = new Float32Array(N), order = new Int32Array(N), recv = new Int32Array(N), water = new Float32Array(N), cut = new Float32Array(N);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  for (let pass = 0; pass < 3; pass++) {
    // Hollows filled from the box's edge inward (a priority flood), each cell draining to the one it was reached from.
    const heap: number[] = [], seen = new Uint8Array(N);
    const push = (b: number) => {
      heap.push(b);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (filled[heap[p]] <= filled[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) { const l = 2 * c + 1, r2 = l + 1; let s2 = c; if (l < heap.length && filled[heap[l]] < filled[heap[s2]]) s2 = l; if (r2 < heap.length && filled[heap[r2]] < filled[heap[s2]]) s2 = r2; if (s2 === c) break; [heap[s2], heap[c]] = [heap[c], heap[s2]]; c = s2; }
      }
      return top;
    };
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const b = by * bw + bx;
      filled[b] = inGrid(by) ? e[at(bx, by)] : 1e9;
      recv[b] = -1;
      if (bx === 0 || by === 0 || bx === bw - 1 || by === bh - 1) { seen[b] = 1; push(b); }
    }
    let n = 0;
    while (heap.length) {
      const b = pop();
      order[n++] = b;
      const bx = b % bw, by = (b - bx) / bw;
      for (let d = 0; d < 8; d++) {
        const nx = bx + DX[d], ny = by + DY[d];
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const o = ny * bw + nx;
        if (seen[o]) continue;
        seen[o] = 1;
        filled[o] = Math.max(filled[o], filled[b] + 1e-3);
        recv[o] = b;
        push(o);
      }
    }
    // Water gathered: each cell its own, passed down to where it drains, from the highest first.
    water.fill(1);
    for (let t = n - 1; t >= 0; t--) { const b = order[t]; if (recv[b] >= 0) water[recv[b]] += water[b]; }
    // The cut: deeper where more water has gathered (as a share of what a valley as long as the stroke is wide
    // would gather), only inside the stroke.
    const most = Math.max(4, cellsAcross * cellsAcross * 0.25);
    for (let b = 0; b < N; b++) cut[b] = wgt[b] > 0 ? 0.65 * strength * Math.min(1, Math.pow(water[b] / most, 0.5)) * Math.pow(wgt[b], 0.5) : 0;
    // Widened: the cuts smoothed with their neighbours (a valley a few cells across, not a slot one cell wide).
    for (let s2 = 0; s2 < 2; s2++) {
      const next = new Float32Array(N);
      for (let by = 1; by < bh - 1; by++) for (let bx = 1; bx < bw - 1; bx++) {
        const b = by * bw + bx;
        next[b] = Math.max(cut[b] * 0.7, 0.4 * cut[b] + 0.15 * (cut[b - 1] + cut[b + 1] + cut[b - bw] + cut[b + bw]));
      }
      cut.set(next);
    }
    for (let by = 1; by < bh - 1; by++) for (let bx = 1; bx < bw - 1; bx++) {
      const b = by * bw + bx;
      if (cut[b] > 0 && wgt[b] > 0 && inGrid(by)) e[at(bx, by)] -= cut[b] / 3;
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
