// Lines that take the course of the lines they run along (Stage 12, D148): the last step of the smart brushes
// (smart-brush.ts). Where a line runs close to a river, a coast or lake shore, or a border for a stretch, that
// stretch takes the exact course of the line it runs along. All in screen pixels; pure functions.
import type { Pt } from './stroke.ts';

/** What a line to follow is: a river, a coast or lake shore, or a border of today (each can be chosen apart). */
export type FollowKind = 'river' | 'coast' | 'border';
/** A line to follow, in screen pixels (`closed`: a loop, such as an island's coast; its first point is not repeated). */
export interface FollowLine { pts: Pt[]; kind: FollowKind; closed?: boolean }

export interface FollowOptions {
  /** How near (pixels) a drawn line must run to a line for that stretch to follow it. */
  tolerance: number;
  /** How long (pixels along the line followed) a stretch must be to follow it (default: three tolerances, at least 20). */
  minRun?: number;
  /** The spacing (pixels) the drawn line is looked at (default: a quarter of the tolerance, at least 1.5). */
  spacing?: number;
}

/** A line followed and where it is drawn from now: which line, and the place along it (pixels from its start). */
interface Hit { t: number; s: number; d: number }

/** A line to follow, prepared: its points (a loop's first point repeated at its end), the length along it to each, and its whole length. */
interface Prepared { pts: Pt[]; cum: Float64Array; len: number; closed: boolean }

function prepare(f: FollowLine): Prepared | null {
  const pts = f.pts.filter((p, i) => i === 0 || Math.hypot(p[0] - f.pts[i - 1][0], p[1] - f.pts[i - 1][1]) > 1e-9);
  const closed = !!f.closed && pts.length >= 3;
  if (closed) pts.push(pts[0]);
  if (pts.length < 2) return null;
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const len = cum[pts.length - 1];
  return len > 0 ? { pts, cum, len, closed } : null;
}

/** The point at a place along a prepared line (pixels from its start; on a loop, any number, taken round it). */
function pointAt(T: Prepared, s: number): Pt {
  if (T.closed) s = ((s % T.len) + T.len) % T.len;
  else s = Math.max(0, Math.min(T.len, s));
  let lo = 0, hi = T.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T.cum[mid] <= s) lo = mid; else hi = mid; }
  const seg = T.cum[hi] - T.cum[lo], k = seg > 0 ? (s - T.cum[lo]) / seg : 0;
  const a = T.pts[lo], b = T.pts[hi];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/**
 * The course of a prepared line from one place along it to another (pixels from its start; on a loop the
 * places may run past its length or below zero, round it again): the end points and every point between.
 */
function course(T: Prepared, a: number, b: number): Pt[] {
  const out: Pt[] = [pointAt(T, a)];
  const m = T.pts.length;
  if (b > a) {
    if (T.closed) {
      let k = Math.floor(a / T.len);
      let j = upper(T.cum, a - k * T.len);
      for (let guard = 0; guard < 4 * m + 8; guard++) {
        if (j > m - 1) { j = 1; k++; }
        const pos = T.cum[j] + k * T.len;
        if (pos >= b) break;
        out.push(T.pts[j]);
        j++;
      }
    } else for (let j = upper(T.cum, a); j < m && T.cum[j] < b; j++) out.push(T.pts[j]);
  } else if (b < a) {
    if (T.closed) {
      let k = Math.floor(a / T.len);
      let j = lower(T.cum, a - k * T.len) - 1;
      for (let guard = 0; guard < 4 * m + 8; guard++) {
        if (j < 0) { j = m - 2; k--; }
        const pos = T.cum[j] + k * T.len;
        if (pos <= b) break;
        out.push(T.pts[j]);
        j--;
      }
    } else for (let j = lower(T.cum, a) - 1; j >= 0 && T.cum[j] > b; j--) out.push(T.pts[j]);
  }
  out.push(pointAt(T, b));
  return out;
}

/** The first index whose value is above `v` (values in order). */
function upper(a: Float64Array, v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid; }
  return lo;
}
/** The first index whose value is `v` or above (values in order). */
function lower(a: Float64Array, v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A line's points every `h` pixels or closer (its own points kept). */
export function resample(line: Pt[], h: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = line.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = line[i], b = line[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / h));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed && n) out.push(line[n - 1]);
  return out;
}

/**
 * The stretches of a drawn line (screen pixels) that run within the tolerance of one of `targets` for long
 * enough take that line's course between where the stretch begins and ends along it: the whole of the line
 * between, so that a river's bends are followed where the drawn line cut across them. A stretch ends where the
 * drawn line leaves the tolerance, comes nearer another line, or turns back along the line it follows.
 * `fixed`: 1 for each point that lies on a line followed. The drawn line itself when nothing is followed.
 */
