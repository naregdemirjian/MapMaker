// Domain commands: every user action is one of these. Each runs inside a transaction against the
// in-memory world and returns the exact row diffs to save (and to undo). Commands never draw anything.
import { World, Tx, newId } from '../world-model/world.ts';
import {
  Engine, canonicalFaces, leafDescendants, hashFaces, parseJSON, type Resolution, type TransitionSpec, type AnnexIntent, type PlaceIntent,
} from '../temporal-engine/engine.ts';
import { type Instant, toStore, NEG_INF, compare } from '../core-time/index.ts';
import {
  BASE_EVENT_ID, MAIN_BRANCH, SCHEMA_VERSION, type RowDiff, type EffectRow, type EventRow, type EntityRow, type LayerKind,
} from '../world-model/schema.ts';
import type { Vec3 } from '../geo-kernel/vec.ts';
import { worldSettings, type BasemapSource } from '../world-model/world-settings.ts';
import type { LabelStyle, CountryLabel } from '../render-engine/label-style.ts';
import { ringFromMapPoints } from '../render-engine/stroke.ts';

export interface CommandResult<T = unknown> { label: string; diffs: RowDiff[]; result: T }

export function run<T>(world: World, label: string, fn: (tx: Tx) => T): CommandResult<T> {
  const tx = new Tx(world);
  try {
    const result = fn(tx);
    return { label, diffs: tx.finish(), result };
  } catch (e) {
    tx.rollback();
    throw e;
  }
}

export const BUILTIN_ENTITY_TYPES = [
  { id: 'polity', name: 'Country or territory', category: 'political' },
  { id: 'faction', name: 'Faction or organisation', category: 'political' },
  { id: 'character', name: 'Character', category: 'people' },
  { id: 'settlement', name: 'City or settlement', category: 'places' },
  { id: 'unit', name: 'Military unit', category: 'military' },
  { id: 'body', name: 'Planet, moon or habitat', category: 'astronomy' },
];

export const BUILTIN_EVENT_TYPES = [
  { id: 'base', name: 'Base world' },
  { id: 'general', name: 'Event' },
  { id: 'founding', name: 'Founding' },
  { id: 'conquest', name: 'Conquest' },
  { id: 'war', name: 'War' },
  { id: 'treaty', name: 'Treaty' },
  { id: 'revolution', name: 'Revolution' },
  { id: 'collapse', name: 'Collapse' },
  { id: 'disaster', name: 'Disaster' },
];

const PALETTE = ['#c8553d', '#2f7f8f', '#d9a441', '#6a4c93', '#3a7d44', '#b5446e', '#3d5a80', '#e07a5f', '#81b29a', '#9c6644', '#5e60ce', '#c9a227'];

export function suggestColor(world: World): string {
  const used = new Set(world.all('entity').map((e) => e.color));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[world.all('entity').length % PALETTE.length];
}

// ---------------------------------------------------------------- project and worlds

/** Initial content of a new project: types, the base-world event and a first world. */
export function seedProject(world: World, name: string, firstWorld = { name: 'Earth', radiusKm: 6371.0088 }): CommandResult<{ spaceId: string }> {
  return run(world, 'Create project', (tx) => {
    tx.insert('meta', { key: 'schema_version', value: String(SCHEMA_VERSION) });
    tx.insert('meta', { key: 'project_name', value: name });
    tx.insert('meta', { key: 'created_at', value: new Date().toISOString() });
    for (const t of BUILTIN_ENTITY_TYPES) tx.insert('entity_type', { ...t, builtin: 1 });
    for (const t of BUILTIN_EVENT_TYPES) tx.insert('event_type', { ...t, builtin: 1, fields: '{}' });
    const [sd, sm] = toStore(NEG_INF);
    tx.insert('event', {
      id: BASE_EVENT_ID, type_id: 'base', branch_id: MAIN_BRANCH, name: 'Base world', start_day: sd, start_ms: sm,
      end_day: null, end_ms: null, precision: 'exact', precedence: 0, description: 'How the world is before any recorded event.',
      fields: '{}', presentation: '{}', created_seq: 0, variant_group: null, variant_active: 1,
    });
    return { spaceId: createWorldIn(tx, firstWorld.name, firstWorld.radiusKm, 'natural-earth') };
  });
}

function createWorldIn(tx: Tx, name: string, radiusKm: number, basemap: BasemapSource): string {
  const w = tx.world;
  const spaceId = newId('space');
  const bodyId = newId('ent');
  tx.insert('entity', { id: bodyId, type_id: 'body', branch_id: MAIN_BRANCH, name, color: '#7a8b99', notes: '', created_seq: w.nextSeq('entity'), style: '{}' });
  const root = w.ids.next('face');
  tx.insert('map_space', {
    id: spaceId, name, kind: 'sphere', body_id: bodyId, radius_m: radiusKm * 1000, unit: null, parent_space_id: null,
    root_face: root, sort_order: w.all('map_space').length, settings: JSON.stringify({ projection: 'equirectangular', basemap }),
  });
  tx.insert('face', { id: root, space_id: spaceId, parent_id: null, is_leaf: 1 });
  tx.insert('layer', {
    id: newId('layer'), space_id: spaceId, kind: 'partition', name: 'Political', sort_order: 0, visible: 1,
    style: JSON.stringify({ fillOpacity: 0.78, borderWidth: 1.4 }), export_pass: 'political',
  });
  return spaceId;
}

export function createWorld(world: World, name: string, radiusKm: number, basemap: BasemapSource = 'none'): CommandResult<string> {
  if (!(radiusKm > 0)) throw new Error('A round map needs a positive radius.');
  return run(world, `Create map "${name}"`, (tx) => createWorldIn(tx, name, radiusKm, basemap));
}

