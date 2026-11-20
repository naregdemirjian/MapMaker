// The climate II: winds, rain and the sea's currents (Stage 14.7, D158). Reduced-complexity models of the
// established kind, physically motivated, with parameters calibrated on the Earth.
//
// - Winds at the surface are diagnosed from the planet's own circulation (physics.ts: the Hadley cells' width and
//   the number of cells in each hemisphere): easterly trade winds blowing towards the equator's convergence zone,
//   westerlies beyond, easterlies again near the poles, each belt following the thermal equator through the year;
//   on a planet turning backwards the zonal winds reverse; on a tidally locked planet air flows along the surface
//   towards the point under the star. Monsoons: air is also drawn from where it is cooler than its latitude's mean
//   to where it is warmer (onto the continents in summer, off them in winter).
// - Water vapour (precipitable water, mm) evaporates from the sea at a rate rising with temperature and wind
//   (Clausius-Clapeyron; a bulk formula), and less from land (recycled rain); it is carried downwind and falls
//   as rain at a rate set by how long vapour stays aloft: shorter where air rises (the convergence zone, the storm
//   belts, and above all where wind blows up a slope), longer where it sinks (the subtropical highs) and in the lee
//   of mountains, which therefore lie in rain shadows. Solved to a steady state each month (upwind transport).
// - The sea's currents: winds drive gyres in every basin (Stommel 1948; Munk 1950): warm currents along the western
//   sides of oceans carry heat poleward (the Gulf Stream, the Kuroshio), cold currents along the eastern sides carry
//   cold water towards the equator with upwelling (California, Canary, Humboldt, Benguela), and the warm water's
//   drift reaches the eastern side of the oceans at high latitudes (north-western Europe). Applied as warmer and
//   cooler sea surfaces by distance from each basin's western and eastern shores, spread a little inland.
import { meshAt, type Mesh } from '../mesh/icosphere.ts';
import { toLevel } from '../mesh/transfer.ts';
import type { Derived } from '../model/physics.ts';
import type { PlanetDefinition } from '../model/definition.ts';
import { orbitAt } from './insolation.ts';
import { currentAnomaly } from './currents.ts';

export interface HydroResult {
  /** Rain and snow each month (mm) and over the year (mm), month m of cell c at [m·n + c]. */
  precipMonthly: Float32Array;
  precipAnnual: Float32Array;
  /** Surface temperatures each month (°C) with the sea's currents, and the currents' change to the sea's surface (K, yearly). */
  tempMonthly: Float32Array;
  currents: Float32Array;
  /** Winds in the first and seventh months: east and north components (m/s), per cell. */
  windJan: Float32Array;
  windJul: Float32Array;
  /** Mean rain over the planet (mm a year). */
  meanPrecip: number;
}

const DAY = 86_400;
/** The rain model's constants (calibrated on the Earth, D158). */
/**
 * The rain model's settings (D158, D159; recalibrated in D165 on 22 stations, the land's rain at 30-55° N, the share
 * of dry climates and the planet's mean): rain rates (per day) in the convergence zone (`rising`) and the storm belts
 * (`storm`), less under the highs' sinking air (`sinking`; convection held down by it: `subsidence`, which follow the
 * convergence zone a quarter as far: `highFollow`); evaporation, slowing as the air nears saturation (`deficit`);
 * the convergence zone drawn over land near the sea (`lowLand`, within `coastReach` km) and over high ground above
 * `highFrom` m (one more unit per `plateau` m), in `sectors` of longitude.
 */
