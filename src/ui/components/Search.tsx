// The search box (top bar) and the data export dialog (Stage 4).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, store } from '../store.ts';
import { Api } from '../api.ts';
import { search, fold, type SearchResult } from '../../domain/search.ts';
import { mapGeoJSON, eventsCSV, entitiesCSV, relationsCSV, featuresCSV, isoDate } from '../../domain/data-export.ts';
import { type Instant, compare, fromStore } from '../../core-time/index.ts';
import { isFeatureKind } from '../../render-engine/feature-style.ts';
import { DateField, fmt } from './Panels.tsx';
import { spaceSettingsOf } from '../../world-model/world-settings.ts';
import { spaceScene } from '../../space/scene.ts';
import { findStars, type Star } from '../../space/catalogue.ts';
import { exoplanetsNow, planetSize } from '../../space/exoplanets.ts';

/** Go to what was found: choose it, and bring the date and the view to where it can be seen. */
export function goToResult(r: SearchResult): void {
  const s = store, w = s.world!, e = s.engine!;
  if (r.kind === 'entity') {
    s.set({ selection: { kind: 'entity', id: r.id }, mode: 'world' });
    const ent = w.get('entity', r.id);
    if (ent?.type_id === 'character' || ent?.type_id === 'settlement') {
      let at = e.charactersAt(s.spaceId, s.time).find((c) => c.entity === r.id);
      if (!at) {
        // Not on this map at this date: to its first place.
        const track = e.characterTrack(s.spaceId, r.id);
        const first = track.find((x) => !x.off);
        if (first) { if (first.t.day !== -Infinity) s.setTime(first.t); at = { entity: r.id, lon: first.lon, lat: first.lat, moving: false }; }
      }
      if (at) s.setCamera({ ...s.camera, lon: at.lon, lat: at.lat, zoom: Math.max(s.camera.zoom, 2) });
    }
    return;
  }
  if (r.kind === 'feature') {
    const f = w.get('feature', r.id);
    const layer = f ? w.get('layer', f.layer_id) : undefined;
    if (!f || !layer) return;
    if (layer.space_id !== s.spaceId) s.set({ spaceId: layer.space_id, layerId: w.all('layer').find((l) => l.space_id === layer.space_id && l.kind === 'partition')?.id ?? '' });
    let shape = e.featuresAt(f.layer_id, s.time).find((x) => x.feature === r.id)?.parts ?? null;
    if (!shape) {
      const first = e.featureHistory(r.id).find((x) => x.parts);
      if (first) { if (first.t.day !== -Infinity) s.setTime(first.t); shape = first.parts; }
    }
    s.set({ selection: { kind: 'feature', id: r.id }, mode: 'world' });
    if (shape?.[0]?.length) {
      let x = 0, y = 0, n = 0;
      for (const p of shape) for (let i = 0; i + 1 < p.length; i += 2) { x += p[i]; y += p[i + 1]; n++; }
      s.setCamera({ ...s.camera, lon: ((x / n + 540) % 360) - 180, lat: y / n });
    }
    return;
  }
  if (r.kind === 'event') {
    const ev = w.get('event', r.id);
    s.set({ selection: { kind: 'event', id: r.id }, mode: 'world' });
    if (ev) s.setTime(fromStore(ev.start_day, ev.start_ms));
    return;
  }
  if (r.kind === 'relation') {
    const rel = w.get('relation', r.id);
    if (rel) s.set({ selection: { kind: 'entity', id: rel.a }, mode: 'world' });
    return;
  }
  const l = w.get('layer', r.id);
  if (!l) return;
  if (l.space_id !== s.spaceId) s.set({ spaceId: l.space_id });
  if (isFeatureKind(l.kind)) s.set({ featureLayerId: l.id, tool: 'feature', mode: 'world' });
  else s.set({ layerId: l.id, mode: 'world' });
}

