// Settling a galaxy's systems as a race (D180): ships go from system to system at their speed, each colony waiting a
// while before it sends its own; the first to arrive keeps a system; systems a lineage may not settle, systems taken
// already and arrivals after the end are left alone; the same every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbours, race, Heap } from '../src/examples/settle.ts';
import { galaxyCatalogue, SYSTEM_ID_BASE } from '../src/space/galaxy.ts';
import type { Star, StarCatalogue } from '../src/space/catalogue.ts';

/** Stars on a line, `gap` light-years apart (ids 0, 1, 2…). */
function line(n: number, gap: number): StarCatalogue {
  const stars: Star[] = Array.from({ length: n }, (_, i) => ({ id: i, name: `S${i}`, alt: '', x: i * gap, y: 0, z: 0, dist: i * gap, absmag: 5, spect: 'G2V', system: 0 }));
  return { radiusLy: n * gap, stars, byId: new Map(stars.map((s) => [s.id, s])) };
}

test('a heap gives the smallest first, equal keys in the order pushed', () => {
  const h = new Heap<string>();
  for (const [k, v] of [[5, 'e'], [1, 'a'], [3, 'c1'], [3, 'c2'], [2, 'b'], [3, 'c3']] as Array<[number, string]>) h.push(k, v);
  const out: string[] = [];
  for (let x = h.pop(); x; x = h.pop()) out.push(x[1]);
  assert.deepEqual(out, ['a', 'b', 'c1', 'c2', 'c3', 'e']);
});

test('ships go from system to system: each arrives after its colony waited and the voyage took its time', () => {
  const cat = line(6, 100);
  const g = neighbours(cat, 150, () => true);
  assert.deepEqual(g.get(2)!.map(([id]) => id), [1, 3], 'only the systems within reach, nearest first');
  const out = race(cat, g, [{ lineage: 'a', stars: [0], year: 1000, speed: 0.1, pause: 500 }], 1e9);
  // 100 light-years at a tenth of the speed of light take a thousand years; each colony waits five hundred.
  assert.deepEqual([...out.values()].map((a) => [a.star, a.year, a.from]), [[0, 1000, null], [1, 2500, 0], [2, 4000, 1], [3, 5500, 2], [4, 7000, 3], [5, 8500, 4]]);
});

test('the first to arrive keeps a system; none settles what it may not, what is taken, or after the end', () => {
  const cat = line(9, 100);
  const g = neighbours(cat, 150, () => true);
  // From both ends at once: they meet in the middle, the one starting earlier taking the middle system.
  const both = race(cat, g, [{ lineage: 'west', stars: [0], year: 0, speed: 0.1, pause: 0 }, { lineage: 'east', stars: [8], year: 100, speed: 0.1, pause: 0 }], 1e9);
  assert.deepEqual([...both.values()].sort((a, b) => a.star - b.star).map((a) => a.lineage), ['west', 'west', 'west', 'west', 'west', 'east', 'east', 'east', 'east']);
  // Only systems it may settle, never one taken, and nothing after the end.
  const only = race(cat, g, [{ lineage: 'a', stars: [0], year: 0, speed: 0.1, pause: 0, only: (s) => s.id < 6 }], 1e9, new Set([3]));
  assert.deepEqual([...only.keys()].sort((a, b) => a - b), [0, 1, 2], 'stopped by the taken system');
  const ended = race(cat, g, [{ lineage: 'a', stars: [0], year: 0, speed: 0.1, pause: 0 }], 2500);
  assert.deepEqual([...ended.keys()].sort((a, b) => a - b), [0, 1, 2], 'two voyages before the end');
  const until = race(cat, g, [{ lineage: 'a', stars: [0], year: 0, speed: 0.1, pause: 0, until: 1500 }], 1e9);
  assert.equal(until.size, 2, 'nor after its own last year');
});

test('on the Milky Way: realms grow along the arms, the same every time', () => {
  const cat = galaxyCatalogue({ kind: 'milkyway', seed: 1, systems: 600, arms: 4, pitch: 14, radiusLy: 50000, bar: true });
  const g = neighbours(cat, 4000, (s) => s.id >= SYSTEM_ID_BASE || s.id === 0);
  const seeds = [{ lineage: 'sun', stars: [0], year: 0, speed: 0.01, pause: 50000 }, { lineage: 'far', stars: [SYSTEM_ID_BASE + 7], year: 0, speed: 0.01, pause: 50000 }];
  const a = race(cat, g, seeds, 5e6), b = race(cat, g, seeds, 5e6);
  assert.deepEqual([...a.values()], [...b.values()], 'the same every time');
  assert.ok(a.size > 300, `${a.size} systems reached`);
  for (const x of a.values()) {
    if (x.from === null) continue;
    const p = a.get(x.from)!, s = cat.byId.get(x.star)!, f = cat.byId.get(x.from)!;
    assert.equal(p.lineage, x.lineage, 'settled from a system of its own lineage');
    assert.ok(Math.abs(x.year - (p.year + 50000 + Math.hypot(s.x - f.x, s.y - f.y, s.z - f.z) / 0.01)) < 1e-6, 'after the wait and the voyage');
  }
});
