// The planetary engine's stages (Stage 14, D152): each makes a product from a slice of the planet's definition and
// the products of the stages it uses. A product's key is a hash of exactly that (the stage, its version, the
// engine's version, its inputs and its dependencies' keys), so changing a setting re-runs only the stages that
// read it, and anything already made for the same inputs is reused (scheduler.ts).
//
// The same registry runs in the interface (to work out inputs and keys, and to join parts) and in the workers (to
// run stages). A stage that works cell by cell can be run in parts: fixed ranges of cells, whatever the number of
// workers, joined in order, so the result is the same bytes on one worker or on many.
import { definitionOf, historyView, referenceSea, withWaterGuess, type PlanetDefinition } from '../model/definition.ts';
import { seasonalClimate, type ClimateOptions } from '../climate/ebm.ts';
import { joinRain, rainMonths, type RainMonths } from '../climate/hydroclimate.ts';
import { hydrology } from '../water/hydrology.ts';
import { iceSheets } from '../water/ice.ts';
import { BIOME, BIOME_IDS, KOPPEN, SEA_ICE_FROM, biomeColour, biomeOf, customBiomeOf, hotSurface, koppen, rockColour, type BiomeId, type Place } from '../life/biomes.ts';
import { toLevel } from '../mesh/transfer.ts';
import { derive, waterState } from '../model/physics.ts';
import { cellsAt, meshAt } from '../mesh/icosphere.ts';
import { seaLevelForVolume } from '../water/sealevel.ts';
import { rasterize } from '../mesh/transfer.ts';
import { insolationCells, sunlightOf, type Sunlight } from '../climate/insolation.ts';
import { rasterizeNearest } from '../mesh/transfer.ts';
import { runHistory, type TectonicHistory } from '../tectonics/history.ts';
import type { TectonicParams } from '../tectonics/state.ts';
import { CRUST } from '../tectonics/plates.ts';
import type { FieldArray } from '../state/codec.ts';
import { momentColours, type Moment } from '../life/past.ts';
import { momentPicture } from '../climate/paleo.ts';

/** Changes whenever any model changes its results, so nothing made before is reused. */
export const ENGINE_VERSION = 1;

export interface StageParams {
  /** The mesh level to work at. */
  level: number;
  /** For pictures: the size and the layer, and which of a history's pictures (default: the present). */
  width?: number;
  height?: number;
  layer?: LayerId;
  frame?: number;
  /** For histories: how long (Myr, ending at the present) and how often a picture is kept (Myr). */
  durationMyr?: number;
  frameEveryMyr?: number;
  /**
   * The present's heights (m above the sea, per cell of the mesh at `level`) given instead of a history (D169: a
   * generated planet's own land and sea): the climate, water and life stages work on them.
   */
  heights?: Int16Array;
  /**
   * For the cover (D257): the land's colours alone, never mixed with the sea's along the coast, and in each pixel's
   * alpha how much of what surrounds it is land (255 inland, 0 at sea; the coast runs where it passes 128).
   */
  land?: boolean;
  /**
   * The sea follows from the planet's water (D258, definitions of `engine` 2): the climate, water and life stages
   * work on the land and sea of the sea stage, at the moment asked for (`frame`: one of the history's pictures;
   * none or −1: the present), and `month` chooses the month of the layers that have months.
   */
  sea?: boolean;
  month?: number;
}

export type ProductValue = FieldArray | number | string | boolean | null | ProductValue[] | { [k: string]: ProductValue };
export type ProductData = { [k: string]: ProductValue };

export interface StageContext {
  progress(done: number, total: number): void;
  /** Products the stage may start from (never changing what it makes): `base`, an earlier history (D163). */
  hints?: Record<string, ProductData>;
}

export interface StageDef {
  id: string;
  version: number;
  deps(params: StageParams): string[];
  /** What the stage reads: only this (and its dependencies' keys) decides its product. */
  inputs(def: PlanetDefinition, params: StageParams): ProductData;
  /** How many items (cells) it can be run in parts over, if it can. */
  parts?(inputs: ProductData): number;
  /** How many items a part takes, given the workers (default: fixed ranges of cells); the product is the same whatever. */
  partSize?(items: number, workers: number): number;
  /** Run on a range of items, a part; without one, the whole product (as the parts joined). */
  run(inputs: ProductData, deps: Record<string, ProductData>, ctx: StageContext, range?: [number, number]): ProductData | Promise<ProductData>;
  /** Joins the parts' products, in order. */
  join?(parts: ProductData[], inputs: ProductData, deps: Record<string, ProductData>): ProductData;
}

/**
 * The layers a picture can show: which stage and field, the unit, whether the field has one picture per moment of a
 * history (`frames`), and whether its values are categories (drawn by the nearest cell, never blended).
 */
