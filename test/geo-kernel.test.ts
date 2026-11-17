import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoContains, geoArea } from 'd3-geo';
import { Arrangement, type IdSource, type KernelTable } from '../src/geo-kernel/arrangement.ts';
import { orient, arcsCross } from '../src/geo-kernel/predicates.ts';
import { type Vec3, lonLatToVec, slerp, dot, cross } from '../src/geo-kernel/vec.ts';
import { rng } from './helpers.ts';

function idSource(): IdSource {
  const n: Record<KernelTable, number> = { vertex: 0, segment: 0, face: 0 };
  return { next: (t) => ++n[t] };
}

function fresh() {
  const ids = idSource();
  const { arrangement } = Arrangement.createEmpty('w1', ids);
  return { arr: arrangement, ids };
}

/** Densify a lon/lat ring so no arc exceeds `maxDeg` degrees. */
function densify(points: Array<[number, number]>, closed: boolean, maxDeg = 1): Vec3[] {
  const out: Vec3[] = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = lonLatToVec(...points[i]);
    const b = lonLatToVec(...points[(i + 1) % n]);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
    const k = Math.max(1, Math.ceil(ang / maxDeg));
    for (let j = 0; j < k; j++) out.push(slerp(a, b, j / k));
  }
  if (!closed) out.push(lonLatToVec(...points[n - 1]));
  return out;
}

function insertRing(arr: Arrangement, pts: Array<[number, number]>, snap = 1e-7) {
  arr.begin();
  try {
    const path = arr.insertPath(densify(pts, true), { closed: true, snap });
    const diff = arr.commit();
    return { path, diff };
  } catch (e) {
    arr.rollback();
    throw e;
  }
}

/** d3-geo polygon for a face (d3 wants the interior on the right of each ring). */
function d3Polygon(arr: Arrangement, face: number): GeoJSON.Polygon | null {
  const rings = arr.faceRingsLonLat(face);
  if (rings.length === 0) return null;
  return { type: 'Polygon', coordinates: rings.map((r) => { const rr = [...r].reverse(); rr.push(rr[0]); return rr; }) };
}

function assertSound(arr: Arrangement) {
  assert.deepEqual(arr.validate(), []);
  const total = arr.leafFaces().reduce((s, f) => s + arr.faceArea(f), 0);
  assert.ok(Math.abs(total - 4 * Math.PI) < 1e-6, `leaf areas sum to ${total}`);
}

const square = (lon: number, lat: number, h: number): Array<[number, number]> => [
  [lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h],
];

test('orientation predicate is the exact sign of det[a,b,c]', () => {
  const r = rng(1);
  for (let i = 0; i < 2000; i++) {
    const a = lonLatToVec(r.float(-180, 180), r.float(-90, 90));
    const b = lonLatToVec(r.float(-180, 180), r.float(-90, 90));
    const c = lonLatToVec(r.float(-180, 180), r.float(-90, 90));
    const det = dot(a, cross(b, c));
    if (Math.abs(det) > 1e-9) assert.equal(orient(a, b, c), Math.sign(det));
  }
  assert.equal(orient([1, 0, 0], [0, 1, 0], [0, 0, 1]), 1);
});

test('arc crossing ignores the antipodal intersection', () => {
  const v = lonLatToVec;
  assert.equal(arcsCross(v(0, 0), v(90, 0), v(45, -10), v(45, 10)), 'cross');
  assert.equal(arcsCross(v(0, 0), v(90, 0), v(45, 10), v(45, 20)), 'none');
  // the great circles also meet at (-135, 0), which is not on either arc
  assert.equal(arcsCross(v(0, 0), v(90, 0), v(-135, -10), v(-135, 10)), 'none');
  assert.equal(arcsCross(v(179, -1), v(-179, 1), v(179, 1), v(-179, -1)), 'cross');
});

