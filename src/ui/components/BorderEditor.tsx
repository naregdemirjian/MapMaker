// How borders look (D183): the borders between countries and their edges against nobody, for a whole layer, and
// special borders between two named countries (from a country's panel): colour, width, dashes, a double line, a
// casing, ticks, a hand-drawn look, a soft edge, a glow and marching dashes.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { NumberField } from '../inputs.tsx';
import { DASHES, DASH_NAMES, DEFAULT_BORDER, layerBordersOf, pairKey, type BorderStyle, type DashKind, type LayerBorders } from '../../render-engine/border-look.ts';

/** An editor of one border style. */
export function BorderStyleEditor({ value, onChange, idPrefix }: { value: BorderStyle; onChange: (next: BorderStyle) => void; idPrefix: string }) {
  const set = (patch: Partial<BorderStyle>) => onChange({ ...value, ...patch });
  const n = (key: keyof BorderStyle, label: string, min: number, max: number, step: number, title?: string) => (
    <label title={title}>{label}<NumberField min={min} max={max} step={step} value={value[key] as number} def={typeof DEFAULT_BORDER[key] === 'number' ? DEFAULT_BORDER[key] as number : undefined} onCommit={(x) => set({ [key]: x } as Partial<BorderStyle>)} testId={`${idPrefix}-${key}`} /></label>
  );
  return (
    <div className="border-style effect-fields" data-testid={`${idPrefix}-style`}>
      <label title="Its colour (untick: the map's border colour)">Colour
        <span className="inline">
          <input type="checkbox" checked={value.color !== null} onChange={(e) => set({ color: e.target.checked ? '#101820' : null })} />
          {value.color !== null && <input type="color" value={value.color} onChange={(e) => set({ color: e.target.value })} data-testid={`${idPrefix}-color`} />}
        </span>
      </label>
      <label title="Width (empty: the layer's border width)">Width
        <NumberField min={0} max={40} step={0.25} value={value.width ?? 0} def={DEFAULT_BORDER.width ?? 0} onCommit={(x) => set({ width: x > 0 ? x : null })} testId={`${idPrefix}-width`} />
      </label>
      <label>Strength (%)<NumberField min={0} max={100} step={5} value={Math.round(value.opacity * 100)} def={Math.round(DEFAULT_BORDER.opacity * 100)} onCommit={(x) => set({ opacity: x / 100 })} /></label>
      <label>Dashes
        <select value={value.dash} onChange={(e) => set({ dash: e.target.value as DashKind })} data-testid={`${idPrefix}-dash`}>
          {DASHES.map((d) => <option key={d} value={d}>{DASH_NAMES[d]}</option>)}
        </select>
      </label>
      {value.dash !== 'solid' && n('dashScale', 'Dash length (×)', 0.25, 8, 0.25)}
      {value.dash !== 'solid' && n('march', 'Marching (px/s)', -400, 400, 5, 'The dashes move along the border as time on screen passes (0: still)')}
      {n('double', 'Double line gap', 0, 30, 0.5, 'Two lines with this gap between them (0: one line)')}
      {n('casing', 'Casing', 0, 30, 0.5, 'A wider line under it in another colour (0: none)')}
      {value.casing > 0 && <label>Casing colour<input type="color" value={value.casingColor} onChange={(e) => set({ casingColor: e.target.value })} /></label>}
      {n('ticks', 'Ticks every (px)', 0, 200, 1, 'Short lines across it, as on old maps\' frontiers and railways (0: none)')}
      {value.ticks > 0 && n('tickLength', 'Tick length', 1, 40, 0.5)}
      {n('sketch', 'Hand-drawn', 0, 3, 1, 'Drawn as if by hand: up to three strokes a little apart')}
      {n('soft', 'Soft edge', 0, 40, 0.5, 'The line softened by so many pixels')}
      {n('glow', 'Glow', 0, 80, 1, 'A glow round the line (0: none)')}
      {value.glow > 0 && <label>Glow colour<input type="color" value={value.glowColor} onChange={(e) => set({ glowColor: e.target.value })} /></label>}
    </div>
  );
}

