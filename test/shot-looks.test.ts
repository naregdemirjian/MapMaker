// A shot's looks of its own (D239) and its keyed settings (D240): the rows a shot keeps (countries', groups', layers', areas' colours and styles)
// read through a view of the world for that shot alone; a change of looks made for one shot kept as its rows and
// leaving the world as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { restyleOf, hasRestyle, restyled, shotWorld, shotLooksAt, restyleAfter, restyleDiffs, withoutRestyle, tracksOf, keyedValue, looksAfter, trackIdOf, withKey, withoutKey, movedKey, easedKey, withoutTrack, withoutRowKeys } from '../src/presentation/shot-looks.ts';
import { lookedEntity, groupStyle } from '../src/domain/group-looks.ts';
import { EFFECT_DEFAULTS, countryLookOf } from '../src/render-engine/country-look.ts';

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

// ---- Keys (D240) ----

test('a shot\'s keyed settings as stored are checked: keys in order, one a frame; a colour keyed only with colours', () => {
  const tracks = tracksOf([
    { table: 'entity', id: 'x', path: ['color'], label: 'Colour', keys: [{ frame: 10, value: '#FFFFFF', ease: 'smooth' }, { frame: 0, value: '#000000' }, { frame: 10, value: '#ff0000' }, { frame: 3, value: 7 }] },
    { table: 'entity', id: 'x', path: ['style', 'look', 'effects', { where: { kind: 'shadow' }, nth: 0 }, 'distance'], label: 'Look · Drop shadow · Distance', keys: [{ frame: 5, value: 12, ease: 'zigzag' }] },
    { table: 'layer', id: 'l', path: ['color'], label: 'no colour of its own', keys: [{ frame: 0, value: '#000000' }] },
    { table: 'entity', id: 'x', path: ['style'], label: 'the whole style', keys: [{ frame: 0, value: 1 }] },
    { table: 'event', id: 'e', path: ['style', 'x'], keys: [{ frame: 0, value: 1 }] },
    { table: 'entity', id: 'y', path: ['style', 'label', 'sizeScale'], label: 'Label · Size', make: true, keys: [] },
    'nonsense',
  ]);
  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks[0].keys, [{ frame: 0, value: '#000000', ease: 'linear' }, { frame: 10, value: '#ff0000', ease: 'linear' }], 'sorted, the last at a frame kept, a number dropped from a colour');
  assert.equal(tracks[1].keys[0].ease, 'linear', 'an unknown pace: even');
  assert.deepEqual(tracksOf(null), []);
});

test('a keyed setting between its keys: numbers eased, colours mixed, held; before the first and after the last, theirs', () => {
  const t = { keys: [{ frame: 10, value: 0, ease: 'linear' as const }, { frame: 20, value: 100, ease: 'smooth' as const }, { frame: 30, value: 50, ease: 'hold' as const }, { frame: 40, value: 0, ease: 'linear' as const }] };
  assert.equal(keyedValue(t, 0), 0);
  assert.equal(keyedValue(t, 15), 50);
  assert.equal(keyedValue(t, 12.5), 25, 'between frames too (motion blur)');
  assert.ok(Math.abs((keyedValue(t, 22) as number) - (100 - 50 * 0.2 * 0.2 * (3 - 0.4))) < 1e-9, 'eased in and out');
  assert.equal(keyedValue(t, 35), 50, 'held until the next key');
  assert.equal(keyedValue(t, 40), 0);
  assert.equal(keyedValue(t, 99), 0);
  assert.equal(keyedValue({ keys: [{ frame: 0, value: '#000000', ease: 'linear' }, { frame: 10, value: '#ffffff', ease: 'linear' }] }, 5), '#808080');
  assert.equal(keyedValue({ keys: [] }, 5), undefined);
});

test('the world as a shot shows it at a frame: each keyed setting at its value there, the world unchanged', () => {
  const { world, a, b } = project();
  cmd.setCountryLook(world, a, { elevation: 0, opacity: 1, effects: [{ ...EFFECT_DEFAULTS.stroke }, { ...EFFECT_DEFAULTS.shadow }] });
  const distance = ['style', 'look', 'effects', { where: { kind: 'shadow' }, nth: 0 }, 'distance'];
  const tracks = tracksOf([
    { table: 'entity', id: a, path: ['color'], label: 'Colour', keys: [{ frame: 0, value: '#000000' }, { frame: 10, value: '#ffffff' }] },
    { table: 'entity', id: a, path: distance, label: 'Look · Drop shadow · Distance', keys: [{ frame: 0, value: 0 }, { frame: 10, value: 40 }] },
    { table: 'entity', id: b, path: ['style', 'label', 'sizeScale'], label: 'Label · Size', make: true, keys: [{ frame: 0, value: 2 }] },
    { table: 'entity', id: b, path: ['style', 'look', 'elevation'], label: 'Look · Elevation', keys: [{ frame: 0, value: 9 }] },
  ]);
  const at5 = shotWorld(world, {}, tracks, 5);
  assert.equal(at5.get('entity', a)!.color, '#808080');
  assert.equal((cmd.entityStyle(at5.get('entity', a)).look!.effects[1] as { distance: number }).distance, 20, 'the shadow found by its kind, not its place');
  assert.equal(cmd.entityStyle(at5.get('entity', b)).label?.sizeScale, 2, 'a label setting of its own made for the shot');
  assert.equal(cmd.entityStyle(at5.get('entity', b)).look, undefined, 'a look it has not: none made');
  assert.equal(shotWorld(world, {}, tracks, 10).get('entity', a)!.color, '#ffffff');
  assert.equal(shotWorld(world, {}, tracks, 5), at5, 'the same view at the same frame');
  assert.notEqual(shotWorld(world, {}, tracks, 6), at5);
  assert.notEqual(at5.revision, world.revision, 'pictures kept for the world are not taken for it');
  assert.equal(Math.floor(at5.revision), world.revision);
  assert.equal(world.get('entity', a)!.color, '#3366cc', 'the world unchanged');
  assert.equal(shotLooksAt(world, { keys: tracks }, 5).get('entity', a)!.color, '#808080');
  assert.equal(shotLooksAt(world, {}, 5), world);
  // Laid on the world for a change (and taken away again), as the shot shows it at the frame.
  const lay = restyleDiffs(world, {}, tracks, 5);
  world.applyDiffs(lay.apply);
  assert.equal(world.get('entity', a)!.color, '#808080');
  world.applyDiffs(lay.undo);
  assert.equal(world.get('entity', a)!.color, '#3366cc');
});

