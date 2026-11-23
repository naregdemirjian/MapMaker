// The tool strip down the left edge and the options bar of the tool in hand (D198, D205); the options of each tool
// (tidy stage, D213: moved here from Panels.tsx).
import { useState, useEffect, useRef } from 'react';
import { useStore, DEFAULT_STROKE, type Tool } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { SCULPT_TOOLS, tipped } from '../../terrain/sculpt.ts';
import { BrushTipControl } from '../components/BrushTip.tsx';
import { BIOMES, type Biome } from '../../terrain/biomes.ts';
import { fromStore, compare } from '../../core-time/index.ts';
import { sculptOf, isSpaceMap } from '../../world-model/world-settings.ts';
import { RecordLengthControls } from '../components/RecordLength.tsx';
import { FeatureToolOptions } from '../components/Features.tsx';
import { FieldToolOptions, DisasterToolOptions } from '../components/Fields.tsx';
import { SplitToolOptions } from '../components/SplitMerge.tsx';
import { SmartBrushControls } from '../components/SmartBrush.tsx';
import { RegionToolOptions } from '../components/Regions.tsx';
import { RangeReset } from './Reset.tsx';
import { TOOLS, toolsFor, stackOf, type ToolInfo } from '../tools.ts';
import { ToolIcon } from './ToolIcon.tsx';
import { fmt } from '../inputs.tsx';
import { outlinerLists } from '../panels/Lists.tsx';

/** The biomes a brush can paint (D169), by their names. */
const BIOME_NAMES: Record<Biome, string> = { ice: 'Ice', tundra: 'Tundra', boreal: 'Northern forest', forest: 'Forest', grass: 'Grassland', steppe: 'Steppe', desert: 'Desert', savanna: 'Savanna', rainforest: 'Rainforest', rock: 'Bare rock' };

/** The border pen's draft: which one, take back a piece, finish, discard, resume another. */
function PenControls() {
  const s = useStore();
  const d = s.draft && s.draft.spaceId === s.spaceId ? s.draft : null;
  const others = s.drafts.filter((x) => x.id !== d?.id);
  return (
    <div className="pen-controls" data-testid="pen-controls">
      {d ? <>
        <input className="draft-name" value={d.name} onChange={(e) => s.renameDraft(d.id, e.target.value)} title="Name of this draft" data-testid="draft-name" />
        <span className="muted">{d.points.length} points</span>
        <button className="small" disabled={!d.pieces.length} onClick={() => s.penUndoPiece()} title="Ctrl+Z or Backspace (with the pen, undo only touches the draft)" data-testid="draft-undo">Take back last piece</button>
        <button className="small" onClick={() => s.penRedoPiece()} title="Ctrl+Y" data-testid="draft-redo">Put back</button>
        <button className="small primary" disabled={d.points.length < 3} onClick={() => s.finishDraft()} data-testid="draft-finish">Finish <span className="key">Enter</span></button>
        <button className="small danger" onClick={() => { if (confirm(`Discard "${d.name}"?`)) s.discardDraft(d.id); }} data-testid="draft-discard">Discard</button>
        <button className="small" onClick={() => s.newDraft()} title="Keep this draft and start another">New draft</button>
      </> : <span className="muted">Press on the map to start a border. Let go and carry on whenever you like.</span>}
      {others.length > 0 && (
        <select value="" onChange={(e) => e.target.value && s.resumeDraft(e.target.value)} title="Carry on with another draft" data-testid="draft-resume">
          <option value="">Other drafts ({others.length})…</option>
          {others.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.points.length} points{x.spaceId !== s.spaceId ? ` · ${s.world?.get('map_space', x.spaceId)?.name ?? 'another map'}` : ''}</option>)}
        </select>
      )}
    </div>
  );
}

