// Fronts that follow the land (D136): arrival times worked out through the land of a change, and the land
// reached at any moment traced as closed lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrontField, frontRings, reachedAt, type FrontField, type Rings } from '../src/render-engine/front-field.ts';

const box = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// A U: arms 0-4 and 12-16 degrees east from 10 S to 10 N, joined along the bottom (10 S to 6 S).
const U: Array<[number, number]> = [[0, 10], [0, -10], [16, -10], [16, 10], [12, 10], [12, -6], [4, -6], [4, 10]];
const timeAt = (f: FrontField, lon: number, lat: number) => {
  const i = Math.floor((lon - f.west) / f.dlon), j = Math.floor((f.north - lat) / f.dlat);
  return f.at[j * f.nx + i];
};
/** Whether a place lies in the land reached (the closed lines filled by the even-odd rule). */
const inRings = (rings: Rings, x: number, y: number) => {
  let odd = false;
  for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
    const [x0, y0] = r[b], [x1, y1] = r[a];
    if ((y0 > y) !== (y1 > y) && x < x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)) odd = !odd;
  }
  return odd;
};

test('a front from the tip of one arm of a U goes down it, along the bottom and up the other, never across the gap', () => {
  const f = buildFrontField([U], { kind: 'lines', lonlat: [0, 10, 4, 10] }, { roughness: 0, seed: 1 })!;
  assert.ok(f);
  // Along the way: ever later.
  const path: Array<[number, number]> = [[2, 9], [2, 0], [2, -8], [8, -8], [14, -8], [14, 0], [14, 9]];
  const times = path.map(([x, y]) => timeAt(f, x, y));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `later along the U (${times.map((t) => t.toFixed(3)).join(', ')})`);
  // The far arm's tip last; the near arm's tip first.
  assert.ok(times[0] < 0.05 && times[times.length - 1] > 0.95, `from the start to the end (${times[0]}, ${times[times.length - 1]})`);
  // The way through the land, round the inside corners: 16 degrees down, 8 along, 16.5 up to the far corner;
  // half of it reached at about the bottom's middle.
  assert.ok(Math.abs(timeAt(f, 8, -8) - 0.5) < 0.06, `half way at the bottom's middle (${timeAt(f, 8, -8)})`);
  assert.ok(Math.abs(f.travel - 40.5) < 2, `about 40.5 degrees of travel (${f.travel})`);
});

test('a front from a straight border reaches each place when the border\'s distance from it says', () => {
  const f = buildFrontField([box(0, 0, 10, 10)], { kind: 'lines', lonlat: [0, 0, 0, 10] }, { roughness: 0, seed: 1 })!;
  for (const x of [1, 3, 5, 7, 9]) for (const y of [1, 5, 9]) {
    const want = (x * Math.cos((y * Math.PI) / 180)) / f.travel;
    assert.ok(Math.abs(timeAt(f, x, y) - want) < 0.04, `(${x}, ${y}): ${timeAt(f, x, y).toFixed(3)} against ${want.toFixed(3)}`);
  }
});

