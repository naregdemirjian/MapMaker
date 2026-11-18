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
