// What a simulated planet is made from (Stage 14, D152): the user's description of a star system, an orbit, a
// planet, its interior, plates, air, water, history and life, as stored with a map (`sim` in its settings).
// Values the physics can work out (the planet's mass from its size, the year from its orbit, whether it is
// tidally locked) are left out unless the user sets them, and then they are overrides (see physics.ts).
// Presets are scientifically coherent starting points, not looks: each is a whole description.

export type RegimeChoice = 'auto' | 'mobile-lid' | 'stagnant-lid' | 'episodic';
export type GeoEventKind =
  | 'supercontinent' | 'breakup' | 'collision' | 'rift' | 'volcanic-period' | 'lip' | 'hotspot'
  | 'impact' | 'ice-age' | 'greenhouse' | 'sea-level' | 'reorganisation';

export interface StarSpec {
  /** Mass, in Suns: the main-sequence relations give its brightness, temperature and size. */
  massSun: number;
  /** Set by hand instead of from the mass (overrides). */
  luminositySun?: number;
  teffK?: number;
}

export interface StarSystemSpec {
  /** One star, or two (circumbinary: the planet circles both; companion: a far star beside the planet's own). */
  arrangement: 'single' | 'circumbinary' | 'companion';
  stars: StarSpec[];
  /** For a companion: its distance from the planet, AU. */
  companionAu?: number;
}

export interface OrbitSpec {
  /** The orbit's semi-major axis, AU. */
  semiMajorAu: number;
  eccentricity: number;
  /** Where in the year the planet is closest to its star: the season angle (solar longitude: 0 northern spring equinox, 90 northern
   * summer solstice) at perihelion, degrees. Earth: about 283 (early January); Mars: 251. */
  perihelionDeg: number;
  /** The year set by hand, days (overrides Kepler's law). */
  yearDays?: number;
}

export interface BodySpec {
  radiusKm: number;
  /** Set by hand, Earths (overrides the mass worked out from the size and core). */
  massEarths?: number;
  /** Axial tilt, degrees (over 90: turning backwards). */
  tiltDeg: number;
  /** One turn on its axis against the stars, hours. */
  dayHours: number;
  /** Always the same face to its star: yes, no, or as the tides would have it ('auto'). */
  tidallyLocked: boolean | 'auto';
}

export interface InteriorSpec {
  /** Heat made by radioactivity, per kilogram, as a multiple of Earth's. */
  heatProduction: number;
  /** The share of the mass in the iron core (Earth: about 0.33). */
  coreFraction: number;
  /** How stiff the mantle is, as a multiple of Earth's (advanced). */
  mantleViscosity: number;
  /** How strong the crust is, as a multiple of Earth's (advanced): stronger crust holds higher mountains. */
  crustStrength: number;
  regime: RegimeChoice;
}

export interface TectonicsSpec {
  /** About how many plates. */
  plates: number;
  /** How vigorous plate motion and mountain building are, as a multiple of what the interior's heat gives. */
  activity: number;
  /** The share of the surface the continents' crust covers at the present (shelves included). */
  continentalFraction: number;
  /** How many mantle plumes (hotspots) there are. */
  hotspots: number;
}

export interface AtmosphereSpec {
  /** Surface pressure, bar (0: none). */
  pressureBar: number;
  /** Mole fractions; nitrogen is the rest. */
  co2: number;
  ch4: number;
  o2: number;
  ar: number;
  /** How much of the sky clouds cover on average (0 to 1), and how bright they are. */
  clouds: number;
  cloudAlbedo: number;
}

export interface WaterSpec {
  /** The share of the present surface under the sea (0: a dry world). */
  oceanFraction: number;
}

export interface GeoEvent {
  id: string;
  kind: GeoEventKind;
  /** When it begins, million years before the present, and how long it lasts. */
  startMa: number;
  durationMyr: number;
  /** How strong (1: typical). */
  strength: number;
  /** Where, if it is somewhere (longitude, latitude in degrees). */
  at?: [number, number];
  note?: string;
  /**
   * Where the user clicked for it, and on the picture of which moment (Ma): the crust there, followed with its plate
   * back to the event's start, gives `at` (D164). Kept to say so; the history reads only `at`.
   */
  clicked?: { at: [number, number]; ma: number };
}

