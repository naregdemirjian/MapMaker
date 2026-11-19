// The smart brushes (Stage 12, D148): a line drawn roughly is pulled towards nearby features as strongly as the
// weights say, like a magnetic lasso drawn to rivers and ridges instead of the edges in a picture. A corridor is
// built around the stroke, as wide as the search radius; a cost map is worked out inside it (being near a feature
// that attracts makes a place cheap, straying from the stroke makes it dear); the cheapest path from the start of
// the stroke to its end, through any points pinned, is the line; the stretches of it that run along a line
// feature (a river, a coast, a border) then take that feature's exact course.
//
// The geography-aware brush attracts the line to rivers, coasts and lakes, ridges and valleys (from the heights),
// the map's own borders, today's borders and the lines drawn on the map's layers. The strategic brush is the same
// with a military cost model and a side: rivers draw the line to their far bank (the river kept on your side),
// ridges to the crest, rough ground draws it in, and towns, the points placed on the map (objectives,
// installations) and mountain passes within reach are pulled onto your side.
//
// All in screen pixels, at the zoom the stroke is drawn at; pure functions.
import type { Pt } from './stroke.ts';
import { followLines, resample, type FollowLine } from './follow-land.ts';

/** The kinds of line a line can be drawn to. */
export type SmartLineKind = 'river' | 'coast' | 'border' | 'today' | 'line';
export interface SmartFeature { kind: SmartLineKind; pts: Pt[]; closed?: boolean }
/** Points the strategic brush pulls onto your side: towns, points placed on the map, mountain passes (found from the heights). */
export interface SmartPoint { kind: 'town' | 'point' | 'pass'; p: Pt }

/** How strongly each feature draws the line (0: not at all, 1: as strongly as can be). */
export interface SmartWeights {
  rivers: number; coasts: number; ridges: number; valleys: number; borders: number; today: number; lines: number;
  /** The strategic brush only: rough ground, towns, points placed on the map, mountain passes. */
  rough: number; towns: number; points: number; passes: number;
}
export const NO_WEIGHTS: SmartWeights = { rivers: 0, coasts: 0, ridges: 0, valleys: 0, borders: 0, today: 0, lines: 0, rough: 0, towns: 0, points: 0, passes: 0 };

export interface SmartInput {
  /** The stroke as drawn (screen pixels); `closed`: an outline (the brush), else a line. */
  stroke: Pt[];
  closed: boolean;
  /** The search radius: how far (pixels) either side of the stroke the line may go. */
  radius: number;
  features: SmartFeature[];
  /** The height (metres) at a place on screen; null off the map. Ridges, valleys, rough ground and passes need them. */
  heightAt: ((x: number, y: number) => number | null) | null;
  points: SmartPoint[];
  /**
   * The strategic brush: your side, left (1) or right (-1) of the stroke as drawn (as seen on the screen); 0: the
   * geography-aware brush. (An outline as the brush gives it has its inside on the left.)
   */
  side: 0 | 1 | -1;
}

/** What is worked out once for a stroke, whatever the weights. */
export interface SmartPrepared {
  input: SmartInput;
  /** The stroke every couple of pixels, and the length along it to each point. */
  S: Pt[]; cum: Float64Array; len: number;
  /** The grid: its cell size, its corner, its size. */
  g: number; x0: number; y0: number; nx: number; ny: number;
  /** For each cell: the distance to the stroke (Infinity beyond the corridor's reach), the place along it nearest, the side of it. */
  ds: Float32Array; sp: Float32Array; side: Int8Array;
  /** For each kind of line: the distance to the nearest (only near them; Infinity elsewhere). */
  dist: Map<string, Float32Array>;
  /** From the heights (0 to 1): ridges, valleys, rough ground. Null without heights. */
  ridge: Float32Array | null; valley: Float32Array | null; rough: Float32Array | null;
  /** The points within reach (passes found from the heights included). */
  points: SmartPoint[];
  /** The rivers' far banks for the strategic brush (screen pixels). */
  farBanks: FollowLine[];
  /** How sharply a line's pull falls off (pixels). */
  sigma: number;
}

