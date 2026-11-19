// Calendars of one's own (Stage 13, D149): made from a definition, exact over the whole range of instants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gregorian, instant, stepDate, floorTo, daysFromCivil, calendarOf, calendarProblems, CALENDAR_TEMPLATES, type CalendarDef } from '../src/core-time/index.ts';
import { rng } from './helpers.ts';

const template = (id: string) => calendarOf(CALENDAR_TEMPLATES.find((t) => t.id === id)!.def);
const G = (y: number, m: number, d: number) => instant(daysFromCivil(y, m, d));

test('the Julian calendar: the days of the Gregorian reform and of 1917; BC years; its week the same days as ever', () => {
  const J = template('julian');
  // 4 October 1582 (Julian) was followed by 15 October 1582 (Gregorian).
  assert.deepEqual(J.fromCivil({ year: 1582, month: 10, day: 4 }), G(1582, 10, 14));
  assert.deepEqual(J.fromCivil({ year: 1582, month: 10, day: 5 }), G(1582, 10, 15));
  // The October Revolution: 25 October 1917 (Julian), 7 November 1917.
  assert.deepEqual(J.fromCivil({ year: 1917, month: 10, day: 25 }), G(1917, 11, 7));
  assert.equal(J.format(G(2000, 1, 14), 'day'), '1 January 2000');
  // 1900 was a leap year in the Julian calendar only.
  assert.equal(J.daysIn(1900, 2), 29);
  assert.equal(gregorian.daysIn(1900, 2), 28);
  // The Ides of March, 44 BC: written, read back.
  const ides = J.fromCivil({ year: -43, month: 3, day: 15 });
  assert.equal(J.format(ides, 'day'), '15 March 44 BC');
  assert.deepEqual(J.parse('15 March 44 BC')?.instant, ides);
  assert.equal(J.yearLabel(1), '1');
  assert.equal(J.yearLabel(0), '1 BC');
  assert.equal(J.parseYear('44 BC'), -43);
  // Weekdays: the same day of the week as the Gregorian calendar gives the same day.
  for (const t of [G(1582, 10, 15), G(2026, 11, 19), G(-500, 3, 1)]) assert.equal(J.weekdays![J.weekdayOf(t)!], gregorian.weekdays![gregorian.weekdayOf(t)!]);
  assert.equal(gregorian.weekdays![gregorian.weekdayOf(G(2026, 11, 19))!], 'Thursday');
});

test('the French Republican calendar: 9 Thermidor Year II, 18 Brumaire Year VIII; the festival days; the décade', () => {
  const R = template('republican');
  assert.deepEqual(R.fromCivil({ year: 2, month: 11, day: 9 }), G(1794, 7, 27));
  assert.deepEqual(R.fromCivil({ year: 8, month: 2, day: 18 }), G(1799, 11, 9));
  assert.equal(R.format(G(1794, 7, 27), 'day'), '9 Thermidor 2 of the Republic');
  assert.deepEqual(R.parse('9 Thermidor 2 of the Republic')?.instant, G(1794, 7, 27));
  // Year III a leap year: six festival days; year IV begins on 23 September 1795.
  assert.equal(R.daysIn(3, 13), 6);
  assert.equal(R.daysIn(4, 13), 5);
  assert.deepEqual(R.fromCivil({ year: 4 }), G(1795, 9, 23));
  // The décade begins again each month: the 1st of every month a Primidi, the 10th a Décadi.
  assert.equal(R.weekdays![R.weekdayOf(R.fromCivil({ year: 2, month: 11, day: 1 }))!], 'Primidi');
  assert.equal(R.weekdays![R.weekdayOf(R.fromCivil({ year: 2, month: 11, day: 10 }))!], 'Décadi');
});

test('thirteen months of four weeks: the leap day after June, the year day at the end, every month from Sunday', () => {
  const F = template('fixed');
  assert.deepEqual(F.toCivil(G(2021, 1, 29)).month, 2);
  assert.equal(F.format(G(2021, 1, 29), 'day'), '1 February 2021');
  assert.equal(F.format(G(2021, 12, 31), 'day'), '1 Year Day 2021');
  // 2024 a leap year: the leap day is the 169th day (17 June); 2023 has none.
  assert.equal(F.format(G(2024, 6, 17), 'day'), '1 Leap Day 2024');
  assert.equal(F.daysIn(2023, 7), 0);
  assert.equal(F.toCivil(G(2023, 6, 18)).month, 8, 'in a common year Sol follows June directly');
  for (const m of [1, 5, 8, 13]) assert.equal(F.weekdays![F.weekdayOf(F.fromCivil({ year: 2030, month: m, day: 1 }))!], 'Sunday');
  // Stepping a month passes over the leap day where there is none.
  assert.equal(F.toCivil(stepDate(F.fromCivil({ year: 2023, month: 6, day: 10 }), 'month', 1, F)).month, 8);
  assert.equal(F.toCivil(stepDate(F.fromCivil({ year: 2024, month: 6, day: 10 }), 'month', 1, F)).month, 7);
  assert.equal(F.toCivil(stepDate(F.fromCivil({ year: 2024, month: 6, day: 10 }), 'month', 1, F)).day, 1, 'the day kept within the month');
});

