// Choosing a date on a calendar (fifth feedback round, D80): a month at a time, with arrows for the
// month and the year, a box to jump to any year (BCE too: "500 BCE", "-499"), and the keyboard: arrows
// move a day or a week, Page Up/Down a month, Shift+Page Up/Down a year, Enter takes the day.
import { useEffect, useRef, useState } from 'react';
import { type Instant, gregorian, daysInMonth, formatYear, instant, stepDate, parseYear } from '../../core-time/index.ts';
export { stepDate } from '../../core-time/index.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function CalendarPopover({ value, onPick, onClose, testId }: { value: Instant; onPick: (t: Instant) => void; onClose: () => void; testId?: string }) {
  const [focus, setFocus] = useState<Instant>(value);
  const c = gregorian.toCivil(focus);
  const [yearText, setYearText] = useState(formatYear(c.year));
  useEffect(() => setYearText(formatYear(gregorian.toCivil(focus).year)), [focus.day]);
  const box = useRef<HTMLDivElement | null>(null);
  // Closed by a click elsewhere or by Escape.
  useEffect(() => {
    const down = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement)?.closest?.('.date-calendar-button')) onClose(); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [onClose]);
  useEffect(() => { box.current?.focus(); }, []);
  const chosen = gregorian.toCivil(value);
  const first = gregorian.fromCivil({ year: c.year, month: c.month, day: 1 });
  // Monday first: 1970-01-01 (day 0) was a Thursday.
  const lead = ((first.day % 7) + 7 + 3) % 7;
  const days = daysInMonth(c.year, c.month);
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const pick = (day: number) => onPick(instant(gregorian.fromCivil({ year: c.year, month: c.month, day }).day, value.ms));
  const key = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key;
    let next: Instant | null = null;
    if (k === 'ArrowLeft') next = stepDate(focus, 'day', -1);
    else if (k === 'ArrowRight') next = stepDate(focus, 'day', 1);
    else if (k === 'ArrowUp') next = stepDate(focus, 'day', -7);
    else if (k === 'ArrowDown') next = stepDate(focus, 'day', 7);
    else if (k === 'PageUp') next = stepDate(focus, e.shiftKey ? 'year' : 'month', -1);
    else if (k === 'PageDown') next = stepDate(focus, e.shiftKey ? 'year' : 'month', 1);
    else if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); onPick(instant(focus.day, value.ms)); return; }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (next) { e.preventDefault(); e.stopPropagation(); setFocus(next); }
  };
  const jumpYear = () => {
    const y = parseYear(yearText);
    if (y === null) { setYearText(formatYear(c.year)); return; }
    setFocus(instant(gregorian.fromCivil({ year: y, month: c.month, day: Math.min(c.day, daysInMonth(y, c.month)) }).day, focus.ms));
  };
  return (
    <div className="date-popover" ref={box} tabIndex={-1} onKeyDown={key} data-testid={testId ?? 'date-popover'} onPointerDown={(e) => e.stopPropagation()}>
      <div className="date-popover-head">
        <button className="small" title="A year earlier (Shift+Page Up)" onClick={() => setFocus(stepDate(focus, 'year', -1))} data-testid="cal-year-back">«</button>
        <button className="small" title="A month earlier (Page Up)" onClick={() => setFocus(stepDate(focus, 'month', -1))} data-testid="cal-month-back">‹</button>
        <span className="date-popover-title">
          <select value={c.month} onChange={(e) => setFocus(instant(gregorian.fromCivil({ year: c.year, month: Number(e.target.value), day: Math.min(c.day, daysInMonth(c.year, Number(e.target.value))) }).day, focus.ms))} data-testid="cal-month">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input value={yearText} onChange={(e) => setYearText(e.target.value)} onBlur={jumpYear} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); jumpYear(); } }} title="Any year: 1450, 44 BCE" data-testid="cal-year" />
        </span>
        <button className="small" title="A month later (Page Down)" onClick={() => setFocus(stepDate(focus, 'month', 1))} data-testid="cal-month-forward">›</button>
        <button className="small" title="A year later (Shift+Page Down)" onClick={() => setFocus(stepDate(focus, 'year', 1))} data-testid="cal-year-forward">»</button>
      </div>
      <div className="date-grid">
        {WEEKDAYS.map((d) => <span key={d} className="date-weekday">{d}</span>)}
        {cells.map((d, i) => d === null ? <span key={`x${i}`} /> : (
          <button key={d} className={`date-day ${d === c.day ? 'focus' : ''} ${chosen.year === c.year && chosen.month === c.month && chosen.day === d ? 'on' : ''}`} onClick={() => pick(d)} data-testid={`cal-day-${d}`}>{d}</button>
        ))}
      </div>
      <div className="muted date-popover-hint">Arrows: a day or a week · Page Up/Down: a month (Shift: a year) · Enter: this day</div>
    </div>
  );
}
