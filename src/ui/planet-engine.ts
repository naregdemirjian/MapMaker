// The interface's side of the planetary engine (Stage 14, D152): one pipeline whose stages run in a pool of
// workers (dist/ui/planet-worker.js), made when first needed. The Planet Studio (14.5) asks it for products;
// the interface tests ask it through __mapmaker.bench.planet.
import { WorkerPool, type Executor, type WorkerLike } from '../planet/worker/pool.ts';
import { adoptFoundation, decodeFoundation, encodeFoundation, foundationKey, gatherFoundation } from '../planet/foundation.ts';
import { deflateInBrowser, inflateInBrowser } from '../planet/state/codec.ts';
import { Api } from './api.ts';
import { Pipeline } from '../planet/pipeline/scheduler.ts';
import { definitionFromPreset, newDefinition, PRESETS, type PlanetDefinition, type PresetId } from '../planet/model/definition.ts';
import { derive } from '../planet/model/physics.ts';
import { sha256 } from '../planet/state/hash.ts';
import type { LayerId, StageParams } from '../planet/pipeline/stages.ts';
import type { PaleoSet } from '../terrain/paleo.ts';
import type { CoverSet } from '../terrain/cover.ts';
import { keyOf } from '../planet/state/hash.ts';
import { meshAt } from '../planet/mesh/icosphere.ts';
import { sampleGrid } from '../planet/mesh/transfer.ts';
import { climateOf } from '../terrain/biomes.ts';
import type { PlanetParams } from '../terrain/planet.ts';
import type { ElevationGrid } from '../terrain/grid.ts';

/** Workers for a pool: one fewer than the processor's threads (the interface keeps one), from one to eight. */
export const defaultWorkers = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));

export const newWorker = (): WorkerLike => new Worker(new URL('planet-worker.js', document.baseURI), { type: 'module' }) as unknown as WorkerLike;

let shared: Pipeline | null = null;
/** How many times each stage has been run by the interface's pipeline since the page opened (for the tests, D269). */
const stageRuns = new Map<string, number>();

/** The interface's pipeline (its cache is kept while the page is open). */
export function planetPipeline(): Pipeline {
  if (!shared) {
    const pool = new WorkerPool(newWorker, defaultWorkers());
    const counted: Executor = {
      get size() { return pool.size; },
      run: (task, args, opts) => { const stage = (args as { stage?: string }).stage ?? task; stageRuns.set(stage, (stageRuns.get(stage) ?? 0) + 1); return pool.run(task, args, opts); },
      dispose: () => pool.dispose(),
    };
    shared = new Pipeline(counted);
  }
  return shared;
}

/** The project whose planets' foundations are read and kept (D269): set by the store as a project opens and closes. */
let foundationProject: string | null = null;
export const setFoundationProject = (id: string | null): void => { foundationProject = id; };
/** What became of a planet's foundation when it was last asked for, by its key: read from the project, or made (and kept). */
const foundationFrom = new Map<string, 'kept' | 'made'>();

/** What became of a planet's foundation this session (D269): read from the project, made (and kept), or not asked for yet. */
export const foundationState = (def: PlanetDefinition): 'kept' | 'made' | null => (def.engine === 2 ? foundationFrom.get(foundationKey(def, simParams(def))) ?? null : null);

/**
 * A simulated planet's foundation (D269), for a planet of the second calculation: what was worked out for it at
 * every point. Read from the project where it is kept there (the planet is then as it was made, with nothing
 * simulated); otherwise made, given to the pipeline so that it stays, and kept with the project for next time.
 */
export async function simFoundation(def: PlanetDefinition, opts: { onProgress?: (share: number) => void; signal?: AbortSignal } = {}): Promise<'kept' | 'made' | 'none'> {
  if (def.engine !== 2) return 'none';
  const p = planetPipeline(), params = simParams(def), key = foundationKey(def, params), project = foundationProject;
  if (p.hasAdopted(key)) return foundationFrom.get(key) ?? 'kept';
  if (project) {
    try {
      const bytes = await Api.foundation(project, key);
      if (bytes) {
        adoptFoundation(p, def, params, await decodeFoundation(bytes, inflateInBrowser));
        foundationFrom.set(key, 'kept');
        return 'kept';
      }
    } catch { /* (Unreadable or damaged: made anew below, and written over.) */ }
  }
  const f = await gatherFoundation(p, def, params, { signal: opts.signal, onProgress: (d, t) => opts.onProgress?.(d / Math.max(1, t)) });
  adoptFoundation(p, def, params, f);
  foundationFrom.set(key, 'made');
  if (project) void encodeFoundation(f, deflateInBrowser).then((bytes) => Api.saveFoundation(project, key, bytes)).catch(() => undefined);
  return 'made';
}

