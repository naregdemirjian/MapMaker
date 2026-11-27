// Every command of the interface in one list (D197): its name, its shortcut, when it can be used, what it
// does. The menu bar is drawn from it, the keyboard runs it, and the list of shortcuts is read from it, so a
// command has one home and one description.
import { store, type AppStore, type MenuItem, type DialogName } from './store.ts';
import { STUDIOS, PAGES, PANELS, presents, panelOn } from './shell/studios.ts';
import { holderOf, VIEWER } from './shell/dock.ts';
import { matches, type KeyLike } from './shell/shortcuts.ts';
import { stepChange } from './components/Timeline.tsx';
import { deleteEntitiesAsked, deleteEventsAsked } from './components/ContextMenu.tsx';
import { basemapSourceOf, isSpaceMap } from '../world-model/world-settings.ts';
import { add } from '../core-time/index.ts';
import { calendarNow } from './calendar-now.ts';

export interface Command {
  id: string;
  name: string;
  /** As written in menus. */
  shortcut?: string;
  /** The key is listened for elsewhere (with conditions of its own): shown, not run from here. */
  keyedElsewhere?: boolean;
  enabled?: (s: AppStore) => boolean;
  /** Whether it is in its menu at all now (a panel that cannot be opened in the page worked in is left out). */
  visible?: (s: AppStore) => boolean;
  checked?: (s: AppStore) => boolean;
  run: (s: AppStore) => void;
}

const world = (s: AppStore) => s.mode === 'world';
const space = (s: AppStore) => s.world?.get('map_space', s.spaceId);
const earth = (s: AppStore) => { const sp = space(s); return !!sp && basemapSourceOf(sp) === 'natural-earth'; };
const dialog = (name: DialogName) => (s: AppStore) => s.set({ dialog: name });
const politicalChosen = (s: AppStore) => s.chosen('entity').filter((id) => { const t = s.world?.get('entity', id)?.type_id; return t === 'polity' || t === 'faction'; });

/** The date to compare with when comparing is switched on: the day before the last change (so the line shows what the map was before it), else a century earlier. */
export function defaultCompareTime(s: AppStore) {
  const last = s.engine?.lastChangeStart(s.time);
  if (last) return add(last, -1);
  const cal = calendarNow(), c = cal.toCivil(s.time);
  try { return cal.fromCivil({ year: c.year - 100, month: c.month, day: Math.min(c.day, cal.daysIn(c.year - 100, c.month)) }); } catch { return cal.fromCivil({ year: c.year - 100 }); }
}

/**
 * A panel in the Window menu (S1, D234): ticked while open in the page worked in. Chosen, a closed panel opens (where it
 * was last, else floating), one behind another tab comes to the front, and one in front closes.
 */
const panel = (id: string, name: string): Command => ({
  id: `panel-${id}`, name, visible: (s) => panelOn(id, s.pageNow()), checked: (s) => s.panelOpen(id),
  run: (s) => { const h = holderOf(s.dockNow(), id); if (h && h.active === id) s.closePanel(id); else s.openPanel(id); },
});
const PANEL_COMMANDS = PANELS.filter((p) => p.id !== VIEWER).map((p) => panel(p.id, p.title));

