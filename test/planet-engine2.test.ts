// The same land unless the geology changes (D258): planets of the second calculation (`engine` 2). Their history is
// made from their geology alone; the sea stands where their water, an amount, fills the land's hollows; the climate,
// water and life are worked out on that land and sea, at the present or at any of the history's pictures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  definitionFromPreset, newDefinition, asEngine2, definitionOf, definitionProblems, canonicalDefinition, referenceSea, seaShareGuess, waterForShare,
  withLandOf, withWaterGuess, EARTH_WATER_KM, type PlanetDefinition,
} from '../src/planet/model/definition.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { tectonicParams } from '../src/planet/pipeline/stages.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME_IDS } from '../src/planet/life/biomes.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { simOf } from '../src/world-model/world-settings.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };

test('the definition: water as an amount, the share a guess until the land is made; kept and read back; the first calculation as it was', () => {
  // The Earth's amount gives the share the history keeps; none gives none; a great deal covers everything.
  assert.ok(Math.abs(referenceSea(0.4) - 0.712) < 1e-9);
  assert.ok(Math.abs(seaShareGuess(EARTH_WATER_KM, 0.4) - referenceSea(0.4)) < 1e-9);
  assert.equal(seaShareGuess(0, 0.4), 0);
  assert.ok(seaShareGuess(20, 0.4) > 0.999);
  assert.ok(Math.abs(waterForShare(seaShareGuess(1.3, 0.25), 0.25) - 1.3) < 1e-9);
  assert.equal(waterForShare(0, 0.4), 0);
  // (However few or many the continents, the history keeps some land and some sea.)
  assert.equal(referenceSea(0), 0.97);
  assert.equal(referenceSea(1), 0.3);
  // A new planet: of the second calculation, its water about the Earth's, no climate kept with its history.
  const d = newDefinition('earthlike', 9);
  assert.equal(d.engine, 2);
  assert.ok(Math.abs(d.water.depthKm! - EARTH_WATER_KM) < 0.02, `${d.water.depthKm} km`);
  assert.equal(d.history.climate, undefined);
  assert.deepEqual(definitionProblems(d), []);
  // The presets' seas, as amounts: none for the dry ones, less for the desert, the Earth's for the ocean world
  // (there the continents are what is missing).
  assert.equal(newDefinition('inactive').water.depthKm, 0);
  assert.equal(newDefinition('hothouse').water.depthKm, 0);
  assert.ok(newDefinition('desert').water.depthKm! > 0.1 && newDefinition('desert').water.depthKm! < 0.8);
  assert.ok(Math.abs(newDefinition('ocean').water.depthKm! - EARTH_WATER_KM) < 0.3);
  // Stored and read back: the same; an amount out of range brought within it; no amount readable, the share's.
  const back = definitionOf(JSON.parse(JSON.stringify(canonicalDefinition(d))))!;
  assert.deepEqual(back, d);
  assert.equal(definitionOf({ ...d, water: { depthKm: 99 } })!.water.depthKm, 30);
  assert.ok(Math.abs(definitionOf({ ...d, water: { oceanFraction: 0.5 } })!.water.depthKm! - waterForShare(0.5, 0.4)) < 1e-9);
  assert.match(definitionProblems({ ...d, water: { ...d.water, depthKm: -1 } })[0], /amount of water/);
  // Made of the second calculation twice: the same. The first calculation's definitions are as they were.
  assert.deepEqual(asEngine2(d), d);
  const first = definitionFromPreset('earthlike', 9);
  assert.equal(first.engine, undefined);
  assert.equal(first.water.depthKm, undefined);
  assert.equal(definitionOf(JSON.parse(JSON.stringify(first)))!.engine, undefined);
  assert.equal(tectonicParams(first, 4).climate !== undefined, true, 'the first calculation\'s history reads its climate');
});

