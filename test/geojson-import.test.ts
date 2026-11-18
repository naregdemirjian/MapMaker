// Territories from GeoJSON files at dates (improvement B, D120): reading the files, the names and years they
// give, and maps of several dates becoming the history between them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { readGeoJSON, guessNameKey, countriesOf, yearOfFileName } from '../src/domain/geojson-import.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const box = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const fc = (features: Array<{ props: Record<string, unknown>; rings: number[][][] | number[][][][] ; multi?: boolean }>) => JSON.stringify({
  type: 'FeatureCollection',
  features: features.map((f) => ({ type: 'Feature', properties: f.props, geometry: f.multi ? { type: 'MultiPolygon', coordinates: f.rings } : { type: 'Polygon', coordinates: f.rings } })),
});

test('reading GeoJSON: polygons and pieces, holes, the name property guessed, colours, what is left out', () => {
  const file = readGeoJSON(fc([
    { props: { NAME: 'Westmark', COLOR: '#c0392b', area: 3 }, rings: [box(0, 40, 10, 50), box(2, 42, 4, 44)] },
    { props: { NAME: 'Eastmark' }, rings: [[box(12, 40, 20, 50)], [box(22, 40, 24, 42)]], multi: true },
    { props: { NAME: 'Westmark' }, rings: [box(-5, 30, -1, 34)] },
    { props: { NAME: '' }, rings: [box(30, 0, 31, 1)] },
  ]));
  assert.equal(file.features.length, 4);
  assert.deepEqual(file.keys.sort(), ['COLOR', 'NAME', 'area']);
  assert.equal(guessNameKey(file), 'NAME');
  const { countries, unnamed } = countriesOf(file, 'NAME', 'COLOR');
  assert.equal(unnamed, 1);
  assert.deepEqual(countries.map((c) => [c.name, c.polygons.length, c.color]), [['Westmark', 2, '#c0392b'], ['Eastmark', 2, undefined]]);
  assert.equal(countries[0].polygons[0].length, 2, 'an outline and a hole');
  assert.equal(countries[0].polygons[0][0].length, 4, 'the closing point dropped');
  // Points and lines have no area; a file with none to import is refused.
  const mixed = readGeoJSON(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Town' }, geometry: { type: 'Point', coordinates: [1, 2] } }, { type: 'Feature', properties: { name: 'Land' }, geometry: { type: 'Polygon', coordinates: [box(0, 0, 1, 1)] } }] }));
  assert.equal(mixed.skipped, 1);
  assert.equal(guessNameKey(mixed), 'name');
  assert.throws(() => readGeoJSON('{"type":"FeatureCollection","features":[]}'), /no GeoJSON features/);
  assert.throws(() => readGeoJSON('not json'), /not GeoJSON/);
  assert.throws(() => readGeoJSON(JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } })), /No feature of this file has an area/);
});

test('years from file names, as historical datasets name their maps', () => {
  assert.equal(yearOfFileName('world_1492.geojson'), 1492);
  assert.equal(yearOfFileName('world_bc1000.geojson'), -999, '1000 BC (astronomical year -999)');
  assert.equal(yearOfFileName('europe-1914.json'), 1914);
  assert.equal(yearOfFileName('Rome 44 BC.geojson'), -43);
  assert.equal(yearOfFileName('borders.geojson'), null);
});

