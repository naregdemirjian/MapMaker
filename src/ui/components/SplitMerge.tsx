// Splitting a country along a line and merging countries (Stage 2, D76): the question after a split
// line is drawn and its part clicked, the "Merge into one" dialog, and the choice of when a change
// holds that both share (from the date viewed, as a correction, or in an event).
import { SmartBrushControls } from './SmartBrush.tsx';
import { useEffect, useState } from 'react';
import { useStore, type PendingEdit } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, compare, fromStore } from '../../core-time/index.ts';
import { eventsHere } from '../events-here.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { lineFromMapPoints } from '../../render-engine/stroke.ts';
import { DateField, fmt } from '../inputs.tsx';
import { TypeDot, TypeSelect } from './EventTypes.tsx';
import { defaultEnd } from '../../domain/event-types.ts';

export interface When { choice: 'change' | 'correct' | 'event'; target: string; evName: string; evType: string; end: Instant | null }

/** The choice of when a change holds, as the drawing prompt offers it. */
export function useWhen(defaultName: string, defaultType = 'general') {
  const s = useStore();
  const w = s.world!;
  const recording = s.recordEventId && w.get('event', s.recordEventId) ? s.recordEventId : null;
  return useState<When>(() => ({ choice: recording ? 'event' : 'change', target: recording ?? 'new-event', evName: defaultName, evType: defaultType, end: defaultEnd(w, defaultType, s.time) }));
}

/** The edit mode (and the event to make, if any) for a choice of when. */
export function modeOf(when: When, t: Instant, world: ReturnType<typeof useStore>['world']): { mode: cmd.EditMode; newEvent?: cmd.EventInput } {
  if (when.choice === 'change') return { mode: { kind: 'change', t } };
  if (when.choice === 'correct') return { mode: { kind: 'correct', t } };
  if (when.target === 'new-event') return { mode: { kind: 'change', t }, newEvent: { name: when.evName, type_id: when.evType, start: t, end: when.end } };
  const ev = world!.get('event', when.target);
  const start = ev ? fromStore(ev.start_day, ev.start_ms) : t;
  return { mode: { kind: 'new', eventId: when.target, at: compare(t, start) > 0 ? t : null } };
}

export function WhenChooser({ when, setWhen }: { when: When; setWhen: (w: When) => void }) {
  const s = useStore();
  const w = s.world!;
  const events = eventsHere();
  const set = (patch: Partial<When>) => setWhen({ ...when, ...patch });
  return <>
    <div className={`choice ${when.choice === 'change' ? 'on' : ''}`} onClick={() => set({ choice: 'change' })} data-testid="when-change">
      <b>From {fmt(s.time)} on</b>
      <div className="muted">A change without an event; earlier dates stay as they are.</div>
    </div>
    <div className={`choice ${when.choice === 'correct' ? 'on' : ''}`} onClick={() => set({ choice: 'correct' })} data-testid="when-correct">
      <b>Correct this period</b>
      <div className="muted">As if it had always been so in the period around {fmt(s.time)} (on the starting map, from the beginning).</div>
    </div>
    <div className={`choice ${when.choice === 'event' ? 'on' : ''}`} onClick={() => set({ choice: 'event' })} data-testid="when-event">
      <b>In an event</b>
      {when.choice === 'event' && (
        <div className="choice-body" onClick={(ev) => ev.stopPropagation()}>
          <label>Event
            <select value={when.target} onChange={(ev) => set({ target: ev.target.value })} data-testid="when-event-target">
              <option value="new-event">A new event from {fmt(s.time)}…</option>
              {events.map((x) => <option key={x.id} value={x.id}>{fmt(fromStore(x.start_day, x.start_ms))} · {x.name}</option>)}
            </select>
          </label>
          {when.target === 'new-event' && <>
            <label>Event name<input value={when.evName} onChange={(ev) => set({ evName: ev.target.value })} data-testid="when-event-name" /></label>
            <label>Type<span className="row-inline"><TypeDot typeId={when.evType} /><TypeSelect value={when.evType} onChange={(t) => set({ evType: t, end: defaultEnd(w, t, s.time) ?? when.end })} /></span></label>
            <label>Ends (optional)<DateField value={when.end} allowEmpty suggest={s.time} onChange={(t) => set({ end: t })} /></label>
          </>}
        </div>
      )}
    </div>
  </>;
}

