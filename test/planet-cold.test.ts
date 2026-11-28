// Cold worlds (D260): the sea frozen over for most of the year is sea ice (still sea, drawn as ice), in the polar
// seas of an Earth and from pole to pole on a planet too far from its star; the planet's figures as its pictures
// have them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, newDefinition, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME, BIOME_IDS, SEA_ICE_FROM } from '../src/planet/life/biomes.ts';
import { explain } from '../src/planet/explain.ts';
import { seenFromSpace } from '../src/ui/planet-colors.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const mesh = meshAt(4), n = mesh.n, A = mesh.area;
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };
const id = (b: keyof typeof BIOME) => BIOME_IDS.indexOf(b);

async function planet(p: Pipeline, d: PlanetDefinition) {
  const sea = (await p.product('sea', d, P)).data, T = (await p.product('temperature', d, P)).data, C = (await p.product('climate', d, P)).data;
  const W = (await p.product('water', d, P)).data, B = (await p.product('biomes', d, P)).data;
  const biome = B.biome as Uint8Array, share = new Map<string, number>();
  for (let c = 0; c < n; c++) share.set(BIOME_IDS[biome[c]], (share.get(BIOME_IDS[biome[c]]) ?? 0) + A[c] / (4 * Math.PI));
  return { sea, T, C, W, B, biome, of: (b: keyof typeof BIOME) => share.get(b) ?? 0 };
}

test('sea ice: the polar seas of an Earth; from pole to pole on a planet too far from its star; still sea', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  // (The new kind is added after the old ones: a stored biome's number means what it meant.)
  assert.equal(id('seaIce'), 22);
  assert.equal(SEA_ICE_FROM, 0.5);
  // An Earth: a little of its sea frozen for most of the year, all of it towards the poles; the rest open.
  const earth = await planet(p, d);
  const frozen = earth.T.seaFrozen as number, heights = earth.sea.heights as Int16Array, ice = earth.C.ice as Float32Array;
  assert.ok(frozen > 0.01 && frozen < 0.2, `${frozen} of the sea`);
  assert.ok(Math.abs(earth.of('seaIce') - frozen * (earth.sea.share as number)) < 0.02);
  assert.ok(earth.of('sea') > 0.55);
  for (let c = 0; c < n; c++) {
    if (earth.biome[c] === id('seaIce')) { assert.ok(Math.abs(mesh.lat[c]) > (50 * Math.PI) / 180, `sea ice at ${(mesh.lat[c] * 180) / Math.PI}°`); assert.ok(ice[c] >= SEA_ICE_FROM); }
    // (The water stage counts a few low shores with the sea: sea by its kind of water, not by its height alone.)
    if (earth.biome[c] === id('sea')) assert.ok(ice[c] < SEA_ICE_FROM);
    if (heights[c] < -200) assert.ok(earth.biome[c] === id('sea') || earth.biome[c] === id('seaIce'));
  }
  // The surface's mean over the year, as the pictures have it.
  const monthly = earth.C.monthly as Float32Array;
  let mean = 0;
  for (let c = 0; c < n; c++) for (let m = 0; m < 12; m++) mean += (monthly[m * n + c] * A[c]) / (12 * 4 * Math.PI);
  assert.ok(Math.abs((earth.T.surfaceC as number) - mean) < 1e-3, `${earth.T.surfaceC} against ${mean}`);
  assert.ok(mean > 5 && mean < 25);

  // Farther out (1.25 AU): frozen over from pole to pole. The same land and the same sea (its share, its heights:
  // still sea for whatever is drawn on a map of it); no open water left, the land under ice.
  const far = change(d, (c) => { c.orbit.semiMajorAu = 1.25; });
  const snowball = await planet(p, far);
  assert.equal(p.keyOf('tectonics', far, P), p.keyOf('tectonics', d, P));
  assert.equal(snowball.sea.fate, 'liquid');
  assert.equal(snowball.sea.share, earth.sea.share);
  assert.deepEqual([...(snowball.sea.heights as Int16Array)], [...heights]);
  assert.ok((snowball.T.seaFrozen as number) > 0.995, `${snowball.T.seaFrozen}`);
  assert.equal(snowball.of('sea'), 0);
  assert.ok(Math.abs(snowball.of('seaIce') - (earth.sea.share as number)) < 0.02, `${snowball.of('seaIce')}`);
  assert.ok(snowball.of('ice') > 0.9 * (1 - (earth.sea.share as number)), `the land under ice (${snowball.of('ice')})`);
  assert.ok((snowball.T.surfaceC as number) < -40, `${snowball.T.surfaceC} °C`);
  // The model's own mean is far below the planet's balance as a whole worked out without the ice's spread.
  assert.ok((snowball.T.surfaceC as number) < derive({ ...far, water: { ...far.water, oceanFraction: snowball.sea.share as number } }).surfaceK - 273.15 + 5);
  // Its colours: the sea's ice in its own, and counted with what shows (not the sea's dark blue) in the land's cover.
  const colour = snowball.B.colour as Uint8Array;
  const mid = heights.findIndex((h, c) => h < -3000 && Math.abs(mesh.lat[c]) < 0.2);
  assert.deepEqual([colour[3 * mid], colour[3 * mid + 1], colour[3 * mid + 2]], [...BIOME.seaIce.colour]);
  const W = 180, H = 90;
  const cover = (await p.product('cover', far, { ...P, width: W, height: H, land: true })).data.pixels as Uint8Array;
  for (let i = 0; i < W * H; i += 13) assert.equal(cover[4 * i + 3], 255, 'ice or land everywhere');
  // A place on the frozen sea, explained.
  const none = new Uint8Array(n), zero = new Float32Array(n);
  const text = explain({
    mesh, def: far, x: derive(far), heights: snowball.sea.heights as Int16Array, kinds: none, age: zero, thickness: zero, tags: none, boundary: none, boundaryRate: zero,
    climate: snowball.C as never, water: snowball.W as never, biomes: snowball.B as never,
  }, mid);
  assert.match(text.title, /m under the sea$/);
  assert.match(text.sections.flatMap((sec) => sec.lines).join(' '), /The sea here lies frozen for 100 % of the year: sea ice\. It is still sea: nothing stands on it\./);
});

