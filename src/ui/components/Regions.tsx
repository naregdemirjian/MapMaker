// The region picker (Stage 2, D78): with the Regions tool, today's countries or their states and
// provinces are chosen on the map (a click toggles one, a box takes all inside it) and given to an
// owner, existing or new, from the date viewed, as a correction or in an event.
import { useEffect, useState } from 'react';
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { decodeRegions, RegionIndex, countriesAsRegions, type RegionsFile } from '../../domain/regions.ts';
import { loadCountries } from './AddCountries.tsx';
import { useWhen, modeOf, WhenChooser, useKeys, Frame, countriesOf } from './SplitMerge.tsx';

export type RegionLevel = 'regions' | 'countries';
const loaded = new Map<RegionLevel, RegionIndex>();
const loading = new Map<RegionLevel, Promise<RegionIndex>>();

function load(level: RegionLevel): Promise<RegionIndex> {
  let p = loading.get(level);
  if (!p) {
    p = (level === 'regions'
      ? fetch('data/natural-earth/regions-10m.json').then(async (r) => decodeRegions(await r.json() as RegionsFile))
      : loadCountries().then(countriesAsRegions)
    ).then((list) => { const ix = new RegionIndex(list); loaded.set(level, ix); store.notify(); return ix; });
    p.catch((e: Error) => { loading.delete(level); store.toast(`The regions could not be loaded: ${e.message}`, 'error'); });
    loading.set(level, p);
  }
  return p;
}

/** The regions of a level, once loaded (asking for them starts loading; the map is drawn again when they arrive). */
export function regionIndex(level: RegionLevel): RegionIndex | null {
  const ix = loaded.get(level);
  if (!ix) void load(level).catch(() => {});
  return ix ?? null;
}

/** Under the toolbar while picking regions. */
export function RegionToolOptions() {
  const s = useStore();
  const ix = regionIndex(s.regionLevel);
  const picks = s.regionPicks;
  const names = ix ? picks.slice(0, 4).map((i) => ix.regions[i]?.name).filter(Boolean) : [];
  return (
    <div className="toolbar sub" data-testid="region-options">
      <label className="inline">Pick
        <select value={s.regionLevel} onChange={(e) => s.set({ regionLevel: e.target.value as RegionLevel, regionPicks: [] })} data-testid="region-level">
          <option value="regions">States and provinces of today</option>
          <option value="countries">Countries of today</option>
        </select>
      </label>
      {!ix ? <span className="muted">Loading…</span>
        : !picks.length ? <span className="muted">Click regions to choose them (click again to leave one out), or drag a box around several.</span>
        : <>
          <span data-testid="region-count">{picks.length} chosen</span>
          <span className="muted">{names.join(', ')}{picks.length > names.length ? '…' : ''}</span>
          <button className="small primary" onClick={() => s.set({ dialog: 'give-regions' })} data-testid="regions-give">Give them to… <span className="key">Enter</span></button>
          <button className="small" onClick={() => s.set({ regionPicks: [] })}>Clear <span className="key">Esc</span></button>
        </>}
    </div>
  );
}

export function GiveRegionsDialog() {
  const s = useStore();
  const w = s.world!;
  const ix = regionIndex(s.regionLevel);
  const picks = ix ? s.regionPicks.filter((i) => ix.regions[i]) : [];
  const first = ix && picks.length ? ix.regions[picks[0]] : null;
  const owners = countriesOf(w);
  const [to, setTo] = useState(() => (s.paintValue && owners.some((o) => o.id === s.paintValue) ? s.paintValue : 'new'));
  const [newName, setNewName] = useState(first ? (picks.length === 1 ? first.name : `${first.name} and others`) : '');
  const [when, setWhen] = useWhen(first ? `${first.name}${picks.length > 1 ? ` and ${picks.length - 1} more` : ''} change hands` : 'Regions change hands');
  const close = () => s.set({ dialog: null });
  const confirm = () => {
    if (!ix || !picks.length || !s.layerId) { close(); return; }
    const { mode, newEvent } = modeOf(when, s.time, w);
    const countries = picks.map((i) => ({ name: ix.regions[i].name, polygons: ix.regions[i].polygons }));
    const r = s.execute((wd, en) => cmd.addCountries(wd, en, { spaceId: s.spaceId, layerId: s.layerId!, countries, into: to === 'new' ? { name: newName } : to, mode, newEvent }));
    if (r) {
      s.set({ dialog: null, regionPicks: [], selection: r.entities[0] ? { kind: 'entity', id: r.entities[0] } : s.selection });
      s.toast(`${picks.length === 1 ? first!.name : `${picks.length} regions`} given to ${w.get('entity', r.entities[0])?.name ?? 'their owner'}.`);
    }
  };
  useKeys(confirm, close);
  useEffect(() => { if (!picks.length) close(); });
  return (
    <Frame title={`Give ${picks.length === 1 ? first?.name ?? 'the region' : `${picks.length} regions`}`} testId="give-regions" onClose={close}>
      <p className="muted">Their land (as Natural Earth draws {s.regionLevel === 'regions' ? 'today\'s states and provinces' : 'today\'s countries'}) goes to:</p>
      <label>
        <select value={to} onChange={(ev) => setTo(ev.target.value)} data-testid="regions-to">
          <option value="new">A new country…</option>
          {owners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      {to === 'new' && <label>Name of the new country<input autoFocus value={newName} onChange={(ev) => setNewName(ev.target.value)} data-testid="regions-new-name" /></label>}
      <h4>When</h4>
      <WhenChooser when={when} setWhen={setWhen} />
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={confirm} data-testid="confirm-regions">Give <span className="key">Enter</span></button></div>
    </Frame>
  );
}
