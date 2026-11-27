// The table of events (S6, D242): in the Timeline studio, a tab beside the timeline ("Tracks" and "Table"). The events
// of the timeline viewed, under their groups as chapters (in the groups' order; those in none last), sorted by date:
// drawn or not yet (planned), dates, name, type, groups, who they involve, their changes, the shots over them. A cell
// is changed in place (double-click a name or a date, choose a type); a row chosen is the event selected (Ctrl and
// Shift choose several); right-click as in the lists. Its tools: a new event; the dates of the chosen moved together;
// a list of events read from a CSV file (planned, nothing drawn yet) and the table written as one.
import { Fragment, useState } from 'react';
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { eventsHere } from '../events-here.ts';
import { eventVisible, sortedGroups } from '../components/EventGroups.tsx';
import { nameMatches } from '../name-match.ts';
import { calendarNow } from '../calendar-now.ts';
import { DateField } from '../inputs.tsx';
import { TypeSelect } from '../components/EventTypes.tsx';
import { openMenu, eventMenu } from '../components/ContextMenu.tsx';
import { eventFacts, changesText, involvesText, shotsOver, eventsCsv, parseEventsCsv } from '../../domain/event-table.ts';
import { fromStore, type Instant } from '../../core-time/index.ts';
import type { EventRow } from '../../world-model/schema.ts';

type Cell = { id: string; col: 'name' | 'start' | 'end' };

