// Landscape evolution (Stage 14.4, D155): rivers cutting down, hillslopes creeping, sediment carried to where it
// settles. Physically based process laws with constants calibrated for the coarse cells the history runs on.
//
//  - Fluvial incision follows the stream-power law, rock removed at R = K Q^m S (Whipple and Tucker 1999), Q the
//    water draining through a cell (its area and everything upstream, weighted by rain), S the slope to the cell
//    it drains to, m = ½, n = 1; with a threshold slope below which lowland rivers carry sediment but cut no
//    bedrock (at these cell sizes trunk rivers on cratons would otherwise wear whole continents flat). Solved implicitly from the outlets upwards (Braun and Willett 2013), so it is
//    stable at the geological steps the history takes. Removing rock lets the crust rise isostatically: the surface
//    falls by only β of the rock removed (about 0.15 for continental crust), as height comes from the crust.
//  - Hillslopes creep: rock moves downslope between neighbouring land cells at a rate proportional to the
//    difference in height (linear diffusion), standing in, at these cell sizes, for landslides and soil creep.
//  - Sediment: what rivers remove travels downstream; it fills closed depressions up to their sills, part of it
//    settles on lowland plains where the slope is gentle, and the rest reaches the sea, where it builds deltas and
//    spreads along the shelf. Nothing is lost: every cubic kilometre removed is laid down somewhere.
import type { Mesh } from '../mesh/icosphere.ts';
import { accumulate, drainage, type Drainage } from './drainage.ts';

export interface LandscapeParams {
  /** Step, Myr. */
  dt: number;
  /** Erodibility, Myr⁻¹ km^(1−2m) for Q in km² (of area, weighted by rain). */
  K: number;
  m: number;
  /** Hillslope diffusivity, km²/Myr. */
  kappa: number;
  /** Below this slope rivers carry sediment but cut no bedrock (lowland rivers, transport-limited); 0 for none. */
  threshold?: number;
  /** How far the surface falls per km of rock removed (isostasy; 1 for a surface that does not rebound). */
  beta: number | ArrayLike<number>;
  radiusKm: number;
  /** Heights below this are sea (km; -Infinity for no sea). */
  seaLevel: number;
  /** Relative rain per cell (mean 1), or none for even rain. */
  rain?: ArrayLike<number> | null;
}

export interface LandscapeResult {
  drainage: Drainage;
  /** Water draining through each cell (km², weighted by rain). */
  discharge: Float64Array;
  /** Rock removed by rivers (km, ≥ 0) and rock gained (+) or lost (−) by creep, per cell. */
  incision: Float64Array;
  creep: Float64Array;
  /** Sediment laid down per cell, km. */
  deposit: Float64Array;
  /** Volumes over the step, km³: removed by rivers, laid down. */
  eroded: number;
  deposited: number;
}

/** Erodibility of an Earth-like climate: a 5 km range drained by a large river loses about half a km of rock a Myr. */
export const EARTH_K = 0.15;

