// Why a planet looks as it does (D263): the chain of causes from its star to its surface, each link with the numbers
// that decided it, read from the same products its pictures are made from. And its figures in a few words (how much
// sea, ice, forest, desert and bare rock; how warm; how wet), for saying what a change of a setting did.
import type { PlanetDefinition } from './model/definition.ts';
import { EARTH_WATER_KM } from './model/definition.ts';
import type { Derived, WaterFate } from './model/physics.ts';
import { SIGMA } from './model/units.ts';
import { BIOME_IDS, type BiomeId } from './life/biomes.ts';

/** What the sea stage says of the planet's air and water (stages.ts, `sea`). */
export interface SeaFacts {
  share: number; liquidShare: number; fate: WaterFate; kept: boolean; cause: 'sunlight' | 'greenhouse' | 'thin-air' | null;
  absorbed: number; limit: number; withSeasK: number;
  air: 'none' | 'held' | 'lost' | 'kept'; escapeKmS: number; neededKmS: number; pressureBar: number; iceK: number; iceLastsK: number;
}
/** The planet's figures from the model its pictures are made with (the temperature, climate and biomes stages). */
export interface ModelFacts {
  /** The surface's mean temperature over the year (°C), the sunlight taken in (W/m²), the share of the sea frozen for most of the year, of the surface under ice caps. */
  surfaceC: number; absorbed: number; seaFrozen: number; capShare: number;
  /** With little or no air: the equator's days and nights (°C). */
  dayC?: number; nightC?: number;
  /** Rain and snow over the year, the planet's mean (mm); each kind of surface's share of the planet (by BIOME_IDS). */
  rainMm: number; shares: ArrayLike<number>;
}

/** Kinds of surface gathered into the few a planet is described by. */
export const FAMILIES = {
  sea: { name: 'open sea', of: ['sea', 'lake'] },
  ice: { name: 'ice', of: ['ice', 'seaIce'] },
  forest: { name: 'forest', of: ['boreal', 'temperateRainforest', 'temperateForest', 'tropicalSeasonal', 'rainforest', 'swamp'] },
  grass: { name: 'grass and scrub', of: ['mediterranean', 'grassland', 'steppe', 'savanna', 'wetland', 'tundra', 'alpine'] },
  desert: { name: 'desert', of: ['desert', 'polarDesert', 'saltFlat'] },
  rock: { name: 'bare rock', of: ['barren'] },
  scorched: { name: 'scorched rock', of: ['scorched'] },
  molten: { name: 'molten rock', of: ['lava'] },
} as const satisfies Record<string, { name: string; of: readonly BiomeId[] }>;
export type FamilyId = keyof typeof FAMILIES;
export const FAMILY_IDS = Object.keys(FAMILIES) as FamilyId[];
const FAMILY_OF = new Map<number, FamilyId>();
for (const f of FAMILY_IDS) for (const b of FAMILIES[f].of) FAMILY_OF.set(BIOME_IDS.indexOf(b), f);
/** The family of a kind of surface (by its place in BIOME_IDS). */
export const familyOf = (biome: number): FamilyId => FAMILY_OF.get(biome) ?? 'rock';

/** Each family's share of the planet, from each kind's. */
export function familyShares(shares: ArrayLike<number>): Record<FamilyId, number> {
  const out = Object.fromEntries(FAMILY_IDS.map((f) => [f, 0])) as Record<FamilyId, number>;
  for (let i = 0; i < shares.length; i++) out[familyOf(i)] += shares[i];
  return out;
}

const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d }) : '∞');
const pct = (v: number) => (v > 0 && v < 0.005 ? 'under 1' : num(100 * v));

/** The surface in words: its families from the largest, those under a hundredth left out. */
export function surfaceInWords(shares: ArrayLike<number>): string {
  const fam = familyShares(shares);
  const parts = FAMILY_IDS.filter((f) => fam[f] >= 0.01).sort((a, b) => fam[b] - fam[a]);
  if (parts.length === 1 && fam[parts[0]] > 0.985) return `${FAMILIES[parts[0]].name[0].toUpperCase()}${FAMILIES[parts[0]].name.slice(1)} everywhere`;
  return parts.map((f, i) => `${i === 0 ? FAMILIES[f].name[0].toUpperCase() + FAMILIES[f].name.slice(1) : FAMILIES[f].name} ${pct(fam[f])} %`).join(', ');
}

/** One link of the chain: what decides, and what follows from it. */
export interface Why { key: 'light' | 'air' | 'water' | 'warmth' | 'rain' | 'surface'; cause: string; effect: string }

