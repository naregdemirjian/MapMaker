// The smart brushes (Stage 12, D148): a rough stroke pulled to rivers, coasts, borders and ridges as strongly as the
// weights say; the strategic brush with its side. Synthetic terrains and lines with known best paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSmart, smartLine, NO_WEIGHTS, type SmartInput, type SmartWeights } from '../src/render-engine/smart-brush.ts';
import type { Pt } from '../src/render-engine/stroke.ts';

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
const straight = (x0: number, y0: number, x1: number, y1: number, n = 40): Pt[] => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n] as Pt);
const W = (w: Partial<SmartWeights>): SmartWeights => ({ ...NO_WEIGHTS, ...w });
const run = (input: Partial<SmartInput> & Pick<SmartInput, 'stroke'>, w: Partial<SmartWeights>, pins: Pt[] = []) => {
  const P = prepareSmart({ closed: false, radius: 20, features: [], heightAt: null, points: [], side: 0, ...input });
  assert.ok(P);
  return smartLine(P, W(w), pins);
};

test('a stroke beside a river is drawn to it, ends where drawn; with the river\'s weight at nothing, the stroke as drawn', () => {
  // A gently winding river along y = 100; the stroke 9 px below it.
  const river: Pt[] = Array.from({ length: 101 }, (_, i) => [i * 4, 100 + 4 * Math.sin(i / 6)] as Pt);
  const stroke = straight(20, 109, 380, 109);
  const r = run({ stroke, features: [{ kind: 'river', pts: river }] }, { rivers: 0.9 });
  assert.ok(r.followed >= 1);
  const middle = r.pts.filter((p) => p[0] > 70 && p[0] < 330);
  assert.ok(middle.length > 10);
  for (const p of middle) assert.ok(distTo(p, river) < 1e-6, `(${p.map((v) => v.toFixed(1))}) on the river (${distTo(p, river).toFixed(2)})`);
  assert.deepEqual(r.pts[0], stroke[0], 'starts where drawn');
  assert.deepEqual(r.pts[r.pts.length - 1], stroke[stroke.length - 1], 'ends where drawn');
  // Nothing pulls: the stroke itself.
  const none = run({ stroke, features: [{ kind: 'river', pts: river }] }, { rivers: 0, coasts: 1 });
  assert.equal(none.followed, 0);
  for (const p of none.pts) assert.ok(distTo(p, stroke) < 2, `(${p}) near the stroke`);
  // Beyond the search radius: not drawn to it.
  const far = run({ stroke: straight(20, 140, 380, 140), features: [{ kind: 'river', pts: river }] }, { rivers: 1 });
  assert.ok(far.pts.every((p) => Math.abs(p[1] - 140) < 21), 'never beyond the radius');
  assert.equal(far.followed, 0);
});

test('the cheapest path through a meander follows the river round it; a weaker pull takes the short cut', () => {
  // A river with a loop out to y = 60 between x = 140 and 220 (its neck 16 px wide).
  const corner = (pts: Array<[number, number]>) => pts.flatMap(([x, y], i, a): Pt[] => {
    if (i === a.length - 1) return [[x, y]];
    const [nx, ny] = a[i + 1], k = Math.ceil(Math.hypot(nx - x, ny - y) / 4);
    return Array.from({ length: k }, (_, j) => [x + ((nx - x) * j) / k, y + ((ny - y) * j) / k] as Pt);
  });
  const river = corner([[0, 100], [172, 100], [150, 84], [210, 84], [188, 100], [400, 100]]);
  const stroke = straight(20, 104, 380, 104);
  const strong = run({ stroke, radius: 24, features: [{ kind: 'river', pts: river }] }, { rivers: 1 });
  assert.ok(strong.pts.some((p) => p[1] < 88), 'round the meander');
  const weak = run({ stroke, radius: 24, features: [{ kind: 'river', pts: river }] }, { rivers: 0.15 });
  assert.ok(!weak.pts.some((p) => p[1] < 92), 'a weak pull does not take it round');
});