export const HYDRO = { base: 0.08, rising: 1, sinking: 0.6, itczWidth: 11, swingSea: 0.3, swingLand: 0.9, convective: 0.4, recycle: 0.3, evaporation: 0.11, carry: 0.7, warmRecycle: 0.3, eddy: 1.5e6, deficit: 0.25, subsidence: 3, lowLand: 1, plateau: 400, storm: 3, sectors: 24, coastReach: 800, highFrom: 1000, highFollow: 0.25, nearItcz: 6 };
/** The subtropical highs' flanks (D159): winds (m/s) poleward on the western flanks, equatorward on the eastern; and how much more (less) air sinks there. */
export const HIGHS = { poleward: 6, equatorward: 3, sinking: 0.8, wide: 1500, reachLand: 2500, reachSea: 1500, coast: 800, monsoon: 8 };
/** Precipitable water over the sea at a temperature (mm): about 50 mm in the warm tropics, a few at the poles. */
const vapour = (t: number) => 48 * Math.exp(0.066 * (t - 27));

/**
 * The convergence zone in a month by longitude (degrees): it follows the latitude where the star stands overhead, a
 * month late, swinging much further over land, which warms quickly, and furthest over high ground (on Earth to about
 * 20° N over Asia in July, 8° over the Pacific): the monsoons. By 30° bands of longitude, the land's share of the
 * summer hemisphere to 40° (high ground counting more) deciding the swing; smoothed across the bands, read per cell.
 */
