// The land within reach of a border (D222): as far as the distance by travel through the land, from the border
// only; slower over rough ground; outlines and their holes; the border between two countries and the land
// either side found on the map; an advance taking only the neighbour's land, a buffer zone to nobody, never
// another country's land; one undo step; refused where it makes no sense. Zones of control (D223): a country's
// land divided among its cities by travel through it, each parcel to one zone, none left over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { landWithin, polygonsOf, sharedBorder, landRings, borderNear, clipRing, degreesFor, zonesOf, zoneFinder, type LonLatPolygon } from '../src/domain/reach.ts';
import { ring } from './helpers.ts';

const R = 6371.0088;
const KM_PER_DEG = (R * Math.PI) / 180;
const box = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const Y = (y: number) => gregorian.fromCivil({ year: y, month: 1, day: 1 });

/** The farthest east a polygon reaches along a latitude (its outline's crossings of it). */
function eastAt(polys: LonLatPolygon[], lat: number): number {
  let best = -Infinity;
  for (const p of polys) for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [x0, y0] = r[j], [x1, y1] = r[i];
    if ((y0 > lat) !== (y1 > lat)) best = Math.max(best, x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0));
  }
  return best;
}

test('the land within a distance of a border, by travel through the land; slower over rough ground', () => {
  assert.ok(Math.abs(degreesFor(KM_PER_DEG, R) - 1) < 1e-12);
  // A country 20° wide, its border on the west along 10° east: 2° of it reached.
  const region = [box(10, -10, 30, 10)], border = [10, -10, 10, 10];
  const two = landWithin(region, border, 2 * KM_PER_DEG, R);
  assert.equal(two.problem, null);
  for (const lat of [-6, 0, 6]) { const e = eastAt(two.polygons, lat); assert.ok(e > 11.75 && e < 12.25, `as far as 12° east at ${lat}° (${e.toFixed(2)})`); }
  // Half as far, half as deep.
  const one = landWithin(region, border, KM_PER_DEG, R);
  assert.ok(Math.abs(eastAt(one.polygons, 0) - 11) < 0.2, `1° in (${eastAt(one.polygons, 0).toFixed(2)})`);
  // Minding the land: three times slower east of 11°, so the second degree of travel goes a third as far.
  const rough = landWithin(region, border, 2 * KM_PER_DEG, R, (lon) => (lon > 11 ? 3 : 1));
  const e = eastAt(rough.polygons, 0);
  assert.ok(e > 11.15 && e < 11.55, `stopped short in the rough ground (${e.toFixed(2)}, about 11.33)`);
  // All of a small country when it lies within reach; none without a border.
  const small = landWithin([box(10, -1, 11, 1)], [10, -1, 10, 1], 5 * KM_PER_DEG, R);
  assert.ok(eastAt(small.polygons, 0) >= 11 - 1e-6, 'all of it');
  assert.equal(landWithin(region, [], 100, R).problem, 'no-border');
  // Both sides of a border, as for a buffer zone: nowhere within the land farther from the border than the distance,
  // not even where the land's edges meet the cut made round the border (its corners).
  // (Several distances: where the cut lies just within reach depends on how the grid falls.)
  for (const km of [60, 75, 90, 100, 115, 130, 150]) {
    const zone = landWithin([box(20, 47, 25, 50), box(25, 47, 31, 50)], [25, 47, 25, 48, 25, 48, 25, 49, 25, 49, 25, 50], km, R);
    let far = 0;
    for (const p of zone.polygons) for (const r of p) for (const [x, y] of r) if (y > 47.05 && y < 49.95 && x > 20.05 && x < 30.95) far = Math.max(far, Math.abs(x - 25) * KM_PER_DEG * Math.cos((y * Math.PI) / 180));
    assert.ok(far > km * 0.9 && far < km * 1.08, `out to ${km} km and no farther (${far.toFixed(1)} km)`);
  }
});

