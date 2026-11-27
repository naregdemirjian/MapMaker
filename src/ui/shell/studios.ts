// The five studios (S1, D234), each its own software: Map Studio, History, Timeline, Looks, Presentation (two pages:
// Shots and Export). Each page has its own arrangement of docking panels (dock.ts): the one worked in, kept on this
// computer, and the one saved with Save workspace, which Reset workspace returns to (else to the page's first).
// Only data and pure functions here (the panels themselves are drawn by shell/panels.tsx).
import { stack, split, cleanLayout, VIEWER, type DockLayout, type PanelId } from './dock.ts';

export type Studio = 'map' | 'history' | 'timeline' | 'looks' | 'present';
export type Page = 'map' | 'history' | 'timeline' | 'looks' | 'shots' | 'export';

export const STUDIOS: Array<{ id: Studio; name: string; hint: string; pages: Page[] }> = [
  { id: 'map', name: 'Map Studio', hint: 'The ground: the maps of this project and how each is set up', pages: ['map'] },
  { id: 'history', name: 'History', hint: 'Who holds what, when: countries and their borders, places, areas, conditions and disasters', pages: ['history'] },
  { id: 'timeline', name: 'Timeline', hint: 'Events in order: when they happen, their groups and types, alternative timelines', pages: ['timeline'] },
  { id: 'looks', name: 'Looks', hint: 'How each thing is drawn, designed in depth', pages: ['looks'] },
  { id: 'present', name: 'Presentation', hint: 'Shots, then the export', pages: ['shots', 'export'] },
];
export const PAGES: Array<{ id: Page; studio: Studio; name: string }> = [
  { id: 'map', studio: 'map', name: 'Map Studio' }, { id: 'history', studio: 'history', name: 'History' }, { id: 'timeline', studio: 'timeline', name: 'Timeline' },
  { id: 'looks', studio: 'looks', name: 'Looks' }, { id: 'shots', studio: 'present', name: 'Shots' }, { id: 'export', studio: 'present', name: 'Export' },
];
export const studioOf = (p: Page): Studio => PAGES.find((x) => x.id === p)!.studio;
/** Whether a page works on shots (the presentation view of the map) or on the world itself. */
export const presents = (p: Page): boolean => p === 'shots' || p === 'export';
/** Whether a page has tools to draw on the map with (the others choose and inspect only). */
export const drawsOn = (p: Page): boolean => p === 'map' || p === 'history';
export const isPage = (v: unknown): v is Page => PAGES.some((p) => p.id === v);

const WORLD: Page[] = ['map', 'history', 'timeline', 'looks'];
const SHOTS: Page[] = ['shots', 'export'];

/** Every panel there is: its name on its tab, the pages it can be opened in, the least it may measure. */
export interface PanelInfo { id: PanelId; title: string; pages: Page[]; hint: string; minW?: number; minH?: number; closable?: boolean }
export const PANELS: PanelInfo[] = [
  { id: VIEWER, title: 'Map', pages: [...WORLD, ...SHOTS], hint: 'The map being viewed (in Presentation, the shot’s preview)', minW: 200, minH: 120, closable: false },
  { id: 'tools', title: 'Tools', pages: ['map', 'history'], hint: 'The tools to draw on the map with', minW: 40 },
  { id: 'gallery', title: 'New map', pages: ['map'], hint: 'Every kind of map: choose one, set it up, create it', minW: 260 },
  { id: 'maps', title: 'Maps', pages: WORLD, hint: 'The maps of this project' },
  { id: 'layers', title: 'Layers', pages: WORLD, hint: 'The layers of the map being viewed: which are shown, which is drawn on' },
  { id: 'countries', title: 'Countries', pages: WORLD, hint: 'Countries and factions, and the groups they are kept in' },
  { id: 'places', title: 'Places', pages: WORLD, hint: 'Characters, cities and other points on the map' },
  { id: 'areas', title: 'Areas', pages: WORLD, hint: 'Areas, lines and points drawn on feature layers' },
  { id: 'events', title: 'Events', pages: WORLD, hint: 'The events of the timeline being viewed' },
  { id: 'properties', title: 'Properties', pages: WORLD, hint: 'What is selected (with nothing selected, the map)' },
  { id: 'looks', title: 'Looks', pages: ['history', 'timeline', 'looks', 'shots'], hint: 'How the thing chosen is drawn: its colour, fill, borders, label, marker (Design, Ctrl+D); in Shots, everywhere or this shot only', minW: 200 },
  { id: 'effects', title: 'Effects', pages: ['history', 'timeline', 'looks', 'shots'], hint: 'Every effect, in folders: drag one onto a country on the map, into the Looks panel or onto a row of the lists; double-click gives it to what is chosen', minW: 170 },
  { id: 'timeline', title: 'Timeline', pages: WORLD, hint: 'The date viewed, playing history, and the events on their tracks' },
  // (The Timeline studio's own, D241.)
  { id: 'groups', title: 'Groups', pages: ['timeline'], hint: 'The groups of events: each a track of the timeline, shown or not, its colour, name and place', minW: 200 },
  { id: 'types', title: 'Types', pages: ['timeline'], hint: 'Event types: their colours, how territory drawn into their events spreads, how long a new one lasts', minW: 200 },
  { id: 'branches', title: 'Branches', pages: ['timeline'], hint: 'Alternative timelines: the one viewed, a new one from the date viewed, each changed or deleted', minW: 200 },
  { id: 'statistics', title: 'Statistics', pages: ['timeline'], hint: 'Numbers kept over time on the map viewed, shown counting in shots as {name}', minW: 200 },
  { id: 'event-table', title: 'Table', pages: ['timeline'], hint: 'The events as a table: dates, names, types and groups changed in place; drawn or still to draw; a list read or written as a CSV file', minW: 320 },
  { id: 'shots', title: 'Shots', pages: SHOTS, hint: 'The shots of this project' },
  { id: 'shot', title: 'Shot', pages: ['shots'], hint: 'The settings of the shot chosen' },
  { id: 'export', title: 'Export', pages: ['export'], hint: 'What is exported, how and where' },
  { id: 'shot-timeline', title: 'Shot timeline', pages: SHOTS, hint: 'The shots as clips, and the frame shown' },
];
export const panelInfo = (id: PanelId): PanelInfo | undefined => PANELS.find((p) => p.id === id);
/** Whether a panel can be opened in a page. */
export const panelOn = (id: PanelId, page: Page): boolean => !!panelInfo(id)?.pages.includes(page);