/** Enter or Space applies, Escape closes (not while typing in a text box or choosing in a list). */
export function useKeys(confirm: () => void, close: () => void) {
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      // Enter or Space applies (Space only while not typing in a field).
      const tag = (ev.target as HTMLElement)?.tagName;
      const space = ev.key === ' ' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT';
      if (!space && (ev.key !== 'Enter' || ev.shiftKey)) return;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      ev.preventDefault();
      confirm();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
}

export function Frame({ title, testId, onClose, children }: { title: string; testId: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} data-testid={testId}>
        <div className="modal-head"><h2>{title}</h2><button className="close" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}

export const countriesOf = (w: NonNullable<ReturnType<typeof useStore>['world']>) => w.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));

/** Which way the clicked part lies from the line ("North", "East"…), for the new country's name:
 * from the nearest point of the line to the click (longitudes scaled to the latitude). */
function sideOf(line: Array<[number, number]>, pick: [number, number]): string {
  const k = Math.cos((pick[1] * Math.PI) / 180);
  const xy = (q: [number, number]): [number, number] => [(((q[0] - pick[0] + 540) % 360) - 180) * k, q[1] - pick[1]];
  let best: [number, number] = xy(line[0]), bd = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = xy(line[i]), b = xy(line[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L)) : 0;
    const q: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const d = q[0] * q[0] + q[1] * q[1];
    if (d < bd) { bd = d; best = q; }
  }
  // (The click seen from the line: the opposite of the line seen from the click.)
  const ex = -best[0], ey = -best[1];
  return Math.abs(ey) >= Math.abs(ex) ? (ey > 0 ? 'North' : 'South') : ex > 0 ? 'East' : 'West';
}