export interface PreviewResult {
  key: string;
  width: number;
  height: number;
  min: number;
  max: number;
  /** Values at the middle of the equator and at the north pole's row. */
  equator: number;
  pole: number;
  /** The picture's values, as SHA-256 of their bytes (to compare runs). */
  hash: string;
  cached: boolean;
  ms: number;
  workers: number;
}

/** A picture of a layer of a planet (for the tests: a stage run in workers from the interface). */
async function preview(def: PlanetDefinition | PresetId, opts: { level?: number; width?: number; height?: number; layer?: LayerId; workers?: number; frame?: number; durationMyr?: number; frameEveryMyr?: number } = {}): Promise<PreviewResult> {
  const d = typeof def === 'string' ? definitionFromPreset(def) : def;
  const own = opts.workers ? new Pipeline(new WorkerPool(newWorker, opts.workers)) : null;
  const p = own ?? planetPipeline();
  try {
    const width = opts.width ?? 256, height = opts.height ?? 128;
    const r = await p.product('raster', d, {
      level: opts.level ?? 5, width, height, layer: opts.layer ?? 'insolation',
      ...(opts.frame !== undefined ? { frame: opts.frame } : {}), ...(opts.durationMyr !== undefined ? { durationMyr: opts.durationMyr } : {}),
      ...(opts.frameEveryMyr !== undefined ? { frameEveryMyr: opts.frameEveryMyr } : {}),
    });
    const raster = r.data.raster as Float32Array;
    return {
      key: r.key, width, height, min: r.data.min as number, max: r.data.max as number,
      equator: raster[(height >> 1) * width + (width >> 1)], pole: raster[width >> 1],
      hash: sha256(new Uint8Array(raster.buffer, raster.byteOffset, raster.byteLength)), cached: r.cached, ms: r.ms, workers: p.executor.size,
    };
  } finally {
    own?.executor.dispose();
  }
}

/** What the interface tests and benchmarks use. */
export const planetBench = {
  preview, derive, definitionFromPreset, newDefinition, presets: Object.keys(PRESETS) as PresetId[],
  /** (D269) How many times each stage has been run since the page opened; what became of a planet's foundation. */
  runs: (): Record<string, number> => Object.fromEntries(stageRuns),
  foundation: (def: PlanetDefinition): { key: string; from: 'kept' | 'made' | null } => { const key = foundationKey(def, simParams(def)); return { key, from: foundationFrom.get(key) ?? null }; },
  /** The planet as the pipeline has it, in three checksums: its heights against its sea, its colours seen from space, its temperatures by month. */
  digest: async (def: PlanetDefinition): Promise<{ heights: string; colour: string; temperature: string }> => {
    const p = planetPipeline(), params = simParams(def), sum = (a: unknown) => { const v = a as Uint8Array; return sha256(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); };
    return { heights: sum((await p.product('sea', def, params)).data.heights), colour: sum((await p.product('biomes', def, params)).data.colour), temperature: sum((await p.product('climate', def, params)).data.monthly) };
  },
};

/** The mesh level for a definition's quality: a preview (about 240 km cells on an Earth-sized planet) or standard (110 km). */
export const simLevel = (def: PlanetDefinition) => (def.engine === 2 || def.simulation.quality === 'preview' ? 5 : 6);

/** What a simulated planet's history is run with (D156): its level, the last `spanMyr` of it, a picture every 25 Myr. */
export function simParams(def: PlanetDefinition): StageParams {
  // (Where the sea follows from the planet's water, D258: one detail for every planet, the land and sea from the sea stage.)
  return { level: simLevel(def), durationMyr: Math.min(def.simulation.spanMyr ?? 500, def.history.ageGyr * 1000), frameEveryMyr: 25, ...(def.engine === 2 ? { sea: true } : {}) };
}

/** The size of the pictures a map of a simulated planet draws its land and sea from. */
export const SIM_WIDTH = 1024, SIM_HEIGHT = 512;

/**
 * A simulated planet's land and sea through its history (D156), kept as the maps of the Earth through time are
 * (D134): its heights every 25 million years, youngest first, each relative to the sea of its moment, blended
 * between. Made in workers from the planet's definition (the same every time); `key` names the history.
 */
