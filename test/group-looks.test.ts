// The looks of a group of countries (D237): laid over its members' as an adjustment layer over the clips under it. Its
// effects drawn after each member's own; a member's own colour (chosen for it alone), fill, label settings, elevation and
// fill strength winning part by part; the commands that keep them (one undo step each); older files gaining them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectRegistry } from '../src/server/projects.ts';
import { ProjectDb } from '../src/server/db.ts';
import { SCHEMA_VERSION } from '../src/world-model/schema.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { groupStyle, withGroupLooks, lookedEntity, groupLookOf, labelWithGroup, groupLooksPlain, groupMembers } from '../src/domain/group-looks.ts';
import { lookFor, layerLookOf, countryLookOf, EFFECT_DEFAULTS } from '../src/render-engine/country-look.ts';

function project() {
  const world = new World();
  cmd.seedProject(world, 'Groups');
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Arcadia', color: '#3366cc' }).result;
  const b = cmd.createEntity(world, { type_id: 'polity', name: 'Boreal', color: '#cc6633' }).result;
  const c = cmd.createEntity(world, { type_id: 'polity', name: 'Cyrene', color: '#33cc66' }).result;
  const g = cmd.createEntityGroup(world, 'Allies', [a, b]).result;
  return { world, a, b, c, g };
}

test('a group\'s look works with a member\'s as an adjustment layer: effects of both, the member\'s own fundamentals first', () => {
  const layer = layerLookOf({ elevation: 2, opacity: 0.9, effects: [{ kind: 'bevel' }], blend: 'multiply' })!;
  const group = countryLookOf({ elevation: 4, opacity: 0.6, effects: [{ kind: 'stroke' }, { kind: 'outer-glow' }] })!;
  // A member with no look of its own: its layer's effects, then the group's; the group's elevation and fill over the layer's.
  const bare = lookFor(null, layer, group)!;
  assert.deepEqual(bare.effects.map((e) => e.kind), ['bevel', 'stroke', 'outer-glow']);
  assert.deepEqual([bare.elevation, bare.opacity], [4, 0.6]);
  // A member with a look of its own (replacing its layer's, as before): its effects first, the group's after.
  const own = countryLookOf({ elevation: 0, opacity: 1, effects: [{ kind: 'shadow' }] })!;
  const both = lookFor(own, layer, group)!;
  assert.deepEqual(both.effects.map((e) => e.kind), ['shadow', 'stroke', 'outer-glow'], 'both at the same time');
  assert.deepEqual([both.elevation, both.opacity], [4, 0.6], 'its own elevation and fill as they come: the group\'s');
  // Its own elevation or fill set: they win, part by part.
  const raised = lookFor(countryLookOf({ elevation: 7, opacity: 1, effects: [] }), layer, group)!;
  assert.deepEqual([raised.elevation, raised.opacity], [7, 0.6]);
  const faint = lookFor(countryLookOf({ elevation: 0, opacity: 0.3, effects: [] }), null, group)!;
  assert.deepEqual([faint.elevation, faint.opacity], [4, 0.3]);
  // A group with no look: exactly as before.
  assert.equal(lookFor(own, layer, null), own);
  assert.deepEqual(lookFor(null, null, countryLookOf({ effects: [{ kind: 'stroke' }] })), { elevation: 0, opacity: 1, effects: [{ ...EFFECT_DEFAULTS.stroke }] });
});

test('colour, fill and label: the group\'s under the member\'s own, part by part', () => {
  const { world, a, b, c, g } = project();
  const row = (id: string) => world.get('entity', id)!;
  // Nothing set on the group: the very same rows.
  assert.equal(lookedEntity(world, row(a)), row(a));
  assert.ok(groupLooksPlain(groupStyle(world.get('entity_group', g))));
  // The members drawn in the group's colour; one outside the group untouched.
  cmd.setEntityGroupColor(world, g, '#AA0000');
  cmd.setGroupStyle(world, g, { colorMembers: true });
  assert.equal(lookedEntity(world, row(a)).color, '#aa0000');
  assert.equal(lookedEntity(world, row(b)).color, '#aa0000');
  assert.equal(lookedEntity(world, row(c)), row(c));
  // A colour chosen for one member alone wins; given back, the group's again (its own colour kept).
  cmd.setEntityColor(world, b, '#0000ff');
  assert.equal(lookedEntity(world, row(b)).color, '#0000ff');
  assert.equal(lookedEntity(world, row(a)).color, '#aa0000', 'clicking one thing changes only that thing');
  cmd.setEntityColor(world, b, null, false);
  assert.equal(lookedEntity(world, row(b)).color, '#aa0000');
  assert.equal(row(b).color, '#0000ff', 'its own colour kept for when it leaves the group');
  // A fill for the group: members without one of their own take it.
  const flag = { kind: 'image' as const, asset: 'data/flags/fr.svg', fit: 'fill' as const };
  cmd.setGroupStyle(world, g, { fill: flag });
  cmd.setEntityStyle(world, a, { fill: { kind: 'image', asset: 'data/flags/de.svg' } });
  assert.equal(cmd.entityStyle(lookedEntity(world, row(a))).fill?.asset, 'data/flags/de.svg', 'its own fill wins');
  assert.equal(cmd.entityStyle(lookedEntity(world, row(b))).fill?.asset, 'data/flags/fr.svg');
  // Label settings: each of the member's own wins; the group's text never applies.
  cmd.setGroupStyle(world, g, { label: { italic: true, uppercase: true, color: '#ffeeaa', text: 'ignored' } });
  cmd.setEntityStyle(world, a, { label: { uppercase: false, text: 'Arcady' } });
  assert.deepEqual(cmd.entityStyle(lookedEntity(world, row(a))).label, { italic: true, uppercase: false, color: '#ffeeaa', text: 'Arcady' });
  assert.deepEqual(cmd.entityStyle(lookedEntity(world, row(b))).label, { italic: true, uppercase: true, color: '#ffeeaa' });
  assert.deepEqual(labelWithGroup({ hidden: true }, { hidden: false }), { hidden: false }, 'a member shown where its group hides labels');
  assert.equal(labelWithGroup(undefined, { italic: true })?.italic, true);
  // The same row object while nothing changes (drawn every frame).
  assert.equal(lookedEntity(world, row(b)), lookedEntity(world, row(b)));
  assert.equal(withGroupLooks(row(b), undefined), row(b));
  assert.deepEqual(groupMembers(world, g).map((e) => e.name), ['Arcadia', 'Boreal']);
});

