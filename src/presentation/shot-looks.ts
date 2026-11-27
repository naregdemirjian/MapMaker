// A shot's looks of its own (D239, S5 of the studios plan): in Presentation, a change in the Looks panel applies
// everywhere, or to this shot only. A shot keeps the rows it changes (countries', groups', layers' and areas' colours
// and styles, whole) in its settings; drawing the shot, and the Looks panel while it edits this shot only, read the world
// through a view in which those rows are the shot's. Pure: the store writes them (store.executeLooks).
import type { World } from '../world-model/world.ts';
import { invertDiffs, rowKey, type AnyRow, type RowDiff, type TableName } from '../world-model/schema.ts';

/** The tables whose rows a shot can have looks of its own for: countries (and people, cities), groups, layers, areas. */
export type RestyleTable = 'entity' | 'entity_group' | 'layer' | 'feature';
export const RESTYLE_TABLES: readonly RestyleTable[] = ['entity', 'entity_group', 'layer', 'feature'];
/** Tables whose rows have a colour of their own besides their style. */
const COLOURED: readonly RestyleTable[] = ['entity', 'entity_group'];
const isRestyle = (t: TableName): t is RestyleTable => (RESTYLE_TABLES as readonly string[]).includes(t);

/** A row's look in a shot: its colour (countries, groups) and its style (JSON), whole. */
export interface RestyleRow { color?: string; style?: string }
/** What a shot keeps of its own looks (ShotSettings.restyle). */
export type Restyle = Partial<Record<RestyleTable, Record<string, RestyleRow>>>;

/** A shot's looks of its own as stored, checked (unknown tables and fields dropped). */
export function restyleOf(v: unknown): Restyle {
  const out: Restyle = {};
  if (!v || typeof v !== 'object') return out;
  for (const t of RESTYLE_TABLES) {
    const rows = (v as Record<string, unknown>)[t];
    if (!rows || typeof rows !== 'object') continue;
    const kept: Record<string, RestyleRow> = {};
    for (const [id, r] of Object.entries(rows as Record<string, unknown>)) {
      if (!r || typeof r !== 'object') continue;
      const { color, style } = r as Record<string, unknown>;
      const row: RestyleRow = {};
      if (COLOURED.includes(t) && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) row.color = color.toLowerCase();
      if (typeof style === 'string') row.style = style;
      if (row.color !== undefined || row.style !== undefined) kept[id] = row;
    }
    if (Object.keys(kept).length) out[t] = kept;
  }
  return out;
}

/** Whether a shot has looks of its own at all. */
export const hasRestyle = (r: Restyle | null | undefined): boolean => !!r && RESTYLE_TABLES.some((t) => Object.keys(r[t] ?? {}).length > 0);

/** Whether a shot has looks of its own for a row. */
export const restyled = (r: Restyle | null | undefined, table: RestyleTable, id: string): boolean => !!r?.[table]?.[id];

const views = new WeakMap<World, { key: string; view: World }>();

/**
 * The world as a shot shows it: the rows the shot has looks of its own for read with its colour and style, every
 * other row and everything else as the world's (the same world when the shot has none). Kept per world while the
 * shot's looks stay the same; read only.
 */
export function shotWorld(world: World, restyle: Restyle | null | undefined): World {
  if (!restyle || !hasRestyle(restyle)) return world;
  const key = JSON.stringify(restyle);
  const kept = views.get(world);
  if (kept && kept.key === key) return kept.view;
  const merged = new WeakMap<object, AnyRow>();
  const over = <R extends AnyRow>(table: RestyleTable, row: R): R => {
    const r = restyle[table]?.[String(rowKey(table, row))];
    if (!r) return row;
    let m = merged.get(row) as R | undefined;
    if (!m) merged.set(row, (m = { ...row, ...(r.color !== undefined ? { color: r.color } : {}), ...(r.style !== undefined ? { style: r.style } : {}) } as R));
    return m;
  };
  const lists = new Map<RestyleTable, { revision: number; rows: readonly AnyRow[] }>();
  const view = Object.create(world) as World;
  view.get = ((table: TableName, k: string | number) => {
    const row = world.get(table, k);
    return row && isRestyle(table) ? over(table, row) : row;
  }) as World['get'];
  view.all = ((table: TableName) => (isRestyle(table) ? world.all(table).map((r) => over(table, r)) : world.all(table))) as World['all'];
  view.rows = ((table: TableName) => {
    if (!isRestyle(table)) return world.rows(table);
    const revision = world.tableRevision(table);
    let l = lists.get(table);
    if (!l || l.revision !== revision) lists.set(table, (l = { revision, rows: Object.freeze(world.all(table).map((r) => over(table, r))) }));
    return l.rows;
  }) as World['rows'];
  views.set(world, { key, view });
  return view;
}

/**
 * What a change made on the shot's view leaves as the shot's own looks: the rows of the three tables it changed, as
 * they are after it (colour and style), laid over what the shot kept. Rows it inserted or removed are not looks: a
 * change that adds or deletes things is refused here.
 */
export function restyleAfter(before: Restyle, diffs: RowDiff[]): Restyle {
  const out: Restyle = JSON.parse(JSON.stringify(before ?? {}));
  for (const d of diffs) {
    if (!isRestyle(d.table) || !d.after) continue;
    if (!d.before) throw new Error('Only looks can be changed for one shot: make things everywhere.');
    const row = d.after as AnyRow & { color?: string; style?: string };
    const id = String(rowKey(d.table, row));
    const keep: RestyleRow = { style: row.style };
    if (COLOURED.includes(d.table) && typeof row.color === 'string') keep.color = row.color;
    (out[d.table] ??= {})[id] = keep;
  }
  for (const d of diffs) if (isRestyle(d.table) && !d.after) throw new Error('Only looks can be changed for one shot: make things everywhere.');
  return restyleOf(out);
}

/** The diffs that lay a shot's own looks on the world's rows (and those that take them away again). */
export function restyleDiffs(world: World, restyle: Restyle): { apply: RowDiff[]; undo: RowDiff[] } {
  const apply: RowDiff[] = [];
  for (const t of RESTYLE_TABLES) for (const [id, r] of Object.entries(restyle[t] ?? {})) {
    const row = world.get(t, id);
    if (!row) continue;
    apply.push({ table: t, before: row, after: { ...row, ...(r.color !== undefined && COLOURED.includes(t) ? { color: r.color } : {}), ...(r.style !== undefined ? { style: r.style } : {}) } as AnyRow });
  }
  return { apply, undo: invertDiffs(apply) };
}

/** A shot's looks without its own for some rows (back to everywhere's). */
export function withoutRestyle(restyle: Restyle, table: RestyleTable, ids: string[]): Restyle {
  const out: Restyle = JSON.parse(JSON.stringify(restyle ?? {}));
  for (const id of ids) delete out[table]?.[id];
  return restyleOf(out);
}
