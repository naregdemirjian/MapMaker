// Locked countries (fifth feedback round, D87): a locked country keeps the land it holds at the moment
// of an edit, is given no land, cannot be split, merged or annexed; unlocked, it changes as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { ring, square } from './helpers.ts';

const D = (y: number) => gregorian.fromCivil({ year: y, month: 1, day: 1 });

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Locks').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const [A, B, C] = ['Aria', 'Bel', 'Cor'].map((name) => cmd.createEntity(world, { type_id: 'polity', name }).result);
  // Aria holds 0..10°E, Bel 10..20°E (on the starting map); Cor nothing yet.
  cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(square(5, 0, 5)), value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(square(15, 0, 5)), value: B, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const owner = (lon: number, t = D(1950)) => engine.valueAtPoint(space, layer, lonLatToVec(lon, 0), t);
  const paint = (lon: number, half: number, value: string | null, mode: cmd.EditMode) =>
    cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(square(lon, 0, half)), value, snap: 1e-7, mode });
  return { world, engine, space, layer, A, B, C, owner, paint };
}

test('a locked country keeps its land: a stroke across it changes only the land around it, and says so', () => {
  const s = setup();
  cmd.setLocked(s.world, [s.A], true);
  assert.equal(cmd.isLocked(s.world, s.A), true);
  // Cor takes 3..17°E from 1900: Bel's part changes hands, Aria's stays.
  const r = s.paint(10, 7, s.C, { kind: 'change', t: D(1900) });
  assert.equal(s.owner(5), s.A, 'the locked country keeps its land');
  assert.equal(s.owner(15), s.C, 'the other country\'s land changes hands');
  assert.deepEqual(cmd.takeLockedSkipped(), ['Aria'], 'the locked country left out is named once');
  assert.deepEqual(cmd.takeLockedSkipped(), [], 'and only once');
  assert.ok(r.diffs.length);
  // In an event, and as a correction of the starting map, the same.
  const ev = cmd.createEvent(s.world, { name: 'War', start: D(1920) }).result;
  s.paint(5, 2, s.B, { kind: 'new', eventId: ev });
  s.paint(5, 2, null, { kind: 'correct', t: NEG_INF });
  assert.equal(s.owner(5), s.A);
  assert.equal(s.owner(5, D(1800)), s.A);
});

test('a locked country is given no land, and cannot be split, merged or annexed; unlocked, it can', () => {
  const s = setup();
  cmd.setLocked(s.world, [s.A], true);
  assert.throws(() => s.paint(15, 2, s.A, { kind: 'change', t: D(1900) }), /Aria.*locked/);
  assert.throws(() => cmd.mergeTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ids: [s.A, s.B], into: s.B, t: D(1900), mode: { kind: 'change', t: D(1900) } }), /locked/);
  assert.throws(() => cmd.splitTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, line: [lonLatToVec(5, -10), lonLatToVec(5, 10)], pick: lonLatToVec(3, 0), t: D(1900), snap: 1e-7, to: { name: 'West Aria' }, mode: { kind: 'change', t: D(1900) } }), /locked/);
  const ev = cmd.createEvent(s.world, { name: 'Annexation', start: D(1930) }).result;
  assert.throws(() => cmd.annex(s.world, s.engine, { spaceId: s.space, layerId: s.layer, eventId: ev, from: s.A, to: s.B }), /locked/);
  // Unlocked (and the lock undone the same way), edits reach it again.
  const lock = cmd.setLocked(s.world, [s.A], false);
  assert.equal(cmd.isLocked(s.world, s.A), false);
  s.paint(5, 2, s.B, { kind: 'change', t: D(1900) });
  assert.equal(s.owner(5), s.B);
  s.world.applyDiffs(invertDiffs(lock.diffs));
  assert.equal(cmd.isLocked(s.world, s.A), true, 'undo locks it again');
  // Locking keeps the rest of its look.
  cmd.setEntityStyle(s.world, s.B, { label: { size: 2 } as never });
  cmd.setLocked(s.world, [s.B], true);
  assert.ok(cmd.entityStyle(s.world.get('entity', s.B)).label, 'its label style kept');
  assert.throws(() => cmd.setLocked(s.world, ['ent_missing'], true), /no longer exists/);
});