test('a calendar made like the Gregorian one agrees with it day for day, over trillions of years', () => {
  const like: CalendarDef = {
    id: 'like', name: 'Like Gregorian',
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((name, i) => ({ name, days: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i], ...(i === 1 ? { leapDays: 1 } : {}) })),
    leap: { every: 4, except: 100, but: 400 }, epochDay: daysFromCivil(1, 1, 1), eras: [], before: '', yearZero: true,
  };
  const C = calendarOf(like);
  const r = rng(7);
  for (let k = 0; k < 3000; k++) {
    const span = [1e3, 1e6, 1e9, 1e12, 8e15][k % 5];
    const t = instant(Math.round(r.float(-span, span)), r.int(0, 86_399_999));
    const a = C.toCivil(t), b = gregorian.toCivil(t);
    assert.deepEqual(a, b, `day ${t.day}`);
    assert.deepEqual(C.fromCivil(a), t);
  }
});

test('a world of its own: eras, the years before them, a day of 30 hours, a week of six days; round trips everywhere', () => {
  const def: CalendarDef = {
    ...CALENDAR_TEMPLATES.find((t) => t.id === 'world')!.def,
    dayHours: 30,
    eras: [{ name: 'After the Founding', abbr: 'AF', start: 1 }, { name: 'Third Age', abbr: 'TA', start: 1201 }],
  };
  assert.deepEqual(calendarProblems(def), []);
  const W = calendarOf(def);
  assert.equal(W.hoursPerDay, 30);
  // Its year 1 begins at its epoch; a day of 30 hours.
  const start = W.fromCivil({ year: 1 });
  assert.deepEqual(start, instant(def.epochDay));
  const late = W.fromCivil({ year: 1, month: 1, day: 1, hour: 29, minute: 59 });
  assert.equal(W.format(late), '1 Firstmonth 1 AF, 29:59');
  assert.throws(() => W.fromCivil({ year: 1, month: 1, day: 1, hour: 30 }));
  assert.equal(W.format(W.addDays(start, 1), 'minute'), '2 Firstmonth 1 AF, 00:00');
  assert.equal(W.addDays(start, 4).day - start.day, 5, 'four days of 30 hours are five of 24');
  // Eras: the Third Age from the year 1201; the years before the first counted back.
  assert.equal(W.yearLabel(1200), '1200 AF');
  assert.equal(W.yearLabel(1201), '1 TA');
  assert.equal(W.yearLabel(1544), '344 TA');
  assert.equal(W.yearLabel(0), '1 BF');
  assert.equal(W.yearLabel(-9), '10 BF');
  for (const y of [-9, 0, 1, 1200, 1201, 1544]) assert.equal(W.parseYear(W.yearLabel(y)), y);
  assert.equal(W.parseYear('344 Third Age'), 1544);
  assert.equal(W.parseYear('344'), 344, 'a year alone: the first era\'s count');
  // Dates written and read back, at every precision that keeps them.
  const t = W.fromCivil({ year: 1544, month: 8, day: 14, hour: 25, minute: 30 });
  assert.equal(W.format(t, 'day'), '14 Frostmoon 344 TA');
  assert.deepEqual(W.parse('14 Frostmoon 344 TA, 25:30')?.instant, t);
  assert.deepEqual(W.parse('14 frost 344 TA, 25:30')?.instant, t, 'a month by the start of its name');
  assert.deepEqual(W.parse('1544-8-14 25:30')?.instant, W.fromCivil({ year: 1544, month: 8, day: 14, hour: 25, minute: 30 }));
  assert.equal(W.parse('Frostmoon 344 TA')?.precision, 'month');
  assert.equal(W.parse('344 TA')?.precision, 'year');
  assert.equal(W.parse('c. 344 TA')?.precision, 'circa');
  assert.equal(W.parse('Blorptember 344 TA'), null);
  assert.equal(W.parse('40 Frostmoon 344 TA'), null, 'no 40th day');
  // Round trips far and wide.
  const r = rng(3);
  for (let k = 0; k < 2000; k++) {
    const span = [1e3, 1e6, 1e9, 1e12, 3e15][k % 5];
    const u = instant(Math.round(r.float(-span, span)), r.int(0, 86_399_999));
    const c = W.toCivil(u);
    assert.deepEqual(W.fromCivil(c), u, `day ${u.day}`);
    assert.ok(c.hour < 30 && c.day >= 1 && c.day <= W.daysIn(c.year, c.month));
  }
  // Days, months and years stepped; rounded down to the year, month and day.
  const s0 = W.fromCivil({ year: 1544, month: 10, day: 36, hour: 7 });
  assert.equal(W.daysIn(1544, 11), 6, '1544 a leap year: six days of the Turning');
  assert.deepEqual(W.toCivil(stepDate(s0, 'month', 1, W)), { ...W.toCivil(s0), month: 11, day: 6 }, 'a month on from the 36th: the Turning\'s last day');
  assert.equal(W.toCivil(stepDate(s0, 'year', -1544, W)).year, 0);
  assert.equal(W.format(floorTo(t, 'month', 1, W), 'day'), '1 Frostmoon 344 TA');
  assert.equal(W.format(floorTo(t, 'year', 100, W), 'day'), '1 Firstmonth 300 TA');
  assert.equal(W.format(floorTo(t, 'day', 1, W)), '14 Frostmoon 344 TA, 00:00');
});

