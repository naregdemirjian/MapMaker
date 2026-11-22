// The look of a shot's graphics (D184): the events box, a text box. Templates set a whole look at once; then the
// panel (shape, gradient, frosted glass, grain, shadow, glow, accent bar), the text (shadow, gradient, spacing,
// capitals, line height) and lines coming in one after another.
import { NumberField } from './Panels.tsx';
import { DEFAULT_GRAPHIC, GRAPHIC_TEMPLATES, graphicStyleOf, type GraphicStyle, type GraphicTemplate, type PanelShape, type Shade } from '../../presentation/graphic-style.ts';

const SHADE: Shade = { color: '#000000', opacity: 0.5, blur: 12, x: 0, y: 4 };

function ShadeFields({ value, onChange }: { value: Shade; onChange: (s: Shade) => void }) {
  return (
    <div className="effect-fields">
      <label>Colour<input type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} /></label>
      <label>Strength (%)<NumberField min={0} max={100} step={5} value={Math.round(value.opacity * 100)} def={50} onCommit={(n) => onChange({ ...value, opacity: n / 100 })} /></label>
      <label>Blur<NumberField min={0} max={200} step={1} value={value.blur} def={12} onCommit={(n) => onChange({ ...value, blur: n })} /></label>
      <label>Across<NumberField min={-200} max={200} step={1} value={value.x} def={0} onCommit={(n) => onChange({ ...value, x: n })} /></label>
      <label>Down<NumberField min={-200} max={200} step={1} value={value.y} def={4} onCommit={(n) => onChange({ ...value, y: n })} /></label>
    </div>
  );
}

