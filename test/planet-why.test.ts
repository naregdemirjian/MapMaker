// Why a planet looks as it does (D263): the chain of causes from its star to its surface, read from the products its
// pictures are made of; the surface in a few words; what a change did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDefinition, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { BIOME_IDS } from '../src/planet/life/biomes.ts';
import { FAMILIES, FAMILY_IDS, familyOf, familyShares, figuresOf, settingsChanged, surfaceInWords, whatChanged, whyItLooksSo, type ModelFacts, type SeaFacts } from '../src/planet/why.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };
const shares = (of: Record<string, number>) => { const s = new Float32Array(BIOME_IDS.length); for (const [k, v] of Object.entries(of)) s[BIOME_IDS.indexOf(k as never)] = v; return s; };

/** A planet's facts as the Studio gathers them. */
async function facts(p: Pipeline, def: PlanetDefinition) {
  const s = (await p.product('sea', def, P)).data, t = (await p.product('temperature', def, P)).data, c = (await p.product('climate', def, P)).data, b = (await p.product('biomes', def, P)).data;
  const sea = s as unknown as SeaFacts;
  const model: ModelFacts = {
    surfaceC: t.surfaceC as number, absorbed: t.absorbed as number, seaFrozen: t.seaFrozen as number, capShare: (t.capShare as number | undefined) ?? 0,
    ...(t.dayHigh ? { dayC: t.dayC as number, nightC: t.nightC as number } : {}), rainMm: c.meanPrecip as number, shares: b.shares as Float32Array,
  };
  const x = derive({ ...def, atmosphere: { ...def.atmosphere, pressureBar: sea.pressureBar }, water: { ...def.water, oceanFraction: sea.share } });
  return { sea, model, x, why: whyItLooksSo(def, x, sea, model) };
}
const link = (why: Array<{ key: string; cause: string; effect: string }>, key: string) => why.find((w) => w.key === key)!;

test('the surface in a few words: each kind in one family; the families from the largest', () => {
  // Every kind of surface belongs to exactly one family.
  const seen = new Map<string, number>();
  for (const f of FAMILY_IDS) for (const b of FAMILIES[f].of) seen.set(b, (seen.get(b) ?? 0) + 1);
  for (const b of BIOME_IDS) assert.equal(seen.get(b), 1, b);
  assert.equal(familyOf(BIOME_IDS.indexOf('seaIce')), 'ice');
  assert.equal(familyOf(BIOME_IDS.indexOf('lake')), 'sea');
  assert.equal(familyOf(BIOME_IDS.indexOf('savanna')), 'grass');
  const fam = familyShares(shares({ sea: 0.6, seaIce: 0.05, ice: 0.05, rainforest: 0.1, boreal: 0.05, desert: 0.08, steppe: 0.07 }));
  assert.ok(Math.abs(fam.sea - 0.6) < 1e-6 && Math.abs(fam.ice - 0.1) < 1e-6 && Math.abs(fam.forest - 0.15) < 1e-6 && Math.abs(fam.grass - 0.07) < 1e-6 && Math.abs(fam.desert - 0.08) < 1e-6);
  assert.equal(surfaceInWords(shares({ sea: 0.6, seaIce: 0.05, ice: 0.05, rainforest: 0.1, boreal: 0.05, desert: 0.08, steppe: 0.07 })), 'Open sea 60 %, forest 15 %, ice 10 %, desert 8 %, grass and scrub 7 %');
  assert.equal(surfaceInWords(shares({ barren: 1 })), 'Bare rock everywhere');
  assert.equal(surfaceInWords(shares({ lava: 0.995, scorched: 0.005 })), 'Molten rock everywhere');
  assert.equal(surfaceInWords(shares({ scorched: 0.7, barren: 0.296, ice: 0.004 })), 'Scorched rock 70 %, bare rock 30 %');
});

