import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { ProjectRegistry } from '../src/server/projects.ts';
import { ProjectDb, readSnapshot, ConflictError } from '../src/server/db.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { encodePNG } from '../src/export/png.ts';
import { ring, square } from './helpers.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const temp = () => mkdtempSync(join(tmpdir(), 'mapmaker-test-'));
const worldTables = (s: any) => { const o = { ...s }; return JSON.stringify(Object.keys(o).sort().map((k) => [k, [...o[k]].sort((a: any, b: any) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)))])); };

function session(db: ProjectDb) {
  const world = World.fromSnapshot(db.snapshot());
  const engine = new Engine(world);
  const save = (r: cmd.CommandResult<any>) => { db.commit(r.label, r.diffs, db.journalState().head); return r.result; };
  const space = world.all('map_space')[0].id;
  const layer = world.all('layer')[0].id;
  return { world, engine, save, space, layer };
}

test('a new project is created, saved and reopened with the same data', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const info = reg.create('My Film: World <1>');
    assert.equal(info.id, 'My Film World 1');
    const s = session(reg.get(info.id));
    const A = s.save(cmd.createEntity(s.world, { type_id: 'polity', name: 'Kingdom of Varn' }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(10, 45, 8)), value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } }));
    const ev = s.save(cmd.createEvent(s.world, { name: 'Conquest', start: Y(1200) }));
    const B = s.save(cmd.createEntity(s.world, { type_id: 'polity', name: 'Empire of Sel' }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(12, 47, 3)), value: B, snap: 1e-7, mode: { kind: 'new', eventId: ev } }));
    reg.closeAll();

    const reg2 = new ProjectRegistry(root);
    assert.deepEqual(reg2.list().map((p) => p.id), ['My Film World 1']);
    const s2 = session(reg2.get(info.id));
    assert.deepEqual(s2.world.arrangement(s2.space).validate(), []);
    const v = (lon: number, lat: number, y: number) => s2.engine.valueAtPoint(s2.space, s2.layer, lonLatToVec(lon, lat), Y(y));
    assert.equal(v(12, 47, 1100), A);
    assert.equal(v(12, 47, 1300), B);
    assert.equal(v(5, 40, 1300), A);
    assert.equal(s2.world.get('entity', B)?.name, 'Empire of Sel');
    reg2.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the snapshot written as text by the database is the snapshot (awkward names, a flat map\'s radius, empty tables)', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const info = reg.create('Text Snapshot');
    const db = reg.get(info.id);
    const s = session(db);
    // Text that JSON must escape, and letters beyond the first plane.
    const A = s.save(cmd.createEntity(s.world, { type_id: 'polity', name: 'Kingdom "of" Varn \\ back\\slash\n second line \t tab \u00e9\u4e2d\ud83d\ude00 \u2028' }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(10, 45, 8)), value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } }));
    const ev = s.save(cmd.createEvent(s.world, { name: 'Conquest </script> \u0001', start: Y(1200) }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(12, 47, 3)), value: A, snap: 1e-7, mode: { kind: 'new', eventId: ev } }));
    // A map with a radius that is not a whole number (the only column of real numbers).
    s.save(cmd.createWorld(s.world, 'A moon', 1737.400123456789));
    const text = db.snapshotJson();
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(db.snapshot())));
    // Row for row in the same order (the order rows are read in decides the order of lists in the app).
    const a = JSON.parse(text) as Record<string, Array<Record<string, unknown>>>, b = db.snapshot() as unknown as Record<string, Array<Record<string, unknown>>>;
    for (const t of Object.keys(b)) assert.deepEqual(a[t].map((r) => Object.values(r)[0]), b[t].map((r) => Object.values(r)[0]), `the order of ${t}`);
    assert.ok(a.vertex.length > 4 && a.entity.some((e) => String(e.name).includes('\ud83d\ude00')) && a.map_space.some((m) => typeof m.radius_m === 'number' && !Number.isInteger(m.radius_m)));
    reg.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('undo and redo walk the journal exactly, across reopening', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const { id } = reg.create('Undo test');
    let db = reg.get(id);
    const initial = worldTables(db.snapshot());
    const s = session(db);
    const A = s.save(cmd.createEntity(s.world, { type_id: 'polity', name: 'A' }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(0, 0, 10)), value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(5, 5, 10)), value: null, snap: 1e-7, mode: { kind: 'new', eventId: s.save(cmd.createEvent(s.world, { name: 'E', start: Y(1500) })) } }));
    const final = worldTables(db.snapshot());
    assert.equal(db.journalState().canUndo, true);
    reg.closeAll();
    const reg2 = new ProjectRegistry(root);
    db = reg2.get(id);
    let n = 0;
    while (db.undo()) n++;
    assert.equal(n, 4);
    assert.equal(worldTables(db.snapshot()), initial);
    assert.equal(db.journalState().canUndo, false); // the project's creation itself cannot be undone
    while (db.redo()) n--;
    assert.equal(n, 0);
    assert.equal(worldTables(db.snapshot()), final);
    reg2.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('saving is atomic and refuses changes based on a different state', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const { id } = reg.create('Atomic');
    const db = reg.get(id);
    const before = worldTables(db.snapshot());
    const head = db.journalState().head;
    assert.throws(() => db.commit('stale', [], head - 1), ConflictError);
    const fakeEntity = { id: 'ent_x', type_id: 'polity', branch_id: 'main', name: 'X', color: '#fff', notes: '', created_seq: 1, style: '{}', group_id: '' };
    const wrongBefore = { ...fakeEntity, id: 'ent_missing' };
    assert.throws(() => db.commit('bad', [
      { table: 'entity', before: null, after: fakeEntity },
      { table: 'entity', before: wrongBefore, after: null },
    ], head), ConflictError);
    assert.equal(worldTables(db.snapshot()), before, 'nothing from the failed commit was applied');
    reg.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('killing the app mid-save never corrupts the project', async () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const { id, dir } = reg.create('Crash');
    reg.closeAll();
    for (let round = 0; round < 4; round++) {
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, 'fixtures', 'crash-writer.ts'), dir, String(round + 1)], { stdio: ['ignore', 'pipe', 'inherit'] });
      let lines = 0;
      await new Promise<void>((resolve) => {
        child.stdout!.on('data', (d: Buffer) => {
          lines += d.toString().split('\n').filter(Boolean).length;
          if (lines >= 3 + round * 2) { child.kill('SIGKILL'); }
        });
        child.on('exit', () => resolve());
      });
      const db = ProjectDb.open(dir); // integrity check runs on open
      const world = World.fromSnapshot(db.snapshot());
      for (const arr of world.arrangements.values()) assert.deepEqual(arr.validate(), []);
      const engine = new Engine(world);
      engine.ensure();
      assert.equal(engine.conflicts.filter((c) => c.kind === 'broken').length, 0);
      db.close();
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('named versions and backups restore as a new, undoable step; backups hold full copies', () => {
  const root = temp();
  try {
    const reg = new ProjectRegistry(root);
    const { id } = reg.create('Versions');
    const db = reg.get(id);
    const s = session(db);
    const A = s.save(cmd.createEntity(s.world, { type_id: 'polity', name: 'A' }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(0, 0, 10)), value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } }));
    const v1 = db.createVersion('Before the war');
    const atV1 = worldTables(db.snapshot());
    s.save(cmd.createEntity(s.world, { type_id: 'polity', name: 'B' }));
    s.save(cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(square(3, 3, 4)), value: null, snap: 1e-7, mode: { kind: 'new', eventId: s.save(cmd.createEvent(s.world, { name: 'War', start: Y(1600) })) } }));
    const later = worldTables(db.snapshot());
    assert.notEqual(later, atV1);
    assert.equal(worldTables(db.versionSnapshot(v1.id)), atV1);
    db.restoreVersion(v1.id);
    assert.equal(worldTables(db.snapshot()), atV1);
    db.undo();
    assert.equal(worldTables(db.snapshot()), later, 'restoring a version can itself be undone');
    const b = db.backupNow();
    assert.ok(existsSync(b.file));
    assert.equal(worldTables(readSnapshot(b.file)), later);
    assert.ok(readdirSync(db.backupDir()).length >= 2);
    // Restoring a backup works like restoring a version: a new step that can be undone.
    s.save(cmd.createEntity(s.world, { type_id: 'polity', name: 'C' }));
    const afterBackup = worldTables(db.snapshot());
    db.restoreBackup(b.file.split(/[\\/]/).pop()!);
    assert.equal(worldTables(db.snapshot()), later);
    db.undo();
    assert.equal(worldTables(db.snapshot()), afterBackup);
    assert.throws(() => db.restoreBackup('../project.db'), /no longer exists/);
    reg.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('PNG encoder round-trips pixels exactly, including transparency', () => {
  const w = 37, h = 23;
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24;
  const png = encodePNG(w, h, px);
  // decode: find IDAT, inflate, undo the Sub filter
  let off = 8; const idat: Uint8Array[] = [];
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (off < png.length) {
    const len = dv.getUint32(off); const type = String.fromCharCode(...png.slice(off + 4, off + 8));
    if (type === 'IDAT') idat.push(png.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w * 4 + 1)], 1);
    for (let x = 0; x < w * 4; x++) {
      const v = raw[y * (w * 4 + 1) + 1 + x];
      out[y * w * 4 + x] = (v + (x >= 4 ? out[y * w * 4 + x - 4] : 0)) & 0xff;
    }
  }
  assert.deepEqual(out, px);
});