test('maps of several dates become the history between them: countries go on by name, land not shown becomes nobody\'s; one undo step each', () => {
  const world = new World();
  const space = cmd.seedProject(world, 'Import').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const owner = (lon: number, lat: number, t: ReturnType<typeof Y>) => {
    const f = world.arrangement(space).locate(lonLatToVec(lon, lat));
    const v = engine.partitionState(space, layer, t).get(f)?.value ?? null;
    return v ? world.get('entity', v)!.name : null;
  };
  const read = (text: string) => countriesOf(readGeoJSON(text), 'NAME').countries;
  // 1500: two kingdoms; the starting map.
  const r1 = cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t: NEG_INF, replace: true, countries: read(fc([{ props: { NAME: 'Westmark' }, rings: [box(0, 40, 10, 50)] }, { props: { NAME: 'Eastmark' }, rings: [box(10, 40, 20, 50)] }])) });
  assert.equal(r1.result.created, 2);
  // 1600: Westmark has taken Eastmark's west half; Eastmark keeps the rest; a new Northmark.
  const r2 = cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t: Y(1600), replace: true, countries: read(fc([{ props: { NAME: 'Westmark' }, rings: [box(0, 40, 15, 50)] }, { props: { NAME: 'Eastmark' }, rings: [box(15, 40, 20, 50)] }, { props: { NAME: 'Northmark' }, rings: [box(0, 55, 10, 60)] }])) });
  assert.equal(r2.result.created, 1, 'Westmark and Eastmark go on');
  // 1700: only Westmark is on the map: Eastmark's land becomes nobody's.
  const r3 = cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t: Y(1700), replace: true, countries: read(fc([{ props: { NAME: 'westmark' }, rings: [box(0, 40, 12, 50)] }])) });
  assert.ok(r3.result.cleared > 0);
  assert.equal(world.all('entity').filter((e) => e.type_id === 'polity').length, 3, 'names matched without regard to case');
  const at = (lon: number, lat: number) => [owner(lon, lat, Y(1550)), owner(lon, lat, Y(1650)), owner(lon, lat, Y(1750))];
  assert.deepEqual(at(5, 45), ['Westmark', 'Westmark', 'Westmark']);
  assert.deepEqual(at(12, 45), ['Eastmark', 'Westmark', 'Westmark']);
  assert.deepEqual(at(17, 45), ['Eastmark', 'Eastmark', null]);
  assert.deepEqual(at(5, 57), [null, 'Northmark', null]);
  // Each map one undo step.
  world.applyDiffs(invertDiffs(r3.diffs));
  assert.deepEqual(at(17, 45), ['Eastmark', 'Eastmark', 'Eastmark']);
  assert.throws(() => cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t: Y(1800), replace: true, countries: [] }), /no countries/);
});

