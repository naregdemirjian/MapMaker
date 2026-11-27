// Panels that dock (S1 of the studios, D234): the layout tree and what dragging, closing and opening do to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stack, split, panelsOf, visiblePanels, holderOf, removePanel, dockPanel, floatPanel, placeFloat, resizeAt, openPanel, cleanLayout, normalize, topStacks, sameShape, activate, type DockLayout, type DockNode } from '../src/ui/shell/dock.ts';

/** A layout as it reads: rows (a|b), columns (a/b), groups [x,y] with the panel in front starred, sizes after @. */
function sig(n: DockNode): string {
  const size = n.size ? `@${n.size}` : '';
  if (n.kind === 'stack') return `[${n.panels.map((p) => (p === n.active && n.panels.length > 1 ? `${p}*` : p)).join(',')}]${size}`;
  return `(${n.children.map(sig).join(n.dir === 'row' ? ' | ' : ' / ')})${size}`;
}
/** Tools | lists | (viewer / timeline) | properties. */
function page(): DockLayout {
  return { root: split('row', [stack(['tools'], 44), stack(['layers', 'countries', 'events'], 250), split('col', [stack(['viewer']), stack(['timeline'], 190)]), stack(['properties'], 310)]), floats: [] };
}
const idOf = (l: DockLayout, panel: string) => holderOf(l, panel)!.id;

test('a page: its panels, those in front, where each is', () => {
  const l = page();
  assert.equal(sig(l.root), '([tools]@44 | [layers*,countries,events]@250 | ([viewer] / [timeline]@190) | [properties]@310)');
  assert.deepEqual(panelsOf(l), ['tools', 'layers', 'countries', 'events', 'viewer', 'timeline', 'properties']);
  assert.deepEqual(visiblePanels(l), ['tools', 'layers', 'viewer', 'timeline', 'properties']);
  assert.deepEqual(visiblePanels(activate(l, idOf(l, 'events'), 'events')), ['tools', 'events', 'viewer', 'timeline', 'properties']);
});

test('dropped into a group, a panel joins its tabs, in front', () => {
  const l = dockPanel(page(), 'properties', idOf(page(), 'layers'), 'center');
  const l2 = dockPanel(page(), 'properties', 'nope', 'center');
  assert.equal(sig(l2.root), sig(page().root), 'nowhere: nothing changes');
  const p = page();
  const m = dockPanel(p, 'properties', idOf(p, 'layers'), 'center');
  assert.equal(sig(m.root), '([tools]@44 | [layers,countries,events,properties*]@250 | ([viewer] / [timeline]@190))');
  void l;
});

test('dropped on a side, a group is split there; the new group takes the size given', () => {
  const p = page();
  // Beside the viewer, on its right, in the column it shares with the timeline: a row of the two in that column.
  const r = dockPanel(p, 'events', idOf(p, 'viewer'), 'right', 300);
  assert.equal(sig(r.root), '([tools]@44 | [layers*,countries]@250 | (([viewer] | [events]@300) / [timeline]@190) | [properties]@310)');
  // Above the timeline: in the same column, so no new split.
  const t = dockPanel(p, 'properties', idOf(p, 'timeline'), 'top', 150);
  assert.equal(sig(t.root), '([tools]@44 | [layers*,countries,events]@250 | ([viewer] / [properties]@150 / [timeline]@190))');
  // Left of the lists, in the page's row: a new group in that row.
  const lft = dockPanel(p, 'timeline', idOf(p, 'layers'), 'left', 200);
  assert.equal(sig(lft.root), '([tools]@44 | [timeline]@200 | [layers*,countries,events]@250 | [viewer] | [properties]@310)');
  // Below a fixed group: the group becomes a column of the two, keeping its width.
  const b = dockPanel(p, 'events', idOf(p, 'properties'), 'bottom', 200);
  assert.equal(sig(b.root), '([tools]@44 | [layers*,countries]@250 | ([viewer] / [timeline]@190) | ([properties] / [events]@200)@310)');
});

test('on its own group, alone in it: nothing changes; with others: it leaves for its own group', () => {
  const p = page();
  assert.equal(sig(dockPanel(p, 'properties', idOf(p, 'properties'), 'left', 200).root), sig(p.root));
  const m = dockPanel(p, 'events', idOf(p, 'events'), 'bottom', 180);
  assert.equal(sig(m.root), '([tools]@44 | ([layers*,countries] / [events]@180)@250 | ([viewer] / [timeline]@190) | [properties]@310)');
});

