// Many disasters at once (D233): a brush scatters a number of them (seventy thousand nuclear strikes, say) along a
// stroke, each at a place of its own within the brush's reach, of a size of its own between a least and a most, and
// at a moment of its own over a span of time. What is kept is the recipe (the stroke, the brush, how many, the seed,
// the sizes and the span), not each disaster: it is laid out the same every time it is drawn, so the project stays
// small and the picture the same.

export interface Scatter {
  /** The brush's stroke (degrees); one place: a dab. */
  path: Array<[number, number]>;
  /** How far from the stroke they fall (km). */
  widthKm: number;
  count: number;
  seed: number;
  /** Each one's reach and strength, as multiples of the source's own, for the least and the most of the sizes (between them, as their sizes are spread evenly between the least and the most on a scale of ratios). */
  reach: [number, number];
  strength: [number, number];
  /** Over how many days after the start they happen (0: all at once). */
  spreadDays: number;
}

/** The most disasters one stroke scatters. */
export const MOST_SCATTERED = 100_000;
/** Sizes are drawn in so many steps between the least and the most (they share their settings, D233). */
export const SIZE_STEPS = 24;

export interface ScatterItem { lon: number; lat: number; /** Its size, as a step from 0 (the least) to SIZE_STEPS - 1 (the most). */ size: number; /** Days after the start. */ delay: number }

/** A stored scatter, checked (null when it is not one). */
export function scatterOf(raw: unknown): Scatter | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof Scatter, unknown>>;
  const path = Array.isArray(r.path) ? (r.path as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x))).map((p) => [p[0], p[1]] as [number, number]) : [];
  if (!path.length) return null;
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const pair = (v: unknown): [number, number] => (Array.isArray(v) && v.length === 2 ? [n(v[0], 1, 1e-4, 1e4), n(v[1], 1, 1e-4, 1e4)] : [1, 1]);
  return { path, widthKm: n(r.widthKm, 100, 0, 20000), count: Math.round(n(r.count, 1, 1, MOST_SCATTERED)), seed: Math.round(n(r.seed, 1, 0, 1e9)), reach: pair(r.reach), strength: pair(r.strength), spreadDays: n(r.spreadDays, 0, 0, 1e7) };
}

/** A small, fast generator of numbers from 0 to 1, the same from the same seed. */
function random(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = 6371.0088;
/** The distance (km) between two places on the Earth's sphere. */
function distance(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180, h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** The place `d` km from `from` towards `bearing` (radians from north). */
function destination(from: [number, number], d: number, bearing: number): [number, number] {
  const r = Math.PI / 180, p1 = from[1] * r, l1 = from[0] * r, a = d / R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(a) + Math.cos(p1) * Math.sin(a) * Math.cos(bearing));
  const l2 = l1 + Math.atan2(Math.sin(bearing) * Math.sin(a) * Math.cos(p1), Math.cos(a) - Math.sin(p1) * Math.sin(p2));
  return [((((l2 / r) + 540) % 360) - 180), p2 / r];
}

const cache = new WeakMap<Scatter, ScatterItem[]>();

/**
 * The disasters of a scatter, laid out (the same every time for the same recipe): each at a place along the stroke
 * (evenly by its length) and within the brush's reach around it (evenly over the disc), of a size between the least
 * and the most, and at a moment within the span.
 */
export function scatterItems(s: Scatter): ScatterItem[] {
  const kept = cache.get(s);
  if (kept) return kept;
  const rnd = random(s.seed + 1);
  // The stroke's length, piece by piece.
  const lengths: number[] = [0];
  for (let i = 1; i < s.path.length; i++) lengths.push(lengths[i - 1] + distance(s.path[i - 1], s.path[i]));
  const total = lengths[lengths.length - 1];
  const out: ScatterItem[] = new Array(s.count);
  for (let k = 0; k < s.count; k++) {
    let at = s.path[0];
    if (total > 0) {
      const x = rnd() * total;
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < x) i++;
      const f = (x - lengths[i - 1]) / Math.max(1e-9, lengths[i] - lengths[i - 1]);
      const a = s.path[i - 1], b = s.path[i];
      at = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    } else rnd();
    const d = s.widthKm * Math.sqrt(rnd()), bearing = rnd() * 2 * Math.PI;
    const [lon, lat] = d > 0 ? destination(at, d, bearing) : at;
    out[k] = { lon, lat, size: Math.min(SIZE_STEPS - 1, Math.floor(rnd() * SIZE_STEPS)), delay: rnd() * s.spreadDays };
  }
  cache.set(s, out);
  return out;
}

/** A size step's reach and strength, as multiples of the source's own (spread evenly on a scale of ratios). */
export function sizeFactors(s: Scatter, step: number): { reach: number; strength: number } {
  const f = SIZE_STEPS > 1 ? step / (SIZE_STEPS - 1) : 0.5;
  const mix = ([lo, hi]: [number, number]) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * f);
  return { reach: mix(s.reach), strength: mix(s.strength) };
}

/** The size of step `step` between the least and the most (spread evenly on a scale of ratios). */
export function sizeAtStep(least: number, most: number, step: number): number {
  const f = SIZE_STEPS > 1 ? step / (SIZE_STEPS - 1) : 0.5;
  return least > 0 && most > 0 ? Math.exp(Math.log(least) + (Math.log(most) - Math.log(least)) * f) : least + (most - least) * f;
}
