// A map's calendar (Stage 13, D149): the Gregorian, or one of its own, started from a template and changed in every
// part: its months, its leap years, the day its year 1 began, the hours of its day, its week and its eras. Only
// how dates are written, typed and chosen changes; the moments stored stay as they are.
import { DialogFrame } from '../shell/DialogFrame.tsx';
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { calendarDefOf } from '../../world-model/world-settings.ts';
import { gregorian, instant, calendarOf, calendarProblems, CALENDAR_TEMPLATES, type CalendarDef } from '../../core-time/index.ts';
import { DateField, NumberField } from './Panels.tsx';

const copy = (d: CalendarDef): CalendarDef => JSON.parse(JSON.stringify(d)) as CalendarDef;

export function CalendarDialog() {
  const s = useStore();
  const space = s.world!.get('map_space', s.spaceId)!;
  const own = calendarDefOf(space);
  const [draft, setDraft] = useState<CalendarDef | null>(own ? copy(own) : null);
  const close = () => s.set({ dialog: null });
  const problems = draft ? calendarProblems(draft) : [];
  const cal = draft && !problems.length ? calendarOf(draft) : null;
  const set = (patch: Partial<CalendarDef>) => setDraft(draft ? { ...draft, ...patch } : null);
  const month = (i: number, patch: Partial<CalendarDef['months'][number]>) => draft && set({ months: draft.months.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const era = (i: number, patch: Partial<CalendarDef['eras'][number]>) => draft && set({ eras: draft.eras.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const leap = draft?.leap;
  const start = (id: string) => {
    if (id === 'gregorian') { setDraft(null); return; }
    const t = CALENDAR_TEMPLATES.find((x) => x.id === id);
    if (t) setDraft({ ...copy(t.def), id: `cal_${Date.now().toString(36)}` });
  };
  const num = (v: number | undefined) => (v === undefined ? '' : String(v));
  const optInt = (text: string) => (text.trim() === '' ? undefined : Math.round(Number(text)));
  return (
    <DialogFrame label="Calendar" title={<>Calendar of “{space.name}”</>} testId="calendar-dialog" wide className="calendar-dialog" onClose={close}>
        <p className="muted">Dates on this map are written, typed and chosen in its calendar: on the timeline, in every date field, in shots and exports. Nothing stored changes, only how the moments are written.</p>
        <label>Start from
          <select value="" onChange={(e) => e.target.value && start(e.target.value)} data-testid="calendar-template">
            <option value="">Choose…</option>
            <option value="gregorian">The Gregorian calendar (the usual)</option>
            {CALENDAR_TEMPLATES.map((t) => <option key={t.id} value={t.id} title={t.note}>{t.def.name}</option>)}
          </select>
        </label>
        {!draft ? <p data-testid="calendar-gregorian">This map uses the Gregorian calendar. Choose a calendar above to give it one of its own.</p> : (
          <div className="calendar-editor">
            <label>Name<input value={draft.name} onChange={(e) => set({ name: e.target.value })} data-testid="calendar-name" /></label>
            <h4>Months</h4>
            <table className="calendar-months">
              <thead><tr><th>Name</th><th>Short</th><th>Days</th><th title="Days more in a leap year">Leap</th><th /></tr></thead>
              <tbody>
                {draft.months.map((m, i) => (
                  <tr key={i}>
                    <td><input value={m.name} onChange={(e) => month(i, { name: e.target.value })} data-testid={`calendar-month-${i}`} /></td>
                    <td><input value={m.short ?? ''} placeholder={m.name.slice(0, 3)} onChange={(e) => month(i, { short: e.target.value || undefined })} className="short" /></td>
                    <td><NumberField value={m.days} min={0} max={1000} step={1} onCommit={(n) => month(i, { days: Math.round(n) })} testId={`calendar-days-${i}`} /></td>
                    <td><NumberField value={m.leapDays ?? 0} min={0} max={100} step={1} onCommit={(n) => month(i, { leapDays: Math.round(n) || undefined })} testId={`calendar-leap-${i}`} /></td>
                    <td><button className="link" disabled={draft.months.length < 2} onClick={() => set({ months: draft.months.filter((_, j) => j !== i) })}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="small" onClick={() => set({ months: [...draft.months, { name: `Month ${draft.months.length + 1}`, days: 30 }] })} data-testid="calendar-add-month">Add a month</button>
            <h4>Leap years</h4>
            <label className="check"><input type="checkbox" checked={!!leap} onChange={(e) => set({ leap: e.target.checked ? { every: 4 } : null })} data-testid="calendar-leap-on" /> Leap years, with the extra days above</label>
            {leap && (
              <div className="row-inline calendar-leap">
                <span>Every</span><input className="short" value={num(leap.every)} onChange={(e) => set({ leap: { ...leap, every: Math.max(1, Math.round(Number(e.target.value)) || 1) } })} data-testid="calendar-leap-every" /><span>years, except every</span>
                <input className="short" value={num(leap.except)} placeholder="–" onChange={(e) => set({ leap: { ...leap, except: optInt(e.target.value) } })} /><span>but every</span>
                <input className="short" value={num(leap.but)} placeholder="–" onChange={(e) => set({ leap: { ...leap, but: optInt(e.target.value) } })} /><span>(counted from year</span>
                <input className="short" value={num(leap.offset ?? 0)} onChange={(e) => set({ leap: { ...leap, offset: optInt(e.target.value) } })} /><span>)</span>
              </div>
            )}
            <h4>Its days</h4>
            <div className="two">
              <label title="The day of the Gregorian calendar whose midnight begins year 1">Year 1 began on
                <DateField cal={gregorian} value={instant(draft.epochDay)} onChange={(t) => t && Number.isFinite(t.day) && set({ epochDay: t.day })} testId="calendar-epoch" />
              </label>
              <label title="Hours in its day: a world turning faster or slower than the Earth">Hours in a day
                <NumberField value={draft.dayHours ?? 24} min={1} max={1000} step={1} onCommit={(n) => set({ dayHours: n === 24 ? undefined : n })} testId="calendar-hours" />
              </label>
            </div>
            <label title="The names of the days of its week, in order, separated by commas (none: no weeks)">Days of the week
              <input value={(draft.weekdays ?? []).join(', ')} onChange={(e) => { const w = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); set({ weekdays: w.length ? w : undefined }); }} data-testid="calendar-weekdays" />
            </label>
            {!!draft.weekdays?.length && (
              <div className="row-inline">
                <label className="check"><input type="checkbox" checked={!!draft.weeksByMonth} onChange={(e) => set({ weeksByMonth: e.target.checked || undefined })} /> The week begins again with each month</label>
                <label className="inline">Year 1 begins on a
                  <select value={draft.firstWeekday ?? 0} onChange={(e) => set({ firstWeekday: Number(e.target.value) })}>{draft.weekdays.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>
                </label>
              </div>
            )}
            <h4>Eras</h4>
            {draft.eras.map((e, i) => (
              <div key={i} className="row-inline calendar-era">
                <input value={e.name} placeholder="Name" onChange={(ev) => era(i, { name: ev.target.value })} data-testid={`calendar-era-name-${i}`} />
                <input className="short" value={e.abbr} placeholder="Abbr." onChange={(ev) => era(i, { abbr: ev.target.value })} data-testid={`calendar-era-abbr-${i}`} />
                <span>from year</span><input className="short" value={String(e.start)} onChange={(ev) => era(i, { start: Math.round(Number(ev.target.value)) || 0 })} data-testid={`calendar-era-start-${i}`} />
                <label className="check" title="Its years written without the abbreviation (as 1203 for 1203 CE)"><input type="checkbox" checked={!!e.quiet} onChange={(ev) => era(i, { quiet: ev.target.checked || undefined })} /> quiet</label>
                <button className="link" onClick={() => set({ eras: draft.eras.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
            <button className="small" onClick={() => set({ eras: [...draft.eras, { name: 'A new era', abbr: 'NE', start: (draft.eras[draft.eras.length - 1]?.start ?? 0) + 100 }] })} data-testid="calendar-add-era">Add an era</button>
            {draft.eras.length > 0
              ? <label>Years before the first era are written with<input value={draft.before} onChange={(e) => set({ before: e.target.value })} data-testid="calendar-before" /></label>
              : <label className="check"><input type="checkbox" checked={!!draft.yearZero} onChange={(e) => set({ yearZero: e.target.checked || undefined })} /> Count through a year zero (…, −1, 0, 1, …)</label>}
            {problems.length > 0 && <ul className="calendar-problems" data-testid="calendar-problems">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            {cal && (
              <p className="muted" data-testid="calendar-preview">
                The date viewed: <b>{cal.format(s.time, 'day')}</b> (Gregorian: {gregorian.format(s.time, 'day')}{cal.weekdays ? `; a ${cal.weekdays[cal.weekdayOf(s.time)!]}` : ''}). Its year 1 began on {gregorian.format(cal.fromCivil({ year: 1 }), 'day')}.
              </p>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={close}>Close</button>
          {own && <button onClick={() => { s.execute((wd) => cmd.setMapCalendar(wd, space.id, null)); close(); }} data-testid="calendar-use-gregorian">Use the Gregorian calendar</button>}
          {draft && <button className="primary" disabled={problems.length > 0} onClick={() => { s.execute((wd) => cmd.setMapCalendar(wd, space.id, draft)); close(); }} data-testid="calendar-use">Use this calendar</button>}
        </div>
    </DialogFrame>
  );
}
