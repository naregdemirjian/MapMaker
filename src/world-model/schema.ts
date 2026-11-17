// The tables of a Map Maker project. The same definitions drive the SQLite schema (server), the
// in-memory replica (interface) and the generic row diffs used for saving, undo and redo.
import type { VertexRow, SegmentRow, FaceRow } from '../geo-kernel/arrangement.ts';

export type { VertexRow, SegmentRow, FaceRow };

export type LayerKind = 'partition' | 'area' | 'line' | 'point' | 'field' | 'track';
export type EffectKind = 'assign' | 'annex' | 'set_attribute' | 'place' | 'rename';
export type Json = string; // stored JSON text

export interface MetaRow { key: string; value: string }
export interface MapSpaceRow {
  id: string; name: string; kind: 'sphere' | 'plane'; body_id: string | null; radius_m: number | null;
  unit: string | null; parent_space_id: string | null; root_face: number; sort_order: number; settings: Json;
}
export interface EntityTypeRow { id: string; name: string; category: string; builtin: number }
export interface EntityRow {
  id: string; type_id: string; branch_id: string; name: string; color: string; notes: string; created_seq: number;
  /** Look of the entity on the map (JSON): label overrides, fills. Added in file format 3. */
  style: Json;
  /** The user's group (folder) it is listed in; '' for none. Added in file format 4. */
  group_id: string;
}
/** A group (folder) of countries, factions, cities or characters, made by the user. Added in file format 4. */
export interface EntityGroupRow { id: string; name: string; color: string; sort_order: number; created_seq: number }
export interface LayerRow { id: string; space_id: string; kind: LayerKind; name: string; sort_order: number; visible: number; style: Json; export_pass: string }
export interface EventTypeRow { id: string; name: string; builtin: number; fields: Json }
export interface EventRow {
  id: string; type_id: string; branch_id: string; name: string;
  start_day: number; start_ms: number; end_day: number | null; end_ms: number | null;
  precision: string; precedence: number; description: string; fields: Json; presentation: Json;
  created_seq: number; variant_group: string | null; variant_active: number;
}
export interface EffectRow {
  id: string; event_id: string; ordinal: number; kind: EffectKind; space_id: string | null; layer_id: string | null;
  at_day: number | null; at_ms: number | null; transition: Json; intent: Json; resolution: Json; basis_hash: string;
}
/** A group of events chosen by the user (by country, by world, or any grouping of their own). */
export interface EventGroupRow { id: string; name: string; color: string; sort_order: number; created_seq: number }
/** Membership of an event in a group; an event can belong to several groups. Key: `${group_id}|${event_id}`. */
export interface EventGroupMemberRow { id: string; group_id: string; event_id: string }
export interface SequenceRow { id: string; name: string; created_seq: number; settings: Json }

export interface Rows {
  meta: MetaRow; map_space: MapSpaceRow; entity_type: EntityTypeRow; entity: EntityRow; layer: LayerRow;
  event_type: EventTypeRow; event: EventRow; effect: EffectRow; sequence: SequenceRow;
  event_group: EventGroupRow; event_group_member: EventGroupMemberRow; entity_group: EntityGroupRow;
  vertex: VertexRow; segment: SegmentRow; face: FaceRow;
}
export type TableName = keyof Rows;
export type AnyRow = Rows[TableName];

type ColType = 'text' | 'int' | 'real' | 'text?' | 'int?' | 'real?';
export interface TableDef {
  key: string; columns: Record<string, ColType>; kernel?: boolean;
  /** Values for columns added after a table was first released: rows written before have none. */
  defaults?: Record<string, string | number>;
}