export function SearchBox() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const found = useMemo(() => (q.trim() && s.world ? search(s.world, s.engine, q) : []), [q, s.world?.revision]);
  // On a map of space, its stars or planets too (D110, D113), after what the project holds.
  const settings = spaceSettingsOf(s.world?.get('map_space', s.spaceId));
  const stars = useMemo(() => {
    if (!settings || !q.trim()) return [];
    const scene = spaceScene(settings, s.time);
    if (!scene.cat) return [];
    const cat = scene.cat;
    const kind = (st: Star) => (st.kind ? st.kind[0].toUpperCase() + st.kind.slice(1) : '');
    const what = (st: Star) => scene.unit === 'au'
      ? (st.id === 0 ? 'The Sun' : st.kind === 'moon' ? kind(st) : st.id === 9 ? 'Dwarf planet' : 'Planet')
      : scene.middle ? `${kind(st) || 'Star system'}${st.id ? `, ${Math.round(st.dist).toLocaleString('en-GB')} light-years away` : ''}`
      : st.id === 0 ? 'The Sun' : `Star, ${st.dist.toFixed(1)} light-years`;
    const out: Array<{ star: Star; title?: string; what: string; context: string }> = findStars(cat, q, 8).map((st) => ({ star: st, what: what(st), context: st.alt }));
    // Planets of other stars (D118), by name: choosing one chooses its star.
    if (settings.catalogue === 'nearby') {
      // (Every word asked for begins a word of the name: "proxima b" finds Proxima Centauri b.)
      const want = fold(q.trim()).split(/\s+/).filter(Boolean);
      for (const p of exoplanetsNow()?.planets ?? []) {
        const host = cat.byId.get(p.star), words = fold(p.name).split(/[\s-]+/);
        if (host && want.every((w) => words.some((x) => x.startsWith(w))) && out.length < 14) out.push({ star: host, title: p.name, what: `Planet of ${host.name}`, context: planetSize(p) });
      }
    }
    return out;
  }, [q, s.spaceId, settings?.catalogue, s.time.day]);
  const results: Array<{ r: SearchResult } | { star: Star; title?: string; what: string; context: string }> = [...found.map((r) => ({ r })), ...stars];
  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, []);
  // Ctrl+F (or Ctrl+K) goes to the search box.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k')) { e.preventDefault(); box.current?.querySelector('input')?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const pick = (item: (typeof results)[number]) => {
    if ('r' in item) goToResult(item.r);
    else {
      // A star or planet: chosen, and the view turned around it.
      const st = item.star;
      s.set({ selection: { kind: 'star', id: st.id }, mode: 'world', tool: 'select' });
      s.setCamera({ ...s.camera, target: [st.x, st.y, st.z] });
    }
    setOpen(false); setQ(''); (document.activeElement as HTMLElement | null)?.blur();
  };
  return (
    <div className="search" ref={box}>
      <input value={q} placeholder="Search… (Ctrl+F)" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} data-testid="search"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(results.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' && results[at]) { e.preventDefault(); pick(results[at]); }
          else if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }} />
      {open && q.trim() && (
        <div className="search-results" data-testid="search-results">
          {results.map((item, i) => {
            const key = 'r' in item ? `${item.r.kind}:${item.r.id}` : `star:${item.star.id}:${item.title ?? ''}`;
            const title = 'r' in item ? item.r.title : item.title ?? item.star.name, what = 'r' in item ? item.r.what : item.what, context = 'r' in item ? item.r.context : item.context;
            return (
              <div key={key} className={`search-result ${i === at ? 'on' : ''}`} onPointerDown={(e) => { e.preventDefault(); pick(item); }} onPointerMove={() => i !== at && setAt(i)} data-testid="search-result">
                <div><b>{title}</b> <span className="muted">· {what}</span></div>
                {context && <div className="muted small-note">{context}</div>}
              </div>
            );
          })}
          {!results.length && <div className="muted pad">Nothing found.</div>}
        </div>
      )}
    </div>
  );
}

/** Export the map at a date as GeoJSON, and the record as CSV, into the project's exports folder. */
export function DataExportDialog() {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const [t, setT] = useState<Instant>(s.time);
  const [which, setWhich] = useState({ map: true, events: true, entities: true, relations: true, features: true });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ dir: string; files: string[] } | null>(null);
  const space = w.get('map_space', s.spaceId);
  const close = () => s.set({ dialog: null });
  const run = async () => {
    setBusy(true);
    try {
      const files: Array<{ name: string; text: string }> = [];
      const safe = (x: string) => x.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'map';
      if (which.map) files.push({ name: `${safe(space?.name ?? 'map')}_${isoDate(t).replace(/:/g, '-')}.geojson`, text: JSON.stringify(mapGeoJSON(w, e, s.spaceId, t)) });
      if (which.events) files.push({ name: 'events.csv', text: eventsCSV(w) });
      if (which.entities) files.push({ name: 'countries_and_others.csv', text: entitiesCSV(w, e) });
      if (which.relations) files.push({ name: 'relationships.csv', text: relationsCSV(w, e) });
      if (which.features) files.push({ name: 'areas_lines_points.csv', text: featuresCSV(w, e) });
      if (!files.length) { s.toast('Choose something to export.', 'error'); return; }
      const r = await Api.exportData(s.projectId!, 'data', files);
      setDone(r);
    } catch (err) {
      s.toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const box = (k: keyof typeof which, label: string, hint: string) => (
    <label className="check" title={hint}><input type="checkbox" checked={which[k]} onChange={(ev) => setWhich({ ...which, [k]: ev.target.checked })} data-testid={`data-${k}`} /> {label}</label>
  );
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Export data" data-testid="data-export-dialog">
        <div className="modal-head"><h2>Export data</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">For GIS tools (QGIS, ArcGIS), spreadsheets and other software. The project itself stays the authoritative copy.</p>
        {box('map', `The map “${space?.name ?? ''}” on the date below (GeoJSON)`, 'Territories joined owner by owner, areas, lines and points, cities and characters, as they are at that date')}
        <label className="indent">Date<DateField value={t} onChange={(v) => v && setT(v)} testId="data-date" /></label>
        {box('events', 'Events (CSV)', 'Name, type, start, end, groups, alternatives, description')}
        {box('entities', 'Countries, factions, characters and cities (CSV)', 'With their other names over time and notes')}
        {box('relations', 'Relationships (CSV)', 'One row for each period a relationship holds')}
        {box('features', 'Areas, lines and points over time (CSV)', 'One row for each dated shape or ending; the shapes themselves are in the GeoJSON')}
        {done && <div className="ok-box" data-testid="data-export-result">Wrote {done.files.length} file{done.files.length === 1 ? '' : 's'}.<br /><span className="path">{done.dir}</span><br /><button onClick={() => Api.showFolder(s.projectId!, 'exports', done.dir)}>Show folder</button></div>}
        <div className="modal-actions"><button onClick={close}>Close</button><button className="primary" disabled={busy} onClick={run} data-testid="data-export-run">{busy ? 'Exporting…' : 'Export'}</button></div>
        <p className="muted small-note">Dates are written as {isoDate(t)} (astronomical years: year 0 is 1 BCE). Shown on {fmt(t)}.{compare(t, s.time) ? '' : ''}</p>
      </div>
    </div>
  );
}