export function convergenceZones(mesh: Mesh, land: ArrayLike<number>, height: ArrayLike<number>, declinationDeg: number, radiusKm = 6371): Float64Array {
  const LON = HYDRO.sectors;
  const share = new Float64Array(LON), all = new Float64Array(LON);
  const summer = declinationDeg >= 0 ? 1 : -1;
  // How far each cell lies from the sea (km), by spreading out from the sea's cells (D165): lowland far inland, as
  // the Sahara's, draws no rain belt.
  const dist = new Float64Array(mesh.n).fill(Infinity), queue: number[] = [];
  for (let c = 0; c < mesh.n; c++) if (land[c] < 0.5) { dist[c] = 0; queue.push(c); }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    for (let k = mesh.nbrStart[c]; k < mesh.nbrStart[c + 1]; k++) {
      const j = mesh.nbr[k], d = dist[c] + mesh.edgeDist[k] * radiusKm;
      if (d < dist[j]) { dist[j] = d; queue.push(j); }
    }
  }
  for (let c = 0; c < mesh.n; c++) {
    const lat = ((mesh.lat[c] * 180) / Math.PI) * summer;
    if (lat < 0 || lat > 40) continue;
    const l = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * LON) % LON;
    // High ground heats the air above it most (a plateau draws the monsoon furthest); low desert draws it much less
    // (its heat low stays dry: the rain belt stops well short of it, D165).
    // (High ground counts above about a kilometre, where it heats the middle of the air: Tibet's, Mexico's plateau.)
    share[l] += land[c] * (HYDRO.lowLand * Math.exp(-dist[c] / HYDRO.coastReach) + Math.max(0, height[c] - HYDRO.highFrom) / HYDRO.plateau) * mesh.area[c]; all[l] += mesh.area[c];
  }
  const raw = new Float64Array(LON);
  for (let l = 0; l < LON; l++) raw[l] = Math.max(-28, Math.min(28, declinationDeg * (HYDRO.swingSea + HYDRO.swingLand * (all[l] ? share[l] / all[l] : 0))));
  const smooth = new Float64Array(LON);
  for (let l = 0; l < LON; l++) smooth[l] = 0.5 * raw[l] + 0.25 * raw[(l + 1) % LON] + 0.25 * raw[(l + LON - 1) % LON];
  const out = new Float64Array(mesh.n);
  for (let c = 0; c < mesh.n; c++) {
    const f = ((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * LON - 0.5, l0 = Math.floor(f), t = f - l0;
    out[c] = smooth[((l0 % LON) + LON) % LON] * (1 - t) + smooth[(l0 + 1 + LON) % LON] * t;
  }
  return out;
}

/**
 * Surface wind (east, north components, m/s) at a latitude, given the thermal equator, the Hadley edge and the number
 * of cells in a hemisphere; zonal winds flip on a backwards-turning planet. The trade winds blow from the subtropical
 * highs to the convergence zone; the highs follow it only a quarter as far (on Earth about 5° between the seasons,
 * while over land the convergence zone swings 20°), so a summer continent's trades are short and its westerlies
 * stay near their latitude (D159).
 */
export function beltWind(latDeg: number, itczDeg: number, hadleyDeg: number, cells: number, retrograde: boolean): [number, number] {
  const north = latDeg >= itczDeg;
  const sign = north ? 1 : -1;
  let u: number, v: number;
  if (cells <= 1) {
    // One cell: air sinks near the pole and returns along the surface to the equator, turned westward.
    const span = north ? 90 - itczDeg : 90 + itczDeg;
    const d = Math.abs(latDeg - itczDeg) * (90 / Math.max(10, span));
    const s = Math.sin((Math.PI * d) / 90);
    u = -4 * s; v = -sign * 3 * s;
  } else {
    // The high on this side of the convergence zone (degrees of latitude, signed).
    const edge = Math.min(85, hadleyDeg);
    const high = north ? Math.min(85, Math.max(itczDeg + 8, edge + 0.25 * itczDeg)) : Math.max(-85, Math.min(itczDeg - 8, -edge + 0.25 * itczDeg));
    const span = Math.abs(high - itczDeg), d = Math.abs(latDeg - itczDeg);
    if (d < span) {
      // Trade winds: towards the convergence zone, from the east, calm at the zone itself and at the high.
      const f = d / span, s = Math.sin(Math.PI * f);
      u = -7 * Math.sin((Math.PI * f) / 2) * (0.4 + 0.6 * s); v = -sign * 4 * s;
      // Between the equator and a convergence zone drawn into the summer hemisphere, air crossing the equator is
      // turned east by the planet's spin: the south-west monsoon (India, West Africa), the north-west (Australia).
      if (itczDeg * latDeg > 0 && Math.abs(latDeg) < Math.abs(itczDeg)) {
        const g = Math.sin((Math.PI * Math.abs(latDeg)) / Math.abs(itczDeg));
        u = u * (1 - g) + HIGHS.monsoon * g * Math.min(1, Math.abs(itczDeg) / 15);
      }
    } else {
      // Beyond: belts of width (90 − |high|)/(cells − 1), westerlies then easterlies in turn.
      const width = (90 - Math.abs(high)) / Math.max(1, cells - 1);
      const beyond = Math.abs(latDeg - high);
      const k = Math.floor(beyond / width), f = (beyond - k * width) / width;
      const s = Math.sin(Math.PI * f), west = k % 2 === 0;
      u = (west ? 9 : -4) * s; v = sign * (west ? 2 : -2) * s;
    }
  }
  return retrograde ? [-u, v] : [u, v];
}

/**
 * Rain, winds and currents for a planet's present climate, from its monthly temperatures (climate/ebm.ts) and its
 * heights (m above the sea; under 0 the sea). Runs on the climate's coarse mesh, results brought to `mesh`'s level.
 */
export function hydroclimate(mesh: Mesh, def: PlanetDefinition, x: Derived, heightM: ArrayLike<number>, tempMonthly: ArrayLike<number>, level = 4, dryWarm: ArrayLike<number> | null = null, monthStep = 1): HydroResult {
  const fineN = mesh.n, months = 12;
  const coarse = meshAt(Math.min(mesh.level, level)), n = coarse.n;
  const down = (f: ArrayLike<number>) => (mesh.level > coarse.level ? toLevel(f, mesh.level, coarse.level) : Float64Array.from(f));
  const up = (f: ArrayLike<number>) => (mesh.level > coarse.level ? toLevel(f, coarse.level, mesh.level) : Float64Array.from(f));
  const landFine = new Float64Array(fineN), hFine = new Float64Array(fineN);
  for (let c = 0; c < fineN; c++) { landFine[c] = heightM[c] >= 0 ? 1 : 0; hFine[c] = Math.max(0, heightM[c]); }
  const land = down(landFine), height = down(hFine);
  // Winds and rain go by the air column's temperature: dry ground's own extra warmth (ebm.ts, D159) draws in no rain.
  const T: Float64Array[] = [], Tair: Float64Array[] = [];
  for (let m = 0; m < months; m++) {
    const col = Array.prototype.slice.call(tempMonthly, m * fineN, (m + 1) * fineN) as number[];
    Tair.push(down(col));
    if (dryWarm) for (let c = 0; c < fineN; c++) col[c] -= dryWarm[c];
    T.push(down(col));
  }
  const water = def.water.oceanFraction > 0 && def.atmosphere.pressureBar > 0.006;
  const R = def.body.radiusKm * 1000;
  // The sea's currents, from each basin's shores (a raster of the land at about 2°).
  const currents = currentAnomaly(coarse, land, x);
  // The subtropical highs' flanks (D159): poleward, moist on the western sides of wide oceans and the land beside
  // them; equatorward, sinking and dry on their eastern sides and the west coasts facing them.
  const flank = highFlanks(coarse, land, x);
  // (The currents' heat is in the temperatures already: the energy balance carries it, D165.)
  const precipMonthly = new Float32Array(months * fineN), tempOut = new Float32Array(months * fineN);
  let windJan = new Float32Array(2 * fineN), windJul = new Float32Array(2 * fineN);
  const retro = def.body.tiltDeg > 90;
  const { xyz, nbrStart, nbr, edgeLen, edgeDist, area } = coarse;
  // Local east and north unit vectors per cell.
  const east = new Float64Array(3 * n), north = new Float64Array(3 * n);
  for (let c = 0; c < n; c++) {
    const lo = coarse.lon[c], la = coarse.lat[c];
    east[3 * c] = -Math.sin(lo); east[3 * c + 1] = Math.cos(lo); east[3 * c + 2] = 0;
    north[3 * c] = -Math.sin(la) * Math.cos(lo); north[3 * c + 1] = -Math.sin(la) * Math.sin(lo); north[3 * c + 2] = Math.cos(la);
  }
  let total = 0, lastTotal = 0;
  // (A history's past climates work out every `monthStep`-th month and give the months between the last one's rain.)
  for (let m = 0; m < months; m++) {
    if (m % monthStep !== 0) {
      precipMonthly.copyWithin(m * fineN, (m - 1) * fineN, m * fineN);
      total += lastTotal;
      continue;
    }
    const t = T[m], ta = Tair[m];
    // Where the star stands overhead a month earlier (mid-month).
    const o = orbitAt((m - 0.5) / months, def.orbit.eccentricity, def.orbit.perihelionDeg);
    const decl = (Math.asin(Math.sin((def.body.tiltDeg * Math.PI) / 180) * Math.sin(o.lambda)) * 180) / Math.PI;
    const itczAt = convergenceZones(coarse, land, height, decl, def.body.radiusKm);
    // Zonal means for the monsoon's pull (air drawn to where the air column is warmer than its latitude's mean).
    const zb = new Float64Array(37), zw = new Float64Array(37);
    for (let c = 0; c < n; c++) { const b = Math.round(((coarse.lat[c] * 180) / Math.PI + 90) / 5); zb[b] += t[c] * area[c]; zw[b] += area[c]; }
    const anomaly = new Float64Array(n);
    for (let c = 0; c < n; c++) { const b = Math.round(((coarse.lat[c] * 180) / Math.PI + 90) / 5); anomaly[c] = t[c] - zb[b] / zw[b]; }
    // Winds (m/s, 3D tangent vectors).
    const wind = new Float64Array(3 * n);
    for (let c = 0; c < n; c++) {
      let ue: number, vn: number;
      if (x.tidallyLocked) {
        // Towards the point under the star (longitude 0 on the equator), strongest on the day side's edge.
        const tx = 1 - xyz[3 * c] * xyz[3 * c], ty = -xyz[3 * c] * xyz[3 * c + 1], tz = -xyz[3 * c] * xyz[3 * c + 2];
        const l = Math.hypot(tx, ty, tz) || 1;
        const sp = 8 * Math.sin(Math.acos(Math.max(-1, Math.min(1, xyz[3 * c]))));
        wind[3 * c] = (sp * tx) / l; wind[3 * c + 1] = (sp * ty) / l; wind[3 * c + 2] = (sp * tz) / l;
        continue;
      }
      [ue, vn] = beltWind((coarse.lat[c] * 180) / Math.PI, itczAt[c], x.hadleyEdgeDeg, x.cellsPerHemisphere, retro);
      // On a high's western flank the trades turn poleward; on its eastern flank they blow towards the equator.
      vn = vn * Math.max(0, 1 - flank.band[c] * flank.west[c]) + (coarse.lat[c] >= 0 ? 1 : -1) * flank.band[c] * (HIGHS.poleward * flank.west[c] - HIGHS.equatorward * flank.east[c]);
      for (let k = 0; k < 3; k++) wind[3 * c + k] = ue * east[3 * c + k] + vn * north[3 * c + k];
    }
    // The monsoon's pull: down the temperature anomaly's gradient towards warmer ground, at 0.4 m/s per K over a cell.
    for (let c = 0; c < n; c++) {
      let gx = 0, gy = 0, gz = 0;
      for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
        const j = nbr[k], dx = xyz[3 * j] - xyz[3 * c], dy = xyz[3 * j + 1] - xyz[3 * c + 1], dz = xyz[3 * j + 2] - xyz[3 * c + 2];
        const l = Math.hypot(dx, dy, dz) || 1, dT = anomaly[j] - anomaly[c];
        gx += (dT * dx) / l; gy += (dT * dy) / l; gz += (dT * dz) / l;
      }
      const deg = nbrStart[c + 1] - nbrStart[c];
      wind[3 * c] += (0.8 * gx) / deg; wind[3 * c + 1] += (0.8 * gy) / deg; wind[3 * c + 2] += (0.8 * gz) / deg;
    }
    // Rain: precipitable water carried downwind, raining out at a rate set by rising or sinking air.
    const W = new Float64Array(n), P = new Float64Array(n);
    if (water) {
      // Rate of rain (per day) for vapour aloft: about a tenth a day in rising air, much less where air sinks.
      const rate = new Float64Array(n), source = new Float64Array(n), convect = new Float64Array(n), lift = new Float64Array(n), sat = new Float64Array(n);
      for (let c = 0; c < n; c++) {
        const lat = (coarse.lat[c] * 180) / Math.PI, d = Math.abs(lat - itczAt[c]);
        // (The convergence zone's rising air and the storm belts', each with its own efficiency: storms rain out more of
        // less vapour, D165.)
        const rising = Math.exp(-((d / HYDRO.itczWidth) ** 2)) + (HYDRO.storm / HYDRO.rising) * Math.exp(-(((Math.abs(lat) - Math.min(80, x.hadleyEdgeDeg + 20)) / 13) ** 2));
        // Warm air rises in storms only where it is moist (over dry hot ground it does not: D159), so this part of
        // the rate is weighed by how near saturation the vapour is, step by step.
        convect[c] = HYDRO.convective * Math.max(0, Math.min(1, (t[c] - 22) / 6));
        // The subtropical highs' sinking air, beside the convergence zone; the highs follow its swing only partly (on
        // the Earth about a quarter as far: D159, D165), so a desert stays under its high in winter too.
        // (Not beside the convergence zone itself: where a monsoon draws it far, as over India, the high gives way.)
        const dh = Math.abs(lat - HYDRO.highFollow * itczAt[c]), clear = Math.max(0, Math.min(1, (d - HYDRO.nearItcz) / HYDRO.nearItcz));
        const sinking = clear * Math.exp(-(((dh - Math.min(60, x.hadleyEdgeDeg) + 8) / 9) ** 2)) * Math.max(0, 1 + HIGHS.sinking * (flank.east[c] - flank.west[c]));
        // (Under the highs' sinking air the warm ground's convection stays shallow and dry: D165.)
        convect[c] *= Math.max(0, 1 - HYDRO.subsidence * sinking);
        // Up or down a slope: the wind across the height's gradient (m/s × m/m), the biggest single term.
        let up = 0;
        for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
          const j = nbr[k], dx = xyz[3 * j] - xyz[3 * c], dy = xyz[3 * j + 1] - xyz[3 * c + 1], dz = xyz[3 * j + 2] - xyz[3 * c + 2];
          const l = Math.hypot(dx, dy, dz) || 1;
          // Wind blowing from j towards c over ground rising towards c.
          const along = -(wind[3 * c] * dx + wind[3 * c + 1] * dy + wind[3 * c + 2] * dz) / l;
          up += (along * (height[c] - height[j])) / (edgeDist[k] * R) * (edgeLen[k] / (2 * Math.PI / 5));
        }
        up /= nbrStart[c + 1] - nbrStart[c];
        lift[c] = 1 + Math.max(-0.9, Math.min(6, 3000 * up));
        rate[c] = Math.max(0.01, HYDRO.base * (1 + HYDRO.rising * rising - HYDRO.sinking * sinking) * lift[c]);
        // (Deep convection keeps the warmest seas near 30 °C: evaporation is reckoned from no warmer.)
        sat[c] = vapour(Math.min(30, t[c]));
        // Evaporation: over the sea towards saturation, faster in wind; over land a share of what falls is recycled.
        const speed = Math.hypot(wind[3 * c], wind[3 * c + 1], wind[3 * c + 2]);
        source[c] = (1 - land[c]) * Math.max(0, HYDRO.evaporation * sat[c] * (0.5 + speed / 10) * (t[c] > -2 ? 1 : 0.3));
        W[c] = (1 - land[c]) * sat[c];
      }
      // The wind's flux across each edge (per second, as a share of the cell), the same every step of the month.
      const flux = new Float64Array(nbr.length);
      for (let c = 0; c < n; c++) {
        for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
          const j = nbr[k], dx = xyz[3 * j] - xyz[3 * c], dy = xyz[3 * j + 1] - xyz[3 * c + 1], dz = xyz[3 * j + 2] - xyz[3 * c + 2];
          const l = Math.hypot(dx, dy, dz) || 1;
          // (Vapour lies low, where winds are about 0.7 of those at the surface's top.)
          const un = 0.5 * HYDRO.carry * ((wind[3 * c] + wind[3 * j]) * dx + (wind[3 * c + 1] + wind[3 * j + 1]) * dy + (wind[3 * c + 2] + wind[3 * j + 2]) * dz) / l;
          flux[k] = (un * edgeLen[k] * R) / (area[c] * R * R);
        }
      }
      // Storms carry vapour poleward as eddies (D159): diffusion down the vapour's gradient, strongest in the storm
      // belts (as moist energy-balance models do; Frierson, Held and Zurita-Gotor 2007), per second per edge.
      const eddy = new Float64Array(nbr.length);
      const belt = Math.min(75, x.hadleyEdgeDeg + 15);
      for (let c = 0; c < n; c++) {
        for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
          const j = nbr[k], z = (xyz[3 * c + 2] + xyz[3 * j + 2]) / 2, lat = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
          const K = HYDRO.eddy * (0.25 + Math.exp(-(((Math.abs(lat) - belt) / 20) ** 2))) * (x.cellsPerHemisphere >= 2 ? 1 : 0.5);
          eddy[k] = (K * edgeLen[k]) / (edgeDist[k] * area[c] * R * R);
        }
      }
      // (Kept within what an explicit step can carry stably: at most 0.4 of a cell's vapour exchanged per step.)
      let most = 0;
      for (let c = 0; c < n; c++) { let sum = 0; for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) sum += eddy[k]; most = Math.max(most, sum * (DAY / 3)); }
      if (most > 0.4) for (let k = 0; k < eddy.length; k++) eddy[k] *= 0.4 / most;
      // Steady state by upwind steps of a third of a day (what condenses at the cap counted as rain, per step, at the end).
      const dt = DAY / 3, steps = 240, extra = new Float64Array(n);
      for (let it = 0; it < steps; it++) {
        if (it === steps - 60) extra.fill(0);
        const next = new Float64Array(n);
        for (let c = 0; c < n; c++) {
          let inflow = 0, outflow = 0;
          for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
            const f = flux[k], j = nbr[k];
            if (f > 0) outflow += f; else inflow -= f * W[j];
            inflow += eddy[k] * (W[j] - W[c]);
          }
          const r = rate[c] + HYDRO.base * HYDRO.rising * convect[c] * lift[c] * Math.min(1, W[c] / sat[c]);
          const rain = (r / DAY) * W[c];
          // Land gives back part of its rain by evaporation and the breath of plants: more where it is warm and wet.
          const recycled = land[c] ? (HYDRO.recycle + HYDRO.warmRecycle * Math.max(0, Math.min(1, (t[c] - 12) / 12))) * rain : 0;
          // (Evaporation slows as the air nears saturation, D165: the bulk formula's humidity deficit, as much as before
          // with the air at its usual vapour, more with drier air.)
          const evap = HYDRO.deficit > 0 ? source[c] * Math.max(0, 1 - W[c] / ((1 + HYDRO.deficit) * sat[c])) * (1 + 1 / HYDRO.deficit) : source[c];
          next[c] = Math.max(0, W[c] + dt * (evap / DAY + recycled + inflow - outflow * W[c] - rain));
          // Vapour cannot much exceed what the air holds at its temperature: over cold ground it condenses and falls.
          // (The air's own temperature: over a hot desert it holds more, D165.)
          const cap = (land[c] ? 0.9 : 1.05) * vapour(Math.min(30, ta[c]));
          if (next[c] > cap) { extra[c] += next[c] - cap; next[c] = cap; }
        }
        W.set(next);
      }
      const days = x.yearDays / months;
      for (let c = 0; c < n; c++) P[c] = ((rate[c] + HYDRO.base * HYDRO.rising * convect[c] * lift[c] * Math.min(1, W[c] / sat[c])) * W[c] + (extra[c] / 60) * (DAY / dt)) * days;
    }
    const fineP = up(P);
    for (let c = 0; c < fineN; c++) precipMonthly[m * fineN + c] = Math.max(0, fineP[c]);
    if (m === 0 || m === 6) {
      const out = new Float32Array(2 * fineN);
      const ue = up(Float64Array.from({ length: n }, (_, c) => wind[3 * c] * east[3 * c] + wind[3 * c + 1] * east[3 * c + 1] + wind[3 * c + 2] * east[3 * c + 2]));
      const vn = up(Float64Array.from({ length: n }, (_, c) => wind[3 * c] * north[3 * c] + wind[3 * c + 1] * north[3 * c + 1] + wind[3 * c + 2] * north[3 * c + 2]));
      for (let c = 0; c < fineN; c++) { out[2 * c] = ue[c]; out[2 * c + 1] = vn[c]; }
      if (m === 0) windJan = out; else windJul = out;
    }
    lastTotal = 0;
    for (let c = 0; c < n; c++) lastTotal += P[c] * area[c];
    total += lastTotal;
  }
  // The currents' warmth on the fine mesh's temperatures (and a little inland).
  const cur = up(currents);
  for (let m = 0; m < months; m++) for (let c = 0; c < fineN; c++) tempOut[m * fineN + c] = tempMonthly[m * fineN + c];
  const precipAnnual = new Float32Array(fineN);
  for (let m = 0; m < months; m++) for (let c = 0; c < fineN; c++) precipAnnual[c] += precipMonthly[m * fineN + c];
  return { precipMonthly, precipAnnual, tempMonthly: tempOut, currents: Float32Array.from(cur), windJan, windJul, meanPrecip: total / (4 * Math.PI) };
}