test('what the land is made from: the geology alone', () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 9), key = p.keyOf('tectonics', d, P);
  const params = tectonicParams(d, 4, 200);
  assert.equal(params.climate, undefined);
  assert.equal(params.hadleyDeg, 30);
  assert.equal(params.erodibility, 1);
  assert.ok(Math.abs(params.oceanFraction - referenceSea(0.4)) < 1e-12);
  // The star, the orbit, the tilt, the day, the air, the amount of water, the life, the events of the climate and the
  // sea: the same history.
  const same: Array<[string, (d: PlanetDefinition) => void]> = [
    ['the star', (x) => { x.star.stars[0].massSun = 0.6; }], ['the distance', (x) => { x.orbit.semiMajorAu = 0.3; }], ['the eccentricity', (x) => { x.orbit.eccentricity = 0.4; }],
    ['the tilt', (x) => { x.body.tiltDeg = 60; }], ['the day', (x) => { x.body.dayHours = 240; }], ['locked', (x) => { x.body.tidallyLocked = true; }],
    ['the air', (x) => { x.atmosphere.pressureBar = 0.01; }], ['carbon dioxide', (x) => { x.atmosphere.co2 = 0.5; }], ['clouds', (x) => { x.atmosphere.clouds = 0.9; }],
    ['more water', (x) => { x.water.depthKm = 9; }], ['less water', (x) => { x.water.depthKm = 0.2; }], ['plants', (x) => { x.life.vegetation = 'none'; }],
    ['an ice age', (x) => { x.history.events.push({ id: 'a', kind: 'ice-age', startMa: 50, durationMyr: 20, strength: 2 }); }],
    ['a rise of the sea', (x) => { x.history.events.push({ id: 'b', kind: 'sea-level', startMa: 50, durationMyr: 20, strength: 2 }); }],
  ];
  for (const [name, f] of same) assert.equal(p.keyOf('tectonics', change(d, f), P), key, name);
  // The seed, the size, the mass, the interior, the plates, the continents, the hotspots, the age, the events that
  // move plates, and whether there is any water at all: another history.
  const other: Array<[string, (d: PlanetDefinition) => void]> = [
    ['the seed', (x) => { x.seed = 10; }], ['the radius', (x) => { x.body.radiusKm = 7000; }], ['the mass', (x) => { x.body.massEarths = 2; }],
    ['the heat', (x) => { x.interior.heatProduction = 2; }], ['the plates', (x) => { x.tectonics.plates = 20; }], ['the activity', (x) => { x.tectonics.activity = 2; }],
    ['the continents', (x) => { x.tectonics.continentalFraction = 0.2; }], ['the hotspots', (x) => { x.tectonics.hotspots = 3; }], ['the age', (x) => { x.history.ageGyr = 2; }],
    ['a rift', (x) => { x.history.events.push({ id: 'c', kind: 'rift', startMa: 50, durationMyr: 20, strength: 1 }); }], ['no water', (x) => { x.water.depthKm = 0; x.water.oceanFraction = 0; }],
  ];
  for (const [name, f] of other) assert.notEqual(p.keyOf('tectonics', change(d, f), P), key, name);
  // (Whether there is water is read from the amount: a share left beside it from before changes nothing.)
  assert.equal(tectonicParams(change(d, (x) => { x.water.depthKm = 0; }), 4, 200).regime, 'stagnant-lid');
  assert.equal(withWaterGuess(change(d, (x) => { x.water.depthKm = 0; })).water.oceanFraction, 0);
  assert.equal(withWaterGuess(d), d, 'already in step: itself');
  // Without water: no plates moving (as the physics suggests), and the land hardly worn.
  const dry = tectonicParams(definitionOf({ ...d, water: { depthKm: 0 } })!, 4, 200);
  assert.equal(dry.regime, 'stagnant-lid');
  assert.equal(dry.erodibility, 0.03);
  // The land there is, with the other settings as they are (D257): the water among those, unless it comes or goes.
  const now = change(d, (x) => { x.water.depthKm = 6; x.orbit.semiMajorAu = 1.2; x.tectonics.plates = 20; });
  const mixed = withLandOf(now, d);
  assert.equal(p.keyOf('tectonics', mixed, P), key);
  assert.equal(mixed.water.depthKm, 6);
  assert.equal(withLandOf(change(d, (x) => { x.water.depthKm = 0; }), d).water.depthKm, d.water.depthKm);
});

