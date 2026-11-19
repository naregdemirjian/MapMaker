// What follows from a planet's definition (Stage 14, D152): the quantities the user does not set but the physics
// gives, each with its relation, so the studio can show them and explain them, and every subsystem can use them.
// Labels per the plan (section 6.8): orbits, insolation, gravity, scale height and lapse rates are physically
// based; the stellar relations and the greenhouse estimate are empirical or simplified and calibrated (Earth's
// mean surface temperature from Earth's air), and say so.
import {
  G, SIGMA, R_GAS, EARTH_MASS, EARTH_RADIUS, EARTH_GRAVITY, SUN_MASS, SUN_LUMINOSITY, SUN_TEFF, AU,
  SOLAR_CONSTANT, DAY, YEAR, GASES, clamp, deg,
} from './units.ts';
import type { PlanetDefinition, StarSpec } from './definition.ts';

// ---------------------------------------------------------------- stars (empirical main-sequence relations)

export interface StarProperties {
  massSun: number;
  /** Luminosity now (Suns), and the relation that gave it. */
  luminositySun: number;
  teffK: number;
  radiusSun: number;
  /** Main-sequence lifetime, billion years (about 10 for the Sun). */
  lifetimeGyr: number;
  /** "G2", "M3"…: the spectral class its temperature corresponds to. */
  spectralClass: string;
  /** Its colour, sRGB 0-255 (from the temperature). */
  color: [number, number, number];
}

/** Luminosity of a main-sequence star from its mass (Suns), piecewise power laws (Duric 2004). */
export function mainSequenceLuminosity(massSun: number): number {
  const m = massSun;
  if (m < 0.43) return 0.23 * m ** 2.3;
  if (m < 2) return m ** 4;
  if (m < 55) return 1.4 * m ** 3.5;
  return 32_000 * m;
}

/** Radius of a main-sequence star from its mass (Suns): about M^0.8 below a Sun, M^0.57 above. */
export function mainSequenceRadius(massSun: number): number {
  return massSun < 1 ? massSun ** 0.8 : massSun ** 0.57;
}

const CLASSES: Array<[number, string]> = [[30_000, 'O'], [10_000, 'B'], [7500, 'A'], [6000, 'F'], [5200, 'G'], [3700, 'K'], [2400, 'M'], [0, 'L']];
/** The spectral class (with its tenth) of a star's temperature. */
export function spectralClassOf(teffK: number): string {
  for (let i = 0; i < CLASSES.length; i++) {
    const [lo, cls] = CLASSES[i];
    if (teffK >= lo) {
      const hi = i === 0 ? 50_000 : CLASSES[i - 1][0];
      const sub = Math.max(0, Math.min(9, Math.floor(10 * (1 - (teffK - lo) / (hi - lo)))));
      return `${cls}${sub}`;
    }
  }
  return 'L';
}

