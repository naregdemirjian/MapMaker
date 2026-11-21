// The solar system side by side, as chosen (D192): the bodies' sizes (as before, all alike, true to each other or
// compressed), the spacing of the row (even, true to the distances from the Sun or compressed), and which moons.
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { spaceSettingsOf } from '../../world-model/world-settings.ts';
import { BODIES, MOONS, DEFAULT_SOLAR_ROW, type SolarRow, type RowSizes, type RowSpacing } from '../../space/solar.ts';

export function SolarRowDialog() {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  const settings = spaceSettingsOf(space);
  const close = () => s.set({ dialog: null });
  if (!space || settings?.catalogue !== 'solar') return null;
  const row = settings.row ?? DEFAULT_SOLAR_ROW;
  const set = (patch: Partial<SolarRow>) => s.execute((w) => cmd.setSolarRow(w, space.id, { ...row, ...patch }));
  const toggle = (id: number, on: boolean) => set({ moons: 'chosen', chosen: on ? [...row.chosen, id] : row.chosen.filter((x) => x !== id) });
  return (
    <div className="modal-back see-through">
      <div className="modal" role="dialog" aria-label="The solar system side by side" data-testid="solar-row-dialog">
        <div className="modal-head"><h2>Side by side</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">How the Sun, the planets and their moons are drawn in a row. Who holds each body, and the lanes between them, stay as they are.</p>
        <label>Sizes<select value={row.sizes} onChange={(e) => set({ sizes: e.target.value as RowSizes })} data-testid="solar-row-sizes">
          <option value="styled">As drawn to read well</option>
          <option value="equal">All alike</option>
          <option value="true">True to each other (Jupiter eleven Earths across; the Sun held smaller)</option>
          <option value="compressed">Compressed (the small ones larger)</option>
        </select></label>
        <label>Spacing<select value={row.spacing} onChange={(e) => set({ spacing: e.target.value as RowSpacing })} data-testid="solar-row-spacing">
          <option value="even">Even steps</option>
          <option value="true">True to the distances from the Sun (the inner planets close together)</option>
          <option value="compressed">Compressed distances</option>
        </select></label>
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
