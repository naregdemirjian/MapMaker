// Calendars translate instants to and from human dates. The Gregorian calendar comes first
// (proleptic, astronomical year numbering internally: year 0 = 1 BCE). Fictional calendars
// (custom-calendar.ts, D149) implement the same Calendar interface; the stored instants never change.
import { type Instant, MS_PER_DAY, instant, isFiniteInstant, add } from './instant.ts';

export type Precision = 'exact' | 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year' | 'decade' | 'century' | 'millennium' | 'circa';

export interface CivilDate {
  year: number; // astronomical: 0 = 1 BCE, -1 = 2 BCE (a fictional calendar: its own count, year 1 the first)
  month: number; // 1-12 (a fictional calendar: 1 to its months)
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export interface Calendar {
  readonly id: string;
  readonly name: string;
  toCivil(t: Instant): CivilDate;
  fromCivil(c: Partial<CivilDate> & { year: number }): Instant;
  format(t: Instant, precision?: Precision): string;
  parse(text: string): { instant: Instant; precision: Precision } | null;
  /** How many months its years have (a month may have no days in a common year: a leap month). */
  monthsIn(year: number): number;
  /** The days of a month of a year (0: the month is there in leap years only). */
  daysIn(year: number, month: number): number;
  /** A month's name (short: for tight places). */
  monthName(year: number, month: number, short?: boolean): string;
  /** A year as it is written: "1203", "500 BCE", "345 TA". */
  yearLabel(year: number): string;
  /** A year typed on its own ("1450", "44 BC", "345 TA"); null if it is not one. */
  parseYear(text: string): number | null;
  /** The days of its week, first first (null: it has no weeks), and which of them a day is. */
  readonly weekdays: string[] | null;
  weekdayOf(t: Instant): number | null;
  /** Hours in its day (24 but for a world whose day is longer or shorter). */
  readonly hoursPerDay: number;
  /** An instant some of its days later (or earlier). */
  addDays(t: Instant, n: number): Instant;
}

const fdiv = (a: number, b: number) => Math.floor(a / b);

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm; valid over the whole safe-integer range). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = fdiv(y, 400);
  const yoe = y - era * 400;
  const doy = fdiv(153 * (month + (month > 2 ? -3 : 9)) + 2, 5) + day - 1;
  const doe = yoe * 365 + fdiv(yoe, 4) - fdiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = fdiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = fdiv(doe - fdiv(doe, 1460) + fdiv(doe, 36524) - fdiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + fdiv(yoe, 4) - fdiv(yoe, 100));
  const mp = fdiv(5 * doy + 2, 153);
  const d = doy - fdiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (m <= 2 ? 1 : 0), month: m, day: d };
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

/** A year's digits, grouped by thousands from five digits on ("1453", "12,026", "5,000,000"). */
function groupDigits(n: number): string {
  const s = String(n);
  return s.length > 4 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
}

/** Years before this (astronomical) year are written as how long ago they were (D134): before 10,000 BCE. */
export const DEEP_BEFORE_YEAR = -9999;
/** Ages are counted back from the start of this year. */
export const PRESENT_YEAR = 2000;

/** How long ago, written out (D134): "21,000 years ago", "2.58 million years ago", "250 million years ago". */
export function formatYearsAgo(years: number): string {
  if (years >= 1e6) {
    const m = years / 1e6, v = m >= 10 ? Math.round(m * 10) / 10 : Math.round(m * 100) / 100;
    return `${v.toLocaleString('en-GB', { maximumFractionDigits: 2 })} million years ago`;
  }
  return `${Math.round(years).toLocaleString('en-GB')} years ago`;
}

/** Year label for display: "1203", "500 BCE", "1 BCE" (= astronomical year 0); before 10,000 BCE how long ago ("21,000 years ago"). */
export function formatYear(year: number): string {
  if (year < DEEP_BEFORE_YEAR) return formatYearsAgo(PRESENT_YEAR - year);
  return year <= 0 ? `${groupDigits(1 - year)} BCE` : groupDigits(year);
}

