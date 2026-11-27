// The outline of events (S6, D247): in the Timeline studio, a tab beside the timeline and the table ("Tracks", "Table",
// "Outline"). The events of the timeline viewed as a tree, chapter by chapter (their groups, in the groups' order;
// those in none last): each under the shortest longer event of its chapter that holds it (a battle in a campaign in a
// war), in order of their start; drawn or planned. A row chosen is the event selected (Ctrl and Shift choose
// several) and the date goes to its start; a twisty, or the arrow keys, fold and open; the up and down arrows move
// along; a double-click renames; right-click as in the lists; a filter by name keeps the events it finds and those
// holding them.
import { Fragment, useMemo, useRef, useState } from 'react';
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { eventsHere } from '../events-here.ts';
import { eventVisible, sortedGroups } from '../components/EventGroups.tsx';
import { nameMatches } from '../name-match.ts';
import { calendarNow } from '../calendar-now.ts';
import { openMenu, eventMenu } from '../components/ContextMenu.tsx';
import { eventFacts } from '../../domain/event-table.ts';
import { outline, heldCount, visibleRows, parentOf, type OutlineNode } from '../../domain/event-outline.ts';
import { fromStore, MS_PER_DAY } from '../../core-time/index.ts';
import type { EventRow } from '../../world-model/schema.ts';

const fold = (id: string) => `ol:${id}`;

