// Hot worlds (D259): what becomes of a planet's water (seas where they can stand; boiled away under too much sunlight
// or too strong a greenhouse; kept by hand), and what heat makes of the land (bare ground too hot for plants, scorched
// rock, molten rock), on the same land whatever the star, the orbit and the air.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, newDefinition, definitionOf, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { derive, runawayLimit, waterState, WATER_CRITICAL_K } from '../src/planet/model/physics.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { STAGES } from '../src/planet/pipeline/stages.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME, BIOME_IDS, MOLTEN_FROM, SCORCHED_FROM, TOO_HOT_FOR_PLANTS, hotSurface, rockColour } from '../src/planet/life/biomes.ts';
import { explain } from '../src/planet/explain.ts';
import { TEMPERATURE, colourLayer, temperatureColour } from '../src/ui/planet-colors.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const mesh = meshAt(4), n = mesh.n, A = mesh.area;
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };
const id = (b: keyof typeof BIOME) => BIOME_IDS.indexOf(b);

/** A planet's products and a few figures of them: the mean temperature (°C), the year's rain (mm), each biome's share. */
async function planet(p: Pipeline, d: PlanetDefinition) {
  const sea = (await p.product('sea', d, P)).data, T = (await p.product('temperature', d, P)).data, C = (await p.product('climate', d, P)).data;
  const W = (await p.product('water', d, P)).data, B = (await p.product('biomes', d, P)).data;
  const monthly = C.monthly as Float32Array, rain = C.precipMonthly as Float32Array, biome = B.biome as Uint8Array;
  let mean = 0, wet = 0;
  const hot = new Float64Array(n).fill(-Infinity), share = new Map<string, number>();
  for (let c = 0; c < n; c++) {
    for (let m = 0; m < 12; m++) { mean += (monthly[m * n + c] * A[c]) / (12 * 4 * Math.PI); wet += (rain[m * n + c] * A[c]) / (4 * Math.PI); hot[c] = Math.max(hot[c], monthly[m * n + c]); }
    share.set(BIOME_IDS[biome[c]], (share.get(BIOME_IDS[biome[c]]) ?? 0) + A[c] / (4 * Math.PI));
  }
  return { sea, T, C, W, B, biome, hot, mean, rain: wet, of: (b: keyof typeof BIOME) => share.get(b) ?? 0 };
}

test('the water\'s fate: seas where they can stand; boiled away under too much sunlight or too strong a greenhouse; kept by hand', () => {
  const d = newDefinition('earthlike', 4);
  // The Earth: seas, taking in well under what seas can stand.
  const earth = waterState(d, 0.71);
  assert.equal(earth.fate, 'liquid');
  assert.equal(earth.kept, false);
  assert.equal(earth.cause, null);
  assert.ok(earth.absorbed > 228 && earth.absorbed < 248, `${earth.absorbed} W/m²`);
  assert.equal(earth.limit, 282);
  // A little closer: hotter, the seas still there. Closer again: more sunlight than seas can stand.
  assert.equal(waterState(change(d, (c) => { c.orbit.semiMajorAu = 0.95; }), 0.71).fate, 'liquid');
  const close = waterState(change(d, (c) => { c.orbit.semiMajorAu = 0.9; }), 0.71);
  assert.equal(close.fate, 'boiled');
  assert.equal(close.cause, 'sunlight');
  assert.ok(close.absorbed > close.limit);
  // A brighter star does the same from the Earth's distance.
  assert.equal(waterState(change(d, (c) => { c.star.stars[0].massSun = 1.3; }), 0.71).fate, 'boiled');
  // A hundred times the carbon dioxide: no more sunlight than the Earth's, but with the vapour of seas on top the
  // surface finds no balance below the temperature above which water is no liquid at all.
  const thick = waterState(change(d, (c) => { c.atmosphere.co2 = 0.04; }), 0.71);
  assert.equal(thick.fate, 'boiled');
  assert.equal(thick.cause, 'greenhouse');
  assert.ok(thick.absorbed < thick.limit && thick.withSeasK > WATER_CRITICAL_K, `${thick.absorbed} W/m², ${thick.withSeasK} K`);
  // Ten times: a hothouse, with its seas.
  assert.equal(waterState(change(d, (c) => { c.atmosphere.co2 = 0.004; }), 0.71).fate, 'liquid');
  // Small seas hold out closer in than oceans (Abe et al. 2011): the limit is higher for a mostly dry planet.
  assert.ok(runawayLimit(0.1) > runawayLimit(0.5));
  assert.equal(waterState(change(d, (c) => { c.orbit.semiMajorAu = 0.9; c.atmosphere.clouds = 0.6; }), 0.08).fate, 'liquid');
  // No water given: none to lose.
  assert.equal(waterState(change(d, (c) => { c.water.depthKm = 0; }), 0).fate, 'none');
  assert.equal(waterState(d, 0).fate, 'none');
  // Kept by hand: seas, and said to be kept.
  const kept = waterState(change(d, (c) => { c.orbit.semiMajorAu = 0.9; c.water.keep = true; }), 0.71);
  assert.equal(kept.fate, 'liquid');
  assert.equal(kept.kept, true);
  assert.equal(kept.cause, 'sunlight');
  // (Where nothing would have removed them, there is nothing to keep.)
  assert.equal(waterState(change(d, (c) => { c.water.keep = true; }), 0.71).kept, false);
  // The switch is kept with the definition of a planet of the second calculation, and is none of the first's.
  const stored = JSON.parse(JSON.stringify(change(d, (c) => { c.water.keep = true; })));
  assert.equal(definitionOf(stored)!.water.keep, true);
  assert.equal(definitionOf(JSON.parse(JSON.stringify(d)))!.water.keep, undefined);
  const first = definitionFromPreset('earthlike', 4) as unknown as { water: Record<string, unknown> };
  first.water.keep = true;
  assert.equal(definitionOf(JSON.parse(JSON.stringify(first)))!.water.keep, undefined);
});

