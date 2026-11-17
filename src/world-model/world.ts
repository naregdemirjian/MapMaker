// The in-memory world: ordinary tables plus one parcel map (Arrangement) per sphere map space.
// It is a replica of the project database. It changes only through row diffs: either recorded by a
// transaction (a command being executed) or applied from storage (load, undo, redo).
import { Arrangement, type IdSource, type KernelTable, type KernelRow } from '../geo-kernel/arrangement.ts';
import {
  TABLES, TABLE_NAMES, type RowDiff, type TableName, type Rows, type AnyRow, type MapSpaceRow, rowKey, invertDiffs, withDefaults,
} from './schema.ts';

export type Snapshot = { [K in TableName]?: Rows[K][] };

export function newId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(36).padStart(2, '0');
  return `${prefix}_${s.slice(0, 12)}`;
}

let worldSerial = 0;

/** One change that can alter history as the temporal engine compiles it (see World.historySince). */
export interface HistoryStep { rev: number; table: TableName; before: AnyRow | null; after: AnyRow | null }

export class World {
  private readonly tables = new Map<TableName, Map<string | number, AnyRow>>();
  readonly arrangements = new Map<string, Arrangement>();
  private readonly counters: Record<KernelTable, number> = { vertex: 0, segment: 0, face: 0 };
  readonly ids: IdSource = { next: (t) => ++this.counters[t] };
  /** Bumped after every applied change; caches compare against it. */
  revision = 0;
  /**
   * Bumped only by changes that can alter history as the temporal engine compiles it: events and
   * dated changes, the coming and going of layers, maps, countries and parcels, moved border points.
   * Restyling, renaming, shots and settings leave it alone, so they never cost a recompile.
   */
  historyRevision = 0;

  /**
   * What lay behind each step of historyRevision (the last few thousand), so that the temporal
   * engine can follow changes one by one instead of compiling all of history again.
   */
  private historyLog: HistoryStep[] = [];
  private historyLogFrom = 0;

  /** Count a change that can alter history, and remember what it was. */
  noteHistory(table: TableName, before: AnyRow | null, after: AnyRow | null): void {
    this.historyRevision++;
    if (this.historyLog.length >= 40_000) { this.historyLog.splice(0, 20_000); this.historyLogFrom = this.historyLog[0].rev - 1; }
    this.historyLog.push({ rev: this.historyRevision, table, before, after });
  }

