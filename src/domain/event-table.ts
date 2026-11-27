// The table of events (S6, D242): what each event of a timeline holds, for its row in the Timeline studio's table:
// whether anything is drawn into it yet, who it involves, its changes by kind, the shots over it; and the list of
// events as a CSV file, written and read back (events read from a list have nothing drawn: they are planned).
import type { World } from '../world-model/world.ts';
import type { EventRow } from '../world-model/schema.ts';
import { parseJSON } from '../temporal-engine/engine.ts';
import { compare, type Calendar, type Instant, fromStore } from '../core-time/index.ts';
import { timeAt, type ShotSettings } from '../presentation/sequence.ts';

/** What an event holds: its changes (how many, by kind) and who they are about. */
export interface EventFacts { drawn: number; involves: string[]; changes: Array<[string, number]> }

const CHANGE_NAMES: Record<string, [string, string]> = {
  assign: ['change of land', 'changes of land'],
  annex: ['annexation', 'annexations'],
  place: ['move of a point', 'moves of points'],
  rename: ['new name', 'new names'],
  shape: ['shape', 'shapes'],
  relate: ['relationship', 'relationships'],
  system: ['star system', 'star systems'],
  lane: ['lane', 'lanes'],
};

const facts = new WeakMap<World, { key: string; map: Map<string, EventFacts> }>();

/** What every event holds, worked out at once (kept while the changes, features and relationships stay the same). */
export function eventFacts(world: World): Map<string, EventFacts> {
  const key = `${world.tableRevision('effect')}|${world.tableRevision('feature')}|${world.tableRevision('relation')}`;
  const kept = facts.get(world);
  if (kept && kept.key === key) return kept.map;
  const counts = new Map<string, Map<string, number>>();
  const who = new Map<string, Set<string>>();
  for (const ef of world.all('effect')) {
    const c = counts.get(ef.event_id) ?? new Map<string, number>();
    counts.set(ef.event_id, c);
    c.set(ef.kind, (c.get(ef.kind) ?? 0) + 1);
    const w = who.get(ef.event_id) ?? new Set<string>();
    who.set(ef.event_id, w);
    const add = (v: unknown) => { if (typeof v === 'string' && v) w.add(v); };
    // (Land changed hands: its new holders as resolved, whatever the tool that drew it.)
    for (const pair of parseJSON<{ set?: unknown[] } | null>(ef.resolution, null)?.set ?? []) if (Array.isArray(pair)) add(pair[1]);
    const it = parseJSON<Record<string, unknown> | null>(ef.intent, null);
    if (!it) continue;
    if (it.op === 'set' || it.op === 'paint') add(it.value);
    else if (it.op === 'annex') { add(it.from); add(it.to); }
    else if (it.op === 'shape') add(world.get('feature', String(it.feature))?.entity_id);
    else if (it.op === 'relate') { const r = world.get('relation', String(it.relation)); add(r?.a); add(r?.b); }
    else add(it.entity);
  }
  const map = new Map<string, EventFacts>();
  for (const [id, c] of counts) {
    map.set(id, { drawn: [...c.values()].reduce((a, b) => a + b, 0), involves: [...(who.get(id) ?? [])], changes: [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) });
  }
  facts.set(world, { key, map });
  return map;
}

/** An event's changes in words: "2 changes of land, 1 new name". */
export function changesText(changes: Array<[string, number]>): string {
  return changes.map(([k, n]) => { const [one, many] = CHANGE_NAMES[k] ?? [k, k]; return `${n} ${n === 1 ? one : many}`; }).join(', ');
}

/** The names of those an event involves (the first few, then how many more). */
export function involvesText(world: World, ids: string[], most = 3): string {
  const names = ids.map((id) => world.get('entity', id)?.name).filter((n): n is string => !!n).sort((a, b) => a.localeCompare(b));
  return names.length <= most ? names.join(', ') : `${names.slice(0, most).join(', ')} and ${names.length - most} more`;
}

const spans = new WeakMap<World, { revision: number; list: Array<[Instant, Instant]> }>();

