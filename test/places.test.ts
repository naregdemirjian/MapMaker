// Today's cities and capitals (D173): Natural Earth's places with their shares, ranks and economic importance;
// the filters a map shows them by; added as cities that remember what they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePlaces, pickPlaces, cityShown, placeMetaOf, cityFilterOf, DEFAULT_CITY_FILTER, type PlacesFile } from '../src/domain/places.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { cityFilterOfSpace } from '../src/world-model/world-settings.ts';
import { NEG_INF } from '../src/core-time/index.ts';

const places = decodePlaces(JSON.parse(readFileSync(new URL('../data/natural-earth/places-10m.json', import.meta.url), 'utf8')) as PlacesFile);
const find = (n: string, c: string) => places.find((p) => p.name === n && p.country === c)!;

test('today\'s places: capitals, shares of their country, ranks and economic centres', () => {
  assert.ok(places.length > 7000);
  const yerevan = find('Yerevan', 'Armenia');
  assert.equal(yerevan.capital, 'national');
  assert.equal(yerevan.rank, 1);
  assert.ok(yerevan.sharePct > 30 && yerevan.sharePct < 45, `a third of Armenians: ${yerevan.sharePct}`);
  assert.equal(yerevan.economic, 2, 'the largest city');
  assert.equal(find('Istanbul', 'Turkey').economic, 3, 'a world city');
  assert.equal(find('Ankara', 'Turkey').capital, 'national');
  assert.equal(find('Gyumri', 'Armenia').capital, 'regional');
  // Each country has one national capital at least, nearly all.
  const withCapital = new Set(places.filter((p) => p.capital === 'national').map((p) => p.country));
  assert.ok(withCapital.size > 190, `${withCapital.size} countries with their capitals`);
});

test('which cities a filter keeps', () => {
  const armenia = new Set(['Armenia']);
  const all = pickPlaces(places, armenia, DEFAULT_CITY_FILTER);
  assert.ok(all.length >= 6 && all.every((p) => p.country === 'Armenia'));
  const big = pickPlaces(places, armenia, { ...DEFAULT_CITY_FILTER, minSharePct: 4 });
  assert.deepEqual(big.map((p) => p.name).sort(), ['Gyumri', 'Yerevan'].sort());
  const capitals = pickPlaces(places, null, { ...DEFAULT_CITY_FILTER, minPopulation: 1e9, capitals: 'national' });
  assert.ok(capitals.length > 190 && capitals.every((p) => p.capital === 'national'));
  const world = pickPlaces(places, null, { ...DEFAULT_CITY_FILTER, minPopulation: 1e9, economic: 3 });
  assert.ok(world.length >= 60 && world.every((p) => p.worldCity));
  assert.ok(pickPlaces(places, null, { ...DEFAULT_CITY_FILTER, minPopulation: 5e6 }).every((p) => p.population >= 5e6));
  assert.equal(cityShown('x', null, { ...DEFAULT_CITY_FILTER, minSharePct: 50 }), true, 'cities of one\'s own always show');
  assert.equal(cityShown('x', null, { ...DEFAULT_CITY_FILTER, only: ['y'] }), false, 'but not when only a list shows');
  assert.deepEqual(cityFilterOf({ minSharePct: 500, capitals: 'bad', economic: 9 }), { ...DEFAULT_CITY_FILTER, minSharePct: 100 });
});

test('added as cities that remember what they are; a map\'s filter stored with it', () => {
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'T').result;
  const picked = pickPlaces(places, new Set(['Armenia', 'Georgia']), { ...DEFAULT_CITY_FILTER, minSharePct: 3, capitals: 'national' });
  const ids = cmd.addCities(world, { spaceId, places: picked, mode: { kind: 'correct', t: NEG_INF } }).result;
  assert.equal(ids.length, picked.length);
  const yerevan = world.all('entity').find((e) => e.name === 'Yerevan')!;
  assert.equal(yerevan.type_id, 'settlement');
  assert.equal(placeMetaOf(yerevan.style)?.capital, 'national');
  assert.equal(world.get('entity_group', yerevan.group_id)?.name, 'Today\'s cities');
  assert.throws(() => cmd.addCities(world, { spaceId, places: picked, mode: { kind: 'correct', t: NEG_INF } }), /already/);
  cmd.setWorldShow(world, spaceId, { cities: { ...DEFAULT_CITY_FILTER, only: [yerevan.id] } });
  assert.deepEqual(cityFilterOfSpace(world.get('map_space', spaceId)).only, [yerevan.id]);
});
