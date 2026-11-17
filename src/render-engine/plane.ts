// Map geometry in the plane of the projection, prepared once and reused for many frames.
//
// The renderer used to hand every parcel and coastline to d3-geo for every new view: each pan step
// re-projected the whole map. Here geometry is projected into a "sheet": a patch of the projection's
// plane around the view, at about the view's scale, in coordinates local to the patch (so they stay
// exact however far in the view is). While the view stays on the sheet, drawing a frame is nothing
// but filling and stroking ready-made paths under a transform; panning and zooming cost no geometry
// work at all. Leaving the sheet (or zooming to another scale) makes a new one.
//
// A sheet holds only what can be seen from it, at the detail its scale can show:
//   - level of detail: every point of a line carries an importance (how far the line would move
//     without it); a sheet keeps the points that matter at its scale. Neighbouring parcels share
//     their borders point for point, so they never part or overlap.
//   - culling: rings and lines whose box misses the sheet's window are left out.
// Longitudes are kept unwrapped (continuous along a line), so nothing is cut at the 180° meridian:
// a ring is simply drawn again one turn east or west where that copy is in view, and the outline of
// the planet clips what lies beyond it.
import type { ProjectionName, View } from './camera.ts';
import { rotatePoint, meridianOf } from './camera.ts';
import { BlockPath } from './blocks.ts';

const RAD = Math.PI / 180;
/** Latitudes beyond this are drawn at it in Mercator (where the poles are infinitely far). */
const MERCATOR_MAX_LAT = 89.99;

// ---------------------------------------------------------------- projections (forward, unit scale)

/** Result of the last project() call (plane units, y down), kept out of the heap. */
let PX = 0, PY = 0;

const EE_A1 = 1.340264, EE_A2 = -0.081106, EE_A3 = 0.000893, EE_A4 = 0.003796, EE_M = Math.sqrt(3) / 2;

/**
 * Project a point: longitude relative to the sheet's reference meridian and latitude, in degrees,
 * into PX, PY. The formulas are d3-geo's (checked against it by test/plane.test.ts); y points down.
 */
function project(kind: ProjectionName, lonRel: number, lat: number): void {
  const lam = lonRel * RAD;
  let phi = lat * RAD;
  switch (kind) {
    case 'mercator': {
      if (lat > MERCATOR_MAX_LAT) phi = MERCATOR_MAX_LAT * RAD; else if (lat < -MERCATOR_MAX_LAT) phi = -MERCATOR_MAX_LAT * RAD;
      PX = lam; PY = -Math.log(Math.tan((Math.PI / 2 + phi) / 2));
      return;
    }
    case 'equalEarth': {
      const l = Math.asin(EE_M * Math.sin(phi)), l2 = l * l, l6 = l2 * l2 * l2;
      PX = (lam * Math.cos(l)) / (EE_M * (EE_A1 + 3 * EE_A2 * l2 + l6 * (7 * EE_A3 + 9 * EE_A4 * l2)));
      PY = -l * (EE_A1 + EE_A2 * l2 + l6 * (EE_A3 + EE_A4 * l2));
      return;
    }
    case 'naturalEarth': {
      const p2 = phi * phi, p4 = p2 * p2;
      PX = lam * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
      PY = -phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
      return;
    }
    case 'flat': {
      const cy = Math.cos(phi), k = Math.cos(lam) * cy;
      PX = (cy * Math.sin(lam)) / k; PY = -Math.sin(phi) / k;
      return;
    }
    default:
      PX = lam; PY = -phi;
  }
}

/** For tests: a point in plane units. */
export function projectPoint(kind: ProjectionName, lonRel: number, lat: number): [number, number] {
  project(kind, lonRel, lat);
  return [PX, PY];
}

/** Equirectangular and Mercator: x is the longitude itself, so a turn east or west is a plain shift. */
export const isCylindrical = (kind: ProjectionName) => kind === 'equirectangular' || kind === 'mercator';

// ---------------------------------------------------------------- lines with levels of detail

/**
 * A line or closed ring in longitude/latitude (degrees). Longitudes are unwrapped: continuous along
 * the line, so they may run past ±180°.
 */
