// Areas, lines and points on feature layers (D71): the tool's options above the map, the question
// asked once something is drawn, the panel of a chosen feature, the list of features, and the dialog
// that makes a layer of any kind.
import { RangeReset } from '../shell/Reset.tsx';
import { SmartBrushControls } from './SmartBrush.tsx';
import { useEffect, useState } from 'react';
import { DesignButton } from '../panels/Looks.tsx';
import { useStore, store, type PendingEdit } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, compare, fromStore, NEG_INF } from '../../core-time/index.ts';
import { isBaseEvent } from '../../world-model/schema.ts';
import { eventsHere } from '../events-here.ts';
import { featureStyle, featureColor, isFeatureKind, DEFAULT_FEATURE_STYLE, type FeatureKind, type FeatureStyle } from '../../render-engine/feature-style.ts';
import { parseJSON, type FeatureAnimStyle } from '../../temporal-engine/engine.ts';
import { DateField, fmt } from '../inputs.tsx';
import { FieldTypeChoice } from './Fields.tsx';
import { FIELD_TYPES, type FieldType } from '../../domain/fields.ts';
import { PicturesSection } from './Pictures.tsx';

const KIND_NAME: Record<FeatureKind, { one: string; many: string; example: string }> = {
  area: { one: 'area', many: 'Areas', example: 'claims, influence zones, occupied zones' },
  line: { one: 'line', many: 'Lines', example: 'front lines, roads, rivers, routes, arrows' },
  point: { one: 'point', many: 'Points', example: 'battles, bases, sites, landmarks' },
};

/** The feature layers of the map being viewed, in their order. */
export function featureLayers(s: ReturnType<typeof useStore>) {
  return (s.world?.all('layer') ?? []).filter((l) => l.space_id === s.spaceId && isFeatureKind(l.kind)).sort((a, b) => a.sort_order - b.sort_order);
}

/** How a drawing goes into history when it is not asked about: into the event being recorded, or from the date viewed. */
function recordedMode(): cmd.EditMode | null {
  const s = store;
  const rec = s.recordEventId ? s.world?.get('event', s.recordEventId) : null;
  if (!rec) return null;
  const start = fromStore(rec.start_day, rec.start_ms);
  return { kind: 'new', eventId: rec.id, at: compare(s.time, start) > 0 ? s.time : null };
}

/** The features tool's options: which layer, how to draw, and what the next drawing is for. */
export function FeatureToolOptions() {
  const s = useStore();
  const layers = featureLayers(s);
  const layer = layers.find((l) => l.id === s.featureLayerId) ?? null;
  useEffect(() => { if (!layer && layers.length) s.set({ featureLayerId: layers[0].id }); }, [layer, layers.length]);
  const kind = layer && isFeatureKind(layer.kind) ? layer.kind : null;
  const reshaping = s.reshapeId ? s.world?.get('feature', s.reshapeId) : null;
  return (
    <div className="toolbar sub" data-testid="feature-options">
      <label className="inline">Layer
        <select value={layer?.id ?? ''} onChange={(e) => { if (e.target.value === '+') s.set({ dialog: 'new-layer' }); else s.set({ featureLayerId: e.target.value, reshapeId: null }); }} data-testid="feature-layer">
          {!layers.length && <option value="">No layer yet</option>}
          {layers.map((l) => <option key={l.id} value={l.id}>{l.name} ({KIND_NAME[l.kind as FeatureKind].many.toLowerCase()})</option>)}
          <option value="+">New layer…</option>
        </select>
      </label>
      {kind && kind !== 'point' && (
        <label className="inline">Draw
          <select value={s.featureDraw} onChange={(e) => s.set({ featureDraw: e.target.value as 'freehand' | 'clicks' })} data-testid="feature-draw">
            <option value="freehand">Freehand (drag)</option>
            <option value="clicks">Click by click</option>
          </select>
        </label>
      )}
      {reshaping
        ? <span className="muted" data-testid="reshaping">Drawing a new shape for “{reshaping.name}”. <button className="small" onClick={() => s.set({ reshapeId: null })}>Cancel</button></span>
        : <span className="muted">{!kind ? 'Make a layer of areas, lines or points first.'
          : kind === 'point' ? 'Click the map to put a point there.'
          : s.featureDraw === 'clicks' ? `Click the ${kind === 'area' ? 'corners' : 'points'}; double-click or Enter to finish; Esc to cancel.`
          : kind === 'area' ? 'Draw around an area.' : 'Draw the line.'}</span>}
      {kind && kind !== 'point' && s.featureDraw === 'freehand' && <SmartBrushControls />}
    </div>
  );
}

