// Fronts that follow the land (D136). A territory changing hands is reached by a front that travels through
// the land itself, the way an army, a flood of settlers or an administration would: down a long arm before
// round its end, round a bay rather than across it, past a lake, never jumping a gap. For each change a field
// of arrival times is worked out once, on a grid in longitude and latitude over the change (so it stays the
// same whatever the camera does): from where the front starts (the border with the new owner's land, the
// points the change was drawn from, the side facing the owner's nearest land, the middle), outward through
// the cells of the change only, by the fast marching method (each cell reached at the earliest time a front
// moving at the cells' speeds can get there). Parts of the change cut off from the rest (islands) are reached
// from the nearest land already taken, as the front would cross the water. Times are scaled so that the last
// place is reached at 1, and carried a few cells beyond the change so that its own edges are exact.
//
// At any moment the land reached is the cells reached by then: traced as smooth closed lines (marching
// squares, the corners rounded) in longitude and latitude, ready to be projected by any camera. A speed that
// varies from place to place (smooth noise, seeded by the change) makes the front ragged, from a few kinks to
// long fingers; a pattern of noise alone, with no front at all, makes the land change hands in patches.

/** A change's field of arrival times on its grid. */
export interface FrontField {
  /** The grid: its west and north edges (degrees; west may be beyond ±180 for a change across the 180th meridian), and cell sizes. */
  west: number; north: number; dlon: number; dlat: number; nx: number; ny: number;
  /** When each cell's middle is reached, 0 to 1 within the change; beyond it, as its nearest cell of the change; Infinity further out. */
  at: Float32Array;
  /** Whether each cell belongs to the change. */
  inside: Uint8Array;
  /** The farthest the front travels, in degrees of arc (how big the change is, for its pace). */
  travel: number;
}

/** Where a front starts. */
export type FrontSource =
  /** From these lines (segments as lon0, lat0, lon1, lat1 in turn): the border with the land the front comes from. */
  | { kind: 'lines'; lonlat: ArrayLike<number> }
  /** From these places at once (each front meets the others: pincers, encirclement). */
  | { kind: 'points'; points: Array<[number, number]> }
  /** From the side facing a place outside (the owner's nearest land across the sea), as a straight front. */
  | { kind: 'toward'; point: [number, number] }
  /** From the place farthest from every edge (a country that held no land before). */
  | { kind: 'heart' }
  /** No front: the land changes hands in patches, in a pattern of smooth noise. */
  | { kind: 'scatter' };

export interface FrontShape {
  /** How ragged the front is: 0 clean, 1 long fingers. */
  roughness: number;
  /** Seeds the pattern (the same change, the same front). */
  seed: number;
  /** Cells across the change's longer side (default 160). */
  cells?: number;
}

const PAD = 4;

/** A change's rings in longitude and latitude, each a list of points (closed or not). */
export type Rings = Array<Array<[number, number]>>;

/**
 * The field of a change (`rings`: its outline, holes included, as given by its parcels), with the front starting
 * from `source`. Null when the change is too small to be seen or spans the whole planet.
 */