/** Show or hide Earth's geography (Natural Earth) under a world's territories. */
export function setWorldBasemap(world: World, spaceId: string, basemap: BasemapSource): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  const label = basemap === 'none' ? `Hide Earth's geography on "${space.name}"` : `Show Earth's geography on "${space.name}"`;
  return run(world, label, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify({ ...worldSettings(space), basemap }) }); });
}

export function createLayer(world: World, spaceId: string, name: string, kind: LayerKind = 'partition'): CommandResult<string> {
  return run(world, `Create layer "${name}"`, (tx) => {
    const id = newId('layer');
    const order = world.all('layer').filter((l) => l.space_id === spaceId).length;
    tx.insert('layer', { id, space_id: spaceId, kind, name, sort_order: order, visible: 1, style: JSON.stringify({ fillOpacity: 0.6, borderWidth: 1 }), export_pass: name.toLowerCase().replace(/\W+/g, '-') });
    return id;
  });
}

export function updateLayer(world: World, id: string, patch: Partial<{ name: string; visible: number; style: string; sort_order: number }>): CommandResult {
  return run(world, 'Change layer', (tx) => tx.patch('layer', id, patch));
}

/** Whether a layer's territory ends at the coast (on worlds that show Earth's geography). */
export function setLayerClipToLand(world: World, id: string, clip: boolean): CommandResult {
  const layer = world.get('layer', id);
  if (!layer) throw new Error('That layer no longer exists.');
  const style = { ...parseJSON<Record<string, unknown>>(layer.style, {}), clipToLand: clip };
  return run(world, clip ? `End "${layer.name}" at the coast` : `Let "${layer.name}" cover the sea`, (tx) => tx.patch('layer', id, { style: JSON.stringify(style) }));
}

// ---------------------------------------------------------------- looks: label styles, entity styles

/** How a country's territory is filled: its colour (default), a picture, or a video. */
export interface CountryFill {
  kind: 'color' | 'image' | 'video';
  /** A project asset name, or a file shipped with the app (for example 'data/flags/fr.svg'). */
  asset?: string;
  /** How the picture covers the territory: cover (cropped), contain, stretch, or tile (repeat). */
  fit?: 'cover' | 'contain' | 'stretch' | 'tile';
  /** Tile size in pixels of a 1920-wide frame. */
  tileSize?: number;
  /** Videos: loop, or play once and hold the last frame. */
  play?: 'loop' | 'once';
  speed?: number;
  /** Videos: seconds into the video at the start of a shot. */
  start?: number;
}

/** What is stored in entity.style (JSON). */
export interface EntityStyle { label?: CountryLabel; fill?: CountryFill }

export function entityStyle(e: { style?: string } | null | undefined): EntityStyle {
  return parseJSON<EntityStyle>(e?.style ?? '{}', {}) ?? {};
}

/** The project's general label style (all country labels), as stored. */
export function generalLabelStyle(world: World): Partial<LabelStyle> {
  return parseJSON<Partial<LabelStyle>>(world.get('meta', 'label_style')?.value ?? '{}', {}) ?? {};
}

