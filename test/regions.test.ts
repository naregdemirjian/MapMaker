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
