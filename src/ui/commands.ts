// Every command of the interface in one list (D197): its name, its shortcut, when it can be used, what it
// does. The menu bar is drawn from it, the keyboard runs it, and the list of shortcuts is read from it, so a
// command has one home and one description.
import { store, type AppStore, type MenuItem, type DialogName } from './store.ts';
import { WORKSPACES, type Side } from './shell/layout.ts';
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

const panel = (side: Side, name: string): Command => ({ id: `panel-${side}`, name, checked: (s) => !s.layouts[s.workspaceNow()].hidden.includes(side), run: (s) => s.togglePanel(side) });

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
  panel('left', 'Lists at the left'),
  panel('right', 'Panel at the right'),
  panel('bottom', 'Timeline'),
  // Map
  { id: 'new-map', name: 'New map…', enabled: world, run: dialog('new-world') },
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
  ...WORKSPACES.map((w, i): Command => ({ id: `workspace-${w.id}`, name: w.name, shortcut: `Alt+${i + 1}`, checked: (s) => s.workspaceNow() === w.id, run: (s) => s.setWorkspace(w.id) })),
  { id: 'reset-workspace', name: 'Reset this workspace', run: (s) => s.setLayout(null) },
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
  { id: 'view', name: 'View', items: ['show', 'compare', '-', 'guide-countries', 'guide-states', '-', 'panel-left', 'panel-right', 'panel-bottom'] },
  { id: 'map', name: 'Map', items: ['new-map', 'new-layer', '-', 'add-countries', 'add-cities', '-', 'label-style', 'statistics'] },
  { id: 'history', name: 'History', items: ['new-event', 'event-types', 'branches', '-', 'play', 'previous-change', 'next-change', '-', 'health'] },
  { id: 'window', name: 'Window', items: [...WORKSPACES.map((w) => `workspace-${w.id}`), '-', 'reset-workspace'] },
  { id: 'help', name: 'Help', items: ['getting-started', 'shortcuts'] },
];

export const canRun = (c: Command, s: AppStore = store): boolean => !c.enabled || c.enabled(s);

/** A menu's items as they stand now. */
export function menuItems(menu: string, s: AppStore = store): MenuItem[] {
  return MENUS.find((m) => m.id === menu)!.items.map((id): MenuItem => {
    if (id === '-') return 'divider';
    const c = command(id);
    return { label: c.name, run: () => c.run(store), testId: `command-${c.id}`, shortcut: c.shortcut, disabled: !canRun(c, s), checked: c.checked?.(s) };
  });
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
