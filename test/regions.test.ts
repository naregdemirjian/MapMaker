// The region picker's data and lookups (Stage 2, D78): states and provinces of today (Natural Earth
// admin-1), found by a point (holes respected: Berlin inside Brandenburg); neighbouring regions share
// their border point for point, so giving them to owners leaves no gap or overlap between them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geoArea } from 'd3-geo';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { decodeRegions, RegionIndex, countriesAsRegions, type RegionsFile } from '../src/domain/regions.ts';
import { decodeCountries, type CountriesFile } from '../src/domain/countries.ts';

const regions = decodeRegions(JSON.parse(readFileSync(new URL('../data/natural-earth/regions-10m.json', import.meta.url), 'utf8')) as RegionsFile);
const index = new RegionIndex(regions);
const named = (name: string, country: string) => regions.findIndex((r) => r.name === name && r.country === country);

test('regions of today: thousands of them, found by a point; enclaves are holes of the region around them', () => {
  assert.ok(regions.length > 4000, `${regions.length} regions`);
  const berlin = named('Berlin', 'Germany'), brandenburg = named('Brandenburg', 'Germany');
  assert.ok(berlin >= 0 && brandenburg >= 0);
  assert.equal(index.at(13.40, 52.52), berlin);
  assert.equal(index.at(13.06, 52.40), brandenburg, 'Potsdam');
  assert.equal(regions[index.at(2.35, 48.86)!].country, 'France');
  assert.equal(regions[index.at(-74.0, 40.75)!].name, 'New York');
  assert.equal(index.at(-30, -40), null, 'the South Atlantic');
  assert.equal(regions[index.at(179.5, -16.5)!].country, 'Fiji', 'near the 180th meridian');
  // Each region's anchor lies inside it.
  for (const i of [berlin, brandenburg, named('Hawaii', 'United States of America')]) assert.equal(index.at(...index.anchors[i]), i, regions[i].name);
  // Today's countries can be picked the same way.
  const countries = countriesAsRegions(decodeCountries(JSON.parse(readFileSync(new URL('../data/natural-earth/countries-50m.json', import.meta.url), 'utf8')) as CountriesFile));
  const ci = new RegionIndex(countries);
  assert.equal(countries[ci.at(2.35, 48.86)!].name, 'France');
});

test('neighbouring regions given to two owners meet exactly: no gap, no overlap', () => {
  const world = new World();
  const space = cmd.seedProject(world, 'Regions').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const A = cmd.createEntity(world, { type_id: 'polity', name: 'Mark' }).result;
  const berlin = regions[named('Berlin', 'Germany')], brandenburg = regions[named('Brandenburg', 'Germany')];
  const give = (r: typeof berlin, into: cmd.NewOwner) => cmd.addCountries(world, engine, { spaceId: space, layerId: layer, countries: [{ name: r.name, polygons: r.polygons }], into, mode: { kind: 'correct', t: NEG_INF } });
  give(brandenburg, A);
  const made = give(berlin, { name: 'Free City' });
  const B = made.result.entities[0];
  assert.equal(world.get('entity', B)!.name, 'Free City', 'a new country made in the same step');
  const t = gregorian.fromCivil({ year: 2000 });
  const at = (lon: number, lat: number) => engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), t);
  assert.equal(at(13.40, 52.52), B);
  assert.equal(at(13.06, 52.40), A);
  // Areas: the two owners together cover Brandenburg's outline (Berlin's hole included), and Berlin is Berlin.
  const arr = world.arrangement(space);
  const area = (o: string) => { let s = 0; for (const [f, st] of engine.partitionState(space, layer, t)) if (st.value === o) s += arr.faceArea(f); return s; };
  const d3 = (rings: Array<Array<[number, number]>>) => { const a = geoArea({ type: 'Polygon', coordinates: rings.map((r) => [...r, r[0]]) }); return a > 2 * Math.PI ? 4 * Math.PI - a : a; };
  const outer = brandenburg.polygons.reduce((s, p) => s + d3([p[0]]), 0);
  const city = berlin.polygons.reduce((s, p) => s + d3([p[0]]), 0);
  assert.ok(Math.abs(area(A) + area(B) - outer) / outer < 0.002, `together ${area(A) + area(B)} sr, outline ${outer}`);
  assert.ok(Math.abs(area(B) - city) / city < 0.002, `Berlin ${area(B)} sr, ${city} in the data`);
  // Along the shared border, every sample is held by one or the other (no unowned sliver).
  const ring = berlin.polygons[0][0];
  for (let i = 0; i < ring.length; i += 7) {
    const [x, y] = ring[i];
    for (const [dx, dy] of [[0.004, 0], [-0.004, 0], [0, 0.004], [0, -0.004]]) {
      const o = at(x + dx, y + dy);
      assert.ok(o === A || o === B, `near ${x},${y}: ${o}`);
    }
  }
});

