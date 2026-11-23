// Rivers drawn as guidance (D220). A river is kept as the few points it was drawn through (clicked with the pen, or a
// brush stroke simplified to where it turns) and its settings; its course is worked out from them whenever the heights
// are: smoothly through the points, or along the valleys and downhill between them; winding at every scale as much as
// asked; with tributaries where the water of the heights around gathers; wider downstream. Its water is drawn at any
// height (not only where the ground is below the sea), and it may cut its valley into the ground.
import { simplex3 } from './planet.ts';

export interface RiverSpec {
  /** How wide it is drawn at its mouth: a multiple of the usual line (1). */
  width: number;
  /** How much it winds: 0 smoothly through its points, 1 much, at every scale. */
  meander: number;
  /** How many tributaries the heights around it give it: 0 none, 1 many. */
  tributaries: number;
  /** Along the valleys and downhill between its points, instead of straight on between them. */
  follow: boolean;
  /** How it was drawn: points clicked with the pen, or a brush stroke (simplified to where it turns). */
  drawn: 'pen' | 'brush';
}

export const DEFAULT_RIVER: RiverSpec = { width: 1, meander: 0.5, tributaries: 0.4, follow: true, drawn: 'brush' };
/** A river drawn before rivers kept their settings (D169): its stroke followed as drawn, no tributaries. */
export const LEGACY_RIVER: RiverSpec = { width: 1, meander: 0, tributaries: 0, follow: false, drawn: 'brush' };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Number(v))) : d);

/** A river's settings as stored, checked (null when there are none: a river from before D220). */
export function riverSpecOf(v: unknown): RiverSpec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<RiverSpec>, d = DEFAULT_RIVER;
  return {
    width: clamp(o.width, 0.2, 6, d.width), meander: clamp(o.meander, 0, 1, d.meander), tributaries: clamp(o.tributaries, 0, 1, d.tributaries),
    follow: typeof o.follow === 'boolean' ? o.follow : d.follow, drawn: o.drawn === 'pen' ? 'pen' : 'brush',
  };
}

/** A tributary: from its source to where it joins the river (or a greater tributary), with its width at each point. */
export interface RiverBranch { line: Array<[number, number]>; widths: number[] }

/**
 * A river as worked out: its course from source to mouth and the width drawn at each point (multiples of the usual line),
 * and its tributaries. Longitudes run on from the source's (past ±180° where a river crosses the 180th meridian).
 */
export interface RiverShape { id: string; course: Array<[number, number]>; widths: number[]; branches: RiverBranch[] }

/** What a river stamp needs (see TerrainStamp). */
export interface RiverStampLike {
  id: string;
  /** Its points, from its source to its mouth ([longitude, latitude]). */
  path: Array<[number, number]>;
  /** How wide the valley it cuts is (km, either side) and how deep (m; 0: the ground as it is). */
  radiusKm: number;
  strength: number;
  seed: number;
  river?: RiverSpec;
}

const RAD = Math.PI / 180;

