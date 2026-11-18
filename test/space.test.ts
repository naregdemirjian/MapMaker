// Space maps (Stage 11, D110): the nearby stars, how they are seen, and the map that holds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeStars, findStars, starKind, starColour, starSize, galacticOf, primaryOf, systemOf } from '../src/space/catalogue.ts';
import { makeSpaceView, orbitCamera, panSpaceCamera, spaceCamera } from '../src/space/space-view.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { isSpaceMap, spaceSettingsOf } from '../src/world-model/world-settings.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cat = decodeStars(JSON.parse(readFileSync(join(root, 'data', 'stars', 'nearby-50ly.json'), 'utf8')));
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

test('the nearby stars: every star within 50 light-years, the Sun at the middle, the nearest first', () => {
  assert.equal(cat.radiusLy, 50);
  assert.ok(cat.stars.length > 900, `${cat.stars.length} stars`);
  assert.ok(cat.stars.every((s) => s.dist <= 50.001));
  for (let i = 1; i < cat.stars.length; i++) assert.ok(cat.stars[i].dist >= cat.stars[i - 1].dist - 1e-9, 'nearest first');
  const sun = cat.byId.get(0)!;
  assert.equal(sun.name, 'Sol');
  assert.equal(sun.dist, 0);
  const by = (name: string) => cat.stars.find((s) => s.name === name)!;
  assert.ok(near(by('Proxima Centauri').dist, 4.24, 0.03), `Proxima ${by('Proxima Centauri').dist}`);
  assert.ok(near(by('Sirius').dist, 8.6, 0.05));
  assert.ok(near(by('Vega').dist, 25.0, 0.2));
  // Toward the galactic centre (positive x) for Barnard's Star in Ophiuchus; Sirius away from it.
  assert.ok(by("Barnard's Star").x > 0 && by('Sirius').x < 0);
  // Systems: Alpha Centauri's B with A; companions named apart.
  assert.equal(by('Toliman').system, by('Rigil Kentaurus').id);
  // A system is its primary and companions; the Sun (star 0, "no primary") is a system of its own.
  assert.equal(primaryOf(cat, by('Toliman').id), by('Rigil Kentaurus').id);
  assert.deepEqual(systemOf(cat, by('Toliman').id).sort(), [by('Rigil Kentaurus').id, by('Toliman').id].sort());
  assert.deepEqual(systemOf(cat, 0), [0]);
  assert.deepEqual(systemOf(cat, by('Sirius').id).length, 2);
  assert.deepEqual(systemOf(cat, by("Barnard's Star").id), [by("Barnard's Star").id]);
  assert.ok(cat.stars.some((s) => s.name === '61 Cyg B'));
  // Found by either name, accents and case ignored.
  assert.deepEqual(findStars(cat, 'tau ceti').map((s) => s.name), ['τ Cet']);
  assert.equal(findStars(cat, 'EPSILON eridani')[0].name, 'Ran');
  assert.equal(findStars(cat, 'barnard')[0].name, "Barnard's Star");
  assert.deepEqual(findStars(cat, '  '), []);
});

test('stars by their kind: colours, words and sizes', () => {
  assert.equal(starKind('M5Ve'), 'Red dwarf');
  assert.equal(starKind('G2V'), 'Sun-like star');
  assert.equal(starKind('K1V'), 'Orange dwarf');
  assert.equal(starKind('DA2'), 'White dwarf');
  assert.equal(starKind('K0IIIvar'), 'Red giant');
  assert.equal(starKind('A0m...'), 'White star');
  assert.equal(starKind('sdM4'), 'Red dwarf');
  assert.equal(starKind('F5IV-V'), 'Subgiant');
  assert.notEqual(starColour('M5Ve'), starColour('A0V'));
  assert.equal(starColour('DA2'), '#dfe8ff');
  assert.ok(starSize(-1) > starSize(5) && starSize(5) > starSize(15) && starSize(30) >= 1.6);
  const g = galacticOf(0, 10, 0);
  assert.ok(near(g.l, 90, 1e-9) && near(g.b, 0, 1e-9));
  assert.ok(near(galacticOf(0, 0, 5).b, 90, 1e-9));
});