test('what heat makes of the land, and the colour of hot rock', () => {
  assert.equal(hotSurface(30), null);
  assert.equal(hotSurface(TOO_HOT_FOR_PLANTS), 'barren');
  assert.equal(hotSurface(SCORCHED_FROM - 1), 'barren');
  assert.equal(hotSurface(SCORCHED_FROM), 'scorched');
  assert.equal(hotSurface(MOLTEN_FROM - 1), 'scorched');
  assert.equal(hotSurface(MOLTEN_FROM), 'lava');
  // The new kinds are added after the old: a stored biome's number means what it meant.
  assert.deepEqual(BIOME_IDS.slice(19, 22), ['barren', 'scorched', 'lava']);
  assert.equal(id('barren'), 19);
  // Bare rock's own colour up to 100 °C; darker as it is baked; then its own glow, brighter and yellower as it heats.
  assert.deepEqual(rockColour(20), [...BIOME.barren.colour]);
  assert.deepEqual(rockColour(100), [...BIOME.barren.colour]);
  assert.deepEqual(rockColour(250), [...BIOME.scorched.colour]);
  assert.deepEqual(rockColour(MOLTEN_FROM), [...BIOME.lava.colour]);
  const light = (c: number[]) => c[0] + c[1] + c[2];
  assert.ok(light(rockColour(450)) < light(rockColour(250)) && light(rockColour(250)) < light(rockColour(100)), 'darker as it is baked');
  let last = light(rockColour(650));
  for (const t of [800, 950, 1100, 1400, 2000, 3000, 5000]) { const l = light(rockColour(t)); assert.ok(l >= last, `no dimmer at ${t} °C`); last = l; }
  assert.ok(rockColour(900)[0] > 2 * rockColour(900)[2], 'red');
  assert.deepEqual(rockColour(9000), rockColour(3000));
});