test('the same borders drawn again a few kilometres apart follow those already on the map: no slivers; countries joined; a shape that cannot be joined left out and named', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { decodeCountries } = await import('../src/domain/countries.ts');
  const all = decodeCountries(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'natural-earth', 'countries-50m.json'), 'utf8')));
  // (With atolls of the Pacific: small rings whose points, followed one by one, could fall out of order.)
  const names = ['France', 'Spain', 'Andorra', 'Belgium', 'Luxembourg', 'Germany', 'Switzerland', 'Italy', 'Austria', 'Liechtenstein', 'Kiribati', 'Marshall Islands', 'Tuvalu'];
  const base = names.map((n) => { const c = all.find((x) => x.name === n)!; return { name: n, polygons: c.polygons }; });
  // Every point moved by up to about 2 km, smoothly (neighbours' shared borders move together, as in another dataset).
  const moved = (km: number) => base.map((c) => ({ name: c.name, polygons: c.polygons.map((p) => p.map((r) => r.map(([lon, lat]) => [lon + (km / 111) * Math.sin(lat * 0.9 + lon * 0.4) / Math.cos((lat * Math.PI) / 180), lat + (km / 111) * Math.cos(lon * 0.7 - lat * 0.3)] as [number, number]))) }));
  const run = (matchKm: number) => {
    const world = new World();
    const space = cmd.seedProject(world, 'Again').result.spaceId;
    const layer = world.all('layer')[0].id;
    const engine = new Engine(world);
    const arr = world.arrangement(space);
    cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t: NEG_INF, replace: true, countries: base, matchKm });
    const first = arr.leafFaces().length;
    const second = moved(2);
    const joined = second.filter((c) => c.name === 'Germany' || c.name === 'Austria');
    const map2 = [...second.filter((c) => !joined.includes(c)), { name: 'Greater Germany', polygons: joined.flatMap((c) => c.polygons) }];
    const r = cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t: Y(1850), replace: true, countries: map2, matchKm });
    const owner = (lon: number, lat: number, t: ReturnType<typeof Y>) => { const id = engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), t); return id ? world.get('entity', id)!.name : null; };
    return { first, second: arr.leafFaces().length, r, owner, valid: arr.validate(), world };
  };
  const a = run(3);
  assert.deepEqual(a.valid, []);
  assert.ok(a.second < a.first * 1.15 + 20, `few new parcels (${a.first} then ${a.second})`);
  assert.equal(a.r.result.created, 1, 'only Greater Germany is new');
  assert.deepEqual(a.r.result.skipped, []);
  assert.deepEqual([a.owner(2.35, 48.86, Y(1800)), a.owner(2.35, 48.86, Y(1900))], ['France', 'France'], 'Paris');
  assert.deepEqual([a.owner(13.4, 52.52, Y(1800)), a.owner(13.4, 52.52, Y(1900))], ['Germany', 'Greater Germany'], 'Berlin');
  assert.deepEqual([a.owner(16.37, 48.21, Y(1800)), a.owner(16.37, 48.21, Y(1900))], ['Austria', 'Greater Germany'], 'Vienna');
  assert.equal(a.owner(9.52, 47.14, Y(1900)), 'Liechtenstein', 'a country of a few kilometres keeps its land');
  // No atoll turned inside out: the open sea is nobody's, and each atoll country keeps an island of its own.
  assert.deepEqual([a.owner(-30, 0, Y(1900)), a.owner(160, -30, Y(1900))], [null, null], 'the open sea stays nobody\'s');
  for (const n of ['Kiribati', 'Marshall Islands', 'Tuvalu']) {
    const c = base.find((x) => x.name === n)!;
    const ring = c.polygons.map((p) => p[0]).sort((x, y) => y.length - x.length)[0];
    const [lon, lat] = ring.reduce(([x, y], [u, v]) => [x + u / ring.length, y + v / ring.length], [0, 0]);
    const near = [0, 0.02, -0.02].flatMap((d) => [a.owner(lon + d, lat, Y(1900)), a.owner(lon, lat + d, Y(1900))]);
    assert.ok(near.every((o) => o === null || o === n), `${n}: only itself or the sea around its largest atoll (${near.join(', ')})`);
  }
  // Without following them, each border drawn again leaves slivers between the two.
  const b = run(0);
  assert.ok(b.second > a.second * 3, `slivers without following (${b.second} parcels against ${a.second})`);
  // A shape too small to be an area at all: left out and named; the rest of the file imported.
  const world = new World();
  const space = cmd.seedProject(world, 'Tiny').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const tiny = { name: 'Speck', polygons: [[[[10, 10], [10 + 1e-9, 10], [10, 10 + 1e-9]] as Array<[number, number]>]] };
  const r = cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t: NEG_INF, replace: true, countries: [{ name: 'Westmark', polygons: [[box(0, 40, 10, 50).slice(0, 4) as Array<[number, number]>]] }, tiny] });
  assert.deepEqual(r.result.skipped, ['Speck']);
  assert.equal(engine.valueAtPoint(space, layer, lonLatToVec(5, 45), Y(1900)) !== null, true, 'the rest imported');
});

