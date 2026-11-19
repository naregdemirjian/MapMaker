// Moving fields between mesh levels, and between the mesh and longitude/latitude grids (Stage 14, D152).
//
// Because the levels nest (icosphere.ts), a coarse cell is also a fine cell, and every other fine cell halves a
// coarse edge: prolongation copies the coarse cells and gives each new cell the mean of the two it lies between
// (linear along the edges); restriction gives each coarse cell the area-weighted mean over its footprint (its own
// fine cell and half of each neighbouring one). Both keep constants exactly; restriction keeps totals closely.
//
// Rasterisation to an equirectangular grid finds, once per mesh and grid size, the face holding every pixel's
// centre and its interpolation weights (scanning each face's box of pixels, so the cost is about one test per
// pixel), then any field is drawn by a weighted gather. Pixel (i, j) has its centre at longitude
// -180 + (i + ½)·360/width and latitude 90 - (j + ½)·180/height, as the terrain grids (grid.ts).
import { cellsAt, locate, meshAt, type Mesh, type Located } from './icosphere.ts';

/** A coarse field (level L-1) brought to level L. */
export function prolong(fine: Mesh, coarse: ArrayLike<number>, out = new Float64Array(fine.n)): Float64Array {
  if (fine.level < 1) throw new Error('Nothing is coarser than level 0');
  const nc = cellsAt(fine.level - 1), par = fine.parents[fine.level - 1];
  for (let i = 0; i < nc; i++) out[i] = coarse[i];
  for (let i = nc; i < fine.n; i++) out[i] = (coarse[par[2 * (i - nc)]] + coarse[par[2 * (i - nc) + 1]]) / 2;
  return out;
}

/** A fine field (level L) brought to level L-1 (area-weighted means over each coarse cell's footprint). */
export function restrict(fine: Mesh, f: ArrayLike<number>, out = new Float64Array(cellsAt(fine.level - 1))): Float64Array {
  if (fine.level < 1) throw new Error('Nothing is coarser than level 0');
  const nc = cellsAt(fine.level - 1), par = fine.parents[fine.level - 1], A = fine.area;
  const w = new Float64Array(nc);
  for (let i = 0; i < nc; i++) { out[i] = A[i] * f[i]; w[i] = A[i]; }
  for (let i = nc; i < fine.n; i++) {
    const half = A[i] / 2, v = half * f[i], a = par[2 * (i - nc)], b = par[2 * (i - nc) + 1];
    out[a] += v; w[a] += half;
    out[b] += v; w[b] += half;
  }
  for (let i = 0; i < nc; i++) out[i] /= w[i];
  return out;
}

/** A field brought from one level to another (finer or coarser), step by step. */
export function toLevel(f: ArrayLike<number>, from: number, to: number): Float64Array {
  let cur: Float64Array = Float64Array.from(f as ArrayLike<number>);
  for (let l = from; l < to; l++) cur = prolong(meshAt(l + 1), cur);
  for (let l = from; l > to; l--) cur = restrict(meshAt(l), cur);
  return cur;
}

// ---------------------------------------------------------------- rasterisation

export interface RasterMap {
  width: number;
  height: number;
  /** Per pixel: the face, the cells of its corners (from the mesh's faces) and two weights (the third is the rest). */
  face: Int32Array;
  w0: Float32Array;
  w1: Float32Array;
  /** Per pixel: the nearest cell (for categories). */
  nearest: Int32Array;
}

const rasterMaps = new Map<string, RasterMap>();

/** The pixel-to-mesh map of a grid size (kept for the last few sizes used). */
export function rasterMap(mesh: Mesh, width: number, height: number): RasterMap {
  const key = `${mesh.level}:${width}x${height}`;
  let m = rasterMaps.get(key);
  if (m) { rasterMaps.delete(key); rasterMaps.set(key, m); return m; }
  m = buildRasterMap(mesh, width, height);
  rasterMaps.set(key, m);
  while (rasterMaps.size > 4) rasterMaps.delete(rasterMaps.keys().next().value!);
  return m;
}