/** A W × H grid of heights (metres, rows from the north-west corner) on a planet of radius R (km). */
class Cells {
  readonly e: Float32Array; readonly W: number; readonly H: number; readonly R: number;
  readonly kmPerDeg: number; readonly cellKm: number;
  constructor(e: Float32Array, W: number, H: number, R: number) {
    this.e = e; this.W = W; this.H = H; this.R = R;
    this.kmPerDeg = R * RAD;
    this.cellKm = (180 / H) * this.kmPerDeg;
  }
  row(lat: number) { return Math.max(0, Math.min(this.H - 1, Math.floor(((90 - lat) / 180) * this.H))); }
  col(lon: number) { return ((Math.floor(((lon + 180) / 360) * this.W) % this.W) + this.W) % this.W; }
  /** The height at a place, between the cells' middles. */
  at(lon: number, lat: number): number {
    const { W, H, e } = this;
    const fx = ((lon + 180) / 360) * W - 0.5, fy = Math.max(0, Math.min(H - 1, ((90 - lat) / 180) * H - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, y1 = Math.min(H - 1, y0 + 1);
    const c0 = ((x0 % W) + W) % W, c1 = (c0 + 1) % W;
    const a = e[y0 * W + c0], b = e[y0 * W + c1], c = e[y1 * W + c0], d = e[y1 * W + c1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  /** Kilometres between two places close together (the ground taken as flat there). */
  km(a: [number, number], b: [number, number]): number {
    const k = Math.cos(((a[1] + b[1]) / 2) * RAD);
    return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * this.kmPerDeg;
  }
}

/** A longitude brought within half a turn of another (so a line across the 180th meridian runs on). */
const near = (lon: number, to: number) => to + ((((lon - to) % 360) + 540) % 360) - 180;
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Total length (km) of a line. */
function lengthOf(g: Cells, line: Array<[number, number]>): number {
  let L = 0;
  for (let i = 1; i < line.length; i++) L += g.km(line[i - 1], line[i]);
  return L;
}

/** The line again with a point every `ds` km (its ends kept). */
function resample(g: Cells, line: Array<[number, number]>, ds: number): Array<[number, number]> {
  if (line.length < 2) return line.slice();
  const out: Array<[number, number]> = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], d = g.km(a, b);
    if (d <= 0) continue;
    let t = ds - carry;
    while (t <= d) { const f = t / d; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); t += ds; }
    carry = d - (t - ds);
  }
  const last = line[line.length - 1], end = out[out.length - 1];
  if (g.km(end, last) > ds * 0.25) out.push(last); else out[out.length - 1] = last;
  return out;
}

/** A smooth curve through the points (centripetal Catmull-Rom), a point every `ds` km. */
function spline(g: Cells, pts: Array<[number, number]>, ds: number): Array<[number, number]> {
  if (pts.length < 3) return resample(g, pts, ds);
  const k = Math.cos((pts.reduce((a, p) => a + p[1], 0) / pts.length) * RAD);
  const P = pts.map(([x, y]) => [x * k, y] as [number, number]);
  const ext = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]] as [number, number], ...P, [2 * P[P.length - 1][0] - P[P.length - 2][0], 2 * P[P.length - 1][1] - P[P.length - 2][1]] as [number, number]];
  const out: Array<[number, number]> = [];
  for (let i = 1; i + 2 < ext.length; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    const tj = (a: [number, number], b: [number, number]) => Math.max(1e-9, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    const n = Math.max(2, Math.ceil(g.km(pts[i - 1], pts[i]) / ds));
    for (let s = i === 1 ? 0 : 1; s <= n; s++) {
      const t = t1 + ((t2 - t1) * s) / n;
      const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
        const f = (t - ta) / (tb - ta || 1e-9);
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      };
      const A1 = lerp(p0, p1, 0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, 0, t2), B2 = lerp(A2, A3, t1, t3);
      const C = lerp(B1, B2, t1, t2);
      out.push([C[0] / k, Math.max(-89.9, Math.min(89.9, C[1]))]);
    }
  }
  return out;
}

/** A binary heap of items by a float key, smallest first. */
class Heap {
  private keys: Float64Array; private items: Int32Array; size = 0;
  constructor(capacity: number) { this.keys = new Float64Array(capacity); this.items = new Int32Array(capacity); }
  push(key: number, item: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2), it = new Int32Array(this.size * 2);
      k.set(this.keys); it.set(this.items); this.keys = k; this.items = it;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p]; this.items[i] = this.items[p]; i = p;
    }
    this.keys[i] = key; this.items[i] = item;
  }
  topKey(): number { return this.keys[0]; }
  pop(): number {
    const top = this.items[0], key = this.keys[--this.size], item = this.items[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= this.size) break;
      const c = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c]; this.items[i] = this.items[c]; i = c;
    }
    this.keys[i] = key; this.items[i] = item;
    return top;
  }
}

/**
 * A box of cells around some places: columns counted from `c0` (across the 180th meridian if need be), rows from `j0`.
 * Places are given with longitudes running on from one another.
 */
