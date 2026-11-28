// The day and night of ground with little or no air over it (D262).
//
// Under thick air the ground's temperature hardly changes between day and night: the air holds heat and gives it
// back. With thin air or none the ground is on its own: by day as hot as the sunlight it takes in makes it, by night
// cooling towards space, held up only by the heat stored in its top few centimetres. Because the heat it loses goes
// as the fourth power of its temperature, a hot day loses far more than a cold night saves, and the mean over the
// day is lower than that of ground lit evenly (the Moon's equator: about 215 K, against 290 K were its light
// spread over the day).
//
// The ground is a column of layers heated from above (conduction, implicit in time), their thickness in units of the
// depth the day's wave reaches (the skin depth √(κP/π)), so that the ground's thermal inertia Γ = √(kρc) and the
// length of the day P are all that describe it. Its surface takes in the sunlight of each moment of the day at its
// latitude and season and loses σT⁴ (less what the air's greenhouse holds). Run over a few days until the day
// repeats; the deep ground settles at the day's mean.
import { SIGMA } from '../model/units.ts';
import { orbitAt, type Sunlight } from './insolation.ts';

/** The ground's thermal inertia (J m⁻² K⁻¹ s⁻½): the loose dust of an airless world (the Moon: about 50), the firmer ground under thin air (Mars: about 250). */
export const INERTIA_AIRLESS = 60, INERTIA_THIN_AIR = 250;
/** Of ground hot enough to sinter and melt (solid and molten rock: about 2,000): from 700 K the dust begins to fuse, by 1,100 K it is rock. */
export const INERTIA_ROCK = 2000;
export const groundInertia = (pressureBar: number): number => INERTIA_AIRLESS + (INERTIA_THIN_AIR - INERTIA_AIRLESS) * Math.max(0, Math.min(1, pressureBar / 0.006));
/** How much of the ground's own day and night shows, by the air over it (bar): all of it under a hundredth of a bar, none from a tenth. */
export const dayShare = (pressureBar: number): number => Math.max(0, Math.min(1, (0.1 - pressureBar) / 0.09));

/** The thickness of the column's layers, in skin depths, from the surface down. */
const LAYERS = [0.06, 0.09, 0.14, 0.2, 0.3, 0.45, 0.7, 1.05, 1.6, 2.4];

export interface DayCycle {
  /** The surface's mean, highest and lowest temperature over the day (K). */
  mean: number;
  max: number;
  min: number;
  /** The temperature of the same ground were the day's light spread evenly over the day (K); 0 where the sun does not rise. */
  even: number;
}

/**
 * The day's cycle of ground with little or no air: `overhead` the light it would take in with the sun overhead
 * (W/m², after its albedo), at a latitude and for a declination of the sun (radians), over a day of `daySeconds`,
 * with the ground's thermal inertia; `hold` is how much of the heat it loses the air sends back (1 + ¾τ; 1 with no
 * air). Where the sun does not rise all day, `even` is 0 and the rest are too: the season's stored heat decides.
 */
