// Every slider earns its place (D267): the cloud cover, the amount of water and the plants each change the planet as
// their causes would, on the same land; bare ground under no air is dark; ground heated only by its days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, newDefinition, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { CLOUD_HOLD, derive, groundAlbedo, opticalDepth, seaLimit, waterState } from '../src/planet/model/physics.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { STAGES, WATER_MOST_KM } from '../src/planet/pipeline/stages.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BARE_DESERT_AI, BIOME, BIOME_IDS, SCORCHED_BY_DAY_FROM, biomeOf, hotSurface, withoutPlants, type Place } from '../src/planet/life/biomes.ts';
import { WATER } from '../src/planet/water/hydrology.ts';
import { familyShares, whyItLooksSo, type ModelFacts, type SeaFacts } from '../src/planet/why.ts';
import { shareForWater, tippingPoints, waterMarks, type WaterTable } from '../src/planet/tipping.ts';
import { explain } from '../src/planet/explain.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const mesh = meshAt(4), n = mesh.n, A = mesh.area;
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };
/** About the Earth's water (km, spread evenly). */
const EARTHS = 2.6;

/** A planet's products with its figures: the surface's mean (°C), the frozen share of its sea, each family's share. */
async function planet(p: Pipeline, d: PlanetDefinition) {
  const sea = (await p.product('sea', d, P)).data, T = (await p.product('temperature', d, P)).data, C = (await p.product('climate', d, P)).data;
  const W = (await p.product('water', d, P)).data, B = (await p.product('biomes', d, P)).data;
  return { sea, T, C, W, B, meanC: T.surfaceC as number, frozen: T.seaFrozen as number, fam: familyShares(B.shares as Float32Array), biome: B.biome as Uint8Array, colour: B.colour as Uint8Array };
}

test('the clouds\' hold on heat: counted from half cover, only where there is water, only in the second calculation', () => {
  const d = newDefinition('earthlike', 4), wet = change(d, (c) => { c.water.oceanFraction = 0.71; });
  // Half the sky clouded: the opacity the Earth is fitted with, nothing added.
  assert.equal(opticalDepth(wet, 288).cloud, 0);
  // A clear sky lets more heat out, a clouded one holds more in: by 0.21 of opacity each way with the Earth's seas.
  const clear = opticalDepth(change(wet, (c) => { c.atmosphere.clouds = 0; }), 288), full = opticalDepth(change(wet, (c) => { c.atmosphere.clouds = 1; }), 288);
  assert.ok(Math.abs(clear.cloud! + CLOUD_HOLD / 2) < 1e-9 && Math.abs(full.cloud! - CLOUD_HOLD / 2) < 1e-9, `${clear.cloud}, ${full.cloud}`);
  assert.ok(Math.abs(clear.total - (clear.co2 + clear.ch4 + clear.h2o + clear.cloud!)) < 1e-12);
  // (Less in cold air, which holds little vapour to make cloud of; never more than the vapour's own share.)
  const cold = opticalDepth(change(wet, (c) => { c.atmosphere.clouds = 0; }), 230);
  assert.ok(cold.cloud! < 0 && cold.cloud! > clear.cloud! && cold.h2o + cold.cloud! > 0, `${cold.cloud} against ${cold.h2o}`);
  // No water, no water clouds: a dry planet's cloud cover only turns light away.
  assert.equal(opticalDepth(change(d, (c) => { c.water.oceanFraction = 0; c.atmosphere.clouds = 1; }), 288).cloud, undefined);
  // The first calculation as it was made: no such share, whatever the cover.
  const first = definitionFromPreset('earthlike', 4);
  first.atmosphere.clouds = 0;
  assert.deepEqual(Object.keys(opticalDepth(first, 288)), ['co2', 'ch4', 'h2o', 'total']);
  // So the planet as a whole: a clear sky warms an Earth and a clouded one cools it, by some tens of degrees; and a
  // clear sky no longer boils its seas (it takes in 286 W/m², and can shed up to 295 with so little cloud).
  const at = (clouds: number) => derive(change(wet, (c) => { c.atmosphere.clouds = clouds; })).surfaceK - 273.15;
  assert.ok(at(0) > at(0.5) + 10 && at(0) < 45 && at(1) < at(0.5) - 10 && at(1) > -15, `${at(0)}, ${at(0.5)}, ${at(1)} °C`);
  const sunny = change(wet, (c) => { c.atmosphere.clouds = 0; });
  assert.equal(waterState(sunny, 0.71).fate, 'liquid');
  assert.ok(seaLimit(sunny, 0.71) > seaLimit(wet, 0.71) + 10 && seaLimit(change(wet, (c) => { c.atmosphere.clouds = 1; }), 0.71) < seaLimit(wet, 0.71) - 10);
  // Nearer the star it does: the cloud cover has a tipping point of its own there.
  const near = change(d, (c) => { c.orbit.semiMajorAu = 0.97; });
  const marks = tippingPoints(near, 0.71, 'clouds');
  assert.equal(marks.length, 1);
  assert.ok(marks[0].tone === 'hot' && marks[0].side === 'below' && marks[0].at > 0.05 && marks[0].at < 0.3 && /^seas boil away below \d+ % of cloud$/.test(marks[0].label), JSON.stringify(marks));
  assert.deepEqual(tippingPoints(d, 0.71, 'clouds'), [], 'none for an Earth where it is');
});

