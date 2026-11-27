// A shot's looks of its own (D239, S5 of the studios plan): in Presentation, a change in the Looks panel applies
// everywhere, or to this shot only. A shot keeps the rows it changes (countries', groups', layers' and areas' colours
// and styles, whole) in its settings; drawing the shot, and the Looks panel while it edits this shot only, read the world
// through a view in which those rows are the shot's. Pure: the store writes them (store.executeLooks).
//
// Keys (D240): a setting of those rows (a colour, or a number or colour in a row's style) keyed at frames of the shot,
// as in a video editor's effect controls: between two keys it goes from one value to the other (numbers eased, colours
// mixed, or held until the next key); before the first and after the last it keeps theirs. Each keyed setting is a
// track of the shot, its keys diamonds along it; the shot's view at a frame has each keyed setting's value there.
import type { World } from '../world-model/world.ts';
import { invertDiffs, rowKey, type AnyRow, type RowDiff, type TableName } from '../world-model/schema.ts';

/** The tables whose rows a shot can have looks of its own for: countries (and people, cities), groups, layers, areas. */
export type RestyleTable = 'entity' | 'entity_group' | 'layer' | 'feature';
export const RESTYLE_TABLES: readonly RestyleTable[] = ['entity', 'entity_group', 'layer', 'feature'];
/** Tables whose rows have a colour of their own besides their style. */
const COLOURED: readonly RestyleTable[] = ['entity', 'entity_group'];
const isRestyle = (t: unknown): t is RestyleTable => (RESTYLE_TABLES as readonly unknown[]).includes(t);

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
      if (COLOURED.includes(t) && typeof color === 'string' && COLOUR.test(color)) row.color = color.toLowerCase();
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

// ---- Keys (D240) ----

/** How a keyed setting goes from a key to the next: evenly, eased, or held until the next. */
export type KeyEase = 'linear' | 'smooth' | 'in' | 'out' | 'hold';
export const KEY_EASES: ReadonlyArray<readonly [KeyEase, string]> = [
  ['linear', 'Even'], ['smooth', 'Ease in and out'], ['in', 'Slow, then fast'], ['out', 'Fast, then slow'], ['hold', 'Held, then a jump'],
];
/** A key's value: a number, or a colour (#rrggbb). */
export type KeyValue = number | string;
export interface LookKey { frame: number; value: KeyValue; ease: KeyEase }
/** One step of the way to a setting: a field of an object, or the n-th item of a list whose fields are as given. */
export type PathStep = string | { where: Record<string, string>; nth: number };
/**
 * A setting of a row keyed in a shot: its colour (`['color']`), or a value in its style (`['style', …]`); `label` names
 * it ("Drop shadow · Distance"); `make`: objects missing on the way are made (a label setting of its own, for one).
 */
export interface LookTrack { table: RestyleTable; id: string; path: PathStep[]; label: string; make?: boolean; keys: LookKey[] }
/** Which setting of which row (and how it is named). */
export type TrackAt = Pick<LookTrack, 'table' | 'id' | 'path' | 'label' | 'make'>;

const COLOUR = /^#[0-9a-f]{6}$/i;
const EASE_NAMES = KEY_EASES.map(([k]) => k);
/** Whether a value can be keyed: a number, or a colour. */
export const isKeyValue = (v: unknown): v is KeyValue => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && COLOUR.test(v));

function stepOf(v: unknown): PathStep | null {
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object') {
    const { where, nth } = v as { where?: unknown; nth?: unknown };
    if (where && typeof where === 'object' && Object.values(where).every((x) => typeof x === 'string') && Number.isInteger(nth) && (nth as number) >= 0) {
      return { where: { ...(where as Record<string, string>) }, nth: nth as number };
    }
  }
  return null;
}