/** Change the general label style (only the fields given; null resets a field to the default). */
export function setGeneralLabelStyle(world: World, patch: Partial<Record<keyof LabelStyle, unknown>>): CommandResult {
  const next: Record<string, unknown> = { ...generalLabelStyle(world) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
  return run(world, 'Change the look of all labels', (tx) => {
    const row = world.get('meta', 'label_style');
    const value = JSON.stringify(next);
    if (row) tx.update('meta', { key: 'label_style', value }); else tx.insert('meta', { key: 'label_style', value });
  });
}

/** Change parts of an entity's look. `label: null` returns its label to the general style. */
export function setEntityStyle(world: World, id: string, patch: { label?: CountryLabel | null; fill?: CountryFill | null }): CommandResult {
  const e = world.get('entity', id);
  if (!e) throw new Error('That country no longer exists.');
  const next: EntityStyle = { ...entityStyle(e) };
  if (patch.label === null) delete next.label;
  else if (patch.label !== undefined) {
    const clean = Object.fromEntries(Object.entries(patch.label).filter(([, v]) => v !== undefined && v !== null && v !== '')) as CountryLabel;
    if (Object.keys(clean).length) next.label = clean; else delete next.label;
  }
  if (patch.fill === null || patch.fill?.kind === 'color') delete next.fill;
  else if (patch.fill) {
    if (!patch.fill.asset) throw new Error('Choose a picture or video first.');
    next.fill = patch.fill;
  }
  return run(world, `Change the look of "${e.name}"`, (tx) => { tx.patch('entity', id, { style: JSON.stringify(next) }); });
}

// ---------------------------------------------------------------- entities

export function createEntity(world: World, e: { type_id: string; name: string; color?: string; notes?: string }): CommandResult<string> {
  if (!e.name.trim()) throw new Error('Give it a name.');
  return run(world, `Create "${e.name}"`, (tx) => {
    const id = newId('ent');
    tx.insert('entity', { id, type_id: e.type_id, branch_id: MAIN_BRANCH, name: e.name.trim(), color: e.color ?? suggestColor(world), notes: e.notes ?? '', created_seq: world.nextSeq('entity'), style: '{}' });
    return id;
  });
}

export function updateEntity(world: World, id: string, patch: Partial<Pick<EntityRow, 'name' | 'color' | 'notes' | 'type_id'>>): CommandResult {
  return run(world, 'Edit entity', (tx) => tx.patch('entity', id, patch));
}

export function deleteEntity(world: World, id: string): CommandResult {
  const name = world.get('entity', id)?.name ?? '';
  return run(world, `Delete "${name}"`, (tx) => tx.remove('entity', id));
}

// ---------------------------------------------------------------- events

export interface EventInput {
  name: string; type_id?: string; start: Instant; end?: Instant | null; precision?: string; description?: string; precedence?: number;
}

function insertEventIn(tx: Tx, e: EventInput): string {
  if (!e.name.trim()) throw new Error('Give the event a name.');
  if (e.end && compare(e.end, e.start) < 0) throw new Error('An event cannot end before it starts.');
  const id = newId('evt');
  const [sd, sm] = toStore(e.start);
  const end = e.end ? toStore(e.end) : null;
  tx.insert('event', {
    id, type_id: e.type_id ?? 'general', branch_id: MAIN_BRANCH, name: e.name.trim(), start_day: sd, start_ms: sm,
    end_day: end ? end[0] : null, end_ms: end ? end[1] : null, precision: e.precision ?? 'day', precedence: e.precedence ?? 0,
    description: e.description ?? '', fields: '{}', presentation: '{}', created_seq: tx.world.nextSeq('event'), variant_group: null, variant_active: 1,
  });
  return id;
}

/** Create an event; `groups` puts it in those event groups in the same step. */
export function createEvent(world: World, e: EventInput & { groups?: string[] }): CommandResult<string> {
  for (const g of e.groups ?? []) if (!world.get('event_group', g)) throw new Error('That group no longer exists.');
  return run(world, `Create event "${e.name}"`, (tx) => {
    const id = insertEventIn(tx, e);
    for (const g of e.groups ?? []) insertMember(tx, g, id);
    return id;
  });
}

export function updateEvent(world: World, id: string, patch: Partial<EventInput> & { variant_group?: string | null; variant_active?: number }): CommandResult {
  if (id === BASE_EVENT_ID && (patch.start || patch.end)) throw new Error('The starting map has no date.');
  return run(world, 'Edit event', (tx) => {
    const ev = world.get('event', id);
    if (!ev) throw new Error('Unknown event');
    const next: EventRow = { ...ev };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.type_id !== undefined) next.type_id = patch.type_id;
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.precision !== undefined) next.precision = patch.precision;
    if (patch.precedence !== undefined) next.precedence = patch.precedence;
    if (patch.start) [next.start_day, next.start_ms] = toStore(patch.start);
    if (patch.end !== undefined) {
      if (patch.end === null) { next.end_day = null; next.end_ms = null; } else [next.end_day, next.end_ms] = toStore(patch.end);
    }
    if (patch.variant_group !== undefined) next.variant_group = patch.variant_group;
    if (patch.variant_active !== undefined) next.variant_active = patch.variant_active;
    if (next.end_day !== null && (next.end_day < next.start_day || (next.end_day === next.start_day && (next.end_ms ?? 0) < next.start_ms))) {
      throw new Error('An event cannot end before it starts.');
    }
    tx.update('event', next);
  });
}

export function deleteEvent(world: World, id: string): CommandResult {
  if (id === BASE_EVENT_ID) throw new Error('The starting map cannot be deleted.');
  const name = world.get('event', id)?.name ?? '';
  return run(world, `Delete event "${name}"`, (tx) => {
    for (const ef of world.all('effect').filter((f) => f.event_id === id)) tx.remove('effect', ef.id);
    for (const m of world.all('event_group_member').filter((g) => g.event_id === id)) tx.remove('event_group_member', m.id);
    tx.remove('event', id);
  });
}

/** Make an alternative version of an event (story planning): the copy becomes the active version. */
export function createVariant(world: World, eventId: string, name: string): CommandResult<string> {
  return run(world, `Create alternative "${name}"`, (tx) => {
    const ev = world.get('event', eventId);
    if (!ev || ev.id === BASE_EVENT_ID) throw new Error('Choose an event first.');
    const group = ev.variant_group ?? newId('alt');
    if (!ev.variant_group) tx.patch('event', ev.id, { variant_group: group, variant_active: 0 });
    for (const other of world.all('event')) if (other.variant_group === group && other.id !== ev.id) tx.patch('event', other.id, { variant_active: 0 });
    if (ev.variant_group) tx.patch('event', ev.id, { variant_active: 0 });
    const id = newId('evt');
    tx.insert('event', { ...ev, id, name, variant_group: group, variant_active: 1, created_seq: world.nextSeq('event') });
    for (const ef of world.all('effect').filter((f) => f.event_id === ev.id)) tx.insert('effect', { ...ef, id: newId('eff'), event_id: id });
    // The alternative belongs to the same groups as the original.
    for (const m of world.all('event_group_member').filter((g) => g.event_id === ev.id)) insertMember(tx, m.group_id, id);
    return id;
  });
}

export function activateVariant(world: World, eventId: string): CommandResult {
  return run(world, 'Switch alternative', (tx) => {
    const ev = world.get('event', eventId);
    if (!ev?.variant_group) throw new Error('This event has no alternatives.');
    for (const other of world.all('event')) if (other.variant_group === ev.variant_group) tx.patch('event', other.id, { variant_active: other.id === eventId ? 1 : 0 });
  });
}

// ---------------------------------------------------------------- event groups
// Events belong to the project; the user groups them (by country, by world, or groups of their own)
// and chooses which groups the timeline shows (DECISIONS D8). An event can be in several groups.

const GROUP_COLORS = ['#4f9bd9', '#e0a458', '#7bc47f', '#d1495b', '#a77dc2', '#5fb7b0', '#c9b458', '#e07a9a'];

function insertMember(tx: Tx, groupId: string, eventId: string): void {
  const id = `${groupId}|${eventId}`;
  if (!tx.world.get('event_group_member', id)) tx.insert('event_group_member', { id, group_id: groupId, event_id: eventId });
}

