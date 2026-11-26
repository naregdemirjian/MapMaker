import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, splitPiece, hitTest, moveHandle, moveAnchor, anchorIndices, cubicAt, type Anchor, type LL } from '../src/ui/bezier-path.ts';

const near = (a: LL, b: LL, eps = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
const proj = (ll: LL): [number, number] => [ll[0] * 10, -ll[1] * 10];

test('corners make straight pieces; a handle makes a curve through its anchors (D232)', () => {
  const corners: Anchor[] = [{ p: [0, 0] }, { p: [10, 0] }, { p: [10, 10] }];
  assert.deepEqual(flatten(corners, false), [[0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(flatten(corners, true), [[0, 0], [10, 0], [10, 10]], 'closed: back to the first, not repeated');
  const smooth: Anchor[] = [{ p: [0, 0], o: [0, 5] }, { p: [10, 0], i: [10, 5] }];
  const line = flatten(smooth, false, 20);
  assert.equal(line.length, 21);
  assert.ok(near(line[0], [0, 0]) && near(line[20], [10, 0]), 'through its anchors');
  assert.ok(Math.abs(line[10][1] - 3.75) < 1e-9, 'bulging toward its handles (3/4 of their height half way)');
  assert.deepEqual(anchorIndices([{ p: [0, 0] }, ...smooth.map((a) => ({ ...a, p: [a.p[0] + 1, a.p[1]] as LL }))], 20), [0, 1, 21]);
});

test('a point added on the path keeps its shape', () => {
  const path: Anchor[] = [{ p: [0, 0], o: [2, 6] }, { p: [10, 0], i: [8, 6] }, { p: [12, 4] }];
  const before = flatten(path, false, 400);
  for (const t of [0.2, 0.5, 0.83]) {
    const split = splitPiece(path, 0, t);
    assert.equal(split.length, 4);
    assert.ok(near(split[1].p, cubicAt([0, 0], [2, 6], [8, 6], [10, 0], t)), 'on the curve');
    const after = flatten(split, false, 400);
    // Every point of the new path lies on the old one.
    for (const q of after.filter((_, i) => i % 20 === 0)) {
      const d = Math.min(...before.map((b) => Math.hypot(b[0] - q[0], b[1] - q[1])));
      assert.ok(d < 0.03, `t ${t}: on the old curve (${d})`);
    }
  }
  // A straight piece: a corner half way.
  assert.deepEqual(splitPiece([{ p: [0, 0] }, { p: [4, 2] }], 0, 0.5), [{ p: [0, 0] }, { p: [2, 1] }, { p: [4, 2] }]);
  // Closed: the piece from the last back to the first.
  const closed = splitPiece([{ p: [0, 0] }, { p: [4, 0] }, { p: [4, 4] }], 2, 0.5);
  assert.deepEqual(closed.map((a) => a.p), [[0, 0], [4, 0], [4, 4], [2, 2]]);
});

test('handles: a smooth point keeps them in line, Alt breaks it; an anchor carries its handles', () => {
  const a: Anchor = { p: [0, 0], i: [-2, 0], o: [2, 0] };
  const turned = moveHandle(a, 'o', [0, 3], false);
  assert.ok(near(turned.o!, [0, 3]) && near(turned.i!, [0, -2]), 'in line, keeping its length');
  const broken = moveHandle(a, 'o', [0, 3], true);
  assert.ok(near(broken.i!, [-2, 0]), 'broken: the other stays');
  assert.deepEqual(moveAnchor(a, 1, 1), { p: [1, 1], i: [-1, 1], o: [3, 1] });
});

test('what lies under the pointer: handles, then anchors, then the path', () => {
  const path: Anchor[] = [{ p: [0, 0], o: [0, 2] }, { p: [10, 0] }];
  assert.deepEqual(hitTest(path, false, proj, [0, -20]), { kind: 'handle', index: 0, which: 'o' });
  assert.deepEqual(hitTest(path, false, proj, [101, 2]), { kind: 'anchor', index: 1 });
  const h = hitTest(path, false, proj, [50, -5]);
  assert.equal(h?.kind, 'piece');
  assert.equal(hitTest(path, false, proj, [50, 40]), null, 'nothing far from it');
  // The closing piece only when closed.
  const tri: Anchor[] = [{ p: [0, 0] }, { p: [10, 0] }, { p: [10, 10] }];
  assert.equal(hitTest(tri, false, proj, [50, -50]), null);
  assert.deepEqual(hitTest(tri, true, proj, [50, -50])?.kind, 'piece');
});