/** A shot's keyed settings as stored, checked: each with its keys in order, one at a frame. */
export function tracksOf(v: unknown): LookTrack[] {
  if (!Array.isArray(v)) return [];
  const out: LookTrack[] = [];
  const seen = new Set<string>();
  for (const t of v) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (!isRestyle(r.table) || typeof r.id !== 'string' || !Array.isArray(r.path)) continue;
    const path = r.path.map(stepOf);
    if (!path.length || path.some((p) => p === null)) continue;
    const colour = path[0] === 'color';
    if (colour ? path.length !== 1 || !COLOURED.includes(r.table) : path[0] !== 'style' || path.length < 2) continue;
    const at = new Map<number, LookKey>();
    for (const k of Array.isArray(r.keys) ? r.keys : []) {
      if (!k || typeof k !== 'object') continue;
      const { frame, value, ease } = k as Record<string, unknown>;
      if (!Number.isInteger(frame) || (frame as number) < 0 || !isKeyValue(value) || (colour && typeof value !== 'string')) continue;
      at.set(frame as number, { frame: frame as number, value: typeof value === 'string' ? value.toLowerCase() : value, ease: EASE_NAMES.includes(ease as KeyEase) ? (ease as KeyEase) : 'linear' });
    }
    if (!at.size) continue;
    const track: LookTrack = { table: r.table, id: r.id, path: path as PathStep[], label: typeof r.label === 'string' ? r.label : '', ...(r.make === true ? { make: true } : {}), keys: [...at.values()].sort((a, b) => a.frame - b.frame) };
    const tid = trackIdOf(track);
    if (seen.has(tid)) continue;
    seen.add(tid);
    out.push(track);
  }
  return out;
}

/** A keyed setting's identity: the row and the way to the setting. */
export const trackIdOf = (t: Pick<LookTrack, 'table' | 'id' | 'path'>): string => `${t.table}|${t.id}|${JSON.stringify(t.path)}`;

const EASE: Record<Exclude<KeyEase, 'hold'>, (u: number) => number> = {
  linear: (u) => u,
  smooth: (u) => u * u * (3 - 2 * u),
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
};

/** Two colours mixed: `u` of the way from `a` to `b`. */
function mix(a: string, b: string, u: number): string {
  let out = '#';
  for (const i of [1, 3, 5]) {
    const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
    out += Math.max(0, Math.min(255, Math.round(x + (y - x) * u))).toString(16).padStart(2, '0');
  }
  return out;
}

/** A keyed setting's value at a frame (fractions of frames too, for motion blur). */
export function keyedValue(t: Pick<LookTrack, 'keys'>, frame: number): KeyValue | undefined {
  const ks = t.keys;
  if (!ks.length) return undefined;
  if (frame <= ks[0].frame) return ks[0].value;
  const last = ks[ks.length - 1];
  if (frame >= last.frame) return last.value;
  let i = 0;
  while (ks[i + 1].frame <= frame) i++;
  const a = ks[i], b = ks[i + 1];
  if (a.ease === 'hold') return a.value;
  const u = EASE[a.ease]((frame - a.frame) / (b.frame - a.frame));
  if (typeof a.value === 'number' && typeof b.value === 'number') return a.value + (b.value - a.value) * u;
  if (typeof a.value === 'string' && typeof b.value === 'string') return mix(a.value, b.value, u);
  return a.value;
}

/** Where a step leads from a value: an object's field, or the n-th item of a list matching. */
function stepInto(o: unknown, step: PathStep): string | number | null {
  if (typeof step === 'string') return o && typeof o === 'object' && !Array.isArray(o) ? step : null;
  if (!Array.isArray(o)) return null;
  let n = step.nth;
  for (let i = 0; i < o.length; i++) {
    const it = o[i] as Record<string, unknown> | null;
    if (it && typeof it === 'object' && Object.entries(step.where).every(([k, v]) => it[k] === v) && n-- === 0) return i;
  }
  return null;
}