test('bare ground: dark under no air, as the Earth\'s deserts under air; day-heated ground scorched only by hot days', () => {
  assert.equal(groundAlbedo(1), 0.25);
  assert.equal(groundAlbedo(0.0063), 0.25);
  assert.equal(groundAlbedo(0), 0.12);
  assert.ok(groundAlbedo(0.003) > 0.12 && groundAlbedo(0.003) < 0.25);
  // The planet as a whole: an airless one takes in more light than it did (the first calculation: as it was).
  const d = newDefinition('earthlike', 4), bare = change(d, (c) => { c.atmosphere.pressureBar = 0; c.water.oceanFraction = 0; });
  assert.ok(Math.abs(derive(bare).albedo - 0.12) < 1e-9, `${derive(bare).albedo}`);
  const first = definitionFromPreset('earthlike', 4);
  first.atmosphere.pressureBar = 0; first.water.oceanFraction = 0;
  assert.ok(derive(first).albedo >= 0.25 && derive(first).albedo < 0.26, `${derive(first).albedo}`);
  // Ground heated by its days alone: bare rock at the Moon's noon, scorched at Mercury's, molten where rock melts.
  assert.equal(hotSurface(-20, 120), 'barren');
  assert.equal(hotSurface(-20, SCORCHED_BY_DAY_FROM), 'scorched');
  assert.equal(hotSurface(20, 430), 'scorched');
  assert.equal(hotSurface(20, 1200), 'lava');
  assert.equal(hotSurface(120), 'scorched', 'a warmest month over 100 °C scorches, as before');
  assert.equal(hotSurface(20, 30), null);
});

test('no plants: bare ground and desert where they would have grown; cold land too dry for scrub is desert', () => {
  for (const b of BIOME_IDS) {
    const w = withoutPlants(b);
    assert.equal(BIOME[w].plants === 0 || w === 'desert', true, `${b} -> ${w}`);
    if (!(BIOME[b].plants > 0)) assert.equal(w, b);
  }
  assert.deepEqual(['rainforest', 'boreal', 'grassland', 'wetland', 'steppe', 'tundra', 'alpine', 'desert'].map((b) => withoutPlants(b as keyof typeof BIOME)), ['barren', 'barren', 'barren', 'barren', 'desert', 'polarDesert', 'barren', 'desert']);
  // A cold place with a twentieth of the rain that could evaporate: scrub by the rules as first made, desert now.
  const place: Place = { temp: [-8, -5, 0, 6, 12, 17, 19, 17, 12, 5, -2, -7], precip: new Array(12).fill(3), pet: 36 / (BARE_DESERT_AI / 2), height: 900, water: WATER.land, ice: 0 };
  assert.equal(biomeOf(place), 'steppe');
  assert.equal(biomeOf(place, true), 'desert');
  assert.equal(biomeOf({ ...place, pet: 36 / 0.15 }, true), 'steppe', 'dry, but not too dry for scrub');
});

test('the cloud cover on an Earth: a clear sky makes a hothouse with its seas, a clouded one an ice age, on the same land', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const earth = await planet(p, d), clear = await planet(p, change(d, (c) => { c.atmosphere.clouds = 0; })), full = await planet(p, change(d, (c) => { c.atmosphere.clouds = 1; }));
  assert.equal(clear.sea.fate, 'liquid');
  assert.ok(clear.meanC > earth.meanC + 20 && clear.meanC < 70, `${clear.meanC} °C under a clear sky`);
  assert.ok(full.meanC < earth.meanC - 8 && full.meanC > -15 && full.frozen < 0.5 && full.frozen > earth.frozen, `${full.meanC} °C, ${full.frozen} frozen under cloud`);
  assert.ok(full.fam.ice > earth.fam.ice + 0.04, `${full.fam.ice} ice`);
  assert.deepEqual([...(clear.sea.heights as Int16Array).subarray(0, 64)], [...(earth.sea.heights as Int16Array).subarray(0, 64)], 'the same land');
});

