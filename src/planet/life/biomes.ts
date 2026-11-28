// Biomes (Stage 14.9, D160): empirical classifications of the simulated climate.
//
// - Köppen-Geiger classes from the twelve monthly temperatures and precipitation, by the rules of Peel, Finlayson
//   and McMahon (2007): polar (E) where the warmest month stays below 10 °C; arid (B) where the year's precipitation
//   falls below ten times a threshold of twice the mean temperature (plus 14 mm, or 28 when most falls in summer,
//   none when in winter); then tropical (A, the coldest month 18 °C or warmer), temperate (C, the coldest above 0 °C)
//   or cold (D); with their dry seasons (s, w, f) and their summers' warmth (a, b, c, d). Summer is the warmer half of
//   the year, so the rules hold on any orbit.
// - Biomes as Whittaker's diagram places them by the year's temperature and wetness, here the aridity index (rain
//   over potential evaporation, from the water stage, as the UN's dryland classes use): rainforests, seasonal forests,
//   savannas, deserts, grasslands and steppes, Mediterranean shrubland, temperate forests and rainforests, boreal
//   forest, tundra; refined by the water stage (ice sheets, lakes, salt flats, wetlands, floodplains and deltas, and
//   tropical swamps), by height (alpine tundra and bare rock above the trees), and by the planet's own rules (custom
//   biomes, in priority order).
// - Colours as seen from space (the satellite look's, D100), the vegetation's colour after the star's light (Kiang et
//   al. 2007): green under a Sun-like star, dark red to near black under a red dwarf, yellow-orange under a hot blue-
//   white star, or bare ground where nothing grows.
import type { CustomBiome, LifeSpec } from '../model/definition.ts';
import { WATER } from '../water/hydrology.ts';

/** Köppen-Geiger classes, in the usual order, with their usual map colours. */
export const KOPPEN = [
  ['Af', 'Tropical rainforest', [0, 0, 255]], ['Am', 'Tropical monsoon', [0, 120, 255]], ['Aw', 'Tropical savanna', [70, 170, 250]],
  ['BWh', 'Hot desert', [255, 0, 0]], ['BWk', 'Cold desert', [255, 150, 150]], ['BSh', 'Hot steppe', [245, 165, 0]], ['BSk', 'Cold steppe', [255, 220, 100]],
  ['Csa', 'Mediterranean, hot summer', [255, 255, 0]], ['Csb', 'Mediterranean, warm summer', [200, 200, 0]], ['Csc', 'Mediterranean, cold summer', [150, 150, 0]],
  ['Cwa', 'Humid subtropical, dry winter', [150, 255, 150]], ['Cwb', 'Subtropical highland, dry winter', [100, 200, 100]], ['Cwc', 'Subpolar oceanic, dry winter', [50, 150, 50]],
  ['Cfa', 'Humid subtropical', [200, 255, 80]], ['Cfb', 'Oceanic', [100, 255, 80]], ['Cfc', 'Subpolar oceanic', [50, 200, 0]],
  ['Dsa', 'Continental, dry hot summer', [255, 0, 255]], ['Dsb', 'Continental, dry warm summer', [200, 0, 200]], ['Dsc', 'Subarctic, dry summer', [150, 50, 150]], ['Dsd', 'Subarctic, dry summer, very cold winter', [150, 100, 150]],
  ['Dwa', 'Continental, dry winter, hot summer', [170, 175, 255]], ['Dwb', 'Continental, dry winter, warm summer', [90, 120, 220]], ['Dwc', 'Subarctic, dry winter', [75, 80, 180]], ['Dwd', 'Subarctic, dry winter, very cold', [50, 0, 135]],
  ['Dfa', 'Continental, hot summer', [0, 255, 255]], ['Dfb', 'Continental, warm summer', [55, 200, 255]], ['Dfc', 'Subarctic', [0, 125, 125]], ['Dfd', 'Subarctic, very cold winter', [0, 70, 95]],
  ['ET', 'Tundra', [178, 178, 178]], ['EF', 'Ice cap', [102, 102, 102]],
] as const;
export type KoppenCode = (typeof KOPPEN)[number][0];
const KOPPEN_INDEX = new Map<string, number>(KOPPEN.map(([k], i) => [k, i]));
/** The index of a Köppen code (1-based in the `koppen` field; 0 is no class: the sea). */
export const koppenIndex = (code: KoppenCode) => KOPPEN_INDEX.get(code)!;

