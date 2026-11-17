// Event types (Stage 3, D75): the built-in ones (Founding, Conquest, War, Treaty…) and the user's own.
// A type is a template for its events: a colour on the timeline and in the lists, how the territory
// drawn into its events spreads by default (at once, an advancing front, an expansion, a fade), and
// how long a new event of the type lasts by default. Kept in the `fields` of the event_type row, so
// the project file format is unchanged.
import type { World } from '../world-model/world.ts';
import { newId } from '../world-model/world.ts';
import type { EventTypeRow } from '../world-model/schema.ts';
import { add, instant, daysInMonth, type Instant, gregorian } from '../core-time/index.ts';
import { run, type CommandResult } from './commands.ts';

export type Spread = 'instant' | 'border' | 'advance' | 'fade';
export const SPREADS: Array<{ id: Spread; name: string }> = [
  { id: 'instant', name: 'At once' },
  { id: 'border', name: "Advancing front, out of the country's existing border" },
  { id: 'advance', name: 'Expansion, a circle from where you started drawing' },
  { id: 'fade', name: "Fade over the event's duration" },
];
export type LengthUnit = 'day' | 'month' | 'year';
export interface EventLength { n: number; unit: LengthUnit }

export interface EventTypeSettings {
  /** Its colour on the timeline and in the lists (none: the usual blue). */
  color?: string;
  /** How territory drawn into its events spreads, when they last a while. */
  spread?: Spread;
  /** How long a new event of the type lasts (none: it happens at once). */
  length?: EventLength | null;
}

/** Types that are always there: the starting map's (never shown) and the plain "Event" that events of a deleted type become. */
export const FIXED_TYPES = new Set(['base', 'general']);
export const TYPE_COLORS = ['#c8553d', '#d9a441', '#3a7d44', '#6a4c93', '#b5446e', '#2f7f8f', '#e07a5f', '#5e60ce', '#9c6644', '#81b29a'];

export function typeSettings(row: EventTypeRow | undefined | null): EventTypeSettings {
  if (!row) return {};
  try {
    const f = typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields;
    return f && typeof f === 'object' ? (f as EventTypeSettings) : {};
  } catch {
    return {};
  }
}

/** The types offered for events, in the order shown: built-in ones first, then the user's own by name. */
export function eventTypes(world: World): EventTypeRow[] {
  return world.all('event_type').filter((t) => t.id !== 'base').sort((a, b) => (b.builtin - a.builtin) || (a.builtin ? 0 : a.name.localeCompare(b.name)));
}

/** The colour of an event's type, if it has one. */
export function typeColor(world: World, typeId: string): string | undefined {
  return typeSettings(world.get('event_type', typeId)).color;
}

/** When an event of this type starting at `start` ends by default (null: it happens at once). */
export function defaultEnd(world: World, typeId: string, start: Instant): Instant | null {
  const len = typeSettings(world.get('event_type', typeId)).length;
  if (!len || !(len.n > 0)) return null;
  if (len.unit === 'day') return add(start, len.n);
  const c = gregorian.toCivil(start);
  const total = c.year * 12 + (c.month - 1) + (len.unit === 'year' ? len.n * 12 : len.n);
  const year = Math.floor(total / 12), month = total - year * 12 + 1;
  // (31 January plus a month is the last day of February.)
  return instant(gregorian.fromCivil({ year, month, day: Math.min(c.day, daysInMonth(year, month)) }).day, start.ms);
}

function checkName(world: World, name: string, except?: string): string {
  const n = name.trim();
  if (!n) throw new Error('Give the type a name.');
  if (world.all('event_type').some((t) => t.id !== except && t.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a type called "${n}".`);
  return n;
}

function checkSettings(s: EventTypeSettings): EventTypeSettings {
  const out: EventTypeSettings = {};
  if (s.color !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(s.color)) throw new Error('A colour is written like #c8553d.'); out.color = s.color; }
  if (s.spread !== undefined) { if (!SPREADS.some((x) => x.id === s.spread)) throw new Error('Unknown way of spreading.'); out.spread = s.spread; }
  if (s.length !== undefined) {
    if (s.length && (!(s.length.n > 0) || !Number.isFinite(s.length.n) || !['day', 'month', 'year'].includes(s.length.unit))) throw new Error('A length is a number of days, months or years.');
    out.length = s.length ? { n: Math.round(s.length.n), unit: s.length.unit } : null;
  }
  return out;
}

export function createEventType(world: World, name: string, settings: EventTypeSettings = {}): CommandResult<string> {
  const n = checkName(world, name);
  const own = world.all('event_type').filter((t) => !t.builtin).length;
  const fields = { color: TYPE_COLORS[own % TYPE_COLORS.length], ...checkSettings(settings) };
  return run(world, `Create event type "${n}"`, (tx) => {
    const id = newId('etype');
    tx.insert('event_type', { id, name: n, builtin: 0, fields: JSON.stringify(fields) });
    return id;
  });
}

/** A copy of a type to change ("Siege" from "War"), with its settings. */
export function copyEventType(world: World, id: string): CommandResult<string> {
  const t = world.get('event_type', id);
  if (!t || id === 'base') throw new Error('That type no longer exists.');
  let name = `${t.name} (copy)`;
  for (let i = 2; world.all('event_type').some((o) => o.name.toLowerCase() === name.toLowerCase()); i++) name = `${t.name} (copy ${i})`;
  return createEventType(world, name, typeSettings(t));
}

/** Rename a type or change its settings (null clears the colour or the length). */
export function updateEventType(world: World, id: string, patch: { name?: string; color?: string | null; spread?: Spread | null; length?: EventLength | null }): CommandResult {
  const t = world.get('event_type', id);
  if (!t || id === 'base') throw new Error('That type no longer exists.');
  const name = patch.name !== undefined ? checkName(world, patch.name, id) : t.name;
  const next: EventTypeSettings = { ...typeSettings(t) };
  const checked = checkSettings({ ...(patch.color ? { color: patch.color } : {}), ...(patch.spread ? { spread: patch.spread } : {}), ...(patch.length !== undefined ? { length: patch.length } : {}) });
  Object.assign(next, checked);
  if (patch.color === null) delete next.color;
  if (patch.spread === null) delete next.spread;
  if (patch.length === null) delete next.length;
  return run(world, `Change event type "${t.name}"`, (tx) => { tx.patch('event_type', id, { name, fields: JSON.stringify(next) }); });
}

/** Delete types; their events become plain events ("Event"). The starting map's type and "Event" stay. */
export function deleteEventTypes(world: World, ids: string[]): CommandResult {
  const gone = ids.filter((id) => world.get('event_type', id));
  for (const id of gone) if (FIXED_TYPES.has(id)) throw new Error(`"${world.get('event_type', id)!.name}" cannot be deleted: events of deleted types become it.`);
  if (!gone.length) throw new Error('That type no longer exists.');
  const set = new Set(gone);
  return run(world, gone.length === 1 ? `Delete event type "${world.get('event_type', gone[0])!.name}"` : `Delete ${gone.length} event types`, (tx) => {
    for (const ev of world.all('event')) if (set.has(ev.type_id)) tx.patch('event', ev.id, { type_id: 'general' });
    for (const id of gone) tx.remove('event_type', id);
  });
}

/** How many events are of each type. */
export function eventsByType(world: World): Map<string, number> {
  const m = new Map<string, number>();
  for (const ev of world.all('event')) m.set(ev.type_id, (m.get(ev.type_id) ?? 0) + 1);
  return m;
}
