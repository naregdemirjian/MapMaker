// The planetary engine's stages (Stage 14, D152): each makes a product from a slice of the planet's definition and
// the products of the stages it uses. A product's key is a hash of exactly that (the stage, its version, the
// engine's version, its inputs and its dependencies' keys), so changing a setting re-runs only the stages that
// read it, and anything already made for the same inputs is reused (scheduler.ts).
//
// The same registry runs in the interface (to work out inputs and keys, and to join parts) and in the workers (to
// run stages). A stage that works cell by cell can be run in parts: fixed ranges of cells, whatever the number of
// workers, joined in order, so the result is the same bytes on one worker or on many.
import { definitionOf, type PlanetDefinition } from '../model/definition.ts';
import { seasonalClimate } from '../climate/ebm.ts';
import { hydroclimate } from '../climate/hydroclimate.ts';
import { hydrology } from '../water/hydrology.ts';
import { iceSheets } from '../water/ice.ts';
import { BIOME_IDS, KOPPEN, biomeColour, biomeOf, customBiomeOf, koppen, type Place } from '../life/biomes.ts';
import { toLevel } from '../mesh/transfer.ts';
import { derive } from '../model/physics.ts';
import { cellsAt, meshAt } from '../mesh/icosphere.ts';
import { rasterize } from '../mesh/transfer.ts';
import { insolationCells, sunlightOf, type Sunlight } from '../climate/insolation.ts';
import { rasterizeNearest } from '../mesh/transfer.ts';
import { runHistory } from '../tectonics/history.ts';
import type { TectonicParams } from '../tectonics/state.ts';
import type { FieldArray } from '../state/codec.ts';

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
}

export type ProductValue = FieldArray | number | string | boolean | null | ProductValue[] | { [k: string]: ProductValue };
export type ProductData = { [k: string]: ProductValue };

export interface StageContext {
  progress(done: number, total: number): void;
}

export interface StageDef {
  id: string;
  version: number;
  deps(params: StageParams): string[];
  /** What the stage reads: only this (and its dependencies' keys) decides its product. */
  inputs(def: PlanetDefinition, params: StageParams): ProductData;
  /** How many items (cells) it can be run in parts over, if it can. */
  parts?(inputs: ProductData): number;
  run(inputs: ProductData, deps: Record<string, ProductData>, ctx: StageContext, range?: [number, number]): ProductData | Promise<ProductData>;
  /** Joins the parts' products, in order. */
  join?(parts: ProductData[], inputs: ProductData): ProductData;
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
  koppen: { stage: 'biomes', field: 'koppen', unit: '', label: 'Köppen-Geiger climates', frames: false, categories: true },
  biome: { stage: 'biomes', field: 'biome', unit: '', label: 'Biomes', frames: false, categories: true },
  boundaries: { stage: 'tectonics', field: 'boundary', unit: '', label: 'Plate boundaries', frames: false, categories: true },
} as const;
export type LayerId = keyof typeof LAYERS;

