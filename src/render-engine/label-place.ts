// Where a country's label goes and how large it can be. Pure functions, shared by the renderer and
// the tests.
//
// A country's label is placed in its main piece of territory (the largest connected part), at the
// point that leaves the most room for the label's own shape: a search for the widest ellipse with the
// label's proportions that fits inside the outline (the "pole of inaccessibility", stretched to the
// text), mildly drawn towards the middle of the piece. The work is done in the map projection's own
// plane, so the room measured is the room seen on screen.
import { geoEquirectangular, geoEqualEarth, geoMercator, geoNaturalEarth1, geoGnomonic, type GeoProjection } from 'd3-geo';
import type { ProjectionName } from './camera.ts';

const factories = { equirectangular: geoEquirectangular, equalEarth: geoEqualEarth, naturalEarth: geoNaturalEarth1, mercator: geoMercator, flat: geoGnomonic };
const RAD = Math.PI / 180;

/** A territory's outline in a projection's plane (scale 1), centred on the territory. */
export interface PlaneShape {
  /** Outline pieces as x0, y0, x1, y1 (projection units). */
  edges: Float64Array;
  bbox: [number, number, number, number];
  projection: GeoProjection;
  /** The edges sorted into a grid, for quick distance and inside tests (made on first use). */
  grid?: EdgeGrid;
}

/**
 * The outline's edges by the grid cells they pass through, and by the columns they span. Finding the
 * nearest edge to a point, or whether the point is inside, then looks only at the edges nearby (a
 * large country has thousands of edges, and a label search asks thousands of times).
 */
interface EdgeGrid {
  x0: number; y0: number; cw: number; ch: number; nx: number; ny: number;
  /** Edges (index of their first coordinate) of cell c: cellEdges[cellStart[c] .. cellStart[c + 1]]. */
  cellStart: Int32Array; cellEdges: Int32Array;
  /** Edges spanning column i (for counting the outline's crossings of a vertical line). */
  colStart: Int32Array; colEdges: Int32Array;
}

function gridOf(shape: PlaneShape): EdgeGrid {
  if (shape.grid) return shape.grid;
  const { edges, bbox } = shape;
  const n = edges.length / 4;
  const side = Math.max(4, Math.min(256, Math.round(Math.sqrt(n))));
  const w = Math.max(bbox[2] - bbox[0], 1e-12), h = Math.max(bbox[3] - bbox[1], 1e-12);
  const nx = side, ny = side, cw = w / nx, ch = h / ny, x0 = bbox[0], y0 = bbox[1];
  const cx = (x: number) => Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / cw)));
  const cy = (y: number) => Math.max(0, Math.min(ny - 1, Math.floor((y - y0) / ch)));
  // Two passes: count, then fill.
  const cellCount = new Int32Array(nx * ny + 1), colCount = new Int32Array(nx + 1);
  const span = (i: number) => [cx(Math.min(edges[i], edges[i + 2])), cx(Math.max(edges[i], edges[i + 2])), cy(Math.min(edges[i + 1], edges[i + 3])), cy(Math.max(edges[i + 1], edges[i + 3]))];
  for (let i = 0; i < edges.length; i += 4) {
    const [a, b, c, d] = span(i);
    for (let u = a; u <= b; u++) { colCount[u + 1]++; for (let v = c; v <= d; v++) cellCount[v * nx + u + 1]++; }
  }
  for (let i = 0; i < nx * ny; i++) cellCount[i + 1] += cellCount[i];
  for (let i = 0; i < nx; i++) colCount[i + 1] += colCount[i];
  const cellEdges = new Int32Array(cellCount[nx * ny]), colEdges = new Int32Array(colCount[nx]);
  const cellAt = cellCount.slice(0, nx * ny), colAt = colCount.slice(0, nx);
  for (let i = 0; i < edges.length; i += 4) {
    const [a, b, c, d] = span(i);
    for (let u = a; u <= b; u++) { colEdges[colAt[u]++] = i; for (let v = c; v <= d; v++) cellEdges[cellAt[v * nx + u]++] = i; }
  }
  return (shape.grid = { x0, y0, cw, ch, nx, ny, cellStart: cellCount, cellEdges, colStart: colCount, colEdges });
}