const CELLS_MAX = 450_000;

/** Lines drawn as cells: each segment's cells within `reach` of it, with the distance kept where it is the least. */
function lineDistance(P: SmartPrepared, lines: Array<{ pts: Pt[]; closed?: boolean }>, reach: number, into?: Float32Array): Float32Array {
  const { g, x0, y0, nx, ny } = P;
  const d = into ?? new Float32Array(nx * ny).fill(Infinity);
  for (const l of lines) {
    const n = l.pts.length;
    for (let i = 0; i < (l.closed ? n : n - 1); i++) {
      const a = l.pts[i], b = l.pts[(i + 1) % n];
      const ci0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - x0) / g)), ci1 = Math.min(nx - 1, Math.floor((Math.max(a[0], b[0]) + reach - x0) / g));
      const cj0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - y0) / g)), cj1 = Math.min(ny - 1, Math.floor((Math.max(a[1], b[1]) + reach - y0) / g));
      if (ci0 > ci1 || cj0 > cj1) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      for (let j = cj0; j <= cj1; j++) for (let i2 = ci0; i2 <= ci1; i2++) {
        const c = j * nx + i2;
        if (!(P.ds[c] < Infinity)) continue;
        const x = x0 + (i2 + 0.5) * g, y = y0 + (j + 0.5) * g;
        const k = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
        const dd = Math.hypot(x - a[0] - k * dx, y - a[1] - k * dy);
        if (dd < d[c]) d[c] = dd;
      }
    }
  }
  return d;
}

/** A box blur of `v` (weighted by `w`) over a square of `r` cells each way. */
function blur(v: Float32Array, w: Float32Array, nx: number, ny: number, r: number): Float32Array {
  const sv = new Float32Array(nx * ny), sw = new Float32Array(nx * ny);
  // Rows, then columns, as running sums.
  for (let j = 0; j < ny; j++) {
    let a = 0, b = 0;
    const row = j * nx;
    for (let i = -r; i < nx + r; i++) {
      const ia = i + r, ib = i - r - 1;
      if (ia < nx && ia >= 0) { a += v[row + ia] * w[row + ia]; b += w[row + ia]; }
      if (ib >= 0 && ib < nx) { a -= v[row + ib] * w[row + ib]; b -= w[row + ib]; }
      if (i >= 0 && i < nx) { sv[row + i] = a; sw[row + i] = b; }
    }
  }
  const out = new Float32Array(nx * ny), ow = new Float32Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    let a = 0, b = 0;
    for (let j = -r; j < ny + r; j++) {
      const ja = j + r, jb = j - r - 1;
      if (ja < ny && ja >= 0) { a += sv[ja * nx + i]; b += sw[ja * nx + i]; }
      if (jb >= 0 && jb < ny) { a -= sv[jb * nx + i]; b -= sw[jb * nx + i]; }
      if (j >= 0 && j < ny) { out[j * nx + i] = a; ow[j * nx + i] = b; }
    }
  }
  for (let c = 0; c < out.length; c++) out[c] = ow[c] > 1e-9 ? out[c] / ow[c] : 0;
  return out;
}

/**
 * Works out, for a stroke, everything that does not depend on the weights: the corridor, the distance to each
 * kind of line in it, ridges, valleys and rough ground from the heights, the points within reach (mountain
 * passes found among them).
 */
