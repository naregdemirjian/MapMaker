// Workspaces' layouts (D196).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLayouts, DEFAULT_LAYOUTS, dragged, tracks, presents, WORKSPACES, LIMITS } from '../src/ui/shell/layout.ts';

test('layouts: whatever was stored is made valid', () => {
  assert.deepEqual(cleanLayouts(null), DEFAULT_LAYOUTS);
  assert.deepEqual(cleanLayouts('nonsense'), DEFAULT_LAYOUTS);
  const l = cleanLayouts({ map: { left: 5000, right: 'wide', bottom: 200.4, hidden: ['right', 'top', 3] }, other: { left: 1 } });
  assert.equal(l.map.left, LIMITS.left[1], 'too wide: the widest allowed');
  assert.equal(l.map.right, DEFAULT_LAYOUTS.map.right, 'not a number: the default');
  assert.equal(l.map.bottom, 200);
  assert.deepEqual(l.map.hidden, ['right'], 'only panels there are');
  assert.deepEqual(l.history, DEFAULT_LAYOUTS.history);
  assert.deepEqual(Object.keys(l).sort(), WORKSPACES.map((w) => w.id).sort());
});

test('layouts: an edge dragged resizes its panel within its limits', () => {
  assert.equal(dragged('left', 250, 40), 290, 'the left panel grows rightwards');
  assert.equal(dragged('right', 310, 40), 270, 'the right panel shrinks when its edge goes right');
  assert.equal(dragged('bottom', 150, -100), 250, 'the timeline grows upwards');
  assert.equal(dragged('left', 250, -1000), LIMITS.left[0]);
  assert.equal(dragged('bottom', 150, -5000), LIMITS.bottom[1]);
});

test('layouts: a folded panel takes no room; shots belong to Present and Export', () => {
  assert.deepEqual(tracks({ left: 250, right: 310, bottom: 150, hidden: ['left', 'bottom'] }), { left: 0, right: 310, bottom: 0 });
  assert.deepEqual(WORKSPACES.filter((w) => presents(w.id)).map((w) => w.id), ['present', 'export']);
});