/**
 * The Köppen-Geiger class of a place from its twelve monthly mean temperatures (°C) and precipitation (mm). Summer is
 * the half-year from `summerStart` (a month index: the six months of most sunlight, as Peel and others take April to
 * September in the north); by default the half-year centred a month before the warmest month (the seasons' lag).
 */
export function koppen(temp: ArrayLike<number>, precip: ArrayLike<number>, summerStart?: number): KoppenCode {
  const months = temp.length;
  let hot = -Infinity, cold = Infinity, mat = 0, map = 0, dry = Infinity, warmMonths = 0;
  for (let m = 0; m < months; m++) {
    hot = Math.max(hot, temp[m]); cold = Math.min(cold, temp[m]);
    mat += temp[m] / months; map += precip[m]; dry = Math.min(dry, precip[m]);
    if (temp[m] > 10) warmMonths++;
  }
  let start = summerStart ?? -1;
  if (start < 0) {
    let w = 0;
    for (let m = 1; m < months; m++) if (temp[m] > temp[w]) w = m;
    start = (w - months / 4 + months) % months;
  }
  const inSummer = (m: number) => (m - start + months) % months < months / 2;
  let summerP = 0, sDry = Infinity, sWet = 0, wDry = Infinity, wWet = 0;
  for (let m = 0; m < months; m++) {
    if (inSummer(m)) { summerP += precip[m]; sDry = Math.min(sDry, precip[m]); sWet = Math.max(sWet, precip[m]); }
    else { wDry = Math.min(wDry, precip[m]); wWet = Math.max(wWet, precip[m]); }
  }
  if (hot < 10) return hot > 0 ? 'ET' : 'EF';
  const threshold = 2 * mat + (map > 0 && summerP >= 0.7 * map ? 28 : map > 0 && map - summerP >= 0.7 * map ? 0 : 14);
  if (map < 10 * threshold) {
    const dryKind = map < 5 * threshold ? 'BW' : 'BS';
    return `${dryKind}${mat >= 18 ? 'h' : 'k'}` as KoppenCode;
  }
  if (cold >= 18) {
    if (dry >= 60) return 'Af';
    return dry >= 100 - map / 25 ? 'Am' : 'Aw';
  }
  const season = sDry < 40 && sDry < wWet / 3 ? 's' : wDry < sWet / 10 ? 'w' : 'f';
  const summer = hot >= 22 ? 'a' : warmMonths >= 4 ? 'b' : cold < -38 ? 'd' : 'c';
  if (cold > 0) return `C${season}${summer === 'd' ? 'c' : summer}` as KoppenCode;
  return `D${season}${summer}` as KoppenCode;
}

/** Biomes, with their colours seen from space under a Sun-like star (vegetated ones take the star's palette). */
export const BIOME = {
  sea: { name: 'Sea', colour: [16, 40, 80], plants: 0 },
  ice: { name: 'Ice sheet', colour: [238, 242, 246], plants: 0 },
  polarDesert: { name: 'Polar desert', colour: [200, 200, 196], plants: 0 },
  tundra: { name: 'Tundra', colour: [120, 118, 96], plants: 0.4 },
  alpine: { name: 'Alpine tundra and rock', colour: [128, 116, 104], plants: 0.2 },
  boreal: { name: 'Boreal forest', colour: [44, 66, 46], plants: 1 },
  temperateRainforest: { name: 'Temperate rainforest', colour: [36, 70, 40], plants: 1 },
  temperateForest: { name: 'Temperate seasonal forest', colour: [58, 86, 46], plants: 1 },
  mediterranean: { name: 'Mediterranean woodland and shrub', colour: [112, 116, 70], plants: 0.7 },
  grassland: { name: 'Temperate grassland', colour: [124, 132, 80], plants: 0.8 },
  steppe: { name: 'Steppe and cold desert scrub', colour: [166, 148, 106], plants: 0.4 },
  desert: { name: 'Desert', colour: [214, 182, 128], plants: 0.05 },
  savanna: { name: 'Savanna', colour: [150, 138, 80], plants: 0.6 },
  tropicalSeasonal: { name: 'Tropical seasonal forest', colour: [70, 96, 44], plants: 1 },
  rainforest: { name: 'Tropical rainforest', colour: [32, 64, 30], plants: 1 },
  wetland: { name: 'Wetland', colour: [60, 92, 70], plants: 0.9 },
  swamp: { name: 'Tropical swamp and mangrove', colour: [40, 74, 52], plants: 1 },
  lake: { name: 'Lake', colour: [40, 90, 140], plants: 0 },
  saltFlat: { name: 'Salt flat', colour: [236, 228, 210], plants: 0 },
  barren: { name: 'Bare rock', colour: [118, 106, 96], plants: 0 },
  // (D259) Ground too hot for water or life, and ground hot enough to melt; their colours here are those at the
  // cooler end of each (rockColour gives the colour by the temperature).
  scorched: { name: 'Scorched rock', colour: [92, 78, 70], plants: 0 },
  lava: { name: 'Molten rock', colour: [232, 96, 24], plants: 0 },
  // (D260) The sea frozen over for most of the year: still sea (nothing stands on it), drawn as ice.
  seaIce: { name: 'Sea ice', colour: [224, 233, 240], plants: 0 },
} as const;
export type BiomeId = keyof typeof BIOME;
export const BIOME_IDS = Object.keys(BIOME) as BiomeId[];

