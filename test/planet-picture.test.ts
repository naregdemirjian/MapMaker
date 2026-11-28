// A planet always on screen (D257): the land's colours made without the sea's along the coast, the picture of the
// planet seen from space (the land lit by its relief, the sea by its depth), and the land there is shown with every
// other setting as it is now while the land asked for is being made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, climateSnapshot, withLandOf, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor, CancelledError } from '../src/planet/worker/pool.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME, BIOME_IDS } from '../src/planet/life/biomes.ts';
import { seenFromSpace } from '../src/ui/planet-colors.ts';

test('the cover of the land alone: no sea in the colours of a shore, the land\'s share in the alpha; the plain cover as it was', async () => {
  // A continent about the equator and the prime meridian, 55° across, in a deep sea.
  const mesh = meshAt(4), heights = new Int16Array(mesh.n);
  for (let c = 0; c < mesh.n; c++) heights[c] = mesh.xyz[3 * c] > Math.cos((27.5 * Math.PI) / 180) ? 400 : -3500;
  const def = definitionFromPreset('earthlike', 5), p = new Pipeline(new LocalExecutor());
  const W = 180, H = 90, params = { level: 4, heights, width: W, height: H };
  const plain = await p.product('cover', def, params), land = await p.product('cover', def, { ...params, land: true });
  assert.notEqual(plain.key, land.key, 'another product');
  const a = plain.data.pixels as Uint8Array, b = land.data.pixels as Uint8Array;
  const at = (lon: number, lat: number) => Math.round(((90 - lat) / 180) * H - 0.5) * W + Math.round(((lon + 180) / 360) * W - 0.5);
  const sea = BIOME.sea.colour;
  // The plain cover: opaque everywhere, the sea in the sea's colour.
  for (let i = 0; i < W * H; i++) assert.equal(a[4 * i + 3], 255);
  assert.deepEqual([...a.subarray(4 * at(180, 0), 4 * at(180, 0) + 3)], [...sea]);
  // The land alone: nothing of it far out at sea, all of it inland, where its colours are the plain cover's.
  assert.equal(b[4 * at(180, 0) + 3], 0);
  assert.equal(b[4 * at(0, 0) + 3], 255);
  assert.deepEqual([...b.subarray(4 * at(0, 0), 4 * at(0, 0) + 3)], [...a.subarray(4 * at(0, 0), 4 * at(0, 0) + 3)]);
  // Along the shore the plain cover runs the land's colours into the sea's dark blue; the land alone keeps the
  // land's: wherever half or more of what surrounds a pixel is land, its colour is that of land cells only.
  const biome = (await p.product('biomes', def, { level: 4, heights })).data.biome as Uint8Array, seaId = BIOME_IDS.indexOf('sea');
  const colours = (await p.product('biomes', def, { level: 4, heights })).data.colour as Uint8Array;
  let lo = [255, 255, 255], hi = [0, 0, 0];
  for (let c = 0; c < mesh.n; c++) if (biome[c] !== seaId) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], colours[3 * c + k]); hi[k] = Math.max(hi[k], colours[3 * c + k]); }
  let shore = 0, darker = 0;
  for (let i = 0; i < W * H; i++) {
    const share = b[4 * i + 3];
    if (share === 0 || share === 255) continue;
    shore++;
    for (let k = 0; k < 3; k++) assert.ok(b[4 * i + k] >= lo[k] - 1 && b[4 * i + k] <= hi[k] + 1, `a shore pixel within the land's colours (${b[4 * i + k]} in ${lo[k]} to ${hi[k]})`);
    if (a[4 * i] + a[4 * i + 1] + a[4 * i + 2] < b[4 * i] + b[4 * i + 1] + b[4 * i + 2] - 6) darker++;
  }
  assert.ok(shore > 100, `a shore (${shore} pixels)`);
  assert.ok(darker > shore / 2, `the plain cover darker along it (${darker} of ${shore})`);
});

