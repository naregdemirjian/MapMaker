// The prepared map geometry (render-engine/plane.ts, parcel-geometry.ts): projections equal d3-geo's,
// simplification stays within its tolerance, and the rings drawn for a parcel cover exactly the
// parcel, in every projection, across the 180° meridian and around the poles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Arrangement, type IdSource, type KernelTable } from '../src/geo-kernel/arrangement.ts';
import { lonLatToVec, type Vec3 } from '../src/geo-kernel/vec.ts';
import { makeView, lonLatToScreen, screenToLonLat, rotatePoint, type Camera, type ProjectionName } from '../src/render-engine/camera.ts';
import { Sheet, projectPoint, rankPoints, makeRing, rankRing, arcLatitudes, type PathSink } from '../src/render-engine/plane.ts';
import { parcelGeometry } from '../src/render-engine/parcel-geometry.ts';
import { rng, ring, square } from './helpers.ts';

const ROUND: ProjectionName[] = ['equirectangular', 'equalEarth', 'naturalEarth', 'mercator'];
const cam = (projection: ProjectionName, lon = 0, lat = 0, zoom = 0, rotation = 0): Camera => ({ lon, lat, zoom, rotation, projection });

/** Records the rings and lines written to it, in screen pixels of a view. */
class Recorder implements PathSink {
  rings: number[][] = [];
  private cur: number[] = [];
  private readonly a: number; private readonly e: number; private readonly f: number;
  constructor(place: [number, number, number]) { [this.a, this.e, this.f] = place; }
  moveTo(x: number, y: number) { this.cur = [this.a * x + this.e, this.a * y + this.f]; this.rings.push(this.cur); }
  lineTo(x: number, y: number) { this.cur.push(this.a * x + this.e, this.a * y + this.f); }
  closePath() { /* rings are closed when tested */ }
  /** How many rings a point is inside (even-odd parity decides filling). */
  around(x: number, y: number): number {
    let c = 0;
    for (const r of this.rings) {
      let inside = false;
      for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
        const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) c++;
    }
    return c;
  }
}

test('the projections equal d3-geo\'s at any camera', () => {
  const r = rng(3);
  for (const kind of [...ROUND, 'flat'] as ProjectionName[]) {
    for (let i = 0; i < 40; i++) {
      const flat = kind === 'flat';
      const c = cam(kind, flat ? 0 : r.float(-180, 180), flat ? 0 : r.float(-60, 60), r.float(0, 9));
      const view = makeView(c, 1600, 900);
      const sheet = new Sheet(view, { tolerance: 0.3, margin: 0.5 });
      const [a, e, f] = sheet.placement(view);
      for (let k = 0; k < 25; k++) {
        const lon = flat ? r.float(-7, 7) : c.lon + r.float(-179, 179), lat = flat ? r.float(-7, 7) : r.float(-85, 85);
        const want = lonLatToScreen(view, lon, lat)!;
        const one = makeRing(Float64Array.of(lon, lon), Float64Array.of(lat, lat), false, false);
        const pts = sheet.points(one, sheet.kind === 'flat' ? 0 : Math.round((c.lon - lon) / 360));
        const got = [a * pts[0] + e, a * pts[1] + f];
        const tol = 1e-6 * Math.max(1, Math.abs(want[0]), Math.abs(want[1])) + 2e-2; // sheet points are 32-bit
        assert.ok(Math.abs(got[0] - want[0]) < tol && Math.abs(got[1] - want[1]) < tol, `${kind} ${lon},${lat}: ${got} vs ${want}`);
      }
      void projectPoint;
    }
  }
});

test('a sheet stays exact deep in: local coordinates', () => {
  // At zoom 20 a pixel is a few centimetres; 32-bit coordinates measured from the planet's middle could not hold that.
  const c = cam('equirectangular', 123.456789, 45.678901, 20);
  const view = makeView(c, 1600, 900);
  const sheet = new Sheet(view, { tolerance: 0.3, margin: 0.5 });
  const [a, e, f] = sheet.placement(view);
  const r = rng(9);
  for (let i = 0; i < 50; i++) {
    const ll = screenToLonLat(view, r.float(0, 1600), r.float(0, 900))!;
    const want = lonLatToScreen(view, ll[0], ll[1])!;
    const pts = sheet.points(makeRing(Float64Array.of(ll[0], ll[0]), Float64Array.of(ll[1], ll[1]), false, false), 0);
    assert.ok(Math.hypot(a * pts[0] + e - want[0], a * pts[1] + f - want[1]) < 0.01);
  }
});

