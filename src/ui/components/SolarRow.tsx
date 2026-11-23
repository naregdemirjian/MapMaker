// The solar system side by side, as chosen (D192): the bodies' sizes (as before, all alike, true to each other or
// compressed), the spacing of the row (even, true to the distances from the Sun or compressed), and which moons.
import { useStore } from '../store.ts';
import { RangeReset } from '../shell/Reset.tsx';
import { shownSpace } from './SpaceView.tsx';
import * as cmd from '../../domain/commands.ts';
import { spaceSettingsOf } from '../../world-model/world-settings.ts';
import { BODIES, MOONS, DEFAULT_SOLAR_ROW, ROW_SCALE, ROW_GAP, fitRowGap, fitRowScale, solarRowOf, type SolarRow, type RowSizes, type RowSpacing } from '../../space/solar.ts';

export function SolarRowDialog() {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  const settings = spaceSettingsOf(space);
  const close = () => s.set({ dialog: null });
  if (!space || settings?.catalogue !== 'solar') return null;
  const row = solarRowOf(settings.row ?? DEFAULT_SOLAR_ROW);
  const set = (patch: Partial<SolarRow>) => s.execute((w) => cmd.setSolarRow(w, space.id, { ...row, ...patch }));
  // Fitting the screen (D216): for the view as it is now (its size), the row seen whole; the view brought home to see it.
  const frame = () => shownSpace()?.frame ?? { w: 1600, h: 900 };
  const lookSize = settings.look?.size ?? 1;
  const fitSizes = () => { const f = frame(); set({ scale: Math.round(fitRowScale(s.time, row, f.w, f.h, lookSize) * 1000) / 1000 }); s.setCamera({ ...s.camera, zoom: 0, rotation: 0 }); };
  const fitSpacing = () => { const f = frame(), fit = fitRowGap(s.time, row, f.w, f.h, lookSize); set({ gap: Math.round(fit.gap * 1000) / 1000 }); s.setCamera({ ...s.camera, zoom: 0, rotation: 0, target: fit.target }); };
  const toggle = (id: number, on: boolean) => set({ moons: 'chosen', chosen: on ? [...row.chosen, id] : row.chosen.filter((x) => x !== id) });
  return (
    <div className="modal-back see-through">
      <div className="modal" role="dialog" aria-label="The solar system side by side" data-testid="solar-row-dialog">
        <div className="modal-head"><h2>Side by side</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">How the Sun, the planets and their moons are drawn in a row. Who holds each body, and the lanes between them, stay as they are.</p>
        <label>Sizes<select value={row.sizes} onChange={(e) => set({ sizes: e.target.value as RowSizes })} data-testid="solar-row-sizes">
          <option value="poster">As a poster: true sizes, the Sun at the edge, the dwarf planets below</option>
          <option value="styled">As drawn to read well</option>
          <option value="equal">All alike</option>
          <option value="true">True to each other (Jupiter eleven Earths across; the Sun held smaller)</option>
          <option value="compressed">Compressed (the small ones larger)</option>
        </select></label>
        <label className="range-row">How large: <b>×{row.scale < 1 ? row.scale.toFixed(2) : row.scale.toFixed(1)}</b>
          <input type="range" min={Math.log10(ROW_SCALE.min) * 100} max={Math.log10(ROW_SCALE.max) * 100} step={1} value={Math.round(Math.log10(row.scale) * 100)} onChange={(e) => set({ scale: Math.round(Math.pow(10, Number(e.target.value) / 100) * 1000) / 1000 })} data-testid="solar-row-size" title="Every body larger or smaller, the sizes kept true to each other as chosen above" /><RangeReset def={0} value={Math.round(Math.log10(row.scale) * 100)} />
        </label>
        <button className="small fit-screen" onClick={fitSizes} data-testid="solar-row-size-fit" title="Every body as large as it can be without touching the next, the spacing as it is">Fit screen</button>
        <label>Spacing<select value={row.spacing} onChange={(e) => set({ spacing: e.target.value as RowSpacing })} data-testid="solar-row-spacing">
          <option value="even">Even steps</option>
          <option value="true">True to the distances from the Sun (the inner planets close together)</option>
          <option value="compressed">Compressed distances</option>
        </select></label>
        <label className="range-row">How far apart: <b>×{row.gap.toFixed(2)}</b>
          <input type="range" min={Math.log2(ROW_GAP.min) * 100} max={Math.log2(ROW_GAP.max) * 100} step={1} value={Math.round(Math.log2(row.gap) * 100)} onChange={(e) => set({ gap: Math.round(Math.pow(2, Number(e.target.value) / 100) * 1000) / 1000 })} data-testid="solar-row-gap" title="The bodies closer together or further apart, the spacing chosen above kept" /><RangeReset def={0} value={Math.round(Math.log2(row.gap) * 100)} />
        </label>
        <button className="small fit-screen" onClick={fitSpacing} data-testid="solar-row-gap-fit" title="The row from the Sun to the last planet across the whole screen, the sizes as they are">Fit screen</button>
        <label>Moons<select value={row.moons} onChange={(e) => set({ moons: e.target.value as SolarRow['moons'] })} data-testid="solar-row-moons">
          <option value="all">All the large moons</option>
          <option value="none">None</option>
          <option value="chosen">These ones:</option>
        </select></label>
        {row.moons === 'chosen' && (
          <div className="solar-row-moons">
            {BODIES.filter((b) => MOONS.some((m) => m.planet === b.id)).map((b) => (
              <div key={b.id} className="solar-row-planet"><b>{b.name}</b>
                {MOONS.filter((m) => m.planet === b.id).map((m) => (
                  <label key={m.id} className="check"><input type="checkbox" checked={row.chosen.includes(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} data-testid={`solar-row-moon-${m.name}`} /> {m.name}</label>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions"><button className="primary" onClick={close}>Done</button></div>
      </div>
    </div>
  );
}