export interface Place {
  /** Twelve monthly temperatures (°C) and precipitation (mm); the year's potential evaporation (mm). */
  temp: ArrayLike<number>;
  precip: ArrayLike<number>;
  pet: number;
  /** Height (m above the sea), kind of water (WATER), ice thickness (m). */
  height: number;
  water: number;
  ice: number;
}

/** The biome of a place by the Earth's rules. */
export function biomeOf(p: Place): BiomeId {
  if (p.water === WATER.sea) return 'sea';
  if (p.ice > 50 || p.water === WATER.ice) return 'ice';
  if (p.water === WATER.lake || p.water === WATER.saltLake) return 'lake';
  if (p.water === WATER.saltFlat) return 'saltFlat';
  let mat = 0, hot = -Infinity, map = 0;
  for (let m = 0; m < p.temp.length; m++) { mat += p.temp[m] / p.temp.length; hot = Math.max(hot, p.temp[m]); map += p.precip[m]; }
  // Above the trees (the warmest month under 10 °C): tundra, alpine tundra on high ground, polar desert, ice.
  if (hot < 0) return 'ice';
  if (hot < 10) return p.height > 1500 && Math.abs(mat) < 40 && mat > -12 ? 'alpine' : map < 150 ? 'polarDesert' : 'tundra';
  if (p.water === WATER.wetland || p.water === WATER.floodplain || p.water === WATER.delta) return mat >= 20 ? 'swamp' : 'wetland';
  const ai = p.pet > 0 ? map / p.pet : map > 0 ? 10 : 0;
  if (mat < 3) return ai < 0.25 ? 'steppe' : 'boreal';
  if (mat < 18) {
    if (ai < 0.2) return mat < 10 ? 'steppe' : 'desert';
    if (ai < 0.5) return 'steppe';
    if (ai < 0.75) {
      // Winter rain and summer drought: Mediterranean woodland and shrub; otherwise grassland.
      const k = koppen(p.temp, p.precip);
      return k.startsWith('Cs') || k.startsWith('Ds') ? 'mediterranean' : 'grassland';
    }
    return ai > 2 ? 'temperateRainforest' : 'temperateForest';
  }
  if (ai < 0.2) return 'desert';
  if (ai < 0.5) return mat >= 20 ? 'savanna' : 'steppe';
  if (ai < 0.9) return 'savanna';
  return ai < 1.4 ? 'tropicalSeasonal' : 'rainforest';
}

/** The share of the year the sea lies frozen from which it is drawn as ice (D260). */
export const SEA_ICE_FROM = 0.5;
/** Above this (°C, the warmest month's mean) nothing grows: photosynthesis fails near 50 °C (D259). */
export const TOO_HOT_FOR_PLANTS = 50;
/** Above this (°C) no water lies on the ground at the Earth's pressure: the rock is baked dry (D259). */
export const SCORCHED_FROM = 100;
/** Above this (°C) basalt, the commonest rock of a planet's crust, melts (D259). */
export const MOLTEN_FROM = 1100;

/**
 * What heat alone makes of the land (D259), from the mean temperature of its warmest month (°C): molten rock, rock
 * scorched dry, bare ground too hot for anything to grow; null where the heat decides nothing.
 */
export function hotSurface(hot: number): BiomeId | null {
  return hot >= MOLTEN_FROM ? 'lava' : hot >= SCORCHED_FROM ? 'scorched' : hot >= TOO_HOT_FOR_PLANTS ? 'barren' : null;
}