class Box {
  readonly g: Cells; readonly c0: number; readonly j0: number; readonly bw: number; readonly bh: number;
  constructor(g: Cells, places: Array<[number, number]>, pad: number) {
    this.g = g;
    let cMin = Infinity, cMax = -Infinity, jMin = Infinity, jMax = -Infinity;
    for (const [x, y] of places) {
      const c = Math.floor(((x + 180) / 360) * g.W), j = g.row(y);
      cMin = Math.min(cMin, c); cMax = Math.max(cMax, c); jMin = Math.min(jMin, j); jMax = Math.max(jMax, j);
    }
    this.c0 = cMin - pad; this.j0 = Math.max(0, jMin - pad);
    this.bw = Math.min(g.W, cMax + pad - this.c0 + 1); this.bh = Math.min(g.H, jMax + pad + 1) - this.j0;
  }
  get size() { return this.bw * this.bh; }
  /** The box's cell holding a place (−1 outside it). */
  of(x: number, y: number): number {
    const c = Math.floor(((x + 180) / 360) * this.g.W) - this.c0, j = this.g.row(y) - this.j0;
    return c >= 0 && c < this.bw && j >= 0 && j < this.bh ? j * this.bw + c : -1;
  }
  /** The grid's own index of a box cell. */
  cell(b: number): number { const c = b % this.bw, j = Math.floor(b / this.bw); return (this.j0 + j) * this.g.W + ((((this.c0 + c) % this.g.W) + this.g.W) % this.g.W); }
  /** The middle of a box cell (its longitude near the box's own). */
  middle(b: number): [number, number] {
    const c = b % this.bw, j = Math.floor(b / this.bw);
    return [((this.c0 + c + 0.5) / this.g.W) * 360 - 180, 90 - ((this.j0 + j + 0.5) / this.g.H) * 180];
  }
  height(b: number): number { return this.g.e[this.cell(b)]; }
  /** Kilometres from a box cell to its neighbour (dc, dj). */
  step(b: number, dc: number, dj: number): number {
    const lat = 90 - ((this.j0 + Math.floor(b / this.bw) + 0.5) / this.g.H) * 180;
    const ew = (360 / this.g.W) * this.g.kmPerDeg * Math.max(0.02, Math.cos(lat * RAD)), ns = this.g.cellKm;
    return Math.hypot(dc * ew, dj * ns);
  }
  /** The eight neighbours of a box cell inside the box: (neighbour, dc, dj). */
  each(b: number, visit: (n: number, dc: number, dj: number) => void): void {
    const c = b % this.bw, j = Math.floor(b / this.bw);
    for (let dj = -1; dj <= 1; dj++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dj) continue;
      const cc = c + dc, jj = j + dj;
      if (cc < 0 || cc >= this.bw || jj < 0 || jj >= this.bh) continue;
      visit(jj * this.bw + cc, dc, dj);
    }
  }
}

/**
 * The cheapest way from one place to the next over the heights (D220, "Follows the valleys"): low ground is cheap,
 * high ground dear, climbing dearer still and the sea dearest; within a box around the two (a river does not go far
 * out of its way). Its cells' middles, from `a` to `b` (exactly at both ends); null when the box would be too large.
 */
function valleyPath(g: Cells, a: [number, number], b: [number, number]): Array<[number, number]> | null {
  const span = Math.max(Math.abs(Math.floor(((b[0] + 180) / 360) * g.W) - Math.floor(((a[0] + 180) / 360) * g.W)), Math.abs(g.row(b[1]) - g.row(a[1])));
  const box = new Box(g, [a, b], Math.max(6, Math.round(span * 0.45)));
  if (box.size > 1.6e6 || box.size < 4) return null;
  const from = box.of(a[0], a[1]), to = box.of(b[0], b[1]);
  if (from < 0 || to < 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < box.size; k++) { const h = box.height(k); if (h >= 0) { if (h < lo) lo = h; if (h > hi) hi = h; } }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const relief = Math.max(80, hi - lo);
  const cost = new Float64Array(box.size).fill(Infinity), prev = new Int32Array(box.size).fill(-1);
  const heap = new Heap(1024);
  cost[from] = 0; heap.push(0, from);
  while (heap.size) {
    const key = heap.topKey(), c = heap.pop();
    if (key > cost[c]) continue;
    if (c === to) break;
    const hc = box.height(c);
    box.each(c, (n, dc, dj) => {
      const hn = box.height(n);
      const f = hn < 0 && n !== to ? 12 : 1 + 5 * Math.max(0, Math.min(1, (hn - lo) / relief)) + (30 * Math.max(0, hn - hc)) / relief;
      const k = cost[c] + box.step(c, dc, dj) * f;
      if (k < cost[n]) { cost[n] = k; prev[n] = c; heap.push(k, n); }
    });
  }
  if (prev[to] < 0 && to !== from) return null;
  const cells: number[] = [];
  for (let c = to; c >= 0; c = prev[c]) cells.push(c);
  cells.reverse();
  const out = cells.map((c) => box.middle(c));
  out[0] = a; out[out.length - 1] = b;
  if (out.length === 1) out.push(b);
  return out;
}