test('the amount of water: small seas on a cold, dry world that does not freeze over; an ocean world; the amounts where it tips', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const earth = await planet(p, d);
  // A hundredth of the Earth's water: seas over a small part, a colder and far drier world (less vapour in its air),
  // mostly desert; its cold land mostly bare, so it does not brighten into a ball of ice (as it did: -55 °C).
  const little = await planet(p, change(d, (c) => { c.water.depthKm = 0.03; }));
  assert.ok((little.sea.share as number) > 0.02 && (little.sea.share as number) < 0.2, `${little.sea.share} of it sea`);
  assert.ok(little.meanC < earth.meanC - 10 && little.meanC > -25 && little.frozen < 0.9, `${little.meanC} °C, ${little.frozen} of its sea frozen`);
  assert.ok((little.C.meanPrecip as number) < 0.15 * (earth.C.meanPrecip as number), `${little.C.meanPrecip} mm`);
  assert.ok(little.fam.desert > 0.3 && little.fam.desert > little.fam.ice && little.fam.forest < 0.05, JSON.stringify(little.fam));
  // A tenth of it: still no ball of ice.
  const some = await planet(p, change(d, (c) => { c.water.depthKm = 0.3; }));
  assert.ok(some.meanC > -20 && some.frozen < 0.6 && some.meanC > little.meanC - 3, `${some.meanC} °C, ${some.frozen} frozen`);
  // Far more: water over nearly everything, mild and even.
  const much = await planet(p, change(d, (c) => { c.water.depthKm = 8; }));
  assert.ok(much.fam.sea + much.fam.ice > 0.97 && much.meanC > earth.meanC, `${much.fam.sea} sea, ${much.meanC} °C`);
  // (The same land under all of them: its heights differ only by where the sea stands.)
  const shift = (earth.sea.level as number) - (little.sea.level as number);
  for (let c = 0; c < n; c += 37) assert.ok(Math.abs((little.sea.heights as Int16Array)[c] - (earth.sea.heights as Int16Array)[c] - shift) <= 2, `cell ${c}`);
  // How much sea each amount gives over this land, and the amount that drowns its last land: from the sea stage.
  const t: WaterTable = { depths: earth.sea.depths as Float32Array, shares: earth.sea.shares as Float32Array, drownsKm: earth.sea.drownsKm as number };
  assert.equal(t.depths.length, 48);
  assert.ok(Math.abs(t.depths[47] - WATER_MOST_KM) < 1e-6);
  for (let i = 1; i < 48; i++) assert.ok(t.depths[i] > t.depths[i - 1] && t.shares[i] >= t.shares[i - 1] - 1e-9);
  assert.ok(t.shares[0] > 0 && t.shares[47] > 0.99, `${t.shares[0]} to ${t.shares[47]}`);
  assert.ok(t.drownsKm > EARTHS && t.drownsKm < WATER_MOST_KM, `no land above ${t.drownsKm} km`);
  // (Between the table's amounts: the planet's own share at its own amount, and the others' at theirs.)
  assert.ok(Math.abs(shareForWater(t, d.water.depthKm!) - (earth.sea.liquidShare as number)) < 0.02, `${shareForWater(t, d.water.depthKm!)} against ${earth.sea.liquidShare}`);
  assert.ok(Math.abs(shareForWater(t, 0.03) - (little.sea.liquidShare as number)) < 0.02 && Math.abs(shareForWater(t, 8) - (much.sea.liquidShare as number)) < 0.02);
  assert.equal(shareForWater(t, 0), 0);
  // The slider's marks for an Earth: no land left above that amount; nothing boils at any amount.
  const marks = waterMarks(d, t, WATER_MOST_KM);
  assert.equal(marks.length, 1);
  assert.ok(marks[0].tone === 'sea' && marks[0].side === 'above' && Math.abs(marks[0].at - t.drownsKm) < 1e-9 && /^no land above \d+\.\d km$/.test(marks[0].label), JSON.stringify(marks));
  // Nearer its star: small seas stand where wide ones boil away (the wider the seas, the more vapour).
  const near = change(d, (c) => { c.orbit.semiMajorAu = 0.9; }), nearMarks = waterMarks(near, t, WATER_MOST_KM);
  const boil = nearMarks.find((m) => m.tone === 'hot');
  assert.ok(boil && boil.side === 'above' && boil.at > 0.02 && boil.at < 2.6 && /^seas boil away above \d+\.\d+ km$/.test(boil.label), JSON.stringify(nearMarks));
  assert.equal(waterState({ ...near, water: { ...near.water } }, shareForWater(t, boil!.at * 0.8)).fate, 'liquid');
  assert.equal(waterState({ ...near, water: { ...near.water } }, shareForWater(t, boil!.at * 1.25)).fate, 'boiled');
  // And close in, they boil away however little there is.
  assert.equal(waterMarks(change(d, (c) => { c.orbit.semiMajorAu = 0.5; }), t, WATER_MOST_KM)[0].label, 'seas boil away, however little the water');
  // The sea stage's version says its products changed (D267).
  assert.equal(STAGES.sea.version, 4);
});