/** The tools, down the left edge: icons in groups, each with its key (D198). */
export function ToolStrip() {
  const s = useStore();
  const tools = toolsFor(s.world!, s.spaceId);
  // Stacked tools take one place, at the first of them (D205).
  const slots: Array<{ tools: ToolInfo[]; stack: string | null }> = [];
  for (const t of tools) {
    const k = stackOf(t.id), last = slots[slots.length - 1];
    if (k && last?.stack === k) last.tools.push(t); else slots.push({ tools: [t], stack: k });
  }
  return (
    <div className="tool-strip" role="toolbar" aria-label="Tools" aria-orientation="vertical" data-testid="tool-strip">
      {slots.map((slot, i) => (
        <span key={slot.tools[0].id} className="tool-slot">
          {i > 0 && slots[i - 1].tools[0].group !== slot.tools[0].group && <span className="tool-sep" />}
          {slot.stack && slot.tools.length > 1 ? <ToolStack stack={slot.stack} tools={slot.tools} /> : <ToolButton t={slot.tools[0]} />}
        </span>
      ))}
    </div>
  );
}

function ToolButton({ t, stacked, onPointerDown }: { t: ToolInfo; stacked?: boolean; onPointerDown?: (e: React.PointerEvent) => void }) {
  const s = useStore();
  return (
    <button className={`tool ${s.tool === t.id ? 'on' : ''} ${stacked ? 'stacked' : ''}`} title={`${t.name} (${t.key})${stacked ? ' · hold or rest the pointer on it for the others' : ''}\n${t.hint}`} aria-label={t.name} aria-pressed={s.tool === t.id}
      onClick={() => s.set({ tool: t.id })} onPointerDown={onPointerDown} data-testid={`tool-${t.id}`}><ToolIcon id={t.id} /></button>
  );
}

/** The last tool used of each stack: the one it shows. */
const stackFace = new Map<string, Tool>();

/**
 * Tools stacked in one place (D205), as in Photoshop: the one last used shows, with a mark at its corner;
 * resting the pointer on it, or holding it pressed, slides the others out beside it, each with its key.
 */
