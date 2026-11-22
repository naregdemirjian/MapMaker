// Workspaces and their layouts (D196). A workspace is a named arrangement of the same panels for one kind of
// work: the tool strip and lists at the left, the map in the middle, Properties at the right, the timeline
// below. The sizes of its panels, and which are folded away, are kept per workspace on this computer.

export type Workspace = 'map' | 'history' | 'world' | 'present' | 'export';

export const WORKSPACES: Array<{ id: Workspace; name: string; hint: string }> = [
  { id: 'map', name: 'Map', hint: 'Draw: countries and their borders, areas, lines, points, cities and characters' },
  { id: 'history', name: 'History', hint: 'Events and what changes in them, on a tall timeline' },
  { id: 'world', name: 'World', hint: 'The map itself: terrain, sea level, calendar, what is shown, how the stars look' },
  { id: 'present', name: 'Present', hint: 'Shots: framing, timing, transitions, the look of the map, texts and graphics' },
  { id: 'export', name: 'Export', hint: 'Output quality, what to export and where, and the export itself' },
];

/** Whether a workspace works on shots (the presentation view of the map) or on the world itself. */
export const presents = (w: Workspace): boolean => w === 'present' || w === 'export';

export type Side = 'left' | 'right' | 'bottom';
export interface PanelLayout { left: number; right: number; bottom: number; hidden: Side[] }
export type Layouts = Record<Workspace, PanelLayout>;

export const DEFAULT_LAYOUTS: Layouts = {
  map: { left: 250, right: 310, bottom: 150, hidden: [] },
  history: { left: 270, right: 330, bottom: 300, hidden: [] },
  world: { left: 230, right: 350, bottom: 110, hidden: [] },
  present: { left: 250, right: 310, bottom: 150, hidden: [] },
  export: { left: 230, right: 380, bottom: 110, hidden: [] },
};

/** The least and most a panel may measure, pixels. */
export const LIMITS: Record<Side, [number, number]> = { left: [160, 600], right: [220, 700], bottom: [70, 600] };
const SIDES: Side[] = ['left', 'right', 'bottom'];

export const clampSize = (side: Side, v: number): number => Math.round(Math.max(LIMITS[side][0], Math.min(LIMITS[side][1], v)));

/** A panel's size after its edge is dragged by `delta` pixels (right: positive is rightwards; down: downwards). */
export function dragged(side: Side, size: number, delta: number): number {
  return clampSize(side, side === 'left' ? size + delta : size - delta);
}

/** Whatever was stored, made valid (anything unknown falls back to the default arrangement). */
export function cleanLayouts(raw: unknown): Layouts {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as Layouts;
  for (const { id } of WORKSPACES) {
    const d = DEFAULT_LAYOUTS[id], v = (r[id] && typeof r[id] === 'object' ? r[id] : {}) as Record<string, unknown>;
    const size = (side: Side) => (typeof v[side] === 'number' && Number.isFinite(v[side]) ? clampSize(side, v[side] as number) : d[side]);
    out[id] = { left: size('left'), right: size('right'), bottom: size('bottom'), hidden: Array.isArray(v.hidden) ? SIDES.filter((x) => (v.hidden as unknown[]).includes(x)) : [] };
  }
  return out;
}

const KEY = 'mapmaker.layouts', KEY_WORKSPACE = 'mapmaker.workspace';

export function loadLayouts(): Layouts {
  try { return cleanLayouts(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return cleanLayouts(null); }
}
export function saveLayouts(v: Layouts): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage may be unavailable */ }
}
/** The workspace last worked in, if it was one on the world (a session never opens in a shot). */
export function loadWorkspace(): Workspace {
  try { const v = localStorage.getItem(KEY_WORKSPACE); return v === 'history' || v === 'world' ? v : 'map'; } catch { return 'map'; }
}
export function saveWorkspace(w: Workspace): void {
  try { localStorage.setItem(KEY_WORKSPACE, w); } catch { /* storage may be unavailable */ }
}

/** The grid tracks of a layout: a folded panel takes no room. */
export function tracks(l: PanelLayout): Record<Side, number> {
  return { left: l.hidden.includes('left') ? 0 : l.left, right: l.hidden.includes('right') ? 0 : l.right, bottom: l.hidden.includes('bottom') ? 0 : l.bottom };
}

// The lists at the left (D199): one at a time, by tabs, or all of them in one column.
export type ListTab = 'maps' | 'layers' | 'countries' | 'places' | 'areas' | 'events' | 'all';
export const LIST_TABS: Array<{ id: ListTab; name: string; hint: string }> = [
  { id: 'maps', name: 'Maps', hint: 'The maps of this project' },
  { id: 'layers', name: 'Layers', hint: 'The layers of the map being viewed: which are shown, which is drawn on' },
  { id: 'countries', name: 'Countries', hint: 'Countries and factions, and the groups they are kept in' },
  { id: 'places', name: 'Places', hint: 'Characters, cities and other points on the map' },
  { id: 'areas', name: 'Areas', hint: 'Areas, lines and points drawn on feature layers' },
  { id: 'events', name: 'Events', hint: 'The events of the timeline being viewed' },
  { id: 'all', name: 'All', hint: 'Every list in one column' },
];
/** The list each workspace on the world opens with. */
export const DEFAULT_LIST_TABS: Record<'map' | 'history' | 'world', ListTab> = { map: 'countries', history: 'events', world: 'maps' };
export type ListTabs = typeof DEFAULT_LIST_TABS;

export function cleanListTabs(raw: unknown): ListTabs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const one = (k: keyof ListTabs): ListTab => (LIST_TABS.some((t) => t.id === r[k]) ? (r[k] as ListTab) : DEFAULT_LIST_TABS[k]);
  return { map: one('map'), history: one('history'), world: one('world') };
}
const KEY_TABS = 'mapmaker.listTabs';
export function loadListTabs(): ListTabs {
  try { return cleanListTabs(JSON.parse(localStorage.getItem(KEY_TABS) ?? 'null')); } catch { return { ...DEFAULT_LIST_TABS }; }
}
export function saveListTabs(v: ListTabs): void {
  try { localStorage.setItem(KEY_TABS, JSON.stringify(v)); } catch { /* storage may be unavailable */ }
}

/** Whether a name answers what is typed in a list's filter (every word of it, in any order, whatever the case). */
export function nameMatches(name: string, filter: string): boolean {
  const n = name.toLowerCase();
  return filter.toLowerCase().split(/\s+/).filter(Boolean).every((word) => n.includes(word));
}
