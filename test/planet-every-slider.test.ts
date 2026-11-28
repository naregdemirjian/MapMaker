// The slider test (D268): every setting of the Planet Studio, moved from its lowest to its highest with the others an
// Earth's, changes the planet by a measurable amount, on the same land unless the land is made from it; and what
// changed is said by the setting's name with the figures that moved. (The user's first finding: "Moving the sliders,
// even heavily, barely changes how the map looks.")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDefinition, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { familyOf, figuresOf, settingsChanged, whatChanged, type Figures, type ModelFacts, type SeaFacts } from '../src/planet/why.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const mesh = meshAt(4), n = mesh.n, A = mesh.area;

interface Made { biome: Uint8Array; colour: Uint8Array; heights: Int16Array; level: number; figures: Figures }
async function made(p: Pipeline, d: PlanetDefinition): Promise<Made> {
  const sea = (await p.product('sea', d, P)).data, T = (await p.product('temperature', d, P)).data, C = (await p.product('climate', d, P)).data, B = (await p.product('biomes', d, P)).data;
  const facts: ModelFacts = { surfaceC: T.surfaceC as number, absorbed: T.absorbed as number, seaFrozen: T.seaFrozen as number, capShare: (T.capShare as number | undefined) ?? 0, rainMm: C.meanPrecip as number, shares: B.shares as Float32Array };
  return { biome: B.biome as Uint8Array, colour: B.colour as Uint8Array, heights: sea.heights as Int16Array, level: sea.level as number, figures: figuresOf(sea as unknown as SeaFacts, facts) };
}
/** Between two planets: the shares of the surface of another kind (family), of another colour, and swapped between land and sea; and whether the land itself is the same. */
function apart(x: Made, y: Made) {
  let kind = 0, colour = 0, swapped = 0, sameLand = true;
  for (let c = 0; c < n; c++) {
    const w = A[c] / (4 * Math.PI);
    if (familyOf(x.biome[c]) !== familyOf(y.biome[c])) kind += w;
    if (Math.abs(x.colour[3 * c] - y.colour[3 * c]) + Math.abs(x.colour[3 * c + 1] - y.colour[3 * c + 1]) + Math.abs(x.colour[3 * c + 2] - y.colour[3 * c + 2]) > 30) colour += w;
    if ((x.heights[c] < 0) !== (y.heights[c] < 0)) swapped += w;
    // (The land's own height: against the sea, plus where the sea stands; but for heights beyond what is kept.)
    if (Math.abs(x.heights[c]) < 31_000 && Math.abs(y.heights[c]) < 31_000 && Math.abs(x.heights[c] + x.level - (y.heights[c] + y.level)) > 2) sameLand = false;
  }
  return { kind, colour, swapped, sameLand };
}

type Set = (d: PlanetDefinition) => void;
/** A setting: its name as "What changed" says it, its lowest and highest (and a middle one where both ends are alike), and the least it must do. */
interface Slider { name: string; lo: Set; hi: Set; mid?: Set; least: { kind?: number; colour?: number; swapped?: number }; land?: boolean }

