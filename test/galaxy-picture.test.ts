// A galaxy as a picture (D193): painted from its model, the same every time and in any bands, the same picture
// small and large; its middle bright and warm, its arms bluer, dark beyond its edge; what its picture depends on;
// the map's baked setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galaxyModel, galaxyCatalogue, DEFAULT_GALAXY, type GalaxySettings } from '../src/space/galaxy.ts';
import { galaxyPainter, galaxyPicture, pictureExtent } from '../src/space/galaxy-picture.ts';
import { pictureKey, pictureSpec, galaxyImageNow, galaxyBakeState, DRAFT_SIZE, BAKE_SIZE } from '../src/space/galaxy-pictures.ts';
import { TASKS } from '../src/planet/worker/tasks.ts';
import { spaceScene } from '../src/space/scene.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { spaceSettingsOf } from '../src/world-model/world-settings.ts';
import { NEG_INF } from '../src/core-time/index.ts';

const MW: GalaxySettings = { ...DEFAULT_GALAXY, kind: 'milkyway' };
const OWN: GalaxySettings = { ...DEFAULT_GALAXY, kind: 'invented', seed: 3, arms: 2, pitch: 16 };
/** The mean red, green and blue of the pixels of a square picture for which `where(x, y)` holds (x, y from -1 to 1). */
function mean(px: Uint8ClampedArray, size: number, where: (x: number, y: number) => boolean): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (!where(((i + 0.5) / size) * 2 - 1, 1 - ((j + 0.5) / size) * 2)) continue;
    const k = (j * size + i) * 4;
    r += px[k]; g += px[k + 1]; b += px[k + 2]; n++;
  }
  return [r / n, g / n, b / n];
}

test('the Milky Way painted: bright and warm in the middle, bluer in the arms, dark beyond the disc', () => {
  const size = 160, px = galaxyPicture({ model: galaxyModel(MW), seed: 11, size });
  assert.equal(px.length, size * size * 4);
  for (let k = 3; k < px.length; k += 4) assert.equal(px[k], 255);
  const middle = mean(px, size, (x, y) => Math.hypot(x, y) < 0.03);
  assert.ok(middle[0] > 235 && middle[0] >= middle[2], `the middle white-hot (${middle.map(Math.round)})`);
  const bulge = mean(px, size, (x, y) => Math.hypot(x, y) < 0.12);
  assert.ok(bulge[0] > bulge[2] * 1.2, `old yellow stars round the middle (${bulge.map(Math.round)})`);
  // (The disc reaches 1 / 1.2 of the way to the picture's edge.)
  const arms = mean(px, size, (x, y) => { const r = Math.hypot(x, y); return r > 0.45 && r < 0.75; });
  assert.ok(arms[2] > arms[0] && arms[0] + arms[1] + arms[2] > 150, `young blue-white stars in the arms (${arms.map(Math.round)})`);
  const beyond = mean(px, size, (x, y) => Math.hypot(x, y) > 1.02);
  assert.ok(beyond[0] + beyond[1] + beyond[2] < 12, `dark beyond the disc (${beyond.map(Math.round)})`);
  assert.equal(pictureExtent(galaxyModel(MW)), 72000);
});

test('the same galaxy is the same picture: every time, in whatever bands, in a worker, small or large', () => {
  const spec = { model: galaxyModel(MW), seed: 11, size: 96 };
  const whole = galaxyPicture(spec), again = galaxyPicture(spec);
  assert.deepEqual(whole, again);
  const p = galaxyPainter(spec), bands = new Uint8ClampedArray(whole.length);
  bands.set(p.rows(0, 40), 0); bands.set(p.rows(40, 41), 40 * 96 * 4); bands.set(p.rows(41, 96), 41 * 96 * 4);
  assert.deepEqual(bands, whole, 'in bands');
  // (The task the workers run, with the spec as a worker receives it.)
  const rows = (TASKS.galaxyRows as (a: unknown) => Uint8ClampedArray)(structuredClone({ spec, y0: 10, y1: 20 }));
  assert.deepEqual(rows, whole.slice(10 * 96 * 4, 20 * 96 * 4), 'in a worker');
  // Twice the size, brought down again: the same picture but for its grain.
  const large = galaxyPicture({ ...spec, size: 192 });
  let diff = 0;
  for (let j = 0; j < 96; j++) for (let i = 0; i < 96; i++) for (let c = 0; c < 3; c++) {
    const big = (large[((2 * j) * 192 + 2 * i) * 4 + c] + large[((2 * j) * 192 + 2 * i + 1) * 4 + c] + large[((2 * j + 1) * 192 + 2 * i) * 4 + c] + large[((2 * j + 1) * 192 + 2 * i + 1) * 4 + c]) / 4;
    diff += Math.abs(big - whole[(j * 96 + i) * 4 + c]);
  }
  assert.ok(diff / (96 * 96 * 3) < 9, `small and large alike (mean difference ${(diff / (96 * 96 * 3)).toFixed(1)} of 255)`);
});