function buildRasterMap(mesh: Mesh, width: number, height: number): RasterMap {
  const N = width * height;
  const face = new Int32Array(N).fill(-1), w0 = new Float32Array(N), w1 = new Float32Array(N), nearest = new Int32Array(N);
  const { xyz } = mesh, faces = mesh.levels[mesh.level], F = faces.length / 3;
  // Pixel centres' trigonometry, once.
  const sinLat = new Float64Array(height), cosLat = new Float64Array(height), sinLon = new Float64Array(width), cosLon = new Float64Array(width);
  for (let j = 0; j < height; j++) { const la = (Math.PI / 2) - ((j + 0.5) * Math.PI) / height; sinLat[j] = Math.sin(la); cosLat[j] = Math.cos(la); }
  for (let i = 0; i < width; i++) { const lo = -Math.PI + ((i + 0.5) * 2 * Math.PI) / width; sinLon[i] = Math.sin(lo); cosLon[i] = Math.cos(lo); }
  const lonOf = (v: number) => Math.atan2(xyz[3 * v + 1], xyz[3 * v]);
  const latOf = (v: number) => Math.asin(Math.max(-1, Math.min(1, xyz[3 * v + 2])));
  // A face's edges bulge towards the poles between their corners; a margin of a fraction of its size covers it
  // (and any pixel left over is found by point location below).
  const margin = (1.2 * 2 * Math.PI) / (5 * 2 ** mesh.level) / 4 + Math.PI / height;
  const p: [number, number, number] = [0, 0, 0];
  for (let f = 0; f < F; f++) {
    const a = faces[3 * f], b = faces[3 * f + 1], c = faces[3 * f + 2];
    const A = 3 * a, B = 3 * b, C = 3 * c;
    // The planes of the three edges (n·p ≥ 0 inside).
    const nax = xyz[A + 1] * xyz[B + 2] - xyz[A + 2] * xyz[B + 1], nay = xyz[A + 2] * xyz[B] - xyz[A] * xyz[B + 2], naz = xyz[A] * xyz[B + 1] - xyz[A + 1] * xyz[B];
    const nbx = xyz[B + 1] * xyz[C + 2] - xyz[B + 2] * xyz[C + 1], nby = xyz[B + 2] * xyz[C] - xyz[B] * xyz[C + 2], nbz = xyz[B] * xyz[C + 1] - xyz[B + 1] * xyz[C];
    const ncx = xyz[C + 1] * xyz[A + 2] - xyz[C + 2] * xyz[A + 1], ncy = xyz[C + 2] * xyz[A] - xyz[C] * xyz[A + 2], ncz = xyz[C] * xyz[A + 1] - xyz[C + 1] * xyz[A];
    let latLo = Math.min(latOf(a), latOf(b), latOf(c)) - margin, latHi = Math.max(latOf(a), latOf(b), latOf(c)) + margin;
    let lo = [lonOf(a), lonOf(b), lonOf(c)];
    let lonLo: number, lonHi: number;
    // A face holding a pole spans every longitude.
    const north = naz >= 0 && nbz >= 0 && ncz >= 0, south = naz <= 0 && nbz <= 0 && ncz <= 0;
    if (north || south) {
      lonLo = -Math.PI; lonHi = Math.PI;
      if (north) latHi = Math.PI / 2; else latLo = -Math.PI / 2;
    } else {
      // Across the antimeridian: take the longitudes on the side that keeps them together.
      if (Math.max(...lo) - Math.min(...lo) > Math.PI) lo = lo.map((x) => (x < 0 ? x + 2 * Math.PI : x));
      const span = Math.max(...lo) - Math.min(...lo);
      const lm = margin / Math.max(0.05, Math.cos(Math.max(Math.abs(latLo), Math.abs(latHi))));
      lonLo = Math.min(...lo) - lm; lonHi = Math.max(...lo) + lm;
      if (span + 2 * lm >= 2 * Math.PI) { lonLo = -Math.PI; lonHi = Math.PI; }
    }
    const j0 = Math.max(0, Math.floor(((Math.PI / 2 - latHi) / Math.PI) * height - 0.5));
    const j1 = Math.min(height - 1, Math.ceil(((Math.PI / 2 - latLo) / Math.PI) * height - 0.5));
    const i0 = Math.floor(((lonLo + Math.PI) / (2 * Math.PI)) * width - 0.5);
    const i1 = Math.ceil(((lonHi + Math.PI) / (2 * Math.PI)) * width - 0.5);
    for (let j = j0; j <= j1; j++) {
      const sl = sinLat[j], cl = cosLat[j], row = j * width;
      for (let ii = i0; ii <= i1; ii++) {
        const i = ((ii % width) + width) % width, k = row + i;
        if (face[k] >= 0) continue;
        p[0] = cl * cosLon[i]; p[1] = cl * sinLon[i]; p[2] = sl;
        const sa = nbx * p[0] + nby * p[1] + nbz * p[2]; // weight of a: p·(b×c)
        if (sa < -1e-15) continue;
        const sb = ncx * p[0] + ncy * p[1] + ncz * p[2]; // weight of b: p·(c×a)
        if (sb < -1e-15) continue;
        const sc = nax * p[0] + nay * p[1] + naz * p[2]; // weight of c: p·(a×b)
        if (sc < -1e-15) continue;
        const sum = Math.max(0, sa) + Math.max(0, sb) + Math.max(0, sc) || 1;
        face[k] = f;
        w0[k] = Math.max(0, sa) / sum; w1[k] = Math.max(0, sb) / sum;
        const da = p[0] * xyz[A] + p[1] * xyz[A + 1] + p[2] * xyz[A + 2];
        const db = p[0] * xyz[B] + p[1] * xyz[B + 1] + p[2] * xyz[B + 2];
        const dc = p[0] * xyz[C] + p[1] * xyz[C + 1] + p[2] * xyz[C + 2];
        nearest[k] = da >= db && da >= dc ? a : db >= dc ? b : c;
      }
    }
  }
  // Anything the boxes missed (they should not), by point location.
  const r: Located = { face: 0, cells: [0, 0, 0], weights: [0, 0, 0], nearest: 0 };
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const k = j * width + i;
    if (face[k] >= 0) continue;
    p[0] = cosLat[j] * cosLon[i]; p[1] = cosLat[j] * sinLon[i]; p[2] = sinLat[j];
    locate(mesh, p, r);
    face[k] = r.face; w0[k] = r.weights[0]; w1[k] = r.weights[1]; nearest[k] = r.nearest;
  }
  return { width, height, face, w0, w1, nearest };
}