// D177: provinces given from a country whose outline is another dataset's (Natural Earth's 1:50m countries
// against its 1:10m provinces), in one change.
const countries = decodeCountries(JSON.parse(readFileSync(new URL('../data/natural-earth/countries-50m.json', import.meta.url), 'utf8')) as CountriesFile);
const shapeOf = (n: string) => { const c = countries.find((x) => x.name === n)!; return { name: c.name, polygons: c.polygons }; };
const provinces = (country: string, names: string[]) => regions.filter((r) => r.country === country && names.includes(r.name)).map((r) => ({ name: r.name, polygons: r.polygons }));
function setUp(owned: string[]) {
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'T').result;
  const layerId = world.all('layer').find((l) => l.kind === 'partition')!.id;
  const A = cmd.createEntity(world, { type_id: 'polity', name: 'A', color: '#33f' }).result;
  const B = cmd.createEntity(world, { type_id: 'polity', name: 'B', color: '#fc3' }).result;
  cmd.addCountries(world, new Engine(world), { spaceId, layerId, countries: owned.map(shapeOf), mode: { kind: 'correct', t: NEG_INF }, into: A });
  const ev = cmd.createEvent(world, { name: 'Change', start: gregorian.fromCivil({ year: 1260 }), end: gregorian.fromCivil({ year: 1261 }), type_id: 'general', description: '', precision: 'day' }).result;
  return { world, spaceId, layerId, A, B, ev };
}

test('provinces running onto a country\'s frontier keep the country\'s history: none of them is taken for land carved out of the rest of the world (D177)', () => {
  const { world, spaceId, layerId, A, B, ev } = setUp(['Kazakhstan']);
  cmd.addCountries(world, new Engine(world), { spaceId, layerId, countries: provinces('Kazakhstan', ['Aqmola', 'Astana', 'Pavlodar']), mode: { kind: 'new', eventId: ev, at: null }, into: B, onlyFrom: [A] });
  const engine = new Engine(world);
  const at = (lon: number, lat: number, y: number) => engine.valueAtPoint(spaceId, layerId, lonLatToVec(lon, lat), gregorian.fromCivil({ year: y }));
  assert.equal(at(71.43, 51.13, 1250), A, 'Astana held by A before the change');
  assert.equal(at(69.5, 52.0, 1250), A, 'Aqmola too');
  assert.equal(at(71.43, 51.13, 1262), B, 'and given to B by it');
  assert.equal(at(76.9, 52.3, 1262), B, 'Pavlodar');
  assert.equal(at(73.1, 49.8, 1262), A, 'Qaraghandy, not in the change, still A');
});

test('a province never takes land beyond its outline, even where the outlines of two datasets disagree round it (D177)', () => {
  const { world, spaceId, layerId, A, B, ev } = setUp(['Uzbekistan', 'Turkmenistan', 'Afghanistan', 'Kazakhstan', 'Tajikistan']);
  cmd.addCountries(world, new Engine(world), { spaceId, layerId, countries: [...provinces('Uzbekistan', ['Karakalpakstan', 'Khorezm']), ...provinces('Turkmenistan', ['Tashauz']), ...provinces('Kazakhstan', ['West Kazakhstan', 'Atyrau', 'Aqtöbe', 'Mangghystau', 'Qostanay', 'Aqmola', 'Astana', 'North Kazakhstan', 'Pavlodar', 'Qaraghandy'])], mode: { kind: 'new', eventId: ev, at: null }, into: B, onlyFrom: [A] });
  const engine = new Engine(world);
  const at = (lon: number, lat: number) => engine.valueAtPoint(spaceId, layerId, lonLatToVec(lon, lat), gregorian.fromCivil({ year: 1262 }));
  assert.equal(at(59.6, 42.46), B, 'Nukus, in Karakalpakstan');
  assert.equal(at(71.43, 51.13), B, 'Astana');
  for (const [name, lon, lat] of [['Samarkand', 66.96, 39.65], ['Merv', 61.84, 37.66], ['Herat', 62.2, 34.35], ['Almaty', 76.9, 43.25]] as Array<[string, number, number]>) assert.equal(at(lon, lat), A, `${name} stays A`);
});