test('ridges and valleys from the heights: the line on the crest, or down in the valley', () => {
  // A ridge (or valley) along y = 120 + 0.15 x, about 20 px wide, 1,500 m high; the stroke 10 px off it.
  const axis = (x: number) => 120 + 0.15 * x;
  const ridge = (x: number, y: number) => 300 + 1500 * Math.exp(-(((y - axis(x)) / 12) ** 2));
  const valley = (x: number, y: number) => 2000 - 1500 * Math.exp(-(((y - axis(x)) / 12) ** 2));
  const stroke: Pt[] = Array.from({ length: 41 }, (_, i) => [10 + i * 9, axis(10 + i * 9) + 10] as Pt);
  for (const [heightAt, w] of [[ridge, { ridges: 1 }], [valley, { valleys: 1 }]] as const) {
    const r = run({ stroke, radius: 22, heightAt }, w);
    const middle = r.pts.filter((p) => p[0] > 80 && p[0] < 300);
    assert.ok(middle.length > 5);
    const off = Math.max(...middle.map((p) => Math.abs(p[1] - axis(p[0]))));
    assert.ok(off < 3.5, `${Object.keys(w)[0]}: within ${off.toFixed(1)} px of the axis`);
  }
  // The ridge's weight at nothing: the stroke.
  const none = run({ stroke, radius: 22, heightAt: ridge }, { ridges: 0, rivers: 1 });
  assert.ok(none.pts.every((p) => Math.abs(p[1] - axis(p[0]) - 10) < 2.5));
});

test('a pinned point: the line passes through it; an outline is drawn to a lake shore all the way round', () => {
  const stroke = straight(0, 100, 400, 100);
  const pin: Pt = [200, 112];
  const r = run({ stroke, radius: 20 }, { rivers: 1 }, [pin]);
  assert.ok(r.pts.some((p) => Math.hypot(p[0] - pin[0], p[1] - pin[1]) < 1e-6), 'through the pin');
  // A lake: a circle of radius 100; the outline drawn 7 px outside it, anticlockwise on screen (inside on the left).
  const lake: Pt[] = Array.from({ length: 160 }, (_, i) => [300 + 100 * Math.cos((i * 2 * Math.PI) / 160), 300 + 100 * Math.sin((i * 2 * Math.PI) / 160)] as Pt);
  const ring: Pt[] = Array.from({ length: 72 }, (_, i) => [300 + 107 * Math.cos((-i * 2 * Math.PI) / 72), 300 + 107 * Math.sin((-i * 2 * Math.PI) / 72)] as Pt);
  const shore = run({ stroke: ring, closed: true, radius: 16, features: [{ kind: 'coast', pts: lake, closed: true }] }, { coasts: 1 });
  const onShore = shore.pts.filter((p) => Math.abs(Math.hypot(p[0] - 300, p[1] - 300) - 100) < 0.6).length;
  assert.ok(onShore / shore.pts.length > 0.9, `${onShore} of ${shore.pts.length} points on the shore`);
});

