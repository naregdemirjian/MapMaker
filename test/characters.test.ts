// Characters are points that move over time, never territory: placements from a date on, travelling
// between places or appearing, leaving the map; with or without an event; undo; saving and reloading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine, positionOnTrack, slerpLonLat } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs } from '../src/world-model/schema.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Characters').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const hero = cmd.createEntity(world, { type_id: 'character', name: 'Ilse the Wanderer' }).result;
  const at = (t: ReturnType<typeof Y>) => engine.charactersAt(space, t).find((c) => c.entity === hero) ?? null;
  const place = (lon: number, lat: number, t: ReturnType<typeof Y>, arrive?: 'travel' | 'jump') => cmd.placeCharacter(world, { spaceId: space, entity: hero, lon, lat, mode: { kind: 'change', t }, arrive });
  return { world, space, layer, engine, hero, at, place };
}

test('a character travels between its places, steadily along the shortest path', () => {
  const s = setup();
  const events = s.world.all('event').length;
  s.place(10, 50, Y(1500));
  s.place(30, 40, Y(1600));
  assert.equal(s.world.all('event').length, events, 'no event is made');
  assert.equal(s.at(Y(1499)), null, 'not on the map before it is first placed');
  assert.deepEqual(s.at(Y(1500)), { entity: s.hero, lon: 10, lat: 50, moving: false });
  const mid = s.at(Y(1550))!;
  const expect = slerpLonLat(10, 50, 30, 40, s.engine.characterTrack(s.space, s.hero).length && (Y(1550).day - Y(1500).day) / (Y(1600).day - Y(1500).day));
  assert.ok(Math.abs(mid.lon - expect[0]) < 1e-6 && Math.abs(mid.lat - expect[1]) < 1e-6 && mid.moving, `half-way: ${mid.lon}, ${mid.lat}`);
  assert.ok(mid.lon > 15 && mid.lon < 25);
  assert.deepEqual(s.at(Y(1700)), { entity: s.hero, lon: 30, lat: 40, moving: false }, 'stays at the last place');
  // A point, not territory: nobody owns the place it stands on.
  assert.equal(s.engine.valueAtPoint(s.space, s.layer, lonLatToVec(30, 40), Y(1700)), null);
  assert.equal(s.world.arrangement(s.space).segments.size, 0, 'no borders were drawn');
});

test('appearing instead of travelling; leaving the map; placing again at the same moment moves the placement', () => {
  const s = setup();
  s.place(10, 50, Y(1500));
  const r = s.place(30, 40, Y(1600), 'jump');
  assert.deepEqual(s.at(Y(1599, 12, 31)), { entity: s.hero, lon: 10, lat: 50, moving: false }, 'waits where it was');
  assert.equal(s.at(Y(1600))!.lon, 30, 'and appears at the date');
  cmd.setPlacementArrival(s.world, r.result, 'travel');
  assert.ok(s.at(Y(1550))!.moving, 'switched to travelling');
  // Placing again at the very same moment moves that placement (no second one).
  const before = s.world.all('effect').filter((f) => f.kind === 'place').length;
  s.place(35, 45, Y(1600));
  assert.equal(s.world.all('effect').filter((f) => f.kind === 'place').length, before);
  assert.equal(s.at(Y(1600))!.lon, 35);
  // Leaves the map in 1700; placed again in 1800 (appears there, not travelling from nowhere).
  cmd.characterLeaves(s.world, { spaceId: s.space, entity: s.hero, mode: { kind: 'change', t: Y(1700) } });
  assert.equal(s.at(Y(1750)), null);
  assert.ok(!s.at(Y(1650))!.moving, 'does not travel towards leaving');
  s.place(0, 0, Y(1800));
  assert.deepEqual(s.at(Y(1850)), { entity: s.hero, lon: 0, lat: 0, moving: false });
  assert.deepEqual(s.engine.conflicts, []);
});

