// Rivers drawn as guidance (D220): kept as their points and settings, worked out with the heights: through the points
// or along the valleys, winding, with tributaries where the water gathers, wider downstream; their water at any height.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRiverStamp, riverSpecOf, simplifyStroke, DEFAULT_RIVER, type RiverSpec } from '../src/terrain/river-course.ts';
import { applyStamps, cleanStamps, stampsKey, type TerrainStamp } from '../src/terrain/sculpt.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';

// A world of quarter-degree cells (about 28 km): land rising westward from a coast at 20°E, with ridges and valleys
// running east-west (heights 200 to 1,800 m), and the sea east of the coast.
const W = 1440, H = 720, R = 6371;
const ground = (f: (lon: number, lat: number) => number): Float32Array => {
  const e = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) e[j * W + i] = f(-180 + ((i + 0.5) / W) * 360, 90 - ((j + 0.5) / H) * 180);
  return e;
};
const hills = (lon: number, lat: number) => (lon > 20 ? -800 : 200 + (20 - lon) * 70 + 500 * Math.cos(lat * 1.6) + 120 * Math.sin(lon * 2.3 + lat));
const kmBetween = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), b[1] - a[1]) * R * Math.PI / 180;
const nearest = (line: Array<[number, number]>, p: [number, number]) => Math.min(...line.map((q) => kmBetween(q, p)));
const river = (path: Array<[number, number]>, spec: Partial<RiverSpec> | null, more: Partial<TerrainStamp> = {}) => ({ id: 'r1', path, radiusKm: 20, strength: 0, seed: 5, ...(spec ? { river: { ...DEFAULT_RIVER, ...spec } } : {}), ...more });

test('river settings (D220): checked as stored; none for a river from before', () => {
  assert.equal(riverSpecOf(undefined), null);
  assert.deepEqual(riverSpecOf({}), DEFAULT_RIVER);
  assert.deepEqual(riverSpecOf({ width: 99, meander: -1, tributaries: 'x', follow: 'yes', drawn: 'pen' }), { width: 6, meander: 0, tributaries: DEFAULT_RIVER.tributaries, follow: true, drawn: 'pen' });
  // Kept with a river's stroke only, with how many times it was changed.
  const [a, b] = cleanStamps([
    { id: 'a', tool: 'river', path: [[0, 0], [1, 1]], radiusKm: 10, strength: 0, seed: 1, from: null, river: { width: 2 }, rev: 3 },
    { id: 'b', tool: 'raise', path: [[0, 0]], radiusKm: 10, strength: 100, seed: 1, from: null, river: { width: 2 } },
  ]);
  assert.equal(a.river?.width, 2);
  assert.equal(a.rev, 3);
  assert.equal(a.strength, 0, 'a river may cut no valley');
  assert.equal(b.river, undefined);
  // A river changed is worked out again: its name for the heights changes.
  assert.notEqual(stampsKey('base', [a]), stampsKey('base', [{ ...a, rev: 4 }]));
});

test('a river through its points, smoothly or along the valleys; to its mouth at the coast; its water whatever the height', () => {
  const path: Array<[number, number]> = [[8, 12], [12, 11.2], [16, 12.4], [21, 12]];
  for (const follow of [false, true]) {
    const e = ground(hills), before = e.slice();
    const touched = new Uint8Array(W * H);
    const r = applyRiverStamp(e, touched, W, H, river(path, { follow, meander: 0.5, tributaries: 0 }), R)!;
    assert.ok(r, `worked out (${follow ? 'along the valleys' : 'smoothly'})`);
    assert.deepEqual(r.course[0], path[0], 'from its source');
    // Through (or close by) each of its points on land, to the coast at 20°E (not on into the sea).
    for (const p of path.slice(1, 3)) assert.ok(nearest(r.course, p) < 30, `by its point ${p} (${nearest(r.course, p).toFixed(1)} km)`);
    const end = r.course[r.course.length - 1];
    assert.ok(end[0] > 19.5 && end[0] < 20.6, `ends at the coast (${end})`);
    // No valley cut: the ground as it is (its water is drawn above the sea all the same).
    assert.deepEqual(e, before);
    assert.ok(touched.every((v) => v === 0));
    // Wider downstream, as wide as asked at its mouth.
    assert.ok(r.widths[0] < r.widths[r.widths.length - 1] && Math.abs(r.widths[r.widths.length - 1] - 1) < 1e-9);
  }
  // Along the valleys: at most a little higher than the straight way (it keeps to low ground).
  const e1 = ground(hills), e2 = ground(hills);
  const smooth = applyRiverStamp(e1, new Uint8Array(W * H), W, H, river(path, { follow: false, meander: 0, tributaries: 0 }), R)!;
  const valley = applyRiverStamp(e2, new Uint8Array(W * H), W, H, river(path, { follow: true, meander: 0, tributaries: 0 }), R)!;
  const mean = (line: Array<[number, number]>) => line.reduce((a, [lon, lat]) => a + hills(lon, lat), 0) / line.length;
  assert.ok(mean(valley.course) < mean(smooth.course), `lower along the valleys (${mean(valley.course).toFixed(0)} m against ${mean(smooth.course).toFixed(0)} m)`);
  // Winding: longer than without, its points still by its course.
  const wound = applyRiverStamp(ground(hills), new Uint8Array(W * H), W, H, river(path, { follow: false, meander: 1, tributaries: 0 }), R)!;
  const len = (line: Array<[number, number]>) => line.slice(1).reduce((a, p, i) => a + kmBetween(line[i], p), 0);
  assert.ok(len(wound.course) > len(smooth.course) * 1.02, `winding (${len(wound.course).toFixed(0)} km against ${len(smooth.course).toFixed(0)} km)`);
});

