// The inputs shared by every panel (tidy stage, D213): a date as the map being viewed writes it, the date field (typed,
// chosen on a calendar, stepped with the arrow keys; steady while history plays) and the number field that saves on
// Enter or on leaving it, with a button back to its default.
import { useState, useEffect } from 'react';
import { type Instant, type Calendar, gregorian, formatYear, DEEP_BEFORE_YEAR, fromApproxYear } from '../core-time/index.ts';
import { calendarNow } from './calendar-now.ts';
import { CalendarPopover, stepDate } from './components/DatePicker.tsx';
import { ResetButton } from './shell/Reset.tsx';

/** A date as the map being viewed writes it (its own calendar, D149, or the Gregorian). */
export const fmt = (t: Instant, precision: 'year' | 'day' | 'minute' = 'day') => calendarNow().format(t, precision);

/**
 * A date: typed ("14 May 1203", "500 BCE"), chosen on a calendar (the button at its end), or stepped
 * with the arrow keys (a day; Shift: a month; Alt: a year). `suggest`: where an empty field starts
 * (an event's end at its start): shown greyed in it, and where the arrows and the calendar begin. `live`: arrow steps apply at once
 * (the date viewed); otherwise on Enter or on leaving the field, as typing does.
 */
export function DateField({ value, onChange, placeholder, allowEmpty, testId, suggest, live, steady, cal: calendar }: { cal?: Calendar; value: Instant | null; onChange: (t: Instant | null) => void; placeholder?: string; allowEmpty?: boolean; testId?: string; suggest?: Instant | null; live?: boolean; steady?: { yearSizer: string; dayOnly: boolean } }) {
  // (In the calendar of the map being viewed, D149, unless another is given: written, read, stepped and chosen in it.)
  const cal = calendar ?? calendarNow();
  const show = (t: Instant) => cal.format(t, t.ms ? 'minute' : 'day');
  const [text, setText] = useState(value ? show(value) : '');
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  // Shown steady (see SteadyDate) while the field is not being typed in.
  // (Deep time, D134, is written as how long ago: no cells of day, month and year.)
  // (Not tied to the text: that is brought up to date a moment after the date changes, and while history plays the
  // steady cells would give way to the text on every other frame, jumping about.)
  const steadyShown = !!steady && !focused && !bad && !!value && Number.isFinite(value.day) && (cal !== gregorian || gregorian.toCivil(value).year >= DEEP_BEFORE_YEAR);
  useEffect(() => { setText(value ? show(value) : ''); setBad(false); }, [value?.day, value?.ms, cal]);
  const suggested = !value && suggest ? show(suggest) : null;
  const commit = (t = text) => {
    if (!t.trim()) { if (allowEmpty) onChange(null); else setBad(true); return; }
    const p = cal.parse(t);
    if (!p) { setBad(true); return; }
    setBad(false);
    onChange(p.instant);
  };
  const current = (): Instant | null => { const typed = text.trim() ? cal.parse(text)?.instant : undefined; return typed ?? value ?? suggest ?? null; };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { commit(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const t = current();
    if (!t || t.day === -Infinity || t.day === Infinity) return;
    e.preventDefault();
    const next = stepDate(t, e.altKey ? 'year' : e.shiftKey ? 'month' : 'day', e.key === 'ArrowUp' ? 1 : -1, cal);
    setText(show(next));
    setBad(false);
    if (live) onChange(next);
  };
  return (
    <span className="date-field">
      <input
        className={`${bad ? 'date-input bad' : 'date-input'}${steadyShown ? ' steady-under' : ''}`} value={text} placeholder={suggested ?? placeholder ?? (cal === gregorian ? 'e.g. 14 May 1203, 500 BCE, 2241-03-02' : `e.g. ${cal.format(cal.fromCivil({ year: 1, month: 1, day: 1 }), 'day')}`)}
        onChange={(e) => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit(); }} onKeyDown={key}
        title={cal === gregorian ? 'Dates: 14 May 1203 · May 1203 · 1203 · 500 BCE · 2241-03-02T04:05 · c. 3000 BCE. Up and down arrows here: a day (Shift: a month, Alt: a year). Anywhere else, left and right arrows: a day (Ctrl: a week, Ctrl+Shift: a month, Ctrl+Shift+Alt: a year)' : `Dates in the ${cal.name} calendar: ${cal.format(cal.fromCivil({ year: 12, month: 1, day: 3 }), 'day')} · ${cal.format(cal.fromCivil({ year: 12 }), 'month')} · ${cal.yearLabel(12)} · 12-1-3 (its own year, month and day numbers). Up and down arrows here: a day (Shift: a month, Alt: a year). Anywhere else, left and right arrows: a day (Ctrl: a week, Ctrl+Shift: a month, Ctrl+Shift+Alt: a year)`} data-testid={testId}
      />
      {steadyShown && <SteadyDate t={value!} yearSizer={steady!.yearSizer} dayOnly={steady!.dayOnly} />}
      <button type="button" className="date-calendar-button" title="Choose on a calendar" onClick={() => setOpen(!open)} data-testid={testId ? `${testId}-calendar` : undefined} tabIndex={-1}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M1.5 6.5h13M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (() => {
        const start = current();
        const at = start && Number.isFinite(start.day) ? start : gregorian.fromCivil({ year: 1900 });
        return <CalendarPopover cal={cal} value={at} onClose={() => setOpen(false)} onPick={(t) => { setOpen(false); setText(show(t)); setBad(false); onChange(t); }} testId={testId ? `${testId}-popover` : undefined} />;
      })()}
    </span>
  );
}

