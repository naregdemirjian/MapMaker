// Names over time: renamed from a date on, in an event or without one; reloads; deleted with the thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });

test('a city renamed from a date on: its name before and after, renamed again, in an event, undone, reloaded, deleted', () => {
  const world = new World();
  cmd.seedProject(world, 'Names');
  const engine = new Engine(world);
  const city = cmd.createEntity(world, { type_id: 'settlement', name: 'Byzantium' }).result;
  cmd.renameFrom(world, { entity: city, name: 'Constantinople', mode: { kind: 'change', t: Y(330) } });
  const r = cmd.renameFrom(world, { entity: city, name: 'Istanbul', mode: { kind: 'change', t: Y(1930) } });
  assert.equal(engine.nameAt(city, Y(100)), null, 'its own name before any rename');
  assert.equal(engine.nameAt(city, Y(1453)), 'Constantinople');
  assert.equal(engine.nameAt(city, Y(1930)), 'Istanbul');
  assert.equal(world.all('event').length, 1, 'no event was made (only the starting map)');
  // Renaming again at the same moment replaces that name.
  cmd.renameFrom(world, { entity: city, name: 'İstanbul', mode: { kind: 'change', t: Y(1930) } });
  assert.equal(engine.nameAt(city, Y(2000)), 'İstanbul');
  assert.equal(world.all('effect').filter((f) => f.kind === 'rename').length, 2);
  // In an event, and from the beginning.
  const ev = cmd.createEvent(world, { name: 'Ottoman conquest', start: Y(1453) }).result;
  cmd.renameFrom(world, { entity: city, name: 'Kostantiniyye', mode: { kind: 'new', eventId: ev } });
  assert.equal(engine.nameAt(city, Y(1500)), 'Kostantiniyye');
  cmd.renameFrom(world, { entity: city, name: 'Lygos', mode: { kind: 'correct', t: NEG_INF } });
  assert.equal(engine.nameAt(city, Y(-1000)), 'Lygos');
  assert.deepEqual(engine.namesOf(city).map((n) => n.name), ['Lygos', 'Constantinople', 'Kostantiniyye', 'İstanbul']);
  // Undo, reload.
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(world.snapshot())));
  assert.equal(new Engine(copy).nameAt(city, Y(1453)), 'Kostantiniyye', 'after reloading (the event wins at its moment)');
  void r;
  assert.throws(() => cmd.renameFrom(world, { entity: city, name: '  ', mode: { kind: 'change', t: Y(1) } }), /new name/);
  // Deleting the city takes its names with it.
  const del = cmd.deleteEntities(world, [city]);
  assert.ok(!world.all('effect').some((f) => f.kind === 'rename'));
  assert.deepEqual(engine.conflicts, []);
  world.applyDiffs(invertDiffs(del.diffs));
  assert.equal(engine.nameAt(city, Y(2000)), 'İstanbul', 'one undo brings it all back');
});