const FAST: Slider[] = [
  { name: 'The star\'s mass', lo: (d) => { d.star.stars[0].massSun = 0.1; }, hi: (d) => { d.star.stars[0].massSun = 3; }, least: { kind: 0.9 } },
  { name: 'Distance', lo: (d) => { d.orbit.semiMajorAu = 0.02; }, hi: (d) => { d.orbit.semiMajorAu = 10; }, least: { kind: 0.9 } },
  { name: 'Eccentricity', lo: (d) => { d.orbit.eccentricity = 0; }, hi: (d) => { d.orbit.eccentricity = 0.6; }, least: { kind: 0.5 } },
  { name: 'Tilt', lo: (d) => { d.body.tiltDeg = 0; }, hi: (d) => { d.body.tiltDeg = 90; }, least: { kind: 0.2 } },
  { name: 'Day', lo: (d) => { d.body.dayHours = 2; }, hi: (d) => { d.body.dayHours = 6000; }, least: { kind: 0.2 } },
  { name: 'Locked to its star', lo: (d) => { d.body.tidallyLocked = false; }, hi: (d) => { d.body.tidallyLocked = true; }, least: { kind: 0.2 } },
  { name: 'Air', lo: (d) => { d.atmosphere.pressureBar = 0; }, hi: (d) => { d.atmosphere.pressureBar = 100; }, least: { kind: 0.5 } },
  { name: 'Carbon dioxide', lo: (d) => { d.atmosphere.co2 = 1e-6; }, hi: (d) => { d.atmosphere.co2 = 0.97; }, least: { kind: 0.9 } },
  { name: 'Cloud cover', lo: (d) => { d.atmosphere.clouds = 0; }, hi: (d) => { d.atmosphere.clouds = 1; }, least: { kind: 0.2 } },
  { name: 'Water', lo: (d) => { d.water.depthKm = 0.01; }, hi: (d) => { d.water.depthKm = 12; }, least: { kind: 0.8 } },
  { name: 'Plants', lo: () => {}, hi: (d) => { d.life.vegetation = 'none'; }, least: { kind: 0.15 } },
  // (The plants' colour: no kind of surface changes, the colour of the plant cover does.)
  { name: 'Plants', lo: () => {}, hi: (d) => { d.life.vegetation = 'red-dwarf'; }, least: { colour: 0.15 } },
  // (Under "More": the clouds' brightness and the methane.)
  { name: 'The clouds\' brightness', lo: (d) => { d.atmosphere.cloudAlbedo = 0; }, hi: (d) => { d.atmosphere.cloudAlbedo = 1; }, least: { kind: 0.5 } },
  { name: 'Methane', lo: (d) => { d.atmosphere.ch4 = 0; }, hi: (d) => { d.atmosphere.ch4 = 1e-3; }, least: { kind: 0.5 } },
];
const LAND: Slider[] = [
  { name: 'Radius', lo: (d) => { d.body.radiusKm = 1000; }, hi: (d) => { d.body.radiusKm = 16_000; }, least: { kind: 0.9 }, land: true },
  { name: 'The interior\'s heat', lo: (d) => { d.interior.heatProduction = 0; }, hi: (d) => { d.interior.heatProduction = 5; }, least: { swapped: 0.2 }, land: true },
  { name: 'Plates', lo: (d) => { d.tectonics.plates = 2; }, hi: (d) => { d.tectonics.plates = 30; }, least: { swapped: 0.2 }, land: true },
  { name: 'Tectonic activity', lo: (d) => { d.tectonics.activity = 0; }, hi: (d) => { d.tectonics.activity = 3; }, least: { swapped: 0.2 }, land: true },
  // (With the same water, no continental crust and nearly all of it both leave little land: the middle is the Earth's.)
  { name: 'Continents', lo: (d) => { d.tectonics.continentalFraction = 0; }, hi: (d) => { d.tectonics.continentalFraction = 0.9; }, mid: (d) => { d.tectonics.continentalFraction = 0.4; }, least: { swapped: 0.15 }, land: true },
  { name: 'Hotspots', lo: (d) => { d.tectonics.hotspots = 0; }, hi: (d) => { d.tectonics.hotspots = 40; }, least: { swapped: 0.2 }, land: true },
  { name: 'Age', lo: (d) => { d.history.ageGyr = 0.1; }, hi: (d) => { d.history.ageGyr = 10; }, least: { kind: 0.5 }, land: true },
  { name: 'Seed', lo: () => {}, hi: (d) => { d.seed = 5; }, least: { swapped: 0.2 }, land: true },
  { name: 'The core\'s share', lo: (d) => { d.interior.coreFraction = 0; }, hi: (d) => { d.interior.coreFraction = 0.8; }, least: { swapped: 0.15 }, land: true },
];

async function tried(p: Pipeline, s: Slider) {
  const base = newDefinition('earthlike', 4), a = structuredClone(base), b = structuredClone(base);
  s.lo(a); s.hi(b);
  const x = await made(p, a), y = await made(p, b);
  let d = apart(x, y), from = x, defFrom = a;
  if (s.mid) {
    // (Both ends alike: the middle against the highest.)
    const m = structuredClone(base); s.mid(m);
    from = await made(p, m); defFrom = m; d = apart(from, y);
  }
  const settings = settingsChanged(defFrom, b);
  return { d, settings, said: whatChanged(from.figures, y.figures, settings), from: from.figures, to: y.figures };
}