/**
 * The outline of a territory, given as border arcs (lon0, lat0, lon1, lat1 in degrees, any order and
 * direction), in the plane of `projection` turned so the territory is in the middle (`centreLon`).
 */
export function planeShape(arcs: ArrayLike<number>, projectionName: ProjectionName, centreLon: number): PlaneShape {
  const projection = factories[projectionName]().rotate([-centreLon, 0]).scale(1).translate([0, 0]).precision(0.1);
  if (projectionName === 'mercator') projection.clipExtent(null);
  const maxLat = projectionName === 'mercator' ? 85 : 90;
  const out: number[] = [];
  const P = (lon: number, lat: number) => projection([lon, Math.max(-maxLat, Math.min(maxLat, lat))]);
  // Half the width of the projected world: an edge longer than this crosses the cut behind the planet.
  const a0 = P(centreLon - 179.999, 0), a1 = P(centreLon + 179.999, 0);
  // A flat map's plan has no back side (and the gnomonic projection does not show the whole world).
  const halfWorld = projectionName === 'flat' ? Infinity : a0 && a1 ? Math.abs(a1[0] - a0[0]) / 2 : Math.PI;
  for (let i = 0; i + 3 < arcs.length; i += 4) {
    const lon0 = arcs[i], lat0 = arcs[i + 1], lon1 = arcs[i + 2], lat1 = arcs[i + 3];
    // Long arcs are followed as great circles, in pieces of at most one degree.
    const v0 = vec(lon0, lat0), v1 = vec(lon1, lat1);
    const ang = Math.acos(Math.max(-1, Math.min(1, v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2])));
    const n = Math.max(1, Math.ceil(ang / RAD));
    let prev = P(lon0, lat0);
    for (let k = 1; k <= n; k++) {
      let q: [number, number];
      if (k === n) q = [lon1, lat1];
      else {
        const t = k / n, s = Math.sin(ang);
        const w0 = Math.sin((1 - t) * ang) / s, w1 = Math.sin(t * ang) / s;
        q = lonlat([w0 * v0[0] + w1 * v1[0], w0 * v0[1] + w1 * v1[1], w0 * v0[2] + w1 * v1[2]]);
      }
      const p = P(q[0], q[1]);
      if (prev && p && Math.abs(p[0] - prev[0]) < halfWorld) out.push(prev[0], prev[1], p[0], p[1]);
      prev = p;
    }
  }
  const edges = Float64Array.from(out);
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < edges.length; i += 2) {
    const x = edges[i], y = edges[i + 1];
    if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
    if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
  }
  return { edges, bbox, projection };
}

function vec(lon: number, lat: number): [number, number, number] {
  const a = lon * RAD, b = lat * RAD;
  return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
}
function lonlat(v: [number, number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2] / len))) / RAD];
}