export function buildFrontField(rings: Rings, source: FrontSource, shape: FrontShape): FrontField | null {
  // 1. Longitudes made continuous (a change across the 180th meridian gets longitudes beyond 180).
  const rs = unwrap(rings);
  if (!rs.length) return null;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const r of rs) for (const [x, y] of r) { if (x < west) west = x; if (x > east) east = x; if (y < south) south = y; if (y > north) north = y; }
  if (!(east > west) || !(north > south) || east - west > 300) return null;
  const midLat = Math.max(-80, Math.min(80, (north + south) / 2)), k = Math.cos((midLat * Math.PI) / 180);
  const cells = Math.max(16, Math.min(400, shape.cells ?? 160));
  const size = Math.max((east - west) * k, north - south) / cells;
  if (!(size > 0)) return null;
  const dlat = size, dlon = size / k;
  let nx = Math.ceil((east - west) / dlon) + 2 * PAD, ny = Math.ceil((north - south) / dlat) + 2 * PAD;
  // (Very long thin changes: no more than about 200,000 cells.)
  if (nx * ny > 200_000) return null;
  nx = Math.max(nx, 2 * PAD + 1); ny = Math.max(ny, 2 * PAD + 1);
  const gw = west - PAD * dlon, gn = north + PAD * dlat;
  const N = nx * ny;
  const lonOf = (i: number) => gw + (i + 0.5) * dlon, latOf = (j: number) => gn - (j + 0.5) * dlat;
  // Each row's cell width in degrees of arc.
  const hx = new Float64Array(ny);
  for (let j = 0; j < ny; j++) hx[j] = dlon * Math.max(0.05, Math.cos((latOf(j) * Math.PI) / 180));
  // 2. The cells of the change: those whose middle lies inside (even-odd over every ring), and every cell an
  //    edge passes through (so that no thin piece is lost).
  const inside = new Uint8Array(N);
  for (let j = 0; j < ny; j++) {
    const y = latOf(j), xs: number[] = [];
    for (const r of rs) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      const [x0, y0] = r[b], [x1, y1] = r[a];
      if ((y0 > y) !== (y1 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((p, q) => p - q);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - gw) / dlon - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - gw) / dlon - 0.5));
      for (let i = i0; i <= i1; i++) inside[j * nx + i] = 1;
    }
  }
  const cellOf = (x: number, y: number) => {
    const i = Math.floor((x - gw) / dlon), j = Math.floor((gn - y) / dlat);
    return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1;
  };
  for (const r of rs) for (let a = 0, b = r.length - 1; a < r.length; b = a++) walk(r[b], r[a], 0.4 * Math.min(dlon, dlat), (x, y) => { const c = cellOf(x, y); if (c >= 0) inside[c] = 1; });
  let count = 0;
  for (let c = 0; c < N; c++) count += inside[c];
  if (!count) return null;
  // 3. How slowly the front crosses each cell: the same everywhere, or varying smoothly (a ragged front).
  const slow = new Float32Array(N).fill(1);
  const noise = source.kind === 'scatter' || shape.roughness > 0 ? fbm(nx, ny, cells, shape.seed) : null;
  if (noise && source.kind !== 'scatter') {
    const r = Math.max(0, Math.min(1, shape.roughness)) * 1.6;
    for (let c = 0; c < N; c++) slow[c] = Math.exp(-r * noise[c]);
  }
  // 4. The arrival times.
  const T = new Float64Array(N).fill(Infinity);
  if (source.kind === 'scatter') {
    // Patches: each cell when the noise says, smoothed into blobs; scaled below.
    for (let c = 0; c < N; c++) if (inside[c]) T[c] = noise![c] + 1;
  } else {
    const seeds: Array<[number, number]> = [];
    const offer = (c: number, t: number) => { if (c >= 0 && t < T[c]) T[c] = t; };
    if (source.kind === 'lines') {
      const L = source.lonlat;
      const lines: Array<[number, number, number, number]> = [];
      for (let q = 0; q + 3 < L.length; q += 4) {
        const ax = near(L[q], west, east), ay = L[q + 1], bx = near(L[q + 2], west, east), by = L[q + 3];
        lines.push([ax, ay, bx, by]);
        // Every cell the line passes through, and those round them: their times from the line itself.
        walk([ax, ay], [bx, by], 0.4 * Math.min(dlon, dlat), (x, y) => {
          const i0 = Math.floor((x - gw) / dlon), j0 = Math.floor((gn - y) / dlat);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const i = i0 + di, j = j0 + dj;
            if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
            offer(j * nx + i, arcToSegment(lonOf(i), latOf(j), ax, ay, bx, by));
          }
        });
      }
      if (!lines.length) return buildFrontField(rings, { kind: 'heart' }, shape);
    } else if (source.kind === 'points') {
      for (const [px0, py] of source.points) {
        const px = near(px0, west, east);
        let c = cellOf(px, py);
        // (A point outside the change: from the nearest cell of the change.)
        if (c < 0 || !inside[c]) c = nearestInside(inside, nx, ny, px, py, gw, gn, dlon, dlat, hx);
        if (c < 0) continue;
        const i = c % nx, j = (c - i) / nx;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          offer(jj * nx + ii, arc(lonOf(ii), latOf(jj), lonOf(i), latOf(j)) + (c === cellOf(px, py) ? 0 : 0));
        }
      }
    } else if (source.kind === 'toward') {
      // A straight front from the side facing the place: the cells of the change nearest to it along the way it lies.
      let cx = 0, cy = 0;
      for (let c = 0; c < N; c++) if (inside[c]) { cx += lonOf(c % nx); cy += latOf(Math.floor(c / nx)); }
      cx /= count; cy /= count;
      const px = near(source.point[0], west - 180, east + 180);
      let ux = (cx - px) * k, uy = cy - source.point[1];
      const len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
      let lo = Infinity;
      const proj = new Float64Array(N);
      for (let c = 0; c < N; c++) { const v = (lonOf(c % nx) - cx) * k * ux + (latOf(Math.floor(c / nx)) - cy) * uy; proj[c] = v; if (inside[c] && v < lo) lo = v; }
      for (let c = 0; c < N; c++) if (inside[c] && proj[c] <= lo + 1.5 * size) offer(c, proj[c] - lo);
    } else {
      // From the middle: the cell farthest from every edge.
      const c = heartOf(inside, nx, ny, hx, dlat);
      if (c >= 0) offer(c, 0);
    }
    for (let c = 0; c < N; c++) if (T[c] < Infinity) seeds.push([c, T[c]]);
    if (!seeds.length) return null;
    march(T, seeds, inside, nx, ny, hx, dlat, slow);
    // 5. Parts not reached (islands, pieces beyond a gap): from the nearest land already reached, across
    //    whatever lies between at the same pace; then through their own land.
    let missing = false;
    for (let c = 0; c < N; c++) if (inside[c] && T[c] === Infinity) { missing = true; break; }
    if (missing) {
      const air = new Float64Array(N).fill(Infinity), from: Array<[number, number]> = [];
      for (let c = 0; c < N; c++) if (T[c] < Infinity) { air[c] = T[c]; from.push([c, T[c]]); }
      march(air, from, null, nx, ny, hx, dlat, null);
      // Each piece not reached starts where the crossing reaches it first.
      const seen = new Uint8Array(N), entries: Array<[number, number]> = [];
      for (let c = 0; c < N; c++) {
        if (!inside[c] || T[c] < Infinity || seen[c]) continue;
        let best = c;
        const stack = [c];
        seen[c] = 1;
        while (stack.length) {
          const q = stack.pop()!;
          if (air[q] < air[best]) best = q;
          const i = q % nx;
          for (const n of [i > 0 ? q - 1 : -1, i < nx - 1 ? q + 1 : -1, q >= nx ? q - nx : -1, q + nx < N ? q + nx : -1]) {
            if (n >= 0 && inside[n] && T[n] === Infinity && !seen[n]) { seen[n] = 1; stack.push(n); }
          }
        }
        if (air[best] < Infinity) entries.push([best, air[best]]);
      }
      for (const [c, t] of entries) T[c] = t;
      if (entries.length) march(T, entries, inside, nx, ny, hx, dlat, slow);
    }
  }
  // 6. Scaled so that the last cell of the change is reached at 1.
  let tmax = 0, tmin = Infinity;
  for (let c = 0; c < N; c++) if (inside[c] && T[c] < Infinity) { if (T[c] > tmax) tmax = T[c]; if (T[c] < tmin) tmin = T[c]; }
  if (!(tmax < Infinity)) return null;
  const base = source.kind === 'scatter' ? tmin : 0, span = tmax - base;
  const at = new Float32Array(N).fill(Infinity);
  for (let c = 0; c < N; c++) {
    if (T[c] === Infinity) continue;
    if (!inside[c] && source.kind === 'scatter') continue;
    at[c] = span > 0 ? Math.max(0, (T[c] - base) / span) : 0;
  }
  for (let c = 0; c < N; c++) if (inside[c] && !(at[c] < Infinity)) at[c] = 1;
  // 7. Carried beyond the change by a few cells (each takes its nearest neighbour's time), so that the land
  //    reached reaches past the change's own edges, which then cut it exactly.
  for (let pass = 0; pass < PAD - 1; pass++) {
    const next = at.slice();
    for (let c = 0; c < N; c++) {
      if (inside[c] || at[c] < Infinity) continue;
      const i = c % nx;
      let m = Infinity;
      for (const n of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c >= nx ? c - nx : -1, c + nx < N ? c + nx : -1]) if (n >= 0 && at[n] < m) m = at[n];
      if (m < Infinity) next[c] = m;
    }
    at.set(next);
  }
  return { west: gw, north: gn, dlon, dlat, nx, ny, at, inside, travel: source.kind === 'scatter' ? 0 : tmax };
}

