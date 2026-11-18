// A pen that is drawn on as a 2D canvas is and writes SVG (Stage 10, D115). It takes the part of
// CanvasRenderingContext2D that the map's own drawing of areas, lines, points, cities, names,
// characters, stars and texts uses, so SVG frames are drawn by the same code as the pictures: what
// that code draws as paths and text becomes shapes and text a drawing program can edit, and what it
// draws as pictures (icons, flags, layers it builds offscreen) stays a picture. Painting other than
// plain painting over (erasing, masking) and shadows are left out.
//
// Paths follow the canvas's rules: points are placed through the transform of the moment they are
// added, and a path is filled or stroked through the transform of that moment (so line widths, dashes
// and patterns are in its units). Each shape is written with that transform and its points in its
// units; text likewise.

type Mat = [number, number, number, number, number, number];
const I: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const isIdentity = (m: Mat) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
const matOf = (a: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number): Mat =>
  typeof a === 'number' ? [a, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0] : [a.a ?? a.m11 ?? 1, a.b ?? a.m12 ?? 0, a.c ?? a.m21 ?? 0, a.d ?? a.m22 ?? 1, a.e ?? a.m41 ?? 0, a.f ?? a.m42 ?? 0];

/** A number for SVG: rounded to `digits` decimals, without trailing zeros. */
export function num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '0';
  let s = v.toFixed(digits);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

/** Text made safe for XML (attributes and content). */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'))
    // (Characters XML does not allow.)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

const matAttr = (m: Mat, digits = 4) => (isIdentity(m) ? '' : ` transform="matrix(${m.map((v, i) => num(v, i < 4 ? 6 : digits)).join(' ')})"`);

/** Digits that keep a shape's points to a hundredth of a pixel through its transform. */
const digitsFor = (m: Mat) => {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  return Math.max(0, Math.min(8, Math.ceil(Math.log10(s * 100))));
};

// Path commands, flattened: 0 move (x y), 1 line (x y), 2 curve (x1 y1 x2 y2 x y), 3 close.
const M = 0, L = 1, C = 2, Z = 3;

/**
 * The bezier curves of an elliptical arc (canvas rules for the sweep): its start point, then each
 * curve's two control points and end point.
 */
export function arcCurves(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean): number[] {
  const TAU = Math.PI * 2;
  let sweep: number;
  if (!ccw) sweep = a1 - a0 >= TAU ? TAU : ((a1 - a0) % TAU + TAU) % TAU;
  else sweep = a0 - a1 >= TAU ? -TAU : -(((a0 - a1) % TAU + TAU) % TAU);
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const d = sweep / n, k = (4 / 3) * Math.tan(d / 4);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const pt = (x: number, y: number) => [cx + rx * x * cr - ry * y * sr, cy + rx * x * sr + ry * y * cr];
  const out = pt(Math.cos(a0), Math.sin(a0));
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * d, t1 = t0 + d;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    out.push(...pt(c0 - k * s0, s0 + k * c0), ...pt(c1 + k * s1, s1 - k * c1), ...pt(c1, s1));
  }
  return out;
}

