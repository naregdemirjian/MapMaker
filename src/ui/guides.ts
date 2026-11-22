// Guide lines over the working map (D206): today's states and provinces (the Regions tool's own data), drawn
// thin and dashed as an aid to drawing. Never in shots or exports. Outlines are kept simplified to a few
// degrees of detail and only those in view are drawn, so they cost little while the map moves.
import { lonLatToScreen, viewBounds, radiansPerPixel, type View } from '../render-engine/camera.ts';
import type { RegionIndex } from '../domain/regions.ts';

type Ring = Array<[number, number]>;
interface Simplified { rings: Array<{ box: [number, number, number, number]; ring: Ring }> }
const LEVELS = [0.4, 0.08, 0.015, 0];
const kept = new WeakMap<RegionIndex, Map<number, Simplified>>();

/** A ring with points closer than `tol` degrees to the last one kept left out. */
export function thin(ring: Ring, tol: number): Ring {
  if (tol <= 0 || ring.length < 4) return ring;
  const out: Ring = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const a = out[out.length - 1], b = ring[i];
    if (Math.abs(b[0] - a[0]) > tol || Math.abs(b[1] - a[1]) > tol) out.push(b);
  }
  out.push(ring[ring.length - 1]);
  return out;
}

function simplified(ix: RegionIndex, tol: number): Simplified {
  let byTol = kept.get(ix);
  if (!byTol) kept.set(ix, (byTol = new Map()));
  let s = byTol.get(tol);
  if (!s) {
    s = { rings: [] };
    for (const r of ix.regions) for (const poly of r.polygons) for (const ring of poly) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const t = thin(ring, tol);
      if (t.length >= 3) s.rings.push({ box: [x0, y0, x1, y1], ring: t });
    }
    byTol.set(tol, s);
  }
  return s;
}

/** The outlines of today's states and provinces, as guides, on the working map. */
export function drawStateGuides(ctx: CanvasRenderingContext2D, v: View, ix: RegionIndex): void {
  const degPerPx = (radiansPerPixel(v) * 180) / Math.PI;
  const tol = LEVELS.find((l) => l <= degPerPx * 1.5) ?? 0;
  const b = viewBounds(v, 0.05);
  // (Longitudes of the view may run past ±180: a ring is in view if it is in the box shifted by a turn either way.)
  const inView = (box: [number, number, number, number]) => !b || b.east - b.west > 300 || (box[3] >= b.south && box[1] <= b.north
    && [-360, 0, 360].some((k) => box[2] + k >= b.west && box[0] + k <= b.east));
  ctx.save();
  ctx.beginPath();
  for (const { box, ring } of simplified(ix, tol).rings) {
    if (!inView(box)) continue;
    let open = false, last: [number, number] | null = null;
    for (const [lon, lat] of ring) {
      const q = lonLatToScreen(v, lon, lat);
      // (Broken where the projection breaks: off a globe's edge, or across the map's seam.)
      if (!q || (last && Math.abs(q[0] - last[0]) > v.width * 0.5)) { open = false; last = q; continue; }
      if (open) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); open = true; }
      last = q;
    }
  }
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 236, 170, 0.55)';
  ctx.stroke();
  ctx.restore();
}