/**
 * The land reached by `level` (0 to 1): closed lines in longitude and latitude (the corners rounded), each
 * going clockwise (the land it holds on its right, as d3 draws spherical polygons). Filled together by the
 * even-odd rule they are the land reached, holes included.
 */
export function frontRings(f: FrontField, level: number): Rings {
  if (!(level > 0)) return [];
  const { nx, ny, at, west, north, dlon, dlat } = f;
  // Corners of the marching squares: the cells' middles, with a border of cells never reached all round.
  const W = nx + 2, H = ny + 2;
  const v = (i: number, j: number) => (i <= 0 || j <= 0 || i > nx || j > ny ? Infinity : at[(j - 1) * nx + (i - 1)]);
  const X = (i: number) => west + (i - 0.5) * dlon, Y = (j: number) => north - (j - 0.5) * dlat;
  // Where the level crosses the edge between two corners (one reached, one not).
  const cross = (va: number, vb: number) => (va === Infinity || vb === Infinity ? 0.5 : Math.max(0.02, Math.min(0.98, (level - va) / (vb - va))));
  const pts = new Map<number, [number, number]>();
  const at2 = (id: number): [number, number] => {
    let p = pts.get(id);
    if (p) return p;
    const e = id >> 1, i = e % W, j = (e - i) / W;
    if (id & 1) { const t = cross(v(i, j), v(i, j + 1)); p = [X(i), Y(j + t)]; } else { const t = cross(v(i, j), v(i + 1, j)); p = [X(i + t), Y(j)]; }
    pts.set(id, p);
    return p;
  };
  const hEdge = (i: number, j: number) => (j * W + i) * 2, vEdge = (i: number, j: number) => (j * W + i) * 2 + 1;
  // Pieces of line in each square, by the edges they join.
  const links = new Map<number, number[]>();
  const join = (a: number, b: number) => {
    let l = links.get(a); if (!l) links.set(a, (l = [])); l.push(b);
    let m = links.get(b); if (!m) links.set(b, (m = [])); m.push(a);
  };
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = v(i, j) <= level, b = v(i + 1, j) <= level, c = v(i + 1, j + 1) <= level, d = v(i, j + 1) <= level;
    const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const top = hEdge(i, j), right = vEdge(i + 1, j), bottom = hEdge(i, j + 1), left = vEdge(i, j);
    switch (code) {
      case 1: case 14: join(left, bottom); break;
      case 2: case 13: join(bottom, right); break;
      case 3: case 12: join(left, right); break;
      case 4: case 11: join(top, right); break;
      case 6: case 9: join(top, bottom); break;
      case 7: case 8: join(left, top); break;
      case 5: case 10: {
        // A saddle: joined as the middle of the square says.
        const mid = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 <= level;
        if ((code === 5) === mid) { join(left, top); join(bottom, right); } else { join(left, bottom); join(top, right); }
        break;
      }
    }
  }
  // The pieces joined into closed lines.
  const out: Rings = [];
  const used = new Set<number>();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const ring: number[] = [start];
    used.add(start);
    let prev = -1, cur = start;
    for (;;) {
      const next = links.get(cur)!.find((n) => n !== prev && !used.has(n)) ?? links.get(cur)!.find((n) => n !== prev);
      if (next === undefined || next === start) break;
      if (used.has(next)) break;
      ring.push(next);
      used.add(next);
      prev = cur; cur = next;
    }
    if (ring.length < 3) continue;
    let line = ring.map(at2);
    line = chaikin(line);
    // Clockwise (the land on the right as d3 wants it).
    let area = 0;
    for (let q = 0, p = line.length - 1; q < line.length; p = q++) area += line[p][0] * line[q][1] - line[q][0] * line[p][1];
    if (area > 0) line.reverse();
    line.push([line[0][0], line[0][1]]);
    out.push(line);
  }
  return out;
}

