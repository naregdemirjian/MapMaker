// Stepping dates by calendar units and reading a year typed on its own (the date fields' arrows and
// calendar, D80).
import { type Instant, add, instant } from './instant.ts';
import { gregorian, daysInMonth, parseGregorianYear, type Calendar } from './calendar.ts';

/**
 * A date moved by whole days, months or years in a calendar (a month later than 31 January is the end of
 * February; months with no days that year are passed over), its time of day kept.
 */
export function stepDate(t: Instant, unit: 'day' | 'month' | 'year', n: number, cal: Calendar = gregorian): Instant {
  if (cal === gregorian) {
    if (unit === 'day') return add(t, n);
    const c = gregorian.toCivil(t);
    const total = c.year * 12 + (c.month - 1) + (unit === 'year' ? 12 * n : n);
    const year = Math.floor(total / 12), month = total - year * 12 + 1;
    return instant(gregorian.fromCivil({ year, month, day: Math.min(c.day, daysInMonth(year, month)) }).day, t.ms);
  }
  if (unit === 'day') return cal.addDays(t, n);
  const c = cal.toCivil(t);
  let year = c.year, month = c.month;
  if (unit === 'year') year += n;
  else {
    // (Month by month, passing over months with no days that year.)
    const dir = Math.sign(n);
    for (let k = 0; k < Math.abs(n); k++) {
      do {
        month += dir;
        if (month > cal.monthsIn(year)) { year++; month = 1; }
        if (month < 1) { year--; month = cal.monthsIn(year); }
      } while (cal.daysIn(year, month) === 0);
    }
  }
  while (cal.daysIn(year, month) === 0) month = month < cal.monthsIn(year) ? month + 1 : 1;
  return cal.fromCivil({ year, month, day: Math.min(c.day, cal.daysIn(year, month)), hour: c.hour, minute: c.minute, second: c.second, millisecond: c.millisecond });
}

/** The year typed in the calendar's box: 1450, -44 (astronomical), 44 BCE / 44 BC, AD 900. */
export const parseYear = (text: string): number | null => parseGregorianYear(text);

/** The date a step of the arrow keys away (D172): a day; with Ctrl (or Cmd), a week; with Shift too, a month; with Alt too, a year. */
export function arrowStep(t: Instant, dir: 1 | -1, k: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, cal: Calendar = gregorian): Instant {
  const ctrl = k.ctrlKey || k.metaKey;
  if (ctrl && k.shiftKey && k.altKey) return stepDate(t, 'year', dir, cal);
  if (ctrl && k.shiftKey) return stepDate(t, 'month', dir, cal);
  if (ctrl) return stepDate(t, 'day', dir * (cal.weekdays?.length || 7), cal);
  return stepDate(t, 'day', dir, cal);
}
