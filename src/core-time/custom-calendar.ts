// Calendars of one's own (Stage 13, D149): a world's calendar made from a definition, with its own months, leap
// years, eras (or a year zero), week and day length. Like the Gregorian, it only translates the stored instants
// to and from readable dates; nothing stored changes when a map is given another calendar.
//
// Its years are counted from its first (year 1 begins at its epoch); years before it are 0, -1, -2… inside, and
// are written counted back from its first era ("12 BF") unless the calendar has a year zero. Leap years follow
// a rule like the Gregorian one (every n years, except every m, but every k), counted from an offset. Exact over
// the whole range of instants: a whole cycle of leap years is counted at once.
import { type Instant, MS_PER_DAY, instant, isFiniteInstant } from './instant.ts';
import { type Calendar, type CivilDate, type Precision, daysFromCivil } from './calendar.ts';

export interface CalendarMonth { name: string; short?: string; days: number; leapDays?: number }
/** An era: from the year `start` of the calendar's own count (its year 1), its years counted from 1, written with `abbr`. */
export interface CalendarEra { name: string; abbr: string; start: number; quiet?: boolean }

export interface CalendarDef {
  id: string;
  name: string;
  months: CalendarMonth[];
  /** Leap years: those (counted from `offset`) divisible by `every`, except those divisible by `except` but not by `but`. Null: none. */
  leap: { every: number; offset?: number; except?: number; but?: number } | null;
  /** The day (days since 1 January 1970) whose midnight begins its year 1. */
  epochDay: number;
  /** Hours in its day (default 24): a world turning faster or slower than the Earth. */
  dayHours?: number;
  /** The days of its week (none: no weeks), and which of them its first day is. */
  weekdays?: string[];
  firstWeekday?: number;
  /** The week begins again with each month (a ten-day décade, four weeks to a month), instead of running on. */
  weeksByMonth?: boolean;
  /** Eras, earliest first; years before the first are counted back from it, written with `before`. */
  eras: CalendarEra[];
  before: string;
  /** No eras: years are counted through a year zero (…, -1, 0, 1, …) instead of back from year 1. */
  yearZero?: boolean;
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');
const group = (n: number) => { const s = String(Math.abs(n)); const g = s.length > 5 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s; return n < 0 ? `-${g}` : g; };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** What is wrong with a definition (empty if nothing), in words for the person making it. */
export function calendarProblems(d: CalendarDef): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('The calendar needs a name.');
  if (!d.months.length || d.months.length > 60) out.push('A calendar needs between 1 and 60 months.');
  for (const m of d.months) {
    if (!m.name.trim()) out.push('Every month needs a name.');
    if (!Number.isInteger(m.days) || m.days < 0 || m.days > 1000) out.push(`${m.name || 'A month'}: its days must be a whole number from 0 to 1,000.`);
    if (m.leapDays !== undefined && (!Number.isInteger(m.leapDays) || m.leapDays < 0 || m.leapDays > 100)) out.push(`${m.name || 'A month'}: its extra days in a leap year must be a whole number from 0 to 100.`);
  }
  const base = d.months.reduce((n, m) => n + (m.days || 0), 0);
  if (base < 1 || base > 100_000) out.push('A year must have between 1 and 100,000 days.');
  if (d.leap) {
    const { every, except, but } = d.leap;
    if (!Number.isInteger(every) || every < 1 || every > 10_000) out.push('Leap years: "every" must be a whole number from 1 to 10,000.');
    if (except !== undefined && (!Number.isInteger(except) || except < 1 || except % every)) out.push('Leap years: the exception must be a multiple of the rule.');
    if (but !== undefined && (except === undefined || !Number.isInteger(but) || but < 1 || but % except)) out.push('Leap years: the exception to the exception must be a multiple of the exception.');
    if (!d.months.some((m) => (m.leapDays ?? 0) > 0)) out.push('Leap years need at least one month with extra days in them.');
  }
  if (!Number.isSafeInteger(d.epochDay)) out.push('The first day of year 1 is not a date.');
  if (d.dayHours !== undefined && !(d.dayHours >= 1 && d.dayHours <= 1000)) out.push('A day must last between 1 and 1,000 hours.');
  if (d.weekdays && d.weekdays.length > 60) out.push('A week of at most 60 days.');
  for (const e of d.eras) {
    if (!e.name.trim() || !e.abbr.trim()) out.push('Every era needs a name and an abbreviation.');
    if (!Number.isSafeInteger(e.start)) out.push(`${e.name || 'An era'}: its first year must be a whole number.`);
  }
  for (let i = 1; i < d.eras.length; i++) if (d.eras[i].start <= d.eras[i - 1].start) out.push('Eras must follow one another, each beginning after the one before.');
  return out;
}

