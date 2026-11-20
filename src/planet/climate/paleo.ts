// The climate of a moment of a history (Stage 14.8, D159): the same energy balance and rain as the present's
// (ebm.ts, hydroclimate.ts), run quickly on the coarsest level (about 1,000 km cells on an Earth-sized planet) from
// the previous moment's temperatures, over the land and sea of that moment. It sets where rain wears the land down
// (erosion's rain, relative to the planet's mean) and how much ice the land holds (which lowers the sea): where snow
// outlasts the summer, ice sheets of the size such regions carry (ice.ts). Ice ages and greenhouse periods on the
// timeline act on the air's carbon dioxide while they last.
//
// What a picture of a moment shows of its climate and life (D167) is worked out when it is wanted, from the picture's
// heights and the climate the history had then (to start from): the same energy balance, rain on finer cells (as the
// present's), then each cell's biome by the Earth's rules (biomes.ts), the year's mean temperature, its rain and how
// seasonal the rain is. (No lakes or wetlands: those need the water stage.)
import type { Mesh } from '../mesh/icosphere.ts';
import { definitionOf, type PlanetDefinition } from '../model/definition.ts';
import { derive, type Derived } from '../model/physics.ts';
import { seasonalClimate } from './ebm.ts';
import { hydroclimate, type HydroResult } from './hydroclimate.ts';
import { insolationCells, sunlightOf } from './insolation.ts';
import { iceVolumeEstimate, massBalance } from '../water/ice.ts';
import { WATER, waterBalance } from '../water/hydrology.ts';
import { BIOME_IDS, biomeOf, seasonality, type BiomeId, type Place } from '../life/biomes.ts';

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

/** The definition a history's climate settings (and its carbon dioxide's factor at a moment) describe. */
function definitionAt(climateDef: unknown, co2: number): PlanetDefinition {
  const base = definitionOf(climateDef)!;
  return { ...base, atmosphere: { ...base.atmosphere, co2: base.atmosphere.co2 * co2 } };
}

/** The land (1) and, on it, where snow outlasts the summer (1). */
function snowyLand(n: number, heightM: ArrayLike<number>, hy: HydroResult, x: Derived): { land: Uint8Array; snowy: Uint8Array } {
  const land = new Uint8Array(n), snowy = new Uint8Array(n), T = new Float64Array(12), P = new Float64Array(12);
  for (let c = 0; c < n; c++) {
    if (!(heightM[c] >= 0)) continue;
    land[c] = 1;
    for (let m = 0; m < 12; m++) { T[m] = hy.tempMonthly[m * n + c]; P[m] = hy.precipMonthly[m * n + c]; }
    if (massBalance(T, P, x.yearDays / 12).balance > 0) snowy[c] = 1;
  }
  return { land, snowy };
}

/** The climate of a moment over its heights (m above the sea), from the last moment's (its temperatures: a warm start) if any. */
export function paleoClimate(mesh: Mesh, heightM: ArrayLike<number>, climateDef: unknown, co2: number, prev: { coarseK: Float64Array } | null): PaleoClimate {
  const def = definitionAt(climateDef, co2);
  const x = derive(def), n = mesh.n;
  // (A history's first climate starts as it always has, from one even temperature: D168 leaves histories as they were.)
  const cl = seasonalClimate(mesh, def, x, heightM, { level: PALEO_LEVEL, initialK: prev?.coarseK, maxYears: prev ? 4 : 40, minYears: prev ? 2 : 3, tolerance: 0.05, ...(prev ? {} : { start: 'even' as const, extrapolateAt: 0 }) });
  const hy = hydroclimate(mesh, def, x, heightM, cl.monthly, PALEO_LEVEL, cl.dryWarm, 3);
  const rain = new Float64Array(n);
  let mean = 0;
  for (let c = 0; c < n; c++) { rain[c] = hy.precipAnnual[c]; mean += rain[c] * mesh.area[c]; }
  mean /= 4 * Math.PI;
  if (mean > 0) for (let c = 0; c < n; c++) rain[c] /= mean; else rain.fill(1);
  // Land where snow outlasts the summer.
  const { land, snowy } = snowyLand(n, heightM, hy, x);
  return { rain, ice: iceVolumeEstimate(mesh, def.body.radiusKm, land, snowy), coarseK: cl.coarseK, meanK: cl.meanK };
}