test('a square splits the sphere into an inside and an outside with lineage', () => {
  const { arr } = fresh();
  const root = arr.rootFace;
  const { path } = insertRing(arr, square(10, 20, 5));
  assertSound(arr);
  const leaves = arr.leafFaces();
  assert.equal(leaves.length, 2);
  assert.equal(arr.faces.get(root)!.is_leaf, 0);
  for (const f of leaves) assert.equal(arr.faces.get(f)!.parent_id, root);
  const inside = arr.locate(lonLatToVec(10, 20));
  const outside = arr.locate(lonLatToVec(-100, -40));
  assert.notEqual(inside, outside);
  assert.equal(arr.rootFace, outside);
  assert.deepEqual([...arr.facesLeftOf(path)], [inside]);
  const expected = geoArea(d3Polygon(arr, inside)!);
  assert.ok(Math.abs(arr.faceArea(inside) - expected) < 1e-9);
});

test('a ring around the north pole that crosses the 180° meridian', () => {
  const { arr } = fresh();
  const ring: Array<[number, number]> = [];
  for (let lon = -180; lon < 180; lon += 10) ring.push([lon + 5, 70]);
  insertRing(arr, ring);
  assertSound(arr);
  const cap = arr.locate(lonLatToVec(0, 90));
  const rest = arr.locate(lonLatToVec(0, -90));
  assert.notEqual(cap, rest);
  assert.equal(arr.locate(lonLatToVec(180, 80)), cap);
  assert.equal(arr.locate(lonLatToVec(-179.9, 75)), cap);
  // Our arcs are great circles, so the cap is slightly smaller than the lat-70 cap; compare with d3.
  const expected = geoArea(d3Polygon(arr, cap)!);
  assert.ok(Math.abs(arr.faceArea(cap) - expected) < 1e-6, `${arr.faceArea(cap)} vs ${expected}`);
});

test('nested islands get the right containing faces', () => {
  const { arr } = fresh();
  insertRing(arr, square(0, 0, 20));
  const a = arr.locate(lonLatToVec(0, 0));
  insertRing(arr, square(0, 0, 5));
  assertSound(arr);
  const inner = arr.locate(lonLatToVec(0, 0));
  const ring = arr.locate(lonLatToVec(15, 15));
  const outside = arr.locate(lonLatToVec(100, 0));
  assert.equal(new Set([inner, ring, outside]).size, 3);
  // both pieces of the old face a are its children
  assert.equal(arr.faces.get(inner)!.parent_id, a);
  assert.equal(arr.faces.get(ring)!.parent_id, a);
  assert.equal(arr.faces.get(a)!.is_leaf, 0);
  // a separate island far away splits the outside face
  insertRing(arr, square(120, -30, 3));
  assertSound(arr);
  assert.equal(arr.leafFaces().length, 4);
});

test('a line across a square splits it; a dangling line splits nothing', () => {
  const { arr } = fresh();
  insertRing(arr, square(0, 0, 10));
  const before = arr.leafFaces().length;
  arr.begin();
  arr.insertPath(densify([[-15, 2], [15, -3]], false), { closed: false, snap: 1e-7 });
  arr.commit();
  assertSound(arr);
  assert.equal(arr.leafFaces().length, before + 1);
  assert.notEqual(arr.locate(lonLatToVec(0, 5)), arr.locate(lonLatToVec(0, -5)));
  const count = arr.leafFaces().length;
  arr.begin();
  arr.insertPath(densify([[40, 40], [50, 45]], false), { closed: false, snap: 1e-7 });
  arr.commit();
  assertSound(arr);
  assert.equal(arr.leafFaces().length, count);
});

test('overlapping and nearly coincident rings are snapped, never leaving slivers', () => {
  const { arr } = fresh();
  insertRing(arr, square(30, 10, 8));
  // same square shifted by ~1 m: within a 1e-6 rad (~6 m) snap tolerance it must reuse the borders
  const tiny = 1e-5;
  insertRing(arr, square(30 + tiny, 10 - tiny, 8), 1e-6);
  assertSound(arr);
  assert.equal(arr.leafFaces().length, 2);
  // a partly overlapping square shares part of a border
  insertRing(arr, [[38, 2], [45, 2], [45, 18], [38, 18]], 1e-6);
  assertSound(arr);
  assert.equal(arr.leafFaces().length, 3);
});

