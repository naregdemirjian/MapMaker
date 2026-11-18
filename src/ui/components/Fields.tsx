// The Conditions tool (Stage 9, D102): the field layer sources are placed on, and the settings of the
// next source: its strength, size, shape (a circle, or a plume carried by the wind) and life (rising,
// lasting, halving). A click on the map places one from the date viewed (in the event being recorded).
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { DEFAULT_SOURCES, FIELD_TYPES, fieldLayerStyleOf, fieldSourceOf, lifespan, type FieldSource, type FieldType } from '../../domain/fields.ts';
import { fieldsDrawable } from '../../render-engine/fields-gl.ts';
import { fmt } from './Panels.tsx';

/** The field layers of the map viewed, in their order. */
export function fieldLayers(s: ReturnType<typeof useStore>) {
  return (s.world?.all('layer') ?? []).filter((l) => l.space_id === s.spaceId && l.kind === 'field').sort((a, b) => a.sort_order - b.sort_order);
}

/** How long, in words: days, months or years. */
export function lengthText(days: number): string {
  if (!Number.isFinite(days)) return 'for ever';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} hours`;
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${Math.round(days / 365.25)} years`;
}

export function FieldToolOptions() {
  const s = useStore();
  const w = s.world!;
  const layers = fieldLayers(s);
  const layer = layers.find((l) => l.id === s.fieldLayerId) ?? null;
  const style = layer ? fieldLayerStyleOf(layer.style) : null;
  const type: FieldType = style?.type ?? 'custom';
  const src = fieldSourceOf({ ...DEFAULT_SOURCES[type], ...s.fieldSource }, type);
  const set = (patch: Partial<FieldSource>) => s.set({ fieldSource: { ...s.fieldSource, ...patch } });
  const count = layer ? w.all('feature').filter((f) => f.layer_id === layer.id).length : 0;
  const rec = s.recordEventId ? w.get('event', s.recordEventId) : null;
  const num = (label: string, key: keyof FieldSource, unit: string, title: string, min = 0, step = 1) => (
    <label className="inline" title={title}>{label}
      <input type="number" min={min} step={step} value={src[key] as number} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min) set({ [key]: v } as Partial<FieldSource>); }} data-testid={`field-${key}`} /> {unit}
    </label>
  );
  return (
    <div className="toolbar sub field-options" data-testid="field-options">
      {!fieldsDrawable() && <span className="muted">Conditions are drawn by the graphics card (WebGL2), which this browser does not offer.</span>}
      <label className="inline">Layer
        <select value={layer?.id ?? ''} onChange={(e) => { if (e.target.value === '+') s.set({ dialog: 'new-layer', newLayerKind: 'field' }); else s.set({ fieldLayerId: e.target.value, fieldSource: {} }); }} data-testid="field-layer">
          {!layer && <option value="">Choose…</option>}
          {layers.map((l) => <option key={l.id} value={l.id}>{l.name} ({FIELD_TYPES[fieldLayerStyleOf(l.style).type].name.toLowerCase()})</option>)}
          <option value="+">New field layer…</option>
        </select>
      </label>
      {layer && style && <>
        <label className="inline" title="How opaque the layer is drawn">Opacity
          <input type="range" min={0.1} max={1} step={0.05} value={style.opacity} onChange={(e) => s.execute((wd) => cmd.setFieldLayerStyle(wd, layer.id, { opacity: Number(e.target.value) }))} data-testid="field-opacity" />
        </label>
        <label className="inline" title="A circle spreading from where it is placed, or a plume carried downwind">Shape
          <select value={src.shape} onChange={(e) => set({ shape: e.target.value as FieldSource['shape'] })} data-testid="field-shape">
            <option value="circle">Circle</option>
            <option value="plume">Plume (carried by the wind)</option>
          </select>
        </label>
        {num('Strength', 'intensity', FIELD_TYPES[type].unit, `At its peak, in the middle (the colours are full at ${FIELD_TYPES[type].full} ${FIELD_TYPES[type].unit})`, 0, FIELD_TYPES[type].full / 20)}
        {num('Size', 'radiusKm', 'km', 'How far it reaches from where it is placed', 0.01, 1)}
        {src.shape === 'plume' && <>
          {num('Wind towards', 'windDeg', '°', 'The direction the wind carries it: 0 north, 90 east, 180 south, 270 west', 0, 15)}
          {num('at', 'windKmPerDay', 'km a day', 'How far the wind carries it in a day', 0, 10)}
        </>}
        {num('Rises over', 'rise', 'days', 'How long it takes to reach its peak', 0, 0.5)}
        {num('Lasts', 'hold', 'days', 'How long it stays at its peak', 0, 1)}
        {num('Halves every', 'decay', 'days', 'Then it fades, halving in strength every so many days (0: gone at once)', 0, 1)}
        {num('Grows over', 'grow', 'days', 'How long its edge takes to reach its full size (0: at once)', 0, 0.5)}
        <label className="inline" title="How uneven a circle's edge is">Uneven edge
          <input type="range" min={0} max={1} step={0.05} value={src.noise} onChange={(e) => set({ noise: Number(e.target.value), seed: (src.seed % 9973) + 1 })} data-testid="field-noise" />
        </label>
        <span className="muted" data-testid="field-hint">Click the map: {FIELD_TYPES[type].name.toLowerCase()} from {rec ? `"${rec.name}"` : fmt(s.time)}, gone after about {lengthText(lifespan(src))}.</span>
        {count > 0 && <button className="link" onClick={() => s.execute((wd) => cmd.deleteFeatures(wd, wd.all('feature').filter((f) => f.layer_id === layer.id).map((f) => f.id)))} data-testid="field-clear" title="Take every source on this layer away (one step, which can be undone)">Remove all {count} source{count === 1 ? '' : 's'}</button>}
      </>}
    </div>
  );
}

/** The kinds of field to choose from when making a field layer. */
export function FieldTypeChoice({ value, onChange }: { value: FieldType; onChange: (t: FieldType) => void }) {
  return (
    <label>Kind
      <select value={value} onChange={(e) => onChange(e.target.value as FieldType)} data-testid="new-layer-field-type">
        {(Object.keys(FIELD_TYPES) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPES[t].name}: {FIELD_TYPES[t].about.toLowerCase()}</option>)}
      </select>
    </label>
  );
}