test('seen from space: the land lit from the north-west, the sea by its depth, the coast at half land', () => {
  const W = 8, H = 4, n = W * H;
  // Land (a mid green) over the left half, sea over the right, deepening eastwards; the land rising by `slope`
  // metres a pixel to the east, the same on every row.
  const picture = (slope: number) => {
    const cover = new Uint8Array(4 * n), heights = new Float32Array(n);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, land = i < 4;
      cover.set([100, 140, 80, land ? 255 : 0], 4 * k);
      heights[k] = land ? 600 + slope * i : -300 - 1500 * (i - 4);
    }
    return { cover, heights };
  };
  const pixel = (px: Uint8ClampedArray, i: number, j: number) => [...px.subarray(4 * (j * W + i), 4 * (j * W + i) + 4)];
  const { cover, heights } = picture(0), px = seenFromSpace(cover, heights, W, H), at = (i: number, j: number) => pixel(px, i, j);
  // A slope facing west (the ground higher to its east) is lit; one facing east is in shade; level ground neither.
  const up = picture(400), down = picture(-400);
  const lit = pixel(seenFromSpace(up.cover, up.heights, W, H), 1, 1), shaded = pixel(seenFromSpace(down.cover, down.heights, W, H), 1, 1), level = at(1, 1);
  assert.ok(lit[1] > level[1] && shaded[1] < level[1], `lit ${lit[1]}, level ${level[1]}, shaded ${shaded[1]}`);
  assert.deepEqual(level, [100, 140, 80, 255], 'level ground in the land\'s own colour');
  // The sea: none of the cover's colour, darker with depth, opaque.
  const shallow = at(4, 3), deep = at(7, 3);
  assert.ok(shallow[2] > shallow[0] && deep[2] > deep[0], 'blue');
  assert.ok(deep[0] + deep[1] + deep[2] < shallow[0] + shallow[1] + shallow[2], 'darker where deeper');
  assert.equal(deep[3], 255);
  // The coast where the land's share passes one half: a pixel three quarters land is land, one a quarter land sea.
  cover[4 * 3 + 3] = 191; cover[4 * 4 + 3] = 64;
  const again = seenFromSpace(cover, heights, W, H);
  assert.ok(again[4 * 3 + 1] > again[4 * 3 + 2], 'three quarters land: green over blue');
  assert.ok(again[4 * 4 + 2] > again[4 * 4 + 1], 'a quarter land: blue over green');
});

test('the land of one definition with the other settings of another: the same history, the settings as they are', () => {
  const p = new Pipeline(new LocalExecutor()), params = { level: 4, durationMyr: 200, frameEveryMyr: 25 };
  const first = definitionFromPreset('earthlike', 11);
  // Simulated: the history keeps the climate it was made with (D161).
  const was: PlanetDefinition = { ...first, history: { ...first.history, climate: climateSnapshot(first) } };
  const key = p.keyOf('tectonics', was, params);
  assert.equal(p.keyOf('tectonics', first, params), key, 'keeping the climate it is made with asks for no other land');
  // Then the star, the orbit, the tilt, the air and the life changed, and what the land is made from.
  const now: PlanetDefinition = structuredClone(was);
  now.orbit.semiMajorAu = 0.8; now.body.tiltDeg = 50; now.atmosphere.co2 = 0.01; now.life.vegetation = 'red-dwarf';
  now.tectonics.plates = 20; now.body.radiusKm = 8000; now.body.massEarths = 2; now.water.oceanFraction = 0.4; now.seed = 12;
  assert.notEqual(p.keyOf('tectonics', now, params), key, 'another land is asked for');
  const mixed = withLandOf(now, was);
  assert.equal(p.keyOf('tectonics', mixed, params), key, 'the land there is');
  assert.equal(mixed.orbit.semiMajorAu, 0.8);
  assert.equal(mixed.body.tiltDeg, 50);
  assert.equal(mixed.atmosphere.co2, 0.01);
  assert.equal(mixed.life.vegetation, 'red-dwarf');
  assert.equal(mixed.body.radiusKm, was.body.radiusKm);
  assert.equal('massEarths' in mixed.body, false, 'the mass as it was: worked out');
  // Its climate, water and life are worked out for the settings as they are.
  assert.notEqual(p.keyOf('climate', mixed, params), p.keyOf('climate', was, params));
  // A change of the air or the orbit alone asks for no other land (the history keeps its climate).
  const air: PlanetDefinition = structuredClone(was);
  air.atmosphere.pressureBar = 2; air.orbit.eccentricity = 0.3;
  assert.equal(p.keyOf('tectonics', air, params), key);
});

test('a product wanted by two requests: the first cancelled, the second still gets it', async () => {
  const p = new Pipeline(new LocalExecutor()), def = definitionFromPreset('earthlike', 3), ac = new AbortController();
  const first = p.product('insolation', def, { level: 4 }, { signal: ac.signal });
  const second = p.product('insolation', def, { level: 4 });
  ac.abort();
  await assert.rejects(first, CancelledError);
  // (Being made for the first when it was cancelled: the second makes it itself.)
  const r = await second;
  assert.equal((r.data.annual as Float32Array).length, meshAt(4).n);
  assert.equal(r.cached, false);
  assert.equal((await p.product('insolation', def, { level: 4 })).cached, true);
  // A request cancelled itself stays cancelled, whoever else wanted the product.
  const other = definitionFromPreset('earthlike', 3);
  other.body.tiltDeg = 40;
  const ac2 = new AbortController();
  const one = p.product('insolation', other, { level: 4 }), two = p.product('insolation', other, { level: 4 }, { signal: ac2.signal });
  ac2.abort();
  assert.equal((await one).cached, false);
  await two.then(() => undefined, (e) => assert.ok(e instanceof CancelledError));
});