class DefinedCalendar implements Calendar {
  readonly id: string;
  readonly name: string;
  readonly weekdays: string[] | null;
  readonly hoursPerDay: number;
  private readonly def: CalendarDef;
  /** Days in a common year, and extra days in a leap year. */
  private readonly base: number;
  private readonly extra: number;
  /** Years in a whole cycle of leap years, days in it, and days before each year of it. */
  private readonly C: number;
  private readonly D: number;
  private readonly before: Float64Array;
  private readonly dayMs: number;
  private readonly epochMs: bigint;

  constructor(def: CalendarDef) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.weekdays = def.weekdays?.length ? def.weekdays : null;
    this.hoursPerDay = def.dayHours ?? 24;
    this.base = def.months.reduce((n, m) => n + m.days, 0);
    this.extra = def.months.reduce((n, m) => n + (m.leapDays ?? 0), 0);
    const L = def.leap;
    this.C = !L ? 1 : [L.every, L.except, L.but].filter((x): x is number => !!x).reduce(lcm, 1);
    this.before = new Float64Array(this.C + 1);
    for (let j = 0; j < this.C; j++) this.before[j + 1] = this.before[j] + this.base + (this.isLeap(j + 1) ? this.extra : 0);
    this.D = this.before[this.C];
    this.dayMs = Math.round(this.hoursPerDay * 3_600_000);
    this.epochMs = BigInt(def.epochDay) * BigInt(MS_PER_DAY);
  }

  isLeap(year: number): boolean {
    const L = this.def.leap;
    if (!L) return false;
    const y = year - (L.offset ?? 0);
    if (mod(y, L.every)) return false;
    if (L.except && !mod(y, L.except)) return !!L.but && !mod(y, L.but);
    return true;
  }

  monthsIn(): number { return this.def.months.length; }
  daysIn(year: number, month: number): number {
    const m = this.def.months[month - 1];
    return m ? m.days + (this.isLeap(year) ? m.leapDays ?? 0 : 0) : 0;
  }
  monthName(_year: number, month: number, short = false): string {
    const m = this.def.months[month - 1];
    if (!m) return '';
    return short ? m.short?.trim() || m.name.slice(0, 3) : m.name;
  }

  /** The calendar day an instant falls on (days since its epoch) and the milliseconds into it. */
  private split(t: Instant): { d: number; ms: number } {
    if (this.dayMs === MS_PER_DAY) return { d: t.day - this.def.epochDay, ms: t.ms };
    const L = BigInt(this.dayMs);
    const total = BigInt(t.day) * BigInt(MS_PER_DAY) + BigInt(t.ms) - this.epochMs;
    let q = total / L, r = total % L;
    if (r < 0n) { r += L; q -= 1n; }
    return { d: Number(q), ms: Number(r) };
  }
  private join(d: number, ms: number): Instant {
    if (this.dayMs === MS_PER_DAY) return instant(this.def.epochDay + d, ms);
    const M = BigInt(MS_PER_DAY);
    const total = BigInt(d) * BigInt(this.dayMs) + BigInt(ms) + this.epochMs;
    let q = total / M, r = total % M;
    if (r < 0n) { r += M; q -= 1n; }
    return instant(Number(q), Number(r));
  }
  /** The day its year begins on (days since its epoch). */
  private yearStart(year: number): number {
    const k = Math.floor((year - 1) / this.C), j = year - 1 - k * this.C;
    return k * this.D + this.before[j];
  }

  toCivil(t: Instant): CivilDate {
    if (!isFiniteInstant(t)) throw new RangeError('Cannot convert an infinite instant to a date');
    const { d, ms } = this.split(t);
    const k = Math.floor(d / this.D), r = d - k * this.D;
    let lo = 0, hi = this.C;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.before[mid] <= r) lo = mid; else hi = mid; }
    const year = k * this.C + lo + 1;
    let doy = r - this.before[lo], month = 1;
    for (; month <= this.def.months.length; month++) {
      const n = this.daysIn(year, month);
      if (doy < n) break;
      doy -= n;
    }
    let rest = ms;
    const hour = Math.floor(rest / 3_600_000); rest -= hour * 3_600_000;
    const minute = Math.floor(rest / 60_000); rest -= minute * 60_000;
    const second = Math.floor(rest / 1000); rest -= second * 1000;
    return { year, month, day: doy + 1, hour, minute, second, millisecond: rest };
  }

  fromCivil(c: Partial<CivilDate> & { year: number }): Instant {
    if (!Number.isSafeInteger(c.year)) throw new RangeError(`Year out of range: ${c.year}`);
    let month = c.month ?? 1;
    // (A date given by its year alone begins with the first month that has days that year.)
    if (c.month === undefined) while (month < this.def.months.length && this.daysIn(c.year, month) === 0) month++;
    const day = c.day ?? 1;
    if (month < 1 || month > this.def.months.length) throw new RangeError(`Month out of range: ${month}`);
    if (day < 1 || day > this.daysIn(c.year, month)) throw new RangeError(`Day out of range: ${day}`);
    const ms = ((c.hour ?? 0) * 3600 + (c.minute ?? 0) * 60 + (c.second ?? 0)) * 1000 + (c.millisecond ?? 0);
    if (ms < 0 || ms >= this.dayMs) throw new RangeError('Time of day out of range');
    let d = this.yearStart(c.year);
    for (let m = 1; m < month; m++) d += this.daysIn(c.year, m);
    return this.join(d + day - 1, ms);
  }

  addDays(t: Instant, n: number): Instant {
    if (!isFiniteInstant(t)) return t;
    const { d, ms } = this.split(t);
    return this.join(d + n, ms);
  }

  weekdayOf(t: Instant): number | null {
    if (!this.weekdays || !isFiniteInstant(t)) return null;
    if (this.def.weeksByMonth) return mod(this.toCivil(t).day - 1 + (this.def.firstWeekday ?? 0), this.weekdays.length);
    return mod(this.split(t).d + (this.def.firstWeekday ?? 0), this.weekdays.length);
  }

  yearLabel(year: number): string {
    const eras = this.def.eras;
    if (!eras.length) return this.def.yearZero || year >= 1 ? group(year) : `${group(1 - year)} ${this.def.before || 'before year 1'}`.trim();
    let era: CalendarEra | null = null;
    for (const e of eras) if (e.start <= year) era = e;
    if (!era) return `${group(eras[0].start - year)} ${this.def.before}`.trim();
    const n = year - era.start + 1;
    return era.quiet ? group(n) : `${group(n)} ${era.abbr}`;
  }

  /** An era (or the years before them all) named by its abbreviation or name; null if none is. */
  private eraNamed(label: string): { start: number; back: boolean } | null {
    const l = label.trim().toLowerCase().replace(/\./g, '');
    if (!l) return null;
    const same = (x: string) => x.trim().toLowerCase().replace(/\./g, '') === l;
    for (const e of this.def.eras) if (same(e.abbr) || same(e.name)) return { start: e.start, back: false };
    if (this.def.before && same(this.def.before)) return { start: this.def.eras[0]?.start ?? 1, back: true };
    return null;
  }

  parseYear(text: string): number | null {
    const m = /^\s*(?:(\D+?)\s+)?([+-]?\d[\d,]*)(?:\s+(\D.*?))?\s*$/.exec(text);
    if (!m || (m[1] && m[3])) return null;
    const n = Number(m[2].replace(/,/g, ''));
    if (!Number.isSafeInteger(n)) return null;
    const label = m[1] ?? m[3];
    if (!label) {
      // (A year alone: the first era's count, or the calendar's own.)
      if (n <= 0 && !this.def.yearZero && !this.def.eras.length) return n;
      return this.def.eras.length ? this.def.eras[0].start + n - 1 : n;
    }
    const era = this.eraNamed(label);
    if (!era || n < 1) return null;
    return era.back ? era.start - n : era.start + n - 1;
  }

  format(t: Instant, precision: Precision = 'minute'): string {
    if (t.day === -Infinity) return 'the beginning of time';
    if (t.day === Infinity) return 'the end of time';
    const c = this.toCivil(t);
    const y = this.yearLabel(c.year), mn = this.monthName(c.year, c.month);
    switch (precision) {
      case 'millennium': return `${y} (millennium)`;
      case 'century':
      case 'decade':
      case 'year': return y;
      case 'circa': return `c. ${y}`;
      case 'month': return `${mn} ${y}`;
      case 'day': return `${c.day} ${mn} ${y}`;
      case 'hour':
      case 'minute': return `${c.day} ${mn} ${y}, ${pad(c.hour)}:${pad(c.minute)}`;
      case 'second': return `${c.day} ${mn} ${y}, ${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`;
      default: return `${c.day} ${mn} ${y}, ${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}.${pad(c.millisecond, 3)}`;
    }
  }

  parse(text: string): { instant: Instant; precision: Precision } | null {
    let s = text.trim().replace(/\s+/g, ' ');
    let circa = false;
    const cm = /^(c\.|ca\.|circa|about)\s*/i.exec(s);
    if (cm) { circa = true; s = s.slice(cm[0].length); }
    try {
      // Year-month-day (the calendar's own numbers), a time perhaps, an era perhaps: "1203-3-14 06:30 AF".
      const iso = /^([+-]?\d[\d,]*)-(\d{1,3})(?:-(\d{1,4}))?(?:[T ](\d{1,4}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:\s+(\D.*))?$/.exec(s);
      if (iso) {
        const year = this.parseYear(`${iso[1]}${iso[8] ? ` ${iso[8]}` : ''}`);
        if (year === null) return null;
        const t = this.fromCivil({ year, month: Number(iso[2]), day: iso[3] ? Number(iso[3]) : undefined, hour: iso[4] ? Number(iso[4]) : 0, minute: iso[5] ? Number(iso[5]) : 0, second: iso[6] ? Number(iso[6]) : 0, millisecond: iso[7] ? Number(iso[7].padEnd(3, '0')) : 0 });
        return { instant: t, precision: circa ? 'circa' : iso[7] ? 'millisecond' : iso[6] ? 'second' : iso[4] ? 'minute' : iso[3] ? 'day' : 'month' };
      }
      // "14 Frostmoon 1203 AF[, 06:30]", "Frostmoon 1203": a day perhaps, a month by its name (or the start of
      // it), a year with its era perhaps, a time perhaps.
      const dm = /^(\d{1,4}) (.*)$/.exec(s);
      const day = dm ? Number(dm[1]) : undefined;
      const rest = dm ? dm[2] : s;
      const lower = rest.toLowerCase();
      let best: { month: number; len: number } | null = null;
      this.def.months.forEach((m, i) => {
        for (const n of [m.name, m.short ?? '']) {
          const name = n.trim().toLowerCase();
          if (name && lower.startsWith(`${name} `) && (!best || name.length > best.len)) best = { month: i + 1, len: name.length };
        }
      });
      if (!best && rest.length >= 4) {
        // (Or the start of a month's name, three letters at least.)
        const word = /^(\S{3,})\s/.exec(lower);
        if (word) this.def.months.forEach((m, i) => { if (!best && m.name.toLowerCase().startsWith(word[1].replace(/\.$/, ''))) best = { month: i + 1, len: word[1].length }; });
      }
      if (best) {
        const { month, len } = best as { month: number; len: number };
        const after = rest.slice(len).trim();
        const tm = /^(.*?)(?:,? (\d{1,4}):(\d{2})(?::(\d{2}))?)?$/.exec(after)!;
        const year = this.parseYear(tm[1]);
        if (year === null) return null;
        const t = this.fromCivil({ year, month, day, hour: tm[2] ? Number(tm[2]) : 0, minute: tm[3] ? Number(tm[3]) : 0, second: tm[4] ? Number(tm[4]) : 0 });
        return { instant: t, precision: circa ? 'circa' : tm[4] ? 'second' : tm[2] ? 'minute' : day ? 'day' : 'month' };
      }
      // A year on its own (a number first was not a day after all).
      const year = this.parseYear(s);
      if (year === null) return null;
      return { instant: this.fromCivil({ year }), precision: circa ? 'circa' : 'year' };
    } catch {
      return null;
    }
  }
}

