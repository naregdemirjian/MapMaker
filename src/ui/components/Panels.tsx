import { useState, useEffect, memo } from 'react';
import { useStore, useLive, store, type Tool } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { SCULPT_TOOLS } from '../../terrain/sculpt.ts';
import { type Instant, gregorian, fromStore, formatYear, compare, add, NEG_INF, MONTHS, DEEP_BEFORE_YEAR } from '../../core-time/index.ts';
import { BASE_EVENT_ID, type EffectRow } from '../../world-model/schema.ts';
import { basemapSourceOf, worldSettings, terrainSourceOf, sculptOf, isSpaceMap, isPaleoEarth } from '../../world-model/world-settings.ts';
import { parseJSON, leafDescendants, isUntracked, resolutionOf, type Resolution, type TransitionSpec } from '../../temporal-engine/engine.ts';
import type { World } from '../../world-model/world.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { stepChange } from './Timeline.tsx';
import { GroupChecks, eventVisible } from './EventGroups.tsx';
import { CountryLabelSection } from './LabelStyles.tsx';
import { CountryFillSection, FillSwatch } from './CountryFill.tsx';
import { CharacterSection } from './Characters.tsx';
import { RecordLengthControls, ChangeLength } from './RecordLength.tsx';
import { eventScreenSeconds, eventTransitionLook, TRANSITION_LOOKS } from '../../presentation/sequence.ts';
import { openMenu, entityMenu, groupMenu, eventMenu } from './ContextMenu.tsx';
import { CountryHistorySection } from './CountryHistory.tsx';
import { NamesSection } from './Names.tsx';
import { FeatureToolOptions, FeaturePanel, FeatureRows, featureLayers } from './Features.tsx';
import { FieldToolOptions, DisasterToolOptions } from './Fields.tsx';
import { RelationsSection } from './Relations.tsx';
import { SearchBox } from './Search.tsx';
import { PicturesSection } from './Pictures.tsx';
import { TypeDot, TypeSelect } from './EventTypes.tsx';
import { CalendarPopover, stepDate } from './DatePicker.tsx';
import { SplitToolOptions } from './SplitMerge.tsx';
import { SmartBrushControls } from './SmartBrush.tsx';
import { RegionToolOptions } from './Regions.tsx';
import { typeColor } from '../../domain/event-types.ts';
import { isFeatureKind } from '../../render-engine/feature-style.ts';
import { StarPanel } from './Stars.tsx';

export const fmt = (t: Instant, precision: 'year' | 'day' | 'minute' = 'day') => gregorian.format(t, precision);

/**
 * A date: typed ("14 May 1203", "500 BCE"), chosen on a calendar (the button at its end), or stepped
 * with the arrow keys (a day; Shift: a month; Alt: a year). `suggest`: where an empty field starts
 * (an event's end at its start): shown greyed in it, and where the arrows and the calendar begin. `live`: arrow steps apply at once
 * (the date viewed); otherwise on Enter or on leaving the field, as typing does.
 */
export function DateField({ value, onChange, placeholder, allowEmpty, testId, suggest, live, steady }: { value: Instant | null; onChange: (t: Instant | null) => void; placeholder?: string; allowEmpty?: boolean; testId?: string; suggest?: Instant | null; live?: boolean; steady?: { yearSizer: string; dayOnly: boolean } }) {
  const show = (t: Instant) => fmt(t, t.ms ? 'minute' : 'day');
  const [text, setText] = useState(value ? show(value) : '');
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  // Shown steady (see SteadyDate) while the field is not being typed in.
  // (Deep time, D134, is written as how long ago: no cells of day, month and year.)
  const steadyShown = !!steady && !focused && !!value && Number.isFinite(value.day) && text === show(value) && gregorian.toCivil(value).year >= DEEP_BEFORE_YEAR;
  useEffect(() => { setText(value ? show(value) : ''); setBad(false); }, [value?.day, value?.ms]);
  const suggested = !value && suggest ? show(suggest) : null;
  const commit = (t = text) => {
    if (!t.trim()) { if (allowEmpty) onChange(null); else setBad(true); return; }
    const p = gregorian.parse(t);
    if (!p) { setBad(true); return; }
    setBad(false);
    onChange(p.instant);
  };
  const current = (): Instant | null => { const typed = text.trim() ? gregorian.parse(text)?.instant : undefined; return typed ?? value ?? suggest ?? null; };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { commit(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const t = current();
    if (!t || t.day === -Infinity || t.day === Infinity) return;
    e.preventDefault();
    const next = stepDate(t, e.altKey ? 'year' : e.shiftKey ? 'month' : 'day', e.key === 'ArrowUp' ? 1 : -1);
    setText(show(next));
    setBad(false);
    if (live) onChange(next);
  };
  return (
    <span className="date-field">
      <input
        className={`${bad ? 'date-input bad' : 'date-input'}${steadyShown ? ' steady-under' : ''}`} value={text} placeholder={suggested ?? placeholder ?? 'e.g. 14 May 1203, 500 BCE, 2241-03-02'}
        onChange={(e) => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit(); }} onKeyDown={key}
        title="Dates: 14 May 1203 · May 1203 · 1203 · 500 BCE · 2241-03-02T04:05 · c. 3000 BCE. Arrow keys: a day (Shift: a month, Alt: a year)" data-testid={testId}
      />
      {steadyShown && <SteadyDate t={value!} yearSizer={steady!.yearSizer} dayOnly={steady!.dayOnly} />}
      <button type="button" className="date-calendar-button" title="Choose on a calendar" onClick={() => setOpen(!open)} data-testid={testId ? `${testId}-calendar` : undefined} tabIndex={-1}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M1.5 6.5h13M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (() => {
        const start = current();
        const at = start && Number.isFinite(start.day) ? start : gregorian.fromCivil({ year: 1900 });
        return <CalendarPopover value={at} onClose={() => setOpen(false)} onPick={(t) => { setOpen(false); setText(show(t)); setBad(false); onChange(t); }} testId={testId ? `${testId}-popover` : undefined} />;
      })()}
    </span>
  );
}

/**
 * A date that stays still as it changes (history playing, the timeline dragged): the day, the month and
 * the year each in a cell of its own, as wide as the widest it can be (the day's two digits, "September",
 * the longest year of the timeline), with figures all the same width; the day and the year are set to
 * the right of their cells, so their digits never move sideways.
 */
function SteadyDate({ t, yearSizer, dayOnly }: { t: Instant; yearSizer: string; dayOnly: boolean }) {
  const c = gregorian.toCivil(t);
  const cell = (cls: string, text: string, sizer: string) => <span className={`sd-cell ${cls}`}><span className="sd-text">{text}</span><span className="sd-size">{sizer}</span></span>;
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="steady-date" aria-hidden="true" data-testid="steady-date">
      {cell('sd-day', String(c.day), '00')}
      {cell('sd-month', MONTHS[c.month - 1], 'September')}
      {cell('sd-year', formatYear(c.year), yearSizer)}
      {!dayOnly && t.ms ? cell('sd-time', `${two(c.hour)}:${two(c.minute)}`, '00:00') : null}
    </span>
  );
}

/** The widest a year of the timeline can be written (its digits as 0s: all figures are the same width). */
export function yearSizer(startYear: number, endYear: number): string {
  const a = formatYear(Math.floor(startYear)), b = formatYear(Math.ceil(endYear));
  return (a.length >= b.length ? a : b).replace(/\d/g, '0');
}

/** A number box that saves when you press Enter or leave it, not on every keystroke. */
export function NumberField({ value, onCommit, min, max, step, testId, title }: { value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number; testId?: string; title?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n)) { setText(String(value)); return; }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (c !== value) onCommit(c);
    setText(String(c));
  };
  return <input type="number" value={text} min={min} max={max} step={step} title={title} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} data-testid={testId} />;
}

/** The date being viewed (follows the timeline as it is scrubbed). */
function CurrentDate() {
  const s = useLive();
  return <DateField value={s.time} onChange={(t) => t && s.setTime(t)} testId="current-date" live steady={{ yearSizer: yearSizer(s.timeline.start, s.timeline.end), dayOnly: s.historyPlay.on }} />;
}

/** A first date to compare with: the day before the last change up to the date viewed (the map as it
 * was before it), else a century earlier. */
