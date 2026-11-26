// The Conditions tool (Stage 9, D102): the field layer sources are placed on, and the settings of the
// next source: its strength, size, shape (a circle, or a plume carried by the wind) and life (rising,
// lasting, halving). A click on the map places one from the date viewed (in the event being recorded).
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { DEFAULT_SOURCES, FIELD_TYPES, fieldLayerStyleOf, fieldSourceOf, lifespan, type FieldSource, type FieldType } from '../../domain/fields.ts';
import { MOST_SCATTERED } from '../../domain/scatter.ts';
import { DISASTERS, planDisaster, type DisasterId } from '../../domain/disasters.ts';
import { terrainSourceOf } from '../../world-model/world-settings.ts';
import { fieldsDrawable } from '../../render-engine/fields-gl.ts';
import { fmt } from '../inputs.tsx';

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
  const spreading = src.shape === 'spread', flood = spreading && src.spread === 'flood';
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
      {layer && style && type === 'heat' && (() => {
        const points = w.all('layer').filter((l) => l.space_id === s.spaceId && l.kind === 'point').sort((a, b) => a.sort_order - b.sort_order);
        return <>
          <label className="inline" title="A heatmap can be worked out from a layer of points: each point in force at the date viewed counts, spread over the distance below (sources placed by hand count too)">From
            <select value={style.from ?? ''} onChange={(e) => s.execute((wd) => cmd.setFieldLayerStyle(wd, layer.id, { from: e.target.value || null }))} data-testid="field-from">
              <option value="">sources placed by hand</option>
              {points.map((l) => <option key={l.id} value={l.id}>the points of "{l.name}"</option>)}
            </select>
          </label>
          {style.from && <>
            <label className="inline" title="How far each point spreads">Each over
              <input type="number" min={1} step={10} value={style.kernelKm} onChange={(e) => { const v = Number(e.target.value); if (v >= 1) s.execute((wd) => cmd.setFieldLayerStyle(wd, layer.id, { kernelKm: v })); }} data-testid="field-kernel" /> km
            </label>
            <label className="inline" title="Where this many points overlap the colours are full">Full colour at
              <input type="number" min={0.1} step={1} value={style.full ?? FIELD_TYPES.heat.full} onChange={(e) => { const v = Number(e.target.value); if (v > 0) s.execute((wd) => cmd.setFieldLayerStyle(wd, layer.id, { full: v })); }} data-testid="field-full" /> points
            </label>
          </>}
        </>;
      })()}
      {layer && style && <>
        <label className="inline" title="How opaque the layer is drawn">Opacity
          <input type="range" min={0.1} max={1} step={0.05} value={style.opacity} onChange={(e) => s.execute((wd) => cmd.setFieldLayerStyle(wd, layer.id, { opacity: Number(e.target.value) }))} data-testid="field-opacity" />
        </label>
        <label className="inline" title="A circle spreading from where it is placed, a plume carried downwind, or something spreading over the terrain itself (where the map has terrain)">Shape
          <select value={src.shape} onChange={(e) => set({ shape: e.target.value as FieldSource['shape'] })} data-testid="field-shape">
            <option value="circle">Circle</option>
            <option value="plume">Plume (carried by the wind)</option>
            <option value="spread">Spreading over the terrain</option>
          </select>
        </label>
        {spreading && (
          <label className="inline" title="A fire spreads over the land, faster uphill and downwind, never over water; lava flows downhill; a flood fills the low ground as the water rises">As
            <select value={src.spread} onChange={(e) => set({ spread: e.target.value as FieldSource['spread'] })} data-testid="field-spread">
              <option value="fire">a fire</option>
              <option value="lava">lava</option>
              <option value="flood">a flood</option>
            </select>
          </label>
        )}
        {flood
          ? num('Water rises by', 'intensity', 'm', 'How high the water rises above the ground where it starts', 0, 0.5)
          : num('Strength', 'intensity', FIELD_TYPES[type].unit, `At its peak, in the middle (the colours are full at ${FIELD_TYPES[type].full} ${FIELD_TYPES[type].unit})`, 0, FIELD_TYPES[type].full / 20)}
        {num(spreading ? 'Reaches up to' : 'Size', 'radiusKm', 'km', spreading ? 'How far from where it starts it can spread' : 'How far it reaches from where it is placed', 0.01, 1)}
        {spreading && !flood && num('at the pace of', 'grow', 'days', 'The days it takes to spread that far over flat ground (faster uphill and downwind for a fire, down steep slopes for lava)', 0, 0.5)}
        {(src.shape === 'plume' || (spreading && src.spread === 'fire')) && <>
          {num('Wind towards', 'windDeg', '°', 'The direction the wind carries it: 0 north, 90 east, 180 south, 270 west', 0, 15)}
          {num('at', 'windKmPerDay', 'km a day', 'How strong the wind is: how far it carries things in a day', 0, 10)}
        </>}
        {num(flood ? 'Rises over' : 'Rises over', 'rise', 'days', flood ? 'How long the water takes to rise' : 'How long it takes to reach its peak (each place, from when it arrives)', 0, 0.5)}
        {num('Lasts', 'hold', 'days', 'How long it stays at its peak', 0, 1)}
        {num(flood ? 'Recedes, halving every' : 'Halves every', 'decay', 'days', 'Then it fades, halving every so many days (0: gone at once)', 0, 1)}
        {!spreading && num('Grows over', 'grow', 'days', 'How long its edge takes to reach its full size (0: at once)', 0, 0.5)}
        {!spreading && (
          <label className="inline" title="How uneven a circle's edge is">Uneven edge
            <input type="range" min={0} max={1} step={0.05} value={src.noise} onChange={(e) => set({ noise: Number(e.target.value), seed: (src.seed % 9973) + 1 })} data-testid="field-noise" />
          </label>
        )}
        <span className="muted" data-testid="field-hint">Click the map: {FIELD_TYPES[type].name.toLowerCase()} from {rec ? `"${rec.name}"` : fmt(s.time)}, gone after about {lengthText(lifespan(src))}.</span>
        {count > 0 && <button className="link" onClick={() => s.execute((wd) => cmd.deleteFeatures(wd, wd.all('feature').filter((f) => f.layer_id === layer.id).map((f) => f.id)))} data-testid="field-clear" title="Take every source on this layer away (one step, which can be undone)">Remove all {count} source{count === 1 ? '' : 's'}</button>}
      </>}
    </div>
  );
}

