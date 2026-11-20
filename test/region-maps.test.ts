// Ready-made region maps (D175): the Middle East today and Armenia with its neighbours, made in a project from
// today's countries, cities, provinces and urban areas, with the satellite look at its finest and a 4K shot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { decodeCountries, type CountriesFile } from '../src/domain/countries.ts';
import { decodePlaces, type PlacesFile } from '../src/domain/places.ts';
import { decodeRegions, type RegionsFile } from '../src/domain/regions.ts';
import { REGION_MAPS, buildRegionMap, type UrbanFile } from '../src/domain/region-maps.ts';
import { terrainLook } from '../src/world-model/world-settings.ts';
import { gregorian } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../data/natural-earth/${f}`, import.meta.url), 'utf8'));
const data = {
  countries: decodeCountries(read('countries-50m.json') as CountriesFile), places: decodePlaces(read('places-10m.json') as PlacesFile),
  urban: read('urban-10m-mideast.json') as UrbanFile, regions: decodeRegions(read('regions-10m.json') as RegionsFile),
};

for (const def of REGION_MAPS) {
  test(`"${def.name}": the region's countries, cities, urban areas, satellite look and a 4K shot`, () => {
    const world = new World();
    cmd.seedProject(world, 'T');
    const engine = new Engine(world);
    const made = buildRegionMap(def, data, (fn) => fn(world, engine).result)!;
    const space = world.get('map_space', made.spaceId)!;
    const look = terrainLook(space)!;
    assert.ok(look.photo && look.detail && look.fine && look.palette === 'satellite', 'the Earth as photographed, at its finest');
    const owner = (lon: number, lat: number) => { const v = engine.valueAtPoint(made.spaceId, made.layerId, lonLatToVec(lon, lat), gregorian.fromCivil({ year: 2026 })); return v ? world.get('entity', v)!.name : null; };
    const cities = new Set(world.all('entity').filter((e) => e.type_id === 'settlement').map((e) => e.name));
    if (def.id === 'armenia') {
      for (const [n, lon, lat] of [['Armenia', 44.5, 40.2], ['Turkey', 42, 39.5], ['Azerbaijan', 48, 40.5], ['Georgia', 44, 42], ['Iran', 47, 37.8]] as const) assert.equal(owner(lon, lat), n);
      for (const c of ['Yerevan', 'Gyumri', 'Vanadzor', 'Tbilisi', 'Baku', 'Tabriz', 'Erzurum']) assert.ok(cities.has(c), `${c} among the cities`);
      assert.ok(world.all('feature').filter((f) => world.get('layer', f.layer_id)?.name === 'Provinces').length >= 10, 'Armenia\'s provinces');
    } else {
      for (const [n, lon, lat] of [['Egypt', 31, 27], ['Iran', 53, 32], ['Saudi Arabia', 45, 24], ['Turkey', 35, 39], ['Iraq', 44, 33]] as const) assert.equal(owner(lon, lat), n);
      for (const c of ['Cairo', 'Tehran', 'Riyadh', 'Baghdad', 'Istanbul', 'Dubai', 'Jerusalem', 'Damascus']) assert.ok(cities.has(c), `${c} among the cities`);
    }
    const urban = world.all('feature').find((f) => f.name === 'Built-up areas')!;
    assert.ok(urban, 'the built-up areas');
    const shot = JSON.parse(world.get('sequence', made.shotId)!.settings);
    assert.equal(shot.width, 3840);
    assert.equal(shot.height, 2160);
    assert.equal(shot.spaceId, made.spaceId);
  });
}
