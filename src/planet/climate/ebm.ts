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
  /** (Calibration: transport and the land's heat capacity.) */
  tune?: { D?: number; landC?: number; airShare?: number; cloudSwing?: number; width?: number; peak?: number; dryWarm?: number; dryFrom?: number; plateau?: number };
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
export const EARTH_D = 0.3;
/** The share of the air column's heat capacity that follows the surface through the seasons (its lowest part). */
const AIR_SHARE = 0.3;
/**
 * The surface's own balance, which the column model leaves out (D159; calibrated on stations of the Earth): dry ground
 * far from the sea under the subtropical highs runs warmer than its column by up to DRY_WARM (K), where the land's
 * share within DRY_REACH (radians, about 3,000 km) exceeds DRY_FROM; broad high ground cools with height at PLATEAU of
 * the lapse rate (the local relief above it at the full rate).
 */
export const DRY_WARM = 16, DRY_REACH = 0.45, DRY_FROM = 0.35, PLATEAU = 0.6;
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
  const lapse = x.air.lapse; // K/km
  const highFine = new Float64Array(mesh.n);
  for (let c = 0; c < mesh.n; c++) highFine[c] = Math.max(0, heightM[c]);
  const broad = up(mesh.level > coarse.level ? toLevel(highFine, mesh.level, coarse.level) : highFine);
  const warm = up(dryGroundWarming(coarse, land, x, def, opts));
  // (Sunlit high ground heats the air above it; frozen high ground, as an ice sheet, does not: there the full rate.)
  const plateau = opts.tune?.plateau ?? PLATEAU, seaAnnual = new Float64Array(coarse.n);
  for (let m = 0; m < months; m++) for (let c = 0; c < coarse.n; c++) seaAnnual[c] += sea.monthly[m * coarse.n + c] / months;
  const frozen = up(seaAnnual);
  for (let c = 0; c < n; c++) frozen[c] = plateau + (1 - plateau) * Math.max(0, Math.min(1, -frozen[c] / 10));
  for (let m = 0; m < months; m++) {
    const fine = up(sea.monthly.subarray(m * coarse.n, (m + 1) * coarse.n));
    for (let c = 0; c < n; c++) {
      const h = heightM[c];
      const t = h >= 0 ? fine[c] - (lapse * (frozen[c] * Math.min(h, broad[c]) + Math.max(0, h - broad[c]))) / 1000 + warm[c] : fine[c];
      monthly[m * n + c] = t;
      annual[c] += t / months;
    }
  }
  // Ice: where it is cold through the year (frozen sea, snow on land), from the surface's own temperatures.
  for (let c = 0; c < n; c++) {
    let cold = 0;
    for (let m = 0; m < months; m++) {
      const t = monthly[m * n + c];
      cold += heightM[c] >= 0 ? Math.max(0, Math.min(1, -t / 10)) : Math.max(0, Math.min(1, (-1.8 - t) / 8));
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
  const cloud = new Float64Array(n);
  if (at.pressureBar > 0 && at.clouds > 0) {
    let mean = 0;
    for (let c = 0; c < n; c++) { cloud[c] = cloudsByLatitude((mesh.lat[c] * 180) / Math.PI, x.hadleyEdgeDeg, at.clouds, opts.tune?.cloudSwing ?? 1); mean += cloud[c] * mesh.area[c]; }
    mean /= 4 * Math.PI;
    for (let c = 0; c < n; c++) cloud[c] = Math.min(1, (cloud[c] * at.clouds) / Math.max(1e-9, mean));
  }
  const iceOf = (c: number, T: number) => {
    const tc = T - 273.15;
    return { snow: Math.max(0, Math.min(1, -tc / 10)), sea: Math.max(0, Math.min(1, (-1.8 - tc) / 8)) };
  };
  const albedo = (c: number, T: number) => {
    const i = iceOf(c, T), l = land[c];
    const surface = l * (0.25 * (1 - i.snow) + 0.62 * i.snow) + (1 - l) * (0.06 * (1 - i.sea) + 0.62 * i.sea);
    return cloud[c] * at.cloudAlbedo + (1 - cloud[c]) * (rayleigh + (1 - rayleigh) ** 2 * surface);
  };
  const olr = (T: number) => (SIGMA * T ** 4) / (1 + 0.75 * opticalDepth(def, T).total);
  // Transport is strongest in the storm belts beyond the Hadley cells (on Earth near 45°), where eddies carry heat
  // poleward, weaker towards the poles and the equator (North et al. 1981 let D vary with latitude in the same way).
  const storms = Math.min(70, x.hadleyEdgeDeg + 10), width = opts.tune?.width ?? 20, peak = opts.tune?.peak ?? 2;
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
  const yearS = x.yearDays * 86_400, dt = yearS / steps;
  let T: Float64Array = opts.initialK && opts.initialK.length === n ? Float64Array.from(opts.initialK) : new Float64Array(n).fill(Math.max(150, Math.min(700, x.surfaceK)));
  const monthSum = new Float64Array(months * n), monthCount = new Float64Array(months);
  let prevAnnual = Infinity, years = 0, absorbed = 0, emitted = 0;
  const maxYears = opts.maxYears ?? 40, tol = opts.tolerance ?? 0.01;
  const diag = new Float64Array(n), rhs = new Float64Array(n);
  for (years = 1; years <= maxYears; years++) {
    monthSum.fill(0); monthCount.fill(0);
    let abs = 0, emi = 0;
    for (let s = 0; s < steps; s++) {
      const m = Math.min(months - 1, Math.floor((s * months) / steps));
      for (let c = 0; c < n; c++) {
        const Tc = T[c], a = albedo(c, Tc), Q = f * sun.monthly[m * n + c] * (1 - a);
        const o = olr(Tc), B = Math.max(0.5, (olr(Tc + 0.5) - o) / 0.5);
        const i = iceOf(c, Tc);
        const C = air + land[c] * 2e6 + (1 - land[c]) * ocean * (1 - 0.9 * i.sea);
        diag[c] = (C / dt + B) * area[c];
        rhs[c] = ((C / dt) * Tc + Q - o + B * Tc) * area[c];
        abs += Q * area[c]; emi += o * area[c];
      }
      T = solve(n, nbrStart, nbr, w, diag, rhs, T);
      for (let c = 0; c < n; c++) monthSum[m * n + c] += T[c];
      monthCount[m]++;
    }
    absorbed = abs / (4 * Math.PI * steps); emitted = emi / (4 * Math.PI * steps);
    let mean = 0;
    for (let c = 0; c < n; c++) for (let m = 0; m < months; m++) mean += (area[c] * monthSum[m * n + c]) / monthCount[m] / months;
    mean /= 4 * Math.PI;
    if (Math.abs(mean - prevAnnual) < tol && years >= (opts.minYears ?? 3)) break;
    prevAnnual = mean;
  }
  const monthly = new Float32Array(months * n);
  let meanK = 0, trop = 0, tropA = 0, pole = 0, poleA = 0;
  for (let c = 0; c < n; c++) {
    let sum = 0;
    for (let m = 0; m < months; m++) { const t = monthSum[m * n + c] / monthCount[m]; monthly[m * n + c] = t - 273.15; sum += t; }
    const tm = sum / months;
    meanK += area[c] * tm;
    const lat = Math.abs((mesh.lat[c] * 180) / Math.PI);
    if (lat < 10) { trop += area[c] * (tm - 273.15); tropA += area[c]; }
    if (lat > 70) { pole += area[c] * (tm - 273.15); poleA += area[c]; }
  }
  return {
    monthly, finalK: T,
    stats: { meanK: meanK / (4 * Math.PI), absorbed, emitted, tropicsC: tropA ? trop / tropA : NaN, polesC: poleA ? pole / poleA : NaN, years: Math.min(years, maxYears) },
  };
}

/**
 * Solves (diag_i) x_i + Σ_j w_ij (x_i − x_j) = rhs_i (symmetric positive definite) by conjugate gradients with a
 * diagonal preconditioner, starting from `x0`.
 */
function solve(n: number, start: Int32Array, nbr: Int32Array, w: Float64Array, diag: Float64Array, rhs: Float64Array, x0: Float64Array): Float64Array {
  const x = Float64Array.from(x0), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), q = new Float64Array(n);
  const full = new Float64Array(n);
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
    if (rr <= 1e-20 * rr0) break;
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
