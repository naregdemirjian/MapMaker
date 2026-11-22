// "Changes over time": a selection mode for a country. The whole country is shown lightly; the land it
// gained and lost during a chosen period (a day, a month, a year, several years) around the date
// being viewed is shown strongly, with the changes that did it listed. Nothing is changed.
import { calendarNow } from '../calendar-now.ts';
import { useStore, store } from '../store.ts';
import { countryPeriodChanges, periodAround, stepPeriod, periodLabel, type PeriodChanges, type PeriodSpec } from '../../domain/history-view.ts';
import type { World } from '../../world-model/world.ts';
import type { Engine } from '../../temporal-engine/engine.ts';
import { fmt } from '../inputs.tsx';
import { isBaseEvent } from '../../world-model/schema.ts';

export const GAINED_COLOR = '#5fe08a';
export const LOST_COLOR = '#ff6b6b';

let memo: { key: string; value: PeriodChanges } | null = null;

/** The changes for a country in the period around the date being viewed (kept until anything changes). */
export function periodChangesNow(world: World, engine: Engine, spaceId: string, layerId: string, entity: string): PeriodChanges {
  const { from, to } = periodAround(store.time, store.historyView.period, calendarNow());
  const key = `${world.revision}|${spaceId}|${layerId}|${entity}|${from.day}:${from.ms}|${to.day}:${to.ms}`;
  if (memo?.key !== key) memo = { key, value: countryPeriodChanges(world, engine, spaceId, layerId, entity, from, to) };
  return memo.value;
}

export function CountryHistorySection({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const hv = s.historyView;
  const radius = w.get('map_space', s.spaceId)?.radius_m ?? 6371000;
  const km2 = (sr: number) => `${Math.round(sr * (radius / 1000) ** 2).toLocaleString()} km²`;
  const setPeriod = (period: PeriodSpec) => s.set({ historyView: { ...hv, period } });
  const pc = hv.on && s.layerId ? periodChangesNow(w, e, s.spaceId, s.layerId, id) : null;
  const name = (v: string | null) => (v ? w.get('entity', v)?.name ?? 'someone' : 'nobody');
  return (
    <div className="history-section">
      <h4>Changes over time</h4>
      <label className="check"><input type="checkbox" checked={hv.on} onChange={(ev) => s.set({ historyView: { ...hv, on: ev.target.checked } })} data-testid="history-mode" /> Show what changed in a period</label>
      {hv.on && <>
        <div className="two">
          <label>Period<select value={hv.period.unit} onChange={(ev) => setPeriod({ ...hv.period, unit: ev.target.value as PeriodSpec['unit'] })} data-testid="history-unit">
            <option value="day">A day</option><option value="month">A month</option><option value="year">A year</option><option value="years">Several years</option>
          </select></label>
          {hv.period.unit === 'years' && <label>Years<input type="number" min={2} max={100000} value={hv.period.years} onChange={(ev) => setPeriod({ ...hv.period, years: Math.max(2, Math.round(Number(ev.target.value) || 10)) })} data-testid="history-years" /></label>}
        </div>
        {pc && <>
          <div className="period-nav">
            <button className="small" onClick={() => s.setTime(stepPeriod(s.time, hv.period, -1, calendarNow()))} title="The period before" data-testid="history-prev">◀</button>
            <b data-testid="history-period">{periodLabel(pc.from, pc.to, hv.period, calendarNow())}</b>
            <button className="small" onClick={() => s.setTime(stepPeriod(s.time, hv.period, 1, calendarNow()))} title="The period after" data-testid="history-next">▶</button>
          </div>
          <div className="stat" data-testid="history-summary">
            <span className="swatch" style={{ background: GAINED_COLOR }} /> Gained {km2(pc.gainedArea)} · <span className="swatch" style={{ background: LOST_COLOR }} /> lost {km2(pc.lostArea)}
          </div>
          {pc.changes.map((c) => {
            const ev = w.get('event', c.eventId);
            return (
              <div key={c.effectId} className="row" onClick={() => s.set({ time: c.t, selection: { kind: 'entity', id } })} data-testid="history-change">
                <span className="date">{fmt(c.t)}</span> {ev && !isBaseEvent(ev.id) ? ev.name : 'a change without an event'}
                {c.gainedArea > 0 && <span className="gain"> +{km2(c.gainedArea)} from {c.from.map(name).join(', ')}</span>}
                {c.lostArea > 0 && <span className="loss"> −{km2(c.lostArea)} to {c.to.map(name).join(', ')}</span>}
              </div>
            );
          })}
          {!pc.changes.length && <div className="muted">No changes to its land in this period.</div>}
          <p className="muted">On the map: the whole country lightly, land gained in this period in green, land lost in red.</p>
        </>}
      </>}
    </div>
  );
}
