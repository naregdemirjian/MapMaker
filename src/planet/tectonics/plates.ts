// Plates (Stage 14.2, D153): rigid caps of lithosphere turning about Euler poles, each carrying its crust in its
// own frame (Cortial et al. 2019). A plate's crust lives on a copy of the mesh in the plate's reference frame:
// which cells are its own and their crust (type, thickness, age, …). Moving the plate changes only its rotation,
// so its crust never smears or blurs, however long it travels; the world at a moment is assembled by turning each
// cell's position into the plates' frames (assemble.ts).
//
// Rotations are unit quaternions (w, x, y, z) taking a plate's frame to the world now; angular velocities are
// vectors in the world frame, radians per million years (an Euler pole and a rate: v = ω × r).
import type { Mesh } from '../mesh/icosphere.ts';

/** Kinds of crust. */
export const CRUST = { none: 0, oceanic: 1, continental: 2, arc: 3 } as const;
/** What has happened to crust (bits): sewn into a continent at a collision, scraped onto a margin, a flood basalt,
 * a hotspot's track, stretched in a rift, built in an arc, struck by an impact. */
export const TAG = { suture: 1, accreted: 2, lip: 4, hotspot: 8, rift: 16, arc: 32, impact: 64 } as const;
export type CrustKind = (typeof CRUST)[keyof typeof CRUST];

export interface Plate {
  id: number;
  /** Frame → world rotation (w, x, y, z). */
  q: Float64Array;
  /** Angular velocity in the world frame, rad/Myr. */
  omega: Float64Array;
  /** Per cell of the plate's frame: its own (1) or not (0), and its crust. */
  member: Uint8Array;
  kind: Uint8Array;
  /** Crust thickness, km. */
  thickness: Float32Array;
  /** Time since the crust formed, Myr. */
  age: Float32Array;
  /** Time since it was last thickened by an arc or a collision, Myr (large: long ago). */
  orogeny: Float32Array;
  /** Sediment on it, km. */
  sediment: Float32Array;
  /** What has happened to it (TAG bits). */
  tags: Uint8Array;
}

export function newPlate(id: number, n: number): Plate {
  return {
    id, q: Float64Array.from([1, 0, 0, 0]), omega: new Float64Array(3),
    member: new Uint8Array(n), kind: new Uint8Array(n), thickness: new Float32Array(n), age: new Float32Array(n),
    orogeny: new Float32Array(n).fill(1e4), sediment: new Float32Array(n), tags: new Uint8Array(n),
  };
}

// ---------------------------------------------------------------- quaternions

/** The rotation by `angle` about the unit axis. */
export function quatAxisAngle(ax: number, ay: number, az: number, angle: number, out: Float64Array = new Float64Array(4)): Float64Array {
  const s = Math.sin(angle / 2);
  out[0] = Math.cos(angle / 2); out[1] = ax * s; out[2] = ay * s; out[3] = az * s;
  return out;
}

/** a ∘ b (b first, then a). */
export function quatMul(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array = new Float64Array(4)): Float64Array {
  const w = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3];
  const x = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2];
  const y = a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1];
  const z = a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0];
  const r = Math.hypot(w, x, y, z) || 1;
  out[0] = w / r; out[1] = x / r; out[2] = y / r; out[3] = z / r;
  return out;
}

/** Rotates (x, y, z) by q (or by its inverse), into out. */
export function quatRotate(q: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array | number[], inverse = false) {
  const w = q[0], qx = inverse ? -q[1] : q[1], qy = inverse ? -q[2] : q[2], qz = inverse ? -q[3] : q[3];
  // v' = v + 2w (q × v) + 2 q × (q × v)
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + w * tx + (qy * tz - qz * ty);
  out[1] = y + w * ty + (qz * tx - qx * tz);
  out[2] = z + w * tz + (qx * ty - qy * tx);
}

/** Turns a plate by its angular velocity for dt Myr. */
export function advancePlate(p: Plate, dt: number) {
  const w = Math.hypot(p.omega[0], p.omega[1], p.omega[2]);
  if (w * dt < 1e-15) return;
  const step = quatAxisAngle(p.omega[0] / w, p.omega[1] / w, p.omega[2] / w, w * dt);
  quatMul(step, p.q, p.q);
}

/** The velocity (unit sphere per Myr) of a plate at a world position: ω × r. */
export function velocityAt(p: Plate, x: number, y: number, z: number, out: Float64Array | number[]) {
  const o = p.omega;
  out[0] = o[1] * z - o[2] * y; out[1] = o[2] * x - o[0] * z; out[2] = o[0] * y - o[1] * x;
}

// ---------------------------------------------------------------- finding cells

/**
 * The cell of a mesh nearest a unit vector, walking from a cell nearby: on a Delaunay mesh a cell that is not the
 * nearest always has a neighbour nearer, so the walk ends at the nearest. A few steps when the start is close.
 */
export function walkNearest(mesh: Mesh, x: number, y: number, z: number, start: number): number {
  const { xyz, nbrStart, nbr } = mesh;
  let c = start, d = x * xyz[3 * c] + y * xyz[3 * c + 1] + z * xyz[3 * c + 2];
  for (let guard = 0; guard < 4 * mesh.n; guard++) {
    let best = c, bd = d;
    for (let k = nbrStart[c], e = nbrStart[c + 1]; k < e; k++) {
      const j = nbr[k], dj = x * xyz[3 * j] + y * xyz[3 * j + 1] + z * xyz[3 * j + 2];
      if (dj > bd) { bd = dj; best = j; }
    }
    if (best === c) return c;
    c = best; d = bd;
  }
  return c;
}
