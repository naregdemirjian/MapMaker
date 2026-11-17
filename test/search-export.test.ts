// Search (names, former names, notes, descriptions) and data export (GeoJSON of the map at a date,
// CSV of the record), Stage 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoArea, geoContains } from 'd3-geo';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { search, fold } from '../src/domain/search.ts';
import { mapGeoJSON, eventsCSV, entitiesCSV, relationsCSV, featuresCSV, ringsToPolygons, isoDate, csv } from '../src/domain/data-export.ts';
import { ring, square } from './helpers.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Search').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Kingdom of Zürich', notes: 'Founded by the river folk after the great flood.' }).result;
  const b = cmd.createEntity(world, { type_id: 'polity', name: 'Duchy of Proba' }).result;
  const city = cmd.createEntity(world, { type_id: 'settlement', name: 'Byzantium' }).result;
  cmd.renameFrom(world, { entity: city, name: 'Constantinople', mode: { kind: 'change', t: Y(330) } });
  // (From a date on, without an event: 'change'; the starting map: 'correct' at the beginning of time.)
  const paint = (owner: string, pts: Array<[number, number]>, t = NEG_INF) => cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts), value: owner, snap: 1e-9, mode: t.day === -Infinity ? { kind: 'correct', t } : { kind: 'change', t } });
  return { world, space, layer, engine, a, b, city, paint };
}

test('search: names first, then former names, then notes and descriptions; accents and case ignored', () => {
  const s = setup();
  cmd.createEvent(s.world, { name: 'The Great Flood', start: Y(1200), description: 'Waters rose over Zurich and the lowlands.' });
  const zones = cmd.createLayer(s.world, s.space, 'Claims', 'area').result;
  cmd.createFeature(s.world, { layerId: zones, name: 'Zurich claim', parts: [square(8, 47, 1)], mode: { kind: 'correct', t: NEG_INF } });
  cmd.relate(s.world, { kind: 'war', a: s.a, b: s.b, mode: { kind: 'change', t: Y(1300) } });
  const r = search(s.world, s.engine, 'zurich');
  assert.deepEqual(r.map((x) => [x.kind, x.title]).slice(0, 4), [['feature', 'Zurich claim'], ['entity', 'Kingdom of Zürich'], ['relation', 'Kingdom of Zürich is at war with Duchy of Proba'], ['event', 'The Great Flood']]);
  assert.match(r.find((x) => x.kind === 'event')!.context, /Waters rose over Zurich/);
  // A former name finds the city under its present one; the reason is given.
  const c = search(s.world, s.engine, 'constantinople')[0];
  assert.deepEqual([c.kind, c.title], ['entity', 'Byzantium']);
  // (Byzantium is renamed Constantinople from 330: the row keeps its first name.)
  assert.match(c.context, /also called Constantinople/);
  // Notes.
  assert.equal(search(s.world, s.engine, 'river folk')[0].title, 'Kingdom of Zürich');
  assert.deepEqual(search(s.world, s.engine, '   '), []);
  assert.equal(fold('ÉÇÅ Zürich'), 'eca zurich');
});

test('GeoJSON of the map at a date: owners joined into polygons with holes, as large as their land; features and cities', () => {
  const s = setup();
  // A's land with B's enclave inside it (a hole in A, an island of B), from 1500.
  s.paint(s.a, square(10, 45, 6), Y(1500));
  s.paint(s.b, square(10, 45, 2), Y(1500));
  // A second piece of A, apart.
  s.paint(s.a, square(40, 10, 3), Y(1500));
  const lines = cmd.createLayer(s.world, s.space, 'Fronts', 'line').result;
  cmd.createFeature(s.world, { layerId: lines, name: 'Front', parts: [[[0, 40], [5, 41], [10, 40]]], mode: { kind: 'change', t: Y(1600) } });
  cmd.placeCharacter(s.world, { spaceId: s.space, entity: s.city, lon: 28.97, lat: 41.01, mode: { kind: 'correct', t: NEG_INF } });
  const before = mapGeoJSON(s.world, s.engine, s.space, Y(1400));
  assert.equal(before.features.filter((f) => f.properties.kind === 'territory').length, 0, 'no territory yet in 1400');
  const gj = mapGeoJSON(s.world, s.engine, s.space, Y(1700));
  assert.equal(gj.properties.date, '1700-01-01');
  const terr = gj.features.filter((f) => f.properties.kind === 'territory');
  const A = terr.find((f) => f.properties.id === s.a)!, B = terr.find((f) => f.properties.id === s.b)!;
  assert.equal(A.geometry!.type, 'MultiPolygon', 'two pieces');
  const aPolys = A.geometry!.coordinates as number[][][][];
  assert.equal(aPolys.length, 2);
  assert.ok(aPolys.some((p) => p.length === 2), 'one of them has a hole (the enclave)');
  assert.equal(B.geometry!.type, 'Polygon');
  // Each ring is closed; the areas (d3, from the GeoJSON alone) match the engine's land.
  for (const f of terr) for (const poly of (f.geometry!.type === 'Polygon' ? [f.geometry!.coordinates] : f.geometry!.coordinates) as number[][][][]) for (const r of poly) assert.deepEqual(r[0], r[r.length - 1]);
  // (The GeoJSON follows RFC 7946: outer rings anticlockwise. d3 measures on the sphere with the
  // opposite winding, so its rings are reversed for d3.)
  const forD3 = (f: (typeof terr)[number]) => {
    const polys = (f.geometry!.type === 'Polygon' ? [f.geometry!.coordinates] : f.geometry!.coordinates) as number[][][][];
    return { type: 'MultiPolygon', coordinates: polys.map((p) => p.map((r) => [...r].reverse())) };
  };
  const arr = s.world.arrangement(s.space);
  const landOf = (owner: string) => { let sr = 0; for (const [face, st] of s.engine.partitionState(s.space, s.layer, Y(1700))) if (st.value === owner) sr += arr.faceArea(face); return sr; };
  for (const [f, owner] of [[A, s.a], [B, s.b]] as const) {
    const area = geoArea(forD3(f) as never);
    assert.ok(Math.abs(area - landOf(owner)) / landOf(owner) < 0.01, `${f.properties.name}: ${area} sr from the GeoJSON, ${landOf(owner)} in the map`);
  }
  assert.ok(geoContains(forD3(A) as never, [7, 45]) && !geoContains(forD3(A) as never, [10, 45]), 'the enclave is not A\'s');
  assert.ok(geoContains(forD3(B) as never, [10, 45]));
  const front = gj.features.find((f) => f.properties.name === 'Front')!;
  assert.deepEqual(front.geometry, { type: 'LineString', coordinates: [[0, 40], [5, 41], [10, 40]] });
  assert.equal(front.properties.since, '1600-01-01');
  const city = gj.features.find((f) => f.properties.kind === 'city')!;
  assert.equal(city.properties.name, 'Constantinople', 'named as it is at the date');
  assert.deepEqual(city.geometry!.coordinates, [28.97, 41.01]);
  // It is plain JSON (what is written to the file).
  assert.equal(JSON.parse(JSON.stringify(gj)).features.length, gj.features.length);
});