test('ranked points: a line simplified at any tolerance stays within it', () => {
  const r = rng(5);
  const n = 400, x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = i * 0.1 + r.float(-0.03, 0.03); y[i] = 5 * Math.sin(i / 25) + r.float(-0.2, 0.2) + (i % 97 === 0 ? 2 : 0); }
  const imp = new Float32Array(n);
  imp[0] = imp[n - 1] = Infinity;
  rankPoints(x, y, 0, n - 1, imp);
  let last = n;
  for (const eps of [0.01, 0.05, 0.2, 1, 4]) {
    const keep: number[] = [];
    for (let i = 0; i < n; i++) if (imp[i] >= eps) keep.push(i);
    assert.ok(keep.length <= last, 'coarser keeps fewer');
    last = keep.length;
    // Every dropped point is within eps of the simplified line.
    for (let s = 0; s + 1 < keep.length; s++) {
      const a = keep[s], b = keep[s + 1];
      for (let k = a + 1; k < b; k++) {
        const dx = x[b] - x[a], dy = y[b] - y[a], t = Math.max(0, Math.min(1, ((x[k] - x[a]) * dx + (y[k] - y[a]) * dy) / (dx * dx + dy * dy)));
        assert.ok(Math.hypot(x[k] - x[a] - t * dx, y[k] - y[a] - t * dy) <= eps * 1.0001, `point ${k} at eps ${eps}`);
      }
    }
  }
  assert.ok(last < 30, `${last} points at the coarsest`);
  // A closed ring keeps its extent however coarse.
  const ringPts = makeRing(Float64Array.from({ length: 200 }, (_, i) => 10 * Math.cos(i / 200 * 2 * Math.PI)), Float64Array.from({ length: 200 }, (_, i) => 6 * Math.sin(i / 200 * 2 * Math.PI)), true, false);
  const ri = rankRing(ringPts);
  assert.equal([...ri].filter((v) => v === Infinity).length, 2, 'two anchors');
});

function mapWith(shapes: Array<Array<[number, number]>>, densify = 2): Arrangement {
  const n: Record<KernelTable, number> = { vertex: 0, segment: 0, face: 0 };
  const ids: IdSource = { next: (t) => ++n[t] };
  const { arrangement: arr } = Arrangement.createEmpty('s', ids);
  for (const s of shapes) {
    arr.begin();
    try { arr.insertPath(ring(s, densify), { closed: true, snap: 1e-7 }); arr.commit(); } catch { arr.rollback(); }
  }
  return arr;
}

/** For every leaf face: the rings a sheet draws for it (with the planet's outline where the face needs it) cover exactly the face. */
function checkCoverage(arr: Arrangement, view: ReturnType<typeof makeView>, samples: number, seed: number, tolerance = 0.05): number {
  const geom = parcelGeometry(arr), t = arr.topology();
  const sheet = new Sheet(view, { tolerance, margin: 0.4 });
  const place = sheet.placement(view);
  const drawn = new Map<number, { rec: Recorder; outline: boolean }>();
  for (const f of arr.leafFaces()) {
    const rec = new Recorder(place);
    for (const c of t.facesCycles.get(f) ?? []) sheet.ring(rec, geom.cycle(c, t));
    drawn.set(f, { rec, outline: geom.needsOutline(f) });
  }
  const r = rng(seed);
  let checked = 0;
  for (let i = 0; i < samples; i++) {
    const x = r.float(2, view.width - 2), y = r.float(2, view.height - 2);
    const ll = screenToLonLat(view, x, y);
    if (!ll) continue; // outside the planet's outline
    let face: number;
    try { face = arr.locate(lonLatToVec(ll[0], ll[1])); } catch { continue; }
    // Skip points within a pixel of a border (simplification and rounding may move it that far).
    let nearBorder = false;
    for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
      const q = screenToLonLat(view, x + dx, y + dy);
      if (!q) { nearBorder = true; break; }
      try { if (arr.locate(lonLatToVec(q[0], q[1])) !== face) { nearBorder = true; break; } } catch { nearBorder = true; break; }
    }
    if (nearBorder) continue;
    checked++;
    // The sheet is placed on the view before the view's own turn.
    const [ux, uy] = rotatePoint(x, y, view.width / 2, view.height / 2, -view.rotation);
    for (const [f, d] of drawn) {
      const filled = ((d.rec.around(ux, uy) + (d.outline ? 1 : 0)) & 1) === 1;
      assert.equal(filled, f === face, `point ${x.toFixed(1)},${y.toFixed(1)} (${ll[0].toFixed(3)}, ${ll[1].toFixed(3)}): face ${f} ${filled ? 'is' : 'is not'} drawn there, the point is in face ${face}`);
    }
  }
  return checked;
}