test('the land reached at a moment: closed lines round it, holding what is reached and not what is not; at the end all of it', () => {
  const f = buildFrontField([U], { kind: 'lines', lonlat: [0, 10, 4, 10] }, { roughness: 0, seed: 1 })!;
  const half = frontRings(f, 0.5);
  assert.ok(half.length >= 1);
  for (const r of half) { assert.deepEqual(r[0], r[r.length - 1], 'closed'); let a = 0; for (let i = 0; i + 1 < r.length; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; assert.ok(a < 0, 'clockwise'); }
  assert.ok(inRings(half, 2, 0) && inRings(half, 2, -8), 'the near arm and the bottom\'s start reached');
  assert.ok(!inRings(half, 14, 0) && !inRings(half, 14, 9), 'the far arm not yet');
  assert.ok(!inRings(half, 8, 5), 'nor the gap between the arms');
  const all = frontRings(f, 1);
  for (const [x, y] of [[2, 9], [8, -8], [14, 9], [15.8, -9.8], [0.2, 9.8]] as const) assert.ok(inRings(all, x, y), `(${x}, ${y}) reached at the end`);
  assert.ok(!inRings(all, 8, 5), 'the gap never');
  assert.deepEqual(frontRings(f, 0), []);
  assert.equal(reachedAt(f, 2, 0, 0.5), true);
  assert.equal(reachedAt(f, 14, 9, 0.5), false);
});

test('an island of the change is reached from the nearest land taken, after it, across the water between', () => {
  const f = buildFrontField([box(0, 0, 10, 10), box(13, 3, 17, 7)], { kind: 'lines', lonlat: [0, 0, 0, 10] }, { roughness: 0, seed: 1 })!;
  const shore = timeAt(f, 9.8, 5), landing = timeAt(f, 13.2, 5), far = timeAt(f, 16.8, 5);
  assert.ok(shore < landing && landing < far, `the island after the shore facing it (${shore}, ${landing}, ${far})`);
  // The last place of all on the island (its far corners), the main land all reached before the crossing.
  const corners = [timeAt(f, 16.9, 3.1), timeAt(f, 16.9, 6.9)];
  assert.ok(Math.abs(Math.max(...corners) - 1) < 0.02, `the island's far corner last (${corners})`);
  assert.ok(Math.max(timeAt(f, 9.9, 0.1), timeAt(f, 9.9, 9.9)) < landing, 'the main land before the island');
});

test('several starting points: each place from the nearest; from the middle when the owner held nothing', () => {
  const two = buildFrontField([box(0, 0, 20, 4)], { kind: 'points', points: [[1, 2], [19, 2]] }, { roughness: 0, seed: 1 })!;
  assert.ok(timeAt(two, 10, 2) > 0.95, 'the middle last, where the pincers close');
  assert.ok(Math.abs(timeAt(two, 5, 2) - timeAt(two, 15, 2)) < 0.03, 'both pincers alike');
  const heart = buildFrontField([box(0, 0, 10, 10)], { kind: 'heart' }, { roughness: 0, seed: 1 })!;
  assert.ok(timeAt(heart, 5, 5) < 0.06, `the middle first (${timeAt(heart, 5, 5)})`);
  assert.ok(timeAt(heart, 0.2, 0.2) > 0.9, 'the corners last');
  const toward = buildFrontField([box(0, 0, 10, 10)], { kind: 'toward', point: [-30, 5] }, { roughness: 0, seed: 1 })!;
  assert.ok(timeAt(toward, 0.5, 5) < 0.1 && timeAt(toward, 9.5, 5) > 0.9, 'facing a place across the sea: from the side facing it');
});

test('a ragged front: the same for the same seed, another for another, still from the start to the end; patches when scattered', () => {
  const rings = [box(0, 0, 10, 10)], src = { kind: 'lines' as const, lonlat: [0, 0, 0, 10] };
  const a = buildFrontField(rings, src, { roughness: 0.7, seed: 7 })!, b = buildFrontField(rings, src, { roughness: 0.7, seed: 7 })!, c = buildFrontField(rings, src, { roughness: 0.7, seed: 8 })!;
  assert.deepEqual(Array.from(a.at), Array.from(b.at));
  assert.notDeepEqual(Array.from(a.at), Array.from(c.at));
  // Along a line parallel to the border, times differ (a clean front would reach it all at once).
  const clean = buildFrontField(rings, src, { roughness: 0, seed: 7 })!;
  const spread = (f: FrontField) => { const ts = [1, 3, 5, 7, 9].map((y) => timeAt(f, 5, y)); return Math.max(...ts) - Math.min(...ts); };
  assert.ok(spread(clean) < 0.03 && spread(a) > 0.08, `clean ${spread(clean)}, ragged ${spread(a)}`);
  assert.ok(timeAt(a, 0.3, 5) < 0.1, 'still from the border');
  const s = buildFrontField(rings, { kind: 'scatter' }, { roughness: 0, seed: 3 })!;
  let lo = 1, hi = 0;
  for (let x = 0.5; x < 10; x += 1) for (let y = 0.5; y < 10; y += 1) { const t = timeAt(s, x, y); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  assert.ok(lo < 0.15 && hi > 0.85, `scattered over the whole span (${lo}, ${hi})`);
});

test('a change across the 180th meridian; too small or too large to be drawn', () => {
  const f = buildFrontField([[[170, 0], [-170, 0], [-170, 10], [170, 10]]], { kind: 'lines', lonlat: [170, 0, 170, 10] }, { roughness: 0, seed: 1 })!;
  assert.ok(f);
  assert.ok(f.nx * f.dlon < 40, 'one grid across the meridian, not round the world');
  assert.ok(timeAt(f, 171, 5) < timeAt(f, 179.5, 5) && timeAt(f, 179.5, 5) < timeAt(f, 180 + 9.5, 5), 'eastward across it');
  const all = frontRings(f, 1);
  assert.ok(all.length >= 1 && all.every((r) => r.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));
  assert.equal(buildFrontField([[[0, 0], [0, 0], [0, 0]]], { kind: 'heart' }, { roughness: 0, seed: 1 }), null);
  // A band right round the planet.
  const band: Array<[number, number]> = [];
  for (let x = -180; x <= 180; x += 30) band.push([x, 60]);
  for (let x = 180; x >= -180; x -= 30) band.push([x, -60]);
  assert.equal(buildFrontField([band], { kind: 'heart' }, { roughness: 0, seed: 1 }), null);
});

test('a front field is quick to make for a change of 160 cells across, and its lines quick to trace', () => {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < 400; i++) { const a = (i / 400) * Math.PI * 2, r = 8 + 2 * Math.sin(a * 7); ring.push([20 + r * Math.cos(a), 45 + r * Math.sin(a) * 0.7]); }
  const t0 = performance.now();
  const f = buildFrontField([ring], { kind: 'lines', lonlat: [12, 45, 13, 47] }, { roughness: 0.5, seed: 2 })!;
  const t1 = performance.now();
  for (let k = 0; k < 10; k++) frontRings(f, k / 10);
  const t2 = performance.now();
  assert.ok(t1 - t0 < 400, `made in ${(t1 - t0).toFixed(0)} ms`);
  assert.ok((t2 - t1) / 10 < 40, `traced in ${((t2 - t1) / 10).toFixed(1)} ms`);
});
