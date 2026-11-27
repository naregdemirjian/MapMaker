// Choosing a date on a calendar (fifth feedback round, D80): a month at a time, with arrows for the
// month and the year, a box to jump to any year (BCE too: "500 BCE", "-499"), and the keyboard: arrows
// move a day or a week, Page Up/Down a month, Shift+Page Up/Down a year, Enter takes the day. In the
// calendar of the map being viewed (D149): its months, its week (or rows of seven when it has none).
import { useEffect, useRef, useState } from 'react';
import { type Instant, type Calendar, gregorian, stepDate } from '../../core-time/index.ts';
import { useOverPanels } from '../over-panels.ts';
export { stepDate } from '../../core-time/index.ts';

export function CalendarPopover({ value, onPick, onClose, testId, cal = gregorian }: { value: Instant; onPick: (t: Instant) => void; onClose: () => void; testId?: string; cal?: Calendar }) {
  const [focus, setFocus] = useState<Instant>(value);
  const c = cal.toCivil(focus);
  const [yearText, setYearText] = useState(cal.yearLabel(c.year));
  useEffect(() => setYearText(cal.yearLabel(cal.toCivil(focus).year)), [focus.day, focus.ms]);
  const box = useRef<HTMLDivElement | null>(null);
  // (Over the panels, not cut off by the one it opened in.)
  useOverPanels(box);
  // Closed by a click elsewhere or by Escape.
  useEffect(() => {
    const down = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement)?.closest?.('.date-calendar-button')) onClose(); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [onClose]);
  useEffect(() => { box.current?.focus(); }, []);
  const chosen = cal.toCivil(value);
  const at = (year: number, month: number, day: number) => cal.fromCivil({ year, month, day, hour: c.hour, minute: c.minute, second: c.second, millisecond: c.millisecond });
  // The week: its days across (rows of seven without one), the month's first day under its own.
  const week = cal.weekdays && cal.weekdays.length <= 10 ? cal.weekdays : null;
  const cols = week ? week.length : 7;
  const first = cal.fromCivil({ year: c.year, month: c.month, day: 1 });
  const lead = week ? cal.weekdayOf(first) ?? 0 : 0;
  const days = cal.daysIn(c.year, c.month);
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % cols) cells.push(null);
  const pick = (day: number) => onPick(at(c.year, c.month, day));
  const key = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key;
    let next: Instant | null = null;
    if (k === 'ArrowLeft') next = stepDate(focus, 'day', -1, cal);
    else if (k === 'ArrowRight') next = stepDate(focus, 'day', 1, cal);
    else if (k === 'ArrowUp') next = stepDate(focus, 'day', -cols, cal);
    else if (k === 'ArrowDown') next = stepDate(focus, 'day', cols, cal);
    else if (k === 'PageUp') next = stepDate(focus, e.shiftKey ? 'year' : 'month', -1, cal);
    else if (k === 'PageDown') next = stepDate(focus, e.shiftKey ? 'year' : 'month', 1, cal);
    else if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); onPick(focus); return; }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (next) { e.preventDefault(); e.stopPropagation(); setFocus(next); }
  };
  const jumpYear = () => {
    const y = cal.parseYear(yearText);
    if (y === null) { setYearText(cal.yearLabel(c.year)); return; }
    let month = Math.min(c.month, cal.monthsIn(y));
    while (cal.daysIn(y, month) === 0 && month < cal.monthsIn(y)) month++;
    setFocus(at(y, month, Math.min(c.day, cal.daysIn(y, month))));
  };
  const months = Array.from({ length: cal.monthsIn(c.year) }, (_, i) => i + 1).filter((m) => cal.daysIn(c.year, m) > 0);
  return (
    <div className="date-popover" ref={box} tabIndex={-1} onKeyDown={key} data-testid={testId ?? 'date-popover'} onPointerDown={(e) => e.stopPropagation()}>
      <div className="date-popover-head">
        <button className="small" title="A year earlier (Shift+Page Up)" onClick={() => setFocus(stepDate(focus, 'year', -1, cal))} data-testid="cal-year-back">«</button>
        <button className="small" title="A month earlier (Page Up)" onClick={() => setFocus(stepDate(focus, 'month', -1, cal))} data-testid="cal-month-back">‹</button>
        <span className="date-popover-title">
          <select value={c.month} onChange={(e) => { const m = Number(e.target.value); setFocus(at(c.year, m, Math.min(c.day, cal.daysIn(c.year, m)))); }} data-testid="cal-month">
            {months.map((m) => <option key={m} value={m}>{cal.monthName(c.year, m)}</option>)}
          </select>
          <input value={yearText} onChange={(e) => setYearText(e.target.value)} onBlur={jumpYear} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); jumpYear(); } }} title={cal === gregorian ? 'Any year: 1450, 44 BCE' : `Any year: ${cal.yearLabel(12)}, ${cal.yearLabel(-11)}`} data-testid="cal-year" />
        </span>
        <button className="small" title="A month later (Page Down)" onClick={() => setFocus(stepDate(focus, 'month', 1, cal))} data-testid="cal-month-forward">›</button>
        <button className="small" title="A year later (Shift+Page Down)" onClick={() => setFocus(stepDate(focus, 'year', 1, cal))} data-testid="cal-year-forward">»</button>
      </div>
      <div className="date-grid" style={cols !== 7 ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined}>
        {week && week.map((d, i) => <span key={`${d}${i}`} className="date-weekday" title={d}>{d.slice(0, 2)}</span>)}
        {cells.map((d, i) => d === null ? <span key={`x${i}`} /> : (
          <button key={d} className={`date-day ${d === c.day ? 'focus' : ''} ${chosen.year === c.year && chosen.month === c.month && chosen.day === d ? 'on' : ''}`} onClick={() => pick(d)} data-testid={`cal-day-${d}`}>{d}</button>
        ))}
      </div>
      <div className="muted date-popover-hint">Arrows: a day or a week · Page Up/Down: a month (Shift: a year) · Enter: this day{cal === gregorian ? '' : ` · the ${cal.name} calendar`}</div>
    </div>
  );
}