test('the sea from the water: the same land under more or less of it; a dry world keeps its relief; the climate and life on that land and sea', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 9), mesh = meshAt(4), n = mesh.n;
  const sea = async (depthKm: number, extra: Record<string, unknown> = {}) => (await p.product('sea', change(d, (x) => { x.water.depthKm = depthKm; }), { ...P, ...extra })).data;
  const share = (h: Int16Array) => { let a = 0; for (let c = 0; c < n; c++) if (h[c] < 0) a += mesh.area[c]; return a / (4 * Math.PI); };
  const history = await p.product('tectonics', d, P);
  // The Earth's amount: a sea over most of the surface, land over the rest.
  const earth = await sea(EARTH_WATER_KM), h1 = earth.heights as Int16Array;
  assert.ok((earth.share as number) > 0.45 && (earth.share as number) < 0.9, `the Earth's water over ${(100 * (earth.share as number)).toFixed(0)} % of it`);
  assert.ok(Math.abs(share(h1) - (earth.share as number)) < 1e-9);
  assert.equal(earth.dry, false);
  // More water, more sea; less, less: and the land that stands out of the higher sea stands out of the lower.
  const amounts = [0.2, 1, EARTH_WATER_KM, 5, 9];
  const seas = await Promise.all(amounts.map((a) => sea(a)));
  for (let i = 1; i < seas.length; i++) {
    assert.ok((seas[i].share as number) > (seas[i - 1].share as number), `${amounts[i]} km covers more than ${amounts[i - 1]} km`);
    assert.ok((seas[i].level as number) > (seas[i - 1].level as number));
    const lo = seas[i - 1].heights as Int16Array, hi = seas[i].heights as Int16Array;
    for (let c = 0; c < n; c++) assert.ok(hi[c] <= lo[c], 'every place lower against the higher sea');
    // (The same land: the heights differ by the sea's level alone.)
    const shift = Math.round((seas[i].level as number) - (seas[i - 1].level as number));
    for (let c = 0; c < n; c += 97) assert.ok(Math.abs(lo[c] - hi[c] - shift) <= 1, 'the land itself unchanged');
  }
  // The water's volume is the one asked for.
  let volume = 0;
  for (let c = 0; c < n; c++) if (h1[c] < 0) volume += (-h1[c] / 1000) * mesh.area[c];
  assert.ok(Math.abs(volume / (4 * Math.PI) - EARTH_WATER_KM) < 0.01, `${(volume / (4 * Math.PI)).toFixed(3)} km of water over the planet`);
  // The history itself was made once, whatever the water.
  for (const a of amounts) assert.equal(p.keyOf('tectonics', change(d, (x) => { x.water.depthKm = a; }), P), history.key);
  // An ocean world: all sea. A deluge of 25 km leaves nothing out.
  const all = await sea(25);
  assert.equal(all.share, 1);
  // The climate, water and life stages on the sea stage's land and sea: as much sea among the biomes as the sea has.
  const seaId = BIOME_IDS.indexOf('sea');
  const biomes = (await p.product('biomes', change(d, (x) => { x.water.depthKm = 1; }), P)).data.biome as Uint8Array;
  let seaCells = 0;
  for (let c = 0; c < n; c++) if (biomes[c] === seaId) seaCells += mesh.area[c];
  assert.ok(Math.abs(seaCells / (4 * Math.PI) - (seas[1].share as number)) < 0.03, `biomes' sea ${(seaCells / (4 * Math.PI)).toFixed(3)}, the sea's ${(seas[1].share as number).toFixed(3)}`);
  // An earlier picture of the history: its own sea from the same water, its own biomes, no stand-in needed.
  const then = await sea(EARTH_WATER_KM, { frame: 0 });
  assert.equal(then.ma, 200);
  assert.ok((then.share as number) > 0.4 && (then.share as number) < 0.95);
  const cover = await p.product('cover', d, { ...P, frame: 0, width: 90, height: 45 });
  assert.equal((cover.data.pixels as Uint8Array).length, 4 * 90 * 45);
  assert.equal(p.cache.get(p.keyOf('moment', d, { ...P, frame: 0 })), undefined, 'no stand-in for the past was made');
  // The sea's own rise on the timeline: 50 m a unit of strength, in the pictures it covers and no others.
  const risen = change(d, (x) => { x.history.events.push({ id: 'r', kind: 'sea-level', startMa: 200, durationMyr: 30, strength: 2 }); });
  const up = (await p.product('sea', risen, { ...P, frame: 0 })).data, later = (await p.product('sea', risen, P)).data;
  const flat = (await p.product('sea', d, { ...P, frame: 0 })).data, today = (await p.product('sea', d, P)).data;
  assert.ok(Math.abs((up.level as number) - (flat.level as number) - 100) < 1e-6, `${up.level} against ${flat.level}`);
  assert.equal(later.level, today.level);
});

