// The smart brushes in the interface (Stage 12, D148): their settings in the drawing tools' options, and the
// panel shown while a line just drawn is adjusted (its weights moved live, its side swapped, the line used,
// kept as drawn, or dropped).
import { RangeReset } from '../shell/Reset.tsx';
import { useStore } from '../store.ts';
import { smartOffered } from '../smart-input.ts';
import { SMART_FEATURES, SMART_MIN_RADIUS, SMART_MAX_RADIUS, DEFAULT_SMART, DEFAULT_WEIGHTS, type SmartSettings } from '../smart-settings.ts';
import type { SmartWeights } from '../../render-engine/smart-brush.ts';
import type { MapSpaceRow } from '../../world-model/schema.ts';

/** The features a map offers the brush in its mode. */
function featuresOn(space: MapSpaceRow | null | undefined, mode: SmartSettings['mode']) {
  const o = smartOffered(space);
  return SMART_FEATURES.filter((f) => (f.brush === 'both' || f.brush === mode) && (f.needs === 'any' || (f.needs === 'heights' ? o.heights : o[f.needs])));
}

/** A weight per feature, and the search radius: changed at once (and, while a line is adjusted, the line with them). */
export function SmartWeightsControls() {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  const sm = s.smart;
  const set = (patch: Partial<SmartSettings>) => s.setSmart({ ...sm, ...patch });
  const weight = (k: keyof SmartWeights, v: number) => set({ weights: { ...sm.weights, [k]: v } });
  return (
    <div className="smart-weights">
      {featuresOn(space, sm.mode).map((f) => (
        <label key={f.key} title={f.hint}>{f.name}
          <span className="row-inline amount">
            <input type="range" min={0} max={100} step={5} value={Math.round(sm.weights[f.key] * 100)} onChange={(e) => weight(f.key, Number(e.target.value) / 100)} data-testid={`smart-${f.key}`} /><RangeReset def={Math.round(DEFAULT_WEIGHTS[f.key] * 100)} value={Math.round(sm.weights[f.key] * 100)} />
            <span className="muted amount-value">{Math.round(sm.weights[f.key] * 100)}</span>
          </span>
        </label>
      ))}
      <label title="How far either side of your stroke the line may go (on screen)">Search radius
        <span className="row-inline amount">
          <input type="range" min={SMART_MIN_RADIUS} max={SMART_MAX_RADIUS} step={1} value={sm.radius} onChange={(e) => set({ radius: Number(e.target.value) })} data-testid="smart-radius" /><RangeReset def={DEFAULT_SMART.radius} value={sm.radius} />
          <span className="muted amount-value">{sm.radius} px</span>
        </span>
      </label>
    </div>
  );
}

/** "Smart brush" in the options of the brush, the pen, the Split tool and the features tool. */
export function SmartBrushControls() {
  const s = useStore();
  const sm = s.smart;
  const set = (patch: Partial<SmartSettings>) => s.setSmart({ ...sm, ...patch });
  return (
    <details className="brush-settings smart-brush" data-testid="smart-brush">
      <summary title="Lines you draw are pulled towards rivers, coasts, ridges and borders near them, as strongly as you set; you see the result before it is used">{sm.on ? (sm.mode === 'strategic' ? 'Strategic brush' : 'Geography-aware brush') : 'Smart brush'} ▾</summary>
      <div className="popover">
        <label className="check" title="After each line you draw, it is shown adjusted, with your stroke beside it: use it, keep yours, or change the weights first"><input type="checkbox" checked={sm.on} onChange={(e) => set({ on: e.target.checked })} data-testid="smart-on" /> Adjust the lines I draw</label>
        <div className="row-inline" role="radiogroup">
          <label className="check" title="Drawn to rivers, coasts, ridges and valleys, borders and the lines on the map's layers"><input type="radio" checked={sm.mode === 'geography'} onChange={() => set({ mode: 'geography' })} data-testid="smart-geography" /> Geography-aware</label>
          <label className="check" title="A military cost model with a side that is yours: rivers to their far bank, ridges to the crest, rough ground as a buffer; towns, your points and passes pulled onto your side"><input type="radio" checked={sm.mode === 'strategic'} onChange={() => set({ mode: 'strategic' })} data-testid="smart-strategic" /> Strategic</label>
        </div>
        <SmartWeightsControls />
        <p className="muted small-text">While a line is shown adjusted: click the map to pin a point it must pass through; click a pin to take it away. Hold Alt while drawing to keep that part as drawn.</p>
      </div>
    </details>
  );
}

/** The panel while a line just drawn is shown adjusted. */
export function SmartAdjustPanel() {
  const s = useStore();
  const a = s.adjust;
  if (!a) return null;
  const strategic = s.smart.mode === 'strategic';
  const outline = a.lines.every((l) => l.closed);
  return (
    <div className="smart-adjust" data-testid="smart-adjust" onPointerDown={(e) => e.stopPropagation()}>
      <div className="smart-adjust-head">
        <strong>{strategic ? 'Strategic brush' : 'Geography-aware brush'}</strong>
        <span className="muted" data-testid="smart-status">
          {!a.result ? ' working…' : a.followed ? ` · follows ${a.followed} stretch${a.followed === 1 ? '' : 'es'} of line` : ''}
          {a.pins.length ? ` · ${a.pins.length} pin${a.pins.length === 1 ? '' : 's'}` : ''}
          {a.missing.length ? ` · the ${a.missing.join(' and ')} still loading` : ''}
        </span>
      </div>
      <SmartWeightsControls />
      {strategic && (
        <div className="row-inline" data-testid="smart-side">
          <span className="muted">Your side: {outline ? 'the inside' : a.side === 1 ? 'left of the line as you drew it' : 'right of the line as you drew it'}</span>
          {!outline && <button className="small" onClick={() => s.set({ adjust: { ...a, side: a.side === 1 ? -1 : 1, result: null } })} data-testid="smart-swap">Swap sides</button>}
        </div>
      )}
      <div className="modal-actions">
        <button onClick={() => s.adjustFinish('cancel')} data-testid="smart-cancel">Cancel <span className="key">Esc</span></button>
        <button onClick={() => s.adjustFinish('drawn')} data-testid="smart-keep">Keep my line</button>
        <button className="primary" disabled={!a.result} onClick={() => s.adjustFinish('adjusted')} data-testid="smart-use">Use this line <span className="key">Enter</span></button>
      </div>
    </div>
  );
}
