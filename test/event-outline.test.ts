// The outline of events (D247): events as a tree, each under the shortest longer one that holds it; the rows shown,
// folded and filtered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outline, heldCount, visibleRows, parentOf, type OutlineEvent, type OutlineNode } from '../src/domain/event-outline.ts';

const E = (id: string, start: number, end: number | null = null): OutlineEvent => ({ id, name: id, start, end });
const shape = (list: OutlineNode[]): unknown => list.map((n) => (n.kids.length ? [n.id, shape(n.kids)] : n.id));

test('each event under the shortest longer one that holds it, every level in order of start', () => {
  const roots = outline([
    E('treaty', 1360), E('battle', 1342, 1342.1), E('war', 1337, 1356), E('campaign', 1340, 1345), E('siege', 1350, 1351), E('plague', 1357, 1359),
  ]);
  assert.deepEqual(shape(roots), [['war', [['campaign', ['battle']], 'siege']], 'plague', 'treaty']);
  assert.deepEqual(roots[0].kids[0].kids.map((n) => n.depth), [2]);
  assert.equal(heldCount(roots[0]), 3);
  assert.equal(parentOf(roots, 'battle')?.id, 'campaign');
  assert.equal(parentOf(roots, 'war'), null);
});

test('events of the same span stand side by side; a moment at an end is held; an event crossing another is not', () => {
  assert.deepEqual(shape(outline([E('a', 10, 20), E('b', 10, 20)])), ['a', 'b']);
  assert.deepEqual(shape(outline([E('war', 10, 20), E('peace', 20)])), [['war', ['peace']]]);
  assert.deepEqual(shape(outline([E('a', 10, 20), E('b', 15, 25)])), ['a', 'b']);
  assert.deepEqual(outline([]), []);
});

test('the rows shown: what folded events hold left out; filtered, the matches and what holds them, opened', () => {
  const roots = outline([E('war', 1337, 1356), E('campaign', 1340, 1345), E('battle', 1342, 1342.1), E('treaty', 1360)]);
  const ids = (rows: OutlineNode[]) => rows.map((n) => n.id);
  assert.deepEqual(ids(visibleRows(roots, () => false)), ['war', 'campaign', 'battle', 'treaty']);
  assert.deepEqual(ids(visibleRows(roots, (id) => id === 'campaign')), ['war', 'campaign', 'treaty']);
  assert.deepEqual(ids(visibleRows(roots, (id) => id === 'war')), ['war', 'treaty']);
  // Filtered: the battle, with the war and the campaign holding it, whatever is folded.
  assert.deepEqual(ids(visibleRows(roots, () => true, (id) => id === 'battle')), ['war', 'campaign', 'battle']);
  assert.deepEqual(ids(visibleRows(roots, () => false, (id) => id === 'nothing')), []);
});
