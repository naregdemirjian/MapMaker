// Routes (Stage 10, D106): campaign arrows along lines, and marks flowing along them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothLine, resample, lineLength, campaignArrow, arrowBodyLength, marksAlong, cutLineBetween, mixColor, ARROW_HEAD } from '../src/render-engine/routes.ts';
import { featureStyle } from '../src/render-engine/feature-style.ts';

const L = (...xs: number[]) => Float32Array.from(xs);
/** Whether a point is inside a ring (even-odd). */
function inside(ring: Float32Array, x: number, y: number): boolean {
  let c = false;
  const n = ring.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i], yi = ring[2 * i + 1], xj = ring[2 * j], yj = ring[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

test('a line smoothed keeps its ends and rounds its corners; resampled evenly', () => {
  const corner = L(0, 0, 100, 0, 100, 100);
  const sm = smoothLine(corner, 2);
  assert.deepEqual([sm[0], sm[1]], [0, 0]);
  assert.deepEqual([sm[sm.length - 2], sm[sm.length - 1]], [100, 100]);
  for (let i = 0; i < sm.length; i += 2) assert.ok(!(sm[i] === 100 && sm[i + 1] === 0), 'the corner is cut');
  assert.ok(lineLength(sm) < lineLength(corner), 'shorter round the corner');
  assert.equal(smoothLine(L(0, 0, 10, 0), 3).length, 4, 'a straight segment stays as it is');
  const r = resample(L(0, 0, 100, 0), 10);
  assert.equal(r.length / 2, 11);
  for (let i = 2; i < r.length; i += 2) assert.ok(Math.abs(r[i] - r[i - 2] - 10) < 1e-4);
  const r2 = resample(L(0, 0, 25, 0), 10);
  assert.deepEqual(Array.from(r2), [0, 0, 10, 0, 20, 0, 25, 0], 'the last point kept');
});

test('a campaign arrow: broad body narrowing to its tail, a head twice as wide at the end', () => {
  const ring = campaignArrow(L(0, 0, 300, 0), 20)!;
  assert.ok(ring && ring.length >= 12);
  // Its tip is the line's end.
  let maxX = -Infinity;
  for (let i = 0; i < ring.length; i += 2) maxX = Math.max(maxX, ring[i]);
  assert.equal(maxX, 300);
  const headStart = 300 - 20 * ARROW_HEAD.length;
  assert.ok(inside(ring, 150, 0) && inside(ring, 150, 8), 'the body is broad');
  assert.ok(!inside(ring, 150, 12), 'no broader than its width');
  assert.ok(inside(ring, headStart + 2, 18), 'the head is twice as wide');
  assert.ok(!inside(ring, headStart + 2, 22));
  assert.ok(inside(ring, 2, 2) && !inside(ring, 2, 6), 'narrow at its tail');
  assert.ok(!inside(ring, 301, 0) && !inside(ring, -1, 0));
  // Along a bend it follows the line; a line too short shows nothing.
  const bent = campaignArrow(L(0, 0, 200, 0, 200, 200), 16)!;
  assert.ok(inside(bent, 100, 0) && inside(bent, 197, 120) && !inside(bent, 185, 120), 'it follows the line round the bend');
  assert.equal(campaignArrow(L(0, 0, 0.5, 0), 16), null);
  assert.equal(campaignArrow(L(5, 5), 16), null);
  // Grown half way along (an arrow drawing itself): its head where the line has got to.
  const half = campaignArrow(cutLineBetween(L(0, 0, 300, 0), 0, 150), 20)!;
  let hx = -Infinity;
  for (let i = 0; i < half.length; i += 2) hx = Math.max(hx, half[i]);
  assert.equal(hx, 150);
  assert.ok(Math.abs(arrowBodyLength(300, 20) - headStart) < 1e-9);
  assert.equal(arrowBodyLength(10, 20), 5, 'a short arrow is half head');
});

test('marks along a line, carried toward its end as the offset grows', () => {
  const line = L(0, 0, 100, 0);
  assert.deepEqual(marksAlong(line, 10, 0).map((m) => m[0]), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const moved = marksAlong(line, 10, 3).map((m) => Math.round(m[0]));
  assert.deepEqual(moved, [3, 13, 23, 33, 43, 53, 63, 73, 83, 93], 'moved 3 pixels along');
  assert.deepEqual(marksAlong(line, 10, 13).map((m) => Math.round(m[0])), moved, 'the same every spacing');
  assert.deepEqual(marksAlong(line, 10, -7).map((m) => Math.round(m[0])), moved, 'and backwards');
  assert.deepEqual(marksAlong(line, 10, 0, 25, 55).map((m) => Math.round(m[0] * 1e6) / 1e6), [25, 35, 45, 55], 'between two distances');
  const corner = marksAlong(L(0, 0, 50, 0, 50, 50), 20, 0);
  assert.deepEqual(corner.map((m) => [Math.round(m[0]), Math.round(m[1])]), [[0, 0], [20, 0], [40, 0], [50, 10], [50, 30], [50, 50]]);
  assert.equal(corner[1][2], 0);
  assert.ok(Math.abs(corner[4][2] - Math.PI / 2) < 1e-9, 'the way the line goes there');
  assert.deepEqual(marksAlong(line, 0, 0), []);
  assert.deepEqual(Array.from(cutLineBetween(L(0, 0, 50, 0, 50, 50), 40, 60)), [40, 0, 50, 0, 50, 10]);
});

test('route looks are kept in a line\'s style; colours mixed', () => {
  const st = featureStyle('line', JSON.stringify({ look: 'arrow', width: 24 }), JSON.stringify({ flow: 'chevrons', flowSpeed: 90 }));
  assert.equal(st.look, 'arrow');
  assert.equal(st.width, 24);
  assert.equal(st.flow, 'chevrons');
  assert.equal(st.flowSpeed, 90);
  const plain = featureStyle('line', undefined, undefined);
  assert.equal(plain.look, 'line');
  assert.equal(plain.flow, 'none');
  assert.equal(mixColor('#ff0000', '#ffffff', 0.5), 'rgb(255,128,128)');
  assert.equal(mixColor('#abc', '#000', 0), 'rgb(170,187,204)');
  assert.equal(mixColor('rgba(10,20,30,0.5)', '#ffffff', 1), 'rgb(255,255,255)');
  assert.equal(mixColor('tomato', '#fff', 0.5), 'tomato', 'names are left as they are');
});