test('a group\'s looks are kept checked and undone in one step each; a group\'s look reaches its members only', () => {
  const { world, a, c, g } = project();
  const before = world.get('entity_group', g)!.style;
  assert.equal(before, '{}', 'a new group sets nothing');
  const r = cmd.setGroupStyle(world, g, { look: { elevation: 3, opacity: 1, effects: [{ ...EFFECT_DEFAULTS.stroke, width: 3 }] } });
  assert.equal(groupLookOf(world, world.get('entity', a))?.effects[0].kind, 'stroke');
  assert.equal(groupLookOf(world, world.get('entity', c)), null, 'not in the group');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(world.get('entity_group', g)!.style, before, 'undone');
  // Checked when read: unknown parts dropped, a fill without a picture refused.
  assert.deepEqual(groupStyle({ style: '{"colorMembers":true,"sparkle":1,"label":{"text":"x","italic":true},"fill":{"kind":"image"}}' }), { colorMembers: true, label: { italic: true } });
  assert.deepEqual(groupStyle({ style: 'not json' }), {});
  assert.throws(() => cmd.setGroupStyle(world, g, { fill: { kind: 'image' } }), /picture or video/);
  assert.throws(() => cmd.setGroupStyle(world, 'nobody', { colorMembers: true }), /no longer exists/);
  assert.throws(() => cmd.setEntityGroupColor(world, g, 'red'), /colour/);
  // Parts taken away again.
  cmd.setGroupStyle(world, g, { colorMembers: true, label: { italic: true } });
  cmd.setGroupStyle(world, g, { colorMembers: false, label: null });
  assert.deepEqual(groupStyle(world.get('entity_group', g)), {});
  // A member's colour chosen in its Looks is its own, in one undo step.
  const col = cmd.setEntityColor(world, a, '#123456');
  assert.equal(cmd.entityStyle(world.get('entity', a)).ownColor, true);
  world.applyDiffs(invertDiffs(col.diffs));
  assert.equal(world.get('entity', a)!.color, '#3366cc');
  assert.equal(cmd.entityStyle(world.get('entity', a)).ownColor, undefined);
});

test('a version 7 file\'s groups gain looks of their own when opened (none set); its old undo history still undoes', () => {
  const root = mkdtempSync(join(tmpdir(), 'mapmaker-group-looks-'));
  try {
    const reg = new ProjectRegistry(root);
    const info = reg.create('Version 7 Film', null);
    const db = reg.get(info.id);
    const world = World.fromSnapshot(db.snapshot());
    const save = <T,>(r: cmd.CommandResult<T>) => { db.commit(r.label, r.diffs.map((d) => d.table !== 'entity_group' ? d : { ...d, after: d.after ? Object.fromEntries(Object.entries(d.after).filter(([k]) => k !== 'style')) : null }) as typeof r.diffs, db.journalState().head); return r.result; };
    const a = save(cmd.createEntity(world, { type_id: 'polity', name: 'Varn' })) as string;
    save(cmd.createEntityGroup(world, 'Old group', [a]));
    reg.closeAll();
    const file = ProjectDb.databasePath(join(root, `${info.id}.mapmaker`));
    const raw = new DatabaseSync(file);
    raw.exec("ALTER TABLE entity_group DROP COLUMN style; UPDATE meta SET value = '7' WHERE key = 'schema_version'; PRAGMA wal_checkpoint(TRUNCATE);");
    raw.close();
    const reg2 = new ProjectRegistry(root);
    const db2 = reg2.get(info.id);
    assert.equal(db2.snapshot().meta!.find((m) => m.key === 'schema_version')!.value, String(SCHEMA_VERSION));
    const g = db2.snapshot().entity_group!.find((x) => x.name === 'Old group')!;
    assert.equal(g.style, '{}', 'an old group sets nothing of its members\' looks');
    const w2 = World.fromSnapshot(db2.snapshot());
    assert.equal(lookedEntity(w2, w2.get('entity', a)!), w2.get('entity', a), 'its members drawn as before');
    db2.undo();
    assert.ok(!db2.snapshot().entity_group!.some((x) => x.name === 'Old group'), 'the old step undoes');
    db2.redo();
    assert.equal(db2.snapshot().entity_group!.find((x) => x.name === 'Old group')!.style, '{}', 'and redoes, with no looks');
    const r = cmd.setGroupStyle(w2, g.id, { colorMembers: true });
    db2.commit(r.label, r.diffs, db2.journalState().head);
    reg2.closeAll();
    const reg3 = new ProjectRegistry(root);
    assert.deepEqual(groupStyle(reg3.get(info.id).snapshot().entity_group!.find((x) => x.name === 'Old group')), { colorMembers: true }, 'kept on reopening');
    reg3.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