test('rings drawn for each parcel cover exactly the parcel: every projection, any camera, across 180°', () => {
  const r = rng(11);
  // Shapes around the planet, some across the 180° meridian, some nested, some overlapping.
  const shapes: Array<Array<[number, number]>> = [
    square(0, 0, 25), square(10, 5, 8), square(170, 20, 25), square(-175, -30, 12), square(60, 60, 15), square(-90, -50, 20), square(100, -10, 30), square(110, -5, 6),
  ];
  for (let i = 0; i < 6; i++) shapes.push(square(r.float(-170, 170), r.float(-60, 60), r.float(3, 20)));
  const arr = mapWith(shapes);
  assert.ok(arr.leafFaces().length > 15);
  let total = 0;
  for (const kind of ROUND) for (const [lon, lat, zoom, rot] of [[0, 0, 0, 0], [150, 10, 0, 0], [-170, 20, 1.5, 0], [175, 15, 3, 20], [5, 2, 4.2, 0]] as const) {
    total += checkCoverage(arr, makeView(cam(kind, lon, lat, zoom, rot), 1200, 700), 500, 3);
  }
  assert.ok(total > 4000, `${total} points checked`);
});

test('parcels around the poles and bands round the planet are drawn right', () => {
  // A cap over the north pole, a band round the planet, a cap over the south pole with a hole in it.
  const circle = (lat: number, n = 72, east = true): Array<[number, number]> => Array.from({ length: n }, (_, i) => [((east ? i : n - i) / n) * 360 - 180, lat] as [number, number]);
  const arr = mapWith([circle(70), circle(20), circle(-20), circle(-60), square(30, -75, 5), square(40, 0, 6)], 1);
  assert.ok(arr.leafFaces().length >= 6, `${arr.leafFaces().length} faces`);
  let total = 0;
  for (const kind of ['equirectangular', 'equalEarth', 'naturalEarth'] as ProjectionName[]) for (const lon of [0, 97, -179]) total += checkCoverage(arr, makeView(cam(kind, lon, 0, 0), 1200, 700), 600, 5);
  // Mercator cannot show the poles; closer in it shows the bands.
  total += checkCoverage(arr, makeView(cam('mercator', 20, 10, 0.5), 1200, 700), 600, 7);
  assert.ok(total > 2500, `${total} points checked`);
});

test('a flat map, and long straight borders close in (great-circle arcs drawn as they curve)', () => {
  const flat = mapWith([square(0, 0, 3), square(1, 1, 1), square(-2.5, 2, 1.5)], 0.25);
  assert.ok(checkCoverage(flat, makeView(cam('flat', 0, 0, 0), 1200, 700), 500, 2) > 300);
  assert.ok(checkCoverage(flat, makeView(cam('flat', 1, 1, 4), 1200, 700), 500, 2) > 200);
  // One border 40° long with no points between its ends: on the map it is a curve, not a straight line.
  const arr = mapWith([[[0, 50], [40, 50], [40, 62], [0, 62]]], 90);
  for (const kind of ROUND) {
    assert.ok(checkCoverage(arr, makeView(cam(kind, 20, 52, 4), 1200, 700), 800, 4) > 500, kind);
    assert.ok(checkCoverage(arr, makeView(cam(kind, 20, 50.9, 9), 1200, 700), 800, 4, 0.3) > 300, `${kind} close in`);
  }
});

test('neighbouring parcels simplify their shared border identically (no gaps, no overlaps, at any detail)', () => {
  const r = rng(21);
  const wobbly = (cx: number, cy: number, rad: number): Array<[number, number]> => Array.from({ length: 180 }, (_, i) => {
    const a = (i / 180) * Math.PI * 2, k = rad * (1 + 0.15 * Math.sin(7 * a) + r.float(-0.04, 0.04));
    return [cx + k * Math.cos(a), cy + k * Math.sin(a)] as [number, number];
  });
  const arr = mapWith([wobbly(0, 0, 20), wobbly(15, 5, 18), wobbly(-10, 12, 14), wobbly(5, -14, 12)], 5);
  const geom = parcelGeometry(arr), t = arr.topology();
  // Coarse sheets: each point of the view is drawn for exactly one parcel.
  for (const tolerance of [0.3, 3, 12]) {
    const view = makeView(cam('equirectangular', 3, 2, 1.5), 1000, 600);
    const sheet = new Sheet(view, { tolerance, margin: 0.3 });
    const place = sheet.placement(view);
    const recs = arr.leafFaces().map((f) => {
      const rec = new Recorder(place);
      for (const c of t.facesCycles.get(f) ?? []) sheet.ring(rec, geom.cycle(c, t));
      return { rec, outline: geom.needsOutline(f) };
    });
    const total = recs.reduce((s, x) => s + x.rec.rings.reduce((q, ring2) => q + ring2.length / 2, 0), 0);
    for (let i = 0; i < 3000; i++) {
      const x = r.float(1, 999), y = r.float(1, 599);
      const n = recs.filter((d) => ((d.rec.around(x, y) + (d.outline ? 1 : 0)) & 1) === 1).length;
      assert.equal(n, 1, `tolerance ${tolerance}: point ${x.toFixed(1)},${y.toFixed(1)} is drawn for ${n} parcels`);
    }
    if (tolerance === 12) assert.ok(total < 700, `${total} points drawn at the coarsest`);
  }
});

