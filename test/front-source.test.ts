// Where a change's front starts (D136), worked out from the parcels round it: the border with the new owner's
// land; the side facing its nearest land; the middle; the outer edges of land given up; the points an expansion
// was drawn from; nowhere for a dissolve. Found from the change's own edges, the same as looking at every edge
// of the map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { frontSourceOf } from '../src/render-engine/front-source.ts';
import { E7 } from '../src/geo-kernel/vec.ts';
import { ring } from './helpers.ts';

const Y = (y: number, m = 1) => gregorian.fromCivil({ year: y, month: m });
const box = (w: number, s: number, e: number, n: number): Array<[number, number]> => [[w, s], [e, s], [e, n], [w, n]];

function build() {
  const world = new World();
  const space = cmd.seedProject(world, 'Sources').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const id = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result as string;
  const west = id('West'), east = id('East'), far = id('Far'), fresh = id('New');
  const paint = (pts: Array<[number, number]>, value: string | null, mode: Parameters<typeof cmd.paintTerritory>[2]['mode'], transition: Parameters<typeof cmd.paintTerritory>[2]['transition'] = null) =>
    cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts), value, snap: 1e-7, mode, transition });
  const always = { kind: 'correct' as const, t: NEG_INF };
  // West (0 to 10 °E) and East (10 to 30 °E) share a border at 10 °E; Far lies beyond a gap, from 40 °E.
  paint(box(0, 0, 10, 10), west, always);
  paint(box(10, 0, 30, 10), east, always);
  paint(box(40, 0, 50, 10), far, always);
  const change = (name: string, pts: Array<[number, number]>, value: string | null, year: number, transition: NonNullable<Parameters<typeof cmd.paintTerritory>[2]['transition']>) => {
    const ev = cmd.createEvent(world, { name, start: Y(year), end: Y(year + 2) }).result as string;
    paint(pts, value, { kind: 'new', eventId: ev }, transition);
  };
  return { world, engine, space, layer, west, east, far, fresh, change };
}

/** The change under way at a moment: its parcels, their states, and its source as worked out. */
function sourceAt(p: ReturnType<typeof build>, year: number, owner: string | null, kind: 'border' | 'advance' | 'scatter') {
  const t = Y(year, 7);
  const states = p.engine.partitionState(p.space, p.layer, t);
  const changing = p.engine.partitionChanging(p.space, p.layer, t).filter((f) => states.get(f)?.transition);
  assert.ok(changing.length > 0, 'a change under way');
  const arr = p.world.arrangement(p.space);
  const spec = states.get(changing[0])!.transition!.spec;
  const src = frontSourceOf(arr, changing, owner, spec, kind, states)!;
  // The same lines found the long way: every edge of the map with the change on one side only.
  const inChange = new Set(changing);
  const before = (f: number) => { const st = states.get(f); return st ? (st.transition ? st.transition.from : st.value) : null; };
  const across = (want: (other: number) => boolean) => {
    const out: string[] = [];
    for (const sg of arr.segments.values()) {
      const li = inChange.has(sg.left_face), ri = inChange.has(sg.right_face);
      if (li === ri || !want(li ? sg.right_face : sg.left_face)) continue;
      const a = arr.vertices.get(sg.a)!, b = arr.vertices.get(sg.b)!;
      out.push([a.lon / E7, a.lat / E7, b.lon / E7, b.lat / E7].map((v) => v.toFixed(5)).join(','));
    }
    return out.sort();
  };
  const found = (lonlat: ArrayLike<number>) => { const out: string[] = []; for (let q = 0; q + 3 < lonlat.length; q += 4) out.push([lonlat[q], lonlat[q + 1], lonlat[q + 2], lonlat[q + 3]].map((v) => v.toFixed(5)).join(',')); return out.sort(); };
  return { src, across, found, before };
}

