// Drawings by hand (S8 of the studios plan, D251): parts of a country's design, drawn in the Looks studio. A drawing
// has a stroke, a fill, an opacity and a blend of its own, and holds shapes: paths of curves (anchors with handles, as
// the pen of D232 draws them; a rectangle or an ellipse is such a path, made at once). It is fixed to the land: its
// points are kept in degrees of longitude and latitude, so it stays where it was drawn while the map moves, and the
// country's borders cut it (where the country does not hold the land, it is not seen). Pure data here: what a drawing
// is, how it is kept and checked, shapes made from a box drawn on the screen, what lies under the pointer; the
// renderer draws them (render-engine/drawings.ts), the commands change them (commands.ts).
import { BLEND_MODES, type BlendMode } from '../render-engine/country-look.ts';

export type LL = [number, number];
export type Pt = [number, number];
/** An anchor of a path: its point, and its handles before (`i`) and after (`o`) it, in degrees (none: a corner). */
export interface DrawAnchor { p: LL; i?: LL | null; o?: LL | null }
/** A path of curves: straight where neither end of a piece has a handle; closed, it runs back to its first anchor. */
export interface PathShape { kind: 'path'; anchors: DrawAnchor[]; closed: boolean }
export type DrawShape = PathShape;
/** A line along a drawing's shapes: its colour, and its width in pixels of a frame 1920 wide. */
export interface DrawStroke { color: string; width: number }

export interface Drawing {
  id: string;
  name: string;
  /** Shown (its eye, in the Parts panel). */
  on: boolean;
  stroke: DrawStroke | null;
  /** The colour its closed shapes are filled with (null: not filled). */
  fill: string | null;
  /** 0 to 1. */
  opacity: number;
  blend: BlendMode;
  shapes: DrawShape[];
}

/** A new drawing's looks: a dark line two pixels wide, not filled, as drawn. */
export const NEW_DRAWING: Omit<Drawing, 'id' | 'name' | 'shapes'> = { on: true, stroke: { color: '#2b1d12', width: 2 }, fill: null, opacity: 1, blend: 'normal' };
/** At most, for a country: drawings, shapes in a drawing, anchors in a shape. */
export const MOST_DRAWINGS = 40, MOST_SHAPES = 400, MOST_ANCHORS = 4000;
/** The widest line a drawing can have (pixels of a frame 1920 wide). */
export const MOST_WIDTH = 200;

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const llOf = (v: unknown): LL | null =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Math.abs(v[0]) <= 540 && Math.abs(v[1]) <= 90
    ? [v[0], v[1]] : null;

function anchorOf(v: unknown): DrawAnchor | null {
  const a = v as { p?: unknown; i?: unknown; o?: unknown } | null;
  const p = a ? llOf(a.p) : null;
  if (!p) return null;
  const out: DrawAnchor = { p };
  const i = llOf(a!.i), o = llOf(a!.o);
  if (i) out.i = i;
  if (o) out.o = o;
  return out;
}

/** A shape as kept, checked (null: not a shape this version knows, or one with too few points to draw). */
export function shapeOf(v: unknown): DrawShape | null {
  const s = v as { kind?: unknown; anchors?: unknown; closed?: unknown } | null;
  if (!s || s.kind !== 'path' || !Array.isArray(s.anchors)) return null;
  const anchors = s.anchors.slice(0, MOST_ANCHORS).map(anchorOf).filter((a): a is DrawAnchor => !!a);
  if (anchors.length < 2) return null;
  return { kind: 'path', anchors, closed: s.closed === true && anchors.length >= 2 };
}