export function SplitPrompt({ p }: { p: Extract<PendingEdit, { kind: 'split' }> }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const country = e.valueAtPoint(p.spaceId, p.layerId, lonLatToVec(p.pick[0], p.pick[1]), s.time);
  const name = country ? w.get('entity', country)?.name ?? 'the country' : null;
  const [to, setTo] = useState('new');
  const [newName, setNewName] = useState(name ? `${sideOf(p.line, p.pick)} ${name}` : '');
  const [when, setWhen] = useWhen(name ? `Partition of ${name}` : 'Partition');
  const close = () => s.set({ pending: null });
  const confirm = () => {
    if (!country) { close(); return; }
    const { mode, newEvent } = modeOf(when, s.time, w);
    const line = lineFromMapPoints(p.line);
    if (!line) { s.toast('Draw a longer line.', 'error'); return; }
    const r = s.execute((wd, en) => cmd.splitTerritory(wd, en, { spaceId: p.spaceId, layerId: p.layerId, line, pick: lonLatToVec(p.pick[0], p.pick[1]), t: s.time, snap: p.snap, to: to === 'new' ? { name: newName } : to, mode, newEvent }));
    if (r) {
      s.set({ pending: null, splitLine: null, selection: { kind: 'entity', id: r.owner }, lastPaintEvent: r.eventId ?? s.lastPaintEvent });
      s.toast(`Split: the part went to ${w.get('entity', r.owner)?.name ?? 'its new owner'}.`);
    }
  };
  useKeys(confirm, close);
  if (!country) return <Frame title="Split a country" testId="split-prompt" onClose={close}><p className="muted">Nobody holds the place you clicked on {fmt(s.time)}. Click the part of a country that changes hands.</p><div className="modal-actions"><button onClick={close}>Close</button></div></Frame>;
  return (
    <Frame title={`Split ${name}`} testId="split-prompt" onClose={close}>
      <p className="muted">The line becomes a border. The part you clicked goes to:</p>
      <label>
        <select value={to} onChange={(ev) => setTo(ev.target.value)} data-testid="split-to">
          <option value="new">A new country…</option>
          {countriesOf(w).filter((x) => x.id !== country).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      {to === 'new' && <label>Name of the new country<input autoFocus value={newName} onChange={(ev) => setNewName(ev.target.value)} data-testid="split-new-name" /></label>}
      <h4>When</h4>
      <WhenChooser when={when} setWhen={setWhen} />
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={confirm} data-testid="confirm-split">Split <span className="key">Enter</span></button></div>
    </Frame>
  );
}

export function MergeDialog() {
  const s = useStore();
  const w = s.world!;
  const ids = s.mergeIds.filter((id) => w.get('entity', id));
  const names = ids.map((id) => w.get('entity', id)!.name);
  // Into the largest of them by default (the one holding most land at the date viewed).
  const [into, setInto] = useState(() => {
    if (!s.engine || !s.layerId) return ids[0] ?? 'new';
    const area = new Map<string, number>();
    const arr = w.arrangement(s.spaceId);
    for (const [f, st] of s.engine.partitionState(s.spaceId, s.layerId, s.time)) if (st.value && ids.includes(st.value)) area.set(st.value, (area.get(st.value) ?? 0) + arr.faceArea(f));
    return [...ids].sort((a, b) => (area.get(b) ?? 0) - (area.get(a) ?? 0))[0] ?? 'new';
  });
  const [newName, setNewName] = useState(names.length === 2 ? `Union of ${names[0]} and ${names[1]}` : 'Union');
  const [when, setWhen] = useWhen(`Union of ${names.join(', ')}`);
  const close = () => s.set({ dialog: null });
  const confirm = () => {
    if (!s.layerId) { s.toast('This map has no political layer.', 'error'); return; }
    const { mode, newEvent } = modeOf(when, s.time, w);
    const r = s.execute((wd, en) => cmd.mergeTerritory(wd, en, { spaceId: s.spaceId, layerId: s.layerId!, ids, into: into === 'new' ? { name: newName } : into, t: s.time, mode, newEvent }));
    if (r) {
      s.set({ dialog: null, selection: { kind: 'entity', id: r.owner }, multi: null });
      s.toast(`Merged into ${w.get('entity', r.owner)?.name ?? 'one country'}.`);
    }
  };
  useKeys(confirm, close);
  return (
    <Frame title="Merge into one country" testId="merge-dialog" onClose={close}>
      <p className="muted">All the land of {names.join(', ')} on {fmt(s.time)} goes to:</p>
      <label>
        <select value={into} onChange={(ev) => setInto(ev.target.value)} data-testid="merge-into">
          {ids.map((id) => <option key={id} value={id}>{w.get('entity', id)!.name}</option>)}
          <option value="new">A new country…</option>
        </select>
      </label>
      {into === 'new' && <label>Name of the new country<input autoFocus value={newName} onChange={(ev) => setNewName(ev.target.value)} data-testid="merge-new-name" /></label>}
      <p className="muted small-note">The others keep their names and history; from then on they hold no land on this map.</p>
      <h4>When</h4>
      <WhenChooser when={when} setWhen={setWhen} />
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={confirm} data-testid="confirm-merge">Merge <span className="key">Enter</span></button></div>
    </Frame>
  );
}

/** Under the toolbar while splitting: what to do next. */
export function SplitToolOptions() {
  const s = useStore();
  return (
    <div className="toolbar sub" data-testid="split-options">
      {s.splitLine
        ? <><span className="muted">Now click the part that changes hands.</span><button className="small" onClick={() => s.set({ splitLine: null })} data-testid="split-again">Draw the line again <span className="key">Esc</span></button></>
        : <span className="muted">Drag a line right across a country (from outside it to outside it, or from border to border).</span>}
      <SmartBrushControls />
    </div>
  );
}
