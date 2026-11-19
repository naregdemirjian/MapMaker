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
export const HYDRO = { base: 0.08, rising: 1.3, sinking: 0.6, itczWidth: 11, swingSea: 0.3, swingLand: 0.9, convective: 0.8, recycle: 0.3, evaporation: 0.14 };
/** Precipitable water over the sea at a temperature (mm): about 50 mm in the warm tropics, a few at the poles. */
const vapour = (t: number) => 48 * Math.exp(0.066 * (t - 27));

/**
 * The convergence zone in a month by longitude (degrees): it follows the latitude where the star stands overhead, a
 * month late, swinging much further over land, which warms quickly, and furthest over high ground (on Earth to about
 * 20° N over Asia in July, 8° over the Pacific): the monsoons. By 30° bands of longitude, the land's share of the
 * summer hemisphere to 40° (high ground counting more) deciding the swing; smoothed across the bands, read per cell.
 */
function convergenceZones(mesh: Mesh, land: ArrayLike<number>, height: ArrayLike<number>, declinationDeg: number): Float64Array {
  const LON = 12;
  const share = new Float64Array(LON), all = new Float64Array(LON);
  const summer = declinationDeg >= 0 ? 1 : -1;
  for (let c = 0; c < mesh.n; c++) {
    const lat = ((mesh.lat[c] * 180) / Math.PI) * summer;
    if (lat < 0 || lat > 40) continue;
    const l = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * LON) % LON;
    // High ground heats the air above it most (a plateau draws the monsoon furthest).
    share[l] += land[c] * (1 + height[c] / 2000) * mesh.area[c]; all[l] += mesh.area[c];
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
 * of cells in a hemisphere; zonal winds flip on a backwards-turning planet.
 */
export function beltWind(latDeg: number, itczDeg: number, hadleyDeg: number, cells: number, retrograde: boolean): [number, number] {
  // Distance from the convergence zone, in the hemisphere's own sense.
  const north = latDeg >= itczDeg;
  const span = north ? 90 - itczDeg : 90 + itczDeg;
  const d = Math.abs(latDeg - itczDeg) * (90 / Math.max(10, span));
  const sign = north ? 1 : -1;
  let u: number, v: number;
  if (cells <= 1) {
    // One cell: air sinks near the pole and returns along the surface to the equator, turned westward.
    const s = Math.sin((Math.PI * d) / 90);
    u = -4 * s; v = -sign * 3 * s;
  } else {
    const edge = Math.min(85, hadleyDeg);
    if (d < edge) {
      // Trade winds: towards the convergence zone, from the east, calm at the zone itself.
      const s = Math.sin((Math.PI * d) / edge);
      u = -7 * Math.sin((Math.PI * d) / (2 * edge)) * (0.4 + 0.6 * s); v = -sign * 4 * s;
    } else {
      // Beyond: belts of width (90 − edge)/(cells − 1), westerlies then easterlies in turn.
      const width = (90 - edge) / Math.max(1, cells - 1);
      const k = Math.floor((d - edge) / width), f = (d - edge - k * width) / width;
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
export function hydroclimate(mesh: Mesh, def: PlanetDefinition, x: Derived, heightM: ArrayLike<number>, tempMonthly: ArrayLike<number>, level = 4): HydroResult {
  const fineN = mesh.n, months = 12;
  const coarse = meshAt(Math.min(mesh.level, level)), n = coarse.n;
  const down = (f: ArrayLike<number>) => (mesh.level > coarse.level ? toLevel(f, mesh.level, coarse.level) : Float64Array.from(f));
  const up = (f: ArrayLike<number>) => (mesh.level > coarse.level ? toLevel(f, coarse.level, mesh.level) : Float64Array.from(f));
  const landFine = new Float64Array(fineN), hFine = new Float64Array(fineN);
  for (let c = 0; c < fineN; c++) { landFine[c] = heightM[c] >= 0 ? 1 : 0; hFine[c] = Math.max(0, heightM[c]); }
  const land = down(landFine), height = down(hFine);
  const T: Float64Array[] = [];
  for (let m = 0; m < months; m++) T.push(down(Array.prototype.slice.call(tempMonthly, m * fineN, (m + 1) * fineN) as number[]));
  const water = def.water.oceanFraction > 0 && def.atmosphere.pressureBar > 0.006;
  const R = def.body.radiusKm * 1000;
  // The sea's currents, from each basin's shores (a raster of the land at about 2°).
  const currents = currentAnomaly(coarse, land, x);
  for (let m = 0; m < months; m++) for (let c = 0; c < n; c++) T[m][c] += currents[c] * (1 - 0.6 * land[c]);
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
  let total = 0;
  for (let m = 0; m < months; m++) {
    const t = T[m];
    // Where the star stands overhead a month earlier (mid-month).
    const o = orbitAt((m - 0.5) / months, def.orbit.eccentricity, def.orbit.perihelionDeg);
    const decl = (Math.asin(Math.sin((def.body.tiltDeg * Math.PI) / 180) * Math.sin(o.lambda)) * 180) / Math.PI;
    const itczAt = convergenceZones(coarse, land, height, decl);
    // Zonal means for the monsoon's pull (air drawn to where it is warmer than its latitude's mean).
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
      const rate = new Float64Array(n), source = new Float64Array(n);
      for (let c = 0; c < n; c++) {
        const lat = (coarse.lat[c] * 180) / Math.PI, d = Math.abs(lat - itczAt[c]);
        const rising = Math.exp(-((d / HYDRO.itczWidth) ** 2)) + 0.75 * Math.exp(-(((Math.abs(lat) - Math.min(80, x.hadleyEdgeDeg + 20)) / 13) ** 2))
          + HYDRO.convective * Math.max(0, Math.min(1, (t[c] - 22) / 6));
        const sinking = Math.exp(-(((d - Math.min(60, x.hadleyEdgeDeg) + 8) / 9) ** 2));
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
        rate[c] = Math.max(0.01, HYDRO.base * (1 + HYDRO.rising * rising - HYDRO.sinking * sinking) * (1 + Math.max(-0.9, Math.min(6, 3000 * up))));
        // (Deep convection keeps the warmest seas near 30 °C: evaporation is reckoned from no warmer.)
        const sat = vapour(Math.min(30, t[c]));
        // Evaporation: over the sea towards saturation, faster in wind; over land a share of what falls is recycled.
        const speed = Math.hypot(wind[3 * c], wind[3 * c + 1], wind[3 * c + 2]);
        source[c] = (1 - land[c]) * Math.max(0, HYDRO.evaporation * sat * (0.5 + speed / 10) * (t[c] > -2 ? 1 : 0.3));
        W[c] = (1 - land[c]) * sat;
      }
      // Steady state by upwind steps of a third of a day (what condenses at the cap counted as rain, per step, at the end).
      const dt = DAY / 3, steps = 240, extra = new Float64Array(n);
      for (let it = 0; it < steps; it++) {
        if (it === steps - 60) extra.fill(0);
        const next = new Float64Array(n);
        for (let c = 0; c < n; c++) {
          let inflow = 0, outflow = 0;
          for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
            const j = nbr[k], dx = xyz[3 * j] - xyz[3 * c], dy = xyz[3 * j + 1] - xyz[3 * c + 1], dz = xyz[3 * j + 2] - xyz[3 * c + 2];
            const l = Math.hypot(dx, dy, dz) || 1;
            // (Vapour lies low, where winds are about 0.7 of those at the surface's top.)
            const un = 0.35 * ((wind[3 * c] + wind[3 * j]) * dx + (wind[3 * c + 1] + wind[3 * j + 1]) * dy + (wind[3 * c + 2] + wind[3 * j + 2]) * dz) / l;
            const flux = (un * edgeLen[k] * R) / (area[c] * R * R); // per second, share of the cell
            if (un > 0) outflow += flux; else inflow -= flux * W[j];
          }
          const rain = (rate[c] / DAY) * W[c];
          // Land gives back part of its rain by evaporation and the breath of plants: more where it is warm and wet.
          const recycled = land[c] ? (HYDRO.recycle + 0.3 * Math.max(0, Math.min(1, (t[c] - 12) / 12))) * rain : 0;
          next[c] = Math.max(0, W[c] + dt * (source[c] / DAY + recycled + inflow - outflow * W[c] - rain));
          // Vapour cannot much exceed what the air holds at its temperature: over cold ground it condenses and falls.
          const cap = (land[c] ? 0.9 : 1.05) * vapour(Math.min(30, t[c]));
          if (next[c] > cap) { extra[c] += next[c] - cap; next[c] = cap; }
        }
        W.set(next);
      }
      const days = x.yearDays / months;
      for (let c = 0; c < n; c++) P[c] = (rate[c] * W[c] + (extra[c] / 60) * (DAY / dt)) * days;
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
    for (let c = 0; c < n; c++) total += P[c] * area[c];
  }
  // The currents' warmth on the fine mesh's temperatures (and a little inland).
  const cur = up(currents);
  for (let m = 0; m < months; m++) for (let c = 0; c < fineN; c++) tempOut[m * fineN + c] = tempMonthly[m * fineN + c] + cur[c] * (heightM[c] >= 0 ? 0.4 : 1);
  const precipAnnual = new Float32Array(fineN);
  for (let m = 0; m < months; m++) for (let c = 0; c < fineN; c++) precipAnnual[c] += precipMonthly[m * fineN + c];
  return { precipMonthly, precipAnnual, tempMonthly: tempOut, currents: Float32Array.from(cur), windJan, windJul, meanPrecip: total / (4 * Math.PI) };
}

/**
 * The sea surface's change from the currents (K): warm along each basin's western side, cool along its eastern side
 * (between about 10° and 45°), warm on the eastern side at high latitudes where the warm drift arrives, fading with
 * distance from the shore (about 1,000 km); on land a little of it, fading inland.
 */
function currentAnomaly(mesh: Mesh, land: ArrayLike<number>, x: Derived): Float64Array {
  const n = mesh.n, W = 180, H = 90, grid = new Uint8Array(W * H);
  // A raster of the land (2° cells), from the mesh.
  for (let c = 0; c < n; c++) {
    if (land[c] < 0.5) continue;
    const i = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * W) % W, j = Math.min(H - 1, Math.floor(((Math.PI / 2 - mesh.lat[c]) / Math.PI) * H));
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const jj = j + dj, ii = (i + di + W) % W;
      if (jj >= 0 && jj < H && Math.hypot(di, dj) < 1.2) grid[jj * W + ii] = 1;
    }
  }
  const out = new Float64Array(n);
  if (!(x.cellsPerHemisphere >= 2) || x.tidallyLocked) return out;
  const R = x.radiusM / 1000, L = 1000;
  for (let c = 0; c < n; c++) {
    if (land[c] >= 0.5) continue;
    const lat = (mesh.lat[c] * 180) / Math.PI, a = Math.abs(lat);
    const i0 = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * W) % W, j = Math.min(H - 1, Math.floor(((Math.PI / 2 - mesh.lat[c]) / Math.PI) * H));
    const kmPerCell = ((2 * Math.PI * R) / W) * Math.cos(mesh.lat[c]);
    // Distance to the shore to the west and to the east, along the parallel (within half the world).
    let dw = Infinity, de = Infinity;
    for (let s = 1; s < W / 2; s++) { if (grid[j * W + ((i0 - s + W) % W)]) { dw = s * kmPerCell; break; } }
    for (let s = 1; s < W / 2; s++) { if (grid[j * W + ((i0 + s) % W)]) { de = s * kmPerCell; break; } }
    const west = Math.exp(-dw / L), eastSide = Math.exp(-de / L);
    const edge = x.hadleyEdgeDeg;
    // Warm western boundary currents in the subtropics and mid-latitudes, cold eastern ones; at high latitudes the drift warms the east.
    const sub = Math.exp(-(((a - (edge - 5)) / 15) ** 2));
    const high = Math.exp(-(((a - (edge + 25)) / 10) ** 2));
    out[c] = 4 * sub * west - 4 * sub * eastSide + 5 * high * eastSide;
  }
  return out;
}