test('exports go to the chosen folder, or the project folder when none is chosen; relative paths are refused', async () => {
  const { startJob, exportRoot } = await import('../src/export/writer.ts');
  const root = temp();
  try {
    const projectDir = join(root, 'P.mapmaker');
    const base = { shotName: 'Shot 1', width: 4, height: 4, fps: 24, frameStart: 0, frameEnd: 0, passes: [{ name: 'all', label: 'All', blend: 'Normal' }], transparent: false, projectHead: 1, appVersion: 'test' };
    assert.equal(exportRoot(projectDir, null), join(projectDir, 'exports'));
    assert.equal(exportRoot(projectDir, '   '), join(projectDir, 'exports'));
    const chosen = join(root, 'My exports', 'Maps');
    const job = startJob(projectDir, { ...base, exportDir: chosen });
    assert.ok(job.dir.startsWith(chosen) && existsSync(join(job.dir, 'all')), 'the chosen folder is created and used');
    assert.throws(() => startJob(projectDir, { ...base, exportDir: 'relative/folder' }), /full folder path/);
    // A folder that cannot be made (a file stands where the folder should be) is reported plainly.
    writeFileSync(join(root, 'a-file'), 'x');
    assert.throws(() => startJob(projectDir, { ...base, exportDir: join(root, 'a-file', 'Maps') }), /cannot write to/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
