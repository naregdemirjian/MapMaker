// Event groups in the interface (DECISIONS D8): the timeline's group filter (where groups are also
// created, renamed, recoloured and deleted) and the group checkboxes of an event.
import { useState } from 'react';
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import type { World } from '../../world-model/world.ts';

export const sortedGroups = (w: World) => w.all('event_group').sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

/** The groups the filter shows, as a set (null: every event). */
export function eventFilterSet(): Set<string> | null {
  return store.eventFilter ? new Set(store.eventFilter) : null;
}

/** Events shown under the current group filter. */
export function eventVisible(w: World, eventId: string): boolean {
  return cmd.eventShown(w, eventId, eventFilterSet());
}

export function GroupFilter() {
  const s = useStore();
  const w = s.world!;
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const groups = sortedGroups(w);
  const all = [...groups.map((g) => g.id), cmd.UNGROUPED];
  const chosen = new Set(s.eventFilter ?? all);
  const toggle = (id: string, on: boolean) => {
    const next = all.filter((g) => (g === id ? on : chosen.has(g)));
    s.set({ eventFilter: next.length === all.length ? null : next });
  };
  const create = () => {
    if (!newName.trim()) return;
    const id = s.execute((wd) => cmd.createEventGroup(wd, newName));
    if (id) { setNewName(''); if (s.eventFilter) s.set({ eventFilter: [...s.eventFilter, id] }); }
  };
  const summary = !s.eventFilter ? 'All events' : `${s.eventFilter.length} of ${all.length} groups`;
  return (
    <div className={`group-filter ${open ? 'open' : ''}`} data-testid="group-filter">
      <button className={`small ${s.eventFilter ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Choose which groups of events the timeline shows" data-testid="group-filter-button">
        Groups: {summary} ▾
      </button>
      {open && (
        <div className="group-popover" onPointerDown={(e) => e.stopPropagation()}>
          <div className="group-actions">
            <button className="small" onClick={() => s.set({ eventFilter: null })}>Show all</button>
            <button className="small" onClick={() => s.set({ eventFilter: [] })}>Show none</button>
            <button className="small close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          {groups.map((g) => (
            <div key={g.id} className="group-row">
              <label className="check">
                <input type="checkbox" checked={chosen.has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} data-testid={`group-show-${g.name}`} />
                <span className="swatch" style={{ background: g.color }} />{g.name}
              </label>
              <span className="muted">{w.all('event_group_member').filter((m) => m.group_id === g.id).length}</span>
              <input type="color" value={g.color} title="Colour" onChange={(e) => s.execute((wd) => cmd.updateEventGroup(wd, g.id, { color: e.target.value }))} />
              <button className="small" title="Rename" onClick={async () => { const n = await s.askText('Rename group', 'New name of the group', g.name, 'Rename'); if (n && n !== g.name) s.execute((wd) => cmd.updateEventGroup(wd, g.id, { name: n })); }}>Rename</button>
              <button className="small danger" title="Delete the group (its events stay)" onClick={() => {
                if (!confirm(`Delete the group "${g.name}"? Its events stay; they only leave the group.`)) return;
                s.execute((wd) => cmd.deleteEventGroup(wd, g.id));
                if (s.eventFilter) s.set({ eventFilter: s.eventFilter.filter((x) => x !== g.id) });
              }}>Delete</button>
            </div>
          ))}
          <div className="group-row">
            <label className="check">
              <input type="checkbox" checked={chosen.has(cmd.UNGROUPED)} onChange={(e) => toggle(cmd.UNGROUPED, e.target.checked)} data-testid="group-show-ungrouped" />
              <span className="swatch" style={{ background: '#4f7ca8' }} />Not in a group
            </label>
          </div>
          <div className="group-new">
            <input placeholder="New group, e.g. a country, a war or a region" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} data-testid="new-group-name" />
            <button className="small" onClick={create} data-testid="new-group-create">Add</button>
          </div>
          <p className="muted">The filter only changes which events are listed; the map always shows the full history.</p>
        </div>
      )}
    </div>
  );
}

/** Group checkboxes: for an existing event (saved at once) or a new one (value and onChange). */
export function GroupChecks({ eventId, value, onChange }: { eventId?: string; value?: string[]; onChange?: (ids: string[]) => void }) {
  const s = useStore();
  const w = s.world!;
  const groups = sortedGroups(w);
  const current = eventId ? cmd.groupsOfEvent(w, eventId) : value ?? [];
  const set = (ids: string[]) => {
    if (eventId) s.execute((wd) => cmd.setEventGroups(wd, eventId, ids));
    else onChange?.(ids);
  };
  if (!groups.length) return <div className="muted">No groups yet. Make them with “Groups” on the timeline.</div>;
  return (
    <div className="group-checks" data-testid="event-groups">
      {groups.map((g) => (
        <label key={g.id} className="check">
          <input type="checkbox" checked={current.includes(g.id)} data-testid={`event-group-${g.name}`}
            onChange={(e) => set(e.target.checked ? [...current, g.id] : current.filter((x) => x !== g.id))} />
          <span className="swatch" style={{ background: g.color }} />{g.name}
        </label>
      ))}
    </div>
  );
}
