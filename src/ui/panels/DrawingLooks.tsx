// A drawing by hand in the Looks panel (S8, D251), as drawn: its name, "Drawing · part of" its country, and its
// fundamentals: its line (width and colour), its fill, its opacity and blend; shown or hidden, moved over or under the
// country's other drawings, taken away. And the options of the Looks studio's tools to draw with, in the options bar:
// the shape to draw, and the line and fill of the drawing being drawn into (of a new one, before there is one).
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { BLEND_MODES, BLEND_NAMES, type BlendMode } from '../../render-engine/country-look.ts';
import { PropGroup } from '../shell/Group.tsx';
import { NumberField } from '../inputs.tsx';
import { LABEL_FONTS } from '../../render-engine/label-style.ts';
import type { Drawing, DrawStroke, TextShape } from '../../domain/drawings.ts';

/** The drawing designed: of the country chosen, the one chosen in its parts (null: none, or no longer there). */
export function drawingNow(s = store): { owner: string; drawing: Drawing } | null {
  const sel = s.selection, w = s.lookWorld ?? s.world;
  if (!w || sel?.kind !== 'entity' || !s.drawingId) return null;
  const d = cmd.drawingsOfEntity(w.get('entity', sel.id)).find((x) => x.id === s.drawingId);
  return d ? { owner: sel.id, drawing: d } : null;
}

/** A drawing's line and fill, as fields: a box to have one, its colour (and the line's width). */
function LineAndFill({ stroke, fill, onStroke, onFill, prefix }: { stroke: DrawStroke | null; fill: string | null; onStroke: (v: DrawStroke | null) => void; onFill: (v: string | null) => void; prefix: string }) {
  const keep = (k: string, v: string) => sessionStorage.setItem(k, v);
  const last = (k: string, d: string) => sessionStorage.getItem(k) ?? d;
  return (
    <>
      <span className="inline draw-field">
        <label className="check" title="A line along its shapes"><input type="checkbox" checked={!!stroke} onChange={(e) => onStroke(e.target.checked ? { color: last('draw-stroke', '#2b1d12'), width: 2 } : null)} data-testid={`${prefix}-stroke-on`} /> Stroke</label>
        {stroke && <>
          <NumberField value={stroke.width} min={0.1} max={200} step={0.5} def={2} onCommit={(n) => onStroke({ ...stroke, width: n })} title="Its width, in pixels of a frame 1920 wide" testId={`${prefix}-stroke-width`} />
          <input type="color" value={stroke.color} onChange={(e) => { keep('draw-stroke', e.target.value); onStroke({ ...stroke, color: e.target.value }); }} title="The line's colour" data-testid={`${prefix}-stroke-color`} />
        </>}
      </span>
      <span className="inline draw-field">
        <label className="check" title="Its closed shapes filled"><input type="checkbox" checked={!!fill} onChange={(e) => onFill(e.target.checked ? last('draw-fill', '#c9a227') : null)} data-testid={`${prefix}-fill-on`} /> Fill</label>
        {fill ? <input type="color" value={fill} onChange={(e) => { keep('draw-fill', e.target.value); onFill(e.target.value); }} title="The fill's colour" data-testid={`${prefix}-fill-color`} /> : <span className="muted">None</span>}
      </span>
    </>
  );
}

/** A text's words, size, font, weight, slant and turn, as fields (D253); `set` changes them. */
function TextFields({ t, set, prefix }: { t: Pick<TextShape, 'size' | 'font' | 'weight' | 'italic'> & Partial<Pick<TextShape, 'text' | 'angle'>>; set: (patch: Partial<TextShape>) => void; prefix: string }) {
  return (
    <span className="inline draw-field text-fields">
      {t.text !== undefined && <input className="text-words" defaultValue={t.text} key={t.text} onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== t.text) set({ text: v }); }} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} title="Its words" data-testid={`${prefix}-words`} />}
      <select value={t.font} onChange={(ev) => set({ font: ev.target.value })} title="Its font" data-testid={`${prefix}-font`}>
        {(LABEL_FONTS.includes(t.font) ? LABEL_FONTS : [t.font, ...LABEL_FONTS]).map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <NumberField value={t.size} min={4} max={400} step={1} def={28} onCommit={(n) => set({ size: n })} title="Its height, in pixels of a frame 1920 wide" testId={`${prefix}-size`} />
      <button className={`small ${t.weight >= 600 ? 'on' : ''}`} aria-pressed={t.weight >= 600} onClick={() => set({ weight: t.weight >= 600 ? 400 : 700 })} title="Bold" data-testid={`${prefix}-bold`}><b>B</b></button>
      <button className={`small ${t.italic ? 'on' : ''}`} aria-pressed={t.italic} onClick={() => set({ italic: !t.italic })} title="Italic" data-testid={`${prefix}-italic`}><i>I</i></button>
      {t.angle !== undefined && <NumberField value={t.angle} min={-360} max={360} step={5} def={0} onCommit={(n) => set({ angle: n })} title="Turned by so many degrees, clockwise" testId={`${prefix}-angle`} />}
    </span>
  );
}

