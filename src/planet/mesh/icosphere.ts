// The planet's mesh (Stage 14, D152): a subdivided icosahedron whose vertices are the centres of the cells the
// engine computes on (their spherical Voronoi regions: 12 pentagons, the rest hexagons). Level L has 10·4^L + 2
// cells: L5 10 242 (about 220 km apart on Earth), L6 40 962, L7 163 842, L8 655 362.
//
// The levels nest: the cells of level L are the first cells of level L+1 (a subdivision only adds the midpoints of
// the edges, after the vertices that were there), so moving a field between levels is exact and cheap
// (transfer.ts), and the faces of every level are kept for point location: the children of face f of one level
// are faces 4f to 4f+3 of the next.
//
// Positions are unit vectors (x towards longitude 0 on the equator, y towards 90° E, z to the north pole).
// Faces are counter-clockwise seen from outside. Neighbours are kept counter-clockwise around each cell, with,
// per neighbour, the great-circle distance between the two centres and the length of the Voronoi edge they share
// (both in radians on the unit sphere), which is what finite-volume operators need (operators.ts).

export interface Mesh {
  level: number;
  /** The number of cells. */
  n: number;
  /** Unit positions, x y z per cell. */
  xyz: Float64Array;
  /** Latitude and longitude, radians. */
  lat: Float64Array;
  lon: Float64Array;
  /** Each cell's area, steradians (the areas sum to 4π). */
  area: Float64Array;
  /** Neighbours: those of cell i are nbr[nbrStart[i]] … nbr[nbrStart[i+1] - 1], counter-clockwise. */
  nbrStart: Int32Array;
  nbr: Int32Array;
  /** Per neighbour entry: the distance between the centres, and the length of the shared edge (radians). */
  edgeDist: Float64Array;
  edgeLen: Float64Array;
  /** The faces of every level from 0 to this one, three vertex indices each (level l has 20·4^l). */
  levels: Int32Array[];
  /** For every level l ≥ 1: the two ends of the coarser edge each new vertex halves (cells nOf(l-1) … nOf(l)-1). */
  parents: Int32Array[];
}

/** Cells at a level. */
export const cellsAt = (level: number) => 10 * 4 ** level + 2;

/** The icosahedron: 12 vertices, 20 counter-clockwise faces, a vertex at each pole. */
function icosahedron(): { xyz: number[]; faces: number[] } {
  const xyz: number[] = [0, 0, 1];
  const lat = Math.atan(0.5);
  for (let i = 0; i < 5; i++) {
    const lon = (i * 2 * Math.PI) / 5;
    xyz.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  }
  for (let i = 0; i < 5; i++) {
    const lon = ((i + 0.5) * 2 * Math.PI) / 5;
    xyz.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), -Math.sin(lat));
  }
  xyz.push(0, 0, -1);
  const faces: number[] = [];
  for (let i = 0; i < 5; i++) {
    const u = 1 + i, u2 = 1 + ((i + 1) % 5), l = 6 + i, l2 = 6 + ((i + 1) % 5);
    faces.push(0, u, u2);      // the northern cap
    faces.push(u, l, u2);      // the band, pointing down
    faces.push(u2, l, l2);     // the band, pointing up
    faces.push(11, l2, l);     // the southern cap
  }
  return { xyz, faces };
}

/** An open-addressing table from an edge (two vertex indices) to its midpoint vertex, sized for `edges` entries. */
class EdgeTable {
  private keys: Float64Array;
  private vals: Int32Array;
  private mask: number;
  private stride: number;
  constructor(edges: number, stride: number) {
    this.stride = stride;
    let size = 1;
    while (size < edges * 2) size *= 2;
    this.keys = new Float64Array(size).fill(-1);
    this.vals = new Int32Array(size);
    this.mask = size - 1;
  }
  /** The midpoint of a and b, made by `make` the first time. */
  get(a: number, b: number, make: () => number): number {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * this.stride + hi;
    let h = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca77)) & this.mask;
    for (;;) {
      const k = this.keys[h];
      if (k === key) return this.vals[h];
      if (k === -1) { const v = make(); this.keys[h] = key; this.vals[h] = v; return v; }
      h = (h + 1) & this.mask;
    }
  }
}

const meshes = new Map<number, Mesh>();

/** The mesh at a level (built once and kept). */
export function meshAt(level: number): Mesh {
  if (!(Number.isInteger(level) && level >= 0 && level <= 9)) throw new Error(`No mesh at level ${level}`);
  let m = meshes.get(level);
  if (!m) { m = buildMesh(level); meshes.set(level, m); }
  return m;
}

