// Temperature through the year (Stage 14.6, D157): a seasonal energy-balance model on the mesh (after North 1975;
// North, Cahalan and Coakley 1981), physically based, with parameters calibrated on the Earth.
//
//   C ∂T/∂t = S(1 − α) − OLR(T) + ∇·(D ∇T)
//
// - S: the sunlight of the moment at each cell (insolation.ts: any orbit, tilt, tidal locking, two stars).
// - α: the albedo of the cell: clouds over a clear sky that scatters light back (Rayleigh, more for more air) over
//   the surface: dark sea, land, and bright sea ice and snow where it is cold (the ice-albedo feedback, which gives
//   ice ages and snowball states); as the planet-wide estimate in physics.ts, cell by cell.
// - OLR: the heat the planet gives off to space through a grey atmosphere, σT⁴ / (1 + ¾τ), τ the infrared optical
//   depth from its carbon dioxide, methane and (rising with temperature) water vapour (physics.ts).
// - C: the heat capacity of the air column (c_p p / g) and of what is under it: the sea's mixed layer (50 m of
//   water) or the ground; sea ice lets less of the sea's heat through.
// - D: transport of heat by the atmosphere, as diffusion: Earth's value calibrated so its zonal temperatures come out
//   right, scaled for other planets as Williams and Kasting (1997): with the air's mass and heat capacity, and
//   inversely with the square of the rotation (slow rotators spread heat further); limited to 30 times Earth's either
//   way (beyond, the planet is already nearly even).
// Each step is implicit (the outgoing heat linearised about the last temperature, diffusion solved by conjugate
// gradients), so a step of a week or a month is stable on any planet. The year is stepped until it repeats.
// Temperatures are at sea level; on land they fall with height at the planet's lapse rate.
import { meshAt, type Mesh } from '../mesh/icosphere.ts';
import { toLevel } from '../mesh/transfer.ts';
import { SIGMA } from '../model/units.ts';
import { opticalDepth, type Derived } from '../model/physics.ts';
import type { PlanetDefinition } from '../model/definition.ts';
import { insolationField, sunlightOf } from './insolation.ts';
import { oceanHeatTransport } from './currents.ts';

export interface ClimateOptions {
  /** Steps a year (24: about a fortnight on Earth). */
  stepsPerYear?: number;
  /** Most years to run before giving up on a repeating year (and the change in the annual mean that counts as repeating, K). */
  maxYears?: number;
  tolerance?: number;
  /** Fewest years to run (3; a warm start needs fewer). */
  minYears?: number;
  /** The sunlight as a multiple of today's (the faint young star; 1 now). */
  sunFactor?: number;
  /** The level the model runs at (default CLIMATE_LEVEL), and temperatures there to start from (K; a warm start). */
  level?: number;
  initialK?: Float64Array;
  /** How a cold start begins (D168): from the year's balance worked out directly (the default), or one even temperature. */
  start?: 'balance' | 'even';
  /**
   * After a cold start, the year at which the slow settling is extrapolated to where it ends (D168; default 5); 0:
   * never (the years run until the planet's mean settles).
   */
  extrapolateAt?: number;
  /**
   * The temperatures the model may reach, K (D259). By default 100 to 1,500 with a start between 150 and 700, as it
   * was made; wider for the hottest and coldest worlds.
   */
  range?: [number, number];
  /**
   * False on a world with no water (D259): no snow and no sea ice, however cold; nothing brightens with the cold.
   * 'sea' (D261): the sea's ice only, no snow on land (seas frozen under air too thin for anything to fall).
   */
  frost?: boolean | 'sea';
  /**
   * The heat shed does not fall again once it has reached its most (D266): the fitted formula's fall beyond that
   * (the vapour's share growing faster than T⁴) is taken as level, as the limit it stands for is, until the formula
   * rises past it again at rock-melting heat. So a planet's tropics passing the limit get hotter and send their
   * heat elsewhere, and the planet tips only when it takes in more than the limit as a whole: the very rule its
   * seas' fate is decided by (physics.ts seaLimit).
   */
  ceiling?: boolean;
  /**
   * Snow needs water to fall (D267): how much of cold land lies under snow, by the water there is to make it. 1 by
   * default (a planet with the Earth's seas); less on a planet with small seas, whose cold land is mostly bare. So
   * such a planet brightens less as it cools and is slower to freeze over (Abe and others 2011; Kodama and others
   * 2019: a planet with little water stays unfrozen in far less light than one covered by sea).
   */
  snow?: number;
  /** The albedo of bare ground (D267): 0.25 by default; darker on a world with no air (physics.ts groundAlbedo). */
  ground?: number;
  /**
   * The sea's currents carry heat only where the sea is open (D261): the heat they carry is taken in proportion to
   * the open share of the sea (all of it while nine tenths are open, as the model was made on the Earth; none under
   * a sea frozen from pole to pole, where it was still carried as on the Earth, more than a cold planet takes in).
   */
  iceStillsCurrents?: boolean;
  /**
   * On a world with no sea (D259), the height (m, on the heights' scale) at which its air has the pressure given:
   * its mean surface. The balance's temperatures hold there; ground above it is colder and ground below it warmer.
   * Also on a world with small seas (D267), whose air lies mostly over its land: a height between its sea's level
   * and its mean surface; its seas keep their own temperatures.
   */
  datum?: number;
  /**
   * How far the air sets the ground's temperature with height (D259; 1 by default): thin air hardly does (on Mars the
   * ground's temperature is its own balance of sunlight and heat lost, whatever its height), so the cooling with
   * height is taken by this share.
   */
  lapseShare?: number;
  /** (Calibration: transport and the land's heat capacity.) */
  tune?: { D?: number; landC?: number; airShare?: number; cloudSwing?: number; width?: number; peak?: number; dryWarm?: number; dryFrom?: number; plateau?: number; transport?: number; gyre?: number; overturning?: number; snowCold?: number; cloudLand?: number; wind?: number; windSwing?: number; tile?: number };
}

