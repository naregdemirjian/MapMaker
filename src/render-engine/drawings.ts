// A country's drawings by hand (S8, D251), drawn over its fill and inside its edge (the canvas is clipped to its land
// before): each drawing's shapes as paths on the screen, filled and stroked in its colours, then laid on at its opacity
// and in its blend mode as one picture (where its line crosses its fill, the line shows as drawn, not mixed with it).
// Texts (D253) in the fill's colour (the line's, where there is no fill), outlined by the line where there are both.
import { screenPath, traceSegs, drawingShows, textFont, type Drawing, type LL, type Pt, type TextShape } from '../domain/drawings.ts';
import { compositeOf } from './country-look.ts';

/**
 * Draw a country's drawings on `c` (clipped to its land, its transform from the view's pixels to the canvas's), in
 * order. `tmp`: a spare canvas of the same size and transform, for a drawing laid on at an opacity or in a blend mode.
 * `unit`: the view's pixels to a pixel of a frame 1920 wide (lines are as wide in every size of frame).
 */
export function paintDrawings(c: CanvasRenderingContext2D, tmp: CanvasRenderingContext2D, list: Drawing[], project: (ll: LL) => Pt | null, unit: number): void {
  for (const d of list) {
    if (!drawingShows(d)) continue;
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
    if (!fills && !lines && !texts.length) continue;
    // (Laid on as it is, unless an opacity or a blend applies to its line and fill together.)
    const alone = d.opacity >= 1 && d.blend === 'normal';
    const on = alone ? c : tmp;
    if (!alone) {
      tmp.save();
      tmp.setTransform(1, 0, 0, 1, 0, 0);
      tmp.clearRect(0, 0, tmp.canvas.width, tmp.canvas.height);
      tmp.restore();
    }
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
    if (alone) continue;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha *= d.opacity;
    c.globalCompositeOperation = compositeOf(d.blend);
    c.drawImage(tmp.canvas as CanvasImageSource, 0, 0);
    c.restore();
  }
}
