// Following crust through a history (Stage 15.2, D164): the crust at a place on the picture of one moment, carried
// with its plate to another moment, from the plates' rotations kept with each picture (between two pictures, the
// nearer one's turned on at the plate's rate, as the history itself turns plates). So an edit clicked on today's
// map is made where that crust was when the edit begins, and its consequences are measured where the crust is now.
import type { Mesh } from './mesh/icosphere.ts';
import { quatAxisAngle, quatMul, quatRotate } from './tectonics/plates.ts';
import { cellAt } from './explain.ts';

/** What following reads from a history: its pictures' moments (Ma), plates per picture and cell, and rotations. */
export interface Rotations {
  times: ArrayLike<number>;
  plates: ArrayLike<number>;
  frameRotations?: ArrayLike<Float64Array>;
}

const near = (times: ArrayLike<number>, ma: number) => {
  let best = 0;
  for (let f = 1; f < times.length; f++) if (Math.abs(times[f] - ma) < Math.abs(times[best] - ma)) best = f;
  return best;
};

/** A plate's rotation (plate frame to world) at a moment (Ma), from the nearest picture it is in; null if none. */
export function plateRotation(h: Rotations, id: number, ma: number): Float64Array | null {
  const R = h.frameRotations;
  if (!R) return null;
  const order = Array.from({ length: h.times.length }, (_, f) => f).sort((a, b) => Math.abs(h.times[a] - ma) - Math.abs(h.times[b] - ma));
  for (const f of order) {
    const r = R[f];
    if (!r || 8 * id + 7 >= r.length || r[8 * id + 7] !== 1) continue;
    const q = Float64Array.from(r.subarray(8 * id, 8 * id + 4));
    const wx = r[8 * id + 4], wy = r[8 * id + 5], wz = r[8 * id + 6], rate = Math.hypot(wx, wy, wz);
    const dt = h.times[f] - ma; // Myr forward from the picture to the moment
    if (rate < 1e-15 || dt === 0) return q;
    return quatMul(quatAxisAngle(wx / rate, wy / rate, wz / rate, rate * dt), q);
  }
  return null;
}

const unit = (at: [number, number]) => {
  const lo = (at[0] * Math.PI) / 180, la = (at[1] * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};
const lonLat = (v: ArrayLike<number>): [number, number] => {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return [(Math.atan2(v[1], v[0]) * 180) / Math.PI, (Math.asin(Math.max(-1, Math.min(1, v[2] / r))) * 180) / Math.PI];
};

/** Great-circle distance between two places (degrees), km on a sphere of radius `radiusKm`. */
export function distanceKm(a: [number, number], b: [number, number], radiusKm: number): number {
  const u = unit(a), v = unit(b);
  return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * radiusKm;
}

/**
 * Where the crust at a place on the picture of moment `fromMa` is at moment `toMa` (degrees), carried from picture
 * to picture by the plate it is on in each (so through splits and welds); null if the history kept no rotations.
 */
export function followCrust(h: Rotations, mesh: Mesh, at: [number, number], fromMa: number, toMa: number): [number, number] | null {
  if (!h.frameRotations) return null;
  const n = mesh.n, forward = toMa < fromMa;
  let x = unit(at), t = fromMa;
  for (let guard = 0; Math.abs(t - toMa) > 1e-9 && guard < 10_000; guard++) {
    const f = near(h.times, t);
    // The next picture's moment on the way (or the end).
    let next = toMa;
    for (let k = 0; k < h.times.length; k++) {
      const m = h.times[k];
      if (forward ? m < t - 1e-9 && m > next : m > t + 1e-9 && m < next) next = m;
    }
    const ll = lonLat(x), id = h.plates[f * n + cellAt(mesh, ll[0], ll[1])];
    if (id === 255) return null;
    const q0 = plateRotation(h, id, t), q1 = plateRotation(h, id, next);
    if (!q0 || !q1) return null;
    const r = [0, 0, 0], y = [0, 0, 0];
    quatRotate(q0, x[0], x[1], x[2], r, true);
    quatRotate(q1, r[0], r[1], r[2], y);
    x = y; t = next;
  }
  return lonLat(x);
}
