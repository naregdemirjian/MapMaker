// How long each change recorded into an event takes (fifth feedback round, D86): the choice made in the
// recording bar, kept on this computer, and the transition it gives a change recorded now.
import type { TransitionSpec } from '../temporal-engine/engine.ts';

export type RecordWhen = 'instant' | 'next' | 'event' | 'for';
export type LengthUnit = 'day' | 'month' | 'year';
export interface RecordLength { when: RecordWhen; style: 'border' | 'advance' | 'dissolve' | 'fade'; n: number; unit: LengthUnit }
export const DEFAULT_RECORD_LENGTH: RecordLength = { when: 'instant', style: 'border', n: 1, unit: 'month' };

const KEY = 'mapmaker.recordLength';
export function loadRecordLength(): RecordLength {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<RecordLength> | null;
    if (!v) return DEFAULT_RECORD_LENGTH;
    return {
      when: (['instant', 'next', 'event', 'for'] as const).includes(v.when as RecordWhen) ? v.when as RecordWhen : DEFAULT_RECORD_LENGTH.when,
      style: (['border', 'advance', 'dissolve', 'fade'] as const).includes(v.style as RecordLength['style']) ? v.style as RecordLength['style'] : DEFAULT_RECORD_LENGTH.style,
      n: typeof v.n === 'number' && v.n >= 1 ? Math.round(v.n) : DEFAULT_RECORD_LENGTH.n,
      unit: (['day', 'month', 'year'] as const).includes(v.unit as LengthUnit) ? v.unit as LengthUnit : DEFAULT_RECORD_LENGTH.unit,
    };
  } catch { return DEFAULT_RECORD_LENGTH; }
}
export function saveRecordLength(r: RecordLength): void {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* storage may be unavailable */ }
}

/** The transition a change recorded now takes. `origin`: where its drawing began (for an expansion; without one, an advancing front). */
export function recordTransition(r: RecordLength, origin: [number, number] | null): TransitionSpec | null {
  if (r.when === 'instant') return null;
  const base: TransitionSpec = r.style === 'advance' && origin ? { style: 'advance', origin, easing: 'smooth' }
    : r.style === 'fade' ? { style: 'fade' } : r.style === 'dissolve' ? { style: 'dissolve', easing: 'smooth' } : { style: 'border', easing: 'smooth' };
  if (r.when === 'next') return { ...base, next: true };
  if (r.when === 'for') return { ...base, for: { n: Math.max(1, Math.round(r.n)), unit: r.unit } };
  return base;
}

