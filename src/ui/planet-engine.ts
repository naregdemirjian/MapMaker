// The interface's side of the planetary engine (Stage 14, D152): one pipeline whose stages run in a pool of
// workers (dist/ui/planet-worker.js), made when first needed. The Planet Studio (14.5) asks it for products;
// the interface tests ask it through __mapmaker.bench.planet.
import { WorkerPool, type WorkerLike } from '../planet/worker/pool.ts';
import { Pipeline } from '../planet/pipeline/scheduler.ts';
import { definitionFromPreset, PRESETS, type PlanetDefinition, type PresetId } from '../planet/model/definition.ts';
import { derive } from '../planet/model/physics.ts';
import { sha256 } from '../planet/state/hash.ts';
import type { LayerId, StageParams } from '../planet/pipeline/stages.ts';
import type { PaleoSet } from '../terrain/paleo.ts';
import type { ElevationGrid } from '../terrain/grid.ts';

/** Workers for a pool: one fewer than the processor's threads (the interface keeps one), from one to eight. */
export const defaultWorkers = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));

const newWorker = (): WorkerLike => new Worker(new URL('planet-worker.js', document.baseURI), { type: 'module' }) as unknown as WorkerLike;

let shared: Pipeline | null = null;

/** The interface's pipeline (its cache is kept while the page is open). */
export function planetPipeline(): Pipeline {
  if (!shared) shared = new Pipeline(new WorkerPool(newWorker, defaultWorkers()));
  return shared;
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
export const planetBench = { preview, derive, definitionFromPreset, presets: Object.keys(PRESETS) as PresetId[] };

/** The mesh level for a definition's quality: a preview (about 240 km cells on an Earth-sized planet) or standard (110 km). */
export const simLevel = (def: PlanetDefinition) => (def.simulation.quality === 'preview' ? 5 : 6);

/** What a simulated planet's history is run with (D156): its level, the last `spanMyr` of it, a picture every 25 Myr. */
export function simParams(def: PlanetDefinition): StageParams {
  return { level: simLevel(def), durationMyr: Math.min(def.simulation.spanMyr ?? 500, def.history.ageGyr * 1000), frameEveryMyr: 25 };
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

/** A simulated planet's land seen from space today (D160): its biomes' colours, laid like its heights' pictures. */
export async function simCover(def: PlanetDefinition, opts: { signal?: AbortSignal } = {}): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const r = await planetPipeline().product('cover', def, { ...simParams(def), width: SIM_WIDTH, height: SIM_HEIGHT }, { signal: opts.signal });
  return { width: r.data.width as number, height: r.data.height as number, pixels: r.data.pixels as Uint8Array };
}
