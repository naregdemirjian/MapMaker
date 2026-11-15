// One absolute time axis for the whole universe.
// An Instant is a whole number of days from 1 January 1970 (proleptic Gregorian, negative = earlier)
// plus milliseconds into that day. Both are exact integers, so arithmetic stays exact at any distance:
// safe-integer days cover roughly ±24 trillion years at millisecond precision.
// Days are a uniform 86,400 seconds (no leap seconds). ±Infinity days mean "forever".

export const MS_PER_DAY = 86_400_000;

export interface Instant {
  readonly day: number;
  readonly ms: number;
}

export const NEG_INF: Instant = Object.freeze({ day: -Infinity, ms: 0 });
export const POS_INF: Instant = Object.freeze({ day: Infinity, ms: 0 });

/** Build a normalised instant: ms is carried into days so that 0 <= ms < MS_PER_DAY. */
export function instant(day: number, ms = 0): Instant {
  if (day === Infinity || day === -Infinity) return day > 0 ? POS_INF : NEG_INF;
  if (!Number.isFinite(day) || !Number.isFinite(ms)) throw new RangeError(`Invalid instant ${day}/${ms}`);
  if (!Number.isInteger(day) || !Number.isInteger(ms)) throw new RangeError(`Instant parts must be integers: ${day}/${ms}`);
  let d = day;
  let m = ms;
  if (m < 0 || m >= MS_PER_DAY) {
    const carry = Math.floor(m / MS_PER_DAY);
    d += carry;
    m -= carry * MS_PER_DAY;
  }
  if (!Number.isSafeInteger(d)) throw new RangeError('Instant is outside the supported range');
  return { day: d, ms: m };
}

export function isFiniteInstant(a: Instant): boolean {
  return Number.isFinite(a.day);
}

export function compare(a: Instant, b: Instant): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  return 0;
}

export const equals = (a: Instant, b: Instant) => compare(a, b) === 0;
export const before = (a: Instant, b: Instant) => compare(a, b) < 0;
export const after = (a: Instant, b: Instant) => compare(a, b) > 0;
export const atOrBefore = (a: Instant, b: Instant) => compare(a, b) <= 0;
export const min = (a: Instant, b: Instant) => (compare(a, b) <= 0 ? a : b);
export const max = (a: Instant, b: Instant) => (compare(a, b) >= 0 ? a : b);

/** Add whole days and milliseconds exactly. */
export function add(a: Instant, days: number, ms = 0): Instant {
  if (!isFiniteInstant(a)) return a;
  return instant(a.day + days, a.ms + ms);
}

export function addMs(a: Instant, ms: number): Instant {
  if (!isFiniteInstant(a)) return a;
  const whole = Math.trunc(ms);
  const days = Math.trunc(whole / MS_PER_DAY);
  return instant(a.day + days, a.ms + (whole - days * MS_PER_DAY));
}

/** Exact difference b - a as {days, ms} with 0 <= ms < MS_PER_DAY. */
export function diff(a: Instant, b: Instant): { days: number; ms: number } {
  const n = instant(b.day - a.day, b.ms - a.ms);
  return { days: n.day, ms: n.ms };
}

/** Difference in milliseconds as a float (exact while |b - a| < about 285,000 years). */
export function diffMs(a: Instant, b: Instant): number {
  if (!isFiniteInstant(a) || !isFiniteInstant(b)) return compare(a, b) === 0 ? 0 : (compare(b, a) > 0 ? Infinity : -Infinity);
  return (b.day - a.day) * MS_PER_DAY + (b.ms - a.ms);
}

/** Interpolate between two finite instants. f = 0 gives a, f = 1 gives b. Exact to the millisecond for spans up to ~285,000 years. */
export function lerp(a: Instant, b: Instant, f: number): Instant {
  if (f <= 0) return a;
  if (f >= 1) return b;
  const spanDays = b.day - a.day;
  if (Math.abs(spanDays) < 100_000_000) {
    return addMs(a, Math.round(diffMs(a, b) * f));
  }
  // Huge spans: a millisecond is far below one frame's worth of history, so split into days + fraction.
  const exactDays = (spanDays + (b.ms - a.ms) / MS_PER_DAY) * f;
  const whole = Math.floor(exactDays);
  return instant(a.day + whole, a.ms + Math.round((exactDays - whole) * MS_PER_DAY));
}

/** Inverse of lerp: where t lies between a and b, as a fraction (not clamped). */
export function fraction(a: Instant, b: Instant, t: Instant): number {
  const span = diffMs(a, b);
  if (span === 0) return 0;
  return diffMs(a, t) / span;
}

/** Approximate decimal year, for drawing timelines only (never for storage or comparison). */
export function toApproxYear(a: Instant): number {
  if (!isFiniteInstant(a)) return a.day;
  return 1970 + (a.day + a.ms / MS_PER_DAY) / 365.2425;
}

/** Inverse of toApproxYear, rounded to the millisecond (for timeline mouse positions). */
export function fromApproxYear(year: number): Instant {
  const days = (year - 1970) * 365.2425;
  const whole = Math.floor(days);
  return instant(whole, Math.round((days - whole) * MS_PER_DAY));
}

// Storage: two SQLite INTEGER columns. ±Infinity use the safe-integer limits as sentinels.
export const STORE_NEG_INF = -Number.MAX_SAFE_INTEGER;
export const STORE_POS_INF = Number.MAX_SAFE_INTEGER;

export function toStore(a: Instant): [number, number] {
  if (a.day === -Infinity) return [STORE_NEG_INF, 0];
  if (a.day === Infinity) return [STORE_POS_INF, 0];
  return [a.day, a.ms];
}

export function fromStore(day: number, ms: number): Instant {
  if (day <= STORE_NEG_INF) return NEG_INF;
  if (day >= STORE_POS_INF) return POS_INF;
  return instant(day, ms);
}

/** Compact string key, sortable only via compare(); used in JSON documents. */
export function toJSONValue(a: Instant): [number, number] | '-inf' | '+inf' {
  if (a.day === -Infinity) return '-inf';
  if (a.day === Infinity) return '+inf';
  return [a.day, a.ms];
}

export function fromJSONValue(v: unknown): Instant {
  if (v === '-inf') return NEG_INF;
  if (v === '+inf') return POS_INF;
  if (Array.isArray(v) && v.length === 2) return instant(Number(v[0]), Number(v[1]));
  throw new TypeError(`Not an instant: ${JSON.stringify(v)}`);
}