/** A drawing is finished: what it is (new, or a new shape for the feature being reshaped), and when. */
export function finishFeatureDrawing(layerId: string, parts: Array<Array<[number, number]>>): void {
  const s = store;
  const layer = s.world?.get('layer', layerId);
  if (!layer || !isFeatureKind(layer.kind)) { s.toast('Choose a layer of areas, lines or points first.', 'error'); return; }
  const reshape = s.reshapeId && s.world?.get('feature', s.reshapeId)?.layer_id === layerId ? s.reshapeId : null;
  // While an event is being recorded, everything drawn goes into it without asking (as for territory).
  const rec = recordedMode();
  if (rec) {
    if (reshape) s.execute((w, e) => cmd.reshapeFeature(w, e, { feature: reshape, parts, mode: rec }));
    else {
      const id = s.execute((w) => cmd.createFeature(w, { layerId, name: nextName(layer.name, layer.kind as FeatureKind), parts, mode: rec }));
      if (id) s.set({ selection: { kind: 'feature', id } });
    }
    s.set({ reshapeId: null });
    return;
  }
  s.set({ pending: { kind: 'feature', layerId, parts, reshape } });
}

/** "Front 3": the layer's name (singular-ish) and a number not used yet on that layer. */
function nextName(layerName: string, kind: FeatureKind): string {
  const w = store.world!;
  const base = KIND_NAME[kind].one[0].toUpperCase() + KIND_NAME[kind].one.slice(1);
  const n = w.all('feature').filter((f) => w.get('layer', f.layer_id)?.name === layerName).length + 1;
  return `${base} ${n}`;
}