/**
 * Where each cell lies against the subtropical highs over the oceans (D159). Over a wide ocean (at least
 * HIGHS.wide km across along the parallel) the high's western flank lies along the basin's western side and the
 * eastern side of the land beyond it (air turns poleward round the high, bringing the sea's moisture: the Gulf of
 * Mexico's to the American south-east and plains, the South China Sea's to China, the Atlantic's to south-eastern
 * Brazil and Argentina, the Tasman's to eastern Australia); its eastern flank along the basin's eastern side and the
 * west coast facing it (air sinking and turning towards the equator: California, the Canaries and the Sahara's
 * coast, the Atacama, the Namib, Western Australia). Weights 0 to 1 by distance, and the band of latitude they act in.
 */
function highFlanks(mesh: Mesh, land: ArrayLike<number>, x: Derived): { west: Float64Array; east: Float64Array; band: Float64Array } {
  const n = mesh.n, W = 180, H = 90, grid = new Uint8Array(W * H);
  const west = new Float64Array(n), east = new Float64Array(n), band = new Float64Array(n);
  if (!(x.cellsPerHemisphere >= 2) || x.tidallyLocked) return { west, east, band };
  for (let c = 0; c < n; c++) {
    if (land[c] < 0.5) continue;
    const i = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * W) % W, j = Math.min(H - 1, Math.floor(((Math.PI / 2 - mesh.lat[c]) / Math.PI) * H));
    grid[j * W + i] = 1;
  }
  // Close one-cell gaps in each row (the raster is finer than the mesh's land).
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!grid[j * W + i] && grid[j * W + ((i + 1) % W)] && grid[j * W + ((i - 1 + W) % W)]) grid[j * W + i] = 2;
  const R = x.radiusM / 1000;
  for (let c = 0; c < n; c++) {
    const a = Math.abs((mesh.lat[c] * 180) / Math.PI);
    band[c] = Math.exp(-(((a - (x.hadleyEdgeDeg - 3)) / 12) ** 2));
    if (band[c] < 0.02) continue;
    const i0 = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * W) % W, j = Math.min(H - 1, Math.floor(((Math.PI / 2 - mesh.lat[c]) / Math.PI) * H));
    const km = ((2 * Math.PI * R) / W) * Math.cos(mesh.lat[c]);
    const isLand = (s: number) => grid[j * W + (((i0 + s) % W) + W) % W] > 0;
    /** From cell offset `from` stepping `dir`: the distance (km) to the first run of sea at least HIGHS.wide across, or Infinity. */
    const toWideSea = (dir: number) => {
      for (let s = 0; Math.abs(s) < W; s += dir) {
        if (isLand(s)) continue;
        let k = s;
        while (!isLand(k) && Math.abs(k - s) * km < HIGHS.wide && Math.abs(k) < W) k += dir;
        if (Math.abs(k - s) * km >= HIGHS.wide) return Math.abs(s) * km;
        s = k - dir;
      }
      return Infinity;
    };
    // Inside a wide ocean: how near its western shore (land to the west) and its eastern shore.
    let dw = Infinity, de = Infinity;
    if (land[c] < 0.5) {
      for (let s = 1; s < W / 2; s++) if (isLand(-s)) { dw = s * km; break; }
      for (let s = 1; s < W / 2; s++) if (isLand(s)) { de = s * km; break; }
    }
    if (land[c] < 0.5 && dw + de >= HIGHS.wide) {
      west[c] = Math.exp(-dw / HIGHS.reachSea);
      east[c] = Math.exp(-de / HIGHS.reachSea);
    } else {
      // Land, or a narrow sea (the Gulf of Mexico, the Yellow Sea): beside a wide ocean to the east, on its high's
      // western flank; just east of one, on the eastern flank of the high to the west.
      west[c] = Math.exp(-toWideSea(1) / HIGHS.reachLand);
      east[c] = Math.exp(-toWideSea(-1) / HIGHS.coast);
    }
  }
  return { west, east, band };
}
