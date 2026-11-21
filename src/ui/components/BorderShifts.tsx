// Generated border shifts (D195): for a change drawn in an event (land one country gains), the shifts of the
// border in between, step by step, as real changes. The dialog sets how long a step is, when the gainer holds
// all of it, how much the other side pushes back and how ragged the front is; "Another version" tries the
// next pattern of chance. Made again or taken away at any time; one step to undo.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON, effectTime, eventEnd, type Resolution } from '../../temporal-engine/engine.ts';
import { compare, fromStore, stepDate, type Instant } from '../../core-time/index.ts';
import { calendarOfSpace } from '../../world-model/world-settings.ts';
import { shiftDates, MAX_SHIFT_STEPS } from '../../domain/border-shifts.ts';
import { DateField } from './Panels.tsx';

type Unit = 'day' | 'week' | 'month' | 'year';

export function BorderShiftsDialog() {
  const s = useStore();
  const w = s.world!;
  const ef = s.shiftsFor ? w.get('effect', s.shiftsFor) : undefined, ev = ef ? w.get('event', ef.event_id) : undefined;
  const made = ef ? cmd.borderShiftsOf(w, ef.id) : null;
  const start = ef && ev ? (made ? fromStore(made.from[0], made.from[1]) : effectTime(ef, ev)) : null;
  const cal = calendarOfSpace(ef?.space_id ? w.get('map_space', ef.space_id) : null);
  const [n, setN] = useState(made?.every.n ?? 1);
  const [unit, setUnit] = useState<Unit>(made?.every.unit ?? 'month');
  const [until, setUntil] = useState<Instant | null>(() => {
    if (made) return fromStore(made.until[0], made.until[1]);
    const end = ev ? eventEnd(ev) : null;
    return start && end && compare(end, start) > 0 ? end : start ? stepDate(start, 'year', 1, cal) : null;
  });
  const [pushBack, setPushBack] = useState(made?.pushBack ?? 0.5);
  const [roughness, setRoughness] = useState(made?.roughness ?? 0.35);
  const [seed, setSeed] = useState(made?.seed ?? 1);
  const close = () => s.set({ dialog: null, shiftsFor: null });
  if (!ef || !ev || !start) return null;
  const set = parseJSON<Resolution>(ef.resolution, { set: [] }).set[0];
  const gainer = set?.[1] ? w.get('entity', set[1])?.name ?? 'someone' : 'nobody';
  const next = (t: Instant) => (unit === 'week' ? stepDate(t, 'day', 7 * Math.max(1, n), cal) : stepDate(t, unit, Math.max(1, n), cal));
  const steps = until && compare(until, start) > 0 ? shiftDates(start, until, next, (a, b) => compare(a, b) < 0).length : 0;
  const problem = !until ? 'Choose when it ends.' : compare(until, start) <= 0 ? 'The end has to be after the change\'s own date.' : steps > MAX_SHIFT_STEPS ? `That would be more than ${MAX_SHIFT_STEPS} steps: choose longer steps or an earlier end.` : null;
  const generate = (withSeed = seed) => {
    if (problem || !until) return;
    const done = s.execute((wd, en) => cmd.generateBorderShifts(wd, en, { effectId: ef.id, every: { n: Math.max(1, Math.round(n)), unit }, until, pushBack, roughness, seed: withSeed, snap: 1e-8 }));
    if (done) { s.toast(`${done.steps} border shifts generated for ${gainer}: play or step through the dates to see them.`); s.setTime(start); }
  };
  const fmt = (t: Instant) => cal.format(t, 'day');
  return (
    <div className="modal-back see-through">
      <div className="modal" role="dialog" aria-label="Generate border shifts" data-testid="border-shifts-dialog">
        <div className="modal-head"><h2>Generate border shifts</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">The change gives {gainer} its land all at once. Here the border is moved there step by step instead, as real changes in “{ev.name}”: at each step {gainer} holds more, from its own border onward, and the other side takes some back here and there. From {fmt(start)}; at the end {gainer} holds all of it.</p>
        <label>A step every
          <span className="row-inline">
            <input type="number" min={1} max={999} step={1} value={n} onChange={(e) => setN(Math.max(1, Math.round(Number(e.target.value) || 1)))} data-testid="shifts-every" style={{ width: 70 }} />
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} data-testid="shifts-unit">
              <option value="day">{n === 1 ? 'day' : 'days'}</option><option value="week">{n === 1 ? 'week' : 'weeks'}</option><option value="month">{n === 1 ? 'month' : 'months'}</option><option value="year">{n === 1 ? 'year' : 'years'}</option>
            </select>
          </span>
        </label>
        <label>Until (all of it is {gainer}'s)<DateField value={until} onChange={(t) => setUntil(t)} testId="shifts-until" cal={cal} /></label>
        <div className={problem ? 'error' : 'muted'} data-testid="shifts-count">{problem ?? `${steps} ${steps === 1 ? 'step' : 'steps'}, then the last at ${fmt(until!)}.`}</div>
        <label className="range-row">The other side pushes back: <b>{Math.round(pushBack * 100)}%</b>
          <input type="range" min={0} max={100} step={5} value={Math.round(pushBack * 100)} onChange={(e) => setPushBack(Number(e.target.value) / 100)} data-testid="shifts-pushback" title="0%: the border only ever advances. 100%: it is thrown back often, and far" />
        </label>
        <label className="range-row">How ragged the front is: <b>{Math.round(roughness * 100)}%</b>
          <input type="range" min={0} max={100} step={5} value={Math.round(roughness * 100)} onChange={(e) => setRoughness(Number(e.target.value) / 100)} data-testid="shifts-roughness" />
        </label>
        <div className="buttons">
          <button className="primary" disabled={!!problem} onClick={() => generate()} data-testid="shifts-generate">{made ? 'Generate again' : 'Generate'}</button>
          <button disabled={!!problem} onClick={() => { setSeed(seed + 1); generate(seed + 1); }} data-testid="shifts-another" title="The same settings with another pattern of chance">Another version</button>
          {made && <button className="danger" onClick={() => { s.execute((wd) => cmd.removeBorderShifts(wd, ef.id)); }} data-testid="shifts-remove">Remove the shifts</button>}
          <button onClick={close} data-testid="shifts-close">Close</button>
        </div>
        {made && <p className="muted" data-testid="shifts-made">{made.steps} generated {made.steps === 1 ? 'shift' : 'shifts'} now, every {made.every.n === 1 ? made.every.unit : `${made.every.n} ${made.every.unit}s`} until {fmt(fromStore(made.until[0], made.until[1]))} (pattern {made.seed}). Generating again replaces them.</p>}
        <p className="muted">Each step's border is cut into the map's parcels. The shifts start where {gainer}'s own land touches the change (or where the change was set to spread from). Undo takes them all away in one step.</p>
      </div>
    </div>
  );
}
