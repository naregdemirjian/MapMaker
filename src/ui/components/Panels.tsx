import { useState, useEffect } from 'react';
import { useStore, store, type Tool } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, gregorian, fromStore, formatYear, compare, NEG_INF } from '../../core-time/index.ts';
import { BASE_EVENT_ID, type EffectRow } from '../../world-model/schema.ts';
import { basemapSourceOf, worldSettings } from '../../world-model/world-settings.ts';
import { parseJSON, leafDescendants, isUntracked, type Resolution, type TransitionSpec } from '../../temporal-engine/engine.ts';
import type { World } from '../../world-model/world.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { stepChange } from './Timeline.tsx';
import { GroupChecks, eventVisible } from './EventGroups.tsx';
import { CountryLabelSection } from './LabelStyles.tsx';
import { CountryFillSection, FillSwatch } from './CountryFill.tsx';
import { CharacterSection } from './Characters.tsx';
import { openMenu, entityMenu, groupMenu, eventMenu } from './ContextMenu.tsx';
import { CountryHistorySection } from './CountryHistory.tsx';
import { NamesSection } from './Names.tsx';

export const fmt = (t: Instant, precision: 'year' | 'day' | 'minute' = 'day') => gregorian.format(t, precision);

export function DateField({ value, onChange, placeholder, allowEmpty, testId }: { value: Instant | null; onChange: (t: Instant | null) => void; placeholder?: string; allowEmpty?: boolean; testId?: string }) {
  const [text, setText] = useState(value ? fmt(value, value.ms ? 'minute' : 'day') : '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value ? fmt(value, value.ms ? 'minute' : 'day') : ''); setBad(false); }, [value?.day, value?.ms]);
  const commit = () => {
    if (!text.trim()) { if (allowEmpty) onChange(null); else setBad(true); return; }
    const p = gregorian.parse(text);
    if (!p) { setBad(true); return; }
    setBad(false);
    onChange(p.instant);
  };
  return (
    <input
      className={bad ? 'date-input bad' : 'date-input'} value={text} placeholder={placeholder ?? 'e.g. 14 May 1203, 500 BCE, 2241-03-02'}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
      title="Dates: 14 May 1203 · May 1203 · 1203 · 500 BCE · 2241-03-02T04:05 · c. 3000 BCE" data-testid={testId}
    />
  );
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

export function TopBar() {
  const s = useStore();
  const w = s.world!;
  s.engine!.ensure();
  const conflicts = s.engine!.conflicts;
  const spaces = w.all('map_space').sort((a, b) => a.sort_order - b.sort_order);
  const switchSpace = (id: string) => {
    const layer = w.all('layer').find((l) => l.space_id === id && l.kind === 'partition');
    s.set({ spaceId: id, layerId: layer?.id ?? '', selection: null, presentCamera: null });
  };
  return (
    <header className="topbar">
      <div className="brand">Map Maker</div>
      <div className="project-name" title={s.projectDir}>{s.projectId}</div>
      <div className="seg">
        <button className={s.mode === 'world' ? 'on' : ''} onClick={() => s.set({ mode: 'world', presentCamera: null, playing: false })} data-testid="mode-world">World-building</button>
        <button className={s.mode === 'present' ? 'on' : ''} onClick={() => s.set({ mode: 'present' })} data-testid="mode-present">Presentation</button>
      </div>
      <select value={s.spaceId} onChange={(e) => switchSpace(e.target.value)} title="Which map you are looking at">
        {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
      </select>
      {s.mode === 'world' && (
        <div className="datebar">
          <button onClick={() => stepChange(-1)} title="Previous change">◀</button>
          <DateField value={s.time} onChange={(t) => t && s.setTime(t)} testId="current-date" />
          <button onClick={() => stepChange(1)} title="Next change">▶</button>
        </div>
      )}
      <div className="spacer" />
      <button disabled={!s.journal.canUndo} title={s.journal.undoLabel ? `Undo: ${s.journal.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={() => s.undo()} data-testid="undo">Undo</button>
      <button disabled={!s.journal.canRedo} title={s.journal.redoLabel ? `Redo: ${s.journal.redoLabel} (Ctrl+Y)` : 'Nothing to redo'} onClick={() => s.redo()}>Redo</button>
      <button onClick={() => s.set({ dialog: 'versions' })} title="Save a named version, restore versions and backups">Versions</button>
      <button className={conflicts.length ? 'warn' : ''} onClick={() => s.set({ dialog: 'health' })} data-testid="health">
        History Health{conflicts.length ? ` (${conflicts.length})` : ' ✓'}
      </button>
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
  { id: 'erase', name: 'Border eraser', hint: 'Drag across borders to erase them: the country where you start takes the land across each border you cross, from the date viewed (or in the event being recorded). Start outside any country to clear land.' },
  { id: 'place', name: 'Characters & cities', hint: 'Click the map to put the chosen character or city there from the date being viewed (a point, no borders). With Select, drag one to move it.' },
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

export function ToolBar() {
  const s = useStore();
  const w = s.world!;
  const owners = w.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const rec = s.recordEventId ? w.get('event', s.recordEventId) : null;
  return (
    <>
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.id} className={s.tool === t.id ? 'on' : ''} title={t.hint} onClick={() => s.set({ tool: t.id })} data-testid={`tool-${t.id}`}>{t.name}</button>
      ))}
      {(s.tool === 'lasso' || s.tool === 'polygon' || s.tool === 'pen') && (
        <>
          <label className="inline">Give to
            <select value={s.paintValue ?? ''} onChange={(e) => { s.set({ paintValue: e.target.value || null }); if (s.tool === 'pen' && s.draft) s.setDraftOwner(s.draft.id, e.target.value || null); }} data-testid="paint-owner">
              <option value="">Nobody (clear territory)</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          {s.tool === 'pen' && <PenControls />}
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
        </>
      )}
    </div>
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
        <button onClick={() => s.set({ recordEventId: null })}>Stop</button>
      </div>
    )}
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

export function Outliner() {
  const s = useStore();
  const w = s.world!;
  const [newEntity, setNewEntity] = useState<null | { name: string; type: string }>(null);
  const layers = w.all('layer').filter((l) => l.space_id === s.spaceId).sort((a, b) => a.sort_order - b.sort_order);
  const types = w.all('entity_type');
  const currentSpace = w.get('map_space', s.spaceId);
  const political = w.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const characters = w.all('entity').filter((e) => e.type_id === 'character').sort((a, b) => a.name.localeCompare(b.name));
  const others = w.all('entity').filter((e) => e.type_id !== 'polity' && e.type_id !== 'faction' && e.type_id !== 'body' && e.type_id !== 'character').sort((a, b) => (a.type_id === 'settlement' ? 0 : 1) - (b.type_id === 'settlement' ? 0 : 1) || a.name.localeCompare(b.name));
  const events = w.all('event').filter((e) => e.id !== BASE_EVENT_ID).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms);
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
  // The lists: groups (folders) of the user's own, each country with the cities in it (at the date
  // viewed), Ctrl/Shift + click to choose several, right-click for quick actions.
  type Ent = (typeof political)[number];
  const groups = w.all('entity_group').sort((a, b) => a.sort_order - b.sort_order || a.created_seq - b.created_seq);
  const cityIn = new Map<string, string>(); // city -> the country holding the place it stands on
  if (s.layerId) for (const c of s.engine!.charactersAt(s.spaceId, s.time)) {
    if (w.get('entity', c.entity)?.type_id !== 'settlement') continue;
    const owner = s.engine!.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(c.lon, c.lat), s.time);
    if (owner) cityIn.set(c.entity, owner);
  }
  const citiesOf = new Map<string, Ent[]>();
  for (const e of w.all('entity')) {
    const owner = e.type_id === 'settlement' ? cityIn.get(e.id) : undefined;
    if (owner && w.get('entity', owner)) { const l = citiesOf.get(owner) ?? []; l.push(e); citiesOf.set(owner, l); }
  }
  for (const l of citiesOf.values()) l.sort((a, b) => a.name.localeCompare(b.name));
  type Item = { kind: 'group'; g: (typeof groups)[number]; members: string[] } | { kind: 'entity'; e: Ent; depth: number; cities: number };
  /** Rows for a section: its groups (with their members), then what is in no group. */
  const itemsFor = (members: Ent[], showEmptyGroups: boolean): Item[] => {
    const out: Item[] = [];
    const add = (e: Ent, depth: number) => {
      const kids = citiesOf.get(e.id) ?? [];
      out.push({ kind: 'entity', e, depth, cities: kids.length });
      if (kids.length && s.collapsed.includes(`open:${e.id}`)) for (const c of kids) out.push({ kind: 'entity', e: c, depth: depth + 1, cities: 0 });
    };
    for (const g of groups) {
      const inside = members.filter((e) => e.group_id === g.id);
      if (!inside.length && !showEmptyGroups) continue;
      out.push({ kind: 'group', g, members: w.all('entity').filter((e) => e.group_id === g.id).map((e) => e.id) });
      if (!s.collapsed.includes(`grp:${g.id}`)) for (const e of inside) add(e, 1);
    }
    for (const e of members) if (!e.group_id || !w.get('entity_group', e.group_id)) add(e, 0);
    return out;
  };
  const renderItems = (items: Item[]) => {
    const order = items.filter((it): it is Extract<Item, { kind: 'entity' }> => it.kind === 'entity').map((it) => it.e.id);
    const chosen = new Set(s.chosen('entity'));
    return items.map((it) => {
      if (it.kind === 'group') {
        const folded = s.collapsed.includes(`grp:${it.g.id}`);
        return (
          <div key={`g-${it.g.id}`} className="row group-head" onClick={() => s.toggleCollapsed(`grp:${it.g.id}`)} data-testid={`entity-group-${it.g.name}`}
            onContextMenu={(ev) => openMenu(ev, groupMenu(w, it.g.id, it.members), it.g.name)}>
            <span className="twisty">{folded ? '▸' : '▾'}</span><span className="swatch" style={{ background: it.g.color }} /><b>{it.g.name}</b><span className="muted"> · {it.members.length}</span>
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
            openMenu(ev, entityMenu(w, ids), ids.length === 1 ? e.name : `${ids.length} chosen`);
          }}>
          {it.cities > 0 && <span className="twisty" title={open ? 'Hide its cities' : 'Show its cities'} onClick={(ev) => { ev.stopPropagation(); s.toggleCollapsed(`open:${e.id}`); }} data-testid={`cities-of-${e.name}`}>{open ? '▾' : '▸'}</span>}
          <FillSwatch entity={e} />{e.name}{it.cities > 0 && <span className="muted"> · {it.cities} {it.cities === 1 ? 'city' : 'cities'}</span>}
        </div>
      );
    });
  };
  const looseOthers = others.filter((e) => !(e.type_id === 'settlement' && cityIn.has(e.id) && w.get('entity', cityIn.get(e.id)!)));
  return (
    <aside className="left">
      <Section title="Maps" onAdd={() => s.set({ dialog: 'new-world' })} addLabel="Map">
        {w.all('map_space').sort((a, b) => a.sort_order - b.sort_order).map((sp) => (
          <div key={sp.id} className={`row ${sp.id === s.spaceId ? 'sel' : ''}`} onClick={() => s.set({ spaceId: sp.id, layerId: w.all('layer').find((l) => l.space_id === sp.id && l.kind === 'partition')?.id ?? '' })}>
            {sp.name}<span className="muted"> · {sp.kind === 'plane' ? `flat, ${(worldSettings(sp) as { widthKm?: number }).widthKm?.toLocaleString() ?? '?'} km wide` : `radius ${Math.round((sp.radius_m ?? 0) / 1000).toLocaleString()} km`}</span>
          </div>
        ))}
        {currentSpace && currentSpace.kind !== 'plane' && (
          <div className="world-options">
            <label className="check" title="Land, lakes and coastlines from Natural Earth, drawn under the territories">
              <input type="checkbox" data-testid="basemap-toggle" checked={basemapSourceOf(currentSpace) === 'natural-earth'}
                onChange={(e) => s.execute((wd) => cmd.setWorldBasemap(wd, currentSpace.id, e.target.checked ? 'natural-earth' : 'none'))} /> Earth's geography
            </label>
            {basemapSourceOf(currentSpace) === 'natural-earth' && (
              <label className="check" title="Today's country borders as a drawing aid. Never exported.">
                <input type="checkbox" data-testid="reference-borders-toggle" checked={s.referenceBorders} onChange={(e) => s.set({ referenceBorders: e.target.checked })} /> Present-day borders (guide)
              </label>
            )}
            <button className="link" onClick={() => s.set({ dialog: 'data-sources' })} data-testid="data-sources">Data sources and credits</button>
          </div>
        )}
      </Section>
      <Section title="Layers" onAdd={async () => { const name = await s.askText('New layer', 'Name (for example "Religion" or "Military control")', '', 'Create layer'); if (name) { const id = s.execute((wd) => cmd.createLayer(wd, s.spaceId, name)); if (id) s.set({ layerId: id }); } }} addLabel="Layer">
        {layers.map((l) => (
          <div key={l.id} className={`row ${l.id === s.layerId ? 'sel' : ''}`}>
            <input type="checkbox" checked={!!l.visible} title="Show or hide" onChange={(e) => s.execute((wd) => cmd.updateLayer(wd, l.id, { visible: e.target.checked ? 1 : 0 }))} />
            <span onClick={() => s.set({ layerId: l.id })} title="Draw on this layer">{l.name}</span>
            {l.id === s.layerId && <span className="muted"> · drawing here</span>}
          </div>
        ))}
        {layers.filter((l) => l.id === s.layerId && currentSpace && basemapSourceOf(currentSpace) === 'natural-earth').map((l) => (
          <label key={`clip-${l.id}`} className="check layer-option" title="Territory painted over the sea or lakes is not shown there. Untick for sea claims or maritime zones.">
            <input type="checkbox" data-testid="clip-to-land" checked={parseJSON<{ clipToLand?: boolean }>(l.style, {}).clipToLand !== false}
              onChange={(e) => s.execute((wd) => cmd.setLayerClipToLand(wd, l.id, e.target.checked))} /> Territory ends at the coast
          </label>
        ))}
      </Section>
      <Section title="Countries and factions" onAdd={() => setNewEntity({ name: '', type: 'polity' })} addLabel="New">
        {newEntityForm('countries')}
        {renderItems(itemsFor(political, true))}
        {political.length > 0 && <div className="muted small-hint">Ctrl or Shift + click to choose several; right-click for quick actions.</div>}
        <button className="link pad-link" onClick={async () => { const name = await s.askText('New group', 'Name of the group (for example "My nations" or "Europe")', '', 'Create group'); if (name) s.execute((wd) => cmd.createEntityGroup(wd, name, s.chosen('entity'))); }} data-testid="new-entity-group">New group{s.chosen('entity').length > 1 ? ` of the ${s.chosen('entity').length} chosen` : ''}…</button>
        {political.length > 0 && <button className="link pad-link" onClick={() => s.set({ dialog: 'label-style' })} data-testid="open-label-style">Label style for all countries…</button>}
        {currentSpace && basemapSourceOf(currentSpace) === 'natural-earth' && <button className="link pad-link" onClick={() => s.set({ dialog: 'add-countries' })} data-testid="open-add-countries">Add today's countries…</button>}
        {!political.length && !newEntity && <div className="muted pad">None yet.</div>}
      </Section>
      <Section title="Characters" onAdd={() => setNewEntity({ name: '', type: 'character' })} addLabel="Character">
        {newEntityForm('characters')}
        {renderItems(itemsFor(characters, false))}
        {!characters.length && !(newEntity?.type === 'character') && <div className="muted pad">None yet. Characters are points on the map that move over time.</div>}
      </Section>
      <Section title="Cities and others" onAdd={() => setNewEntity({ name: '', type: 'settlement' })} addLabel="City">
        {newEntityForm('cities')}
        {renderItems(itemsFor(looseOthers, false))}
        {!others.length && newEntity?.type !== 'settlement' && <div className="muted pad">None yet. Cities are points on the map, founded and abandoned at dates.</div>}
        {others.length > looseOthers.length && <div className="muted small-hint">Cities in a country are listed under it.</div>}
      </Section>
      <Section title="Events" onAdd={() => s.set({ dialog: 'new-event' })} addLabel="Event">
        {(() => {
          const shown = events.filter((e) => eventVisible(w, e.id));
          const order = shown.map((e) => e.id);
          const chosenEv = new Set(s.chosen('event'));
          return shown.map((e) => (
            <div key={e.id} className={`row ${chosenEv.has(e.id) ? 'sel' : ''} ${e.variant_group && !e.variant_active ? 'dim' : ''}`} data-testid={`event-row-${e.name}`}
              onClick={(ev) => { s.pick('event', e.id, ev, order); if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) s.setTime(fromStore(e.start_day, e.start_ms)); }}
              onContextMenu={(ev) => {
                const cur = s.chosen('event');
                const ids = cur.includes(e.id) ? cur : [e.id];
                if (!cur.includes(e.id)) s.pick('event', e.id, {}, order);
                openMenu(ev, eventMenu(w, ids), ids.length === 1 ? e.name : `${ids.length} events`);
              }}>
              <span className="date">{fmt(fromStore(e.start_day, e.start_ms), e.precision === 'year' ? 'year' : 'day')}</span> {e.name}
            </div>
          ));
        })()}
        {events.length > 1 && <div className="muted small-hint">Ctrl or Shift + click to choose several; Delete or right-click to delete them.</div>}
        {!events.length && <div className="muted pad">No events yet.</div>}
        {events.some((e) => !eventVisible(w, e.id)) && (
          <div className="muted pad" data-testid="events-hidden">{events.filter((e) => !eventVisible(w, e.id)).length} hidden by the group filter · <button className="link" onClick={() => s.set({ eventFilter: null })}>show all</button></div>
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
  const changes = w.all('effect').filter((f) => parseJSON<Resolution>(f.resolution, { set: [] }).set.some(([, v]) => v === id));
  return (
    <div className="panel" data-testid="entity-panel">
      <h3><span className="swatch big" style={{ background: e.color }} /> {e.name}</h3>
      <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEntity(wd, id, { name: name.trim() }))} /></label>
      <label>Colour<input type="color" value={e.color} onChange={(ev) => s.execute((wd) => cmd.updateEntity(wd, id, { color: ev.target.value }))} /></label>
      <label>Type<select value={e.type_id} onChange={(ev) => s.execute((wd) => cmd.updateEntity(wd, id, { type_id: ev.target.value }))}>{w.all('entity_type').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Notes<textarea rows={5} value={notes} onChange={(ev) => setNotes(ev.target.value)} onBlur={() => notes !== e.notes && s.execute((wd) => cmd.updateEntity(wd, id, { notes }))} /></label>
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
    let spec: TransitionSpec | null = null;
    if (style === 'advance') {
      const old = parseJSON<TransitionSpec | null>(f.transition, null);
      spec = { style: 'advance', origin: old?.origin ?? regionCentre(s, f), easing: 'smooth' };
    } else if (style === 'border') spec = { style: 'border', easing: 'smooth' };
    else if (style === 'fade') spec = { style: 'fade' };
    s.execute((wd) => cmd.setEffectTransition(wd, f.id, spec));
  };
  return (
    <div className="panel" data-testid="event-panel">
      <h3>{base ? 'Starting map and changes without an event' : e.name}</h3>
      {!base && <>
        <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEvent(wd, id, { name: name.trim() }))} /></label>
        <label>Type<select value={e.type_id} onChange={(ev) => s.execute((wd) => cmd.updateEvent(wd, id, { type_id: ev.target.value }))}>{w.all('event_type').filter((t) => t.id !== 'base').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Starts<DateField value={start} onChange={(t) => t && s.execute((wd) => cmd.updateEvent(wd, id, { start: t }))} testId="event-panel-start" /></label>
        <label>Ends<DateField value={end} allowEmpty placeholder="(instantaneous)" onChange={(t) => s.execute((wd) => cmd.updateEvent(wd, id, { end: t }))} testId="event-panel-end" /></label>
        <label title="When two events change the same place at the same instant, the higher precedence wins">Precedence<NumberField value={e.precedence} step={1} onCommit={(n) => s.execute((wd) => cmd.updateEvent(wd, id, { precedence: Math.round(n) }))} /></label>
        <label>Description<textarea rows={4} value={desc} onChange={(ev) => setDesc(ev.target.value)} onBlur={() => desc !== e.description && s.execute((wd) => cmd.updateEvent(wd, id, { description: desc }))} /></label>
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
          {!base && f.layer_id && (
            <div className="effect-tools">
              <label className="inline">Animation
                <select value={parseJSON<TransitionSpec | null>(f.transition, null)?.style ?? 'instant'} onChange={(ev) => setTransition(f, ev.target.value)} disabled={!end} title={end ? '' : 'Give the event an end date to animate its changes'} data-testid="transition-style">
                  <option value="instant">Instant</option>
                  <option value="border">Advancing front (from the border)</option>
                  <option value="advance">Expansion (a circle)</option>
                  <option value="fade">Fade</option>
                </select>
              </label>
              <button className="small danger" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, f.id))}>Remove</button>
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