test('randomised rings: topology stays valid and point location agrees with d3-geo', () => {
  const r = rng(20251115);
  const { arr } = fresh();
  for (let k = 0; k < 18; k++) {
    const cLon = r.float(-180, 180), cLat = r.float(-80, 80);
    const rad = r.float(2, 40);
    const n = r.int(3, 9);
    const ring: Array<[number, number]> = [];
    const c = lonLatToVec(cLon, cLat);
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * i) / n + r.float(-0.2, 0.2);
      const rr = rad * r.float(0.6, 1);
      // walk from the centre on the sphere: tangent basis at c
      const e = Math.abs(c[2]) > 0.999 ? [0, 1, 0] as Vec3 : ([-c[1], c[0], 0].map((x) => x / Math.hypot(c[0], c[1])) as Vec3);
      const nn = cross(c, e);
      const t = (rr * Math.PI) / 180;
      const dir: Vec3 = [e[0] * Math.cos(ang) + nn[0] * Math.sin(ang), e[1] * Math.cos(ang) + nn[1] * Math.sin(ang), e[2] * Math.cos(ang) + nn[2] * Math.sin(ang)];
      const p: Vec3 = [c[0] * Math.cos(t) + dir[0] * Math.sin(t), c[1] * Math.cos(t) + dir[1] * Math.sin(t), c[2] * Math.cos(t) + dir[2] * Math.sin(t)];
      ring.push([Math.atan2(p[1], p[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, p[2]))) * 180 / Math.PI]);
    }
    insertRing(arr, ring, r.pick([1e-7, 1e-6, 1e-4]));
    assertSound(arr);
  }
  const leaves = arr.leafFaces();
  assert.ok(leaves.length > 18, `only ${leaves.length} faces`);
  const polys = new Map(leaves.map((f) => [f, d3Polygon(arr, f)]));
  for (let i = 0; i < 300; i++) {
    const lon = r.float(-180, 180), lat = r.float(-89, 89);
    const f = arr.locate(lonLatToVec(lon, lat));
    const containing = leaves.filter((g) => { const p = polys.get(g); return p ? geoContains(p, [lon, lat]) : true; });
    assert.ok(containing.includes(f), `point ${lon},${lat}: kernel says ${f}, d3 says ${containing}`);
  }
});

test('rows round-trip: a reloaded parcel map is identical', () => {
  const { arr, ids } = fresh();
  insertRing(arr, square(-60, 40, 10));
  insertRing(arr, square(-55, 45, 10));
  const rows = arr.rows();
  const re = Arrangement.fromRows('w1', rows.rootFace, rows.vertices, rows.segments, rows.faces, ids);
  assert.deepEqual(re.validate(), []);
  for (const f of arr.leafFaces()) assert.deepEqual(re.faceCycles(f), arr.faceCycles(f));
  for (const [lon, lat] of [[-60, 40], [-50, 50], [0, 0], [-57, 42]]) assert.equal(re.locate(lonLatToVec(lon, lat)), arr.locate(lonLatToVec(lon, lat)));
});

test('rollback restores everything after a failed operation', () => {
  const { arr } = fresh();
  insertRing(arr, square(0, 0, 10));
  const before = JSON.stringify(arr.rows());
  arr.begin();
  arr.insertPath(densify(square(5, 5, 10), true), { closed: true, snap: 1e-7 });
  arr.rollback();
  assert.equal(JSON.stringify(arr.rows()), before);
  assert.deepEqual(arr.validate(), []);
});

test('vertex moves keep topology, and moves that would cross a border are refused', () => {
  const { arr } = fresh();
  insertRing(arr, square(0, 0, 10));
  insertRing(arr, square(30, 0, 5));
  const leavesBefore = arr.leafFaces();
  // the corner at (10, 10) of the first square
  const corner = arr.nearestVertex(lonLatToVec(10, 10), 1e-6)!;
  assert.ok(corner);
  arr.begin();
  arr.moveVertex(corner, lonLatToVec(12, 12), 1e-7);
  const diff = arr.commit();
  assert.ok(diff.changes.some((c) => c.table === 'vertex'));
  assert.deepEqual(arr.leafFaces(), leavesBefore);
  assertSound(arr);
  assert.equal(arr.locate(lonLatToVec(10.5, 10.3)), arr.locate(lonLatToVec(0, 0))); // newly covered by the moved corner
  // dragging the corner past the second square would sweep over it
  const check = arr.canMoveVertex(corner, lonLatToVec(40, 2), 1e-7);
  assert.equal(check.ok, false);
});

