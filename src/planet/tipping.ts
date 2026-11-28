// Tipping points (D265): the values of a setting at which a planet becomes another kind of world, found from the
// same rules its pictures follow (physics.ts: whether it holds its air, what becomes of its water) by trying values
// along the setting's range; and, for where its seas freeze over, from the climate itself.
import type { PlanetDefinition } from './model/definition.ts';
import { WATER_TRIPLE_BAR, airState, derive, waterState, withAirAsItIs } from './model/physics.ts';

/**
 * The value between `lo` and `hi` at which `ok` changes (to within a few thousandths of the range, by halving it;
 * `log`: in equal ratios); null when it is the same at both ends.
 */
export function boundary(lo: number, hi: number, ok: (v: number) => boolean, opts: { log?: boolean; steps?: number } = {}): number | null {
  const to = (v: number) => (opts.log ? Math.log(v) : v), from = (u: number) => (opts.log ? Math.exp(u) : u);
  let a = to(lo), b = to(hi);
  const atA = ok(lo);
  if (atA === ok(hi)) return null;
  for (let i = 0; i < (opts.steps ?? 16); i++) {
    const m = (a + b) / 2;
    if (ok(from(m)) === atA) a = m; else b = m;
  }
  return from((a + b) / 2);
}

/** The same where trying a value takes time (a climate worked out): fewer steps, each awaited; stops when `signal` is aborted. */
export async function boundaryAsync(lo: number, hi: number, ok: (v: number) => Promise<boolean>, opts: { log?: boolean; steps?: number; signal?: AbortSignal } = {}): Promise<number | null> {
  const to = (v: number) => (opts.log ? Math.log(v) : v), from = (u: number) => (opts.log ? Math.exp(u) : u);
  let a = to(lo), b = to(hi);
  const atA = await ok(lo);
  if (opts.signal?.aborted) return null;
  if (atA === (await ok(hi))) return null;
  for (let i = 0; i < (opts.steps ?? 6); i++) {
    if (opts.signal?.aborted) return null;
    const m = (a + b) / 2;
    if ((await ok(from(m))) === atA) a = m; else b = m;
  }
  return from((a + b) / 2);
}

/** A mark on a setting's slider: beyond `at`, on the side named, the planet is what `label` says. */
export interface Mark {
  at: number;
  /** Which side of `at` the label holds on: values below it or above it. */
  side: 'below' | 'above';
  /** hot: the seas boil away; air: the air is lost; thin: too little air for liquid water; cold: the seas freeze over. */
  tone: 'hot' | 'air' | 'thin' | 'cold';
  label: string;
}

export type MarkedSetting = 'distance' | 'starMass' | 'pressure' | 'co2' | 'radius';
/** The ranges the Studio's sliders cover. */
export const RANGES: Record<MarkedSetting, [number, number]> = { distance: [0.02, 10], starMass: [0.1, 3], pressure: [1e-4, 100], co2: [1e-6, 0.97], radius: [1000, 16_000] };

const set: Record<MarkedSetting, (d: PlanetDefinition, v: number) => PlanetDefinition> = {
  distance: (d, v) => ({ ...d, orbit: { ...d.orbit, semiMajorAu: v } }),
  starMass: (d, v) => ({ ...d, star: { ...d.star, stars: d.star.stars.map((s, i) => (i === 0 ? { ...s, massSun: v } : s)) } }),
  pressure: (d, v) => ({ ...d, atmosphere: { ...d.atmosphere, pressureBar: v } }),
  co2: (d, v) => ({ ...d, atmosphere: { ...d.atmosphere, co2: v } }),
  radius: (d, v) => ({ ...d, body: { ...d.body, radiusKm: v } }),
};
/** A definition with one of the marked settings at another value. */
export const withSetting = (d: PlanetDefinition, setting: MarkedSetting, v: number): PlanetDefinition => set[setting](d, v);

