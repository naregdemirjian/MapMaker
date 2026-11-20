// What the map shows (fifth feedback round, D84): while working, and in presentation and exports, each
// chosen on its own; the smallest lake shown, so the thousands of small lakes can be left out; and the
// terrain and how it is drawn (D95).
import { useMemo, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { SHOW_ITEMS, shown, minLakeKm2, basemapSourceOf, terrainLook, terrainSourceOf, type ShowSet } from '../../world-model/world-settings.ts';
import { lakeCount } from '../../render-engine/basemap.ts';
import { terrainDrawable } from '../../render-engine/terrain-gl.ts';
import { PALETTES, STRENGTH_MIN, STRENGTH_MAX, type TerrainLook, type TerrainPalette } from '../../terrain/look.ts';

// The relief strength slider: powers of two from a quarter to four times the usual.
const strengthToSlider = (v: number) => Math.round(Math.log2(v) * 4);
const sliderToStrength = (v: number) => Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, 2 ** (v / 4)));

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
  const look = terrainLook(space);
  const planet = terrainSourceOf(space) === 'planet';
  const items = SHOW_ITEMS.filter((it) => (earth || (it.key !== 'lakes' && it.key !== 'coastline' && (it.key !== 'rivers' || planet))) && (it.key !== 'terrain' || !!look));
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
        {terrainSourceOf(space) && <TerrainSection spaceId={space.id} look={look} earth={terrainSourceOf(space) === 'earth'} planet={terrainSourceOf(space) === 'planet'} />}
        <div className="modal-actions"><button className="primary" onClick={close}>Close</button></div>
      </div>
    </div>
  );
}

/** The terrain of an Earth map (D95): on or off, and how it is drawn. */
function TerrainSection({ spaceId, look, earth, planet = false }: { spaceId: string; look: TerrainLook | null; earth: boolean; planet?: boolean }) {
  const s = useStore();
  const [drag, setDrag] = useState<number | null>(null);
  const change = (patch: Partial<TerrainLook> | null) => s.execute((wd) => cmd.setWorldTerrain(wd, spaceId, patch));
  const commit = () => {
    if (drag === null) return;
    const v = sliderToStrength(drag);
    setDrag(null);
    if (look && v !== look.strength) change({ strength: v });
  };
  const box = (key: 'colours' | 'relief' | 'overTerritories' | 'seaFloor' | 'detail' | 'photo' | 'fine' | 'climate', label: string, testid: string) => look && (
    <label className="check"><input type="checkbox" checked={look[key]} onChange={(e) => change({ [key]: e.target.checked })} data-testid={testid} /> {label}</label>
  );
  return (
    <section className="terrain-section" data-testid="terrain-section">
      <h3>Terrain</h3>
      {!terrainDrawable() && <p className="muted">Terrain is drawn by the graphics card (WebGL2), which this computer's browser does not offer: it cannot be shown here.</p>}
      <label className="check"><input type="checkbox" checked={!!look} onChange={(e) => change(e.target.checked ? {} : null)} data-testid="terrain-on" /> Show the terrain: the heights of the land and the depths of the sea</label>
      {look && (
        <div className="terrain-options">
          {box('colours', 'Colour the land by height and the sea by depth', 'terrain-colours')}
          {box('relief', 'Relief shading (lit from the north-west)', 'terrain-relief')}
          {box('overTerritories', 'Relief over the countries too', 'terrain-over-territories')}
          {box('seaFloor', 'Relief of the sea floor', 'terrain-sea-floor')}
          <label className="range-row">Relief strength: <b data-testid="terrain-strength-text">{Math.round((drag !== null ? sliderToStrength(drag) : look.strength) * 100)}%</b>
            <input type="range" min={strengthToSlider(STRENGTH_MIN)} max={strengthToSlider(STRENGTH_MAX)} step={1} value={drag ?? strengthToSlider(look.strength)} onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid="terrain-strength" />
          </label>
          <label className="range-row">Colours
            <select value={look.palette} onChange={(e) => change({ palette: e.target.value as TerrainPalette })} data-testid="terrain-palette">
              {(Object.keys(PALETTES) as TerrainPalette[]).map((p) => <option key={p} value={p}>{PALETTES[p].name}</option>)}
            </select>
          </label>
          {box('fine', 'Fine ground close in: below the heights\' own detail, relief, mottling and the bends of coasts made up by the graphics card (rougher where the land is steep; the same every time)', 'terrain-fine')}
          {planet && PALETTES[look.palette].cover && box('climate', 'The land\'s colours from the climate models: the simulated planets\' seasons, winds and rain, rivers, lakes, ice and biomes worked out on this planet\'s own land and sea (a few seconds; its sculpting included)', 'terrain-climate')}
          {earth && PALETTES[look.palette].cover && box('photo', 'The Earth as photographed from space: the whole planet, and close in the photographs of the place, to about 10 m, downloaded as needed (Sentinel-2 cloudless by EOX; kept on this computer)', 'terrain-photo')}
          {earth && PALETTES[look.palette].cover && look.photo && <p className="muted">The photographs show the land, rivers, lakes and coasts as they are today (no rivers or coastline are drawn over them); land the sea has taken or left at another sea level, and sculpted land, keep the colours of their cover. Offline, close in: the picture of the whole planet. Credit the photographs where you publish them: see Data sources and credits.</p>}
          {earth && box('detail', 'Finer heights close in, downloaded as needed (Terrain Tiles on AWS Open Data; kept on this computer)', 'terrain-detail')}
          {earth && <p className="muted">Earth's heights and depths, about 10 km apart (Mapzen terrain tiles; Greenland and Antarctica from the Copernicus DEM){look.detail ? ', and close in finer ones, to about 40 m, where they can be had (offline: the 10 km heights)' : ''}: see Data sources and credits.</p>}
        </div>
      )}
    </section>
  );
}