/**
 * The chain for a planet: its definition, what follows from it for the planet as it is (`x`: with the air and sea it
 * has in fact), what the sea stage says, and the model's figures once they are worked out (null until then: the
 * links they decide are left out).
 */
export function whyItLooksSo(def: PlanetDefinition, x: Derived, sea: SeaFacts, model: ModelFacts | null): Why[] {
  const out: Why[] = [];
  const star = x.stars[0];
  out.push({
    key: 'light', cause: `A ${star.spectralClass} star ${num(x.luminositySun, x.luminositySun < 10 ? 2 : 0)} × as bright as the Sun, ${num(def.orbit.semiMajorAu, def.orbit.semiMajorAu < 10 ? 2 : 0)} AU away`,
    effect: `Sunlight ${num(x.insolationEarth, x.insolationEarth < 10 ? 2 : 0)} × the Earth's (${num(x.insolation)} W/m²)`,
  });
  // The air.
  const hold = `it needs an escape speed of ${num(sea.neededKmS, 1)} km/s to hold air under this light and has ${num(sea.escapeKmS, 1)}`;
  if (sea.air === 'lost') out.push({ key: 'air', cause: `Gravity ${num(x.gravityEarth, 2)} g: ${hold}`, effect: 'No air: it leaked away to space' });
  else if (sea.air === 'kept') out.push({ key: 'air', cause: `Gravity ${num(x.gravityEarth, 2)} g: ${hold}; kept by hand`, effect: `${num(sea.pressureBar, sea.pressureBar < 1 ? 3 : 1)} bar of air (not what the physics gives)` });
  else if (sea.air === 'none') out.push({ key: 'air', cause: 'Given no air', effect: 'No air: nothing to hold heat or carry it' });
  else out.push({ key: 'air', cause: `Gravity ${num(x.gravityEarth, 2)} g holds its air (escape speed ${num(sea.escapeKmS, 1)} km/s, ${num(sea.neededKmS, 1)} needed)`, effect: `${num(sea.pressureBar, sea.pressureBar < 1 ? 3 : 1)} bar of air, ${num(100 * def.atmosphere.co2, def.atmosphere.co2 < 0.01 ? 2 : 0)} % of it carbon dioxide` });
  // The water.
  const depth = def.water.depthKm ?? 0, amount = `${num(depth, 2)} km of water (${num(depth / EARTH_WATER_KM, 2)} × the Earth's)`;
  const thin = `Under ${sea.pressureBar > 0 ? `${num(sea.pressureBar, 4)} bar` : 'no air'} water is never liquid (it needs 0.006 bar)`;
  if (sea.kept) out.push({ key: 'water', cause: `${amount}, kept by hand though ${sea.cause === 'thin-air' ? 'there is too little air for it to be liquid' : 'it would have boiled away'}`, effect: `Seas on ${pct(sea.share)} % of the surface (not what the physics gives)` });
  else if (sea.fate === 'none') out.push({ key: 'water', cause: 'Given no water', effect: 'A dry world: no seas, rain or rivers' });
  else if (sea.fate === 'boiled') out.push({
    key: 'water',
    cause: sea.cause === 'greenhouse'
      ? `Its air holds so much heat in that with seas it could shed no more than ${num(sea.limit)} W/m²; it would take in ${num(sea.absorbed)}`
      : `With seas it would take in ${num(sea.absorbed)} W/m²; a planet with seas can shed no more than ${num(sea.limit)}`,
    effect: 'The seas boiled away and the water was lost to space',
  });
  else if (sea.fate === 'sublimed') out.push({
    key: 'water', cause: `${thin}, and ice does not last where the sun is high (${num(sea.iceK - 273.15)} °C there; it lasts below ${num(sea.iceLastsK - 273.15)} °C)`,
    effect: `The seas went into vapour${model ? (model.capShare >= 0.001 ? `; what was not lost froze into ice caps on ${pct(model.capShare)} % of the surface` : ' and were lost: nowhere is cold enough for ice') : ''}`,
  });
  else if (sea.fate === 'frozen') out.push({ key: 'water', cause: `${thin}; ice lasts even at the equator (${num(sea.iceK - 273.15)} °C there; it lasts below ${num(sea.iceLastsK - 273.15)} °C)`, effect: `The seas stand frozen where they are, on ${pct(sea.share)} % of the surface` });
  else out.push({
    key: 'water', cause: `${amount} filling the land's hollows`,
    effect: `Seas on ${pct(sea.share)} % of the surface${model ? (model.seaFrozen >= 0.995 ? ', all of them frozen over' : model.seaFrozen >= 0.02 ? `, ${pct(model.seaFrozen)} % of them under ice` : '') : ''}`,
  });
  if (!model) return out;
  // How warm: the light taken in, and what the air holds.
  const albedo = 1 - model.absorbed / (x.insolation / 4), bare = (model.absorbed / SIGMA) ** 0.25 - 273.15, held = model.surfaceC - bare;
  const days = model.dayC !== undefined && model.nightC !== undefined ? `; with so little air the ground follows the sun: ${num(model.dayC)} °C by day, ${num(model.nightC)} °C by night at the equator` : '';
  out.push({
    key: 'warmth',
    cause: `It takes in ${num(model.absorbed)} W/m² (it sends back ${num(100 * albedo)} % of its light${albedo > 0.45 ? ': ice and cloud' : ''}); ${held >= 0.5 ? `its air holds in ${num(held)} °C of warmth` : 'no air to hold warmth in'}`,
    effect: `${num(model.surfaceC)} °C on average${days}`,
  });
  // How wet.
  const wet = sea.fate === 'liquid' && sea.pressureBar >= 0.006;
  out.push(wet
    ? { key: 'rain', cause: model.seaFrozen >= 0.995 ? 'Frozen seas give the air little vapour' : `${model.surfaceC > 30 ? 'Hot' : model.surfaceC > 5 ? 'Warm' : 'Cold'} seas give the air its vapour`, effect: `${num(model.rainMm)} mm of rain and snow a year on average` }
    : { key: 'rain', cause: sea.fate === 'frozen' || sea.fate === 'sublimed' ? 'No air to carry vapour, no open water to give it' : 'No water to fall', effect: 'No rain or snow' });
  // What covers it.
  const fam = familyShares(model.shares), living = fam.forest + fam.grass;
  const cause = fam.molten > 0.5 ? 'Hot enough to melt rock (from 1,100 °C)'
    : fam.scorched > 0.5 ? 'Too hot for water to lie on the ground (over 100 °C)'
      : living > 0.01 ? 'Plants where it is warm and wet enough, ice where it is cold, desert where it is dry'
        : fam.ice > 0.5 ? 'Too cold for anything but ice'
          : !wet ? 'No rain, so nothing grows and nothing wears the rock'
            // (D267: a planet given no plants has bare ground where they would have grown.)
            : def.life.vegetation === 'none' && model.surfaceC > -15 && model.surfaceC < 45 ? 'Warmth and rain enough for plants, but no life given' : 'Too cold or too hot for plants';
  out.push({ key: 'surface', cause, effect: surfaceInWords(model.shares) });
  return out;
}