test('parcels taken together are drawn as their joint outline: exactly the parcels, with fewer points', () => {
  const r = rng(31);
  // Many overlapping shapes (so the land is cut into many parcels), some across the 180° meridian.
  const shapes: Array<Array<[number, number]>> = [];
  for (let i = 0; i < 22; i++) shapes.push(square(r.float(-40, 40), r.float(-30, 30), r.float(5, 22)));
  for (let i = 0; i < 6; i++) shapes.push(square(r.float(165, 195), r.float(-30, 30), r.float(5, 15)));
  const arr = mapWith(shapes, 3);
  const leaves = arr.leafFaces().filter((f) => f !== arr.rootFace);
  assert.ok(leaves.length > 150, `${leaves.length} parcels`);
  const geom = parcelGeometry(arr), t = arr.topology();
  // Parcels dealt out to five owners at random; the root parcel (the rest of the planet) to none.
  const owners: number[][] = [[], [], [], [], []];
  for (const f of leaves) owners[r.int(0, 4)].push(f);
  let joint = 0, separate = 0, checked = 0;
  for (const [lon, zoom, kind] of [[0, 1, 'equirectangular'], [178, 2, 'equirectangular'], [10, 1.5, 'equalEarth'], [-170, 1.2, 'mercator']] as const) {
    const view = makeView(cam(kind, lon, 0, zoom), 1200, 700);
    const sheet = new Sheet(view, { tolerance: 0.05, margin: 0.3 });
    const place = sheet.placement(view);
    const recs = owners.map((faces) => {
      const rings = geom.dissolve(faces, t);
      assert.ok(rings, 'these sets can be joined');
      const rec = new Recorder(place);
      for (const ring of rings!) sheet.ringOf(rec, ring.parts, ring.box);
      const each = new Recorder(place);
      for (const f of faces) for (const c of t.facesCycles.get(f) ?? []) sheet.ring(each, geom.cycle(c, t));
      joint += rec.rings.reduce((q, x) => q + x.length / 2, 0);
      separate += each.rings.reduce((q, x) => q + x.length / 2, 0);
      return { rec, set: new Set(faces) };
    });
    for (let i = 0; i < 1500; i++) {
      const x = r.float(2, 1198), y = r.float(2, 698);
      const ll = screenToLonLat(view, x, y);
      if (!ll) continue;
      let face: number;
      try { face = arr.locate(lonLatToVec(ll[0], ll[1])); } catch { continue; }
      let nearBorder = false;
      for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
        const q = screenToLonLat(view, x + dx, y + dy);
        try { if (!q || arr.locate(lonLatToVec(q[0], q[1])) !== face) nearBorder = true; } catch { nearBorder = true; }
      }
      if (nearBorder) continue;
      checked++;
      for (const o of recs) assert.equal((o.rec.around(x, y) & 1) === 1, o.set.has(face), `point ${x.toFixed(1)},${y.toFixed(1)} in parcel ${face}`);
    }
  }
  assert.ok(checked > 2500, `${checked} points checked`);
  // (Owners dealt at random share few borders; a country made of many parcels saves far more.)
  assert.ok(joint < separate * 0.95, `${joint} points in the joint outlines, ${separate} parcel by parcel`);
  // One owner holding everything: only the outer outline is left.
  {
    const view = makeView(cam('equirectangular', 0, 0, 1), 1200, 700);
    const sheet = new Sheet(view, { tolerance: 0.05, margin: 0.3 });
    const all = new Recorder(sheet.placement(view)), each = new Recorder(sheet.placement(view));
    for (const ring of geom.dissolve(leaves, t)!) sheet.ringOf(all, ring.parts, ring.box);
    for (const f of leaves) for (const c of t.facesCycles.get(f) ?? []) sheet.ring(each, geom.cycle(c, t));
    const a = all.rings.reduce((q, x) => q + x.length / 2, 0), b = each.rings.reduce((q, x) => q + x.length / 2, 0);
    assert.ok(a < b * 0.25, `${a} points for the outline of everything, ${b} parcel by parcel`);
  }
  // The rest of the planet, or a band round it, cannot be joined this way (they are drawn parcel by parcel).
  assert.equal(geom.dissolve([arr.rootFace, leaves[0]], t), null);
});

