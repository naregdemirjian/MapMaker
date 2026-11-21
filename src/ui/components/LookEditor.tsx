// The look of countries beyond their colour (D181): a country's own, or the look of every country of a layer. Its
// elevation (who casts shadows on whom), the strength of its fill, the layer's blend mode, and a stack of effects
// (drop shadows, strokes…) added, turned on and off, reordered and set, as in a photo editor's layer styles.
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { NumberField } from './Panels.tsx';
import {
  BLEND_MODES, EFFECT_DEFAULTS, EFFECT_NAMES, countryLookOf, layerLookOf,
  type BlendMode, type CountryLook, type Effect, type EffectKind, type LayerLook,
} from '../../render-engine/country-look.ts';

const BLEND_NAMES: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', 'soft-light': 'Soft light', 'hard-light': 'Hard light',
  darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'Colour dodge', 'color-burn': 'Colour burn', difference: 'Difference', exclusion: 'Exclusion',
  hue: 'Hue', saturation: 'Saturation', color: 'Colour', luminosity: 'Luminosity',
};

/** The settings of each kind of effect: field, label, unit, range and step (a colour when no range). */
type Field = { key: string; label: string; min?: number; max?: number; step?: number; percent?: boolean; colour?: boolean; choices?: Array<[string, string]> };
const FIELDS: Record<EffectKind, Field[]> = {
  shadow: [
    { key: 'color', label: 'Colour', colour: true }, { key: 'opacity', label: 'Strength (%)', percent: true },
    { key: 'angle', label: 'Light from (°)', min: -360, max: 360, step: 5 }, { key: 'distance', label: 'Distance', min: 0, max: 200, step: 1 },
    { key: 'blur', label: 'Blur', min: 0, max: 200, step: 1 }, { key: 'spread', label: 'Spread', min: 0, max: 100, step: 1 },
  ],
  stroke: [
    { key: 'color', label: 'Colour', colour: true }, { key: 'opacity', label: 'Strength (%)', percent: true },
    { key: 'width', label: 'Width', min: 0, max: 60, step: 0.5 },
    { key: 'position', label: 'Where', choices: [['inside', 'Inside the edge'], ['center', 'On the edge'], ['outside', 'Outside the edge']] },
  ],
};

const EMPTY: CountryLook = { elevation: 0, opacity: 1, effects: [] };

