// An expansion from several starting points at once (Stage 6, D91): each place changes hands when the
// front from the nearest starting point reaches it, so two pincers meet in the middle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { ring } from './helpers.ts';

const D = (y: number, m = 1) => gregorian.fromCivil({ year: y, month: m, day: 1 });

test('an expansion from two ends at once: the ends change hands first, the middle last; undone to one point', () => {
  const world = new World();
  const space = cmd.seedProject(world, 'Pincers').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const [A, B] = ['Aria', 'Bel'].map((name) => cmd.createEntity(world, { type_id: 'polity', name }).result);
  const strip = ring([[0, -2], [40, -2], [40, 2], [0, 2]]);
  cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: strip, value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const ev = cmd.createEvent(world, { name: 'Pincers', start: D(1900), end: D(1910) }).result;
  cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: strip, value: B, snap: 1e-7, mode: { kind: 'new', eventId: ev }, transition: { style: 'advance', origin: [0.5, 0], easing: 'linear' } });
  const at = (lon: number, t: ReturnType<typeof D>) => engine.valueAtPoint(space, layer, lonLatToVec(lon, 0), t);
  const effect = world.all('effect').find((f) => f.event_id === ev)!;
  // From one end: half way through, the near half has changed hands, the far end not.
  assert.equal(at(3, D(1905)), B);
  assert.equal(at(37, D(1905)), A);
  // From both ends: half way through, both ends have, the middle not; at the end, all of it.
  const r = cmd.addTransitionOrigin(world, effect.id, [39.5, 0]);
  assert.equal(at(3, D(1905)), B);
  assert.equal(at(37, D(1905)), B, 'the far end too, from its own starting point');
  assert.equal(at(20, D(1905)), A, 'the middle last');
  assert.equal(at(20, D(1910)), B);
  assert.equal(at(15, D(1908)), B, 'three quarters of the way in from the first end');
  assert.equal(at(20, D(1908)), A, 'the middle is farthest from both');
  // Undone, and cleared to the first point only.
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(at(37, D(1905)), A);
  cmd.addTransitionOrigin(world, effect.id, [39.5, 0]);
  cmd.clearTransitionOrigins(world, effect.id);
  assert.equal(at(37, D(1905)), A);
  // Only an expansion has starting points.
  cmd.setEffectTransition(world, effect.id, { style: 'fade' });
  assert.throws(() => cmd.addTransitionOrigin(world, effect.id, [10, 0]), /expansion/);
});
