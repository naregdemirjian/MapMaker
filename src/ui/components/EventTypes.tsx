// Event types in the interface (Stage 3, D75): the "Event types" dialog (make, copy, rename, colour,
// default spreading and length, delete), the type chooser used for events, and the type's colour dot.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as types from '../../domain/event-types.ts';

/** The colour of a type as a small square (nothing when the type has no colour of its own). */
export function TypeDot({ typeId }: { typeId: string }) {
  const s = useStore();
  const c = s.world ? types.typeColor(s.world, typeId) : undefined;
  return c ? <span className="swatch" style={{ background: c }} title={s.world!.get('event_type', typeId)?.name} /> : null;
}

/** Choosing an event's type. */
export function TypeSelect({ value, onChange, testId }: { value: string; onChange: (id: string) => void; testId?: string }) {
  const s = useStore();
  const list = types.eventTypes(s.world!);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      {!list.some((t) => t.id === value) && <option value={value}>Event</option>}
    </select>
  );
}

function LengthField({ value, onChange, testId }: { value: types.EventLength | null | undefined; onChange: (v: types.EventLength | null) => void; testId: string }) {
  const [n, setN] = useState(value ? String(value.n) : '');
  const unit = value?.unit ?? 'year';
  const commit = (text: string, u: types.LengthUnit) => {
    const k = Number(text);
    onChange(text.trim() && k > 0 ? { n: Math.round(k), unit: u } : null);
  };
  return (
    <span className="type-length">
      <input type="number" min={1} placeholder="–" title="Empty: a new event of the type happens at once" value={n} onChange={(e) => { setN(e.target.value); if (!(e.nativeEvent as Event & { inputType?: string }).inputType) commit(e.target.value, unit); }} onBlur={() => commit(n, unit)} onKeyDown={(e) => e.key === 'Enter' && commit(n, unit)} data-testid={`${testId}-n`} />
      <select value={unit} onChange={(e) => commit(n, e.target.value as types.LengthUnit)} data-testid={`${testId}-unit`}>
        <option value="day">days</option><option value="month">months</option><option value="year">years</option>
      </select>
    </span>
  );
}

export function EventTypesDialog() {
  const s = useStore();
  const w = s.world!;
  const [newName, setNewName] = useState('');
  const close = () => s.set({ dialog: null });
  const counts = types.eventsByType(w);
  const create = () => {
    if (!newName.trim()) return;
    if (s.execute((wd) => types.createEventType(wd, newName))) setNewName('');
  };
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal wide types" role="dialog" aria-label="Event types" data-testid="event-types-dialog">
        <div className="modal-head"><h2>Event types</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">A type is a template for its events: their colour on the timeline and in the lists, how the
          territory drawn into them spreads, and how long a new one lasts (you can still change each event).</p>
        <div className="type-table">
          <div className="type-row head"><span>Colour</span><span>Name</span><span>Territory drawn into it spreads</span><span>A new one lasts</span><span>Events</span><span /></div>
          {types.eventTypes(w).map((t) => {
            const st = types.typeSettings(t);
            const fixed = types.FIXED_TYPES.has(t.id);
            const n = counts.get(t.id) ?? 0;
            return (
              <div key={t.id} className="type-row" data-testid={`type-row-${t.name}`}>
                <span className="type-color">
                  <input type="color" value={st.color ?? '#4f7ca8'} title="Colour on the timeline and in the lists" onChange={(e) => s.execute((wd) => types.updateEventType(wd, t.id, { color: e.target.value }))} data-testid={`type-color-${t.name}`} />
                  {st.color && <button className="small link" title="Back to the usual blue" onClick={() => s.execute((wd) => types.updateEventType(wd, t.id, { color: null }))}>×</button>}
                </span>
                <input key={t.name} defaultValue={t.name} onBlur={(e) => { const v = e.target.value; if (v.trim() && v.trim() !== t.name) { if (s.execute((wd) => types.updateEventType(wd, t.id, { name: v })) === undefined) e.target.value = t.name; } else e.target.value = t.name; }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} data-testid={`type-name-${t.name}`} />
                <select value={st.spread ?? ''} onChange={(e) => s.execute((wd) => types.updateEventType(wd, t.id, { spread: (e.target.value || null) as types.Spread | null }))} data-testid={`type-spread-${t.name}`}>
                  <option value="">(chosen each time)</option>
                  {types.SPREADS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <LengthField key={`${t.id}:${st.length?.n ?? ''}:${st.length?.unit ?? ''}`} value={st.length} onChange={(v) => { const cur = st.length ?? null; if (JSON.stringify(cur) !== JSON.stringify(v)) s.execute((wd) => types.updateEventType(wd, t.id, { length: v })); }} testId={`type-length-${t.name}`} />
                <span className="muted">{n}</span>
                <span className="type-actions">
                  <button className="small" title="A copy of this type to change" onClick={() => s.execute((wd) => types.copyEventType(wd, t.id))} data-testid={`type-copy-${t.name}`}>Copy</button>
                  {!fixed && <button className="small danger" onClick={() => {
                    if (n && !confirm(`Delete the type "${t.name}"? Its ${n === 1 ? 'event becomes a plain event' : `${n} events become plain events`}. Undo brings it back.`)) return;
                    s.execute((wd) => types.deleteEventTypes(wd, [t.id]));
                  }} data-testid={`type-delete-${t.name}`}>Delete</button>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="group-new">
          <input placeholder="New type, e.g. Siege, Coronation, Plague" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} data-testid="new-type-name" />
          <button className="small" onClick={create} data-testid="new-type-create">Add</button>
        </div>
        <div className="modal-actions"><button onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
