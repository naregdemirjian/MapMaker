// Screen-space processing of drawn strokes before they become geometry: simplification, smoothing,
// controlled irregularity (seeded, so it never changes after drawing), self-crossing removal and
// orientation. All functions are pure.
export type Pt = [number, number];

export function signedArea(r: Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Orient a screen ring (y down) so that its interior is on the left as seen on the map. */
export function orientInteriorLeft(r: Pt[]): Pt[] {
  return signedArea(r) > 0 ? [...r].reverse() : r;
}

export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bestD = tolerance;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      // When the two ends meet (a closed outline), measure from the end point itself.
      const d = len < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting: each iteration rounds corners a little more. */
export function smooth(points: Pt[], iterations: number, closed: boolean): Pt[] {
  let p = points;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Natural-looking irregularity: seeded fractal midpoint displacement (amplitude in pixels). */
export function roughen(points: Pt[], amplitude: number, seed: number, closed: boolean, levels = 3): Pt[] {
  if (amplitude <= 0) return points;
  const rnd = mulberry32(seed);
  let p = points;
  let amp = amplitude;
  for (let l = 0; l < levels; l++) {
    const out: Pt[] = [];
    const n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push(a);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 2) continue;
      const off = (rnd() * 2 - 1) * Math.min(amp, len * 0.3);
      out.push([(a[0] + b[0]) / 2 - (dy / len) * off, (a[1] + b[1]) / 2 + (dx / len) * off]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
    amp *= 0.55;
  }
  return p;
}

export function densify(points: Pt[], maxLen: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i], b = points[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(points[n - 1]);
  return out;
}

function segX(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

/** Split a self-crossing closed ring (e.g. a lasso whose ends overlap) into simple loops. */
export function splitLoops(ring: Pt[], minArea = 4): Pt[][] {
  const out: Pt[][] = [];
  const stack: Pt[][] = [ring];
  let guard = 0;
  while (stack.length && guard++ < 500) {
    const r = stack.pop()!;
    const n = r.length;
    let found: { i: number; j: number; x: Pt } | null = null;
    for (let i = 0; i < n && !found; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
        const x = segX(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n]);
        if (x) { found = { i, j, x }; break; }
      }
    }
    if (!found) { if (Math.abs(signedArea(r)) >= minArea) out.push(r); continue; }
    const { i, j, x } = found;
    stack.push([x, ...r.slice(i + 1, j + 1)]);
    stack.push([...r.slice(0, i + 1), x, ...r.slice(j + 1)]);
  }
  return out;
}

/** Remove consecutive points that are (almost) the same. */
export function dedupe(points: Pt[], eps = 0.25): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  return out;
}

export interface StrokeSettings { smoothness: number; irregularity: number; precision: number; seed: number }

/** Turn a raw freehand lasso into clean, simple loops ready to unproject (interior on the left). */
export function processLasso(raw: Pt[], s: StrokeSettings): Pt[][] {
  let p = simplify(dedupe(raw), Math.max(0.3, s.precision));
  // The outline is closed automatically: drop end points that return to the start.
  while (p.length > 3 && Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]) < 1.5) p = p.slice(0, -1);
  if (p.length < 3) return [];
  if (s.smoothness > 0) p = smooth(p, Math.round(s.smoothness), true);
  if (s.irregularity > 0) p = roughen(p, s.irregularity, s.seed, true);
  return splitLoops(p).map(orientInteriorLeft).map((r) => densify(r, 6, true));
}
