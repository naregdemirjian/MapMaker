// The land within reach of a border (D222): what one country takes from a neighbour by advancing a distance from
// their shared border, and a buffer zone a distance either side of a border. Within reach is measured as travel
// through the land itself, the way a front goes (D136): down a long arm before round its end, round a bay rather
// than across it; and, minding the land (D142), slower over mountains and water, so that an advance stops short at a
// range and runs on along a plain. The land reached is traced as smooth outlines, holes and all, in longitude and
// latitude, to be given as an edit of the map (commands.ts, giveLand), which takes only the land it is meant to.
//
// The field is worked out only round the border: nothing farther from it than the distance can be reached, so the
// region is first cut to a box round the border's lines grown by a little more than the distance. That keeps the
// grid fine (at least about ten cells across the distance) however large the countries are.
import { buildFrontField, frontRings, type Rings } from '../render-engine/front-field.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import { E7 } from '../geo-kernel/vec.ts';

/** How much slower a place is to cross than open flat land (1: as fast), as front-terrain.ts measures it. */
export type SlowAt = (lon: number, lat: number, cellDeg: number) => number;

/** A polygon in longitude and latitude: its outline, then its holes. */
export type LonLatPolygon = Array<Array<[number, number]>>;

/** Degrees of arc in a distance on a planet of this radius (kilometres). */
export const degreesFor = (km: number, radiusKm: number): number => (km / radiusKm) * (180 / Math.PI);

/** Distances an advance or a buffer zone may be given (kilometres). */
export const REACH_KM = { min: 1, max: 2000, step: 5, start: 50 } as const;

/** Why no land could be found within reach. */
export type ReachProblem = 'no-border' | 'too-long' | 'nothing';

/**
 * The land of `region` (rings in longitude and latitude, read together by the even-odd rule: outlines and holes,
 * or the rings of many parcels) within `km` of travel from `lines` (segments as lon0, lat0, lon1, lat1 in turn),
 * minding the land with `slowAt`, on a planet of radius `radiusKm`: polygons (outline, then holes). With the
 * problem when there is none: no border, a border too long to measure at once (over 300° of longitude with its
 * reach), or nothing reached.
 */
export function landWithin(region: Rings, lines: ArrayLike<number>, km: number, radiusKm: number, slowAt?: SlowAt): { polygons: LonLatPolygon[]; problem: ReachProblem | null } {
  const deg = degreesFor(Math.max(0, km), radiusKm);
  if (lines.length < 4) return { polygons: [], problem: 'no-border' };
  if (!(deg > 0)) return { polygons: [], problem: 'nothing' };
  // 1. The border's lines in one run of longitudes (from its first point), and the box they and their reach lie in.
  const ref = lines[0];
  const L: number[] = [];
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (let q = 0; q + 1 < lines.length; q += 2) {
    const x = lines[q] + 360 * Math.round((ref - lines[q]) / 360), y = lines[q + 1];
    L.push(x, y);
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  // (Grown a third more than the distance: the box's own sides, which are no edges of the land, must lie out of
  // reach, or the land reached would be carried on past them as past the land's real edges.)
  const grow = deg * 1.35;
  s = Math.max(-89.5, s - grow); n = Math.min(89.5, n + grow);
  const pad = grow / Math.max(0.02, Math.cos((Math.min(89, Math.max(Math.abs(s), Math.abs(n))) * Math.PI) / 180));
  w -= pad; e += pad;
  if (e - w > 300) return { polygons: [], problem: 'too-long' };
  const box: [number, number, number, number] = [w, s, e, n], mid = (w + e) / 2;
  // 2. The region cut to the box: each ring made continuous, tried at the copies of its longitudes that may meet it.
  const cut: Rings = [];
  for (const r0 of region) {
    if (r0.length < 3) continue;
    const r = continuous(r0);
    let lo = Infinity, hi = -Infinity;
    for (const [x] of r) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const k0 = Math.round((mid - (lo + hi) / 2) / 360);
    for (const k of [k0 - 1, k0, k0 + 1]) {
      const dx = 360 * k;
      if (hi + dx < w || lo + dx > e) continue;
      const c = clipRing(dx ? r.map(([x, y]) => [x + dx, y] as [number, number]) : r, box);
      if (c.length >= 3) cut.push(c);
    }
  }
  if (!cut.length) return { polygons: [], problem: 'nothing' };
  // 3. Travel from the border through the region: fine enough for about ten cells across the distance.
  const k = Math.cos((Math.max(-80, Math.min(80, (s + n) / 2)) * Math.PI) / 180);
  const longer = Math.max((e - w) * k, n - s);
  const cells = Math.max(24, Math.min(400, Math.ceil((longer / deg) * 10)));
  const field = buildFrontField(cut, { kind: 'lines', lonlat: L }, { roughness: 0, seed: 1, cells, slowAt, continuous: true });
  if (!field || !(field.travel > 0)) return { polygons: [], problem: 'nothing' };
  // 4. The land reached within the distance (all of it when the farthest place is nearer), with its holes.
  const rings = frontRings(field, Math.min(1, deg / field.travel));
  const polygons = polygonsOf(rings);
  return { polygons, problem: polygons.length ? null : 'nothing' };
}

/** A ring's longitudes made continuous from its first point (a ring across the 180th meridian runs past 180). */
function continuous(r: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let prev = r[0][0];
  for (const [x0, y] of r) {
    let x = x0;
    while (x - prev > 180) x -= 360;
    while (prev - x > 180) x += 360;
    out.push([x, y]);
    prev = x;
  }
  return out;
}

/** A ring cut to a box (Sutherland and Hodgman's way: a side at a time), the ring and the box in the same longitudes. */
export function clipRing(r: Array<[number, number]>, [w, s, e, n]: [number, number, number, number]): Array<[number, number]> {
  let pts = r;
  const side = (inside: (p: [number, number]) => boolean, cross: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ia = inside(a), ib = inside(b);
      if (ib) { if (!ia) out.push(cross(a, b)); out.push(b); } else if (ia) out.push(cross(a, b));
    }
    pts = out;
  };
  const atX = (x: number) => (a: [number, number], b: [number, number]): [number, number] => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const atY = (y: number) => (a: [number, number], b: [number, number]): [number, number] => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  side((p) => p[0] >= w, atX(w));
  if (pts.length) side((p) => p[0] <= e, atX(e));
  if (pts.length) side((p) => p[1] >= s, atY(s));
  if (pts.length) side((p) => p[1] <= n, atY(n));
  return pts;
}