export function createEventGroup(world: World, name: string, color?: string): CommandResult<string> {
  const n = name.trim();
  if (!n) throw new Error('Give the group a name.');
  if (world.all('event_group').some((g) => g.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a group called "${n}".`);
  return run(world, `Create event group "${n}"`, (tx) => {
    const id = newId('grp');
    const count = world.all('event_group').length;
    tx.insert('event_group', { id, name: n, color: color ?? GROUP_COLORS[count % GROUP_COLORS.length], sort_order: count, created_seq: world.nextSeq('event_group') });
    return id;
  });
}

export function updateEventGroup(world: World, id: string, patch: { name?: string; color?: string }): CommandResult {
  const g = world.get('event_group', id);
  if (!g) throw new Error('That group no longer exists.');
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) throw new Error('Give the group a name.');
  if (name && world.all('event_group').some((o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a group called "${name}".`);
  return run(world, `Change event group "${g.name}"`, (tx) => { tx.patch('event_group', id, { ...(name ? { name } : {}), ...(patch.color ? { color: patch.color } : {}) }); });
}

/** Delete a group. Its events stay; they only leave the group. */
export function deleteEventGroup(world: World, id: string): CommandResult {
  const g = world.get('event_group', id);
  if (!g) throw new Error('That group no longer exists.');
  return run(world, `Delete event group "${g.name}"`, (tx) => {
    for (const m of world.all('event_group_member').filter((x) => x.group_id === id)) tx.remove('event_group_member', m.id);
    tx.remove('event_group', id);
  });
}

/** Put an event in exactly these groups (taking it out of any others). */
export function setEventGroups(world: World, eventId: string, groupIds: string[]): CommandResult {
  const ev = world.get('event', eventId);
  if (!ev || ev.id === BASE_EVENT_ID) throw new Error('Choose an event first.');
  for (const g of groupIds) if (!world.get('event_group', g)) throw new Error('That group no longer exists.');
  const want = new Set(groupIds);
  return run(world, `Change the groups of "${ev.name}"`, (tx) => {
    for (const m of world.all('event_group_member').filter((x) => x.event_id === eventId)) if (!want.has(m.group_id)) tx.remove('event_group_member', m.id);
    for (const g of want) insertMember(tx, g, eventId);
  });
}

/** The groups an event belongs to, in display order. */
export function groupsOfEvent(world: World, eventId: string): string[] {
  const order = new Map(world.all('event_group').map((g) => [g.id, g.sort_order]));
  return world.all('event_group_member').filter((m) => m.event_id === eventId).map((m) => m.group_id).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * Whether an event is shown under a group filter: null shows every event; otherwise the event shows
 * if it is in a chosen group, or if it is in no group and 'ungrouped' is chosen.
 */
export function eventShown(world: World, eventId: string, filter: Set<string> | null): boolean {
  if (!filter) return true;
  const groups = world.all('event_group_member').filter((m) => m.event_id === eventId);
  if (!groups.length) return filter.has(UNGROUPED);
  return groups.some((m) => filter.has(m.group_id));
}
export const UNGROUPED = '__ungrouped';

// ---------------------------------------------------------------- today's countries

export interface CountryToAdd {
  name: string;
  /** Each polygon: its outline, then its holes, as [lon, lat] points. */
  polygons: Array<Array<Array<[number, number]>>>;
  color?: string;
  /** A picture to fill it with (for example its flag), for countries created now. */
  fill?: CountryFill;
}

/**
 * Add countries and their territory in one step: each country is created (or an existing one with
 * the same name is used) and its land is painted as a correction or as part of an event. All outlines
 * go into the map together, so the map's structure is rebuilt once however many countries there are.
 * With `into`, their land is given to that existing country instead (Greece's borders added to a
 * country of the user's own, say), and no countries are created.
 */
export function addCountries(world: World, engine: Engine, o: { spaceId: string; layerId: string; countries: CountryToAdd[]; mode: EditMode; snap?: number; newEvent?: EventInput; into?: string }): CommandResult<{ entities: string[]; eventId: string | null }> {
  checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, mode: o.newEvent ? undefined : o.mode, value: o.into });
  if (!o.countries.length) throw new Error('Choose at least one country.');
  const intoName = o.into ? world.get('entity', o.into)!.name : '';
  const label = o.into
    ? `Add ${o.countries.length === 1 ? o.countries[0].name : `${o.countries.length} countries`} to ${intoName}`
    : o.countries.length === 1 ? `Add ${o.countries[0].name}` : `Add ${o.countries.length} countries`;
  return run(world, label, (tx) => {
    // Optionally the event they belong to is created in the same step (one undo).
    const eventId = o.newEvent ? insertEventIn(tx, o.newEvent) : null;
    if (eventId) o = { ...o, mode: { kind: 'new', eventId } };
    const existing = new Map(world.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').map((e) => [e.name.toLowerCase(), e.id]));
    const entities: string[] = [];
    // Outlines: each polygon's outer ring and holes, oriented with the area they surround on the left.
    const rings: Vec3[][] = [];
    const parts: Array<Array<{ outer: number; holes: number[] }>> = [];
    for (const c of o.countries) {
      const polys: Array<{ outer: number; holes: number[] }> = [];
      for (const poly of c.polygons) {
        const outer = ringFromMapPoints(poly[0], 1);
        if (!outer) continue;
        const entry = { outer: rings.push(outer) - 1, holes: [] as number[] };
        for (const h of poly.slice(1)) { const hr = ringFromMapPoints(h, 1); if (hr) entry.holes.push(rings.push(hr) - 1); }
        polys.push(entry);
      }
      parts.push(polys);
    }
    const paths = tx.kernel(o.spaceId, (arr) => arr.insertPaths(rings, { closed: true, snap: o.snap ?? 1e-8 }));
    const arr = world.arrangement(o.spaceId);
    const lefts = arr.facesLeftOfMany(paths);
    const insideOf = (i: number) => (arr.isSimpleCycle(paths[i]) && arr.separatesFaces(paths[i]) ? lefts[i] : arr.facesWoundBy(paths[i]));
    const items: Array<{ leaves: Iterable<number>; value: string | null }> = [];
    o.countries.forEach((c, k) => {
      // Into an existing country: its territory grows; no country of this name is created.
      let id = o.into ?? existing.get(c.name.toLowerCase());
      if (!id) {
        id = newId('ent');
        const style = c.fill?.asset ? JSON.stringify({ fill: c.fill }) : '{}';
        tx.insert('entity', { id, type_id: 'polity', branch_id: MAIN_BRANCH, name: c.name, color: c.color ?? suggestColor(world), notes: '', created_seq: world.nextSeq('entity'), style });
        existing.set(c.name.toLowerCase(), id);
      }
      if (!entities.includes(id)) entities.push(id);
      const faces = new Set<number>();
      for (const p of parts[k]) {
        const holes = new Set<number>();
        for (const h of p.holes) for (const f of leafDescendants(arr, insideOf(h))) holes.add(f);
        for (const f of leafDescendants(arr, insideOf(p.outer))) if (!holes.has(f)) faces.add(f);
      }
      if (!faces.size) return;
      if (o.mode.kind === 'new') insertAssignEffect(tx, { eventId: o.mode.eventId, spaceId: o.spaceId, layerId: o.layerId, faces: canonicalFaces(arr, [...faces]), value: id, at: o.mode.at ?? null, intent: { op: 'paint', value: id } });
      else items.push({ leaves: faces, value: id });
    });
    if (o.mode.kind !== 'new' && items.length) writeAssignments(tx, engine, o.spaceId, o.layerId, o.mode, items);
    return { entities, eventId };
  });
}

// ---------------------------------------------------------------- territory

export type EditMode =
  | { kind: 'new'; eventId: string; at?: Instant | null }
  /** Retroactive: fixes the period being viewed inside the change that started it (the starting map at NEG_INF). */
  | { kind: 'correct'; t: Instant }
  /** "Correct this period": a change from `t` on, until something later changes the area; no event. */
  | { kind: 'change'; t: Instant };

/** Write territory changes as the edit mode says (one change for all the items). */
function writeAssignments(tx: Tx, engine: Engine, spaceId: string, layerId: string, mode: EditMode, items: Array<{ leaves: Iterable<number>; value: string | null }>, extra: { transition?: TransitionSpec | null; intent?: unknown } = {}): void {
  const arr = tx.world.arrangement(spaceId);
  if (mode.kind === 'correct' || (mode.kind === 'change' && mode.t.day === -Infinity)) {
    correctPeriods(tx, engine, spaceId, layerId, items, mode.t);
    return;
  }
  const sets: Array<[number[], string | null]> = items.map((x) => [canonicalFaces(arr, x.leaves), x.value]);
  const nonEmpty = sets.filter(([f]) => f.length);
  if (!nonEmpty.length) return;
  const id = mode.kind === 'new'
    ? insertAssignEffect(tx, { eventId: mode.eventId, spaceId, layerId, faces: nonEmpty[0][0], value: nonEmpty[0][1], at: mode.at ?? null, transition: extra.transition ?? null, intent: extra.intent })
    : insertAssignEffect(tx, { eventId: BASE_EVENT_ID, spaceId, layerId, faces: nonEmpty[0][0], value: nonEmpty[0][1], at: mode.t, intent: extra.intent });
  if (nonEmpty.length > 1) tx.patch('effect', id, { resolution: JSON.stringify({ set: nonEmpty } satisfies Resolution) });
}

function nextOrdinal(world: World, eventId: string): number {
  return world.all('effect').filter((f) => f.event_id === eventId).reduce((m, f) => Math.max(m, f.ordinal), 0) + 1;
}

function insertAssignEffect(tx: Tx, o: { eventId: string; spaceId: string; layerId: string; faces: number[]; value: string | null; at?: Instant | null; transition?: TransitionSpec | null; intent?: unknown }): string {
  const id = newId('eff');
  const at = o.at ? toStore(o.at) : null;
  tx.insert('effect', {
    id, event_id: o.eventId, ordinal: nextOrdinal(tx.world, o.eventId), kind: 'assign', space_id: o.spaceId, layer_id: o.layerId,
    at_day: at ? at[0] : null, at_ms: at ? at[1] : null,
    transition: o.transition ? JSON.stringify(o.transition) : '',
    intent: JSON.stringify(o.intent ?? { op: 'set', value: o.value }),
    resolution: JSON.stringify({ set: [[o.faces, o.value]] } satisfies Resolution), basis_hash: '',
  });
  return id;
}

/** "Correct this period": change the value from the moment the current one was set, inside that same change. */
function correctPeriod(tx: Tx, engine: Engine, spaceId: string, layerId: string, leaves: Iterable<number>, value: string | null, t: Instant): void {
  correctPeriods(tx, engine, spaceId, layerId, [{ leaves, value }], t);
}

/**
 * Several corrections of the period being viewed at once: every change they fall under is read
 * first, then each is written once (one re-reading of history however many items there are).
 */
function correctPeriods(tx: Tx, engine: Engine, spaceId: string, layerId: string, items: Array<{ leaves: Iterable<number>; value: string | null }>, t: Instant): void {
  const world = tx.world;
  const arr = world.arrangement(spaceId);
  // effect id ('' = nothing set it yet) -> the sets of parcels and their new owners, in item order
  const byEffect = new Map<string, Array<[number[], string | null]>>();
  for (const { leaves, value } of items) {
    const groups = new Map<string, number[]>();
    for (const leaf of leaves) {
      const a = engine.latest(spaceId, layerId, leaf, t);
      const key = a ? a.effectId : '';
      let l = groups.get(key);
      if (!l) groups.set(key, (l = []));
      l.push(leaf);
    }
    for (const [effectId, faces] of groups) {
      let l = byEffect.get(effectId);
      if (!l) byEffect.set(effectId, (l = []));
      l.push([canonicalFaces(arr, faces), value]);
    }
  }
  for (const [effectId, sets] of byEffect) {
    if (effectId) {
      const ef = world.get('effect', effectId)!;
      const res = parseJSON<Resolution>(ef.resolution, { set: [] });
      res.set.push(...sets);
      tx.patch('effect', effectId, { resolution: JSON.stringify(res) });
      continue;
    }
    // Nothing set it yet: correct the base world (its undated change; dated ones are changes made
    // without an event).
    const base = world.all('effect').find((f) => f.event_id === BASE_EVENT_ID && f.layer_id === layerId && f.kind === 'assign' && f.at_day === null);
    if (base) {
      const res = parseJSON<Resolution>(base.resolution, { set: [] });
      res.set.push(...sets);
      tx.patch('effect', base.id, { resolution: JSON.stringify(res) });
    } else {
      const id = insertAssignEffect(tx, { eventId: BASE_EVENT_ID, spaceId, layerId, faces: sets[0][0], value: sets[0][1] });
      // The change's assignments are its resolution sets: the first is written by insertAssignEffect.
      if (sets.length > 1) tx.patch('effect', id, { resolution: JSON.stringify({ set: sets }) });
    }
  }
}

export interface PaintInput {
  spaceId: string; layerId: string;
  /** Closed ring as unit vectors, interior on the left (counter-clockwise on the map). */
  ring?: Vec3[];
  /** Several rings painted together (e.g. a lasso split where it crossed itself). */
  rings?: Vec3[][];
  value: string | null;
  snap: number;
  mode: EditMode;
  transition?: TransitionSpec | null;
}

/** Give an area to an owner (or clear it). The area's outline permanently cuts the parcel map. */
export function paintTerritory(world: World, engine: Engine, p: PaintInput): CommandResult<{ faces: number[] }> {
  const who = p.value ? world.get('entity', p.value)?.name ?? 'someone' : 'nobody';
  return run(world, p.mode.kind === 'new' ? `Give territory to ${who}` : p.mode.kind === 'change' ? `Change territory to ${who}` : `Correct territory to ${who}`, (tx) => {
    const faces: number[] = [];
    paintInside(tx, engine, p, faces);
    return { faces };
  });
}

/** Refuse territory edits that would refer to the wrong map, a missing layer, event or owner. */
function checkTarget(world: World, o: { spaceId: string; layerId: string; value?: string | null; mode?: EditMode; eventId?: string }): void {
  const layer = world.get('layer', o.layerId);
  if (!world.get('map_space', o.spaceId)) throw new Error('That map no longer exists.');
  if (!layer) throw new Error('That layer no longer exists.');
  if (layer.space_id !== o.spaceId) throw new Error(`The layer "${layer.name}" belongs to another map.`);
  if (layer.kind !== 'partition') throw new Error(`The layer "${layer.name}" does not hold territory.`);
  if (o.value && !world.get('entity', o.value)) throw new Error('That owner no longer exists.');
  const eventId = o.eventId ?? (o.mode?.kind === 'new' ? o.mode.eventId : undefined);
  if (eventId && !world.get('event', eventId)) throw new Error('That event no longer exists.');
}

function paintInside(tx: Tx, engine: Engine, p: PaintInput, out: number[] = []): string {
  const world = tx.world;
  checkTarget(world, p);
  const rings = p.rings ?? (p.ring ? [p.ring] : []);
  if (rings.length === 0) throw new Error('Nothing to paint.');
  // Collect each ring's inside right after inserting it: a later ring may split earlier borders,
  // and pieces of split parcels are covered through their parent (children inherit).
  const insideAll = new Set<number>();
  // All rings go in together (one rebuild of the map's structure); each is then read in turn.
  const paths = tx.kernel(p.spaceId, (arr) => arr.insertPaths(rings, { closed: true, snap: p.snap }));
  for (const path of paths) {
    const arr = world.arrangement(p.spaceId);
    // A simple outline paints what lies on its left (so shapes larger than a hemisphere work).
    // Check that against the area the outline encloses, computed independently from its points: if
    // they differ, the outline crosses, folds back or overlaps itself, and it paints every area it
    // goes around instead (DECISIONS D23), exactly as drawn.
    let inside = arr.facesLeftOf(path);
    const enclosed = arr.pathLeftArea(path);
    const full = 4 * Math.PI;
    // A simple loop encloses exactly its left side; only other outlines need the area comparison
    // (which on a large map costs more than the rest of the edit).
    const simple = enclosed > 1e-15 && enclosed < full - 1e-15 && arr.isSimpleCycle(path) && arr.separatesFaces(path);
    let covered = enclosed;
    if (!simple) { covered = 0; for (const f of leafDescendants(arr, inside)) covered += arr.faceArea(f); }
    if (!simple && (enclosed < 1e-15 || enclosed > full - 1e-15 || Math.abs(covered - enclosed) > 1e-9 + 1e-6 * enclosed)) {
      inside = arr.facesWoundBy(path);
      let wound = 0;
      for (const f of leafDescendants(arr, inside)) wound += arr.faceArea(f);
      if (wound < 1e-15) throw new Error('This outline encloses no area (it may be too thin at this zoom level). Draw it a little wider.');
    }
    for (const f of inside) insideAll.add(f);
  }
  const arr = world.arrangement(p.spaceId);
  const inside = [...leafDescendants(arr, insideAll)];
  writeAssignments(tx, engine, p.spaceId, p.layerId, p.mode, [{ leaves: inside, value: p.value }], { transition: p.mode.kind === 'new' ? p.transition ?? null : null, intent: { op: 'paint', value: p.value } });
  out.push(...inside);
  return 'paint';
}

/** Create an event and give it a territorial change, as one undoable step. */
export function paintWithNewEvent(world: World, engine: Engine, e: EventInput, p: Omit<PaintInput, 'mode'>): CommandResult<{ eventId: string }> {
  const painted = { label: '' };
  const r = run(world, `Create event "${e.name}"`, (tx) => {
    const eventId = insertEventIn(tx, e);
    const inner = paintInside(tx, engine, { ...p, mode: { kind: 'new', eventId } });
    painted.label = inner;
    return { eventId };
  });
  return r;
}

/** Give a set of existing parcels to an owner (used by the region picker and fill tool). */
export function assignFaces(world: World, engine: Engine, o: { spaceId: string; layerId: string; leaves: number[]; value: string | null; mode: EditMode; transition?: TransitionSpec | null }): CommandResult {
  const who = o.value ? world.get('entity', o.value)?.name ?? 'someone' : 'nobody';
  return run(world, `Give territory to ${who}`, (tx) => {
    checkTarget(world, o);
    writeAssignments(tx, engine, o.spaceId, o.layerId, o.mode, [{ leaves: o.leaves, value: o.value }], { transition: o.transition ?? null });
  });
}

/** Intention-bearing change: everything `from` holds just before the event goes to `to`. */
export function annex(world: World, engine: Engine, o: { spaceId: string; layerId: string; eventId: string; from: string; to: string; at?: Instant | null; transition?: TransitionSpec | null }): CommandResult<string> {
  const a = world.get('entity', o.from)?.name ?? '?', b = world.get('entity', o.to)?.name ?? '?';
  return run(world, `${b} annexes ${a}`, (tx) => {
    checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, value: o.to, eventId: o.eventId });
    if (!world.get('entity', o.from)) throw new Error('That owner no longer exists.');
    const id = newId('eff');
    const at = o.at ? toStore(o.at) : null;
    const row: EffectRow = {
      id, event_id: o.eventId, ordinal: nextOrdinal(world, o.eventId), kind: 'annex', space_id: o.spaceId, layer_id: o.layerId,
      at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition: o.transition ? JSON.stringify(o.transition) : '',
      intent: JSON.stringify({ op: 'annex', from: o.from, to: o.to } satisfies AnnexIntent), resolution: JSON.stringify({ set: [] }), basis_hash: '',
    };
    tx.insert('effect', row);
    const basis = engine.basisFor(row, o.from);
    tx.patch('effect', id, { resolution: JSON.stringify({ set: [[basis, o.to]] }), basis_hash: hashFaces(basis) });
    return id;
  });
}

