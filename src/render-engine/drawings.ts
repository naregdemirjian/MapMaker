// A country's drawings by hand (S8, D251), drawn over its fill and inside its edge (the canvas is clipped to its land
// before): each drawing's shapes as paths on the screen, filled and stroked in its colours, then laid on at its opacity
// and in its blend mode as one picture (where its line crosses its fill, the line shows as drawn, not mixed with it).
// Texts (D253) in the fill's colour (the line's, where there is no fill), outlined by the line where there are both.
// A pattern that follows the country (D254): one tile of its shapes, repeated over all of the country's land, the
// tile's middle on the middle of the country, so that it goes where the country goes.
import { screenPath, traceSegs, drawingShows, textFont, type Drawing, type LL, type Pt, type TextShape } from '../domain/drawings.ts';
import { compositeOf } from './country-look.ts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Where a country lies on the view (its pixels): the middle a pattern's tile is laid on, and the box it fills. */
export interface Around { at: Pt; box: [number, number, number, number] }

/** A drawing's shapes drawn on `on` as they are (its opacity and blend aside); false if there was nothing to draw. */
function drawShapes(on: Ctx, d: Drawing, project: (ll: LL) => Pt | null, unit: number): boolean {
  const filled = new Path2D(), lined = new Path2D();
  let fills = false, lines = false;
  const texts: TextShape[] = [];
  for (const s of d.shapes) {
    if (s.kind === 'text') { texts.push(s); continue; }
    const segs = screenPath(s, project);
    if (!segs) continue;
    if (d.fill && s.closed) { traceSegs(filled, segs, true); fills = true; }
    if (d.stroke) { traceSegs(lined, segs, s.closed); lines = true; }
  }
  if (!fills && !lines && !texts.length) return false;
  on.save();
  if (fills) { on.fillStyle = d.fill!; on.fill(filled, 'nonzero'); }
  if (lines) {
    on.strokeStyle = d.stroke!.color;
    on.lineWidth = Math.max(0.5, d.stroke!.width * unit);
    on.lineJoin = 'round';
    on.lineCap = 'round';
    on.stroke(lined);
  }
  const ink = d.fill ?? d.stroke?.color;
  for (const t of texts) {
    const at = project(t.at);
    if (!at || !ink) continue;
    on.save();
    on.translate(at[0], at[1]);
    if (t.angle) on.rotate((t.angle * Math.PI) / 180);
    on.font = textFont(t, t.size * unit);
    on.textAlign = 'center';
    on.textBaseline = 'middle';
    if (d.fill && d.stroke) { on.strokeStyle = d.stroke.color; on.lineWidth = Math.max(0.5, 2 * d.stroke.width * unit); on.lineJoin = 'round'; on.strokeText(t.text, 0, 0); }
    on.fillStyle = ink;
    on.fillText(t.text, 0, 0);
    on.restore();
  }
  on.restore();
  return true;
}

/** Tiles of patterns made lately, by what they hold and their size (a frame drawn again reuses them). */
const tiles = new Map<string, OffscreenCanvas>();

/** A pattern's tile `w` by `h` canvas pixels: its shapes drawn in it (kept for the frames after). */
function tileOf(d: Drawing, w: number, h: number): OffscreenCanvas | null {
  const key = `${w}x${h}|${JSON.stringify([d.tile, d.stroke, d.fill, d.shapes])}`;
  let tile = tiles.get(key);
  if (tile) { tiles.delete(key); tiles.set(key, tile); return tile; }
  tile = new OffscreenCanvas(w, h);
  const tc = tile.getContext('2d');
  if (!tc) return null;
  tc.scale(w / d.tile![0], h / d.tile![1]);
  drawShapes(tc, d, (p) => p, 1);
  tiles.set(key, tile);
  if (tiles.size > 24) tiles.delete(tiles.keys().next().value!);
  return tile;
}

/** A pattern laid over the country's box (the canvas clipped to its land), its tile's middle on the country's middle. */
function fillPattern(on: Ctx, d: Drawing, unit: number, around: Around): boolean {
  if (!d.tile) return false;
  const m = on.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const tw = d.tile[0] * unit, th = d.tile[1] * unit;
  const w = Math.max(1, Math.ceil(tw * k)), h = Math.max(1, Math.ceil(th * k));
  if (w * h > 16_000_000) return false;
  const tile = tileOf(d, w, h);
  const pattern = tile ? on.createPattern(tile as unknown as CanvasImageSource, 'repeat') : null;
  if (!pattern) return false;
  pattern.setTransform(new DOMMatrix().translateSelf(around.at[0] - tw / 2, around.at[1] - th / 2).scaleSelf(tw / w, th / h));
  on.fillStyle = pattern;
  const [x, y, bw, bh] = around.box;
  on.fillRect(x, y, bw, bh);
  return true;
}

/**
 * Draw a country's drawings on `c` (clipped to its land, its transform from the view's pixels to the canvas's), in
 * order. `tmp`: a spare canvas of the same size and transform, for a drawing laid on at an opacity or in a blend mode.
 * `unit`: the view's pixels to a pixel of a frame 1920 wide (lines are as wide in every size of frame). `around`: where
 * the country lies, for its patterns (none: patterns left out).
 */
export function paintDrawings(c: CanvasRenderingContext2D, tmp: CanvasRenderingContext2D, list: Drawing[], project: (ll: LL) => Pt | null, unit: number, around?: Around): void {
  for (const d of list) {
    if (!drawingShows(d) || (d.mode === 'pattern' && !around)) continue;
    // (Laid on as it is, unless an opacity or a blend applies to its line and fill together.)
    const alone = d.opacity >= 1 && d.blend === 'normal';
    const on = alone ? c : tmp;
    if (!alone) {
      tmp.save();
      tmp.setTransform(1, 0, 0, 1, 0, 0);
      tmp.clearRect(0, 0, tmp.canvas.width, tmp.canvas.height);
      tmp.restore();
    }
    const drew = d.mode === 'pattern' ? fillPattern(on, d, unit, around!) : drawShapes(on, d, project, unit);
    if (alone || !drew) continue;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha *= d.opacity;
    c.globalCompositeOperation = compositeOf(d.blend);
    c.drawImage(tmp.canvas as CanvasImageSource, 0, 0);
    c.restore();
  }
}