test('the chain of causes: an Earth; its seas boiled away; frozen over; with no air; too small for its air; before its climate is worked out', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  // An Earth: from its star to its surface, in order.
  const earth = await facts(p, d);
  assert.deepEqual(earth.why.map((w) => w.key), ['light', 'air', 'water', 'warmth', 'rain', 'surface']);
  assert.equal(link(earth.why, 'light').cause, 'A G2 star 1.00 × as bright as the Sun, 1.00 AU away');
  assert.equal(link(earth.why, 'light').effect, 'Sunlight 1.00 × the Earth\'s (1,361 W/m²)');
  assert.match(link(earth.why, 'air').cause, /^Gravity 0\.99 g holds its air \(escape speed 11\.\d km\/s, 5\.5 needed\)$/);
  assert.equal(link(earth.why, 'air').effect, '1.0 bar of air, 0.04 % of it carbon dioxide');
  assert.match(link(earth.why, 'water').cause, /^2\.6\d km of water \(1\.00 × the Earth's\) filling the land's hollows$/);
  assert.match(link(earth.why, 'water').effect, /^Seas on 7\d % of the surface, \d+ % of them under ice$/);
  assert.match(link(earth.why, 'warmth').cause, /^It takes in 23\d W\/m² \(it sends back 3\d % of its light\); its air holds in 3\d °C of warmth$/);
  assert.match(link(earth.why, 'warmth').effect, /^1\d °C on average$/);
  assert.match(link(earth.why, 'rain').effect, /^1,\d\d\d mm of rain and snow a year on average$/);
  assert.equal(link(earth.why, 'rain').cause, 'Warm seas give the air its vapour');
  assert.match(link(earth.why, 'surface').effect, /^Open sea 7\d %, .*forest \d+ %/);
  assert.equal(link(earth.why, 'surface').cause, 'Plants where it is warm and wet enough, ice where it is cold, desert where it is dry');
  // Before its climate is worked out: the links it does not decide.
  assert.deepEqual(whyItLooksSo(d, earth.x, earth.sea, null).map((w) => w.key), ['light', 'air', 'water']);
  assert.match(whyItLooksSo(d, earth.x, earth.sea, null)[2].effect, /^Seas on 7\d % of the surface$/);
  // Moved towards its star: the seas boiled away, with the numbers that decided; no rain; bare rock.
  const hot = await facts(p, change(d, (c) => { c.orbit.semiMajorAu = 0.9; }));
  assert.match(link(hot.why, 'water').cause, /^With seas it would take in 29\d W\/m²; a planet with seas can shed no more than 27\d$/);
  assert.equal(link(hot.why, 'water').effect, 'The seas boiled away and the water was lost to space');
  assert.deepEqual([link(hot.why, 'rain').cause, link(hot.why, 'rain').effect], ['No water to fall', 'No rain or snow']);
  assert.equal(link(hot.why, 'surface').effect, 'Bare rock everywhere');
  assert.equal(link(hot.why, 'surface').cause, 'No rain, so nothing grows and nothing wears the rock');
  // Moved away: frozen over; the ice sends the light back.
  const cold = await facts(p, change(d, (c) => { c.orbit.semiMajorAu = 1.25; }));
  assert.match(link(cold.why, 'water').effect, /^Seas on 7\d % of the surface, all of them frozen over$/);
  assert.match(link(cold.why, 'warmth').cause, /it sends back [56]\d % of its light: ice and cloud/);
  assert.equal(link(cold.why, 'rain').cause, 'Frozen seas give the air little vapour');
  assert.equal(link(cold.why, 'surface').cause, 'Too cold for anything but ice');
  assert.match(link(cold.why, 'surface').effect, /^Ice 9\d %/);
  // No air: said so; the seas into vapour; the ground following the sun.
  const bare = await facts(p, change(d, (c) => { c.atmosphere.pressureBar = 0; }));
  assert.deepEqual([link(bare.why, 'air').cause, link(bare.why, 'air').effect], ['Given no air', 'No air: nothing to hold heat or carry it']);
  assert.match(link(bare.why, 'water').cause, /^Under no air water is never liquid \(it needs 0\.006 bar\), and ice does not last where the sun is high/);
  assert.equal(link(bare.why, 'water').effect, 'The seas went into vapour and were lost: nowhere is cold enough for ice');
  assert.match(link(bare.why, 'warmth').cause, /no air to hold warmth in$/);
  assert.match(link(bare.why, 'warmth').effect, /; with so little air the ground follows the sun: \d+ °C by day, -\d+ °C by night at the equator$/);
  assert.equal(link(bare.why, 'rain').cause, 'No air to carry vapour, no open water to give it');
  // Too small for its air.
  const small = await facts(p, change(d, (c) => { c.body.radiusKm = 1737; }));
  assert.match(link(small.why, 'air').cause, /^Gravity 0\.\d\d g: it needs an escape speed of 5\.5 km\/s to hold air under this light and has 2\.\d$/);
  assert.equal(link(small.why, 'air').effect, 'No air: it leaked away to space');
  // Scorched and molten.
  const scorched = await facts(p, change(d, (c) => { c.orbit.semiMajorAu = 0.3; }));
  assert.deepEqual([link(scorched.why, 'surface').cause, link(scorched.why, 'surface').effect], ['Too hot for water to lie on the ground (over 100 °C)', 'Scorched rock everywhere']);
  // Plants given none: said.
  const lifeless = await facts(p, change(d, (c) => { c.life.vegetation = 'none'; }));
  assert.equal(link(lifeless.why, 'surface').cause, 'Warmth and rain enough for plants, but no life given');
});