test('a definition that cannot be a calendar is told why', () => {
  const ok = CALENDAR_TEMPLATES.find((t) => t.id === 'world')!.def;
  for (const t of CALENDAR_TEMPLATES) assert.deepEqual(calendarProblems(t.def), [], t.id);
  assert.ok(calendarProblems({ ...ok, months: [] }).length);
  assert.ok(calendarProblems({ ...ok, months: [{ name: 'Nothing', days: 0 }] }).length);
  assert.ok(calendarProblems({ ...ok, leap: { every: 4, except: 10 } }).length, 'an exception not a multiple of the rule');
  assert.ok(calendarProblems({ ...ok, leap: { every: 4 }, months: ok.months.map((m) => ({ name: m.name, days: m.days })) }).length, 'leap years with nowhere to put the day');
  assert.ok(calendarProblems({ ...ok, eras: [{ name: 'B', abbr: 'B', start: 10 }, { name: 'A', abbr: 'A', start: 5 }] }).length, 'eras out of order');
  assert.ok(calendarProblems({ ...ok, dayHours: 0.5 }).length);
});

test('a map given a calendar of its own: kept in its settings, one undo step, refused when it cannot be one; the Gregorian otherwise', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { calendarOfSpace, calendarDefOf } = await import('../src/world-model/world-settings.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const w = new World();
  const space = cmd.seedProject(w, 'Calendars').result.spaceId;
  assert.equal(calendarOfSpace(w.get('map_space', space)), gregorian);
  const def = { ...CALENDAR_TEMPLATES.find((t) => t.id === 'world')!.def, id: 'cal_test' };
  const keysBefore = Object.keys(JSON.parse(w.get('map_space', space)!.settings)).sort();
  const r = cmd.setMapCalendar(w, space, def);
  assert.deepEqual(calendarDefOf(w.get('map_space', space)), def);
  const cal = calendarOfSpace(w.get('map_space', space));
  assert.equal(cal.name, 'Calendar of the Founding');
  assert.equal(cal.format(instant(daysFromCivil(1000, 1, 1)), 'day'), '1 Firstmonth 1 AF');
  // Its other settings kept.
  assert.deepEqual(Object.keys(JSON.parse(w.get('map_space', space)!.settings)).sort(), [...keysBefore, 'calendar'].sort());
  // Refused when it cannot be a calendar; the map keeps the one it has.
  assert.throws(() => cmd.setMapCalendar(w, space, { ...def, months: [] }), /month/);
  assert.equal(calendarOfSpace(w.get('map_space', space)).name, 'Calendar of the Founding');
  // Undone: the Gregorian again. Set to none: the Gregorian.
  w.applyDiffs(invertDiffs(r.diffs));
  assert.equal(calendarOfSpace(w.get('map_space', space)), gregorian);
  cmd.setMapCalendar(w, space, def);
  cmd.setMapCalendar(w, space, null);
  assert.equal(calendarOfSpace(w.get('map_space', space)), gregorian);
  // Settings that cannot be read as a calendar (written by hand, say): the Gregorian.
  assert.equal(calendarOfSpace({ settings: '{"calendar":{"months":"twelve"}}' }), gregorian);
  assert.equal(calendarOfSpace({ settings: 'not json' }), gregorian);
});