export interface HistorySpec {
  /** How old the planet is, billion years. */
  ageGyr: number;
  events: GeoEvent[];
  /**
   * The climate settings the history was simulated with (D161): its erosion and ice follow these, so changing the air
   * or the orbit afterwards recomputes today's climate, water and life at once and leaves the history as it was until
   * it is re-run with them. None: the history follows the settings as they are.
   */
  climate?: ClimateSnapshot;
}

/**
 * The settings that reach a history only through its climate (a history keeps them as it was simulated with, D161):
 * the star, the orbit, the air, the tilt and the day. (The sea's share, the planet's size and its interior shape the
 * history directly: changing them makes it out of date.)
 */
export interface ClimateSnapshot { star: StarSystemSpec; orbit: OrbitSpec; atmosphere: AtmosphereSpec; tiltDeg: number; dayHours: number }
export const climateSnapshot = (d: PlanetDefinition): ClimateSnapshot => structuredClone({ star: d.star, orbit: d.orbit, atmosphere: d.atmosphere, tiltDeg: d.body.tiltDeg, dayHours: d.body.dayHours });
/** A definition as its history sees it: with the climate settings the history keeps, if it keeps them. */
export function historyView(d: PlanetDefinition): PlanetDefinition {
  const s = d.history.climate;
  return s ? { ...d, star: s.star, orbit: s.orbit, atmosphere: s.atmosphere, body: { ...d.body, tiltDeg: s.tiltDeg, dayHours: s.dayHours } } : d;
}
/** Whether a history was simulated with other climate settings than the definition's now. */
export const historyClimateDiffers = (d: PlanetDefinition) => !!d.history.climate && JSON.stringify(d.history.climate) !== JSON.stringify(climateSnapshot(d));

/**
 * A definition with the land of `was` and everything else as `now` (D257): what a history is made from (the seed,
 * the planet's size and mass, its interior and plates, its water, its history with the climate it keeps, how it is
 * simulated) taken from `was`; the star, the orbit, the tilt and day, the air and the life from `now`. For showing
 * the land there is with the settings as they are, while the land they ask for is still being made.
 */
export function withLandOf(now: PlanetDefinition, was: PlanetDefinition): PlanetDefinition {
  const body = { ...now.body, radiusKm: was.body.radiusKm };
  if (was.body.massEarths === undefined) delete body.massEarths; else body.massEarths = was.body.massEarths;
  return { ...now, seed: was.seed, body, interior: was.interior, tectonics: was.tectonics, water: was.water, history: was.history, simulation: was.simulation };
}

/** A biome of the user's own (D152 defines it; 14.9 classifies with it). */
export interface CustomBiome {
  id: string;
  name: string;
  /** RGB colour seen from space. */
  color: [number, number, number];
  /** Conditions, each optional: annual mean temperature (°C), annual precipitation (mm), its seasonality (0 to 1), elevation (m). */
  tempC?: [number, number];
  precipMm?: [number, number];
  seasonality?: [number, number];
  elevationM?: [number, number];
  /** Earlier rules win where several match. */
  priority: number;
}

export interface LifeSpec {
  biomeSet: 'earth' | 'custom';
  /** The colour of plant life (after the star's light), or none. */
  vegetation: 'earth' | 'red-dwarf' | 'blue-star' | 'none';
  customBiomes: CustomBiome[];
}

export type PresetId =
  | 'earthlike' | 'supercontinent' | 'young-volcanic' | 'high-tectonic' | 'inactive'
  | 'frozen' | 'desert' | 'ocean' | 'tidally-locked' | 'super-earth' | 'hothouse';

export interface PlanetDefinition {
  version: 1;
  name: string;
  seed: number;
  preset: PresetId | 'custom';
  star: StarSystemSpec;
  orbit: OrbitSpec;
  body: BodySpec;
  interior: InteriorSpec;
  tectonics: TectonicsSpec;
  atmosphere: AtmosphereSpec;
  water: WaterSpec;
  history: HistorySpec;
  life: LifeSpec;
  /** How finely and how much of its history is simulated: the last `spanMyr` million years (default 500). */
  simulation: { quality: 'preview' | 'standard' | 'high'; spanMyr?: number };
}