const num = (v: number, d: number) => v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
const say: Record<MarkedSetting, (v: number) => string> = {
  distance: (v) => `${num(v, v < 0.1 ? 3 : 2)} AU`, starMass: (v) => `${num(v, 2)} Suns`, pressure: (v) => `${num(v, v < 0.1 ? 3 : 1)} bar`,
  co2: (v) => `${num(100 * v, v < 0.001 ? 3 : v < 0.1 ? 1 : 0)} %`, radius: (v) => `${num(Math.round(v / 10) * 10, 0)} km`,
};
/** A setting's value in words, as its marks say it. */
export const settingInWords = (setting: MarkedSetting, v: number): string => say[setting](v);

/**
 * The marks of one setting that follow from the rules alone (no climate to work out): where the planet loses its air,
 * where its seas boil away, where there is too little air for liquid water; on the planet as it is otherwise.
 * `liquidShare`: the share of the surface its seas would cover (the sea stage's), 0 with no water.
 */
export function tippingPoints(def: PlanetDefinition, liquidShare: number, setting: MarkedSetting): Mark[] {
  const out: Mark[] = [];
  const wet = (def.water.depthKm ?? 0) > 0 && liquidShare > 0 && !def.water.keep;
  const airy = def.atmosphere.pressureBar > 0 && !def.atmosphere.keep;
  const held = (d: PlanetDefinition) => airState(d).held;
  const boiled = (d: PlanetDefinition) => waterState(withAirAsItIs(d), liquidShare).fate === 'boiled';
  const [lo, hi] = RANGES[setting];
  if (setting === 'distance' || setting === 'starMass' || setting === 'radius') {
    // The air: lost close to the star, under a bright star, on a small planet.
    const air = airy ? boundary(lo, hi, (v) => held(withSetting(def, setting, v)), { log: true }) : null;
    if (air !== null) out.push({ at: air, side: setting === 'starMass' ? 'above' : 'below', tone: 'air', label: `no air ${setting === 'starMass' ? 'above' : setting === 'radius' ? 'below' : 'inside'} ${say[setting](air)}` });
    // The seas boil away: close in, under a bright star (searched on the side where the planet still holds its air).
    if (wet && setting !== 'radius') {
      const from = setting === 'distance' ? Math.max(lo, (air ?? lo) * 1.0001) : lo, to = setting === 'starMass' ? Math.min(hi, (air ?? hi) * 0.9999) : hi;
      const at = from < to ? boundary(from, to, (v) => boiled(withSetting(def, setting, v)), { log: true }) : null;
      if (at !== null) out.push({ at, side: setting === 'starMass' ? 'above' : 'below', tone: 'hot', label: `seas boil away ${setting === 'starMass' ? 'above' : 'inside'} ${say[setting](at)}` });
    }
  } else if (wet) {
    // Too strong a greenhouse: more carbon dioxide, more air.
    const at = boundary(setting === 'pressure' ? WATER_TRIPLE_BAR : lo, hi, (v) => boiled(withSetting(def, setting, v)), { log: true });
    if (at !== null) out.push({ at, side: 'above', tone: 'hot', label: `seas boil away above ${say[setting](at)}` });
    // Too little air for liquid water (if the planet holds its air at all).
    if (setting === 'pressure' && (def.atmosphere.keep || held(def))) out.push({ at: WATER_TRIPLE_BAR, side: 'below', tone: 'thin', label: `no liquid water below ${say.pressure(WATER_TRIPLE_BAR)}` });
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * A first guess of where the seas freeze over along a setting (distance or carbon dioxide), from the planet's balance
 * as a whole: the value at which its mean falls to about freezing. For bracketing the search with the climate itself.
 */
export function freezeGuess(def: PlanetDefinition, liquidShare: number, setting: 'distance' | 'co2'): number | null {
  const [lo, hi] = RANGES[setting];
  const cold = (v: number) => {
    const d = withAirAsItIs(withSetting(def, setting, v));
    return derive({ ...d, water: { ...d.water, oceanFraction: liquidShare } }).surfaceK < 273.15 + 3;
  };
  return boundary(lo, hi, cold, { log: true });
}
