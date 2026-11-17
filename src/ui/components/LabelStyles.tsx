// Editing the look of country labels: the general style (all labels) and each country's own.
import { useEffect, useState } from 'react';
import { useStore } from '../store.ts';
import { NumberField } from './Panels.tsx';
import * as cmd from '../../domain/commands.ts';
import { resolveLabelStyle, labelFont, labelText, LABEL_FONTS, type LabelStyle, type CountryLabel } from '../../render-engine/label-style.ts';

/** A slider that previews while dragging and saves once, when let go (one undo step). */
function Slider({ value, min, max, step, onCommit, format, testId }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void; format?: (v: number) => string; testId?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid={testId} />
      <span className="slider-value">{format ? format(v) : v}</span>
    </span>
  );
}

/** All label settings, showing `value` and reporting each change as one field. */
export function LabelStyleEditor({ value, onChange, idPrefix }: { value: LabelStyle; onChange: (patch: Partial<LabelStyle>) => void; idPrefix: string }) {
  const fonts = LABEL_FONTS.includes(value.font) ? LABEL_FONTS : [value.font, ...LABEL_FONTS];
  return (
    <div className="label-editor">
      <label>Font<select value={value.font} onChange={(e) => onChange({ font: e.target.value })} data-testid={`${idPrefix}-font`}>
        {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
      </select></label>
      <div className="two">
        <label>Weight<select value={value.weight} onChange={(e) => onChange({ weight: Number(e.target.value) })} data-testid={`${idPrefix}-weight`}>
          <option value={300}>Light</option><option value={400}>Regular</option><option value={600}>Semibold</option><option value={700}>Bold</option><option value={900}>Black</option>
        </select></label>
        <label>Opacity<Slider value={value.opacity} min={0} max={1} step={0.05} onCommit={(v) => onChange({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} /></label>
      </div>
      <div className="checks">
        <label className="check"><input type="checkbox" checked={value.italic} onChange={(e) => onChange({ italic: e.target.checked })} /> Italic</label>
        <label className="check"><input type="checkbox" checked={value.uppercase} onChange={(e) => onChange({ uppercase: e.target.checked })} data-testid={`${idPrefix}-uppercase`} /> CAPITALS</label>
      </div>
      <label>Letter spacing<Slider value={value.letterSpacing} min={-0.1} max={0.6} step={0.01} onCommit={(v) => onChange({ letterSpacing: v })} format={(v) => v.toFixed(2)} /></label>
      <div className="two">
        <label>Colour<input type="color" value={value.color} onChange={(e) => onChange({ color: e.target.value })} data-testid={`${idPrefix}-color`} /></label>
        <label>Outline colour<input type="color" value={value.haloColor} onChange={(e) => onChange({ haloColor: e.target.value })} /></label>
      </div>
      <label>Outline width<Slider value={value.haloWidth} min={0} max={0.5} step={0.01} onCommit={(v) => onChange({ haloWidth: v })} format={(v) => (v === 0 ? 'none' : v.toFixed(2))} /></label>
      <label>Size<Slider value={value.sizeScale} min={0.2} max={4} step={0.05} onCommit={(v) => onChange({ sizeScale: v })} format={(v) => `${Math.round(v * 100)}%`} testId={`${idPrefix}-size`} /></label>
      <div className="two">
        <label>Smallest (px)<input type="number" min={2} max={400} value={value.minSize} onChange={(e) => Number(e.target.value) > 0 && onChange({ minSize: Number(e.target.value) })} /></label>
        <label>Largest (px)<input type="number" min={2} max={400} value={value.maxSize} onChange={(e) => Number(e.target.value) > 0 && onChange({ maxSize: Number(e.target.value) })} /></label>
      </div>
      <p className="muted">Sizes are in pixels of a 1920-wide frame; other sizes scale with the frame.</p>
    </div>
  );
}

/** A small sample of a label in a style. */
function Preview({ style, text }: { style: LabelStyle; text: string }) {
  const size = 26;
  return (
    <div className="label-preview">
      <span style={{
        font: labelFont(style, size), letterSpacing: `${style.letterSpacing * size}px`, color: style.color, opacity: style.opacity,
        WebkitTextStroke: style.haloWidth > 0 ? `${(style.haloWidth * size).toFixed(1)}px ${style.haloColor}` : undefined, paintOrder: 'stroke fill',
      }}>{text}</span>
    </div>
  );
}

/** The general label style: the look of every country label that has no look of its own. */
export function LabelStyleDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const w = s.world!;
  const stored = cmd.generalLabelStyle(w);
  const style = resolveLabelStyle(stored);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Label style" data-testid="label-style-dialog">
        <div className="modal-head"><h2>Label style (all countries)</h2><button className="close" onClick={onClose} aria-label="Close">×</button></div>
        <p className="muted">The look of every country label. A country can have its own look: select it and open “Label”.</p>
        <Preview style={style} text={labelText('Kingdom of Varn', style)} />
        <LabelStyleEditor value={style} onChange={(patch) => s.execute((wd) => cmd.setGeneralLabelStyle(wd, patch))} idPrefix="general-label" />
        <h4>Cities and characters</h4>
        <p className="muted">They grow as you zoom in and shrink as you zoom out; city names too small to read are left out. Their size overall:</p>
        <div className="two">
          <label>Cities (%)<NumberField min={25} max={400} step={5} value={Math.round(cmd.pointStyle(w).city * 100)} onCommit={(n) => s.execute((wd) => cmd.setPointStyle(wd, { city: n / 100 }))} testId="city-size" /></label>
          <label>Characters (%)<NumberField min={25} max={400} step={5} value={Math.round(cmd.pointStyle(w).character * 100)} onCommit={(n) => s.execute((wd) => cmd.setPointStyle(wd, { character: n / 100 }))} testId="character-size" /></label>
        </div>
        <div className="modal-actions">
          <button onClick={() => s.execute((wd) => cmd.setGeneralLabelStyle(wd, Object.fromEntries(Object.keys(stored).map((k) => [k, null]))))} disabled={!Object.keys(stored).length}>Reset to default</button>
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** A country's label: shown or hidden, its text, and its own look (or the general one). */
export function CountryLabelSection({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const e = w.get('entity', id);
  const own: CountryLabel = cmd.entityStyle(e).label ?? {};
  const [text, setText] = useState(own.text ?? '');
  useEffect(() => setText(own.text ?? ''), [id, own.text]);
  if (!e) return null;
  const general = cmd.generalLabelStyle(w);
  const effective = resolveLabelStyle(general, own);
  const lookKeys = Object.keys(own).filter((k) => k !== 'hidden' && k !== 'text');
  const save = (next: CountryLabel) => s.execute((wd) => cmd.setEntityStyle(wd, id, { label: next }));
  return (
    <div className="country-label" data-testid="country-label">
      <h4>Label</h4>
      <label className="check"><input type="checkbox" checked={!own.hidden} onChange={(ev) => save({ ...own, hidden: ev.target.checked ? undefined : true })} data-testid="label-shown" /> Show the label</label>
      {!own.hidden && <>
        <label>Label text<input value={text} placeholder={e.name} onChange={(ev) => setText(ev.target.value)} onBlur={() => text !== (own.text ?? '') && save({ ...own, text: text || undefined })} data-testid="label-text" /></label>
        <Preview style={effective} text={labelText(e.name, effective, own)} />
        <details className="own-look" open={lookKeys.length > 0}>
          <summary>{lookKeys.length ? `Own look (${lookKeys.length} setting${lookKeys.length === 1 ? '' : 's'} differ from all labels)` : 'Own look (same as all labels)'}</summary>
          <LabelStyleEditor value={effective} onChange={(patch) => save({ ...own, ...patch })} idPrefix="country-label" />
          <div className="buttons">
            <button className="small" disabled={!lookKeys.length} onClick={() => save({ hidden: own.hidden, text: own.text })} data-testid="label-reset">Use the look of all labels</button>
            <button className="small" onClick={() => s.set({ dialog: 'label-style' })}>Edit the look of all labels…</button>
          </div>
        </details>
      </>}
    </div>
  );
}