/** Whether a place has been reached by `level` (read between the four nearest cells). */
export function reachedAt(f: FrontField, lon: number, lat: number, level: number): boolean {
  const x = (near(lon, f.west, f.west + f.nx * f.dlon) - f.west) / f.dlon - 0.5, y = (f.north - lat) / f.dlat - 0.5;
  const i = Math.round(x), j = Math.round(y);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) return false;
  return f.at[j * f.nx + i] <= level;
}

// ---- the fast marching method

/** A heap of cells by time (the earliest on top). */
class Heap {
  t = new Float64Array(1024); c = new Int32Array(1024); n = 0;
  push(t: number, c: number): void {
    if (this.n === this.t.length) { const t2 = new Float64Array(this.n * 2); t2.set(this.t); this.t = t2; const c2 = new Int32Array(this.n * 2); c2.set(this.c); this.c = c2; }
    let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.t[p] <= t) break; this.t[i] = this.t[p]; this.c[i] = this.c[p]; i = p; }
    this.t[i] = t; this.c[i] = c;
  }
  pop(): number {
    const top = this.c[0], lt = this.t[--this.n], lc = this.c[this.n];
    let i = 0;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= this.n) break;
      if (m + 1 < this.n && this.t[m + 1] < this.t[m]) m++;
      if (this.t[m] >= lt) break;
      this.t[i] = this.t[m]; this.c[i] = this.c[m]; i = m;
    }
    this.t[i] = lt; this.c[i] = lc;
    return top;
  }
  topTime(): number { return this.t[0]; }
}