test('adding and removing a vertex on a border', () => {
  const { arr } = fresh();
  insertRing(arr, square(0, 0, 10));
  const seg = arr.nearestSegment(lonLatToVec(0.5, -10.1), 5e-3)!;
  arr.begin();
  const v = arr.insertVertexOnSegment(seg.s.id, lonLatToVec(0, -10));
  arr.commit();
  assertSound(arr);
  arr.begin();
  arr.moveVertex(v, lonLatToVec(0, -12), 1e-7);
  arr.commit();
  assertSound(arr);
  arr.begin();
  arr.removeVertex(v);
  arr.commit();
  assertSound(arr);
  assert.equal(arr.leafFaces().length, 2);
});

test('a parcel\'s area: the turns summed on plain numbers equal the turns from the arcs\' directions, and d3\'s area', async () => {
  const { arcDirectionAtEnd, arcDirectionAtStart } = await import('../src/geo-kernel/vec.ts');
  const { geoArea } = await import('d3-geo');
  const r = rng(41);
  const ids: IdSource = (() => { const n: Record<string, number> = { vertex: 0, segment: 0, face: 0 }; return { next: (t: string) => ++n[t] }; })() as IdSource;
  const arr = Arrangement.createEmpty('s', ids).arrangement;
  // Forty overlapping rings of every size, some across the 180° line and near the poles.
  for (let i = 0; i < 40; i++) {
    const lon = r.float(-180, 180), lat = r.float(-75, 75), h = r.float(0.5, 25), n = r.int(4, 24);
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, q = h * r.float(0.6, 1); pts.push([lon + q * 1.4 * Math.cos(a), Math.max(-88, Math.min(88, lat + q * Math.sin(a)))]); }
    try { insertRing(arr, pts); } catch { /* a refused ring changes nothing */ }
  }
  assertSound(arr);
  const t = arr.topology() as unknown as { cycles: Map<number, number[]> };
  const self = arr as unknown as { cycleLeftArea(c: number[], t: unknown): number; segments: Map<number, { a: number; b: number }>; v(id: number): Vec3 };
  let checked = 0;
  for (const c of t.cycles.values()) {
    // As it used to be worked out: the angle between the incoming arc's direction and the outgoing arc's, at every corner.
    let sum = 0;
    const ends = (h: number) => { const s = self.segments.get(h >> 1)!; return (h & 1) === 0 ? [s.a, s.b] : [s.b, s.a]; };
    for (let i = 0; i < c.length; i++) {
      const [u, v] = ends(c[i]), [, w] = ends(c[(i + 1) % c.length]);
      if (w === u) { sum += -Math.PI; continue; }
      const pv = self.v(v), T = arcDirectionAtEnd(self.v(u), pv), O = arcDirectionAtStart(pv, self.v(w));
      sum += Math.atan2(dot(cross(T, O), pv), dot(T, O));
    }
    const before = 2 * Math.PI - sum, now = self.cycleLeftArea(c, t);
    assert.ok(Math.abs(before - now) < 1e-9, `a cycle of ${c.length} corners: ${now} against ${before}`);
    checked++;
  }
  assert.ok(checked > 60, `${checked} cycles`);
  // And each parcel against d3's area of its polygon.
  let faces = 0;
  for (const f of arr.leafFaces()) {
    const poly = d3Polygon(arr, f);
    if (!poly) continue;
    const a = geoArea(poly), mine = arr.faceArea(f);
    assert.ok(Math.abs(a - mine) < 1e-6 || Math.abs(4 * Math.PI - a - mine) < 1e-6, `parcel ${f}: ${mine} against d3's ${a}`);
    faces++;
  }
  assert.ok(faces > 40, `${faces} parcels`);
});