test('closed, a panel goes; an emptied group goes and its split closes up', () => {
  const p = page();
  const a = removePanel(p, 'timeline');
  assert.equal(sig(a.root), '([tools]@44 | [layers*,countries,events]@250 | [viewer] | [properties]@310)', 'the column of one is replaced by the viewer');
  const b = removePanel(activate(p, idOf(p, 'countries'), 'countries'), 'countries');
  assert.equal(holderOf(b, 'events')!.active, 'events', 'the next tab comes to the front');
  const c = removePanel(removePanel(removePanel(p, 'layers'), 'countries'), 'events');
  assert.equal(sig(c.root), '([tools]@44 | ([viewer] / [timeline]@190) | [properties]@310)');
});

test('floating: out of its place to a window over everything, moved, docked again', () => {
  const p = page();
  const f = floatPanel(p, 'properties', { x: 300, y: 100, w: 280, h: 400 });
  assert.equal(sig(f.root), '([tools]@44 | [layers*,countries,events]@250 | ([viewer] / [timeline]@190))');
  assert.equal(f.floats.length, 1);
  assert.deepEqual(f.floats[0].panels, ['properties']);
  const moved = placeFloat(f, f.floats[0].id, { x: 10, y: 20 });
  assert.deepEqual([moved.floats[0].x, moved.floats[0].y, moved.floats[0].w], [10, 20, 280]);
  // Another panel dropped into the window joins its tabs; any side of it counts as its tabs.
  const two = dockPanel(f, 'events', f.floats[0].id, 'left');
  assert.deepEqual(two.floats[0].panels, ['properties', 'events']);
  // Docked again: the window goes.
  const back = dockPanel(f, 'properties', idOf(f, 'viewer'), 'right', 310);
  assert.equal(back.floats.length, 0);
  assert.equal(sig(back.root), '([tools]@44 | [layers*,countries,events]@250 | (([viewer] | [properties]@310) / [timeline]@190))');
  // The viewer floating with nothing else docked: the first window docks again, filling the area.
  const lone: DockLayout = { root: stack(['viewer']), floats: [] };
  const out = floatPanel(floatPanel(lone, 'properties', { x: 0, y: 0, w: 200, h: 200 }), 'viewer', { x: 50, y: 50, w: 400, h: 300 });
  assert.equal(sig(out.root), '[properties]');
  assert.deepEqual(out.floats.map((x) => x.panels), [['viewer']]);
});

test('resizing: a fixed group changes size, a flexible one takes what is left, never below the least', () => {
  const p = page();
  const row = p.root as Extract<DockNode, { kind: 'split' }>;
  // The edge between the lists (fixed) and the column of the viewer (flexible): the lists grow.
  const a = resizeAt(p, row.id, 1, 60, [250, 700]);
  assert.equal(sig(a.root), '([tools]@44 | [layers*,countries,events]@310 | ([viewer] / [timeline]@190) | [properties]@310)');
  // Between the column (flexible) and Properties (fixed): Properties shrink as the edge goes right.
  const b = resizeAt(p, row.id, 2, 40, [700, 310]);
  assert.ok(sig(b.root).endsWith('[properties]@270)'));
  // Never below the least.
  const c = resizeAt(p, row.id, 1, -1000, [250, 700]);
  assert.ok(sig(c.root).includes('events]@120 |'));
  // Two flexible ones: the first becomes fixed.
  const q: DockLayout = { root: split('row', [stack(['a']), stack(['viewer'])]), floats: [] };
  const d = resizeAt(q, q.root.id, 0, 50, [400, 400]);
  assert.equal(sig(d.root), '([a]@450 | [viewer])');
});

