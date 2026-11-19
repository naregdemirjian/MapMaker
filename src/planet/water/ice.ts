// Ice sheets (Stage 14.8, D159): physically based, with empirical melt factors.
//
// - Surface mass balance: snow is the share of each month's rain and snow falling on days below 1 °C (daily
//   temperatures spread normally about the month's mean, σ = 5 K); melt follows positive degree days (Braithwaite
//   1995; Reeh 1991: the expected sum of daily temperatures above freezing), 3 mm a day per degree for snow, 8 for
//   ice once the snow is gone; up to 60 per cent of the year's snow can hold meltwater that refreezes.
// - On the ice the air is colder by the lapse rate for the ice's height, and snowfall falls off in the colder air
//   (about 5 per cent per degree, as the air holds less water), so a growing sheet feeds itself until its flanks
//   reach warmer air.
// - Flow: the shallow-ice approximation (Hutter 1983) with Glen's law (n = 3): ice moves down its surface's slope with
//   a flux Γ H⁵ |∇s|² ∇s, Γ = 2A(ρg)³/5, solved implicitly on the mesh (Mahaffy 1976, the diffusivity taken from the
//   last step), so steps of centuries are stable; run until the volume settles.
// - The ice's weight presses the ground down by ρ_ice/ρ_mantle of its thickness (local isostasy, at equilibrium);
//   ice floating off the coast calves away (no ice shelves).
import type { Mesh } from '../mesh/icosphere.ts';

export const ICE = {
  rho: 917, rhoWater: 1000, rhoMantle: 3300,
  /** Glen's rate factor, Pa⁻³ a⁻¹ (ice at about −10 °C with a modest enhancement). */
  A: 5e-17,
  /** Degree-day factors, m of water a day per K: snow, ice. */
  ddfSnow: 0.003, ddfIce: 0.008,
  /** Spread of daily temperatures about a month's mean (K), and the share of the year's snow that can refreeze meltwater. */
  sigma: 5, refreeze: 0.6,
  /** Fall in snowfall per K of colder air over the ice. */
  desert: 0.05,
};

const SQRT2PI = Math.sqrt(2 * Math.PI);
/** Standard normal distribution: density and cumulative (Abramowitz and Stegun 26.2.17, within 1e-7). */
const phi = (x: number) => Math.exp(-0.5 * x * x) / SQRT2PI;
function Phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const p = phi(x) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Positive degree days in a month of `days` days with mean temperature `t` (°C). */
export function positiveDegreeDays(t: number, days: number, sigma = ICE.sigma): number {
  const x = t / sigma;
  return days * (sigma * phi(x) + t * Phi(x));
}

export interface MassBalance {
  /** Snow, melt running off, and the balance (m of water a year). */
  snow: number;
  runoff: number;
  balance: number;
}

/** The year's balance of snow and ice at a place from its 12 monthly temperatures (°C) and rain and snow (mm). */
export function massBalance(temp: ArrayLike<number>, precip: ArrayLike<number>, daysPerMonth: number): MassBalance {
  let snow = 0, pdd = 0;
  for (let m = 0; m < temp.length; m++) {
    snow += (Math.max(0, precip[m]) / 1000) * Phi((1 - temp[m]) / ICE.sigma);
    pdd += positiveDegreeDays(temp[m], daysPerMonth);
  }
  // Snow melts first; what melt is left over melts ice beneath.
  const snowMelt = Math.min(snow, ICE.ddfSnow * pdd);
  const iceMelt = ICE.ddfIce * Math.max(0, pdd - snowMelt / ICE.ddfSnow);
  const melt = snowMelt + iceMelt;
  const runoff = melt - Math.min(ICE.refreeze * snow, melt);
  return { snow, runoff, balance: snow - runoff };
}

export interface IceInput {
  mesh: Mesh;
  radiusKm: number;
  gravity: number;
  /** Ground height (m above the sea) without ice, and monthly temperature (°C, at that ground) and rain and snow (mm), [m·n + c]. */
  bed: ArrayLike<number>;
  temp: ArrayLike<number>;
  precip: ArrayLike<number>;
  /** Earth days in the planet's year; the lapse rate (K per km). */
  yearDays: number;
  lapse: number;
  /** How long to run (years, at most) and the step (years). */
  years?: number;
  dt?: number;
}

export interface IceResult {
  /** Ice thickness (m), the ice's surface (m above the sea) and the ground pressed down under it (m). */
  thickness: Float64Array;
  surface: Float64Array;
  ground: Float64Array;
  /** The year's balance at the surface (m of water), and the meltwater running off (mm a year). */
  balance: Float64Array;
  runoff: Float64Array;
  /** Volume of ice (m³), its area (m²), and how far the sea would rise if it all melted (m, over the present sea's area). */
  volume: number;
  area: number;
  seaLevelEquivalent: number;
  years: number;
  /** Ice lost to the sea at the coast over the run (m³ of ice) and snow gained (m³ of ice). */
  calved: number;
  gained: number;
}

