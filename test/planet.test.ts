// Generated planets (Stage 8, D97): the same settings always make the same planet, the sea covers the
// share asked for, the presets differ, settings are checked, and a planet map is created, made anew
// and undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { terrainSourceOf, terrainLook, planetOf, seaLevelPoints } from '../src/world-model/world-settings.ts';
import { generatePlanet, generatePlanetAsync, planetParamsOf, planetKey, simplex3, random, craters, PLANET_PRESETS, type PlanetPreset } from '../src/terrain/planet.ts';
import { planetPreview } from '../src/terrain/planet-preview.ts';

const W = 192, H = 96;
const hash = (a: Int16Array) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
/** The share of the surface below sea level, by area. */
const seaShare = (g: { width: number; height: number; data: Int16Array }) => {
  let sea = 0, all = 0;
  for (let j = 0; j < g.height; j++) {
    const w = Math.cos(Math.PI / 2 - ((j + 0.5) / g.height) * Math.PI);
    for (let i = 0; i < g.width; i++) { all += w; if (g.data[j * g.width + i] < 0) sea += w; }
  }
  return sea / all;
};

test('noise and randomness are seeded: the same seed gives the same numbers', () => {
  const a = random(5), b = random(5), c = random(6);
  const xs = [a(), a(), a()];
  assert.deepEqual([b(), b(), b()], xs);
  assert.notDeepEqual([c(), c(), c()], xs);
  for (const v of xs) assert.ok(v >= 0 && v < 1);
  const n1 = simplex3(3), n2 = simplex3(3), n3 = simplex3(4);
  assert.equal(n1(0.3, 1.7, -2.2), n2(0.3, 1.7, -2.2));
  assert.notEqual(n1(0.3, 1.7, -2.2), n3(0.3, 1.7, -2.2));
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 2000; k++) { const v = n1(k * 0.37, k * 0.11, -k * 0.23); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= -1.01 && hi <= 1.01 && hi - lo > 1, `noise within about [-1, 1] (${lo}, ${hi})`);
});

test('the same settings make the same planet; another seed another planet', async () => {
  const p = planetParamsOf({ seed: 1234, preset: 'earthlike' })!;
  const a = generatePlanet(p, W, H), b = generatePlanet(p, W, H);
  assert.equal(hash(a.data), hash(b.data));
  const c = await generatePlanetAsync(p, W, H);
  assert.equal(hash(c.data), hash(a.data), 'made a few rows at a time, the same planet');
  assert.notEqual(hash(generatePlanet({ ...p, seed: 1235 }, W, H).data), hash(a.data));
  assert.notEqual(hash(generatePlanet({ ...p, mountains: 1.5 }, W, H).data), hash(a.data));
  assert.equal(planetKey(p), planetKey(planetParamsOf({ ...p })!));
  assert.notEqual(planetKey(p), planetKey({ ...p, seed: 1235 }));
});

test('the sea covers the share of the surface asked for; heights stay within those of a real planet', () => {
  for (const sea of [0.1, 0.5, 0.7, 0.95]) {
    const g = generatePlanet(planetParamsOf({ seed: 77, preset: 'earthlike', sea })!, W, H);
    assert.ok(Math.abs(seaShare(g) - sea) < 0.02, `sea ${sea}: ${seaShare(g).toFixed(3)}`);
    let lo = Infinity, hi = -Infinity;
    for (const v of g.data) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert.ok(lo >= -11000 && hi <= 9000 && lo < -1000 && hi > 1000, `${lo} to ${hi} m`);
  }
  // A world without a sea (a moon, a gas giant): all of it above.
  for (const preset of ['moon', 'gas'] as PlanetPreset[]) assert.equal(seaShare(generatePlanet(planetParamsOf({ seed: 3, preset })!, W, H)), 0, preset);
});