test('seeing space: the point looked at in the middle, nearer stars larger, turned and moved by dragging', () => {
  const cam = spaceCamera();
  const v = makeSpaceView(cam, 1000, 600, 50);
  const mid = v.project([0, 0, 0])!;
  assert.ok(near(mid[0], 500, 1e-6) && near(mid[1], 300, 1e-6) && near(mid[2], 1, 1e-9), 'the Sun in the middle');
  // Toward the camera is nearer (larger), away is farther.
  const towardCam = v.project([-v.forward[0] * 20, -v.forward[1] * 20, -v.forward[2] * 20])!;
  const away = v.project([v.forward[0] * 20, v.forward[1] * 20, v.forward[2] * 20])!;
  assert.ok(towardCam[2] > 1 && away[2] < 1);
  // From straight above, galactic north is toward the viewer: a star above the plane is nearer.
  const top = makeSpaceView({ ...cam, lat: 89.9 }, 1000, 600, 50);
  assert.ok(top.project([0, 0, 10])![2] > top.project([0, 0, -10])![2]);
  // Up on the picture, from the side: a star above the galactic plane is drawn higher.
  const side = makeSpaceView({ ...cam, lat: 0 }, 1000, 600, 50);
  assert.ok(side.project([0, 0, 10])![1] < 300);
  // Zooming in spreads the stars out.
  const z1 = makeSpaceView({ ...cam, zoom: 1 }, 1000, 600, 50);
  const p0 = v.project([10, 0, 0])!, p1 = z1.project([10, 0, 0])!;
  assert.ok(near(Math.hypot(p1[0] - 500, p1[1] - 300), 2 * Math.hypot(p0[0] - 500, p0[1] - 300), 1e-6));
  // Dragging: sideways turns around the pole, up and down tilts (never past the poles).
  const o = orbitCamera(cam, 100, 0);
  assert.ok(near(o.lon, cam.lon - 35, 1e-9) && o.lat === cam.lat);
  assert.ok(orbitCamera(cam, 0, -1000).lat >= -89.9 && orbitCamera(cam, 0, 1000).lat <= 89.9);
  // Moving the point looked at: the old middle follows the pointer.
  const moved = panSpaceCamera(cam, v, 30, -20);
  const after = makeSpaceView(moved, 1000, 600, 50).project([0, 0, 0])!;
  assert.ok(near(after[0], 530, 1e-6) && near(after[1], 280, 1e-6), `${after}`);
  // Behind the camera: not drawn.
  const behind = v.project([-v.forward[0] * 1000, -v.forward[1] * 1000, -v.forward[2] * 1000]);
  assert.equal(behind, null);
});

test('a star map: made with one command, a space map with an (empty) parcel map, kept when the project is opened again; undone', async () => {
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Stars');
  const r = cmd.createSpaceMap(world, 'Nearby stars');
  const sp = world.get('map_space', r.result)!;
  assert.equal(sp.kind, 'space');
  assert.ok(isSpaceMap(sp));
  assert.deepEqual(spaceSettingsOf(sp), { catalogue: 'nearby', radiusLy: 50 });
  assert.equal(spaceSettingsOf(world.all('map_space').find((m) => m.kind === 'sphere')), null);
  assert.ok(world.arrangement(sp.id), 'a parcel map, for what asks for one');
  const again = World.fromSnapshot(world.snapshot());
  assert.equal(again.get('map_space', sp.id)!.kind, 'space');
  assert.ok(again.arrangement(sp.id));
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(world.get('map_space', sp.id), undefined, 'undone in one step');
});

