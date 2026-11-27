// A shot's looks of its own (D239): the rows a shot keeps (countries', groups', layers', areas' colours and styles)
// read through a view of the world for that shot alone; a change of looks made for one shot kept as its rows and
// leaving the world as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { restyleOf, hasRestyle, restyled, shotWorld, restyleAfter, restyleDiffs, withoutRestyle } from '../src/presentation/shot-looks.ts';
import { lookedEntity, groupStyle } from '../src/domain/group-looks.ts';
import { EFFECT_DEFAULTS } from '../src/render-engine/country-look.ts';

function project() {
  const world = new World();
  cmd.seedProject(world, 'Shots');
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Arcadia', color: '#3366cc' }).result;
  const b = cmd.createEntity(world, { type_id: 'polity', name: 'Boreal', color: '#cc6633' }).result;
  const g = cmd.createEntityGroup(world, 'Allies', [a]).result;
  const layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
  return { world, a, b, g, layer };
}

test('a shot\'s own looks as stored are checked; a shot without any has none', () => {
  assert.deepEqual(restyleOf({ entity: { x: { color: '#AABBCC', style: '{}', size: 3 }, y: { name: 'no' } }, layer: { l: { color: '#ffffff', style: '{"fill":"dots"}' } }, sparkle: {} }), {
    entity: { x: { color: '#aabbcc', style: '{}' } }, layer: { l: { style: '{"fill":"dots"}' } },
  }, 'a layer keeps no colour of its own; unknown rows and tables dropped');
  assert.deepEqual(restyleOf('nonsense'), {});
  assert.ok(!hasRestyle({}) && !hasRestyle(null) && hasRestyle({ feature: { f: { style: '{}' } } }));
  assert.ok(restyled({ entity: { x: { style: '{}' } } }, 'entity', 'x') && !restyled({}, 'entity', 'x'));
});

test('the world as a shot shows it: its rows read with the shot\'s colour and style, all else as the world\'s', () => {
  const { world, a, b, layer } = project();
  const restyle = restyleOf({ entity: { [a]: { color: '#ff0000', style: JSON.stringify({ label: { italic: true } }) } }, layer: { [layer]: { style: '{"fill":"dots"}' } } });
  const view = shotWorld(world, restyle);
  assert.equal(view.get('entity', a)!.color, '#ff0000');
  assert.equal(cmd.entityStyle(view.get('entity', a)).label?.italic, true);
  assert.equal(view.get('entity', a)!.name, 'Arcadia', 'the rest of the row as the world\'s');
  assert.equal(view.get('entity', b), world.get('entity', b), 'a row the shot keeps nothing of: the world\'s own');
  assert.equal(view.all('entity').find((e) => e.id === a)!.color, '#ff0000');
  assert.equal(view.rows('entity').find((e) => e.id === a)!.color, '#ff0000');
  assert.equal(JSON.parse(view.get('layer', layer)!.style).fill, 'dots');
  assert.equal(view.get('map_space', world.all('map_space')[0].id), world.all('map_space')[0], 'other tables as they are');
  assert.equal(world.get('entity', a)!.color, '#3366cc', 'the world unchanged');
  assert.equal(shotWorld(world, restyle), view, 'the same view while the shot\'s looks stay the same');
  assert.equal(shotWorld(world, {}), world, 'no looks of its own: the world itself');
  assert.equal(view.get('entity', a), view.get('entity', a), 'the same row each time it is read');
  // A change in the world shows through the shot's view (the row's other fields), its looks still the shot's.
  cmd.updateEntity(world, a, { name: 'Arcady' });
  assert.equal(view.get('entity', a)!.name, 'Arcady');
  assert.equal(view.get('entity', a)!.color, '#ff0000');
});

test('a change of looks for one shot: kept as the shot\'s rows, the world as it was; laid over what the shot kept', () => {
  const { world, a, g } = project();
  const styleBefore = world.get('entity', a)!.style;
  // As the store does it: the shot's looks laid on the world, the change made, both taken away again.
  const forShot = (before: ReturnType<typeof restyleOf>, change: (w: World) => cmd.CommandResult) => {
    const lay = restyleDiffs(world, before);
    world.applyDiffs(lay.apply);
    const r = change(world);
    world.applyDiffs(invertDiffs(r.diffs));
    world.applyDiffs(lay.undo);
    return restyleAfter(before, r.diffs);
  };
  const one = forShot({}, (w) => cmd.setEntityColor(w, a, '#00ff00'));
  assert.equal(one.entity![a].color, '#00ff00');
  assert.equal(world.get('entity', a)!.color, '#3366cc', 'the world as it was');
  assert.equal(world.get('entity', a)!.style, styleBefore);
  // A second change for the shot starts from what it kept: its colour stays, a shadow is added.
  const two = forShot(one, (w) => cmd.setCountryLook(w, a, { elevation: 0, opacity: 1, effects: [{ ...EFFECT_DEFAULTS.shadow }] }));
  assert.equal(two.entity![a].color, '#00ff00');
  assert.equal(cmd.entityStyle({ style: two.entity![a].style! }).look?.effects[0].kind, 'shadow');
  assert.equal(cmd.entityStyle(world.get('entity', a)).look, undefined, 'none in the world');
  // A group's looks for the shot reach its members in the shot's view alone.
  const three = forShot(two, (w) => cmd.setGroupStyle(w, g, { colorMembers: true }));
  assert.equal(groupStyle(shotWorld(world, three).get('entity_group', g)).colorMembers, true);
  assert.equal(groupStyle(world.get('entity_group', g)).colorMembers, undefined);
  const view = shotWorld(world, three);
  assert.equal(lookedEntity(view, view.get('entity', a)!).color, '#00ff00', 'its own colour, chosen for it in the shot, wins over the group\'s');
  // Making or deleting things is not a change of looks.
  assert.throws(() => forShot(three, (w) => cmd.createEntity(w, { type_id: 'polity', name: 'Cyrene' })), /Only looks/);
  assert.ok(world.all('entity').every((e) => e.name !== 'Cyrene'), 'taken away again');
  // Back to everywhere's for one row.
  assert.deepEqual(withoutRestyle(three, 'entity', [a]).entity, undefined);
  assert.ok(withoutRestyle(three, 'entity', [a]).entity_group);
});