/** What the tectonic history reads from a definition, for a history of `durationMyr` ending at the present. */
export function tectonicParams(def: PlanetDefinition, level: number, durationMyr = 500): TectonicParams {
  const x = derive(def);
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
    climate: { star: def.star, orbit: def.orbit, body: def.body, atmosphere: def.atmosphere, water: def.water, history: { ageGyr: def.history.ageGyr, events: [] }, interior: def.interior },
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
    version: 4,
    deps: () => [],
    inputs: (def, p) => ({
      ...(tectonicParams(def, p.level, p.durationMyr ?? 500) as unknown as ProductData),
      durationMyr: Math.min(p.durationMyr ?? 500, def.history.ageGyr * 1000), frameEveryMyr: p.frameEveryMyr ?? 25,
    }),
    run: (inputs, _deps, ctx) => {
      const { durationMyr, frameEveryMyr, ...params } = inputs;
      return runHistory(params as unknown as TectonicParams, {
        durationMyr: durationMyr as number, frameEveryMyr: frameEveryMyr as number, onProgress: (d, t) => ctx.progress(d, t),
      }) as unknown as ProductData;
    },
  },

  /**
   * The present climate through the year (D157): the seasonal energy balance over the present land and sea of the
   * planet's history. Reads only what the climate depends on (star, orbit, body, air, water, age), so changing the
   * air re-runs the climate alone.
   */
  climate: {
    id: 'climate',
    version: 2,
    deps: () => ['tectonics'],
    inputs: (def, p) => ({
      level: p.level,
      def: { star: def.star, orbit: def.orbit, body: def.body, atmosphere: def.atmosphere, water: def.water, history: { ageGyr: def.history.ageGyr, events: [] }, interior: def.interior } as unknown as ProductData,
    }),
    run: (inputs, deps, ctx) => {
      const def = definitionOf(inputs.def)!;
      const mesh = meshAt(inputs.level as number), n = mesh.n;
      const all = deps.tectonics.heights as Int16Array;
      const heights = all.subarray(all.length - n);
      const x = derive(def);
      const r = seasonalClimate(mesh, def, x, heights);
      ctx.progress(1, 2);
      // Winds, rain and the sea's currents (D158); the currents' warmth goes into the temperatures.
      const h = hydroclimate(mesh, def, x, heights, r.monthly, 4, r.dryWarm);
      const annual = new Float32Array(n);
      for (let m = 0; m < 12; m++) for (let c = 0; c < n; c++) annual[c] += h.tempMonthly[m * n + c] / 12;
      ctx.progress(2, 2);
      return {
        monthly: h.tempMonthly, annual, ice: r.ice, meanK: r.meanK, absorbed: r.absorbed, emitted: r.emitted, tropicsC: r.tropicsC, polesC: r.polesC, years: r.years,
        precipMonthly: h.precipMonthly, precipAnnual: h.precipAnnual, currents: h.currents, windJan: h.windJan, windJul: h.windJul, meanPrecip: h.meanPrecip,
      };
    },
  },

  /**
   * Water on the land (D159): ice sheets grown to a steady state in the present climate (on the coarse level), then
   * the water balance, lakes, rivers, wetlands and deltas on the map's level.
   */
  water: {
    id: 'water',
    version: 1,
    deps: () => ['tectonics', 'climate', 'insolation'],
    inputs: (def, p) => ({
      level: p.level,
      def: { star: def.star, orbit: def.orbit, body: def.body, atmosphere: def.atmosphere, water: def.water, history: { ageGyr: def.history.ageGyr, events: [] }, interior: def.interior } as unknown as ProductData,
    }),
    run: (inputs, deps, ctx) => {
      const def = definitionOf(inputs.def)!;
      const level = inputs.level as number, mesh = meshAt(level), n = mesh.n;
      const all = deps.tectonics.heights as Int16Array;
      const heights = Float64Array.from(all.subarray(all.length - n));
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
        ice: thickness, iceRunoff: ice ? up(ice.runoff) : null,
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
    deps: () => ['tectonics', 'climate', 'water', 'insolation'],
    inputs: (def, p) => ({ level: p.level, life: def.life as unknown as ProductData }),
    run: (inputs, deps, ctx) => {
      const level = inputs.level as number, n = cellsAt(level);
      const life = inputs.life as unknown as PlanetDefinition['life'];
      const all = deps.tectonics.heights as Int16Array, heights = all.subarray(all.length - n);
      const temp = deps.climate.monthly as Float32Array, precip = deps.climate.precipMonthly as Float32Array;
      const sun = deps.insolation.monthly as Float32Array;
      const kind = deps.water.kind as Uint8Array, ice = deps.water.ice as Float32Array, pet = deps.water.pet as Float32Array;
      const koppenOut = new Uint8Array(n), biome = new Uint8Array(n), custom = new Uint8Array(n), colour = new Uint8Array(3 * n);
      const rules = life.biomeSet === 'custom' ? [...life.customBiomes].sort((a, b) => a.priority - b.priority) : [];
      const T = new Float64Array(12), P = new Float64Array(12);
      const place: Place = { temp: T, precip: P, pet: 0, height: 0, water: 0, ice: 0 };
      for (let c = 0; c < n; c++) {
        let most = 0;
        for (let m = 0; m < 12; m++) { T[m] = temp[m * n + c]; P[m] = precip[m * n + c]; if (sun[m * n + c] > sun[most * n + c]) most = m; }
        place.pet = pet[c]; place.height = heights[c]; place.water = kind[c]; place.ice = ice[c];
        const b = biomeOf(place);
        biome[c] = BIOME_IDS.indexOf(b);
        if (kind[c] !== 1) koppenOut[c] = 1 + KOPPEN.findIndex(([k]) => k === koppen(T, P, (most - 2 + 12) % 12));
        const own = rules.length && b !== 'sea' && b !== 'lake' ? customBiomeOf(place, rules) : null;
        const rgb = own ? own.color : biomeColour(b, life);
        if (own) custom[c] = 1 + rules.indexOf(own);
        colour[3 * c] = rgb[0]; colour[3 * c + 1] = rgb[1]; colour[3 * c + 2] = rgb[2];
      }
      ctx.progress(1, 1);
      return { koppen: koppenOut, biome, custom, colour, customNames: rules.map((r) => r.name) };
    },
  },

  /** The land's colours seen from space as a picture (RGBA, smooth between cells): a map's satellite look (D160). */
  cover: {
    id: 'cover',
    version: 1,
    deps: () => ['biomes'],
    inputs: (_def, p) => ({ level: p.level, width: p.width ?? 1024, height: p.height ?? 512 }),
    run: (inputs, deps, ctx) => {
      const mesh = meshAt(inputs.level as number), n = mesh.n, w = inputs.width as number, h = inputs.height as number;
      const colour = deps.biomes.colour as Uint8Array, out = new Uint8Array(4 * w * h);
      for (let k = 0; k < 3; k++) {
        const ch = new Float32Array(n);
        for (let c = 0; c < n; c++) ch[c] = colour[3 * c + k];
        const r = rasterize(mesh, ch, w, h);
        for (let i = 0; i < w * h; i++) out[4 * i + k] = Math.max(0, Math.min(255, Math.round(r[i])));
      }
      for (let i = 0; i < w * h; i++) out[4 * i + 3] = 255;
      ctx.progress(1, 1);
      return { pixels: out, width: w, height: h };
    },
  },

  /** A picture of a layer: the field drawn on an equirectangular grid, with its range. */
  raster: {
    id: 'raster',
    version: 2,
    deps: (p) => [LAYERS[p.layer ?? 'insolation'].stage],
    inputs: (_def, p) => ({ level: p.level, width: p.width ?? 512, height: p.height ?? 256, layer: p.layer ?? 'insolation', frame: p.frame ?? -1 }),
    run: (inputs, deps, ctx) => {
      const layer = LAYERS[inputs.layer as LayerId];
      const mesh = meshAt(inputs.level as number), n = mesh.n;
      let field = deps[layer.stage][layer.field] as Float32Array | Int16Array | Uint8Array;
      if (layer.frames) {
        const frames = field.length / n, f = inputs.frame as number;
        const k = f < 0 || f >= frames ? frames - 1 : f;
        field = field.subarray(k * n, (k + 1) * n);
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
