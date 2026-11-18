// "Import borders from files" (improvement B, D120): maps of borders as GeoJSON, each of its date, given to the
// map's territory layer: the first as the starting map (or from its date), the others as the changes at theirs.
// Countries go on from one map to the next by name; land a map does not show becomes nobody's at its date.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { readGeoJSON, guessNameKey, countriesOf, yearOfFileName, type ImportedFile } from '../../domain/geojson-import.ts';
import { gregorian, NEG_INF, type Instant } from '../../core-time/index.ts';
import { DateField, fmt } from './Panels.tsx';

interface Chosen { name: string; file: ImportedFile; t: Instant | null }

export function ImportBordersDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [files, setFiles] = useState<Chosen[]>([]);
  const [error, setError] = useState('');
  const [nameKey, setNameKey] = useState<string>('');
  const [colorKey, setColorKey] = useState<string>('');
  const [firstAsStart, setFirstAsStart] = useState(true);
  const [replace, setReplace] = useState(true);
  // Borders within this distance of borders already on the map are taken as the same border (two datasets
  // draw a border a few kilometres apart; following the one there leaves no slivers between them).
  const [matchKm, setMatchKm] = useState(3);
  const [progress, setProgress] = useState<string | null>(null);
  const keys = [...new Set(files.flatMap((f) => f.file.keys))].sort();

  const read = async (list: FileList | null) => {
    if (!list?.length) return;
    setError('');
    const out: Chosen[] = [...files];
    for (const f of [...list]) {
      try {
        const file = readGeoJSON(await f.text());
        const y = yearOfFileName(f.name);
        out.push({ name: f.name, file, t: y === null ? null : gregorian.fromCivil({ year: y }) });
      } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
    }
    out.sort((a, b) => (a.t?.day ?? Infinity) - (b.t?.day ?? Infinity));
    setFiles(out);
    if (!nameKey && out.length) setNameKey(guessNameKey(out[0].file) ?? '');
  };

  const go = async () => {
    const layerId = s.layerId;
    if (!layerId) { s.toast('This map has no territory layer to draw on.', 'error'); return; }
    if (!nameKey) { s.toast('Choose the property that holds the names.', 'error'); return; }
    const todo = files.map((f, i) => ({ ...f, t: i === 0 && firstAsStart ? NEG_INF : f.t ?? s.time }));
    let made = 0, countries = 0;
    const skipped: string[] = [];
    for (const [i, f] of todo.entries()) {
      setProgress(`Importing ${f.name} (${i + 1} of ${todo.length})…`);
      // (Let the message show before the work starts.)
      await new Promise((r) => setTimeout(r, 30));
      const list = countriesOf(f.file, nameKey, colorKey || null).countries;
      if (!list.length) continue;
      const r = s.execute((wd, en) => cmd.importTerritories(wd, en, {
        spaceId: s.spaceId, layerId, t: f.t, countries: list, replace, matchKm,
        label: `Import ${f.name} (${f.t.day === -Infinity ? 'the starting map' : fmt(f.t)})`,
      }));
      if (!r) { setProgress(null); return; }
      made += r.created; countries += list.length;
      for (const n of r.skipped) if (!skipped.includes(n)) skipped.push(n);
    }
    setProgress(null);
    s.toast(`Imported ${todo.length} ${todo.length === 1 ? 'map' : 'maps'}: ${countries} countries, ${made} of them new.`);
    // (Shapes that could not be joined to the borders around them, by country.)
    if (skipped.length) s.toast(`Some shapes could not be joined to the borders around them and were left out, of: ${skipped.slice(0, 12).join(', ')}${skipped.length > 12 ? ` and ${skipped.length - 12} more` : ''}. Try them again with a larger or smaller matching distance.`, 'error');
    // The timeline shows the whole history imported (widened to the maps' dates, never narrowed).
    const years = todo.filter((f) => f.t.day !== -Infinity).map((f) => f.t.day / 365.2425 + 1970);
    if (years.length) {
      const lo = Math.min(...years), hi = Math.max(...years), pad = Math.max(5, (hi - lo) * 0.1);
      s.set({ timeline: { start: Math.min(s.timeline.start, lo - pad), end: Math.max(s.timeline.end, hi + pad) } });
    }
    onClose();
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Import borders from files" data-testid="import-borders">
        <div className="modal-head"><h2>Import borders from files</h2><button className="close" onClick={onClose} aria-label="Close" disabled={!!progress}>×</button></div>
        <p className="muted">GeoJSON maps of borders (a FeatureCollection of polygons in longitude and latitude), one for each date: historical border datasets, or maps made in a GIS. Each map's countries get their land from its date; a country goes on from one map to the next by its name, and land a map does not show becomes nobody's at its date, so the maps play as the history between them.</p>
        <label className="file-button">Choose files…<input type="file" accept=".geojson,.json,application/geo+json,application/json" multiple onChange={(e) => { void read(e.target.files); e.target.value = ''; }} data-testid="import-borders-files" /></label>
        {error && <p className="error" data-testid="import-borders-error">{error}</p>}
        {files.length > 0 && <>
          <table className="facts import-files" data-testid="import-borders-list"><tbody>
            {files.map((f, i) => (
              <tr key={`${f.name}-${i}`} data-testid="import-borders-file">
                <td>{f.name}<div className="muted">{f.file.features.length} shapes{f.file.skipped ? `, ${f.file.skipped} without an area left out` : ''}</div></td>
                <td>{i === 0 && firstAsStart ? <span className="muted">the starting map</span> : <DateField value={f.t} onChange={(t) => setFiles(files.map((x, k) => (k === i ? { ...x, t } : x)).sort((a, b) => (a.t?.day ?? Infinity) - (b.t?.day ?? Infinity)))} placeholder="Its date" testId={`import-borders-date-${i}`} />}</td>
                <td><button className="small danger" onClick={() => setFiles(files.filter((_, k) => k !== i))} title="Leave this file out">×</button></td>
              </tr>))}
          </tbody></table>
          <div className="two">
            <label>Names from<select value={nameKey} onChange={(e) => setNameKey(e.target.value)} data-testid="import-borders-name">
              <option value="">(choose)</option>{keys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select></label>
            <label>Colours from<select value={colorKey} onChange={(e) => setColorKey(e.target.value)} title="A property holding colours (#c0392b); otherwise each new country gets a colour of its own">
              <option value="">(colours of their own)</option>{keys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select></label>
          </div>
          {nameKey && <p className="muted" data-testid="import-borders-summary">{files.map((f) => { const c = countriesOf(f.file, nameKey); return `${f.name}: ${c.countries.length} countries${c.unnamed ? ` (${c.unnamed} shapes without a name left out)` : ''}`; }).join(' · ')}</p>}
          <label className="check"><input type="checkbox" checked={firstAsStart} onChange={(e) => setFirstAsStart(e.target.checked)} data-testid="import-borders-first-start" /> The first map is the starting map (the countries exist from the beginning)</label>
          <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} data-testid="import-borders-replace" /> Land a map does not show becomes nobody's at its date</label>
          <label title="Two maps rarely draw a border along exactly the same line. A border this close to one already on the map is taken as the same border and follows it, so no slivers of land are left between the two. 0 keeps every line as the file draws it.">Borders within<input type="number" min={0} max={50} step={0.5} value={matchKm} onChange={(e) => setMatchKm(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} data-testid="import-borders-match" style={{ width: '5em', margin: '0 0.4em' }} />km of one already on the map are the same border</label>
          <p className="muted">On the political layer of this map, one undo step for each file. Files without a date take the date viewed ({fmt(s.time)}).</p>
        </>}
        {progress && <p className="muted" data-testid="import-borders-progress">{progress}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={!!progress}>Cancel</button>
          <button className="primary" disabled={!files.length || !nameKey || !!progress} onClick={() => void go()} data-testid="import-borders-go">Import {files.length || ''} {files.length === 1 ? 'map' : 'maps'}</button>
        </div>
      </div>
    </div>
  );
}