test('travel through the land goes round what is not the land: an arm reached along itself, not across the gap', () => {
  // A U: two arms joined in the south; the border at the end of the west arm. The east arm lies 1° across a gap
  // from the west arm, but is reached only round the bottom of the U, far beyond 3° of travel.
  const u = [[[0, 0], [1, 0], [1, 9], [2, 9], [2, 0], [3, 0], [3, 10], [0, 10]].map(([x, y]) => [x, -y]) as Array<[number, number]>];
  const r = landWithin(u, [0, 0, 1, 0], 3 * KM_PER_DEG, R);
  assert.equal(r.problem, null);
  // Down the west arm about 3°; the east arm, a degree across the gap, not reached.
  const reached = (x: number, y: number) => r.polygons.some((p) => { let inside = false; for (const ring of p) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [x0, y0] = ring[j], [x1, y1] = ring[i]; if ((y0 > y) !== (y1 > y) && x < x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)) inside = !inside; } return inside; });
  assert.ok(reached(0.5, -2.5), 'down its own arm');
  assert.ok(!reached(0.5, -4), 'no farther than the distance');
  assert.ok(!reached(2.5, -2), 'not the other arm across the gap');
});

test('outlines and holes from rings read by the even-odd rule; a ring cut to a box', () => {
  const outer = [...box(0, 0, 10, 10), [0, 0]] as Array<[number, number]>, hole = [...box(2, 2, 8, 8), [2, 2]] as Array<[number, number]>, island = [...box(4, 4, 6, 6), [4, 4]] as Array<[number, number]>, apart = [...box(20, 0, 22, 2), [20, 0]] as Array<[number, number]>;
  const polys = polygonsOf([hole, apart, island, outer]);
  assert.equal(polys.length, 3);
  const withHole = polys.find((p) => p.length === 2)!;
  assert.ok(withHole && withHole[0] === outer && withHole[1] === hole, 'the square with its hole');
  assert.ok(polys.some((p) => p.length === 1 && p[0] === island) && polys.some((p) => p.length === 1 && p[0] === apart), 'the island in the hole and the square apart, each on its own');
  const cut = clipRing(box(-5, -5, 5, 5), [0, 0, 10, 10]);
  const xs = cut.map(([x]) => x), ys = cut.map(([, y]) => y);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 5, 0, 5]);
  assert.equal(clipRing(box(20, 20, 30, 30), [0, 0, 10, 10]).length, 0);
});

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Reach').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const country = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result;
  const A = country('Aldmark'), B = country('Bergholt'), C = country('Corvia');
  const start = (owner: string, pts: Array<[number, number]>) => cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts), value: owner, snap: 1e-9, mode: { kind: 'correct', t: NEG_INF } });
  start(A, box(-10, -10, 10, 10));
  start(B, box(10, -10, 30, 10));
  start(C, box(-10, 12, 30, 20));
  const ownerAt = (lon: number, lat: number, t = Y(1900)) => { const arr = world.arrangement(space); return cmd.ownerReader(arr, engine.partitionState(space, layer, t))(arr.locate(lonLatToVec(lon, lat))); };
  const reader = (t = Y(1900)) => cmd.ownerReader(world.arrangement(space), engine.partitionState(space, layer, t));
  return { world, engine, space, layer, A, B, C, ownerAt, reader };
}

test('an advance takes the neighbour\'s land within the distance of their border, only theirs; undone in one step', () => {
  const { world, engine, space, layer, A, B, C, ownerAt, reader } = setup();
  const arr = world.arrangement(space), of = reader();
  // The border between the two: along 10° east, 20° long.
  const line = sharedBorder(arr, of, A, B);
  let len = 0;
  for (let q = 0; q + 3 < line.length; q += 4) { assert.ok(Math.abs(line[q] - 10) < 1e-6 && Math.abs(line[q + 2] - 10) < 1e-6); len += Math.abs(line[q + 3] - line[q + 1]); }
  assert.ok(Math.abs(len - 20) < 1e-6, `the whole border (${len}°)`);
  assert.equal(sharedBorder(arr, of, A, C).length, 0, 'none with a country across the water');
  // Aldmark advances 300 km into Bergholt from 1900.
  const r = landWithin(landRings(arr, of, new Set([B])), line, 300, R);
  assert.equal(r.problem, null);
  const res = cmd.giveLand(world, engine, { spaceId: space, layerId: layer, polygons: r.polygons, value: A, onlyFrom: [B], mode: { kind: 'change', t: Y(1900) }, label: 'Aldmark advances 300 km into Bergholt' });
  assert.equal(res.label, 'Aldmark advances 300 km into Bergholt');
  const deep = 300 / KM_PER_DEG;
  assert.equal(ownerAt(10 + deep * 0.5, 0), A, 'half way in: taken');
  assert.equal(ownerAt(10 + deep * 1.5, 0), B, 'beyond the distance: still theirs');
  assert.equal(ownerAt(10 + deep * 0.5, 0, Y(1800)), B, 'theirs before the date');
  assert.equal(ownerAt(0, 0), A); assert.equal(ownerAt(5, 15), C);
  // Undone: as before.
  world.applyDiffs(invertDiffs(res.diffs));
  assert.equal(ownerAt(10 + deep * 0.5, 0), B);
});