/** The line smoothed (corners cut, twice), its ends kept. */
function chaikin(line: Array<[number, number]>, times = 2): Array<[number, number]> {
  let pts = line;
  for (let t = 0; t < times && pts.length > 2; t++) {
    const out: Array<[number, number]> = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/**
 * The line winding (D220): moved to either side by noise along it, in bends from a third of its length down to a few
 * of its points, each as deep for its length as the next (so it looks alike at every scale); none at its ends.
 */
function wind(g: Cells, line: Array<[number, number]>, amount: number, seed: number, longest: number, byGround = false): Array<[number, number]> {
  if (amount <= 0 || line.length < 4) return line;
  // (Rivers wind most over flat ground: half as much where the ground around rises 800 m or more, half again more on the flat.)
  const flat = new Float32Array(line.length).fill(1);
  if (byGround) {
    const hs = line.map(([x, y]) => g.at(x, y)), win = Math.max(3, Math.round(line.length / 40));
    for (let i = 0; i < line.length; i++) {
      let lo = Infinity, hi = -Infinity;
      for (let q = Math.max(0, i - win); q <= Math.min(line.length - 1, i + win); q++) { if (hs[q] < lo) lo = hs[q]; if (hs[q] > hi) hi = hs[q]; }
      flat[i] = 0.5 + Math.max(0, Math.min(1, 1 - (hi - lo) / 800));
    }
  }
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + g.km(line[i - 1], line[i]));
  const L = s[s.length - 1];
  if (L <= 0) return line;
  const ds = L / (line.length - 1), noise = simplex3(seed);
  const waves: Array<[number, number]> = [];
  for (let lambda = Math.min(longest, L / 3); lambda >= 3 * ds; lambda /= 2.6) waves.push([lambda, 0.085 * lambda * amount]);
  if (!waves.length) return line;
  const out: Array<[number, number]> = [];
  const ends = 0.08 * L;
  for (let i = 0; i < line.length; i++) {
    const p = line[i], a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const k = Math.cos(p[1] * RAD);
    let tx = (b[0] - a[0]) * k, ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    let off = 0;
    waves.forEach(([lambda, amp], o) => { off += amp * noise(s[i] / lambda, o * 13.7 + 0.5, 0.31); });
    const u = Math.min(s[i], L - s[i]) / ends, taper = u >= 1 ? 1 : u * u * (3 - 2 * u);
    off *= taper * flat[i];
    // (Sideways: the normal to the line, in degrees.)
    out.push([p[0] + (-ty * off) / g.kmPerDeg / Math.max(0.02, k), p[1] + (tx * off) / g.kmPerDeg]);
  }
  return out;
}

/** From the first point on land to the first in the sea after it (the river's mouth), or nothing if none is on land. */
function toTheSea(g: Cells, line: Array<[number, number]>): Array<[number, number]> {
  let first = -1;
  for (let i = 0; i < line.length; i++) if (g.at(line[i][0], line[i][1]) >= 0) { first = i; break; }
  if (first < 0) return [];
  for (let i = first + 1; i < line.length; i++) if (g.at(line[i][0], line[i][1]) < 0) return line.slice(first, i + 1);
  return line.slice(first);
}

/**
 * Cuts a valley along a line: its bed falls steadily from `top` to `bottom` along it, the ground is lowered to it on the
 * line and less and less out to `r` km either side; the ground is only ever lowered.
 */
function cutValley(g: Cells, touched: Uint8Array, line: Array<[number, number]>, top: number, bottom: number, r: number): void {
  if (line.length < 2 || r <= 0) return;
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + g.km(line[i - 1], line[i]));
  const L = s[s.length - 1] || 1;
  // (Each point of the line marks the cells around it with its distance and its bed: the nearest point's wins.)
  const best = new Map<number, [number, number]>();
  const rows = Math.ceil(r / g.cellKm) + 1;
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i], bed = top + ((bottom - top) * s[i]) / L;
    const j0 = g.row(y), cols = Math.ceil(r / ((360 / g.W) * g.kmPerDeg * Math.max(0.05, Math.cos(y * RAD)))) + 1, c0 = Math.floor(((x + 180) / 360) * g.W);
    for (let dj = -rows; dj <= rows; dj++) {
      const j = j0 + dj;
      if (j < 0 || j >= g.H) continue;
      const lat = 90 - ((j + 0.5) / g.H) * 180;
      for (let dc = -cols; dc <= cols; dc++) {
        const c = c0 + dc, lon = ((c + 0.5) / g.W) * 360 - 180;
        const d = g.km([x, y], [lon, lat]);
        if (d >= r) continue;
        const k = j * g.W + (((c % g.W) + g.W) % g.W), had = best.get(k);
        if (!had || d < had[0]) best.set(k, [d, bed]);
      }
    }
  }
  for (const [k, [d, bed]] of best) {
    const w = d / r, side = bed + (g.e[k] - bed) * w * w;
    if (side < g.e[k]) { g.e[k] = side; touched[k] = 1; }
  }
}

