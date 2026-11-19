// The smart brushes' last step (Stage 12, D148): stretches of a line that run along a river, a coast or a border take its exact course.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followLines, type FollowLine } from '../src/render-engine/follow-land.ts';
import type { Pt } from '../src/render-engine/stroke.ts';

/** The distance from a point to a polyline. */
function distTo(p: Pt, line: Pt[], closed = false): number {
  let best = Infinity;
  const n = line.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = line[i], b = line[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy));
  }
  return best;
}
const line = (pts: Array<[number, number]>): Pt[] => pts.map(([x, y]) => [x, y]);

test('a stretch drawn near a river takes the river\'s course; the rest stays as drawn; nothing is followed beyond the tolerance', () => {
  // A river along y = 100 (gently wavy), from x = 0 to 400.
  const river: Pt[] = Array.from({ length: 81 }, (_, i) => [i * 5, 100 + 3 * Math.sin(i / 4)] as Pt);
  const targets: FollowLine[] = [{ pts: river, kind: 'river' }];
  // A box drawn with its top side 6 px below the river, from x = 50 to 350.
  const box = line([[50, 106], [350, 106], [350, 250], [50, 250]]);
  const r = followLines(box, true, targets, { tolerance: 12 });
  assert.equal(r.followed, 1);
  // Along the top, between x = 60 and 340, every point is on the river.
  const top = r.pts.filter((p) => p[1] < 140 && p[0] > 60 && p[0] < 340);
  assert.ok(top.length > 30, `${top.length} points along the top`);
  for (const p of top) assert.ok(distTo(p, river) < 1e-6, `(${p}) on the river (${distTo(p, river)})`);
  assert.ok(top.every((p, i) => r.fixed[r.pts.indexOf(p)] === 1));
  // The other sides as drawn.
  for (const p of r.pts.filter((q) => q[1] > 140)) assert.ok(distTo(p, box, true) < 1e-6, `(${p}) as drawn`);
  // Nothing followed when the river is farther than the tolerance.
  const far = followLines(line([[50, 120], [350, 120], [350, 250], [50, 250]]), true, targets, { tolerance: 12 });
  assert.equal(far.followed, 0);
  assert.deepEqual(far.pts, line([[50, 120], [350, 120], [350, 250], [50, 250]]));
  // Nor along a stretch too short to mean it: a side crossing the river.
  const across = followLines(line([[200, 40], [200, 160], [260, 160], [260, 40]]), true, targets, { tolerance: 12 });
  assert.equal(across.followed, 0, 'crossing a river is not following it');
});

test('a river\'s bends are followed where the line drawn cuts across them; a line drawn out and back along a river follows it both ways', () => {
  // A river with a meander: along y = 100, then out round a loop to y = 60 and back, its neck 16 px wide (x = 172 to 188).
  const river: Pt[] = [[0, 100], [172, 100], [140, 60], [220, 60], [188, 100], [400, 100]].flatMap(([x, y], i, a): Pt[] => {
    if (i === a.length - 1) return [[x, y]];
    const [nx, ny] = a[i + 1], k = Math.ceil(Math.hypot(nx - x, ny - y) / 5);
    return Array.from({ length: k }, (_, j) => [x + ((nx - x) * j) / k, y + ((ny - y) * j) / k] as Pt);
  });
  const drawn = line([[20, 105], [380, 105]]);
  const r = followLines(drawn, false, [{ pts: river, kind: 'river' }], { tolerance: 10 });
  assert.equal(r.followed, 1);
  assert.ok(r.pts.some((p) => p[1] < 65), 'out round the meander');
  for (const p of r.pts.slice(1, -1)) assert.ok(distTo(p, river) < 1e-6);
  // Out and back along a river (a hairpin drawn): followed out, then back, as drawn (two stretches, not one).
  const hairpin = line([[20, 105], [300, 105], [300, 95], [40, 95]]);
  const h = followLines(hairpin, false, [{ pts: [[0, 100], [400, 100]], kind: 'river' }], { tolerance: 10 });
  assert.equal(h.followed, 2);
  const xs = h.pts.map((p) => p[0]);
  assert.ok(Math.max(...xs) >= 295 && xs[xs.length - 1] < 60, 'out to the end and back again, as drawn');
});

test('a coast or lake shore that is a loop is followed across where it starts; all the way round once', () => {
  // A lake: a circle of radius 100 about (200, 200), starting at angle 0 (x = 300).
  const lake: Pt[] = Array.from({ length: 120 }, (_, i) => [200 + 100 * Math.cos((i * 2 * Math.PI) / 120), 200 + 100 * Math.sin((i * 2 * Math.PI) / 120)] as Pt);
  const targets: FollowLine[] = [{ pts: lake, kind: 'coast', closed: true }];
  // An arc drawn 5 px outside it, from -60° to +60° (across the lake's first point).
  const arc: Pt[] = Array.from({ length: 41 }, (_, i) => { const a = ((-60 + 3 * i) * Math.PI) / 180; return [200 + 105 * Math.cos(a), 200 + 105 * Math.sin(a)] as Pt; });
  const r = followLines(arc, false, targets, { tolerance: 10 });
  assert.equal(r.followed, 1);
  for (const p of r.pts.slice(1, -1)) assert.ok(Math.abs(Math.hypot(p[0] - 200, p[1] - 200) - 100) < 0.6, `(${p}) on the shore`);
  // A ring drawn all the way round just outside: the shore all the way round, once.
  const ring: Pt[] = Array.from({ length: 90 }, (_, i) => [200 + 104 * Math.cos((i * 2 * Math.PI) / 90), 200 + 104 * Math.sin((i * 2 * Math.PI) / 90)] as Pt);
  const all = followLines(ring, true, targets, { tolerance: 10 });
  assert.equal(all.followed, 1);
  let turn = 0;
  for (let i = 0; i < all.pts.length; i++) {
    const a = all.pts[i], b = all.pts[(i + 1) % all.pts.length];
    turn += Math.atan2((a[0] - 200) * (b[1] - 200) - (a[1] - 200) * (b[0] - 200), (a[0] - 200) * (b[0] - 200) + (a[1] - 200) * (b[1] - 200));
  }
  assert.ok(Math.abs(Math.abs(turn) - 2 * Math.PI) < 0.05, `once round (${(turn / Math.PI).toFixed(2)}π)`);
  for (const p of all.pts) assert.ok(Math.abs(Math.hypot(p[0] - 200, p[1] - 200) - 100) < 0.6);
});

test('the nearer line is followed where two run close; a stretch ends where the drawn line leaves the tolerance', () => {
  const a: Pt[] = [[0, 100], [400, 100]], b: Pt[] = [[0, 130], [400, 130]];
  const drawn = line([[10, 104], [190, 104], [210, 126], [390, 126]]);
  const r = followLines(drawn, false, [{ pts: a, kind: 'river' }, { pts: b, kind: 'border' }], { tolerance: 8 });
  assert.equal(r.followed, 2);
  assert.ok(r.pts.filter((p) => p[0] < 180).every((p) => p[1] === 100 || p[0] < 12), 'first along the river');
  assert.ok(r.pts.filter((p) => p[0] > 220).every((p) => p[1] === 130 || p[0] > 388), 'then along the border');
});