test('temperatures in colour over all a planet can have: as before in the Earth\'s range, no colour used twice beyond it', () => {
  // Between −50 and 50 °C as it was.
  assert.deepEqual(temperatureColour(-50), [60, 20, 110]);
  assert.deepEqual(temperatureColour(15), [150, 210, 90]);
  assert.deepEqual(temperatureColour(50), [170, 30, 30]);
  // Beyond, each step of the scale is told from every other.
  const stops = [-273, -200, -100, -50, -25, 0, 15, 25, 35, 50, 100, 200, 500, 1000, 2000, 3000].map(temperatureColour);
  for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) {
    const far = Math.abs(stops[i][0] - stops[j][0]) + Math.abs(stops[i][1] - stops[j][1]) + Math.abs(stops[i][2] - stops[j][2]);
    assert.ok(far >= 28, `stops ${i} and ${j} apart (${far})`);
  }
  assert.deepEqual(temperatureColour(-400), [0, 0, 0]);
  assert.deepEqual(temperatureColour(9000), [255, 255, 255]);
  assert.equal(TEMPERATURE[0][0], -273);
  // A picture of a furnace: 60 °C and 2,000 °C in their own colours, and the legend says how the scale goes on.
  const hot = colourLayer('temperature', Float32Array.from([60, 2000]), 2, 1, { min: 60, max: 2000 });
  assert.ok(Math.abs(hot.pixels[0] - hot.pixels[4]) + Math.abs(hot.pixels[1] - hot.pixels[5]) + Math.abs(hot.pixels[2] - hot.pixels[6]) > 250);
  assert.match(hot.legend, /^Temperature at the surface: 60 °C to 2,000 °C \(above 50 °C: dark red, then purple and pink, white at 3,000 °C\)$/);
  assert.equal(colourLayer('temperature', Float32Array.from([-20, 30]), 2, 1, { min: -20, max: 30 }).legend, 'Temperature at the surface: -20 °C to 30 °C');
  assert.match(colourLayer('temperatureMonth', Float32Array.from([-180, -60]), 2, 1, { min: -180, max: -60 }).legend, /below −50 °C: violet darkening to black/);
});