test('dates as datasets write them: years (BC negative), ISO dates, day.month.year, open ends; the properties holding them guessed', async () => {
  const { dateOfValue, afterDate, guessDateKeys, datedShapesOf } = await import('../src/domain/geojson-import.ts');
  const ymd = (v: unknown) => { const d = dateOfValue(v); if (!d) return d; const c = gregorian.toCivil(d.t); return [c.year, c.month, c.day, d.precision]; };
  assert.deepEqual(ymd(1886), [1886, 1, 1, 'year']);
  assert.deepEqual(ymd(-500), [-499, 1, 1, 'year'], '500 BC');
  assert.deepEqual(ymd('1918-11-12'), [1918, 11, 12, 'day']);
  assert.deepEqual(ymd('1918/11'), [1918, 11, 1, 'month']);
  assert.deepEqual(ymd('12.11.1918'), [1918, 11, 12, 'day']);
  assert.deepEqual(ymd('1990-10-03T00:00:00Z'), [1990, 10, 3, 'day']);
  assert.deepEqual(ymd('44 BC'), [-43, 1, 1, 'year']);
  for (const open of [null, '', 'present', 9999, '9999-12-31']) assert.equal(dateOfValue(open), null, `${open} is open`);
  for (const bad of ['soon', '1918-13-01', 1918.5, {}]) assert.equal(dateOfValue(bad), undefined, `${JSON.stringify(bad)} is not a date`);
  // An end includes its day, month or year: the change comes after it.
  const after = (v: unknown) => { const c = gregorian.toCivil(afterDate(dateOfValue(v)!)); return [c.year, c.month, c.day]; };
  assert.deepEqual(after('1918-11-11'), [1918, 11, 12]);
  assert.deepEqual(after('1918-12'), [1919, 1, 1]);
  assert.deepEqual(after(1918), [1919, 1, 1]);
  const file = readGeoJSON(fc([
    { props: { CNTRY_NAME: 'Westmark', GWSDATE: '1886-01-01', GWEDATE: '1918-11-11' }, rings: [box(0, 40, 10, 50)] },
    { props: { CNTRY_NAME: 'Westmark', GWSDATE: '1918-11-12', GWEDATE: '2019-12-31' }, rings: [box(0, 40, 6, 50)] },
    { props: { CNTRY_NAME: 'Eastmark', GWSDATE: '1918-11-12', GWEDATE: '' }, rings: [box(6, 40, 10, 50)] },
    { props: { CNTRY_NAME: 'Nowhere', GWSDATE: 'soon', GWEDATE: '' }, rings: [box(20, 40, 21, 41)] },
  ]));
  assert.deepEqual(guessDateKeys(file), { from: 'GWSDATE', to: 'GWEDATE' });
  assert.deepEqual(guessDateKeys(readGeoJSON(fc([{ props: { NAME: 'A' }, rings: [box(0, 0, 1, 1)] }]))), { from: null, to: null });
  const d = datedShapesOf(file, 'CNTRY_NAME', 'GWSDATE', 'GWEDATE');
  assert.equal(d.shapes.length, 3);
  assert.equal(d.undated, 1);
  assert.equal(d.shapes[2].to.day, Infinity, 'still there');
});

test('a dataset dating each shape becomes the history: shapes begin and end at their dates, land no shape of the time covers becomes nobody\'s; the earliest as the starting map; one undo step', async () => {
  const { datedShapesOf } = await import('../src/domain/geojson-import.ts');
  const world = new World();
  const space = cmd.seedProject(world, 'Dated').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const owner = (lon: number, lat: number, y: number) => { const id = engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), Y(y)); return id ? world.get('entity', id)!.name : null; };
  const file = readGeoJSON(fc([
    // Westmark whole until 1918, then its east is Eastmark; Northmark from 1950 to 1990 only.
    { props: { name: 'Westmark', from: '1886-01-01', to: '1918-11-11' }, rings: [box(0, 40, 10, 50)] },
    { props: { name: 'Westmark', from: '1918-11-12', to: '' }, rings: [box(0, 40, 6, 50)] },
    { props: { name: 'Eastmark', from: '1918-11-12', to: '' }, rings: [box(6, 40, 10, 50)] },
    { props: { name: 'Northmark', from: 1950, to: 1990 }, rings: [box(0, 55, 10, 60)] },
  ]));
  const { shapes } = datedShapesOf(file, 'name', 'from', 'to');
  const r = cmd.importDatedTerritories(world, engine, { spaceId: space, layerId: layer, shapes, earliestAsStart: true });
  assert.equal(r.result.created, 3);
  assert.equal(r.result.dates, 4, 'the starting map (1886), 12 November 1918, 1950 and the start of 1991');
  assert.deepEqual([owner(8, 45, 1800), owner(8, 45, 1910), owner(8, 45, 1930)], ['Westmark', 'Westmark', 'Eastmark'], 'the starting map holds from the beginning');
  assert.deepEqual([owner(3, 45, 1910), owner(3, 45, 2020)], ['Westmark', 'Westmark']);
  assert.deepEqual([owner(5, 57, 1940), owner(5, 57, 1960), owner(5, 57, 1990), owner(5, 57, 1991)], [null, 'Northmark', 'Northmark', null], 'from 1950 to the end of 1990');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(owner(8, 45, 1930), null, 'one undo step');
  assert.ok(!world.all('entity').some((e) => e.name === 'Westmark'));
});