/**
 * Cloud cover by latitude (mean over the sphere `mean`): more where air rises (the equator's convergence zone, the
 * storm belts beyond the Hadley cells), less where it sinks (the subtropical highs at the cells' edges, the poles),
 * from the planet's own circulation (Hadley edge in degrees). `swing` is how strongly cover varies.
 */
export function cloudsByLatitude(latDeg: number, hadleyDeg: number, mean: number, swing = 1): number {
  const a = Math.abs(latDeg);
  const shape = 0.35 * Math.exp(-((a / 10) ** 2)) - 0.45 * Math.exp(-(((a - Math.min(hadleyDeg, 60) + 5) / 10) ** 2)) + 0.3 * Math.exp(-(((a - Math.min(85, hadleyDeg + 25)) / 14) ** 2));
  // (The shape averages close to zero over the sphere; the mean is kept by the caller's normalisation.)
  return Math.max(0, Math.min(1, mean * (1 + swing * shape)));
}

export interface ClimateResult {
  /** Surface temperature each month, °C, month m of cell c at [m·n + c]; and the year's mean. */
  monthly: Float32Array;
  annual: Float32Array;
  /** How much of each cell is under ice or snow over the year (0 to 1). */
  ice: Float32Array;
  /** The planet's mean surface temperature (K, at sea level), the sunlight it absorbs and the heat it gives off (W/m², yearly means). */
  meanK: number;
  absorbed: number;
  emitted: number;
  /** Mean temperatures (°C, at sea level) in the band within 10° of the equator and beyond 70° of latitude. */
  tropicsC: number;
  polesC: number;
  years: number;
  /** The model's temperatures at the end of its last year, on its own level (K): to start the next run from. */
  coarseK: Float64Array;
  /** How much warmer than its air column dry ground runs (K, per cell; D159): winds and rain go by the column. */
  dryWarm: Float32Array;
}

/** Earth's atmospheric heat transport as diffusion on the unit sphere, W m⁻² K⁻¹ (calibrated, D157). */
export const EARTH_D = 0.2;
/** The share of the air column's heat capacity that follows the surface through the seasons (its lowest part). */
const AIR_SHARE = 0.3;
/**
 * The surface's own balance, which the column model leaves out (D159; calibrated on stations of the Earth): dry ground
 * far from the sea under the subtropical highs runs warmer than its column by up to DRY_WARM (K), where the land's
 * share within DRY_REACH (radians, about 3,000 km) exceeds DRY_FROM; broad high ground cools with height at PLATEAU of
 * the lapse rate (the local relief above it at the full rate).
 */
export const DRY_WARM = 16, DRY_REACH = 0.45, DRY_FROM = 0.35, PLATEAU = 0.6;
/** How much brighter the coldest snow is than snow near thawing (D165). */
export const SNOW_COLD = 0.18;
/** How much more cloud the sea has than the planet's mean cover, and the land less (a share of the cover, D165). */
export const CLOUD_LAND = 0.15;
/**
 * The effective speed (m/s) at which the prevailing winds carry the air's heat along the parallels (D165): the
 * westerlies of the storm belts and the trade winds. Effective, as the column's air is changed by the ground below it
 * as it goes: calibrated on stations, it gives a maritime air's reach inland of a thousand or two kilometres.
 */
export const WIND = 5, WIND_SWING = 0.8;
/**
 * How strongly the land of a cell that is partly sea is held to the cell's air (W/m²K, D165): the land has its own
 * temperature, from its own sunlight, snow and small heat capacity, so a coast's land has warmer summers and colder
 * winters than the sea beside it (instead of the sea's temperature, as one temperature for the whole cell gave).
 */
export const TILE = 30;
/** The level the model runs at: coarse enough to take a second or two; temperatures are then brought to the map's level. */
export const CLIMATE_LEVEL = 4;

/**
 * The year's climate of a planet on a mesh, given the height of each cell (m above its sea; below 0 is sea).
 */
