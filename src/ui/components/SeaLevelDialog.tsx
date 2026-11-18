// Sea level over time (Stage 8, D96): a map's sea at given dates, rising or falling steadily between
// them; the coasts, and territory that ends at the coast, follow it.
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { seaLevelPoints } from '../../world-model/world-settings.ts';
import { seaLevelAt, SEA_LEVEL_MIN, SEA_LEVEL_MAX, type SeaLevelPoint } from '../../terrain/sea-level.ts';
import { gregorian, type Instant } from '../../core-time/index.ts';
import { DateField, NumberField } from './Panels.tsx';

const at = (p: SeaLevelPoint): Instant => ({ day: p.day, ms: p.ms });
/** "120 m below today's", "today's", "40 m above today's". */
export const seaLevelText = (m: number) => {
  const r = Math.round(m * 10) / 10;
  return r === 0 ? "today's" : `${Math.abs(r).toLocaleString()} m ${r < 0 ? 'below' : 'above'} today's`;
};

/**
 * The end of the last ice age, after the usual reconstructions of global sea level (rounded): about
 * 130 m lower 21,000 years ago, rising fastest between about 14,500 and 7,000 years ago, near today's
 * from about 4000 BCE.
 */
const ICE_AGE: Array<[string, number]> = [['19000 BCE', -130], ['14500 BCE', -110], ['12000 BCE', -80], ['9500 BCE', -60], ['7000 BCE', -30], ['5000 BCE', -5], ['4000 BCE', 0]];

export function SeaLevelDialog() {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  const close = () => s.set({ dialog: null });
  if (!space) return null;
  const points = seaLevelPoints(space);
  const now = seaLevelAt(points, s.time);
  const save = (next: SeaLevelPoint[]) => s.execute((wd) => cmd.setWorldSeaLevel(wd, space.id, next));
  const change = (i: number, patch: Partial<SeaLevelPoint>) => save(points.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const iceAge = () => save(ICE_AGE.map(([text, m]) => { const t = gregorian.parse(text)!.instant; return { day: t.day, ms: t.ms, m }; }));
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Sea level over time" data-testid="sea-level-dialog">
        <div className="modal-head"><h2>Sea level over time</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">
          The sea of "{space.name}" at the dates below, in metres above or below today's. Between them it rises or falls
          steadily; before the first and after the last it stays as it is there. At any other level than today's, the
          coasts are where Earth's terrain then meets the sea (heights about 10 km apart), and territory that ends at the
          coast ends there.
        </p>
        <p data-testid="sea-level-now">On {gregorian.format(s.time, 'day')}: <b>{seaLevelText(now)}</b></p>
        {points.length > 0 && (
          <table className="sea-level-table">
            <thead><tr><th>Date</th><th>Sea level (m)</th><th /></tr></thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={`${p.day}:${p.ms}`}>
                  <td><DateField value={at(p)} onChange={(t) => t && Number.isFinite(t.day) && change(i, { day: t.day, ms: t.ms })} testId={`sea-date-${i}`} /></td>
                  <td><NumberField value={p.m} min={SEA_LEVEL_MIN} max={SEA_LEVEL_MAX} step={1} onCommit={(m) => change(i, { m })} testId={`sea-metres-${i}`} title="Metres above today's sea level (below: negative)" /></td>
                  <td><button className="link" onClick={() => save(points.filter((_, j) => j !== i))} data-testid={`sea-remove-${i}`}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="sea-level-actions">
          <button onClick={() => Number.isFinite(s.time.day) && save([...points, { day: s.time.day, ms: s.time.ms, m: Math.round(now) }])} data-testid="sea-add">Add the date viewed</button>
          <button onClick={iceAge} data-testid="sea-ice-age" title="About 130 m lower 21,000 years ago, near today's from about 4000 BCE (a usual reconstruction, rounded)">The end of the last ice age</button>
          {points.length > 0 && <button onClick={() => save([])} data-testid="sea-clear">Today's sea at all times</button>}
        </div>
        <div className="modal-actions"><button className="primary" onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