/** History Health: accept a stale intention as stored. */
export function keepAsStored(world: World, engine: Engine, effectId: string): CommandResult {
  return run(world, 'Keep change as stored', (tx) => {
    const ef = world.get('effect', effectId);
    const intent = ef ? parseJSON<AnnexIntent | null>(ef.intent, null) : null;
    if (!ef || !intent) throw new Error('Nothing to keep.');
    tx.patch('effect', effectId, { basis_hash: hashFaces(engine.basisFor(ef, intent.from)) });
  });
}

/** History Health: work the intention out again from history as it now stands. */
export function reapplyIntent(world: World, engine: Engine, effectId: string): CommandResult {
  return run(world, 'Re-apply intention', (tx) => {
    const ef = world.get('effect', effectId);
    const intent = ef ? parseJSON<AnnexIntent | null>(ef.intent, null) : null;
    if (!ef || !intent) throw new Error('Nothing to re-apply.');
    const basis = engine.basisFor(ef, intent.from);
    tx.patch('effect', effectId, { resolution: JSON.stringify({ set: [[basis, intent.to]] }), basis_hash: hashFaces(basis) });
  });
}

// ---------------------------------------------------------------- characters (points, never territory)

/**
 * Place a character on a map from a date on: a point, with no borders. Without an event (mode
 * 'change') or as part of an event (mode 'new'). Placing a character again at the same moment moves
 * that placement instead of adding another. `arrive`: travels here from its previous place
 * (moving steadily between the two dates), or appears here at the date.
 */
