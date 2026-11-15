import { useState, useEffect } from 'react';
import { useStore, store, type Tool } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, gregorian, fromStore, formatYear, compare, NEG_INF } from '../../core-time/index.ts';
import { BASE_EVENT_ID, type EffectRow } from '../../world-model/schema.ts';
import { parseJSON, leafDescendants, type Resolution, type TransitionSpec } from '../../temporal-engine/engine.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { stepChange } from './Timeline.tsx';

export const fmt = (t: Instant, precision: 'year' | 'day' | 'minute' = 'day') => gregorian.format(t, precision);

export function DateField({ value, onChange, placeholder, allowEmpty, testId }: { value: Instant | null; onChange: (t: Instant | null) => void; placeholder?: string; allowEmpty?: boolean; testId?: string }) {
  const [text, setText] = useState(value ? fmt(value, value.ms ? 'minute' : 'day') : '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value ? fmt(value, value.ms ? 'minute' : 'day') : ''); setBad(false); }, [value?.day, value?.ms]);
  const commit = () => {
    if (!text.trim()) { if (allowEmpty) onChange(null); else setBad(true); return; }
    const p = gregorian.parse(text);
    if (!p) { setBad(true); return; }
    setBad(false);
    onChange(p.instant);
  };
  return (
    <input
      className={bad ? 'date-input bad' : 'date-input'} value={text} placeholder={placeholder ?? 'e.g. 14 May 1203, 500 BCE, 2241-03-02'}
      onChange={(e: any) => setText(e.target.value)} onBlur={commit} onKeyDown={(e: any) => e.key === 'Enter' && commit()}
      title="Dates: 14 May 1203 · May 1203 · 1203 · 500 BCE · 2241-03-02T04:05 · c. 3000 BCE" data-testid={testId}
    />
  );
}

/** A number box that saves when you press Enter or leave it, not on every keystroke. */
export function NumberField({ value, onCommit, min, max, step, testId, title }: { value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number; testId?: string; title?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n)) { setText(String(value)); return; }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (c !== value) onCommit(c);
    setText(String(c));
  };
  return <input type="number" value={text} min={min} max={max} step={step} title={title} onChange={(e: any) => setText(e.target.value)} onBlur={commit} onKeyDown={(e: any) => e.key === 'Enter' && commit()} data-testid={testId} />;
}