/** An editor of a look: `blend` for a layer's. */
export function LookEditor({ value, onChange, blend, idPrefix }: { value: CountryLook | LayerLook; onChange: (next: CountryLook | LayerLook) => void; blend?: boolean; idPrefix: string }) {
  const set = (patch: Partial<LayerLook>) => onChange({ ...value, ...patch });
  const setEffect = (i: number, patch: Partial<Effect>) => set({ effects: value.effects.map((e, k) => (k === i ? ({ ...e, ...patch } as Effect) : e)) });
  const move = (i: number, by: number) => {
    const list = [...value.effects], j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ effects: list });
  };
  return (
    <div className="look-editor" data-testid={`${idPrefix}-look`}>
      <div className="two">
        <label title="Higher countries are drawn over lower ones and cast their shadows on them; countries of the same elevation never shade each other">Elevation
          <NumberField min={-100} max={100} step={1} value={value.elevation} onCommit={(n) => set({ elevation: Math.round(n) })} testId={`${idPrefix}-elevation`} />
        </label>
        <label title="How strongly the fill shows; its effects keep their own strength">Fill (%)
          <NumberField min={0} max={100} step={5} value={Math.round(value.opacity * 100)} onCommit={(n) => set({ opacity: n / 100 })} testId={`${idPrefix}-fill-opacity`} />
        </label>
      </div>
      {blend && (
        <label title="How the layer's colours are laid on the map under them: Multiply lets the relief show through, Screen lightens, Colour keeps the map's light and shade">Blend
          <select value={(value as LayerLook).blend ?? 'normal'} onChange={(e) => set({ blend: e.target.value as BlendMode })} data-testid={`${idPrefix}-blend`}>
            {BLEND_MODES.map((b) => <option key={b} value={b}>{BLEND_NAMES[b]}</option>)}
          </select>
        </label>
      )}
      <ul className="effects">
        {value.effects.map((e, i) => (
          <li key={i} className={`effect ${e.on ? '' : 'off'}`} data-testid={`${idPrefix}-effect`}>
            <div className="effect-head">
              <label className="check"><input type="checkbox" checked={e.on} onChange={(ev) => setEffect(i, { on: ev.target.checked })} title="Turn this effect on or off" /> {EFFECT_NAMES[e.kind]}</label>
              <span className="buttons">
                <button className="small" disabled={i === 0} onClick={() => move(i, -1)} title="Drawn earlier (under the effects after it)">↑</button>
                <button className="small" disabled={i === value.effects.length - 1} onClick={() => move(i, 1)} title="Drawn later (over the effects before it)">↓</button>
                <button className="small" onClick={() => set({ effects: [...value.effects.slice(0, i + 1), { ...e }, ...value.effects.slice(i + 1)] })} title="Another like it">⧉</button>
                <button className="small danger" onClick={() => set({ effects: value.effects.filter((_, k) => k !== i) })} title="Remove this effect" data-testid={`${idPrefix}-effect-remove`}>✕</button>
              </span>
            </div>
            {e.on && (
              <div className="effect-fields">
                {FIELDS[e.kind].map((f) => {
                  const v = (e as unknown as Record<string, unknown>)[f.key];
                  if (f.colour) return <label key={f.key}>{f.label}<input type="color" value={v as string} onChange={(ev) => setEffect(i, { [f.key]: ev.target.value } as Partial<Effect>)} /></label>;
                  if (f.choices) return (
                    <label key={f.key}>{f.label}
                      <select value={v as string} onChange={(ev) => setEffect(i, { [f.key]: ev.target.value } as Partial<Effect>)}>
                        {f.choices.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                      </select>
                    </label>
                  );
                  if (f.percent) return <label key={f.key}>{f.label}<NumberField min={0} max={100} step={5} value={Math.round((v as number) * 100)} onCommit={(n) => setEffect(i, { [f.key]: n / 100 } as Partial<Effect>)} /></label>;
                  return <label key={f.key}>{f.label}<NumberField min={f.min} max={f.max} step={f.step} value={v as number} onCommit={(n) => setEffect(i, { [f.key]: n } as Partial<Effect>)} testId={`${idPrefix}-${e.kind}-${f.key}`} /></label>;
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
      <label className="inline">Add an effect
        <select value="" onChange={(ev) => { const k = ev.target.value as EffectKind; if (k) set({ effects: [...value.effects, { ...EFFECT_DEFAULTS[k] } as Effect] }); }} data-testid={`${idPrefix}-add-effect`}>
          <option value="">Choose…</option>
          {(Object.keys(EFFECT_NAMES) as EffectKind[]).map((k) => <option key={k} value={k}>{EFFECT_NAMES[k]}</option>)}
        </select>
      </label>
    </div>
  );
}

/** A country's look of its own, in its panel. */
export function CountryLookSection({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('entity', id);
  if (!e) return null;
  const own = countryLookOf(cmd.entityStyle(e).look);
  return (
    <details className="country-look" open={!!own}>
      <summary>{own ? 'Look (its own)' : 'Look (as its layer)'}</summary>
      <LookEditor value={own ?? EMPTY} onChange={(next) => s.execute((w) => cmd.setCountryLook(w, id, next))} idPrefix="country" />
      {own && <button className="small" onClick={() => s.execute((w) => cmd.setCountryLook(w, id, null))} data-testid="country-look-reset">Look like its layer again</button>}
    </details>
  );
}

/** The look of every country of a layer without one of its own, and how the layer is laid on the map. */
export function LayerLookSection({ layerId }: { layerId: string }) {
  const s = useStore();
  const l = s.world!.get('layer', layerId);
  if (!l) return null;
  const look = layerLookOf(parseJSON<{ look?: unknown }>(l.style, {}).look);
  return (
    <details className="layer-option layer-look">
      <summary>{look ? 'Look of its countries (set)' : 'Look of its countries'}</summary>
      <LookEditor value={look ?? { ...EMPTY, blend: 'normal' }} blend onChange={(next) => s.execute((w) => cmd.setLayerEffects(w, layerId, next as LayerLook))} idPrefix="layer" />
      {look && <button className="small" onClick={() => s.execute((w) => cmd.setLayerEffects(w, layerId, null))}>No look</button>}
    </details>
  );
}