export const LAYERS = {
  insolation: { stage: 'insolation', field: 'annual', unit: 'W/m²', label: 'Sunlight (yearly mean)', frames: false, categories: false },
  elevation: { stage: 'tectonics', field: 'heights', unit: 'm', label: 'Height above the sea', frames: true, categories: false },
  plates: { stage: 'tectonics', field: 'plates', unit: '', label: 'Plates', frames: true, categories: true },
  crust: { stage: 'tectonics', field: 'kinds', unit: '', label: 'Kind of crust', frames: true, categories: true },
  crustAge: { stage: 'tectonics', field: 'age', unit: 'Myr', label: 'Age of the crust', frames: false, categories: false },
  crustThickness: { stage: 'tectonics', field: 'thickness', unit: 'km', label: 'Thickness of the crust', frames: false, categories: false },
  history: { stage: 'tectonics', field: 'tags', unit: '', label: 'What made the crust', frames: false, categories: true },
  sediment: { stage: 'tectonics', field: 'sediment', unit: 'km', label: 'Sediment', frames: false, categories: false },
  temperature: { stage: 'climate', field: 'annual', unit: '°C', label: 'Temperature (yearly mean)', frames: false, categories: false },
  temperatureMonth: { stage: 'climate', field: 'monthly', unit: '°C', label: 'Temperature by month', frames: true, categories: false },
  precipitation: { stage: 'climate', field: 'precipAnnual', unit: 'mm', label: 'Rain and snow (a year)', frames: false, categories: false },
  precipitationMonth: { stage: 'climate', field: 'precipMonthly', unit: 'mm', label: 'Rain and snow by month', frames: true, categories: false },
  currents: { stage: 'climate', field: 'currents', unit: 'K', label: 'The sea\'s currents (warmer and cooler)', frames: false, categories: false },
  ice: { stage: 'climate', field: 'ice', unit: '', label: 'Ice and snow (share of the year)', frames: false, categories: false },
  drainage: { stage: 'tectonics', field: 'discharge', unit: 'km²', label: 'Water draining through', frames: false, categories: false },
  runoff: { stage: 'water', field: 'runoff', unit: 'mm', label: 'Water running off (a year)', frames: false, categories: false },
  rivers: { stage: 'water', field: 'discharge', unit: 'm³/s', label: 'Rivers (discharge)', frames: false, categories: false },
  water: { stage: 'water', field: 'kind', unit: '', label: 'Lakes, rivers, wetlands and ice', frames: false, categories: true },
  iceThickness: { stage: 'water', field: 'ice', unit: 'm', label: 'Ice sheets (thickness)', frames: false, categories: false },
  provenance: { stage: 'tectonics', field: 'tags', unit: '', label: 'Simulated or edited', frames: false, categories: true },
  koppen: { stage: 'biomes', field: 'koppen', unit: '', label: 'Köppen-Geiger climates', frames: false, categories: true },
  biome: { stage: 'biomes', field: 'biome', unit: '', label: 'Biomes', frames: false, categories: true },
  boundaries: { stage: 'tectonics', field: 'boundary', unit: '', label: 'Plate boundaries', frames: false, categories: true },
} as const;
export type LayerId = keyof typeof LAYERS;

/**
 * Layers shown at the history's earlier moments too (D167), from what each picture's moment's own climate made
 * (the moment stage). At the present (frame −1) they are the climate and life stages' own.
 */
export const PAST_FIELDS: Partial<Record<LayerId, 'biome' | 'temp' | 'rain'>> = { biome: 'biome', temperature: 'temp', precipitation: 'rain' };
/** Whether a picture of a layer is of an earlier moment (D167). */
const pastOf = (p: StageParams) => !!PAST_FIELDS[p.layer ?? 'insolation'] && (p.frame ?? -1) >= 0;
/** The stage a layer's picture is made from where the sea follows from the water (D258): the heights from the sea stage. */
const layerStage = (layer: LayerId): string => (layer === 'elevation' ? 'sea' : LAYERS[layer].stage);

/** What the tectonic history reads from a definition, for a history of `durationMyr` ending at the present. */
export function tectonicParams(live: PlanetDefinition, level: number, durationMyr = 500): TectonicParams {
  if (live.engine === 2) return geologyParams(live, level, durationMyr);
  // The history sees the climate settings it keeps, if it keeps them (D161).
  const def = historyView(live), x = derive(def);
  const D = Math.min(durationMyr, def.history.ageGyr * 1000);
  // Timeline events, in the history's own time (Myr since it began); those wholly before it are left out.
  const events = def.history.events
    .map((e) => ({ kind: e.kind, start: D - e.startMa, end: D - e.startMa + Math.max(0, e.durationMyr), strength: e.strength, ...(e.at ? { at: e.at } : {}) }))
    .filter((e) => e.end >= 0 && e.start <= D);
  return {
    level, seed: def.seed, radiusKm: def.body.radiusKm, gravity: x.gravity, plates: def.tectonics.plates,
    vigor: def.tectonics.activity * Math.sqrt(Math.max(0, x.heatFlowEarth)), continentalFraction: def.tectonics.continentalFraction,
    oceanFraction: def.water.oceanFraction, regime: x.regime, hotspots: def.tectonics.hotspots, events,
    // Rivers need water and air: a dry world wears down far more slowly (wind and frost only).
    erodibility: (0.03 + 0.97 * Math.min(1, def.water.oceanFraction / 0.3)) * (0.3 + 0.7 * Math.min(1, def.atmosphere.pressureBar / 0.3)),
    hadleyDeg: x.hadleyEdgeDeg,
    // The climate the history's erosion and ice follow (D159): the planet's own settings.
    // (As the history was simulated with, if it keeps them: D161.)
    climate: { star: def.star, orbit: def.orbit, body: def.body, atmosphere: def.atmosphere, water: def.water, history: { ageGyr: def.history.ageGyr, events: [] }, interior: def.interior },
  };
}