test('presets differ; ice caps raise the land towards the poles; craters are bowls with rims', () => {
  const made = new Map<string, string>();
  for (const preset of Object.keys(PLANET_PRESETS) as PlanetPreset[]) made.set(preset, hash(generatePlanet(planetParamsOf({ seed: 9, preset })!, W, H).data));
  assert.equal(new Set(made.values()).size, made.size, 'every preset makes another planet');
  const base = planetParamsOf({ seed: 21, preset: 'earthlike', ice: 0, sea: 0.3 })!;
  const meanLandNearPoles = (ice: number) => {
    const g = generatePlanet({ ...base, ice }, W, H);
    let s = 0, n = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < W; i++) { const v = g.data[j * W + i]; if (v > 0) { s += v; n++; } }
    return n ? s / n : 0;
  };
  assert.ok(meanLandNearPoles(0.8) > meanLandNearPoles(0) + 500, 'ice caps on polar land');
  // Craters on a level plain: bowls below it with raised rims around them, many small and a few large.
  const plain = new Float32Array(W * H);
  craters(plain, W, H, random(4), 0.7);
  let bowls = 0, rims = 0;
  for (const v of plain) { if (v < -0.05) bowls++; else if (v > 0.01) rims++; }
  assert.ok(bowls > W * H * 0.05 && rims > W * H * 0.05, `bowls (${bowls} cells) and rims (${rims} cells)`);
});

test('settings are checked and completed from their preset', () => {
  assert.equal(planetParamsOf(null), null);
  const p = planetParamsOf({ seed: -42.6, preset: 'volcanic', sea: 3, continents: 40, mountains: -1, roughness: 'rough' })!;
  assert.equal(p.seed, 43);
  assert.equal(p.preset, 'volcanic');
  assert.equal(p.sea, 0.98);
  assert.equal(p.continents, 12);
  assert.equal(p.mountains, 0);
  assert.equal(p.roughness, PLANET_PRESETS.volcanic.params.roughness);
  assert.equal(planetParamsOf({ preset: 'nonsense' })!.preset, 'earthlike');
});

test('a picture of a planet for the dialog', () => {
  const px = planetPreview(planetParamsOf({ seed: 2, preset: 'earthlike' })!, 64);
  assert.equal(px.length, 64 * 32 * 4);
  const colours = new Set<number>();
  for (let k = 0; k < px.length; k += 4) colours.add((px[k] << 16) | (px[k + 1] << 8) | px[k + 2]);
  assert.ok(colours.size > 50, 'land and sea, shaded');
});

test('a planet map is created with its terrain and colours, made anew, undone; other maps cannot be', () => {
  const world = new World();
  cmd.seedProject(world, 'Planets');
  const r = cmd.createPlanet(world, 'Aster Prime', 5000, { ...PLANET_PRESETS.desert.params, seed: 99, preset: 'desert' });
  const id = r.result, space = () => world.get('map_space', id)!;
  assert.equal(terrainSourceOf(space()), 'planet');
  assert.equal(planetOf(space())!.seed, 99);
  assert.equal(terrainLook(space())!.palette, 'desert', "the preset's colours");
  assert.equal(space().radius_m, 5_000_000);
  // A sea level over time works on a planet too.
  cmd.setWorldSeaLevel(world, id, [{ day: 0, ms: 0, m: -50 }]);
  assert.equal(seaLevelPoints(space()).length, 1);
  const anew = cmd.setWorldPlanet(world, id, { ...planetOf(space())!, seed: 100 });
  assert.equal(planetOf(space())!.seed, 100);
  assert.equal(terrainLook(space())!.palette, 'desert', 'its look kept');
  world.applyDiffs(invertDiffs(anew.diffs));
  assert.equal(planetOf(space())!.seed, 99, 'undone in one step');
  const plain = cmd.createWorld(world, 'Blank', 3000).result;
  assert.throws(() => cmd.setWorldPlanet(world, plain, planetOf(space())!), /Only a generated planet/);
  assert.throws(() => cmd.createPlanet(world, 'Nowhere', 0, planetOf(space())!), /positive radius/);
});
