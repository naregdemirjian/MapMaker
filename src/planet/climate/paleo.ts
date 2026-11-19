// The climate of a moment of a history (Stage 14.8, D159): the same energy balance and rain as the present's
// (ebm.ts, hydroclimate.ts), run quickly on the coarsest level (about 1,000 km cells on an Earth-sized planet) from
// the previous moment's temperatures, over the land and sea of that moment. It sets where rain wears the land down
// (erosion's rain, relative to the planet's mean) and how much ice the land holds (which lowers the sea): where snow
// outlasts the summer, ice sheets of the size such regions carry (ice.ts). Ice ages and greenhouse periods on the
// timeline act on the air's carbon dioxide while they last.
import type { Mesh } from '../mesh/icosphere.ts';
import { definitionOf, type PlanetDefinition } from '../model/definition.ts';
import { derive } from '../model/physics.ts';
import { seasonalClimate } from './ebm.ts';
import { hydroclimate } from './hydroclimate.ts';
import { iceVolumeEstimate, massBalance } from '../water/ice.ts';

/** The level a past climate runs at. */
export const PALEO_LEVEL = 3;

export interface PaleoClimate {
  /** Rain over the year relative to the planet's mean (mean 1), per cell of the history's mesh. */
  rain: Float64Array;
  /** Ice held on land, m³; and the warm start for the next moment. */
  ice: number;
  coarseK: Float64Array;
  /** The planet's mean temperature, K. */
  meanK: number;
}

/** How the timeline's climate events change the air's carbon dioxide (a factor) while they last. */
export function co2Factor(events: Array<{ kind: string; strength: number }>): number {
  let f = 1;
  for (const e of events) {
    if (e.kind === 'ice-age') f *= 0.5 ** Math.max(0, e.strength);
    if (e.kind === 'greenhouse') f *= 2 ** (1.5 * Math.max(0, e.strength));
  }
  return f;
}

export function paleoClimate(mesh: Mesh, heightM: ArrayLike<number>, climateDef: unknown, co2: number, prev: PaleoClimate | null): PaleoClimate {
  const base = definitionOf(climateDef)!;
  const def: PlanetDefinition = { ...base, atmosphere: { ...base.atmosphere, co2: base.atmosphere.co2 * co2 } };
  const x = derive(def), n = mesh.n;
  const cl = seasonalClimate(mesh, def, x, heightM, { level: PALEO_LEVEL, initialK: prev?.coarseK, maxYears: prev ? 4 : 40, minYears: prev ? 2 : 3, tolerance: 0.05 });
  const hy = hydroclimate(mesh, def, x, heightM, cl.monthly, PALEO_LEVEL, cl.dryWarm, 3);
  const rain = new Float64Array(n);
  let mean = 0;
  for (let c = 0; c < n; c++) { rain[c] = hy.precipAnnual[c]; mean += rain[c] * mesh.area[c]; }
  mean /= 4 * Math.PI;
  if (mean > 0) for (let c = 0; c < n; c++) rain[c] /= mean; else rain.fill(1);
  // Land where snow outlasts the summer.
  const land = new Uint8Array(n), snowy = new Uint8Array(n), T = new Float64Array(12), P = new Float64Array(12);
  for (let c = 0; c < n; c++) {
    if (!(heightM[c] >= 0)) continue;
    land[c] = 1;
    for (let m = 0; m < 12; m++) { T[m] = hy.tempMonthly[m * n + c]; P[m] = hy.precipMonthly[m * n + c]; }
    if (massBalance(T, P, x.yearDays / 12).balance > 0) snowy[c] = 1;
  }
  return { rain, ice: iceVolumeEstimate(mesh, def.body.radiusKm, land, snowy), coarseK: cl.coarseK, meanK: cl.meanK };
}