test('what a change did: each figure that moved, before and after', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const earth = await facts(p, d), hot = await facts(p, change(d, (c) => { c.orbit.semiMajorAu = 0.9; })), tilted = await facts(p, change(d, (c) => { c.body.tiltDeg = 24; }));
  const a = figuresOf(earth.sea, earth.model), b = figuresOf(hot.sea, hot.model);
  assert.ok(a.sea > 0.6 && a.forest > 0.03 && a.rainMm > 500 && b.sea === 0 && b.rock > 0.99 && b.rainMm === 0);
  const said = whatChanged(a, b);
  assert.match(said[0], /^Temperature 1\d °C → -?\d+ °C$/);
  assert.ok(said.some((l) => /^Open sea 7\d % → none$/.test(l)), said.join(' | '));
  assert.ok(said.some((l) => /^Forest \d+ % → none$/.test(l)));
  assert.ok(said.some((l) => /^Bare rock none → 100 %$/.test(l)));
  assert.ok(said.some((l) => /^Rain and snow 1,\d\d\d → 0 mm a year$/.test(l)));
  // Nothing moved: nothing said. A small change: little said.
  assert.deepEqual(whatChanged(a, a), []);
  assert.ok(whatChanged(a, figuresOf(tilted.sea, tilted.model)).length <= 3);
});

test('the settings that differ between two planets: each by its name, with its value before and after', () => {
  const d = newDefinition('earthlike', 4);
  assert.deepEqual(settingsChanged(d, structuredClone(d)), []);
  assert.deepEqual(settingsChanged(d, change(d, (c) => { c.orbit.semiMajorAu = 0.897; })), [{ name: 'Distance', before: '1.000 AU', after: '0.897 AU' }]);
  assert.deepEqual(settingsChanged(d, change(d, (c) => { c.atmosphere.pressureBar = 0; c.atmosphere.co2 = 0.04; })), [
    { name: 'Air', before: '1.01 bar', after: 'none' }, { name: 'Carbon dioxide', before: '0.042 %', after: '4.0 %' },
  ]);
  assert.deepEqual(settingsChanged(d, change(d, (c) => { c.water.keep = true; c.life.vegetation = 'none'; c.body.tiltDeg = 60; })), [
    { name: 'Tilt', before: '23.4°', after: '60.0°' }, { name: 'Seas kept by hand', before: 'no', after: 'yes' }, { name: 'Plants', before: 'earth', after: 'none' },
  ]);
  assert.deepEqual(settingsChanged(d, change(d, (c) => { c.water.depthKm = 6.14; c.tectonics.plates = 20; c.seed = 9; })), [
    { name: 'Water', before: '2.61 km', after: '6.14 km' }, { name: 'Plates', before: '12', after: '20' }, { name: 'Seed', before: '4', after: '9' },
  ]);
  // Something the sliders do not set (a planet's own biomes): said to be other settings.
  assert.deepEqual(settingsChanged(d, change(d, (c) => { c.name = 'Another'; })), [{ name: 'Other settings', before: '', after: '' }]);
});