test('placements in events, from the start of history, undo, and reloading', () => {
  const s = setup();
  cmd.placeCharacter(s.world, { spaceId: s.space, entity: s.hero, lon: 5, lat: 5, mode: { kind: 'correct', t: NEG_INF } });
  assert.deepEqual(s.at(Y(-3000)), { entity: s.hero, lon: 5, lat: 5, moving: false }, 'on the starting map: there from the beginning');
  const ev = cmd.createEvent(s.world, { name: 'The long march', start: Y(1200) }).result;
  const r = cmd.placeCharacter(s.world, { spaceId: s.space, entity: s.hero, lon: 25, lat: 5, mode: { kind: 'new', eventId: ev } });
  assert.equal(s.at(Y(1300))!.lon, 25, 'placed by the event at its date');
  assert.equal(s.at(Y(1199))!.lon, 5, 'does not travel from the beginning of time');
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(s.at(Y(1300))!.lon, 5, 'undone');
  s.world.applyDiffs(r.diffs);
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(s.world.snapshot())));
  const e2 = new Engine(copy);
  assert.equal(e2.charactersAt(s.space, Y(1300))[0].lon, 25, 'after reloading');
  // Deleting a character takes its places with it.
  cmd.deleteEntity(s.world, s.hero);
  assert.deepEqual(s.engine.charactersAt(s.space, Y(1300)), []);
  assert.ok(!s.world.all('effect').some((f) => f.kind === 'place'), 'its places are gone');
  assert.deepEqual(s.engine.conflicts, []);
  assert.throws(() => cmd.placeCharacter(s.world, { spaceId: s.space, entity: s.hero, lon: 0, lat: 0, mode: { kind: 'change', t: Y(1) } }), /no longer exists/);
});

test('positions on a track across the 180° line take the short way round', () => {
  const tr = [
    { t: Y(1000), lon: 170, lat: 0, off: false, arrive: 'travel' as const, effectId: 'a', eventId: 'e', precedence: 0, eventSeq: 0, ordinal: 1 },
    { t: Y(1002), lon: -170, lat: 0, off: false, arrive: 'travel' as const, effectId: 'b', eventId: 'e', precedence: 0, eventSeq: 0, ordinal: 2 },
  ];
  const mid = positionOnTrack(tr, Y(1001))!;
  assert.ok(Math.abs(Math.abs(mid.lon) - 180) < 0.2, `crosses 180°, not the long way: ${mid.lon}`);
});

test('cities: founded at a date or from the beginning, moved at once (never travelling), abandoned', () => {
  const s = setup();
  const city = cmd.createEntity(s.world, { type_id: 'settlement', name: 'Port Aster' }).result;
  const at = (t: ReturnType<typeof Y>) => s.engine.charactersAt(s.space, t).find((c) => c.entity === city) ?? null;
  const founded = cmd.placeCharacter(s.world, { spaceId: s.space, entity: city, lon: 12, lat: 41, mode: { kind: 'change', t: Y(1500) } });
  cmd.placeCharacter(s.world, { spaceId: s.space, entity: city, lon: 14, lat: 40, mode: { kind: 'change', t: Y(1600) } });
  assert.equal(at(Y(1499)), null, 'not yet founded');
  assert.deepEqual(at(Y(1550)), { entity: city, lon: 12, lat: 41, moving: false }, 'stays put until it moves (cities do not travel)');
  assert.equal(at(Y(1600))!.lon, 14);
  cmd.characterLeaves(s.world, { spaceId: s.space, entity: city, mode: { kind: 'change', t: Y(1700) } });
  assert.equal(at(Y(1701)), null, 'abandoned');
  // From the beginning: on the starting map.
  cmd.placementFromBeginning(s.world, founded.result);
  assert.deepEqual(at(Y(-2000)), { entity: city, lon: 12, lat: 41, moving: false });
  assert.deepEqual(s.engine.conflicts, []);
  // A placement inside an event cannot be moved to the beginning that way.
  const ev = cmd.createEvent(s.world, { name: 'Refounding', start: Y(1800) }).result;
  const inEvent = cmd.placeCharacter(s.world, { spaceId: s.space, entity: city, lon: 13, lat: 42, mode: { kind: 'new', eventId: ev } });
  assert.throws(() => cmd.placementFromBeginning(s.world, inEvent.result), /belongs to an event/);
  assert.equal(at(Y(1850))!.lat, 42, 'refounded by the event');
});