/** Each page's first arrangement: what Reset workspace returns to until another is saved. */
export function defaultDock(page: Page): DockLayout {
  const lists = (front: PanelId, panels: PanelId[], width: number) => stack(panels, width, front);
  switch (page) {
    case 'map':
      return { root: split('col', [split('row', [stack(['tools'], 44), lists('maps', ['maps', 'layers'], 230), stack([VIEWER, 'gallery']), stack(['properties'], 350)]), stack(['timeline'], 130)]), floats: [] };
    case 'history':
      return { root: split('col', [split('row', [stack(['tools'], 44), lists('countries', ['layers', 'countries', 'places', 'areas', 'events', 'maps', 'effects'], 250), stack([VIEWER]), split('col', [stack(['properties']), stack(['looks'])], 310)]), stack(['timeline'], 190)]), floats: [] };
    case 'timeline':
      // (The timeline takes the room; a small map follows the date above the studio's own panels, D241.)
      return { root: split('row', [split('col', [stack([VIEWER], 200), lists('groups', ['groups', 'types', 'branches', 'statistics'], 0)], 290), stack(['timeline', 'event-table']), split('col', [stack(['properties']), stack(['looks'])], 320)]), floats: [] };
    case 'looks':
      // (The Effects panel under the lists, beside the map and the Looks panel effects are dragged onto, D238.)
      return { root: split('col', [split('row', [split('col', [lists('countries', ['countries', 'layers', 'places', 'areas'], 0), stack(['effects'], 300)], 250), stack([VIEWER]), split('col', [stack(['looks']), stack(['properties'], 230)], 380)]), stack(['timeline'], 130)]), floats: [] };
    case 'shots':
      // (The Looks and Effects panels beside the shot, under its settings, D239.)
      return { root: split('col', [split('row', [stack(['shots'], 250), stack([VIEWER]), split('col', [stack(['shot']), stack(['looks', 'effects'])], 330)]), stack(['shot-timeline'], 150)]), floats: [] };
    case 'export':
      return { root: split('col', [split('row', [stack(['shots'], 230), stack([VIEWER]), stack(['export'], 380)]), stack(['shot-timeline'], 110)]), floats: [] };
  }
}

/** A page's arrangement now, and the one saved for it (null: none saved; Reset returns to the first). */
export interface PageDock { live: DockLayout; saved: DockLayout | null }
export type Docks = Record<Page, PageDock>;

/** Whatever was kept, made valid page by page. */
export function cleanDocks(raw: unknown): Docks {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as Docks;
  for (const { id } of PAGES) {
    const v = (r[id] && typeof r[id] === 'object' ? r[id] : {}) as Record<string, unknown>;
    const known = (p: PanelId) => panelOn(p, id);
    const first = defaultDock(id);
    const saved = v.saved ? cleanLayout(v.saved, known, first) : null;
    out[id] = { live: cleanLayout(v.live, known, saved ?? first), saved };
  }
  return out;
}

const KEY = 'mapmaker.docks', KEY_PAGE = 'mapmaker.page';
export function loadDocks(): Docks {
  try { return cleanDocks(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return cleanDocks(null); }
}
export function saveDocks(v: Docks): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage may be unavailable */ }
}
/** The page last worked in, if it was one on the world (a session never opens in Presentation). */
export function loadPage(): Page {
  try { const v = localStorage.getItem(KEY_PAGE); return isPage(v) && !presents(v) ? v : 'history'; } catch { return 'history'; }
}
export function savePage(p: Page): void {
  try { localStorage.setItem(KEY_PAGE, p); } catch { /* storage may be unavailable */ }
}
