// Today's cities and capitals (D173): adding them (on their own, or with today's countries) and choosing which a
// map shows: by their share of their country's people, their size, capitals, economic centres, or a list.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { decodePlaces, pickPlaces, placeMetaOf, cityFilterOf, ECONOMIC_LEVELS, type CityFilter, type TodayPlace, type PlacesFile } from '../../domain/places.ts';
import { cityFilterOfSpace } from '../../world-model/world-settings.ts';
import { NEG_INF } from '../../core-time/index.ts';
import { fmt } from './Panels.tsx';

let loading: Promise<TodayPlace[]> | null = null;
export const loadPlaces = () => (loading ??= fetch('data/natural-earth/places-10m.json').then(async (r) => decodePlaces(await r.json() as PlacesFile)));

const POPULATIONS = [0, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];
const popName = (n: number) => (n === 0 ? 'any size' : n >= 1e6 ? `${n / 1e6} million or more` : `${(n / 1000).toLocaleString()},000 or more`);

/** The filter's controls: share of the country's people, size, capitals and economic centres kept regardless. */
export function CityFilterControls({ value, onChange, testId = 'city-filter' }: { value: CityFilter; onChange: (f: CityFilter) => void; testId?: string }) {
  const [share, setShare] = useState<number | null>(null);
  const v = share ?? value.minSharePct;
  const commit = () => { if (share !== null) { onChange({ ...value, minSharePct: share }); setShare(null); } };
  return (
    <div className="city-filter" data-testid={testId}>
      <label className="range-row">Cities with at least <b data-testid={`${testId}-share-text`}>{v > 0 ? `${v.toFixed(v < 1 ? 1 : 0)} %` : 'any share'}</b> of their country's people
        <input type="range" min={0} max={40} step={0.5} value={v} onChange={(e) => setShare(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid={`${testId}-share`} />
      </label>
      <label>and of <select value={value.minPopulation} onChange={(e) => onChange({ ...value, minPopulation: Number(e.target.value) })} data-testid={`${testId}-population`}>
        {POPULATIONS.map((n) => <option key={n} value={n}>{popName(n)}</option>)}
      </select></label>
      <label>Always keep capitals<select value={value.capitals} onChange={(e) => onChange({ ...value, capitals: e.target.value as CityFilter['capitals'] })} data-testid={`${testId}-capitals`}>
        <option value="none">No: only as the share and size say</option>
        <option value="national">National capitals</option>
        <option value="all">National and regional capitals</option>
      </select></label>
      <label>Always keep economic centres<select value={value.economic} onChange={(e) => onChange({ ...value, economic: Number(e.target.value) as CityFilter['economic'] })} data-testid={`${testId}-economic`}>
        {ECONOMIC_LEVELS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select></label>
      <p className="muted small-note">Populations are of the urban area (Natural Earth); world cities are those Natural Earth marks from the Globalization and World Cities ranking.</p>
    </div>
  );
}

/** "Add today's cities": choose countries and which of their cities, then when they are on the map. */
export function AddCitiesDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [all, setAll] = useState<TodayPlace[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<CityFilter>({ minSharePct: 5, capitals: 'national', economic: 2, minPopulation: 0, only: null });
  const [scope, setScope] = useState<'all' | 'map' | 'chosen'>('map');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [as, setAs] = useState<'start' | 'change'>('start');
  useEffect(() => { loadPlaces().then(setAll, (e: Error) => setError(e.message)); }, []);
  const w = s.world!;
  const countries = useMemo(() => [...new Set((all ?? []).map((p) => p.country))].sort(), [all]);
  const onMap = useMemo(() => new Set(w.all('entity').filter((e) => e.type_id === 'polity').map((e) => e.name)), [w]);
  const set = scope === 'all' ? null : scope === 'map' ? onMap : chosen;
  const picked = useMemo(() => (all ? pickPlaces(all, set, filter) : []), [all, set, filter]);
  const add = () => {
    if (!picked.length) return;
    s.set({ busy: `Adding ${picked.length} cities…` });
    setTimeout(() => {
      const r = s.execute((wd) => cmd.addCities(wd, { spaceId: s.spaceId, places: picked, mode: as === 'change' ? { kind: 'change', t: s.time } : { kind: 'correct', t: NEG_INF } }));
      s.set({ busy: null });
      if (r) { s.toast(`Added ${r.length} ${r.length === 1 ? 'city' : 'cities'}.`); onClose(); }
    }, 30);
  };
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Add today's cities" data-testid="add-cities">
        <div className="modal-head"><h2>Add today's cities</h2><button className="close" onClick={onClose} aria-label="Close">×</button></div>
        <p className="muted">Present-day cities and capitals (Natural Earth, 7,289 places), as cities you can change like any other. Which the map shows can be narrowed later in "What is shown".</p>
        {error && <p className="error">{error}</p>}
        {!all && !error && <p className="muted">Loading…</p>}
        {all && <>
          <h4>Of which countries</h4>
          <label className="check"><input type="radio" checked={scope === 'map'} onChange={() => setScope('map')} data-testid="cities-scope-map" /> The countries on this map with today's names ({countries.filter((c) => onMap.has(c)).length})</label>
          <label className="check"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} data-testid="cities-scope-all" /> Every country</label>
          <label className="check"><input type="radio" checked={scope === 'chosen'} onChange={() => setScope('chosen')} data-testid="cities-scope-chosen" /> These countries:</label>
          {scope === 'chosen' && <>
            <input placeholder="Search, e.g. Armenia" value={q} onChange={(e) => setQ(e.target.value)} data-testid="cities-country-search" />
            <div className="country-list short">
              {countries.filter((c) => !q.trim() || c.toLowerCase().includes(q.trim().toLowerCase())).map((c) => (
                <label key={c} className="check country-row"><input type="checkbox" checked={chosen.has(c)} onChange={(e) => setChosen((cur) => { const n = new Set(cur); if (e.target.checked) n.add(c); else n.delete(c); return n; })} data-testid={`cities-country-${c}`} /> {c}</label>
              ))}
            </div>
          </>}
          <h4>Which cities</h4>
          <CityFilterControls value={filter} onChange={setFilter} testId="add-cities-filter" />
          <p data-testid="cities-count"><b>{picked.length.toLocaleString()}</b> cities{picked.length ? `: ${picked.slice(0, 8).map((p) => p.name).join(', ')}${picked.length > 8 ? '…' : ''}` : ''}</p>
          <h4>When</h4>
          <label className="check"><input type="radio" checked={as === 'start'} onChange={() => setAs('start')} /> Part of the starting map (there from the beginning)</label>
          <label className="check"><input type="radio" checked={as === 'change'} onChange={() => setAs('change')} data-testid="cities-as-change" /> From {fmt(s.time)} on</label>
        </>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!picked.length} onClick={add} data-testid="add-cities-go">Add {picked.length.toLocaleString()} {picked.length === 1 ? 'city' : 'cities'}</button>
        </div>
      </div>
    </div>
  );
}

/** The "Cities shown" part of "What is shown" (D173): the map's filter, or a list of the cities it shows. */
export function CitiesShownSection({ spaceId }: { spaceId: string }) {
  const s = useStore();
  const w = s.world!;
  const space = w.get('map_space', spaceId);
  const f = cityFilterOfSpace(space);
  const [q, setQ] = useState('');
  const save = (next: CityFilter) => s.execute((wd) => cmd.setWorldShow(wd, spaceId, { cities: cityFilterOf(next) }));
  const cities = w.all('entity').filter((e) => e.type_id === 'settlement').sort((a, b) => (placeMetaOf(b.style)?.population ?? 0) - (placeMetaOf(a.style)?.population ?? 0) || a.name.localeCompare(b.name));
  const fromToday = cities.filter((e) => placeMetaOf(e.style)).length;
  return (
    <section className="cities-shown" data-testid="cities-shown">
      <h3>Cities shown</h3>
      <label className="check"><input type="radio" checked={!f.only} onChange={() => save({ ...f, only: null })} data-testid="cities-shown-filter" /> As the rules below say{fromToday < cities.length ? ' (cities of your own always show)' : ''}</label>
      <label className="check"><input type="radio" checked={!!f.only} onChange={() => save({ ...f, only: f.only ?? [] })} data-testid="cities-shown-only" /> Only the cities I choose</label>
      {!f.only && <CityFilterControls value={f} onChange={save} testId="show-cities-filter" />}
      {f.only && <>
        <input placeholder="Search cities" value={q} onChange={(e) => setQ(e.target.value)} data-testid="cities-shown-search" />
        <div className="country-list short">
          {cities.filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 400).map((e) => {
            const m = placeMetaOf(e.style);
            return (
              <label key={e.id} className="check country-row"><input type="checkbox" checked={f.only!.includes(e.id)} onChange={(ev) => save({ ...f, only: ev.target.checked ? [...f.only!, e.id] : f.only!.filter((x) => x !== e.id) })} data-testid={`cities-shown-${e.name}`} />
                <span>{e.name}</span><span className="muted">{m ? `${m.country}${m.capital === 'national' ? ', capital' : ''} · ${m.population.toLocaleString()}` : ''}</span></label>
            );
          })}
        </div>
        <p className="muted">{f.only.length} of {cities.length} cities shown.</p>
      </>}
    </section>
  );
}