/**
 * The Disasters tool (D104): a template, its size and the wind; a click places the whole disaster
 * (its conditions on layers of their kinds, made where missing; an impact's crater) in a new event.
 */
export function DisasterToolOptions() {
  const s = useStore();
  const d = s.disaster, t = DISASTERS.find((x) => x.id === d.id)!;
  const set = (patch: Partial<typeof d>) => s.set({ disaster: { ...d, ...patch } });
  const plan = planDisaster(d.id, d.size, d.windDeg);
  const rec = s.recordEventId ? s.world?.get('event', s.recordEventId) : null;
  const terrain = !!terrainSourceOf(s.world?.get('map_space', s.spaceId));
  return (
    <div className="toolbar sub disaster-options" data-testid="disaster-options">
      <label className="inline" title={t.hint}>Disaster
        <select value={d.id} onChange={(e) => { const n = DISASTERS.find((x) => x.id === e.target.value)!; set({ id: n.id as DisasterId, size: n.size.value, least: n.size.value, most: n.size.value }); }} data-testid="disaster-kind">
          {DISASTERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="inline" title="One disaster where you click, or many at once with a brush (D233): scattered along your stroke, each of its own size and moment">Place
        <select value={d.many ? 'many' : 'one'} onChange={(e) => set({ many: e.target.value === 'many' })} data-testid="disaster-place">
          <option value="one">One at a click</option><option value="many">Many with a brush</option>
        </select>
      </label>
      {!d.many && <label className="inline" title={`From ${t.size.min} to ${t.size.max}`}>{t.size.label}
        <input type="number" min={t.size.min} max={t.size.max} step={t.size.step} value={d.size} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) set({ size: v }); }} data-testid="disaster-size" /> {t.size.unit}
      </label>}
      {d.many && <>
        <label className="inline" title={`How many in one stroke (at most ${MOST_SCATTERED.toLocaleString('en')}), scattered evenly along it`}>How many
          <input type="number" min={1} max={MOST_SCATTERED} step={100} value={d.count} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 1) set({ count: Math.min(MOST_SCATTERED, v) }); }} data-testid="disaster-count" style={{ width: '6.5em' }} />
        </label>
        <label className="inline" title="How far from your stroke they fall (a click: around the place)">within
          <input type="number" min={0} max={5000} step={10} value={d.brushKm} onChange={(e) => { const v = Number(e.target.value); if (v >= 0) set({ brushKm: Math.min(5000, v) }); }} data-testid="disaster-brush-km" /> km
        </label>
        <label className="inline" title={`Each a ${t.size.label.toLowerCase()} of its own, from the least to the most (as many small ones as large on a scale of ratios). The same twice: all alike.`}>{t.size.label} from
          <input type="number" min={t.size.min} max={t.size.max} step={t.size.step} value={d.least} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) set({ least: v }); }} data-testid="disaster-least" />
          to <input type="number" min={t.size.min} max={t.size.max} step={t.size.step} value={d.most} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) set({ most: v }); }} data-testid="disaster-most" /> {t.size.unit}
        </label>
        <label className="inline" title="They happen one by one over this time from the date (or the moment recorded), each at a moment of its own; 0: all at once">over
          <input type="number" min={0} max={100000} step={1} value={d.over} onChange={(e) => { const v = Number(e.target.value); if (v >= 0) set({ over: v }); }} data-testid="disaster-over" />
          <select value={d.overUnit} onChange={(e) => set({ overUnit: e.target.value as typeof d.overUnit })} data-testid="disaster-over-unit">
            <option value="hours">hours</option><option value="days">days</option><option value="months">months</option><option value="years">years</option>
          </select>
        </label>
      </>}
      {t.wind && (
        <label className="inline" title="The direction the wind carries its plume: 0 north, 90 east, 180 south, 270 west">Wind towards
          <input type="number" min={0} max={359} step={15} value={d.windDeg} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set({ windDeg: ((v % 360) + 360) % 360 }); }} data-testid="disaster-wind" /> °
        </label>
      )}
      {d.many
        ? <span className="muted" data-testid="disaster-hint">Drag across the map (or click): {d.count.toLocaleString('en')} {t.name.toLowerCase()}{d.count === 1 ? '' : 's'} scattered within {d.brushKm} km of the stroke, {d.over > 0 ? `one by one over ${d.over} ${d.overUnit}` : 'all at once'}, {rec ? `in "${rec.name}"` : `as a new event from ${fmt(s.time)}`}; spreading conditions as circles, no craters; one undo takes it all back.</span>
        : <span className="muted" data-testid="disaster-hint">{t.hint}. Click the map: {plan.name.toLowerCase()} {rec ? `in "${rec.name}"` : `as a new event from ${fmt(s.time)}`}{plan.crater && !terrain ? ' (no crater: this map has no terrain)' : ''}; one undo takes it all back.</span>}
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
