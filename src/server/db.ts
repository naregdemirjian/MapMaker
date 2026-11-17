// One project's database: the only authoritative store of the world. Uses SQLite (built into Node)
// in write-ahead-log mode with full synchronisation, so every completed action survives a crash.
// Every change arrives as row diffs, is verified against the stored rows, applied atomically and
// written to a persistent journal that powers undo, redo and version history.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { TABLES, TABLE_NAMES, SCHEMA_VERSION, type RowDiff, type TableName, type AnyRow, invertDiffs, withDefaults } from '../world-model/schema.ts';
import type { Snapshot } from '../world-model/world.ts';

export class ConflictError extends Error { status = 409; }
/** The project file is damaged. `code: 'damaged'` lets the interface offer recovery from a backup. */
export class IntegrityError extends Error { status = 500; code = 'damaged'; }

/** True when an SQLite file opens and passes a quick integrity check. Never modifies the file. */
export function isHealthyDatabase(file: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check === 'ok';
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/** Automatic backups in a project folder, newest first (readable without opening the project). */
export function listBackups(dir: string): BackupInfo[] {
  const bdir = join(dir, 'backups');
  if (!existsSync(bdir)) return [];
  return readdirSync(bdir).filter((f) => /^backup-.*\.db$/.test(f)).map((f) => {
    const file = join(bdir, f);
    const st = statSync(file);
    return { file, created_at: st.mtime.toISOString(), bytes: st.size };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface JournalState { head: number; canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
export interface VersionInfo { id: number; label: string; kind: string; created_at: string; journal_seq: number }
export interface BackupInfo { file: string; created_at: string; bytes: number }

/**
 * Journal entries (the undo history) are stored compressed: they are highly repetitive, and the
 * compressed form is typically a tenth of the size. Older uncompressed entries still read correctly.
 */
export function packDiffs(diffs: RowDiff[]): string {
  return 'z1:' + deflateRawSync(Buffer.from(JSON.stringify(diffs), 'utf8'), { level: 6 }).toString('base64');
}
export function unpackDiffs(text: string): RowDiff[] {
  if (text.startsWith('z1:')) return JSON.parse(inflateRawSync(Buffer.from(text.slice(3), 'base64')).toString('utf8')) as RowDiff[];
  return JSON.parse(text) as RowDiff[];
}

const sqlType = (t: string) => (t.startsWith('int') ? 'INTEGER' : t.startsWith('real') ? 'REAL' : 'TEXT');

function ddl(): string {
  const parts: string[] = [];
  for (const t of TABLE_NAMES) {
    const def = TABLES[t];
    const cols = Object.entries(def.columns).map(([c, ty]) => `${c} ${sqlType(ty)}${ty.endsWith('?') ? '' : ' NOT NULL'}${c === def.key ? ' PRIMARY KEY' : ''}`);
    parts.push(`CREATE TABLE IF NOT EXISTS ${t} (${cols.join(', ')}) STRICT;`);
  }
  parts.push('CREATE INDEX IF NOT EXISTS effect_event ON effect(event_id);');
  parts.push('CREATE INDEX IF NOT EXISTS vertex_space ON vertex(space_id);');
  parts.push('CREATE INDEX IF NOT EXISTS segment_space ON segment(space_id);');
  parts.push('CREATE INDEX IF NOT EXISTS face_space ON face(space_id);');
  parts.push(`CREATE TABLE IF NOT EXISTS journal (seq INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, created_at TEXT NOT NULL,
    diffs TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('fixed', 'done', 'undone'))) STRICT;`);
  parts.push(`CREATE TABLE IF NOT EXISTS version (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, kind TEXT NOT NULL,
    created_at TEXT NOT NULL, journal_seq INTEGER NOT NULL, file TEXT NOT NULL) STRICT;`);
  return parts.join('\n');
}

export class ProjectDb {
  readonly dir: string;
  readonly db: DatabaseSync;
  private stmts = new Map<string, StatementSync>();
  private lastBackup = 0;

  private constructor(dir: string, db: DatabaseSync) {
    this.dir = dir;
    this.db = db;
  }

  static databasePath(dir: string) { return join(dir, 'project.db'); }

  /** Open (or create) the project database in a project folder. */
  static open(dir: string): ProjectDb {
    mkdirSync(dir, { recursive: true });
    const damaged = (detail: string) => new IntegrityError(`This project's file is damaged and cannot be opened safely (${detail.split('\n')[0].slice(0, 160)}).`);
    let db: DatabaseSync | undefined;
    let ok: string;
    try {
      db = new DatabaseSync(ProjectDb.databasePath(dir));
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
      ok = (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
    } catch (e) {
      // Close the file before reporting: on Windows an open file cannot be moved aside for recovery.
      try { db?.close(); } catch { /* ignore */ }
      throw damaged((e as Error).message);
    }
    const p = new ProjectDb(dir, db);
    if (ok !== 'ok') { try { db.close(); } catch { /* ignore */ } throw damaged(ok); }
    try {
      p.refuseNewerFormat(); // before anything is written to the file
      db.exec(ddl());
      p.migrate();
    } catch (e) {
      try { db.close(); } catch { /* ignore */ }
      throw e;
    }
    // The hourly backup timer carries on from the newest backup already on disk.
    p.lastBackup = p.backups().reduce((m, b) => Math.max(m, Date.parse(b.created_at)), 0);
    return p;
  }

  /** When the newest backup was taken (milliseconds since 1970; 0 if there is none). */
  get lastBackupAt(): number { return this.lastBackup; }

  private fileFormat(): number | null {
    const hasMeta = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
    const row = hasMeta ? this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined : undefined;
    return row ? Number(row.value) : null;
  }

  private refuseNewerFormat(): void {
    const v = this.fileFormat();
    if (v !== null && v > SCHEMA_VERSION) {
      // Not damage: the file is fine, this copy of Map Maker is too old for it. No recovery is offered.
      throw Object.assign(new IntegrityError('This project was saved by a newer version of Map Maker. Please install the newer version to open it.'), { code: 'newer-version', status: 409 });
    }
  }

  private migrate(): void {
    const v = this.fileFormat() ?? SCHEMA_VERSION;
    if (v === SCHEMA_VERSION) return;
    // Each upgrade is preceded by an automatic backup, so the file as it was can always be restored.
    this.backupNow();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // 1 -> 2: the event group tables, already created (empty) by the table definitions above.
      // 2 -> 3 (and any later column): columns a table gained since it was created are added, with
      // their default for the rows already there.
      for (const t of TABLE_NAMES) {
        const have = new Set((this.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name));
        for (const [c, ty] of Object.entries(TABLES[t].columns)) {
          if (have.has(c)) continue;
          const def = TABLES[t].defaults?.[c];
          const lit = def === undefined ? '' : typeof def === 'number' ? ` NOT NULL DEFAULT ${def}` : ` NOT NULL DEFAULT '${String(def).replace(/'/g, "''")}'`;
          this.db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${sqlType(ty)}${lit}`);
        }
      }
      this.db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    this.db.close();
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) this.stmts.set(sql, (s = this.db.prepare(sql)));
    return s;
  }

  isEmpty(): boolean {
    return !(this.db.prepare('SELECT 1 FROM journal LIMIT 1').get());
  }

  snapshot(): Snapshot {
    const s: Record<string, AnyRow[]> = {};
    for (const t of TABLE_NAMES) s[t] = this.db.prepare(`SELECT * FROM ${t}`).all() as unknown as AnyRow[];
    return s as Snapshot;
  }

  /**
   * The snapshot as JSON text, written by the database itself: the same rows in the same order as
   * JSON.stringify(snapshot()) gives, without first making an object of every row here (a quarter
   * of a million of them for a large map). Opening such a project spent half a second on that.
   */
  snapshotJson(): string {
    const parts: string[] = [];
    for (const t of TABLE_NAMES) {
      const pairs = Object.keys(TABLES[t].columns).map((c) => `'${c}', ${c}`).join(', ');
      const row = this.db.prepare(`SELECT json_group_array(json_object(${pairs})) AS j FROM (SELECT * FROM ${t})`).get() as { j: string };
      parts.push(`${JSON.stringify(t)}:${row.j}`);
    }
    return `{${parts.join(',')}}`;
  }

  // ---------------------------------------------------------------- applying diffs

  private applyRow(d: RowDiff): void {
    const def = TABLES[d.table];
    const cols = Object.keys(def.columns);
    const key = def.key;
    const keyOf = (r: AnyRow) => (r as unknown as Record<string, unknown>)[key] as string | number;
    const vals = (r: AnyRow) => cols.map((c) => {
      const v = (withDefaults(d.table, r) as unknown as Record<string, unknown>)[c];
      return v === undefined ? null : (v as string | number | null);
    });
    if (d.before) {
      const cur = this.stmt(`SELECT * FROM ${d.table} WHERE ${key} = ?`).get(keyOf(d.before)) as Record<string, unknown> | undefined;
      if (!cur) throw new ConflictError(`${d.table} ${keyOf(d.before)} is missing from the project`);
      const before = withDefaults(d.table, d.before) as unknown as Record<string, unknown>;
      for (const c of cols) {
        const a = cur[c] ?? null, b = before[c] ?? null;
        if (a !== b) throw new ConflictError(`${d.table} ${keyOf(d.before)} changed unexpectedly (${c})`);
      }
    }
    if (d.before && !d.after) {
      this.stmt(`DELETE FROM ${d.table} WHERE ${key} = ?`).run(keyOf(d.before));
    } else if (!d.before && d.after) {
      this.stmt(`INSERT INTO ${d.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals(d.after));
    } else if (d.before && d.after) {
      if (keyOf(d.before) !== keyOf(d.after)) throw new ConflictError('A change tried to alter a row id');
      this.stmt(`UPDATE ${d.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${key} = ?`).run(...vals(d.after), keyOf(d.after));
    }
  }

  /** Apply diffs atomically: all of them, or none. */
  private applyAtomically(diffs: RowDiff[], journal: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const d of diffs) {
        if (!(d.table in TABLES)) throw new ConflictError(`Unknown table ${d.table}`);
        this.applyRow(d);
      }
      journal();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  journalState(): JournalState {
    const head = (this.db.prepare("SELECT MAX(seq) AS m FROM journal WHERE state IN ('done', 'fixed')").get() as { m: number | null }).m ?? 0;
    const undo = this.db.prepare("SELECT label FROM journal WHERE state = 'done' ORDER BY seq DESC LIMIT 1").get() as { label: string } | undefined;
    const redo = this.db.prepare("SELECT label FROM journal WHERE state = 'undone' ORDER BY seq ASC LIMIT 1").get() as { label: string } | undefined;
    return { head, canUndo: !!undo, canRedo: !!redo, undoLabel: undo?.label ?? null, redoLabel: redo?.label ?? null };
  }

  /** Save one command's changes. `baseHead` guards against saving on top of a different state. */
  commit(label: string, diffs: RowDiff[], baseHead: number | null, fixed = false): JournalState {
    if (baseHead !== null && baseHead !== this.journalState().head) throw new ConflictError('The project changed since this edit was started. Reloading.');
    this.applyAtomically(diffs, () => {
      this.db.prepare("DELETE FROM journal WHERE state = 'undone'").run();
      this.db.prepare('INSERT INTO journal (label, created_at, diffs, state) VALUES (?, ?, ?, ?)').run(label, new Date().toISOString(), packDiffs(diffs), fixed ? 'fixed' : 'done');
    });
    this.maybeBackup();
    return this.journalState();
  }

  undo(): { diffs: RowDiff[]; label: string; journal: JournalState } | null {
    const e = this.db.prepare("SELECT seq, label, diffs FROM journal WHERE state = 'done' ORDER BY seq DESC LIMIT 1").get() as { seq: number; label: string; diffs: string } | undefined;
    if (!e) return null;
    const inverse = invertDiffs(unpackDiffs(e.diffs));
    this.applyAtomically(inverse, () => this.db.prepare("UPDATE journal SET state = 'undone' WHERE seq = ?").run(e.seq));
    return { diffs: inverse, label: e.label, journal: this.journalState() };
  }

  redo(): { diffs: RowDiff[]; label: string; journal: JournalState } | null {
    const e = this.db.prepare("SELECT seq, label, diffs FROM journal WHERE state = 'undone' ORDER BY seq ASC LIMIT 1").get() as { seq: number; label: string; diffs: string } | undefined;
    if (!e) return null;
    const forward = unpackDiffs(e.diffs);
    this.applyAtomically(forward, () => this.db.prepare("UPDATE journal SET state = 'done' WHERE seq = ?").run(e.seq));
    return { diffs: forward, label: e.label, journal: this.journalState() };
  }

  history(limit = 200): Array<{ seq: number; label: string; created_at: string; state: string }> {
    return this.db.prepare('SELECT seq, label, created_at, state FROM journal ORDER BY seq DESC LIMIT ?').all(limit) as Array<{ seq: number; label: string; created_at: string; state: string }>;
  }

  // ---------------------------------------------------------------- versions and backups

  private copyTo(file: string): void {
    if (existsSync(file)) unlinkSync(file);
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  createVersion(label: string, kind: 'named' | 'auto' = 'named'): VersionInfo {
    const dir = join(this.dir, 'versions');
    mkdirSync(dir, { recursive: true });
    const head = this.journalState().head;
    const created_at = new Date().toISOString();
    const res = this.db.prepare('INSERT INTO version (label, kind, created_at, journal_seq, file) VALUES (?, ?, ?, ?, ?)').run(label, kind, created_at, head, '');
    const id = Number(res.lastInsertRowid);
    const file = `version-${String(id).padStart(5, '0')}.db`;
    this.db.prepare('UPDATE version SET file = ? WHERE id = ?').run(file, id);
    this.copyTo(join(dir, file));
    return { id, label, kind, created_at, journal_seq: head };
  }

  versions(): VersionInfo[] {
    return this.db.prepare('SELECT id, label, kind, created_at, journal_seq FROM version ORDER BY id DESC').all() as unknown as VersionInfo[];
  }

  /** Read a stored version's world without touching the live project. */
  versionSnapshot(id: number): Snapshot {
    const v = this.db.prepare('SELECT file FROM version WHERE id = ?').get(id) as { file: string } | undefined;
    if (!v) throw new ConflictError('Unknown version');
    return readSnapshot(join(this.dir, 'versions', v.file));
  }

  /** Restore a version as a new, undoable step (nothing is destroyed). Returns the diffs applied. */
  restoreVersion(id: number): { diffs: RowDiff[]; journal: JournalState } {
    const target = this.versionSnapshot(id);
    const diffs = diffSnapshots(this.snapshot(), target);
    const label = `Restore version "${(this.db.prepare('SELECT label FROM version WHERE id = ?').get(id) as { label: string }).label}"`;
    const journal = this.commit(label, diffs, null);
    return { diffs, journal };
  }

  /** Bring the project back to an automatic backup, as a new step that can itself be undone. */
  restoreBackup(name: string): { diffs: RowDiff[]; journal: JournalState } {
    const file = join(this.backupDir(), name);
    if (!/^backup-[\w.\-]+\.db$/.test(name) || !existsSync(file)) throw Object.assign(new Error('That backup no longer exists.'), { status: 404 });
    const diffs = diffSnapshots(this.snapshot(), readSnapshot(file));
    const journal = this.commit(`Restore backup of ${statSync(file).mtime.toISOString().slice(0, 16).replace('T', ' ')}`, diffs, null);
    return { diffs, journal };
  }

  backupDir(): string { return join(this.dir, 'backups'); }

  backupNow(): BackupInfo {
    const dir = this.backupDir();
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmp = join(dir, `.backup-${stamp}.tmp`);
    const file = join(dir, `backup-${stamp}.db`);
    this.copyTo(tmp);
    renameSync(tmp, file);
    this.lastBackup = Date.now();
    this.pruneBackups();
    return { file, created_at: new Date().toISOString(), bytes: statSync(file).size };
  }

  private maybeBackup(): void {
    if (Date.now() - this.lastBackup > 60 * 60 * 1000) {
      try { this.backupNow(); } catch { /* a failed backup must never block saving */ }
    }
  }

  /** Keep the 24 newest, plus one per day for 30 days, plus one per week for a year. */
  private pruneBackups(): void {
    const list = this.backups();
    const keep = new Set<string>(list.slice(0, 24).map((b) => b.file));
    const days = new Set<string>(), weeks = new Set<string>();
    for (const b of list) {
      const d = b.created_at.slice(0, 10);
      const age = (Date.now() - Date.parse(b.created_at)) / 86_400_000;
      if (age <= 30 && !days.has(d)) { days.add(d); keep.add(b.file); }
      const wk = Math.floor(Date.parse(b.created_at) / (7 * 86_400_000));
      if (age <= 366 && !weeks.has(String(wk))) { weeks.add(String(wk)); keep.add(b.file); }
    }
    for (const b of list) if (!keep.has(b.file)) { try { unlinkSync(b.file); } catch { /* ignore */ } }
  }

  backups(): BackupInfo[] { return listBackups(this.dir); }
}

export function readSnapshot(file: string): Snapshot {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const s: Record<string, AnyRow[]> = {};
    // Files from older versions lack newer tables: those are simply empty.
    const present = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    for (const t of TABLE_NAMES) s[t] = present.has(t) ? (db.prepare(`SELECT * FROM ${t}`).all() as unknown as AnyRow[]).map((r) => withDefaults(t, r)) : [];
    return s as Snapshot;
  } finally {
    db.close();
  }
}

/** Row diffs that turn snapshot `from` into snapshot `to`. */
export function diffSnapshots(from: Snapshot, to: Snapshot): RowDiff[] {
  const diffs: RowDiff[] = [];
  // Deletions in reverse dependency order, inserts and updates in forward order.
  const order: TableName[] = ['meta', 'entity_type', 'event_type', 'map_space', 'face', 'vertex', 'segment', 'layer', 'entity', 'event', 'effect', 'sequence', 'event_group', 'event_group_member', 'entity_group'];
  const keyedAll = (rows: AnyRow[] | undefined, t: TableName) => new Map((rows ?? []).map((r) => [(r as unknown as Record<string, string | number>)[TABLES[t].key], r]));
  // The file format version describes the file, not the project's content: never restored.
  const keyed = (rows: AnyRow[] | undefined, t: TableName) => {
    const m = keyedAll(rows, t);
    if (t === 'meta') m.delete('schema_version');
    return m;
  };
  for (const t of [...order].reverse()) {
    const a = keyed(from[t] as AnyRow[], t), b = keyed(to[t] as AnyRow[], t);
    for (const [k, row] of a) if (!b.has(k)) diffs.push({ table: t, before: row, after: null });
  }
  for (const t of order) {
    const a = keyed(from[t] as AnyRow[], t), b = keyed(to[t] as AnyRow[], t);
    for (const [k, row] of b) {
      const old = a.get(k);
      if (!old) diffs.push({ table: t, before: null, after: row });
      else if (JSON.stringify(normalizeRow(t, old)) !== JSON.stringify(normalizeRow(t, row))) diffs.push({ table: t, before: old, after: row });
    }
  }
  return diffs;
}

function normalizeRow(t: TableName, r: AnyRow): unknown[] {
  return Object.keys(TABLES[t].columns).map((c) => (r as unknown as Record<string, unknown>)[c] ?? null);
}