  /** The changes that took history from `revision` to where it is now, in order; null when they are no longer all known. */
  historySince(revision: number): HistoryStep[] | null {
    if (revision < this.historyLogFrom) return null;
    const log = this.historyLog;
    // (Steps are in order of their revision: find the first one after `revision`.)
    let lo = 0, hi = log.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (log[mid].rev <= revision) lo = mid + 1; else hi = mid; }
    return log.slice(lo);
  }

  constructor() {
    for (const t of TABLE_NAMES) if (!TABLES[t].kernel) this.tables.set(t, new Map());
  }

  /**
   * A world from a snapshot of its tables. `own`: the snapshot's rows of the parcel maps are the
   * world's to keep (a snapshot just read and not used again): a quarter of a million rows of a
   * large map are then not copied one by one.
   */
  static fromSnapshot(s: Snapshot, own = false): World {
    const w = new World();
    for (const t of TABLE_NAMES) {
      if (TABLES[t].kernel) continue;
      for (const row of (s[t] ?? []) as AnyRow[]) w.tables.get(t)!.set(rowKey(t, row), { ...withDefaults(t, row) });
    }
    for (const t of ['vertex', 'segment', 'face'] as const) for (const r of s[t] ?? []) w.counters[t] = Math.max(w.counters[t], r.id);
    for (const sp of w.all('map_space')) {
      if (sp.kind !== 'sphere') continue;
      const by = <T extends { space_id: string }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.space_id === sp.id);
      w.arrangements.set(sp.id, Arrangement.fromRows(sp.id, sp.root_face, by(s.vertex), by(s.segment), by(s.face), w.ids, own));
    }
    return w;
  }

  get<K extends TableName>(table: K, key: string | number): Rows[K] | undefined {
    return this.tables.get(table)?.get(key) as Rows[K] | undefined;
  }

  all<K extends TableName>(table: K): Rows[K][] {
    return [...(this.tables.get(table)?.values() ?? [])] as Rows[K][];
  }

  /** A number that changes whenever a row of the table is added, changed or deleted (not for the parcel maps' tables). */
  tableRevision(table: TableName): number {
    return this.tableRevisions.get(table) ?? 0;
  }
  private readonly tableRevisions = new Map<TableName, number>();
  private readonly rowLists = new Map<TableName, { revision: number; rows: readonly AnyRow[] }>();

  /**
   * The rows of a table as a list that must not be changed (not sorted in place either): the same
   * list is given until the table changes. For what is asked again and again (drawing, long lists);
   * `all` gives a list of one's own.
   */
  rows<K extends TableName>(table: K): readonly Rows[K][] {
    const revision = this.tableRevision(table);
    let kept = this.rowLists.get(table);
    if (!kept || kept.revision !== revision) this.rowLists.set(table, (kept = { revision, rows: Object.freeze(this.all(table)) as readonly AnyRow[] }));
    return kept.rows as readonly Rows[K][];
  }

  /** Tells one loaded project from another (for what is kept per project). */
  readonly serial = ++worldSerial;

  arrangement(spaceId: string): Arrangement {
    const a = this.arrangements.get(spaceId);
    if (!a) throw new Error(`No parcel map for map space ${spaceId}`);
    return a;
  }

  /** Apply diffs coming from storage (load, undo, redo) or rolling back a transaction. */
  applyDiffs(diffs: RowDiff[]): void {
    for (const d of diffs) this.applyOne(d);
    this.revision++;
  }

  /** Internal: apply one diff without bumping the revision (transactions batch them). */
  applyOne(d: RowDiff): void {
    const def = TABLES[d.table];
    if (def.kernel) {
      const row = (d.after ?? d.before) as KernelRow & { space_id: string };
      let arr = this.arrangements.get(row.space_id);
      if (!arr) {
        arr = Arrangement.fromRows(row.space_id, this.get('map_space', row.space_id)?.root_face ?? 0, [], [], [], this.ids);
        this.arrangements.set(row.space_id, arr);
      }
      arr.applyRowChange(d.table as KernelTable, d.before as KernelRow | null, d.after as KernelRow | null);
      if (d.table !== 'segment') this.noteHistory(d.table, d.before, d.after);
      if (d.after) this.counters[d.table as KernelTable] = Math.max(this.counters[d.table as KernelTable], (d.after as KernelRow).id);
      return;
    }
    const map = this.tables.get(d.table)!;
    if (d.before) map.delete(rowKey(d.table, d.before));
    if (d.after) map.set(rowKey(d.table, d.after), { ...withDefaults(d.table, d.after) });
    this.tableRevisions.set(d.table, (this.tableRevisions.get(d.table) ?? 0) + 1);
    if (d.table === 'event' || d.table === 'effect' || ((d.table === 'layer' || d.table === 'map_space' || d.table === 'entity' || d.table === 'feature') && (!d.before || !d.after))) this.noteHistory(d.table, d.before, d.after);
    if (d.table === 'map_space') {
      const sp = (d.after ?? d.before) as MapSpaceRow;
      if (!d.after) this.arrangements.delete(sp.id);
      else if (sp.kind === 'sphere') {
        const arr = this.arrangements.get(sp.id);
        if (arr) arr.rootFace = sp.root_face;
        else this.arrangements.set(sp.id, Arrangement.fromRows(sp.id, sp.root_face, [], [], [], this.ids));
      }
    }
  }

  /**
   * When on (the default), splitting a parcel that no recorded change refers to keeps its identity
   * for its largest piece, instead of relabelling every border around it. History is identical either
   * way (proved by test/split-identity.test.ts); this only avoids needless rewriting.
   */
  optimiseSplits = true;

  /** Which parcels of a map any change (active or not, in any layer) refers to directly. */
  referencedFaces(spaceId: string): (faceId: number) => boolean {
    const set = new Set<number>();
    for (const ef of this.tables.get('effect')!.values() as Iterable<Rows['effect']>) {
      if (ef.space_id !== spaceId) continue;
      // Each change's parcels are read once (a changed row is a new object).
      let faces = this.effectFaces.get(ef);
      if (faces === undefined) {
        faces = [];
        try {
          const res = JSON.parse(ef.resolution) as { set?: Array<[number[], unknown]> };
          for (const entry of res.set ?? []) {
            if (!Array.isArray(entry) || !Array.isArray(entry[0])) { faces = null; break; }
            for (const f of entry[0]) faces.push(f);
          }
        } catch { faces = null; }
        this.effectFaces.set(ef, faces);
      }
      if (faces === null) return () => true; // unreadable: assume everything is referenced
      for (const f of faces) set.add(f);
    }
    return (f) => set.has(f);
  }
  private effectFaces = new WeakMap<object, number[] | null>();

  snapshot(): Snapshot {
    const s: Snapshot = {};
    for (const t of TABLE_NAMES) {
      if (TABLES[t].kernel) continue;
      (s as Record<string, AnyRow[]>)[t] = this.all(t).map((r) => ({ ...r }));
    }
    s.vertex = []; s.segment = []; s.face = [];
    for (const arr of this.arrangements.values()) {
      const r = arr.rows();
      s.vertex.push(...r.vertices); s.segment.push(...r.segments); s.face.push(...r.faces);
    }
    return s;
  }

  nextSeq(table: 'entity' | 'event' | 'sequence' | 'event_group' | 'entity_group' | 'feature'): number {
    let m = 0;
    for (const r of this.all(table)) m = Math.max(m, r.created_seq);
    return m + 1;
  }
}