export function seasonalClimate(mesh: Mesh, def: PlanetDefinition, x: Derived, heightM: ArrayLike<number>, opts: ClimateOptions = {}): ClimateResult {
  // The model runs on a coarse mesh: land as a share of each of its cells.
  const coarse = meshAt(Math.min(mesh.level, opts.level ?? CLIMATE_LEVEL));
  const landFine = new Float64Array(mesh.n);
  for (let c = 0; c < mesh.n; c++) landFine[c] = heightM[c] >= 0 ? 1 : 0;
  const land = mesh.level > coarse.level ? toLevel(landFine, mesh.level, coarse.level) : landFine;
  const sea = coarseClimate(coarse, def, x, land, opts);
  // Brought to the map's level, and lowered by height on land at the planet's lapse rate; with the surface's own
  // balance (dry continental ground warmer, broad high ground cooling more slowly with height; D159), which leaves
  // the planet's balance of energy as it is.
  const n = mesh.n, months = 12;
  const monthly = new Float32Array(months * n), annual = new Float32Array(n), ice = new Float32Array(n);
  const up = (f: ArrayLike<number>) => (mesh.level > coarse.level ? toLevel(f, coarse.level, mesh.level) : Float64Array.from(f));
  const lapse = x.air.lapse * (opts.lapseShare ?? 1); // K/km
  const highFine = new Float64Array(mesh.n);
  for (let c = 0; c < mesh.n; c++) highFine[c] = Math.max(0, heightM[c]);
  const broad = up(mesh.level > coarse.level ? toLevel(highFine, mesh.level, coarse.level) : highFine);
  const warm = up(dryGroundWarming(coarse, land, x, def, opts));
  // (Sunlit high ground heats the air above it; frozen high ground, as an ice sheet, does not: there the full rate.)
  const plateau = opts.tune?.plateau ?? PLATEAU, seaAnnual = new Float64Array(coarse.n);
  for (let m = 0; m < months; m++) for (let c = 0; c < coarse.n; c++) seaAnnual[c] += sea.monthlyLand[m * coarse.n + c] / months;
  const frozen = up(seaAnnual);
  for (let c = 0; c < n; c++) frozen[c] = plateau + (1 - plateau) * Math.max(0, Math.min(1, -frozen[c] / 10));
  for (let m = 0; m < months; m++) {
    // Land from its cells' land, sea from their sea (D165).
    const fineL = up(sea.monthlyLand.subarray(m * coarse.n, (m + 1) * coarse.n)), fineS = up(sea.monthlySea.subarray(m * coarse.n, (m + 1) * coarse.n));
    for (let c = 0; c < n; c++) {
      const h = heightM[c];
      let t: number;
      if (opts.datum !== undefined && h >= 0) {
        // (No sea, D259: heights against the mean surface, the broad part of them at the slower rate both ways.
        // With small seas, D267: the land's heights likewise, at the rate of frozen ground where it is frozen.)
        const hh = h - opts.datum, b = broad[c] - opts.datum;
        const wide = hh >= 0 ? Math.max(0, Math.min(hh, b)) : Math.min(0, Math.max(hh, b));
        t = fineL[c] - (lapse * ((opts.frost === false ? plateau : frozen[c]) * wide + (hh - wide))) / 1000 + warm[c];
      } else t = h >= 0 ? fineL[c] - (lapse * (frozen[c] * Math.min(h, broad[c]) + Math.max(0, h - broad[c]))) / 1000 + warm[c] : fineS[c];
      monthly[m * n + c] = t;
      annual[c] += t / months;
    }
  }
  // Ice: where it is cold through the year (frozen sea, snow on land), from the surface's own temperatures.
  for (let c = 0; c < n && opts.frost !== false; c++) {
    let cold = 0;
    for (let m = 0; m < months; m++) {
      const t = monthly[m * n + c];
      cold += heightM[c] >= 0 ? (opts.frost === 'sea' ? 0 : Math.max(0, Math.min(1, -t / 10))) : Math.max(0, Math.min(1, (-1.8 - t) / 8));
    }
    ice[c] = cold / months;
  }
  const dryWarm = new Float32Array(n);
  for (let c = 0; c < n; c++) dryWarm[c] = heightM[c] >= 0 ? warm[c] : 0;
  return { ...sea.stats, monthly, annual, ice, coarseK: sea.finalK, dryWarm };
}