export interface Ring {
  lon: Float64Array;
  lat: Float64Array;
  /**
   * How much each point matters: the distance (degrees) the line would move if the point were
   * dropped once every less important point is gone. Infinity for points that are always kept.
   * Null: not worked out yet (every point is kept).
   */
  imp: Float32Array | null;
  closed: boolean;
  /** True: consecutive points are joined by great-circle arcs (borders). False: by straight lines in longitude/latitude (map data). */
  arcs: boolean;
  /** [west, south, east, north], unwrapped. */
  box: [number, number, number, number];
  /** Closed rings: whole turns around the planet (+1 eastward, -1 westward): such a ring goes round a pole. */
  wind: number;
}

/**
 * Importance of the points strictly between i0 and i1 of a line (Douglas-Peucker, kept as a ranking):
 * a point's importance is its distance from the chord at the moment it would be the last to go, and
 * never more than that of the point whose removal exposed it. Keeping every point with importance
 * >= e gives a line within e of the original, for any e, from one pass.
 */
export function rankPoints(x: ArrayLike<number>, y: ArrayLike<number>, i0: number, i1: number, imp: Float32Array | number[], offset = 0): void {
  if (i1 - i0 < 2) return;
  const stack: number[] = [i0, i1, Infinity];
  while (stack.length) {
    const cap = stack.pop()!, b = stack.pop()!, a = stack.pop()!;
    const ax = x[a], ay = y[a], dx = x[b] - ax, dy = y[b] - ay, len2 = dx * dx + dy * dy;
    let best = -1, bestD = -1;
    for (let k = a + 1; k < b; k++) {
      const px = x[k] - ax, py = y[k] - ay;
      let d: number;
      if (len2 === 0) d = px * px + py * py;
      else {
        let t = (px * dx + py * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - t * dx, qy = py - t * dy;
        d = qx * qx + qy * qy;
      }
      if (d > bestD) { bestD = d; best = k; }
    }
    const v = Math.min(Math.sqrt(bestD), cap);
    imp[offset + best] = v;
    if (best - a > 1) stack.push(a, best, v);
    if (b - best > 1) stack.push(best, b, v);
  }
}

/** A ring or line from points, with its box and winding; importance is worked out on first use. */
export function makeRing(lon: Float64Array, lat: Float64Array, closed: boolean, arcs: boolean): Ring {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let i = 0; i < lon.length; i++) { const x = lon[i], y = lat[i]; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return { lon, lat, imp: null, closed, arcs, box: [w, s, e, n], wind: 0 };
}

/** Importance for a ring or line on its own (not sharing points with neighbours): both ends are kept. */
export function rankRing(r: Ring): Float32Array {
  if (r.imp) return r.imp;
  const n = r.lon.length;
  const imp = new Float32Array(n);
  if (n > 0) {
    imp[0] = Infinity;
    if (r.closed) {
      // Anchored at the first point and the point farthest from it, so the ring keeps its extent.
      let far = 0, farD = -1;
      for (let i = 1; i < n; i++) { const d = (r.lon[i] - r.lon[0]) ** 2 + (r.lat[i] - r.lat[0]) ** 2; if (d > farD) { farD = d; far = i; } }
      if (far > 0) {
        imp[far] = Infinity;
        rankPoints(r.lon, r.lat, 0, far, imp);
        // The way back to the start: the points after `far`, then the first point again.
        const m = n - far + 1;
        const x = new Float64Array(m), y = new Float64Array(m);
        for (let i = 0; i < m - 1; i++) { x[i] = r.lon[far + i]; y[i] = r.lat[far + i]; }
        x[m - 1] = r.lon[0]; y[m - 1] = r.lat[0];
        const tail = new Float32Array(m);
        rankPoints(x, y, 0, m - 1, tail);
        for (let i = 1; i < m - 1; i++) imp[far + i] = tail[i];
      }
    } else {
      imp[n - 1] = Infinity;
      rankPoints(r.lon, r.lat, 0, n - 1, imp);
    }
  }
  r.imp = imp;
  return imp;
}

// ---------------------------------------------------------------- sheets

/** Anything paths can be written to (a Path2D in the browser; a recorder in tests). */
export interface PathSink { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void }

let sheetIds = 0;
/** Coordinates beyond this many sheet pixels from the sheet's middle are clipped away (they are far off screen). */
const GUARD = 1 << 20;

export interface SheetOptions {
  /** The largest error, in pixels of the view, simplification may cause. */
  tolerance: number;
  /** How much of the view's size the sheet extends beyond the view on each side. */
  margin: number;
}

export class Sheet {
  readonly id = ++sheetIds;
  readonly kind: ProjectionName;
  /** The meridian longitudes are measured from (degrees): 0, or the camera's own for projections whose shape depends on it. */
  readonly lonRef: number;
  /** Sheet pixels per plane unit. */
  readonly S: number;
  /** The plane point at the sheet's origin. */
  readonly ox: number;
  readonly oy: number;
  /** The window, in plane units: everything that reaches into it is on the sheet. */
  readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number;
  /** The window in sheet pixels (for skipping detail work on what lies outside). */
  private readonly wx0: number; private readonly wy0: number; private readonly wx1: number; private readonly wy1: number;
  readonly tolerance: number;
  /** Where the sheet's middle is on the map (the camera it was made for): [longitude, latitude]. */
  readonly centre: [number, number];
  /**
   * Set whenever a ring or line written by ring() or lines() passes through (or beside) the window;
   * callers reset it to learn whether a group of shapes shows on the sheet at all.
   */
  touched = false;
  /** Paths made for this sheet, by whoever draws on it (dropped with the sheet). */
  readonly cache = new Map<string, unknown>();
  private readonly cyl: boolean;

  constructor(view: View, o: SheetOptions) {
    this.kind = view.camera.projection;
    this.cyl = isCylindrical(this.kind);
    this.lonRef = this.cyl || this.kind === 'flat' ? 0 : meridianOf(view.camera);
    this.S = view.projection.scale();
    this.tolerance = o.tolerance;
    this.centre = [view.camera.lon, Math.max(-89.9, Math.min(89.9, view.camera.lat))];
    const r = viewRect(view, this.lonRef);
    const mx = (r[2] - r[0]) * o.margin, my = (r[3] - r[1]) * o.margin;
    this.x0 = r[0] - mx; this.y0 = r[1] - my; this.x1 = r[2] + mx; this.y1 = r[3] + my;
    this.ox = (r[0] + r[2]) / 2; this.oy = (r[1] + r[3]) / 2;
    this.wx0 = (this.x0 - this.ox) * this.S; this.wy0 = (this.y0 - this.oy) * this.S;
    this.wx1 = (this.x1 - this.ox) * this.S; this.wy1 = (this.y1 - this.oy) * this.S;
  }

  /** A path for shapes on this sheet, held in blocks so that drawing part of the view only touches the shapes there. */
  blocks(): BlockPath { return new BlockPath([this.wx0, this.wy0, this.wx1, this.wy1]); }

  /** Can this sheet draw the view (and `pad` view pixels around it): same projection, the view inside the window, a scale near its own? */
  covers(view: View, tolerance: number, pad = 0): boolean {
    if (view.camera.projection !== this.kind || tolerance !== this.tolerance) return false;
    if (!this.cyl && this.kind !== 'flat' && meridianOf(view.camera) !== this.lonRef) return false;
    const s = view.projection.scale(), k = s / this.S;
    if (k > 1.42 || k < 0.5) return false;
    const r = viewRect(view, this.lonRef), p = pad / s;
    return r[0] - p >= this.x0 && r[1] - p >= this.y0 && r[2] + p <= this.x1 && r[3] + p <= this.y1;
  }

  /** The transform that puts the sheet on the view: [scale, x offset, y offset] (screen = scale * sheet + offset). */
  placement(view: View): [number, number, number] {
    const s = view.projection.scale(), [tx, ty] = view.projection.translate();
    const shift = this.cyl ? (view.camera.lon - this.lonRef) * RAD : 0;
    return [s / this.S, tx + s * (this.ox - shift), ty + s * this.oy];
  }

  /** The detail threshold (degrees) for a ring: points less important than this are left out. */
  private threshold(box: [number, number, number, number]): number {
    // Sheet pixels per degree where the ring is most stretched by the projection.
    let stretch = 1;
    if (this.kind === 'mercator') stretch = 1 / Math.max(0.02, Math.cos(Math.min(MERCATOR_MAX_LAT, Math.max(Math.abs(box[1]), Math.abs(box[3]))) * RAD));
    else if (this.kind === 'equalEarth' || this.kind === 'naturalEarth') stretch = 1.4;
    else if (this.kind === 'flat') stretch = 1.05;
    // Drawn up to 1.42 times larger than the sheet's own scale (see covers).
    return this.tolerance / (this.S * RAD * stretch * 1.42);
  }

  /**
   * The copies of a ring (whole turns east or west, as multiples of 360°) that reach into the
   * window. Flat maps have one; round maps may show a ring that spans the 180° meridian twice.
   */
  copies(box: [number, number, number, number]): number[] {
    if (this.kind === 'flat') return this.touches(box, 0) ? [0] : [];
    const out: number[] = [];
    if (this.cyl) {
      const w0 = this.x0 / RAD, w1 = this.x1 / RAD;
      for (let k = Math.ceil((w0 - box[2]) / 360); box[0] + 360 * k <= w1; k++) if (this.touches(box, k)) out.push(k);
      return out;
    }
    // Relative to the camera's meridian; what lies beyond half a turn is outside the planet's outline.
    for (let k = Math.ceil((this.lonRef - 180 - box[2]) / 360); box[0] + 360 * k <= this.lonRef + 180; k++) if (this.touches(box, k)) out.push(k);
    return out;
  }

  /** Does copy k of a box reach into the window? (Never misses; may accept a little too much.) */
  private touches(box: [number, number, number, number], k: number): boolean {
    const w = box[0] + 360 * k - this.lonRef, e = box[2] + 360 * k - this.lonRef;
    if (this.cyl) {
      if (e * RAD < this.x0 || w * RAD > this.x1) return false;
      project(this.kind, 0, box[3]); const top = PY;
      project(this.kind, 0, box[1]); const bottom = PY;
      return bottom >= this.y0 && top <= this.y1;
    }
    // Other projections: the box of the projected corners and of the points nearest the equator
    // (where the map is widest), with a little room for the curve of the edges between them.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const mid = box[1] > 0 ? box[1] : box[3] < 0 ? box[3] : 0;
    for (const lat of [box[1], box[3], mid]) for (const lon of [w, e, (w + e) / 2]) {
      project(this.kind, lon, lat);
      if (PX < x0) x0 = PX; if (PX > x1) x1 = PX; if (PY < y0) y0 = PY; if (PY > y1) y1 = PY;
    }
    const pad = 0.02 * Math.max(x1 - x0, y1 - y0) + 1e-9;
    return x1 + pad >= this.x0 && x0 - pad <= this.x1 && y1 + pad >= this.y0 && y0 - pad <= this.y1;
  }

  // Scratch space for one ring's points (sheet pixels), reused.
  private buf = new Float64Array(4096);
  private n = 0;
  private push(x: number, y: number): void {
    if (this.n + 2 > this.buf.length) { const b = new Float64Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
    this.buf[this.n++] = x; this.buf[this.n++] = y;
  }

  /**
   * Project copy k of points from..to-1 of a ring at this sheet's detail into the scratch space;
   * returns the number of points. `end`: 'open' stops at the last point; 'ring' closes back to the
   * first of them (a whole ring); 'first' carries on to the ring's own first point and includes it
   * (the last chain of a ring).
   */
  private trace(r: Ring, k: number, from: number, to: number, end: 'open' | 'ring' | 'first', turn = 0, append = false): number {
    const imp = r.imp, eps = this.threshold(r.box), kind = this.kind, S = this.S, ox = this.ox, oy = this.oy;
    const shift = 360 * k + turn - this.lonRef;
    const tol = this.tolerance / 1.42;
    const equirect = kind === 'equirectangular', flat = kind === 'flat';
    // Appending: the points carry on from those already traced (the first repeats the last, and is left out).
    const skipFirst = append && this.n > 0;
    if (!append) this.n = 0;
    let prev = -1, plon = 0, plat = 0, px = 0, py = 0;
    const count = to - from;
    const back = end === 'ring' ? from : 0;
    for (let j = 0; j <= count; j++) {
      // Rings come back to their first point; lines stop at their last.
      let i = from + j;
      const closing = j === count;
      if (closing) { if (end === 'open') break; i = back; }
      if (imp && imp[i] < eps && !closing) continue;
      const lon = closing ? r.lon[back] + 360 * r.wind : r.lon[i], lat = r.lat[i];
      project(kind, lon + shift, lat);
      const x = (PX - ox) * S, y = (PY - oy) * S;
      if (prev >= 0) {
        // The piece from the previous point: where it bends on the map by more than the tolerance,
        // points are added along it (only where it can be seen from this sheet).
        const original = r.arcs && (i === prev + 1 || (closing && prev === to - 1));
        const dl = Math.abs(lon - plon) * RAD, dp = Math.abs(lat - plat) * RAD, d = dl > dp ? dl : dp;
        let bend = 0;
        if (d > 1e-7) {
          const a = Math.min(89.9, Math.max(Math.abs(lat), Math.abs(plat))) * RAD;
          // A great-circle arc bulges away from the straight line between its ends in longitude/latitude...
          if (original && !flat) bend += (d * d * (Math.tan(a) + 0.02)) / 8;
          // ...and the projection bends straight lines (not the equirectangular one; a flat map only slightly).
          if (!equirect) bend += (d * d * (kind === 'mercator' ? Math.tan(a) / Math.cos(a) + 0.02 : flat ? (original ? 0 : 0.5) : 5)) / 8;
        }
        if (bend * S > tol && this.near(px, py, x, y, bend * S)) {
          const steps = Math.min(256, Math.ceil(Math.sqrt((bend * S) / tol)));
          if (original) {
            // Along the great circle.
            const la0 = plat * RAD, lo0 = plon * RAD, la1 = lat * RAD, lo1 = lon * RAD;
            const ax = Math.cos(la0) * Math.cos(lo0), ay = Math.cos(la0) * Math.sin(lo0), az = Math.sin(la0);
            const bx = Math.cos(la1) * Math.cos(lo1), by = Math.cos(la1) * Math.sin(lo1), bz = Math.sin(la1);
            const th = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))), sn = Math.sin(th);
            if (sn > 1e-12) for (let q = 1; q < steps; q++) {
              const wa = Math.sin((1 - q / steps) * th) / sn, wb = Math.sin((q / steps) * th) / sn;
              const vx = ax * wa + bx * wb, vy = ay * wa + by * wb, vz = az * wa + bz * wb;
              // Longitude continues from the previous point's (unwrapped).
              let lo = Math.atan2(vy, vx) / RAD;
              lo += 360 * Math.round((plon + ((lon - plon) * q) / steps - lo) / 360);
              project(kind, lo + shift, Math.asin(Math.max(-1, Math.min(1, vz / Math.hypot(vx, vy, vz)))) / RAD);
              this.push((PX - ox) * S, (PY - oy) * S);
            }
          } else for (let q = 1; q < steps; q++) {
            project(kind, plon + ((lon - plon) * q) / steps + shift, plat + ((lat - plat) * q) / steps);
            this.push((PX - ox) * S, (PY - oy) * S);
          }
        }
      }
      if ((!closing || end === 'first') && !(skipFirst && j === 0)) this.push(x, y);
      prev = i; plon = lon; plat = lat; px = x; py = y;
    }
    // A ring that goes round the planet is closed along the south pole (see ParcelGeometry.needsOutline):
    // down the meridian it ends on, along the pole, and back up the meridian it began on. Where
    // meridians are curves on the map they are followed closely (the next copy of the ring, one turn
    // on, runs along the same meridian through the same points, so the two meet exactly).
    if (end === 'ring' && r.wind !== 0 && this.n >= 4) {
      const first = r.lon[from], last = first + 360 * r.wind, top = r.lat[from];
      const steps = this.cyl ? 1 : Math.max(8, Math.min(512, Math.ceil((top + 90) * RAD * Math.sqrt((5 * S) / (8 * tol)))));
      for (let q = 0; q <= steps; q++) { project(kind, last + shift, top + ((-90 - top) * q) / steps); this.push((PX - ox) * S, (PY - oy) * S); }
      for (let q = steps; q >= 0; q--) { project(kind, first + shift, top + ((-90 - top) * q) / steps); this.push((PX - ox) * S, (PY - oy) * S); }
    }
    return this.n >> 1;
  }

  /** Could a piece between two sheet points (bulging by up to `pad`) be seen from the window? */
  private near(ax: number, ay: number, bx: number, by: number, pad: number): boolean {
    return Math.max(ax, bx) + pad >= this.wx0 && Math.min(ax, bx) - pad <= this.wx1 && Math.max(ay, by) + pad >= this.wy0 && Math.min(ay, by) - pad <= this.wy1;
  }

  /** Add a closed ring to a path, once for every copy in view. Returns whether anything was added. */
  ring(path: PathSink, r: Ring): boolean {
    let any = false;
    for (const k of this.copies(r.box)) {
      let n = this.trace(r, k, 0, r.lon.length, 'ring');
      if (n < 3) continue;
      this.marksWindow(n, true);
      let pts: Float64Array = this.buf;
      if (this.beyondGuard(n)) { pts = clipRing(pts, n, GUARD); n = pts.length >> 1; if (n < 3) continue; }
      path.moveTo(pts[0], pts[1]);
      for (let i = 1; i < n; i++) path.lineTo(pts[2 * i], pts[2 * i + 1]);
      path.closePath();
      any = true;
    }
    return any;
  }

  /**
   * Add a closed ring made of several lines end to end (the dissolved outline of several parcels:
   * each part is a stretch of a ring, turned by whole turns so that it carries on from the part before).
   */
  ringOf(path: PathSink, parts: Array<{ cycle: Ring; from: number; to: number; toFirst: boolean; turn: number }>, box: [number, number, number, number]): boolean {
    let any = false;
    for (const k of this.copies(box)) {
      this.n = 0;
      for (const p of parts) this.trace(p.cycle, k, p.from, p.to, p.toFirst ? 'first' : 'open', p.turn, true);
      // The last part ends on the first point again.
      let n = (this.n >> 1) - 1;
      if (n < 3) continue;
      this.marksWindow(n, true);
      let pts: Float64Array = this.buf;
      if (this.beyondGuard(n)) { pts = clipRing(pts, n, GUARD); n = pts.length >> 1; if (n < 3) continue; }
      path.moveTo(pts[0], pts[1]);
      for (let i = 1; i < n; i++) path.lineTo(pts[2 * i], pts[2 * i + 1]);
      path.closePath();
      any = true;
    }
    return any;
  }

  /**
   * The polylines (sheet coordinates: x, y, x, y...) of points from..to-1 of a ring or line, for
   * every copy in view; with `toFirst`, carried on to the ring's first point (its last chain).
   */
  lines(r: Ring, from = 0, to = r.lon.length, toFirst = false): Float32Array[] {
    const out: Float32Array[] = [];
    for (const k of this.copies(r.box)) {
      const n = this.trace(r, k, from, to, toFirst ? 'first' : 'open');
      if (n < 2) continue;
      this.marksWindow(n, false);
      const pts = this.buf;
      if (!this.beyondGuard(n)) { out.push(Float32Array.from(pts.subarray(0, 2 * n))); continue; }
      // Piece by piece, keeping what lies within the guard.
      let cur: number[] = [];
      for (let i = 1; i < n; i++) {
        const c = clipSegment(pts[2 * i - 2], pts[2 * i - 1], pts[2 * i], pts[2 * i + 1], GUARD);
        if (!c) { if (cur.length >= 4) out.push(Float32Array.from(cur)); cur = []; continue; }
        if (!cur.length || c[4]) { if (cur.length >= 4) out.push(Float32Array.from(cur)); cur = [c[0], c[1]]; }
        cur.push(c[2], c[3]);
        if (c[5]) { out.push(Float32Array.from(cur)); cur = []; }
      }
      if (cur.length >= 4) out.push(Float32Array.from(cur));
    }
    return out;
  }

  /** Add an open line to a path, once for every copy in view. */
  line(path: PathSink, r: Ring, from = 0, to = r.lon.length): boolean {
    const ls = this.lines(r, from, to);
    for (const l of ls) addLine(path, l);
    return ls.length > 0;
  }

  /** The sheet coordinates of copy k of a line's points at this sheet's detail (for tests). */
  points(r: Ring, k: number): Float32Array {
    const n = this.trace(r, k, 0, r.lon.length, 'open');
    return Float32Array.from(this.buf.subarray(0, 2 * n));
  }

  /** Does any piece of the n points just traced pass through the window (judged by each piece's box)? */
  private marksWindow(n: number, closed: boolean): void {
    if (this.touched) return;
    const b = this.buf, x0 = this.wx0, y0 = this.wy0, x1 = this.wx1, y1 = this.wy1;
    let px = closed ? b[2 * n - 2] : b[0], py = closed ? b[2 * n - 1] : b[1];
    for (let i = 0; i < n; i++) {
      const x = b[2 * i], y = b[2 * i + 1];
      if ((x > px ? x : px) >= x0 && (x < px ? x : px) <= x1 && (y > py ? y : py) >= y0 && (y < py ? y : py) <= y1) { this.touched = true; return; }
      px = x; py = y;
    }
  }

  private beyondGuard(n: number): boolean {
    const b = this.buf;
    for (let i = 0; i < 2 * n; i++) if (b[i] > GUARD || b[i] < -GUARD || b[i] !== b[i]) return true;
    return false;
  }
}