test('a world with no water: all land, its relief kept, no sea and no rain', async () => {
  const p = new Pipeline(new LocalExecutor()), d = definitionOf({ ...newDefinition('earthlike', 9), water: { depthKm: 0 } })!, mesh = meshAt(4), n = mesh.n;
  assert.equal(d.water.oceanFraction, 0);
  const sea = (await p.product('sea', d, P)).data, h = sea.heights as Int16Array;
  assert.equal(sea.dry, true);
  assert.equal(sea.share, 0);
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < n; c++) { lo = Math.min(lo, h[c]); hi = Math.max(hi, h[c]); }
  // (The first calculation recorded such a world's every height as 32,000 m.)
  assert.equal(lo, 0, 'the lowest ground is the datum');
  assert.ok(hi > 3000 && hi < 31_000, `relief of ${hi} m`);
  const biome = (await p.product('biomes', d, P)).data.biome as Uint8Array, seaId = BIOME_IDS.indexOf('sea');
  assert.equal(biome.includes(seaId), false, 'no sea among its biomes');
  // Bare rock everywhere: no ice, lake, marsh or salt without water (the hollows of its relief hold none).
  assert.ok(biome.every((b) => b === BIOME_IDS.indexOf('barren')), 'bare rock everywhere');
  const water = (await p.product('water', d, P)).data;
  assert.ok((water.kind as Uint8Array).every((k) => k === 0), 'no water of any kind');
  assert.ok((water.lakeDepth as Float32Array).every((v) => v === 0));
  const climate = (await p.product('climate', d, P)).data;
  assert.equal(climate.meanPrecip, 0);
  // The elevation's picture is of those heights.
  const r = await p.product('raster', d, { ...P, layer: 'elevation', width: 64, height: 32 });
  assert.ok((r.data.min as number) >= 0 && (r.data.max as number) > 2000);
});

test('pictures by moment and by month; the first calculation\'s products untouched', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 9);
  const size = { width: 64, height: 32 };
  // The heights of an earlier picture against its own sea; the plates of that picture; a month of the present's rain.
  const now = await p.product('raster', d, { ...P, ...size, layer: 'elevation' }), then = await p.product('raster', d, { ...P, ...size, layer: 'elevation', frame: 0 });
  assert.notEqual(now.key, then.key);
  assert.notDeepEqual(now.data.raster, then.data.raster);
  const plates = await p.product('raster', d, { ...P, ...size, layer: 'plates', frame: 0 });
  assert.ok((plates.data.max as number) >= 1);
  const jan = await p.product('raster', d, { ...P, ...size, layer: 'temperatureMonth', month: 0 }), jul = await p.product('raster', d, { ...P, ...size, layer: 'temperatureMonth', month: 6 });
  assert.notDeepEqual(jan.data.raster, jul.data.raster);
  // (The same climate for both months: made once.)
  assert.equal(p.keyOf('climate', d, { ...P, month: 0 }), p.keyOf('climate', d, { ...P, month: 6 }));
  // A planet of the first calculation: its keys do not know of the sea stage, and its stages run as they did.
  const first = definitionFromPreset('earthlike', 9), P1 = { level: 4, durationMyr: 200, frameEveryMyr: 25 };
  const biomes = await p.product('biomes', first, P1);
  assert.equal(p.cache.get(p.keyOf('sea', first, P1)), undefined, 'no sea stage for the first calculation');
  assert.ok((biomes.data.biome as Uint8Array).length > 0);
});

test('a map of a planet of the second calculation: its definition kept as given, its water with it', () => {
  const world = new World();
  cmd.seedProject(world, 'Planets');
  const def = change(newDefinition('desert', 5), (x) => { x.water.depthKm = 0.4; });
  const given = withWaterGuess(def);
  const id = cmd.createSimPlanet(world, 'Arid', given).result;
  const kept = simOf(world.get('map_space', id)!)!;
  assert.equal(kept.engine, 2);
  assert.equal(kept.water.depthKm, 0.4);
  assert.deepEqual({ ...kept, name: given.name }, given, 'kept as given');
  // A map of the first calculation beside it: no mark of the second, no amount of water.
  const old = simOf(world.get('map_space', cmd.createSimPlanet(world, 'Old', definitionFromPreset('desert', 5)).result)!)!;
  assert.equal(old.engine, undefined);
  assert.equal(old.water.depthKm, undefined);
  assert.equal(old.water.oceanFraction, 0.1);
});