/** The model itself on a mesh, with the land's share of each cell: sea-level temperatures each month (°C) and the planet's figures. */
function coarseClimate(mesh: Mesh, def: PlanetDefinition, x: Derived, land: ArrayLike<number>, opts: ClimateOptions) {
  const n = mesh.n, steps = opts.stepsPerYear ?? 24, months = 12;
  const sun = cachedInsolation(mesh, def, x, months);
  const f = opts.sunFactor ?? 1;
  const at = def.atmosphere;
  // Heat capacities, J m⁻² K⁻¹.
  const air = Math.max(0, x.air.cp * x.air.columnMass) * (opts.tune?.airShare ?? AIR_SHARE);
  const ocean = def.water.oceanFraction > 0 ? 4.18e6 * 50 : 2e6;
  // Transport, scaled for the planet.
  const rot = Math.min(30, Math.max(1 / 30, (7.292e-5 / Math.max(1e-9, x.omega)) ** 2));
  const mass = Math.min(30, Math.max(1 / 30, (at.pressureBar / 1.013) * (x.air.cp / 1005) * (0.02897 / x.air.molar) ** 2));
  const D = (opts.tune?.D ?? EARTH_D) * (at.pressureBar > 0 ? rot * mass : 0.02);
  // Albedo pieces (as physics.ts): clouds by latitude from the circulation, normalised to the planet's mean cover.
  const rayleigh = 0.5 * (1 - Math.exp((-0.125 * (at.pressureBar * 1e5) / x.gravity) / 10_330));
  const cloud = new Float64Array(n), cloudL = new Float64Array(n);
  if (at.pressureBar > 0 && at.clouds > 0) {
    let mean = 0;
    // More cloud over the sea than over land (on the Earth about 72 against 55 per cent: the sea's evaporation and
    // its low marine clouds, D165); the planet's mean cover kept.
    const cl = opts.tune?.cloudLand ?? CLOUD_LAND;
    // (Not in the deep tropics, where the land's convection clouds it as much as the sea.)
    for (let c = 0; c < n; c++) {
      const lat = (mesh.lat[c] * 180) / Math.PI, tropics = Math.max(0, Math.min(1, (Math.abs(lat) - 10) / 15));
      const base = cloudsByLatitude(lat, x.hadleyEdgeDeg, at.clouds, opts.tune?.cloudSwing ?? 1);
      cloud[c] = base * (1 + cl * tropics * (1 - 2 * land[c]));
      cloudL[c] = base * (1 - cl * tropics);
      mean += cloud[c] * mesh.area[c];
    }
    mean /= 4 * Math.PI;
    for (let c = 0; c < n; c++) { cloud[c] = Math.min(1, (cloud[c] * at.clouds) / Math.max(1e-9, mean)); cloudL[c] = Math.min(1, (cloudL[c] * at.clouds) / Math.max(1e-9, mean)); }
  }
  const snowCold = opts.tune?.snowCold ?? SNOW_COLD;
  // Each cell's yearly mean (K), from the year before: ground whose year is cold enough keeps its snow, as an ice
  // sheet, through the summer (D165), instead of losing it whenever the summer sun warms it towards thawing.
  let annualK: Float64Array | null = null;
  const frost = opts.frost !== false, snows = frost && opts.frost !== 'sea';
  // (D267) Snow by the water there is to fall as it; the bare ground's own albedo.
  const fall = opts.snow ?? 1, bare = opts.ground ?? 0.25;
  const iceOf = (c: number, T: number) => {
    if (!frost) return { snow: 0, sea: 0, kept: 0 };
    const tc = T - 273.15, kept = snows && annualK ? fall * Math.max(0, Math.min(1, (263.15 - annualK[c]) / 10)) : 0;
    return { snow: snows ? Math.max(kept, fall * Math.max(0, Math.min(1, -tc / 10))) : 0, sea: Math.max(0, Math.min(1, (-1.8 - tc) / 8)), kept };
  };
  const albedo = (c: number, T: number) => {
    const i = iceOf(c, T), l = land[c];
    // (Snow brightens as it gets colder and drier: 0.62 at −10 °C to 0.8 at −30 °C and below, as on the ice sheets.)
    const snowA = 0.62 + snowCold * Math.max(i.kept, Math.max(0, Math.min(1, (273.15 - 10 - T) / 20)));
    const surface = l * (bare * (1 - i.snow) + snowA * i.snow) + (1 - l) * (0.06 * (1 - i.sea) + 0.62 * i.sea);
    return cloud[c] * at.cloudAlbedo + (1 - cloud[c]) * (rayleigh + (1 - rayleigh) ** 2 * surface);
  };
  // The albedo of a cell's land alone (its own clouds, its own snow from its own temperatures, D165).
  let annualL: Float64Array | null = null;
  const landAlbedo = (c: number, T: number) => {
    const kept = snows && annualL ? fall * Math.max(0, Math.min(1, (263.15 - annualL[c]) / 10)) : 0;
    const snow = snows ? Math.max(kept, fall * Math.max(0, Math.min(1, -(T - 273.15) / 10))) : 0;
    const snowA = 0.62 + snowCold * Math.max(kept, Math.max(0, Math.min(1, (273.15 - 10 - T) / 20)));
    return cloudL[c] * at.cloudAlbedo + (1 - cloudL[c]) * (rayleigh + (1 - rayleigh) ** 2 * (bare * (1 - snow) + snowA * snow));
  };
  // (The air's opacity to heat as physics.ts works it out, its parts that do not change with the temperature taken out
  // once; at 288 K the water vapour's factor is 1, so its part there is its coefficient. Read from a table every
  // twentieth of a kelvin, between its values: within a part in a billion, D168.)
  const tau0 = opticalDepth(def, 288), dryTau = tau0.co2 + tau0.ch4, wet = tau0.h2o;
  // (D267, the second calculation: the clouds' share of the opacity, less in cold air; physics.ts opticalDepth.)
  const cloudTau = tau0.cloud ?? 0;
  const olrOf = cloudTau !== 0
    ? (T: number) => (SIGMA * T ** 4) / (1 + 0.75 * (dryTau + wet * Math.exp(Math.min(8, 0.0237 * (T - 288))) + cloudTau * Math.min(1, Math.exp(0.0237 * (T - 288)))))
    : (T: number) => (SIGMA * T ** 4) / (1 + 0.75 * (dryTau + wet * Math.exp(Math.min(8, 0.0237 * (T - 288)))));
  const OLR_FROM = 50, OLR_STEP = 0.05, OLR_N = Math.ceil((2000 - OLR_FROM) / OLR_STEP) + 2;
  const olrTable = new Float64Array(OLR_N);
  for (let i = 0; i < OLR_N; i++) olrTable[i] = olrOf(OLR_FROM + i * OLR_STEP);
  if (opts.ceiling) for (let i = 1; i < OLR_N; i++) if (olrTable[i] < olrTable[i - 1]) olrTable[i] = olrTable[i - 1];
  const olr = (T: number) => {
    const u = (T - OLR_FROM) / OLR_STEP;
    if (!(u >= 0 && u < OLR_N - 1)) return opts.ceiling && u >= OLR_N - 1 ? Math.max(olrOf(T), olrTable[OLR_N - 1]) : olrOf(T);
    const i = Math.floor(u), t = u - i;
    return olrTable[i] + (olrTable[i + 1] - olrTable[i]) * t;
  };
  // Transport is strongest in the storm belts beyond the Hadley cells (on Earth near 45°), where eddies carry heat
  // poleward, weaker towards the poles and the equator (North et al. 1981 let D vary with latitude in the same way).
  const storms = Math.min(70, x.hadleyEdgeDeg + 10), width = opts.tune?.width ?? 20, peak = opts.tune?.peak ?? 2;
  // The heat the sea's currents carry (D165): taken up in the tropics, given off further poleward.
  const qflux = oceanHeatTransport(mesh, land, x, def.water.oceanFraction, opts.tune ?? {});
  const { nbrStart, nbr, edgeLen, edgeDist, area } = mesh;
  const w = new Float64Array(nbr.length);
  for (let i = 0; i < n; i++) {
    for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) {
      const j = nbr[k];
      const z = (mesh.xyz[3 * i + 2] + mesh.xyz[3 * j + 2]) / 2, lat = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
      const shape = 0.5 + peak * Math.exp(-(((Math.abs(lat) - storms) / width) ** 2));
      w[k] = (D * shape * edgeLen[k]) / edgeDist[k];
    }
  }
  // The prevailing winds along the parallels (D165): westerlies beyond the Hadley cells, the trades within them,
  // carrying the air's heat downwind (upwind differences), so west coasts in the storm belts are mild and east coasts
  // and continental interiors have hard winters. Not on a planet without a day (tidally locked).
  const U = x.tidallyLocked || at.pressureBar <= 0 ? 0 : (opts.tune?.wind ?? WIND);
  let coef: Float64Array = w;
  const adv = new Float64Array(U > 0 ? w.length : 0);
  if (U > 0) {
    coef = Float64Array.from(w);
    const hadley = Math.max(5, x.hadleyEdgeDeg), R = x.radiusM;
    const zonal = (latDeg: number) => {
      const a = Math.abs(latDeg);
      return U * (Math.exp(-(((a - Math.min(75, hadley + 15)) / 15) ** 2)) - 0.7 * Math.exp(-(((a - 0.4 * hadley) / (0.35 * hadley)) ** 2)));
    };
    for (let i = 0; i < n; i++) {
      for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) {
        const j = nbr[k];
        const mx = mesh.xyz[3 * i] + mesh.xyz[3 * j], my = mesh.xyz[3 * i + 1] + mesh.xyz[3 * j + 1], mz = mesh.xyz[3 * i + 2] + mesh.xyz[3 * j + 2];
        const ml = Math.hypot(mx, my, mz) || 1, lat = (Math.asin(mz / ml) * 180) / Math.PI, lon = Math.atan2(my, mx);
        let dx = mesh.xyz[3 * i] - mesh.xyz[3 * j], dy = mesh.xyz[3 * i + 1] - mesh.xyz[3 * j + 1];
        const dz = mesh.xyz[3 * i + 2] - mesh.xyz[3 * j + 2], dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl;
        // The wind's component from j towards i: inflow into i carries j's heat (W/m²K over the unit sphere).
        const un = zonal(lat) * (-Math.sin(lon) * dx + Math.cos(lon) * dy);
        if (un > 0) adv[k] = (air * un * edgeLen[k]) / R;
      }
    }
  }
  // The winds are stronger in each hemisphere's winter and weaker in its summer (on the Earth about half as strong in
  // summer as in winter), more so with more tilt; month 0 is the northern winter's (insolation.ts).
  const swing = (opts.tune?.windSwing ?? WIND_SWING) * Math.min(1, Math.sin((Math.abs(def.body.tiltDeg) * Math.PI) / 180) / Math.sin((23.44 * Math.PI) / 180));
  let coefMonth = -1;
  const windsFor = (m: number) => {
    if (!(U > 0) || m === coefMonth) return;
    coefMonth = m;
    const north = Math.cos((2 * Math.PI * (m + 0.5)) / 12);
    for (let i = 0; i < n; i++) {
      const sfac = 1 + swing * (mesh.xyz[3 * i + 2] >= 0 ? north : -north);
      for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) coef[k] = w[k] + sfac * adv[k];
    }
  };
  const yearS = x.yearDays * 86_400;
  // (D261) How much of the heat the sea's currents carry is carried: by the open share of the sea.
  let carried = 1;
  const currentsCarried = (temps: ArrayLike<number>): number => {
    if (!opts.iceStillsCurrents) return 1;
    let sea = 0, open = 0;
    for (let c = 0; c < n; c++) { const s = (1 - land[c]) * area[c]; sea += s; open += s * (1 - iceOf(c, temps[c]).sea); }
    return sea > 0 ? Math.min(1, open / sea / 0.9) : 1;
  };
  let T: Float64Array = opts.initialK && opts.initialK.length === n ? Float64Array.from(opts.initialK) : new Float64Array(n).fill(opts.range ? Math.max(opts.range[0], Math.min(opts.range[1], x.surfaceK)) : Math.max(150, Math.min(700, x.surfaceK)));
  if (opts.initialK && opts.initialK.length === n) { annualK = Float64Array.from(opts.initialK); annualL = Float64Array.from(opts.initialK); }
  const ws = space(n), cold = !(opts.initialK && opts.initialK.length === n);
  const lowK = opts.range ? opts.range[0] : 100, highK = opts.range ? opts.range[1] : 1500;
  if (cold && (opts.start ?? 'balance') === 'balance') {
    // The year's balance worked out directly (D168): the year's mean sunlight, the outgoing heat linearised about the
    // last estimate and the albedo from it, the transport as in a step; four-fifths of the way to each new estimate
    // until none moves by a fifth of a kelvin (a start: the seasons' years settle the rest).
    const Sbar = new Float64Array(n);
    for (let m = 0; m < months; m++) for (let c = 0; c < n; c++) Sbar[c] += (f * sun.monthly[m * n + c]) / months;
    if (U > 0) { for (let i = 0; i < n; i++) for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) coef[k] = w[k] + adv[k]; coefMonth = -1; }
    const d0 = new Float64Array(n), r0 = new Float64Array(n);
    annualK = Float64Array.from(T); annualL = Float64Array.from(T);
    for (let it = 0; it < 40; it++) {
      carried = currentsCarried(T);
      for (let c = 0; c < n; c++) {
        const Tc = T[c], a = albedo(c, Tc), o = olr(Tc), B = Math.max(0.5, (olr(Tc + 0.5) - o) / 0.5);
        d0[c] = B * area[c];
        r0[c] = (Sbar[c] * (1 - a) - o + B * Tc + carried * qflux[c]) * area[c];
      }
      const next = U > 0 ? solveGeneral(n, nbrStart, nbr, coef, d0, r0, T, ws, 1e-8) : solve(n, nbrStart, nbr, w, d0, r0, T, ws, 1e-8);
      let most = 0;
      for (let c = 0; c < n; c++) { const v = Math.max(lowK, Math.min(highK, 0.2 * T[c] + 0.8 * next[c])); most = Math.max(most, Math.abs(v - T[c])); T[c] = v; }
      annualK.set(T); annualL.set(T);
      if (most < 0.2) break;
    }
  }
  const TL = Float64Array.from(T), kappa = opts.tune?.tile ?? TILE, CL = air + 2e6;
  const monthSum = new Float64Array(months * n), monthCount = new Float64Array(months), monthSumL = new Float64Array(months * n);
  let prevAnnual = Infinity, years = 0, absorbed = 0, emitted = 0;
  const maxYears = opts.maxYears ?? 40, tol = opts.tolerance ?? 0.01;
  const diag = new Float64Array(n), rhs = new Float64Array(n);
  const settleAt = cold ? (opts.extrapolateAt ?? 5) : 0;
  const means: number[] = [];
  let extrapolated: number | null = null;
  let lastEnd: Float64Array | null = null, lastEndL: Float64Array | null = null, lastA: Float64Array | null = null, lastAL: Float64Array | null = null;
  for (years = 1; years <= maxYears; years++) {
    monthSum.fill(0); monthCount.fill(0); monthSumL.fill(0);
    let abs = 0, emi = 0;
    const dt = yearS / steps;
    carried = currentsCarried(annualK ?? T);
    for (let s = 0; s < steps; s++) {
      const m = Math.min(months - 1, Math.floor((s * months) / steps));
      for (let c = 0; c < n; c++) {
        const Tc = T[c], a = albedo(c, Tc), Q = f * sun.monthly[m * n + c] * (1 - a);
        const o = olr(Tc), B = Math.max(0.5, (olr(Tc + 0.5) - o) / 0.5);
        const i = iceOf(c, Tc);
        const C = air + land[c] * 2e6 + (1 - land[c]) * ocean * (1 - 0.9 * i.sea);
        diag[c] = (C / dt + B) * area[c];
        rhs[c] = ((C / dt) * Tc + Q - o + B * Tc + carried * qflux[c]) * area[c];
        abs += Q * area[c]; emi += o * area[c];
      }
      windsFor(m);
      T = U > 0 ? solveGeneral(n, nbrStart, nbr, coef, diag, rhs, T, ws) : solve(n, nbrStart, nbr, w, diag, rhs, T, ws);
      if (opts.range) for (let c = 0; c < n; c++) if (!(T[c] > lowK)) T[c] = lowK;
      // The land of each cell: its own sunlight, snow and heat capacity, the same heat carried in by the air as the
      // cell has (per square metre), and heat exchanged with the rest of the cell's air (implicit in its own
      // temperature). In a cell that is all land it is the cell's temperature.
      const cw = U > 0 ? coef : w;
      for (let c = 0; c < n; c++) {
        if (!(land[c] > 0)) { TL[c] = T[c]; continue; }
        let tr = 0;
        for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) tr += cw[k] * (T[nbr[k]] - T[c]);
        tr /= area[c];
        const t0 = TL[c], QL = f * sun.monthly[m * n + c] * (1 - landAlbedo(c, t0));
        const oL = olr(t0), BL = Math.max(0.5, (olr(t0 + 0.5) - oL) / 0.5);
        TL[c] = ((CL / dt) * t0 + QL - oL + BL * t0 + tr + kappa * T[c]) / (CL / dt + BL + kappa);
        if (opts.range && !(TL[c] > lowK)) TL[c] = lowK;
      }
      for (let c = 0; c < n; c++) { monthSum[m * n + c] += T[c]; monthSumL[m * n + c] += TL[c]; }
      monthCount[m]++;
    }
    absorbed = abs / (4 * Math.PI * steps); emitted = emi / (4 * Math.PI * steps);
    annualK = annualK ?? new Float64Array(n);
    annualL = annualL ?? new Float64Array(n);
    for (let c = 0; c < n; c++) {
      let a = 0, aL = 0;
      for (let m = 0; m < months; m++) { a += monthSum[m * n + c] / Math.max(1, monthCount[m]) / months; aL += monthSumL[m * n + c] / Math.max(1, monthCount[m]) / months; }
      annualK[c] = a; annualL[c] = aL;
    }
    let mean = 0;
    for (let c = 0; c < n; c++) for (let m = 0; m < months; m++) mean += (area[c] * monthSum[m * n + c]) / monthCount[m] / months;
    mean /= 4 * Math.PI;
    means.push(mean);
    // (D168) The slow settling, once it is the only change left (the planet's mean changing by a steady ratio from
    // year to year), extrapolated to where it ends.
    if (settleAt > 0 && years === settleAt && means.length >= 3 && lastEnd && lastA && lastEndL && lastAL) {
      const d1 = means[means.length - 2] - means[means.length - 3], d2 = mean - means[means.length - 2], rho = d1 !== 0 ? d2 / d1 : 0;
      if (rho > 0.05 && rho < 0.95) {
        const g = rho / (1 - rho);
        for (let c = 0; c < n; c++) {
          const dT = T[c] - lastEnd[c], dL = TL[c] - lastEndL[c], dA = annualK![c] - lastA[c], dAL = annualL![c] - lastAL[c];
          T[c] += g * dT; TL[c] += g * dL; annualK![c] += g * dA; annualL![c] += g * dAL;
        }
        // (The next year is measured against where the settling was extrapolated to.)
        extrapolated = mean + g * d2;
      }
    }
    if (settleAt > 0 && years === settleAt - 1) { lastEnd = Float64Array.from(T); lastEndL = Float64Array.from(TL); lastA = Float64Array.from(annualK); lastAL = Float64Array.from(annualL); }
    if (Math.abs(mean - prevAnnual) < tol && years >= (opts.minYears ?? 3) && (extrapolated === null || years > settleAt)) break;
    prevAnnual = extrapolated !== null && years === settleAt ? extrapolated : mean;
  }
  const monthly = new Float32Array(months * n), monthlyLand = new Float32Array(months * n), monthlySea = new Float32Array(months * n);
  let meanK = 0, trop = 0, tropA = 0, pole = 0, poleA = 0;
  for (let c = 0; c < n; c++) {
    let sum = 0;
    for (let m = 0; m < months; m++) {
      const t = monthSum[m * n + c] / monthCount[m], tl = monthSumL[m * n + c] / monthCount[m], l = land[c];
      monthly[m * n + c] = t - 273.15; sum += t;
      monthlyLand[m * n + c] = tl - 273.15;
      // The sea's: the cell's own, which the sea's large heat capacity sets.
      monthlySea[m * n + c] = t - 273.15;
      void l;
    }
    const tm = sum / months;
    meanK += area[c] * tm;
    const lat = Math.abs((mesh.lat[c] * 180) / Math.PI);
    if (lat < 10) { trop += area[c] * (tm - 273.15); tropA += area[c]; }
    if (lat > 70) { pole += area[c] * (tm - 273.15); poleA += area[c]; }
  }
  return {
    monthly, monthlyLand, monthlySea, finalK: Float64Array.from(T),
    stats: { meanK: meanK / (4 * Math.PI), absorbed, emitted, tropicsC: tropA ? trop / tropA : NaN, polesC: poleA ? pole / poleA : NaN, years: Math.min(years, maxYears) },
  };
}