const bordersOfLayer = (style: string): LayerBorders => layerBordersOf(parseJSON<{ borders?: unknown }>(style, {}).borders) ?? { between: null, coast: null, pairs: [] };

/** A layer's borders: between countries, and against nobody (coasts and unclaimed land). */
export function LayerBordersSection({ layerId }: { layerId: string }) {
  const s = useStore();
  const l = s.world!.get('layer', layerId);
  if (!l) return null;
  const b = bordersOfLayer(l.style);
  const save = (next: LayerBorders) => s.execute((w) => cmd.setLayerBorders(w, layerId, next));
  const part = (key: 'between' | 'coast', title: string) => (
    <details>
      <summary>{title}{b[key] ? ' (styled)' : ''}</summary>
      <BorderStyleEditor value={b[key] ?? DEFAULT_BORDER} onChange={(v) => save({ ...b, [key]: v })} idPrefix={`border-${key}`} />
      {b[key] && <button className="small" onClick={() => save({ ...b, [key]: null })}>Plain line again</button>}
    </details>
  );
  return (
    <details className="layer-option layer-borders" data-testid="layer-borders">
      <summary>Borders{b.between || b.coast || b.pairs.length ? ' (styled)' : ''}</summary>
      {part('between', 'Between countries')}
      {part('coast', 'Against nobody (coasts, unclaimed land)')}
      {b.pairs.length > 0 && <p className="muted">{b.pairs.length} special border{b.pairs.length === 1 ? '' : 's'} between two countries (in their panels).</p>}
    </details>
  );
}

/** Special borders between this country and others, on the layer being drawn on. */
export function CountryBordersSection({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const layer = w.get('layer', s.layerId);
  const [other, setOther] = useState('');
  if (!layer || layer.kind !== 'partition') return null;
  const b = bordersOfLayer(layer.style);
  const mine = b.pairs.filter((p) => p.a === id || p.b === id);
  const others = w.all('entity').filter((e) => (e.type_id === 'polity' || e.type_id === 'faction') && e.id !== id && !mine.some((p) => p.a === e.id || p.b === e.id)).sort((x, y) => x.name.localeCompare(y.name));
  const save = (pairs: LayerBorders['pairs']) => s.execute((wd) => cmd.setLayerBorders(wd, layer.id, { ...b, pairs }));
  return (
    <details className="country-borders" open={mine.length > 0}>
      <summary>Special borders{mine.length ? ` (${mine.length})` : ''}</summary>
      {mine.map((p) => {
        const o = w.get('entity', p.a === id ? p.b : p.a);
        return (
          <div key={pairKey(p.a, p.b)} className="effect" data-testid="pair-border">
            <div className="effect-head"><strong>With {o?.name ?? '?'}</strong>
              <button className="small danger" onClick={() => save(b.pairs.filter((q) => pairKey(q.a, q.b) !== pairKey(p.a, p.b)))} title="An ordinary border again">✕</button>
            </div>
            <BorderStyleEditor value={p.style} onChange={(v) => save(b.pairs.map((q) => (pairKey(q.a, q.b) === pairKey(p.a, p.b) ? { ...q, style: v } : q)))} idPrefix="pair" />
          </div>
        );
      })}
      <label className="inline" title="A border of its own between this country and another, on the layer being drawn on: a ceasefire line, an empire's frontier">With
        <select value={other} onChange={(e) => setOther(e.target.value)} data-testid="pair-border-other">
          <option value="">Choose a country…</option>
          {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="small" disabled={!other} onClick={() => { save([...b.pairs, { a: id, b: other, style: { ...DEFAULT_BORDER, color: '#d62828', dash: 'dashed', width: 2.5 } }]); setOther(''); }} data-testid="pair-border-add">Add</button>
      </label>
    </details>
  );
}
