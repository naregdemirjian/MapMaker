// Properties at the right (D200, D202, D209): the thing selected (a country, an event, a layer, a place, a point of the
// map) in groups that fold; with nothing selected, the map's own (tidy stage, D213: moved here from Panels.tsx).
import { useState, useEffect } from 'react';
import { useStore, store, type DialogName } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, type Calendar, fromStore, compare, add } from '../../core-time/index.ts';
import { calendarNow } from '../calendar-now.ts';
import { isBaseEvent, MAIN_BRANCH, type EffectRow } from '../../world-model/schema.ts';
import { basemapSourceOf, worldSettings, terrainSourceOf, isSpaceMap, isGeologicalMap, simOf, statisticsOf } from '../../world-model/world-settings.ts';
import { parseJSON, isUntracked, resolutionOf, type TransitionSpec } from '../../temporal-engine/engine.ts';
import type { World } from '../../world-model/world.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { GroupChecks } from '../components/EventGroups.tsx';
import { CountryLabelSection } from '../components/LabelStyles.tsx';
import { CountryFillSection } from '../components/CountryFill.tsx';
import { CountryLookSection, LayerLookSection } from '../components/LookEditor.tsx';
import { CountryBordersSection, LayerBordersSection } from '../components/BorderEditor.tsx';
import { CharacterSection } from '../components/Characters.tsx';
import { changeSpanText } from '../components/RecordLength.tsx';
import { ChangePanel, changesOf, describeEffect, animationName } from '../components/ChangePanel.tsx';
import { eventScreenSeconds, eventTransitionLook, TRANSITION_LOOKS } from '../../presentation/sequence.ts';
import { CountryHistorySection } from '../components/CountryHistory.tsx';
import { NamesSection } from '../components/Names.tsx';
import { FeaturePanel } from '../components/Features.tsx';
import { RelationsSection } from '../components/Relations.tsx';
import { PicturesSection } from '../components/Pictures.tsx';
import { TypeDot, TypeSelect } from '../components/EventTypes.tsx';
import { isFeatureKind } from '../../render-engine/feature-style.ts';
import { StarPanel } from '../components/Stars.tsx';
import { RiverPanel } from '../components/RiverPanel.tsx';
import { coastBorderOf, overSeaOf, COAST_BORDERS, type CoastBorder } from '../../render-engine/border-look.ts';
import { PropGroup } from '../shell/Group.tsx';
import { InlineDialog } from '../shell/DialogFrame.tsx';
import { ShowDialog } from '../components/ShowDialog.tsx';
import { SeaLevelDialog } from '../components/SeaLevelDialog.tsx';
import { CalendarDialog } from '../components/CalendarDialog.tsx';
import { StatisticsDialog } from '../components/StatisticsDialog.tsx';
import { SettingsDialog } from '../components/Settings.tsx';
import { branchName } from '../../temporal-engine/branches.ts';
import { fmt, DateField, NumberField } from '../inputs.tsx';

/**
 * The setting-up of the map being viewed: its geography, terrain and lakes, sea level, calendar, statistics,
 * the look of its stars, its planet. In Properties with nothing selected (D202).
 */
