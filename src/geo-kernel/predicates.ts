// Exact geometric predicates. orient() returns the exact sign of det[a, b, c] for the floating-point
// vectors given (Shewchuk's adaptive arithmetic via robust-predicates), so every topological decision
// in the kernel is consistent with every other one, however close points are.
import { orient3d } from 'robust-predicates';
import { type Vec3, angle, cross, dot, norm, normalize, neg } from './vec.ts';

/** Sign of det[a, b, c]: +1 when c lies to the left of the great circle a->b (seen from outside the sphere). */
export function orient(a: Vec3, b: Vec3, c: Vec3): number {
  const d = orient3d(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], 0, 0, 0);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

export type CrossResult = 'cross' | 'none' | 'degenerate';

/**
 * Do the minor arcs ab and cd cross at a point interior to both?
 * Uses the four-orientation rule (as in Google's S2 library), which correctly ignores the antipodal
 * intersection of the two great circles. 'degenerate' means an exact touch or collinearity.
 */
export function arcsCross(a: Vec3, b: Vec3, c: Vec3, d: Vec3): CrossResult {
  const acb = orient(a, c, b);
  const bda = orient(b, d, a);
  if (acb !== 0 && bda !== 0 && acb !== bda) return 'none';
  const cbd = orient(c, b, d);
  const dac = orient(d, a, c);
  if (acb === 0 || bda === 0 || cbd === 0 || dac === 0) {
    // At least one endpoint is exactly on the other great circle. If the signs that are known
    // already disagree, there is no crossing; otherwise report the touch so callers can snap.
    const s = [acb, bda, cbd, dac].filter((x) => x !== 0);
    if (s.some((x) => x !== s[0])) return 'none';
    return 'degenerate';
  }
  return acb === bda && bda === cbd && cbd === dac ? 'cross' : 'none';
}

/** Intersection point of two crossing minor arcs. */
export function arcIntersection(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 {
  let x = cross(cross(a, b), cross(c, d));
  if (norm(x) === 0) return normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  x = normalize(x);
  const ref: Vec3 = [a[0] + b[0] + c[0] + d[0], a[1] + b[1] + c[1] + d[1], a[2] + b[2] + c[2] + d[2]];
  return dot(x, ref) < 0 ? neg(x) : x;
}

/** Angular distance from p to the minor arc ab, and the closest point on it. */
export function distanceToArc(p: Vec3, a: Vec3, b: Vec3): { dist: number; closest: Vec3; interior: boolean } {
  const n = cross(a, b);
  const nn = norm(n);
  if (nn < 1e-15) {
    const da = angle(p, a);
    return { dist: da, closest: a, interior: false };
  }
  const nh: Vec3 = [n[0] / nn, n[1] / nn, n[2] / nn];
  const s = dot(p, nh);
  const q: Vec3 = [p[0] - s * nh[0], p[1] - s * nh[1], p[2] - s * nh[2]];
  if (norm(q) > 1e-15) {
    const qn = normalize(q);
    // q lies on the arc when it is between a and b along the circle
    if (dot(cross(a, qn), nh) >= 0 && dot(cross(qn, b), nh) >= 0) {
      return { dist: Math.abs(Math.asin(Math.max(-1, Math.min(1, s)))), closest: qn, interior: true };
    }
  }
  const da = angle(p, a);
  const db = angle(p, b);
  return da <= db ? { dist: da, closest: a, interior: false } : { dist: db, closest: b, interior: false };
}