export function TopBar() {
  const s = useStore();
  const w = s.world!;
  s.engine!.ensure();
  const conflicts = s.engine!.conflicts;
  const spaces = w.all('map_space').sort((a, b) => a.sort_order - b.sort_order);
  const switchSpace = (id: string) => {
    const layer = w.all('layer').find((l) => l.space_id === id && l.kind === 'partition');
    s.set({ spaceId: id, layerId: layer?.id ?? '', selection: null, presentCamera: null });
  };
  return (
    <header className="topbar">
      <div className="brand">Map Maker</div>
      <div className="project-name" title={s.projectDir}>{s.projectId}</div>
      <div className="seg">
        <button className={s.mode === 'world' ? 'on' : ''} onClick={() => s.set({ mode: 'world', presentCamera: null, playing: false })} data-testid="mode-world">World-building</button>
        <button className={s.mode === 'present' ? 'on' : ''} onClick={() => s.set({ mode: 'present' })} data-testid="mode-present">Presentation</button>
      </div>
      <select value={s.spaceId} onChange={(e: any) => switchSpace(e.target.value)} title="Which world you are looking at">
        {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
      </select>
      {s.mode === 'world' && (
        <div className="datebar">
          <button onClick={() => stepChange(-1)} title="Previous change">◀</button>
          <DateField value={s.time} onChange={(t) => t && s.setTime(t)} testId="current-date" />
          <button onClick={() => stepChange(1)} title="Next change">▶</button>
        </div>
      )}
      <div className="spacer" />
      <button disabled={!s.journal.canUndo} title={s.journal.undoLabel ? `Undo: ${s.journal.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={() => s.undo()} data-testid="undo">Undo</button>
      <button disabled={!s.journal.canRedo} title={s.journal.redoLabel ? `Redo: ${s.journal.redoLabel} (Ctrl+Y)` : 'Nothing to redo'} onClick={() => s.redo()}>Redo</button>
      <button onClick={() => s.set({ dialog: 'versions' })} title="Save a named version, restore versions and backups">Versions</button>
      <button className={conflicts.length ? 'warn' : ''} onClick={() => s.set({ dialog: 'health' })} data-testid="health">
        History Health{conflicts.length ? ` (${conflicts.length})` : ' ✓'}
      </button>
      <button onClick={() => s.closeProject()} title="Back to the project list">Projects</button>
    </header>
  );
}

const TOOLS: Array<{ id: Tool; name: string; hint: string }> = [
  { id: 'select', name: 'Select', hint: 'Click to inspect a place; drag to move the map; wheel to zoom; Alt+wheel to rotate.' },
  { id: 'lasso', name: 'Territory brush', hint: 'Draw around an area freehand. It is given to the owner chosen on the right.' },
  { id: 'polygon', name: 'Precise shape', hint: 'Click points; double-click or Enter to finish; Esc to cancel.' },
  { id: 'vertex', name: 'Border points', hint: 'Drag a border point to correct the border shape for all time. Double-click a border to add a point; Delete removes the point under the cursor.' },
];

export function ToolBar() {
  const s = useStore();
  const w = s.world!;
  const owners = w.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const rec = s.recordEventId ? w.get('event', s.recordEventId) : null;
  return (
    <>
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.id} className={s.tool === t.id ? 'on' : ''} title={t.hint} onClick={() => s.set({ tool: t.id })} data-testid={`tool-${t.id}`}>{t.name}</button>
      ))}
      {(s.tool === 'lasso' || s.tool === 'polygon') && (
        <>
          <label className="inline">Give to
            <select value={s.paintValue ?? ''} onChange={(e: any) => s.set({ paintValue: e.target.value || null })} data-testid="paint-owner">
              <option value="">Nobody (clear territory)</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          {s.tool === 'lasso' && (
            <details className="brush-settings">
              <summary title="How freehand outlines are cleaned up">Brush settings ▾</summary>
              <div className="popover">
                <label title="Rounds the corners of your outline">Smoothing <input type="range" min={0} max={4} step={1} value={s.stroke.smoothness} onChange={(e: any) => s.set({ stroke: { ...s.stroke, smoothness: Number(e.target.value) } })} /></label>
                <label title="Adds natural-looking irregularity. It is fixed once drawn and never changes afterwards.">Irregularity <input type="range" min={0} max={20} step={1} value={s.stroke.irregularity} onChange={(e: any) => s.set({ stroke: { ...s.stroke, irregularity: Number(e.target.value), seed: (s.stroke.seed % 9973) + 1 } })} /></label>
                <label title="Higher keeps more of the small wiggles in your outline">Detail <input type="range" min={0.3} max={6} step={0.1} value={7 - s.stroke.precision} onChange={(e: any) => s.set({ stroke: { ...s.stroke, precision: 7 - Number(e.target.value) } })} /></label>
              </div>
            </details>
          )}
        </>
      )}
    </div>
    {rec && (
      <div className="record-banner" data-testid="recording">
        <span className="rec-text">● Recording into “{rec.name}”</span>
        <span className="muted-red">Everything you draw is added to this event{compare(s.time, fromStore(rec.start_day, rec.start_ms)) > 0 ? `, as a change on ${fmt(s.time)}` : ''}.</span>
        <button onClick={() => s.set({ recordEventId: null })}>Stop</button>
      </div>
    )}
    </>
  );
}

function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: any }) {
  return (
    <section className="section">
      <div className="section-head"><span>{title}</span>{onAdd && <button className="small" onClick={onAdd} title={addLabel}>+ {addLabel ?? 'New'}</button>}</div>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Outliner() {
  const s = useStore();
  const w = s.world!;
  const [newEntity, setNewEntity] = useState<null | { name: string; type: string }>(null);
  const layers = w.all('layer').filter((l) => l.space_id === s.spaceId).sort((a, b) => a.sort_order - b.sort_order);
  const types = w.all('entity_type');
  const political = w.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const others = w.all('entity').filter((e) => e.type_id !== 'polity' && e.type_id !== 'faction' && e.type_id !== 'body').sort((a, b) => a.name.localeCompare(b.name));
  const events = w.all('event').filter((e) => e.id !== BASE_EVENT_ID).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms);
  const createEntity = () => {
    if (!newEntity || !newEntity.name.trim()) return;
    const id = s.execute((wd) => cmd.createEntity(wd, { type_id: newEntity.type, name: newEntity.name }));
    if (id) s.set({ selection: { kind: 'entity', id }, paintValue: newEntity.type === 'polity' || newEntity.type === 'faction' ? id : s.paintValue });
    setNewEntity(null);
  };
  const entityRow = (e: { id: string; name: string; color: string; type_id: string }) => (
    <div key={e.id} className={`row ${s.selection?.kind === 'entity' && s.selection.id === e.id ? 'sel' : ''}`} onClick={() => s.set({ selection: { kind: 'entity', id: e.id } })}>
      <span className="swatch" style={{ background: e.color }} />{e.name}
    </div>
  );
  return (
    <aside className="left">
      <Section title="Worlds" onAdd={() => s.set({ dialog: 'new-world' })} addLabel="World">
        {w.all('map_space').sort((a, b) => a.sort_order - b.sort_order).map((sp) => (
          <div key={sp.id} className={`row ${sp.id === s.spaceId ? 'sel' : ''}`} onClick={() => s.set({ spaceId: sp.id, layerId: w.all('layer').find((l) => l.space_id === sp.id && l.kind === 'partition')?.id ?? '' })}>
            {sp.name}<span className="muted"> · radius {Math.round((sp.radius_m ?? 0) / 1000).toLocaleString()} km</span>
          </div>
        ))}
      </Section>
      <Section title="Layers" onAdd={() => { const name = prompt('Name of the new layer (for example "Religion" or "Military control")'); if (name?.trim()) { const id = s.execute((wd) => cmd.createLayer(wd, s.spaceId, name.trim())); if (id) s.set({ layerId: id }); } }} addLabel="Layer">
        {layers.map((l) => (
          <div key={l.id} className={`row ${l.id === s.layerId ? 'sel' : ''}`}>
            <input type="checkbox" checked={!!l.visible} title="Show or hide" onChange={(e: any) => s.execute((wd) => cmd.updateLayer(wd, l.id, { visible: e.target.checked ? 1 : 0 }))} />
            <span onClick={() => s.set({ layerId: l.id })} title="Draw on this layer">{l.name}</span>
            {l.id === s.layerId && <span className="muted"> · drawing here</span>}
          </div>
        ))}
      </Section>
      <Section title="Countries and factions" onAdd={() => setNewEntity({ name: '', type: 'polity' })} addLabel="New">
        {newEntity && (
          <div className="new-entity">
            <input autoFocus placeholder="Name" value={newEntity.name} onChange={(e: any) => setNewEntity({ ...newEntity, name: e.target.value })} onKeyDown={(e: any) => e.key === 'Enter' && createEntity()} data-testid="new-entity-name" />
            <select value={newEntity.type} onChange={(e: any) => setNewEntity({ ...newEntity, type: e.target.value })}>
              {types.filter((t) => t.id !== 'body').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={createEntity} data-testid="new-entity-create">Create</button>
            <button onClick={() => setNewEntity(null)}>Cancel</button>
          </div>
        )}
        {political.map(entityRow)}
        {!political.length && !newEntity && <div className="muted pad">None yet.</div>}
      </Section>
      {others.length > 0 && <Section title="Characters, cities and others">{others.map(entityRow)}</Section>}
      <Section title="Events" onAdd={() => s.set({ dialog: 'new-event' })} addLabel="Event">
        {events.map((e) => (
          <div key={e.id} className={`row ${s.selection?.kind === 'event' && s.selection.id === e.id ? 'sel' : ''} ${e.variant_group && !e.variant_active ? 'dim' : ''}`}
            onClick={() => s.set({ selection: { kind: 'event', id: e.id }, time: fromStore(e.start_day, e.start_ms) })}>
            <span className="date">{fmt(fromStore(e.start_day, e.start_ms), e.precision === 'year' ? 'year' : 'day')}</span> {e.name}
          </div>
        ))}
        {!events.length && <div className="muted pad">No events yet.</div>}
      </Section>
    </aside>
  );
}

export function Inspector() {
  const s = useStore();
  const sel = s.selection;
  return (
    <aside className="right">
      {!sel && <QuickStart />}
      {sel?.kind === 'entity' && <EntityPanel id={sel.id} />}
      {sel?.kind === 'event' && <EventPanel id={sel.id} />}
      {sel?.kind === 'point' && <PointPanel lon={sel.lon} lat={sel.lat} />}
    </aside>
  );
}

function QuickStart() {
  return (
    <div className="panel">
      <h3>Getting started</h3>
      <ol className="steps">
        <li>Create a country under <b>Countries and factions</b> (+ New).</li>
        <li>Pick the <b>Territory brush</b>, choose who gets the land, and draw around an area.</li>
        <li>Say what the drawing means: a change from the current date, or a correction.</li>
        <li>Add an <b>event</b>, move the red playhead on the timeline, and draw again: history now changes at that date.</li>
        <li>Drag the playhead to see the map before and after.</li>
      </ol>
      <p className="muted">Everything is saved as you go. Undo with Ctrl+Z. Use <b>Versions</b> to keep named restore points.</p>
    </div>
  );
}

function EntityPanel({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const e = w.get('entity', id);
  const [name, setName] = useState(e?.name ?? '');
  const [notes, setNotes] = useState(e?.notes ?? '');
  useEffect(() => { setName(e?.name ?? ''); setNotes(e?.notes ?? ''); }, [id, e?.name, e?.notes]);
  if (!e) return null;
  const radius = w.get('map_space', s.spaceId)?.radius_m ?? 6371000;
  let areaSr = 0, parcels = 0;
  if (s.layerId) {
    const arr = w.arrangement(s.spaceId);
    for (const [f, st] of s.engine!.partitionState(s.spaceId, s.layerId, s.time)) if (st.value === id) { areaSr += arr.faceArea(f); parcels++; }
  }
  const changes = w.all('effect').filter((f) => parseJSON<Resolution>(f.resolution, { set: [] }).set.some(([, v]) => v === id));
  return (
    <div className="panel" data-testid="entity-panel">
      <h3><span className="swatch big" style={{ background: e.color }} /> {e.name}</h3>
      <label>Name<input value={name} onChange={(ev: any) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEntity(wd, id, { name: name.trim() }))} /></label>
      <label>Colour<input type="color" value={e.color} onChange={(ev: any) => s.execute((wd) => cmd.updateEntity(wd, id, { color: ev.target.value }))} /></label>
      <label>Type<select value={e.type_id} onChange={(ev: any) => s.execute((wd) => cmd.updateEntity(wd, id, { type_id: ev.target.value }))}>{w.all('entity_type').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Notes<textarea rows={5} value={notes} onChange={(ev: any) => setNotes(ev.target.value)} onBlur={() => notes !== e.notes && s.execute((wd) => cmd.updateEntity(wd, id, { notes }))} /></label>
      <div className="stat">On {fmt(s.time)}: {parcels ? `${Math.round(areaSr * (radius / 1000) ** 2).toLocaleString()} km²` : 'no territory'} </div>
      {(e.type_id === 'polity' || e.type_id === 'faction') && <button onClick={() => s.set({ paintValue: id, tool: 'lasso' })}>Draw territory for {e.name}</button>}
      <h4>Territorial changes</h4>
      {[...new Set(changes.map((f) => f.event_id))].map((eid) => w.get('event', eid)).filter((ev) => !!ev).sort((a, b) => a!.start_day - b!.start_day || a!.start_ms - b!.start_ms).map((ev) => (
        <div key={ev!.id} className="row" onClick={() => s.set({ selection: { kind: 'event', id: ev!.id }, time: ev!.id === BASE_EVENT_ID ? s.time : fromStore(ev!.start_day, ev!.start_ms) })}>
          {ev!.id === BASE_EVENT_ID ? 'Base world (from the beginning)' : <><span className="date">{fmt(fromStore(ev!.start_day, ev!.start_ms))}</span> {ev!.name}</>}
        </div>
      ))}
      {!changes.length && <div className="muted">None yet.</div>}
      <button className="danger" onClick={() => { if (confirm(`Delete ${e.name}? Events that refer to it will be flagged in History Health.`)) { s.execute((wd) => cmd.deleteEntity(wd, id)); s.set({ selection: null }); } }}>Delete</button>
    </div>
  );
}

function describeEffect(s: ReturnType<typeof useStore>, f: EffectRow): string {
  const w = s.world!;
  const name = (v: string | null) => (v ? w.get('entity', v)?.name ?? '(deleted)' : 'nobody');
  if (f.kind === 'annex') {
    const i = parseJSON<{ from: string; to: string }>(f.intent, { from: '', to: '' });
    return `${name(i.to)} annexes everything ${name(i.from)} holds`;
  }
  const res = parseJSON<Resolution>(f.resolution, { set: [] });
  const arr = f.space_id ? w.arrangements.get(f.space_id) : undefined;
  const parts = res.set.map(([faces, v]) => {
    const n = arr ? leafDescendants(arr, faces).size : faces.length;
    return `${n} parcel${n === 1 ? '' : 's'} → ${name(v)}`;
  });
  const layer = f.layer_id ? w.get('layer', f.layer_id)?.name : '';
  return `${layer}: ${parts.join('; ')}${f.at_day !== null ? ` (at ${fmt(fromStore(f.at_day, f.at_ms ?? 0), 'minute')})` : ''}`;
}

function EventPanel({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const e = w.get('event', id);
  const [name, setName] = useState(e?.name ?? '');
  const [desc, setDesc] = useState(e?.description ?? '');
  const [annexFrom, setAnnexFrom] = useState('');
  const [annexTo, setAnnexTo] = useState('');
  useEffect(() => { setName(e?.name ?? ''); setDesc(e?.description ?? ''); }, [id, e?.name, e?.description]);
  if (!e) return null;
  const base = id === BASE_EVENT_ID;
  const effects = w.all('effect').filter((f) => f.event_id === id).sort((a, b) => a.ordinal - b.ordinal);
  const start = fromStore(e.start_day, e.start_ms);
  const end = e.end_day !== null ? fromStore(e.end_day, e.end_ms ?? 0) : null;
  const variants = e.variant_group ? w.all('event').filter((x) => x.variant_group === e.variant_group) : [];
  const owners = w.all('entity').filter((x) => x.type_id === 'polity' || x.type_id === 'faction');
  const setTransition = (f: EffectRow, style: string) => {
    let spec: TransitionSpec | null = null;
    if (style === 'advance') {
      const old = parseJSON<TransitionSpec | null>(f.transition, null);
      spec = { style: 'advance', origin: old?.origin ?? regionCentre(s, f), easing: 'smooth' };
    } else if (style === 'fade') spec = { style: 'fade' };
    s.execute((wd) => cmd.setEffectTransition(wd, f.id, spec));
  };
  return (
    <div className="panel" data-testid="event-panel">
      <h3>{base ? 'Base world' : e.name}</h3>
      {!base && <>
        <label>Name<input value={name} onChange={(ev: any) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEvent(wd, id, { name: name.trim() }))} /></label>
        <label>Type<select value={e.type_id} onChange={(ev: any) => s.execute((wd) => cmd.updateEvent(wd, id, { type_id: ev.target.value }))}>{w.all('event_type').filter((t) => t.id !== 'base').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Starts<DateField value={start} onChange={(t) => t && s.execute((wd) => cmd.updateEvent(wd, id, { start: t }))} testId="event-panel-start" /></label>
        <label>Ends<DateField value={end} allowEmpty placeholder="(instantaneous)" onChange={(t) => s.execute((wd) => cmd.updateEvent(wd, id, { end: t }))} testId="event-panel-end" /></label>
        <label title="When two events change the same place at the same instant, the higher precedence wins">Precedence<NumberField value={e.precedence} step={1} onCommit={(n) => s.execute((wd) => cmd.updateEvent(wd, id, { precedence: Math.round(n) }))} /></label>
        <label>Description<textarea rows={4} value={desc} onChange={(ev: any) => setDesc(ev.target.value)} onBlur={() => desc !== e.description && s.execute((wd) => cmd.updateEvent(wd, id, { description: desc }))} /></label>
        <div className="buttons">
          {s.recordEventId === id
            ? <button onClick={() => s.set({ recordEventId: null })}>Stop recording</button>
            : <button onClick={() => s.set({ recordEventId: id, time: compare(s.time, start) < 0 ? start : s.time, tool: s.tool === 'select' ? 'lasso' : s.tool })} title="Every territory you draw goes into this event, without asking" data-testid="record-event">Record into this event</button>}
          <button onClick={() => s.setTime(start)}>Go to start</button>
          {end && <button onClick={() => s.setTime(end)}>Go to end</button>}
        </div>
      </>}
      <h4>Changes</h4>
      {effects.map((f) => (
        <div key={f.id} className="effect">
          <div>{describeEffect(s, f)}</div>
          {!base && f.layer_id && (
            <div className="effect-tools">
              <label className="inline">Animation
                <select value={parseJSON<TransitionSpec | null>(f.transition, null)?.style ?? 'instant'} onChange={(ev: any) => setTransition(f, ev.target.value)} disabled={!end} title={end ? '' : 'Give the event an end date to animate its changes'} data-testid="transition-style">
                  <option value="instant">Instant</option>
                  <option value="advance">Advancing front</option>
                  <option value="fade">Fade</option>
                </select>
              </label>
              <button className="small danger" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, f.id))}>Remove</button>
            </div>
          )}
        </div>
      ))}
      {!effects.length && <div className="muted">No changes yet. Use “Record into this event” and draw on the map.</div>}
      {!base && owners.length >= 2 && (
        <div className="annex">
          <h4>Annexation (keeps its intention)</h4>
          <select value={annexTo} onChange={(ev: any) => setAnnexTo(ev.target.value)}><option value="">Who annexes…</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select value={annexFrom} onChange={(ev: any) => setAnnexFrom(ev.target.value)}><option value="">…everything held by</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <button disabled={!annexFrom || !annexTo || annexFrom === annexTo} onClick={() => s.execute((wd, en) => cmd.annex(wd, en, { spaceId: s.spaceId, layerId: s.layerId, eventId: id, from: annexFrom, to: annexTo }))}>Add annexation</button>
        </div>
      )}
      {!base && <>
        <h4>Alternative versions</h4>
        {variants.map((v) => (
          <div key={v.id} className={`row ${v.id === id ? 'sel' : ''}`}>
            <span onClick={() => s.set({ selection: { kind: 'event', id: v.id } })}>{v.name}</span>
            {v.variant_active ? <span className="muted"> · active</span> : <button className="small" onClick={() => s.execute((wd) => cmd.activateVariant(wd, v.id))}>Use this version</button>}
          </div>
        ))}
        <button onClick={() => { const n = prompt('Name of the alternative version', `${e.name} (alternative)`); if (n?.trim()) { const nid = s.execute((wd) => cmd.createVariant(wd, id, n.trim())); if (nid) s.set({ selection: { kind: 'event', id: nid } }); } }}>Create alternative version</button>
        <button className="danger" onClick={() => { if (confirm(`Delete the event "${e.name}" and its changes?`)) { s.execute((wd) => cmd.deleteEvent(wd, id)); s.set({ selection: null, recordEventId: s.recordEventId === id ? null : s.recordEventId }); } }}>Delete event</button>
      </>}
    </div>
  );
}

function regionCentre(s: ReturnType<typeof useStore>, f: EffectRow): [number, number] {
  const w = s.world!;
  if (!f.space_id) return [0, 0];
  const arr = w.arrangement(f.space_id);
  const res = parseJSON<Resolution>(f.resolution, { set: [] });
  let x = 0, y = 0, z = 0;
  for (const [faces] of res.set) for (const leaf of leafDescendants(arr, faces)) for (const cyc of arr.faceCycles(leaf)) for (const vid of cyc) {
    const v = arr.v(vid); x += v[0]; y += v[1]; z += v[2];
  }
  const n = Math.hypot(x, y, z) || 1;
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(z / n) * 180 / Math.PI];
}

function PointPanel({ lon, lat }: { lon: number; lat: number }) {
  const s = useStore();
  const w = s.world!;
  if (!s.layerId) return null;
  const p = lonLatToVec(lon, lat);
  const value = s.engine!.valueAtPoint(s.spaceId, s.layerId, p, s.time);
  const face = w.arrangement(s.spaceId).locate(p);
  const a = s.engine!.latest(s.spaceId, s.layerId, face, s.time);
  const ev = a ? w.get('event', a.eventId) : null;
  const next = s.engine!.nextChange(s.spaceId, s.layerId, [face], s.time);
  const owner = value ? w.get('entity', value) : null;
  return (
    <div className="panel" data-testid="point-panel">
      <h3>Place</h3>
      <div className="muted">{lat.toFixed(4)}°, {lon.toFixed(4)}°</div>
      <div className="stat" data-testid="point-owner">
        On {fmt(s.time, 'minute')}: {owner ? <><span className="swatch" style={{ background: owner.color }} /> <b>{owner.name}</b></> : <b>nobody</b>}
      </div>
      {ev && <div>Since {ev.id === BASE_EVENT_ID ? 'the base world' : <>{fmt(a!.t, 'day')} (<a onClick={() => s.set({ selection: { kind: 'event', id: ev.id } })}>{ev.name}</a>)</>}</div>}
      <div>{next ? <>Until {fmt(next, 'day')}</> : 'No later change recorded'}</div>
      {owner && <button onClick={() => s.set({ selection: { kind: 'entity', id: owner.id } })}>Open {owner.name}</button>}
    </div>
  );
}

export function Toasts() {
  const s = useStore();
  return <div className="toasts">{s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} data-testid={`toast-${t.kind}`}>{t.text}</div>)}</div>;
}

export function formatNegInf(t: Instant) { return compare(t, NEG_INF) === 0 ? 'the beginning' : fmt(t); }
export { formatYear };