/**
 * A date that stays still as it changes (history playing, the timeline dragged): the day, the month and
 * the year each in a cell of its own, as wide as the widest it can be (the day's two digits, "September",
 * the longest year of the timeline), with figures all the same width; the day and the year are set to
 * the right of their cells, so their digits never move sideways.
 */
function SteadyDate({ t, yearSizer, dayOnly }: { t: Instant; yearSizer: string; dayOnly: boolean }) {
  const cal = calendarNow();
  const c = cal.toCivil(t);
  // (As wide as its longest month's name.)
  let longest = '';
  for (let m = 1; m <= cal.monthsIn(c.year); m++) { const n = cal.monthName(c.year, m); if (n.length > longest.length) longest = n; }
  const cell = (cls: string, text: string, sizer: string) => <span className={`sd-cell ${cls}`}><span className="sd-text">{text}</span><span className="sd-size">{sizer}</span></span>;
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="steady-date" aria-hidden="true" data-testid="steady-date">
      {cell('sd-day', String(c.day), '00')}
      {cell('sd-month', cal.monthName(c.year, c.month), longest)}
      {cell('sd-year', cal.yearLabel(c.year), yearSizer)}
      {!dayOnly && t.ms ? cell('sd-time', `${two(c.hour)}:${two(c.minute)}`, '00:00') : null}
    </span>
  );
}

/** The widest a year of the timeline can be written (its digits as 0s: all figures are the same width). */
export function yearSizer(startYear: number, endYear: number, cal: Calendar = gregorian): string {
  const label = (y: number) => (cal === gregorian ? formatYear(y) : cal.yearLabel(cal.toCivil(fromApproxYear(y)).year));
  // (Only the years written as dates count: deep time is written as how long ago, never in the steady cells.)
  const lo = Math.max(DEEP_BEFORE_YEAR, Math.min(Math.floor(startYear), 99999)), hi = Math.max(DEEP_BEFORE_YEAR, Math.min(Math.ceil(endYear), 99999));
  const a = label(lo), b = label(hi);
  return (a.length >= b.length ? a : b).replace(/\d/g, '0');
}

/**
 * A number box. Typed numbers are saved when you press Enter or leave it, not on every keystroke; a step with the
 * up and down arrow keys or the box's own arrows, and a drag of the mouse up or down in it (number-scrub.ts, D228),
 * takes effect at once.
 */
export function NumberField({ value, onCommit, min, max, step, testId, title, def }: { value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number; testId?: string; title?: string; def?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (t = text) => {
    const n = Number(t);
    if (!t.trim() || !Number.isFinite(n)) { setText(String(value)); return; }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (c !== value) onCommit(c);
    setText(String(c));
  };
  // (Typing comes as an InputEvent with what was typed; a step of the arrows or a drag comes without one.)
  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value;
    setText(t);
    const ne = e.nativeEvent as Event & { inputType?: string };
    if (!ne.inputType) commit(t);
  };
  const input = <input type="number" value={text} min={min} max={max} step={step} title={title} onChange={change} onBlur={() => commit()} onKeyDown={(e) => e.key === 'Enter' && commit()} data-testid={testId} />;
  // (With a default: a button beside it puts it back, D207.)
  if (def === undefined) return input;
  return <span className="with-reset">{input}<ResetButton def={def} at={value === def} onReset={() => { setText(String(def)); if (value !== def) onCommit(def); }} testId={testId ? `${testId}-reset` : undefined} /></span>;
}
