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

export class World {
  private readonly tables = new Map<TableName, Map<string | number, AnyRow>>();
  readonly arrangements = new Map<string, Arrangement>();
  private readonly counters: Record<KernelTable, number> = { vertex: 0, segment: 0, face: 0 };
  readonly ids: IdSource = { next: (t) => ++this.counters[t] };
  /** Bumped after every applied change; caches compare against it. */
  revision = 0;

  constructor() {
    for (const t of TABLE_NAMES) if (!TABLES[t].kernel) this.tables.set(t, new Map());
  }

  static fromSnapshot(s: Snapshot): World {
    const w = new World();
    for (const t of TABLE_NAMES) {
      if (TABLES[t].kernel) continue;
      for (const row of (s[t] ?? []) as AnyRow[]) w.tables.get(t)!.set(rowKey(t, row), { ...withDefaults(t, row) });
    }
    for (const t of ['vertex', 'segment', 'face'] as const) for (const r of s[t] ?? []) w.counters[t] = Math.max(w.counters[t], r.id);
    for (const sp of w.all('map_space')) {
      if (sp.kind !== 'sphere') continue;
      const by = <T extends { space_id: string }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.space_id === sp.id);
      w.arrangements.set(sp.id, Arrangement.fromRows(sp.id, sp.root_face, by(s.vertex), by(s.segment), by(s.face), w.ids));
    }
    return w;
  }

  get<K extends TableName>(table: K, key: string | number): Rows[K] | undefined {
    return this.tables.get(table)?.get(key) as Rows[K] | undefined;
  }

  all<K extends TableName>(table: K): Rows[K][] {
    return [...(this.tables.get(table)?.values() ?? [])] as Rows[K][];
  }

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
      if (d.after) this.counters[d.table as KernelTable] = Math.max(this.counters[d.table as KernelTable], (d.after as KernelRow).id);
      return;
    }
    const map = this.tables.get(d.table)!;
    if (d.before) map.delete(rowKey(d.table, d.before));
    if (d.after) map.set(rowKey(d.table, d.after), { ...withDefaults(d.table, d.after) });
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
    for (const ef of this.all('effect')) {
      if (ef.space_id !== spaceId) continue;
      let res: { set?: Array<[number[], unknown]> };
      try { res = JSON.parse(ef.resolution); } catch { return () => true; } // unreadable: assume everything is referenced
      for (const entry of res.set ?? []) {
        if (!Array.isArray(entry) || !Array.isArray(entry[0])) return () => true;
        for (const f of entry[0]) set.add(f);
      }
    }
    return (f) => set.has(f);
  }

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

  nextSeq(table: 'entity' | 'event' | 'sequence' | 'event_group' | 'entity_group'): number {
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
    for (const c of kd.changes) this.diffs.push({ table: c.table, before: c.before as AnyRow | null, after: c.after as AnyRow | null });
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