function buildMesh(level: number): Mesh {
  const n = cellsAt(level);
  const xyz = new Float64Array(3 * n);
  const ico = icosahedron();
  xyz.set(ico.xyz);
  let count = 12;
  const levels: Int32Array[] = [Int32Array.from(ico.faces)];
  const parents: Int32Array[] = [];
  for (let l = 1; l <= level; l++) {
    const prev = levels[l - 1], faces = prev.length / 3;
    const next = new Int32Array(prev.length * 4);
    const nPrev = cellsAt(l - 1), par = new Int32Array(2 * (cellsAt(l) - nPrev));
    const table = new EdgeTable(faces * 1.5, nPrev);
    const mid = (a: number, b: number) => table.get(a, b, () => {
      const i = count++;
      let x = xyz[3 * a] + xyz[3 * b], y = xyz[3 * a + 1] + xyz[3 * b + 1], z = xyz[3 * a + 2] + xyz[3 * b + 2];
      const r = Math.hypot(x, y, z);
      x /= r; y /= r; z /= r;
      xyz[3 * i] = x; xyz[3 * i + 1] = y; xyz[3 * i + 2] = z;
      par[2 * (i - nPrev)] = a; par[2 * (i - nPrev) + 1] = b;
      return i;
    });
    for (let f = 0; f < faces; f++) {
      const a = prev[3 * f], b = prev[3 * f + 1], c = prev[3 * f + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], 12 * f);
    }
    levels.push(next);
    parents.push(par);
  }
  if (count !== n) throw new Error('The mesh did not close');
  const faces = levels[level], F = faces.length / 3;
  const lat = new Float64Array(n), lon = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const z = xyz[3 * i + 2];
    lat[i] = Math.asin(Math.max(-1, Math.min(1, z)));
    lon[i] = Math.atan2(xyz[3 * i + 1], xyz[3 * i]);
  }
  // Each face's circumcentre (a vertex of the Voronoi cells) and the kites it gives each corner's cell.
  const cc = new Float64Array(3 * F);
  const area = new Float64Array(n);
  const P = (i: number): [number, number, number] => [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]];
  for (let f = 0; f < F; f++) {
    const ia = faces[3 * f], ib = faces[3 * f + 1], ic = faces[3 * f + 2];
    const a = P(ia), b = P(ib), c = P(ic);
    const o = normalize(cross(sub(b, a), sub(c, a)));
    cc.set(o, 3 * f);
    const mab = normalize(add(a, b)), mbc = normalize(add(b, c)), mca = normalize(add(c, a));
    area[ia] += triArea(a, mab, o) + triArea(a, o, mca);
    area[ib] += triArea(b, mbc, o) + triArea(b, o, mab);
    area[ic] += triArea(c, mca, o) + triArea(c, o, mbc);
  }
  // Neighbours counter-clockwise: each face (a, b, c) says that around a, b is followed by c (and so on).
  const ringFrom = new Int32Array(6 * n).fill(-1), ringTo = new Int32Array(6 * n), ringFace = new Int32Array(6 * n), deg = new Uint8Array(n);
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const v = faces[3 * f + k], p = faces[3 * f + ((k + 1) % 3)], q = faces[3 * f + ((k + 2) % 3)];
      const s = 6 * v + deg[v]++;
      ringFrom[s] = p; ringTo[s] = q; ringFace[s] = f;
    }
  }
  const nbrStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) nbrStart[i + 1] = nbrStart[i] + deg[i];
  const E = nbrStart[n];
  const nbr = new Int32Array(E), edgeDist = new Float64Array(E), edgeLen = new Float64Array(E);
  // The face on each side of the edge from a cell to a neighbour: the one before it (to → this) and after (from → this).
  for (let i = 0; i < n; i++) {
    const d = deg[i], base = 6 * i, out = nbrStart[i];
    let cur = ringFrom[base];
    for (let k = 0; k < d; k++) {
      // The entry whose `from` is cur: its face lies counter-clockwise after the edge to cur.
      let s = base;
      while (ringFrom[s] !== cur) s++;
      const j = cur, fAfter = ringFace[s];
      // The face before the edge to j: the entry whose `to` is j.
      let t = base;
      while (ringTo[t] !== j) t++;
      const fBefore = ringFace[t];
      nbr[out + k] = j;
      edgeDist[out + k] = arc(P(i), P(j));
      edgeLen[out + k] = arc([cc[3 * fAfter], cc[3 * fAfter + 1], cc[3 * fAfter + 2]], [cc[3 * fBefore], cc[3 * fBefore + 1], cc[3 * fBefore + 2]]);
      cur = ringTo[s];
    }
  }
  return { level, n, xyz, lat, lon, area, nbrStart, nbr, edgeDist, edgeLen, levels, parents };
}