/** Write a polyline (x, y, x, y...) to a path. */
export function addLine(path: PathSink, l: ArrayLike<number>): void {
  path.moveTo(l[0], l[1]);
  for (let i = 2; i + 1 < l.length; i += 2) path.lineTo(l[i], l[i + 1]);
}

/** The part of the plane a view shows: [x0, y0, x1, y1] in plane units (the box of the view, turned if the view is). */
export function viewRect(view: View, lonRef: number): [number, number, number, number] {
  const s = view.projection.scale(), [tx, ty] = view.projection.translate();
  const shift = isCylindrical(view.camera.projection) ? (view.camera.lon - lonRef) * RAD : 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height]]) {
    const [ux, uy] = rotatePoint(sx, sy, view.width / 2, view.height / 2, -view.rotation);
    const x = (ux - tx) / s + shift, y = (uy - ty) / s;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Clip a closed ring (n points in `pts`) to the square of half-size g around the origin (Sutherland-Hodgman). */
function clipRing(pts: Float64Array, n: number, g: number): Float64Array {
  let cur: number[] = Array.from(pts.subarray(0, 2 * n)).map((v) => (v === v ? v : 0));
  for (let side = 0; side < 4; side++) {
    const out: number[] = [];
    const m = cur.length >> 1;
    if (!m) break;
    const inside = (x: number, y: number) => (side === 0 ? x >= -g : side === 1 ? x <= g : side === 2 ? y >= -g : y <= g);
    for (let i = 0; i < m; i++) {
      const ax = cur[2 * i], ay = cur[2 * i + 1], bx = cur[2 * ((i + 1) % m)], by = cur[2 * ((i + 1) % m) + 1];
      const ia = inside(ax, ay), ib = inside(bx, by);
      if (ia) out.push(ax, ay);
      if (ia !== ib) {
        const t = side < 2 ? ((side === 0 ? -g : g) - ax) / (bx - ax) : ((side === 2 ? -g : g) - ay) / (by - ay);
        out.push(ax + t * (bx - ax), ay + t * (by - ay));
      }
    }
    cur = out;
  }
  return Float64Array.from(cur);
}

/** Clip a segment to the square of half-size g: [ax, ay, bx, by, start moved, end moved], or null if none of it is inside. */
function clipSegment(ax: number, ay: number, bx: number, by: number, g: number): [number, number, number, number, boolean, boolean] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax + g], [dx, g - ax], [-dy, ay + g], [dy, g - ay]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy, t0 > 0, t1 < 1];
}