export function prepareSmart(input: SmartInput): SmartPrepared | null {
  const R = Math.max(2, input.radius);
  const raw = input.stroke;
  if (raw.length < 2) return null;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of raw) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  // (The cell size: a tenth of the radius, at least a pixel, coarser for very long strokes; the grid holds the
  // corridor and, with heights, the ground round it that ridges and valleys are judged against.)
  const est = 2 * R + 8;
  const g = Math.max(1, R / 10, Math.sqrt(((bx1 - bx0 + 2 * est) * (by1 - by0 + 2 * est)) / CELLS_MAX));
  const rc = Math.max(2, Math.round(R / (2 * g)));
  const reach = R + 4 * g, reachAll = reach + (input.heightAt ? rc * g : 0);
  const pad = reachAll + 2 * g + 2;
  const w = bx1 - bx0 + 2 * pad, h = by1 - by0 + 2 * pad;
  const x0 = bx0 - pad, y0 = by0 - pad, nx = Math.ceil(w / g), ny = Math.ceil(h / g);
  const S = resample(raw, Math.max(1.5, g), input.closed);
  if (input.closed) S.push(S[0]);
  const cum = new Float64Array(S.length);
  for (let i = 1; i < S.length; i++) cum[i] = cum[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
  const len = cum[S.length - 1];
  if (!(len > 0)) return null;
  const N = nx * ny;
  const ds = new Float32Array(N).fill(Infinity), sp = new Float32Array(N), side = new Int8Array(N);
  // The corridor: each cell's distance to the stroke, the place along it nearest, and its side.
  for (let s = 0; s + 1 < S.length; s++) {
    const a = S[s], b = S[s + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, ll = Math.sqrt(l2);
    if (!(ll > 0)) continue;
    const ci0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reachAll - x0) / g)), ci1 = Math.min(nx - 1, Math.floor((Math.max(a[0], b[0]) + reachAll - x0) / g));
    const cj0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reachAll - y0) / g)), cj1 = Math.min(ny - 1, Math.floor((Math.max(a[1], b[1]) + reachAll - y0) / g));
    for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) {
      const x = x0 + (i + 0.5) * g, y = y0 + (j + 0.5) * g;
      const k = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
      const d = Math.hypot(x - a[0] - k * dx, y - a[1] - k * dy);
      const c = j * nx + i;
      if (d < ds[c]) {
        ds[c] = d; sp[c] = cum[s] + k * ll;
        // (Left as seen on screen, y down: the normal (dy, -dx).)
        side[c] = (x - a[0]) * dy - (y - a[1]) * dx >= 0 ? 1 : -1;
      }
    }
  }
  // (Heights are read out to the wider reach; everything else keeps to the corridor.)
  const dsAll = input.heightAt ? Float32Array.from(ds) : ds;
  for (let c = 0; c < N; c++) if (ds[c] > reach) ds[c] = Infinity;
  const sigma = Math.max(1.5, 1.3 * g);
  const P: SmartPrepared = { input, S, cum, len, g, x0, y0, nx, ny, ds, sp, side, dist: new Map(), ridge: null, valley: null, rough: null, points: [], farBanks: [], sigma };
  // The lines, each kind apart.
  for (const kind of ['river', 'coast', 'border', 'today', 'line'] as const) {
    const lines = input.features.filter((f) => f.kind === kind);
    if (lines.length) P.dist.set(kind, lineDistance(P, lines, 4 * sigma + 2 * g));
  }
  // The strategic brush: the rivers' far banks, a little to the enemy's side of each (the river kept on yours).
  if (input.side !== 0) {
    const off = Math.max(2, 1.5 * g);
    for (const f of input.features) {
      if (f.kind !== 'river') continue;
      const bank: Pt[] = f.pts.map((p) => {
        const c = cellOf(P, p[0], p[1]);
        if (c < 0 || !(ds[c] < Infinity)) return p;
        const [tx, ty] = tangentAt(P, sp[c]);
        // Your side is (side × the left normal (ty, -tx)); the far bank is the other way.
        return [p[0] - input.side * ty * off, p[1] + input.side * tx * off];
      });
      P.farBanks.push({ pts: bank, kind: 'river', closed: f.closed });
    }
    if (P.farBanks.length) P.dist.set('far', lineDistance(P, P.farBanks, 4 * sigma + 2 * g));
  }
  // Ridges, valleys and rough ground: where the ground stands above or below the ground round it (within half the
  // radius), against how much it varies there.
  if (input.heightAt) {
    const hgt = new Float32Array(N), ok = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      // (Heights wanted within the corridor and round it, for the averages.)
      if (!(dsAll[c] <= reachAll)) continue;
      const v = input.heightAt(x0 + (i + 0.5) * g, y0 + (j + 0.5) * g);
      if (v === null || !Number.isFinite(v)) continue;
      hgt[c] = v; ok[c] = 1;
    }
    const mean = blur(hgt, ok, nx, ny, rc);
    const sq = new Float32Array(N);
    for (let c = 0; c < N; c++) sq[c] = hgt[c] * hgt[c];
    const mean2 = blur(sq, ok, nx, ny, rc);
    const ridge = new Float32Array(N), valley = new Float32Array(N), rough = new Float32Array(N);
    for (let c = 0; c < N; c++) {
      if (!ok[c] || !(ds[c] < Infinity)) continue;
      const sd = Math.sqrt(Math.max(0, mean2[c] - mean[c] * mean[c]));
      const tpi = hgt[c] - mean[c], scale = Math.max(40, 1.2 * sd);
      ridge[c] = Math.max(0, Math.min(1, tpi / scale));
      valley[c] = Math.max(0, Math.min(1, -tpi / scale));
      rough[c] = Math.max(0, Math.min(1, sd / 300));
    }
    P.ridge = ridge; P.valley = valley; P.rough = rough;
    if (input.side !== 0) P.points.push(...passesOf(P, hgt, ok, Math.max(2, Math.round(rc / 2))));
  }
  for (const q of input.points) { const c = cellOf(P, q.p[0], q.p[1]); if (c >= 0 && ds[c] < Infinity) P.points.push(q); }
  return P;
}