test('taken by a neighbour: from the border it shares with the new owner\'s land, every piece of it and no other edge', () => {
  const p = build();
  p.change('West advances', box(10, 2, 18, 8), p.west, 2000, { style: 'border', easing: 'linear' });
  const { src, across, found, before } = sourceAt(p, 2000, p.west, 'border');
  assert.equal(src.source.kind, 'lines');
  if (src.source.kind !== 'lines') return;
  const lines = found(src.source.lonlat);
  assert.deepEqual(lines, across((o) => before(o) === p.west), 'the edges across which West already held land');
  assert.ok(lines.length >= 1);
  // All of them on the old border at 10 °E, between 2 and 8 °N.
  for (let q = 0; q + 3 < src.source.lonlat.length; q += 4) {
    assert.ok(Math.abs(src.source.lonlat[q] - 10) < 1e-6 && Math.abs(src.source.lonlat[q + 2] - 10) < 1e-6, 'on 10 °E');
    assert.ok(src.source.lonlat[q + 1] >= 2 - 1e-6 && src.source.lonlat[q + 1] <= 8 + 1e-6);
  }
  // Its outline goes with it: the land changing hands.
  const xs = src.rings.flat().map(([x]) => x), ys = src.rings.flat().map(([, y]) => y);
  // (Its northern and southern edges are great circles: a little beyond 8 °N in their middles.)
  assert.ok(Math.min(...xs) > 10 - 1e-6 && Math.max(...xs) < 18 + 1e-6 && Math.min(...ys) > 1.9 && Math.max(...ys) < 8.1, `${Math.min(...xs)}..${Math.max(...xs)}, ${Math.min(...ys)}..${Math.max(...ys)}`);
});

test('taken from across a gap: a straight front from the side facing the new owner\'s nearest land', () => {
  const p = build();
  // Far (from 40 °E) takes East's eastern end (24 to 30 °E): no shared border.
  p.change('Far lands', box(24, 2, 30, 8), p.far, 2000, { style: 'border', easing: 'linear' });
  const { src } = sourceAt(p, 2000, p.far, 'border');
  assert.equal(src.source.kind, 'toward');
  if (src.source.kind !== 'toward') return;
  assert.ok(Math.abs(src.source.point[0] - 40) < 0.6, `Far's nearest land, on 40 °E (${src.source.point})`);
});

test('a country that held nothing grows from the middle; land given up is let go from its outer edges; an expansion from its points; a dissolve from nowhere', () => {
  const p = build();
  p.change('A new country', box(14, 2, 20, 8), p.fresh, 2000, { style: 'border', easing: 'linear' });
  assert.equal(sourceAt(p, 2000, p.fresh, 'border').src.source.kind, 'heart');
  // East gives up its eastern end to nobody: let go from the edges not facing what East keeps (the coast round it).
  p.change('East withdraws', box(24, 0, 30, 10), null, 2010, { style: 'border', easing: 'linear' });
  const gone = sourceAt(p, 2010, null, 'border');
  assert.equal(gone.src.source.kind, 'lines');
  if (gone.src.source.kind === 'lines') {
    const lines = gone.found(gone.src.source.lonlat);
    assert.deepEqual(lines, gone.across((o) => { const v = gone.before(o); return !v || v !== p.east; }));
    for (let q = 0; q + 3 < gone.src.source.lonlat.length; q += 4) assert.ok(!(Math.abs(gone.src.source.lonlat[q] - 24) < 1e-6 && Math.abs(gone.src.source.lonlat[q + 2] - 24) < 1e-6), 'not from the side East keeps (24 °E)');
  }
  // An expansion: from where it was drawn.
  p.change('West expands', box(10, 3, 14, 7), p.west, 2020, { style: 'advance', origin: [10.5, 5], easing: 'linear' });
  const exp = sourceAt(p, 2020, p.west, 'advance');
  assert.equal(exp.src.source.kind, 'points');
  if (exp.src.source.kind === 'points') assert.ok(Math.abs(exp.src.source.points[0][0] - 10.5) < 1e-6 && Math.abs(exp.src.source.points[0][1] - 5) < 1e-6);
  // A dissolve has no front.
  assert.equal(sourceAt(p, 2020, p.west, 'scatter').src.source.kind, 'scatter');
});
