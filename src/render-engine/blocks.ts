/**
 * Shapes cut into blocks. A large outline (a coastline, the borders of a continent) costs time to
 * draw in proportion to all of its points, even when only a sliver of it is being drawn. A BlockPath
 * holds the same shapes in a tree of square blocks, each with only the points that matter inside it:
 * drawing then touches the blocks under the part being drawn and nothing else, however much detail
 * the rest holds. Blocks are worked out the first time they are drawn.
 *
 * What a block keeps of a shape: every point inside the block (and a margin around it), and of each
 * stretch that runs outside, only its first and last points when the stretch stays on one side of
 * the block (the straight line between them stays on that side too, so inside the block nothing
 * changes: neither what a fill covers nor where a line shows). Blocks are drawn clipped to their own
 * square, on whole pixels, so neighbouring blocks meet exactly.
 */

/** x, y, width, height in device pixels. */
export type DeviceRect = [number, number, number, number];

export interface Sub { pts: Float32Array; closed: boolean }
interface Node { x0: number; y0: number; x1: number; y1: number; subs: Sub[] | null; n: number; path: Path2D | null; kids: Node[] | null }

/** A block with at most this many points is not divided further... */
const LEAF_POINTS = 900;
/** ...nor one this small (path units: sheet pixels). */
const MIN_BLOCK = 96;
/** Each block keeps the shapes this far beyond its own square (room for line widths and soft edges). */
const PAD = 16;

/** While only part of a frame is being drawn: the device rectangles being drawn (blocks elsewhere are skipped). */
let paintRegion: DeviceRect[] | null = null;
export function setPaintRegion(r: DeviceRect[] | null): void { paintRegion = r; }

/** Counts for tests and benchmarks: blocks worked out, blocks drawn, whole shapes drawn. */
export const blockStats = { built: 0, drawn: 0, whole: 0 };

/** Does a device rectangle (x0, y0, x1, y1) reach onto the canvas, where drawing is going on? */
function shows(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x1 <= 0 || y1 <= 0 || x0 >= ctx.canvas.width || y0 >= ctx.canvas.height) return false;
  if (!paintRegion) return true;
  for (const r of paintRegion) if (x1 > r[0] && y1 > r[1] && x0 < r[0] + r[2] && y0 < r[1] + r[3]) return true;
  return false;
}

/**
 * A canvas path of some shapes. A closed shape is not closed with closePath: in Chrome each
 * closePath takes time in proportion to everything already in the path, so a path of a thousand
 * rings took twenty times as long to make as its points warrant, and one of five thousand almost a
 * second (measured in Chrome 153 and in the Electron the app ships with). Instead the ring goes
 * back to its first point and on to its second: it fills the same, and drawn as a line it has a
 * proper corner where it starts.
 */
function pathOf(subs: Sub[]): Path2D {
  const p = new Path2D();
  for (const s of subs) {
    const a = s.pts;
    p.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]);
    if (s.closed && a.length >= 6) { p.lineTo(a[0], a[1]); p.lineTo(a[2], a[3]); }
  }
  return p;
}

/** What a rectangle needs of some shapes (see the top of this file); returns the shapes and their number of points. */
export function reduce(subs: Sub[], x0: number, y0: number, x1: number, y1: number): { subs: Sub[]; n: number } {
  const out: Sub[] = [];
  let total = 0;
  let codes = new Uint8Array(1024);
  for (const s of subs) {
    const a = s.pts, n = a.length >> 1;
    if (codes.length < n) codes = new Uint8Array(n * 2);
    let all = 15, any = 0;
    for (let i = 0; i < n; i++) {
      const x = a[2 * i], y = a[2 * i + 1];
      const c = (x < x0 ? 1 : x > x1 ? 2 : 0) | (y < y0 ? 4 : y > y1 ? 8 : 0);
      codes[i] = c; all &= c; any |= c;
    }
    // Wholly on one side: nothing of it shows here, and it goes round no point in here.
    if (all) continue;
    if (!any) { out.push(s); total += n; continue; }
    let keep = 0;
    for (let i = 0; i < n; i++) if (!codes[i] || i === 0 || i === n - 1 || codes[i - 1] !== codes[i] || codes[i + 1] !== codes[i]) keep++;
    if (keep === n) { out.push(s); total += n; continue; }
    const b = new Float32Array(2 * keep);
    let j = 0;
    for (let i = 0; i < n; i++) if (!codes[i] || i === 0 || i === n - 1 || codes[i - 1] !== codes[i] || codes[i + 1] !== codes[i]) { b[j++] = a[2 * i]; b[j++] = a[2 * i + 1]; }
    out.push({ pts: b, closed: s.closed });
    total += keep;
  }
  return { subs: out, n: total };
}

export class BlockPath {
  private cur: number[] = [];
  private subs: Sub[] = [];
  private n = 0;
  private root: Node | null = null;
  private all: Path2D | null = null;
  /** The box of every point added. */
  private bx0 = Infinity; private by0 = Infinity; private bx1 = -Infinity; private by1 = -Infinity;

  private readonly bounds: [number, number, number, number];

  /** `bounds`: the square everything is drawn within (a sheet's window), as x0, y0, x1, y1. */
  constructor(bounds: [number, number, number, number]) { this.bounds = bounds; }