/**
 * Tributaries (D220): within a box around the river, where the water of the heights runs (each cell to the neighbour
 * it reaches the river or the sea by, hollows filled first), how much gathers, and channels where enough has gathered
 * that run into the river; the more tributaries asked for, the less water a channel needs. Each from its source to where
 * it joins, the longest first (so a tributary's own branches end on it). Also how much water the river carries along
 * its course, for its width.
 */
function tributaries(g: Cells, course: Array<[number, number]>, spec: RiverSpec, L: number, inland: boolean): { branches: Array<{ line: Array<[number, number]>; flow: number[] }>; flowAlong: number[]; total: number } | null {
  const pad = Math.max(3, Math.min(250, Math.round((0.3 * L) / g.cellKm)));
  let box = new Box(g, course, pad);
  if (box.size > 2.5e6) box = new Box(g, course, Math.max(3, Math.round(pad * Math.sqrt(2.5e6 / box.size) * 0.8)));
  if (box.size > 2.5e6) return null;
  const n = box.size;
  const filled = new Float32Array(n), dir = new Int32Array(n).fill(-2), origin = new Uint8Array(n), order = new Int32Array(n);
  const heap = new Heap(4096);
  // The river's own cells drain to it; ending inland, the land beyond its end drains on to where it would carry on, not
  // back into it (its last cells taken as going elsewhere).
  const endKm = inland ? Math.max(3 * g.cellKm, 0.04 * L) : 0;
  let along = 0;
  course.forEach(([x, y], i) => {
    if (i) along += g.km(course[i - 1], course[i]);
    const b = box.of(x, y);
    if (b < 0 || dir[b] !== -2) return;
    dir[b] = -1; origin[b] = L - along < endKm ? 2 : 1; filled[b] = box.height(b); heap.push(filled[b], b);
  });
  // The sea, and the box's edge: water there goes elsewhere.
  for (let b = 0; b < n; b++) {
    if (dir[b] !== -2) continue;
    const c = b % box.bw, j = Math.floor(b / box.bw), h = box.height(b);
    if (h < 0 || c === 0 || j === 0 || c === box.bw - 1 || j === box.bh - 1) { dir[b] = -1; origin[b] = 2; filled[b] = h; heap.push(h, b); }
  }
  let m = 0;
  while (heap.size) {
    const c = heap.pop();
    order[m++] = c;
    box.each(c, (nb) => {
      if (dir[nb] !== -2) return;
      dir[nb] = c; origin[nb] = origin[c];
      filled[nb] = Math.max(box.height(nb), filled[c] + 1e-3);
      heap.push(filled[nb], nb);
    });
  }
  // Water gathered: each cell its area, passed downstream (the highest first).
  const acc = new Float64Array(n);
  for (let q = 0; q < m; q++) { const b = order[q], lat = 90 - ((box.j0 + Math.floor(b / box.bw) + 0.5) / g.H) * 180; acc[b] = Math.max(0.05, Math.cos(lat * RAD)); }
  for (let q = m - 1; q >= 0; q--) { const b = order[q]; if (dir[b] >= 0) acc[dir[b]] += acc[b]; }
  let total = 0;
  const flowAlong: number[] = [];
  const seen = new Set<number>();
  for (const [x, y] of course) {
    const b = box.of(x, y);
    if (b >= 0 && !seen.has(b) && origin[b] === 1) { seen.add(b); total += acc[b]; }
    flowAlong.push(total);
  }
  if (!(total > 0)) return null;
  const out: Array<{ line: Array<[number, number]>; flow: number[] }> = [];
  if (spec.tributaries > 0) {
    const share = 0.2 + (0.004 - 0.2) * Math.pow(spec.tributaries, 0.6);
    const T = Math.max(4, total * share);
    const channel = (b: number) => dir[b] >= 0 && origin[b] === 1 && acc[b] >= T;
    const fed = new Uint8Array(n);
    for (let q = 0; q < m; q++) { const b = order[q]; if (channel(b)) fed[dir[b]] = 1; }
    // How far each cell's water runs to the river (its cells), for the longest first.
    const run = new Float32Array(n);
    for (let q = 0; q < m; q++) { const b = order[q]; if (dir[b] >= 0) run[b] = run[dir[b]] + 1; }
    const sources: number[] = [];
    for (let b = 0; b < n; b++) if (channel(b) && !fed[b]) sources.push(b);
    sources.sort((p, q) => run[q] - run[p]);
    const taken = new Uint8Array(n);
    for (const src of sources) {
      const cells: number[] = [];
      let c = src;
      for (;;) {
        cells.push(c);
        if (taken[c] || dir[c] < 0) break;
        taken[c] = 1;
        c = dir[c];
      }
      if (cells.length < 4) continue;
      out.push({ line: cells.map((b) => box.middle(b)), flow: cells.map((b) => acc[b] / total) });
    }
  }
  return { branches: out, flowAlong: flowAlong.map((f) => f / total), total };
}

