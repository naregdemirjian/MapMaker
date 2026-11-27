// The Timeline studio's own panels (S6, D241): Groups, Types, Branches and Statistics, as tabs under the small map at
// its left. Groups: each group of events a track of the timeline; shown or not (the timeline's and the lists' filter),
// its colour, its name, its place among the tracks, a new one. The others hold what were dialogs (event types,
// branches, a map's statistics), which open in the studios without these panels.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { isBaseEvent } from '../../world-model/schema.ts';
import { sortedGroups } from '../components/EventGroups.tsx';
import { EventTypesBody } from '../components/EventTypes.tsx';
import { BranchesBody } from '../components/Branches.tsx';
import { StatisticsBody } from '../components/StatisticsDialog.tsx';

/** The groups of events (D8, D201): which the timeline shows, their colours, names and order; a new one. */
export function GroupsPanel() {
  const s = useStore();
  const w = s.world!;
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const groups = sortedGroups(w);
  const all = [...groups.map((g) => g.id), cmd.UNGROUPED];
  const chosen = new Set(s.eventFilter ?? all);
  const toggle = (id: string, on: boolean) => {
    const next = all.filter((g) => (g === id ? on : chosen.has(g)));
    s.set({ eventFilter: next.length === all.length ? null : next });
  };
  const counts = new Map<string, number>();
  for (const m of w.all('event_group_member')) counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);
  const grouped = new Set(w.all('event_group_member').map((m) => m.event_id));
  const loose = w.all('event').filter((e) => !grouped.has(e.id) && !isBaseEvent(e.id)).length;
  const move = (i: number, by: number) => {
    const ids = groups.map((g) => g.id), j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    s.execute((wd) => cmd.orderEventGroups(wd, ids));
  };
  const rename = (id: string, name: string) => {
    setRenaming(null);
    const g = w.get('event_group', id);
    if (g && name.trim() && name.trim() !== g.name) s.execute((wd) => cmd.updateEventGroup(wd, id, { name: name.trim() }));
  };
  const create = () => {
    if (!newName.trim()) return;
    const id = s.execute((wd) => cmd.createEventGroup(wd, newName));
    if (id) { setNewName(''); if (s.eventFilter) s.set({ eventFilter: [...s.eventFilter, id] }); }
  };
  return (
    <div className="panel groups-panel" data-testid="groups-panel">
      <div className="gp-head">
        <span className="muted">Each group a track of the timeline</span>
        <span className="row-tools">
          <button className="small" onClick={() => s.set({ eventFilter: null })} disabled={!s.eventFilter} title="Every group shown">All</button>
          <button className="small" onClick={() => s.set({ eventFilter: [] })} title="No group shown">None</button>
        </span>
      </div>
      {groups.map((g, i) => (
        <div key={g.id} className={`gp-row ${chosen.has(g.id) ? '' : 'off'}`} data-testid={`gp-row-${g.name}`}>
          <input type="checkbox" checked={chosen.has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} title="Shown on the timeline and in the lists" data-testid={`gp-show-${g.name}`} />
          <input type="color" value={g.color} onChange={(e) => s.execute((wd) => cmd.updateEventGroup(wd, g.id, { color: e.target.value }))} title="Its colour" data-testid={`gp-color-${g.name}`} />
          {renaming === g.id
            ? <input className="gp-rename" autoFocus defaultValue={g.name} onBlur={(e) => rename(g.id, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setRenaming(null); }} data-testid="gp-rename" />
            : <span className="gp-name" onDoubleClick={() => setRenaming(g.id)} title="Double-click to rename">{g.name}</span>}
          <span className="muted gp-count" title="Its events">{counts.get(g.id) ?? 0}</span>
          <span className="row-tools">
            <button className="small" disabled={i === 0} onClick={() => move(i, -1)} title="Its track higher on the timeline">↑</button>
            <button className="small" disabled={i === groups.length - 1} onClick={() => move(i, 1)} title="Its track lower on the timeline">↓</button>
            <button className="small" onClick={() => setRenaming(g.id)} title="Rename" data-testid={`gp-rename-${g.name}`}>✎</button>
            <button className="small danger" onClick={() => {
              s.execute((wd) => cmd.deleteEventGroup(wd, g.id));
              if (s.eventFilter) s.set({ eventFilter: s.eventFilter.filter((x) => x !== g.id) });
              s.toast(`The group "${g.name}" deleted: its events stay (Undo brings it back).`);
            }} title="Delete the group (its events stay)" data-testid={`gp-delete-${g.name}`}>✕</button>
          </span>
        </div>
      ))}
      <div className={`gp-row ${chosen.has(cmd.UNGROUPED) ? '' : 'off'}`} data-testid="gp-row-ungrouped">
        <input type="checkbox" checked={chosen.has(cmd.UNGROUPED)} onChange={(e) => toggle(cmd.UNGROUPED, e.target.checked)} title="Events in no group, shown or not" data-testid="gp-show-ungrouped" />
        <span className="swatch" style={{ background: '#4f7ca8' }} />
        <span className="gp-name muted">Not in a group</span>
        <span className="muted gp-count">{loose}</span>
      </div>
      <div className="group-new">
        <input placeholder="New group: a war, a dynasty, a region" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} data-testid="gp-new-name" />
        <button className="small" onClick={create} disabled={!newName.trim()} data-testid="gp-new-create">+ Group</button>
      </div>
      <p className="muted small-text">A group hidden leaves the timeline and the lists; the map always shows the whole history.</p>
    </div>
  );
}

/** Event types (D75): each type's colour, name, how territory drawn into its events spreads, how long a new one lasts. */
export function TypesPanel() {
  return <div className="panel types-panel" data-testid="types-panel"><EventTypesBody compact /></div>;
}

/** Branches (D150): the timeline viewed, branches made from the date viewed, changed and deleted. */
export function BranchesPanel() {
  return <div className="panel branches-panel" data-testid="branches-panel"><BranchesBody /></div>;
}

/** The map's statistics (D171): numbers kept over time, shown in shots by name. */
export function StatisticsPanel() {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  if (!space) return <div className="panel muted">No map.</div>;
  // (Keyed by the map: another map viewed, its own statistics.)
  return <div className="panel statistics-panel" data-testid="statistics-panel"><StatisticsBody key={space.id} /></div>;
}