  moveTo(x: number, y: number): void { this.end(false); this.cur.push(x, y); }
  lineTo(x: number, y: number): void { this.cur.push(x, y); }
  closePath(): void { this.end(true); }
  rect(x: number, y: number, w: number, h: number): void { this.end(false); this.cur.push(x, y, x + w, y, x + w, y + h, x, y + h); this.end(true); }
  /** Add an open line given as x, y, x, y... (the array is kept, not copied). */
  addLine(pts: Float32Array): void { this.end(false); if (pts.length >= 4) this.take({ pts, closed: false }); }

  private end(closed: boolean): void {
    if (this.cur.length >= 4) this.take({ pts: Float32Array.from(this.cur), closed });
    if (this.cur.length) this.cur = [];
  }

  private take(s: Sub): void {
    const a = s.pts;
    for (let i = 0; i < a.length; i += 2) {
      const x = a[i], y = a[i + 1];
      if (x < this.bx0) this.bx0 = x; if (x > this.bx1) this.bx1 = x;
      if (y < this.by0) this.by0 = y; if (y > this.by1) this.by1 = y;
    }
    this.subs.push(s);
    this.n += a.length >> 1;
    this.root = null; this.all = null;
  }

  /** The number of points held. */
  get size(): number { this.end(false); return this.n; }

  /** Everything as one path (for clipping to the shapes, and for views blocks cannot serve). */
  whole(): Path2D {
    this.end(false);
    return (this.all ??= pathOf(this.subs));
  }

  /**
   * Draw: `draw` is called with a path for each block under the part of the canvas being drawn
   * (clipped to the block), or once with everything when the shapes are few. The context's transform
   * is the one the path's coordinates are in; `reach` is how far the drawing extends beyond the
   * shapes themselves, in path units (half the line width for a stroke).
   */
  paint(ctx: CanvasRenderingContext2D, reach: number, draw: (p: Path2D) => void): void {
    this.end(false);
    if (!this.n) return;
    const t = ctx.getTransform();
    const upright = t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0;
    if (upright) {
      // Nothing of it where drawing is going on?
      const m = reach + 2;
      if (!shows(ctx, t.a * (this.bx0 - m) + t.e, t.d * (this.by0 - m) + t.f, t.a * (this.bx1 + m) + t.e, t.d * (this.by1 + m) + t.f)) return;
    }
    // Few points, a turned view, or lines wider than a block's margin: all at once.
    if (this.n <= LEAF_POINTS || !upright || reach > PAD - 3) { blockStats.whole++; draw(this.whole()); return; }
    this.walk(ctx, t, draw, null);
  }

  /**
   * Erase everything on the canvas that lies outside the shapes (where drawing is going on), block
   * by block: what a buffer shows is trimmed to the land, say.
   */
  keepInside(ctx: CanvasRenderingContext2D): void {
    this.end(false);
    const t = ctx.getTransform();
    const upright = t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0;
    ctx.save();
    if (!this.n) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else if (this.n <= LEAF_POINTS || !upright) {
      blockStats.whole++;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fill(this.whole(), 'evenodd');
    } else {
      ctx.globalCompositeOperation = 'destination-in';
      this.walk(ctx, t, (p) => ctx.fill(p, 'evenodd'), (x, y, w, h) => {
        // No shape comes near this block: it is wholly outside them.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(x, y, w, h);
        ctx.setTransform(t);
      });
    }
    ctx.restore();
  }

  /** Go through the blocks under the part of the canvas being drawn (see paint). */
  private walk(ctx: CanvasRenderingContext2D, t: DOMMatrix, draw: (p: Path2D) => void, empty: ((x: number, y: number, w: number, h: number) => void) | null): void {
    if (!this.root) {
      const b = this.bounds;
      const first = reduce(this.subs, b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD);
      this.root = { x0: b[0], y0: b[1], x1: b[2], y1: b[3], subs: first.subs, n: first.n, path: null, kids: null };
    }
    const visit = (node: Node): void => {
      if (!node.n && !empty) return;
      const dx0 = Math.round(t.a * node.x0 + t.e), dy0 = Math.round(t.d * node.y0 + t.f), dx1 = Math.round(t.a * node.x1 + t.e), dy1 = Math.round(t.d * node.y1 + t.f);
      if (!shows(ctx, dx0, dy0, dx1, dy1)) return;
      if (!node.n) { empty!(dx0, dy0, dx1 - dx0, dy1 - dy0); return; }
      if (!node.path && !node.kids) this.settle(node);
      if (node.kids) { for (const k of node.kids) visit(k); return; }
      blockStats.drawn++;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(dx0, dy0, dx1 - dx0, dy1 - dy0);
      ctx.clip();
      ctx.setTransform(t);
      draw(node.path!);
      ctx.restore();
    };
    visit(this.root);
  }

  /** Make a block ready to draw: as it is when it holds little or is small, otherwise divided in four. */
  private settle(node: Node): void {
    const subs = node.subs!;
    blockStats.built++;
    if (node.n <= LEAF_POINTS || Math.max(node.x1 - node.x0, node.y1 - node.y0) <= MIN_BLOCK) {
      node.path = pathOf(subs);
      node.subs = null;
      return;
    }
    const mx = (node.x0 + node.x1) / 2, my = (node.y0 + node.y1) / 2;
    node.kids = [];
    for (const [x0, y0, x1, y1] of [[node.x0, node.y0, mx, my], [mx, node.y0, node.x1, my], [node.x0, my, mx, node.y1], [mx, my, node.x1, node.y1]]) {
      const r = reduce(subs, x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD);
      node.kids.push({ x0, y0, x1, y1, subs: r.subs, n: r.n, path: null, kids: null });
    }
    node.subs = null;
  }
}