// ---------------------------------------------------------------- small vector helpers

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normalize(a: V3): V3 {
  const r = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / r, a[1] / r, a[2] / r];
}
/** The great-circle distance between two unit vectors (radians), accurate at all distances. */
export function arc(a: V3, b: V3): number {
  return Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
}
/** The area of a spherical triangle of unit vectors (Eriksson 1990: tan(E/2) = |a·(b×c)| / (1 + a·b + b·c + c·a)). */
export function triArea(a: V3, b: V3, c: V3): number {
  const num = Math.abs(dot(a, cross(b, c)));
  const den = 1 + dot(a, b) + dot(b, c) + dot(c, a);
  return 2 * Math.atan2(num, den);
}

/** The unit vector of a longitude and latitude (degrees). */
export function unitOf(lonDeg: number, latDeg: number): V3 {
  const lo = (lonDeg * Math.PI) / 180, la = (latDeg * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

// ---------------------------------------------------------------- point location

export interface Located {
  /** The finest face holding the point, its three cells and their weights (summing to 1). */
  face: number;
  cells: [number, number, number];
  weights: [number, number, number];
  /** The cell whose centre is nearest (the Voronoi cell holding the point). */
  nearest: number;
}

/**
 * Finds the face of the mesh holding a point (a unit vector), exactly, by descending from the icosahedron's 20 faces
 * through the subdivision: O(level). The weights interpolate linearly within the face (they are proportional to
 * the volumes p·(b×c), p·(c×a), p·(a×b), so constants and linear functions are kept).
 */
export function locate(mesh: Mesh, p: V3, out?: Located): Located {
  const { xyz, levels } = mesh;
  const side = (f: Int32Array, k: number) => {
    // The smallest of the three edge tests of face k: ≥ 0 inside.
    const a = 3 * f[3 * k], b = 3 * f[3 * k + 1], c = 3 * f[3 * k + 2];
    const s0 = orient(xyz, a, b, p), s1 = orient(xyz, b, c, p), s2 = orient(xyz, c, a, p);
    return Math.min(s0, s1, s2);
  };
  let best = 0, bestS = -Infinity;
  const top = levels[0];
  for (let k = 0; k < 20; k++) { const s = side(top, k); if (s > bestS) { bestS = s; best = k; } }
  for (let l = 1; l <= mesh.level; l++) {
    const f = levels[l];
    let pick = 4 * best, pickS = -Infinity;
    for (let c = 4 * best; c < 4 * best + 4; c++) { const s = side(f, c); if (s > pickS) { pickS = s; pick = c; } }
    best = pick;
  }
  const f = levels[mesh.level];
  const ia = f[3 * best], ib = f[3 * best + 1], ic = f[3 * best + 2];
  let wa = orient(xyz, 3 * ib, 3 * ic, p), wb = orient(xyz, 3 * ic, 3 * ia, p), wc = orient(xyz, 3 * ia, 3 * ib, p);
  wa = Math.max(0, wa); wb = Math.max(0, wb); wc = Math.max(0, wc);
  const sum = wa + wb + wc || 1;
  const da = p[0] * xyz[3 * ia] + p[1] * xyz[3 * ia + 1] + p[2] * xyz[3 * ia + 2];
  const db = p[0] * xyz[3 * ib] + p[1] * xyz[3 * ib + 1] + p[2] * xyz[3 * ib + 2];
  const dc = p[0] * xyz[3 * ic] + p[1] * xyz[3 * ic + 1] + p[2] * xyz[3 * ic + 2];
  const nearest = da >= db && da >= dc ? ia : db >= dc ? ib : ic;
  const r = out ?? { face: 0, cells: [0, 0, 0], weights: [0, 0, 0], nearest: 0 };
  r.face = best; r.cells[0] = ia; r.cells[1] = ib; r.cells[2] = ic;
  r.weights[0] = wa / sum; r.weights[1] = wb / sum; r.weights[2] = wc / sum; r.nearest = nearest;
  return r;
}

/** p · (a × b) for vertices at offsets a and b of xyz: positive when p is to the left of the great circle a → b. */
function orient(xyz: Float64Array, a: number, b: number, p: V3): number {
  const ax = xyz[a], ay = xyz[a + 1], az = xyz[a + 2], bx = xyz[b], by = xyz[b + 1], bz = xyz[b + 2];
  return p[0] * (ay * bz - az * by) + p[1] * (az * bx - ax * bz) + p[2] * (ax * by - ay * bx);
}

/** The nearest cell to a point by brute force (for tests and checks). */
export function nearestBrute(mesh: Mesh, p: V3): number {
  let best = 0, bestD = -Infinity;
  for (let i = 0; i < mesh.n; i++) {
    const d = p[0] * mesh.xyz[3 * i] + p[1] * mesh.xyz[3 * i + 1] + p[2] * mesh.xyz[3 * i + 2];
    if (d > bestD) { bestD = d; best = i; }
  }
  return best;
}