test('seen from space: ice over the sea lies flat; the land is lit against the sea\'s level, not its floor', () => {
  const W = 6, H = 3, k = (i: number, j: number) => j * W + i;
  const cover = new Uint8Array(4 * W * H), heights = new Float32Array(W * H);
  // Ice (shown, alpha full) over a sea floor that falls steeply to the east.
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { cover.set([224, 233, 240, 255], 4 * k(i, j)); heights[k(i, j)] = -500 - 1500 * i; }
  const px = seenFromSpace(cover, heights, W, H);
  for (let i = 0; i < W; i++) assert.deepEqual([...px.subarray(4 * k(i, 1), 4 * k(i, 1) + 3)], [224, 233, 240], 'in its own colour whatever lies under it');
  // Level land beside a deep sea: neither lit nor shaded by the drop to the sea floor.
  const c2 = new Uint8Array(4 * W * H), h2 = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { c2.set([100, 140, 80, i < 3 ? 255 : 0], 4 * k(i, j)); h2[k(i, j)] = i < 3 ? 0 : -6000; }
  const p2 = seenFromSpace(c2, h2, W, H);
  assert.deepEqual([...p2.subarray(4 * k(2, 1), 4 * k(2, 1) + 3)], [100, 140, 80]);
});

test('the first calculation as it was: no sea ice among its kinds of ground', async () => {
  const p = new Pipeline(new LocalExecutor()), d = definitionFromPreset('earthlike', 4);
  d.orbit.semiMajorAu = 1.25;
  const params = { level: 4, durationMyr: 200, frameEveryMyr: 25 };
  const biome = (await p.product('biomes', d, params)).data.biome as Uint8Array;
  assert.ok(biome.every((b) => b <= id('barren')));
  assert.ok(biome.some((b) => b === id('sea')));
  const T = (await p.product('temperature', d, params)).data;
  assert.equal(T.surfaceC, undefined);
  assert.equal(T.seaFrozen, undefined);
});
