// Seeded random numbers for repeatable randomised (property-style) tests.
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  return {
    next,
    float: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    bool: (p = 0.5) => next() < p,
  };
}

import { lonLatToVec, slerp, dot, type Vec3 } from '../src/geo-kernel/vec.ts';

/** Densified ring of unit vectors (counter-clockwise lon/lat input = interior on the left). */
export function ring(points: Array<[number, number]>, maxDeg = 1): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = lonLatToVec(...points[i]);
    const b = lonLatToVec(...points[(i + 1) % points.length]);
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
    const k = Math.max(1, Math.ceil(ang / maxDeg));
    for (let j = 0; j < k; j++) out.push(slerp(a, b, j / k));
  }
  return out;
}

export const square = (lon: number, lat: number, h: number): Array<[number, number]> => [
  [lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h],
];