test('a buffer zone either side of a border to nobody; land outlined that belongs to another is left alone; refusals', () => {
  const { world, engine, space, layer, A, B, C, ownerAt, reader } = setup();
  const arr = world.arrangement(space), of = reader();
  // The border found from a click beside it; the land either side within 200 km of it, to nobody.
  assert.deepEqual(new Set(borderNear(arr, of, 10.2, 0, 1)), new Set([A, B]));
  assert.equal(borderNear(arr, of, 0, 0, 1), null, 'no border near the middle of a country');
  const zone = landWithin(landRings(arr, of, new Set([A, B])), sharedBorder(arr, of, A, B), 200, R);
  const res = cmd.giveLand(world, engine, { spaceId: space, layerId: layer, polygons: zone.polygons, value: null, onlyFrom: [A, B], mode: { kind: 'change', t: Y(1900) }, label: 'A buffer zone along the border of Aldmark and Bergholt' });
  const d = 200 / KM_PER_DEG;
  assert.equal(ownerAt(10 - d / 2, 0), null, 'Aldmark\'s side: nobody\'s');
  assert.equal(ownerAt(10 + d / 2, 0), null, 'Bergholt\'s side: nobody\'s');
  assert.equal(ownerAt(10 - 2 * d, 0), A); assert.equal(ownerAt(10 + 2 * d, 0), B);
  world.applyDiffs(invertDiffs(res.diffs));
  // An outline over two countries' land takes only from those named.
  const both: LonLatPolygon[] = [[box(5, 5, 15, 16)]];
  cmd.giveLand(world, engine, { spaceId: space, layerId: layer, polygons: both, value: A, onlyFrom: [B], mode: { kind: 'change', t: Y(1900) }, label: 'Aldmark takes from Bergholt' });
  assert.equal(ownerAt(12, 8), A, 'Bergholt\'s land taken');
  assert.equal(ownerAt(12, 14), C, 'Corvia\'s land left as it was');
  // Refused: nothing to give; nobody to take from; a country from itself.
  assert.throws(() => cmd.giveLand(world, engine, { spaceId: space, layerId: layer, polygons: [], value: A, onlyFrom: [B], mode: { kind: 'change', t: Y(1900) }, label: 'x' }), /no land to give/);
  assert.throws(() => cmd.giveLand(world, engine, { spaceId: space, layerId: layer, polygons: both, value: A, onlyFrom: [], mode: { kind: 'change', t: Y(1900) }, label: 'x' }), /whose land/);
  assert.throws(() => cmd.giveLand(world, engine, { spaceId: space, layerId: layer, polygons: both, value: A, onlyFrom: [A], mode: { kind: 'change', t: Y(1900) }, label: 'x' }), /from itself/);
});