export const TABLES: { [K in TableName]: TableDef } = {
  meta: { key: 'key', columns: { key: 'text', value: 'text' } },
  map_space: { key: 'id', columns: { id: 'text', name: 'text', kind: 'text', body_id: 'text?', radius_m: 'real?', unit: 'text?', parent_space_id: 'text?', root_face: 'int', sort_order: 'int', settings: 'text' } },
  entity_type: { key: 'id', columns: { id: 'text', name: 'text', category: 'text', builtin: 'int' } },
  entity: { key: 'id', columns: { id: 'text', type_id: 'text', branch_id: 'text', name: 'text', color: 'text', notes: 'text', created_seq: 'int', style: 'text', group_id: 'text' }, defaults: { style: '{}', group_id: '' } },
  layer: { key: 'id', columns: { id: 'text', space_id: 'text', kind: 'text', name: 'text', sort_order: 'int', visible: 'int', style: 'text', export_pass: 'text' } },
  event_type: { key: 'id', columns: { id: 'text', name: 'text', builtin: 'int', fields: 'text' } },
  event: { key: 'id', columns: { id: 'text', type_id: 'text', branch_id: 'text', name: 'text', start_day: 'int', start_ms: 'int', end_day: 'int?', end_ms: 'int?', precision: 'text', precedence: 'int', description: 'text', fields: 'text', presentation: 'text', created_seq: 'int', variant_group: 'text?', variant_active: 'int' } },
  effect: { key: 'id', columns: { id: 'text', event_id: 'text', ordinal: 'int', kind: 'text', space_id: 'text?', layer_id: 'text?', at_day: 'int?', at_ms: 'int?', transition: 'text', intent: 'text', resolution: 'text', basis_hash: 'text' } },
  sequence: { key: 'id', columns: { id: 'text', name: 'text', created_seq: 'int', settings: 'text' } },
  event_group: { key: 'id', columns: { id: 'text', name: 'text', color: 'text', sort_order: 'int', created_seq: 'int' } },
  event_group_member: { key: 'id', columns: { id: 'text', group_id: 'text', event_id: 'text' } },
  entity_group: { key: 'id', columns: { id: 'text', name: 'text', color: 'text', sort_order: 'int', created_seq: 'int' } },
  vertex: { key: 'id', kernel: true, columns: { id: 'int', space_id: 'text', lon: 'int', lat: 'int' } },
  segment: { key: 'id', kernel: true, columns: { id: 'int', space_id: 'text', a: 'int', b: 'int', left_face: 'int', right_face: 'int' } },
  face: { key: 'id', kernel: true, columns: { id: 'int', space_id: 'text', parent_id: 'int?', is_leaf: 'int' } },
};

export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

/** One row-level change. Insert: before = null. Delete: after = null. */
export interface RowDiff { table: TableName; before: AnyRow | null; after: AnyRow | null }

export function rowKey(table: TableName, row: AnyRow): string | number {
  return (row as unknown as Record<string, string | number>)[TABLES[table].key];
}

export function invertDiffs(diffs: RowDiff[]): RowDiff[] {
  return [...diffs].reverse().map((d) => ({ table: d.table, before: d.after, after: d.before }));
}

/**
 * The project file format. 1: first release. 2: event groups (tables event_group, event_group_member).
 * 3: entity.style (label looks and fills). 4: groups of countries (table entity_group, entity.group_id).
 * Older files are upgraded when opened (see ProjectDb.migrate), after an automatic backup.
 */
export const SCHEMA_VERSION = 4;

/** A row with values for any columns it predates (old backups, old undo history). */
export function withDefaults<T extends AnyRow>(table: TableName, row: T): T {
  const d = TABLES[table].defaults;
  if (!d) return row;
  const r = row as unknown as Record<string, unknown>;
  let missing = false;
  for (const k of Object.keys(d)) if (r[k] === undefined || r[k] === null) { missing = true; break; }
  if (!missing) return row;
  const out: Record<string, unknown> = { ...r };
  for (const [k, v] of Object.entries(d)) if (out[k] === undefined || out[k] === null) out[k] = v;
  return out as unknown as T;
}
export const BASE_EVENT_ID = 'evt_base';
export const MAIN_BRANCH = 'main';