test('a long border bows toward the pole: the latitudes its arc reaches, and the boxes of rings and parcels hold them (D144)', () => {
  const peakOf = (lat: number, span: number) => (Math.atan(Math.tan((lat * Math.PI) / 180) / Math.cos(((span / 2) * Math.PI) / 180)) * 180) / Math.PI;
  // Between 4 and 18 °E along 48.2 °N: a fifth of a degree further north halfway; mirrored in the south.
  let [lo, hi] = arcLatitudes(4, 48.2, 18, 48.2);
  assert.ok(Math.abs(lo - 48.2) < 1e-9 && Math.abs(hi - peakOf(48.2, 14)) < 1e-9 && hi > 48.4, `${lo} to ${hi}`);
  [lo, hi] = arcLatitudes(18, -48.2, 4, -48.2);
  assert.ok(Math.abs(hi + 48.2) < 1e-9 && Math.abs(lo + peakOf(48.2, 14)) < 1e-9);
  // Across the 180th meridian the shorter way round.
  [lo, hi] = arcLatitudes(170, 60, -170, 60);
  assert.ok(Math.abs(hi - peakOf(60, 20)) < 1e-9 && lo === 60);
  // Nothing past its ends: along a meridian, along the equator, and where the circle's highest point is not on the arc.
  assert.deepEqual(arcLatitudes(10, -20, 10, 35), [-20, 35]);
  assert.deepEqual(arcLatitudes(0, 0, 90, 0), [0, 0]);
  assert.deepEqual(arcLatitudes(0, 10, 10, 40), [10, 40]);
  // Checked against points along the arc.
  const r = rng(11);
  for (let k = 0; k < 200; k++) {
    const a: [number, number] = [r.float(-180, 180), r.float(-85, 85)], b: [number, number] = [a[0] + r.float(-60, 60), r.float(-85, 85)];
    const va = lonLatToVec(a[0], a[1]), vb = lonLatToVec(b[0], b[1]);
    let min = Infinity, max = -Infinity;
    for (let q = 0; q <= 400; q++) { const t = q / 400, v = [va[0] * (1 - t) + vb[0] * t, va[1] * (1 - t) + vb[1] * t, va[2] * (1 - t) + vb[2] * t], z = v[2] / Math.hypot(v[0], v[1], v[2]), lat = (Math.asin(z) * 180) / Math.PI; min = Math.min(min, lat); max = Math.max(max, lat); }
    const [l, h] = arcLatitudes(a[0], a[1], b[0], b[1]);
    assert.ok(l <= min + 1e-9 && h >= max - 1e-9 && l > min - 0.01 && h < max + 0.01, `${a} to ${b}: ${l}..${h} against ${min}..${max}`);
  }
  // A ring joined by arcs holds the bow in its box; joined by straight lines in longitude and latitude, not.
  const lon = Float64Array.of(4, 18, 18, 4), lat = Float64Array.of(43.6, 43.6, 48.2, 48.2);
  assert.ok(Math.abs(makeRing(lon, lat, true, true).box[3] - peakOf(48.2, 14)) < 1e-9);
  assert.equal(makeRing(lon, lat, true, false).box[3], 48.2);
  // (An open line: its last point is not joined to its first.)
  assert.equal(makeRing(Float64Array.of(4, 4, 18), Float64Array.of(48.2, 40, 48.2), false, true).box[3], 48.2);
  // A parcel's box likewise.
  const arr = mapWith([[[4, 43.6], [18, 43.6], [18, 48.2], [4, 48.2]]], 180);
  assert.equal(arr.vertices.size, 4);
  const t = arr.topology(), geom = parcelGeometry(arr);
  let north = -Infinity, south = Infinity;
  for (const c of t.cycles.keys()) { const b = geom.cycle(c, t).box; north = Math.max(north, b[3]); south = Math.min(south, b[1]); }
  assert.ok(Math.abs(north - peakOf(48.2, 14)) < 1e-6, `north to ${north}`);
  assert.ok(Math.abs(south - 43.6) < 1e-6, `south to ${south} (the southern border bows north, inside the box)`);
});