/** The limits of every number (and whether it is whole). */
const LIMITS = {
  'star.massSun': [0.08, 20], 'star.luminositySun': [1e-5, 1e6], 'star.teffK': [2000, 50_000], 'star.companionAu': [1, 10_000],
  'orbit.semiMajorAu': [0.005, 200], 'orbit.eccentricity': [0, 0.9], 'orbit.perihelionDeg': [0, 360], 'orbit.yearDays': [0.1, 1e6],
  'body.radiusKm': [500, 20_000], 'body.massEarths': [0.001, 30], 'body.tiltDeg': [0, 180], 'body.dayHours': [1, 1e5],
  'interior.heatProduction': [0, 10], 'interior.coreFraction': [0, 0.8], 'interior.mantleViscosity': [0.01, 100], 'interior.crustStrength': [0.1, 10],
  'tectonics.plates': [2, 40], 'tectonics.activity': [0, 4], 'tectonics.continentalFraction': [0, 1], 'tectonics.hotspots': [0, 60],
  'atmosphere.pressureBar': [0, 300], 'atmosphere.co2': [0, 1], 'atmosphere.ch4': [0, 1], 'atmosphere.o2': [0, 1], 'atmosphere.ar': [0, 1],
  'atmosphere.clouds': [0, 1], 'atmosphere.cloudAlbedo': [0, 1],
  'water.oceanFraction': [0, 1], 'history.ageGyr': [0.05, 13], 'simulation.spanMyr': [50, 4500],
} as const;

const EARTH: Omit<PlanetDefinition, 'name' | 'seed' | 'preset'> = {
  version: 1,
  star: { arrangement: 'single', stars: [{ massSun: 1 }] },
  orbit: { semiMajorAu: 1, eccentricity: 0.0167, perihelionDeg: 283 },
  body: { radiusKm: 6371, tiltDeg: 23.44, dayHours: 23.934, tidallyLocked: false },
  interior: { heatProduction: 1, coreFraction: 0.325, mantleViscosity: 1, crustStrength: 1, regime: 'auto' },
  tectonics: { plates: 12, activity: 1, continentalFraction: 0.4, hotspots: 10 },
  atmosphere: { pressureBar: 1.013, co2: 4.2e-4, ch4: 1.9e-6, o2: 0.2095, ar: 0.0093, clouds: 0.5, cloudAlbedo: 0.45 },
  water: { oceanFraction: 0.71 },
  history: { ageGyr: 4.54, events: [] },
  life: { biomeSet: 'earth', vegetation: 'earth', customBiomes: [] },
  simulation: { quality: 'preview' },
};

type Patch = { [K in keyof typeof EARTH]?: Partial<(typeof EARTH)[K]> };
const preset = (name: string, about: string, patch: Patch) => ({ name, about, patch });

/**
 * Scientifically coherent starting points. Each changes what makes the difference and keeps the rest Earth's;
 * `about` says what to expect and why.
 */
