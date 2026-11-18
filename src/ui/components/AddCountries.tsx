// "Add today's countries": pick present-day countries (Natural Earth, 1:50m) and add them, with
// their land, to the map in one step: as part of the starting map, or as an event.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { decodeCountries, COUNTRY_GROUP_COLORS, type CountryShape, type CountriesFile } from '../../domain/countries.ts';
import { NEG_INF } from '../../core-time/index.ts';
import { fmt } from './Panels.tsx';

let loading: Promise<CountryShape[]> | null = null;
export const loadCountries = () => (loading ??= fetch('data/natural-earth/countries-50m.json').then(async (r) => decodeCountries(await r.json() as CountriesFile)));

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica', 'Seven seas (open ocean)'];

export function AddCountriesDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const w = s.world!;
  const [all, setAll] = useState<CountryShape[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  // Territories (Greenland, Puerto Rico, Hong Kong…): countries of their own (with their own flags),
  // part of the nation they belong to (their land given to it, when it is added too), or left out.
  const [territories, setTerritories] = useState<'own' | 'part' | 'none'>('own');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [colours, setColours] = useState<'map' | 'distinct'>('map');
  const [flags, setFlags] = useState(false);
  const [as, setAs] = useState<'start' | 'event' | 'change'>('start');
  const [eventName, setEventName] = useState('');
  // Who gets the land: each chosen country becomes a country of its own, or all of it goes to one
  // of the project's countries (to add Greece's borders to a country of your own, say).
  const [target, setTarget] = useState<'own' | 'into'>('own');
  const owners = w.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const [intoId, setIntoId] = useState<string>(() => {
    const sel = s.selection;
    return sel?.kind === 'entity' && owners.some((e) => e.id === sel.id) ? sel.id : owners[0]?.id ?? '';
  });
  const into = target === 'into' ? owners.find((e) => e.id === intoId) ?? null : null;
  useEffect(() => { loadCountries().then(setAll, (e: Error) => setError(e.message)); }, []);
  // (As part of their nation, territories are not listed: they come with it. Antarctica belongs to nobody.)
  const pool = useMemo(() => (all ?? []).filter((c) => c.nation || territories === 'own' || (territories === 'part' && c.name === 'Antarctica')), [all, territories]);
  const shown = pool.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const existing = new Set(w.all('entity').map((e) => e.name.toLowerCase()));
  const toggle = (names: string[], on: boolean) => setChosen((cur) => { const n = new Set(cur); for (const x of names) { if (on) n.add(x); else n.delete(x); } return n; });

  const add = () => {
    let list = (all ?? []).filter((c) => chosen.has(c.name));
    if (!list.length) return;
    // Territories as part of their nation: their land goes with the nation's (when it is chosen).
    const parts = new Map<string, CountryShape[]>();
    if (territories === 'part') for (const t of (all ?? []).filter((c) => !c.nation && c.of && c.name !== 'Antarctica')) {
      const nation = list.find((n) => n.name === t.of);
      if (nation) parts.set(nation.name, [...(parts.get(nation.name) ?? []), t]);
    }
    if (territories === 'part') list = list.filter((c) => c.nation || c.name === 'Antarctica');
    if (target === 'into' && !into) { s.toast('Choose the country that gets the land.', 'error'); return; }
    const countries: cmd.CountryToAdd[] = list.map((c, i) => ({
      name: c.name, polygons: [...c.polygons, ...(parts.get(c.name) ?? []).flatMap((t) => t.polygons)],
      color: colours === 'map' ? COUNTRY_GROUP_COLORS[(c.colorGroup - 1 + COUNTRY_GROUP_COLORS.length) % COUNTRY_GROUP_COLORS.length] : `hsl(${Math.round((i * 137.508) % 360)}, 45%, 52%)`,
      fill: flags && c.flag ? { kind: 'image', asset: `data/flags/${c.flag}.svg`, fit: 'fill' } : undefined,
    }));
    const layerId = s.layerId;
    if (!layerId) { s.toast('This map has no political layer to draw on.', 'error'); return; }
    s.set({ busy: `Adding ${list.length} ${list.length === 1 ? 'country' : 'countries'}…` });
    // Let the message show before the work starts.
    setTimeout(() => {
      const r = s.execute((wd, en) => cmd.addCountries(wd, en, {
        spaceId: s.spaceId, layerId, countries,
        mode: as === 'change' ? { kind: 'change', t: s.time } : { kind: 'correct', t: NEG_INF },
        newEvent: as === 'event' ? { name: eventName.trim() || (into ? `${list.length === 1 ? list[0].name : 'Land'} joins ${into.name}` : 'Present-day borders'), start: s.time } : undefined,
        into: into?.id,
      }));
      s.set({ busy: null });
      if (r) {
        s.toast(into ? `Added the land of ${list.length === 1 ? list[0].name : `${list.length} countries`} to ${into.name}.` : `Added ${list.length} ${list.length === 1 ? 'country' : 'countries'}.`);
        if (r.eventId) s.set({ selection: { kind: 'event', id: r.eventId } });
        onClose();
      }
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
            <label className="inline" title="Greenland, Puerto Rico, Hong Kong, New Caledonia and the like">Territories
              <select value={territories} onChange={(e) => setTerritories(e.target.value as typeof territories)} data-testid="countries-territories">
                <option value="own">as countries of their own (their own flags)</option>
                <option value="part">as part of their nation (Greenland with Denmark)</option>
                <option value="none">left out</option>
              </select>
            </label>
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
                <span className="muted">{c.continent}{target === 'own' && existing.has(c.name.toLowerCase()) ? ' · already in the project (it will be used)' : ''}</span>
              </label>
            ))}
          </div>
          <h4>Who gets the land</h4>
          <label className="check"><input type="radio" name="target" checked={target === 'own'} onChange={() => setTarget('own')} /> Each becomes a country of its own</label>
          <label className="check"><input type="radio" name="target" checked={target === 'into'} onChange={() => setTarget('into')} disabled={!owners.length} data-testid="countries-into" /> Add the land to one of your countries{!owners.length ? ' (there are none yet)' : ''}</label>
          {target === 'into' && <label>Country<select value={intoId} onChange={(e) => setIntoId(e.target.value)} data-testid="countries-into-target">
            {owners.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select></label>}
          {target === 'own' && <>
            <h4>How they look</h4>
            <label>Colours<select value={colours} onChange={(e) => setColours(e.target.value as 'map' | 'distinct')}>
              <option value="map">Map colours (neighbours always differ)</option><option value="distinct">A different colour for each</option>
            </select></label>
            <label className="check"><input type="checkbox" checked={flags} onChange={(e) => setFlags(e.target.checked)} data-testid="countries-flags" /> Fill each with its flag</label>
          </>}
          <h4>When</h4>
          <label className="check"><input type="radio" name="when" checked={as === 'start'} onChange={() => setAs('start')} /> Part of the starting map (they exist from the beginning)</label>
          <label className="check"><input type="radio" name="when" checked={as === 'change'} onChange={() => setAs('change')} data-testid="countries-as-change" /> From {fmt(s.time)} on, without an event</label>
          <label className="check"><input type="radio" name="when" checked={as === 'event'} onChange={() => setAs('event')} data-testid="countries-as-event" /> A change on {fmt(s.time)}, as a new event</label>
          {as === 'event' && <label>Event name<input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder={into ? `${chosen.size === 1 ? [...chosen][0] : 'Land'} joins ${into.name}` : 'Present-day borders'} /></label>}
        </>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!chosen.size} onClick={add} data-testid="add-countries-go">{into ? `Add to ${into.name}` : `Add ${chosen.size} ${chosen.size === 1 ? 'country' : 'countries'}`}</button>
        </div>
      </div>
    </div>
  );
}