test('a planet moved towards its star: the same land; a hothouse, then its seas boiled away, bare, scorched and molten', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const at = (au: number) => change(d, (c) => { c.orbit.semiMajorAu = au; });
  const earth = await planet(p, d);
  assert.equal(earth.sea.fate, 'liquid');
  assert.ok(Math.abs((earth.sea.share as number) - 0.74) < 0.05, `${earth.sea.share}`);
  assert.equal(earth.sea.liquidShare, earth.sea.share);
  assert.ok(earth.rain > 500 && earth.mean > 5 && earth.mean < 25, `${earth.mean} °C, ${earth.rain} mm`);
  assert.equal(earth.of('scorched') + earth.of('lava'), 0);

  // A hothouse (0.95 AU): the seas where they were, more rain; land whose warmest month passes 50 °C is bare.
  const hothouse = await planet(p, at(0.95));
  assert.equal(hothouse.sea.fate, 'liquid');
  assert.equal(hothouse.sea.share, earth.sea.share);
  assert.ok(hothouse.mean > earth.mean + 15 && hothouse.rain > earth.rain, `${hothouse.mean} °C, ${hothouse.rain} mm`);
  let bare = 0;
  for (let c = 0; c < n; c++) {
    const b = BIOME_IDS[hothouse.biome[c]];
    if (b === 'sea' || b === 'lake') continue;
    if (hothouse.hot[c] >= TOO_HOT_FOR_PLANTS) { assert.equal(b, 'barren', `${hothouse.hot[c]} °C`); bare++; }
    else assert.notEqual(b, 'scorched');
  }
  assert.ok(bare > 20, `land too hot for plants (${bare} cells)`);
  assert.ok(hothouse.of('swamp') + hothouse.of('rainforest') + hothouse.of('savanna') + hothouse.of('wetland') > 0.03, 'and life where it is cooler');

  // Closer (0.9 AU): the seas boiled away. The same history; the land as it was, now measured from its lowest ground.
  const boiled = await planet(p, at(0.9));
  assert.equal(p.keyOf('tectonics', at(0.9), P), p.keyOf('tectonics', d, P), 'no other land asked for');
  assert.equal(boiled.sea.fate, 'boiled');
  assert.equal(boiled.sea.cause, 'sunlight');
  assert.equal(boiled.sea.kept, false);
  assert.equal(boiled.sea.dry, true);
  assert.equal(boiled.sea.share, 0);
  assert.equal(boiled.sea.liquidShare, earth.sea.share);
  assert.ok((boiled.sea.absorbed as number) > (boiled.sea.limit as number) && boiled.sea.limit === 282);
  const hw = earth.sea.heights as Int16Array, hd = boiled.sea.heights as Int16Array;
  let lo = Infinity, hi = -Infinity, lowest = Infinity;
  for (let c = 0; c < n; c++) { const by = hd[c] - hw[c]; lo = Math.min(lo, by); hi = Math.max(hi, by); lowest = Math.min(lowest, hd[c]); }
  assert.ok(hi - lo <= 1, `every place higher by the same (${lo} to ${hi} m)`);
  assert.equal(lowest, 0);
  // No rain, no rivers, lakes or ice, no snow; nothing but rock.
  assert.equal(boiled.rain, 0);
  assert.ok((boiled.W.kind as Uint8Array).every((k) => k === 0), 'no water of any kind');
  assert.ok((boiled.W.ice as Float32Array).every((v) => v === 0) && (boiled.T.ice as Float32Array).every((v) => v === 0), 'no ice or snow');
  assert.equal(boiled.of('sea'), 0);
  assert.ok(Math.abs(boiled.of('barren') + boiled.of('scorched') - 1) < 1e-9, 'bare rock');
  // Its temperature is a dry planet's: with no vapour in the air, far below what boiled the seas, and near the
  // figure worked out for the planet as a whole.
  const dry = derive({ ...at(0.9), water: { ...d.water, oceanFraction: 0 } });
  assert.ok(Math.abs(boiled.mean - (dry.surfaceK - 273.15)) < 12, `${boiled.mean} °C against ${dry.surfaceK - 273.15}`);
  assert.ok(boiled.mean < 40);

  // Closer still: scorched rock everywhere (0.3 AU, about 200 °C), then rock that melts (0.03 AU).
  const scorched = await planet(p, at(0.3));
  assert.ok(scorched.of('scorched') > 0.99, `${scorched.of('scorched')}`);
  assert.ok(scorched.mean > 150 && scorched.mean < 250, `${scorched.mean} °C`);
  const colour = scorched.B.colour as Uint8Array;
  // Coloured by its heat, and by its crust: the basalt of what were ocean floors darker than the continents' rock.
  const crust = scorched.sea.crust as Uint8Array;
  let floors = 0, lands = 0;
  for (let c = 0; c < n; c++) {
    const tone = crust[c] === 1 ? 0.76 : crust[c] === 3 ? 0.9 : 1.08, rock = rockColour(scorched.hot[c]);
    if (c % 97 === 0) assert.deepEqual([colour[3 * c], colour[3 * c + 1], colour[3 * c + 2]], rock.map((v) => Math.min(255, Math.round(v * tone))));
    if (crust[c] === 1) floors++; else if (crust[c] === 2) lands++;
  }
  assert.ok(floors > n / 4 && lands > n / 10, `ocean floors and continents (${floors}, ${lands} cells)`);
  const molten = await planet(p, at(0.03));
  assert.ok(molten.of('lava') > 0.5 && molten.of('lava') + molten.of('scorched') > 0.999, `${molten.of('lava')}`);
  assert.ok(molten.mean > 1000 && molten.mean < 1600, `${molten.mean} °C`);
  // (Molten, the rock's own glow is all there is to see: no darker over the old ocean floors.)
  const glow = molten.B.colour as Uint8Array;
  for (let c = 0; c < n; c += 97) if (molten.hot[c] >= MOLTEN_FROM) assert.deepEqual([glow[3 * c], glow[3 * c + 1], glow[3 * c + 2]], rockColour(molten.hot[c]));
  // Each step hotter than the one before; all on the same land.
  assert.ok(scorched.mean > boiled.mean + 100 && molten.mean > scorched.mean + 500);
  assert.deepEqual([...(molten.sea.heights as Int16Array)], [...hd]);

  // A place clicked on the scorched planet: said why.
  const none = new Uint8Array(n), zero = new Float32Array(n), def3 = at(0.3);
  const text = explain({
    mesh, def: def3, x: derive({ ...def3, water: { ...def3.water, oceanFraction: 0 } }), heights: scorched.sea.heights as Int16Array, dry: true,
    kinds: none, age: zero, thickness: zero, tags: none, boundary: none, boundaryRate: zero,
    climate: scorched.C as never, water: scorched.W as never, biomes: scorched.B as never,
  }, 100);
  assert.match(text.title, /m above the planet's lowest ground$/);
  const said = text.sections.flatMap((sec) => sec.lines).join(' ');
  assert.match(said, /Scorched rock: its warmest month reaches \d+ °C; no water lies on ground hotter than 100 °C/);
  assert.match(said, /no rain or snow: the planet has no water\./);
  assert.doesNotMatch(said, /Shaped by|rain shadow|convergence zone/);
});