/** The question after drawing a feature: its name and what it belongs to, and how it goes into history. */
export function FeaturePrompt({ p }: { p: Extract<PendingEdit, { kind: 'feature' }> }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const layer = w.get('layer', p.layerId);
  const kind = (layer && isFeatureKind(layer.kind) ? layer.kind : 'area') as FeatureKind;
  const feature = p.reshape ? w.get('feature', p.reshape) : null;
  const [name, setName] = useState(() => (layer ? nextName(layer.name, kind) : ''));
  const [owner, setOwner] = useState('');
  // New features exist from the date viewed by default; a new shape, likewise, from that date.
  const [choice, setChoice] = useState<'change' | 'always' | 'correct' | 'event'>('change');
  const [target, setTarget] = useState<string>(() => (s.lastPaintEvent && w.get('event', s.lastPaintEvent) ? s.lastPaintEvent : 'new-event'));
  const [evName, setEvName] = useState(feature ? `${feature.name} changes` : '');
  const [end, setEnd] = useState<Instant | null>(null);
  // How it appears over its event's length (D79): a line draws itself, an area grows, a point fades in.
  const [anim, setAnim] = useState<FeatureAnimStyle | ''>(kind === 'line' ? 'draw' : kind === 'area' ? 'grow' : 'fade');
  const events = eventsHere();
  const owners = w.all('entity').filter((x) => x.type_id === 'polity' || x.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  // The shape in force at the date viewed (for "correct"), and when it began.
  const steps = feature ? e.featureHistory(feature.id) : [];
  let inForce: (typeof steps)[number] | null = null;
  for (const st of steps) if (compare(st.t, s.time) <= 0) inForce = st;
  const close = () => { s.set({ pending: null }); };
  const confirm = () => {
    let mode: cmd.EditMode;
    if (choice === 'always') mode = { kind: 'correct', t: NEG_INF };
    else if (choice === 'correct') mode = { kind: 'correct', t: s.time };
    else if (choice === 'change') mode = { kind: 'change', t: s.time };
    else if (target === 'new-event') {
      if (end && compare(end, s.time) < 0) { s.toast('The event cannot end before it starts.', 'error'); return; }
      const evId = s.execute((wd) => cmd.createEvent(wd, { name: evName.trim() || (feature ? `${feature.name} changes` : `${name} appears`), start: s.time, end }));
      if (!evId) return;
      mode = { kind: 'new', eventId: evId };
      s.set({ lastPaintEvent: evId });
    } else {
      const ev = w.get('event', target)!;
      const start = fromStore(ev.start_day, ev.start_ms);
      mode = { kind: 'new', eventId: target, at: compare(s.time, start) > 0 ? s.time : null };
      s.set({ lastPaintEvent: target });
    }
    if (feature) {
      s.execute((wd, en) => cmd.reshapeFeature(wd, en, { feature: feature.id, parts: p.parts, mode, anim: mode.kind === 'new' && anim ? anim : null }));
      s.set({ selection: { kind: 'feature', id: feature.id }, reshapeId: null });
    } else {
      const id = s.execute((wd) => cmd.createFeature(wd, { layerId: p.layerId, name, entity: owner || undefined, parts: p.parts, mode, anim: mode.kind === 'new' && anim ? anim : null }));
      if (id) s.set({ selection: { kind: 'feature', id } });
    }
    close();
  };
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
  const what = KIND_NAME[kind].one;
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="feature" data-testid="feature-prompt">
        <div className="modal-head"><h2>{feature ? `A new shape for “${feature.name}”` : `A new ${what} on “${layer?.name ?? ''}”`}</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        {!feature && <>
          <label>Name<input autoFocus value={name} onChange={(ev) => setName(ev.target.value)} data-testid="feature-name" /></label>
          <label>Belongs to (optional; its colour follows)
            <select value={owner} onChange={(ev) => setOwner(ev.target.value)} data-testid="feature-owner">
              <option value="">Nobody in particular</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </>}
        <div className={`choice ${choice === 'change' ? 'on' : ''}`} onClick={() => setChoice('change')} data-testid="feature-choice-change">
          <b>{feature ? `A new shape from ${fmt(s.time)}` : `It exists from ${fmt(s.time)}`}</b>
          <div className="muted">{feature ? 'Earlier dates keep the shape they had.' : 'Not shown before this date.'} No event is made.</div>
        </div>
        {feature && inForce?.parts && (
          <div className={`choice ${choice === 'correct' ? 'on' : ''}`} onClick={() => setChoice('correct')} data-testid="feature-choice-correct">
            <b>Correct the shape it has now (since {inForce.t.day === -Infinity ? 'the beginning' : fmt(inForce.t)})</b>
            <div className="muted">Redraws that shape wherever it shows; other periods stay as they are.</div>
          </div>
        )}
        {!feature && (
          <div className={`choice ${choice === 'always' ? 'on' : ''}`} onClick={() => setChoice('always')} data-testid="feature-choice-always">
            <b>It has always been there</b>
            <div className="muted">Shown at every date, from the beginning of time (until you end it).</div>
          </div>
        )}
        <div className={`choice ${choice === 'event' ? 'on' : ''}`} onClick={() => setChoice('event')} data-testid="feature-choice-event">
          <b>Part of an event</b>
          <div className="muted">{feature ? 'The new shape comes with the event.' : `The ${what} appears with the event.`}</div>
          {choice === 'event' && (
            <div className="choice-body" onClick={(ev) => ev.stopPropagation()}>
              <label>Event
                <select value={target} onChange={(ev) => setTarget(ev.target.value)} data-testid="feature-event">
                  <option value="new-event">A new event from {fmt(s.time)}…</option>
                  {events.map((x) => <option key={x.id} value={x.id}>{fmt(fromStore(x.start_day, x.start_ms))} · {x.name}</option>)}
                </select>
              </label>
              {target === 'new-event' && <>
                <label>Event name<input value={evName} placeholder={feature ? `${feature.name} changes` : `${name} appears`} onChange={(ev) => setEvName(ev.target.value)} data-testid="feature-event-name" /></label>
                <label>Ends (optional)<DateField value={end} allowEmpty suggest={s.time} onChange={setEnd} testId="feature-event-end" /></label>
              </>}
              {(target === 'new-event' ? !!end : w.get('event', target)?.end_day !== null) && (
                <label>How it appears over the event
                  <AnimSelect kind={kind} value={anim} onChange={setAnim} testId="feature-anim" />
                </label>
              )}
            </div>
          )}
        </div>
        <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={confirm} data-testid="confirm-feature">Apply <span className="key">Enter</span></button></div>
      </div>
    </div>
  );
}

