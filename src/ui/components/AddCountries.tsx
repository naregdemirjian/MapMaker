// "Add today's countries": pick present-day countries (Natural Earth, 1:50m) and add them, with
// their land, to the map in one step: as part of the starting map, or as an event.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { decodeCountries, COUNTRY_GROUP_COLORS, type CountryShape, type CountriesFile } from '../../domain/countries.ts';
import { NEG_INF } from '../../core-time/index.ts';
import { fmt } from './Panels.tsx';

let loading: Promise<CountryShape[]> | null = null;
const loadCountries = () => (loading ??= fetch('data/natural-earth/countries-50m.json').then(async (r) => decodeCountries(await r.json() as CountriesFile)));

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica', 'Seven seas (open ocean)'];

export function AddCountriesDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const w = s.world!;
  const [all, setAll] = useState<CountryShape[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [nationsOnly, setNationsOnly] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [colours, setColours] = useState<'map' | 'distinct'>('map');
  const [flags, setFlags] = useState(false);
  const [as, setAs] = useState<'start' | 'event'>('start');
  const [eventName, setEventName] = useState('Present-day borders');
  useEffect(() => { loadCountries().then(setAll, (e: Error) => setError(e.message)); }, []);
  const pool = useMemo(() => (all ?? []).filter((c) => !nationsOnly || c.nation), [all, nationsOnly]);
  const shown = pool.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const existing = new Set(w.all('entity').map((e) => e.name.toLowerCase()));
  const toggle = (names: string[], on: boolean) => setChosen((cur) => { const n = new Set(cur); for (const x of names) { if (on) n.add(x); else n.delete(x); } return n; });

  const add = () => {
    const list = (all ?? []).filter((c) => chosen.has(c.name));
    if (!list.length) return;
    const countries: cmd.CountryToAdd[] = list.map((c, i) => ({
      name: c.name, polygons: c.polygons,
      color: colours === 'map' ? COUNTRY_GROUP_COLORS[(c.colorGroup - 1 + COUNTRY_GROUP_COLORS.length) % COUNTRY_GROUP_COLORS.length] : `hsl(${Math.round((i * 137.508) % 360)}, 45%, 52%)`,
      fill: flags && c.flag ? { kind: 'image', asset: `data/flags/${c.flag}.svg`, fit: 'cover' } : undefined,
    }));
    const layerId = s.layerId;
    if (!layerId) { s.toast('This map has no political layer to draw on.', 'error'); return; }
    s.set({ busy: `Adding ${list.length} ${list.length === 1 ? 'country' : 'countries'}…` });
    // Let the message show before the work starts.
    setTimeout(() => {
      const r = s.execute((wd, en) => cmd.addCountries(wd, en, {
        spaceId: s.spaceId, layerId, countries,
        mode: { kind: 'correct', t: NEG_INF },
        newEvent: as === 'event' ? { name: eventName.trim() || 'Present-day borders', start: s.time } : undefined,
      }));
      s.set({ busy: null });
      if (r) { s.toast(`Added ${list.length} ${list.length === 1 ? 'country' : 'countries'}.`); if (r.eventId) s.set({ selection: { kind: 'event', id: r.eventId } }); onClose(); }
    }, 30);
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Add today's countries" data-testid="add-countries">
        <div className="modal-head"><h2>Add today's countries</h2><button className="close" onClick={onClose} aria-label="Close">×</button></div>
        <p className="muted">Present-day countries and their borders (Natural Earth, 1:50m). Choose some or all; you can change them like any other country afterwards.</p>
        {error && <p className="error">{error}</p>}
        {!all && !error && <p className="muted">Loading…</p>}
        {all && <>
          <div className="country-filters">
            <input placeholder="Search, e.g. Peru" value={q} onChange={(e) => setQ(e.target.value)} data-testid="country-search" />
            <label className="check"><input type="checkbox" checked={nationsOnly} onChange={(e) => setNationsOnly(e.target.checked)} /> Nations only (no dependencies)</label>
          </div>
          <div className="continents">
            {CONTINENTS.map((ct) => {
              const names = pool.filter((c) => c.continent === ct).map((c) => c.name);
              if (!names.length) return null;
              const allOn = names.every((n) => chosen.has(n));
              return <button key={ct} className={`small ${allOn ? 'on' : ''}`} onClick={() => toggle(names, !allOn)} data-testid={`continent-${ct}`}>{ct} ({names.length})</button>;
            })}
            <button className="small" onClick={() => toggle(shown.map((c) => c.name), true)} data-testid="choose-all-shown">All shown</button>
            <button className="small" onClick={() => setChosen(new Set())}>None</button>
          </div>
          <div className="country-list">
            {shown.map((c) => (
              <label key={c.name} className="check country-row">
                <input type="checkbox" checked={chosen.has(c.name)} onChange={(e) => toggle([c.name], e.target.checked)} data-testid={`country-${c.name}`} />
                {c.flag ? <img src={`data/flags/${c.flag}.svg`} alt="" loading="lazy" /> : <span className="noflag" />}
                <span>{c.name}</span>
                <span className="muted">{c.continent}{existing.has(c.name.toLowerCase()) ? ' · already in the project (it will be used)' : ''}</span>
              </label>
            ))}
          </div>
          <h4>How they look</h4>
          <label>Colours<select value={colours} onChange={(e) => setColours(e.target.value as 'map' | 'distinct')}>
            <option value="map">Map colours (neighbours always differ)</option><option value="distinct">A different colour for each</option>
          </select></label>
          <label className="check"><input type="checkbox" checked={flags} onChange={(e) => setFlags(e.target.checked)} data-testid="countries-flags" /> Fill each with its flag</label>
          <h4>When</h4>
          <label className="check"><input type="radio" name="when" checked={as === 'start'} onChange={() => setAs('start')} /> Part of the starting map (they exist from the beginning)</label>
          <label className="check"><input type="radio" name="when" checked={as === 'event'} onChange={() => setAs('event')} data-testid="countries-as-event" /> A change on {fmt(s.time)}, as a new event</label>
          {as === 'event' && <label>Event name<input value={eventName} onChange={(e) => setEventName(e.target.value)} /></label>}
        </>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!chosen.size} onClick={add} data-testid="add-countries-go">Add {chosen.size} {chosen.size === 1 ? 'country' : 'countries'}</button>
        </div>
      </div>
    </div>
  );
}