/** The colour of a black body at a temperature (Tanner Helland's fit to the CIE colour matching), sRGB 0-255. */
export function blackbodyColor(teffK: number): [number, number, number] {
  const t = clamp(teffK, 1000, 40_000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.round(clamp(v, 0, 255));
  return [c(r), c(g), c(b)];
}

/**
 * How a main-sequence star brightens as it ages (Gough 1981: L(t) = L☉ / (1 + 0.4 (1 − t/t☉)) for the Sun),
 * generalised by the star's lifetime: a star at the same fraction of its life as the Sun now (0.454 of it)
 * has the luminosity the mass relation gives. Returns the luminosity at an age as a multiple of that.
 */
export function brighteningFactor(ageGyr: number, lifetimeGyr: number): number {
  const now = 0.454 * lifetimeGyr;
  const at = (t: number) => 1 / (1 + 0.4 * (1 - Math.min(t, lifetimeGyr) / now));
  // The mass relations describe stars as seen around us: no older than the Sun's stage, nor than 4.54 billion years.
  return at(Math.max(0, ageGyr)) / at(Math.min(now, 4.54));
}

/** A star's properties at an age (billion years; overrides respected: a brightness set by hand is its brightness at that age). */
export function starProperties(s: StarSpec, ageGyr = 4.54): StarProperties {
  const reference = mainSequenceLuminosity(s.massSun);
  const radiusSun = mainSequenceRadius(s.massSun);
  const lifetimeGyr = Math.min(1000, (10 * s.massSun) / Math.max(1e-6, reference));
  const luminositySun = s.luminositySun ?? reference * brighteningFactor(ageGyr, lifetimeGyr);
  // Stefan-Boltzmann: L = 4πR²σT⁴, so T = T☉ (L / R²)^¼ in solar units (from the reference: the temperature changes little with age).
  const teffK = s.teffK ?? SUN_TEFF * ((s.luminositySun ?? reference) / (radiusSun * radiusSun)) ** 0.25;
  return { massSun: s.massSun, luminositySun, teffK, radiusSun, lifetimeGyr, spectralClass: spectralClassOf(teffK), color: blackbodyColor(teffK) };
}

/** The star's luminosity `gyrAgo` before the present, as a multiple of the present's (the faint young star). */
export function luminosityFactorAt(gyrAgo: number, ageGyr: number, lifetimeGyr: number): number {
  return brighteningFactor(ageGyr - gyrAgo, lifetimeGyr) / brighteningFactor(ageGyr, lifetimeGyr);
}

// ---------------------------------------------------------------- planets

/**
 * A rocky planet's mass from its radius and core share. Large planets are squeezed by their own weight (Zeng,
 * Sasselov and Jacobsen 2016: R/R⊕ = (1.07 − 0.21·CMF)(M/M⊕)^(1/3.7), fitted from 1 to 8 Earth masses); small ones
 * hardly are, so their density is never below that of their uncompressed rock and iron (about 3.3 and 7.9 t/m³,
 * mixed by volume): this gives Mars and the Moon within a few per cent.
 */
export function rockyMassEarths(radiusKm: number, coreFraction: number): number {
  const r = (radiusKm * 1000) / EARTH_RADIUS;
  const squeezed = (r / (1.07 - 0.21 * coreFraction)) ** 3.7;
  const density = 1 / ((1 - coreFraction) / 3300 + coreFraction / 7900);
  const loose = (density * (4 / 3) * Math.PI * (radiusKm * 1000) ** 3) / EARTH_MASS;
  return Math.max(squeezed, loose);
}

/** Kepler's third law: the orbital period (days) at a semi-major axis (AU) around a total mass (kg). */
export function orbitalPeriodDays(semiMajorAu: number, totalMassKg: number): number {
  const a = semiMajorAu * AU;
  return (2 * Math.PI * Math.sqrt((a * a * a) / (G * totalMassKg))) / DAY;
}

/** The length of a day from sunrise to sunrise (hours), from the turn against the stars and the year (backwards turning over 90° of tilt). */
export function solarDayHours(siderealHours: number, yearDays: number, tiltDeg: number): number {
  const rot = 1 / (siderealHours / 24), orb = 1 / yearDays; // turns per day
  const solar = tiltDeg > 90 ? rot + orb : rot - orb;
  return Math.abs(solar) < 1e-12 ? Infinity : 24 / Math.abs(solar);
}

/**
 * How long tides take to lock a planet's spin to its orbit (years; Gladman et al. 1996): t ≈ ω a⁶ I Q / (3 G m*² k₂ R⁵),
 * I = 0.4 M R², from a spin of `initialDayHours`, with Q = 100 and k₂ = 0.3 (rocky planets). An order of magnitude.
 */
export function tidalLockYears(semiMajorAu: number, starMassKg: number, planetMassKg: number, radiusM: number, initialDayHours = 12): number {
  const a = semiMajorAu * AU, w = (2 * Math.PI) / (initialDayHours * 3600);
  const I = 0.4 * planetMassKg * radiusM * radiusM, Q = 100, k2 = 0.3;
  return (w * a ** 6 * I * Q) / (3 * G * starMassKg * starMassKg * k2 * radiusM ** 5) / YEAR;
}

/**
 * The most sunlight a planet with oceans can absorb and still keep them (W/m², averaged over the sphere): beyond it
 * the water vapour's greenhouse runs away (the Simpson-Nakajima limit, about 282 W/m²; Goldblatt et al. 2013). A
 * nearly dry planet holds out longer (Abe et al. 2011: about 415 W/m² for a land planet); between, interpolated.
 */
export function runawayLimit(oceanFraction: number): number {
  return oceanFraction >= 0.3 ? 282 : 282 + (415 - 282) * (1 - oceanFraction / 0.3);
}

/**
 * The habitable zone around a star (Kopparapu et al. 2013, corrected coefficients): where a planet with Earth's
 * air could keep liquid water. Inner edge: the runaway greenhouse (closer in for a dry planet, as runawayLimit);
 * outer: the maximum greenhouse. AU.
 */
export function habitableZoneAu(luminositySun: number, teffK: number, oceanFraction = 0.71): { inner: number; outer: number } {
  const T = clamp(teffK, 2600, 7200) - 5780;
  const seff = (c: [number, number, number, number, number]) => c[0] + c[1] * T + c[2] * T * T + c[3] * T ** 3 + c[4] * T ** 4;
  const runaway = seff([1.0385, 1.2456e-4, 1.4612e-8, -7.6345e-12, -1.7511e-15]) * (runawayLimit(oceanFraction) / 282);
  const maxGreenhouse = seff([0.3507, 5.9578e-5, 1.6707e-9, -3.0058e-12, -5.1925e-16]);
  return { inner: Math.sqrt(luminositySun / runaway), outer: Math.sqrt(luminositySun / maxGreenhouse) };
}

// ---------------------------------------------------------------- air

export interface AirProperties {
  /** Mean molar mass (kg/mol) and specific heat at constant pressure (J/kg/K). */
  molar: number;
  cp: number;
  /** Mass of air over each square metre (kg/m²) and its heat capacity (J/m²/K). */
  columnMass: number;
  columnHeat: number;
  /** Scale height (km) at the surface temperature. */
  scaleHeightKm: number;
  /** Dry adiabatic lapse rate g/c_p and the typical lapse rate (moist where there is water), K/km. */
  dryLapse: number;
  lapse: number;
}

export function airProperties(d: PlanetDefinition, gravity: number, surfaceK: number): AirProperties {
  const a = d.atmosphere;
  const n2 = Math.max(0, 1 - a.co2 - a.ch4 - a.o2 - a.ar);
  const parts: Array<[number, { molar: number; cp: number }]> = [[n2, GASES.n2], [a.o2, GASES.o2], [a.co2, GASES.co2], [a.ch4, GASES.ch4], [a.ar, GASES.ar]];
  const molar = parts.reduce((s, [x, g]) => s + x * g.molar, 0) || GASES.n2.molar;
  // Specific heat by mass fraction.
  const cp = parts.reduce((s, [x, g]) => s + ((x * g.molar) / molar) * g.cp, 0) || GASES.n2.cp;
  const columnMass = (a.pressureBar * 1e5) / gravity;
  const dryLapse = (gravity / cp) * 1000;
  // Where there is water, condensation releases heat as air rises: on Earth about 6.5 K/km against 9.8 dry.
  const wet = d.water.oceanFraction > 0 && a.pressureBar > 0.006;
  return {
    molar, cp, columnMass, columnHeat: columnMass * cp,
    scaleHeightKm: a.pressureBar > 0 ? (R_GAS * surfaceK) / (molar * gravity) / 1000 : 0,
    dryLapse, lapse: wet ? dryLapse * (6.5 / 9.77) : dryLapse * 0.85,
  };
}

/**
 * Grey optical depth of the air in the thermal infrared (simplified, calibrated): carbon dioxide's grows with its
 * partial pressure and with pressure broadening (fitted through Earth, Mars and Venus: τ = 4.26 p_CO2^0.391
 * P^0.382, bar); methane's with the square root of its amount; water vapour's with temperature at about a third of
 * the Clausius-Clapeyron rate (its effect grows roughly with the logarithm of the vapour), where there is water.
 */
export function opticalDepth(d: PlanetDefinition, surfaceK: number): { co2: number; ch4: number; h2o: number; total: number } {
  const a = d.atmosphere, P = a.pressureBar;
  const co2 = P > 0 && a.co2 > 0 ? 4.26 * (a.co2 * P) ** 0.391 * P ** 0.382 : 0;
  const ch4 = P > 0 && a.ch4 > 0 ? 0.04 * Math.sqrt((a.ch4 * P) / 1.9e-6) : 0;
  const water = d.water.oceanFraction > 0 && P > 0.006 ? Math.min(1, Math.sqrt(d.water.oceanFraction / 0.71)) * Math.min(1, P ** 0.5) : 0;
  const h2o = water > 0 ? 0.62 * water * Math.exp(Math.min(8, 0.0237 * (surfaceK - 288))) : 0;
  return { co2, ch4, h2o, total: co2 + ch4 + h2o };
}

// ---------------------------------------------------------------- everything derived

export interface Derived {
  stars: StarProperties[];
  /** Total luminosity reaching the planet's neighbourhood (Suns) and the light at its mean distance. */
  luminositySun: number;
  insolation: number;            // W/m², averaged over the orbit (a⁻²(1−e²)^-½), the companion's included
  /** The light of the planet's own star(s) at the orbit's semi-major axis, and of a far companion, W/m². */
  fluxSemiMajor: number;
  companionFlux: number;
  insolationEarth: number;       // × Earth's
  perihelionInsolation: number;  // W/m²
  aphelionInsolation: number;    // W/m²
  habitableZone: { inner: number; outer: number };
  /** Inside, inside the inner edge, outside the outer edge. */
  zone: 'inside' | 'too-close' | 'too-far';
  massEarths: number;
  massKg: number;
  radiusM: number;
  gravity: number;               // m/s²
  gravityEarth: number;
  densityKgM3: number;
  escapeKmS: number;
  yearDays: number;
  /** Kepler's year (days), whether or not the year was set by hand. */
  keplerYearDays: number;
  solarDayHours: number;
  /** Spin against the stars, rad/s (the orbital rate when tidally locked). */
  omega: number;
  tidallyLocked: boolean;
  lockYears: number;
  /** Planetary albedo (estimate) and temperatures, K. */
  albedo: number;
  equilibriumK: number;
  surfaceK: number;
  tau: { co2: number; ch4: number; h2o: number; total: number };
  greenhouseK: number;
  /** Sunlight absorbed, W/m² averaged over the sphere. */
  absorbed: number;
  /** Too much sunlight absorbed for oceans to stay (runawayLimit). */
  runaway: boolean;
  air: AirProperties;
  /** Held and Hou's width of the Hadley cells (degrees from the equator) and cells per hemisphere. */
  hadleyEdgeDeg: number;
  cellsPerHemisphere: number;
  /** Surface heat flow from the interior now, as a multiple of Earth's, and the regime that follows. */
  heatFlowEarth: number;
  regime: 'mobile-lid' | 'stagnant-lid' | 'episodic';
  regimeReason: string;
  /** Things worth saying about this planet, in words. */
  notes: string[];
}

/** Earth's present heat production split by isotope (shares of the radiogenic heat), half-lives in Gyr (Turcotte and Schubert 2014). */
const ISOTOPES: Array<[number, number]> = [[0.394, 4.468], [0.017, 0.704], [0.443, 14.05], [0.146, 1.248]];

/** Radiogenic heating `gyrAgo` before now, as a multiple of now's. */
export function radiogenicFactorAt(gyrAgo: number): number {
  return ISOTOPES.reduce((s, [share, half]) => s + share * Math.pow(2, gyrAgo / half), 0);
}

/** Everything derived from a definition. */
export function derive(d: PlanetDefinition): Derived {
  const age = d.history.ageGyr;
  const stars = d.star.stars.map((s) => starProperties(s, age));
  const pair = d.star.arrangement === 'circumbinary';
  const starMassKg = (pair ? stars[0].massSun + stars[1].massSun : stars[0].massSun) * SUN_MASS;
  // The light that reaches the planet: the star it orbits (both, for a circumbinary orbit; a companion adds its own from afar).
  const own = pair ? stars[0].luminositySun + stars[1].luminositySun : stars[0].luminositySun;
  const ownTeff = pair ? (stars[0].luminositySun * stars[0].teffK + stars[1].luminositySun * stars[1].teffK) / own : stars[0].teffK;
  const a = d.orbit.semiMajorAu, e = d.orbit.eccentricity;
  const flux = (au: number) => (own * SUN_LUMINOSITY) / (4 * Math.PI * (au * AU) ** 2);
  const companion = d.star.arrangement === 'companion' && stars[1] ? (stars[1].luminositySun * SUN_LUMINOSITY) / (4 * Math.PI * ((d.star.companionAu ?? 100) * AU) ** 2) : 0;
  // Averaged over the orbit, the light goes as a⁻² (1 − e²)^-½.
  const insolation = flux(a) / Math.sqrt(1 - e * e) + companion;
  const ocean = d.water.oceanFraction;
  const hz = habitableZoneAu(own, ownTeff, ocean);
  const massEarths = d.body.massEarths ?? rockyMassEarths(d.body.radiusKm, d.interior.coreFraction);
  const massKg = massEarths * EARTH_MASS, radiusM = d.body.radiusKm * 1000;
  const gravity = (G * massKg) / (radiusM * radiusM);
  const keplerYearDays = orbitalPeriodDays(a, starMassKg + massKg);
  const yearDays = d.orbit.yearDays ?? keplerYearDays;
  const lockYears = tidalLockYears(a, starMassKg, massKg, radiusM);
  const tidallyLocked = d.body.tidallyLocked === 'auto' ? lockYears < age * 1e9 : d.body.tidallyLocked;
  const omega = tidallyLocked ? (2 * Math.PI) / (yearDays * DAY) : (2 * Math.PI) / (d.body.dayHours * 3600);
  // Albedo: clouds over a clear sky, which scatters blue light back (Rayleigh: more air, more scattering, saturating)
  // over a surface of sea (dark), land (brighter) and, when cold, ice (bright; little of it without water). Calibrated
  // to Earth's 0.30 with half the sky clouded.
  const at = d.atmosphere;
  const rayleigh = 0.5 * (1 - Math.exp((-0.125 * (at.pressureBar * 1e5) / gravity) / 10_330));
  const albedoAt = (T: number) => {
    const ice = clamp((263 - T) / 30, 0, 1) * (ocean > 0 ? Math.min(1, 0.3 + ocean) : 0.05);
    const ground = ocean * 0.06 + (1 - ocean) * 0.25;
    const surface = ground * (1 - ice) + 0.6 * ice;
    const clear = rayleigh + (1 - rayleigh) ** 2 * surface;
    const cover = at.pressureBar > 0 ? at.clouds : 0;
    return cover * at.cloudAlbedo + (1 - cover) * clear;
  };
  // Equilibrium temperature: the light absorbed spread over the whole sphere (or the day side only, where locked and airless).
  const spread = tidallyLocked && at.pressureBar < 0.1 ? 2 : 4;
  const teq = (A: number) => ((insolation * (1 - A)) / (spread * SIGMA)) ** 0.25;
  // Surface temperature: a grey atmosphere (T_s = T_e (1 + ¾τ)^¼) with the water vapour and ice feedbacks, iterated
  // to a balance (damped, so the ice-albedo feedback settles rather than oscillates).
  let T = teq(albedoAt(288));
  for (let i = 0; i < 400; i++) {
    const next = teq(albedoAt(T)) * (1 + 0.75 * opticalDepth(d, T).total) ** 0.25;
    if (Math.abs(next - T) < 1e-5) { T = next; break; }
    T = 0.5 * (T + next);
  }
  const albedo = albedoAt(T), equilibriumK = teq(albedo);
  const absorbed = (insolation * (1 - albedo)) / 4;
  const runaway = ocean > 0 && at.pressureBar > 0.006 && absorbed > runawayLimit(ocean);
  const tau = opticalDepth(d, T);
  const air = airProperties(d, gravity, T);
  // Held and Hou (1980): φ_H = (5/3 · g H Δ_H / (Ω² a²))^½ with H the depth of the troposphere (about 15 km on
  // Earth, scaled with the scale height) and Δ_H the fractional equator-to-pole contrast (1/3).
  const Ht = 15_000 * (air.scaleHeightKm > 0 ? air.scaleHeightKm / 8.5 : 0);
  const phi = Ht > 0 && omega > 0 ? Math.sqrt(((5 / 3) * gravity * Ht * (1 / 3)) / (omega * omega * radiusM * radiusM)) : Math.PI / 2;
  const hadleyEdgeDeg = Math.min(90, deg(phi));
  const cellsPerHemisphere = hadleyEdgeDeg >= 60 ? 1 : Math.max(1, Math.round(90 / hadleyEdgeDeg));
  // Interior heat flow: production per mass × mass over area (∝ g); a younger planet's isotopes have decayed less
  // (a planet of age t has the heat production Earth had at age t).
  const ageScale = radiogenicFactorAt(Math.max(0, 4.54 - age)) / radiogenicFactorAt(Math.max(0, 4.54 - 4.54));
  const heatFlowEarth = d.interior.heatProduction * (gravity / EARTH_GRAVITY) * ageScale;
  let regime: Derived['regime'], regimeReason: string;
  if (d.interior.regime !== 'auto') { regime = d.interior.regime; regimeReason = 'Chosen by hand.'; }
  else if (ocean <= 0) { regime = 'stagnant-lid'; regimeReason = 'Without water the lithosphere stays strong and does not break into plates (as on Mars and Venus).'; }
  else if (heatFlowEarth < 0.25) { regime = 'stagnant-lid'; regimeReason = 'Too little heat from the interior to keep plates moving.'; }
  else if (heatFlowEarth > 6) { regime = 'episodic'; regimeReason = 'So much heat that the lid breaks and sinks in bursts rather than moving steadily.'; }
  else { regime = 'mobile-lid'; regimeReason = 'Water weakens the lithosphere and the interior\'s heat keeps plates moving, as on Earth.'; }
  // What the user should know.
  const notes: string[] = [];
  stars.forEach((s, i) => {
    if (age > s.lifetimeGyr) notes.push(`${stars.length > 1 ? (i ? 'The second star' : 'The first star') : 'The star'} lives about ${s.lifetimeGyr < 1 ? `${Math.round(s.lifetimeGyr * 1000)} million` : `${s.lifetimeGyr.toFixed(1)} billion`} years before swelling into a giant; the planet is older. Its light is taken as at the end of that life.`);
  });
  if (runaway) notes.push('So much sunlight would boil the oceans away (a runaway greenhouse, as Venus probably had); the temperatures shown assume the water somehow stays.');
  if (d.orbit.yearDays !== undefined && Math.abs(d.orbit.yearDays - keplerYearDays) > 0.01 * keplerYearDays) notes.push(`The year is set by hand: ${Math.round(d.orbit.yearDays)} days; this orbit would give ${Math.round(keplerYearDays)}.`);
  if (d.body.tidallyLocked === 'auto' && tidallyLocked) notes.push(`The star's tides would have stopped the planet's turning within ${lockYears < 1e9 ? `${Math.max(1, Math.round(lockYears / 1e6))} million` : `${(lockYears / 1e9).toFixed(1)} billion`} years: one side always faces it.`);
  return {
    stars, luminositySun: own, insolation, insolationEarth: insolation / SOLAR_CONSTANT, fluxSemiMajor: flux(a), companionFlux: companion,
    perihelionInsolation: flux(a * (1 - e)) + companion, aphelionInsolation: flux(a * (1 + e)) + companion,
    habitableZone: hz, zone: a < hz.inner ? 'too-close' : a > hz.outer ? 'too-far' : 'inside',
    massEarths, massKg, radiusM, gravity, gravityEarth: gravity / EARTH_GRAVITY,
    densityKgM3: massKg / ((4 / 3) * Math.PI * radiusM ** 3), escapeKmS: Math.sqrt((2 * G * massKg) / radiusM) / 1000,
    yearDays, keplerYearDays, solarDayHours: tidallyLocked ? Infinity : solarDayHours(d.body.dayHours, yearDays, d.body.tiltDeg),
    omega, tidallyLocked, lockYears, albedo, equilibriumK, surfaceK: T, tau, greenhouseK: T - equilibriumK, absorbed, runaway, air,
    hadleyEdgeDeg, cellsPerHemisphere, heatFlowEarth, regime, regimeReason, notes,
  };
}