/** Templates, then every setting of a graphic's look; `onTemplate` also sets the graphic's colours and font. */
export function GraphicStyleEditor({ value, onChange, onTemplate, idPrefix }: { value: GraphicStyle | undefined; onChange: (s: GraphicStyle | undefined) => void; onTemplate: (t: GraphicTemplate) => void; idPrefix: string }) {
  const g = graphicStyleOf(value ?? DEFAULT_GRAPHIC), p = g.panel, t = g.text;
  const setPanel = (patch: Partial<GraphicStyle['panel']>) => onChange({ ...g, panel: { ...p, ...patch } });
  const setText = (patch: Partial<GraphicStyle['text']>) => onChange({ ...g, text: { ...t, ...patch } });
  return (
    <div className="graphic-style look-editor" data-testid={`${idPrefix}-graphic-style`}>
      <div className="buttons">
        {GRAPHIC_TEMPLATES.map((tp) => <button key={tp.id} className="small" onClick={() => onTemplate(tp)} data-testid={`${idPrefix}-template-${tp.id}`}>{tp.name}</button>)}
      </div>
      <details open={!!value}>
        <summary>Panel</summary>
        <div className="effect-fields">
          <label>Shape<select value={p.shape} onChange={(e) => setPanel({ shape: e.target.value as PanelShape })} data-testid={`${idPrefix}-shape`}>
            <option value="rounded">Rounded</option><option value="square">Square</option><option value="cut">Cut corners</option><option value="pill">Pill</option><option value="tab">Tab</option>
          </select></label>
          <label title="The map behind the panel blurred, as frosted glass (0: none)">Glass<NumberField min={0} max={60} step={1} value={p.glass} def={DEFAULT_GRAPHIC.panel.glass} onCommit={(n) => setPanel({ glass: n })} testId={`${idPrefix}-glass`} /></label>
          <label>Grain (%)<NumberField min={0} max={100} step={5} value={Math.round(p.grain * 100)} def={Math.round(DEFAULT_GRAPHIC.panel.grain * 100)} onCommit={(n) => setPanel({ grain: n / 100 })} /></label>
          <label>Accent bar<select value={p.accent.side} onChange={(e) => setPanel({ accent: { ...p.accent, side: e.target.value as 'none' } })}>
            <option value="none">None</option><option value="left">Left</option><option value="top">Top</option><option value="bottom">Bottom</option>
          </select></label>
          {p.accent.side !== 'none' && <label>Bar colour<input type="color" value={p.accent.color} onChange={(e) => setPanel({ accent: { ...p.accent, color: e.target.value } })} /></label>}
          {p.accent.side !== 'none' && <label>Bar width<NumberField min={0} max={60} step={1} value={p.accent.width} def={DEFAULT_GRAPHIC.panel.accent.width} onCommit={(n) => setPanel({ accent: { ...p.accent, width: n } })} /></label>}
        </div>
        <label className="check"><input type="checkbox" checked={!!p.gradient} onChange={(e) => setPanel({ gradient: e.target.checked ? { from: '#1d2b3a', to: '#0a1018', angle: 90 } : null })} /> Gradient</label>
        {p.gradient && <div className="effect-fields">
          <label>From<input type="color" value={p.gradient.from} onChange={(e) => setPanel({ gradient: { ...p.gradient!, from: e.target.value } })} /></label>
          <label>To<input type="color" value={p.gradient.to} onChange={(e) => setPanel({ gradient: { ...p.gradient!, to: e.target.value } })} /></label>
          <label>Angle (°)<NumberField min={-360} max={360} step={5} value={p.gradient.angle} def={90} onCommit={(n) => setPanel({ gradient: { ...p.gradient!, angle: n } })} /></label>
        </div>}
        <label className="check"><input type="checkbox" checked={!!p.shadow} onChange={(e) => setPanel({ shadow: e.target.checked ? SHADE : null })} data-testid={`${idPrefix}-panel-shadow`} /> Shadow</label>
        {p.shadow && <ShadeFields value={p.shadow} onChange={(s) => setPanel({ shadow: s })} />}
        <label className="check"><input type="checkbox" checked={!!p.glow} onChange={(e) => setPanel({ glow: e.target.checked ? { color: '#5ef2ff', opacity: 0.6, blur: 16 } : null })} /> Glow</label>
        {p.glow && <div className="effect-fields">
          <label>Colour<input type="color" value={p.glow.color} onChange={(e) => setPanel({ glow: { ...p.glow!, color: e.target.value } })} /></label>
          <label>Strength (%)<NumberField min={0} max={100} step={5} value={Math.round(p.glow.opacity * 100)} def={50} onCommit={(n) => setPanel({ glow: { ...p.glow!, opacity: n / 100 } })} /></label>
          <label>Size<NumberField min={0} max={200} step={1} value={p.glow.blur} def={12} onCommit={(n) => setPanel({ glow: { ...p.glow!, blur: n } })} /></label>
        </div>}
      </details>
      <details open={!!value}>
        <summary>Text</summary>
        <div className="effect-fields">
          <label title="Space between letters (hundredths of the size)">Spacing<NumberField min={-10} max={60} step={1} value={t.spacing} def={DEFAULT_GRAPHIC.text.spacing} onCommit={(n) => setText({ spacing: n })} /></label>
          <label>Line height<NumberField min={0.8} max={3} step={0.05} value={t.lineHeight} def={DEFAULT_GRAPHIC.text.lineHeight} onCommit={(n) => setText({ lineHeight: n })} /></label>
          <label title="Each line comes in so many seconds after the one before (0: all together)">Lines one after another (s)<NumberField min={0} max={5} step={0.05} value={g.stagger} def={DEFAULT_GRAPHIC.stagger} onCommit={(n) => onChange({ ...g, stagger: n })} testId={`${idPrefix}-stagger`} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={t.upper} onChange={(e) => setText({ upper: e.target.checked })} /> Capitals</label>
        <label className="check"><input type="checkbox" checked={!!t.shadow} onChange={(e) => setText({ shadow: e.target.checked ? SHADE : null })} /> Shadow</label>
        {t.shadow && <ShadeFields value={t.shadow} onChange={(s) => setText({ shadow: s })} />}
        <label className="check"><input type="checkbox" checked={!!t.gradient} onChange={(e) => setText({ gradient: e.target.checked ? { from: '#ffffff', to: '#ffd166' } : null })} /> Gradient</label>
        {t.gradient && <div className="effect-fields">
          <label>Top<input type="color" value={t.gradient.from} onChange={(e) => setText({ gradient: { ...t.gradient!, from: e.target.value } })} /></label>
          <label>Bottom<input type="color" value={t.gradient.to} onChange={(e) => setText({ gradient: { ...t.gradient!, to: e.target.value } })} /></label>
        </div>}
      </details>
      {value && <button className="small" onClick={() => onChange(undefined)}>The plain look again</button>}
    </div>
  );
}
