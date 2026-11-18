// Right-click menus: quick actions on what was clicked, or on everything chosen (Ctrl/Shift + click).
// Countries and groups: hide or show labels, pictures off or on, move to a group, delete. Events:
// delete, add to a group, go to. Every action is one undo step, however many it changes.
import { useEffect } from 'react';
import { useStore, store, type MenuItem } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { fromStore } from '../../core-time/index.ts';
import type { World } from '../../world-model/world.ts';

export function ContextMenu() {
  const s = useStore();
  const m = s.menu;
  useEffect(() => {
    if (!m) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && (e.target as HTMLElement)?.closest?.('.context-menu')) return;
      store.set({ menu: null });
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', close); window.removeEventListener('blur', close); };
  }, [m]);
  if (!m) return null;
  // Kept inside the window.
  const x = Math.min(m.x, window.innerWidth - 260), y = Math.min(m.y, window.innerHeight - 30 - m.items.length * 28);
  return (
    <div className="context-menu" style={{ left: x, top: Math.max(4, y) }} role="menu" data-testid="context-menu" onContextMenu={(e) => e.preventDefault()}>
      {m.title && <div className="menu-title">{m.title}</div>}
      {m.items.map((it, i) => it === 'divider' ? <hr key={i} />
        : 'heading' in it ? <div key={i} className="menu-heading">{it.heading}</div>
        : <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} data-testid={it.testId} onClick={() => { store.set({ menu: null }); it.run(); }}>{it.label}</button>)}
    </div>
  );
}