test('a change for one shot at a frame: the keyed setting edited gets a key there; others keep theirs; the rest is the shot\'s own', () => {
  const { world, a } = project();
  cmd.setCountryLook(world, a, { elevation: 0, opacity: 1, effects: [] });
  // (Its colour its own already: in a group, a colour chosen for it is marked so, D237, a change of its style too.)
  cmd.setEntityColor(world, a, '#3366cc');
  const colour = { table: 'entity' as const, id: a, path: ['color'], label: 'Colour' };
  const elevation = { table: 'entity' as const, id: a, path: ['style', 'look', 'elevation'], label: 'Look · Elevation' };
  let tracks = withKey(withKey([], colour, 0, '#000000'), colour, 10, '#ffffff');
  tracks = withKey(withKey(tracks, elevation, 0, 0), elevation, 10, 5);
  const forShot = (frame: number, editing: string | null, change: (w: World) => cmd.CommandResult) => {
    const lay = restyleDiffs(world, {}, tracks, frame);
    world.applyDiffs(lay.apply);
    const r = change(world);
    world.applyDiffs(invertDiffs(r.diffs));
    world.applyDiffs(lay.undo);
    return looksAfter({}, tracks, r.diffs, frame, editing);
  };
  // The colour changed in its field at frame 5: a key there; nothing else the shot's own.
  const one = forShot(5, trackIdOf(colour), (w) => cmd.setEntityColor(w, a, '#ff0000'));
  assert.deepEqual(one.tracks[0].keys.map((k) => [k.frame, k.value]), [[0, '#000000'], [5, '#ff0000'], [10, '#ffffff']]);
  assert.deepEqual(one.restyle, {}, 'only the key');
  // The look tidied by a change of another setting (its elevation, 2.5 here, rounded): no key for it, the change the shot's own.
  const two = forShot(5, null, (w) => cmd.setCountryLook(w, a, { ...countryLookOf(cmd.entityStyle(w.get('entity', a)).look)!, opacity: 0.5 }));
  assert.deepEqual(two.tracks, tracks, 'the keys as they were');
  assert.equal(cmd.entityStyle({ style: two.restyle.entity![a].style! }).look!.opacity, 0.5);
  assert.equal(world.get('entity', a)!.color, '#3366cc', 'the world as it was');
});

test('keys added, replaced, moved, eased and removed; a setting with none no longer keyed', () => {
  const at = { table: 'entity' as const, id: 'x', path: ['color'], label: 'Colour' };
  const id = trackIdOf(at);
  let t = withKey([], at, 10, '#000000');
  t = withKey(t, at, 0, '#ffffff');
  t = easedKey(t, id, 0, 'smooth');
  t = withKey(t, at, 5, '#ff0000');
  assert.deepEqual(t[0].keys.map((k) => [k.frame, k.ease]), [[0, 'smooth'], [5, 'smooth'], [10, 'linear']], 'a new key goes on at the pace of the one before it');
  t = withKey(t, at, 5, '#00ff00');
  assert.deepEqual(t[0].keys.map((k) => k.value), ['#ffffff', '#00ff00', '#000000'], 'replaced');
  t = movedKey(t, id, 5, 10);
  assert.deepEqual(t[0].keys.map((k) => [k.frame, k.value]), [[0, '#ffffff'], [10, '#00ff00']], 'moved onto another: that one replaced');
  t = withoutKey(t, id, 0);
  assert.equal(t[0].keys.length, 1);
  assert.deepEqual(withoutKey(t, id, 10), [], 'none left: not keyed');
  assert.deepEqual(withoutTrack(t, id), []);
  assert.deepEqual(withoutRowKeys(t, 'entity', ['x']), []);
  assert.equal(withoutRowKeys(t, 'entity', ['y']).length, 1);
});