export async function simTerrain(def: PlanetDefinition, opts: { onProgress?: (share: number) => void; signal?: AbortSignal } = {}): Promise<{ set: PaleoSet; key: string }> {
  const p = planetPipeline();
  const params = simParams(def);
  const key = p.keyOf('tectonics', def, params);
  // (D269) Its foundation first: read from the project where kept, else made and kept (the history is part of it).
  await simFoundation(def, { signal: opts.signal, onProgress: (share) => opts.onProgress?.(0.85 * share) });
  const history = await p.product('tectonics', def, params, { signal: opts.signal, onProgress: (d, t) => opts.onProgress?.((0.85 * d) / Math.max(1, t)) });
  const times = history.data.times as Float64Array, F = times.length;
  const grids: ElevationGrid[] = new Array(F);
  let done = 0;
  // Every picture at once (the pool shares them out); youngest first.
  await Promise.all(Array.from({ length: F }, async (_, i) => {
    const f = F - 1 - i;
    const r = await p.product('raster', def, { ...params, width: SIM_WIDTH, height: SIM_HEIGHT, layer: 'elevation', frame: f }, { signal: opts.signal });
    const src = r.data.raster as Float32Array, data = new Int16Array(src.length);
    for (let k = 0; k < src.length; k++) data[k] = Math.max(-32_000, Math.min(32_000, Math.round(src[k])));
    grids[i] = { width: SIM_WIDTH, height: SIM_HEIGHT, step: 1, data };
    opts.onProgress?.(0.85 + (0.15 * ++done) / F);
  }));
  const ages = Array.from({ length: F }, (_, i) => times[F - 1 - i]);
  const labels = ages.map((a) => (a === 0 ? 'Today' : `${a.toLocaleString('en')} million years ago`));
  return { set: { ages, labels, grids }, key };
}

/**
 * A simulated planet's land seen from space (D160): its biomes' colours, laid like its heights' pictures; today's
 * (frame −1, the default), or at one of its history's earlier pictures, that moment's own (D167).
 */
export async function simCover(def: PlanetDefinition, opts: { frame?: number; signal?: AbortSignal } = {}): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const frame = opts.frame ?? -1;
  const r = await planetPipeline().product('cover', def, { ...simParams(def), width: SIM_WIDTH, height: SIM_HEIGHT, ...(frame >= 0 ? { frame } : {}) }, { signal: opts.signal });
  return { width: r.data.width as number, height: r.data.height as number, pixels: r.data.pixels as Uint8Array };
}

/**
 * The frame of a simulated planet's history whose cover is the `i`th of its pictures as the maps keep them (youngest
 * first, D156): −1 for today, then the history's pictures from the latest back.
 */
export const simCoverFrame = (i: number, pictures: number) => (i === 0 ? -1 : pictures - 1 - i);

/** A simulated planet's land seen from space at every picture of its history (D167), youngest first; `key` names them. */
export async function simCovers(def: PlanetDefinition, ages: number[], opts: { signal?: AbortSignal } = {}): Promise<CoverSet> {
  const key = `sim-cover:${keyOf({ def, params: simParams(def) })}`;
  const covers = await Promise.all(ages.map(async (_, i) => ({ ...(await simCover(def, { frame: simCoverFrame(i, ages.length), signal: opts.signal })), key: `${key}:${i}` })));
  return { ages, covers, key };
}

/** The level a generated planet's colours are worked out at by the climate models (D169: about 240 km cells on an Earth-sized planet). */
export const QUICK_LEVEL = 5;

/**
 * The definition a generated planet's colours are worked out from by the simulated planets' models (D169): the
 * Earth-like preset sized as the planet, with its sea's share, and warmer or colder as its climate (D100) says (about
 * 3 °C for each doubling of the air's carbon dioxide); null for a world without life (its bare ground keeps its own
 * colours).
 */
export function quickPlanetDefinition(params: PlanetParams, radiusKm: number, oceanFraction: number): PlanetDefinition | null {
  const c = climateOf(params);
  if (c.barren) return null;
  const def = definitionFromPreset('earthlike', params.seed);
  def.name = 'Generated planet';
  def.body.radiusKm = Math.max(500, Math.min(20_000, radiusKm));
  def.water.oceanFraction = Math.max(0.01, Math.min(0.99, oceanFraction));
  def.atmosphere.co2 *= 2 ** (c.warmth / 3);
  return def;
}

/**
 * A generated planet's land seen from space by the simulated planets' climate, water and biome models on its own
 * heights (D169), drawn at half its heights' size; null for a world without life.
 */
export async function quickPlanetCover(params: PlanetParams, radiusKm: number, grid: ElevationGrid, opts: { signal?: AbortSignal } = {}): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
  const mesh = meshAt(QUICK_LEVEL), h = sampleGrid(mesh, grid.data, grid.width, grid.height, grid.step);
  const heights = new Int16Array(mesh.n);
  let sea = 0;
  for (let c = 0; c < mesh.n; c++) { heights[c] = Math.max(-32_000, Math.min(32_000, Math.round(h[c]))); if (heights[c] < 0) sea += mesh.area[c]; }
  const def = quickPlanetDefinition(params, radiusKm, sea / (4 * Math.PI));
  if (!def) return null;
  const r = await planetPipeline().product('cover', def, { level: QUICK_LEVEL, heights, width: Math.max(64, grid.width >> 1), height: Math.max(32, grid.height >> 1) }, { signal: opts.signal });
  return { width: r.data.width as number, height: r.data.height as number, pixels: r.data.pixels as Uint8Array };
}