export function EventOutlinePanel() {
  const s = useStore();
  const w = s.world!;
  const cal = calendarNow();
  const [find, setFind] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const drawn = eventFacts(w);
  const groups = sortedGroups(w);
  const events = eventsHere().filter((e) => eventVisible(w, e.id));
  const byId = new Map(events.map((e) => [e.id, e]));
  // (Each event in the chapter of the first of its groups, in the groups' order.)
  const order = new Map(groups.map((g, i) => [g.id, i]));
  const first = new Map<string, string>();
  for (const m of w.all('event_group_member')) {
    const cur = first.get(m.event_id);
    if (order.has(m.group_id) && (cur === undefined || order.get(m.group_id)! < order.get(cur)!)) first.set(m.event_id, m.group_id);
  }
  const day = (d: number, ms: number) => d + ms / MS_PER_DAY;
  const key = [w.serial, w.tableRevision('event'), w.tableRevision('event_group'), w.tableRevision('event_group_member'), s.branch, s.eventFilter?.join(',') ?? '*'].join('|');
  const chapters = useMemo(() => [...groups.map((g) => ({ id: g.id, name: g.name, color: g.color })), { id: '', name: 'Not in a group', color: '#4f7ca8' }]
    .map((c) => {
      const mine = events.filter((e) => (first.get(e.id) ?? '') === c.id);
      return { ...c, count: mine.length, roots: outline(mine.map((e) => ({ id: e.id, name: e.name, start: day(e.start_day, e.start_ms), end: e.end_day !== null ? day(e.end_day, e.end_ms ?? 0) : null }))) };
    })
    .filter((c) => c.count),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [key]);
  const folded = (id: string) => s.collapsed.includes(fold(id));
  const keep = find.trim() ? (id: string) => nameMatches(byId.get(id)?.name ?? '', find) : undefined;
  const shown = chapters.map((c) => ({ ...c, rows: visibleRows(c.roots, folded, keep) }));
  const rows = shown.flatMap((c) => c.rows);
  const ids = rows.map((n) => n.id);
  const chosen = new Set(s.chosen('event'));
  const allNodes = chapters.flatMap((c) => c.roots);
  const setFolded = (id: string, on: boolean) => { if (folded(id) !== on) store.toggleCollapsed(fold(id)); };
  const choose = (e: EventRow, ev: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    s.pick('event', e.id, ev, ids);
    if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) s.setTime(fromStore(e.start_day, e.start_ms));
  };
  const date = (e: EventRow) => {
    const prec = e.precision === 'year' ? 'year' : 'day';
    const a = cal.format(fromStore(e.start_day, e.start_ms), prec);
    return e.end_day !== null ? `${a} to ${cal.format(fromStore(e.end_day, e.end_ms ?? 0), prec)}` : a;
  };
  /** The arrow keys (D247): up and down along the rows; right opens (or goes into), left folds (or goes up). */
  const onKey = (k: React.KeyboardEvent) => {
    if ((k.target as HTMLElement).tagName === 'INPUT') return;
    const cur = s.selection?.kind === 'event' ? s.selection.id : null;
    const i = cur ? ids.indexOf(cur) : -1;
    const node = i >= 0 ? rows[i] : null;
    const go = (id: string | undefined) => { const e = id ? byId.get(id) : undefined; if (e) { k.preventDefault(); choose(e, {}); box.current?.querySelector(`[data-ol="${id}"]`)?.scrollIntoView({ block: 'nearest' }); } };
    if (k.key === 'ArrowDown') go(ids[Math.min(ids.length - 1, i + 1)] ?? ids[0]);
    else if (k.key === 'ArrowUp') go(ids[Math.max(0, i - 1)]);
    else if (k.key === 'ArrowRight' && node) { k.preventDefault(); if (node.kids.length && folded(node.id)) setFolded(node.id, false); else if (node.kids.length) go(node.kids[0].id); }
    else if (k.key === 'ArrowLeft' && node) { k.preventDefault(); if (node.kids.length && !folded(node.id)) setFolded(node.id, true); else go(parentOf(allNodes, node.id)?.id); }
  };
  const rename = (e: EventRow, v: string) => { setRenaming(null); const name = v.trim(); if (name && name !== e.name) s.execute((wd) => cmd.updateEvent(wd, e.id, { name })); };
  const all = (on: boolean) => {
    const every = allNodes.flatMap(function walk(n: OutlineNode): OutlineNode[] { return [n, ...n.kids.flatMap(walk)]; }).filter((n) => n.kids.length).map((n) => fold(n.id));
    const rest = s.collapsed.filter((k) => !every.includes(k));
    store.set({ collapsed: on ? [...rest, ...every] : rest });
  };
  return (
    <div className="event-outline-panel" data-testid="outline" ref={box} tabIndex={0} onKeyDown={onKey}>
      <div className="et-tools">
        <button className="small" onClick={() => s.set({ dialog: 'new-event' })} data-testid="ol-new" title="A new event (its changes are drawn in History)">+ Event</button>
        <button className="small" onClick={() => all(false)} data-testid="ol-open-all" title="Every event opened, showing those it holds">Open all</button>
        <button className="small" onClick={() => all(true)} data-testid="ol-fold-all" title="Every event folded over those it holds">Fold all</button>
        <input type="search" className="et-find" placeholder="Filter by name" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFind('')} data-testid="ol-filter" aria-label="Filter the outline by name" />
      </div>
      <div className="ol-scroll">
        {shown.map((c) => (
          <Fragment key={c.id || 'none'}>
            <div className="ol-chapter" data-testid={`ol-chapter-${c.name}`}>
              <span className="swatch" style={{ background: c.color }} /> <b>{c.name}</b> <span className="muted">· {c.count} event{c.count === 1 ? '' : 's'}</span>
            </div>
            {c.rows.map((n) => {
              const e = byId.get(n.id)!;
              const held = n.kids.length ? heldCount(n) : 0;
              const open = !!keep || !folded(n.id);
              return (
                <div key={n.id} className={`ol-row ${chosen.has(n.id) ? 'sel' : ''} ${e.variant_group && !e.variant_active ? 'dim' : ''}`} style={{ paddingLeft: 8 + n.depth * 18 }} data-ol={n.id} data-testid={`ol-row-${e.name}`} data-depth={n.depth} data-drop={`event:${e.id}`}
                  onClick={(ev) => { if ((ev.target as HTMLElement).closest('input, button')) return; choose(e, ev); box.current?.focus(); }}
                  onDoubleClick={(ev) => { if (!(ev.target as HTMLElement).closest('button')) setRenaming(e.id); }}
                  onContextMenu={(ev) => { const cur = s.chosen('event'); const sel = cur.includes(e.id) ? cur : [e.id]; if (!cur.includes(e.id)) s.pick('event', e.id, {}, ids); openMenu(ev, eventMenu(store.world!, sel), sel.length === 1 ? e.name : `${sel.length} events`); }}>
                  {held
                    ? <button className="ol-twisty" aria-expanded={open} aria-label={open ? `Fold ${e.name}` : `Open ${e.name}`} onClick={() => setFolded(n.id, open)} data-testid={`ol-twisty-${e.name}`}>{open ? '▾' : '▸'}</button>
                    : <span className="ol-twisty" />}
                  {drawn.has(e.id) ? <span className="et-yes" title="Something is drawn into it">✓</span> : <span className="et-planned" title="Planned: nothing drawn into it yet" />}
                  {renaming === e.id
                    ? <input autoFocus defaultValue={e.name} onBlur={(ev) => rename(e, ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); else if (ev.key === 'Escape') setRenaming(null); }} data-testid="ol-rename" />
                    : <span className="ol-name">{e.name}</span>}
                  <span className="ol-date muted">{date(e)}</span>
                  {held > 0 && !open && <span className="ol-held muted" data-testid={`ol-held-${e.name}`}>{held} within</span>}
                </div>
              );
            })}
          </Fragment>
        ))}
        {!rows.length && <p className="muted pad">{find ? 'No event of that name here.' : 'No events yet. Add one, or a list of them in the Table, to plan the story.'}</p>}
      </div>
    </div>
  );
}