/** A drawing as kept, checked: unknown fields dropped, numbers held to their ranges (null: not a drawing). */
export function drawingOf(v: unknown): Drawing | null {
  const d = v as Partial<Record<keyof Drawing, unknown>> | null;
  if (!d || typeof d.id !== 'string' || !d.id) return null;
  const st = d.stroke as { color?: unknown; width?: unknown } | null | undefined;
  return {
    id: d.id,
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 80) : 'Drawing',
    on: d.on !== false,
    stroke: st && isColor(st.color) ? { color: st.color, width: num(st.width, 0.1, MOST_WIDTH, 2) } : null,
    fill: isColor(d.fill) ? d.fill : null,
    opacity: num(d.opacity, 0, 1, 1),
    blend: (BLEND_MODES as readonly string[]).includes(d.blend as string) ? (d.blend as BlendMode) : 'normal',
    shapes: Array.isArray(d.shapes) ? d.shapes.slice(0, MOST_SHAPES).map(shapeOf).filter((x): x is DrawShape => !!x) : [],
  };
}

/** A country's drawings as kept in its style (`style.drawings`), checked; [] when it has none. */
export function drawingsOf(v: unknown): Drawing[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Drawing[] = [];
  for (const x of v.slice(0, MOST_DRAWINGS)) {
    const d = drawingOf(x);
    if (d && !seen.has(d.id)) { seen.add(d.id); out.push(d); }
  }
  return out;
}

/** Whether a drawing shows anything: shown, at some strength, with a shape and a line or a fill to draw it with. */
export const drawingShows = (d: Drawing) => d.on && d.opacity > 0 && d.shapes.length > 0 && (!!d.stroke || (!!d.fill && d.shapes.some((s) => s.closed)));

/** The name for a country's next drawing: "Drawing 1", "Drawing 2"… the first not taken. */
export function nextDrawingName(list: Drawing[]): string {
  const taken = new Set(list.map((d) => d.name.toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`drawing ${n}`)) return `Drawing ${n}`;
}

export type ShapeKind = 'rectangle' | 'ellipse';
/** How far a quarter of a circle's handles reach, as a share of its radius (the usual cubic circle). */
const KAPPA = 0.5522847498;

/**
 * A rectangle or an ellipse in the box between two points of the screen (`square`: a square or a circle, as wide as
 * the box is high or wide, whichever is larger), its anchors and handles turned into degrees by `unproject`. As drawn
 * on the screen at that moment; kept fixed to the land. Null for a box too small, or off the map.
 */
export function boxShape(kind: ShapeKind, a: Pt, b: Pt, unproject: (p: Pt) => LL | null, square = false): PathShape | null {
  let [x0, y0] = a, [x1, y1] = b;
  if (square) {
    const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    x1 = x0 + Math.sign(x1 - x0 || 1) * s;
    y1 = y0 + Math.sign(y1 - y0 || 1) * s;
  }
  if (Math.abs(x1 - x0) < 2 || Math.abs(y1 - y0) < 2) return null;
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), btm = Math.max(y0, y1);
  const pts: Array<[Pt, Pt | null, Pt | null]> = [];
  if (kind === 'rectangle') {
    for (const p of [[l, t], [r, t], [r, btm], [l, btm]] as Pt[]) pts.push([p, null, null]);
  } else {
    const cx = (l + r) / 2, cy = (t + btm) / 2, rx = (r - l) / 2, ry = (btm - t) / 2, kx = rx * KAPPA, ky = ry * KAPPA;
    // From the top, clockwise on the screen: each anchor's handles along the curve, before and after it.
    pts.push([[cx, t], [cx - kx, t], [cx + kx, t]]);
    pts.push([[r, cy], [r, cy - ky], [r, cy + ky]]);
    pts.push([[cx, btm], [cx + kx, btm], [cx - kx, btm]]);
    pts.push([[l, cy], [l, cy + ky], [l, cy - ky]]);
  }
  const anchors: DrawAnchor[] = [];
  for (const [p, i, o] of pts) {
    const pl = unproject(p);
    if (!pl) return null;
    const an: DrawAnchor = { p: pl };
    if (i) { const q = unproject(i); if (!q) return null; an.i = q; }
    if (o) { const q = unproject(o); if (!q) return null; an.o = q; }
    anchors.push(an);
  }
  return { kind: 'path', anchors, closed: true };
}