test('the strategic brush: a river\'s far bank, whichever side is yours; towns pulled onto your side, as strongly as asked', () => {
  // A river along y = 100; the stroke along y = 106, drawn left to right. Left of it on screen is up (smaller y).
  const river = straight(0, 100, 400, 100, 100);
  const stroke = straight(20, 106, 380, 106);
  // (The line's height on screen where it crosses x.)
  const yOf = (pts: Pt[], x: number) => { for (let i = 0; i + 1 < pts.length; i++) { const [a, b] = [pts[i], pts[i + 1]]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]); } return NaN; };
  // Yours up (the left): the river kept on your side, the line along its far (lower) bank.
  const up = run({ stroke, side: 1, features: [{ kind: 'river', pts: river }] }, { rivers: 1 });
  assert.ok(yOf(up.pts, 200) > 100.5 && yOf(up.pts, 200) < 105, `yours up: along the lower bank (${yOf(up.pts, 200).toFixed(1)})`);
  // Yours down (the right): along the upper bank.
  const down = run({ stroke, side: -1, features: [{ kind: 'river', pts: river }] }, { rivers: 1 });
  assert.ok(yOf(down.pts, 200) < 99.5 && yOf(down.pts, 200) > 95, `yours down: along the upper bank (${yOf(down.pts, 200).toFixed(1)})`);
  // A town at (200, 116), on the enemy's side (below): pulled onto yours, the line passing below it.
  const town: Pt = [200, 116];
  const plain = run({ stroke, side: 1, points: [{ kind: 'town', p: town }] }, { towns: 0, rough: 0.01 });
  assert.ok(Math.abs(yOf(plain.pts, 200) - 106) < 2, 'no pull: the line as drawn, the town left on the enemy\'s side');
  const pulled = run({ stroke, side: 1, points: [{ kind: 'town', p: town }] }, { towns: 1 });
  assert.ok(yOf(pulled.pts, 200) > town[1] + 2, `pulled: the line passes below the town (${yOf(pulled.pts, 200).toFixed(1)})`);
  // The geography-aware brush has no side: towns do not pull.
  const geo = run({ stroke, points: [{ kind: 'town', p: town }] }, { towns: 1, rivers: 0.01 });
  assert.ok(Math.abs(yOf(geo.pts, 200) - 106) < 2);
});

test('mountain passes found on a ridge are pulled onto your side by the strategic brush', () => {
  // A ridge along y = 100 with a saddle at x = 200 (the crest dips to 900 m from 2,000 m).
  const heightAt = (x: number, y: number) => 200 + (2000 - 1100 * Math.exp(-(((x - 200) / 25) ** 2))) * Math.exp(-(((y - 100) / 14) ** 2));
  const stroke = straight(20, 112, 380, 112);
  const P = prepareSmart({ stroke, closed: false, radius: 24, features: [], heightAt, points: [], side: -1 });
  assert.ok(P);
  const passes = P.points.filter((q) => q.kind === 'pass');
  assert.ok(passes.some((q) => Math.abs(q.p[0] - 200) < 10 && Math.abs(q.p[1] - 100) < 8), `the saddle found (${passes.map((q) => q.p.map((v) => v.toFixed(0)).join(',')).join('; ')})`);
  // Yours below (the right of a stroke drawn left to right): the line goes above the pass.
  const r = smartLine(P, W({ passes: 1 }));
  const at = r.pts.filter((p) => Math.abs(p[0] - 200) < 4);
  assert.ok(at.length && at.every((p) => p[1] < 98), `above the pass (${at.map((p) => p[1].toFixed(1)).join(', ')})`);
});

test('quick enough to move the sliders live: a long stroke with heights and lines in well under a second', () => {
  const river: Pt[] = Array.from({ length: 401 }, (_, i) => [i * 4, 300 + 30 * Math.sin(i / 20)] as Pt);
  const stroke: Pt[] = Array.from({ length: 200 }, (_, i) => [i * 8, 300 + 30 * Math.sin(i / 10) + 12] as Pt);
  const heightAt = (x: number, y: number) => 500 + 300 * Math.sin(x / 50) * Math.cos(y / 70);
  const t0 = performance.now();
  const P = prepareSmart({ stroke, closed: false, radius: 30, features: [{ kind: 'river', pts: river }], heightAt, points: [], side: 0 })!;
  const t1 = performance.now();
  for (const w of [0.3, 0.6, 0.9]) smartLine(P, W({ rivers: w, ridges: 0.5 }));
  const t2 = performance.now();
  assert.ok(t1 - t0 < 1500 && (t2 - t1) / 3 < 600, `prepared in ${(t1 - t0).toFixed(0)} ms, each line in ${((t2 - t1) / 3).toFixed(0)} ms`);
});
