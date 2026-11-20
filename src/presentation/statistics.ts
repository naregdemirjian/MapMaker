// Statistics (D171): numbers a map keeps over time, such as a country's economy, its army or the dead of a war,
// each known at dates and worked out between them. A text box or the title of a shot shows one by its name in
// braces, "{GDP}", and the number counts up or down as history plays, in the preview and in every export.
import { type Instant, fromJSONValue, toJSONValue } from '../core-time/index.ts';

/** How a statistic is written: money ($1.20 trillion), a count of people or things (80.0 million), a plain number, a share. */
export type StatFormat = 'money' | 'count' | 'number' | 'percent';
/** How it changes between two dates: growing by the same share each day (an economy), by the same amount, or at once. */
export type StatEase = 'growth' | 'linear' | 'step';

export interface StatKey { at: [number, number]; value: number }
export interface Statistic {
  name: string; format: StatFormat; ease: StatEase;
  /** The values known, in time order. */
  keys: StatKey[];
  /** Digits after the point when written in millions, billions…: absent, as many as keep three figures. */
  decimals?: number;
}

export const STAT_FORMATS: Array<{ id: StatFormat; name: string }> = [
  { id: 'money', name: 'Money ($1.20 trillion)' }, { id: 'count', name: 'People or things (80.0 million)' },
  { id: 'number', name: 'A number (12,345)' }, { id: 'percent', name: 'A share (45 %)' },
];
export const STAT_EASES: Array<{ id: StatEase; name: string }> = [
  { id: 'growth', name: 'Grows by a steady share (economies, populations)' }, { id: 'linear', name: 'Changes by a steady amount' }, { id: 'step', name: 'Changes at once at each date' },
];

const isDay = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** The statistics stored with a map, cleaned: unnamed ones and broken values left out, keys in time order. */
export function cleanStatistics(v: unknown): Statistic[] {
  if (!Array.isArray(v)) return [];
  const out: Statistic[] = [];
  for (const s of v as Array<Partial<Statistic>>) {
    if (!s || typeof s.name !== 'string' || !s.name.trim()) continue;
    const keys = (Array.isArray(s.keys) ? s.keys : []).filter((k) => k && isDay(k.at) && typeof k.value === 'number' && Number.isFinite(k.value))
      .map((k) => ({ at: [k.at[0], k.at[1]] as [number, number], value: k.value }))
      .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
    out.push({
      name: s.name.trim(), keys,
      format: STAT_FORMATS.some((f) => f.id === s.format) ? s.format! : 'number',
      ease: STAT_EASES.some((f) => f.id === s.ease) ? s.ease! : 'linear',
      ...(typeof s.decimals === 'number' && Number.isFinite(s.decimals) ? { decimals: Math.max(0, Math.min(6, Math.round(s.decimals))) } : {}),
    });
  }
  return out;
}

/** Days from `a` to `b` (fractions of a day for the time of day). */
const daysBetween = (a: [number, number], b: Instant) => (b.day - a[0]) + (b.ms - a[1]) / 86_400_000;

/** The value of a statistic at a moment: the first known before its first date, the last after its last, worked out between. Null when it has none. */
export function statisticAt(stat: Statistic, t: Instant): number | null {
  const k = stat.keys;
  if (!k.length) return null;
  if (!Number.isFinite(t.day)) return t.day < 0 ? k[0].value : k[k.length - 1].value;
  if (daysBetween(k[0].at, t) <= 0) return k[0].value;
  for (let i = 1; i < k.length; i++) {
    const span = daysBetween(k[i - 1].at, fromJSONValue(k[i].at));
    const into = daysBetween(k[i - 1].at, t);
    if (into >= span) continue;
    const a = k[i - 1].value, b = k[i].value, f = span > 0 ? into / span : 1;
    if (stat.ease === 'step') return a;
    if (stat.ease === 'growth' && a > 0 && b > 0) return a * Math.pow(b / a, f);
    return a + (b - a) * f;
  }
  return k[k.length - 1].value;
}

const SCALES: Array<[number, string]> = [[1e15, 'quadrillion'], [1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million']];
const grouped = (v: number, decimals = 0) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** A value written as its statistic says: "$72.0 billion", "1.50 billion", "90,000", "45 %". */
export function formatStatistic(value: number, format: StatFormat, decimals?: number): string {
  if (format === 'percent') return `${grouped(value, decimals ?? (Math.abs(value) < 10 ? 1 : 0))} %`;
  const sign = value < 0 ? '−' : '', v = Math.abs(value), money = format === 'money' ? '$' : '';
  if (format !== 'number') {
    for (const [scale, word] of SCALES) {
      if (v >= scale * 0.9995) {
        const n = v / scale;
        const d = decimals ?? (n < 9.995 ? 2 : n < 99.95 ? 1 : 0);
        return `${sign}${money}${grouped(n, d)} ${word}`;
      }
    }
  }
  return `${sign}${money}${grouped(v, decimals ?? (v < 10 && v % 1 ? 1 : 0))}`;
}

/** A text with each "{name}" of a statistic replaced by its value at `t` (names compared without case; others left as they are). */
export function fillStatistics(text: string, stats: Statistic[], t: Instant): string {
  if (!stats.length || !text.includes('{')) return text;
  const byName = new Map(stats.map((s) => [s.name.toLowerCase(), s]));
  return text.replace(/\{([^{}\n]+)\}/g, (whole, name: string) => {
    const s = byName.get(name.trim().toLowerCase());
    if (!s) return whole;
    const v = statisticAt(s, t);
    return v === null ? '' : formatStatistic(v, s.format, s.decimals);
  });
}

/** An amount as written by a person: "72 billion", "1.2 trillion", "$5 trillion", "90,000", "1.5e9", "300k". Null when it is not one. */
export function parseAmount(text: string): number | null {
  const m = text.trim().toLowerCase().replace(/[$,\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .match(/^(-?[\d ]*\.?\d+(?:e[+-]?\d+)?) ?(k|thousand|m|mn|million|b|bn|billion|t|tn|trillion|q|quadrillion|%)?$/);
  if (!m) return null;
  const n = Number(m[1].replace(/ /g, ''));
  if (!Number.isFinite(n)) return null;
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12, q: 1e15, quadrillion: 1e15, '%': 1 };
  return n * (m[2] ? mult[m[2]] : 1);
}

/** A key at a moment. */
export const statKey = (t: Instant, value: number): StatKey => ({ at: toJSONValue(t) as [number, number], value });