/** The cell at a place on screen (-1 off the grid). */
function cellOf(P: SmartPrepared, x: number, y: number): number {
  const i = Math.floor((x - P.x0) / P.g), j = Math.floor((y - P.y0) / P.g);
  return i >= 0 && j >= 0 && i < P.nx && j < P.ny ? j * P.nx + i : -1;
}

/** The stroke's direction (unit) at a place along it. */
function tangentAt(P: SmartPrepared, s: number): [number, number] {
  let lo = 0, hi = P.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.cum[mid] <= s) lo = mid; else hi = mid; }
  const a = P.S[lo], b = P.S[hi], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

/** The place along the stroke (pixels from its start) nearest a point on screen, and how far it is. */
function nearestOnStroke(P: SmartPrepared, p: Pt): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < P.S.length; i++) {
    const a = P.S[i], b = P.S[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const d = Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
    if (d < best.d) best = { s: P.cum[i] + k * Math.sqrt(l2), d };
  }
  return best;
}

/** The point at a place along the stroke. */
function strokeAt(P: SmartPrepared, s: number): Pt {
  if (P.input.closed) s = ((s % P.len) + P.len) % P.len; else s = Math.max(0, Math.min(P.len, s));
  let lo = 0, hi = P.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.cum[mid] <= s) lo = mid; else hi = mid; }
  const seg = P.cum[hi] - P.cum[lo], k = seg > 0 ? (s - P.cum[lo]) / seg : 0;
  const a = P.S[lo], b = P.S[hi];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/**
 * Mountain passes within the corridor: places on high ground where, going round them, the ground is higher twice
 * and lower twice (a saddle), by at least 60 m each way; the most marked in each neighbourhood.
 */