test('galaxies of one\'s own: each seed and shape its own picture; a bar or none', () => {
  const a = galaxyPicture(pictureSpec(OWN, 80)), b = galaxyPicture(pictureSpec({ ...OWN, seed: 4 }, 80)), c = galaxyPicture(pictureSpec({ ...OWN, arms: 5 }, 80));
  const differ = (x: Uint8ClampedArray, y: Uint8ClampedArray) => { let d = 0; for (let k = 0; k < x.length; k++) d += Math.abs(x[k] - y[k]); return d / x.length; };
  assert.ok(differ(a, b) > 3 && differ(a, c) > 3, `other seeds and shapes look different (${differ(a, b).toFixed(1)}, ${differ(a, c).toFixed(1)})`);
  const middle = mean(a, 80, (x, y) => Math.hypot(x, y) < 0.05), far = mean(a, 80, (x, y) => Math.hypot(x, y) > 1.05);
  assert.ok(middle[0] > 200 && far[0] + far[1] + far[2] < 15);
  // Without a bar the middle is round: as bright along one way as across it.
  const round = galaxyPicture(pictureSpec({ ...OWN, bar: false }, 80));
  const along = mean(round, 80, (x, y) => Math.abs(y) < 0.03 && Math.abs(x) > 0.08 && Math.abs(x) < 0.16), across = mean(round, 80, (x, y) => Math.abs(x) < 0.03 && Math.abs(y) > 0.08 && Math.abs(y) < 0.16);
  assert.ok(Math.abs(along[0] - across[0]) < 40, `no bar, a round middle (${Math.round(along[0])}, ${Math.round(across[0])})`);
});

test('what a picture depends on: the galaxy\'s shape, never its star systems or whether it is baked', () => {
  assert.equal(pictureKey(MW), pictureKey({ ...MW, seed: 9, systems: 50, baked: true }));
  assert.equal(pictureKey(OWN), pictureKey({ ...OWN, systems: 50, baked: true }));
  assert.notEqual(pictureKey(OWN), pictureKey({ ...OWN, seed: 4 }));
  assert.notEqual(pictureKey(OWN), pictureKey({ ...OWN, pitch: 20 }));
  assert.notEqual(pictureKey(OWN), pictureKey(MW));
  assert.deepEqual(pictureSpec(MW, 64).model, pictureSpec({ ...MW, seed: 7 }, 64).model);
  assert.ok(DRAFT_SIZE < BAKE_SIZE);
  // The arms only painted (the Milky Way's far side) place no star systems: the map's systems are where they were.
  assert.ok(galaxyModel(MW).paintArms!.length >= 1 && galaxyModel(MW).arms.length === 5);
  const first = galaxyCatalogue(MW).stars.find((s) => s.id === 1000)!;
  assert.deepEqual([Math.round(first.x), Math.round(first.y)], [Math.round(galaxyCatalogue({ ...MW, baked: true }).stars.find((s) => s.id === 1000)!.x), Math.round(first.y)]);
  // Where nothing can be drawn (here, in Node) there is no picture, and nothing is begun.
  assert.equal(galaxyImageNow(MW), null);
  assert.deepEqual(galaxyBakeState(MW), { state: 'none', progress: 0 });
  assert.deepEqual(spaceScene({ catalogue: 'galaxy', radiusLy: 60000, galaxy: MW }, NEG_INF).galaxy, MW);
});

test('a galaxy map baked and drawn as a draft again: kept with the map, undone, refused on other maps', async () => {
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Galaxies');
  const mw = cmd.createSpaceMap(world, 'The Milky Way', 'galaxy', undefined, { ...MW }).result;
  assert.equal(spaceSettingsOf(world.get('map_space', mw))!.galaxy!.baked, undefined);
  const baked = cmd.setGalaxyBaked(world, mw, true);
  assert.deepEqual(spaceSettingsOf(world.get('map_space', mw))!.galaxy, { ...MW, baked: true });
  // (Other star systems from another seed: still baked.)
  cmd.setGalaxy(world, mw, { ...spaceSettingsOf(world.get('map_space', mw))!.galaxy!, seed: 2 });
  assert.equal(spaceSettingsOf(world.get('map_space', mw))!.galaxy!.baked, true);
  cmd.setGalaxyBaked(world, mw, false);
  assert.equal(spaceSettingsOf(world.get('map_space', mw))!.galaxy!.baked, undefined);
  assert.equal(JSON.parse(world.get('map_space', mw)!.settings).space.galaxy.baked, undefined);
  const w2 = new World();
  cmd.seedProject(w2, 'Undo');
  const id = cmd.createSpaceMap(w2, 'The Milky Way', 'galaxy', undefined, { ...MW }).result;
  const r = cmd.setGalaxyBaked(w2, id, true);
  w2.applyDiffs(invertDiffs(r.diffs));
  assert.equal(spaceSettingsOf(w2.get('map_space', id))!.galaxy!.baked, undefined, 'undone');
  assert.ok(baked.diffs.length > 0);
  assert.throws(() => cmd.setGalaxyBaked(world, cmd.createSpaceMap(world, 'Stars').result, true), /Only a galaxy map/);
});