export const PRESETS: Record<PresetId, { name: string; about: string; patch: Patch }> = {
  earthlike: preset('Earth-like', 'A Sun-like star, an Earth-sized planet in the middle of the habitable zone, oceans over two thirds, moving plates.', {}),
  supercontinent: preset('Ancient supercontinent', 'Earth-like, with the continents gathered into one: a vast dry interior, one world ocean, monsoons at its edges.', {
    history: { ageGyr: 4.54, events: [{ id: 'pangaea', kind: 'supercontinent', startMa: 120, durationMyr: 120, strength: 1 }] },
    tectonics: { activity: 0.9 },
  }),
  'young-volcanic': preset('Young volcanic world', 'Only a billion years old: a hot interior, fast plates, many hotspots, little continental crust yet, a thicker greenhouse.', {
    history: { ageGyr: 1, events: [] },
    interior: { heatProduction: 1.5 },
    tectonics: { plates: 16, activity: 1.6, continentalFraction: 0.12, hotspots: 24 },
    atmosphere: { pressureBar: 1.6, co2: 0.01 },
    water: { oceanFraction: 0.8 },
  }),
  'high-tectonic': preset('Highly tectonic', 'More internal heat: more plates, faster motion, more mountain building and volcanism.', {
    interior: { heatProduction: 1.8 },
    tectonics: { plates: 20, activity: 2, continentalFraction: 0.35, hotspots: 16 },
  }),
  inactive: preset('Geologically inactive', 'A small, cooled world with a single rigid lid (like Mars): no moving plates, old volcanoes and basins, thin cold air, no seas.', {
    orbit: { semiMajorAu: 1.524, eccentricity: 0.0934, perihelionDeg: 251 },
    body: { radiusKm: 3390, tiltDeg: 25.19, dayHours: 24.623 },
    interior: { heatProduction: 0.4, coreFraction: 0.25, regime: 'stagnant-lid' },
    tectonics: { plates: 2, activity: 0.1, continentalFraction: 0.5, hotspots: 4 },
    atmosphere: { pressureBar: 0.0063, co2: 0.95, ch4: 0, o2: 0.0013, ar: 0.019, clouds: 0.02, cloudAlbedo: 0.3 },
    water: { oceanFraction: 0 },
    life: { vegetation: 'none' },
  }),
  frozen: preset('Frozen world', 'Earth-like but farther from its star: ice spreads from the poles until it reflects most of the light.', {
    orbit: { semiMajorAu: 1.25 },
    water: { oceanFraction: 0.65 },
  }),
  desert: preset('Desert world', 'Little water and a warmer orbit: small seas, wide deserts, rain only near coasts and mountains. With so little water the oceans do not boil away this close in.', {
    orbit: { semiMajorAu: 0.9 },
    tectonics: { continentalFraction: 0.6 },
    atmosphere: { pressureBar: 0.8, co2: 3e-3, clouds: 0.25 },
    water: { oceanFraction: 0.1 },
  }),
  ocean: preset('Ocean world', 'Water over almost everything: island arcs and hotspot chains, a mild, even climate.', {
    tectonics: { continentalFraction: 0.04, hotspots: 18 },
    water: { oceanFraction: 0.97 },
  }),
  'tidally-locked': preset('Tidally locked (red dwarf)', 'A close orbit around a small red star: one side always lit, the other always dark; warm air flows to the night side; plants dark to use the red light.', {
    star: { arrangement: 'single', stars: [{ massSun: 0.3 }] },
    orbit: { semiMajorAu: 0.13, eccentricity: 0.01 },
    body: { radiusKm: 6700, tiltDeg: 0, dayHours: 24, tidallyLocked: true },
    atmosphere: { pressureBar: 1.3, co2: 2e-3 },
    water: { oceanFraction: 0.6 },
    life: { vegetation: 'red-dwarf' },
  }),
  'super-earth': preset('High-gravity super-Earth', 'Half again Earth\'s size and over four times its mass: nearly double gravity, lower mountains, deeper air, a hotter interior; a little farther from its star, as its thick air holds more heat.', {
    orbit: { semiMajorAu: 1.1 },
    body: { radiusKm: 9500 },
    interior: { heatProduction: 1 },
    tectonics: { plates: 16, activity: 1.2 },
    atmosphere: { pressureBar: 3 },
    water: { oceanFraction: 0.75 },
  }),
  hothouse: preset('Runaway hothouse', 'Like Venus: close to its star, its water lost, a crushing carbon dioxide air under bright clouds, a single lid resurfaced by volcanism.', {
    orbit: { semiMajorAu: 0.723, eccentricity: 0.0068 },
    body: { radiusKm: 6052, tiltDeg: 177.4, dayHours: 5832.5 },
    interior: { heatProduction: 0.9, regime: 'episodic' },
    tectonics: { plates: 2, activity: 0.2, continentalFraction: 0.1, hotspots: 12 },
    atmosphere: { pressureBar: 92, co2: 0.965, ch4: 0, o2: 0, ar: 7e-5, clouds: 1, cloudAlbedo: 0.77 },
    water: { oceanFraction: 0 },
    life: { vegetation: 'none' },
  }),
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A complete definition from a preset (a seed and a name given). */
export function definitionFromPreset(id: PresetId, seed = 1, name = PRESETS[id].name): PlanetDefinition {
  const base = clone(EARTH) as PlanetDefinition;
  const patch = PRESETS[id].patch as Record<string, Record<string, unknown>>;
  for (const [k, v] of Object.entries(patch)) Object.assign((base as unknown as Record<string, Record<string, unknown>>)[k], clone(v));
  return { ...base, name, seed, preset: id };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** What is wrong with a definition (empty if nothing), in words. */
export function definitionProblems(d: PlanetDefinition): string[] {
  const out: string[] = [];
  const check = (path: keyof typeof LIMITS, v: number | undefined, label: string) => {
    if (v === undefined) return;
    const [lo, hi] = LIMITS[path];
    if (!(v >= lo && v <= hi)) out.push(`${label} must be between ${lo} and ${hi}.`);
  };
  if (!d.star.stars.length || d.star.stars.length > 2) out.push('One star or two.');
  if (d.star.arrangement === 'single' && d.star.stars.length !== 1) out.push('A single star system has one star.');
  if (d.star.arrangement !== 'single' && d.star.stars.length !== 2) out.push('A system of two stars needs both.');
  d.star.stars.forEach((s) => { check('star.massSun', s.massSun, 'A star\'s mass (Suns)'); check('star.luminositySun', s.luminositySun, 'A star\'s brightness (Suns)'); check('star.teffK', s.teffK, 'A star\'s temperature (K)'); });
  if (d.star.arrangement === 'companion') check('star.companionAu', d.star.companionAu ?? 0, 'The companion\'s distance (AU)');
  check('orbit.semiMajorAu', d.orbit.semiMajorAu, 'The distance from the star (AU)');
  check('orbit.eccentricity', d.orbit.eccentricity, 'The orbit\'s eccentricity');
  check('orbit.perihelionDeg', d.orbit.perihelionDeg, 'The perihelion\'s longitude');
  check('orbit.yearDays', d.orbit.yearDays, 'The year (days)');
  check('body.radiusKm', d.body.radiusKm, 'The radius (km)');
  check('body.massEarths', d.body.massEarths, 'The mass (Earths)');
  check('body.tiltDeg', d.body.tiltDeg, 'The axial tilt (degrees)');
  check('body.dayHours', d.body.dayHours, 'The day (hours)');
  check('interior.heatProduction', d.interior.heatProduction, 'The heat production (× Earth)');
  check('interior.coreFraction', d.interior.coreFraction, 'The core\'s share of the mass');
  check('interior.mantleViscosity', d.interior.mantleViscosity, 'The mantle\'s stiffness');
  check('interior.crustStrength', d.interior.crustStrength, 'The crust\'s strength');
  check('tectonics.plates', d.tectonics.plates, 'The number of plates');
  if (!Number.isInteger(d.tectonics.plates)) out.push('The number of plates must be whole.');
  check('tectonics.activity', d.tectonics.activity, 'The tectonic activity');
  check('tectonics.continentalFraction', d.tectonics.continentalFraction, 'The continental share');
  check('tectonics.hotspots', d.tectonics.hotspots, 'The number of hotspots');
  if (!Number.isInteger(d.tectonics.hotspots)) out.push('The number of hotspots must be whole.');
  const a = d.atmosphere;
  check('atmosphere.pressureBar', a.pressureBar, 'The surface pressure (bar)');
  for (const [k, label] of [['co2', 'carbon dioxide'], ['ch4', 'methane'], ['o2', 'oxygen'], ['ar', 'argon']] as const) check(`atmosphere.${k}`, a[k], `The share of ${label}`);
  if (a.co2 + a.ch4 + a.o2 + a.ar > 1 + 1e-9) out.push('The gases other than nitrogen add up to more than the whole air.');
  check('atmosphere.clouds', a.clouds, 'The cloud cover');
  check('atmosphere.cloudAlbedo', a.cloudAlbedo, 'The clouds\' brightness');
  check('water.oceanFraction', d.water.oceanFraction, 'The ocean share');
  check('history.ageGyr', d.history.ageGyr, 'The age (billion years)');
  check('simulation.spanMyr', d.simulation.spanMyr, 'The span simulated (million years)');
  for (const e of d.history.events) {
    if (!(e.startMa >= 0 && e.startMa <= d.history.ageGyr * 1000)) out.push(`The event "${e.note ?? e.kind}" must begin within the planet's history.`);
    if (!(e.durationMyr >= 0)) out.push(`The event "${e.note ?? e.kind}" cannot last less than nothing.`);
    if (!(e.strength >= 0 && e.strength <= 10)) out.push(`The event "${e.note ?? e.kind}" must have a strength between 0 and 10.`);
  }
  return out;
}

/**
 * A definition as stored, checked and completed: anything missing or unreadable takes the value of its preset
 * (or Earth's). Null when there is nothing to read.
 */
export function definitionOf(raw: unknown): PlanetDefinition | null {
  if (!isObj(raw)) return null;
  const presetId = typeof raw.preset === 'string' && raw.preset in PRESETS ? (raw.preset as PresetId) : null;
  const base = definitionFromPreset(presetId ?? 'earthlike');
  const out = clone(base);
  out.preset = presetId ?? 'custom';
  out.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : base.name;
  out.seed = Math.abs(Math.round(num(raw.seed) ?? 1)) % 2_147_483_647 || 1;
  // Each group: numbers and choices from the stored value where readable.
  const merge = (group: keyof PlanetDefinition, keys: string[]) => {
    const src = raw[group];
    if (!isObj(src)) return;
    const dst = out[group] as unknown as Record<string, unknown>;
    for (const k of keys) {
      const v = src[k];
      if (typeof dst[k] === 'number' || (dst[k] === undefined && num(v) !== undefined)) { const n = num(v); if (n !== undefined) dst[k] = n; }
      else if (typeof dst[k] === 'string' && typeof v === 'string') dst[k] = v;
      else if (typeof dst[k] === 'boolean' && (typeof v === 'boolean' || v === 'auto')) dst[k] = v;
      else if (dst[k] === false && v === 'auto') dst[k] = v;
    }
  };
  merge('orbit', ['semiMajorAu', 'eccentricity', 'perihelionDeg', 'yearDays']);
  merge('body', ['radiusKm', 'massEarths', 'tiltDeg', 'dayHours', 'tidallyLocked']);
  merge('interior', ['heatProduction', 'coreFraction', 'mantleViscosity', 'crustStrength', 'regime']);
  merge('tectonics', ['plates', 'activity', 'continentalFraction', 'hotspots']);
  merge('atmosphere', ['pressureBar', 'co2', 'ch4', 'o2', 'ar', 'clouds', 'cloudAlbedo']);
  merge('water', ['oceanFraction']);
  if (isObj(raw.star)) {
    const s = raw.star;
    if (s.arrangement === 'single' || s.arrangement === 'circumbinary' || s.arrangement === 'companion') out.star.arrangement = s.arrangement;
    if (Array.isArray(s.stars) && s.stars.length) out.star.stars = s.stars.filter(isObj).slice(0, 2).map((x) => ({ massSun: num(x.massSun) ?? 1, ...(num(x.luminositySun) !== undefined ? { luminositySun: num(x.luminositySun) } : {}), ...(num(x.teffK) !== undefined ? { teffK: num(x.teffK) } : {}) }));
    if (num(s.companionAu) !== undefined) out.star.companionAu = num(s.companionAu);
  }
  if (isObj(raw.history)) {
    const h = raw.history;
    if (num(h.ageGyr) !== undefined) out.history.ageGyr = num(h.ageGyr)!;
    if (Array.isArray(h.events)) out.history.events = h.events.filter(isObj).map((e, i) => ({
      id: typeof e.id === 'string' ? e.id : `event-${i + 1}`,
      kind: (typeof e.kind === 'string' ? e.kind : 'volcanic-period') as GeoEventKind,
      startMa: num(e.startMa) ?? 0, durationMyr: num(e.durationMyr) ?? 0, strength: num(e.strength) ?? 1,
      ...(Array.isArray(e.at) && e.at.length === 2 && num(e.at[0]) !== undefined && num(e.at[1]) !== undefined ? { at: [num(e.at[0])!, num(e.at[1])!] as [number, number] } : {}),
      ...(typeof e.note === 'string' ? { note: e.note } : {}),
      ...(isObj(e.clicked) && Array.isArray(e.clicked.at) && e.clicked.at.length === 2 && num(e.clicked.at[0]) !== undefined && num(e.clicked.at[1]) !== undefined && num(e.clicked.ma) !== undefined
        ? { clicked: { at: [num(e.clicked.at[0])!, num(e.clicked.at[1])!] as [number, number], ma: num(e.clicked.ma)! } } : {}),
    }));
    if (isObj(h.climate)) {
      // Kept as it was simulated with (each part read as a definition's own, so it is valid).
      const c = h.climate;
      const snap = definitionOf({ star: c.star, orbit: c.orbit, atmosphere: c.atmosphere, body: { tiltDeg: c.tiltDeg, dayHours: c.dayHours } });
      if (snap) out.history.climate = climateSnapshot(snap);
    }
  }
  if (isObj(raw.life)) {
    const l = raw.life;
    if (l.biomeSet === 'earth' || l.biomeSet === 'custom') out.life.biomeSet = l.biomeSet;
    if (l.vegetation === 'earth' || l.vegetation === 'red-dwarf' || l.vegetation === 'blue-star' || l.vegetation === 'none') out.life.vegetation = l.vegetation;
    if (Array.isArray(l.customBiomes)) out.life.customBiomes = l.customBiomes.filter(isObj).map((b, i) => ({
      id: typeof b.id === 'string' ? b.id : `biome-${i + 1}`, name: typeof b.name === 'string' ? b.name : `Biome ${i + 1}`,
      color: Array.isArray(b.color) && b.color.length === 3 ? (b.color.map((c) => Math.max(0, Math.min(255, Math.round(num(c) ?? 0)))) as [number, number, number]) : [128, 128, 128],
      priority: num(b.priority) ?? i,
      ...(['tempC', 'precipMm', 'seasonality', 'elevationM'] as const).reduce((acc, key) => {
        const r = b[key];
        if (Array.isArray(r) && r.length === 2 && num(r[0]) !== undefined && num(r[1]) !== undefined) acc[key] = [num(r[0])!, num(r[1])!];
        return acc;
      }, {} as Partial<Record<'tempC' | 'precipMm' | 'seasonality' | 'elevationM', [number, number]>>),
    }));
  }
  if (isObj(raw.simulation) && (raw.simulation.quality === 'preview' || raw.simulation.quality === 'standard' || raw.simulation.quality === 'high')) out.simulation.quality = raw.simulation.quality;
  if (isObj(raw.simulation) && num(raw.simulation.spanMyr) !== undefined) out.simulation.spanMyr = num(raw.simulation.spanMyr);
  // Out-of-range values are brought within their limits rather than refused, so an old or hand-edited file opens.
  const fit = (v: number, path: keyof typeof LIMITS) => Math.min(LIMITS[path][1], Math.max(LIMITS[path][0], v));
  out.orbit.semiMajorAu = fit(out.orbit.semiMajorAu, 'orbit.semiMajorAu');
  out.orbit.eccentricity = fit(out.orbit.eccentricity, 'orbit.eccentricity');
  out.orbit.perihelionDeg = ((out.orbit.perihelionDeg % 360) + 360) % 360;
  out.body.radiusKm = fit(out.body.radiusKm, 'body.radiusKm');
  out.body.tiltDeg = fit(out.body.tiltDeg, 'body.tiltDeg');
  out.body.dayHours = fit(out.body.dayHours, 'body.dayHours');
  out.tectonics.plates = Math.round(fit(out.tectonics.plates, 'tectonics.plates'));
  out.tectonics.hotspots = Math.round(fit(out.tectonics.hotspots, 'tectonics.hotspots'));
  out.water.oceanFraction = fit(out.water.oceanFraction, 'water.oceanFraction');
  out.history.ageGyr = fit(out.history.ageGyr, 'history.ageGyr');
  out.star.stars = out.star.stars.map((s) => ({ ...s, massSun: fit(s.massSun, 'star.massSun') }));
  if (out.star.arrangement === 'single') out.star.stars = out.star.stars.slice(0, 1);
  else if (out.star.stars.length < 2) out.star.stars = [...out.star.stars, { massSun: out.star.stars[0].massSun * 0.5 }];
  return out;
}

/** The same definition, written in a stable order (for hashing and storing). */
export function canonicalDefinition(d: PlanetDefinition): PlanetDefinition {
  return JSON.parse(JSON.stringify(d)) as PlanetDefinition;
}