/** The solvers' working vectors (D168: made once for a climate, not for every step). */
interface Space { x: Float64Array; full: Float64Array; r: Float64Array; rh: Float64Array; p: Float64Array; v: Float64Array; y: Float64Array; sv: Float64Array; z: Float64Array; t: Float64Array; dots: Float64Array }
const space = (n: number): Space => ({
  x: new Float64Array(n), full: new Float64Array(n), r: new Float64Array(n), rh: new Float64Array(n), p: new Float64Array(n),
  v: new Float64Array(n), y: new Float64Array(n), sv: new Float64Array(n), z: new Float64Array(n), t: new Float64Array(n), dots: new Float64Array(2),
});

/**
 * Solves (diag_i) x_i + Σ_j w_ij (x_i − x_j) = rhs_i (symmetric positive definite) by conjugate gradients with a
 * diagonal preconditioner, starting from `x0`.
 */
function solve(n: number, start: Int32Array, nbr: Int32Array, w: Float64Array, diag: Float64Array, rhs: Float64Array, x0: Float64Array, ws = space(n), tol = 1e-12): Float64Array {
  const { x, r, z, p, v: q, full } = ws;
  x.set(x0); p.fill(0);
  for (let i = 0; i < n; i++) { let s = diag[i]; for (let k = start[i]; k < start[i + 1]; k++) s += w[k]; full[i] = s; }
  const apply = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let s = full[i] * v[i];
      for (let k = start[i]; k < start[i + 1]; k++) s -= w[k] * v[nbr[k]];
      out[i] = s;
    }
  };
  apply(x, q);
  let rz = 0, rr0 = 0;
  for (let i = 0; i < n; i++) { r[i] = rhs[i] - q[i]; z[i] = r[i] / full[i]; p[i] = z[i]; rz += r[i] * z[i]; rr0 += rhs[i] * rhs[i]; }
  for (let it = 0; it < 400; it++) {
    let rr = 0;
    for (let i = 0; i < n; i++) rr += r[i] * r[i];
    if (rr <= tol * rr0) break;
    apply(p, q);
    let pq = 0;
    for (let i = 0; i < n; i++) pq += p[i] * q[i];
    const alpha = rz / pq;
    let rz2 = 0;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * q[i]; z[i] = r[i] / full[i]; rz2 += r[i] * z[i]; }
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return x;
}

