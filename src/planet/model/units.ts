// Physical constants and reference values for the planetary engine (Stage 14, D152). SI units throughout
// unless a name says otherwise. Earth and Sun values are references for scaling and for presets, never
// assumptions: every calculation takes the planet's own values.

/** Gravitational constant, m³ kg⁻¹ s⁻². */
export const G = 6.674_30e-11;
/** Stefan-Boltzmann constant, W m⁻² K⁻⁴. */
export const SIGMA = 5.670_374_419e-8;
/** Universal gas constant, J mol⁻¹ K⁻¹. */
export const R_GAS = 8.314_462_618;

export const EARTH_MASS = 5.9722e24; // kg
export const EARTH_RADIUS = 6.371_0e6; // m (mean)
export const EARTH_GRAVITY = 9.806_65; // m s⁻²
export const SUN_MASS = 1.988_47e30; // kg
export const SUN_LUMINOSITY = 3.828e26; // W (IAU nominal)
export const SUN_RADIUS = 6.957e8; // m
export const SUN_TEFF = 5772; // K
export const AU = 1.495_978_707e11; // m
/** The total solar irradiance at 1 AU, W m⁻². */
export const SOLAR_CONSTANT = SUN_LUMINOSITY / (4 * Math.PI * AU * AU);
export const DAY = 86_400; // s
export const YEAR = 365.25 * DAY; // s (Julian year)
export const MYR = 1e6 * YEAR; // s
export const GYR = 1e9 * YEAR; // s

/** Molar masses, kg mol⁻¹, and isobaric specific heats, J kg⁻¹ K⁻¹, of the gases a planet's air can hold. */
export const GASES = {
  n2: { molar: 0.028_013, cp: 1040 },
  o2: { molar: 0.031_999, cp: 918 },
  co2: { molar: 0.044_009, cp: 844 },
  h2o: { molar: 0.018_015, cp: 1996 },
  ch4: { molar: 0.016_043, cp: 2226 },
  ar: { molar: 0.039_948, cp: 520 },
  h2: { molar: 0.002_016, cp: 14_300 },
} as const;
export type Gas = keyof typeof GASES;

/** Latent heat of vaporisation of water over the gas constant for water vapour (K), for Clausius-Clapeyron. */
export const L_OVER_RV = 5420;

export const deg = (radians: number) => (radians * 180) / Math.PI;
export const rad = (degrees: number) => (degrees * Math.PI) / 180;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
