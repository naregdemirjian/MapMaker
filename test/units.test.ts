// Units (Stage 7, D90): a character can belong to a country (it is then drawn in that country's colour)
// and can show its route as a trail or as an arrow of advance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { unitOfStyle } from '../src/render-engine/icons.ts';

test('a unit belongs to a country and shows its route; checked, cleared and undone', () => {
  const world = new World();
  cmd.seedProject(world, 'Units');
  const varn = cmd.createEntity(world, { type_id: 'polity', name: 'Varn' }).result;
  const army = cmd.createEntity(world, { type_id: 'character', name: 'Third Army' }).result;
  const style = () => cmd.entityStyle(world.get('entity', army));
  const r = cmd.setEntityStyle(world, army, { side: varn, route: 'arrow' });
  assert.equal(style().side, varn);
  assert.equal(style().route, 'arrow');
  assert.deepEqual(unitOfStyle(world.get('entity', army)!.style), { side: varn, route: 'arrow' });
  // Only a country or a faction can have units; routes are a trail or an arrow.
  const city = cmd.createEntity(world, { type_id: 'settlement', name: 'Port' }).result;
  assert.throws(() => cmd.setEntityStyle(world, army, { side: city }), /country or a faction/);
  assert.throws(() => cmd.setEntityStyle(world, army, { side: 'ent_missing' }), /country or a faction/);
  assert.throws(() => cmd.setEntityStyle(world, army, { route: 'zigzag' as never }), /Unknown route/);
  // Its icon and the rest of its look are kept.
  cmd.setEntityStyle(world, army, { icon: { set: 'tank' } });
  cmd.setEntityStyle(world, army, { route: 'trail' });
  assert.equal(style().icon?.set, 'tank');
  assert.equal(style().side, varn);
  cmd.setEntityStyle(world, army, { side: null, route: null });
  assert.equal(style().side, undefined);
  assert.equal(style().route, undefined);
  assert.deepEqual(unitOfStyle(world.get('entity', army)!.style), { side: null, route: null });
  // Undone in one step.
  const again = cmd.setEntityStyle(world, army, { side: varn });
  world.applyDiffs(invertDiffs(again.diffs));
  assert.equal(style().side, undefined);
  assert.ok(r.diffs.length > 0);
  assert.equal(unitOfStyle('not json').side, null);
});
