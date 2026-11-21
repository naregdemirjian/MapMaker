// The look of countries beyond their colour (D181): a country's own, or the look of every country of a layer. Its
// elevation (who casts shadows on whom), the strength of its fill, the layer's blend mode, and a stack of effects
// (drop shadows, strokes…) added, turned on and off, reordered and set, as in a photo editor's layer styles.
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { mapLightOf, statisticsOf } from '../../world-model/world-settings.ts';
import { NumberField, DateField } from './Panels.tsx';
import {
  BLEND_MODES, BLEND_NAMES, EFFECTS, EFFECT_DEFAULTS, EFFECT_KINDS, EFFECT_NAMES, PRESET_FILE_KIND, countryLookOf, layerLookOf, lookPresetsOf, takesMapLight,
  type BlendMode, type CountryLook, type Effect, type EffectKind, type LayerLook, type Motion, type Pulse, type Ease,
} from '../../render-engine/country-look.ts';

/** The settings of an effect that can change over time (numbers and strengths), as [key, label, percent?]. */
const movable = (kind: EffectKind) => EFFECTS[kind].fields.flatMap((f) => (f.type === 'number' || f.type === 'percent' ? [[f.key, f.label, f.type === 'percent'] as const] : []));
const EASES: Array<[Ease, string]> = [['smooth', 'Ease in and out'], ['linear', 'Even'], ['in', 'Slow, then fast'], ['out', 'Fast, then slow']];

/**
 * How an effect's settings change (D185): over history, from one value to another between two dates, eased; and as
 * time on screen passes, a pulse (even) or a flicker (uneven) about its value.
 */
