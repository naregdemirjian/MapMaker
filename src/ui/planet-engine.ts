// The interface's side of the planetary engine (Stage 14, D152): one pipeline whose stages run in a pool of
// workers (dist/ui/planet-worker.js), made when first needed. The Planet Studio (14.5) asks it for products;
// the interface tests ask it through __mapmaker.bench.planet.
import { WorkerPool, type WorkerLike } from '../planet/worker/pool.ts';
import { Pipeline } from '../planet/pipeline/scheduler.ts';
import { definitionFromPreset, PRESETS, type PlanetDefinition, type PresetId } from '../planet/model/definition.ts';
import { derive } from '../planet/model/physics.ts';
import { sha256 } from '../planet/state/hash.ts';
import type { LayerId } from '../planet/pipeline/stages.ts';

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
async function preview(def: PlanetDefinition | PresetId, opts: { level?: number; width?: number; height?: number; layer?: LayerId; workers?: number } = {}): Promise<PreviewResult> {
  const d = typeof def === 'string' ? definitionFromPreset(def) : def;
  const own = opts.workers ? new Pipeline(new WorkerPool(newWorker, opts.workers)) : null;
  const p = own ?? planetPipeline();
  try {
    const width = opts.width ?? 256, height = opts.height ?? 128;
    const r = await p.product('raster', d, { level: opts.level ?? 5, width, height, layer: opts.layer ?? 'insolation' });
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
