// A country's borders as they changed over time: for a period (a day, a month, a year or several
// years), which land it gained and lost, from and to whom, and the changes that did it. Read-only:
// nothing here changes the project. Shown by the "changes over time" selection mode.
import { type Instant, type Calendar, compare, addMs, gregorian, floorTo, stepDate } from '../core-time/index.ts';
import type { World } from '../world-model/world.ts';
import { type Engine, leafDescendants } from '../temporal-engine/engine.ts';

export type PeriodUnit = 'day' | 'month' | 'year' | 'years';
/** A kind of period; `years` is the length when the unit is 'years' (10: decades, 100: centuries). */
export interface PeriodSpec { unit: PeriodUnit; years: number }

export const DEFAULT_PERIOD: PeriodSpec = { unit: 'year', years: 10 };

/** The period of the given kind that contains instant t: [from, to), in a calendar (the map's, D149). */
export function periodAround(t: Instant, spec: PeriodSpec, cal: Calendar = gregorian): { from: Instant; to: Instant } {
  const c = cal.toCivil(t);
  switch (spec.unit) {
    case 'day': { const from = floorTo(t, 'day', 1, cal); return { from, to: cal.addDays(from, 1) }; }
    case 'month': {
      const from = cal.fromCivil({ year: c.year, month: c.month });
      return { from, to: stepDate(from, 'month', 1, cal) };
    }
    case 'year': return { from: cal.fromCivil({ year: c.year }), to: cal.fromCivil({ year: c.year + 1 }) };
    default: {
      const n = Math.max(1, Math.round(spec.years));
      const y0 = Math.floor(c.year / n) * n;
      return { from: cal.fromCivil({ year: y0 }), to: cal.fromCivil({ year: y0 + n }) };
    }
  }
}

/** The start of the period before (-1) or after (+1) the one containing t. */
export function stepPeriod(t: Instant, spec: PeriodSpec, dir: -1 | 1, cal: Calendar = gregorian): Instant {
  const p = periodAround(t, spec, cal);
  return dir > 0 ? p.to : periodAround(addMs(p.from, -1), spec, cal).from;
}

/** How a period is written: "1450", "March 1450", "4 March 1450", "1450–1459". */
export function periodLabel(from: Instant, to: Instant, spec: PeriodSpec, cal: Calendar = gregorian): string {
  if (spec.unit === 'day') return cal.format(from, 'day');
  if (spec.unit === 'month') return cal.format(from, 'month');
  if (spec.unit === 'year') return cal.format(from, 'year');
  return `${cal.format(from, 'year')}–${cal.format(addMs(to, -1), 'year')}`;
}

export interface CountryChange {
  t: Instant;
  eventId: string;
  effectId: string;
  /** Areas in steradians (multiply by radius² for square metres). */
  gainedArea: number;
  lostArea: number;
  /** Who held the land it gained before, and who took the land it lost. */
  from: Array<string | null>;
  to: Array<string | null>;
}

export interface PeriodChanges {
  from: Instant;
  to: Instant;
  /** Parcels held at the end of the period, gained during it, and lost during it (leaf faces). */
  held: number[];
  gained: number[];
  lost: number[];
  gainedArea: number;
  lostArea: number;
  /** Every change in the period that gave the country land or took land from it, in order. */
  changes: CountryChange[];
}

/**
 * What changed for a country on one layer during [from, to): its land just before the period and at
 * its end compared (land gained and lost there and back again within the period counts as neither),
 * and each change in the period that touched its land.
 */
export function countryPeriodChanges(world: World, engine: Engine, spaceId: string, layerId: string, entity: string, from: Instant, to: Instant): PeriodChanges {
  const arr = world.arrangement(spaceId);
  const before = engine.partitionState(spaceId, layerId, addMs(from, -1));
  const after = engine.partitionState(spaceId, layerId, addMs(to, -1));
  const owns = (m: typeof before, f: number) => m.get(f)?.value === entity;
  const held: number[] = [], gained: number[] = [], lost: number[] = [];
  let gainedArea = 0, lostArea = 0;
  const faces = new Set([...before.keys(), ...after.keys()]);
  for (const f of faces) {
    const a = owns(before, f), b = owns(after, f);
    if (b) held.push(f);
    if (b && !a) { gained.push(f); gainedArea += arr.faceArea(f); }
    if (a && !b) { lost.push(f); lostArea += arr.faceArea(f); }
  }
  const changes: CountryChange[] = [];
  for (const ef of world.all('effect')) {
    if (ef.layer_id !== layerId || ef.space_id !== spaceId || (ef.kind !== 'assign' && ef.kind !== 'annex')) continue;
    const list = engine.assignmentsOf(ef.id);
    if (!list.length || compare(list[0].t, from) < 0 || compare(list[0].t, to) >= 0) continue;
    const c: CountryChange = { t: list[0].t, eventId: list[0].eventId, effectId: ef.id, gainedArea: 0, lostArea: 0, from: [], to: [] };
    for (const a of list) {
      for (const leaf of leafDescendants(arr, [a.face])) {
        const prev = engine.latest(spaceId, layerId, leaf, a.t, a)?.value ?? null;
        if (a.value === entity && prev !== entity) { c.gainedArea += arr.faceArea(leaf); if (!c.from.includes(prev)) c.from.push(prev); }
        if (prev === entity && a.value !== entity) { c.lostArea += arr.faceArea(leaf); if (!c.to.includes(a.value)) c.to.push(a.value); }
      }
    }
    if (c.gainedArea > 0 || c.lostArea > 0) changes.push(c);
  }
  changes.sort((a, b) => compare(a.t, b.t));
  return { from, to, held, gained, lost, gainedArea, lostArea, changes };
}