/**
 * Times by the fast marching method, from the seeds (cells and their times) outward through the cells `allowed`
 * (all when null), each crossing a cell as slowly as `slow` says (1 when null).
 */
function march(T: Float64Array, seeds: Array<[number, number]>, allowed: Uint8Array | null, nx: number, ny: number, hx: Float64Array, hy: number, slow: Float32Array | null): void {
  const N = nx * ny, done = new Uint8Array(N), heap = new Heap();
  for (const [c, t] of seeds) { T[c] = Math.min(T[c], t); heap.push(T[c], c); }
  const solve = (c: number): number => {
    const i = c % nx, j = (c - i) / nx, s = slow ? slow[c] : 1, h1 = hx[j];
    let a = Infinity, b = Infinity;
    if (i > 0 && done[c - 1]) a = T[c - 1];
    if (i < nx - 1 && done[c + 1] && T[c + 1] < a) a = T[c + 1];
    if (j > 0 && done[c - nx]) b = T[c - nx];
    if (j < ny - 1 && done[c + nx] && T[c + nx] < b) b = T[c + nx];
    if (a === Infinity && b === Infinity) return Infinity;
    if (a === Infinity) return b + s * hy;
    if (b === Infinity) return a + s * h1;
    // Both ways: ((t - a) / hx)^2 + ((t - b) / hy)^2 = s^2.
    const ia = 1 / (h1 * h1), ib = 1 / (hy * hy);
    const A = ia + ib, B = -2 * (a * ia + b * ib), C = a * a * ia + b * b * ib - s * s;
    const disc = B * B - 4 * A * C;
    if (disc >= 0) { const t = (-B + Math.sqrt(disc)) / (2 * A); if (t >= Math.max(a, b)) return t; }
    return Math.min(a + s * h1, b + s * hy);
  };
  while (heap.n) {
    const tt = heap.topTime(), c = heap.pop();
    if (done[c] || tt > T[c]) continue;
    done[c] = 1;
    const i = c % nx;
    const ns = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c >= nx ? c - nx : -1, c + nx < N ? c + nx : -1];
    for (const n of ns) {
      if (n < 0 || done[n] || (allowed && !allowed[n])) continue;
      const t = solve(n);
      if (t < T[n]) { T[n] = t; heap.push(t, n); }
    }
  }
}

// ---- helpers

/** Rings with continuous longitudes, all of them within one span (a change across the 180th meridian runs past 180). */
function unwrap(rings: Rings): Rings {
  const out: Rings = [];
  let ref: number | null = null;
  for (const r of rings) {
    if (r.length < 3) continue;
    const line: Array<[number, number]> = [];
    let prev = r[0][0];
    if (ref !== null) prev = near(prev, ref - 180, ref + 180);
    for (const [x0, y] of r) {
      let x = x0;
      while (x - prev > 180) x -= 360;
      while (prev - x > 180) x += 360;
      line.push([x, y]);
      prev = x;
    }
    if (ref === null) ref = line[0][0];
    out.push(line);
  }
  return out;
}

