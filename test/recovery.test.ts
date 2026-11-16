// Damaged files, recovery from backups, malformed data, and long undo/redo chains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, openSync, writeSync, closeSync, truncateSync, statSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectRegistry } from '../src/server/projects.ts';
import { ProjectDb, IntegrityError } from '../src/server/db.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { rng, ring, square } from './helpers.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const sorted = (snap: unknown) => { const o = snap as Record<string, unknown[]>; return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k].map((r) => JSON.stringify(r)).sort()])); };

function withProject(fn: (root: string, reg: ProjectRegistry, id: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'mapmaker-recovery-'));
  try {
    const reg = new ProjectRegistry(root);
    const { id } = reg.create('Recovery');
    fn(root, reg, id);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function addData(db: ProjectDb, n: number, prefix: string) {
  const w = World.fromSnapshot(db.snapshot());
  for (let i = 0; i < n; i++) {
    const r = cmd.createEntity(w, { type_id: 'polity', name: `${prefix} ${i}`, notes: 'x'.repeat(300) });
    db.commit(r.label, r.diffs, db.journalState().head);
  }
}

const damages: Array<[string, (file: string) => void]> = [
  ['a damaged page', (f) => { const fd = openSync(f, 'r+'); writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, 8192); closeSync(fd); }],
  ['a destroyed header', (f) => { const fd = openSync(f, 'r+'); writeSync(fd, Buffer.alloc(100, 0x11), 0, 100, 0); closeSync(fd); }],
  ['a truncated file', (f) => truncateSync(f, Math.floor(statSync(f).size / 3))],
];

for (const [what, damage] of damages) {
  test(`a project file with ${what} is refused, then recovered from its newest healthy backup`, () => {
    withProject((root, reg, id) => {
      const db = reg.get(id);
      addData(db, 200, 'Before backup');
      const backup = db.backupNow();
      const atBackup = sorted(db.snapshot());
      addData(db, 5, 'After backup');
      reg.closeAll();
      const file = join(root, `${id}.mapmaker`, 'project.db');
      damage(file);

      const reg2 = new ProjectRegistry(root);
      assert.throws(() => reg2.get(id), (e: Error) => e instanceof IntegrityError && (e as IntegrityError).code === 'damaged' && /damaged/.test(e.message));
      const r = reg2.recover(id);
      assert.equal(r.restoredFrom, statSync(backup.file).mtime.toISOString());
      assert.ok(existsSync(join(r.damagedFolder, 'project.db')), 'the damaged file is kept, not deleted');
      const db2 = reg2.get(id);
      assert.equal(sorted(db2.snapshot()), atBackup, 'exactly the backup\'s contents');
      // The recovered project works normally.
      addData(db2, 3, 'After recovery');
      reg2.closeAll();
      const reg3 = new ProjectRegistry(root);
      assert.equal((reg3.get(id).snapshot() as { entity: unknown[] }).entity.length, JSON.parse(atBackup).find((t: [string]) => t[0] === 'entity')[1].length + 3);
      reg3.closeAll();
    });
  });
}

test('recovery skips a damaged backup and uses the newest healthy one; with none it says so', () => {
  withProject((root, reg, id) => {
    const db = reg.get(id);
    addData(db, 50, 'A');
    const older = db.backupNow();
    const atOlder = sorted(db.snapshot());
    addData(db, 50, 'B');
    const newer = db.backupNow();
    reg.closeAll();
    // Give the two backups clearly different times, then damage the newer one and the project.
    const bdir0 = join(root, `${id}.mapmaker`, 'backups');
    for (const f of readdirSync(bdir0)) if (join(bdir0, f) !== older.file && join(bdir0, f) !== newer.file) utimesSync(join(bdir0, f), new Date(Date.now() - 14400e3), new Date(Date.now() - 14400e3));
    utimesSync(older.file, new Date(Date.now() - 7200e3), new Date(Date.now() - 7200e3));
    truncateSync(newer.file, 2000);
    truncateSync(join(root, `${id}.mapmaker`, 'project.db'), 3000);
    const reg2 = new ProjectRegistry(root);
    reg2.recover(id);
    assert.equal(sorted(reg2.get(id).snapshot()), atOlder);
    reg2.closeAll();

    // No healthy backup at all.
    const bdir = join(root, `${id}.mapmaker`, 'backups');
    for (const f of readdirSync(bdir)) truncateSync(join(bdir, f), 100);
    truncateSync(join(root, `${id}.mapmaker`, 'project.db'), 3000);
    const reg3 = new ProjectRegistry(root);
    assert.throws(() => reg3.recover(id), /No usable backup/);
    reg3.closeAll();
  });
});

