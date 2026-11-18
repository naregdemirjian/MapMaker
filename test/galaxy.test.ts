// Galaxy maps (Stage 11, D116): the Milky Way's arms, places and the Sun; star systems along the arms; a
// galaxy of one's own; the maps made, made again and undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galaxyModel, galaxyCatalogue, galaxyDust, armPoint, armLabels, placeAt, galaxyCached, DEFAULT_GALAXY, SUN_FROM_CENTRE_LY, SYSTEM_ID_BASE, type GalaxySettings } from '../src/space/galaxy.ts';
import { spaceScene } from '../src/space/scene.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { spaceSettingsOf } from '../src/world-model/world-settings.ts';
import { NEG_INF } from '../src/core-time/index.ts';

const MW: GalaxySettings = { ...DEFAULT_GALAXY, kind: 'milkyway' };
const by = (name: string) => galaxyCatalogue(MW).stars.find((s) => s.name === name)!;
const r = (s: { x: number; y: number; z: number }) => Math.hypot(s.x, s.y, s.z);

test('the Milky Way: the Sun 26,670 light-years out, the black hole at the middle, places where they are seen from the Sun', () => {
  const sun = by('Sun');
  assert.equal(sun.id, 0);
  assert.ok(Math.abs(r(sun) - SUN_FROM_CENTRE_LY) < 1);
  assert.ok(r(by('Sagittarius A*')) < 100, `Sagittarius A* at the middle (${r(by('Sagittarius A*')).toFixed(0)} ly from it)`);
  const orion = by('Orion Nebula');
  assert.ok(Math.abs(Math.hypot(orion.x - sun.x, orion.y - sun.y, orion.z - sun.z) - 1344) < 1);
  assert.equal(orion.dist, 1344);
  assert.equal(orion.kind, 'nebula');
  // Toward the middle (longitude 0) is +x from the Sun; longitude 90 is +y; the north galactic pole +z.
  assert.deepEqual(placeAt(0, 0, 100).map((v) => Math.round(v)), [-SUN_FROM_CENTRE_LY + 100, 0, 0]);
  assert.deepEqual(placeAt(90, 0, 100).map((v) => Math.round(v)), [-SUN_FROM_CENTRE_LY, 100, 0]);
  assert.deepEqual(placeAt(0, 90, 100).map((v) => Math.round(v)), [-SUN_FROM_CENTRE_LY, 0, 100]);
  // The Magellanic Clouds far outside the disc, below it.
  assert.ok(r(by('Large Magellanic Cloud')) > 140000 && by('Large Magellanic Cloud').z < -50000);
  // The Sun in the Orion–Cygnus arm: within its width of the arm's line.
  const local = galaxyModel(MW).arms.find((a) => a.name.startsWith('Orion'))!;
  let nearest = Infinity;
  for (let b = local.from; b <= local.to; b += 0.25) { const [x, y] = armPoint(local, b); nearest = Math.min(nearest, Math.hypot(x - sun.x, y - sun.y)); }
  assert.ok(nearest < local.width, `the Sun ${nearest.toFixed(0)} ly from the arm's line`);
});

test('arms: trailing logarithmic spirals of their pitch; their names on them', () => {
  for (const a of galaxyModel(MW).arms) {
    const [x0, y0] = armPoint(a, a.betaRef), [x1, y1] = armPoint(a, a.betaRef + 0.01);
    assert.ok(Math.abs(Math.hypot(x0, y0) - a.rRef) < 1e-6, 'through its reference point');
    assert.ok(Math.hypot(x1, y1) < Math.hypot(x0, y0), `${a.name}: inward the way the galaxy turns (trailing)`);
    // The angle between the arm and the circle round the middle is its pitch.
    const tx = x1 - x0, ty = y1 - y0, rx = x0 / Math.hypot(x0, y0), ry = y0 / Math.hypot(x0, y0);
    const pitch = (Math.asin(Math.abs(tx * rx + ty * ry) / Math.hypot(tx, ty)) * 180) / Math.PI;
    assert.ok(Math.abs(pitch - a.pitch) < 0.2, `${a.name}: pitch ${pitch.toFixed(2)} for ${a.pitch}`);
  }
  // The galaxy turns clockwise seen from the north: beta grows from the Sun's side toward +y.
  const [, y] = armPoint({ name: '', rRef: 1000, betaRef: 0, pitch: 0.001, from: 0, to: 1, width: 1, weight: 1 }, 10);
  assert.ok(y > 0);
  assert.equal(armLabels(galaxyModel(MW)).length, 5);
});