/** A path recorded as a Path2D is built (it stands in for Path2D while a pen is drawn on, see withSvgPaths). */
export class SvgPath {
  cmds: number[] = [];
  /** Paths given as SVG path data (`new Path2D(d)`), with the transform they were added through. */
  raw: Array<{ d: string; m: Mat }> = [];
  private sx = 0; private sy = 0; private cx = 0; private cy = 0; private has = false;
  constructor(src?: string | SvgPath | Path2D) {
    if (typeof src === 'string') { if (src.trim()) this.raw.push({ d: src, m: I }); }
    else if (src instanceof SvgPath) { this.cmds = src.cmds.slice(); this.raw = src.raw.slice(); }
  }
  /** Points come through `m` (the pen's transform for its own current path; none for a Path2D). */
  protected place(x: number, y: number): [number, number] { return [x, y]; }
  moveTo(x: number, y: number): void { const [a, b] = this.place(x, y); this.cmds.push(M, a, b); this.sx = this.cx = a; this.sy = this.cy = b; this.has = true; }
  lineTo(x: number, y: number): void {
    if (!this.has) { this.moveTo(x, y); return; }
    const [a, b] = this.place(x, y); this.cmds.push(L, a, b); this.cx = a; this.cy = b;
  }
  closePath(): void { if (this.has) { this.cmds.push(Z); this.cx = this.sx; this.cy = this.sy; } }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!this.has) this.moveTo(x1, y1);
    const [a1, b1] = this.place(x1, y1), [a2, b2] = this.place(x2, y2), [a, b] = this.place(x, y);
    this.cmds.push(C, a1, b1, a2, b2, a, b); this.cx = a; this.cy = b;
  }
  quadraticCurveTo(qx: number, qy: number, x: number, y: number): void {
    if (!this.has) this.moveTo(qx, qy);
    // (As a cubic: the current point is kept placed already, so the control points are worked out placed.)
    const [px, py] = [this.cx, this.cy], [a, b] = this.place(qx, qy), [ex, ey] = this.place(x, y);
    this.cmds.push(C, px + (2 / 3) * (a - px), py + (2 / 3) * (b - py), ex + (2 / 3) * (a - ex), ey + (2 / 3) * (b - ey), ex, ey);
    this.cx = ex; this.cy = ey;
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void { this.ellipse(x, y, r, r, 0, a0, a1, ccw); }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    const c = arcCurves(x, y, Math.abs(rx), Math.abs(ry), rot, a0, a1, ccw);
    if (this.has) this.lineTo(c[0], c[1]); else this.moveTo(c[0], c[1]);
    for (let i = 2; i + 5 < c.length + 1; i += 6) this.bezierCurveTo(c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5]);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (!this.has) { this.moveTo(x1, y1); return; }
    // (The corner rounded with radius r, worked out in the units the points are given in.)
    const inv = this.unplace();
    const [x0, y0] = inv ? [inv[0] * this.cx + inv[2] * this.cy + inv[4], inv[1] * this.cx + inv[3] * this.cy + inv[5]] : [this.cx, this.cy];
    const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const cos = la && lb ? (ax * bx + ay * by) / (la * lb) : 1;
    if (!r || Math.abs(cos) > 1 - 1e-9) { this.lineTo(x1, y1); return; }
    const half = Math.acos(cos) / 2, dist = r / Math.tan(half);
    const p0x = x1 + (ax / la) * dist, p0y = y1 + (ay / la) * dist, p1x = x1 + (bx / lb) * dist, p1y = y1 + (by / lb) * dist;
    // (Each control point lies along its tangent toward the corner, (4/3) tan(angle / 4) r from the arc's end.)
    const h = ((4 / 3) * Math.tan((Math.PI - 2 * half) / 4) * r) / dist;
    this.lineTo(p0x, p0y);
    this.bezierCurveTo(p0x + (x1 - p0x) * h, p0y + (y1 - p0y) * h, p1x + (x1 - p1x) * h, p1y + (y1 - p1y) * h, p1x, p1y);
  }
  /** The transform points are placed through, undone (none for a Path2D). */
  protected unplace(): Mat | null { return null; }
  rect(x: number, y: number, w: number, h: number): void { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); this.moveTo(x, y); }
  roundRect(x: number, y: number, w: number, h: number, radii: number | DOMPointInit | Array<number | DOMPointInit> = 0): void {
    const list = Array.isArray(radii) ? radii : [radii];
    const rv = list.map((v) => (typeof v === 'number' ? v : v.x ?? 0));
    const [tl, tr, br, bl] = rv.length === 1 ? [rv[0], rv[0], rv[0], rv[0]] : rv.length === 2 ? [rv[0], rv[1], rv[0], rv[1]] : rv.length === 3 ? [rv[0], rv[1], rv[2], rv[1]] : [rv[0], rv[1], rv[2], rv[3]];
    const k = Math.min(1, Math.abs(w) / Math.max(1e-9, tl + tr, bl + br), Math.abs(h) / Math.max(1e-9, tl + bl, tr + br));
    const [a, b, c, d] = [tl * k, tr * k, br * k, bl * k];
    this.moveTo(x + a, y);
    this.lineTo(x + w - b, y); if (b) this.ellipse(x + w - b, y + b, b, b, 0, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - c); if (c) this.ellipse(x + w - c, y + h - c, c, c, 0, 0, Math.PI / 2);
    this.lineTo(x + d, y + h); if (d) this.ellipse(x + d, y + h - d, d, d, 0, Math.PI / 2, Math.PI);
    this.lineTo(x, y + a); if (a) this.ellipse(x + a, y + a, a, a, 0, Math.PI, Math.PI * 1.5);
    this.closePath();
    this.moveTo(x, y);
  }
  addPath(p: SvgPath | Path2D, m?: DOMMatrix2DInit): void {
    if (!(p instanceof SvgPath)) return;
    const t = m ? matOf(m) : I;
    for (let i = 0; i < p.cmds.length;) {
      const op = p.cmds[i++], n = op === C ? 6 : op === Z ? 0 : 2;
      this.cmds.push(op);
      for (let j = 0; j < n; j += 2) { const x = p.cmds[i + j], y = p.cmds[i + j + 1]; this.cmds.push(t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]); }
      i += n;
    }
    for (const r of p.raw) this.raw.push({ d: r.d, m: mul(t, r.m) });
    this.has = this.has || p.cmds.length > 0;
  }
  get empty(): boolean { return !this.cmds.length && !this.raw.length; }
}

