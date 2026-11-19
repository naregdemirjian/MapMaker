// Sunlight at the top of the air (Stage 14, D152): physically based orbital geometry.
//
// Through the year the planet moves on its ellipse (Kepler's equation gives where it is at any moment and how far
// from its star), the solar longitude λ (0 at the northern spring equinox) sets the star's declination
// (sin δ = sin ε sin λ, ε the tilt), and the daily mean at latitude φ is (Berger 1978)
//   Q = (S/π) (a/r)² (h₀ sin φ sin δ + cos φ cos δ sin h₀),   cos h₀ = −tan φ tan δ,
// with S the light at the orbit's semi-major axis and h₀ the hour angle of sunset (π in polar day, 0 in polar
// night). A tidally locked planet keeps its star overhead at one point (longitude 0, latitude 0 here):
// Q = S (a/r)² max(0, cos θ), θ the angle from that point. A circumbinary pair shines as one star (their light
// summed); a far companion adds a small share spread as a star in the planet's orbital plane would, over its long
// orbit.
//
// The year is counted from the moment the mean longitude of the star is 280° (Earth's 1 January), so for the
// Earth-like preset the months fall where Earth's calendar puts them.
import { rad } from '../model/units.ts';
import type { PlanetDefinition } from '../model/definition.ts';
import type { Derived } from '../model/physics.ts';
import type { Mesh } from '../mesh/icosphere.ts';

export interface OrbitPoint {
  /** Solar longitude (radians) and distance as a share of the semi-major axis. */
  lambda: number;
  r: number;
}