function EffectMotion({ e, onChange, idPrefix }: { e: Effect; onChange: (patch: Partial<Effect>) => void; idPrefix: string }) {
  const s = useStore();
  const fields = movable(e.kind);
  if (!fields.length) return null;
  const motions = e.motions ?? [], pulses = e.pulses ?? [];
  const val = (k: string) => (e as unknown as Record<string, number>)[k];
  const pct = (k: string) => fields.find((f) => f[0] === k)?.[2] ?? false;
  const shown = (k: string, v: number) => (pct(k) ? Math.round(v * 100) : v);
  const stored = (k: string, n: number) => (pct(k) ? n / 100 : n);
  const setMotion = (i: number, patch: Partial<Motion>) => onChange({ motions: motions.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  const setPulse = (i: number, patch: Partial<Pulse>) => onChange({ pulses: pulses.map((q, k) => (k === i ? { ...q, ...patch } : q)) });
  const fieldSelect = (value: string, put: (k: string) => void) => (
    <select value={value} onChange={(ev) => put(ev.target.value)}>{fields.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
  );
  return (
    <details className="effect-motion" open={motions.length + pulses.length > 0}>
      <summary>Changes over time{motions.length + pulses.length ? ` (${motions.length + pulses.length})` : ''}</summary>
      {motions.map((m, i) => (
        <div key={`m${i}`} className="effect-fields motion" data-testid={`${idPrefix}-motion`}>
          <label>Setting{fieldSelect(m.field, (k) => setMotion(i, { field: k, from: val(k), to: val(k) }))}</label>
          <label>From<NumberField step={1} value={shown(m.field, m.from)} onCommit={(n) => setMotion(i, { from: stored(m.field, n) })} testId={`${idPrefix}-motion-from`} /></label>
          <label>To<NumberField step={1} value={shown(m.field, m.to)} onCommit={(n) => setMotion(i, { to: stored(m.field, n) })} testId={`${idPrefix}-motion-to`} /></label>
          <label>On<DateField value={{ day: m.start[0], ms: m.start[1] }} onChange={(t) => t && setMotion(i, { start: [t.day, t.ms] })} /></label>
          <label>until<DateField value={{ day: m.end[0], ms: m.end[1] }} onChange={(t) => t && setMotion(i, { end: [t.day, t.ms] })} /></label>
          <label>Pace<select value={m.ease} onChange={(ev) => setMotion(i, { ease: ev.target.value as Ease })}>{EASES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          <button className="small danger" onClick={() => onChange({ motions: motions.filter((_, k) => k !== i) })} title="Remove this change">✕</button>
        </div>
      ))}
      {pulses.map((q, i) => (
        <div key={`p${i}`} className="effect-fields motion" data-testid={`${idPrefix}-pulse`}>
          <label>Setting{fieldSelect(q.field, (k) => setPulse(i, { field: k }))}</label>
          <label title="How far it moves either side of its value">By<NumberField min={0} step={1} value={shown(q.field, q.amount)} onCommit={(n) => setPulse(i, { amount: stored(q.field, n) })} testId={`${idPrefix}-pulse-amount`} /></label>
          <label title="Seconds on screen for one beat">Every (s)<NumberField min={0.05} max={120} step={0.05} value={q.period} onCommit={(n) => setPulse(i, { period: n })} /></label>
          <label>As<select value={q.kind} onChange={(ev) => setPulse(i, { kind: ev.target.value as Pulse['kind'] })}><option value="sine">A pulse (even)</option><option value="wiggle">A flicker (uneven)</option></select></label>
          <button className="small danger" onClick={() => onChange({ pulses: pulses.filter((_, k) => k !== i) })} title="Remove this pulse">✕</button>
        </div>
      ))}
      <div className="buttons">
        <button className="small" onClick={() => { const [k] = fields[0]; onChange({ motions: [...motions, { field: k, from: val(k), to: val(k), start: [s.time.day, s.time.ms], end: [s.time.day + 3653, s.time.ms], ease: 'smooth' }] }); }} data-testid={`${idPrefix}-add-motion`} title="From one value to another between two dates of history">Change through history</button>
        <button className="small" onClick={() => { const [k, , p] = fields[0]; onChange({ pulses: [...pulses, { field: k, amount: p ? 0.25 : Math.max(1, Math.abs(val(k)) / 2), period: 1, kind: 'sine' }] }); }} data-testid={`${idPrefix}-add-pulse`} title="Moving as time on screen passes, as a heartbeat or a flicker">Pulse on screen</button>
      </div>
    </details>
  );
}

const EMPTY: CountryLook = { elevation: 0, opacity: 1, effects: [] };

/** An editor of a look: `blend` for a layer's. */
export function LookEditor({ value, onChange, blend, idPrefix }: { value: CountryLook | LayerLook; onChange: (next: CountryLook | LayerLook) => void; blend?: boolean; idPrefix: string }) {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  const statNames = statisticsOf(space).map((x) => x.name);
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
                {EFFECTS[e.kind].fields.map((f) => {
                  const v = (e as unknown as Record<string, unknown>)[f.key];
                  const put = (x: unknown) => setEffect(i, { [f.key]: x } as Partial<Effect>);
                  if (f.type === 'colour') return <label key={f.key}>{f.label}<input type="color" value={v as string} onChange={(ev) => put(ev.target.value)} data-testid={`${idPrefix}-${e.kind}-${f.key}`} /></label>;
                  if (f.type === 'choice') return (
                    <label key={f.key}>{f.label}
                      <select value={v as string} onChange={(ev) => put(ev.target.value)} data-testid={`${idPrefix}-${e.kind}-${f.key}`}>
                        {f.choices.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                      </select>
                    </label>
                  );
                  if (f.type === 'percent') return <label key={f.key}>{f.label}<NumberField min={0} max={100} step={5} value={Math.round((v as number) * 100)} onCommit={(n) => put(n / 100)} testId={`${idPrefix}-${e.kind}-${f.key}`} /></label>;
                  return <label key={f.key}>{f.label}<NumberField min={f.min} max={f.max} step={f.step} value={v as number} onCommit={put} testId={`${idPrefix}-${e.kind}-${f.key}`} /></label>;
                })}
              </div>
            )}
            {e.on && e.kind === 'extrude' && (
              <label className="slab-stat" title={'A statistic of this map: the slab is as tall as its share of the highest value. "{country}" stands for each country\'s name ("Population of {country}"), so one look raises every country by its own'}>Height from a statistic
                <input list={`${idPrefix}-stats`} value={e.stat ?? ''} placeholder="(none: the height above)" onChange={(ev) => setEffect(i, { stat: ev.target.value || undefined } as Partial<Effect>)} data-testid={`${idPrefix}-extrude-stat`} />
                <datalist id={`${idPrefix}-stats`}>{statNames.map((n) => <option key={n} value={n} />)}</datalist>
              </label>
            )}
            {e.on && 'light' in e && e.light === 'map' && <p className="muted small-text">The map's light comes from {mapLightOf(space)}°.</p>}
            {e.on && <EffectMotion e={e} onChange={(patch) => setEffect(i, patch)} idPrefix={`${idPrefix}-${i}`} />}
          </li>
        ))}
      </ul>
      <label className="inline">Add an effect
        <select value="" onChange={(ev) => { const k = ev.target.value as EffectKind; if (k) set({ effects: [...value.effects, { ...EFFECT_DEFAULTS[k], ...(takesMapLight(k) ? { light: 'map' } : {}) } as Effect] }); }} data-testid={`${idPrefix}-add-effect`}>
          <option value="">Choose…</option>
          {EFFECT_KINDS.map((k) => <option key={k} value={k}>{EFFECT_NAMES[k]}</option>)}
        </select>
      </label>
    </div>
  );
}

/**
 * Looks kept under names (D185): one used on what is being edited, the look being edited kept, kept looks forgotten,
 * and all of them saved to a file or added from one (another project's).
 */
