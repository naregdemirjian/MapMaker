// Provinces of a generated planet (D179): the land cut into provinces of about the same size, their borders
// following the mountains, each a polygon whose borders with its neighbours are shared point for point (so that
// land given by province never leaves a sliver or takes a neighbour's), reaching a little into the sea (the
// planet's own coast ends them on the map). Made from the planet's heights, the same every time.
import type { ElevationGrid } from '../terrain/grid.ts';

type Ring = Array<[number, number]>;
export interface Province { id: number; name: string; centre: [number, number]; land: number; polygons: Ring[][] }

/** A small random number generator (the same numbers for the same seed). */
function rng(seed: number): () => number {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

const SYL_A = ['al', 'an', 'ar', 'bel', 'bra', 'cal', 'cor', 'dor', 'dun', 'el', 'en', 'fen', 'gal', 'gor', 'hal', 'har', 'il', 'ir', 'kar', 'kel', 'lor', 'mar', 'mor', 'nor', 'or', 'ost', 'ran', 'ser', 'tal', 'tor', 'ul', 'val', 'ver', 'wen', 'yr', 'zan'];
const SYL_B = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ei'];
const SYL_C = ['dale', 'mere', 'ford', 'wick', 'mark', 'holm', 'gard', 'reach', 'moor', 'vale', 'fell', 'stead', 'more', 'ness', 'rin', 'thas', 'dor', 'lun', 'mir', 'wyn'];
/** A name made of syllables, the same for the same number. */
export function provinceName(n: number): string {
  const r = rng(n * 2654435761 + 7);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const s = pick(SYL_A) + (r() < 0.45 ? pick(SYL_B) : '') + pick(SYL_C);
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Provinces of a planet's land. `spacing`: degrees between the middles of neighbouring provinces; `seaReach`:
 * how far (degrees) a province reaches into the sea; `maxLat`: no province nearer a pole than this.
 */
export function makeProvinces(grid: ElevationGrid, o: { seed: number; spacing: number; seaReach?: number; maxLat?: number; minLand?: number }): Province[] {
  const W = grid.width, H = grid.height, dx = 360 / W, dy = 180 / H;
  const seaReach = o.seaReach ?? 1.5, maxLat = o.maxLat ?? 72;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = grid.data[i] * grid.step;
  const lonOf = (i: number) => -180 + (i + 0.5) * dx, latOf = (j: number) => 90 - (j + 0.5) * dy;
  const land = (k: number) => h[k] > 0;
  // Seeds: land cells far enough from each other (darts thrown in a fixed order).
  const r = rng(o.seed);
  const cand: number[] = [];
  for (let j = 0; j < H; j++) { if (Math.abs(latOf(j)) > maxLat) continue; for (let i = 0; i < W; i++) if (land(j * W + i)) cand.push(j * W + i); }
  for (let i = cand.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [cand[i], cand[k]] = [cand[k], cand[i]]; }
  const toVec = (k: number): [number, number, number] => { const lo = (lonOf(k % W) * Math.PI) / 180, la = (latOf(Math.floor(k / W)) * Math.PI) / 180; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; };
  const minDot = Math.cos((o.spacing * Math.PI) / 180);
  const seeds: number[] = [], seedVec: Array<[number, number, number]> = [];
  // (A coarse bucket grid of the seeds, by latitude band, for the distance test.)
  const bands = new Map<number, number[]>();
  const bandOf = (k: number) => Math.floor(latOf(Math.floor(k / W)) / o.spacing);
  for (const k of cand) {
    const v = toVec(k), b = bandOf(k);
    let ok = true;
    for (let bb = b - 1; bb <= b + 1 && ok; bb++) for (const s of bands.get(bb) ?? []) { const w = seedVec[s]; if (v[0] * w[0] + v[1] * w[1] + v[2] * w[2] > minDot) { ok = false; break; } }
    if (!ok) continue;
    const id = seeds.length;
    seeds.push(k); seedVec.push(v);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b)!.push(id);
  }
  // Grow the provinces from their seeds together, the cheapest way first: across flat land cheaply, up and down
  // mountains dearly (borders then follow the ridges), and only a little way into the sea.
  const label = new Int32Array(W * H).fill(-1);
  const cost = new Float64Array(W * H).fill(Infinity);
  const seaDist = new Float32Array(W * H).fill(0);
  // A binary heap of (cost, cell).
  const heapK: number[] = [], heapC: number[] = [];
  const push = (k: number, c: number) => {
    let i = heapK.length; heapK.push(k); heapC.push(c);
    while (i > 0) { const p = (i - 1) >> 1; if (heapC[p] <= c) break; heapK[i] = heapK[p]; heapC[i] = heapC[p]; i = p; }
    heapK[i] = k; heapC[i] = c;
  };
  const pop = (): [number, number] => {
    const k = heapK[0], c = heapC[0];
    const lk = heapK.pop()!, lc = heapC.pop()!;
    if (heapK.length) {
      let i = 0;
      for (;;) { const a = 2 * i + 1, bb = a + 1; let m = i; let mc = lc; if (a < heapK.length && heapC[a] < mc) { m = a; mc = heapC[a]; } if (bb < heapK.length && heapC[bb] < mc) { m = bb; mc = heapC[bb]; } if (m === i) break; heapK[i] = heapK[m]; heapC[i] = heapC[m]; i = m; }
      heapK[i] = lk; heapC[i] = lc;
    }
    return [k, c];
  };
  seeds.forEach((k, id) => { label[k] = id; cost[k] = 0; push(k, 0); });
  const steps: Array<[number, number, number]> = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  const done = new Uint8Array(W * H);
  while (heapK.length) {
    const [k, c] = pop();
    if (done[k]) continue;
    done[k] = 1;
    const i = k % W, j = Math.floor(k / W);
    const cosLat = Math.max(0.05, Math.cos((latOf(j) * Math.PI) / 180));
    for (const [di, dj, len] of steps) {
      const jj = j + dj;
      if (jj < 0 || jj >= H) continue;
      const ii = (i + di + W) % W, kk = jj * W + ii;
      if (done[kk] || Math.abs(latOf(jj)) > 84) continue;
      const stepDeg = di && dj ? Math.hypot(dx * cosLat, dy) : di ? dx * cosLat : dy;
      void len;
      let sd = 0, mult = 1;
      if (land(kk)) mult = 1 + Math.min(4, Math.abs(h[kk] - h[k]) / 300) + Math.max(0, h[kk]) / 3000;
      else { sd = seaDist[k] + stepDeg; if (sd > seaReach) continue; mult = 3; }
      const nc = c + stepDeg * mult;
      if (nc < cost[kk]) { cost[kk] = nc; label[kk] = label[k]; seaDist[kk] = sd; push(kk, nc); }
    }
  }
  // No two cells of a province meeting only at a corner (a 2 x 2 block like a chessboard): one of them changes.
  for (let j = 0; j + 1 < H; j++) for (let i = 0; i < W; i++) {
    const a = j * W + i, b = j * W + ((i + 1) % W), c = (j + 1) * W + i, d = (j + 1) * W + ((i + 1) % W);
    if (label[a] === label[d] && label[b] === label[c] && label[a] !== label[b]) label[b] = label[a];
  }
  // The borders: the edges between cells of different provinces (or a province and nothing), as chains between
  // the points where three or more meet; each chain smoothed once, so both its sides share the same line.
  // Vertices: (i, j) for i in 0..W-1 (wrapping) and j in 0..H.
  const V = (i: number, j: number) => j * W + ((i + W) % W);
  const at = (i: number, j: number) => (j < 0 || j >= H ? -2 : label[j * W + ((i + W) % W)]);
  // Edges out of each vertex: right (to i+1, j), down (to i, j+1); with the cell on the left and on the right of the
  // edge walked in that direction.
  type Edge = { a: number; b: number; left: number; right: number };
  const edges: Edge[] = [];
  const byVertex = new Map<number, number[]>();
  const addEdge = (e: Edge) => { const id = edges.length; edges.push(e); for (const v of [e.a, e.b]) { let l = byVertex.get(v); if (!l) byVertex.set(v, (l = [])); l.push(id); } };
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    // Horizontal edge from (i, j) to (i+1, j): the cell above is (i, j-1), below (i, j). Walking east, left is north.
    if (j > 0 && j < H) { const up = at(i, j - 1), down = at(i, j); if (up !== down) addEdge({ a: V(i, j), b: V(i + 1, j), left: up, right: down }); }
    // Vertical edge from (i, j) to (i, j+1): the cell west is (i-1, j), east (i, j). Walking south, left is east.
    if (j < H) { const west = at(i - 1, j), east = at(i, j); if (west !== east) addEdge({ a: V(i, j), b: V(i, j + 1), left: east, right: west }); }
  }
  const vx = (v: number): [number, number] => [-180 + (v % W) * dx, 90 - Math.floor(v / W) * dy];
  const degree = (v: number) => byVertex.get(v)?.length ?? 0;
  // Chains: walked from each junction (or round a loop with none), following edges with the same two sides.
  const used = new Uint8Array(edges.length);
  type Chain = { pts: Array<[number, number]>; left: number; right: number; from: number; to: number };
  const chains: Chain[] = [];
  const walk = (start: number, firstEdge: number): Chain => {
    const e0 = edges[firstEdge];
    const forward = e0.a === start;
    const left = forward ? e0.left : e0.right, right = forward ? e0.right : e0.left;
    const verts = [start];
    let v = start, eId = firstEdge;
    for (;;) {
      used[eId] = 1;
      const e = edges[eId];
      v = e.a === v ? e.b : e.a;
      verts.push(v);
      if (degree(v) !== 2) break;
      const next = byVertex.get(v)!.find((x) => !used[x]);
      if (next === undefined) break;
      eId = next;
    }
    // Unwrap longitudes along the chain (a chain may cross the 180th meridian).
    const pts: Array<[number, number]> = [];
    let prev = NaN;
    for (const u of verts) {
      let [lo, la] = vx(u);
      if (Number.isFinite(prev)) { while (lo - prev > 180) lo -= 360; while (lo - prev < -180) lo += 360; }
      pts.push([lo, la]); prev = lo;
    }
    return { pts, left, right, from: start, to: v };
  };
  for (const [v, list] of byVertex) if (list.length !== 2) for (const e of list) if (!used[e]) chains.push(walk(v, e));
  for (let e = 0; e < edges.length; e++) if (!used[e]) chains.push(walk(edges[e].a, e));
  // Smoothing (twice cutting the corners), the ends kept where they are; a loop smoothed all round.
  const smooth = (pts: Array<[number, number]>, loop: boolean) => {
    let p = pts;
    for (let it = 0; it < 2; it++) {
      const out: Array<[number, number]> = [];
      const n = p.length;
      if (!loop) out.push(p[0]);
      const last = loop ? n - 1 : n - 1;
      for (let k = 0; k < last; k++) {
        const [x0, y0] = p[k], [x1, y1] = p[k + 1];
        out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
      }
      if (!loop) out.push(p[n - 1]); else out.push(out[0]);
      p = out;
    }
    return p;
  };
  for (const c of chains) {
    const loop = c.from === c.to;
    // (Straight runs need no points in between: only corners are kept before smoothing.)
    const keep: Array<[number, number]> = [c.pts[0]];
    for (let k = 1; k < c.pts.length - 1; k++) {
      const [a, b, d] = [c.pts[k - 1], c.pts[k], c.pts[k + 1]];
      if ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]) !== 0) keep.push(b);
    }
    keep.push(c.pts[c.pts.length - 1]);
    c.pts = smooth(keep, loop);
  }
  // Each province's rings: its chains, each turned to have the province on its left, joined end to start.
  const rings = new Map<number, Ring[]>();
  const pieces = new Map<number, Array<{ pts: Array<[number, number]>; from: number; to: number }>>();
  for (const c of chains) {
    for (const [id, pts, from, to] of [[c.left, c.pts, c.from, c.to], [c.right, [...c.pts].reverse(), c.to, c.from]] as Array<[number, Array<[number, number]>, number, number]>) {
      if (id < 0) continue;
      let l = pieces.get(id); if (!l) pieces.set(id, (l = []));
      l.push({ pts, from, to });
    }
  }
  for (const [id, list] of pieces) {
    const left = [...list];
    const out: Ring[] = [];
    while (left.length) {
      const first = left.shift()!;
      const ring: Ring = [...first.pts];
      let end = first.to;
      let guard = 0;
      while (end !== first.from && guard++ < 100000) {
        // (Of the pieces starting where this one ends, the one turning most to the left keeps the province apart
        // from another piece of itself meeting at the same point.)
        const k = left.findIndex((p) => p.from === end);
        if (k < 0) break;
        const p = left.splice(k, 1)[0];
        // Longitudes continue from where the ring has got to.
        const off = ring[ring.length - 1][0] - p.pts[0][0];
        const shift = Math.round(off / 360) * 360;
        for (let q = 1; q < p.pts.length; q++) ring.push([p.pts[q][0] + shift, p.pts[q][1]]);
        end = p.to;
      }
      // (The ring closes on its first point: not written twice.)
      const [fx, fy] = ring[0], [lx, ly] = ring[ring.length - 1];
      if (ring.length > 1 && fy === ly && Math.abs(((lx - fx) % 360 + 360) % 360) < 1e-9) ring.pop();
      out.push(ring);
    }
    rings.set(id, out);
  }
  // Outer rings (counter-clockwise, the province on the left) and holes (clockwise) put together.
  const area = (r: Ring) => { let s = 0; for (let k = 0; k < r.length; k++) { const [x0, y0] = r[k], [x1, y1] = r[(k + 1) % r.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
  const inside = ([x, y]: [number, number], ring: Ring) => { let inn = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a], [xb, yb] = ring[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inn = !inn; } return inn; };
  const provinces: Province[] = [];
  const landCount = new Map<number, number>(), sumX = new Map<number, number>(), sumY = new Map<number, number>();
  for (let k = 0; k < W * H; k++) {
    const id = label[k];
    if (id < 0 || !land(k)) continue;
    landCount.set(id, (landCount.get(id) ?? 0) + 1);
  }
  for (const [id, rs] of rings) {
    // (Lat runs up: a ring with the province on its left goes round counter-clockwise, its area positive.)
    const outers = rs.filter((x) => area(x) > 0), holes = rs.filter((x) => area(x) <= 0);
    const polys: Ring[][] = outers.map((x) => [x]);
    for (const hole of holes) {
      const p = polys.find((poly) => inside(hole[0], poly[0]));
      if (p) p.push(hole);
    }
    if (!polys.length) continue;
    const seed = seeds[id];
    const n = landCount.get(id) ?? 0;
    if (n < (o.minLand ?? 1)) continue;
    void sumX; void sumY;
    provinces.push({ id, name: provinceName(o.seed * 1000 + id), centre: [lonOf(seed % W), latOf(Math.floor(seed / W))], land: n, polygons: polys });
  }
  return provinces;
}