/**
 * Solves (diag_i) x_i + Σ_j c_ij (x_i − x_j) = rhs_i for coefficients that need not be symmetric (diffusion with the
 * winds' upwind transport, D165) by BiCGSTAB with a diagonal preconditioner, starting from `x0`.
 */
function solveGeneral(n: number, start: Int32Array, nbr: Int32Array, c: Float64Array, diag: Float64Array, rhs: Float64Array, x0: Float64Array, ws = space(n), tol = 1e-12): Float64Array {
  const { x, full, r, rh, p, v, y, sv, z, t } = ws;
  x.set(x0);
  for (let i = 0; i < n; i++) { let s = diag[i]; const e = start[i + 1]; for (let k = start[i]; k < e; k++) s += c[k]; full[i] = s; }
  p.fill(0);
  operate(n, start, nbr, c, full, x, v);
  let rr0 = 0;
  for (let i = 0; i < n; i++) { r[i] = rhs[i] - v[i]; rh[i] = r[i]; rr0 += rhs[i] * rhs[i]; }
  v.fill(0);
  let rho = 1, alpha = 1, omega = 1;
  const dots = ws.dots;
  for (let it = 0; it < 400; it++) {
    let rr = 0, rho2 = 0;
    for (let i = 0; i < n; i++) { rr += r[i] * r[i]; rho2 += rh[i] * r[i]; }
    if (rr <= tol * rr0 || rho2 === 0) break;
    const beta = (rho2 / rho) * (alpha / omega);
    for (let i = 0; i < n; i++) { p[i] = r[i] + beta * (p[i] - omega * v[i]); y[i] = p[i] / full[i]; }
    // (Each product with the matrix gives its dot products as it goes: the same sums in the same order, D168.)
    operateDot(n, start, nbr, c, full, y, v, rh, dots);
    const rv = dots[0];
    alpha = rho2 / rv;
    let ss = 0;
    for (let i = 0; i < n; i++) { sv[i] = r[i] - alpha * v[i]; ss += sv[i] * sv[i]; }
    if (ss <= tol * rr0) { for (let i = 0; i < n; i++) x[i] += alpha * y[i]; break; }
    for (let i = 0; i < n; i++) z[i] = sv[i] / full[i];
    operateDot(n, start, nbr, c, full, z, t, sv, dots);
    const ts = dots[0], tt = dots[1];
    omega = tt > 0 ? ts / tt : 0;
    for (let i = 0; i < n; i++) { x[i] += alpha * y[i] + omega * z[i]; r[i] = sv[i] - omega * t[i]; }
    rho = rho2;
    if (omega === 0) break;
  }
  return x;
}