test('malformed or dangling data inside a healthy file is reported, never crashes reconstruction', () => {
  withProject((root, reg, id) => {
    const db = reg.get(id);
    const w = World.fromSnapshot(db.snapshot());
    const e = new Engine(w);
    const space = w.all('map_space')[0].id, layer = w.all('layer')[0].id;
    const A = cmd.createEntity(w, { type_id: 'polity', name: 'A' });
    db.commit(A.label, A.diffs, db.journalState().head);
    const p = cmd.paintTerritory(w, e, { spaceId: space, layerId: layer, ring: ring(square(0, 0, 5)), value: A.result, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
    db.commit(p.label, p.diffs, db.journalState().head);
    const ev = cmd.createEvent(w, { name: 'Odd', start: Y(1500) });
    db.commit(ev.label, ev.diffs, db.journalState().head);
    const p2 = cmd.paintTerritory(w, e, { spaceId: space, layerId: layer, ring: ring(square(2, 2, 1)), value: A.result, snap: 1e-7, mode: { kind: 'new', eventId: ev.result } });
    db.commit(p2.label, p2.diffs, db.journalState().head);
    reg.closeAll();
    // Tamper with the file the way a bad import or an outside tool might.
    const raw = new DatabaseSync(join(root, `${id}.mapmaker`, 'project.db'));
    raw.prepare(`UPDATE effect SET resolution = '{not json' WHERE event_id = ?`).run(ev.result);
    raw.prepare(`INSERT INTO effect VALUES ('eff_dangling', ?, 99, 'assign', ?, ?, NULL, NULL, '', '{}', '{"set":[[[99999],"ent_missing"]]}', '')`).run(ev.result, space, layer);
    raw.close();
    const reg2 = new ProjectRegistry(root);
    const w2 = World.fromSnapshot(reg2.get(id).snapshot());
    const e2 = new Engine(w2);
    assert.equal(e2.valueAtPoint(space, layer, lonLatToVec(0, 0), Y(1600)), A.result, 'the rest of history still reconstructs');
    const kinds = e2.conflicts.map((c) => c.kind);
    assert.ok(kinds.includes('broken'), 'the dangling change is reported in History Health');
    reg2.closeAll();
  });
});

test('a long chain of mixed edits undoes and redoes exactly, state by state, across reopening', () => {
  withProject((root, reg, id) => {
    let db = reg.get(id);
    const w = World.fromSnapshot(db.snapshot());
    const e = new Engine(w);
    const space = w.all('map_space')[0].id, layer = w.all('layer')[0].id;
    const r = rng(7);
    const states = [sorted(db.snapshot())];
    const owners: string[] = [];
    const events: string[] = [];
    for (let i = 0; i < 120; i++) {
      let res: cmd.CommandResult<unknown>;
      const roll = r.next();
      if (owners.length < 3 || roll < 0.2) { res = cmd.createEntity(w, { type_id: 'polity', name: `P${i}` }); owners.push(res.result as string); }
      else if (roll < 0.35) { res = cmd.createEvent(w, { name: `E${i}`, start: Y(r.int(1000, 2000)) }); events.push(res.result as string); }
      else if (roll < 0.45 && events.length) res = cmd.updateEvent(w, r.pick(events), { start: Y(r.int(1000, 2000)) });
      else if (roll < 0.5) res = cmd.updateEntity(w, r.pick(owners), { color: `#${r.int(0, 0xffffff).toString(16).padStart(6, '0')}` });
      else {
        const c = [r.float(-150, 150), r.float(-60, 60)] as const;
        const mode = events.length && r.bool() ? { kind: 'new' as const, eventId: r.pick(events) } : { kind: 'correct' as const, t: Y(r.int(900, 2100)) };
        res = cmd.paintTerritory(w, e, { spaceId: space, layerId: layer, ring: ring(square(c[0], c[1], r.float(1, 6))), value: r.bool(0.9) ? r.pick(owners) : null, snap: 1e-7, mode });
      }
      db.commit(res.label, res.diffs, db.journalState().head);
      states.push(sorted(db.snapshot()));
    }
    reg.closeAll();
    const reg2 = new ProjectRegistry(root);
    db = reg2.get(id);
    for (let i = states.length - 1; i > 1; i--) {
      assert.equal(sorted(db.snapshot()), states[i], `state after step ${i}`);
      db.undo();
    }
    assert.equal(sorted(db.snapshot()), states[1]);
    for (let i = 2; i < states.length; i++) {
      db.redo();
      assert.equal(sorted(db.snapshot()), states[i], `redo to step ${i}`);
    }
    // Reconstructed history after redoing everything matches the history before reopening.
    const w3 = World.fromSnapshot(db.snapshot());
    assert.deepEqual(w3.arrangement(space).validate(), []);
    reg2.closeAll();
  });
});

test('undo history written before compression was introduced still undoes correctly', () => {
  withProject((root, reg, id) => {
    const db = reg.get(id);
    const w = World.fromSnapshot(db.snapshot());
    const r = cmd.createEntity(w, { type_id: 'polity', name: 'Old style' });
    const before = sorted(db.snapshot());
    db.commit(r.label, r.diffs, db.journalState().head);
    reg.closeAll();
    // Rewrite that journal entry the old way: plain JSON.
    const raw = new DatabaseSync(join(root, `${id}.mapmaker`, 'project.db'));
    const row = raw.prepare("SELECT seq, diffs FROM journal WHERE state = 'done' ORDER BY seq DESC LIMIT 1").get() as { seq: number; diffs: string };
    assert.ok(row.diffs.startsWith('z1:'), 'new entries are compressed');
    raw.prepare('UPDATE journal SET diffs = ? WHERE seq = ?').run(JSON.stringify(r.diffs), row.seq);
    raw.close();
    const reg2 = new ProjectRegistry(root);
    const db2 = reg2.get(id);
    db2.undo();
    assert.equal(sorted(db2.snapshot()), before);
    db2.redo();
    assert.equal((db2.snapshot() as { entity: Array<{ name: string }> }).entity.some((e) => e.name === 'Old style'), true);
    reg2.closeAll();
  });
});