/** A planet's figures in a few numbers: for saying what a change did. */
export interface Figures { meanC: number; sea: number; ice: number; forest: number; grass: number; desert: number; rock: number; scorched: number; molten: number; rainMm: number }
export function figuresOf(sea: SeaFacts, model: ModelFacts): Figures {
  const fam = familyShares(model.shares);
  return { meanC: model.surfaceC, sea: fam.sea, ice: fam.ice, forest: fam.forest, grass: fam.grass, desert: fam.desert, rock: fam.rock, scorched: fam.scorched, molten: fam.molten, rainMm: sea.fate === 'liquid' ? model.rainMm : 0 };
}

/**
 * What changed between two states of a planet, in words: each figure that moved by more than a little, with its
 * value before and after. Empty when nothing did. (`settings`, D268: the settings that differ; where no figure moved
 * and the plants' colour is among them, that is what changed.)
 */
export function whatChanged(before: Figures, after: Figures, settings: SettingChange[] = []): string[] {
  const out: string[] = [];
  if (Math.abs(after.meanC - before.meanC) >= 0.5) out.push(`Temperature ${num(before.meanC)} °C → ${num(after.meanC)} °C`);
  const share = (name: string, a: number, b: number) => { if (Math.abs(b - a) >= 0.005) out.push(`${name} ${a < 0.005 ? 'none' : `${pct(a)} %`} → ${b < 0.005 ? 'none' : `${pct(b)} %`}`); };
  share('Open sea', before.sea, after.sea);
  share('Ice', before.ice, after.ice);
  share('Forest', before.forest, after.forest);
  share('Grass and scrub', before.grass, after.grass);
  share('Desert', before.desert, after.desert);
  share('Bare rock', before.rock, after.rock);
  share('Scorched rock', before.scorched, after.scorched);
  share('Molten rock', before.molten, after.molten);
  if (Math.abs(after.rainMm - before.rainMm) >= Math.max(10, 0.03 * before.rainMm)) out.push(`Rain and snow ${num(before.rainMm)} → ${num(after.rainMm)} mm a year`);
  const plants = settings.find((c) => c.name === 'Plants');
  if (!out.length && plants && plants.after !== 'none' && before.forest + before.grass > 0.005) out.push(`The colour of its plants: ${plants.before} → ${plants.after}`);
  return out;
}