/** out = A v for A = diag(full) − (the coefficients towards each neighbour). */
function operate(n: number, start: Int32Array, nbr: Int32Array, c: Float64Array, full: Float64Array, v: Float64Array, out: Float64Array): void {
  for (let i = 0; i < n; i++) {
    let s = full[i] * v[i];
    const e = start[i + 1];
    for (let k = start[i]; k < e; k++) s -= c[k] * v[nbr[k]];
    out[i] = s;
  }
}

/** out = A v as `operate`, with dots[0] = Σ w·out and dots[1] = Σ out·out. */
function operateDot(n: number, start: Int32Array, nbr: Int32Array, c: Float64Array, full: Float64Array, v: Float64Array, out: Float64Array, w: Float64Array, dots: Float64Array): void {
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    let s = full[i] * v[i];
    const e = start[i + 1];
    for (let k = start[i]; k < e; k++) s -= c[k] * v[nbr[k]];
    out[i] = s;
    a += s * w[i]; b += s * s;
  }
  dots[0] = a; dots[1] = b;
}

/**
 * How much warmer dry ground runs than the column model gives (K, per coarse cell, D159): where the land's share
 * within DRY_REACH is high (a great landmass: little sea to temper it, little water to evaporate) and the subtropical
 * highs keep skies clear and air sinking; strongest just inside the edge of the Hadley cells, fading towards the
 * equator's rains and the storm belts. (A column model has one temperature for the ground and the air above it, so
 * the sea's evaporation and the desert's lack of it, which set them apart, are missing; calibrated on stations.)
 */