/** The events of a history that act on its plates and crust (the others act on the climate and the sea alone). */
const TECTONIC_EVENTS = new Set(['supercontinent', 'breakup', 'rift', 'collision', 'volcanic-period', 'lip', 'hotspot', 'impact', 'reorganisation']);

/**
 * What a history is made from where the sea follows from the water (D258): the planet's geology alone. Its seed, size
 * and gravity, its interior's heat and regime, its plates, continents and hotspots, the events that move plates and
 * build crust, and whether it has any water at all (water weakens the lithosphere, and rivers wear the land). Nothing
 * of the star, the orbit, the tilt, the day, the air or the amount of water: changing those leaves the land as it is.
 * The land is made against the sea its continents leave room for (`referenceSea`), under rain belts by latitude.
 */
function geologyParams(live: PlanetDefinition, level: number, durationMyr: number): TectonicParams {
  // (Whether there is water at all is read from the amount, whatever share is kept beside it.)
  const def = withWaterGuess(live), x = derive(def), wet = (def.water.depthKm ?? 0) > 0;
  const D = Math.min(durationMyr, def.history.ageGyr * 1000);
  const events = def.history.events
    .filter((e) => TECTONIC_EVENTS.has(e.kind))
    .map((e) => ({ kind: e.kind, start: D - e.startMa, end: D - e.startMa + Math.max(0, e.durationMyr), strength: e.strength, ...(e.at ? { at: e.at } : {}) }))
    .filter((e) => e.end >= 0 && e.start <= D);
  return {
    level, seed: def.seed, radiusKm: def.body.radiusKm, gravity: x.gravity, plates: def.tectonics.plates,
    vigor: def.tectonics.activity * Math.sqrt(Math.max(0, x.heatFlowEarth)), continentalFraction: def.tectonics.continentalFraction,
    oceanFraction: referenceSea(def.tectonics.continentalFraction), regime: x.regime, hotspots: def.tectonics.hotspots, events,
    // (A world with no water wears down far more slowly: wind and frost only.)
    erodibility: wet ? 1 : 0.03, hadleyDeg: 30,
  };
}

/** The present's heights: given (D169), the sea stage's (D258: at the moment asked for), or the history's last picture. */
const presentHeights = (inputs: ProductData, deps: Record<string, ProductData>, n: number): Int16Array => {
  if (inputs.heights) return inputs.heights as Int16Array;
  if (deps.sea) return deps.sea.heights as Int16Array;
  const all = deps.tectonics.heights as Int16Array;
  return all.subarray(all.length - n);
};
/**
 * A stage's dependencies: without the history when the heights are given (D169); with the sea stage in the history's
 * place where the sea follows from the water (D258).
 */
const fromHeights = (p: StageParams, deps: string[]) => (p.heights ? deps.filter((d) => d !== 'tectonics') : p.sea ? deps.map((d) => (d === 'tectonics' ? 'sea' : d)) : deps);
/** A definition with the share of sea its land and water give (D258), for the models that read the share. */
const withSea = (def: PlanetDefinition, share: unknown): PlanetDefinition => (typeof share === 'number' ? { ...def, water: { ...def.water, oceanFraction: share } } : def);
/** The heights given, as an input. */
const givenHeights = (p: StageParams): ProductData => (p.heights ? { heights: p.heights } : {});

/**
 * What the climate reads from a definition (and the water and life stages after it). (Where the sea follows from the
 * water, D258, not the water: its share comes with the land and sea, from the sea stage.)
 */
const climateInputs = (def: PlanetDefinition, p?: StageParams) =>
  ({ star: def.star, orbit: def.orbit, body: def.body, atmosphere: def.atmosphere, ...(p?.sea ? {} : { water: def.water }), history: { ageGyr: def.history.ageGyr, events: [] }, interior: def.interior }) as unknown as ProductData;

/** The climate's product: the temperatures with the months' rain joined in order (D168). */
function joinClimate(parts: ProductData[], deps: Record<string, ProductData>, n: number): ProductData {
  const t = deps.temperature, monthly = t.monthly as Float32Array;
  const h = joinRain(parts as unknown as RainMonths[], monthly, n);
  const annual = new Float32Array(n);
  for (let m = 0; m < 12; m++) for (let c = 0; c < n; c++) annual[c] += h.tempMonthly[m * n + c] / 12;
  return {
    monthly: h.tempMonthly, annual, ice: t.ice, meanK: t.meanK, absorbed: t.absorbed, emitted: t.emitted, tropicsC: t.tropicsC, polesC: t.polesC, years: t.years,
    precipMonthly: h.precipMonthly, precipAnnual: h.precipAnnual, currents: h.currents, windJan: h.windJan, windJul: h.windJul, meanPrecip: h.meanPrecip,
  };
}