test('stars held over time (D111): given from a date, taken in an event, given up; replaced at the same moment; the holder deleted; undone', async () => {
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const { gregorian } = await import('../src/core-time/index.ts');
  const Y = (y: number) => gregorian.fromCivil({ year: y });
  const world = new World();
  const engine = new Engine(world);
  const earth = cmd.seedProject(world, 'Stars').result.spaceId;
  const sp = cmd.createSpaceMap(world, 'Nearby').result;
  const terra = cmd.createEntity(world, { type_id: 'polity', name: 'Terran Union' }).result;
  const kharr = cmd.createEntity(world, { type_id: 'polity', name: 'Kharr' }).result;
  const acen = [71456, 71453], proxima = 70666;
  const given = cmd.holdStars(world, { spaceId: sp, stars: [...acen, proxima, proxima], entity: terra, mode: { kind: 'change', t: Y(2150) }, label: 'Alpha Centauri' });
  assert.equal(given.result, 3, 'each star once');
  assert.equal(given.label, 'Give Alpha Centauri to Terran Union');
  assert.equal(engine.systemsAt(sp, Y(2149)).size, 0, 'nothing held before');
  assert.deepEqual([...engine.systemsAt(sp, Y(2151)).entries()].sort(), [[70666, terra], [71453, terra], [71456, terra]]);
  // Proxima taken by the Kharr in an event of 2200.
  const war = cmd.createEvent(world, { name: 'Kharr incursion', start: Y(2200), end: Y(2201) }).result;
  cmd.holdStars(world, { spaceId: sp, stars: [proxima], entity: kharr, mode: { kind: 'new', eventId: war } });
  assert.equal(engine.systemsAt(sp, Y(2199)).get(proxima), terra);
  assert.equal(engine.systemsAt(sp, Y(2200)).get(proxima), kharr, 'from the event\'s start');
  // Given up from 2250: held by nobody.
  cmd.holdStars(world, { spaceId: sp, stars: [proxima], entity: '', mode: { kind: 'change', t: Y(2250) } });
  assert.equal(engine.systemsAt(sp, Y(2251)).has(proxima), false);
  assert.equal(engine.systemsAt(sp, Y(2251)).get(71456), terra, 'the others kept');
  assert.deepEqual(engine.systemSteps(sp, proxima).map((x) => x.entity), [terra, kharr, '']);
  // The same star at the same moment again: that change replaced, not a second one.
  const effects = world.all('effect').length;
  cmd.holdStars(world, { spaceId: sp, stars: [proxima], entity: kharr, mode: { kind: 'change', t: Y(2250) } });
  assert.equal(world.all('effect').length, effects);
  assert.equal(engine.systemsAt(sp, Y(2251)).get(proxima), kharr);
  // Refused: another kind of map, someone who no longer exists, no stars.
  assert.throws(() => cmd.holdStars(world, { spaceId: earth, stars: [proxima], entity: terra, mode: { kind: 'change', t: Y(2150) } }), /star maps/);
  assert.throws(() => cmd.holdStars(world, { spaceId: sp, stars: [proxima], entity: 'ent_gone', mode: { kind: 'change', t: Y(2150) } }), /no longer exists/);
  assert.throws(() => cmd.holdStars(world, { spaceId: sp, stars: [], entity: terra, mode: { kind: 'change', t: Y(2150) } }), /at least one star/);
  // The Kharr deleted: their holdings go with them (Proxima back to the Terran Union from 2200).
  const del = cmd.deleteEntity(world, kharr);
  assert.equal(engine.systemsAt(sp, Y(2210)).get(proxima), terra);
  world.applyDiffs(invertDiffs(del.diffs));
  assert.equal(engine.systemsAt(sp, Y(2210)).get(proxima), kharr, 'undone: back again');
  // Undone: the first gift.
  world.applyDiffs(invertDiffs(given.diffs));
  assert.equal(engine.systemsAt(sp, Y(2151)).has(71456), false);
});