export function dayCycle(overhead: number, lat: number, dec: number, daySeconds: number, inertia: number, hold = 1): DayCycle {
  const N = 64, L = LAYERS.length, dt = daySeconds / N, emit = SIGMA / hold;
  const q = new Float64Array(N);
  let qbar = 0;
  for (let k = 0; k < N; k++) {
    const h = (2 * Math.PI * (k + 0.5)) / N - Math.PI;
    q[k] = overhead * Math.max(0, Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h));
    qbar += q[k] / N;
  }
  // (No sun to speak of all day: at the pole itself, or in the polar night.)
  if (!(qbar > 1e-4 * overhead)) return { mean: 0, max: 0, min: 0, even: 0 };
  const even = (qbar / emit) ** 0.25;
  // (Ground hot enough to fuse holds and carries heat as rock does, not as dust.)
  const fused = Math.max(0, Math.min(1, (even - 700) / 400)), gamma = inertia + fused * Math.max(0, INERTIA_ROCK - inertia);
  // Heat held by each layer (J/m²K) and carried between neighbours (W/m²K).
  const unit = gamma * Math.sqrt(daySeconds / Math.PI), pass = gamma * Math.sqrt(Math.PI / daySeconds);
  const C = LAYERS.map((t) => unit * t), G = LAYERS.slice(0, -1).map((t, i) => pass / ((t + LAYERS[i + 1]) / 2));
  const T = new Float64Array(L).fill(even), old = new Float64Array(L), a = new Float64Array(L), b = new Float64Array(L), c = new Float64Array(L), r = new Float64Array(L);
  const depth = LAYERS.map((_, i) => Math.min(1, LAYERS.slice(0, i + 1).reduce((s2, t) => s2 + t, 0) / 3));
  let mean = even, max = even, min = even;
  for (let day = 0; day < 8; day++) {
    let sum = 0, hi = -Infinity, lo = Infinity;
    for (let k = 0; k < N; k++) {
      // Implicit in time. The heat lost goes as the fourth power of the surface's temperature at the step's end:
      // found by Newton's method (linearised about the last estimate, a few times: once, from the cold of dawn,
      // overshoots far above what the sunlight can make).
      for (let i = 0; i < L; i++) old[i] = T[i];
      let about = old[0];
      for (let it = 0; it < 6; it++) {
        for (let i = 0; i < L; i++) {
          const up = i > 0 ? G[i - 1] : 0, down = i < L - 1 ? G[i] : 0;
          a[i] = -up; c[i] = -down; b[i] = C[i] / dt + up + down; r[i] = (C[i] / dt) * old[i];
        }
        const slope = 4 * emit * about ** 3;
        b[0] += slope; r[0] += q[k] - emit * about ** 4 + slope * about;
        for (let i = 1; i < L; i++) { const m = a[i] / b[i - 1]; b[i] -= m * c[i - 1]; r[i] -= m * r[i - 1]; }
        T[L - 1] = r[L - 1] / b[L - 1];
        for (let i = L - 2; i >= 0; i--) T[i] = (r[i] - c[i] * T[i + 1]) / b[i];
        if (!(T[0] > 1)) T[0] = 1;
        const moved = Math.abs(T[0] - about);
        about = T[0];
        if (moved < 0.05) break;
      }
      sum += T[0]; hi = Math.max(hi, T[0]); lo = Math.min(lo, T[0]);
    }
    const now = sum / N, settled = Math.abs(now - mean) < 0.05 && day > 1;
    mean = now; max = hi; min = lo;
    if (settled) break;
    // The deep ground, which the day's wave does not reach, settles at the day's mean: put there at once.
    for (let i = 0; i < L; i++) T[i] += depth[i] * (mean - T[i]);
  }
  return { mean, max, min, even };
}

/** The day's cycle by latitude and month, as shares of the temperature of evenly lit ground: what an airless world's day and night do to its year's temperatures. */
export interface DayCycles {
  /** Latitudes (radians, south to north) and, for each month and latitude (month·rows + row), the mean, highest and lowest as shares of the even temperature (1 where the sun does not rise). */
  lats: Float64Array;
  mean: Float32Array;
  max: Float32Array;
  min: Float32Array;
}

/**
 * The table for a planet: its sunlight through the year, the albedo of its ground, the length of its day (seconds
 * from noon to noon), its ground's thermal inertia and what its air holds.
 */
export function dayCycles(sun: Sunlight, albedo: number, daySeconds: number, inertia: number, hold = 1, months = 12): DayCycles {
  const rows = 19, lats = new Float64Array(rows);
  for (let k = 0; k < rows; k++) lats[k] = -Math.PI / 2 + (k * Math.PI) / (rows - 1);
  const mean = new Float32Array(months * rows).fill(1), max = new Float32Array(months * rows).fill(1), min = new Float32Array(months * rows).fill(1);
  for (let m = 0; m < months; m++) {
    const at = orbitAt((m + 0.5) / months, sun.eccentricity, sun.perihelionDeg);
    const dec = Math.asin(Math.sin(sun.tilt) * Math.sin(at.lambda)), overhead = (sun.S * (1 - albedo)) / (at.r * at.r);
    for (let k = 0; k < rows; k++) {
      const d = dayCycle(overhead, lats[k], dec, daySeconds, inertia, hold);
      if (!(d.even > 0)) continue;
      // (Within what a day can do: the mean never above the even one; the high and the low within bounds.)
      mean[m * rows + k] = Math.max(0.3, Math.min(1, d.mean / d.even)); max[m * rows + k] = Math.max(1, Math.min(2.5, d.max / d.even)); min[m * rows + k] = Math.max(0.05, Math.min(1, d.min / d.even));
    }
  }
  return { lats, mean, max, min };
}

/** A table's value for a month at a latitude (radians), between its rows. */
export function cycleAt(table: Float32Array, lats: Float64Array, month: number, lat: number): number {
  const rows = lats.length, f = Math.max(0, Math.min(rows - 1, ((lat + Math.PI / 2) / Math.PI) * (rows - 1)));
  const k0 = Math.min(rows - 2, Math.floor(f)), t = f - k0;
  return table[month * rows + k0] * (1 - t) + table[month * rows + k0 + 1] * t;
}