export function followLines(line: Pt[], closed: boolean, targets: FollowLine[], o: FollowOptions): { pts: Pt[]; fixed: Uint8Array; followed: number } {
  const tol = o.tolerance, h = o.spacing ?? Math.max(1.5, tol / 4), minRun = o.minRun ?? Math.max(3 * tol, 20);
  const none = { pts: line, fixed: new Uint8Array(line.length), followed: 0 };
  const T = targets.map(prepare);
  if (line.length < 2 || !T.some(Boolean) || !(tol > 0)) return none;
  const R = resample(line, h, closed);
  const n = R.length;
  // The lines' pieces in squares of the tolerance's size, for finding the nearest quickly.
  const cs = tol, grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 1_000_003 + cy;
  const [bx0, by0, bx1, by1] = R.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  T.forEach((P, t) => {
    if (!P) return;
    for (let j = 0; j + 1 < P.pts.length; j++) {
      const a = P.pts[j], b = P.pts[j + 1];
      const x0 = Math.min(a[0], b[0]) - tol, x1 = Math.max(a[0], b[0]) + tol, y0 = Math.min(a[1], b[1]) - tol, y1 = Math.max(a[1], b[1]) + tol;
      if (x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1) continue;
      for (let cx = Math.floor(x0 / cs); cx <= Math.floor(x1 / cs); cx++) for (let cy = Math.floor(y0 / cs); cy <= Math.floor(y1 / cs); cy++) {
        const k = key(cx, cy);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(t, j);
      }
    }
  });
  if (!grid.size) return none;
  // Each point of the drawn line: the nearest line within the tolerance, and the place along it.
  const hits: Array<Hit | null> = R.map(([x, y]) => {
    const list = grid.get(key(Math.floor(x / cs), Math.floor(y / cs)));
    if (!list) return null;
    let best: Hit | null = null;
    for (let q = 0; q < list.length; q += 2) {
      const t = list[q], j = list[q + 1], P = T[t]!;
      const a = P.pts[j], b = P.pts[j + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const k = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      const d = Math.hypot(x - a[0] - k * dx, y - a[1] - k * dy);
      if (d <= tol && (!best || d < best.d)) best = { t, s: P.cum[j] + k * Math.sqrt(l2), d };
    }
    return best;
  });
  // Stretches along one line, in the drawn line's order (a loop is started where a stretch cannot be under way).
  let start = 0;
  if (closed) {
    start = -1;
    for (let i = 0; i < n; i++) { const a = hits[i], b = hits[(i + n - 1) % n]; if (!a || !b || a.t !== b.t) { start = i; break; } }
    if (start < 0) start = 0;
  }
  type Run = { i0: number; i1: number; t: number; s0: number; ds: number; dir: number; count: number; peak: number; peakK: number; peakI: number; peakCount: number };
  const runs: Run[] = [];
  let cur: Run | null = null, lastS = 0;
  const close = () => {
    if (cur && cur.count >= 3 && Math.abs(cur.ds) >= minRun) {
      const P = T[cur.t]!;
      // (A loop followed all the way round is followed once.)
      if (P.closed && Math.abs(cur.ds) > P.len) cur.ds = Math.sign(cur.ds) * P.len;
      runs.push(cur);
    }
    cur = null;
  };
  for (let k = 0; k < n; ) {
    const i = (start + k) % n, hit = hits[i];
    if (!hit) { close(); k++; continue; }
    if (cur && hit.t === cur.t) {
      const P = T[hit.t]!;
      let ds = hit.s - lastS;
      if (P.closed) { if (ds > P.len / 2) ds -= P.len; else if (ds < -P.len / 2) ds += P.len; }
      const total = cur.ds + ds;
      if (cur.dir === 0 && Math.abs(total) > tol) cur.dir = Math.sign(total);
      if (cur.dir !== 0 && cur.dir * total < cur.peak - tol) {
        // Turned back along the line: the stretch ends where it went farthest, and what follows is looked at afresh.
        cur.i1 = cur.peakI; cur.ds = cur.dir * cur.peak; cur.count = cur.peakCount;
        const resume = cur.peakK + 1;
        close();
        k = resume;
        continue;
      }
      cur.ds = total; cur.i1 = i; cur.count++; lastS = hit.s;
      if (cur.dir !== 0 && cur.dir * total > cur.peak) { cur.peak = cur.dir * total; cur.peakK = k; cur.peakI = i; cur.peakCount = cur.count; }
      k++;
      continue;
    }
    close();
    cur = { i0: i, i1: i, t: hit.t, s0: hit.s, ds: 0, dir: 0, count: 1, peak: 0, peakK: k, peakI: i, peakCount: 1 };
    lastS = hit.s;
    k++;
  }
  close();
  if (!runs.length) return none;
  // The drawn line again, each stretch followed replaced by the course of its line.
  const byStart = new Map(runs.map((r) => [r.i0, r]));
  const pts: Pt[] = [], fixed: number[] = [];
  for (let k = 0; k < n; ) {
    const i = (start + k) % n, r = byStart.get(i);
    if (!r) { pts.push(R[i]); fixed.push(0); k++; continue; }
    for (const p of course(T[r.t]!, r.s0, r.s0 + r.ds)) { pts.push(p); fixed.push(1); }
    k += ((r.i1 - r.i0 + n) % n) + 1;
  }
  // (Points that came out the same, one after the other: once.)
  const outPts: Pt[] = [], outFixed: number[] = [];
  for (let q = 0; q < pts.length; q++) {
    const last = outPts[outPts.length - 1];
    if (last && Math.hypot(pts[q][0] - last[0], pts[q][1] - last[1]) < 1e-6) { outFixed[outFixed.length - 1] ||= fixed[q]; continue; }
    outPts.push(pts[q]); outFixed.push(fixed[q]);
  }
  return { pts: outPts, fixed: Uint8Array.from(outFixed), followed: runs.length };
}