const made = new Map<string, Calendar>();
/** The calendar of a definition (made once for each definition). */
export function calendarOf(def: CalendarDef): Calendar {
  const key = JSON.stringify(def);
  let c = made.get(key);
  if (!c) { c = new DefinedCalendar(def); made.set(key, c); if (made.size > 64) made.delete(made.keys().next().value!); }
  return c;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Calendars to start from (each can be changed in every part). */
export const CALENDAR_TEMPLATES: Array<{ id: string; note: string; def: CalendarDef }> = [
  {
    id: 'julian',
    note: 'The calendar of Rome and of Europe until 1582 (Britain until 1752, Russia until 1918): a leap year every four years.',
    def: {
      id: 'julian', name: 'Julian',
      months: MONTHS.map((name, i) => ({ name, days: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i], ...(i === 1 ? { leapDays: 1 } : {}) })),
      leap: { every: 4 },
      // 1 January AD 1 (Julian) was 30 December 1 BC (proleptic Gregorian).
      epochDay: daysFromCivil(0, 12, 30),
      weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], firstWeekday: 5,
      eras: [{ name: 'Anno Domini', abbr: 'AD', start: 1, quiet: true }], before: 'BC',
    },
  },
  {
    id: 'republican',
    note: 'The French Republican calendar (from 22 September 1792): twelve months of thirty days and five or six festival days.',
    def: {
      id: 'republican', name: 'French Republican',
      months: [...['Vendémiaire', 'Brumaire', 'Frimaire', 'Nivôse', 'Pluviôse', 'Ventôse', 'Germinal', 'Floréal', 'Prairial', 'Messidor', 'Thermidor', 'Fructidor'].map((name) => ({ name, days: 30 })), { name: 'Sansculottides', short: 'San', days: 5, leapDays: 1 }],
      // (Leap years III, VII and XI as kept; every fourth after them.)
      leap: { every: 4, offset: 3 },
      epochDay: daysFromCivil(1792, 9, 22),
      weekdays: ['Primidi', 'Duodi', 'Tridi', 'Quartidi', 'Quintidi', 'Sextidi', 'Septidi', 'Octidi', 'Nonidi', 'Décadi'], weeksByMonth: true,
      eras: [{ name: 'Year of the Republic', abbr: 'of the Republic', start: 1 }], before: 'before the Republic',
    },
  },
  {
    id: 'fixed',
    note: 'Thirteen months of four weeks each, a year day at the end and a leap day after June: every date on the same day of the week every year.',
    def: {
      id: 'fixed', name: 'Thirteen months',
      months: [...MONTHS.slice(0, 6).map((name) => ({ name, days: 28 })), { name: 'Leap Day', short: 'Leap', days: 0, leapDays: 1 }, { name: 'Sol', days: 28 }, ...MONTHS.slice(6).map((name) => ({ name, days: 28 })), { name: 'Year Day', short: 'Year', days: 1 }],
      leap: { every: 4, except: 100, but: 400 },
      epochDay: daysFromCivil(1, 1, 1),
      weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], weeksByMonth: true,
      eras: [{ name: 'Common Era', abbr: 'CE', start: 1, quiet: true }], before: 'BCE',
    },
  },
  {
    id: 'world',
    note: 'A world of your own: ten months of 36 days, a festival at the year\'s turn, a leap day every fourth year, an era from its founding. Change any part.',
    def: {
      id: 'world', name: 'Calendar of the Founding',
      months: [...['Firstmonth', 'Rainmoon', 'Seedtime', 'Greening', 'Highsun', 'Harvest', 'Fallow', 'Frostmoon', 'Deepwinter', 'Lastmonth'].map((name) => ({ name, days: 36 })), { name: 'Turning', days: 5, leapDays: 1 }],
      leap: { every: 4 },
      epochDay: daysFromCivil(1000, 1, 1),
      weekdays: ['Sunday', 'Moonday', 'Starday', 'Fireday', 'Waterday', 'Earthday'],
      eras: [{ name: 'After the Founding', abbr: 'AF', start: 1 }], before: 'BF',
    },
  },
];
