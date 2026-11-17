// Event groups (DECISIONS D8) and the first project-file upgrade (schema version 1 -> 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectRegistry } from '../src/server/projects.ts';
import { ProjectDb } from '../src/server/db.ts';
import { World } from '../src/world-model/world.ts';
import { invertDiffs, SCHEMA_VERSION } from '../src/world-model/schema.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian } from '../src/core-time/index.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const temp = () => mkdtempSync(join(tmpdir(), 'mapmaker-groups-'));

function project() {
  const world = new World();
  cmd.seedProject(world, 'Groups');
  const ev = (name: string, y: number) => cmd.createEvent(world, { name, start: Y(y) }).result as string;
  return { world, ev };
}

test('event groups: create, assign to several groups, filter, rename, delete; every step undoes', () => {
  const { world, ev } = project();
  const war = ev('War of the Straits', 1200), treaty = ev('Treaty of Sel', 1210), famine = ev('Great famine', 1230);
  const steps: cmd.CommandResult[] = [];
  const run = <T,>(r: cmd.CommandResult<T>) => { steps.push(r); return r.result; };
  const varn = run(cmd.createEventGroup(world, 'Varn'));
  const sel = run(cmd.createEventGroup(world, 'Sel'));
  assert.throws(() => cmd.createEventGroup(world, ' varn '), /already a group called "varn"/);
  assert.throws(() => cmd.createEventGroup(world, '  '), /name/);
  assert.notEqual(world.get('event_group', varn)!.color, world.get('event_group', sel)!.color, 'groups get distinct colours');

  run(cmd.setEventGroups(world, war, [varn, sel])); // an event can belong to more than one group
  run(cmd.setEventGroups(world, treaty, [sel]));
  assert.deepEqual(cmd.groupsOfEvent(world, war), [varn, sel]);
  const shown = (f: string[] | null) => [war, treaty, famine].filter((e) => cmd.eventShown(world, e, f ? new Set(f) : null));
  assert.deepEqual(shown(null), [war, treaty, famine]);
  assert.deepEqual(shown([varn]), [war]);
  assert.deepEqual(shown([sel]), [war, treaty]);
  assert.deepEqual(shown([cmd.UNGROUPED]), [famine]);
  assert.deepEqual(shown([varn, cmd.UNGROUPED]), [war, famine]);
  assert.deepEqual(shown([]), []);

  run(cmd.setEventGroups(world, war, [sel])); // taken out of Varn
  assert.deepEqual(cmd.groupsOfEvent(world, war), [sel]);
  run(cmd.updateEventGroup(world, sel, { name: 'Empire of Sel', color: '#123456' }));
  assert.equal(world.get('event_group', sel)!.name, 'Empire of Sel');
  assert.throws(() => cmd.updateEventGroup(world, varn, { name: 'empire of sel' }), /already/);

  run(cmd.deleteEventGroup(world, sel)); // the events stay
  assert.ok(world.get('event', war) && world.get('event', treaty));
  assert.deepEqual(world.all('event_group_member'), []);

  // Undo everything, step by step: back to no groups at all.
  for (const r of steps.reverse()) world.applyDiffs(invertDiffs(r.diffs));
  assert.deepEqual(world.all('event_group'), []);
  assert.deepEqual(world.all('event_group_member'), []);
});

test('event groups: deleting an event removes its memberships; an alternative version keeps its groups', () => {
  const { world, ev } = project();
  const war = ev('War', 1200);
  const g = cmd.createEventGroup(world, 'Varn').result;
  const h = cmd.createEventGroup(world, 'Battles').result;
  cmd.setEventGroups(world, war, [g, h]);
  const alt = cmd.createVariant(world, war, 'War (if Varn wins)').result;
  assert.deepEqual(cmd.groupsOfEvent(world, alt), [g, h]);
  const del = cmd.deleteEvent(world, war);
  assert.deepEqual(cmd.groupsOfEvent(world, war), []);
  assert.deepEqual(world.all('event_group_member').map((m) => m.event_id).sort(), [alt, alt]);
  world.applyDiffs(invertDiffs(del.diffs));
  assert.deepEqual(cmd.groupsOfEvent(world, war), [g, h], 'undoing the deletion brings the memberships back');
  assert.throws(() => cmd.setEventGroups(world, war, ['grp_missing']), /no longer exists/);
  assert.throws(() => cmd.setEventGroups(world, 'evt_base', [g]), /Choose an event/);
});