export function placeCharacter(world: World, o: { spaceId: string; entity: string; lon: number; lat: number; mode: EditMode; arrive?: 'travel' | 'jump' }): CommandResult<string> {
  const e = world.get('entity', o.entity);
  if (!e) throw new Error('That character no longer exists.');
  if (!world.get('map_space', o.spaceId)) throw new Error('That map no longer exists.');
  if (!Number.isFinite(o.lon) || !Number.isFinite(o.lat) || Math.abs(o.lat) > 90) throw new Error('That place is not on the map.');
  const lon = ((((o.lon + 180) % 360) + 360) % 360) - 180;
  // Characters travel between their places; cities and other places move (if at all) at once.
  const arrive = o.arrive ?? (e.type_id === 'character' ? undefined : 'jump');
  return run(world, `Place ${e.name}`, (tx) => writePlacement(tx, o.spaceId, o.entity, o.mode, { lon, lat: o.lat, arrive }));
}

/** A character leaves the map from a date on (until placed again). */
export function characterLeaves(world: World, o: { spaceId: string; entity: string; mode: EditMode }): CommandResult<string> {
  const e = world.get('entity', o.entity);
  if (!e) throw new Error('That character no longer exists.');
  return run(world, `${e.name} leaves the map`, (tx) => writePlacement(tx, o.spaceId, o.entity, o.mode, { off: true }));
}