const concat = (parts: Float32Array[]): Float32Array => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

export const STAGES: Record<string, StageDef> = {
  /** Everything the physics works out from the definition (instant; kept so other stages can depend on it). */
  derived: {
    id: 'derived',
    version: 1,
    deps: () => [],
    inputs: (def) => {
      const { name: _n, preset: _p, ...rest } = def;
      return rest as unknown as ProductData;
    },
    run: (inputs) => derive(inputs as unknown as PlanetDefinition) as unknown as ProductData,
  },

  /** Sunlight on every cell: the yearly mean and the twelve monthly means. */
  insolation: {
    id: 'insolation',
    version: 1,
    deps: () => [],
    inputs: (def, p) => ({ level: p.level, sunlight: { ...sunlightOf(def, derive(def)) } as unknown as ProductData }),
    parts: (inputs) => cellsAt(inputs.level as number),
    run: (inputs, _deps, ctx, range) => {
      const mesh = meshAt(inputs.level as number);
      const [a, b] = range ?? [0, mesh.n];
      const r = insolationCells(mesh, inputs.sunlight as unknown as Sunlight, a, b);
      ctx.progress(1, 1);
      return { annual: r.annual, monthly: r.monthly, months: 12 };
    },
    join: (parts, inputs) => {
      const n = cellsAt(inputs.level as number), months = 12;
      const monthly = new Float32Array(months * n);
      let start = 0;
      for (const p of parts) {
        const annual = p.annual as Float32Array, mo = p.monthly as Float32Array, len = annual.length;
        for (let m = 0; m < months; m++) monthly.set(mo.subarray(m * len, (m + 1) * len), m * n + start);
        start += len;
      }
      return { annual: concat(parts.map((p) => p.annual as Float32Array)), monthly, months };
    },
  },

  /** The planet's tectonic history: plates, crust and heights through time (a preview at coarse levels). */
  tectonics: {
    id: 'tectonics',
    version: 7,
    deps: () => [],
    inputs: (def, p) => ({
      ...(tectonicParams(def, p.level, p.durationMyr ?? 500) as unknown as ProductData),
      durationMyr: Math.min(p.durationMyr ?? 500, def.history.ageGyr * 1000), frameEveryMyr: p.frameEveryMyr ?? 25,
    }),
    run: (inputs, _deps, ctx) => {
      const { durationMyr, frameEveryMyr, ...params } = inputs;
      // (Going on from an earlier history of the planet where it can: D163.)
      return runHistory(params as unknown as TectonicParams, {
        durationMyr: durationMyr as number, frameEveryMyr: frameEveryMyr as number, onProgress: (d, t) => ctx.progress(d, t),
        base: (ctx.hints?.base as unknown as TectonicHistory | undefined) ?? null,
      }) as unknown as ProductData;
    },
  },

  /**
   * Where the sea stands (D258): the planet's water, an amount, fills the land's hollows from the lowest up, at the
   * present or at one of the history's pictures (`frame`). Gives that moment's heights against its sea (m), the sea's
   * level against the one the history kept (m), and its share of the surface. No water: the lowest ground is the
   * datum, and all of it is land. The land itself is the history's, unchanged whatever the water.
   *
   * The water's fate (D259, physics.ts waterState) is decided here, from the share the seas would cover and the
   * sunlight the planet takes in with them there: where they would boil away, the planet is dry (`fate` 'boiled'),
   * as a planet given no water, unless the water is kept by hand (`kept`). `liquidShare` is the share the seas
   * would cover; `cause`, `absorbed` and `limit` (W/m²) and `withSeasK` are what decided.
   */
  sea: {
    id: 'sea',
    version: 2,
    deps: () => ['tectonics'],
    inputs: (def, p) => ({
      level: p.level, frame: p.frame ?? -1, depthKm: def.water.depthKm ?? 0, keep: !!def.water.keep,
      // (What decides whether seas can stand: the star, the orbit, the planet's body and its air.)
      state: climateInputs(def, { ...p, sea: true }),
      // (The sea's own rises on the timeline: 50 m for each unit of strength while they last.)
      rises: def.history.events.filter((e) => e.kind === 'sea-level').map((e) => [e.startMa, e.durationMyr, e.strength]),
    }),
    run: (inputs, deps, ctx) => {
      const T = deps.tectonics, mesh = meshAt(inputs.level as number), n = mesh.n, area = mesh.area;
      const times = T.times as Float64Array, F = times.length, frame = inputs.frame as number, f = frame < 0 || frame >= F ? F - 1 : frame;
      const H = T.heights as Int16Array, kept = (T.frameSea as Float64Array)[f];
      // The land as it stands (km against the history's datum), then the water over it.
      const h = new Float64Array(n);
      let lowest = Infinity;
      for (let c = 0; c < n; c++) { h[c] = H[f * n + c] / 1000 + kept; if (h[c] < lowest) lowest = h[c]; }
      const depth = inputs.depthKm as number, none = !(depth > 0);
      let level = none ? lowest : seaLevelForVolume(h, area, depth * 4 * Math.PI);
      if (!none) for (const [startMa, lasts, strength] of inputs.rises as number[][]) if (times[f] <= startMa + 1e-9 && times[f] > startMa - lasts - 1e-9) level += 0.05 * Math.max(0, strength);
      const heights = new Int16Array(n);
      const against = (datum: number) => {
        let under = 0;
        for (let c = 0; c < n; c++) {
          heights[c] = Math.max(-32_000, Math.min(32_000, Math.round((h[c] - datum) * 1000)));
          if (heights[c] < 0) under += area[c];
        }
        return Math.min(1, under / (4 * Math.PI));
      };
      // The share the seas would cover, then what becomes of them (D259): boiled away, the planet is dry.
      const liquidShare = against(level);
      const given = definitionOf(inputs.state)!;
      const st = waterState({ ...given, water: { ...given.water, depthKm: depth, ...(inputs.keep ? { keep: true } : {}) } }, none ? 0 : liquidShare);
      const dry = st.fate !== 'liquid';
      if (dry && !none) level = lowest;
      const share = dry ? (none ? liquidShare : against(level)) : liquidShare;
      ctx.progress(1, 1);
      return {
        heights, level: (level - kept) * 1000, share, dry, ma: times[f],
        // (The kind of crust at each place then, for the colour of bare rock: D259.)
        crust: (T.kinds as Uint8Array).slice(f * n, (f + 1) * n),
        fate: st.fate, kept: st.kept, cause: st.cause, liquidShare: none ? 0 : liquidShare, absorbed: st.absorbed, limit: Number.isFinite(st.limit) ? st.limit : 0, withSeasK: st.withSeasK,
      };
    },
  },

  /**
   * The present's temperatures through the year (D157): the seasonal energy balance over the present land and sea of
   * the planet's history, with those heights (for the rain, D168). Reads only what the climate depends on (star,
   * orbit, body, air, water, age), so changing the air re-runs the climate alone.
   */
  temperature: {
    id: 'temperature',
    version: 1,
    // (Where the sea follows from the water, its product also says the surface's mean and the sea's frozen share:
    // those products are asked for under other keys, the sea stage's version being part of them.)
    deps: (p) => fromHeights(p, ['tectonics']),
    inputs: (def, p) => ({ level: p.level, def: climateInputs(def, p), ...givenHeights(p) }),
    run: (inputs, deps, ctx) => {
      const def = withSea(definitionOf(inputs.def)!, deps.sea?.share);
      const mesh = meshAt(inputs.level as number), n = mesh.n;
      const heights = presentHeights(inputs, deps, n);
      // (Where the sea follows from the water, D259: any temperature a planet can have, from the cold of the outer
      // system to rock that melts; and no snow or sea ice on a world with no water.)
      const second: ClimateOptions = {};
      if (deps.sea) {
        second.range = [20, 10_000];
        // (Thin air hardly sets the ground's temperature with height: all of it from about a third of a bar.)
        second.lapseShare = Math.min(1, def.atmosphere.pressureBar / 0.3);
        if (deps.sea.dry) {
          second.frost = false;
          // (No sea: the air's pressure is that at the mean surface, and the temperatures are worked out for there.)
          let mean = 0;
          for (let c = 0; c < n; c++) mean += (heights[c] * mesh.area[c]) / (4 * Math.PI);
          second.datum = mean;
        }
      }
      const r = seasonalClimate(mesh, def, derive(def), heights, second);
      ctx.progress(1, 1);
      // The planet's figures as the pictures have them (D260): the surface's mean temperature over the year (°C; the
      // model's own `meanK` is the sea-level one), and how much of the sea lies frozen for most of the year.
      let surfaceC = 0, seaArea = 0, frozen = 0;
      for (let c = 0; c < n; c++) {
        let t = 0;
        for (let m = 0; m < 12; m++) t += r.monthly[m * n + c] / 12;
        surfaceC += (t * mesh.area[c]) / (4 * Math.PI);
        if (heights[c] < 0) { seaArea += mesh.area[c]; if (r.ice[c] >= SEA_ICE_FROM) frozen += mesh.area[c]; }
      }
      return {
        monthly: r.monthly, dryWarm: r.dryWarm, ice: r.ice, meanK: r.meanK, absorbed: r.absorbed, emitted: r.emitted, tropicsC: r.tropicsC, polesC: r.polesC,
        years: r.years, heights: heights.slice(), ...(deps.sea ? { seaShare: deps.sea.share, surfaceC, seaFrozen: seaArea > 0 && !deps.sea.dry ? frozen / seaArea : 0 } : {}),
      };
    },
  },

  /**
   * The present climate through the year (D157, D158): the temperatures, and the winds, rain and the sea's currents
   * worked out month by month, the months shared among the workers and joined in order (D168: the same product
   * however they are shared).
   */
  climate: {
    id: 'climate',
    version: 3,
    deps: () => ['temperature'],
    inputs: (def, p) => ({ level: p.level, def: climateInputs(def, p) }),
    parts: () => 12,
    partSize: (items, workers) => Math.ceil(items / Math.max(1, Math.min(items, workers))),
    run: (inputs, deps, ctx, range) => {
      const t = deps.temperature, def = withSea(definitionOf(inputs.def)!, t.seaShare), mesh = meshAt(inputs.level as number);
      const [a, b] = range ?? [0, 12];
      const months = Array.from({ length: b - a }, (_, i) => a + i);
      const part = rainMonths(mesh, def, derive(def), t.heights as Int16Array, t.monthly as Float32Array, 4, t.dryWarm as Float32Array, months);
      ctx.progress(1, 1);
      const out = part as unknown as ProductData;
      return range ? out : joinClimate([out], deps, mesh.n);
    },
    join: (parts, inputs, deps) => joinClimate(parts, deps, cellsAt(inputs.level as number)),
  },

  /**
   * Water on the land (D159): ice sheets grown to a steady state in the present climate (on the coarse level), then
   * the water balance, lakes, rivers, wetlands and deltas on the map's level.
   */
  water: {
    id: 'water',
    version: 1,
    deps: (p) => fromHeights(p, ['tectonics', 'climate', 'insolation']),
    inputs: (def, p) => ({ level: p.level, def: climateInputs(def, p), ...givenHeights(p) }),
    run: (inputs, deps, ctx) => {
      const def = withSea(definitionOf(inputs.def)!, deps.sea?.share);
      const level = inputs.level as number, mesh = meshAt(level), n = mesh.n;
      const heights = Float64Array.from(presentHeights(inputs, deps, n));
      const x = derive(def);
      const temp = deps.climate.monthly as Float32Array, precip = deps.climate.precipMonthly as Float32Array;
      // Ice on the coarse level (about 480 km cells on an Earth-sized planet), brought to the map's.
      const iceLevel = Math.min(level, 4), coarse = meshAt(iceLevel);
      const down = (f: ArrayLike<number>) => (level > iceLevel ? toLevel(f, level, iceLevel) : Float64Array.from(f));
      const up = (f: ArrayLike<number>) => (level > iceLevel ? toLevel(f, iceLevel, level) : Float64Array.from(f));
      const monthsDown = (f: Float32Array) => {
        const out = new Float64Array(12 * coarse.n);
        for (let m = 0; m < 12; m++) out.set(down(f.subarray(m * n, (m + 1) * n)), m * coarse.n);
        return out;
      };
      const ice = def.water.oceanFraction > 0 || def.atmosphere.pressureBar > 0
        ? iceSheets({ mesh: coarse, radiusKm: def.body.radiusKm, gravity: x.gravity, bed: down(heights), temp: monthsDown(temp), precip: monthsDown(precip), yearDays: x.yearDays, lapse: x.air.lapse, years: 60_000, dt: 500 })
        : null;
      ctx.progress(1, 2);
      const thickness = ice ? up(ice.thickness) : new Float64Array(n);
      for (let c = 0; c < n; c++) if (thickness[c] < 1) thickness[c] = 0;
      const w = hydrology({
        mesh, radiusKm: def.body.radiusKm, height: heights, temp, precip, sun: deps.insolation.monthly as Float32Array, yearDays: x.yearDays,
        ice: thickness, iceRunoff: ice ? up(ice.runoff) : null, ...(deps.sea?.dry ? { dry: true } : {}),
      });
      ctx.progress(2, 2);
      return {
        runoff: Float32Array.from(w.balance.runoff), pet: Float32Array.from(w.balance.pet), discharge: w.discharge, kind: w.kind, order: w.order, lakeDepth: w.lakeDepth,
        ice: Float32Array.from(thickness), riverMin: w.riverMin, depressions: w.depressions,
        budget: w.budget as unknown as ProductData,
        iceVolume: ice ? ice.volume : 0, iceArea: ice ? ice.area : 0, seaLevelEquivalent: ice ? ice.seaLevelEquivalent : 0, iceYears: ice ? ice.years : 0,
      };
    },
  },

  /**
   * Biomes (D160): the Köppen-Geiger class, the biome (the Earth's rules, or the planet's own where they match) and
   * its colour seen from space, per cell; summer as the six months of most sunlight at each place.
   */
  biomes: {
    id: 'biomes',
    version: 1,
    deps: (p) => fromHeights(p, ['tectonics', 'climate', 'water', 'insolation']),
    inputs: (def, p) => ({ level: p.level, life: def.life as unknown as ProductData, ...givenHeights(p) }),
    run: (inputs, deps, ctx) => {
      const level = inputs.level as number, n = cellsAt(level);
      const life = inputs.life as unknown as PlanetDefinition['life'];
      const heights = presentHeights(inputs, deps, n);
      const temp = deps.climate.monthly as Float32Array, precip = deps.climate.precipMonthly as Float32Array;
      const sun = deps.insolation.monthly as Float32Array;
      const kind = deps.water.kind as Uint8Array, ice = deps.water.ice as Float32Array, pet = deps.water.pet as Float32Array;
      const koppenOut = new Uint8Array(n), biome = new Uint8Array(n), custom = new Uint8Array(n), colour = new Uint8Array(3 * n);
      const rules = life.biomeSet === 'custom' ? [...life.customBiomes].sort((a, b) => a.priority - b.priority) : [];
      const second = !!deps.sea, dry = !!deps.sea?.dry, crust = deps.sea?.crust as Uint8Array | undefined;
      const frozenYear = deps.climate.ice as Float32Array;
      const T = new Float64Array(12), P = new Float64Array(12);
      const place: Place = { temp: T, precip: P, pet: 0, height: 0, water: 0, ice: 0 };
      for (let c = 0; c < n; c++) {
        let most = 0;
        for (let m = 0; m < 12; m++) { T[m] = temp[m * n + c]; P[m] = precip[m * n + c]; if (sun[m * n + c] > sun[most * n + c]) most = m; }
        place.pet = pet[c]; place.height = heights[c]; place.water = kind[c]; place.ice = ice[c];
        // (A world with no water, D258: bare rock everywhere. Where the sea follows from the water, D259, heat alone
        // decides first: molten rock, rock scorched dry, bare ground too hot for anything to grow.)
        let hot = -Infinity;
        for (let m = 0; m < 12; m++) if (T[m] > hot) hot = T[m];
        const first: BiomeId = dry ? 'barren' : biomeOf(place);
        const heat = second && first !== 'sea' && first !== 'lake' ? hotSurface(hot) : null;
        // (The sea frozen over for most of the year, D260: still sea, drawn as ice.)
        // (And a lake frozen for most of the year: ice.)
        const b: BiomeId = heat ?? (second && frozenYear[c] >= SEA_ICE_FROM ? (first === 'sea' ? 'seaIce' : first === 'lake' ? 'ice' : first) : first);
        biome[c] = BIOME_IDS.indexOf(b);
        if (kind[c] !== 1 && !dry) koppenOut[c] = 1 + KOPPEN.findIndex(([k]) => k === koppen(T, P, (most - 2 + 12) % 12));
        const own = rules.length && b !== 'sea' && b !== 'seaIce' && b !== 'lake' && !heat ? customBiomeOf(place, rules) : null;
        let rgb = own ? own.color : b === 'scorched' || b === 'lava' ? rockColour(hot) : biomeColour(b, life);
        if (crust && !own && (b === 'barren' || b === 'scorched' || b === 'lava')) {
          // Bare rock by its crust (D259): the dark basalt of an ocean's floor, the paler rock of continents, as the
          // Moon's dark plains lie among its bright highlands; lost in the rock's own glow as it nears melting.
          const tone = crust[c] === CRUST.oceanic ? 0.76 : crust[c] === CRUST.arc ? 0.9 : 1.08, glow = Math.max(0, Math.min(1, (hot - 650) / 450));
          const f = tone + (1 - tone) * glow;
          rgb = [Math.min(255, Math.round(rgb[0] * f)), Math.min(255, Math.round(rgb[1] * f)), Math.min(255, Math.round(rgb[2] * f))];
        }
        if (own) custom[c] = 1 + rules.indexOf(own);
        colour[3 * c] = rgb[0]; colour[3 * c + 1] = rgb[1]; colour[3 * c + 2] = rgb[2];
      }
      ctx.progress(1, 1);
      return { koppen: koppenOut, biome, custom, colour, customNames: rules.map((r) => r.name) };
    },
  },

  /**
   * What one of the history's pictures (`frame`; −1 or none: the last) shows of its moment's climate and life
   * (D167): worked out from the picture's heights and the climate the history had then (paleo.ts, momentPicture).
   */
  moment: {
    id: 'moment',
    version: 1,
    deps: () => ['tectonics'],
    inputs: (_def, p) => ({ level: p.level, frame: p.frame ?? -1 }),
    run: (inputs, deps, ctx) => {
      const T = deps.tectonics, mesh = meshAt(inputs.level as number), n = mesh.n;
      const params = T.params as unknown as TectonicParams, times = T.times as Float64Array, F = times.length;
      if (!params.climate || !T.frameWarm) throw new Error('This history keeps no climate of its moments.');
      const frame = inputs.frame as number, f = frame < 0 || frame >= F ? F - 1 : frame;
      const height = (T.heights as Int16Array).slice(f * n, (f + 1) * n), warm = (T.frameWarm as Float64Array[])[f];
      const p = momentPicture(mesh, height, params.climate, (T.frameCo2 as Float64Array)[f], warm.length ? warm : null);
      ctx.progress(1, 1);
      return { biome: p.biome, temp: p.temp, rain: p.rain, season: p.season, height, ma: times[f] };
    },
  },

  /**
   * The land's colours seen from space as a picture (RGBA, smooth between cells): a map's satellite look (D160); at
   * one of the history's earlier pictures (`frame` 0 or more, D167), that moment's own biomes.
   */
  cover: {
    id: 'cover',
    version: 2,
    // (Where the sea follows from the water, D258, the biomes are worked out at any moment: no stand-in for the past.)
    deps: (p) => ((p.frame ?? -1) >= 0 && !p.sea ? ['moment'] : ['biomes']),
    inputs: (def, p) => ({
      level: p.level, width: p.width ?? 1024, height: p.height ?? 512,
      ...((p.frame ?? -1) >= 0 && !p.sea ? { frame: p.frame!, life: def.life as unknown as ProductData } : {}),
      ...(p.land ? { land: true } : {}),
    }),
    run: (inputs, deps, ctx) => {
      const mesh = meshAt(inputs.level as number), n = mesh.n, w = inputs.width as number, h = inputs.height as number;
      const colour = inputs.frame !== undefined
        ? momentColours(deps.moment as unknown as Moment, inputs.life as unknown as PlanetDefinition['life'])
        : deps.biomes.colour as Uint8Array;
      const out = new Uint8Array(4 * w * h);
      // The land alone (D257): each pixel's colour from the land cells round it only, weighted as they are near, and
      // in its alpha how much of them is land; the sea's dark colour never reaches a shore.
      const biome = (inputs.frame !== undefined ? deps.moment.biome : deps.biomes.biome) as Uint8Array;
      const sea = BIOME_IDS.indexOf('sea'), seaColour = BIOME.sea.colour;
      const share = inputs.land ? rasterize(mesh, Float32Array.from(biome, (b) => (b === sea ? 0 : 1)), w, h) : null;
      for (let k = 0; k < 3; k++) {
        const ch = new Float32Array(n);
        for (let c = 0; c < n; c++) ch[c] = share && biome[c] === sea ? 0 : colour[3 * c + k];
        const r = rasterize(mesh, ch, w, h);
        for (let i = 0; i < w * h; i++) out[4 * i + k] = Math.max(0, Math.min(255, Math.round(share ? (share[i] > 1e-3 ? r[i] / share[i] : seaColour[k]) : r[i])));
      }
      for (let i = 0; i < w * h; i++) out[4 * i + 3] = share ? Math.max(0, Math.min(255, Math.round(255 * share[i]))) : 255;
      ctx.progress(1, 1);
      return { pixels: out, width: w, height: h };
    },
  },

  /** A picture of a layer: the field drawn on an equirectangular grid, with its range. */
  raster: {
    id: 'raster',
    version: 3,
    // (An earlier moment of a layer the history's pictures show, from the history alone: D167.)
    deps: (p) => [p.sea ? layerStage(p.layer ?? 'insolation') : pastOf(p) ? 'moment' : LAYERS[p.layer ?? 'insolation'].stage],
    inputs: (_def, p) => ({
      level: p.level, width: p.width ?? 512, height: p.height ?? 256, layer: p.layer ?? 'insolation', frame: p.frame ?? -1,
      ...(p.sea ? { sea: true, month: p.month ?? 0 } : {}),
    }),
    run: (inputs, deps, ctx) => {
      const layer = LAYERS[inputs.layer as LayerId], past = PAST_FIELDS[inputs.layer as LayerId];
      const mesh = meshAt(inputs.level as number), n = mesh.n;
      let field: Float32Array | Int16Array | Uint8Array | Int8Array | Uint16Array;
      if (inputs.sea) {
        // (D258) The heights against the sea are the sea stage's, at the moment asked for; the climate, water and life
        // layers are that moment's own already; the history's own layers by moment, the monthly ones by month.
        const stage = layerStage(inputs.layer as LayerId);
        field = deps[stage][stage === 'sea' ? 'heights' : layer.field] as Float32Array | Int16Array | Uint8Array;
        if (layer.frames && stage !== 'sea') {
          const frames = field.length / n, f = (stage === 'tectonics' ? inputs.frame : inputs.month) as number;
          const k = f < 0 || f >= frames ? frames - 1 : f;
          field = field.subarray(k * n, (k + 1) * n);
        }
      } else if (past && (inputs.frame as number) >= 0) field = deps.moment[past] as Uint8Array | Int8Array | Uint16Array;
      else {
        field = deps[layer.stage][layer.field] as Float32Array | Int16Array | Uint8Array;
        if (layer.frames) {
          const frames = field.length / n, f = inputs.frame as number;
          const k = f < 0 || f >= frames ? frames - 1 : f;
          field = field.subarray(k * n, (k + 1) * n);
        }
      }
      const w = inputs.width as number, h = inputs.height as number;
      const raster = layer.categories ? rasterizeNearest(mesh, field, w, h, new Float32Array(w * h)) : rasterize(mesh, field, w, h);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < raster.length; i++) { const v = raster[i]; if (v < min) min = v; if (v > max) max = v; }
      ctx.progress(1, 1);
      return { raster, width: w, height: h, min, max, unit: layer.unit };
    },
  },
};