function passesOf(P: SmartPrepared, hgt: Float32Array, ok: Float32Array, r: number): SmartPoint[] {
  const { nx, ny } = P;
  const score = new Float32Array(nx * ny);
  const ring: Array<[number, number]> = [[r, 0], [r, r], [0, r], [-r, r], [-r, 0], [-r, -r], [0, -r], [r, -r]];
  for (let j = r; j < ny - r; j++) for (let i = r; i < nx - r; i++) {
    const c = j * nx + i;
    if (!ok[c] || !(P.ds[c] < Infinity)) continue;
    const h0 = hgt[c];
    let changes = 0, up = 0, down = 0, last = 0;
    const signs: number[] = [];
    for (const [di, dj] of ring) {
      const q = (j + dj) * nx + i + di;
      if (!ok[q]) { signs.length = 0; break; }
      const dh = hgt[q] - h0;
      signs.push(dh > 0 ? 1 : -1);
      if (dh > 0) up = Math.max(up, dh); else down = Math.max(down, -dh);
    }
    if (signs.length !== 8) continue;
    last = signs[7];
    for (const sgn of signs) { if (sgn !== last) changes++; last = sgn; }
    if (changes >= 4 && up >= 60 && down >= 60) score[c] = Math.min(up, down);
  }
  const out: SmartPoint[] = [];
  const win = 2 * r;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!(score[c] > 0)) continue;
    let best = true;
    for (let dj = -win; dj <= win && best; dj++) for (let di = -win; di <= win; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const q = jj * nx + ii;
      if (score[q] > score[c] || (score[q] === score[c] && q < c)) { best = false; break; }
    }
    if (best) out.push({ kind: 'pass', p: [P.x0 + (i + 0.5) * P.g, P.y0 + (j + 0.5) * P.g] });
  }
  return out;
}

/** A binary heap of cells by cost, cheapest first. */
class Heap {
  private k: Float64Array; private v: Int32Array; size = 0;
  constructor(n: number) { this.k = new Float64Array(n); this.v = new Int32Array(n); }
  push(key: number, item: number): void {
    if (this.size === this.k.length) { const k = new Float64Array(this.size * 2), v = new Int32Array(this.size * 2); k.set(this.k); v.set(this.v); this.k = k; this.v = v; }
    let i = this.size++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = key; this.v[i] = item;
  }
  pop(): number {
    const top = this.v[0], key = this.k[--this.size], item = this.v[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= this.size) break;
      const c = r < this.size && this.k[r] < this.k[l] ? r : l;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = key; this.v[i] = item;
    return top;
  }
  topKey(): number { return this.k[0]; }
}

/** What following the weights gave: the line, which of its points lie on a line feature, and the stretches that did. */
export interface SmartResult { pts: Pt[]; along: Uint8Array; followed: number }

/**
 * The line for a set of weights, through the points pinned (in the order they come along the stroke; each moved
 * onto the corridor's middle if need be): the cheapest path along the corridor, its stretches along a line
 * feature given that feature's exact course, the rest smoothed. With every weight 0, the stroke as drawn.
 */