/** How a shape appears over its event (D79). */
function AnimSelect({ kind, value, onChange, testId }: { kind: FeatureKind; value: FeatureAnimStyle | ''; onChange: (v: FeatureAnimStyle | '') => void; testId?: string }) {
  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value as FeatureAnimStyle | '')} data-testid={testId}>
      <option value="">At once</option>
      {kind !== 'point' && <option value="draw">{kind === 'line' ? 'Draws itself (an arrow\'s head travels)' : 'Its outline draws itself'}</option>}
      <option value="grow">{kind === 'point' ? 'Grows' : 'Grows from its middle'}</option>
      <option value="fade">Fades in</option>
    </select>
  );
}

/** The panel of a chosen area, line or point: name, what it belongs to, look, shapes over time, notes. */
/**
 * The look of an area, a line or a point (D236: in the Looks panel): its colour, fill and pattern, how a line is drawn,
 * its width and dashes, marks flowing along it, teeth and arrowheads, a point's symbol and size, its name on the map.
 */
export function FeatureLookSection({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const f = w.get('feature', id);
  if (!f) return null;
  const layer = w.get('layer', f.layer_id);
  if (!layer || !isFeatureKind(layer.kind)) return null;
  const kind = layer.kind;
  const own = parseJSON<FeatureStyle>(f.style, {});
  const st = featureStyle(kind, layer.style, f.style);
  const ownerColor = f.entity_id ? w.get('entity', f.entity_id)?.color ?? null : null;
  const color = featureColor(kind, layer.style, f.style, ownerColor);
  const look = (patch: FeatureStyle) => s.execute((wd) => cmd.updateFeature(wd, id, { style: patch }));
  const arrowLook = kind === 'line' && st.look === 'arrow';
  const owners = w.all('entity').filter((x) => x.type_id === 'polity' || x.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="look-grid">
        <label className="inline">Colour <input type="color" value={own.color ?? color} onChange={(ev) => look({ color: ev.target.value })} data-testid="feature-color" /></label>
        {own.color && <button className="small" onClick={() => look({ color: undefined } as FeatureStyle)} title={ownerColor ? "Use the colour of the country it belongs to" : "Use the layer's colour"}>{ownerColor ? "Country's colour" : "Layer's colour"}</button>}
        {kind === 'area' && <>
          <label className="inline" title="0: outline only">Fill <input type="range" min={0} max={1} step={0.05} value={st.fillOpacity ?? 0.25} onChange={(ev) => look({ fillOpacity: Number(ev.target.value) })} /><RangeReset def={0.25} value={st.fillOpacity ?? 0.25} /></label>
          <label className="inline">Pattern
            <select value={st.hatch ?? 'none'} onChange={(ev) => look({ hatch: ev.target.value as FeatureStyle['hatch'] })} data-testid="feature-hatch">
              <option value="none">None</option><option value="diagonal">Diagonal lines</option><option value="cross">Cross-hatched</option><option value="dots">Dots</option>
            </select>
          </label>
          <label className="inline" title="Claimed by another country or faction as well: drawn in stripes of both colours">Contested with
            <select value={st.contested ?? ''} onChange={(ev) => look({ contested: ev.target.value })} data-testid="feature-contested">
              <option value="">Nobody</option>
              {owners.filter((o) => o.id !== f.entity_id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </>}
        {kind === 'line' && (
          <label className="inline" title="A campaign arrow is a broad arrow along the line, narrowing to its tail; drawn in an event with a length, it grows along its path. A missile is seen only while its line draws itself: a glowing head and trail flying along it, gone when it arrives">Drawn as
            <select value={st.look ?? 'line'} onChange={(ev) => { const v = ev.target.value as FeatureStyle['look']; look(v === 'arrow' && (st.width ?? 3) < 8 ? { look: v, width: 18 } : v === 'line' && (st.width ?? 3) > 20 ? { look: v, width: 3 } : { look: v }); }} data-testid="feature-look">
              <option value="line">A line</option><option value="arrow">A campaign arrow</option><option value="missile">A missile (seen only in flight)</option>
            </select>
          </label>
        )}
        {kind !== 'point' && <>
          <label className="inline">{arrowLook ? 'Arrow width' : 'Line width'} <input type="number" min={0} max={arrowLook ? 200 : 20} step={arrowLook ? 1 : 0.5} value={st.width ?? 2} onChange={(ev) => look({ width: Math.max(0, Number(ev.target.value)) })} style={{ width: '4.5em' }} data-testid="feature-width" /></label>
          {!arrowLook && <label className="inline">Line
            <select value={st.dash ?? 'solid'} onChange={(ev) => look({ dash: ev.target.value as FeatureStyle['dash'] })} data-testid="feature-dash">
              <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
            </select>
          </label>}
        </>}
        {kind === 'line' && <>
          <label className="inline" title="Marks moving along the line the way it was drawn, as a shot plays (still while world-building): for migrations, supply lines, trade and campaigns">Flowing
            <select value={st.flow ?? 'none'} onChange={(ev) => look({ flow: ev.target.value as FeatureStyle['flow'] })} data-testid="feature-flow">
              <option value="none">Nothing</option><option value="dashes">Dashes</option><option value="chevrons">Chevrons</option><option value="dots">Dots</option>
            </select>
          </label>
          {st.flow && st.flow !== 'none' && <label className="inline" title="How fast the marks move (pixels a second in a 1920-wide frame)">at <input type="number" min={0} max={2000} step={5} value={st.flowSpeed ?? 40} onChange={(ev) => look({ flowSpeed: Math.max(0, Number(ev.target.value)) })} style={{ width: '4.5em' }} data-testid="feature-flow-speed" /> px/s</label>}
        </>}
        {kind === 'line' && !arrowLook && <>
          <label className="inline" title="Teeth along the line: a front line facing that way">Front teeth
            <select value={st.teeth ?? 'none'} onChange={(ev) => look({ teeth: ev.target.value as FeatureStyle['teeth'] })} data-testid="feature-teeth">
              <option value="none">None</option><option value="left">On the left</option><option value="right">On the right</option>
            </select>
          </label>
          <label className="inline">Arrowhead
            <select value={st.arrow ?? 'none'} onChange={(ev) => look({ arrow: ev.target.value as FeatureStyle['arrow'] })} data-testid="feature-arrow">
              <option value="none">None</option><option value="end">At the end</option><option value="both">At both ends</option>
            </select>
          </label>
        </>}
        {kind === 'point' && <>
          <label className="inline">Symbol
            <select value={st.symbol ?? 'circle'} onChange={(ev) => look({ symbol: ev.target.value as FeatureStyle['symbol'] })} data-testid="feature-symbol">
              <option value="circle">Circle</option><option value="square">Square</option><option value="triangle">Triangle</option><option value="diamond">Diamond</option>
              <option value="star">Star</option><option value="cross">Cross</option><option value="battle">Crossed swords (battle)</option>
            </select>
          </label>
          <label className="inline">Size <input type="number" min={2} max={60} step={1} value={st.size ?? 9} onChange={(ev) => look({ size: Math.max(2, Number(ev.target.value)) })} style={{ width: '4em' }} /></label>
        </>}
        <label className="check"><input type="checkbox" checked={!!st.showName} onChange={(ev) => look({ showName: ev.target.checked })} data-testid="feature-show-name" /> Name on the map</label>
      </div>
    </>
  );
}

export function FeaturePanel({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const f = w.get('feature', id);
  const [name, setName] = useState(f?.name ?? '');
  const [notes, setNotes] = useState(f?.notes ?? '');
  useEffect(() => { setName(f?.name ?? ''); setNotes(f?.notes ?? ''); }, [id, f?.name, f?.notes]);
  if (!f) return null;
  const layer = w.get('layer', f.layer_id);
  if (!layer || !isFeatureKind(layer.kind)) return null;
  const kind = layer.kind;
  const ownerColor = f.entity_id ? w.get('entity', f.entity_id)?.color ?? null : null;
  const color = featureColor(kind, layer.style, f.style, ownerColor);
  const steps = e.featureHistory(id);
  const animOf = (effectId: string): FeatureAnimStyle | '' => { const tr = parseJSON<{ style?: FeatureAnimStyle } | null>(w.get('effect', effectId)?.transition ?? '', null); return tr?.style ?? ''; };
  const now = e.featuresAt(f.layer_id, s.time).some((x) => x.feature === id);
  const owners = w.all('entity').filter((x) => x.type_id === 'polity' || x.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const sameKind = w.all('layer').filter((l) => l.space_id === layer.space_id && l.kind === layer.kind);
  return (
    <div className="panel" data-testid="feature-panel">
      <h3><span className="swatch big" style={{ background: color }} /> {f.name}<DesignButton /></h3>
      <div className="muted">{KIND_NAME[kind].one[0].toUpperCase() + KIND_NAME[kind].one.slice(1)} on “{layer.name}” · {now ? `shown on ${fmt(s.time)}` : `not there on ${fmt(s.time)}`}</div>
      <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== f.name && s.execute((wd) => cmd.updateFeature(wd, id, { name }))} data-testid="feature-panel-name" /></label>
      <label>Belongs to
        <select value={f.entity_id} onChange={(ev) => s.execute((wd) => cmd.updateFeature(wd, id, { entity_id: ev.target.value }))} data-testid="feature-panel-owner">
          <option value="">Nobody in particular</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      {sameKind.length > 1 && (
        <label>Layer
          <select value={f.layer_id} onChange={(ev) => s.execute((wd) => cmd.updateFeature(wd, id, { layer_id: ev.target.value }))}>
            {sameKind.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      <h4>Shapes over time</h4>
      {steps.map((x) => {
        const ev = w.get('event', x.eventId);
        const inEvent = ev && !isBaseEvent(ev.id) ? ev.name : null;
        return (
          <div key={x.effectId} className="row" data-testid="feature-step">
            <span className="date">{x.t.day === -Infinity ? 'From the beginning' : fmt(x.t)}</span> {x.parts ? 'shape' : 'ends'}{inEvent ? ` · ${inEvent}` : ''}
            <span className="row-tools">
              {x.t.day !== -Infinity && <button className="small" onClick={() => s.setTime(x.t)}>Go to</button>}
              {!inEvent && x.t.day !== -Infinity && x.parts && x === steps[0] && <button className="small" title="Shown from the beginning of time instead of from this date" onClick={() => s.execute((wd) => cmd.shapeFromBeginning(wd, x.effectId))}>From the beginning</button>}
              {steps.length > 1 && <button className="small danger" title="Remove this step" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, x.effectId))}>×</button>}
            </span>
            {/* In an event with a length, the shape can appear over it (D79). */}
            {inEvent && x.parts && ev!.end_day !== null && kind && (
              <label className="inline small-note">Appears
                <AnimSelect kind={kind} value={animOf(x.effectId)} onChange={(v) => s.execute((wd) => cmd.setShapeAnimation(wd, x.effectId, v || null))} testId="feature-step-anim" />
              </label>
            )}
          </div>
        );
      })}
      {!steps.length && <div className="muted">No shape (its event was deleted). Draw it again.</div>}
      <div className="buttons">
        <button onClick={() => s.set({ tool: 'feature', featureLayerId: f.layer_id, reshapeId: id })} data-testid="feature-reshape">Draw a new shape…</button>
        {now && <button onClick={() => s.execute((wd, en) => cmd.endFeature(wd, en, { feature: id, mode: { kind: 'change', t: s.time } }))} data-testid="feature-end" title="It no longer exists from the date viewed (until given a new shape)">Ends on {fmt(s.time)}</button>}
      </div>
      <label>Notes<textarea rows={4} value={notes} onChange={(ev) => setNotes(ev.target.value)} onBlur={() => notes !== f.notes && s.execute((wd) => cmd.updateFeature(wd, id, { notes }))} /></label>
      <PicturesSection holder={{ kind: 'feature', id }} />
      <button className="danger" onClick={() => { if (confirm(`Delete "${f.name}" and all its shapes?`)) { s.execute((wd) => cmd.deleteFeatures(wd, [id])); s.set({ selection: null }); } }} data-testid="feature-delete">Delete</button>
    </div>
  );
}

/** The features of the map being viewed, layer by layer (those not there at the date viewed are dimmed). */
export function FeatureRows() {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const layers = featureLayers(s);
  if (!layers.length) return <div className="muted pad">None yet. Make a layer of areas, lines or points (+ Layer), then draw with the <b>Areas, lines &amp; points</b> tool.</div>;
  return (
    <>
      {layers.map((l) => {
        const here = new Set(e.featuresAt(l.id, s.time).map((x) => x.feature));
        const list = w.all('feature').filter((f) => f.layer_id === l.id).sort((a, b) => a.created_seq - b.created_seq);
        return (
          <div key={l.id} className="feature-group">
            <div className="group-head muted">{l.name}</div>
            {list.map((f) => {
              const color = featureColor(l.kind as FeatureKind, l.style, f.style, f.entity_id ? w.get('entity', f.entity_id)?.color : null);
              const sel = s.selection?.kind === 'feature' && s.selection.id === f.id;
              return (
                <div key={f.id} className={`row ${sel ? 'sel' : ''} ${here.has(f.id) ? '' : 'dim'}`} onClick={() => s.set({ selection: { kind: 'feature', id: f.id } })} data-testid="feature-row" title={here.has(f.id) ? '' : `Not there on ${fmt(s.time)}`}>
                  <span className="swatch" style={{ background: color }} /> {f.name}
                </div>
              );
            })}
            {!list.length && <div className="muted pad">Nothing drawn on it yet.</div>}
          </div>
        );
      })}
    </>
  );
}

/** A new layer of any kind: territory, areas, lines, points, or conditions (fields, D102). */
export function NewLayerDialog() {
  const s = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'partition' | FeatureKind | 'field'>(s.newLayerKind ?? 'partition');
  const [fieldType, setFieldType] = useState<FieldType>('radiation');
  const round = s.world?.get('map_space', s.spaceId)?.kind === 'sphere';
  const close = () => s.set({ dialog: null, newLayerKind: null });
  const create = () => {
    if (kind === 'field') {
      const id = s.execute((wd) => cmd.createFieldLayer(wd, s.spaceId, name, fieldType));
      if (!id) return;
      s.set({ fieldLayerId: id, fieldSource: {}, tool: 'field' });
      close();
      return;
    }
    const n = name.trim() || (kind === 'partition' ? 'Territory' : KIND_NAME[kind].many);
    const id = s.execute((wd) => cmd.createLayer(wd, s.spaceId, n, kind));
    if (!id) return;
    if (kind === 'partition') s.set({ layerId: id });
    else s.set({ featureLayerId: id, tool: 'feature', reshapeId: null });
    close();
  };
  const kinds: Array<{ id: 'partition' | FeatureKind | 'field'; name: string; hint: string }> = [
    { id: 'partition', name: 'Territory', hint: 'Each place has one holder at a time, with borders between them: religion, military control, language.' },
    { id: 'area', name: 'Areas', hint: `Shapes that may overlap: ${KIND_NAME.area.example}.` },
    { id: 'line', name: 'Lines', hint: `${KIND_NAME.line.example[0].toUpperCase()}${KIND_NAME.line.example.slice(1)}.` },
    { id: 'point', name: 'Points', hint: `${KIND_NAME.point.example[0].toUpperCase()}${KIND_NAME.point.example.slice(1)}.` },
    ...(round ? [{ id: 'field' as const, name: 'Conditions', hint: 'Radiation, fire, smoke and ash, floods, destruction or a heatmap: sources that rise, last and fade by themselves, coloured by strength.' }] : []),
  ];
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="New layer" data-testid="new-layer-dialog">
        <div className="modal-head"><h2>New layer</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        {kinds.map((k) => (
          <div key={k.id} className={`choice ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)} data-testid={`layer-kind-${k.id}`}>
            <b>{k.name}</b>
            <div className="muted">{k.hint}</div>
          </div>
        ))}
        {kind === 'field' && <FieldTypeChoice value={fieldType} onChange={setFieldType} />}
        <label>Name<input autoFocus value={name} placeholder={kind === 'partition' ? 'for example "Military control"' : kind === 'field' ? `for example "${FIELD_TYPES[fieldType].name}"` : `for example "${kind === 'area' ? 'Claims' : kind === 'line' ? 'Front lines' : 'Battles'}"`} onChange={(ev) => setName(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && create()} data-testid="new-layer-name" /></label>
        <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={create} data-testid="create-layer">Create layer</button></div>
      </div>
    </div>
  );
}

export { DEFAULT_FEATURE_STYLE };