/** A longitude moved by whole turns to lie nearest the span [a, b]. */
function near(x: number, a: number, b: number): number {
  const mid = (a + b) / 2;
  while (x - mid > 180) x -= 360;
  while (mid - x > 180) x += 360;
  return x;
}

/** Points along a line no further apart than `step` (degrees), the ends included. */
function walk(a: [number, number], b: [number, number], step: number, at: (x: number, y: number) => void): void {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  for (let q = 0; q <= n; q++) at(a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n);
}

/** Distance in degrees of arc between two nearby places (flat, the longitudes shrunk at their latitude). */
function arc(x0: number, y0: number, x1: number, y1: number): number {
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  return Math.hypot((x1 - x0) * k, y1 - y0);
}

/** Distance in degrees of arc from a place to a line between two nearby places. */
function arcToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const k = Math.cos((y * Math.PI) / 180);
  const px = (x - ax) * k, py = y - ay, qx = (bx - ax) * k, qy = by - ay, L = qx * qx + qy * qy;
  const t = L > 0 ? Math.max(0, Math.min(1, (px * qx + py * qy) / L)) : 0;
  return Math.hypot(px - t * qx, py - t * qy);
}

/** The cell of the change nearest to a place, or -1. */
function nearestInside(inside: Uint8Array, nx: number, ny: number, x: number, y: number, gw: number, gn: number, dlon: number, dlat: number, hx: Float64Array): number {
  let best = -1, bd = Infinity;
  for (let j = 0; j < ny; j++) {
    const cy = gn - (j + 0.5) * dlat, ky = hx[j] / dlon;
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (!inside[c]) continue;
      const d = Math.hypot((gw + (i + 0.5) * dlon - x) * ky, cy - y);
      if (d < bd) { bd = d; best = c; }
    }
  }
  return best;
}

/** The cell of the change farthest from its edges (two passes of a distance to the nearest cell outside it). */
function heartOf(inside: Uint8Array, nx: number, ny: number, hx: Float64Array, hy: number): number {
  const N = nx * ny, d = new Float64Array(N);
  for (let c = 0; c < N; c++) d[c] = inside[c] ? Infinity : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!d[c]) continue;
    if (i > 0) d[c] = Math.min(d[c], d[c - 1] + hx[j]);
    if (j > 0) d[c] = Math.min(d[c], d[c - nx] + hy);
  }
  let best = -1, bd = -1;
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const c = j * nx + i;
    if (!d[c]) continue;
    if (i < nx - 1) d[c] = Math.min(d[c], d[c + 1] + hx[j]);
    if (j < ny - 1) d[c] = Math.min(d[c], d[c + nx] + hy);
    if (d[c] > bd) { bd = d[c]; best = c; }
  }
  return best;
}

/** Smooth noise between -1 and 1 over the grid, in patterns about a quarter of the change across, seeded. */
function fbm(nx: number, ny: number, cells: number, seed: number): Float32Array {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const out = new Float32Array(nx * ny);
  let amp = 1, total = 0, wave = cells / 3.5;
  for (let o = 0; o < 4; o++) {
    const gx = Math.ceil(nx / wave) + 2, gy = Math.ceil(ny / wave) + 2, g = new Float32Array(gx * gy);
    for (let q = 0; q < g.length; q++) g[q] = rnd() * 2 - 1;
    const ox = rnd() * wave, oy = rnd() * wave;
    for (let j = 0; j < ny; j++) {
      const fy = (j + oy) / wave, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let i = 0; i < nx; i++) {
        const fx = (i + ox) / wave, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = g[y0 * gx + x0], b = g[y0 * gx + x0 + 1], c = g[(y0 + 1) * gx + x0], d = g[(y0 + 1) * gx + x0 + 1];
        out[j * nx + i] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
      }
    }
    total += amp; amp *= 0.5; wave = Math.max(2, wave / 2);
  }
  for (let c = 0; c < out.length; c++) out[c] = Math.max(-1, Math.min(1, (out[c] / total) * 1.6));
  return out;
}

/** One round of corner cutting (Chaikin) of a closed line: its staircase from the grid rounded off. */
function chaikin(p: Array<[number, number]>): Array<[number, number]> {
  if (p.length < 4) return p;
  const out: Array<[number, number]> = [];
  for (let q = 0; q < p.length; q++) {
    const a = p[q], b = p[(q + 1) % p.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}