export function smartLine(P: SmartPrepared, wts: SmartWeights, pins: Pt[] = []): SmartResult {
  const { input, g, nx, ny, ds, sp, x0, y0 } = P;
  const R = Math.max(2, input.radius);
  const N = nx * ny;
  const strategic = input.side !== 0;
  const any = (Object.keys(wts) as Array<keyof SmartWeights>).some((k) => wts[k] > 0 && (strategic || !['rough', 'towns', 'points', 'passes'].includes(k)));
  if (!any) return { pts: input.stroke, along: new Uint8Array(input.stroke.length), followed: 0 };
  // The pull of each place (0 to 1): the strongest of the features near it.
  const pull = new Float32Array(N);
  const near = (d: Float32Array | undefined, w: number) => {
    if (!d || !(w > 0)) return;
    const s2 = P.sigma * P.sigma;
    for (let c = 0; c < N; c++) { const dd = d[c]; if (dd < 4 * P.sigma) { const v = w * Math.exp(-(dd * dd) / s2); if (v > pull[c]) pull[c] = v; } }
  };
  near(P.dist.get(strategic ? 'far' : 'river'), wts.rivers);
  near(P.dist.get('coast'), wts.coasts);
  near(P.dist.get('border'), wts.borders);
  near(P.dist.get('today'), wts.today);
  near(P.dist.get('line'), wts.lines);
  const field = (f: Float32Array | null, w: number) => { if (f && w > 0) for (let c = 0; c < N; c++) { const v = w * f[c]; if (v > pull[c]) pull[c] = v; } };
  field(P.ridge, wts.ridges);
  if (!strategic) field(P.valley, wts.valleys);
  if (strategic) field(P.rough, wts.rough);
  // The cost of each place: cheaper the more it is pulled, dearer the further from the stroke.
  const cost = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const d = ds[c];
    cost[c] = d < Infinity && d <= R ? (1 - 0.95 * Math.min(1, pull[c])) * (1 + (d / R) * (d / R)) : Infinity;
  }
  // The strategic brush: each point to pull onto your side is walled off from the line on that side (a disc round
  // it, and a wall from it to the corridor's edge on your side), as strongly as its weight; the line goes round it.
  if (strategic) {
    const weightOf = { town: wts.towns, point: wts.points, pass: wts.passes } as const;
    for (const q of P.points) {
      const w = weightOf[q.kind];
      if (!(w > 0)) continue;
      const near0 = nearestOnStroke(P, q.p);
      const [tx, ty] = tangentAt(P, near0.s);
      const ux = input.side * ty, uy = -input.side * tx;
      const wall = 400 * w, rDisc = Math.max(3, 2 * g);
      const steps = Math.ceil((R + near0.d + 2 * g) / (0.5 * g));
      for (let k = 0; k <= steps; k++) {
        const x = q.p[0] + ux * k * 0.5 * g, y = q.p[1] + uy * k * 0.5 * g;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const c = cellOf(P, x + di * 0.5 * g, y + dj * 0.5 * g);
          if (c >= 0 && cost[c] < Infinity) cost[c] += wall;
        }
      }
      const rc = Math.ceil(rDisc / g);
      const [ci, cj] = [Math.floor((q.p[0] - x0) / g), Math.floor((q.p[1] - y0) / g)];
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny || di * di + dj * dj > rc * rc) continue;
        const c = j * nx + i;
        if (cost[c] < Infinity) cost[c] += wall;
      }
    }
  }
  // Where the line must pass: its ends (an outline: two places on it, where nothing pulls), and the pins.
  const stops: Array<{ s: number; p: Pt }> = pins.map((p) => ({ s: nearestOnStroke(P, p).s, p })).sort((a, b) => a.s - b.s);
  let legs: Array<{ a: { s: number; p: Pt }; b: { s: number; p: Pt } }> = [];
  if (!input.closed) {
    const all = [{ s: 0, p: input.stroke[0] }, ...stops.filter((q) => q.s > 0 && q.s < P.len), { s: P.len, p: input.stroke[input.stroke.length - 1] }];
    for (let i = 0; i + 1 < all.length; i++) legs.push({ a: all[i], b: all[i + 1] });
  } else {
    let anchors = stops;
    if (anchors.length < 2) {
      // (Where the pull is least, and the place furthest round from there where it is least too.)
      const quiet = (s: number) => { const c = cellOf(P, ...strokeAt(P, s)); return c >= 0 ? pull[c] : 0; };
      const first = anchors.length ? anchors[0].s : (() => { let best = 0, bv = Infinity; for (let s = 0; s < P.len; s += P.len / 64) { const v = quiet(s); if (v < bv) { bv = v; best = s; } } return best; })();
      let second = first + P.len / 2, sv = Infinity;
      for (let s = first + P.len / 3; s <= first + (2 * P.len) / 3; s += P.len / 64) { const v = quiet(s); if (v < sv) { sv = v; second = s; } }
      // (Each anchor where it costs least across the corridor there: on the shore being followed, say, not beside it.)
      const across = (s0: number): Pt => {
        let best = -1;
        for (let c = 0; c < N; c++) {
          if (!(cost[c] < Infinity)) continue;
          let d = Math.abs(sp[c] - s0);
          if (input.closed) d = Math.min(d, P.len - d);
          if (d > g) continue;
          if (best < 0 || cost[c] < cost[best] - 1e-6 || (Math.abs(cost[c] - cost[best]) <= 1e-6 && ds[c] < ds[best])) best = c;
        }
        if (best < 0) return strokeAt(P, s0);
        const i = best % nx, j = (best - i) / nx;
        return [x0 + (i + 0.5) * g, y0 + (j + 0.5) * g];
      };
      const pts = anchors.length ? [anchors[0]] : [{ s: first, p: across(first) }];
      pts.push({ s: second % P.len, p: across(second % P.len) });
      anchors = pts.sort((a, b) => a.s - b.s);
    }
    for (let i = 0; i < anchors.length; i++) legs.push({ a: anchors[i], b: i + 1 < anchors.length ? anchors[i + 1] : { s: anchors[0].s + P.len, p: anchors[0].p } });
  }
  legs = legs.filter((l) => l.b.s - l.a.s > 1e-9);
  // Each leg: the cheapest path from its start to its end among the cells near its own stretch of the stroke.
  const paths = legs.map((leg) => cheapest(P, cost, leg.a, leg.b, R) ?? [leg.a.p, ...strokeBetween(P, leg.a.s, leg.b.s), leg.b.p]);
  // Tidied: straight runs kept straight; the stretches along a line feature given its exact course; the rest
  // rounded a little. The ends of a line and the points pinned stay where they are (each leg tidied apart);
  // an outline without pins is tidied whole, so that following a shore all round has no seam.
  const targets: FollowLine[] = [];
  const lineWeight: Record<SmartLineKind, number> = { river: wts.rivers, coast: wts.coasts, border: wts.borders, today: wts.today, line: wts.lines };
  for (const f of strategic ? input.features.filter((x) => x.kind !== 'river') : input.features) if (lineWeight[f.kind] > 0) targets.push({ pts: f.pts, kind: f.kind === 'river' ? 'river' : f.kind === 'coast' ? 'coast' : 'border', closed: f.closed });
  if (strategic && wts.rivers > 0) targets.push(...P.farBanks);
  const tol = Math.max(2.5, 1.6 * P.sigma + g);
  let followed = 0;
  const tidy = (path: Pt[], closed: boolean): { pts: Pt[]; along: Uint8Array } => {
    let pts = simplifyPath(path, 0.6 * g, closed);
    let along: Uint8Array = new Uint8Array(pts.length);
    if (targets.length) {
      const f = followLines(pts, closed, targets, { tolerance: tol, spacing: Math.max(1, g / 2), minRun: Math.max(4 * tol, 12) });
      if (f.followed) {
        pts = f.pts; along = f.fixed; followed += f.followed;
        // (A line's ends stay where they are: joined to the course followed if it took them.)
        if (!closed) {
          const a = path[0], b = path[path.length - 1];
          if (pts[0][0] !== a[0] || pts[0][1] !== a[1]) { pts = [a, ...pts]; along = Uint8Array.from([0, ...along]); }
          const e = pts[pts.length - 1];
          if (e[0] !== b[0] || e[1] !== b[1]) { pts = [...pts, b]; along = Uint8Array.from([...along, 0]); }
        }
      }
    }
    return roundUnfixed(pts, along, closed);
  };
  if (input.closed && !stops.length) {
    const loop: Pt[] = [];
    for (const p of paths) loop.push(...p.slice(0, -1));
    const t = tidy(loop, true);
    return { pts: t.pts, along: t.along, followed };
  }
  const pts: Pt[] = [], along: number[] = [];
  for (const p of paths) {
    const t = tidy(p, false);
    const from = pts.length ? 1 : 0;
    for (let i = from; i < t.pts.length; i++) { pts.push(t.pts[i]); along.push(t.along[i]); }
  }
  // (An outline's last leg ends where its first begins.)
  if (input.closed && pts.length > 1) { pts.pop(); along.pop(); }
  return { pts, along: Uint8Array.from(along), followed };
}

