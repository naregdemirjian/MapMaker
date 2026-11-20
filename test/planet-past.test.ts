// Earlier moments' own climate and life (Stage 15.5, D167): a picture of an earlier moment shows the biomes, warmth
// and rain its moment's own climate makes over its own land and sea (from the climate the history had then), coloured
// as seen from space as the present's are; a map's land cover blends between its pictures as its heights do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { STAGES, tectonicParams, type ProductData, type StageParams } from '../src/planet/pipeline/stages.ts';
import { runHistory } from '../src/planet/tectonics/history.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME_IDS } from '../src/planet/life/biomes.ts';
import { coverAt, type CoverSet, type TerrainCover } from '../src/terrain/cover.ts';

const ctx = { progress() {} };
const P: StageParams = { level: 4, durationMyr: 200, frameEveryMyr: 25 };
const stage = async (id: string, def: PlanetDefinition, deps: Record<string, ProductData>, extra: Partial<StageParams> = {}) =>
  STAGES[id].run(STAGES[id].inputs(def, { ...P, ...extra }), deps, ctx) as Promise<ProductData>;
const history = (def: PlanetDefinition) => runHistory(tectonicParams(def, 4, 200), { durationMyr: 200, frameEveryMyr: 25 }) as unknown as ProductData;
const mesh = meshAt(4), n = mesh.n;
const WET = new Set(['wetland', 'swamp', 'lake', 'saltFlat']);

test('a picture of today shows the biomes the full climate, water and life stages do, but for lakes and wetlands', async () => {
  const def = definitionFromPreset('earthlike', 5);
  const h = history(def), F = (h.times as Float64Array).length;
  // The history keeps the climate each picture's moment had, to start from.
  assert.equal((h.frameWarm as Float64Array[]).length, F);
  assert.ok((h.frameWarm as Float64Array[]).every((k) => k.length === 642 && k.every((v) => v > 150 && v < 400)), 'coarse temperatures, K');
  assert.ok((h.frameCo2 as Float64Array).every((v) => v === 1), 'no climate events: the air as set');
  const ins = await stage('insolation', def, {});
  const cl = await stage('climate', def, { tectonics: h });
  const wa = await stage('water', def, { tectonics: h, climate: cl, insolation: ins });
  const bi = await stage('biomes', def, { tectonics: h, climate: cl, water: wa, insolation: ins });
  const now = await stage('moment', def, { tectonics: h }, { frame: F - 1 });
  const full = bi.biome as Uint8Array, pic = now.biome as Uint8Array, heights = h.heights as Int16Array;
  let land = 0, same = 0;
  for (let c = 0; c < n; c++) {
    // The picture's sea is below the picture's sea level.
    assert.equal(BIOME_IDS[pic[c]] === 'sea', heights[(F - 1) * n + c] < 0, `cell ${c}: sea below the sea`);
    const a = BIOME_IDS[full[c]];
    if (a === 'sea' || WET.has(a)) continue;
    land += mesh.area[c];
    if (full[c] === pic[c]) same += mesh.area[c];
  }
  assert.ok(same / land > 0.75, `the same biome on ${(100 * same / land).toFixed(0)} % of the land besides lakes and wetlands`);
  // Its warmth and rain are the climate's (the picture's: mean temperatures in whole °C, rain in mm).
  const T = now.temp as Int8Array, R = now.rain as Uint16Array, annual = cl.annual as Float32Array, rain = cl.precipAnnual as Float32Array;
  let dT = 0, dR = 0, sR = 0, a = 0;
  for (let c = 0; c < n; c++) { dT += Math.abs(T[c] - annual[c]) * mesh.area[c]; dR += Math.abs(R[c] - rain[c]) * mesh.area[c]; sR += rain[c] * mesh.area[c]; a += mesh.area[c]; }
  assert.ok(dT / a < 2.5, `temperatures within ${(dT / a).toFixed(1)} K on average`);
  assert.ok(dR / sR < 0.2, `rain within ${(100 * dR / sR).toFixed(0)} %`);
});

