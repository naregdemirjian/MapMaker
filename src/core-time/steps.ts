// Stepping dates by calendar units and reading a year typed on its own (the date fields' arrows and
// calendar, D80).
import { type Instant, add, instant } from './instant.ts';
import { gregorian, daysInMonth } from './calendar.ts';

/** A date moved by whole days, months or years (a month later than 31 January is the end of February). */
export function stepDate(t: Instant, unit: 'day' | 'month' | 'year', n: number): Instant {
  if (unit === 'day') return add(t, n);
  const c = gregorian.toCivil(t);
  const total = c.year * 12 + (c.month - 1) + (unit === 'year' ? 12 * n : n);
  const year = Math.floor(total / 12), month = total - year * 12 + 1;
  return instant(gregorian.fromCivil({ year, month, day: Math.min(c.day, daysInMonth(year, month)) }).day, t.ms);
}

/** The year typed in the calendar's box: 1450, -44 (astronomical), 44 BCE / 44 BC, AD 900. */
export function parseYear(text: string): number | null {
  const m = /^\s*(?:(?:AD|CE)\s*)?(-?\d+)\s*(BCE|BC|AD|CE)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  // (1 BCE is the year 0, 44 BCE the year -43.)
  return m[2] && /^BC/i.test(m[2]) ? 1 - Math.abs(n) : n;
}