function readIn(o: unknown, path: PathStep[]): unknown {
  let cur = o;
  for (const step of path) {
    const k = stepInto(cur, step);
    if (k === null) return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

/** `o` with the value at the end of the path set (copied along the way); null where the path leads nowhere. */
function writeIn(o: unknown, path: PathStep[], value: unknown, make: boolean): unknown {
  if (!path.length) return value;
  const [step, ...rest] = path;
  if (typeof step === 'string') {
    if (o === undefined || o === null) { if (!make) return null; o = {}; }
    if (typeof o !== 'object' || Array.isArray(o)) return null;
    const child = writeIn((o as Record<string, unknown>)[step], rest, value, make);
    return child === null ? null : { ...(o as Record<string, unknown>), [step]: child };
  }
  const i = stepInto(o, step);
  if (i === null) return null;
  const list = [...(o as unknown[])];
  const child = writeIn(list[i as number], rest, value, make);
  if (child === null) return null;
  list[i as number] = child;
  return list;
}

function styleObject(s: unknown): Record<string, unknown> {
  try {
    const o: unknown = typeof s === 'string' && s ? JSON.parse(s) : {};
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A row's setting at a path: its colour, or a value in its style. */
export function readRow(row: AnyRow | null | undefined, path: PathStep[]): unknown {
  if (!row) return undefined;
  const r = row as AnyRow & { color?: unknown; style?: unknown };
  return path[0] === 'color' ? r.color : readIn(styleObject(r.style), path.slice(1));
}

/** A row with its setting at a path set; null where the row has no such setting (and `make` does not make it). */
export function writeRow<R extends AnyRow>(row: R, path: PathStep[], value: KeyValue, make = false): R | null {
  if (path[0] === 'color') return typeof value === 'string' ? { ...row, color: value } : null;
  const next = writeIn(styleObject((row as AnyRow & { style?: unknown }).style), path.slice(1), value, make);
  return next === null ? null : { ...row, style: JSON.stringify(next) };
}

/** A row as a shot shows it at a frame: each keyed setting of it at its value there. */
function keyedRow<R extends AnyRow>(row: R, tracks: readonly LookTrack[], frame: number): R {
  let out = row;
  for (const t of tracks) {
    const v = keyedValue(t, frame);
    if (v !== undefined) out = writeRow(out, t.path, v, !!t.make) ?? out;
  }
  return out;
}

// ---- The world as a shot shows it ----

const views = new WeakMap<World, Map<string, World>>();
let viewSerial = 0;

/**
 * The world as a shot shows it: the rows the shot has looks of its own for read with its colour and style, and, at a
 * frame, every keyed setting at its value there; every other row and everything else as the world's (the same world
 * when the shot has none). Kept per world while the shot's looks, and the keyed values, stay the same; read only. Its
 * `revision` is its own (the world's, and a fraction for the view): pictures kept for the world are not taken for it.
 */
export function shotWorld(world: World, restyle: Restyle | null | undefined, tracks: readonly LookTrack[] = [], frame = 0): World {
  const own = !!restyle && hasRestyle(restyle);
  if (!own && !tracks.length) return world;
  const key = JSON.stringify([own ? restyle : 0, tracks.map((t) => [trackIdOf(t), t.make ? 1 : 0, keyedValue(t, frame)])]);
  let kept = views.get(world);
  const found = kept?.get(key);
  if (found) return found;
  const byRow = new Map<string, LookTrack[]>();
  for (const t of tracks) {
    const k = `${t.table}|${t.id}`;
    const list = byRow.get(k);
    if (list) list.push(t); else byRow.set(k, [t]);
  }
  const merged = new WeakMap<object, AnyRow>();
  const over = <R extends AnyRow>(table: RestyleTable, row: R): R => {
    const id = String(rowKey(table, row));
    const r = own ? restyle![table]?.[id] : undefined;
    const ts = byRow.get(`${table}|${id}`);
    if (!r && !ts) return row;
    let m = merged.get(row) as R | undefined;
    if (!m) {
      let base = r ? ({ ...row, ...(r.color !== undefined ? { color: r.color } : {}), ...(r.style !== undefined ? { style: r.style } : {}) } as R) : row;
      if (ts) base = keyedRow(base, ts, frame);
      merged.set(row, (m = base));
    }
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
  const tag = ((++viewSerial % 1048576) + 1) / 2097152;
  Object.defineProperty(view, 'revision', { get: () => world.revision + tag, enumerable: true, configurable: true });
  if (!kept) views.set(world, (kept = new Map()));
  kept.set(key, view);
  // (A few kept: the preview, the Looks panel and an export may ask for different frames at once.)
  if (kept.size > 4) kept.delete(kept.keys().next().value!);
  return view;
}

/** The world as a shot (its settings as stored) shows it at a frame. */
export function shotLooksAt(world: World, shot: { restyle?: unknown; keys?: unknown } | null | undefined, frame: number): World {
  if (!shot || (!shot.restyle && !shot.keys)) return world;
  return shotWorld(world, restyleOf(shot.restyle), tracksOf(shot.keys), frame);
}

// ---- Changes made for one shot ----

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'undefined';
}
const sameStyle = (a: unknown, b: unknown): boolean => stable(styleObject(a)) === stable(styleObject(b));

/**
 * What a change made on the shot's view at a frame leaves as the shot's own looks. The keyed setting being edited
 * (`editing`, a track's id: the field the change was made in) gets a key at the frame with its new value; other keyed
 * settings keep their keys (a command tidying the whole look, rounding a value keyed between two keys, adds none).
 * Where the change did anything else to a row, the row (colour and style, as after it) is kept as the shot's, laid over
 * what the shot kept. Rows inserted or removed are not looks: a change that adds or deletes things is refused here.
 */
export function looksAfter(before: Restyle, tracks: readonly LookTrack[], diffs: RowDiff[], frame: number, editing?: string | null): { restyle: Restyle; tracks: LookTrack[] } {
  const out: Restyle = JSON.parse(JSON.stringify(before ?? {}));
  let ts: LookTrack[] = [...tracks];
  for (const d of diffs) {
    if (!isRestyle(d.table)) continue;
    if (!d.before || !d.after) throw new Error('Only looks can be changed for one shot: make things everywhere.');
    const table = d.table, id = String(rowKey(table, d.after));
    let neutral = d.after as AnyRow;
    for (const t of tracks) {
      if (t.table !== table || t.id !== id) continue;
      const was = readRow(d.before, t.path), now = readRow(d.after, t.path);
      if (was === now) continue;
      if (isKeyValue(now) && trackIdOf(t) === editing) ts = withKey(ts, t, frame, now);
      if (isKeyValue(was)) neutral = writeRow(neutral, t.path, was, !!t.make) ?? neutral;
    }
    const b = d.before as AnyRow & { color?: string; style?: string }, n = neutral as AnyRow & { color?: string; style?: string };
    if ((COLOURED.includes(table) && n.color !== b.color) || !sameStyle(n.style, b.style)) {
      const row = d.after as AnyRow & { color?: string; style?: string };
      const keep: RestyleRow = { style: row.style };
      if (COLOURED.includes(table) && typeof row.color === 'string') keep.color = row.color;
      (out[table] ??= {})[id] = keep;
    }
  }
  return { restyle: restyleOf(out), tracks: ts };
}

/** What a change of looks (no keys) leaves as the shot's own looks (see looksAfter). */
export const restyleAfter = (before: Restyle, diffs: RowDiff[]): Restyle => looksAfter(before, [], diffs, 0).restyle;

/** The diffs that lay a shot's own looks (with its keyed settings at a frame) on the world's rows, and back. */
export function restyleDiffs(world: World, restyle: Restyle, tracks: readonly LookTrack[] = [], frame = 0): { apply: RowDiff[]; undo: RowDiff[] } {
  const view = shotWorld(world, restyle, tracks, frame);
  const apply: RowDiff[] = [];
  const seen = new Set<string>();
  const rows: Array<[RestyleTable, string]> = [];
  for (const t of RESTYLE_TABLES) for (const id of Object.keys(restyle[t] ?? {})) rows.push([t, id]);
  for (const t of tracks) rows.push([t.table, t.id]);
  for (const [t, id] of rows) {
    if (seen.has(`${t}|${id}`)) continue;
    seen.add(`${t}|${id}`);
    const row = world.get(t, id);
    const shown = view.get(t, id);
    if (row && shown && shown !== row) apply.push({ table: t, before: row, after: { ...shown } as AnyRow });
  }
  return { apply, undo: invertDiffs(apply) };
}

/** A shot's looks without its own for some rows (back to everywhere's). */
export function withoutRestyle(restyle: Restyle, table: RestyleTable, ids: string[]): Restyle {
  const out: Restyle = JSON.parse(JSON.stringify(restyle ?? {}));
  for (const id of ids) delete out[table]?.[id];
  return restyleOf(out);
}

// ---- Keys added, moved, eased and removed ----

/** The keyed settings with a key at a frame (the setting keyed if it was not; a key there replaced, keeping its pace). */
export function withKey(tracks: readonly LookTrack[], at: TrackAt, frame: number, value: KeyValue): LookTrack[] {
  const id = trackIdOf(at);
  const i = tracks.findIndex((t) => trackIdOf(t) === id);
  if (i < 0) return [...tracks, { table: at.table, id: at.id, path: at.path, label: at.label, ...(at.make ? { make: true } : {}), keys: [{ frame, value, ease: 'linear' }] }];
  const t = tracks[i];
  const old = t.keys.find((k) => k.frame === frame);
  const prev = [...t.keys].reverse().find((k) => k.frame < frame);
  const keys = [...t.keys.filter((k) => k.frame !== frame), { frame, value, ease: old?.ease ?? prev?.ease ?? 'linear' }].sort((a, b) => a.frame - b.frame);
  return tracks.map((x, k) => (k === i ? { ...x, keys } : x));
}

/** Without the key at a frame (a setting left with none is no longer keyed). */
export function withoutKey(tracks: readonly LookTrack[], id: string, frame: number): LookTrack[] {
  return tracks.flatMap((t) => {
    if (trackIdOf(t) !== id) return [t];
    const keys = t.keys.filter((k) => k.frame !== frame);
    return keys.length ? [{ ...t, keys }] : [];
  });
}

/** With the key at `from` moved to `to` (replacing one there). */
export function movedKey(tracks: readonly LookTrack[], id: string, from: number, to: number): LookTrack[] {
  if (from === to) return [...tracks];
  return tracks.map((t) => {
    const k = trackIdOf(t) === id ? t.keys.find((x) => x.frame === from) : undefined;
    if (!k) return t;
    return { ...t, keys: [...t.keys.filter((x) => x.frame !== from && x.frame !== to), { ...k, frame: Math.max(0, Math.round(to)) }].sort((a, b) => a.frame - b.frame) };
  });
}

/** With the key at a frame going on to the next at another pace. */
export function easedKey(tracks: readonly LookTrack[], id: string, frame: number, ease: KeyEase): LookTrack[] {
  return tracks.map((t) => (trackIdOf(t) === id ? { ...t, keys: t.keys.map((k) => (k.frame === frame ? { ...k, ease } : k)) } : t));
}

/** Without a keyed setting (all its keys). */
export const withoutTrack = (tracks: readonly LookTrack[], id: string): LookTrack[] => tracks.filter((t) => trackIdOf(t) !== id);

/** Without the keyed settings of some rows (back to everywhere's). */
export const withoutRowKeys = (tracks: readonly LookTrack[], table: RestyleTable, ids: string[]): LookTrack[] => tracks.filter((t) => t.table !== table || !ids.includes(t.id));

/** Whether a shot keys any setting of a row. */
export const keysRow = (tracks: readonly LookTrack[], table: RestyleTable, id: string): boolean => tracks.some((t) => t.table === table && t.id === id);
