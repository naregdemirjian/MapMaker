// The lists (D199), each a panel of its own (S1, D234): maps, layers, countries, people and places, areas, events; each
// with its "+" button, and a filter where the list is long (tidy stage, D213: moved here from Panels.tsx).
import { useState, memo } from 'react';
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { fromStore, add } from '../../core-time/index.ts';
import { listedHere } from '../events-here.ts';
import { basemapSourceOf, worldSettings, isSpaceMap } from '../../world-model/world-settings.ts';
import type { World } from '../../world-model/world.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { eventVisible } from '../components/EventGroups.tsx';
import { FillSwatch } from '../components/CountryFill.tsx';
import { openMenu, entityMenu, groupMenu, eventMenu } from '../components/ContextMenu.tsx';
import { FeatureRows, featureLayers } from '../components/Features.tsx';
import { typeColor } from '../../domain/event-types.ts';
import { isFeatureKind } from '../../render-engine/feature-style.ts';
import { nameMatches } from '../name-match.ts';
import { fmt } from '../inputs.tsx';

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

/** The events of the timeline being viewed in order of their dates, kept until an event or a branch changes (D150). */
const eventLists = new WeakMap<World, { key: string; list: ReturnType<World['all']> }>();

function sortedEvents(w: World) {
  let kept = eventLists.get(w);
  const key = `${w.tableRevision('event')}|${w.tableRevision('branch')}|${store.branch}`;
  if (!kept || kept.key !== key) eventLists.set(w, (kept = { key, list: w.all('event').filter(listedHere).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms) }));
  return kept.list as ReturnType<typeof w.all<'event'>>;
}

/**
 * What the lists of countries, characters and cities show, worked out once for each state of it:
 * the things themselves in order of their names, the groups (folders) of the user's own, and each
 * country's cities (at the date viewed). `sig` changes whenever any of it does.
 */
let outlinerMemo: { key: string; value: ReturnType<typeof buildOutlinerLists> } | null = null;