test('rings to polygons: nesting, the right-hand rule, closed rings', () => {
  const outer: Array<[number, number]> = [[0, 0], [0, 10], [10, 10], [10, 0]]; // clockwise as given
  const hole: Array<[number, number]> = [[2, 2], [8, 2], [8, 8], [2, 8]];
  const island: Array<[number, number]> = [[4, 4], [4, 6], [6, 6], [6, 4]];
  const polys = ringsToPolygons([island, hole, outer]);
  assert.equal(polys.length, 2, 'the outer ring with its hole, and the island in the hole');
  const area2 = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a; };
  assert.ok(area2(polys[0][0]) > 0 && area2(polys[0][1]) < 0, 'outer anticlockwise, hole clockwise');
  assert.deepEqual(polys[0][0][0], polys[0][0][polys[0][0].length - 1]);
});

test('CSV: events, entities with their other names, relationships by period, feature steps; dates sortable; cells quoted and defused', () => {
  const s = setup();
  const g = cmd.createEventGroup(s.world, 'Wars').result;
  const ev = cmd.createEvent(s.world, { name: 'War of the "Two" Rivers', start: Y(1700, 3, 1), end: Y(1702), description: 'Long, bloody,\nand pointless.', groups: [g] }).result;
  cmd.relate(s.world, { kind: 'war', a: s.a, b: s.b, mode: { kind: 'new', eventId: ev }, until: Y(1702) });
  const e = eventsCSV(s.world);
  assert.match(e, /^id,name,type,start,end,groups,alternative_of,active,description\r\n/);
  assert.ok(e.includes('"War of the ""Two"" Rivers"'), 'quotes doubled');
  assert.ok(e.includes(',1700-03-01,1702-01-01,Wars,'), 'dates a spreadsheet sorts');
  assert.ok(e.includes('"Long, bloody,\nand pointless."'), 'line breaks kept inside quotes');
  const ents = entitiesCSV(s.world, s.engine);
  assert.ok(ents.includes('Constantinople (from 0330-01-01)'), ents);
  const rel = relationsCSV(s.world, s.engine);
  assert.ok(rel.includes(',war,Kingdom of Zürich,is at war with,Duchy of Proba,1700-03-01,1702-01-01,'), rel);
  const zones = cmd.createLayer(s.world, s.space, 'Battles', 'point').result;
  const f = cmd.createFeature(s.world, { layerId: zones, name: 'Ford', parts: [[[1, 1]]], mode: { kind: 'change', t: Y(1701) } }).result;
  cmd.endFeature(s.world, s.engine, { feature: f, mode: { kind: 'change', t: Y(1702) } });
  const fc = featuresCSV(s.world, s.engine);
  assert.ok(fc.includes(',Ford,Battles,point,,1701-01-01,shape,,') && fc.includes(',Ford,Battles,point,,1702-01-01,ends,,'), fc);
  assert.equal(csv([['=HYPERLINK("x")', '-12', '+cmd']]), `"'=HYPERLINK(""x"")",-12,'+cmd\r\n`, 'formula-like text is defused, numbers are not');
  assert.equal(isoDate(Y(-43, 3, 15)), '-0043-03-15');
  assert.equal(isoDate(NEG_INF), 'beginning');
});