test('an ice age shows in the pictures of its time: less carbon dioxide, colder, more ice and tundra', async () => {
  const def = definitionFromPreset('earthlike', 3);
  const cold = structuredClone(def);
  cold.history.events = [{ id: 'i', kind: 'ice-age', startMa: 120, durationMyr: 60, strength: 2 }];
  const [h0, h1] = [history(def), history(cold)];
  const times = h1.times as Float64Array, f = Array.from(times).indexOf(75);
  assert.ok(f > 0);
  assert.equal((h1.frameCo2 as Float64Array)[f], 0.25, 'half the carbon dioxide per unit of strength');
  assert.equal((h1.frameCo2 as Float64Array)[times.length - 1], 1, 'and as set again after it');
  const [m0, m1] = await Promise.all([stage('moment', def, { tectonics: h0 }, { frame: f }), stage('moment', cold, { tectonics: h1 }, { frame: f })]);
  const measure = (m: ProductData) => {
    let land = 0, frozen = 0, t = 0;
    const B = m.biome as Uint8Array, T = m.temp as Int8Array;
    for (let c = 0; c < n; c++) {
      if (BIOME_IDS[B[c]] === 'sea') continue;
      land += mesh.area[c]; t += T[c] * mesh.area[c];
      if (['ice', 'tundra', 'polarDesert'].includes(BIOME_IDS[B[c]])) frozen += mesh.area[c];
    }
    return { frozen: frozen / land, t: t / land };
  };
  const a = measure(m0), b = measure(m1);
  assert.ok(b.t < a.t - 3, `colder on land: ${a.t.toFixed(1)} → ${b.t.toFixed(1)} °C`);
  assert.ok(b.frozen > a.frozen + 0.05, `more ice and tundra: ${(100 * a.frozen).toFixed(0)} → ${(100 * b.frozen).toFixed(0)} % of the land`);
});

test('the land seen from space at an earlier picture: its moment\'s own biomes, coloured as today\'s, the planet\'s own biomes too', async () => {
  const def = definitionFromPreset('earthlike', 5);
  def.life.biomeSet = 'custom';
  def.life.customBiomes = [{ id: 'warm', name: 'Warm moss', color: [255, 0, 255], priority: 1, tempC: [15, 60] }];
  const h = history(def);
  const W = 128, H = 64, f = 2;
  const past = await stage('cover', def, { moment: await stage('moment', def, { tectonics: h }, { frame: f }) }, { frame: f, width: W, height: H });
  const px = past.pixels as Uint8Array;
  assert.equal(px.length, 4 * W * H);
  // Land as warm as the rule asks is the planet's own biome's colour; colder land is not.
  const m = await stage('moment', def, { tectonics: h }, { frame: f });
  const T = m.temp as Int8Array, B = m.biome as Uint8Array;
  let warm = 0, cold = 0;
  for (let c = 0; c < n; c++) if (BIOME_IDS[B[c]] !== 'sea') { if (T[c] >= 16) warm++; else if (T[c] <= 13) cold++; }
  assert.ok(warm > 20 && cold > 20, `warm and cold land at ${(h.times as Float64Array)[f]} Ma (${warm}, ${cold} cells)`);
  let magenta = 0, green = 0;
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = [px[4 * i], px[4 * i + 1], px[4 * i + 2]];
    if (r > 200 && g < 60 && b > 200) magenta++;
    if (g > r && g > b) green++;
  }
  assert.ok(magenta > 50, `the planet's own biome where it is warm enough (${magenta} pixels)`);
  assert.ok(green > 50, `the Earth's biomes elsewhere (${green} greener pixels)`);
  // Not today's: the cover of today is the full stages'.
  const today = await stage('cover', def, { biomes: { colour: new Uint8Array(3 * n).fill(7) } }, { width: W, height: H });
  assert.equal((today.pixels as Uint8Array)[0], 7);
});

test('a map\'s land cover between two pictures: the two blended in sixteenths, the nearer while the other is made', () => {
  const plain = (v: number, key: string): TerrainCover => ({ width: 2, height: 1, pixels: new Uint8Array(8).fill(v), key });
  const set: CoverSet = { ages: [0, 25, 50], covers: [plain(0, 'a'), plain(160, 'b'), null], key: 'set' };
  assert.equal(coverAt(set, 0)?.key, 'a');
  assert.equal(coverAt(set, 25)?.key, 'b');
  const mid = coverAt(set, 12.5)!;
  assert.equal((mid.pixels as Uint8Array)[0], 80);
  assert.equal(coverAt(set, 12.5), mid, 'kept');
  // Sixteenths of the way: 1 Myr in is 1/16 of the way at most 0.78 Myr off, the same as 1.2 Myr in.
  assert.equal(coverAt(set, 1)!.key, coverAt(set, 1.2)!.key);
  assert.equal((coverAt(set, 0.1)!), set.covers[0], 'the first under half a sixteenth');
  // The older picture not made yet: the nearer of the two that are.
  assert.equal(coverAt(set, 30)?.key, 'b');
  assert.equal(coverAt(set, 45)?.key, 'b');
  set.covers = [null, null, null];
  assert.equal(coverAt(set, 30), null);
});
