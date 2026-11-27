// Drawings by hand (S8 of the studios plan, D251): parts of a country's design, drawn in the Looks studio. A drawing
// has a stroke, a fill, an opacity and a blend of its own, and holds shapes: paths of curves (anchors with handles, as
// the pen of D232 draws them; a rectangle or an ellipse is such a path, made at once). It is fixed to the land: its
// points are kept in degrees of longitude and latitude, so it stays where it was drawn while the map moves, and the
// country's borders cut it (where the country does not hold the land, it is not seen). Pure data here: what a drawing
// is, how it is kept and checked, shapes made from a box drawn on the screen, what lies under the pointer; the
// renderer draws them (render-engine/drawings.ts), the commands change them (commands.ts).
import { BLEND_MODES, effectOf, type BlendMode, type Effect } from '../render-engine/country-look.ts';

export type LL = [number, number];
export type Pt = [number, number];
/** An anchor of a path: its point, and its handles before (`i`) and after (`o`) it, in degrees (none: a corner). */
export interface DrawAnchor { p: LL; i?: LL | null; o?: LL | null }
/** A path of curves: straight where neither end of a piece has a handle; closed, it runs back to its first anchor. */
export interface PathShape { kind: 'path'; anchors: DrawAnchor[]; closed: boolean }
/**
 * Words drawn at a place (D253): centred on it, `size` pixels high in a frame 1920 wide, in a font of a weight, upright
 * or italic, turned by `angle` degrees (clockwise on the screen). Fixed to the land at its place, as paths are.
 */
export interface TextShape { kind: 'text'; at: LL; text: string; size: number; font: string; weight: number; italic: boolean; angle: number }
export type DrawShape = PathShape | TextShape;
/** A new text's look (D253). */
export const NEW_TEXT: Omit<TextShape, 'kind' | 'at' | 'text'> = { size: 28, font: 'Georgia', weight: 600, italic: false, angle: 0 };
/** The longest words a text holds. */
export const MOST_TEXT = 200;
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
  /**
   * Fixed to the land (its shapes in degrees; the country's borders cut it), or a pattern that follows the country
   * (D254): its shapes in pixels of a frame 1920 wide within a tile `tile` wide and high, repeated over the country's
   * land wherever it lies, the tile's middle on the middle of the country.
   */
  mode: 'land' | 'pattern';
  tile: [number, number] | null;
  /** Effects on the drawing (D255): drop shadows and outer glows, cast from what it draws, in order. */
  effects: Effect[];
  shapes: DrawShape[];
}
/** The effects a drawing takes (D255). */
export const DRAWING_EFFECTS = ['shadow', 'outer-glow'] as const;

/** A new drawing's looks: a dark line two pixels wide, not filled, as drawn, fixed to the land. */
export const NEW_DRAWING: Omit<Drawing, 'id' | 'name' | 'shapes'> = { on: true, stroke: { color: '#2b1d12', width: 2 }, fill: null, opacity: 1, blend: 'normal', mode: 'land', tile: null, effects: [] };
/** The widest and highest tile a pattern has (pixels of a frame 1920 wide). */
export const MOST_TILE = 2000;
/** At most, for a country: drawings, shapes in a drawing, anchors in a shape. */
export const MOST_DRAWINGS = 40, MOST_SHAPES = 400, MOST_ANCHORS = 4000;
/** The widest line a drawing can have (pixels of a frame 1920 wide). */
export const MOST_WIDTH = 200;

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
/** Where a shape's points may lie: in degrees on the land, or in a pattern's tile (pixels, with room either side). */
type Bound = 'land' | 'tile';
const ptIn = (v: unknown, b: Bound): LL | null =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1])
    && (b === 'land' ? Math.abs(v[0]) <= 540 && Math.abs(v[1]) <= 90 : Math.abs(v[0]) <= 2 * MOST_TILE && Math.abs(v[1]) <= 2 * MOST_TILE)
    ? [v[0], v[1]] : null;
const llOf = (v: unknown) => ptIn(v, 'land');

function anchorOf(v: unknown, b: Bound = 'land'): DrawAnchor | null {
  const a = v as { p?: unknown; i?: unknown; o?: unknown } | null;
  const p = a ? ptIn(a.p, b) : null;
  if (!p) return null;
  const out: DrawAnchor = { p };
  const i = ptIn(a!.i, b), o = ptIn(a!.o, b);
  if (i) out.i = i;
  if (o) out.o = o;
  return out;
}

