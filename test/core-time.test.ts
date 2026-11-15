import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  instant, compare, add, addMs, diff, diffMs, lerp, NEG_INF, POS_INF, toStore, fromStore,
  gregorian, daysFromCivil, civilFromDays, formatYear, MS_PER_DAY,
} from '../src/core-time/index.ts';
import { rng } from './helpers.ts';

test('known Gregorian dates map to the right day numbers', () => {
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.equal(daysFromCivil(2000, 3, 1), 11017);
  assert.equal(daysFromCivil(0, 3, 1), -719468);
  assert.equal(daysFromCivil(1969, 12, 31), -1);
  assert.deepEqual(civilFromDays(-1), { year: 1969, month: 12, day: 31 });
  // Year 0 (1 BCE) is a leap year in the proleptic Gregorian calendar.
  assert.equal(daysFromCivil(0, 3, 1) - daysFromCivil(0, 2, 28), 2);
});

test('civil <-> days round-trips across trillions of years', () => {
  const r = rng(7);
  for (let i = 0; i < 20000; i++) {
    const mag = r.pick([10, 3000, 1e6, 1e9, 1e12]);
    const y = r.int(-mag, mag);
    const m = r.int(1, 12);
    const d = r.int(1, 28);
    const days = daysFromCivil(y, m, d);
    assert.ok(Number.isSafeInteger(days));
    assert.deepEqual(civilFromDays(days), { year: y, month: m, day: d });
  }
  // consecutive days stay consecutive across era boundaries
  for (const y of [-400, -1, 0, 1, 399, 400, 1e12]) {
    const a = daysFromCivil(y, 12, 31);
    assert.deepEqual(civilFromDays(a + 1), { year: y + 1, month: 1, day: 1 });
  }
});

test('instants normalise, compare and add exactly', () => {
  const t = instant(10, MS_PER_DAY + 5);
  assert.deepEqual(t, { day: 11, ms: 5 });
  assert.deepEqual(instant(0, -1), { day: -1, ms: MS_PER_DAY - 1 });
  assert.equal(compare(NEG_INF, instant(-1e15)), -1);
  assert.equal(compare(POS_INF, instant(1e15)), 1);
  assert.equal(compare(instant(5, 1), instant(5, 2)), -1);
  assert.deepEqual(addMs(instant(0, 0), -1), { day: -1, ms: MS_PER_DAY - 1 });
  assert.deepEqual(add(instant(3, 10), 2, MS_PER_DAY), { day: 6, ms: 10 });
  assert.deepEqual(diff(instant(0, 500), instant(2, 100)), { days: 1, ms: MS_PER_DAY - 400 });
  assert.equal(diffMs(instant(0), instant(1)), MS_PER_DAY);
});

test('far-apart instants keep millisecond precision', () => {
  const a = instant(-3e14, 1); // about 820 billion years ago
  const b = add(a, 0, 1);
  assert.equal(compare(a, b), -1);
  assert.deepEqual(diff(a, b), { days: 0, ms: 1 });
  const c = instant(3e14, 0);
  assert.equal(compare(a, c), -1);
});

test('lerp is exact for normal spans and sane for huge ones', () => {
  const a = gregorian.fromCivil({ year: 1203, month: 5, day: 14, hour: 6 });
  const b = gregorian.fromCivil({ year: 1203, month: 5, day: 17, hour: 18 });
  assert.deepEqual(lerp(a, b, 0.5), gregorian.fromCivil({ year: 1203, month: 5, day: 16 }));
  assert.deepEqual(lerp(a, b, 0), a);
  assert.deepEqual(lerp(a, b, 1), b);
  const far0 = instant(-1e13), far1 = instant(1e13);
  const mid = lerp(far0, far1, 0.5);
  assert.equal(mid.day, 0);
});

test('storage round-trip including infinities', () => {
  for (const t of [NEG_INF, POS_INF, instant(-5, 7), instant(123456789, 1)]) {
    const [d, m] = toStore(t);
    assert.deepEqual(fromStore(d, m), t);
  }
});

test('formats and parses human dates', () => {
  const t = gregorian.fromCivil({ year: 1203, month: 5, day: 14, hour: 6, minute: 0 });
  assert.equal(gregorian.format(t, 'minute'), '14 May 1203, 06:00');
  assert.equal(gregorian.format(t, 'day'), '14 May 1203');
  assert.equal(formatYear(0), '1 BCE');
  assert.equal(formatYear(-499), '500 BCE');
  assert.equal(formatYear(12000000), '12,000,000');

  const cases: Array<[string, { year: number; month?: number; day?: number; hour?: number; minute?: number }, string]> = [
    ['1203', { year: 1203 }, 'year'],
    ['1203-05-14', { year: 1203, month: 5, day: 14 }, 'day'],
    ['1203-05-14T06:30', { year: 1203, month: 5, day: 14, hour: 6, minute: 30 }, 'minute'],
    ['500 BCE', { year: -499 }, 'year'],
    ['500 BC', { year: -499 }, 'year'],
    ['-499', { year: -499 }, 'year'],
    ['14 May 1203', { year: 1203, month: 5, day: 14 }, 'day'],
    ['May 1203', { year: 1203, month: 5 }, 'month'],
    ['AD 33', { year: 33 }, 'year'],
    ['c. 3000 BCE', { year: -2999 }, 'circa'],
    ['2,400,000', { year: 2400000 }, 'year'],
  ];
  for (const [text, civil, precision] of cases) {
    const p = gregorian.parse(text);
    assert.ok(p, `parse ${text}`);
    assert.deepEqual(p.instant, gregorian.fromCivil(civil), text);
    assert.equal(p.precision, precision, text);
  }
  assert.equal(gregorian.parse('31 February 2000'), null);
  assert.equal(gregorian.parse('not a date'), null);
  assert.equal(gregorian.parse('0 BCE'), null);
});

test('milliseconds are representable and formatted', () => {
  const t = gregorian.parse('2241-03-02T04:05:06.007');
  assert.ok(t);
  assert.equal(t.instant.ms, ((4 * 60 + 5) * 60 + 6) * 1000 + 7);
  assert.equal(gregorian.format(t.instant, 'millisecond'), '2 March 2241, 04:05:06.007');
});