test('tributaries where the water of the heights gathers, each ending on the river or a greater tributary; more when asked', () => {
  const path: Array<[number, number]> = [[6, 11], [12, 11.5], [21, 11.8]];
  const few = applyRiverStamp(ground(hills), new Uint8Array(W * H), W, H, river(path, { tributaries: 0.3 }), R)!;
  const many = applyRiverStamp(ground(hills), new Uint8Array(W * H), W, H, river(path, { tributaries: 1 }), R)!;
  assert.ok(few.branches.length >= 1, `some (${few.branches.length})`);
  assert.ok(many.branches.length > few.branches.length, `more when asked (${few.branches.length}, then ${many.branches.length})`);
  const lines = [many.course, ...many.branches.map((b) => b.line)];
  for (const b of many.branches) {
    const mouth = b.line[b.line.length - 1];
    const on = Math.min(...lines.filter((l) => l !== b.line).map((l) => nearest(l, mouth)));
    assert.ok(on < 1, `ends on the river or a tributary (${on.toFixed(2)} km off)`);
    assert.ok(b.widths.every((w) => w < 1 && w > 0), 'narrower than the river at its mouth');
  }
  // None from the sea.
  for (const b of many.branches) for (const [lon] of b.line) assert.ok(lon <= 20.3, 'on land');
});

test('a river ending inland gathers no water from beyond its end; its valley cut when asked; a river from before follows its stroke', () => {
  const e = ground(hills);
  const inland = applyRiverStamp(e, new Uint8Array(W * H), W, H, river([[4, 11], [9, 11.4], [13, 11]], { tributaries: 1 }), R)!;
  const end = inland.course[inland.course.length - 1];
  for (const b of inland.branches) assert.ok(kmBetween(b.line[b.line.length - 1], end) > 20, 'no tributary joins at its very end');
  // Its valley cut: the ground lowered along it, down to below the sea at its mouth.
  const cut = ground(hills), touched = new Uint8Array(W * H);
  const r = applyRiverStamp(cut, touched, W, H, river([[8, 12], [21, 12]], { tributaries: 0, meander: 0, follow: false }, { strength: 150, radiusKm: 40 }), R)!;
  const cell = (lon: number, lat: number) => Math.floor(((90 - lat) / 180) * H) * W + Math.floor(((lon + 180) / 360) * W);
  const mid = r.course[Math.floor(r.course.length / 2)];
  assert.ok(cut[cell(mid[0], mid[1])] < hills(mid[0], mid[1]) - 50, 'cut below the ground');
  assert.ok(touched.some((v) => v === 1));
  // A river drawn before D220 (no settings): its stroke followed as drawn, no tributaries.
  const old = applyRiverStamp(ground(hills), new Uint8Array(W * H), W, H, river([[8, 12], [12, 10], [16, 12]], null), R)!;
  assert.equal(old.branches.length, 0);
  assert.ok(nearest(old.course, [12, 10]) < 1, 'through its turn as drawn');
});

test('rivers with the heights (D220): one shape for each river stroke, worked out in order with the other strokes', () => {
  const base: ElevationGrid = { width: 360, height: 180, step: 1, data: new Int16Array(360 * 180).fill(300) };
  const strokes: TerrainStamp[] = [
    { id: 'a', tool: 'raise', path: [[10, 10]], radiusKm: 300, strength: 500, seed: 1, from: null },
    { id: 'b', tool: 'river', path: [[5, 10], [15, 10]], radiusKm: 100, strength: 50, seed: 2, from: null, river: { ...DEFAULT_RIVER } },
  ];
  const r = applyStamps(base, strokes, R);
  assert.equal(r.rivers.length, 1);
  assert.equal(r.rivers[0].id, 'b');
  assert.equal(applyStamps(base, strokes.slice(0, 1), R).rivers.length, 0);
});

test('a brush stroke kept as the points where it turns (D220)', () => {
  const straight = Array.from({ length: 101 }, (_, i) => [i * 0.1, 5] as [number, number]);
  assert.equal(simplifyStroke(straight, 5).length, 2);
  const bend = [...Array.from({ length: 50 }, (_, i) => [i * 0.1, 5] as [number, number]), ...Array.from({ length: 50 }, (_, i) => [5, 5 + i * 0.1] as [number, number])];
  const kept = simplifyStroke(bend, 5);
  assert.equal(kept.length, 3);
  assert.deepEqual(kept[0], bend[0]);
  assert.deepEqual(kept[2], bend[bend.length - 1]);
  // Never more than asked for.
  const zigzag = Array.from({ length: 400 }, (_, i) => [i * 0.05, 5 + (i % 2) * 0.5] as [number, number]);
  assert.ok(simplifyStroke(zigzag, 1, R, 30).length <= 30);
});
