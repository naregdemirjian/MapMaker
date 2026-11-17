// Working with many things at once: groups (folders) of countries, labels and pictures of many
// countries switched together, many events or countries deleted at once; each one undo step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { ring, square } from './helpers.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Workflow').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const ents = ['Ardia', 'Belmar', 'Corvane', 'Dovren'].map((name) => cmd.createEntity(world, { type_id: 'polity', name }).result);
  return { world, space, layer, engine, ents };
}

test('groups of countries: made from a choice, renamed, moved in and out, deleted keeping their countries; undo', () => {
  const s = setup();
  const g = cmd.createEntityGroup(s.world, 'My nations', [s.ents[0], s.ents[1]]);
  assert.deepEqual(s.world.all('entity').filter((e) => e.group_id === g.result).map((e) => e.name).sort(), ['Ardia', 'Belmar']);
  cmd.setEntitiesGroup(s.world, [s.ents[2]], g.result);
  assert.equal(s.world.get('entity', s.ents[2])!.group_id, g.result);
  cmd.setEntitiesGroup(s.world, [s.ents[0]], '');
  assert.equal(s.world.get('entity', s.ents[0])!.group_id, '');
  cmd.renameEntityGroup(s.world, g.result, 'Allies');
  assert.equal(s.world.get('entity_group', g.result)!.name, 'Allies');
  const del = cmd.deleteEntityGroup(s.world, g.result);
  assert.equal(s.world.all('entity').length, 4 + 1, 'every country is still there (and the planet)');
  assert.ok(s.world.all('entity').every((e) => e.group_id === ''), 'ungrouped');
  s.world.applyDiffs(invertDiffs(del.diffs));
  assert.equal(s.world.all('entity').filter((e) => e.group_id === g.result).length, 2, 'undo restores the group and its members');
  assert.throws(() => cmd.setEntitiesGroup(s.world, [s.ents[3]], 'egrp_gone'), /no longer exists/);
});

test('labels and pictures of many countries switched at once, and back; one undo step each', () => {
  const s = setup();
  cmd.setEntityStyle(s.world, s.ents[0], { fill: { kind: 'image', asset: 'data/flags/fr.svg', fit: 'cover' } });
  cmd.setEntityStyle(s.world, s.ents[1], { label: { color: '#ff0000' } });
  const hide = cmd.setLabelsHidden(s.world, s.ents, true);
  assert.ok(s.ents.every((id) => cmd.entityStyle(s.world.get('entity', id)).label?.hidden));
  assert.equal(cmd.entityStyle(s.world.get('entity', s.ents[1])).label?.color, '#ff0000', 'its own label settings are kept');
  const show = cmd.setLabelsHidden(s.world, s.ents, false);
  assert.ok(s.ents.every((id) => !cmd.entityStyle(s.world.get('entity', id)).label?.hidden));
  s.world.applyDiffs(invertDiffs(show.diffs));
  assert.ok(s.ents.every((id) => cmd.entityStyle(s.world.get('entity', id)).label?.hidden), 'undo hides them again');
  // Undoing the hide (on its own) shows them again.
  s.world.applyDiffs(invertDiffs(hide.diffs));
  // Pictures off: the colour shows, the picture is kept; on again: it is back.
  cmd.setFillsShown(s.world, s.ents, false);
  const f = cmd.entityStyle(s.world.get('entity', s.ents[0])).fill!;
  assert.equal(f.off, true);
  assert.equal(f.asset, 'data/flags/fr.svg');
  assert.equal(cmd.entityStyle(s.world.get('entity', s.ents[2])).fill, undefined, 'countries without a picture are left alone');
  cmd.setFillsShown(s.world, s.ents, true);
  assert.equal(cmd.entityStyle(s.world.get('entity', s.ents[0])).fill!.off, undefined);
});

test('many events deleted at once, with their changes; many added to a group; one undo brings all back', () => {
  const s = setup();
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(0, 0, 10)), value: s.ents[0], snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const evs = [1500, 1600, 1700, 1800].map((y, i) => {
    const id = cmd.createEvent(s.world, { name: `E${y}`, start: Y(y) }).result;
    cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(-6 + i * 4, 0, 1.5)), value: s.ents[1], snap: 1e-7, mode: { kind: 'new', eventId: id } });
    return id;
  });
  const grp = cmd.createEventGroup(s.world, 'Wars').result;
  cmd.addEventsToGroup(s.world, evs.slice(0, 3), grp);
  assert.equal(s.world.all('event_group_member').filter((m) => m.group_id === grp).length, 3);
  cmd.addEventsToGroup(s.world, evs, grp);
  assert.equal(s.world.all('event_group_member').filter((m) => m.group_id === grp).length, 4, 'no duplicates');
  const effects = s.world.all('effect').length;
  const t0 = performance.now();
  const r = cmd.deleteEvents(s.world, [...evs.slice(0, 3), 'evt_base']);
  const ms = performance.now() - t0;
  assert.equal(s.world.all('event').filter((e) => evs.includes(e.id)).length, 1, 'three deleted, the starting map never');
  assert.equal(s.world.all('effect').length, effects - 3);
  assert.equal(s.engine.valueAtPoint(s.space, s.layer, [1, 0, 0], Y(2000)), s.ents[0]);
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(s.world.all('event').filter((e) => evs.includes(e.id)).length, 4, 'one undo');
  assert.ok(ms < 1000, `quick (${ms.toFixed(0)} ms)`);
});

test('deleting several countries at once takes each out of history; one undo', () => {
  const s = setup();
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(0, 0, 10)), value: s.ents[0], snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const ev = cmd.createEvent(s.world, { name: 'Split', start: Y(1500) }).result;
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(3, 3, 2)), value: s.ents[1], snap: 1e-7, mode: { kind: 'new', eventId: ev } });
  const r = cmd.deleteEntities(s.world, [s.ents[1], s.ents[2]]);
  assert.equal(s.world.all('entity').filter((e) => e.type_id === 'polity').length, 2);
  assert.deepEqual(s.engine.conflicts, []);
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(s.world.all('entity').filter((e) => e.type_id === 'polity').length, 4);
});
