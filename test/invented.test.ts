// Invented star maps (Stage 11, D114): stars of the user's own from a seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventedStars, inventedStarsCached } from '../src/space/invented.ts';
import { starKind } from '../src/space/catalogue.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { spaceSettingsOf } from '../src/world-model/world-settings.ts';
import { DEFAULT_SKY } from '../src/space/sky-look.ts';

test('invented stars: the same seed the same stars; their number, reach and shape; mostly red dwarfs; names of their own', () => {
  const o = { seed: 42, count: 400, radiusLy: 80, shape: 'sphere' as const };
  const a = inventedStars(o), b = inventedStars(o);
  assert.deepEqual(a.stars, b.stars, 'the same seed, the same stars');
  assert.notDeepEqual(inventedStars({ ...o, seed: 43 }).stars.map((s) => s.x), a.stars.map((s) => s.x), 'another seed, other stars');
  assert.equal(a.stars.length, 400);
  assert.deepEqual(a.stars.map((s) => s.id), Array.from({ length: 400 }, (_, i) => i));
  const home = a.byId.get(0)!;
  assert.deepEqual([home.x, home.y, home.z, home.alt], [0, 0, 0, 'Home']);
  assert.ok(a.stars.every((s) => s.dist <= 80 + 1e-9), 'within its reach');
  for (let i = 2; i < a.stars.length; i++) assert.ok(a.stars[i].dist >= a.stars[i - 1].dist, 'nearest first');
  const red = a.stars.filter((s) => starKind(s.spect) === 'Red dwarf').length / a.stars.length;
  assert.ok(red > 0.55 && red < 0.9, `mostly red dwarfs (${Math.round(red * 100)}%)`);
  assert.equal(new Set(a.stars.map((s) => s.name)).size, a.stars.length, 'every name its own');
  assert.ok(a.stars.filter((s) => !/^KX-/.test(s.name)).length > 60, 'many with names of their own');
  const disc = inventedStars({ ...o, shape: 'disc' });
  assert.ok(disc.stars.every((s) => Math.abs(s.z) <= 0.2 * 80 + 1e-9), 'a disc is flat');
  assert.equal(inventedStarsCached(o), inventedStarsCached({ ...o }), 'made once for the same settings');
});

test('an invented star map: made with its settings, made again from another seed (undone), refused when wrong', async () => {
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Invented');
  const sp = cmd.createSpaceMap(world, 'The Reach', 'invented', { seed: 7, count: 120, radiusLy: 30, shape: 'disc' }).result;
  assert.deepEqual(spaceSettingsOf(world.get('map_space', sp)), { catalogue: 'invented', radiusLy: 30, invented: { seed: 7, count: 120, radiusLy: 30, shape: 'disc' }, look: DEFAULT_SKY });
  const again = cmd.setInventedStars(world, sp, { seed: 8, count: 200, radiusLy: 40, shape: 'sphere' });
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.invented!.seed, 8);
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.radiusLy, 40);
  world.applyDiffs(invertDiffs(again.diffs));
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.invented!.seed, 7, 'undone');
  assert.throws(() => cmd.createSpaceMap(world, 'Too many', 'invented', { seed: 1, count: 5000, radiusLy: 30, shape: 'sphere' }), /between 2 and 3,000/);
  const real = cmd.createSpaceMap(world, 'Nearby').result;
  assert.throws(() => cmd.setInventedStars(world, real, { seed: 2, count: 100, radiusLy: 30, shape: 'sphere' }), /Only an invented/);
});