/** Ice sheets grown from bare ground to a steady state in the given climate. */
export function iceSheets(input: IceInput): IceResult {
  const { mesh, bed } = input;
  const n = mesh.n, R = input.radiusKm * 1000, months = 12, days = input.yearDays / months;
  const { nbrStart, nbr, edgeLen, edgeDist } = mesh;
  const area = new Float64Array(n);
  for (let c = 0; c < n; c++) area[c] = mesh.area[c] * R * R;
  const Gamma = (2 * ICE.A * (ICE.rho * input.gravity) ** 3) / 5;
  const sink = ICE.rho / ICE.rhoMantle;
  const H = new Float64Array(n), ground = Float64Array.from(bed), s = new Float64Array(n);
  const balance = new Float64Array(n), runoff = new Float64Array(n);
  const dt = input.dt ?? 200, maxYears = input.years ?? 60_000;
  const T = new Float64Array(months), P = new Float64Array(months);
  let seaArea = 0;
  for (let c = 0; c < n; c++) if (bed[c] < 0) seaArea += area[c];
  /** The year's balance (m of ice) at each cell with the ice's surface where it is now. */
  const updateBalance = () => {
    for (let c = 0; c < n; c++) {
      const rise = Math.max(0, s[c]) - Math.max(0, bed[c]);
      const dT = (-input.lapse * rise) / 1000;
      for (let m = 0; m < months; m++) {
        T[m] = input.temp[m * n + c] + dT;
        P[m] = input.precip[m * n + c] * Math.exp(ICE.desert * Math.min(0, dT));
      }
      const mb = massBalance(T, P, days);
      balance[c] = mb.balance;
      runoff[c] = mb.runoff * 1000;
    }
  };
  const w = new Float64Array(nbr.length), diag = new Float64Array(n), rhs = new Float64Array(n);
  let calved = 0, gained = 0, years = 0, last = 0;
  for (let c = 0; c < n; c++) s[c] = ground[c];
  updateBalance();
  for (let step = 0; years < maxYears; step++) {
    // Ice-equivalent balance (m of ice a year).
    if (step % 5 === 0) updateBalance();
    // The diffusivity across each edge from the thickness and slope now.
    for (let i = 0; i < n; i++) {
      for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) {
        const j = nbr[k];
        if (j < i) { w[k] = 0; continue; }
        const h = 0.5 * (H[i] + H[j]);
        if (h <= 0) { w[k] = 0; continue; }
        const d = edgeDist[k] * R, slope = Math.abs(s[j] - s[i]) / d;
        w[k] = (Gamma * h ** 5 * slope * slope * edgeLen[k] * R) / d;
      }
    }
    // Symmetric weights for both directions of each edge.
    for (let i = 0; i < n; i++) {
      for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) {
        const j = nbr[k];
        if (j >= i) continue;
        for (let q = nbrStart[j]; q < nbrStart[j + 1]; q++) if (nbr[q] === i) { w[k] = w[q]; break; }
      }
    }
    // A_i (H_i − H_i⁰)/dt + Σ w_ij (s_i − s_j) = A_i b_i, with s = ground + H (ground held for the step).
    for (let i = 0; i < n; i++) {
      const b = (balance[i] * ICE.rhoWater) / ICE.rho;
      const add = H[i] > 0 || b > 0 ? b : 0;
      diag[i] = area[i] / dt;
      let flow = 0;
      for (let k = nbrStart[i]; k < nbrStart[i + 1]; k++) flow += w[k] * (ground[nbr[k]] - ground[i]);
      rhs[i] = area[i] * (H[i] / dt + add) + flow;
    }
    const next = solve(n, nbrStart, nbr, w, diag, rhs, H);
    let before = 0, after = 0;
    for (let i = 0; i < n; i++) before += H[i] * area[i];
    for (let i = 0; i < n; i++) {
      const b = (balance[i] * ICE.rhoWater) / ICE.rho;
      if (b > 0) gained += b * dt * area[i];
      let h = Math.max(0, next[i]);
      // Ice that would float (its bed below the sea, too thin to rest on it) breaks away.
      const g = bed[i] - sink * h;
      if (g < 0 && h * ICE.rho < -g * ICE.rhoWater) { calved += h * area[i]; h = 0; }
      H[i] = h;
      ground[i] = bed[i] - sink * h;
      s[i] = ground[i] + h;
      after += h * area[i];
    }
    years += dt;
    // Settled: the volume changing by less than a part in 10⁴ over the step (after a minimum run).
    if (years > 5000 && Math.abs(after - before) <= 1e-4 * Math.max(after, 1e9)) break;
    last = after;
  }
  void last;
  updateBalance();
  let volume = 0, iceArea = 0;
  for (let c = 0; c < n; c++) { volume += H[c] * area[c]; if (H[c] > 50) iceArea += area[c]; }
  return {
    thickness: H, surface: s, ground, balance, runoff, volume, area: iceArea,
    seaLevelEquivalent: seaArea > 0 ? (volume * ICE.rho) / ICE.rhoWater / seaArea : 0, years, calved, gained,
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
  for (let it = 0; it < 500; it++) {
    let rr = 0;
    for (let i = 0; i < n; i++) rr += r[i] * r[i];
    if (rr <= 1e-24 * rr0) break;
    apply(p, q);
    let pq = 0;
    for (let i = 0; i < n; i++) pq += p[i] * q[i];
    if (!(pq > 0)) break;
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
 * The ice a climate would hold, estimated without running the flow (for the history's past climates, D159): over
 * each connected region of land where snow outlasts the summer, a sheet of volume 0.034 A^1.25 (km³ for A in km²;
 * Bahr, Meier and Peckham 1997's scaling for ice caps, as a perfectly plastic sheet gives, matched to Antarctica and
 * Greenland). Returns the volume, m³.
 */
export function iceVolumeEstimate(mesh: Mesh, radiusKm: number, land: ArrayLike<number>, accumulating: ArrayLike<number>): number {
  const n = mesh.n, seen = new Uint8Array(n), km2 = radiusKm * radiusKm;
  let volume = 0;
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0] || !land[s0] || !accumulating[s0]) continue;
    let a = 0;
    const stack = [s0];
    seen[s0] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      a += mesh.area[c] * km2;
      for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
        const j = mesh.nbr[e];
        if (!seen[j] && land[j] && accumulating[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    volume += 0.034 * a ** 1.25 * 1e9;
  }
  return volume;
}