test('lanes between stars (D112): opened from a date, growing from star to star over an event, closed; replaced at the same moment; refused; the owner deleted; undone', async () => {
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const { gregorian } = await import('../src/core-time/index.ts');
  const Y = (y: number) => gregorian.fromCivil({ year: y });
  const world = new World();
  const engine = new Engine(world);
  const earth = cmd.seedProject(world, 'Lanes').result.spaceId;
  const sp = cmd.createSpaceMap(world, 'Nearby').result;
  const terra = cmd.createEntity(world, { type_id: 'polity', name: 'Terran Union' }).result;
  const rigil = 71456, barnard = 87665;
  const first = cmd.setLane(world, { spaceId: sp, a: 0, b: rigil, on: true, entity: terra, mode: { kind: 'change', t: Y(2150) }, label: 'Sol – Rigil Kentaurus' });
  assert.equal(first.label, 'Open Sol – Rigil Kentaurus (Terran Union)');
  assert.deepEqual(engine.lanesAt(sp, Y(2149)), []);
  assert.deepEqual(engine.lanesAt(sp, Y(2151)).map((l) => [l.a, l.b, l.entity, l.progress]), [[0, rigil, terra, 1]]);
  // An expedition: a lane opened in an event of ten years grows from Rigil Kentaurus to Barnard's Star.
  const voyage = cmd.createEvent(world, { name: 'Barnard expedition', start: Y(2200), end: Y(2210) }).result;
  cmd.setLane(world, { spaceId: sp, a: rigil, b: barnard, on: true, entity: terra, mode: { kind: 'new', eventId: voyage }, grow: true });
  const half = engine.lanesAt(sp, Y(2205)).find((l) => l.b === barnard)!;
  assert.ok(Math.abs(half.progress - 0.5) < 0.002, `half way there half way through (${half.progress})`);
  assert.equal(half.a, rigil, 'from the star it set out from');
  assert.equal(engine.lanesAt(sp, Y(2211)).find((l) => l.b === barnard)!.progress, 1, 'whole once the event is over');
  // Closed from 2250 (the stars in either order).
  cmd.setLane(world, { spaceId: sp, a: rigil, b: 0, on: false, entity: '', mode: { kind: 'change', t: Y(2250) } });
  assert.deepEqual(engine.lanesAt(sp, Y(2251)).map((l) => l.b), [barnard]);
  assert.deepEqual(engine.laneSteps(sp, rigil, 0).map((x) => x.on), [true, false]);
  assert.deepEqual(engine.lanesOf(sp, rigil).length, 2, 'both lanes touch Rigil Kentaurus');
  // The same lane at the same moment: replaced.
  const n = world.all('effect').length;
  cmd.setLane(world, { spaceId: sp, a: 0, b: rigil, on: true, entity: '', mode: { kind: 'change', t: Y(2250) } });
  assert.equal(world.all('effect').length, n);
  assert.equal(engine.lanesAt(sp, Y(2251)).find((l) => l.b === rigil || l.a === rigil && l.b === 0)?.entity, '', 'open again, belonging to nobody');
  // Refused.
  assert.throws(() => cmd.setLane(world, { spaceId: sp, a: 5, b: 5, on: true, entity: '', mode: { kind: 'change', t: Y(2150) } }), /two different stars/);
  assert.throws(() => cmd.setLane(world, { spaceId: earth, a: 0, b: rigil, on: true, entity: '', mode: { kind: 'change', t: Y(2150) } }), /star maps/);
  assert.throws(() => cmd.setLane(world, { spaceId: sp, a: 0, b: rigil, on: true, entity: 'ent_gone', mode: { kind: 'change', t: Y(2150) } }), /no longer exists/);
  // The owner deleted: its lanes go with it; undone.
  const del = cmd.deleteEntity(world, terra);
  assert.deepEqual(engine.lanesAt(sp, Y(2205)), []);
  world.applyDiffs(invertDiffs(del.diffs));
  assert.equal(engine.lanesAt(sp, Y(2205)).length, 2);
  world.applyDiffs(invertDiffs(first.diffs));
  assert.equal(engine.lanesAt(sp, Y(2151)).length, 0, 'the first lane undone');
});