test('star systems along the arms: numbered from 1000, named, out of the crowded middle, the same for the same seed', () => {
  const a = galaxyCatalogue(MW), b = galaxyCatalogue(MW), c = galaxyCatalogue({ ...MW, seed: 2 });
  const sys = a.stars.filter((s) => s.id >= SYSTEM_ID_BASE);
  assert.equal(sys.length, 600);
  assert.equal(a.stars.length - sys.length, 33, '33 places');
  assert.deepEqual(sys.map((s) => s.id), Array.from({ length: 600 }, (_, i) => SYSTEM_ID_BASE + i));
  assert.deepEqual(a.stars, b.stars, 'the same seed, the same systems');
  assert.notDeepEqual(c.stars.filter((s) => s.id >= SYSTEM_ID_BASE).map((s) => s.x), sys.map((s) => s.x), 'another seed, others');
  assert.deepEqual(c.stars.filter((s) => s.id < SYSTEM_ID_BASE), a.stars.filter((s) => s.id < SYSTEM_ID_BASE), 'the places stay');
  assert.equal(new Set(a.stars.map((s) => s.name)).size, a.stars.length, 'every name its own');
  assert.ok(sys.every((s) => s.minor && Math.hypot(s.x, s.y) > galaxyModel(MW).bulge * 2.2 && Math.hypot(s.x, s.y) <= galaxyModel(MW).radiusLy * 1.15));
  assert.ok(sys.every((s) => Math.abs(s.dist - Math.hypot(s.x + SUN_FROM_CENTRE_LY, s.y, s.z)) < 1e-6), 'distances from the Sun');
  // The glow: as many points as asked, the same every time, within the galaxy.
  const d1 = galaxyDust(galaxyModel(MW), 3000, 5), d2 = galaxyDust(galaxyModel(MW), 3000, 5);
  assert.equal(d1.count, 3000);
  assert.deepEqual(d1.points, d2.points);
  for (let i = 0; i < d1.count; i++) assert.ok(Math.hypot(d1.points[i * 4], d1.points[i * 4 + 1]) <= galaxyModel(MW).radiusLy * 1.15);
});

test('a galaxy of its own: its arms, its home half way out; the scene drawn with rings, a glow and realms in proportion', () => {
  const g: GalaxySettings = { kind: 'invented', seed: 9, systems: 200, arms: 3, pitch: 18, radiusLy: 20000, bar: false };
  const m = galaxyModel(g);
  assert.equal(m.arms.length, 3);
  assert.equal(m.bar, null);
  assert.ok(Math.abs(Math.hypot(m.home[0], m.home[1]) - 11000) < 50, `home half way out (${Math.hypot(m.home[0], m.home[1]).toFixed(0)} ly)`);
  const cat = galaxyCatalogue(g);
  assert.equal(cat.stars[0].alt, 'Home');
  assert.equal(cat.stars.length, 201);
  assert.deepEqual(galaxyModel({ ...g }).arms, m.arms, 'the same seed, the same galaxy');
  const scene = spaceScene({ catalogue: 'galaxy', radiusLy: 24000, galaxy: g }, NEG_INF);
  assert.equal(scene.cat, galaxyCached(g).cat);
  assert.deepEqual(scene.rings!.map((x) => x.label), ['5,000 ly', '10,000 ly', '15,000 ly', '20,000 ly']);
  assert.ok(scene.dust && scene.dust.count > 1000 && scene.dropLines === false);
  assert.ok(scene.realmReach! > 500 && scene.realmReach! < 3000, `realms reach ${scene.realmReach}`);
});

test('a galaxy map: made with its settings, made again from another seed (undone), held systems, refused when wrong', async () => {
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const world = new World();
  const engine = new Engine(world);
  cmd.seedProject(world, 'Galaxies');
  const mw = cmd.createSpaceMap(world, 'The Milky Way', 'galaxy', undefined, { ...MW }).result;
  assert.deepEqual(spaceSettingsOf(world.get('map_space', mw))!.galaxy, { ...MW });
  assert.equal(spaceSettingsOf(world.get('map_space', mw))!.radiusLy, 60000);
  const again = cmd.setGalaxy(world, mw, { ...MW, seed: 5 });
  assert.equal(spaceSettingsOf(world.get('map_space', mw))!.galaxy!.seed, 5);
  world.applyDiffs(invertDiffs(again.diffs));
  assert.equal(spaceSettingsOf(world.get('map_space', mw))!.galaxy!.seed, 1, 'undone');
  const empire = cmd.createEntity(world, { type_id: 'polity', name: 'Galactic Empire' }).result;
  cmd.holdStars(world, { spaceId: mw, stars: [0, SYSTEM_ID_BASE, SYSTEM_ID_BASE + 1], entity: empire, mode: { kind: 'correct', t: NEG_INF } });
  assert.equal(engine.systemsAt(mw, NEG_INF).get(SYSTEM_ID_BASE + 1), empire);
  assert.throws(() => cmd.createSpaceMap(world, 'Too many', 'galaxy', undefined, { ...MW, systems: 9000 }), /up to 5,000/);
  assert.throws(() => cmd.createSpaceMap(world, 'Odd', 'galaxy', undefined, { ...MW, kind: 'invented', arms: 12 }), /1 to 8 arms/);
  assert.throws(() => cmd.setGalaxy(world, cmd.createSpaceMap(world, 'Stars').result, MW), /Only a galaxy map/);
});