function MapSetup() {
  const s = useStore();
  const currentSpace = s.world!.get('map_space', s.spaceId);
  return (
    <>
        {currentSpace && isSpaceMap(currentSpace) && (
          <button className="link pad-link" onClick={() => s.set({ dialog: 'sky-look' })} data-testid="open-sky-look" title="The stars' colours, shapes, glows and spikes, the sky, the lines and names, a flat chart, and how realms are drawn">How the stars look…</button>
        )}
        {currentSpace && simOf(currentSpace) && (
          <button className="link pad-link" onClick={() => s.set({ dialog: 'planet-studio', studioSpaceId: currentSpace.id })} data-testid="open-planet-studio" title="The planet's star, orbit, interior, air, water and history: change them and simulate its history again">Open in the Planet Studio…</button>
        )}
        {currentSpace && currentSpace.kind !== 'plane' && !isSpaceMap(currentSpace) && (
          <div className="world-options">
            {!isGeologicalMap(currentSpace) && <label className="check" title="Land, lakes and coastlines from Natural Earth, drawn under the territories">
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
            <button className="link" onClick={() => s.set({ dialog: 'calendar' })} data-testid="open-calendar" title="The calendar this map's dates are written, typed and chosen in: the Gregorian, or one of its own">Calendar: {calendarNow().name}…</button>
            <button className="link" onClick={() => s.set({ dialog: 'statistics' })} data-testid="open-statistics" title="Numbers kept over time (an economy, an army, the dead of a war), shown counting in shots' texts as {name}">Statistics ({statisticsOf(currentSpace).length})…</button>
            <button className="link" onClick={() => s.set({ dialog: 'data-sources' })} data-testid="data-sources">Data sources and credits</button>
          </div>
        )}
    </>
  );
}

/** A layer in Properties (D200): how its countries are filled and look, its borders and front lines, where its territory ends. */
function LayerPanel({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const layer = w.get('layer', id);
  const [name, setName] = useState(layer?.name ?? '');
  useEffect(() => { setName(layer?.name ?? ''); }, [id, layer?.name]);
  if (!layer) return null;
  const currentSpace = w.get('map_space', layer.space_id);
  const feat = isFeatureKind(layer.kind), field = layer.kind === 'field';
  // (Only a layer of territory has more than its name and whether it is shown.)
  const layers = feat || field ? [] : [layer];
  return (
    <div className="panel" data-testid="layer-panel">
      <h3>{layer.name}</h3>
      <PropGroup id="layer:layer" title="Layer">
        <div className="muted">{field ? 'Conditions (radiation, fire, floods, heatmaps)' : feat ? (layer.kind === 'area' ? 'Areas' : layer.kind === 'line' ? 'Lines' : 'Points') : layer.kind === 'partition' ? 'Territory: each place held by one country at a time' : 'Territory'}</div>
        <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== layer.name && s.execute((wd) => cmd.updateLayer(wd, id, { name: name.trim() }))} data-testid="layer-name" /></label>
        <label className="check"><input type="checkbox" checked={!!layer.visible} onChange={(ev) => s.execute((wd) => cmd.updateLayer(wd, id, { visible: ev.target.checked ? 1 : 0 }))} data-testid="layer-visible" /> Shown on the map</label>
      </PropGroup>
      {layers.length > 0 && <PropGroup id="layer:fill" title="Fill and look">
        {layers.map((l) => (
          <label key={`fill-${l.id}`} className="inline layer-option" title="Stripes or dots let the layers under this one show through: for occupation, control or influence over the political map">Fill
            <select value={parseJSON<{ fill?: string }>(l.style, {}).fill ?? 'solid'} onChange={(e) => s.execute((wd) => cmd.setLayerFill(wd, l.id, e.target.value as 'solid' | 'hatch' | 'cross' | 'dots'))} data-testid="layer-fill">
              <option value="solid">Solid</option>
              <option value="hatch">Stripes</option>
              <option value="cross">Crossed stripes</option>
              <option value="dots">Dots</option>
            </select>
          </label>
        ))}
        {layers.filter((l) => l.kind === 'partition').map((l) => {
          const st = parseJSON<{ fillOpacity?: number; borderWidth?: number }>(l.style, {});
          return (
            <div key={`look-${l.id}`} className="two layer-option">
              <label title="How strongly the countries' colours cover the map under them, in shots and exports too">Opacity (%)<NumberField min={0} max={100} step={5} value={Math.round((st.fillOpacity ?? 0.78) * 100)} def={l.export_pass === 'political' ? 78 : 60} onCommit={(n) => s.execute((wd) => cmd.setLayerLook(wd, l.id, { fillOpacity: n / 100 }))} testId="layer-opacity" /></label>
              <label title="The width of the borders between countries on this layer (pixels at 1920 wide)">Border width<NumberField min={0} max={20} step={0.25} value={st.borderWidth ?? 1.3} def={l.export_pass === 'political' ? 1.4 : 1} onCommit={(n) => s.execute((wd) => cmd.setLayerLook(wd, l.id, { borderWidth: n }))} testId="layer-border-width" /></label>
            </div>
          );
        })}
        {layers.filter((l) => l.kind === 'partition').map((l) => <LayerLookSection key={`lk-${l.id}`} layerId={l.id} />)}
      </PropGroup>}
      {layers.length > 0 && <PropGroup id="layer:borders" title="Borders and front lines">
        {layers.filter((l) => l.kind === 'partition').map((l) => <LayerBordersSection key={`lb-${l.id}`} layerId={l.id} />)}
        {layers.map((l) => {
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
      </PropGroup>}
      {layers.length > 0 && currentSpace && terrainSourceOf(currentSpace) && <PropGroup id="layer:coast" title="Coast">
        {layers.filter(() => currentSpace && terrainSourceOf(currentSpace)).map((l) => {
          const st = parseJSON<{ clipToLand?: boolean; coastBorder?: string }>(l.style, {}), mode = coastBorderOf(st);
          return (
            <div key={`clip-${l.id}`} className="layer-option">
              <label className="check" title="Territory painted over the sea or lakes is not shown there. Untick for sea claims or maritime zones (or let one country's land carry on over the sea, in its panel).">
                <input type="checkbox" data-testid="clip-to-land" checked={st.clipToLand !== false}
                  onChange={(e) => s.execute((wd) => cmd.setLayerClipToLand(wd, l.id, e.target.checked))} /> Territory ends at the coast
              </label>
              {/* How the borders meet the coast (D221): along the coastline, as drawn, or not at all. */}
              {st.clipToLand !== false && (
                <label className="inline" title={COAST_BORDERS.find((m) => m.id === mode)!.hint}>Borders at the coast
                  <select value={mode} onChange={(e) => s.execute((wd) => cmd.setLayerCoastBorder(wd, l.id, e.target.value as CoastBorder))} data-testid="coast-border">
                    {COAST_BORDERS.map((m) => <option key={m.id} value={m.id} title={m.hint}>{m.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </PropGroup>}
    </div>
  );
}

export function Inspector() {
  const s = useStore();
  const sel = s.selection;
  return (
    <div className="properties-panel">
      {!sel && <MapPanel />}
      {sel?.kind === 'entity' && <EntityPanel id={sel.id} />}
      {sel?.kind === 'event' && <EventPanel id={sel.id} />}
      {sel?.kind === 'point' && <PointPanel lon={sel.lon} lat={sel.lat} />}
      {sel?.kind === 'feature' && <FeaturePanel id={sel.id} />}
      {sel?.kind === 'layer' && <LayerPanel id={sel.id} />}
      {sel?.kind === 'change' && <ChangePanel id={sel.id} />}
      {sel?.kind === 'star' && <StarPanel id={sel.id} />}
      {sel?.kind === 'river' && <RiverPanel id={sel.id} spaceId={sel.spaceId} />}
    </div>
  );
}

/** A settings window shown in place in Properties (D209), folded at first; while the same window is open over everything, a note instead. */
function InlineSettings({ id, title, dialog, children }: { id: string; title: string; dialog: DialogName; children: React.ReactNode }) {
  const s = useStore();
  return (
    <PropGroup id={id} title={title} folded>
      {s.dialog === dialog ? <p className="muted">Open in its own window.</p> : <InlineDialog.Provider value={true}>{children}</InlineDialog.Provider>}
    </PropGroup>
  );
}

/** The map being viewed, in Properties when nothing is selected (D202): what it is, and its setting-up. */
function MapPanel() {
  const s = useStore();
  const sp = s.world!.get('map_space', s.spaceId);
  if (!sp) return <QuickStart />;
  return (
    <div className="panel" data-testid="map-panel">
      <h3>{sp.name}</h3>
      <PropGroup id="map:map" title="This map">
        <div className="muted">{isSpaceMap(sp) ? 'A map of space' : sp.kind === 'plane' ? `A flat map, ${(worldSettings(sp) as { widthKm?: number }).widthKm?.toLocaleString() ?? '?'} km wide` : `A globe, radius ${Math.round((sp.radius_m ?? 0) / 1000).toLocaleString()} km`}</div>
        <div className="map-setup" data-testid="map-setup"><MapSetup /></div>
        <button className="link" onClick={() => s.set({ dialog: 'show' })} data-testid="map-open-show" title="What the map shows while you work and in presentations and exports">What the map shows…</button>
      </PropGroup>
      {/* The map's settings in place (D209), folded until opened; each also opens in its own window from the menus. */}
      {!isSpaceMap(sp) && <InlineSettings id="map:show" title="What is shown" dialog="show"><ShowDialog /></InlineSettings>}
      {basemapSourceOf(sp) === 'natural-earth' && <InlineSettings id="map:sea" title="Sea level over time" dialog="sea-level"><SeaLevelDialog /></InlineSettings>}
      {!isSpaceMap(sp) && <InlineSettings id="map:calendar" title="Calendar" dialog="calendar"><CalendarDialog /></InlineSettings>}
      {!isSpaceMap(sp) && sp.kind !== 'plane' && <InlineSettings id="map:statistics" title="Statistics" dialog="statistics"><StatisticsDialog /></InlineSettings>}
      <InlineSettings id="map:speed" title="Speed of the working view" dialog="settings"><SettingsDialog /></InlineSettings>
      <PropGroup id="map:start" title="Getting started"><QuickStart /></PropGroup>
    </div>
  );
}

export function QuickStart() {
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

/** A country's land carrying on over the sea where drawn (D221), where its layer otherwise ends at the coast. */
function OverSeaOption({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('entity', id);
  if (!e) return null;
  return (
    <label className="check" title="Where its layer ends at the coast, this country's land and border still carry on over the sea where they were drawn: a sea claim, waters of its own">
      <input type="checkbox" checked={overSeaOf(e.style)} onChange={(ev) => s.execute((wd) => cmd.setEntityOverSea(wd, id, ev.target.checked))} data-testid="country-over-sea" /> Its land carries on over the sea where drawn
    </label>
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
  const changes = w.rows('effect').filter((f) => resolutionOf(f).set.some(([, v]) => v === id) && inTimelineHere(w, f));
  const political = e.type_id === 'polity' || e.type_id === 'faction';
  return (
    <div className="panel" data-testid="entity-panel">
      <h3><span className="swatch big" style={{ background: e.color }} /> {e.name}</h3>
      <PropGroup id="entity:identity" title={political ? 'Country' : e.type_id === 'character' ? 'Character' : e.type_id === 'settlement' ? 'City' : 'Identity'}>
      <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEntity(wd, id, { name: name.trim() }))} /></label>
      <label>Colour<input type="color" value={e.color} onChange={(ev) => s.execute((wd) => cmd.updateEntity(wd, id, { color: ev.target.value }))} /></label>
      <label>Type<select value={e.type_id} onChange={(ev) => s.execute((wd) => cmd.updateEntity(wd, id, { type_id: ev.target.value }))}>{w.all('entity_type').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {(e.type_id === 'polity' || e.type_id === 'faction') && (
        <label className="check" title="While locked, drawing over it leaves its land out, it is given no land, and it cannot be split, merged or annexed, nor its border points moved">
          <input type="checkbox" checked={cmd.isLocked(w, id)} onChange={(ev) => s.execute((wd) => cmd.setLocked(wd, [id], ev.target.checked))} data-testid="entity-locked" /> Locked: its land and borders stay as they are
        </label>
      )}
      </PropGroup>
      <PropGroup id="entity:notes" title="Notes and pictures">
      <label>Notes<textarea rows={5} value={notes} onChange={(ev) => setNotes(ev.target.value)} onBlur={() => notes !== e.notes && s.execute((wd) => cmd.updateEntity(wd, id, { notes }))} /></label>
      <PicturesSection holder={{ kind: 'entity', id }} />
      </PropGroup>
      {e.type_id !== 'character' && e.type_id !== 'settlement' && <PropGroup id="entity:territory" title="Territory">
      {e.type_id !== 'character' && e.type_id !== 'settlement' && <div className="stat">On {fmt(s.time)}: {parcels ? `${Math.round(areaSr * (radius / 1000) ** 2).toLocaleString()} km²` : 'no territory'} </div>}
      {(e.type_id === 'polity' || e.type_id === 'faction') && <button onClick={() => s.set({ paintValue: id, tool: 'lasso' })}>Draw territory for {e.name}</button>}
      {e.type_id !== 'character' && e.type_id !== 'settlement' && <h4>Territorial changes</h4>}
      {changeRows(w, changes).map((r) => (
        <div key={r.key} className="row" onClick={() => s.set({ selection: { kind: 'event', id: r.eventId }, time: r.time ?? s.time })}>
          {r.time ? <><span className="date">{fmt(r.time)}</span> {r.label}</> : r.label}
        </div>
      ))}
      {!changes.length && e.type_id !== 'character' && e.type_id !== 'settlement' && <div className="muted">None yet.</div>}
      {political && <CountryHistorySection id={id} />}
      </PropGroup>}
      {political && <PropGroup id="entity:fill" title="Fill"><CountryFillSection id={id} /></PropGroup>}
      {political && <PropGroup id="entity:look" title="Look and borders"><CountryLookSection id={id} /><CountryBordersSection id={id} /><OverSeaOption id={id} /></PropGroup>}
      {political && <PropGroup id="entity:label" title="Label"><CountryLabelSection id={id} /></PropGroup>}
      {(e.type_id === 'character' || e.type_id === 'settlement') && <PropGroup id="entity:onmap" title="On the map"><CharacterSection id={id} /></PropGroup>}
      {e.type_id !== 'body' && <PropGroup id="entity:relations" title="Relationships"><RelationsSection id={id} /></PropGroup>}
      {e.type_id !== 'body' && <PropGroup id="entity:names" title="Names over time"><NamesSection id={id} /></PropGroup>}
      <button className="danger" onClick={() => { if (confirm(`Delete ${e.name}? Events that refer to it will be flagged in History Health.`)) { s.execute((wd) => cmd.deleteEntity(wd, id)); s.set({ selection: null }); } }}>Delete</button>
    </div>
  );
}

/** Whether a change is part of the history of the timeline being viewed (D150). */
function inTimelineHere(w: World, f: EffectRow): boolean {
  const ev = w.get('event', f.event_id);
  return !!ev && (!store.engine || store.engine.inTimeline(f, ev));
}

/**
 * A country's territorial changes in date order: the starting map, each event once, and each change
 * made without an event on its own date.
 */
function changeRows(w: World, changes: EffectRow[]): Array<{ key: string; eventId: string; time: Instant | null; label: string }> {
  const rows: Array<{ key: string; eventId: string; time: Instant | null; label: string }> = [];
  const seen = new Set<string>();
  for (const f of changes) {
    if (isUntracked(f)) { rows.push({ key: f.id, eventId: f.event_id, time: fromStore(f.at_day!, f.at_ms ?? 0), label: 'Change without an event' }); continue; }
    if (seen.has(f.event_id)) continue;
    seen.add(f.event_id);
    const ev = w.get('event', f.event_id);
    if (!ev) continue;
    rows.push(isBaseEvent(ev.id)
      ? { key: ev.id, eventId: ev.id, time: null, label: 'Starting map (from the beginning)' }
      : { key: ev.id, eventId: ev.id, time: fromStore(ev.start_day, ev.start_ms), label: ev.name });
  }
  return rows.sort((a, b) => (a.time ? (b.time ? compare(a.time, b.time) : 1) : b.time ? -1 : 0));
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
  const base = isBaseEvent(id);
  const effects = changesOf(w, id);
  const start = fromStore(e.start_day, e.start_ms);
  const end = e.end_day !== null ? fromStore(e.end_day, e.end_ms ?? 0) : null;
  const variants = e.variant_group ? w.all('event').filter((x) => x.variant_group === e.variant_group) : [];
  const owners = w.all('entity').filter((x) => x.type_id === 'polity' || x.type_id === 'faction');
  return (
    <div className="panel" data-testid="event-panel">
      <h3>{base ? 'Starting map and changes without an event' : e.name}</h3>
      {w.all('branch').length > 0 && (() => {
        // Which timeline it belongs to (D150): the one viewed, or the history it shares.
        const owner = e.branch_id || MAIN_BRANCH, row = w.get('branch', owner);
        return (
          <div className="muted" data-testid="event-branch">
            <span className="swatch" style={{ background: row ? row.color : '#9aa7b4' }} /> {owner === s.branch ? `In ${branchName(w, owner)}` : `Shared with ${branchName(w, owner)}: changing it changes every timeline that shares it`}
          </div>
        );
      })()}
      {!base && <>
        <PropGroup id="event:event" title="Event">
        <label>Name<input value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name.trim() && name !== e.name && s.execute((wd) => cmd.updateEvent(wd, id, { name: name.trim() }))} /></label>
        <label>Type<span className="row-inline"><TypeDot typeId={e.type_id} /><TypeSelect value={e.type_id} onChange={(t) => s.execute((wd) => cmd.updateEvent(wd, id, { type_id: t }))} testId="event-panel-type" /><button className="small" onClick={() => s.set({ dialog: 'event-types' })} title="Make, change and delete event types">Types…</button></span></label>
        <label>Starts<DateField value={start} onChange={(t) => t && s.execute((wd) => cmd.updateEvent(wd, id, { start: t }))} testId="event-panel-start" /></label>
        <label>Ends<DateField value={end} allowEmpty suggest={start} onChange={(t) => s.execute((wd) => cmd.updateEvent(wd, id, { end: t }))} testId="event-panel-end" /></label>
        <label title="When two events change the same place at the same instant, the higher precedence wins">Precedence<NumberField value={e.precedence} def={0} step={1} onCommit={(n) => s.execute((wd) => cmd.updateEvent(wd, id, { precedence: Math.round(n) }))} /></label>
        <div className="buttons">
          {s.recordEventId === id
            ? <button onClick={() => s.set({ recordEventId: null })}>Stop recording</button>
            : <button onClick={() => s.set({ recordEventId: id, time: compare(s.time, start) < 0 ? start : s.time, tool: s.tool === 'select' ? 'lasso' : s.tool })} title="Every territory you draw goes into this event, without asking" data-testid="record-event">Record into this event</button>}
          <button onClick={() => s.setTime(start)}>Go to start</button>
          {end && <button onClick={() => s.setTime(end)}>Go to end</button>}
        </div>
        </PropGroup>
        <PropGroup id="event:presentations" title="In presentations">
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
        </PropGroup>
        <PropGroup id="event:description" title="Description and pictures">
        <label>Description<textarea rows={4} value={desc} onChange={(ev) => setDesc(ev.target.value)} onBlur={() => desc !== e.description && s.execute((wd) => cmd.updateEvent(wd, id, { description: desc }))} /></label>
        <PicturesSection holder={{ kind: 'event', id }} />
        </PropGroup>
        <PropGroup id="event:groups" title="Groups">
        <GroupChecks eventId={id} />
        </PropGroup>
      </>}
      <PropGroup id="event:changes" title="Changes">
      {/* Each change chosen here (D210) shows in Properties with its animation, length, starting points and border shifts. */}
      {effects.map((f) => {
        const span = base ? null : changeSpanText(f, e), style = parseJSON<TransitionSpec | null>(f.transition, null)?.style;
        const shifts = !base && cmd.borderShiftsOf(w, f.id);
        return (
          <div key={f.id} className="effect">
            <button className="change-row" onClick={() => s.set({ selection: { kind: 'change', id: f.id } })} data-testid="change-row" title="Its animation, how long it takes and its border shifts, in Properties">
              {isUntracked(f) && <span className="date">{fmt(fromStore(f.at_day!, f.at_ms ?? 0))} · </span>}{describeEffect(s, f)}
            </button>
            {(span || shifts) && <div className="muted change-sum">{span && <>{animationName(style)} · <span data-testid="change-span">{span}</span></>}{shifts && <span>{span ? ' · ' : ''}border shifts</span>}</div>}
            <div className="effect-tools">
              {base && isUntracked(f) && <button className="small" onClick={() => s.setTime(fromStore(f.at_day!, f.at_ms ?? 0))}>Go to</button>}
              {(!base || isUntracked(f)) && <button className="small danger" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, f.id))}>Remove</button>}
            </div>
          </div>
        );
      })}
      {!effects.length && <div className="muted">No changes yet. Use “Record into this event” and draw on the map.</div>}
      {!base && owners.length > 0 && <RenameInEvent eventId={id} owners={owners} />}
      {!base && owners.length >= 2 && (
        <div className="annex">
          <h4>Annexation (keeps its intention)</h4>
          <select value={annexTo} onChange={(ev) => setAnnexTo(ev.target.value)}><option value="">Who annexes…</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select value={annexFrom} onChange={(ev) => setAnnexFrom(ev.target.value)}><option value="">…everything held by</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <button disabled={!annexFrom || !annexTo || annexFrom === annexTo} onClick={() => s.execute((wd, en) => cmd.annex(wd, en, { spaceId: s.spaceId, layerId: s.layerId, eventId: id, from: annexFrom, to: annexTo }))}>Add annexation</button>
        </div>
      )}
      </PropGroup>
      {!base && <>
        <PropGroup id="event:versions" title="Alternative versions">
        {variants.map((v) => (
          <div key={v.id} className={`row ${v.id === id ? 'sel' : ''}`}>
            <span onClick={() => s.set({ selection: { kind: 'event', id: v.id } })}>{v.name}</span>
            {v.variant_active ? <span className="muted"> · active</span> : <button className="small" onClick={() => s.execute((wd) => cmd.activateVariant(wd, v.id))}>Use this version</button>}
          </div>
        ))}
        <button onClick={async () => { const n = await s.askText('Alternative version', 'Name of the alternative version', `${e.name} (alternative)`, 'Create'); if (n) { const nid = s.execute((wd) => cmd.createVariant(wd, id, n)); if (nid) s.set({ selection: { kind: 'event', id: nid } }); } }}>Create alternative version</button>
        </PropGroup>
        <button className="danger" onClick={() => { if (confirm(`Delete the event "${e.name}" and its changes?`)) { s.execute((wd) => cmd.deleteEvent(wd, id)); s.set({ selection: null, recordEventId: s.recordEventId === id ? null : s.recordEventId }); } }}>Delete event</button>
      </>}
    </div>
  );
}

/** A country renamed by an event (D204): from the event's start, a change of the event like its others. */
function RenameInEvent({ eventId, owners }: { eventId: string; owners: Array<{ id: string; name: string }> }) {
  const s = useStore();
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const ev = s.world!.get('event', eventId);
  if (!ev) return null;
  const start = fromStore(ev.start_day, ev.start_ms);
  const now = who ? s.engine!.nameAt(who, start) ?? s.world!.get('entity', who)?.name ?? '' : '';
  const add = () => {
    if (!who || !name.trim()) return;
    if (s.execute((wd) => cmd.renameFrom(wd, { entity: who, name, mode: { kind: 'new', eventId, at: null } }))) { setName(''); setWho(''); }
  };
  return (
    <div className="rename-in-event" data-testid="rename-in-event">
      <h4>Rename a country</h4>
      <select value={who} onChange={(e) => { setWho(e.target.value); const n = e.target.value ? s.engine!.nameAt(e.target.value, start) ?? s.world!.get('entity', e.target.value)?.name ?? '' : ''; setName(n); }} data-testid="rename-event-who">
        <option value="">Which country…</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input value={name} placeholder={who ? `New name of ${now}` : 'New name'} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} data-testid="rename-event-name" />
      <button disabled={!who || !name.trim() || name.trim() === now} onClick={add} title="From the event's start the country is called so (its label on the map too)" data-testid="rename-event-add">Add renaming</button>
    </div>
  );
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
      {ev && <div>Since {isBaseEvent(ev.id)
        ? (a!.t.day === -Infinity ? 'the starting map' : <>{fmt(a!.t, 'day')} (<a onClick={() => s.set({ selection: { kind: 'event', id: ev.id } })}>a change without an event</a>)</>)
        : <>{fmt(a!.t, 'day')} (<a onClick={() => s.set({ selection: { kind: 'event', id: ev.id } })}>{ev.name}</a>)</>}</div>}
      <div>{next ? <>Until {fmt(next, 'day')}</> : 'No later change recorded'}</div>
      {owner && <button onClick={() => s.set({ selection: { kind: 'entity', id: owner.id } })}>Open {owner.name}</button>}
    </div>
  );
}
