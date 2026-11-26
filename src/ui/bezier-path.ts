// Paths of curves (D232), as the pen of Photoshop or After Effects draws them: anchors, each with a handle before and
// after it (absent: a corner). A click adds a corner, a drag pulls out its handles (a smooth point, the two handles in
// a line); a click on the path adds an anchor there without changing its shape; anchors and handles are dragged to
// reshape it, Alt breaking the line of a smooth point's handles. The curves are kept in degrees of longitude and
// latitude (so they stay put whatever the zoom) and laid out as lines of points for the map.

export type LL = [number, number];
export type Pt = [number, number];
export interface Anchor { p: LL; i?: LL | null; o?: LL | null }

const lerp = (a: LL, b: LL, t: number): LL => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A point of the cubic curve from a to b (its handles c0 after a, c1 before b) at t. */
export function cubicAt(a: LL, c0: LL, c1: LL, b: LL, t: number): LL {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return [k0 * a[0] + k1 * c0[0] + k2 * c1[0] + k3 * b[0], k0 * a[1] + k1 * c0[1] + k2 * c1[1] + k3 * b[1]];
}

/** Whether the piece from a to b is curved (either end has a handle on its side). */
export const curved = (a: Anchor, b: Anchor) => !!(a.o || b.i);

/** The points of the piece from a to b after a (b included): one for a straight piece, `steps` for a curve. */
export function piecePoints(a: Anchor, b: Anchor, steps = 24): LL[] {
  if (!curved(a, b)) return [b.p];
  const c0 = a.o ?? a.p, c1 = b.i ?? b.p;
  const out: LL[] = [];
  for (let k = 1; k <= steps; k++) out.push(cubicAt(a.p, c0, c1, b.p, k / steps));
  return out;
}

/** The path as a line of points (closed: back to its first anchor, which is not repeated). */
export function flatten(anchors: Anchor[], closed: boolean, steps = 24): LL[] {
  if (!anchors.length) return [];
  const out: LL[] = [anchors[0].p];
  for (let k = 0; k + 1 < anchors.length; k++) out.push(...piecePoints(anchors[k], anchors[k + 1], steps));
  if (closed && anchors.length > 2) {
    const back = piecePoints(anchors[anchors.length - 1], anchors[0], steps);
    out.push(...back.slice(0, -1));
  }
  return out;
}

/** Where each anchor lies in `flatten(anchors, false, steps)` (the index of its point). */
export function anchorIndices(anchors: Anchor[], steps = 24): number[] {
  const out: number[] = [];
  let n = 0;
  for (let k = 0; k < anchors.length; k++) {
    if (k) n += curved(anchors[k - 1], anchors[k]) ? steps : 1;
    out.push(n);
  }
  return out;
}

/** The handle across the anchor from `h`, as far from it again. */
export const mirror = (p: LL, h: LL): LL => [2 * p[0] - h[0], 2 * p[1] - h[1]];

/**
 * An anchor with one of its handles moved to `h`. Unless `broken`, the other handle (if it has one) turns to stay in
 * line with it, keeping its own length, as on a smooth point; broken, the other stays where it is.
 */
export function moveHandle(a: Anchor, which: 'i' | 'o', h: LL, broken: boolean): Anchor {
  const other = which === 'i' ? 'o' : 'i';
  const next: Anchor = { ...a, [which]: h };
  const o = a[other];
  if (!broken && o) {
    const len = Math.hypot(o[0] - a.p[0], o[1] - a.p[1]);
    const dx = a.p[0] - h[0], dy = a.p[1] - h[1], d = Math.hypot(dx, dy);
    if (d > 0) next[other] = [a.p[0] + (dx / d) * len, a.p[1] + (dy / d) * len];
  }
  return next;
}

/** An anchor and its handles moved by (dx, dy). */
export function moveAnchor(a: Anchor, dx: number, dy: number): Anchor {
  const by = (q: LL | null | undefined) => (q ? [q[0] + dx, q[1] + dy] as LL : q);
  return { p: [a.p[0] + dx, a.p[1] + dy], i: by(a.i), o: by(a.o) };
}

/**
 * The path with an anchor added on the piece after anchor `k`, at `t` along it, its shape unchanged (the curve split in
 * two, de Casteljau): the new anchor gets the handles that keep both halves as they were. Closed: the piece after the
 * last anchor runs back to the first.
 */
export function splitPiece(anchors: Anchor[], k: number, t: number): Anchor[] {
  const n = anchors.length, a = anchors[k], b = anchors[(k + 1) % n];
  const out = anchors.slice();
  if (!curved(a, b)) {
    out.splice(k + 1, 0, { p: lerp(a.p, b.p, t) });
    return out;
  }
  const p0 = a.p, p1 = a.o ?? a.p, p2 = b.i ?? b.p, p3 = b.p;
  const q0 = lerp(p0, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t);
  const s = lerp(r0, r1, t);
  out[k] = { ...a, o: a.o ? q0 : a.o };
  const nb = { ...b, i: b.i ? q2 : b.i };
  if (k + 1 < n) out[k + 1] = nb; else out[0] = nb;
  out.splice(k + 1, 0, { p: s, i: r0, o: r1 });
  return out;
}

export type Hit = { kind: 'handle'; index: number; which: 'i' | 'o' } | { kind: 'anchor'; index: number } | { kind: 'piece'; index: number; t: number };

/**
 * What lies under a point of the screen, within `tol` pixels: a handle (of an anchor that has one), an anchor, or a
 * piece of the path (the anchor it starts from and how far along it). Handles first, then anchors, then pieces.
 * `closed`: the piece from the last anchor back to the first counts too.
 */
export function hitTest(anchors: Anchor[], closed: boolean, project: (ll: LL) => Pt | null, at: Pt, tol = 7): Hit | null {
  const d = (q: Pt | null) => (q ? Math.hypot(q[0] - at[0], q[1] - at[1]) : Infinity);
  let best: Hit | null = null, bd = tol;
  anchors.forEach((a, index) => {
    for (const which of ['i', 'o'] as const) {
      const h = a[which];
      if (!h) continue;
      const dh = d(project(h));
      if (dh <= bd) { bd = dh; best = { kind: 'handle', index, which }; }
    }
  });
  if (best) return best;
  bd = tol;
  anchors.forEach((a, index) => { const da = d(project(a.p)); if (da <= bd) { bd = da; best = { kind: 'anchor', index }; } });
  if (best) return best;
  bd = tol;
  const pieces = closed && anchors.length > 2 ? anchors.length : anchors.length - 1;
  for (let k = 0; k < pieces; k++) {
    const a = anchors[k], b = anchors[(k + 1) % anchors.length];
    const steps = curved(a, b) ? 32 : 1;
    let prev = project(a.p);
    for (let j = 1; j <= steps; j++) {
      const ll = steps === 1 ? b.p : cubicAt(a.p, a.o ?? a.p, b.i ?? b.p, b.p, j / steps);
      const q = project(ll);
      if (prev && q) {
        const dx = q[0] - prev[0], dy = q[1] - prev[1], l2 = dx * dx + dy * dy;
        const f = l2 > 0 ? Math.max(0, Math.min(1, ((at[0] - prev[0]) * dx + (at[1] - prev[1]) * dy) / l2)) : 0;
        const dd = Math.hypot(at[0] - prev[0] - f * dx, at[1] - prev[1] - f * dy);
        if (dd <= bd) { bd = dd; best = { kind: 'piece', index: k, t: (j - 1 + f) / steps }; }
      }
      prev = q;
    }
  }
  return best;
}