/**
 * Records every change made while executing one command. Changes apply to the world immediately,
 * so later steps of the command see them. finish() returns the row diffs to save; rollback() undoes
 * everything if the command fails part-way.
 */
export class Tx {
  private readonly diffs: RowDiff[] = [];
  private done = false;

  readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  insert<K extends TableName>(table: K, row: Rows[K]): Rows[K] {
    if (this.world.get(table, rowKey(table, row))) throw new Error(`${table} ${rowKey(table, row)} already exists`);
    this.push({ table, before: null, after: { ...row } });
    return row;
  }

  update<K extends TableName>(table: K, row: Rows[K]): Rows[K] {
    const before = this.world.get(table, rowKey(table, row));
    if (!before) throw new Error(`${table} ${rowKey(table, row)} does not exist`);
    this.push({ table, before: { ...before }, after: { ...row } });
    return row;
  }

  patch<K extends TableName>(table: K, key: string | number, changes: Partial<Rows[K]>): Rows[K] {
    const before = this.world.get(table, key);
    if (!before) throw new Error(`${table} ${key} does not exist`);
    return this.update(table, { ...before, ...changes } as Rows[K]);
  }

  remove<K extends TableName>(table: K, key: string | number): void {
    const before = this.world.get(table, key);
    if (!before) return;
    this.push({ table, before: { ...before }, after: null });
  }

  private push(d: RowDiff): void {
    if (this.done) throw new Error('Transaction already finished');
    this.world.applyOne(d);
    this.diffs.push(d);
  }

  /** Run a parcel-map operation; its row changes (and any root-face change) are recorded. */
  kernel<T>(spaceId: string, fn: (arr: Arrangement) => T): T {
    const arr = this.world.arrangement(spaceId);
    arr.isReferenced = this.world.optimiseSplits ? this.world.referencedFaces(spaceId) : null;
    arr.begin();
    let result: T;
    try {
      result = fn(arr);
    } catch (e) {
      arr.rollback();
      throw e;
    } finally {
      arr.isReferenced = null;
    }
    const kd = arr.commit();
    for (const c of kd.changes) {
      this.diffs.push({ table: c.table, before: c.before as AnyRow | null, after: c.after as AnyRow | null });
      if (c.table !== 'segment') this.world.noteHistory(c.table, c.before as AnyRow | null, c.after as AnyRow | null);
    }
    if (kd.rootFace) {
      const sp = this.world.get('map_space', spaceId)!;
      this.push({ table: 'map_space', before: { ...sp }, after: { ...sp, root_face: kd.rootFace.after } });
    }
    return result;
  }

  /** Record changes made by a freshly created arrangement. */
  recordKernel(changes: RowDiff[]): void {
    for (const c of changes) this.diffs.push(c);
  }

  finish(): RowDiff[] {
    this.done = true;
    this.world.revision++;
    return this.diffs;
  }

  rollback(): void {
    if (this.done) return;
    this.done = true;
    this.world.applyDiffs(invertDiffs(this.diffs));
  }
}