/** A shape as kept, checked (null: not a shape this version knows, or one with too few points to draw). */
export function shapeOf(v: unknown, b: Bound = 'land'): DrawShape | null {
  const s = v as { kind?: unknown; anchors?: unknown; closed?: unknown } | null;
  if (s?.kind === 'text') {
    const t = v as Partial<Record<keyof TextShape, unknown>>;
    const at = ptIn(t.at, b), text = typeof t.text === 'string' ? t.text.trim().slice(0, MOST_TEXT) : '';
    if (!at || !text) return null;
    const font = typeof t.font === 'string' && t.font.trim() ? t.font.trim().slice(0, 60) : NEW_TEXT.font;
    return { kind: 'text', at, text, size: num(t.size, 4, 400, NEW_TEXT.size), font, weight: Math.round(num(t.weight, 100, 900, NEW_TEXT.weight) / 100) * 100, italic: t.italic === true, angle: num(t.angle, -360, 360, 0) };
  }
  if (!s || s.kind !== 'path' || !Array.isArray(s.anchors)) return null;
  const anchors = s.anchors.slice(0, MOST_ANCHORS).map((a) => anchorOf(a, b)).filter((a): a is DrawAnchor => !!a);
  if (anchors.length < 2) return null;
  return { kind: 'path', anchors, closed: s.closed === true && anchors.length >= 2 };
}

/** A drawing as kept, checked: unknown fields dropped, numbers held to their ranges (null: not a drawing). */
export function drawingOf(v: unknown): Drawing | null {
  const d = v as Partial<Record<keyof Drawing, unknown>> | null;
  if (!d || typeof d.id !== 'string' || !d.id) return null;
  const st = d.stroke as { color?: unknown; width?: unknown } | null | undefined;
  // (A pattern needs its tile; without one it is taken for a drawing on the land.)
  const tl = d.tile as unknown[] | null | undefined;
  const tile: [number, number] | null = Array.isArray(tl) && tl.length === 2 && typeof tl[0] === 'number' && typeof tl[1] === 'number' && tl[0] >= 1 && tl[1] >= 1
    ? [Math.min(MOST_TILE, tl[0]), Math.min(MOST_TILE, tl[1])] : null;
  const mode = d.mode === 'pattern' && tile ? 'pattern' : 'land';
  return {
    id: d.id,
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 80) : 'Drawing',
    on: d.on !== false,
    stroke: st && isColor(st.color) ? { color: st.color, width: num(st.width, 0.1, MOST_WIDTH, 2) } : null,
    fill: isColor(d.fill) ? d.fill : null,
    opacity: num(d.opacity, 0, 1, 1),
    blend: (BLEND_MODES as readonly string[]).includes(d.blend as string) ? (d.blend as BlendMode) : 'normal',
    mode,
    tile: mode === 'pattern' ? tile : null,
    effects: Array.isArray(d.effects) ? d.effects.slice(0, 8).map(effectOf).filter((e): e is Effect => !!e && (DRAWING_EFFECTS as readonly string[]).includes(e.kind)) : [],
    shapes: Array.isArray(d.shapes) ? d.shapes.slice(0, MOST_SHAPES).map((x) => shapeOf(x, mode === 'pattern' ? 'tile' : 'land')).filter((x): x is DrawShape => !!x) : [],
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

/** A path's anchors without those that fall on the one before on the screen (a double-click's second press, D252). */
export function withoutRepeats(anchors: DrawAnchor[], project: (ll: LL) => Pt | null, px = 2): DrawAnchor[] {
  const out: DrawAnchor[] = [];
  let prev: Pt | null = null;
  for (const a of anchors) {
    const q = project(a.p);
    if (prev && q && Math.hypot(q[0] - prev[0], q[1] - prev[1]) <= px && !a.i && !a.o) continue;
    out.push(a);
    if (q) prev = q;
  }
  return out;
}

/** Whether a drawing shows anything: shown, at some strength, with a shape and a line or a fill to draw it with. */
export const drawingShows = (d: Drawing) => d.on && d.opacity > 0 && d.shapes.length > 0 && (!!d.stroke || (!!d.fill && d.shapes.some((s) => s.kind === 'text' || s.closed)));

/** The canvas's font for a text at `px` pixels high (D253). */
export function textFont(t: TextShape, px: number): string {
  const family = /[\s,]/.test(t.font) && !t.font.includes('"') ? `"${t.font}"` : t.font;
  return `${t.italic ? 'italic ' : ''}${t.weight} ${px.toFixed(1)}px ${family}, Georgia, serif`;
}

/** About how wide a text is, as a share of its height (an average letter's width; for what lies under the pointer). */
const TEXT_WIDTH = 0.56;
/** A text's box on the screen: its middle, half its width and height, and its turn (null: its place off the map). */
export function textBox(t: TextShape, project: (ll: LL) => Pt | null, unit: number): { at: Pt; hw: number; hh: number; angle: number } | null {
  const at = project(t.at);
  if (!at) return null;
  const h = t.size * unit;
  return { at, hw: (TEXT_WIDTH * h * Math.max(1, t.text.length)) / 2, hh: h / 2, angle: t.angle };
}

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
export function hitsShape(s: DrawShape, project: (ll: LL) => Pt | null, at: Pt, filled: boolean, half: number, tol = 5, unit = 1): boolean {
  if (s.kind === 'text') {
    // (Within its box, turned with it.)
    const b = textBox(s, project, unit);
    if (!b) return false;
    const a = (-b.angle * Math.PI) / 180, dx = at[0] - b.at[0], dy = at[1] - b.at[1];
    const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(x) <= b.hw + tol && Math.abs(y) <= b.hh + tol;
  }
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
    // (A pattern lies everywhere on the country: chosen in its parts, not by a click.)
    if (!d.on || d.mode === 'pattern') continue;
    const half = d.stroke ? (d.stroke.width * unit) / 2 : 0;
    if (d.shapes.some((s) => hitsShape(s, project, at, !!d.fill, half, 5, unit))) return d;
  }
  return null;
}