test('zones of control: the land divided where two cities are equally near by travel; slower ground moves the line toward the city beyond it', () => {
  const land = [box(0, 0, 20, 10)], cities: Array<[number, number]> = [[5, 5], [15, 5]];
  const zones = zonesOf(land, cities)!;
  assert.equal(zones.length, 2);
  const at = zoneFinder(zones);
  assert.deepEqual([at(3, 5), at(9.5, 5), at(10.5, 5), at(17, 5), at(1, 9), at(19, 1)], [0, 0, 1, 1, 0, 1], 'split along 10° east');
  // Three times slower east of 8°: from the west city, 3° and then the slow ground; the line moves to 11° east.
  const slowed = zoneFinder(zonesOf(land, cities, (lon) => (lon > 8 ? 3 : 1))!);
  assert.deepEqual([slowed(10.5, 5), slowed(11.5, 5)], [0, 1], 'the line at about 11° east');
  // Round the land, not across what is not it: in a U, the city at the end of one arm holds its whole arm.
  const u = [[[0, 0], [1, 0], [1, 9], [2, 9], [2, 0], [3, 0], [3, 10], [0, 10]].map(([x, y]) => [x, -y]) as Array<[number, number]>];
  const inU = zoneFinder(zonesOf(u, [[0.5, -0.5], [2.5, -0.5]])!);
  assert.deepEqual([inU(0.5, -3), inU(2.5, -3), inU(0.6, -9.5), inU(2.4, -9.5)], [0, 1, 0, 1], 'each arm to the city at its end');
  // Fewer than two places, or too many: none.
  assert.equal(zonesOf(land, [[5, 5]]), null);
});

test('a country\'s land divided among zones: each parcel to the zone it lies in, none left over; a zone kept; new countries named; undone in one step; refusals', () => {
  const { world, engine, space, layer, A, ownerAt } = setup();
  const arr = world.arrangement(space);
  const of = cmd.ownerReader(arr, engine.partitionState(space, layer, Y(1900)));
  // Aldmark (20° by 20°) among three cities: its west kept, its north-east and south-east new countries.
  const zones = zonesOf(landRings(arr, of, new Set([A])), [[-5, 0], [5, 5], [5, -5]])!;
  const res = cmd.divideLand(world, engine, { spaceId: space, layerId: layer, from: A, zones: [{ owner: A, polygons: zones[0] }, { owner: { name: 'Nordhafen' }, polygons: zones[1] }, { owner: { name: 'Suderburg' }, polygons: zones[2] }], mode: { kind: 'change', t: Y(1900) }, label: 'Aldmark divided among its cities' });
  assert.equal(res.label, 'Aldmark divided among its cities');
  const name = (lon: number, lat: number, t = Y(1950)) => { const id = ownerAt(lon, lat, t); return id ? world.get('entity', id)!.name : null; };
  assert.deepEqual([name(-8, 0), name(8, 8), name(8, -8), name(1, 0.2) !== null], ['Aldmark', 'Nordhafen', 'Suderburg', true]);
  assert.equal(name(8, 8, Y(1800)), 'Aldmark', 'as it was before the date');
  assert.deepEqual(res.result.entities.map((id) => world.get('entity', id)!.name).sort(), ['Nordhafen', 'Suderburg']);
  // Every place of the land to one of the three; none left to nobody, nothing of Bergholt's taken.
  const held = new Set<string | null>();
  for (let x = -9.5; x < 10; x += 1) for (let y = -9.5; y < 10; y += 1) held.add(name(x, y));
  assert.deepEqual([...held].sort(), ['Aldmark', 'Nordhafen', 'Suderburg']);
  assert.equal(name(15, 0), 'Bergholt');
  world.applyDiffs(invertDiffs(res.diffs));
  assert.equal(name(8, 8), 'Aldmark', 'undone');
  assert.equal(world.all('entity').some((e) => e.name === 'Nordhafen'), false, 'the new countries undone too');
  // Refused: one zone; a locked country.
  assert.throws(() => cmd.divideLand(world, engine, { spaceId: space, layerId: layer, from: A, zones: [{ owner: A, polygons: zones[0] }], mode: { kind: 'change', t: Y(1900) }, label: 'x' }), /two places at least/);
  cmd.setLocked(world, [A], true);
  assert.throws(() => cmd.divideLand(world, engine, { spaceId: space, layerId: layer, from: A, zones: [{ owner: A, polygons: zones[0] }, { owner: { name: 'X' }, polygons: zones[1] }], mode: { kind: 'change', t: Y(1900) }, label: 'x' }), /locked/);
});