test('every setting that keeps the land: from its lowest to its highest the planet is another, on the same land; named, with what moved', async () => {
  const p = new Pipeline(new LocalExecutor());
  for (const s of FAST) {
    const r = await tried(p, s), what = `${s.name}: ${(100 * r.d.kind).toFixed(0)} % another kind, ${(100 * r.d.colour).toFixed(0)} % another colour`;
    assert.ok(r.d.kind >= (s.least.kind ?? 0) && r.d.colour >= (s.least.colour ?? 0), what);
    assert.equal(r.d.sameLand, true, `${s.name}: the same land under it`);
    assert.deepEqual(r.settings.map((c) => c.name), [s.name], 'named in what changed');
    assert.ok(r.settings[0].before !== r.settings[0].after && `${r.settings[0].before}${r.settings[0].after}`.length > 0);
    assert.ok(r.said.length >= 1, `${s.name}: what moved is said (${r.said.join(' | ')})`);
  }
});

test('every setting the land is made from: other land, or another world; named, with what moved', async () => {
  const p = new Pipeline(new LocalExecutor());
  for (const s of LAND) {
    const r = await tried(p, s), what = `${s.name}: ${(100 * r.d.kind).toFixed(0)} % another kind, ${(100 * r.d.swapped).toFixed(0)} % between land and sea`;
    assert.ok(r.d.kind >= (s.least.kind ?? 0) && r.d.swapped >= (s.least.swapped ?? 0), what);
    assert.equal(r.d.sameLand, false, `${s.name}: other land`);
    assert.deepEqual(r.settings.map((c) => c.name), [s.name], 'named in what changed');
    assert.ok(r.said.length >= 1, `${s.name}: what moved is said`);
  }
});

test('what a change did, in full: scorched and molten rock among the figures; the plants\' colour said where nothing else moved; the other settings by name', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const set = (f: Set) => { const c = structuredClone(d); f(c); return c; };
  // No air against a hundred bar: bare rock, then scorched rock (each said, not lumped as rock).
  const none = set((c) => { c.atmosphere.pressureBar = 0; }), thick = set((c) => { c.atmosphere.pressureBar = 100; });
  const a = await made(p, none), b = await made(p, thick);
  const said = whatChanged(a.figures, b.figures);
  assert.ok(said.some((l) => /^Bare rock 100 % → \d+ %$/.test(l)) && said.some((l) => /^Scorched rock none → \d+ %$/.test(l)), said.join(' | '));
  // A lava world against an Earth: molten rock.
  const lava = await made(p, newDefinition('lava', 4)), earth = await made(p, d);
  assert.ok(whatChanged(earth.figures, lava.figures).some((l) => /^Molten rock none → \d+ %$/.test(l)));
  // The plants' colour alone.
  const red = set((c) => { c.life.vegetation = 'red-dwarf'; }), settings = settingsChanged(d, red);
  assert.deepEqual(whatChanged(earth.figures, (await made(p, red)).figures, settings), ['The colour of its plants: green → dark red']);
  assert.deepEqual(whatChanged(earth.figures, earth.figures, settings.filter((c) => c.name !== 'Plants')), []);
  // The settings under "More" and those set by hand, each by its name.
  const name = (f: Set) => settingsChanged(d, set(f)).map((c) => `${c.name}: ${c.before} → ${c.after}`);
  assert.deepEqual(name((c) => { c.orbit.perihelionDeg = 180; }), ['The season at the nearest point: 283° → 180°']);
  assert.deepEqual(name((c) => { c.interior.coreFraction = 0.5; }), ['The core\'s share: 0.33 → 0.50']);
  assert.deepEqual(name((c) => { c.body.massEarths = 2; }), ['The mass, set by hand: none → 2.00 Earths']);
  assert.deepEqual(name((c) => { c.orbit.yearDays = 400; }), ['The year, set by hand: none → 400.0 days']);
  assert.deepEqual(name((c) => { c.star.stars[0].luminositySun = 1.5; }), ['The star\'s light, set by hand: none → 1.500 × the Sun\'s']);
  assert.deepEqual(name((c) => { c.star.stars[0].teffK = 4000; }), ['The star\'s surface temperature, set by hand: none → 4,000 K']);
  assert.deepEqual(name((c) => { c.simulation.spanMyr = 300; }), ['Simulated: 500 million years → 300 million years']);
  assert.deepEqual(name((c) => { c.life.biomeSet = 'custom'; }), ['Biomes: the Earth\'s → the planet\'s own']);
});
