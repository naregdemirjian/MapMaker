// Finite-volume operators on the mesh (Stage 14, D152). Fields are one value per cell; vector fields are three
// values per cell (x y z, tangent to the sphere). Every operator works on the unit sphere: scale by the planet's
// radius where lengths matter (a gradient per radian is a gradient per metre times the radius).
//
// On a Voronoi mesh the flux between two cells crosses their shared edge, perpendicular to the line between their
// centres, so the Laplacian is the classic two-point flux (ℓ_ij / d_ij)(f_j − f_i) summed and divided by the area;
// gradient and divergence use the same edges (Green-Gauss).
import type { Mesh } from './icosphere.ts';

/** The Laplacian ∇²f per cell (unit sphere). */
export function laplacian(mesh: Mesh, f: ArrayLike<number>, out = new Float64Array(mesh.n)): Float64Array {
  const { n, nbrStart, nbr, edgeDist, edgeLen, area } = mesh;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const fi = f[i];
    for (let k = nbrStart[i], e = nbrStart[i + 1]; k < e; k++) s += (edgeLen[k] / edgeDist[k]) * (f[nbr[k]] - fi);
    out[i] = s / area[i];
  }
  return out;
}

/**
 * The unit normal of the edge between cells i and j, pointing from i to j: the chord x_j − x_i, which is tangent to
 * the sphere at the midpoint of the two centres and perpendicular to the Voronoi edge they share.
 */
function normalTo(xyz: Float64Array, i: number, j: number, t: Float64Array) {
  const x = xyz[3 * j] - xyz[3 * i], y = xyz[3 * j + 1] - xyz[3 * i + 1], z = xyz[3 * j + 2] - xyz[3 * i + 2];
  const r = Math.hypot(x, y, z) || 1;
  t[0] = x / r; t[1] = y / r; t[2] = z / r;
}

/** The gradient of a field per cell, as a tangent vector (x y z per cell; per radian on the unit sphere). */
export function gradient(mesh: Mesh, f: ArrayLike<number>, out = new Float64Array(3 * mesh.n)): Float64Array {
  const { n, nbrStart, nbr, edgeLen, area, xyz } = mesh;
  const t = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    let gx = 0, gy = 0, gz = 0;
    const fi = f[i];
    for (let k = nbrStart[i], e = nbrStart[i + 1]; k < e; k++) {
      normalTo(xyz, i, nbr[k], t);
      const w = (edgeLen[k] * (f[nbr[k]] - fi)) / 2;
      gx += w * t[0]; gy += w * t[1]; gz += w * t[2];
    }
    // Kept tangent to the sphere at the cell.
    const xi = xyz[3 * i], yi = xyz[3 * i + 1], zi = xyz[3 * i + 2], d = gx * xi + gy * yi + gz * zi;
    out[3 * i] = (gx - d * xi) / area[i]; out[3 * i + 1] = (gy - d * yi) / area[i]; out[3 * i + 2] = (gz - d * zi) / area[i];
  }
  return out;
}

/** The divergence of a tangent vector field (x y z per cell) per cell. */
export function divergence(mesh: Mesh, u: ArrayLike<number>, out = new Float64Array(mesh.n)): Float64Array {
  const { n, nbrStart, nbr, edgeLen, area, xyz } = mesh;
  const t = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = nbrStart[i], e = nbrStart[i + 1]; k < e; k++) {
      const j = nbr[k];
      normalTo(xyz, i, j, t);
      // The normal velocity at the shared edge: the mean of the two cells' vectors along the direction i → j.
      const un = ((u[3 * i] + u[3 * j]) * t[0] + (u[3 * i + 1] + u[3 * j + 1]) * t[1] + (u[3 * i + 2] + u[3 * j + 2]) * t[2]) / 2;
      s += edgeLen[k] * un;
    }
    out[i] = s / area[i];
  }
  return out;
}

/**
 * One explicit upwind step of the transport of a quantity by a tangent velocity field (per radian per unit time),
 * in flux form, so the total (Σ area · f) is kept exactly. Stable while dt·|u| stays below about half a cell.
 */
export function advectUpwind(mesh: Mesh, f: ArrayLike<number>, u: ArrayLike<number>, dt: number, out = new Float64Array(mesh.n)): Float64Array {
  const { n, nbrStart, nbr, edgeLen, area, xyz } = mesh;
  const t = new Float64Array(3);
  for (let i = 0; i < n; i++) out[i] = f[i];
  for (let i = 0; i < n; i++) {
    for (let k = nbrStart[i], e = nbrStart[i + 1]; k < e; k++) {
      const j = nbr[k];
      if (j < i) continue; // each edge once
      normalTo(xyz, i, j, t);
      const un = ((u[3 * i] + u[3 * j]) * t[0] + (u[3 * i + 1] + u[3 * j + 1]) * t[1] + (u[3 * i + 2] + u[3 * j + 2]) * t[2]) / 2;
      // What crosses from i to j (negative: from j to i), carried at the upwind cell's value.
      const flux = dt * edgeLen[k] * un * (un > 0 ? f[i] : f[j]);
      out[i] -= flux / area[i];
      out[j] += flux / area[j];
    }
  }
  return out;
}

/** One explicit diffusion step, f + dt·κ∇²f (stable for dt·κ below about a quarter of the smallest cell's area). */
export function diffuse(mesh: Mesh, f: ArrayLike<number>, kappaDt: number, out = new Float64Array(mesh.n)): Float64Array {
  const lap = laplacian(mesh, f);
  for (let i = 0; i < mesh.n; i++) out[i] = f[i] + kappaDt * lap[i];
  return out;
}

/** The area-weighted total of a field (Σ area · f) and its mean. */
export function integral(mesh: Mesh, f: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < mesh.n; i++) s += mesh.area[i] * f[i];
  return s;
}
export const mean = (mesh: Mesh, f: ArrayLike<number>) => integral(mesh, f) / (4 * Math.PI);