function LookPresets({ current, onUse, useLabel, idPrefix }: { current: CountryLook | null; onUse: (look: CountryLook, name: string) => void; useLabel: string; idPrefix: string }) {
  const s = useStore();
  const presets = cmd.lookPresets(s.world!);
  const save = async () => {
    if (!current) return;
    const name = await s.askText('Keep this look', 'Name of the look (for example "Raised, gold edge")', '', 'Keep');
    if (name) s.execute((w) => cmd.saveLookPreset(w, name, current));
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ kind: PRESET_FILE_KIND, presets: presets.map(({ name, look }) => ({ name, look })) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'looks.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    let json: unknown = null;
    try { json = JSON.parse(await file.text()); } catch { s.toast('That file is not a file of looks.', 'error'); return; }
    if (!lookPresetsOf(json).length) { s.toast('There are no looks in that file.', 'error'); return; }
    const n = s.execute((w) => cmd.importLookPresets(w, json));
    if (n) s.toast(n === 1 ? 'One look added.' : `${n} looks added.`);
  };
  return (
    <div className="look-presets" data-testid={`${idPrefix}-presets`}>
      <div className="buttons">
        {presets.length > 0 && (
          <select value="" onChange={(ev) => { const p = presets.find((x) => x.id === ev.target.value); if (p) onUse(p.look, p.name); }} data-testid={`${idPrefix}-preset-use`} title={useLabel}>
            <option value="">{useLabel}…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button className="small" disabled={!current} onClick={save} data-testid={`${idPrefix}-preset-save`} title="Keep this look under a name, to give it to other countries">Keep this look…</button>
      </div>
      {presets.length > 0 && (
        <details>
          <summary>Kept looks ({presets.length})</summary>
          <ul className="presets">
            {presets.map((p) => (
              <li key={p.id}><span>{p.name}</span> <button className="small danger" onClick={() => s.execute((w) => cmd.deleteLookPreset(w, p.id))} title="Forget this look (countries keep theirs)">✕</button></li>
            ))}
          </ul>
          <button className="small" onClick={download} data-testid={`${idPrefix}-preset-export`}>Save them to a file</button>
        </details>
      )}
      <label className="small file-pick" title="Looks saved from another project">Add looks from a file
        <input type="file" accept=".json,application/json" onChange={(ev) => { void upload(ev.target.files?.[0]); ev.target.value = ''; }} data-testid={`${idPrefix}-preset-import`} />
      </label>
    </div>
  );
}

/** Where the map's one light comes from (D186): every shadow and bevel set to the map's light turns with it. */
function MapLightField({ idPrefix }: { idPrefix: string }) {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  if (!space) return null;
  return (
    <label className="inline" title="Shadows, inner shadows and bevels set to the map's light fall away from it, all at once">The map's light from (°)
      <NumberField min={-360} max={360} step={5} value={mapLightOf(space)} onCommit={(n) => s.execute((w) => cmd.setMapLight(w, space.id, n))} testId={`${idPrefix}-map-light`} />
    </label>
  );
}

/** A country's look of its own, in its panel. */
export function CountryLookSection({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('entity', id);
  if (!e) return null;
  const own = countryLookOf(cmd.entityStyle(e).look);
  // (A kept look goes to every country chosen, when several are.)
  const chosen = s.chosen('entity').filter((x) => { const t = s.world!.get('entity', x)?.type_id; return t === 'polity' || t === 'faction'; });
  const targets = chosen.includes(id) ? chosen : [id];
  return (
    <details className="country-look" open={!!own}>
      <summary>{own ? 'Look (its own)' : 'Look (as its layer)'}</summary>
      <LookEditor value={own ?? EMPTY} onChange={(next) => s.execute((w) => cmd.setCountryLook(w, id, next))} idPrefix="country" />
      {own?.effects.some((x) => 'light' in x && x.light === 'map') && <MapLightField idPrefix="country" />}
      {own && <button className="small" onClick={() => s.execute((w) => cmd.setCountryLook(w, id, null))} data-testid="country-look-reset">Look like its layer again</button>}
      <LookPresets current={own} idPrefix="country" useLabel={targets.length > 1 ? `Give the ${targets.length} chosen a kept look` : 'Give it a kept look'}
        onUse={(look, name) => s.execute((w) => cmd.setCountriesLook(w, targets, look, `the look "${name}"`))} />
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
      <MapLightField idPrefix="layer" />
      {look && <button className="small" onClick={() => s.execute((w) => cmd.setLayerEffects(w, layerId, null))}>No look</button>}
      <LookPresets current={look} idPrefix="layer" useLabel="Use a kept look" onUse={(kept) => s.execute((w) => cmd.setLayerEffects(w, layerId, { ...kept, blend: look?.blend ?? 'normal' }))} />
    </details>
  );
}