/** Every point of a shape (anchors and handles, a text's place), mapped by `f` (null if any maps to nothing). */
function mapShape(s: DrawShape, f: (p: LL) => LL | null): DrawShape | null {
  if (s.kind === 'text') { const at = f(s.at); return at ? { ...s, at } : null; }
  const anchors: DrawAnchor[] = [];
  for (const a of s.anchors) {
    const p = f(a.p), i = a.i ? f(a.i) : null, o = a.o ? f(a.o) : null;
    if (!p || (a.i && !i) || (a.o && !o)) return null;
    anchors.push({ p, ...(i ? { i } : {}), ...(o ? { o } : {}) });
  }
  return { ...s, anchors };
}

/**
 * A drawing on the land made a pattern that follows the country (D254): its shapes as they look on the screen now, in
 * pixels of a frame 1920 wide, within a tile as large as they are with `gap` pixels of room round them (and the line's
 * width). Null if any of it is off the map.
 */
export function toPattern(d: Drawing, project: (ll: LL) => Pt | null, unit: number, gap = 12): Drawing | null {
  if (d.mode === 'pattern' || !d.shapes.length) return null;
  const px = (ll: LL): LL | null => { const q = project(ll); return q ? [q[0] / unit, q[1] / unit] : null; };
  const shapes: DrawShape[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (p: LL, rx = 0, ry = 0) => { x0 = Math.min(x0, p[0] - rx); y0 = Math.min(y0, p[1] - ry); x1 = Math.max(x1, p[0] + rx); y1 = Math.max(y1, p[1] + ry); };
  for (const s of d.shapes) {
    const m = mapShape(s, px);
    if (!m) return null;
    if (m.kind === 'text') { const b = textBox(m, (q) => q, 1)!; take(m.at, Math.hypot(b.hw, b.hh), Math.hypot(b.hw, b.hh)); }
    else for (const a of m.anchors) for (const q of [a.p, a.i, a.o]) if (q) take(q);
    shapes.push(m);
  }
  const pad = gap / 2 + (d.stroke ? d.stroke.width : 0);
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  if (!(w >= 1 && h >= 1) || w > MOST_TILE || h > MOST_TILE) return null;
  const dx = pad - x0, dy = pad - y0;
  return { ...d, mode: 'pattern', tile: [w, h], shapes: shapes.map((s) => mapShape(s, (p) => [p[0] + dx, p[1] + dy])!) };
}

/**
 * A pattern laid back on the land (D254): one tile of it with its middle at `middle` (a point of the screen), its
 * shapes turned into degrees as they are seen there. Null if any of it is off the map.
 */
export function toLand(d: Drawing, unproject: (p: Pt) => LL | null, unit: number, middle: Pt): Drawing | null {
  if (d.mode !== 'pattern' || !d.tile) return null;
  const [w, h] = d.tile;
  const shapes: DrawShape[] = [];
  for (const s of d.shapes) {
    const m = mapShape(s, (p) => unproject([middle[0] + (p[0] - w / 2) * unit, middle[1] + (p[1] - h / 2) * unit]));
    if (!m) return null;
    shapes.push(m);
  }
  return { ...d, mode: 'land', tile: null, shapes };
}