/** A field drawn on an equirectangular grid, interpolated linearly within the mesh's faces. */
export function rasterize(mesh: Mesh, f: ArrayLike<number>, width: number, height: number, out = new Float32Array(width * height)): Float32Array {
  const m = rasterMap(mesh, width, height), faces = mesh.levels[mesh.level];
  for (let k = 0; k < out.length; k++) {
    const t = 3 * m.face[k], a = m.w0[k], b = m.w1[k];
    out[k] = a * f[faces[t]] + b * f[faces[t + 1]] + (1 - a - b) * f[faces[t + 2]];
  }
  return out;
}

/** A field of categories (or anything not to be blended) drawn on a grid: each pixel takes its nearest cell's value. */
export function rasterizeNearest<T extends { length: number; [i: number]: number }>(mesh: Mesh, f: ArrayLike<number>, width: number, height: number, out: T): T {
  const m = rasterMap(mesh, width, height);
  for (let k = 0; k < width * height; k++) out[k] = f[m.nearest[k]];
  return out;
}

/**
 * A field on the mesh from an equirectangular grid of values (the terrain grids' layout), bilinear between pixel
 * centres: for starting a simulation from a sketch and for checking rasterisation both ways.
 */
export function sampleGrid(mesh: Mesh, data: ArrayLike<number>, width: number, height: number, scale = 1, out = new Float64Array(mesh.n)): Float64Array {
  for (let c = 0; c < mesh.n; c++) {
    const fx = ((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * width - 0.5, fy = ((Math.PI / 2 - mesh.lat[c]) / Math.PI) * height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const col = (x: number) => ((x % width) + width) % width, row = (y: number) => Math.max(0, Math.min(height - 1, y));
    const a = col(x0), b = col(x0 + 1), r0 = row(y0) * width, r1 = row(y0 + 1) * width;
    const top = data[r0 + a] * (1 - tx) + data[r0 + b] * tx, bottom = data[r1 + a] * (1 - tx) + data[r1 + b] * tx;
    out[c] = (top * (1 - ty) + bottom * ty) * scale;
  }
  return out;
}
