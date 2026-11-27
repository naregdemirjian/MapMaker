// The five studios (S1, D234): their pages, the panels each page can hold, each page's first layout, and what is
// kept of the layouts on this computer made valid again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STUDIOS, PAGES, PANELS, studioOf, presents, drawsOn, isPage, panelOn, defaultDock, cleanDocks, loadPage, type Page } from '../src/ui/shell/studios.ts';
import { panelsOf, sameShape, stack, split, VIEWER, type DockNode } from '../src/ui/shell/dock.ts';

/** A layout as it reads: rows (a|b), columns (a/b), groups [x,y] with the panel in front starred, sizes after @. */
function sig(n: DockNode): string {
  const size = n.size ? `@${n.size}` : '';
  if (n.kind === 'stack') return `[${n.panels.map((p) => (p === n.active && n.panels.length > 1 ? `${p}*` : p)).join(',')}]${size}`;
  return `(${n.children.map(sig).join(n.dir === 'row' ? ' | ' : ' / ')})${size}`;
}

test('five studios; Presentation has two pages, the others one each', () => {
  assert.deepEqual(STUDIOS.map((s) => s.name), ['Map Studio', 'History', 'Timeline', 'Looks', 'Presentation']);
  assert.deepEqual(STUDIOS.map((s) => s.pages), [['map'], ['history'], ['timeline'], ['looks'], ['shots', 'export']]);
  assert.deepEqual(PAGES.map((p) => [p.id, studioOf(p.id)]), [['map', 'map'], ['history', 'history'], ['timeline', 'timeline'], ['looks', 'looks'], ['shots', 'present'], ['export', 'present']]);
  assert.deepEqual(PAGES.filter((p) => presents(p.id)).map((p) => p.id), ['shots', 'export']);
  assert.deepEqual(PAGES.filter((p) => drawsOn(p.id)).map((p) => p.id), ['map', 'history'], 'the tools to draw with: Map Studio and History');
  assert.ok(isPage('looks') && !isPage('world') && !isPage(null));
});

test('every panel has a name and the pages it opens in; the viewer opens everywhere and cannot be closed', () => {
  assert.equal(new Set(PANELS.map((p) => p.id)).size, PANELS.length);
  const viewer = PANELS.find((p) => p.id === VIEWER)!;
  assert.deepEqual(viewer.pages, PAGES.map((p) => p.id));
  assert.equal(viewer.closable, false);
  assert.ok(panelOn('countries', 'history') && panelOn('countries', 'looks') && !panelOn('countries', 'shots'));
  assert.ok(panelOn('shots', 'export') && !panelOn('shots', 'history'));
  assert.ok(panelOn('tools', 'map') && panelOn('tools', 'history') && !panelOn('tools', 'timeline'), 'the tools only where there is drawing');
  assert.ok(!panelOn('nonsense', 'history'));
});

test('each page opens with its own layout, holding only panels it can hold, the viewer among them', () => {
  const want: Record<Page, string> = {
    map: '(([tools]@44 | [maps*,layers]@230 | [viewer] | [properties]@350) / [timeline]@130)',
    history: '(([tools]@44 | [layers,countries*,places,areas,events,maps]@250 | [viewer] | [properties]@310) / [timeline]@190)',
    timeline: '(([events*,countries,layers]@270 | [viewer] | [properties]@330) / [timeline]@340)',
    looks: '(([countries*,layers,places,areas]@250 | [viewer] | [properties]@340) / [timeline]@130)',
    shots: '(([shots]@250 | [viewer] | [shot]@310) / [shot-timeline]@150)',
    export: '(([shots]@230 | [viewer] | [export]@380) / [shot-timeline]@110)',
  };
  for (const { id } of PAGES) {
    const l = defaultDock(id);
    assert.equal(sig(l.root), want[id], id);
    assert.deepEqual(l.floats, []);
    const panels = panelsOf(l);
    assert.ok(panels.includes(VIEWER), id);
    for (const p of panels) assert.ok(panelOn(p, id), `${p} in ${id}`);
    assert.equal(new Set(panels).size, panels.length, `${id}: each panel once`);
  }
});

test('the layouts kept, made valid page by page: nothing kept, the first layouts; a panel of another page dropped', () => {
  const none = cleanDocks(null);
  for (const { id } of PAGES) {
    assert.ok(sameShape(none[id].live, defaultDock(id)), id);
    assert.equal(none[id].saved, null);
  }
  const junk = cleanDocks('nonsense');
  for (const { id } of PAGES) assert.ok(sameShape(junk[id].live, defaultDock(id)) && junk[id].saved === null, `not a layout at all: the first ones (${id})`);
  // History kept with the Shots panel (which belongs to Presentation) and the viewer: the Shots panel goes.
  const kept = { history: { live: { root: split('row', [stack(['shots', 'countries']), stack([VIEWER])]), floats: [] }, saved: null } };
  assert.equal(sig(cleanDocks(kept).history.live.root), '([countries] | [viewer])');
  // A saved layout without the viewer is not one: Reset then returns to the first layout.
  const noViewer = { looks: { live: null, saved: { root: stack(['countries']), floats: [] } } };
  const c = cleanDocks(noViewer);
  assert.ok(sameShape(c.looks.saved!, defaultDock('looks')));
  // The layout worked in, unreadable: the one saved stands in for it.
  const saved = { root: split('col', [stack([VIEWER]), stack(['timeline'], 200)]), floats: [] };
  const d = cleanDocks({ timeline: { live: { root: 42 }, saved } });
  assert.equal(sig(d.timeline.live.root), '([viewer] / [timeline]@200)');
  assert.ok(sameShape(d.timeline.saved!, saved));
});

test('a session opens on the page last worked in, never in Presentation; with nothing kept, History', () => {
  // (Here there is no storage at all: the default.)
  assert.equal(loadPage(), 'history');
});