/** The time each shot shows, from its first frame to its last (kept while the shots stay the same). */
function shotSpans(world: World): Array<[Instant, Instant]> {
  const revision = world.tableRevision('sequence');
  const kept = spans.get(world);
  if (kept && kept.revision === revision) return kept.list;
  const list: Array<[Instant, Instant]> = [];
  for (const sh of world.all('sequence')) {
    const st = parseJSON<ShotSettings | null>(sh.settings, null);
    if (!st || !(st.frames > 0)) continue;
    const a = timeAt(st, 0), b = timeAt(st, st.frames - 1);
    list.push(compare(a, b) <= 0 ? [a, b] : [b, a]);
  }
  spans.set(world, { revision, list });
  return list;
}

/** How many shots show some of an event's time (its span, or its moment). */
export function shotsOver(world: World, e: Pick<EventRow, 'start_day' | 'start_ms' | 'end_day' | 'end_ms'>): number {
  const start = fromStore(e.start_day, e.start_ms), end = e.end_day !== null ? fromStore(e.end_day, e.end_ms ?? 0) : start;
  let n = 0;
  for (const [lo, hi] of shotSpans(world)) if (compare(start, hi) <= 0 && compare(end, lo) >= 0) n++;
  return n;
}

// ---- The list as a CSV file ----

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Events as a CSV file: name, start, end, type and groups (dates written in the map's calendar). */
export function eventsCsv(world: World, events: EventRow[], cal: Calendar, groupsOf: (id: string) => string[]): string {
  const lines = ['Name,Starts,Ends,Type,Groups'];
  for (const e of events) {
    const prec = e.precision === 'year' ? 'year' : 'day';
    const start = cal.format(fromStore(e.start_day, e.start_ms), prec);
    const end = e.end_day !== null ? cal.format(fromStore(e.end_day, e.end_ms ?? 0), prec) : '';
    const type = world.get('event_type', e.type_id)?.name ?? '';
    lines.push([e.name, start, end, type, groupsOf(e.id).join('; ')].map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** The fields of a CSV line (quotes, doubled quotes and commas within quotes understood). */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

export interface ListedEvent { name: string; start: Instant; end: Instant | null; precision: 'year' | 'day'; type: string; groups: string[] }

/**
 * Events from a CSV file: a first line naming the columns (Name, Starts, Ends, Type, Groups, in any order; a list
 * without it read in that order), then an event a line, its dates in the map's calendar. Lines that cannot be read
 * are named in `errors`.
 */
export function parseEventsCsv(text: string, cal: Calendar): { events: ListedEvent[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const events: ListedEvent[] = [], errors: string[] = [];
  if (!lines.length) return { events, errors: ['The file is empty.'] };
  const head = fields(lines[0]).map((h) => h.toLowerCase());
  const named = head.includes('name');
  const col = (names: string[], i: number) => { const k = head.findIndex((h) => names.includes(h)); return named ? k : i; };
  const cName = col(['name', 'event'], 0), cStart = col(['starts', 'start', 'from', 'date'], 1), cEnd = col(['ends', 'end', 'to', 'until'], 2);
  const cType = col(['type'], 3), cGroups = col(['groups', 'group'], 4);
  lines.slice(named ? 1 : 0).forEach((line, i) => {
    const f = fields(line), at = (c: number) => (c >= 0 ? f[c] ?? '' : '');
    const name = at(cName), s = cal.parse(at(cStart)), endText = at(cEnd), e = endText ? cal.parse(endText) : null;
    const n = i + (named ? 2 : 1);
    if (!name) { errors.push(`Line ${n}: no name.`); return; }
    if (!s) { errors.push(`Line ${n} (${name}): its start "${at(cStart)}" is not a date.`); return; }
    if (endText && !e) { errors.push(`Line ${n} (${name}): its end "${endText}" is not a date.`); return; }
    if (e && compare(e.instant, s.instant) < 0) { errors.push(`Line ${n} (${name}): it ends before it starts.`); return; }
    events.push({ name, start: s.instant, end: e?.instant ?? null, precision: s.precision === 'year' ? 'year' : 'day', type: at(cType), groups: at(cGroups).split(';').map((g) => g.trim()).filter(Boolean) });
  });
  return { events, errors };
}