/**
 * What a picture of a moment shows of its climate and life (D167), per cell: the biome by the Earth's rules (an
 * index of BIOME_IDS: the sea below the sea's level, ice where snow outlasts the summer), the year's mean
 * temperature (°C), its rain and snow (mm) and how seasonal the rain is (0 to 255).
 */
export interface PaleoPicture {
  biome: Uint8Array;
  temp: Int8Array;
  rain: Uint16Array;
  season: Uint8Array;
}

/** The level the rain of a picture is worked out on (the present's, D158: about 480 km cells on an Earth-sized planet). */
export const PICTURE_RAIN_LEVEL = 4;
const BIOME_INDEX = new Map<BiomeId, number>(BIOME_IDS.map((b, i) => [b, i]));

/** Sunlight at the top of the air each month per cell (the same through a history): the last few kept. */
const sunKept = new Map<string, Float32Array>();
function sunOf(mesh: Mesh, def: PlanetDefinition, x: Derived): Float32Array {
  const s = sunlightOf(def, x), key = `${mesh.level}:${JSON.stringify(s)}`;
  let m = sunKept.get(key);
  if (!m) {
    m = insolationCells(mesh, s, 0, mesh.n).monthly;
    if (sunKept.size >= 4) sunKept.delete(sunKept.keys().next().value!);
    sunKept.set(key, m);
  }
  return m;
}

/**
 * What a picture of a moment shows (D167), from its heights (m above the sea), the history's climate settings, the
 * carbon dioxide's factor then and the climate the history had then (its coarse temperatures, K: a warm start).
 */
export function momentPicture(mesh: Mesh, heightM: ArrayLike<number>, climateDef: unknown, co2: number, warmK: Float64Array | null): PaleoPicture {
  const def = definitionAt(climateDef, co2);
  const x = derive(def), n = mesh.n;
  const cl = seasonalClimate(mesh, def, x, heightM, { level: PALEO_LEVEL, initialK: warmK ?? undefined, maxYears: warmK ? 4 : 40, minYears: warmK ? 2 : 3, tolerance: 0.05 });
  const hy = hydroclimate(mesh, def, x, heightM, cl.monthly, PICTURE_RAIN_LEVEL, cl.dryWarm, 3);
  const { land, snowy } = snowyLand(n, heightM, hy, x);
  // Evaporation as the water stage works it out, then each cell's biome.
  const pet = waterBalance(n, hy.tempMonthly, hy.precipMonthly, sunOf(mesh, def, x), land, x.yearDays / 12).pet;
  const picture: PaleoPicture = { biome: new Uint8Array(n), temp: new Int8Array(n), rain: new Uint16Array(n), season: new Uint8Array(n) };
  const T = new Float64Array(12), P = new Float64Array(12), place: Place = { temp: T, precip: P, pet: 0, height: 0, water: 0, ice: 0 };
  for (let c = 0; c < n; c++) {
    let mat = 0, map = 0;
    for (let m = 0; m < 12; m++) { T[m] = hy.tempMonthly[m * n + c]; P[m] = Math.max(0, hy.precipMonthly[m * n + c]); mat += T[m] / 12; map += P[m]; }
    place.pet = pet[c]; place.height = heightM[c]; place.water = !land[c] ? WATER.sea : snowy[c] ? WATER.ice : WATER.land;
    picture.biome[c] = BIOME_INDEX.get(biomeOf(place))!;
    picture.temp[c] = Math.max(-128, Math.min(127, Math.round(mat)));
    picture.rain[c] = Math.max(0, Math.min(65_535, Math.round(map)));
    picture.season[c] = Math.round(255 * seasonality(P));
  }
  return picture;
}