/** Where the planet is at a fraction of its year (from the mean longitude 280°). */
export function orbitAt(yearFraction: number, eccentricity: number, perihelionDeg: number): OrbitPoint {
  const e = eccentricity, w = rad(perihelionDeg);
  const M = 2 * Math.PI * yearFraction + rad(280) - w;
  // Kepler's equation M = E − e sin E, by Newton's method.
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return { lambda: (((nu + w) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), r: 1 - e * Math.cos(E) };
}

/** The daily mean light (W/m²) at a latitude (radians) for a solar longitude, distance (share of a) and tilt (radians). */
export function dailyInsolation(S: number, lat: number, lambda: number, r: number, tilt: number): number {
  const sinDec = Math.sin(tilt) * Math.sin(lambda), dec = Math.asin(sinDec), cosDec = Math.cos(dec);
  const sl = Math.sin(lat), cl = Math.cos(lat);
  let h0: number;
  const x = cl > 1e-12 && cosDec > 1e-12 ? (-sl * sinDec) / (cl * cosDec) : sl * sinDec > 0 ? -2 : 2;
  if (x <= -1) h0 = Math.PI;        // polar day
  else if (x >= 1) h0 = 0;          // polar night
  else h0 = Math.acos(x);
  return (S / Math.PI) / (r * r) * (h0 * sl * sinDec + cl * cosDec * Math.sin(h0));
}

/** Everything about a planet's sunlight the climate needs, from its definition and what follows from it. */
export interface Sunlight {
  /** Light at the semi-major axis from the planet's own star(s), and from a far companion, W/m². */
  S: number;
  companion: number;
  tilt: number;
  eccentricity: number;
  perihelionDeg: number;
  locked: boolean;
}

export function sunlightOf(d: PlanetDefinition, x: Derived): Sunlight {
  return {
    S: x.fluxSemiMajor, companion: x.companionFlux, tilt: rad(d.body.tiltDeg), eccentricity: d.orbit.eccentricity,
    perihelionDeg: d.orbit.perihelionDeg, locked: x.tidallyLocked,
  };
}

/** A far companion's light, averaged over its long orbit, at a latitude: a star circling in the orbital plane. */
function companionShare(s: Sunlight, lat: number): number {
  if (!(s.companion > 0)) return 0;
  let q = 0;
  const K = 24;
  for (let k = 0; k < K; k++) q += dailyInsolation(s.companion, lat, (2 * Math.PI * (k + 0.5)) / K, 1, s.tilt);
  return q / K;
}

/**
 * Mean light over a span of the year (fractions t0 to t1) at each of the given latitudes (radians), by equal steps
 * in time. For a tidally locked planet the latitude alone does not decide: use lockedInsolation.
 */
export function meanInsolation(s: Sunlight, lats: ArrayLike<number>, t0 = 0, t1 = 1, steps = 96): Float64Array {
  const out = new Float64Array(lats.length);
  const pts: OrbitPoint[] = [];
  for (let k = 0; k < steps; k++) pts.push(orbitAt(t0 + ((t1 - t0) * (k + 0.5)) / steps, s.eccentricity, s.perihelionDeg));
  for (let i = 0; i < lats.length; i++) {
    let q = 0;
    for (const p of pts) q += dailyInsolation(s.S, lats[i], p.lambda, p.r, s.tilt);
    out[i] = q / steps + companionShare(s, lats[i]);
  }
  return out;
}

/** The mean light at the angle θ from the point under a tidally locked planet's star, over a span of the year. */
export function lockedInsolation(s: Sunlight, cosTheta: number, t0 = 0, t1 = 1, steps = 48): number {
  let q = 0;
  for (let k = 0; k < steps; k++) {
    const p = orbitAt(t0 + ((t1 - t0) * (k + 0.5)) / steps, s.eccentricity, s.perihelionDeg);
    q += (s.S / (p.r * p.r)) * Math.max(0, cosTheta);
  }
  return q / steps + s.companion / 4;
}

/**
 * The light on every cell of a mesh, as the annual mean and the means of `months` equal parts of the year (month m
 * at out.monthly[m·n + cell]), W/m².
 */
export function insolationField(mesh: Mesh, s: Sunlight, months = 12): { annual: Float32Array; monthly: Float32Array } {
  return insolationCells(mesh, s, 0, mesh.n, months);
}

/** The same for the cells a to b - 1 only (month m of cell a + i at out.monthly[m·(b − a) + i]). */
export function insolationCells(mesh: Mesh, s: Sunlight, a: number, b: number, months = 12): { annual: Float32Array; monthly: Float32Array } {
  const n = b - a, annual = new Float32Array(n), monthly = new Float32Array(months * n);
  if (s.locked) {
    // The star stands over longitude 0 on the equator: cos θ = x. Only the distance changes through the year.
    for (let m = 0; m < months; m++) {
      const flux = lockedInsolation(s, 1, m / months, (m + 1) / months, 32) - s.companion / 4;
      for (let i = 0; i < n; i++) {
        const q = flux * Math.max(0, mesh.xyz[3 * (a + i)]) + s.companion / 4;
        monthly[m * n + i] = q;
        annual[i] += q / months;
      }
    }
    return { annual, monthly };
  }
  // Light depends only on latitude: work it out on a fine table of latitudes and interpolate.
  const rows = 721, lats = new Float64Array(rows);
  for (let k = 0; k < rows; k++) lats[k] = -Math.PI / 2 + (k * Math.PI) / (rows - 1);
  const tables: Float64Array[] = [];
  for (let m = 0; m < months; m++) tables.push(meanInsolation(s, lats, m / months, (m + 1) / months, 16));
  for (let i = 0; i < n; i++) {
    const f = ((mesh.lat[a + i] + Math.PI / 2) / Math.PI) * (rows - 1);
    const k0 = Math.min(rows - 2, Math.floor(f)), t = f - k0;
    let sum = 0;
    for (let m = 0; m < months; m++) {
      const q = tables[m][k0] * (1 - t) + tables[m][k0 + 1] * t;
      monthly[m * n + i] = q;
      sum += q;
    }
    annual[i] = sum / months;
  }
  return { annual, monthly };
}