/** Path data for commands, each point through `m` first (when given). */
function pathData(cmds: number[], digits: number, m: Mat | null): string {
  const out: string[] = [];
  const p = (x: number, y: number) => (m ? `${num(m[0] * x + m[2] * y + m[4], digits)} ${num(m[1] * x + m[3] * y + m[5], digits)}` : `${num(x, digits)} ${num(y, digits)}`);
  // (A move is written only when something is drawn from it: rect() and the like end with one.)
  let move = '';
  for (let i = 0; i < cmds.length;) {
    const op = cmds[i++];
    if (op === M) { move = `M${p(cmds[i], cmds[i + 1])}`; i += 2; continue; }
    if (move) { out.push(move); move = ''; }
    if (op === L) { out.push(`L${p(cmds[i], cmds[i + 1])}`); i += 2; }
    else if (op === C) { out.push(`C${p(cmds[i], cmds[i + 1])} ${p(cmds[i + 2], cmds[i + 3])} ${p(cmds[i + 4], cmds[i + 5])}`); i += 6; }
    else if (out.length) out.push('Z');
  }
  return out.join('');
}

/** The pen's own current path: points placed through the pen's transform as they are added. */
class PlacedPath extends SvgPath {
  private readonly at: () => Mat;
  constructor(at: () => Mat) { super(); this.at = at; }
  protected override place(x: number, y: number): [number, number] { const m = this.at(); return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  protected override unplace(): Mat | null { return invert(this.at()); }
}

/** A colour as SVG writes it: '#rrggbb' and an opacity (null when it cannot be read: given as it is). */
export function svgColour(c: string): { color: string; opacity: number } {
  const s = c.trim().toLowerCase();
  if (s === 'transparent') return { color: '#000000', opacity: 0 };
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { color: `#${h.slice(0, 6)}`, opacity: a };
  }
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) {
    const hex = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0');
    const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
    return { color: `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`, opacity: Math.max(0, Math.min(1, a)) };
  }
  return { color: c, opacity: 1 };
}

/** A gradient made on the pen (as CanvasGradient). */
export class SvgGradient {
  stops: Array<[number, string]> = [];
  readonly kind: 'linear' | 'radial';
  readonly at: number[];
  constructor(kind: 'linear' | 'radial', at: number[]) { this.kind = kind; this.at = at; }
  addColorStop(offset: number, color: string): void { this.stops.push([offset, color]); }
}

/** A pattern made on the pen (as CanvasPattern): its picture, how it repeats, its own transform. */
export class SvgPattern {
  m: Mat = I;
  readonly image: CanvasImageSource;
  readonly repetition: string | null;
  constructor(image: CanvasImageSource, repetition: string | null) { this.image = image; this.repetition = repetition; }
  setTransform(t?: DOMMatrix2DInit): void { this.m = t ? matOf(t) : I; }
}

type Paint = string | SvgGradient | SvgPattern;

interface PenState {
  m: Mat; alpha: number; fill: Paint; stroke: Paint; lineWidth: number; lineJoin: CanvasLineJoin; lineCap: CanvasLineCap; miterLimit: number;
  dash: number[]; dashOffset: number; font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline; letterSpacing: string;
  composite: GlobalCompositeOperation; clip: string | null;
}