export function outlinerLists(s: ReturnType<typeof useStore>) {
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

const EntityRows = memo(function EntityRows({ section, filter }: { sig: string; section: 'countries' | 'characters' | 'cities'; filter: string }) {
  const s = store, w = s.world!;
  // (With a filter the list is flat: the things whose names answer it, cities in countries among them, without the groups.)
  const lists = outlinerLists(s);
  const flat = (): OutlinerItem[] => (section === 'countries' ? lists.political : section === 'characters' ? lists.characters : lists.others).filter((e) => nameMatches(e.name, filter)).map((e) => ({ kind: 'entity', e, depth: 0, cities: 0 }));
  const items = filter.trim() ? flat() : lists.items[section];
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
const EventRows = memo(function EventRows({ filter }: { sig: string; filter: string }) {
  const s = store, w = s.world!;
  const shown = sortedEvents(w).filter((e) => eventVisible(w, e.id) && (!filter.trim() || nameMatches(e.name, filter)));
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

export type ListKind = 'maps' | 'layers' | 'countries' | 'places' | 'areas' | 'events';

/** One of the lists, as a panel (S1, D234). */
export function ListPanel({ list }: { list: ListKind }) {
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
  const eventSig = [w.serial, w.tableRevision('event'), w.tableRevision('event_type'), w.tableRevision('event_group'), w.tableRevision('event_group_member'), w.tableRevision('branch'), s.branch, (s.eventFilter ?? ['*']).join(','), s.chosen('event').join(',')].join('|');
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
  const filter = s.listFilters[list] ?? '';
  const on = (...kinds: ListKind[]) => kinds.includes(list);
  const filtered = list === 'countries' || list === 'places' || list === 'events';
  const setFilter = (v: string) => s.set({ listFilters: { ...s.listFilters, [list]: v } });
  return (
    <div className="list-panel" data-list={list}>
      {filtered && (
        <div className="list-filter">
          <input type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); }} data-testid={`list-filter-${list}`} aria-label="Filter the list by name" />
        </div>
      )}
      <div className="lists">
      {on('maps') && <Section title="Maps" onAdd={() => s.openGallery()} addLabel="Map">
        {w.all('map_space').sort((a, b) => a.sort_order - b.sort_order).map((sp) => (
          <div key={sp.id} className={`row ${sp.id === s.spaceId ? 'sel' : ''}`} data-testid={`map-row-${sp.name}`} title="View this map, and show it in Properties" onClick={() => { const before = s.spaceId; s.set({ selection: null, spaceId: sp.id, layerId: w.all('layer').find((l) => l.space_id === sp.id && l.kind === 'partition')?.id ?? '' }); s.mapChanged(before); }}>
            {sp.name}<span className="muted"> · {sp.kind === 'plane' ? `flat, ${(worldSettings(sp) as { widthKm?: number }).widthKm?.toLocaleString() ?? '?'} km wide` : `radius ${Math.round((sp.radius_m ?? 0) / 1000).toLocaleString()} km`}</span>
          </div>
        ))}
        <button className="link pad-link" onClick={() => s.set({ dialog: 'data-export' })} data-testid="open-data-export" title="The map at a date as GeoJSON; events, countries, relationships and features as CSV">Export data (GeoJSON, CSV)…</button>
      </Section>}
      {on('layers') && <Section title="Layers" onAdd={() => s.set({ dialog: 'new-layer' })} addLabel="Layer">
        {layers.map((l) => {
          const feat = isFeatureKind(l.kind), field = l.kind === 'field';
          const here = field ? s.tool === 'field' && s.fieldLayerId === l.id : feat ? s.tool === 'feature' && s.featureLayerId === l.id : l.id === s.layerId;
          const chosen = s.selection?.kind === 'layer' && s.selection.id === l.id;
          return (
            <div key={l.id} className={`row ${chosen ? 'sel' : ''} ${here ? 'drawing' : ''}`} data-testid="layer-row" title={chosen ? 'Click again to stop showing it in Properties' : 'Draw on this layer, and show it in Properties'}
              onClick={() => { if (chosen) { s.set({ selection: null }); return; } (field ? s.set({ selection: { kind: 'layer', id: l.id }, fieldLayerId: l.id, fieldSource: s.fieldLayerId === l.id ? s.fieldSource : {}, tool: 'field' }) : feat ? s.set({ selection: { kind: 'layer', id: l.id }, featureLayerId: l.id, tool: 'feature', reshapeId: null }) : s.set({ selection: { kind: 'layer', id: l.id }, layerId: l.id, tool: s.tool === 'feature' || s.tool === 'field' ? 'lasso' : s.tool })); }}>
              <input type="checkbox" checked={!!l.visible} title="Show or hide" onClick={(e) => e.stopPropagation()} onChange={(e) => s.execute((wd) => cmd.updateLayer(wd, l.id, { visible: e.target.checked ? 1 : 0 }))} />
              <span className="layer-name">{l.name}</span>
              {feat && <span className="muted"> · {l.kind === 'area' ? 'areas' : l.kind === 'line' ? 'lines' : 'points'}</span>}
              {field && <span className="muted"> · conditions</span>}
              {here && <span className="muted"> · drawing here</span>}
            </div>
          );
        })}
      </Section>}
      {on('countries') && <Section title="Countries and factions" onAdd={() => setNewEntity({ name: '', type: 'polity' })} addLabel="New">
        {newEntityForm('countries')}
        <EntityRows sig={entitySig} section="countries" filter={filter} />
        <button className="link pad-link" onClick={async () => { const name = await s.askText('New group', 'Name of the group (for example "My nations" or "Europe")', '', 'Create group'); if (name) s.execute((wd) => cmd.createEntityGroup(wd, name, s.chosen('entity'))); }} data-testid="new-entity-group">New group{s.chosen('entity').length > 1 ? ` of the ${s.chosen('entity').length} chosen` : ''}…</button>
        {political.length > 0 && <button className="link pad-link" onClick={() => s.set({ dialog: 'label-style' })} data-testid="open-label-style">Label style for all countries…</button>}
        {currentSpace && basemapSourceOf(currentSpace) === 'natural-earth' && <button className="link pad-link" onClick={() => s.set({ dialog: 'add-countries' })} data-testid="open-add-countries">Add today's countries…</button>}
        {currentSpace && !isSpaceMap(currentSpace) && <button className="link pad-link" onClick={() => s.set({ dialog: 'import-borders' })} data-testid="open-import-borders" title="GeoJSON maps of borders, one for each date: their countries and how their land changed between them">Import borders from files…</button>}
        {!political.length && !newEntity && <div className="muted pad">None yet.</div>}
      </Section>}
      {on('places') && <Section title="Characters" onAdd={() => setNewEntity({ name: '', type: 'character' })} addLabel="Character">
        {newEntityForm('characters')}
        <EntityRows sig={entitySig} section="characters" filter={filter} />
        {!characters.length && !(newEntity?.type === 'character') && <div className="muted pad">None yet. Characters are points on the map that move over time.</div>}
      </Section>}
      {on('places') && <Section title="Cities and others" onAdd={() => setNewEntity({ name: '', type: 'settlement' })} addLabel="City">
        {newEntityForm('cities')}
        <EntityRows sig={entitySig} section="cities" filter={filter} />
        {!others.length && newEntity?.type !== 'settlement' && <div className="muted pad">None yet. Cities are points on the map, founded and abandoned at dates.</div>}
        {others.length > looseOthers.length && <div className="muted small-hint">Cities in a country are listed under it.</div>}
        {currentSpace && basemapSourceOf(currentSpace) === 'natural-earth' && <button className="link pad-link" onClick={() => s.set({ dialog: 'add-cities' })} data-testid="open-add-cities" title="Present-day cities and capitals, chosen by their share of their country's people, size, capital or economic importance">Add today's cities…</button>}
      </Section>}
      {on('areas') && <Section title="Areas, lines and points" onAdd={() => (featureLayers(s).length ? s.set({ tool: 'feature' }) : s.set({ dialog: 'new-layer' }))} addLabel="Draw">
        <FeatureRows />
      </Section>}
      {on('events') && <Section title="Events" onAdd={() => s.set({ dialog: 'new-event' })} addLabel="Event">
        <EventRows sig={eventSig} filter={filter} />
        {!events.length && <div className="muted pad">No events yet.</div>}
        <button className="link pad-link" onClick={() => s.set({ dialog: 'event-types' })} data-testid="open-event-types">Event types…</button>
        {hiddenEvents > 0 && (
          <div className="muted pad" data-testid="events-hidden">{hiddenEvents} hidden by the group filter · <button className="link" onClick={() => s.set({ eventFilter: null })}>show all</button></div>
        )}
      </Section>}
      </div>
    </div>
  );
}