/** Twice a ring's signed area in the plane of longitude and latitude. */
function area2(r: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a;
}

/** Whether a point lies inside a ring (even-odd, in the plane of longitude and latitude). */
function inRing(x: number, y: number, r: Array<[number, number]>): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}

/**
 * Rings that together make an area by the even-odd rule (none crossing another) as polygons: a ring inside an even
 * number of others is an outline, one inside an odd number a hole in the smallest outline round it.
 */
export function polygonsOf(rings: Rings): LonLatPolygon[] {
  const rs = rings.filter((r) => r.length >= 4 && Math.abs(area2(r)) > 1e-12);
  // (A point of each ring tested: the middle of its first side, which lies on no other ring.)
  const probe = rs.map((r) => [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2] as [number, number]);
  const holders = rs.map((_, i) => rs.map((o, j) => (j !== i && inRing(probe[i][0], probe[i][1], o) ? j : -1)).filter((j) => j >= 0));
  const depth = holders.map((h) => h.length);
  const out: LonLatPolygon[] = [], at = new Map<number, number>();
  rs.forEach((r, i) => { if (depth[i] % 2 === 0) at.set(i, out.push([r]) - 1); });
  rs.forEach((r, i) => {
    if (depth[i] % 2 === 0) return;
    let best = -1;
    for (const j of holders[i]) if (depth[j] === depth[i] - 1 && (best < 0 || Math.abs(area2(rs[j])) < Math.abs(area2(rs[best])))) best = j;
    if (best >= 0) out[at.get(best)!].push(r);
  });
  return out;
}

/** The border between the land of owners `a` and `b` (segments as lon0, lat0, lon1, lat1 in turn), as `ownerOf` reads the map. */
export function sharedBorder(arr: Arrangement, ownerOf: (face: number) => string | null, a: string, b: string): number[] {
  const out: number[] = [];
  for (const sg of arr.segments.values()) {
    const l = ownerOf(sg.left_face), r = ownerOf(sg.right_face);
    if (!((l === a && r === b) || (l === b && r === a))) continue;
    const p = arr.vertices.get(sg.a), q = arr.vertices.get(sg.b);
    if (p && q) out.push(p.lon / E7, p.lat / E7, q.lon / E7, q.lat / E7);
  }
  return out;
}

/** The rings of every parcel the owners hold, as `ownerOf` reads the map (read together by the even-odd rule). */
export function landRings(arr: Arrangement, ownerOf: (face: number) => string | null, owners: ReadonlySet<string>): Rings {
  const out: Rings = [];
  for (const f of arr.leafFaces()) {
    const o = ownerOf(f);
    if (o === null || !owners.has(o)) continue;
    for (const r of arr.faceRingsLonLat(f)) if (r.length >= 3) out.push(r);
  }
  return out;
}

/** The two owners either side of the border between owners nearest a place, among those within `maxDeg` degrees of it. */
export function borderNear(arr: Arrangement, ownerOf: (face: number) => string | null, lon: number, lat: number, maxDeg: number): [string, string] | null {
  const k = Math.max(0.02, Math.cos((lat * Math.PI) / 180));
  let best: [string, string] | null = null, bd = maxDeg;
  for (const sg of arr.segments.values()) {
    const l = ownerOf(sg.left_face), r = ownerOf(sg.right_face);
    if (l === r || l === null || r === null) continue;
    const p = arr.vertices.get(sg.a), q = arr.vertices.get(sg.b);
    if (!p || !q) continue;
    // (Distances in the plane round the place, longitudes taken to its side of the planet.)
    const ax = ((p.lon / E7 - lon + 540) % 360 - 180) * k, ay = p.lat / E7 - lat, bx = ((q.lon / E7 - lon + 540) % 360 - 180) * k, by = q.lat / E7 - lat;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < bd) { bd = d; best = [l, r]; }
  }
  return best;
}
