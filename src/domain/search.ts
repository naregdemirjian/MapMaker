// Search (Stage 4): countries, factions, characters, cities, areas, lines and points, events,
// relationships and layers, by name, by any name they went by, and by the words of their notes and
// descriptions. Results come best first: a name that starts with the words, then a name that holds
// them, then a former name, then notes.
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import { BASE_EVENT_ID } from '../world-model/schema.ts';
import { describeRelation } from './commands.ts';

export type SearchKind = 'entity' | 'feature' | 'event' | 'relation' | 'layer';
export interface SearchResult {
  kind: SearchKind;
  id: string;
  /** What it is called (now), and what kind of thing it is ("Country", "Event", "Line on Fronts"). */
  title: string;
  what: string;
  /** Why it was found, when not by its name: a former name, or a piece of its notes around the words. */
  context: string;
  score: number;
}

const TYPE_NAMES: Record<string, string> = { polity: 'Country', faction: 'Faction', character: 'Character', settlement: 'City', unit: 'Military unit', body: 'Planet or moon' };

/** Lower case without accents, for matching ("Zürich" matches "zurich"). */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** A piece of a text around the first place the words are found (null: not there). */
function snippet(text: string, q: string): string | null {
  const i = fold(text).indexOf(q);
  if (i < 0) return null;
  const from = Math.max(0, i - 30), to = Math.min(text.length, i + q.length + 50);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
}

/** How well a name matches the words: 3 starts with them, 2 a word of it does, 1 holds them, 0 not at all. */
function nameScore(name: string, q: string): number {
  const n = fold(name);
  if (n.startsWith(q)) return 3;
  if (n.includes(` ${q}`) || n.includes(`-${q}`) || n.includes(`(${q}`)) return 2;
  return n.includes(q) ? 1 : 0;
}

export function search(world: World, engine: Engine | null, text: string, limit = 30): SearchResult[] {
  const q = fold(text.trim());
  if (!q) return [];
  const out: SearchResult[] = [];
  const add = (r: Omit<SearchResult, 'score'>, score: number) => { if (score > 0) out.push({ ...r, score }); };
  for (const e of world.all('entity')) {
    const what = TYPE_NAMES[e.type_id] ?? 'Entity';
    let score = nameScore(e.name, q) * 10, context = '';
    if (!score && engine) {
      // Any name it went by (Constantinople, Byzantium).
      for (const n of engine.namesOf(e.id)) if (nameScore(n.name, q)) { score = 5; context = `also called ${n.name}`; break; }
    }
    if (!score) { const s = snippet(e.notes, q); if (s) { score = 2; context = s; } }
    add({ kind: 'entity', id: e.id, title: e.name, what, context }, score);
  }
  const layerName = new Map(world.all('layer').map((l) => [l.id, l]));
  for (const f of world.all('feature')) {
    const l = layerName.get(f.layer_id);
    const what = `${l?.kind === 'area' ? 'Area' : l?.kind === 'line' ? 'Line' : l?.kind === 'field' ? 'Source' : 'Point'} on ${l?.name ?? 'a layer'}`;
    let score = nameScore(f.name, q) * 10, context = '';
    if (!score) { const s = snippet(f.notes, q); if (s) { score = 2; context = s; } }
    add({ kind: 'feature', id: f.id, title: f.name, what, context }, score);
  }
  for (const ev of world.all('event')) {
    if (ev.id === BASE_EVENT_ID) continue;
    let score = nameScore(ev.name, q) * 10, context = '';
    if (!score) { const s = snippet(ev.description, q); if (s) { score = 2; context = s; } }
    add({ kind: 'event', id: ev.id, title: ev.name, what: ev.variant_group && !ev.variant_active ? 'Event (inactive alternative)' : 'Event', context }, score);
  }
  for (const r of world.all('relation')) {
    const title = describeRelation(world, r);
    let score = nameScore(title, q) * 4, context = '';
    if (!score) { const s = snippet(r.notes, q); if (s) { score = 2; context = s; } }
    add({ kind: 'relation', id: r.id, title, what: 'Relationship', context }, score);
  }
  for (const l of world.all('layer')) add({ kind: 'layer', id: l.id, title: l.name, what: `Layer on ${world.get('map_space', l.space_id)?.name ?? 'a map'}`, context: '' }, nameScore(l.name, q) * 3);
  // Best first; among equals, shorter names (closer matches) first, then alphabetical.
  out.sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title));
  return out.slice(0, limit);
}