const ROCK: Array<[number, [number, number, number]]> = [
  [100, [118, 106, 96]], [250, [92, 78, 70]], [450, [64, 52, 50]], [650, [58, 36, 34]], [800, [110, 34, 22]], [950, [176, 52, 20]],
  [1100, [232, 96, 24]], [1400, [252, 160, 52]], [2000, [255, 224, 150]], [3000, [255, 250, 235]],
];
/**
 * The colour of bare rock by its temperature (°C, D259): bare rock's own up to 100 °C; darker as it is baked; from
 * about 650 °C its own glow shows (red, then orange, yellow and white, as iron in a forge), brighter than anything
 * it reflects once it melts.
 */
export function rockColour(tempC: number): [number, number, number] {
  if (!(tempC > ROCK[0][0])) return [...ROCK[0][1]];
  for (let i = 1; i < ROCK.length; i++) {
    if (tempC <= ROCK[i][0]) {
      const a = ROCK[i - 1], b = ROCK[i], t = (tempC - a[0]) / (b[0] - a[0]);
      return [Math.round(a[1][0] + (b[1][0] - a[1][0]) * t), Math.round(a[1][1] + (b[1][1] - a[1][1]) * t), Math.round(a[1][2] + (b[1][2] - a[1][2]) * t)];
    }
  }
  return [...ROCK[ROCK.length - 1][1]];
}

/** How seasonal a place's rain is: twice the difference between its wettest and driest months over the year's (0 even; 1 when that difference is half the year's or more). */
export function seasonality(precip: ArrayLike<number>): number {
  let lo = Infinity, hi = 0, sum = 0;
  for (let m = 0; m < precip.length; m++) { lo = Math.min(lo, precip[m]); hi = Math.max(hi, precip[m]); sum += precip[m]; }
  return sum > 0 ? Math.min(1, (2 * (hi - lo)) / sum) : 0;
}

/** The first of a planet's own biomes (by priority) whose conditions a place meets, or null. */
export function customBiomeOf(p: Place, rules: CustomBiome[]): CustomBiome | null {
  if (p.water === WATER.sea) return null;
  let mat = 0, map = 0;
  for (let m = 0; m < p.temp.length; m++) { mat += p.temp[m] / p.temp.length; map += p.precip[m]; }
  return customBiomeFor(mat, map, seasonality(p.precip), p.height, rules);
}

/**
 * The first of a planet's own biomes (by priority) whose conditions are met by a place's year: its mean temperature
 * (°C), rain and snow (mm), how seasonal the rain is (0 to 1) and its height (m); or null.
 */
export function customBiomeFor(mat: number, map: number, season: number, height: number, rules: CustomBiome[]): CustomBiome | null {
  const within = (v: number, r?: [number, number]) => !r || (v >= r[0] && v <= r[1]);
  for (const b of [...rules].sort((a, b2) => a.priority - b2.priority)) {
    if (within(mat, b.tempC) && within(map, b.precipMm) && within(season, b.seasonality) && within(height, b.elevationM)) return b;
  }
  return null;
}

type RGB = [number, number, number];
/** The colour of plant cover under a star (Kiang et al. 2007), from its colour under a Sun-like star. */
export function vegetationColour(c: readonly number[], vegetation: LifeSpec['vegetation']): RGB {
  const [r, g, b] = c;
  switch (vegetation) {
    // Under a red dwarf plants would take as much of the dim red light as they can: dark, red to black.
    case 'red-dwarf': return [Math.round(0.75 * g + 0.2 * r), Math.round(0.35 * r), Math.round(0.4 * b + 0.15 * g)];
    // Under a hot white star they would shade themselves from the blue: yellow to orange.
    case 'blue-star': return [Math.round(0.6 * r + 0.9 * g), Math.round(0.95 * g + 0.15 * r), Math.round(0.45 * b)];
    // No life: the bare ground the climate leaves (desert, steppe and rock tones by wetness).
    case 'none': return [Math.round(150 + 0.25 * r), Math.round(132 + 0.2 * g), Math.round(108 + 0.15 * b)];
    default: return [r, g, b];
  }
}

/** A biome's colour seen from space on a planet: plants coloured after its star, blended by how much plant cover it has. */
export function biomeColour(id: BiomeId, life: Pick<LifeSpec, 'vegetation'>): RGB {
  const b = BIOME[id], c = b.colour as readonly number[];
  if (!b.plants || life.vegetation === 'earth') return [c[0], c[1], c[2]];
  const v = vegetationColour(c, life.vegetation), t = b.plants;
  return [Math.round(c[0] + (v[0] - c[0]) * t), Math.round(c[1] + (v[1] - c[1]) * t), Math.round(c[2] + (v[2] - c[2]) * t)];
}