/** Open a menu at the pointer. */
export function openMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[], title?: string): void {
  e.preventDefault();
  store.set({ menu: { x: e.clientX, y: e.clientY, items, title } });
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** Actions for countries, factions, cities or characters (one or many). */
export function entityMenu(w: World, ids: string[]): MenuItem[] {
  const ents = ids.map((id) => w.get('entity', id)).filter((e): e is NonNullable<typeof e> => !!e);
  if (!ents.length) return [];
  const political = ents.filter((e) => e.type_id === 'polity' || e.type_id === 'faction');
  const items: MenuItem[] = [];
  if (political.length) {
    const hidden = political.filter((e) => cmd.entityStyle(e).label?.hidden).length;
    const pids = political.map((e) => e.id);
    if (hidden < political.length) items.push({ label: 'Hide labels', run: () => store.execute((wd) => cmd.setLabelsHidden(wd, pids, true)), testId: 'menu-hide-labels' });
    if (hidden > 0) items.push({ label: 'Show labels', run: () => store.execute((wd) => cmd.setLabelsHidden(wd, pids, false)), testId: 'menu-show-labels' });
    const pictured = political.filter((e) => cmd.entityStyle(e).fill?.asset);
    const off = pictured.filter((e) => cmd.entityStyle(e).fill?.off).length;
    if (pictured.length && off < pictured.length) items.push({ label: 'Use colours (pictures off)', run: () => store.execute((wd) => cmd.setFillsShown(wd, pids, false)), testId: 'menu-pictures-off' });
    if (off > 0) items.push({ label: 'Show their pictures again', run: () => store.execute((wd) => cmd.setFillsShown(wd, pids, true)), testId: 'menu-pictures-on' });
    // Locking (D87): their land and borders stay as they are until unlocked.
    const locked = political.filter((e) => cmd.isLocked(w, e.id)).length;
    if (locked < political.length) items.push({ label: 'Lock (land and borders stay as they are)', run: () => store.execute((wd) => cmd.setLocked(wd, pids, true)), testId: 'menu-lock' });
    if (locked > 0) items.push({ label: 'Unlock', run: () => store.execute((wd) => cmd.setLocked(wd, pids, false)), testId: 'menu-unlock' });
    const others = w.all('entity').filter((e) => (e.type_id === 'polity' || e.type_id === 'faction') && !pids.includes(e.id) && !cmd.isLocked(w, e.id)).map((e) => e.id);
    if (others.length) items.push({ label: `Lock all the others (${others.length})`, run: () => store.execute((wd) => cmd.setLocked(wd, others, true)), testId: 'menu-lock-others' });
  }
  const countries = ents.filter((e) => e.type_id === 'polity' || e.type_id === 'faction');
  if (countries.length >= 2) items.push({ label: `Merge into one…`, testId: 'menu-merge', run: () => store.set({ dialog: 'merge', mergeIds: countries.map((e) => e.id) }) });
  const groups = w.all('entity_group').sort((a, b) => a.sort_order - b.sort_order);
  items.push({ heading: 'Group' });
  items.push({ label: 'New group from ' + plural(ents.length, 'this', 'these') + '…', testId: 'menu-new-group', run: async () => {
    const name = await store.askText('New group', 'Name of the group (for example "My nations" or "Europe")', '', 'Create group');
    if (name) store.execute((wd) => cmd.createEntityGroup(wd, name, ents.map((e) => e.id)));
  } });
  for (const g of groups) if (ents.some((e) => e.group_id !== g.id)) items.push({ label: `Move to “${g.name}”`, run: () => store.execute((wd) => cmd.setEntitiesGroup(wd, ents.map((e) => e.id), g.id)), testId: `menu-move-${g.name}` });
  if (ents.some((e) => e.group_id)) items.push({ label: 'Take out of the group', run: () => store.execute((wd) => cmd.setEntitiesGroup(wd, ents.map((e) => e.id), '')), testId: 'menu-ungroup' });
  items.push('divider');
  items.push({ label: ents.length === 1 ? `Delete “${ents[0].name}”` : `Delete ${ents.length}`, danger: true, testId: 'menu-delete', run: () => deleteEntitiesAsked(ents.map((e) => e.id)) });
  return items;
}

export function deleteEntitiesAsked(ids: string[]): void {
  const w = store.world!;
  const names = ids.map((id) => w.get('entity', id)?.name).filter(Boolean);
  if (!names.length) return;
  const what = names.length === 1 ? `“${names[0]}”` : `these ${names.length}`;
  if (!confirm(`Delete ${what}? They are taken out of history too: land they held goes back to its previous holders. Undo brings everything back.`)) return;
  store.execute((wd) => cmd.deleteEntities(wd, ids));
  store.set({ selection: null, multi: null });
}

/** Actions for a group (folder) of the list. */
export function groupMenu(w: World, groupId: string, memberIds: string[]): MenuItem[] {
  const g = w.get('entity_group', groupId);
  if (!g) return [];
  const items: MenuItem[] = [];
  if (memberIds.length) {
    items.push({ label: `Select all ${memberIds.length}`, run: () => store.set({ multi: { kind: 'entity', ids: memberIds }, selection: { kind: 'entity', id: memberIds[0] } }), testId: 'menu-select-all' });
    // Everything the country menu offers, for the whole group.
    for (const it of entityMenu(w, memberIds)) {
      if (it !== 'divider' && 'label' in it && /^Delete|^New group|^Move to|^Take out/.test(it.label)) continue;
      if (it !== 'divider' && 'heading' in it) continue;
      if (it === 'divider') continue;
      items.push(it);
    }
  }
  items.push('divider');
  items.push({ label: 'Rename group…', testId: 'menu-rename-group', run: async () => {
    const name = await store.askText('Rename group', 'New name of the group', g.name, 'Rename');
    if (name && name !== g.name) store.execute((wd) => cmd.renameEntityGroup(wd, groupId, name));
  } });
  items.push({ label: 'Delete the group (keep what is in it)', testId: 'menu-delete-group', run: () => store.execute((wd) => cmd.deleteEntityGroup(wd, groupId)) });
  if (memberIds.length) items.push({ label: `Delete the group and the ${memberIds.length} in it`, danger: true, testId: 'menu-delete-group-all', run: () => {
    deleteEntitiesAsked(memberIds);
    if (!w.all('entity').some((e) => e.group_id === groupId)) store.execute((wd) => cmd.deleteEntityGroup(wd, groupId));
  } });
  return items;
}

/** Actions for events (one or many). */
export function eventMenu(w: World, ids: string[]): MenuItem[] {
  const evs = ids.map((id) => w.get('event', id)).filter((e): e is NonNullable<typeof e> => !!e);
  if (!evs.length) return [];
  const items: MenuItem[] = [];
  if (evs.length === 1) items.push({ label: 'Go to its date', run: () => store.set({ time: fromStore(evs[0].start_day, evs[0].start_ms), selection: { kind: 'event', id: evs[0].id }, multi: null }) });
  const groups = w.all('event_group').sort((a, b) => a.sort_order - b.sort_order);
  if (groups.length) {
    items.push({ heading: 'Event groups' });
    for (const g of groups) items.push({ label: `Add to “${g.name}”`, run: () => store.execute((wd) => cmd.addEventsToGroup(wd, evs.map((e) => e.id), g.id)) });
  }
  items.push('divider');
  items.push({ label: evs.length === 1 ? `Delete “${evs[0].name}”` : `Delete ${evs.length} events`, danger: true, testId: 'menu-delete-events', run: () => deleteEventsAsked(evs.map((e) => e.id)) });
  return items;
}

export function deleteEventsAsked(ids: string[]): void {
  const w = store.world!;
  const evs = ids.map((id) => w.get('event', id)).filter(Boolean);
  if (!evs.length) return;
  if (!confirm(evs.length === 1 ? `Delete the event “${evs[0]!.name}” and its changes? Undo brings it back.` : `Delete these ${evs.length} events and their changes? Undo brings them back.`)) return;
  store.execute((wd) => cmd.deleteEvents(wd, ids));
  store.set({ selection: null, multi: null });
}