test('too strong a greenhouse; the seas kept by hand; a planet like Venus; a dry planet\'s temperatures', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  // A hundred times the carbon dioxide at the Earth's distance: the seas gone, bare rock, warm but not scorched.
  const thick = await planet(p, change(d, (c) => { c.atmosphere.co2 = 0.04; }));
  assert.equal(thick.sea.fate, 'boiled');
  assert.equal(thick.sea.cause, 'greenhouse');
  assert.equal(thick.rain, 0);
  assert.ok(thick.mean > 0 && thick.mean < 60, `${thick.mean} °C`);
  // Kept by hand at 0.9 AU: the seas where they stood, and said to be kept; the temperatures those with them there.
  const kept = await planet(p, change(d, (c) => { c.orbit.semiMajorAu = 0.9; c.water.keep = true; }));
  const earth = (await p.product('sea', d, P)).data;
  assert.equal(kept.sea.fate, 'liquid');
  assert.equal(kept.sea.kept, true);
  assert.equal(kept.sea.dry, false);
  assert.equal(kept.sea.share, earth.share);
  assert.deepEqual([...(kept.sea.heights as Int16Array)], [...(earth.heights as Int16Array)]);
  assert.ok(Math.abs(kept.of('sea') - (earth.share as number)) < 0.02, `${kept.of('sea')} of the surface is sea`);
  assert.ok(kept.mean > 500, `${kept.mean} °C`);
  // Like Venus: no water to lose, a crushing carbon dioxide air under bright clouds; near Venus's 464 °C, all scorched.
  const venus = await planet(p, newDefinition('hothouse', 4));
  assert.equal(venus.sea.fate, 'none');
  assert.ok(venus.mean > 420 && venus.mean < 520, `${venus.mean} °C`);
  assert.ok(venus.of('scorched') > 0.999);
  // A dry planet at the Earth's distance: no snow however cold; its mean near the figure for the planet as a whole;
  // its lowlands warmer than its highlands.
  const desert = change(d, (c) => { c.water.depthKm = 0; });
  const dry = await planet(p, desert);
  assert.equal(dry.sea.fate, 'none');
  assert.ok((dry.T.ice as Float32Array).every((v) => v === 0), 'no snow');
  const whole = derive({ ...desert, water: { ...desert.water, oceanFraction: 0 } }).surfaceK - 273.15;
  assert.ok(Math.abs(dry.mean - whole) < 12, `${dry.mean} °C against ${whole}`);
  const h = dry.sea.heights as Int16Array, monthly = dry.C.monthly as Float32Array;
  let low = 0, lowN = 0, high = 0, highN = 0, meanH = 0;
  for (let c = 0; c < n; c++) meanH += (h[c] * A[c]) / (4 * Math.PI);
  for (let c = 0; c < n; c++) {
    if (Math.abs(mesh.lat[c]) > 0.5) continue;
    let t = 0;
    for (let m = 0; m < 12; m++) t += monthly[m * n + c] / 12;
    if (h[c] < meanH - 1500) { low += t; lowN++; } else if (h[c] > meanH + 1500) { high += t; highN++; }
  }
  assert.ok(lowN > 5 && highN > 5 && low / lowN > high / highN + 5, `lowlands ${low / lowN} °C, highlands ${high / highN} °C`);
});

test('the first calculation as it was: its seas whatever the heat, none of the new kinds of ground', async () => {
  const p = new Pipeline(new LocalExecutor());
  const d = definitionFromPreset('earthlike', 4);
  d.orbit.semiMajorAu = 0.3;
  const params = { level: 4, durationMyr: 200, frameEveryMyr: 25 };
  const biome = (await p.product('biomes', d, params)).data.biome as Uint8Array;
  let sea = 0;
  for (let c = 0; c < n; c++) { if (biome[c] === id('sea')) sea += A[c] / (4 * Math.PI); assert.ok(biome[c] <= id('barren')); }
  assert.ok(sea > 0.6 && sea < 0.8, `${sea}`);
  // (Its stages are the versions they were: what a map of it was made from is asked for under the same keys.)
  assert.deepEqual(['temperature', 'climate', 'water', 'biomes', 'cover'].map((s) => STAGES[s as keyof typeof STAGES].version), [1, 3, 1, 1, STAGES.cover.version]);
});