/** The size of a picture source (0 when it has none yet). */
function sourceSize(s: CanvasImageSource): [number, number] {
  const o = s as unknown as Record<string, number>;
  if (typeof HTMLImageElement !== 'undefined' && s instanceof HTMLImageElement) return [s.naturalWidth || s.width, s.naturalHeight || s.height];
  if (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  if (typeof o.displayWidth === 'number') return [o.displayWidth, o.displayHeight];
  return [o.width ?? 0, o.height ?? 0];
}

const pictureIds = new WeakMap<object, number>();
let pictureCount = 0;

/**
 * Writes SVG. Draw on it as on a CanvasRenderingContext2D (`asContext`), then take what was drawn
 * with `body()` (shapes, text and pictures, in order) and `defs()` (what they refer to). `prefix`
 * keeps the ids of several pens in one document apart.
 */
export class SvgPen {
  readonly canvas: { width: number; height: number };
  private st: PenState;
  private stack: PenState[] = [];
  private path: PlacedPath;
  private out: string[] = [];
  private defsOut: string[] = [];
  private ids = 0;
  private pictures = new Map<string, string>();
  /** Drawing the pen leaves out (painting other than over, say), counted by kind. */
  readonly skipped = new Map<string, number>();
  /** Measures text as the canvas would (null: estimated). */
  private measurer: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  private readonly prefix: string;
  constructor(width: number, height: number, prefix = 'p') {
    this.prefix = prefix;
    this.canvas = { width, height };
    this.st = { m: I, alpha: 1, fill: '#000000', stroke: '#000000', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt', miterLimit: 10, dash: [], dashOffset: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', letterSpacing: '0px', composite: 'source-over', clip: null };
    this.path = new PlacedPath(() => this.st.m);
    if (typeof OffscreenCanvas !== 'undefined') this.measurer = new OffscreenCanvas(4, 4).getContext('2d');
  }

  /** The pen as a canvas context, for drawing code written for one. */
  asContext(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }

  // ---- state
  get fillStyle(): Paint { return this.st.fill; } set fillStyle(v: Paint) { this.st.fill = v; }
  get strokeStyle(): Paint { return this.st.stroke; } set strokeStyle(v: Paint) { this.st.stroke = v; }
  get lineWidth(): number { return this.st.lineWidth; } set lineWidth(v: number) { if (v > 0 && Number.isFinite(v)) this.st.lineWidth = v; }
  get lineJoin(): CanvasLineJoin { return this.st.lineJoin; } set lineJoin(v: CanvasLineJoin) { this.st.lineJoin = v; }
  get lineCap(): CanvasLineCap { return this.st.lineCap; } set lineCap(v: CanvasLineCap) { this.st.lineCap = v; }
  get miterLimit(): number { return this.st.miterLimit; } set miterLimit(v: number) { this.st.miterLimit = v; }
  get lineDashOffset(): number { return this.st.dashOffset; } set lineDashOffset(v: number) { this.st.dashOffset = v; }
  get globalAlpha(): number { return this.st.alpha; } set globalAlpha(v: number) { if (v >= 0 && v <= 1) this.st.alpha = v; }
  get globalCompositeOperation(): GlobalCompositeOperation { return this.st.composite; } set globalCompositeOperation(v: GlobalCompositeOperation) { this.st.composite = v; }
  get font(): string { return this.st.font; } set font(v: string) { this.st.font = v; }
  get textAlign(): CanvasTextAlign { return this.st.textAlign; } set textAlign(v: CanvasTextAlign) { this.st.textAlign = v; }
  get textBaseline(): CanvasTextBaseline { return this.st.textBaseline; } set textBaseline(v: CanvasTextBaseline) { this.st.textBaseline = v; }
  get letterSpacing(): string { return this.st.letterSpacing; } set letterSpacing(v: string) { this.st.letterSpacing = v; }
  // (Kept but not written.)
  shadowBlur = 0; shadowColor = 'transparent'; shadowOffsetX = 0; shadowOffsetY = 0; filter = 'none';
  imageSmoothingEnabled = true; imageSmoothingQuality: ImageSmoothingQuality = 'low'; direction: CanvasDirection = 'inherit';
  fontKerning: CanvasFontKerning = 'auto'; wordSpacing = '0px';

  setLineDash(d: number[]): void { if (d.every((v) => Number.isFinite(v) && v >= 0)) this.st.dash = d.length % 2 ? [...d, ...d] : d.slice(); }
  getLineDash(): number[] { return this.st.dash.slice(); }
  save(): void { this.stack.push({ ...this.st, dash: this.st.dash.slice() }); }
  restore(): void { const s = this.stack.pop(); if (s) this.st = s; }
  reset(): void { this.stack = []; this.st = { ...this.st, m: I, alpha: 1, clip: null, composite: 'source-over' }; this.beginPath(); }

  // ---- transforms
  getTransform(): DOMMatrix {
    const m = this.st.m;
    if (typeof DOMMatrix !== 'undefined') return new DOMMatrix([...m]);
    return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5], is2D: true } as unknown as DOMMatrix;
  }
  setTransform(a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number): void { this.st.m = a === undefined ? I : matOf(a, b, c, d, e, f); }
  resetTransform(): void { this.st.m = I; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.st.m = mul(this.st.m, [a, b, c, d, e, f]); }
  translate(x: number, y: number): void { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number): void { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a: number): void { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }

  // ---- the current path
  beginPath(): void { this.path = new PlacedPath(() => this.st.m); }
  moveTo(x: number, y: number): void { this.path.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.path.lineTo(x, y); }
  closePath(): void { this.path.closePath(); }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void { this.path.bezierCurveTo(a, b, c, d, e, f); }
  quadraticCurveTo(a: number, b: number, c: number, d: number): void { this.path.quadraticCurveTo(a, b, c, d); }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void { this.path.arc(x, y, r, a0, a1, ccw); }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void { this.path.arcTo(x1, y1, x2, y2, r); }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void { this.path.ellipse(x, y, rx, ry, rot, a0, a1, ccw); }
  rect(x: number, y: number, w: number, h: number): void { this.path.rect(x, y, w, h); }
  roundRect(x: number, y: number, w: number, h: number, r?: number | DOMPointInit | Array<number | DOMPointInit>): void { this.path.roundRect(x, y, w, h, r); }
  isPointInPath(): boolean { return false; }
  isPointInStroke(): boolean { return false; }

  // ---- drawing
  /** Path data and the transform to write it with: a path given (its own units, through the transform now), or the current path (placed already, written in the units of now). */
  private shapeOf(p: SvgPath | Path2D | CanvasFillRule | undefined): { d: string; m: Mat } | null {
    const m = this.st.m;
    if (p instanceof SvgPath) {
      if (p.empty) return null;
      const digits = digitsFor(m);
      let d = pathData(p.cmds, digits, null);
      for (const r of p.raw) d += isIdentity(r.m) ? r.d : pathData(rawToCmds(r.d), digits, r.m);
      return { d, m };
    }
    if (p && typeof p === 'object') { this.skip('a Path2D made before drawing began'); return null; }
    if (this.path.empty) return null;
    const inv = invert(m);
    if (!inv) return null;
    return { d: pathData(this.path.cmds, digitsFor(m), isIdentity(m) ? null : inv), m };
  }
  private skip(why: string): void { this.skipped.set(why, (this.skipped.get(why) ?? 0) + 1); }
  private painting(): boolean {
    if (this.st.composite === 'source-over') return true;
    this.skip(`painting by ${this.st.composite}`);
    return false;
  }
  fill(a?: SvgPath | Path2D | CanvasFillRule, b?: CanvasFillRule): void {
    if (!this.painting()) return;
    const rule = typeof a === 'string' ? a : b;
    const s = this.shapeOf(typeof a === 'string' ? undefined : a);
    if (!s) return;
    const paint = this.paint('fill', this.st.fill);
    if (!paint) return;
    this.emit(`<path d="${s.d}"${matAttr(s.m)}${paint}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${this.alphaAttr()}/>`);
  }
  stroke(p?: SvgPath | Path2D): void {
    if (!this.painting()) return;
    const s = this.shapeOf(p);
    if (!s) return;
    const paint = this.paint('stroke', this.st.stroke);
    if (!paint) return;
    this.emit(`<path d="${s.d}"${matAttr(s.m)} fill="none"${paint}${this.lineAttrs()}${this.alphaAttr()}/>`);
  }
  fillRect(x: number, y: number, w: number, h: number): void { const p = new SvgPath(); p.rect(x, y, w, h); this.fill(p); }
  strokeRect(x: number, y: number, w: number, h: number): void { const p = new SvgPath(); p.rect(x, y, w, h); this.stroke(p); }
  clearRect(): void { /* The pen starts empty; erasing what it drew is not written. */ }
  clip(a?: SvgPath | Path2D | CanvasFillRule, b?: CanvasFillRule): void {
    const rule = typeof a === 'string' ? a : b;
    const given = typeof a === 'string' ? undefined : a;
    // (A Path2D the pen cannot read: not clipped at all, rather than everything clipped away.)
    if (given && !(given instanceof SvgPath)) { this.skip('a clip by a Path2D made before drawing began'); return; }
    const s = this.shapeOf(given);
    const id = `${this.prefix}c${++this.ids}`;
    // (An empty path clips everything away, as on a canvas.)
    const d = s?.d ?? 'M0 0Z';
    this.defsOut.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"${this.st.clip ? ` clip-path="url(#${this.st.clip})"` : ''}><path d="${d}"${s ? matAttr(s.m) : ''}${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    this.st.clip = id;
  }

  private alphaAttr(): string { return this.st.alpha < 1 ? ` opacity="${num(this.st.alpha, 3)}"` : ''; }
  private lineAttrs(): string {
    const s = this.st;
    let a = ` stroke-width="${num(s.lineWidth, 3)}"`;
    if (s.lineJoin !== 'miter') a += ` stroke-linejoin="${s.lineJoin}"`;
    else if (s.miterLimit !== 4) a += ` stroke-miterlimit="${num(s.miterLimit, 2)}"`;
    if (s.lineCap !== 'butt') a += ` stroke-linecap="${s.lineCap}"`;
    if (s.dash.length) a += ` stroke-dasharray="${s.dash.map((v) => num(v, 3)).join(' ')}"${s.dashOffset ? ` stroke-dashoffset="${num(s.dashOffset, 3)}"` : ''}`;
    return a;
  }
  /** fill="…" or stroke="…" (with its opacity) for a paint; '' when it paints nothing. */
  private paint(kind: 'fill' | 'stroke', p: Paint): string {
    if (typeof p === 'string') {
      const c = svgColour(p);
      if (c.opacity <= 0) return '';
      return ` ${kind}="${esc(c.color)}"${c.opacity < 1 ? ` ${kind}-opacity="${num(c.opacity, 3)}"` : ''}`;
    }
    const id = `${this.prefix}g${++this.ids}`;
    if (p instanceof SvgGradient) {
      const stops = p.stops.slice().sort((x, y) => x[0] - y[0]).map(([o, col]) => { const c = svgColour(col); return `<stop offset="${num(o, 4)}" stop-color="${esc(c.color)}"${c.opacity < 1 ? ` stop-opacity="${num(c.opacity, 3)}"` : ''}/>`; }).join('');
      const [a, b, c, d, e, f] = p.at.map((v) => num(v, 3));
      this.defsOut.push(p.kind === 'linear'
        ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a}" y1="${b}" x2="${c}" y2="${d}">${stops}</linearGradient>`
        : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" fx="${a}" fy="${b}" cx="${d}" cy="${e}" r="${f}">${stops}</radialGradient>`);
      return ` ${kind}="url(#${id})"`;
    }
    const [w, h] = sourceSize(p.image);
    const href = this.pictureOf(p.image, 0, 0, w, h);
    if (!href || !w || !h) return '';
    this.defsOut.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${w}" height="${h}"${matAttr(p.m).replace('transform=', 'patternTransform=')}><image width="${w}" height="${h}" xlink:href="${href}"/></pattern>`);
    return ` ${kind}="url(#${id})"`;
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SvgGradient { return new SvgGradient('linear', [x0, y0, x1, y1]); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SvgGradient {
    // (SVG has no inner circle with a radius: the gradient starts at its focus; an inner radius is
    // kept by moving the first stops out, see below.)
    const g = new SvgGradient('radial', [x0, y0, r0, x1, y1, r1]);
    const add = g.addColorStop.bind(g);
    g.addColorStop = (o: number, c: string) => add(r1 > 0 ? (r0 + o * (r1 - r0)) / r1 : o, c);
    return g;
  }
  createPattern(image: CanvasImageSource, repetition: string | null): SvgPattern { return new SvgPattern(image, repetition); }

  // ---- text
  /** The parts of a canvas font: style, weight, size (px) and family. */
  static fontParts(font: string): { style: string; weight: string; size: number; family: string } {
    const m = /^\s*((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|\d{3})\s+)*)([\d.]+)px(?:\s*\/\s*[\d.]+(?:px)?)?\s+(.+)$/i.exec(font);
    if (!m) return { style: 'normal', weight: '400', size: 10, family: 'sans-serif' };
    const words = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    const style = words.find((w) => w === 'italic' || w === 'oblique') ?? 'normal';
    const weight = words.find((w) => /^\d{3}$/.test(w) || w === 'bold' || w === 'bolder' || w === 'lighter') ?? '400';
    return { style, weight: weight === 'bold' ? '700' : weight, size: Number(m[2]), family: m[3].trim() };
  }
  measureText(text: string): TextMetrics {
    const mz = this.measurer;
    if (mz) {
      mz.font = this.st.font;
      (mz as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = this.st.letterSpacing;
      mz.textAlign = this.st.textAlign;
      mz.textBaseline = this.st.textBaseline;
      return mz.measureText(text);
    }
    const size = SvgPen.fontParts(this.st.font).size, w = 0.55 * size * [...text].length;
    return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: 0.72 * size, actualBoundingBoxDescent: 0.2 * size, fontBoundingBoxAscent: 0.9 * size, fontBoundingBoxDescent: 0.25 * size } as TextMetrics;
  }
  /** How far below a text's place its baseline lies for the pen's baseline setting (the canvas's own placing, measured). */
  private baselineShift(size: number): number {
    const b = this.st.textBaseline;
    if (b === 'alphabetic') return 0;
    let asc = 0.9 * size, desc = 0.25 * size, hang = 0.8 * size;
    const mz = this.measurer;
    if (mz) {
      // (The browser says where the alphabetic baseline lies from the one asked for: exactly where the canvas puts the text.)
      mz.font = this.st.font;
      mz.textBaseline = b;
      const at = (mz.measureText('Hg') as TextMetrics & { alphabeticBaseline?: number }).alphabeticBaseline;
      if (typeof at === 'number' && Number.isFinite(at)) return -at;
      mz.textBaseline = 'alphabetic';
      const t = mz.measureText('Hg');
      if (t.fontBoundingBoxAscent !== undefined) { asc = t.fontBoundingBoxAscent; desc = t.fontBoundingBoxDescent; }
      hang = (t as TextMetrics & { hangingBaseline?: number }).hangingBaseline ?? 0.8 * asc;
    }
    if (b === 'middle') return (asc - desc) / 2;
    if (b === 'top') return asc;
    if (b === 'hanging') return hang;
    if (b === 'bottom') return -desc;
    if (b === 'ideographic') return -desc;
    return 0;
  }
  private text(kind: 'fill' | 'stroke', text: string, x: number, y: number, maxWidth?: number): void {
    if (!this.painting() || !text) return;
    const paint = this.paint(kind, kind === 'fill' ? this.st.fill : this.st.stroke);
    if (!paint) return;
    const f = SvgPen.fontParts(this.st.font);
    const anchor = this.st.textAlign === 'center' ? 'middle' : this.st.textAlign === 'right' || this.st.textAlign === 'end' ? 'end' : 'start';
    const spacing = parseFloat(this.st.letterSpacing) || 0;
    let m = this.st.m;
    // (Squeezed to a largest width as the canvas does.)
    if (maxWidth !== undefined) {
      const w = this.measureText(text).width;
      // (Narrowed about its place, whichever way it is aligned.)
      if (w > maxWidth && w > 0) { const k = maxWidth / w; m = mul(m, [k, 0, 0, 1, x * (1 - k), 0]); }
    }
    const attrs = `${matAttr(m)} x="${num(x, digitsFor(m))}" y="${num(y + this.baselineShift(f.size), digitsFor(m))}" font-family="${esc(f.family.replace(/"/g, "'"))}" font-size="${num(f.size, 2)}"${f.weight !== '400' && f.weight !== 'normal' ? ` font-weight="${f.weight}"` : ''}${f.style !== 'normal' ? ` font-style="${f.style}"` : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${spacing ? ` letter-spacing="${num(spacing, 2)}"` : ''}`;
    const extra = kind === 'stroke' ? ` fill="none"${this.lineAttrs()}` : '';
    this.emit(`<text${attrs}${paint}${extra}${this.alphaAttr()} xml:space="preserve">${esc(text)}</text>`);
  }
  fillText(text: string, x: number, y: number, maxWidth?: number): void { this.text('fill', text, x, y, maxWidth); }
  strokeText(text: string, x: number, y: number, maxWidth?: number): void { this.text('stroke', text, x, y, maxWidth); }

  // ---- pictures
  /** A picture (or part of one) as a PNG data URL, made once per picture and part. */
  private pictureOf(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): string | null {
    if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') return null;
    let id = pictureIds.get(src as object);
    if (id === undefined) pictureIds.set(src as object, (id = ++pictureCount));
    // (Canvases change as they are drawn on: those are not taken from what was made before.)
    const live = (typeof OffscreenCanvas !== 'undefined' && src instanceof OffscreenCanvas) || (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement);
    const key = `${id}|${sx},${sy},${sw},${sh}`;
    if (!live && this.pictures.has(key)) return this.pictures.get(key)!;
    const w = Math.max(1, Math.round(sw)), h = Math.max(1, Math.round(sh));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    try { g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h); } catch { return null; }
    let url: string;
    try { url = c.toDataURL('image/png'); } catch { this.skip('a picture from another site'); return null; }
    if (!live) this.pictures.set(key, url);
    return url;
  }
  drawImage(src: CanvasImageSource, ...a: number[]): void {
    if (!this.painting()) return;
    const [w, h] = sourceSize(src);
    if (!w || !h) return;
    let sx = 0, sy = 0, sw = w, sh = h, dx: number, dy: number, dw: number, dh: number;
    if (a.length >= 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    else if (a.length >= 4) [dx, dy, dw, dh] = a;
    else { [dx, dy] = a; dw = w; dh = h; }
    if (!(sw > 0 && sh > 0 && dw && dh)) return;
    const href = this.pictureOf(src, sx, sy, sw, sh);
    if (!href) return;
    const m = this.st.m;
    this.emit(`<image${matAttr(m)} x="${num(dx, 3)}" y="${num(dy, 3)}" width="${num(dw, 3)}" height="${num(dh, 3)}" preserveAspectRatio="none" xlink:href="${href}"${this.alphaAttr()}/>`);
  }
  getImageData(): ImageData { throw new Error('An SVG pen has no pixels.'); }
  putImageData(): void { this.skip('pixels put on'); }

  // ---- what was drawn
  /** An id and a name given to the next thing drawn (a country's shape, say), as drawing programs show them. */
  name(id: string | null, label: string | null): void { this.next = { id, label }; }
  private next: { id: string | null; label: string | null } | null = null;
  private emit(el: string): void {
    if (this.next) {
      const { id, label } = this.next;
      this.next = null;
      const add = `${id ? ` id="${esc(id)}"` : ''}${label ? ` inkscape:label="${esc(label)}"` : ''}`;
      const sp = el.search(/[\s/>]/);
      el = el.slice(0, sp) + add + el.slice(sp);
      if (label && el.endsWith('/>')) el = `${el.slice(0, -2)}><title>${esc(label)}</title></${el.slice(1, sp)}>`;
    }
    const c = this.st.clip;
    this.out.push(c ? `\u0000${c}\u0000${el}` : el);
  }
  /** What was drawn, in order (shapes clipped alike grouped in a clipped group). */
  body(): string {
    const parts: string[] = [];
    let open: string | null = null;
    for (const raw of this.out) {
      let clip: string | null = null, el = raw;
      if (raw.charCodeAt(0) === 0) { const end = raw.indexOf('\u0000', 1); clip = raw.slice(1, end); el = raw.slice(end + 1); }
      if (clip !== open) { if (open) parts.push('</g>'); if (clip) parts.push(`<g clip-path="url(#${clip})">`); open = clip; }
      parts.push(el);
    }
    if (open) parts.push('</g>');
    return parts.join('\n');
  }
  defs(): string { return this.defsOut.join('\n'); }
  get drawnCount(): number { return this.out.length; }
}

/** SVG path data's commands (M, L, H, V, C, Q, Z, absolute or relative; arcs as lines) as the pen's own. */
function rawToCmds(d: string): number[] {
  const out: number[] = [];
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0, op = '', x = 0, y = 0, sx = 0, sy = 0;
  const n = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) op = toks[i++];
    const rel = op === op.toLowerCase(), o = op.toUpperCase();
    if (o === 'Z') { out.push(Z); x = sx; y = sy; continue; }
    if (o === 'M') { x = (rel ? x : 0) + n(); y = (rel ? y : 0) + n(); out.push(M, x, y); sx = x; sy = y; op = rel ? 'l' : 'L'; continue; }
    if (o === 'L') { x = (rel ? x : 0) + n(); y = (rel ? y : 0) + n(); out.push(L, x, y); continue; }
    if (o === 'H') { x = (rel ? x : 0) + n(); out.push(L, x, y); continue; }
    if (o === 'V') { y = (rel ? y : 0) + n(); out.push(L, x, y); continue; }
    if (o === 'C') { const a = [n(), n(), n(), n(), n(), n()]; if (rel) for (let k = 0; k < 6; k += 2) { a[k] += x; a[k + 1] += y; } out.push(C, ...a); x = a[4]; y = a[5]; continue; }
    if (o === 'Q') { const a = [n(), n(), n(), n()]; if (rel) { a[0] += x; a[1] += y; a[2] += x; a[3] += y; } out.push(C, x + (2 / 3) * (a[0] - x), y + (2 / 3) * (a[1] - y), a[2] + (2 / 3) * (a[0] - a[2]), a[3] + (2 / 3) * (a[1] - a[3]), a[2], a[3]); x = a[2]; y = a[3]; continue; }
    if (o === 'A') { n(); n(); n(); n(); n(); const ex = (rel ? x : 0) + n(), ey = (rel ? y : 0) + n(); out.push(L, ex, ey); x = ex; y = ey; continue; }
    i++; // (Anything else: passed over.)
  }
  return out;
}

/**
 * Runs `draw` with Path2D standing for the pen's own paths, so shapes the drawing code builds as
 * Path2D objects can be written (the global is put back afterwards, even on an error).
 */
export function withSvgPaths<T>(draw: () => T): T {
  const g = globalThis as unknown as { Path2D?: unknown };
  const before = g.Path2D;
  g.Path2D = SvgPath;
  try { return draw(); } finally { g.Path2D = before; }
}