/** Whether a character travels to a placement from the previous one, or appears there. */
export function setPlacementArrival(world: World, effectId: string, arrive: 'travel' | 'jump'): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef || ef.kind !== 'place') throw new Error('That placement no longer exists.');
  const it = parseJSON<PlaceIntent>(ef.intent, { op: 'place', entity: '' });
  return run(world, arrive === 'travel' ? 'Travels there' : 'Appears there', (tx) => tx.patch('effect', effectId, { intent: JSON.stringify({ ...it, arrive }) }));
}

/** A placement made without an event holds from the beginning instead of from its date (the starting map). */
export function placementFromBeginning(world: World, effectId: string): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef || ef.kind !== 'place') throw new Error('That placement no longer exists.');
  if (ef.event_id !== BASE_EVENT_ID) throw new Error('This place belongs to an event; change the event instead.');
  return run(world, 'From the beginning', (tx) => tx.patch('effect', effectId, { at_day: null, at_ms: null }));
}

function writePlacement(tx: Tx, spaceId: string, entity: string, mode: EditMode, what: { lon?: number; lat?: number; off?: boolean; arrive?: 'travel' | 'jump' }): string {
  const world = tx.world;
  const eventId = mode.kind === 'new' ? mode.eventId : BASE_EVENT_ID;
  if (mode.kind === 'new' && !world.get('event', eventId)) throw new Error('That event no longer exists.');
  const t: Instant | null = mode.kind === 'new' ? mode.at ?? null : mode.t;
  const at = t && t.day !== -Infinity ? toStore(t) : null;
  // The same character, map, event and moment: move that placement.
  const same = world.all('effect').find((f) => {
    if (f.kind !== 'place' || f.space_id !== spaceId || f.event_id !== eventId || f.at_day !== (at ? at[0] : null) || f.at_ms !== (at ? at[1] : null)) return false;
    return parseJSON<PlaceIntent | null>(f.intent, null)?.entity === entity;
  });
  const prev = same ? parseJSON<PlaceIntent | null>(same.intent, null) : null;
  const intent: PlaceIntent = what.off
    ? { op: 'place', entity, off: true }
    : { op: 'place', entity, lon: what.lon, lat: what.lat, arrive: what.arrive ?? prev?.arrive ?? 'travel' };
  if (same) { tx.patch('effect', same.id, { intent: JSON.stringify(intent) }); return same.id; }
  const id = newId('eff');
  tx.insert('effect', {
    id, event_id: eventId, ordinal: nextOrdinal(world, eventId), kind: 'place', space_id: spaceId, layer_id: null,
    // No parcels: an empty resolution, in the same shape as every other change's.
    at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition: '', intent: JSON.stringify(intent), resolution: JSON.stringify({ set: [] }), basis_hash: '',
  });
  return id;
}