export const gregorian: Calendar = {
  id: 'gregorian',
  name: 'Gregorian',
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  hoursPerDay: 24,
  monthsIn: () => 12,
  daysIn: (y, m) => daysInMonth(y, m),
  monthName: (_y, m, short) => (short ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]),
  yearLabel: (y) => formatYear(y),
  parseYear: (text) => parseGregorianYear(text),
  // (1 January 1970, day 0, was a Thursday: the fourth day of a week from Monday.)
  weekdayOf: (t) => (isFiniteInstant(t) ? ((t.day % 7) + 7 + 3) % 7 : null),
  addDays: (t, n) => add(t, n),

  toCivil(t) {
    if (!isFiniteInstant(t)) throw new RangeError('Cannot convert an infinite instant to a date');
    const { year, month, day } = civilFromDays(t.day);
    let ms = t.ms;
    const hour = Math.floor(ms / 3_600_000); ms -= hour * 3_600_000;
    const minute = Math.floor(ms / 60_000); ms -= minute * 60_000;
    const second = Math.floor(ms / 1000); ms -= second * 1000;
    return { year, month, day, hour, minute, second, millisecond: ms };
  },

  fromCivil(c) {
    const month = c.month ?? 1;
    const day = c.day ?? 1;
    if (month < 1 || month > 12) throw new RangeError(`Month out of range: ${month}`);
    if (day < 1 || day > daysInMonth(c.year, month)) throw new RangeError(`Day out of range: ${day}`);
    const ms = ((c.hour ?? 0) * 3600 + (c.minute ?? 0) * 60 + (c.second ?? 0)) * 1000 + (c.millisecond ?? 0);
    if (ms < 0 || ms >= MS_PER_DAY) throw new RangeError('Time of day out of range');
    return instant(daysFromCivil(c.year, month, day), ms);
  },

  format(t, precision = 'minute') {
    if (t.day === -Infinity) return 'the beginning of time';
    if (t.day === Infinity) return 'the end of time';
    const c = this.toCivil(t);
    const y = formatYear(c.year);
    // (Deep time, D134: no days or months, only how long ago.)
    if (c.year < DEEP_BEFORE_YEAR) return precision === 'circa' ? `c. ${y}` : y;
    switch (precision) {
      case 'millennium': return `${formatYear(c.year)} (millennium)`;
      case 'century':
      case 'decade':
      case 'year': return y;
      case 'circa': return `c. ${y}`;
      case 'month': return `${MONTHS[c.month - 1]} ${y}`;
      case 'day': return `${c.day} ${MONTHS[c.month - 1]} ${y}`;
      case 'hour':
      case 'minute': return `${c.day} ${MONTHS[c.month - 1]} ${y}, ${pad(c.hour)}:${pad(c.minute)}`;
      case 'second': return `${c.day} ${MONTHS[c.month - 1]} ${y}, ${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`;
      default: return `${c.day} ${MONTHS[c.month - 1]} ${y}, ${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}.${pad(c.millisecond, 3)}`;
    }
  },

  parse(text) {
    let s = text.trim().replace(/\s+/g, ' ');
    let circa = false;
    const circaMatch = /^(c\.|ca\.|circa|about)\s*/i.exec(s);
    if (circaMatch) { circa = true; s = s.slice(circaMatch[0].length); }
    // How long ago (D134): "250 million years ago", "250 Ma", "2.6 mya", "21 ka", "21,000 years ago".
    const ago = /^([\d][\d,]*(?:\.\d+)?)\s*(million years ago|million years|m\.?y\.?a\.?|ma|thousand years ago|ka|kya|years ago|yrs ago|years bp|bp)$/i.exec(s);
    if (ago) {
      const n = Number(ago[1].replace(/,/g, '')), unit = ago[2].toLowerCase();
      const years = Math.round(n * (/^(million|m\.?y|ma)/.test(unit) ? 1e6 : /^(thousand|ka|kya)/.test(unit) ? 1e3 : 1));
      if (!Number.isFinite(years) || years < 0 || years > 1e12) return null;
      return { instant: this.fromCivil({ year: PRESENT_YEAR - years }), precision: circa ? 'circa' : 'year' };
    }
    let era: 'BCE' | 'CE' | null = null;
    const eraMatch = /\s*\b(BCE|BC|B\.C\.|CE|AD|A\.D\.)$/i.exec(s);
    if (eraMatch) { era = /^B/i.test(eraMatch[1]) ? 'BCE' : 'CE'; s = s.slice(0, eraMatch.index).trim(); }
    if (/^(AD|A\.D\.) /i.test(s)) { era = 'CE'; s = s.replace(/^(AD|A\.D\.) /i, ''); }
    const toAstro = (y: number) => (era === 'BCE' ? 1 - y : y);

    try {
      // ISO-like: [-]YYYY[-MM[-DD]][(T| )HH:MM[:SS[.mmm]]]
      const iso = /^([+-]?\d[\d,]*)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(s);
      if (iso) {
        const year = toAstro(Number(iso[1].replace(/,/g, '')));
        if (era === 'BCE' && Number(iso[1].replace(/,/g, '')) < 1) return null;
        const month = iso[2] ? Number(iso[2]) : undefined;
        const day = iso[3] ? Number(iso[3]) : undefined;
        const t = this.fromCivil({
          year, month, day,
          hour: iso[4] ? Number(iso[4]) : 0, minute: iso[5] ? Number(iso[5]) : 0,
          second: iso[6] ? Number(iso[6]) : 0, millisecond: iso[7] ? Number(iso[7].padEnd(3, '0')) : 0,
        });
        const precision: Precision = circa ? 'circa' : iso[7] ? 'millisecond' : iso[6] ? 'second' : iso[4] ? 'minute' : day ? 'day' : month ? 'month' : 'year';
        return { instant: t, precision };
      }
      // "14 May 1203[, 06:00]" or "May 1203"
      const named = /^(?:(\d{1,2}) )?([A-Za-z]+)\.? ([+-]?\d[\d,]*)(?:,? (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
      if (named) {
        const mi = MONTHS.findIndex((m) => m.toLowerCase().startsWith(named[2].toLowerCase().slice(0, 3)));
        if (mi < 0 || named[2].length < 3) return null;
        const year = toAstro(Number(named[3].replace(/,/g, '')));
        const day = named[1] ? Number(named[1]) : undefined;
        const t = this.fromCivil({ year, month: mi + 1, day, hour: named[4] ? Number(named[4]) : 0, minute: named[5] ? Number(named[5]) : 0, second: named[6] ? Number(named[6]) : 0 });
        const precision: Precision = circa ? 'circa' : named[6] ? 'second' : named[4] ? 'minute' : day ? 'day' : 'month';
        return { instant: t, precision };
      }
    } catch {
      return null;
    }
    return null;
  },
};

/** The year typed in a date's calendar: 1450, -44 (astronomical), 44 BCE / 44 BC, AD 900. */
export function parseGregorianYear(text: string): number | null {
  const m = /^\s*(?:(?:AD|CE)\s*)?(-?\d+)\s*(BCE|BC|AD|CE)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  // (1 BCE is the year 0, 44 BCE the year -43.)
  return m[2] && /^BC/i.test(m[2]) ? 1 - Math.abs(n) : n;
}

/** Round an instant down to a calendar unit; used for timeline tick generation. */
export function floorTo(t: Instant, unit: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', stepYears = 1, cal: Calendar = gregorian): Instant {
  const c = cal.toCivil(t);
  switch (unit) {
    case 'year': return cal.fromCivil({ year: Math.floor(c.year / stepYears) * stepYears });
    case 'month': return cal.fromCivil({ year: c.year, month: c.month });
    case 'day': return cal === gregorian ? instant(t.day, 0) : cal.fromCivil({ year: c.year, month: c.month, day: c.day });
    case 'hour': return cal.fromCivil({ year: c.year, month: c.month, day: c.day, hour: c.hour });
    case 'minute': return cal.fromCivil({ year: c.year, month: c.month, day: c.day, hour: c.hour, minute: c.minute });
    default: return cal.fromCivil({ year: c.year, month: c.month, day: c.day, hour: c.hour, minute: c.minute, second: c.second });
  }
}
