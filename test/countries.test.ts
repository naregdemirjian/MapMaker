// Adding today's countries (Natural Earth 1:50m): shapes with holes, across 180°, many at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { decodeCountries, COUNTRY_GROUP_COLORS, type CountriesFile } from '../src/domain/countries.ts';
import { NEG_INF, gregorian } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs } from '../src/world-model/schema.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = decodeCountries(JSON.parse(readFileSync(join(root, 'data', 'natural-earth', 'countries-50m.json'), 'utf8')) as CountriesFile);

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Countries').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const owner = (lon: number, lat: number, t = NEG_INF) => { const id = engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), t); return id ? world.get('entity', id)?.name ?? id : null; };
  return { world, space, layer, engine, owner };
}
const pick = (...names: string[]) => names.map((n) => { const c = all.find((x) => x.name === n); assert.ok(c, n); return { name: c.name, polygons: c.polygons, color: COUNTRY_GROUP_COLORS[c.colorGroup - 1] }; });

test('the countries file: 242 countries, 199 nations, with continents and flags', () => {
  assert.equal(all.length, 242);
  assert.equal(all.filter((c) => c.nation).length, 199);
  const fr = all.find((c) => c.name === 'France')!;
  assert.equal(fr.iso2, 'fr');
  assert.equal(fr.flag, 'fr');
  assert.equal(fr.continent, 'Europe');
  assert.ok(fr.polygons.length > 3, 'France has overseas parts');
});

test('adding countries: holes (Lesotho in South Africa), overseas parts, across 180°; one undo step', () => {
  const s = setup();
  const r = cmd.addCountries(s.world, s.engine, { spaceId: s.space, layerId: s.layer, countries: pick('South Africa', 'Lesotho', 'France', 'Russia', 'United States of America', 'Fiji'), mode: { kind: 'correct', t: NEG_INF } });
  assert.equal(r.result.entities.length, 6);
  assert.equal(s.owner(28.0, -26.2), 'South Africa', 'Johannesburg');
  assert.equal(s.owner(27.5, -29.4), 'Lesotho', 'Maseru: the hole in South Africa');
  assert.equal(s.owner(2.35, 48.86), 'France', 'Paris');
  assert.equal(s.owner(-52.3, 4.9), 'France', 'Cayenne, French Guiana');
  assert.equal(s.owner(37.6, 55.75), 'Russia', 'Moscow');
  assert.equal(s.owner(-175, 66), 'Russia', 'Chukotka, east of 180°');
  assert.equal(s.owner(-150, 64), 'United States of America', 'Alaska');
  assert.equal(s.owner(178.4, -18.1), 'Fiji', 'Suva');
  assert.equal(s.owner(-30, 30), null, 'the Atlantic stays empty');
  assert.deepEqual(s.world.arrangement(s.space).validate(), []);
  // An existing country of the same name is used, not duplicated.
  const again = cmd.addCountries(s.world, s.engine, { spaceId: s.space, layerId: s.layer, countries: pick('France'), mode: { kind: 'correct', t: NEG_INF } });
  assert.equal(again.result.entities[0], r.result.entities[2]);
  assert.equal(s.world.all('entity').filter((e) => e.name === 'France').length, 1);
  // Undo removes everything in one step.
  s.world.applyDiffs(invertDiffs(again.diffs));
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(s.owner(2.35, 48.86), null);
  assert.ok(!s.world.all('entity').some((e) => e.name === 'France'));
});

test('adding all 242 countries at once, as an event: a valid map, right owners before and after', () => {
  const s = setup();
  const ev = cmd.createEvent(s.world, { name: 'Present-day borders', start: gregorian.fromCivil({ year: 2026 }) }).result;
  const t0 = performance.now();
  cmd.addCountries(s.world, s.engine, { spaceId: s.space, layerId: s.layer, countries: all.map((c) => ({ name: c.name, polygons: c.polygons })), mode: { kind: 'new', eventId: ev } });
  const seconds = (performance.now() - t0) / 1000;
  assert.ok(seconds < 60, `took ${seconds.toFixed(1)} s`);
  const after = gregorian.fromCivil({ year: 2027 });
  for (const [name, lon, lat] of [['Brazil', -47.9, -15.8], ['India', 77.2, 28.6], ['Japan', 139.7, 35.7], ['Egypt', 31.2, 30.0], ['Australia', 133.9, -23.7], ['Lesotho', 27.5, -29.4], ['Vatican City', 12.434, 41.902]] as const) {
    assert.equal(s.owner(lon, lat, after), name, `${name} in 2027`);
  }
  assert.equal(s.owner(2.35, 48.86, gregorian.fromCivil({ year: 2000 })), null, 'nothing before the event');
  assert.deepEqual(s.world.arrangement(s.space).validate(), []);
  assert.equal(s.world.all('entity').filter((e) => e.type_id === 'polity').length, 242);
});