/** Turn a project file into exactly what version 1 of Map Maker wrote. */
function makeVersion1(file: string): void {
  const db = new DatabaseSync(file);
  db.exec("DROP TABLE event_group; DROP TABLE event_group_member; DROP TABLE entity_group; ALTER TABLE entity DROP COLUMN style; ALTER TABLE entity DROP COLUMN group_id; UPDATE meta SET value = '1' WHERE key = 'schema_version';");
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

test('a version 1 project file is upgraded when opened: backup first, content intact, groups usable, backups still restorable', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const info = reg.create('Old Film');
    const db = reg.get(info.id);
    const world = World.fromSnapshot(db.snapshot());
    const save = <T,>(r: cmd.CommandResult<T>) => { db.commit(r.label, r.diffs, db.journalState().head); return r.result; };
    const war = save(cmd.createEvent(world, { name: 'War', start: Y(1200) })) as string;
    save(cmd.createEntity(world, { type_id: 'polity', name: 'Varn' }));
    const head = db.journalState().head;
    reg.closeAll();
    const file = ProjectDb.databasePath(join(root, `${info.id}.mapmaker`));
    makeVersion1(file);

    const reg2 = new ProjectRegistry(root);
    const db2 = reg2.get(info.id);
    const meta = () => Object.fromEntries(db2.snapshot().meta!.map((m) => [m.key, m.value]));
    assert.equal(meta().schema_version, String(SCHEMA_VERSION));
    // A backup taken before upgrading still holds the file exactly as version 1 wrote it.
    const versionOf = (f: string) => { const d = new DatabaseSync(f, { readOnly: true }); try { return (d.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value; } finally { d.close(); } };
    const preUpgrade = db2.backups().filter((b) => versionOf(b.file) === '1');
    assert.equal(preUpgrade.length, 1, 'an automatic backup was taken before upgrading');
    const w2 = World.fromSnapshot(db2.snapshot());
    assert.equal(w2.get('event', war)?.name, 'War');
    assert.ok(w2.all('entity').some((e) => e.name === 'Varn'));
    assert.equal(db2.journalState().head, head, 'the undo history is untouched');

    // Groups work in the upgraded file and survive reopening.
    const g = cmd.createEventGroup(w2, 'Varn');
    db2.commit(g.label, g.diffs, db2.journalState().head);
    const m = cmd.setEventGroups(w2, war, [g.result]);
    db2.commit(m.label, m.diffs, db2.journalState().head);
    // Restoring the pre-upgrade backup brings back its content (no groups) but not the old file format.
    db2.restoreBackup(preUpgrade[0].file.split(/[\\/]/).pop()!);
    assert.equal(meta().schema_version, String(SCHEMA_VERSION));
    assert.deepEqual(db2.snapshot().event_group, []);
    db2.undo();
    assert.equal(db2.snapshot().event_group!.length, 1, 'the restore itself can be undone');
    reg2.closeAll();

    const reg3 = new ProjectRegistry(root);
    const w3 = World.fromSnapshot(reg3.get(info.id).snapshot());
    assert.deepEqual(cmd.groupsOfEvent(w3, war), [g.result]);
    assert.equal(reg3.get(info.id).backups().filter((b) => versionOf(b.file) === '1').length, 1, 'opening an up-to-date file needs no further upgrade');
    reg3.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a project saved by a newer version of Map Maker is refused, not damaged', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const info = reg.create('Future Film');
    reg.closeAll();
    const file = ProjectDb.databasePath(join(root, `${info.id}.mapmaker`));
    const raw = new DatabaseSync(file);
    raw.exec(`UPDATE meta SET value = '${SCHEMA_VERSION + 1}' WHERE key = 'schema_version'; PRAGMA wal_checkpoint(TRUNCATE);`);
    raw.close();
    // Pretend the newer version dropped a table this version knows: opening must not recreate it.
    const tables = () => { const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => (r as { name: string }).name).join(); } finally { d.close(); } };
    const w = new DatabaseSync(file); w.exec('DROP TABLE sequence; PRAGMA wal_checkpoint(TRUNCATE);'); w.close();
    const before = tables();
    assert.throws(() => ProjectDb.open(join(root, `${info.id}.mapmaker`)), (e: Error & { code?: string }) => /newer version of Map Maker/.test(e.message) && e.code === 'newer-version');
    assert.equal(tables(), before, 'nothing is written to a newer file');
    const check = new DatabaseSync(file, { readOnly: true });
    assert.equal((check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value, String(SCHEMA_VERSION + 1));
    check.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a version 2 file gains entity styles when opened; its old undo history still undoes and redoes', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const info = reg.create('Version 2 Film');
    const db = reg.get(info.id);
    const world = World.fromSnapshot(db.snapshot());
    // Undo history as version 2 wrote it: entity rows without a style column.
    const r = cmd.createEntity(world, { type_id: 'polity', name: 'Varn' });
    const old = r.diffs.map((d) => ({ ...d, after: d.after ? Object.fromEntries(Object.entries(d.after).filter(([k]) => k !== 'style')) : null })) as typeof r.diffs;
    db.commit(r.label, old, db.journalState().head);
    reg.closeAll();
    const file = ProjectDb.databasePath(join(root, `${info.id}.mapmaker`));
    const raw = new DatabaseSync(file);
    raw.exec("ALTER TABLE entity DROP COLUMN style; ALTER TABLE entity DROP COLUMN group_id; DROP TABLE entity_group; UPDATE meta SET value = '2' WHERE key = 'schema_version'; PRAGMA wal_checkpoint(TRUNCATE);");
    raw.close();

    const reg2 = new ProjectRegistry(root);
    const db2 = reg2.get(info.id);
    const varn = db2.snapshot().entity!.find((e) => e.name === 'Varn')!;
    assert.equal(varn.style, '{}', 'existing countries get an empty style');
    db2.undo();
    assert.ok(!db2.snapshot().entity!.some((e) => e.name === 'Varn'), 'the old step undoes');
    db2.redo();
    assert.equal(db2.snapshot().entity!.find((e) => e.name === 'Varn')!.style, '{}', 'and redoes, with the default style');
    const w2 = World.fromSnapshot(db2.snapshot());
    const st = cmd.setEntityStyle(w2, varn.id, { label: { color: '#ff0000' } });
    db2.commit(st.label, st.diffs, db2.journalState().head);
    reg2.closeAll();
    const reg3 = new ProjectRegistry(root);
    assert.equal(JSON.parse(reg3.get(info.id).snapshot().entity!.find((e) => e.name === 'Varn')!.style).label.color, '#ff0000');
    reg3.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