/** A drawing chosen in the Looks studio's parts: its looks, in the Looks panel. */
export function DrawingLooks({ owner, drawing: d }: { owner: string; drawing: Drawing }) {
  const s = useStore();
  const e = s.lookWorld?.get('entity', owner);
  if (!e) return null;
  const list = cmd.drawingsOfEntity(e), at = list.findIndex((x) => x.id === d.id);
  const set = (patch: Partial<Omit<Drawing, 'id' | 'shapes'>>) => s.executeLooks((wd) => cmd.updateDrawing(wd, owner, d.id, patch));
  return (
    <div className="panel" data-testid="looks-drawing">
      <h3>{d.name}</h3>
      <p className="muted drawing-of">Drawing · part of <button className="small link" onClick={() => s.set({ drawingId: null })} title={`The looks of ${e.name}`} data-testid="drawing-owner">{e.name}</button></p>
      <PropGroup id="drawing:fundamentals" title="Fundamentals">
        <label>Name<input defaultValue={d.name} key={d.name} onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== d.name) set({ name: v }); }} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} data-testid="drawing-name" /></label>
        <LineAndFill stroke={d.stroke} fill={d.fill} onStroke={(stroke) => set({ stroke })} onFill={(fill) => set({ fill })} prefix="drawing" />
        <label>Opacity
          <span className="inline"><input type="range" min={0} max={100} step={1} value={Math.round(d.opacity * 100)} onChange={(ev) => set({ opacity: Number(ev.target.value) / 100 })} data-testid="drawing-opacity" /><span className="muted">{Math.round(d.opacity * 100)}%</span></span>
        </label>
        <label>Blend
          <select value={d.blend} onChange={(ev) => set({ blend: ev.target.value as BlendMode })} data-testid="drawing-blend">
            {BLEND_MODES.map((b) => <option key={b} value={b}>{BLEND_NAMES[b]}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={d.on} onChange={(ev) => set({ on: ev.target.checked })} data-testid="drawing-on" /> Shown</label>
        <p className="muted small-text">{d.shapes.length === 1 ? 'One shape' : `${d.shapes.length} shapes`}, fixed to the land: the borders of {e.name} cut it.</p>
      </PropGroup>
      {d.shapes.some((sh) => sh.kind === 'text') && (
        <PropGroup id="drawing:texts" title="Texts">
          {d.shapes.map((sh, k) => sh.kind !== 'text' ? null : (
            <div key={k} className="drawing-text" data-testid={`drawing-text-${k}`}>
              <TextFields t={sh} prefix={`drawing-text-${k}`} set={(patch) => s.executeLooks((wd) => cmd.updateDrawingShape(wd, owner, d.id, k, { ...sh, ...patch }))} />
              <button className="small danger" onClick={() => s.executeLooks((wd) => cmd.removeDrawingShape(wd, owner, d.id, k))} title="Take this text away" data-testid={`drawing-text-${k}-remove`}>×</button>
            </div>
          ))}
          <p className="muted small-text">In the fill's colour (the line's, with no fill), outlined by the line when there are both. With Select, drag a text to move it; double-click it to write it again.</p>
        </PropGroup>
      )}
      <div className="buttons">
        <button className="small" disabled={at >= list.length - 1} onClick={() => s.executeLooks((wd) => cmd.moveDrawing(wd, owner, d.id, 1))} title="Drawn after its other drawings: over them" data-testid="drawing-up">Bring forward</button>
        <button className="small" disabled={at <= 0} onClick={() => s.executeLooks((wd) => cmd.moveDrawing(wd, owner, d.id, -1))} title="Drawn before its other drawings: under them" data-testid="drawing-down">Send backward</button>
        <button className="small danger" onClick={() => s.removeDrawing(owner, d.id)} title="Delete" data-testid="drawing-remove">Remove drawing</button>
      </div>
    </div>
  );
}

/** The Shapes tool's options (S8, D251): the shape, then the line and fill of what is drawn into. */
export function DrawToolOptions() {
  const s = useStore();
  const now = drawingNow(s);
  const sel = s.selection, w = s.world!;
  const country = sel?.kind === 'entity' ? w.get('entity', sel.id) : null;
  const designable = !!country && (country.type_id === 'polity' || country.type_id === 'faction');
  return (
    <div className="toolbar sub" data-testid="draw-options">
      {s.tool === 'draw-text' && <TextFields t={s.textStyle} prefix="text" set={(patch) => s.set({ textStyle: { ...s.textStyle, ...patch } })} />}
      {s.tool === 'shape' && (
        <span className="seg" role="group" aria-label="Shape">
          {(['rectangle', 'ellipse'] as const).map((k) => (
            <button key={k} className={`small ${s.shapeKind === k ? 'on' : ''}`} aria-pressed={s.shapeKind === k} onClick={() => s.set({ shapeKind: k })} data-testid={`shape-${k}`}>{k === 'rectangle' ? 'Rectangle' : 'Ellipse'}</button>
          ))}
        </span>
      )}
      {now ? (
        <LineAndFill stroke={now.drawing.stroke} fill={now.drawing.fill} prefix="draw"
          onStroke={(stroke) => s.executeLooks((wd) => cmd.updateDrawing(wd, now.owner, now.drawing.id, { stroke }))}
          onFill={(fill) => s.executeLooks((wd) => cmd.updateDrawing(wd, now.owner, now.drawing.id, { fill }))} />
      ) : (
        <LineAndFill stroke={s.drawNew.stroke} fill={s.drawNew.fill} prefix="draw" onStroke={(stroke) => s.set({ drawNew: { ...s.drawNew, stroke } })} onFill={(fill) => s.set({ drawNew: { ...s.drawNew, fill } })} />
      )}
      <span className="muted" data-testid="draw-into">
        {!designable ? 'Choose a country to draw on its design.' : now ? `Into "${now.drawing.name}" of ${country!.name}, fixed to the land.` : `Into a new drawing of ${country!.name}, fixed to the land.`}
      </span>
    </div>
  );
}
