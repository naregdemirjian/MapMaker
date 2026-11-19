// Height from the crust (Stage 14.2, D153). Physically based relations with Earth-calibrated constants:
//  - oceanic crust sinks as it cools and ages: depth 2.6 km + 0.365 km·√age for young crust, flattening towards
//    5.65 km (the GDH1 plate model; Stein and Stein 1992);
//  - continental crust floats on the mantle by its thickness (Airy isostasy): a column of crust h km thick stands
//    h·(ρm − ρc)/ρm above the level where the mantle would be, less a reference; below the sea the water's weight
//    deepens it by ρm/(ρm − ρw);
//  - arc crust, between the two, is weighted between them by its thickness.
// Heights are km above a datum; sea level is set afterwards from the water (seaLevelFor).
import { CRUST } from './plates.ts';

export const RHO_MANTLE = 3.3, RHO_CONTINENT = 2.8, RHO_WATER = 1.03;
/** Earth's continental crust: 35 km stands about 0.5 km above the sea; this is the reference that gives it. */
const AIRY_REFERENCE = (35 * (RHO_MANTLE - RHO_CONTINENT)) / RHO_MANTLE - 0.5;
/** The datum: a ridge crest (age 0) stands 2.6 km below the sea of an Earth-like planet. */

/** Depth of oceanic crust below a ridge-crest datum's sea, km, by age (Myr): GDH1. */
export function oceanDepth(ageMyr: number): number {
  const t = Math.max(0, ageMyr);
  return t < 20 ? 2.6 + 0.365 * Math.sqrt(t) : 5.651 - 2.473 * Math.exp(-0.0278 * t);
}

/** Height of a continental column (km above an Earth-like sea) by its thickness (km). */
export function airyHeight(thicknessKm: number): number {
  const e = (thicknessKm * (RHO_MANTLE - RHO_CONTINENT)) / RHO_MANTLE - AIRY_REFERENCE;
  return e >= 0 ? e : (e * RHO_MANTLE) / (RHO_MANTLE - RHO_WATER);
}

/** Height (km, Earth-like sea at 0) of a column of crust of a kind, thickness and age. */
export function crustHeight(kind: number, thicknessKm: number, ageMyr: number): number {
  if (kind === CRUST.continental) return airyHeight(thicknessKm);
  // Oceanic crust thicker than usual (plateaus, arcs on oceanic plates) stands higher in proportion.
  const ocean = -oceanDepth(ageMyr) + 0.15 * (thicknessKm - 7);
  if (kind !== CRUST.arc) return ocean;
  const w = Math.max(0, Math.min(1, (thicknessKm - 10) / 15));
  return (1 - w) * ocean + w * Math.max(ocean, airyHeight(thicknessKm));
}

/**
 * The sea level (km on the same datum) at which the given share of the surface is under water, from the heights of
 * the cells and their areas (a histogram of heights by area, then within the bin: O(n), a few metres' precision).
 */
export function seaLevelFor(height: ArrayLike<number>, area: ArrayLike<number>, oceanFraction: number): number {
  const n = height.length;
  if (oceanFraction <= 0) return -Infinity;
  if (oceanFraction >= 1) return Infinity;
  let min = Infinity, max = -Infinity, total = 0;
  for (let i = 0; i < n; i++) { const h = height[i]; if (h < min) min = h; if (h > max) max = h; total += area[i]; }
  if (!(max > min)) return min;
  const B = 16_384, w = (max - min) / B, bins = new Float64Array(B + 1);
  for (let i = 0; i < n; i++) bins[Math.min(B, Math.floor((height[i] - min) / w))] += area[i];
  const target = oceanFraction * total;
  let acc = 0;
  for (let k = 0; k <= B; k++) {
    if (acc + bins[k] >= target) return min + (k + (target - acc) / bins[k]) * w;
    acc += bins[k];
  }
  return max;
}