/** Where a line's point nearest a place lies on the line (its index). */
function nearestIndex(g: Cells, line: Array<[number, number]>, p: [number, number]): number {
  let best = Infinity, at = 0;
  for (let i = 0; i < line.length; i++) { const d = g.km(line[i], p); if (d < best) { best = d; at = i; } }
  return at;
}

/**
 * Works out a river from its points and settings over heights `e` (W × H, metres; changed where it cuts its valley,
 * those cells marked in `touched`); R the planet's radius (km). Null when it has no course on land.
 */
export function applyRiverStamp(e: Float32Array, touched: Uint8Array, W: number, H: number, s: RiverStampLike, R: number): RiverShape | null {
  if (s.path.length < 2) return null;
  const g = new Cells(e, W, H, R);
  const spec = s.river ?? LEGACY_RIVER, legacy = !s.river;
  // Its points with longitudes running on from the first (across the 180th meridian if need be).
  const pts: Array<[number, number]> = [];
  for (const [lon, lat] of s.path) pts.push([pts.length ? near(lon, pts[pts.length - 1][0]) : lon, lat]);
  const roughL = lengthOf(g, pts);
  if (!(roughL > 0)) return null;
  const ds = Math.max(roughL / 1500, Math.min(g.cellKm / 4, roughL / 300));
  // 1. The course through its points: as drawn (a river from before D220), along the valleys, or smoothly.
  let course: Array<[number, number]>;
  if (legacy) course = resample(g, pts, ds);
  else if (spec.follow) {
    const joined: Array<[number, number]> = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const part = valleyPath(g, pts[i], pts[i + 1]) ?? [pts[i], pts[i + 1]];
      joined.push(...(i ? part.slice(1) : part));
    }
    course = resample(g, chaikin(resample(g, joined, g.cellKm / 2), 3), ds);
  } else course = spline(g, pts, ds);
  const L0 = lengthOf(g, course);
  course = wind(g, course, legacy ? 0 : spec.meander * (spec.follow ? 0.6 : 1), s.seed, spec.follow ? L0 / 8 : L0 / 3, true);
  course = toTheSea(g, course);
  if (course.length < 2) return null;
  const L = lengthOf(g, course);
  // 2. Its valley, cut into the ground: a bed falling from below its source to below the sea at its mouth (or as far
  // below the ground where it ends inland).
  const reachesSea = g.at(course[course.length - 1][0], course[course.length - 1][1]) < 0;
  const top = g.at(course[0][0], course[0][1]) - s.strength;
  const bottom = reachesSea ? Math.min(-5, top - 1) : Math.min(g.at(course[course.length - 1][0], course[course.length - 1][1]) - s.strength, top - 1);
  if (s.strength > 0) cutValley(g, touched, course, top, bottom, Math.max(s.radiusKm, g.cellKm * 0.75));
  // 3. Tributaries, from the heights now (the valley cut drawing water to it), and how much water it carries.
  const net = legacy ? null : tributaries(g, course, spec, L, !reachesSea);
  const widths = net ? net.flowAlong.map((f) => spec.width * Math.max(0.3, Math.sqrt(f))) : course.map((_, i) => spec.width * (0.35 + 0.65 * Math.pow(i / (course.length - 1), 0.6)));
  const branches: RiverBranch[] = [];
  if (net) {
    let seed = s.seed;
    // (The lines drawn so far: a tributary ends exactly on the one it joins, the river's or a greater tributary's.)
    const drawn: Array<Array<[number, number]>> = [course];
    for (const b of net.branches) {
      const line = b.line.slice();
      const last = line[line.length - 1];
      let to: [number, number] | null = null, best = g.cellKm * 2.5;
      for (const d of drawn) { const i = nearestIndex(g, d, last), km = g.km(d[i], last); if (km < best) { best = km; to = d[i]; } }
      if (to) line[line.length - 1] = to;
      const smooth = resample(g, chaikin(line, 3), Math.max(ds, g.cellKm / 5));
      const lb = lengthOf(g, smooth);
      const wound = wind(g, smooth, spec.meander * 0.8, ++seed, lb / 2.5, true);
      drawn.push(wound);
      const flow = (i: number) => b.flow[Math.min(b.flow.length - 1, Math.round((i / Math.max(1, wound.length - 1)) * (b.flow.length - 1)))];
      branches.push({ line: wound, widths: wound.map((_, i) => spec.width * Math.max(0.22, Math.min(0.9, Math.sqrt(flow(i))))) });
      // (Their valleys cut too, less deep the smaller they are.)
      if (s.strength > 0) {
        const depth = s.strength * 0.6 * Math.sqrt(Math.min(1, b.flow[b.flow.length - 1] ?? 0.1));
        const t = g.at(wound[0][0], wound[0][1]) - depth, end = wound[wound.length - 1];
        cutValley(g, touched, wound, t, Math.min(t - 1, g.at(end[0], end[1])), Math.max(g.cellKm * 0.6, s.radiusKm * 0.5));
      }
    }
  }
  // (Longitudes run on from the source's, across the 180th meridian if need be: lines are drawn whole.)
  return { id: s.id, course, widths, branches };
}