/** A setting that differs between two definitions: its name and its value in each, in words. */
export interface SettingChange { name: string; before: string; after: string }
const SETTINGS: Array<[string, (d: PlanetDefinition) => number | string | boolean | undefined, (v: number) => string]> = [
  ['The star\'s mass', (d) => d.star.stars[0].massSun, (v) => `${num(v, 2)} Suns`],
  ['Distance', (d) => d.orbit.semiMajorAu, (v) => `${num(v, 3)} AU`],
  ['Eccentricity', (d) => d.orbit.eccentricity, (v) => num(v, 3)],
  ['The season at the nearest point', (d) => d.orbit.perihelionDeg, (v) => `${num(v)}°`],
  ['The year, set by hand', (d) => d.orbit.yearDays, (v) => `${num(v, 1)} days`],
  ['The star\'s light, set by hand', (d) => d.star.stars[0].luminositySun, (v) => `${num(v, 3)} × the Sun\'s`],
  ['The star\'s surface temperature, set by hand', (d) => d.star.stars[0].teffK, (v) => `${num(v)} K`],
  ['Tilt', (d) => d.body.tiltDeg, (v) => `${num(v, 1)}°`],
  ['Day', (d) => d.body.dayHours, (v) => `${num(v, 1)} hours`],
  ['Locked to its star', (d) => String(d.body.tidallyLocked), () => ''],
  ['Radius', (d) => d.body.radiusKm, (v) => `${num(v)} km`],
  ['The mass, set by hand', (d) => d.body.massEarths, (v) => `${num(v, 2)} Earths`],
  ['Air', (d) => d.atmosphere.pressureBar, (v) => (v > 0 ? `${num(v, v < 0.1 ? 4 : 2)} bar` : 'none')],
  ['Carbon dioxide', (d) => d.atmosphere.co2, (v) => `${num(100 * v, v < 0.01 ? 3 : 1)} %`],
  ['Methane', (d) => d.atmosphere.ch4, (v) => `${num(100 * v, 4)} %`],
  ['Cloud cover', (d) => d.atmosphere.clouds, (v) => num(v, 2)],
  ['The clouds\' brightness', (d) => d.atmosphere.cloudAlbedo, (v) => num(v, 2)],
  ['Air kept by hand', (d) => (d.atmosphere.keep ? 'yes' : 'no'), () => ''],
  ['Water', (d) => d.water.depthKm ?? d.water.oceanFraction, (v) => `${num(v, 2)} km`],
  ['Seas kept by hand', (d) => (d.water.keep ? 'yes' : 'no'), () => ''],
  ['Plants', (d) => ({ earth: 'green', 'red-dwarf': 'dark red', 'blue-star': 'yellow to orange', none: 'none' })[d.life.vegetation], () => ''],
  ['Biomes', (d) => (d.life.biomeSet === 'custom' ? 'the planet\'s own' : 'the Earth\'s'), () => ''],
  ['The interior\'s heat', (d) => d.interior.heatProduction, (v) => num(v, 2)],
  ['The core\'s share', (d) => d.interior.coreFraction, (v) => num(v, 2)],
  ['Plates', (d) => d.tectonics.plates, (v) => num(v)],
  ['Tectonic activity', (d) => d.tectonics.activity, (v) => num(v, 2)],
  ['Continents', (d) => d.tectonics.continentalFraction, (v) => num(v, 2)],
  ['Hotspots', (d) => d.tectonics.hotspots, (v) => num(v)],
  ['Age', (d) => d.history.ageGyr, (v) => `${num(v, 2)} billion years`],
  ['Simulated', (d) => d.simulation.spanMyr ?? 500, (v) => `${num(v)} million years`],
  ['Seed', (d) => d.seed, (v) => String(v)],
];
/** The settings that differ between two definitions (those the Studio's sliders set), each with its value before and after. */
export function settingsChanged(a: PlanetDefinition, b: PlanetDefinition): SettingChange[] {
  const out: SettingChange[] = [];
  for (const [name, get, say] of SETTINGS) {
    const x = get(a), y = get(b);
    if (x === y) continue;
    const word = (v: number | string | boolean | undefined) => (typeof v === 'number' ? say(v) : String(v ?? 'none'));
    out.push({ name, before: word(x), after: word(y) });
  }
  if (!out.length && JSON.stringify(a) !== JSON.stringify(b)) out.push({ name: 'Other settings', before: '', after: '' });
  return out;
}