export function deleteEffect(world: World, effectId: string): CommandResult {
  return run(world, 'Remove change', (tx) => tx.remove('effect', effectId));
}

export function setEffectTransition(world: World, effectId: string, spec: TransitionSpec | null): CommandResult {
  return run(world, 'Change transition', (tx) => tx.patch('effect', effectId, { transition: spec ? JSON.stringify(spec) : '' }));
}

// ---------------------------------------------------------------- border geometry ("correct for all time")

export function moveVertex(world: World, o: { spaceId: string; vertexId: number; to: Vec3; snap: number }): CommandResult {
  return run(world, 'Move border point (all time)', (tx) => tx.kernel(o.spaceId, (arr) => arr.moveVertex(o.vertexId, o.to, o.snap)));
}

export function insertBorderVertex(world: World, o: { spaceId: string; segmentId: number; at: Vec3 }): CommandResult<number> {
  return run(world, 'Add border point', (tx) => tx.kernel(o.spaceId, (arr) => arr.insertVertexOnSegment(o.segmentId, o.at)));
}

export function removeBorderVertex(world: World, o: { spaceId: string; vertexId: number }): CommandResult {
  return run(world, 'Remove border point', (tx) => tx.kernel(o.spaceId, (arr) => arr.removeVertex(o.vertexId)));
}

/** Draw a dividing line (e.g. a new border inside a country) without changing anyone's territory yet. */
export function drawLine(world: World, o: { spaceId: string; points: Vec3[]; snap: number }): CommandResult {
  return run(world, 'Draw border line', (tx) => tx.kernel(o.spaceId, (arr) => arr.insertPath(o.points, { closed: false, snap: o.snap })));
}

// ---------------------------------------------------------------- presentation (kept apart from world data)

export function createSequence(world: World, name: string, settings: unknown): CommandResult<string> {
  return run(world, `Create shot "${name}"`, (tx) => {
    const id = newId('seq');
    tx.insert('sequence', { id, name, created_seq: world.nextSeq('sequence'), settings: JSON.stringify(settings) });
    return id;
  });
}

export function updateSequence(world: World, id: string, patch: { name?: string; settings?: unknown }): CommandResult {
  return run(world, 'Edit shot', (tx) => tx.patch('sequence', id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.settings !== undefined ? { settings: JSON.stringify(patch.settings) } : {}),
  }));
}

export function deleteSequence(world: World, id: string): CommandResult {
  return run(world, 'Delete shot', (tx) => tx.remove('sequence', id));
}