/**
 * A brush stroke as a river's points (D220): only where it turns (Douglas-Peucker, to within `toleranceKm`), at most
 * `most` of them; its ends kept.
 */
export function simplifyStroke(points: Array<[number, number]>, toleranceKm: number, R = 6371.0088, most = 60): Array<[number, number]> {
  if (points.length <= 2) return points.slice();
  const pts: Array<[number, number]> = [];
  for (const [lon, lat] of points) pts.push([pts.length ? near(lon, pts[pts.length - 1][0]) : lon, lat]);
  const kmPerDeg = R * RAD, k = Math.cos((pts.reduce((a, p) => a + p[1], 0) / pts.length) * RAD);
  const xy = pts.map(([x, y]) => [x * k * kmPerDeg, y * kmPerDeg] as [number, number]);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  let tol = Math.max(1e-6, toleranceKm);
  for (;;) {
    keep.fill(0); keep[0] = 1; keep[pts.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let worst = -1, at = -1;
      for (let i = a + 1; i < b; i++) { const d = dist(xy[i], xy[a], xy[b]); if (d > worst) { worst = d; at = i; } }
      if (worst > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    let count = 0;
    for (let i = 0; i < keep.length; i++) count += keep[i];
    if (count <= most) break;
    tol *= 1.5;
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [wrap(x), y] as [number, number]);
}