export const COMMANDS: Command[] = [
  // File
  { id: 'projects', name: 'Projects…', run: (s) => { void s.closeProject(); } },
  { id: 'versions', name: 'Versions and backups…', run: dialog('versions') },
  { id: 'import-borders', name: 'Import borders from files…', enabled: (s) => world(s) && !!space(s) && !isSpaceMap(space(s)), run: dialog('import-borders') },
  { id: 'data-export', name: 'Export data (GeoJSON, CSV)…', run: dialog('data-export') },
  // Edit
  { id: 'undo', name: 'Undo', shortcut: 'Ctrl+Z', enabled: (s) => s.journal.canUndo || (s.tool === 'pen' && world(s)), run: (s) => { if (s.tool === 'pen' && world(s)) s.penUndoPiece(); else void s.undo(); } },
  { id: 'redo', name: 'Redo', shortcut: 'Ctrl+Y', enabled: (s) => s.journal.canRedo || (s.tool === 'pen' && world(s)), run: (s) => { if (s.tool === 'pen' && world(s)) s.penRedoPiece(); else void s.redo(); } },
  { id: 'delete', name: 'Delete what is chosen', shortcut: 'Delete', keyedElsewhere: true, enabled: (s) => world(s) && (s.chosen('entity').length > 0 || s.chosen('event').length > 0),
    run: (s) => { const ents = s.chosen('entity'), evs = s.chosen('event'); if (ents.length) deleteEntitiesAsked(ents); else if (evs.length) deleteEventsAsked(evs); } },
  { id: 'merge', name: 'Merge the countries chosen into one…', enabled: (s) => world(s) && politicalChosen(s).length >= 2, run: (s) => s.set({ dialog: 'merge', mergeIds: politicalChosen(s) }) },
  { id: 'settings', name: 'Settings: speed of the working view…', run: dialog('settings') },
  // View
  { id: 'show', name: 'What the map shows…', run: dialog('show') },
  { id: 'guide-countries', name: 'Guides: today\'s country borders', enabled: (s) => world(s) && earth(s), checked: (s) => s.referenceBorders, run: (s) => s.set({ referenceBorders: !s.referenceBorders }) },
  { id: 'guide-states', name: 'Guides: today\'s states and provinces', enabled: (s) => world(s) && !!space(s) && space(s)!.kind === 'sphere' && !isSpaceMap(space(s)), checked: (s) => s.guideStates, run: (s) => s.set({ guideStates: !s.guideStates }) },
  { id: 'compare', name: 'Compare two dates', enabled: world, checked: (s) => s.compare.on, run: (s) => s.set({ compare: { ...s.compare, on: !s.compare.on, time: s.compare.on ? s.compare.time : defaultCompareTime(s) } }) },
  // Map
  { id: 'new-map', name: 'New map…', run: (s) => s.openGallery() },
  { id: 'new-layer', name: 'New layer…', enabled: world, run: dialog('new-layer') },
  { id: 'add-countries', name: 'Add today\'s countries…', enabled: (s) => world(s) && earth(s), run: dialog('add-countries') },
  { id: 'add-cities', name: 'Add today\'s cities…', enabled: (s) => world(s) && earth(s), run: dialog('add-cities') },
  { id: 'label-style', name: 'Label style for all countries…', enabled: world, run: dialog('label-style') },
  { id: 'statistics', name: 'Statistics…', enabled: (s) => world(s) && !!space(s) && space(s)!.kind !== 'plane' && !isSpaceMap(space(s)), run: dialog('statistics') },
  // History
  { id: 'new-event', name: 'New event…', shortcut: 'Ctrl+E', enabled: world, run: dialog('new-event') },
  { id: 'event-types', name: 'Event types…', enabled: world, run: dialog('event-types') },
  { id: 'branches', name: 'Alternative timelines (branches)…', enabled: world, run: dialog('branches') },
  { id: 'play', name: 'Play or pause', shortcut: 'Space', keyedElsewhere: true, run: (s) => {
    if (world(s)) { const p = s.historyPlay; s.set({ historyPlay: { ...p, on: !p.on } }); if (p.on) s.setTime(s.time); } else if (s.shotId) s.set({ playing: !s.playing });
  } },
  { id: 'previous-change', name: 'Previous change', shortcut: ',', enabled: world, run: () => stepChange(-1) },
  { id: 'next-change', name: 'Next change', shortcut: '.', enabled: world, run: () => stepChange(1) },
  { id: 'health', name: 'History Health…', run: dialog('health') },
  // Window
  ...STUDIOS.map((st, i): Command => ({ id: `studio-${st.id}`, name: st.name, shortcut: `Alt+${i + 1}`, checked: (s) => s.studioNow() === st.id, run: (s) => s.setStudio(st.id) })),
  ...PAGES.filter((p) => presents(p.id)).map((p): Command => ({ id: `page-${p.id}`, name: `Presentation: ${p.name}`, checked: (s) => s.pageNow() === p.id, run: (s) => s.setPage(p.id) })),
  ...PANEL_COMMANDS,
  { id: 'save-workspace', name: 'Save workspace', run: (s) => s.saveWorkspace() },
  { id: 'reset-workspace', name: 'Reset workspace', run: (s) => s.resetWorkspace() },
  { id: 'original-layout', name: 'Original layout', run: (s) => s.resetWorkspace(true) },
  // Help
  { id: 'getting-started', name: 'Getting started', run: dialog('getting-started') },
  { id: 'shortcuts', name: 'Keyboard shortcuts', run: dialog('shortcuts') },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
export const command = (id: string): Command => { const c = BY_ID.get(id); if (!c) throw new Error(`No command ${id}`); return c; };

/** The menus: ids of commands, '-' a line between them. */
export const MENUS: Array<{ id: string; name: string; items: string[] }> = [
  { id: 'file', name: 'File', items: ['projects', 'versions', '-', 'import-borders', 'data-export'] },
  { id: 'edit', name: 'Edit', items: ['undo', 'redo', '-', 'delete', 'merge', '-', 'settings'] },
  { id: 'view', name: 'View', items: ['show', 'compare', '-', 'guide-countries', 'guide-states'] },
  { id: 'map', name: 'Map', items: ['new-map', 'new-layer', '-', 'add-countries', 'add-cities', '-', 'label-style', 'statistics'] },
  { id: 'history', name: 'History', items: ['new-event', 'event-types', 'branches', '-', 'play', 'previous-change', 'next-change', '-', 'health'] },
  { id: 'window', name: 'Window', items: [...STUDIOS.map((st) => `studio-${st.id}`), '-', ...PAGES.filter((p) => presents(p.id)).map((p) => `page-${p.id}`), '-', ...PANEL_COMMANDS.map((c) => c.id), '-', 'save-workspace', 'reset-workspace', 'original-layout'] },
  { id: 'help', name: 'Help', items: ['getting-started', 'shortcuts'] },
];

export const canRun = (c: Command, s: AppStore = store): boolean => !c.enabled || c.enabled(s);

/** A menu's items as they stand now (those not in it now left out, and no line where nothing is either side of it). */
export function menuItems(menu: string, s: AppStore = store): MenuItem[] {
  const out: MenuItem[] = [];
  for (const id of MENUS.find((m) => m.id === menu)!.items) {
    if (id === '-') { if (out.length && out[out.length - 1] !== 'divider') out.push('divider'); continue; }
    const c = command(id);
    if (c.visible && !c.visible(s)) continue;
    out.push({ label: c.name, run: () => c.run(store), testId: `command-${c.id}`, shortcut: c.shortcut, disabled: !canRun(c, s), checked: c.checked?.(s) });
  }
  if (out[out.length - 1] === 'divider') out.pop();
  return out;
}

/** The command a key press asks for, if it can be used now. */
export function commandForKey(e: KeyLike, s: AppStore = store): Command | null {
  // (Ctrl+Shift+Z is redo too.)
  if (matches(e, 'Ctrl+Shift+Z')) return canRun(command('redo'), s) ? command('redo') : null;
  for (const c of COMMANDS) if (c.shortcut && !c.keyedElsewhere && matches(e, c.shortcut)) return canRun(c, s) ? c : null;
  return null;
}

/** Shortcuts that are not commands of the menus, for the list of shortcuts. */
export const OTHER_SHORTCUTS: Array<[string, string]> = [
  ['← →', 'The day before, the day after'],
  ['Ctrl+← →', 'A week back or on (with Shift a month, with Shift and Alt a year)'],
  ['Ctrl+F', 'Search'],
  ['Enter', 'Finish the shape or the border being drawn'],
  ['Esc', 'Cancel what is being drawn'],
  ['Backspace', 'Border pen: take back the last piece'],
  ['Wheel', 'Zoom the map or the timeline'],
  ['Double-click the timeline', 'Fit the whole history'],
];