export function landscapeStep(mesh: Mesh, z: ArrayLike<number>, p: LandscapeParams): LandscapeResult {
  const { n, nbrStart, nbr, edgeDist, edgeLen } = mesh;
  const R = p.radiusKm, km2 = R * R;
  const sea = new Uint8Array(n);
  let anySea = false;
  for (let c = 0; c < n; c++) if (z[c] < p.seaLevel) { sea[c] = 1; anySea = true; }
  const d = drainage(mesh, z, anySea ? sea : null, R);
  const area = new Float64Array(n);
  for (let c = 0; c < n; c++) area[c] = mesh.area[c] * km2 * (p.rain ? Math.max(0, p.rain[c]) : 1);
  const Q = accumulate(d, area);
  const beta = (c: number) => (typeof p.beta === 'number' ? p.beta : p.beta[c]);
  // Rivers: implicit stream power from the outlets upwards.
  const zNew = new Float64Array(n), incision = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const c = d.order[k], r = d.receiver[c];
    if (r === c || sea[c]) { zNew[c] = z[c]; continue; }
    // A river reaching the sea cuts down to the sea's level, not to the sea floor; and only where it is steeper
    // than the threshold (R = K Q^m (S − Sc)).
    const base = (sea[r] ? Math.max(zNew[r], p.seaLevel) : zNew[r]) + (p.threshold ?? 0) * d.length[c];
    if (z[c] <= base) { zNew[c] = z[c]; continue; }
    const F = (p.K * p.dt * Q[c] ** p.m) / d.length[c], b = beta(c);
    zNew[c] = (z[c] + b * F * base) / (1 + b * F);
    incision[c] = (z[c] - zNew[c]) / b;
  }
  // Hillslopes: rock creeps between land cells, in substeps short enough to be stable.
  const creep = new Float64Array(n);
  let minL2 = Infinity;
  for (let e = 0; e < edgeDist.length; e++) minL2 = Math.min(minL2, (edgeDist[e] * R) ** 2);
  const sub = Math.max(1, Math.ceil((p.kappa * p.dt) / (0.2 * minL2)));
  const h = Float64Array.from(zNew), cellKm2 = new Float64Array(n);
  for (let c = 0; c < n; c++) cellKm2[c] = mesh.area[c] * km2;
  for (let s = 0; s < sub; s++) {
    const dh = new Float64Array(n);
    for (let c = 0; c < n; c++) {
      if (sea[c]) continue;
      for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) {
        const j = nbr[e];
        if (j < c || sea[j]) continue;
        // Rock moved from the higher to the lower cell (km³).
        const v = ((p.kappa * p.dt) / sub) * ((h[c] - h[j]) / (edgeDist[e] * R)) * (edgeLen[e] * R);
        dh[c] -= v / cellKm2[c]; dh[j] += v / cellKm2[j];
      }
    }
    for (let c = 0; c < n; c++) { creep[c] += dh[c]; h[c] += beta(c) * dh[c]; }
  }
  // Sediment: carried down from the heads of the rivers, settling in depressions, on plains, and in the sea.
  const load = new Float64Array(n), deposit = new Float64Array(n);
  let eroded = 0;
  for (let c = 0; c < n; c++) { load[c] = incision[c] * cellKm2[c]; eroded += load[c]; }
  for (let k = n - 1; k >= 0; k--) {
    const c = d.order[k], r = d.receiver[c];
    let here = load[c];
    if (here <= 0) continue;
    let settle = 0;
    if (r === c || sea[c]) settle = here;
    else if (d.filled[c] > z[c] + 1e-6) settle = Math.min(here, ((d.filled[c] - z[c]) / 0.3) * cellKm2[c]);
    else {
      const slope = (z[c] - z[r]) / d.length[c];
      settle = here * 0.3 * Math.max(0, Math.min(1, 1 - slope / 0.0015));
    }
    deposit[c] += settle / cellKm2[c];
    here -= settle;
    if (here > 0 && r !== c) load[r] += here;
  }
  // In the sea, sediment spreads along the shelf from where rivers bring it.
  if (anySea) {
    for (let it = 0; it < 4; it++) {
      const moved = new Float64Array(n);
      for (let c = 0; c < n; c++) {
        if (!sea[c] || deposit[c] <= 0) continue;
        let k = 0;
        for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) if (sea[nbr[e]]) k++;
        if (!k) continue;
        const out = 0.5 * deposit[c] * cellKm2[c];
        moved[c] -= out / cellKm2[c];
        for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) { const j = nbr[e]; if (sea[j]) moved[j] += out / k / cellKm2[j]; }
      }
      for (let c = 0; c < n; c++) deposit[c] += moved[c];
    }
  }
  let deposited = 0;
  for (let c = 0; c < n; c++) deposited += deposit[c] * cellKm2[c];
  return { drainage: d, discharge: Q, incision, creep, deposit, eroded, deposited };
}

/**
 * Relative rain by latitude (mean about 1), a stand-in for the climate until the history is coupled to it (Stage
 * 14.8): wet near the equator where the trade winds meet, dry at the edges of the Hadley cells (the subtropical
 * deserts), wetter again in the storm belts beyond, dry near the poles. `hadleyDeg` from the planet's physics.
 */
export function zonalRain(latDeg: number, hadleyDeg: number): number {
  const a = Math.abs(latDeg);
  return 0.35 + 1.5 * Math.exp(-((a / 11) ** 2)) - 0.25 * Math.exp(-(((a - hadleyDeg + 5) / 9) ** 2)) + 0.75 * Math.exp(-(((a - Math.min(80, hadleyDeg + 20)) / 13) ** 2));
}