test('a planet given no plants: no forest or grass anywhere, bare ground and desert in their place; said in its chain and of a place', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const earth = await planet(p, d), bare = await planet(p, change(d, (c) => { c.life.vegetation = 'none'; }));
  assert.ok(earth.fam.forest > 0.05 && earth.fam.grass > 0.05);
  assert.equal(bare.fam.forest, 0);
  assert.equal(bare.fam.grass, 0);
  assert.ok(Math.abs(bare.fam.rock + bare.fam.desert - (earth.fam.rock + earth.fam.desert + earth.fam.forest + earth.fam.grass)) < 1e-6, JSON.stringify(bare.fam));
  assert.ok(Math.abs(bare.fam.sea - earth.fam.sea) < 1e-9 && Math.abs(bare.fam.ice - earth.fam.ice) < 1e-9, 'its sea and ice as they were');
  // (The same climate: nothing but the kinds of land and their colours differs.)
  assert.equal(bare.meanC, earth.meanC);
  let kinds = 0, colours = 0;
  for (let c = 0; c < n; c++) {
    if (bare.biome[c] !== earth.biome[c]) { kinds += A[c] / (4 * Math.PI); assert.equal(BIOME[BIOME_IDS[bare.biome[c]]].plants <= 0.05, true); }
    if (Math.abs(bare.colour[3 * c] - earth.colour[3 * c]) + Math.abs(bare.colour[3 * c + 1] - earth.colour[3 * c + 1]) + Math.abs(bare.colour[3 * c + 2] - earth.colour[3 * c + 2]) > 30) colours += A[c] / (4 * Math.PI);
  }
  assert.ok(kinds > 0.15 && colours > 0.1, `${kinds} of the planet another kind, ${colours} another colour`);
  // In the chain of causes.
  const lifeless = change(d, (c) => { c.life.vegetation = 'none'; });
  const model: ModelFacts = { surfaceC: bare.meanC, absorbed: bare.T.absorbed as number, seaFrozen: bare.frozen, capShare: 0, rainMm: bare.C.meanPrecip as number, shares: bare.B.shares as Float32Array };
  const surface = whyItLooksSo(lifeless, derive(lifeless), bare.sea as unknown as SeaFacts, model).find((w) => w.key === 'surface')!;
  assert.equal(surface.cause, 'Warmth and rain enough for plants, but no life given');
  assert.ok(/bare rock \d+ %/i.test(surface.effect) && !/forest|grass/.test(surface.effect), surface.effect);
  // Of a place where a forest would have stood.
  const forest = [...earth.biome].findIndex((b, c) => ['temperateForest', 'rainforest', 'tropicalSeasonal', 'boreal'].includes(BIOME_IDS[b]) && BIOME_IDS[bare.biome[c]] === 'barren');
  assert.ok(forest >= 0);
  const none = new Uint8Array(n), zero = new Float32Array(n);
  const text = explain({
    mesh, def: lifeless, x: derive(lifeless), heights: bare.sea.heights as Int16Array, kinds: none, age: zero, thickness: zero, tags: none, boundary: none, boundaryRate: zero,
    climate: bare.C as never, water: bare.W as never, biomes: bare.B as never,
  }, forest).sections.flatMap((s) => s.lines).join(' ');
  assert.ok(/Bare rock: rain is [\d.]+ of what the warmth and sunlight could evaporate\. The planet was given no plants: where they would grow the ground is bare\./.test(text), text);
});