function defaultCompareTime(s: ReturnType<typeof useStore>): Instant {
  const last = s.engine?.lastChangeStart(s.time);
  if (last) return add(last, -1);
  const c = gregorian.toCivil(s.time);
  return gregorian.fromCivil({ year: c.year - 100, month: c.month, day: c.day });
}

export function TopBar() {
  const s = useStore();
  const w = s.world!;
  const problems = s.problemCount();
  const spaces = w.all('map_space').sort((a, b) => a.sort_order - b.sort_order);
  const switchSpace = (id: string) => {
    const layer = w.all('layer').find((l) => l.space_id === id && l.kind === 'partition');
    // (A star map has only the Select tool, D110.)
    // (Leaving one for another kind of map, a tool of the other kind gives way to Select.)
    const space = isSpaceMap(w.get('map_space', id));
    const before = s.spaceId;
    s.set({ spaceId: id, layerId: layer?.id ?? '', selection: null, presentCamera: null, ...(space !== SPACE_TOOLS.includes(s.tool) || s.tool === 'select' ? { tool: 'select' as const } : {}) });
    s.mapChanged(before);
  };
  return (
    <header className="topbar">
      <div className="brand">Map Maker</div>
      <div className="project-name" title={s.projectDir}>{s.projectId}</div>
      <div className="seg">
        <button className={s.mode === 'world' ? 'on' : ''} onClick={() => s.set({ mode: 'world', presentCamera: null, playing: false })} data-testid="mode-world">World-building</button>
        <button className={s.mode === 'present' ? 'on' : ''} onClick={() => s.set({ mode: 'present', historyPlay: { ...s.historyPlay, on: false } })} data-testid="mode-present">Presentation</button>
      </div>
      <select value={s.spaceId} onChange={(e) => switchSpace(e.target.value)} title="Which map you are looking at">
        {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
      </select>
      {s.mode === 'world' && (
        <div className="datebar">
          <button onClick={() => stepChange(-1)} title="Previous change">◀</button>
          <CurrentDate />
          <button onClick={() => stepChange(1)} title="Next change">▶</button>
          <button className={s.compare.on ? 'on' : ''} onClick={() => s.set({ compare: { ...s.compare, on: !s.compare.on, time: s.compare.on ? s.compare.time : defaultCompareTime(s) } })}
            title="Compare two dates: the date viewed on the left of a line across the map, another date on the right (drag the line)" data-testid="compare-toggle">Compare</button>
          {s.compare.on && <>
            <DateField value={s.compare.time} onChange={(t) => t && s.set({ compare: { ...s.compare, time: t } })} testId="compare-date" />
            <button onClick={() => { const a = s.time; s.setTime(s.compare.time); s.set({ compare: { ...s.compare, time: a } }); }} title="Swap the two dates" data-testid="compare-swap">⇄</button>
          </>}
        </div>
      )}
      <div className="spacer" />
      <SearchBox />
      <button disabled={!s.journal.canUndo} title={s.journal.undoLabel ? `Undo: ${s.journal.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={() => s.undo()} data-testid="undo">Undo</button>
      <button disabled={!s.journal.canRedo} title={s.journal.redoLabel ? `Redo: ${s.journal.redoLabel} (Ctrl+Y)` : 'Nothing to redo'} onClick={() => s.redo()} data-testid="redo">Redo</button>
      <button onClick={() => s.set({ dialog: 'versions' })} title="Save a named version, restore versions and backups">Versions</button>
      <button className={problems ? 'warn' : ''} onClick={() => s.set({ dialog: 'health' })} data-testid="health">
        History Health{problems ? ` (${problems})` : ' ✓'}
      </button>
      <button onClick={() => s.set({ dialog: 'show' })} title="What the map shows while you work and in presentation and exports: borders, names, lakes (and from what size)…" data-testid="open-show">Show…</button>
      <button onClick={() => s.set({ dialog: 'settings' })} title="Settings: how fast and how sharp the map is drawn while you work (never changes an export)" data-testid="settings">Settings</button>
      <button onClick={() => s.closeProject()} title="Back to the project list">Projects</button>
    </header>
  );
}

const TOOLS: Array<{ id: Tool; name: string; hint: string }> = [
  { id: 'select', name: 'Select', hint: 'Click to inspect a place; drag to move the map; wheel to zoom; Alt+wheel to rotate.' },
  { id: 'lasso', name: 'Territory brush', hint: 'Draw around an area freehand. It is given to the owner chosen on the right.' },
  { id: 'polygon', name: 'Precise shape', hint: 'Click points; double-click or Enter to finish; Esc to cancel.' },
  { id: 'pen', name: 'Border pen', hint: 'Draw a border at your own pace: drag or click, let go, pan and zoom, carry on later. Enter finishes; Backspace takes back the last piece. Drafts are kept with the project.' },
  { id: 'vertex', name: 'Border points', hint: 'Drag a border point to correct the border shape for all time. Double-click a border to add a point; Delete removes the point under the cursor.' },
  { id: 'split', name: 'Split', hint: 'Draw a line right across a country, then click the part that changes hands: it goes to a new country or another one, from the date viewed, as a correction or in an event. Esc starts the line again.' },
  { id: 'regions', name: 'Regions', hint: 'Choose today\'s states and provinces, or today\'s countries, on the map (a click toggles one, a box takes all inside it), then give them to a country, from the date viewed, as a correction or in an event.' },
  { id: 'erase', name: 'Border eraser', hint: 'Drag across borders to erase them: the country where you start takes the land across each border you cross, from the date viewed (or in the event being recorded). Start outside any country to clear land.' },
  { id: 'feature', name: 'Areas, lines & points', hint: 'Draw on a layer of areas, lines or points: claims and zones, front lines, roads and arrows, battles and sites. They overlap freely and never change who holds the land.' },
  { id: 'place', name: 'Characters & cities', hint: 'Click the map to put the chosen character or city there from the date being viewed (a point, no borders). With Select, drag one to move it.' },
  { id: 'sculpt', name: 'Terrain', hint: 'Sculpt the terrain: raise and lower ground, draw mountain ranges and valleys, make craters and islands, paint land and sea, smooth, flatten, roughen or erode. A stroke changes the base world or holds from the date viewed.' },
  { id: 'disaster', name: 'Disasters', hint: 'Nuclear strikes, earthquakes, eruptions, floods, wildfires, meteor impacts and droughts: choose one and its size, then click the map. It is placed as an event from the date viewed, its conditions rising and fading by themselves (an impact leaves its crater in the terrain); one undo takes it all back.' },
  { id: 'field', name: 'Conditions', hint: 'Radiation, fire, smoke and ash, floods, destruction and heatmaps: click the map to place a source on a field layer from the date viewed (or in the event being recorded). It rises, lasts and fades by itself.' },
  { id: 'lanes', name: 'Lanes', hint: 'On a star map: click a star, then another: a lane between them (a route, a jump lane, a supply line) from the date viewed, belonging to the country or faction chosen. Recorded into an event with a length, it grows from the first star to the second over the event: an expedition or a fleet on its way.' },
  { id: 'systems', name: 'Star systems', hint: 'On a star map: click a star to give it to the country or faction chosen, from the date viewed (or in the event being recorded); hold Ctrl and drag a box to give every star in it. Their realm glows around the stars they hold.' },
];


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

/** The tools that work on a space map (D110); the others draw on the surface of a world. */
const SPACE_TOOLS: string[] = ['select', 'systems', 'lanes'];

export function ToolBar() {
  const s = useStore();
  const w = s.world!;
  const owners = outlinerLists(s).political;
  const rec = s.recordEventId ? w.get('event', s.recordEventId) : null;
  return (
    <>
    <div className="toolbar">
      {TOOLS.filter((t) => (t.id !== 'sculpt' || terrainSourceOf(w.get('map_space', s.spaceId))) && ((t.id !== 'field' && t.id !== 'disaster') || w.get('map_space', s.spaceId)?.kind === 'sphere') && (!isSpaceMap(w.get('map_space', s.spaceId)) || SPACE_TOOLS.includes(t.id)) && ((t.id !== 'systems' && t.id !== 'lanes') || isSpaceMap(w.get('map_space', s.spaceId)))).map((t) => (
        <button key={t.id} className={s.tool === t.id ? 'on' : ''} title={t.hint} onClick={() => s.set({ tool: t.id })} data-testid={`tool-${t.id}`}>{t.name}</button>
      ))}
    </div>
    {/* What a tool needs besides its button lies over the top edge of the map, so that the map
        keeps its size and place whichever tool is chosen (a map that changes size is drawn again in full). */}
    <div className="tool-options-anchor"><div className="tool-options">
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
                <label title="Rounds the corners of your outline">Smoothing <input type="range" min={0} max={4} step={1} value={s.stroke.smoothness} onChange={(e) => s.set({ stroke: { ...s.stroke, smoothness: Number(e.target.value) } })} /></label>
                <label title="Adds natural-looking irregularity. It is fixed once drawn and never changes afterwards.">Irregularity <input type="range" min={0} max={20} step={1} value={s.stroke.irregularity} onChange={(e) => s.set({ stroke: { ...s.stroke, irregularity: Number(e.target.value), seed: (s.stroke.seed % 9973) + 1 } })} /></label>
                <label title="Higher keeps more of the small wiggles in your outline">Detail <input type="range" min={0.3} max={6} step={0.1} value={7 - s.stroke.precision} onChange={(e) => s.set({ stroke: { ...s.stroke, precision: 7 - Number(e.target.value) } })} /></label>
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
    </>
  );
}

function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><span>{title}</span>{onAdd && <button className="small" onClick={onAdd} title={addLabel}>+ {addLabel ?? 'New'}</button>}</div>
      <div className="section-body">{children}</div>
    </section>
  );
}

/** Which country each city stands in at the date viewed: worked out once per state of the project and date. */
let cityMemo: { key: string; map: Map<string, string> } | null = null;
const cityFaces = new Map<string, { arr: unknown; lon: number; lat: number; face: number; stamp: number }>();
function citiesInCountries(s: ReturnType<typeof useStore>): Map<string, string> {
  const w = s.world!;
  const key = `${w.revision}|${s.spaceId}|${s.layerId}|${s.time.day}:${s.time.ms}`;
  if (cityMemo?.key === key) return cityMemo.map;
  const map = new Map<string, string>();
  if (s.layerId) {
    const arr = w.arrangement(s.spaceId);
    for (const c of s.engine!.charactersAt(s.spaceId, s.time)) {
      if (w.get('entity', c.entity)?.type_id !== 'settlement') continue;
      // The parcel a city stands in is looked up once, and again only when that parcel's outline has
      // changed (finding it is the slow part, and most edits are nowhere near most cities).
      let at = cityFaces.get(c.entity);
      if (!at || at.arr !== arr || at.lon !== c.lon || at.lat !== c.lat || !arr.faces.get(at.face)?.is_leaf || arr.faceStamp(at.face) !== at.stamp) {
        const face = arr.locate(lonLatToVec(c.lon, c.lat));
        cityFaces.set(c.entity, (at = { arr, lon: c.lon, lat: c.lat, face, stamp: arr.faceStamp(face) }));
      }
      const owner = s.engine!.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(c.lon, c.lat), s.time, at.face);
      if (owner) map.set(c.entity, owner);
    }
  }
  cityMemo = { key, map };
  return map;
}

type Ent = ReturnType<World['all']>[number] & { id: string; name: string; type_id: string; group_id?: string | null; color: string; style?: string };
type EntGroup = { id: string; name: string; color: string; sort_order: number; created_seq: number };
type OutlinerItem = { kind: 'group'; g: EntGroup; members: string[] } | { kind: 'entity'; e: Ent; depth: number; cities: number };

/** Events in order of their dates, kept until an event changes. */
const eventLists = new WeakMap<World, { revision: number; list: ReturnType<World['all']> }>();
function sortedEvents(w: World) {
  let kept = eventLists.get(w);
  const revision = w.tableRevision('event');
  if (!kept || kept.revision !== revision) eventLists.set(w, (kept = { revision, list: w.all('event').filter((e) => e.id !== BASE_EVENT_ID).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms) }));
  return kept.list as ReturnType<typeof w.all<'event'>>;
}

/**
 * What the lists of countries, characters and cities show, worked out once for each state of it:
 * the things themselves in order of their names, the groups (folders) of the user's own, and each
 * country's cities (at the date viewed). `sig` changes whenever any of it does.
 */
let outlinerMemo: { key: string; value: ReturnType<typeof buildOutlinerLists> } | null = null;
function outlinerLists(s: ReturnType<typeof useStore>) {
  const w = s.world!;
  const cityIn = citiesInCountries(s); // city -> the country holding the place it stands on
  let where = '';
  for (const [city, country] of cityIn) where += `${city}>${country},`;
  const key = `${w.serial}|${w.tableRevision('entity')}|${w.tableRevision('entity_group')}|${s.collapsed.join(',')}|${where}`;
  if (!outlinerMemo || outlinerMemo.key !== key) outlinerMemo = { key, value: buildOutlinerLists(w, cityIn, s.collapsed, key) };
  return outlinerMemo.value;
}

function buildOutlinerLists(w: World, cityIn: Map<string, string>, collapsed: string[], sig: string) {
  const all = w.all('entity') as Ent[];
  const byName = (a: Ent, b: Ent) => a.name.localeCompare(b.name);
  const political = all.filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort(byName);
  const characters = all.filter((e) => e.type_id === 'character').sort(byName);
  const others = all.filter((e) => e.type_id !== 'polity' && e.type_id !== 'faction' && e.type_id !== 'body' && e.type_id !== 'character').sort((a, b) => (a.type_id === 'settlement' ? 0 : 1) - (b.type_id === 'settlement' ? 0 : 1) || byName(a, b));
  const groups = w.all('entity_group').sort((a, b) => a.sort_order - b.sort_order || a.created_seq - b.created_seq) as EntGroup[];
  const groupMembers = new Map<string, string[]>();
  for (const e of all) if (e.group_id) { const l = groupMembers.get(e.group_id); if (l) l.push(e.id); else groupMembers.set(e.group_id, [e.id]); }
  const citiesOf = new Map<string, Ent[]>();
  for (const e of all) {
    const owner = e.type_id === 'settlement' ? cityIn.get(e.id) : undefined;
    if (owner && w.get('entity', owner)) { const l = citiesOf.get(owner) ?? []; l.push(e); citiesOf.set(owner, l); }
  }
  for (const l of citiesOf.values()) l.sort(byName);
  const looseOthers = others.filter((e) => !(e.type_id === 'settlement' && cityIn.has(e.id) && w.get('entity', cityIn.get(e.id)!)));
  /** Rows for a section: its groups (with their members), then what is in no group. */
  const itemsFor = (members: Ent[], showEmptyGroups: boolean): OutlinerItem[] => {
    const out: OutlinerItem[] = [];
    const add = (e: Ent, depth: number) => {
      const kids = citiesOf.get(e.id) ?? [];
      out.push({ kind: 'entity', e, depth, cities: kids.length });
      if (kids.length && collapsed.includes(`open:${e.id}`)) for (const c of kids) out.push({ kind: 'entity', e: c, depth: depth + 1, cities: 0 });
    };
    const inGroup = new Map<string, Ent[]>();
    for (const e of members) if (e.group_id) { const l = inGroup.get(e.group_id); if (l) l.push(e); else inGroup.set(e.group_id, [e]); }
    for (const g of groups) {
      const inside = inGroup.get(g.id) ?? [];
      if (!inside.length && !showEmptyGroups) continue;
      out.push({ kind: 'group', g, members: groupMembers.get(g.id) ?? [] });
      if (!collapsed.includes(`grp:${g.id}`)) for (const e of inside) add(e, 1);
    }
    for (const e of members) if (!e.group_id || !w.get('entity_group', e.group_id)) add(e, 0);
    return out;
  };
  return { sig, political, characters, others, looseOthers, items: { countries: itemsFor(political, true), characters: itemsFor(characters, false), cities: itemsFor(looseOthers, false) } };
}

/**
 * The rows of one of the lists of countries, characters or cities. Drawn again only when `sig`
 * changes (what the lists show, and what is chosen in them): not for every stroke on the map.
 */
/** A locked country or group (D87). */
function LockMark({ testId }: { testId?: string }) {
  return (
    <span className="lock-mark" title="Locked: its land and borders stay as they are" data-testid={testId}>
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7Zm2 0h4V5a2 2 0 0 0-4 0Z" fill="currentColor" /></svg>
    </span>
  );
}

const EntityRows = memo(function EntityRows({ section }: { sig: string; section: 'countries' | 'characters' | 'cities' }) {
  const s = store, w = s.world!;
  const items = outlinerLists(s).items[section];
  const order = items.filter((it): it is Extract<OutlinerItem, { kind: 'entity' }> => it.kind === 'entity').map((it) => it.e.id);
  const chosen = new Set(s.chosen('entity'));
  return <>{items.map((it) => {
    if (it.kind === 'group') {
      const folded = s.collapsed.includes(`grp:${it.g.id}`);
      return (
        <div key={`g-${it.g.id}`} className="row group-head" onClick={() => s.toggleCollapsed(`grp:${it.g.id}`)} data-testid={`entity-group-${it.g.name}`}
          onContextMenu={(ev) => openMenu(ev, groupMenu(w, it.g.id, it.members), it.g.name)}>
          <span className="twisty">{folded ? '▸' : '▾'}</span><span className="swatch" style={{ background: it.g.color }} /><b>{it.g.name}</b><span className="muted"> · {it.members.length}</span>
          {it.members.length > 0 && it.members.every((m) => cmd.isLocked(w, m)) && <LockMark testId={`locked-group-${it.g.name}`} />}
        </div>
      );
    }
    const e = it.e;
    const open = s.collapsed.includes(`open:${e.id}`);
    return (
      <div key={e.id} className={`row ${chosen.has(e.id) ? 'sel' : ''}`} style={{ paddingLeft: 8 + it.depth * 14 }} data-testid={`entity-row-${e.name}`}
        onClick={(ev) => s.pick('entity', e.id, ev, order)}
        onContextMenu={(ev) => {
          const cur = s.chosen('entity');
          const ids = cur.includes(e.id) ? cur : [e.id];
          if (!cur.includes(e.id)) s.pick('entity', e.id, {}, order);
          openMenu(ev, entityMenu(s.world!, ids), ids.length === 1 ? e.name : `${ids.length} chosen`);
        }}>
        {it.cities > 0 && <span className="twisty" title={open ? 'Hide its cities' : 'Show its cities'} onClick={(ev) => { ev.stopPropagation(); s.toggleCollapsed(`open:${e.id}`); }} data-testid={`cities-of-${e.name}`}>{open ? '▾' : '▸'}</span>}
        <FillSwatch entity={e} />{e.name}{it.cities > 0 && <span className="muted"> · {it.cities} {it.cities === 1 ? 'city' : 'cities'}</span>}
        {cmd.isLocked(w, e.id) && <LockMark testId={`locked-${e.name}`} />}
      </div>
    );
  })}</>;
});

/** The rows of the list of events (those the group filter shows). Drawn again only when `sig` changes. */
const EventRows = memo(function EventRows(_: { sig: string }) {
  const s = store, w = s.world!;
  const shown = sortedEvents(w).filter((e) => eventVisible(w, e.id));
  const order = shown.map((e) => e.id);
  const chosenEv = new Set(s.chosen('event'));
  return <>{shown.map((e) => (
    <div key={e.id} className={`row ${chosenEv.has(e.id) ? 'sel' : ''} ${e.variant_group && !e.variant_active ? 'dim' : ''}`} data-testid={`event-row-${e.name}`}
      onClick={(ev) => { s.pick('event', e.id, ev, order); if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) s.setTime(fromStore(e.start_day, e.start_ms)); }}
      onContextMenu={(ev) => {
        const cur = s.chosen('event');
        const ids = cur.includes(e.id) ? cur : [e.id];
        if (!cur.includes(e.id)) s.pick('event', e.id, {}, order);
        openMenu(ev, eventMenu(s.world!, ids), ids.length === 1 ? e.name : `${ids.length} events`);
      }}>
      <span className="date">{fmt(fromStore(e.start_day, e.start_ms), e.precision === 'year' ? 'year' : 'day')}</span> {(() => { const c = typeColor(w, e.type_id); return c ? <span className="swatch" style={{ background: c }} /> : null; })()}{e.name}
    </div>
  ))}</>;
});

export function Outliner() {
  const s = useStore();
  const w = s.world!;
  const [newEntity, setNewEntity] = useState<null | { name: string; type: string }>(null);
  const layers = w.all('layer').filter((l) => l.space_id === s.spaceId).sort((a, b) => a.sort_order - b.sort_order);
  const types = w.all('entity_type');
  const currentSpace = w.get('map_space', s.spaceId);
  const lists = outlinerLists(s);
  const { political, characters, others, looseOthers } = lists;
  // Long lists are drawn again only when what they show changes (see EntityRows and EventRows).
  const entitySig = `${lists.sig}|${s.chosen('entity').join(',')}`;
  const eventSig = [w.serial, w.tableRevision('event'), w.tableRevision('event_type'), w.tableRevision('event_group'), w.tableRevision('event_group_member'), (s.eventFilter ?? ['*']).join(','), s.chosen('event').join(',')].join('|');
  const events = sortedEvents(w);
  const hiddenEvents = s.eventFilter ? events.reduce((n, e) => n + (eventVisible(w, e.id) ? 0 : 1), 0) : 0;
  const createEntity = () => {
    if (!newEntity || !newEntity.name.trim()) return;
    const id = s.execute((wd) => cmd.createEntity(wd, { type_id: newEntity.type, name: newEntity.name }));
    if (id) {
      if (newEntity.type === 'character' || newEntity.type === 'settlement') s.set({ selection: { kind: 'entity', id }, placeValue: id, tool: 'place' });
      else s.set({ selection: { kind: 'entity', id }, paintValue: newEntity.type === 'polity' || newEntity.type === 'faction' ? id : s.paintValue });
    }
    setNewEntity(null);
  };
  // The form for a new entity shows in the section it was asked for from.
  const sectionOf = (type: string) => (type === 'character' ? 'characters' : type === 'settlement' ? 'cities' : 'countries');
  const newEntityForm = (section: 'countries' | 'characters' | 'cities') => newEntity && sectionOf(newEntity.type) === section && (
    <div className="new-entity">
      <input autoFocus placeholder="Name" value={newEntity.name} onChange={(e) => setNewEntity({ ...newEntity, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && createEntity()} data-testid={section === 'characters' ? 'new-character-name' : section === 'cities' ? 'new-city-name' : 'new-entity-name'} />
      {section === 'countries' && <select value={newEntity.type} onChange={(e) => setNewEntity({ ...newEntity, type: e.target.value })}>
        {types.filter((t) => t.id !== 'body' && t.id !== 'character' && t.id !== 'settlement').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>}
      <button onClick={createEntity} data-testid={section === 'characters' ? 'new-character-create' : section === 'cities' ? 'new-city-create' : 'new-entity-create'}>Create</button>
      <button onClick={() => setNewEntity(null)}>Cancel</button>
    </div>
  );
  return (
    <aside className="left">
      <Section title="Maps" onAdd={() => s.set({ dialog: 'new-world' })} addLabel="Map">
        {w.all('map_space').sort((a, b) => a.sort_order - b.sort_order).map((sp) => (
          <div key={sp.id} className={`row ${sp.id === s.spaceId ? 'sel' : ''}`} onClick={() => { const before = s.spaceId; s.set({ spaceId: sp.id, layerId: w.all('layer').find((l) => l.space_id === sp.id && l.kind === 'partition')?.id ?? '' }); s.mapChanged(before); }}>
            {sp.name}<span className="muted"> · {sp.kind === 'plane' ? `flat, ${(worldSettings(sp) as { widthKm?: number }).widthKm?.toLocaleString() ?? '?'} km wide` : `radius ${Math.round((sp.radius_m ?? 0) / 1000).toLocaleString()} km`}</span>
          </div>
        ))}
        {currentSpace && isSpaceMap(currentSpace) && (
          <button className="link pad-link" onClick={() => s.set({ dialog: 'sky-look' })} data-testid="open-sky-look" title="The stars' colours, shapes, glows and spikes, the sky, the lines and names, a flat chart, and how realms are drawn">How the stars look…</button>
        )}
        {currentSpace && currentSpace.kind !== 'plane' && !isSpaceMap(currentSpace) && (
          <div className="world-options">
            {!isPaleoEarth(currentSpace) && <label className="check" title="Land, lakes and coastlines from Natural Earth, drawn under the territories">
              <input type="checkbox" data-testid="basemap-toggle" checked={basemapSourceOf(currentSpace) === 'natural-earth'}
                onChange={(e) => s.execute((wd) => cmd.setWorldBasemap(wd, currentSpace.id, e.target.checked ? 'natural-earth' : 'none'))} /> Earth's geography
            </label>}
            {basemapSourceOf(currentSpace) === 'natural-earth' && (
              <label className="check" title="Today's country borders as a drawing aid. Never exported.">
                <input type="checkbox" data-testid="reference-borders-toggle" checked={s.referenceBorders} onChange={(e) => s.set({ referenceBorders: e.target.checked })} /> Present-day borders (guide)
              </label>
            )}
            <button className="link" onClick={() => s.set({ dialog: 'show' })} data-testid="open-show-lakes" title="Terrain, which lakes are shown (from what size), coastlines, and the rest">Terrain, lakes and what is shown…</button>
            {basemapSourceOf(currentSpace) === 'natural-earth' && (
              <button className="link" onClick={() => s.set({ dialog: 'sea-level' })} data-testid="open-sea-level" title="The sea higher or lower than today's at dates you choose; the coasts follow it">Sea level over time…</button>
            )}
            <button className="link" onClick={() => s.set({ dialog: 'data-sources' })} data-testid="data-sources">Data sources and credits</button>
          </div>
        )}
        <button className="link pad-link" onClick={() => s.set({ dialog: 'data-export' })} data-testid="open-data-export" title="The map at a date as GeoJSON; events, countries, relationships and features as CSV">Export data (GeoJSON, CSV)…</button>
      </Section>
      <Section title="Layers" onAdd={() => s.set({ dialog: 'new-layer' })} addLabel="Layer">
        {layers.map((l) => {
          const feat = isFeatureKind(l.kind), field = l.kind === 'field';
          const here = field ? s.tool === 'field' && s.fieldLayerId === l.id : feat ? s.tool === 'feature' && s.featureLayerId === l.id : l.id === s.layerId;
          return (
            <div key={l.id} className={`row ${here ? 'sel' : ''}`} data-testid="layer-row">
              <input type="checkbox" checked={!!l.visible} title="Show or hide" onChange={(e) => s.execute((wd) => cmd.updateLayer(wd, l.id, { visible: e.target.checked ? 1 : 0 }))} />
              <span onClick={() => (field ? s.set({ fieldLayerId: l.id, fieldSource: s.fieldLayerId === l.id ? s.fieldSource : {}, tool: 'field' }) : feat ? s.set({ featureLayerId: l.id, tool: 'feature', reshapeId: null }) : s.set({ layerId: l.id, tool: s.tool === 'feature' || s.tool === 'field' ? 'lasso' : s.tool }))} title="Draw on this layer">{l.name}</span>
              {feat && <span className="muted"> · {l.kind === 'area' ? 'areas' : l.kind === 'line' ? 'lines' : 'points'}</span>}
              {field && <span className="muted"> · conditions</span>}
              {here && <span className="muted"> · drawing here</span>}
            </div>
          );
        })}
        {layers.filter((l) => l.id === s.layerId).map((l) => (
          <label key={`fill-${l.id}`} className="inline layer-option" title="Stripes or dots let the layers under this one show through: for occupation, control or influence over the political map">Fill
            <select value={parseJSON<{ fill?: string }>(l.style, {}).fill ?? 'solid'} onChange={(e) => s.execute((wd) => cmd.setLayerFill(wd, l.id, e.target.value as 'solid' | 'hatch' | 'cross' | 'dots'))} data-testid="layer-fill">
              <option value="solid">Solid</option>
              <option value="hatch">Stripes</option>
              <option value="cross">Crossed stripes</option>
              <option value="dots">Dots</option>
            </select>
          </label>
        ))}
        {layers.filter((l) => l.id === s.layerId && l.kind === 'partition').map((l) => {
          const st = parseJSON<{ fillOpacity?: number; borderWidth?: number }>(l.style, {});
          return (
            <div key={`look-${l.id}`} className="two layer-option">
              <label title="How strongly the countries' colours cover the map under them, in shots and exports too">Opacity (%)<NumberField min={0} max={100} step={5} value={Math.round((st.fillOpacity ?? 0.78) * 100)} onCommit={(n) => s.execute((wd) => cmd.setLayerLook(wd, l.id, { fillOpacity: n / 100 }))} testId="layer-opacity" /></label>
              <label title="The width of the borders between countries on this layer (pixels at 1920 wide)">Border width<NumberField min={0} max={20} step={0.25} value={st.borderWidth ?? 1.3} onCommit={(n) => s.execute((wd) => cmd.setLayerLook(wd, l.id, { borderWidth: n }))} testId="layer-border-width" /></label>
            </div>
          );
        })}
        {layers.filter((l) => l.id === s.layerId).map((l) => {
          const st = parseJSON<{ fronts?: 'second' | 'first' | 'plain'; frontColor?: string }>(l.style, {});
          return (
            <label key={`fronts-${l.id}`} className="inline layer-option" title="Where two countries are at war (Relationships, in a country's panel), the border between them on this layer is drawn as a front line while the war lasts">Front lines
              <select value={st.fronts ?? 'off'} onChange={(e) => s.execute((wd) => cmd.setLayerFronts(wd, l.id, e.target.value === 'off' ? null : e.target.value as 'second' | 'first' | 'plain'))} data-testid="layer-fronts">
                <option value="off">None</option>
                <option value="second" title="Where two countries are at war: teeth into the second of the war (as entered)">Teeth to the 2nd</option>
                <option value="first" title="Where two countries are at war: teeth into the first of the war">Teeth to the 1st</option>
                <option value="plain">No teeth</option>
              </select>
              {st.fronts && <input type="color" value={st.frontColor ?? '#d62828'} onChange={(e) => s.execute((wd) => cmd.setLayerFronts(wd, l.id, st.fronts!, e.target.value))} title="The colour of the front lines" data-testid="layer-front-color" />}
            </label>
          );
        })}
        {layers.filter((l) => l.id === s.layerId && currentSpace && terrainSourceOf(currentSpace)).map((l) => (
          <label key={`clip-${l.id}`} className="check layer-option" title="Territory painted over the sea or lakes is not shown there. Untick for sea claims or maritime zones.">
            <input type="checkbox" data-testid="clip-to-land" checked={parseJSON<{ clipToLand?: boolean }>(l.style, {}).clipToLand !== false}
              onChange={(e) => s.execute((wd) => cmd.setLayerClipToLand(wd, l.id, e.target.checked))} /> Territory ends at the coast
          </label>
        ))}
      </Section>
      <Section title="Countries and factions" onAdd={() => setNewEntity({ name: '', type: 'polity' })} addLabel="New">
        {newEntityForm('countries')}
        <EntityRows sig={entitySig} section="countries" />
        {political.length > 0 && <div className="muted small-hint">Ctrl or Shift + click to choose several; right-click for quick actions.</div>}
        <button className="link pad-link" onClick={async () => { const name = await s.askText('New group', 'Name of the group (for example "My nations" or "Europe")', '', 'Create group'); if (name) s.execute((wd) => cmd.createEntityGroup(wd, name, s.chosen('entity'))); }} data-testid="new-entity-group">New group{s.chosen('entity').length > 1 ? ` of the ${s.chosen('entity').length} chosen` : ''}…</button>
        {political.length > 0 && <button className="link pad-link" onClick={() => s.set({ dialog: 'label-style' })} data-testid="open-label-style">Label style for all countries…</button>}
        {currentSpace && basemapSourceOf(currentSpace) === 'natural-earth' && <button className="link pad-link" onClick={() => s.set({ dialog: 'add-countries' })} data-testid="open-add-countries">Add today's countries…</button>}
        {currentSpace && !isSpaceMap(currentSpace) && <button className="link pad-link" onClick={() => s.set({ dialog: 'import-borders' })} data-testid="open-import-borders" title="GeoJSON maps of borders, one for each date: their countries and how their land changed between them">Import borders from files…</button>}
        {!political.length && !newEntity && <div className="muted pad">None yet.</div>}
      </Section>
      <Section title="Characters" onAdd={() => setNewEntity({ name: '', type: 'character' })} addLabel="Character">
        {newEntityForm('characters')}
        <EntityRows sig={entitySig} section="characters" />
        {!characters.length && !(newEntity?.type === 'character') && <div className="muted pad">None yet. Characters are points on the map that move over time.</div>}
      </Section>
      <Section title="Cities and others" onAdd={() => setNewEntity({ name: '', type: 'settlement' })} addLabel="City">
        {newEntityForm('cities')}
        <EntityRows sig={entitySig} section="cities" />
        {!others.length && newEntity?.type !== 'settlement' && <div className="muted pad">None yet. Cities are points on the map, founded and abandoned at dates.</div>}
        {others.length > looseOthers.length && <div className="muted small-hint">Cities in a country are listed under it.</div>}
      </Section>
      <Section title="Areas, lines and points" onAdd={() => (featureLayers(s).length ? s.set({ tool: 'feature' }) : s.set({ dialog: 'new-layer' }))} addLabel="Draw">
        <FeatureRows />
      </Section>
      <Section title="Events" onAdd={() => s.set({ dialog: 'new-event' })} addLabel="Event">
        <EventRows sig={eventSig} />
        {events.length > 1 && <div className="muted small-hint">Ctrl or Shift + click to choose several; Delete or right-click to delete them.</div>}
        {!events.length && <div className="muted pad">No events yet.</div>}
        <button className="link pad-link" onClick={() => s.set({ dialog: 'event-types' })} data-testid="open-event-types">Event types…</button>
        {hiddenEvents > 0 && (
          <div className="muted pad" data-testid="events-hidden">{hiddenEvents} hidden by the group filter · <button className="link" onClick={() => s.set({ eventFilter: null })}>show all</button></div>
        )}
      </Section>
    </aside>
  );
}

export function Inspector() {
  const s = useStore();
  const sel = s.selection;
  return (
    <aside className="right">
      {!sel && <QuickStart />}
      {sel?.kind === 'entity' && <EntityPanel id={sel.id} />}
      {sel?.kind === 'event' && <EventPanel id={sel.id} />}
      {sel?.kind === 'point' && <PointPanel lon={sel.lon} lat={sel.lat} />}
      {sel?.kind === 'feature' && <FeaturePanel id={sel.id} />}
      {sel?.kind === 'star' && <StarPanel id={sel.id} />}
    </aside>
  );
}

function QuickStart() {
  return (
    <div className="panel">
      <h3>Getting started</h3>
      <ol className="steps">
        <li>Create a country under <b>Countries and factions</b> (+ New).</li>
        <li>Pick the <b>Territory brush</b>, choose who gets the land, and draw around an area.</li>
        <li>Say what the drawing means: a change from the current date, or a correction.</li>
        <li>Add an <b>event</b>, move the red playhead on the timeline, and draw again: history now changes at that date.</li>
        <li>Drag the playhead to see the map before and after.</li>
      </ol>
      <p className="muted">Everything is saved as you go. Undo with Ctrl+Z. Use <b>Versions</b> to keep named restore points.</p>
    </div>
  );
}

function EntityPanel({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const e = w.get('entity', id);
  const [name, setName] = useState(e?.name ?? '');
  const [notes, setNotes] = useState(e?.notes ?? '');
  useEffect(() => { setName(e?.name ?? ''); setNotes(e?.notes ?? ''); }, [id, e?.name, e?.notes]);
  if (!e) return null;
  const radius = w.get('map_space', s.spaceId)?.radius_m ?? 6371000;
  let areaSr = 0, parcels = 0;
  if (s.layerId) {
    const arr = w.arrangement(s.spaceId);
    for (const [f, st] of s.engine!.partitionState(s.spaceId, s.layerId, s.time)) if (st.value === id) { areaSr += arr.faceArea(f); parcels++; }
  }
  const changes = w.rows('effect').filter((f) => resolutionOf(f).set.some(([, v]) => v === id));
  return (
    <div className="panel" data-testid="entity-panel">
      <h3><span className="swatch big" style={{ background: e.color }} /> {e.name}</h3>
      <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEntity(wd, id, { name: name.trim() }))} /></label>
      <label>Colour<input type="color" value={e.color} onChange={(ev) => s.execute((wd) => cmd.updateEntity(wd, id, { color: ev.target.value }))} /></label>
      <label>Type<select value={e.type_id} onChange={(ev) => s.execute((wd) => cmd.updateEntity(wd, id, { type_id: ev.target.value }))}>{w.all('entity_type').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {(e.type_id === 'polity' || e.type_id === 'faction') && (
        <label className="check" title="While locked, drawing over it leaves its land out, it is given no land, and it cannot be split, merged or annexed, nor its border points moved">
          <input type="checkbox" checked={cmd.isLocked(w, id)} onChange={(ev) => s.execute((wd) => cmd.setLocked(wd, [id], ev.target.checked))} data-testid="entity-locked" /> Locked: its land and borders stay as they are
        </label>
      )}
      <label>Notes<textarea rows={5} value={notes} onChange={(ev) => setNotes(ev.target.value)} onBlur={() => notes !== e.notes && s.execute((wd) => cmd.updateEntity(wd, id, { notes }))} /></label>
      <PicturesSection holder={{ kind: 'entity', id }} />
      {e.type_id !== 'character' && e.type_id !== 'settlement' && <div className="stat">On {fmt(s.time)}: {parcels ? `${Math.round(areaSr * (radius / 1000) ** 2).toLocaleString()} km²` : 'no territory'} </div>}
      {(e.type_id === 'polity' || e.type_id === 'faction') && <button onClick={() => s.set({ paintValue: id, tool: 'lasso' })}>Draw territory for {e.name}</button>}
      {e.type_id !== 'character' && e.type_id !== 'settlement' && <h4>Territorial changes</h4>}
      {changeRows(w, changes).map((r) => (
        <div key={r.key} className="row" onClick={() => s.set({ selection: { kind: 'event', id: r.eventId }, time: r.time ?? s.time })}>
          {r.time ? <><span className="date">{fmt(r.time)}</span> {r.label}</> : r.label}
        </div>
      ))}
      {!changes.length && e.type_id !== 'character' && e.type_id !== 'settlement' && <div className="muted">None yet.</div>}
      {(e.type_id === 'polity' || e.type_id === 'faction') && <><CountryHistorySection id={id} /><CountryFillSection id={id} /><CountryLabelSection id={id} /></>}
      {(e.type_id === 'character' || e.type_id === 'settlement') && <CharacterSection id={id} />}
      {e.type_id !== 'body' && <RelationsSection id={id} />}
      {e.type_id !== 'body' && <NamesSection id={id} />}
      <button className="danger" onClick={() => { if (confirm(`Delete ${e.name}? Events that refer to it will be flagged in History Health.`)) { s.execute((wd) => cmd.deleteEntity(wd, id)); s.set({ selection: null }); } }}>Delete</button>
    </div>
  );
}

/**
 * A country's territorial changes in date order: the starting map, each event once, and each change
 * made without an event on its own date.
 */
function changeRows(w: World, changes: EffectRow[]): Array<{ key: string; eventId: string; time: Instant | null; label: string }> {
  const rows: Array<{ key: string; eventId: string; time: Instant | null; label: string }> = [];
  const seen = new Set<string>();
  for (const f of changes) {
    if (isUntracked(f)) { rows.push({ key: f.id, eventId: BASE_EVENT_ID, time: fromStore(f.at_day!, f.at_ms ?? 0), label: 'Change without an event' }); continue; }
    if (seen.has(f.event_id)) continue;
    seen.add(f.event_id);
    const ev = w.get('event', f.event_id);
    if (!ev) continue;
    rows.push(ev.id === BASE_EVENT_ID
      ? { key: ev.id, eventId: ev.id, time: null, label: 'Starting map (from the beginning)' }
      : { key: ev.id, eventId: ev.id, time: fromStore(ev.start_day, ev.start_ms), label: ev.name });
  }
  return rows.sort((a, b) => (a.time ? (b.time ? compare(a.time, b.time) : 1) : b.time ? -1 : 0));
}

function describeEffect(s: ReturnType<typeof useStore>, f: EffectRow): string {
  const w = s.world!;
  const name = (v: string | null) => (v ? w.get('entity', v)?.name ?? '(deleted)' : 'nobody');
  if (f.kind === 'annex') {
    const i = parseJSON<{ from: string; to: string }>(f.intent, { from: '', to: '' });
    return `${name(i.to)} annexes everything ${name(i.from)} holds`;
  }
  if (f.kind === 'rename') {
    const i = parseJSON<{ entity: string; name: string }>(f.intent, { entity: '', name: '' });
    return `${name(i.entity)} is called ${i.name}`;
  }
  if (f.kind === 'relate') {
    const i = parseJSON<{ relation: string; on?: boolean }>(f.intent, { relation: '' });
    const r = w.get('relation', i.relation);
    const what = r ? cmd.describeRelation(w, r) : '(a deleted relationship)';
    return `${i.on ? 'Begins' : 'Ends'}: ${what}${f.at_day !== null ? ` (at ${fmt(fromStore(f.at_day, f.at_ms ?? 0), 'minute')})` : ''}`;
  }
  if (f.kind === 'shape') {
    const i = parseJSON<{ feature: string; off?: boolean }>(f.intent, { feature: '' });
    const ft = w.get('feature', i.feature);
    const what = ft ? `"${ft.name}"` : '(deleted)';
    const layer = f.layer_id ? w.get('layer', f.layer_id)?.name ?? '' : '';
    return `${layer ? `${layer}: ` : ''}${i.off ? `${what} ends` : `${what} takes its shape`}${f.at_day !== null ? ` (at ${fmt(fromStore(f.at_day, f.at_ms ?? 0), 'minute')})` : ''}`;
  }
  if (f.kind === 'place') {
    const i = parseJSON<{ entity: string; lon?: number; lat?: number; off?: boolean }>(f.intent, { entity: '' });
    return i.off ? `${name(i.entity)} leaves the map` : `${name(i.entity)} is at ${Math.abs(i.lat ?? 0).toFixed(2)}°${(i.lat ?? 0) >= 0 ? 'N' : 'S'}, ${Math.abs(i.lon ?? 0).toFixed(2)}°${(i.lon ?? 0) >= 0 ? 'E' : 'W'}`;
  }
  const res = parseJSON<Resolution>(f.resolution, { set: [] });
  const arr = f.space_id ? w.arrangements.get(f.space_id) : undefined;
  const parts = res.set.map(([faces, v]) => {
    const n = arr ? leafDescendants(arr, faces).size : faces.length;
    return `${n} parcel${n === 1 ? '' : 's'} → ${name(v)}`;
  });
  const layer = f.layer_id ? w.get('layer', f.layer_id)?.name : '';
  return `${layer}: ${parts.join('; ')}${f.at_day !== null ? ` (at ${fmt(fromStore(f.at_day, f.at_ms ?? 0), 'minute')})` : ''}`;
}

function EventPanel({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const e = w.get('event', id);
  const [name, setName] = useState(e?.name ?? '');
  const [desc, setDesc] = useState(e?.description ?? '');
  const [annexFrom, setAnnexFrom] = useState('');
  const [annexTo, setAnnexTo] = useState('');
  useEffect(() => { setName(e?.name ?? ''); setDesc(e?.description ?? ''); }, [id, e?.name, e?.description]);
  if (!e) return null;
  const base = id === BASE_EVENT_ID;
  const effects = w.all('effect').filter((f) => f.event_id === id).sort((a, b) => a.ordinal - b.ordinal);
  const start = fromStore(e.start_day, e.start_ms);
  const end = e.end_day !== null ? fromStore(e.end_day, e.end_ms ?? 0) : null;
  const variants = e.variant_group ? w.all('event').filter((x) => x.variant_group === e.variant_group) : [];
  const owners = w.all('entity').filter((x) => x.type_id === 'polity' || x.type_id === 'faction');
  const setTransition = (f: EffectRow, style: string) => {
    const old = parseJSON<TransitionSpec | null>(f.transition, null);
    let spec: TransitionSpec | null = null;
    if (style === 'advance') spec = { style: 'advance', origin: old?.origin ?? regionCentre(s, f), easing: 'smooth' };
    else if (style === 'border') spec = { style: 'border', easing: 'smooth' };
    else if (style === 'dissolve') spec = { style: 'dissolve', easing: 'smooth' };
    else if (style === 'fade') spec = { style: 'fade' };
    // How long it takes is kept (D86); in an event without an end, a change that starts to spread takes a year until chosen otherwise.
    if (spec) {
      if (old?.until) spec.until = old.until;
      else if (old?.for) spec.for = old.for;
      else if (!end) spec.for = { n: 1, unit: 'year' };
      if (old?.next) spec.next = true;
      if (spec.style === 'advance' && old?.origins) spec.origins = old.origins;
    }
    s.execute((wd) => cmd.setEffectTransition(wd, f.id, spec));
  };
  return (
    <div className="panel" data-testid="event-panel">
      <h3>{base ? 'Starting map and changes without an event' : e.name}</h3>
      {!base && <>
        <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEvent(wd, id, { name: name.trim() }))} /></label>
        <label>Type<span className="row-inline"><TypeDot typeId={e.type_id} /><TypeSelect value={e.type_id} onChange={(t) => s.execute((wd) => cmd.updateEvent(wd, id, { type_id: t }))} testId="event-panel-type" /><button className="small" onClick={() => s.set({ dialog: 'event-types' })} title="Make, change and delete event types">Types…</button></span></label>
        <label>Starts<DateField value={start} onChange={(t) => t && s.execute((wd) => cmd.updateEvent(wd, id, { start: t }))} testId="event-panel-start" /></label>
        <label>Ends<DateField value={end} allowEmpty suggest={start} onChange={(t) => s.execute((wd) => cmd.updateEvent(wd, id, { end: t }))} testId="event-panel-end" /></label>
        {(() => {
          // In presentations (D92): following the clock, or taking its own time on screen.
          const own = eventScreenSeconds(e.presentation);
          return (
            <label title="In a presentation, its changes can take a set time on screen from the moment they happen, however fast the clock runs (a one-day battle in a shot of centuries, say)">In presentations
              <span className="row-inline">
                <select value={own ? 'own' : 'clock'} onChange={(ev) => s.execute((wd) => cmd.setEventScreenSeconds(wd, id, ev.target.value === 'own' ? 2 : null))} data-testid="event-screen">
                  <option value="clock">Follows the clock</option>
                  <option value="own">Takes its own time on screen</option>
                </select>
                {own && <><NumberField value={own} min={0.1} max={600} step={0.5} onCommit={(n) => s.execute((wd) => cmd.setEventScreenSeconds(wd, id, n))} testId="event-screen-seconds" title="Screen seconds" /> s</>}
              </span>
            </label>
          );
        })()}
        <label title="How its changes look when they animate, here and in every shot: as the shot's look, or a look of their own (a blitz in a film otherwise clean)">Look of its changes
          <select value={eventTransitionLook(e.presentation) ?? ''} onChange={(ev) => s.execute((wd) => cmd.setEventLook(wd, id, ev.target.value || null))} data-testid="event-look">
            <option value="">As the shot's look</option>
            {TRANSITION_LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label title="When two events change the same place at the same instant, the higher precedence wins">Precedence<NumberField value={e.precedence} step={1} onCommit={(n) => s.execute((wd) => cmd.updateEvent(wd, id, { precedence: Math.round(n) }))} /></label>
        <label>Description<textarea rows={4} value={desc} onChange={(ev) => setDesc(ev.target.value)} onBlur={() => desc !== e.description && s.execute((wd) => cmd.updateEvent(wd, id, { description: desc }))} /></label>
        <PicturesSection holder={{ kind: 'event', id }} />
        <h4>Groups</h4>
        <GroupChecks eventId={id} />
        <div className="buttons">
          {s.recordEventId === id
            ? <button onClick={() => s.set({ recordEventId: null })}>Stop recording</button>
            : <button onClick={() => s.set({ recordEventId: id, time: compare(s.time, start) < 0 ? start : s.time, tool: s.tool === 'select' ? 'lasso' : s.tool })} title="Every territory you draw goes into this event, without asking" data-testid="record-event">Record into this event</button>}
          <button onClick={() => s.setTime(start)}>Go to start</button>
          {end && <button onClick={() => s.setTime(end)}>Go to end</button>}
        </div>
      </>}
      <h4>Changes</h4>
      {effects.map((f) => (
        <div key={f.id} className="effect">
          <div>{isUntracked(f) && <span className="date">{fmt(fromStore(f.at_day!, f.at_ms ?? 0))} · </span>}{describeEffect(s, f)}</div>
          {base && isUntracked(f) && <div className="effect-tools"><button className="small" onClick={() => s.setTime(fromStore(f.at_day!, f.at_ms ?? 0))}>Go to</button><button className="small danger" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, f.id))}>Remove</button></div>}
          {!base && f.layer_id && f.kind !== 'shape' && (
            <div className="effect-tools">
              <label className="inline">Animation
                <select value={parseJSON<TransitionSpec | null>(f.transition, null)?.style ?? 'instant'} onChange={(ev) => setTransition(f, ev.target.value)} data-testid="transition-style">
                  <option value="instant">Instant</option>
                  <option value="border">Advancing front (through the land from the border)</option>
                  <option value="advance">Expansion (from where it was drawn)</option>
                  <option value="dissolve">Dissolve (in patches)</option>
                  <option value="fade">Fade</option>
                </select>
              </label>
              <button className="small danger" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, f.id))}>Remove</button>
              <ChangeLength f={f} ev={e} />
              {(() => {
                // An expansion's starting points (D91): more of them, and it spreads from all at once.
                const sp = parseJSON<TransitionSpec | null>(f.transition, null);
                if (sp?.style !== 'advance' || !sp.origin) return null;
                const n = 1 + (sp.origins?.length ?? 0);
                return (
                  <span className="change-length" data-testid="change-origins">
                    <span className="muted">Spreads from {n === 1 ? 'one point' : `${n} points at once`}</span>
                    <button className="small" onClick={() => { s.set({ pickOrigin: f.id }); s.toast('Click on the map where it also starts from.'); }} data-testid="add-origin">{s.pickOrigin === f.id ? 'Click the map…' : 'Add a starting point'}</button>
                    {n > 1 && <button className="small" onClick={() => s.execute((wd) => cmd.clearTransitionOrigins(wd, f.id))} data-testid="clear-origins">Only the first</button>}
                  </span>
                );
              })()}
            </div>
          )}
        </div>
      ))}
      {!effects.length && <div className="muted">No changes yet. Use “Record into this event” and draw on the map.</div>}
      {!base && owners.length >= 2 && (
        <div className="annex">
          <h4>Annexation (keeps its intention)</h4>
          <select value={annexTo} onChange={(ev) => setAnnexTo(ev.target.value)}><option value="">Who annexes…</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select value={annexFrom} onChange={(ev) => setAnnexFrom(ev.target.value)}><option value="">…everything held by</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <button disabled={!annexFrom || !annexTo || annexFrom === annexTo} onClick={() => s.execute((wd, en) => cmd.annex(wd, en, { spaceId: s.spaceId, layerId: s.layerId, eventId: id, from: annexFrom, to: annexTo }))}>Add annexation</button>
        </div>
      )}
      {!base && <>
        <h4>Alternative versions</h4>
        {variants.map((v) => (
          <div key={v.id} className={`row ${v.id === id ? 'sel' : ''}`}>
            <span onClick={() => s.set({ selection: { kind: 'event', id: v.id } })}>{v.name}</span>
            {v.variant_active ? <span className="muted"> · active</span> : <button className="small" onClick={() => s.execute((wd) => cmd.activateVariant(wd, v.id))}>Use this version</button>}
          </div>
        ))}
        <button onClick={async () => { const n = await s.askText('Alternative version', 'Name of the alternative version', `${e.name} (alternative)`, 'Create'); if (n) { const nid = s.execute((wd) => cmd.createVariant(wd, id, n)); if (nid) s.set({ selection: { kind: 'event', id: nid } }); } }}>Create alternative version</button>
        <button className="danger" onClick={() => { if (confirm(`Delete the event "${e.name}" and its changes?`)) { s.execute((wd) => cmd.deleteEvent(wd, id)); s.set({ selection: null, recordEventId: s.recordEventId === id ? null : s.recordEventId }); } }}>Delete event</button>
      </>}
    </div>
  );
}

function regionCentre(s: ReturnType<typeof useStore>, f: EffectRow): [number, number] {
  const w = s.world!;
  if (!f.space_id) return [0, 0];
  const arr = w.arrangement(f.space_id);
  const res = parseJSON<Resolution>(f.resolution, { set: [] });
  let x = 0, y = 0, z = 0;
  for (const [faces] of res.set) for (const leaf of leafDescendants(arr, faces)) for (const cyc of arr.faceCycles(leaf)) for (const vid of cyc) {
    const v = arr.v(vid); x += v[0]; y += v[1]; z += v[2];
  }
  const n = Math.hypot(x, y, z) || 1;
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(z / n) * 180 / Math.PI];
}

function PointPanel({ lon, lat }: { lon: number; lat: number }) {
  const s = useStore();
  const w = s.world!;
  if (!s.layerId) return null;
  const p = lonLatToVec(lon, lat);
  const value = s.engine!.valueAtPoint(s.spaceId, s.layerId, p, s.time);
  const face = w.arrangement(s.spaceId).locate(p);
  const a = s.engine!.latest(s.spaceId, s.layerId, face, s.time);
  const ev = a ? w.get('event', a.eventId) : null;
  const next = s.engine!.nextChange(s.spaceId, s.layerId, [face], s.time);
  const owner = value ? w.get('entity', value) : null;
  return (
    <div className="panel" data-testid="point-panel">
      <h3>Place</h3>
      <div className="muted">{lat.toFixed(4)}°, {lon.toFixed(4)}°</div>
      <div className="stat" data-testid="point-owner">
        On {fmt(s.time, 'minute')}: {owner ? <><span className="swatch" style={{ background: owner.color }} /> <b>{owner.name}</b></> : <b>nobody</b>}
      </div>
      {ev && <div>Since {ev.id === BASE_EVENT_ID
        ? (a!.t.day === -Infinity ? 'the starting map' : <>{fmt(a!.t, 'day')} (<a onClick={() => s.set({ selection: { kind: 'event', id: ev.id } })}>a change without an event</a>)</>)
        : <>{fmt(a!.t, 'day')} (<a onClick={() => s.set({ selection: { kind: 'event', id: ev.id } })}>{ev.name}</a>)</>}</div>}
      <div>{next ? <>Until {fmt(next, 'day')}</> : 'No later change recorded'}</div>
      {owner && <button onClick={() => s.set({ selection: { kind: 'entity', id: owner.id } })}>Open {owner.name}</button>}
    </div>
  );
}

export function Toasts() {
  const s = useStore();
  return <div className="toasts">{s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} data-testid={`toast-${t.kind}`}>{t.text}</div>)}</div>;
}

export function formatNegInf(t: Instant) { return compare(t, NEG_INF) === 0 ? 'the beginning' : fmt(t); }
export { formatYear };

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
      <label className="inline" title="The brush's radius on the ground">Size
        <input type="number" min={1} max={5000} step={10} value={b.radiusKm} onChange={(e) => Number(e.target.value) > 0 && set({ radiusKm: Math.min(5000, Number(e.target.value)) })} data-testid="sculpt-size" /> km
      </label>
      {uses && (
        <label className="inline" title={b.tool === 'land' ? 'How high the new land stands' : b.tool === 'sea' ? 'How deep the new sea is' : 'How much the brush raises or lowers'}>{b.tool === 'land' ? 'Height' : b.tool === 'sea' ? 'Depth' : 'Strength'}
          <input type="number" min={1} max={10000} step={50} value={b.strength} onChange={(e) => Number(e.target.value) > 0 && set({ strength: Math.min(10000, Number(e.target.value)) })} data-testid="sculpt-strength" /> m
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