function dryGroundWarming(mesh: Mesh, land: ArrayLike<number>, x: Derived, def: PlanetDefinition, opts: ClimateOptions): Float64Array {
  const n = mesh.n, out = new Float64Array(n);
  const amp = opts.tune?.dryWarm ?? DRY_WARM, from = opts.tune?.dryFrom ?? DRY_FROM;
  if (!(amp > 0) || def.atmosphere.pressureBar <= 0) return out;
  const cos = Math.cos(DRY_REACH);
  for (let c = 0; c < n; c++) {
    if (land[c] <= 0) continue;
    let s = 0, a = 0;
    for (let j = 0; j < n; j++) {
      const d = mesh.xyz[3 * c] * mesh.xyz[3 * j] + mesh.xyz[3 * c + 1] * mesh.xyz[3 * j + 1] + mesh.xyz[3 * c + 2] * mesh.xyz[3 * j + 2];
      if (d < cos) continue;
      s += land[j] * mesh.area[j]; a += mesh.area[j];
    }
    const lat = Math.abs((mesh.lat[c] * 180) / Math.PI);
    const band = Math.exp(-(((lat - (x.hadleyEdgeDeg - 5)) / 15) ** 2));
    out[c] = amp * land[c] * band * Math.max(0, (s / a - from) / (1 - from));
  }
  return out;
}

/** Sunlight fields by level and sunlight (a history works out many climates under the same sky). */
const insolationCache = new Map<string, { annual: Float32Array; monthly: Float32Array }>();
function cachedInsolation(mesh: Mesh, def: PlanetDefinition, x: Derived, months: number) {
  const s = sunlightOf(def, x), key = `${mesh.level}:${months}:${JSON.stringify(s)}`;
  let f = insolationCache.get(key);
  if (!f) {
    f = insolationField(mesh, s, months);
    if (insolationCache.size > 16) insolationCache.clear();
    insolationCache.set(key, f);
  }
  return f;
}