function ToolStack({ stack, tools }: { stack: string; tools: ToolInfo[] }) {
  const s = useStore();
  const [open, setOpen] = useState<null | { left: number; top: number }>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slot = useRef<HTMLSpanElement | null>(null);
  if (tools.some((t) => t.id === s.tool)) stackFace.set(stack, s.tool);
  const face = tools.find((t) => t.id === stackFace.get(stack)) ?? tools[0];
  const show = () => { const r = slot.current?.getBoundingClientRect(); if (r) setOpen({ left: r.right + 2, top: r.top }); };
  const later = (ms: number, f: () => void) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(f, ms); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <span className="tool-stack" ref={slot} data-testid={`tool-stack-${stack}`}
      onPointerEnter={() => later(350, show)} onPointerLeave={() => later(200, () => setOpen(null))}>
      <ToolButton t={face} stacked onPointerDown={() => later(300, show)} />
      {open && (
        <div className="tool-flyout" role="menu" aria-label="Tools stacked here" style={{ left: open.left, top: open.top }} data-testid={`tool-flyout-${stack}`}
          onPointerEnter={() => { if (timer.current) clearTimeout(timer.current); }}>
          {tools.map((t) => (
            <button key={t.id} role="menuitemradio" aria-checked={s.tool === t.id} className={`tool-flyout-item ${s.tool === t.id ? 'on' : ''}`} title={t.hint}
              onClick={() => { stackFace.set(stack, t.id); s.set({ tool: t.id }); setOpen(null); }} data-testid={t.id === face.id ? undefined : `tool-${t.id}`}>
              <span className="tool-flyout-mark">{s.tool === t.id ? '■' : ''}</span><ToolIcon id={t.id} size={16} /><span className="tool-flyout-name">{t.name}</span><span className="tool-flyout-key">{t.key}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * What the tool in hand needs besides its button, in a bar of its own above the map and the panels. The bar
 * keeps one height whichever tool is chosen, so the map keeps its size and place (a map that changes size is
 * drawn again in full); options that need a second line lie over the top edge of what is below.
 */
export function ToolOptions() {
  const s = useStore();
  const w = s.world!;
  const owners = outlinerLists(s).political;
  const rec = s.recordEventId ? w.get('event', s.recordEventId) : null;
  const tool = TOOLS.find((t) => t.id === s.tool);
  return (
    <div className="options-bar" data-testid="options-bar">
    <div className="tool-options-anchor"><div className="tool-options">
      <span className="tool-name" data-testid="tool-name">{tool?.name}</span>
      {s.tool === 'systems' && isSpaceMap(w.get('map_space', s.spaceId)) && (
        <div className="toolbar sub" data-testid="systems-options">
          <label className="inline">Give to
            <select value={s.paintValue ?? ''} onChange={(e) => s.set({ paintValue: e.target.value || null })} data-testid="systems-owner">
              <option value="">Nobody (no longer held)</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <span className="muted" data-testid="systems-hint">Click a star, or hold Ctrl and drag a box around several: {s.paintValue ? `held by ${w.get('entity', s.paintValue)?.name ?? '?'}` : 'held by nobody'} from {rec ? `"${rec.name}"` : fmt(s.time)}.</span>
        </div>
      )}
      {s.tool === 'lanes' && isSpaceMap(w.get('map_space', s.spaceId)) && (
        <div className="toolbar sub" data-testid="lanes-options">
          <label className="inline">Belonging to
            <select value={s.paintValue ?? ''} onChange={(e) => s.set({ paintValue: e.target.value || null })} data-testid="lanes-owner">
              <option value="">Nobody in particular</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <span className="muted" data-testid="lanes-hint">Click a star, then another: a lane between them from {rec ? `"${rec.name}"${rec.end_day !== null ? ', growing from the first star to the second over the event' : ''}` : fmt(s.time)}.</span>
        </div>
      )}
      {(s.tool === 'lasso' || s.tool === 'polygon' || s.tool === 'pen') && (
        <div className="toolbar sub">
          <label className="inline">Give to
            <select value={s.paintValue ?? ''} onChange={(e) => { s.set({ paintValue: e.target.value || null }); if (s.tool === 'pen' && s.draft) s.setDraftOwner(s.draft.id, e.target.value || null); }} data-testid="paint-owner">
              <option value="">Nobody (clear territory)</option>
              {owners.map((o) => { const locked = cmd.isLocked(w, o.id); return <option key={o.id} value={o.id} disabled={locked}>{o.name}{locked ? ' (locked)' : ''}</option>; })}
            </select>
          </label>
          {s.tool === 'pen' && <PenControls />}
          {(s.tool === 'pen' || s.tool === 'lasso') && <SmartBrushControls />}
          {s.tool === 'lasso' && (
            <details className="brush-settings">
              <summary title="How freehand outlines are cleaned up">Brush settings ▾</summary>
              <div className="popover">
                <label title="Rounds the corners of your outline">Smoothing <input type="range" min={0} max={4} step={1} value={s.stroke.smoothness} onChange={(e) => s.set({ stroke: { ...s.stroke, smoothness: Number(e.target.value) } })} /><RangeReset def={DEFAULT_STROKE.smoothness} value={s.stroke.smoothness} /></label>
                <label title="Adds natural-looking irregularity. It is fixed once drawn and never changes afterwards.">Irregularity <input type="range" min={0} max={20} step={1} value={s.stroke.irregularity} onChange={(e) => s.set({ stroke: { ...s.stroke, irregularity: Number(e.target.value), seed: (s.stroke.seed % 9973) + 1 } })} /><RangeReset def={DEFAULT_STROKE.irregularity} value={s.stroke.irregularity} /></label>
                <label title="Higher keeps more of the small wiggles in your outline">Detail <input type="range" min={0.3} max={6} step={0.1} value={7 - s.stroke.precision} onChange={(e) => s.set({ stroke: { ...s.stroke, precision: 7 - Number(e.target.value) } })} /><RangeReset def={7 - DEFAULT_STROKE.precision} value={7 - s.stroke.precision} /></label>
              </div>
            </details>
          )}
        </div>
      )}
    {s.tool === 'feature' && <FeatureToolOptions />}
    {s.tool === 'sculpt' && <SculptToolOptions />}
    {s.tool === 'field' && <FieldToolOptions />}
    {s.tool === 'disaster' && <DisasterToolOptions />}
    {s.tool === 'split' && <SplitToolOptions />}
    {s.tool === 'regions' && <RegionToolOptions />}
    {s.tool === 'place' && (
      <div className="toolbar sub">
        <label className="inline">Place
          <select value={s.placeValue ?? ''} onChange={(e) => s.set({ placeValue: e.target.value || null })} data-testid="place-character">
            <option value="">Choose…</option>
            {[['character', 'Characters'], ['settlement', 'Cities']].map(([type, title]) => (
              <optgroup key={type} label={title}>
                {w.all('entity').filter((e) => e.type_id === type).sort((a, b) => a.name.localeCompare(b.name)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="muted">{s.placeValue ? `Click the map to put ${w.get('entity', s.placeValue)?.name ?? 'them'} there from ${fmt(s.time)} on.` : 'Choose a character or a city, or make one (+ Character, + City).'}</span>
      </div>
    )}
    {rec && (
      <div className="record-banner" data-testid="recording">
        <span className="rec-text">● Recording into “{rec.name}”</span>
        <span className="muted-red">Everything you draw is added to this event{compare(s.time, fromStore(rec.start_day, rec.start_ms)) > 0 ? `, as a change on ${fmt(s.time)}` : ''}.</span>
        <RecordLengthControls />
        <button onClick={() => s.set({ recordEventId: null })}>Stop</button>
      </div>
    )}
    </div></div>
    </div>
  );
}

/** The sculpting brush (D98): which brush, its size and strength, and what a stroke changes. */
function SculptToolOptions() {
  const s = useStore();
  const w = s.world!;
  const space = w.get('map_space', s.spaceId);
  const b = s.sculpt;
  const strokes = sculptOf(space);
  const info = SCULPT_TOOLS.find((t) => t.id === b.tool)!;
  const set = (patch: Partial<typeof b>) => s.set({ sculpt: { ...b, ...patch } });
  const uses = info.strength > 0;
  return (
    <div className="toolbar sub sculpt-options" data-testid="sculpt-options">
      <label className="inline">Brush
        <select value={b.tool} onChange={(e) => { const t = SCULPT_TOOLS.find((x) => x.id === e.target.value)!; set({ tool: t.id, strength: t.strength || b.strength }); }} title={info.hint} data-testid="sculpt-brush">
          {SCULPT_TOOLS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="inline" title={b.tool === 'coast-land' || b.tool === 'coast-sea' ? 'How ragged the coast is: the size of its bays and headlands' : 'The brush\'s radius on the ground'}>Size
        <input type="number" min={1} max={5000} step={10} value={b.radiusKm} onChange={(e) => Number(e.target.value) > 0 && set({ radiusKm: Math.min(5000, Number(e.target.value)) })} data-testid="sculpt-size" /> km
      </label>
      {uses && (
        <label className="inline" title={b.tool === 'land' ? 'How high the new land stands' : b.tool === 'coast-land' ? 'How high the land rises inland' : b.tool === 'sea' || b.tool === 'coast-sea' ? 'How deep the new sea is' : b.tool === 'river' ? 'How far below the ground the river\'s bed runs' : 'How much the brush raises or lowers'}>{b.tool === 'land' || b.tool === 'coast-land' ? 'Height' : b.tool === 'sea' || b.tool === 'coast-sea' || b.tool === 'river' ? 'Depth' : 'Strength'}
          <input type="number" min={1} max={10000} step={50} value={b.strength} onChange={(e) => Number(e.target.value) > 0 && set({ strength: Math.min(10000, Number(e.target.value)) })} data-testid="sculpt-strength" /> m
        </label>
      )}
      {tipped(b.tool) && <BrushTipControl tip={b.tip} onChange={(tip) => set({ tip })} />}
      {b.tool === 'biome' && (
        <label className="inline" title="What grows where you paint, as the satellite look shows it">Biome
          <select value={b.biome} onChange={(e) => set({ biome: e.target.value as Biome })} data-testid="sculpt-biome">
            {(Object.keys(BIOMES) as Biome[]).map((k) => <option key={k} value={k}>{BIOME_NAMES[k]}</option>)}
          </select>
        </label>
      )}
      <label className="inline" title="A change to the base world holds at every date; a dated change holds from the date viewed on">Changes
        <select value={b.dated ? 'dated' : 'base'} onChange={(e) => set({ dated: e.target.value === 'dated' })} data-testid="sculpt-when">
          <option value="base">the base world</option>
          <option value="dated">from {fmt(s.time)} on</option>
        </select>
      </label>
      <span className="muted">{info.hint}.</span>
      {strokes.length > 0 && <button className="link" onClick={() => s.execute((wd) => cmd.clearTerrainStamps(wd, s.spaceId))} data-testid="sculpt-clear" title="Take every stroke away (one step, which can be undone)">Remove all {strokes.length} stroke{strokes.length === 1 ? '' : 's'}</button>}
    </div>
  );
}
