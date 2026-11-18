// What the map shows (fifth feedback round, D84): while working, and in presentation and exports, each
// chosen on its own; and the smallest lake shown, so the thousands of small lakes can be left out.
import { useMemo, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { SHOW_ITEMS, shown, minLakeKm2, basemapSourceOf, type ShowSet } from '../../world-model/world-settings.ts';
import { lakeCount } from '../../render-engine/basemap.ts';

// The lake slider: all lakes at the left, then from 1 to 100,000 square kilometres on a log scale.
const LAKE_MAX = 100_000;
export const lakeToSlider = (km2: number) => (km2 > 0 ? Math.max(1, Math.round(1 + (Math.log10(Math.min(LAKE_MAX, Math.max(1, km2))) / Math.log10(LAKE_MAX)) * 99)) : 0);
export const sliderToLake = (v: number) => {
  if (v <= 0) return 0;
  const km2 = 10 ** (((v - 1) / 99) * Math.log10(LAKE_MAX));
  const step = km2 < 10 ? 1 : km2 < 100 ? 5 : km2 < 1000 ? 25 : km2 < 10_000 ? 250 : 2500;
  return Math.max(1, Math.round(km2 / step) * step);
};

export function ShowDialog() {
  const s = useStore();
  const w = s.world!;
  const space = w.get('map_space', s.spaceId);
  const close = () => s.set({ dialog: null });
  // While the slider is dragged its value is kept here, and saved (one change to undo) on release.
  const [drag, setDrag] = useState<number | null>(null);
  const min = drag !== null ? sliderToLake(drag) : minLakeKm2(space);
  const earth = !!space && space.kind !== 'plane' && basemapSourceOf(space) === 'natural-earth';
  const counts = useMemo(() => (earth && s.basemap ? lakeCount(s.basemap, min) : null), [earth, s.basemap, min]);
  if (!space) return null;
  const commit = () => {
    if (drag === null) return;
    const v = sliderToLake(drag);
    setDrag(null);
    if (v !== minLakeKm2(space)) s.execute((wd) => cmd.setWorldShow(wd, space.id, { minLakeKm2: v }));
  };
  const set = (where: 'working' | 'export', key: keyof ShowSet, on: boolean) => s.execute((wd) => cmd.setWorldShow(wd, space.id, { [where]: { [key]: on } }));
  const items = SHOW_ITEMS.filter((it) => earth || (it.key !== 'lakes' && it.key !== 'coastline'));
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="What is shown" data-testid="show-dialog">
        <div className="modal-head"><h2>What is shown</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">On "{space.name}", while you work and in presentation and exports, each on its own: hiding something while you work keeps it in your exports.</p>
        <table className="show-table">
          <thead><tr><th /><th>While working</th><th>In presentation and exports</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key}>
                <td>{it.name}</td>
                <td><input type="checkbox" checked={shown(space, 'working', it.key)} onChange={(e) => set('working', it.key, e.target.checked)} aria-label={`${it.name} while working`} data-testid={`show-working-${it.key}`} /></td>
                <td><input type="checkbox" checked={shown(space, 'export', it.key)} onChange={(e) => set('export', it.key, e.target.checked)} aria-label={`${it.name} in presentation and exports`} data-testid={`show-export-${it.key}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">A shot's own choices (names, cities, characters, grid lines) still apply to it.</p>
        {earth && (
          <label className="range-row">Smallest lake shown: <b data-testid="lake-min-text">{min > 0 ? `${min.toLocaleString()} km² and larger` : 'every lake'}</b>
            <input type="range" min={0} max={100} step={1} value={drag ?? lakeToSlider(min)} onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid="lake-min" />
            <span className="muted">{counts ? `${counts.shown.toLocaleString()} of ${counts.total.toLocaleString()} lakes shown. ` : ''}For scale: Lake Geneva is about 580 km², Lake Titicaca 8,400 km², Lake Superior 82,000 km².</span>
          </label>
        )}
        <div className="modal-actions"><button className="primary" onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