/** Signed distance from (x, y) to the outline, with x divided by `stretch`: positive inside. */
export function signedDistance(shape: PlaneShape, x: number, y: number, stretch: number, limit = Infinity): number {
  const edges = shape.edges, g = gridOf(shape);
  const k = 1 / stretch;
  // Inside: an even-odd count of the outline crossing the vertical line above the point (projected
  // outlines of a polar territory are open at the sides, but always cross a vertical line properly).
  // Only edges spanning the point's column can cross it.
  let inside = false;
  if (x >= shape.bbox[0] && x <= shape.bbox[2]) {
    const col = Math.max(0, Math.min(g.nx - 1, Math.floor((x - g.x0) / g.cw)));
    for (let q = g.colStart[col]; q < g.colStart[col + 1]; q++) {
      const i = g.colEdges[q];
      const ax = edges[i], ay = edges[i + 1], bx = edges[i + 2], by = edges[i + 3];
      if ((ax > x) !== (bx > x) && ay + ((x - ax) * (by - ay)) / (bx - ax) < y) inside = !inside;
    }
  }
  // Distance in the stretched plane: the nearest edge among those in a box around the point, the box
  // growing until nothing outside it could be nearer.
  let best = Infinity;
  let r = Math.max(g.ch, g.cw * k);
  for (;;) {
    const u0 = Math.floor((x - r * stretch - g.x0) / g.cw), u1 = Math.floor((x + r * stretch - g.x0) / g.cw);
    const v0 = Math.floor((y - r - g.y0) / g.ch), v1 = Math.floor((y + r - g.y0) / g.ch);
    const a = Math.max(0, u0), b = Math.min(g.nx - 1, u1), c = Math.max(0, v0), d = Math.min(g.ny - 1, v1);
    for (let v = c; v <= d; v++) for (let u = a; u <= b; u++) {
      const cell = v * g.nx + u;
      for (let q = g.cellStart[cell]; q < g.cellStart[cell + 1]; q++) {
        const i = g.cellEdges[q];
        const ax = edges[i], ay = edges[i + 1];
        const px = (x - ax) * k, py = y - ay, dx = (edges[i + 2] - ax) * k, dy = edges[i + 3] - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - t * dx, ey = py - t * dy;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) best = d2;
      }
    }
    // Every edge within r of the point (in the stretched plane) passes through the box.
    if (best <= r * r || (u0 <= 0 && v0 <= 0 && u1 >= g.nx - 1 && v1 >= g.ny - 1)) break;
    // Farther than the caller cares about: that is all it needs to know.
    if (r >= limit) { best = limit * limit; break; }
    r *= 2;
  }
  const dist = Math.min(Math.sqrt(best), limit);
  return inside ? dist : -dist;
}

export interface LabelSpot {
  /** Projection-plane position (scale 1, turned to the territory). */
  x: number;
  y: number;
  /** The label's room: half the height of the widest fitting ellipse with the label's proportions. */
  room: number;
  lon: number;
  lat: number;
}

/**
 * The best place for a label `aspect` times as wide as it is tall: where the widest ellipse with
 * those proportions fits inside the outline, mildly drawn towards the middle. `accept` can rule
 * places out (for example the sea, or off screen); `within` limits the search to a box of the plane.
 * `cap`: room beyond this (in the plane's units) is worth no more, so among places with that much
 * room the one nearest the middle wins, and the search need not measure how much more there is.
 * Null when nothing inside is acceptable.
 */
