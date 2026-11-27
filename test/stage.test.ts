// The Looks studio's stage (D249): a thing drawn alone, the other countries muted; the box and middle of its outline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { aloneWorld, keptBy, boxOf, middleOf, MUTED } from '../src/ui/stage.ts';

function project() {
  const world = new World();
  cmd.seedProject(world, 'Stage');
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Arcadia' }).result;
  const b = cmd.createEntity(world, { type_id: 'polity', name: 'Boreal' }).result;
  const c = cmd.createEntity(world, { type_id: 'settlement', name: 'Port' }).result;
  return { world, a, b, c };
}

test('alone: the other countries muted, without looks, fills or names; the kept one and the rest as they are', () => {
  const { world, a, b, c } = project();
  cmd.setCountryLook(world, b, { elevation: 0, opacity: 1, effects: [] } as never);
  const colourA = world.get('entity', a)!.color, styleA = world.get('entity', a)!.style;
  const v = aloneWorld(world, new Set([a]));
  assert.equal(v.get('entity', a)!.color, colourA);
  assert.equal(v.get('entity', a)!.style, styleA);
  const other = v.get('entity', b)!;
  assert.equal(other.color, MUTED);
  const st = JSON.parse(other.style);
  assert.equal(st.label.hidden, true);
  assert.equal(st.look, undefined);
  assert.equal(v.get('entity', c)!.color, world.get('entity', c)!.color, 'a city as it is');
  assert.equal(world.get('entity', b)!.color === MUTED, false, 'the world itself untouched');
});

test('what a thing keeps on the stage: a country itself, a group with its members, nothing for the rest', () => {
  const { world, a, c } = project();
  assert.deepEqual([...keptBy(world, { kind: 'entity', id: a })!], [a]);
  assert.equal(keptBy(world, { kind: 'entity', id: c }), null, 'a city is drawn among the rest');
  assert.equal(keptBy(world, null), null);
});

test('the box of an outline, across 180° too, and its middle', () => {
  assert.deepEqual(boxOf([[[[10, 40], [20, 40], [20, 50], [10, 50]]]]), [10, 40, 20, 50]);
  // Fiji-like: points either side of 180°.
  const box = boxOf([[[[178, -18], [179.5, -17], [-179.5, -16], [-178, -18]]]])!;
  assert.deepEqual(box, [178, -18, -178, -16]);
  assert.deepEqual(middleOf(box), [180, -17]);
  assert.deepEqual(middleOf([10, 40, 20, 50]), [15, 45]);
  assert.equal(boxOf([]), null);
});