/** The stroke's own points between two places along it (for a leg no path was found for). */
function strokeBetween(P: SmartPrepared, a: number, b: number): Pt[] {
  const out: Pt[] = [];
  for (let s = a; s < b; s += Math.max(1, P.g)) out.push(strokeAt(P, s));
  return out;
}

/**
 * The cheapest path (8 neighbours) from one place to another among the cells of the corridor near the stroke
 * between them (by the place along the stroke nearest each cell, with the radius to spare). Null if none.
 */
function cheapest(P: SmartPrepared, cost: Float32Array, a: { s: number; p: Pt }, b: { s: number; p: Pt }, R: number): Pt[] | null {
  const { nx, ny, g, sp, len } = P;
  const closed = P.input.closed;
  const lo = a.s - R - 2 * g, hi = b.s + R + 2 * g;
  const inLeg = (c: number) => {
    let s = sp[c];
    if (closed) { while (s < lo) s += len; while (s > hi) s -= len; if (s < lo) return false; }
    return s >= lo && s <= hi;
  };
  const start = cellOf(P, a.p[0], a.p[1]), goal = cellOf(P, b.p[0], b.p[1]);
  if (start < 0 || goal < 0) return null;
  const N = nx * ny;
  const dist = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const heap = new Heap(1024);
  // (The start and end cells may lie a little off the corridor's cheap middle: always allowed.)
  const costOf = (c: number) => (c === start || c === goal ? Math.min(cost[c], 1) : cost[c]);
  dist[start] = 0;
  heap.push(0, start);
  const D = Math.SQRT2;
  while (heap.size) {
    const c = heap.pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === goal) break;
    const i = c % nx, j = (c - i) / nx, cc = costOf(c);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const q = jj * nx + ii;
      if (done[q]) continue;
      const cq = costOf(q);
      if (!(cq < Infinity) || (q !== goal && !inLeg(q))) continue;
      const nd = dist[c] + (di && dj ? D : 1) * g * 0.5 * (cc + cq);
      if (nd < dist[q]) { dist[q] = nd; from[q] = c; heap.push(nd, q); }
    }
  }
  if (!(dist[goal] < Infinity)) return null;
  const cells: number[] = [];
  for (let c = goal; c >= 0; c = from[c]) { cells.push(c); if (c === start) break; }
  cells.reverse();
  const pts: Pt[] = cells.map((c) => { const i = c % nx, j = (c - i) / nx; return [P.x0 + (i + 0.5) * g, P.y0 + (j + 0.5) * g] as Pt; });
  pts[0] = a.p; pts[pts.length - 1] = b.p;
  return pts;
}

/** Douglas–Peucker on an open or closed path. */
function simplifyPath(pts: Pt[], tol: number, closed: boolean): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bd = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b], l = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i++) {
      const d = l < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / l;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  if (closed && out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return out;
}

/** Corners cut once where the line is not on a feature (the points on one, and the ends of a line, stay). */
function roundUnfixed(pts: Pt[], along: Uint8Array, closed: boolean): { pts: Pt[]; along: Uint8Array } {
  const n = pts.length;
  if (n < 3) return { pts, along };
  const out: Pt[] = [], fl: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const end = !closed && (i === 0 || i === n - 1);
    if (along[i] || end) { out.push(p); fl.push(along[i]); continue; }
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    out.push([0.75 * p[0] + 0.25 * a[0], 0.75 * p[1] + 0.25 * a[1]], [0.75 * p[0] + 0.25 * b[0], 0.75 * p[1] + 0.25 * b[1]]);
    fl.push(0, 0);
  }
  return { pts: out, along: Uint8Array.from(fl) };
}