export function placeLabel(shape: PlaneShape, aspect: number, accept?: (lon: number, lat: number) => boolean, within?: [number, number, number, number], cap = Infinity): LabelSpot | null {
  const { edges, projection } = shape;
  let bbox = shape.bbox;
  // Searching only part of the territory (the part on screen, say): start from that part's box.
  if (within) bbox = [Math.max(bbox[0], within[0]), Math.max(bbox[1], within[1]), Math.min(bbox[2], within[2]), Math.min(bbox[3], within[3])];
  if (!edges.length || !(bbox[2] > bbox[0]) || !(bbox[3] > bbox[1])) return null;
  const st = Math.max(0.2, aspect);
  // Work in the stretched plane: there the label's ellipse is a circle.
  const W = (bbox[2] - bbox[0]) / st, H = bbox[3] - bbox[1];
  const cx0 = (bbox[0] + bbox[2]) / 2 / st, cy0 = (bbox[1] + bbox[3]) / 2;
  // Drawn towards the middle: a place half the territory's size away from it scores 15% less.
  const R = Math.max(W, H) / 2;
  const bias = (dc: number) => 1 - 0.3 * Math.min(1, Math.max(0, dc) / R);
  const evalAt = (x: number, y: number) => signedDistance(shape, x * st, y, st, cap);
  const precision = Math.max(W, H) / 400;
  const lonlatOf = (x: number, y: number) => projection.invert?.([x * st, y]) ?? null;
  const ok = (x: number, y: number) => {
    if (!accept) return true;
    const ll = lonlatOf(x, y);
    return !!ll && accept(ll[0], ll[1]);
  };
  type Cell = { x: number; y: number; h: number; d: number; score: number; max: number };
  const make = (x: number, y: number, h: number): Cell => {
    const d = evalAt(x, y);
    const dc = Math.hypot(x - cx0, y - cy0);
    const good = d > 0 && ok(x, y);
    return { x, y, h, d, score: good ? d * bias(dc) : -Infinity, max: Math.min(d + h * Math.SQRT2, cap) * bias(dc - h * Math.SQRT2) };
  };
  const heap = new MaxHeap<Cell>((c) => c.max);
  const size = Math.min(W, H);
  const h0 = size / 2;
  for (let x = cx0 - W / 2; x < cx0 + W / 2; x += size) for (let y = cy0 - H / 2; y < cy0 + H / 2; y += size) heap.push(make(x + h0, y + h0, h0));
  let best: Cell | null = null;
  const centre = make(cx0, cy0, 0);
  if (centre.score > -Infinity) best = centre;
  let n = 0;
  while (heap.size && n++ < 6000) {
    const c = heap.pop()!;
    if (c.score > (best?.score ?? -Infinity)) best = c;
    if (best && c.max - best.score <= precision) continue;
    if (c.h < precision / 4) continue;
    const h = c.h / 2;
    heap.push(make(c.x - h, c.y - h, h)); heap.push(make(c.x + h, c.y - h, h));
    heap.push(make(c.x - h, c.y + h, h)); heap.push(make(c.x + h, c.y + h, h));
  }
  if (!best) return null;
  const ll = lonlatOf(best.x, best.y);
  if (!ll) return null;
  return { x: best.x * st, y: best.y, room: best.d, lon: ll[0], lat: ll[1] };
}

/**
 * How a label's text can be broken into lines: one line, and for names of several words the most
 * even two- and three-line versions.
 */
export function lineChoices(text: string): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[][] = [[text]];
  if (words.length < 2 || text.length < 14) return out;
  for (const k of [2, 3]) {
    if (words.length < k) break;
    let bestLines: string[] | null = null, bestLen = Infinity;
    // Every way of cutting the words into k runs (names are short, so this is small).
    const cuts = (start: number, left: number, acc: string[]): void => {
      if (left === 1) {
        const lines = [...acc, words.slice(start).join(' ')];
        const longest = Math.max(...lines.map((l) => l.length));
        if (longest < bestLen) { bestLen = longest; bestLines = lines; }
        return;
      }
      for (let i = start + 1; i <= words.length - left + 1; i++) cuts(i, left - 1, [...acc, words.slice(start, i).join(' ')]);
    };
    cuts(0, k, []);
    if (bestLines && bestLen < text.length * 0.75) out.push(bestLines);
  }
  return out;
}

/** Width of a line in font sizes (an estimate; good enough to choose places and sizes). */
export function textWidthEm(line: string, uppercase: boolean, letterSpacing: number): number {
  let w = 0;
  for (const ch of line) {
    if (ch === ' ') w += 0.28;
    else if (/[.,'’\-]/.test(ch)) w += 0.3;
    else if (uppercase || (ch >= 'A' && ch <= 'Z')) w += 0.68;
    else if ('ijl'.includes(ch)) w += 0.26;
    else if ('mw'.includes(ch)) w += 0.85;
    else w += 0.55;
    w += letterSpacing;
  }
  return w;
}

/** Height of a block of lines, in font sizes. */
export const LINE_HEIGHT = 1.05;
export const blockHeightEm = (lines: number) => 0.85 + (lines - 1) * LINE_HEIGHT;

class MaxHeap<T> {
  private a: T[] = [];
  private key: (t: T) => number;
  constructor(key: (t: T) => number) { this.key = key; }
  get size() { return this.a.length; }
  push(t: T): void {
    const a = this.a; a.push(t);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.key(a[p]) >= this.key(a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): T | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.key(a[l]) > this.key(a[m])) m = l;
        if (r < a.length && this.key(a[r]) > this.key(a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