export function EventTablePanel() {
  const s = useStore();
  const w = s.world!;
  const [find, setFind] = useState('');
  const [editing, setEditing] = useState<Cell | null>(null);
  const [shift, setShift] = useState<{ n: string; unit: 'year' | 'month' | 'day' } | null>(null);
  const cal = calendarNow();
  const facts = eventFacts(w);
  const groups = sortedGroups(w);
  const events = eventsHere().filter((e) => eventVisible(w, e.id) && (!find.trim() || nameMatches(e.name, find)));
  // (Each event's groups found once, in the groups' order: a table of thousands draws at once.)
  const order = new Map(groups.map((g, i) => [g.id, i]));
  const member = new Map<string, string[]>();
  for (const m of w.all('event_group_member')) { const l = member.get(m.event_id); if (l) l.push(m.group_id); else member.set(m.event_id, [m.group_id]); }
  for (const l of member.values()) l.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const groupsOf = (id: string) => member.get(id) ?? [];
  // Chapters: each group's events (an event in several, under the first), then those in none.
  const chapterOf = (e: EventRow) => groupsOf(e.id)[0] ?? '';
  const chapters = [...groups.map((g) => ({ id: g.id, name: g.name, color: g.color })), { id: '', name: 'Not in a group', color: '#4f7ca8' }]
    .map((c) => ({ ...c, rows: events.filter((e) => chapterOf(e) === c.id) }))
    .filter((c) => c.rows.length);
  const ids = chapters.flatMap((c) => c.rows.map((e) => e.id));
  const chosen = new Set(s.chosen('event'));
  const date = (e: EventRow, end: boolean): Instant | null => (end ? (e.end_day !== null ? fromStore(e.end_day, e.end_ms ?? 0) : null) : fromStore(e.start_day, e.start_ms));
  const show = (t: Instant | null, e: EventRow) => (t ? cal.format(t, e.precision === 'year' ? 'year' : 'day') : '');
  const span = (rows: EventRow[]) => {
    const a = rows[0], z = rows.reduce((m, e) => { const t = date(e, true) ?? date(e, false)!; return !m || t.day > m.day ? t : m; }, null as Instant | null);
    return `${cal.format(date(a, false)!, 'year')}${z && z.day !== a.start_day ? ` to ${cal.format(z, 'year')}` : ''}`;
  };
  const save = (id: string, patch: Parameters<typeof cmd.updateEvent>[2]) => { setEditing(null); s.execute((wd) => cmd.updateEvent(wd, id, patch)); };
  const exportList = () => {
    const blob = new Blob([eventsCsv(w, events, cal, (id) => groupsOf(id).map((g) => w.get('event_group', g)?.name ?? '').filter(Boolean))], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'events.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  const importList = async (file: File | undefined) => {
    if (!file) return;
    const { events: list, errors } = parseEventsCsv(await file.text(), cal);
    if (list.length) {
      const made = s.execute((wd) => cmd.importEvents(wd, list));
      if (made) s.toast(`${made.length === 1 ? 'One event' : `${made.length} events`} added from "${file.name}", nothing drawn into ${made.length === 1 ? 'it' : 'them'} yet.`);
    }
    if (errors.length) s.toast(`${errors.length === 1 ? 'A line' : `${errors.length} lines`} of "${file.name}" could not be read: ${errors.slice(0, 2).join(' ')}${errors.length > 2 ? ' …' : ''}`, 'error');
  };
  const doShift = () => {
    if (!shift) return;
    const n = Math.round(Number(shift.n));
    if (s.execute((wd) => cmd.shiftEvents(wd, [...chosen], shift.unit, n, cal)) !== undefined || n === 0) setShift(null);
  };
  return (
    <div className="event-table-panel" data-testid="event-table">
      <div className="et-tools">
        <button className="small" onClick={() => s.set({ dialog: 'new-event' })} data-testid="et-new" title="A new event (its changes are drawn in History)">+ Event</button>
        <button className="small" disabled={!chosen.size} onClick={() => setShift(shift ? null : { n: '1', unit: 'year' })} data-testid="et-shift" title="The events chosen moved together, each keeping its length">Shift dates…</button>
        <label className="file-button small" title="A CSV file of events: Name, Starts, Ends, Type, Groups. They come in planned, with nothing drawn">Import a list
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(ev) => { void importList(ev.target.files?.[0]); ev.target.value = ''; }} data-testid="et-import" />
        </label>
        <button className="small" onClick={exportList} disabled={!events.length} data-testid="et-export" title="The events listed here as a CSV file">Export the list</button>
        <input type="search" className="et-find" placeholder="Filter by name" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFind('')} data-testid="et-filter" aria-label="Filter the table by name" />
      </div>
      {shift && (
        <div className="et-shift" data-testid="et-shift-form">
          Move the {chosen.size === 1 ? 'event chosen' : `${chosen.size} events chosen`} by
          <input type="number" step={1} value={shift.n} onChange={(e) => setShift({ ...shift, n: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && doShift()} data-testid="et-shift-n" />
          <select value={shift.unit} onChange={(e) => setShift({ ...shift, unit: e.target.value as 'year' | 'month' | 'day' })} data-testid="et-shift-unit">
            <option value="year">years</option><option value="month">months</option><option value="day">days</option>
          </select>
          <span className="muted">(less than 0: earlier)</span>
          <button className="small primary" onClick={doShift} data-testid="et-shift-apply">Move</button>
          <button className="small" onClick={() => setShift(null)}>Cancel</button>
        </div>
      )}
      <div className="et-scroll">
        <table className="et">
          <thead>
            <tr><th title="Drawn: something is drawn into it; else planned" /><th>Starts</th><th>Ends</th><th>Event</th><th>Type</th><th>Groups</th><th>Involves</th><th>Changes</th><th title="Shots showing some of its time">Shots</th></tr>
          </thead>
          <tbody>
            {chapters.map((c) => (
              <Fragment key={c.id || 'none'}>
                <tr className="et-chapter" data-testid={`et-chapter-${c.name}`}>
                  <td colSpan={9}><span className="swatch" style={{ background: c.color }} /> <b>{c.name}</b> <span className="muted">· {span(c.rows)} · {c.rows.length} event{c.rows.length === 1 ? '' : 's'}</span></td>
                </tr>
                {c.rows.map((e) => {
                  const f = facts.get(e.id);
                  const edit = (col: Cell['col']) => editing?.id === e.id && editing.col === col;
                  return (
                    <tr key={e.id} className={`${chosen.has(e.id) ? 'sel' : ''} ${e.variant_group && !e.variant_active ? 'dim' : ''}`} data-testid={`et-row-${e.name}`} data-drop={`event:${e.id}`}
                      onClick={(ev) => { if ((ev.target as HTMLElement).closest('input, select, button')) return; s.pick('event', e.id, ev, ids); if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) s.setTime(fromStore(e.start_day, e.start_ms)); }}
                      onContextMenu={(ev) => { const cur = s.chosen('event'); const sel = cur.includes(e.id) ? cur : [e.id]; if (!cur.includes(e.id)) s.pick('event', e.id, {}, ids); openMenu(ev, eventMenu(store.world!, sel), sel.length === 1 ? e.name : `${sel.length} events`); }}>
                      <td className="et-drawn">{f ? <span className="et-yes" title={`${f.drawn} change${f.drawn === 1 ? '' : 's'} drawn`}>✓</span> : <span className="et-planned" title="Planned: nothing drawn into it yet" />}</td>
                      <td className="et-date" onDoubleClick={() => setEditing({ id: e.id, col: 'start' })}>
                        {edit('start') ? <DateField value={date(e, false)} onChange={(t) => t && save(e.id, { start: t })} testId="et-edit-start" /> : show(date(e, false), e)}
                      </td>
                      <td className="et-date" onDoubleClick={() => setEditing({ id: e.id, col: 'end' })}>
                        {edit('end') ? <DateField value={date(e, true)} allowEmpty onChange={(t) => save(e.id, { end: t })} testId="et-edit-end" /> : show(date(e, true), e)}
                      </td>
                      <td className="et-name" onDoubleClick={() => setEditing({ id: e.id, col: 'name' })} title="Double-click to rename">
                        {edit('name')
                          ? <input autoFocus defaultValue={e.name} onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== e.name) save(e.id, { name: v }); else setEditing(null); }}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); else if (ev.key === 'Escape') setEditing(null); }} data-testid="et-edit-name" />
                          : e.name}
                      </td>
                      <td className="et-type"><TypeSelect value={e.type_id} onChange={(t) => s.execute((wd) => cmd.updateEvent(wd, e.id, { type_id: t }))} testId={`et-type-${e.name}`} /></td>
                      <td className="et-groups">{groupsOf(e.id).map((g) => w.get('event_group', g)?.name).filter(Boolean).join(', ')}</td>
                      <td className="et-who" title={f ? involvesText(w, f.involves, 99) : ''}>{f ? involvesText(w, f.involves) : ''}</td>
                      <td className="et-changes">{f ? changesText(f.changes) : <span className="et-todo">to draw</span>}</td>
                      <td className="et-shots">{shotsOver(w, e) || ''}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!events.length && <p className="muted pad">{find ? 'No event of that name here.' : 'No events yet. Add one, or a list of them, to plan the story; draw each in History afterwards.'}</p>}
      </div>
    </div>
  );
}