/**
 * The points of a path on the screen, as the renderer draws it: each straight piece a line between its anchors as
 * placed, each curved piece a cubic curve through its handles as placed. Null if any of it is off the map (behind the
 * globe). Returned as segments for a path to follow: a move to the first anchor, then a line or a curve to each next.
 */
export type Seg = { to: Pt; c0?: Pt; c1?: Pt };
export function screenPath(s: PathShape, project: (ll: LL) => Pt | null): Seg[] | null {
  const n = s.anchors.length;
  if (n < 2) return null;
  const at = s.anchors.map((a) => ({ p: project(a.p), i: a.i ? project(a.i) : null, o: a.o ? project(a.o) : null, hi: !!a.i, ho: !!a.o }));
  if (at.some((a) => !a.p || (a.hi && !a.i) || (a.ho && !a.o))) return null;
  const segs: Seg[] = [{ to: at[0].p! }];
  const pieces = s.closed ? n : n - 1;
  for (let k = 0; k < pieces; k++) {
    const a = at[k], b = at[(k + 1) % n];
    if (a.o || b.i) segs.push({ to: b.p!, c0: a.o ?? a.p!, c1: b.i ?? b.p! });
    else segs.push({ to: b.p! });
  }
  return segs;
}

/** A path's segments traced on a canvas path (closed if the shape is). */
export function traceSegs(path: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void; closePath(): void }, segs: Seg[], closed: boolean): void {
  path.moveTo(segs[0].to[0], segs[0].to[1]);
  for (let k = 1; k < segs.length; k++) {
    const g = segs[k];
    if (g.c0 && g.c1) path.bezierCurveTo(g.c0[0], g.c0[1], g.c1[0], g.c1[1], g.to[0], g.to[1]);
    else path.lineTo(g.to[0], g.to[1]);
  }
  if (closed) path.closePath();
}

/** Points along a path's segments on the screen (each curve in `steps` pieces), for what lies under the pointer. */
export function segPoints(segs: Seg[], steps = 16): Pt[] {
  const out: Pt[] = [segs[0].to];
  for (let k = 1; k < segs.length; k++) {
    const a = segs[k - 1].to, g = segs[k];
    if (!g.c0 || !g.c1) { out.push(g.to); continue; }
    for (let j = 1; j <= steps; j++) {
      const t = j / steps, u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
      out.push([k0 * a[0] + k1 * g.c0[0] + k2 * g.c1[0] + k3 * g.to[0], k0 * a[1] + k1 * g.c0[1] + k2 * g.c1[1] + k3 * g.to[1]]);
    }
  }
  return out;
}

/**
 * Whether a point of the screen lies on a shape as drawn: inside it if it is closed and filled, or within `tol` pixels
 * of its line (half the line's width added).
 */
export function hitsShape(s: PathShape, project: (ll: LL) => Pt | null, at: Pt, filled: boolean, half: number, tol = 5): boolean {
  const segs = screenPath(s, project);
  if (!segs) return false;
  const pts = segPoints(segs);
  if (s.closed) pts.push(pts[0]);
  let inside = false;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    const f = l2 > 0 ? Math.max(0, Math.min(1, ((at[0] - x0) * dx + (at[1] - y0) * dy) / l2)) : 0;
    if (Math.hypot(at[0] - x0 - f * dx, at[1] - y0 - f * dy) <= half + tol) return true;
    if ((y0 > at[1]) !== (y1 > at[1]) && at[0] < x0 + ((at[1] - y0) / (y1 - y0)) * dx) inside = !inside;
  }
  return filled && s.closed && inside;
}

/** The drawing, of a country's, that lies under a point of the screen (the uppermost: the last drawn), or null. */
export function drawingAt(list: Drawing[], project: (ll: LL) => Pt | null, at: Pt, unit: number): Drawing | null {
  for (let k = list.length - 1; k >= 0; k--) {
    const d = list[k];
    if (!d.on) continue;
    const half = d.stroke ? (d.stroke.width * unit) / 2 : 0;
    if (d.shapes.some((s) => hitsShape(s, project, at, !!d.fill, half))) return d;
  }
  return null;
}