test('opened again: in front where it is; else beside a panel it was with at first; else on its side of the viewer; else floating', () => {
  const original = page();
  const closed = removePanel(original, 'events');
  const back = openPanel(closed, 'events', original);
  assert.equal(sig(back.root), '([tools]@44 | [layers,countries,events*]@250 | ([viewer] / [timeline]@190) | [properties]@310)');
  // In its place among the others, as at first.
  assert.equal(sig(openPanel(removePanel(original, 'countries'), 'countries', original).root), '([tools]@44 | [layers,countries*,events]@250 | ([viewer] / [timeline]@190) | [properties]@310)');
  // None of its group open: in a group of its own, on the side of the viewer it was on at first, as large.
  const alone = removePanel(removePanel(removePanel(original, 'layers'), 'countries'), 'events');
  assert.equal(sig(openPanel(alone, 'countries', original).root), '([tools]@44 | [countries]@250 | ([viewer] / [timeline]@190) | [properties]@310)');
  assert.equal(sig(openPanel(removePanel(original, 'properties'), 'properties', original).root), sig(original.root));
  // (The column the timeline shared with the viewer closed up when it went: it comes back under everything.)
  assert.equal(sig(openPanel(removePanel(original, 'timeline'), 'timeline', original).root), '(([tools]@44 | [layers*,countries,events]@250 | [viewer] | [properties]@310) / [timeline]@190)');
  // A page whose layout has changed: next to the highest part holding the viewer in a split running that way.
  const moved = dockPanel(removePanel(original, 'timeline'), 'properties', holderOf(original, 'viewer')!.id, 'bottom', 200);
  assert.equal(sig(moved.root), '([tools]@44 | [layers*,countries,events]@250 | ([viewer] / [properties]@200))');
  assert.equal(sig(openPanel(moved, 'timeline', original).root), '([tools]@44 | [layers*,countries,events]@250 | ([viewer] / [timeline]@190 / [properties]@200))');
  const flat: DockLayout = { root: split('row', [stack(['viewer']), stack(['tools'], 44)]), floats: [] };
  assert.equal(sig(openPanel(flat, 'timeline', original).root), '(([viewer] | [tools]@44) / [timeline]@190)', 'no column: one round everything');
  // Not in the first layout at all: it floats.
  const fl = openPanel(original, 'shots', original);
  assert.equal(fl.floats.length, 1);
  assert.deepEqual(fl.floats[0].panels, ['shots']);
  const again = openPanel(original, 'events', original);
  assert.equal(holderOf(again, 'events')!.active, 'events', 'already open: brought to the front');
});

test('a kept layout cleaned: unknown and doubled panels taken away; without the viewer, the first layout', () => {
  const known = (p: string) => ['tools', 'layers', 'countries', 'events', 'viewer', 'timeline', 'properties'].includes(p);
  const fallback = page();
  const kept = JSON.parse(JSON.stringify(page()));
  kept.root.children[1].panels.push('old-panel', 'layers');
  kept.floats.push({ id: 'f1', panels: ['events', 'zz'], active: 'zz', x: 'a', y: 30, w: 10, h: 900 });
  const c = cleanLayout(kept, known, fallback);
  assert.equal(sig(c.root), sig(page().root));
  assert.equal(c.floats.length, 0, 'the window held only a panel already placed, and an unknown one');
  assert.equal(cleanLayout({ root: { kind: 'stack', panels: ['layers'] }, floats: [] }, known, fallback), fallback, 'no viewer');
  assert.equal(cleanLayout('nonsense', known, fallback), fallback);
  const good = cleanLayout({ root: { kind: 'split', dir: 'row', children: [{ kind: 'stack', panels: ['viewer'], size: 300 }, { kind: 'stack', panels: ['properties'], size: 200 }] }, floats: [] }, known, fallback);
  assert.equal(sig(good.root), '([viewer] | [properties]@200)', 'every split keeps a flexible child: the viewer’s');
});

test('put in order; the groups along the top; two layouts of the same shape', () => {
  const n = normalize(split('row', [split('row', [stack(['a'], 100), stack(['b'], 100)], 0), split('col', [stack([], 50), stack(['c'], 0)], 200)]))!;
  assert.equal(sig(n), '([a]@100 | [b] | [c]@200)', 'a row in a row opened up; a column of one replaced by its child');
  const p = page();
  const top = topStacks(p.root);
  assert.ok(top.has(idOf(p, 'viewer')) && top.has(idOf(p, 'properties')) && !top.has(idOf(p, 'timeline')));
  assert.ok(sameShape(p, page()));
  assert.ok(!sameShape(p, removePanel(p, 'timeline')));
});
