// Making the planetary engine's products (Stage 14, D152): works out each stage's key from what it reads, reuses
// what is already made, runs what is missing (its dependencies first) on an executor (a pool of workers or this
// thread), in parts where a stage allows it, and keeps the results in a cache bounded by their size.
import type { PlanetDefinition } from '../model/definition.ts';
import { keyOf } from '../state/hash.ts';
import { transferablesOf } from '../worker/protocol.ts';
import type { Executor, RunOptions } from '../worker/pool.ts';
import { ENGINE_VERSION, STAGES, type ProductData, type StageParams } from './stages.ts';

/** Cells per part when a stage runs in parts: fixed, so the parts (and the result) never depend on the workers. */
export const PART_SIZE = 8192;

export interface Product {
  key: string;
  stage: string;
  data: ProductData;
  /** Reused from the cache rather than made now. */
  cached: boolean;
  /** How long making it took (0 when cached), ms. */
  ms: number;
}

/** Products by key, the least recently used dropped first once they hold more than `budget` bytes. */
export class ProductCache {
  private items = new Map<string, { data: ProductData; bytes: number }>();
  private total = 0;
  readonly budget: number;
  constructor(budget = 256 * 2 ** 20) { this.budget = budget; }
  get(key: string): ProductData | undefined {
    const it = this.items.get(key);
    if (!it) return undefined;
    this.items.delete(key);
    this.items.set(key, it);
    return it.data;
  }
  set(key: string, data: ProductData) {
    const bytes = transferablesOf(data).reduce((s, b) => s + b.byteLength, 0) + 256;
    const old = this.items.get(key);
    if (old) { this.total -= old.bytes; this.items.delete(key); }
    this.items.set(key, { data, bytes });
    this.total += bytes;
    while (this.total > this.budget && this.items.size > 1) {
      const [k, v] = this.items.entries().next().value!;
      this.items.delete(k);
      this.total -= v.bytes;
    }
  }
  get bytes() { return this.total; }
  get size() { return this.items.size; }
  clear() { this.items.clear(); this.total = 0; }
}

export interface ProductOptions extends RunOptions {
  /**
   * Products a stage may start from (D163): e.g. an earlier history to go on from. They never change what the stage
   * makes (its key does not depend on them), only how quickly.
   */
  hints?: Record<string, ProductData>;
}

export class Pipeline {
  readonly executor: Executor;
  readonly cache: ProductCache;
  /** Products being made now, so two requests for the same one share the work. */
  private pending = new Map<string, Promise<ProductData>>();

  constructor(executor: Executor, cache = new ProductCache()) {
    this.executor = executor;
    this.cache = cache;
  }

  /** The key of a stage's product for a definition: a hash of the stage, the engine, its inputs and its dependencies' keys. */
  keyOf(stage: string, def: PlanetDefinition, params: StageParams): string {
    const s = STAGES[stage];
    if (!s) throw new Error(`No stage called ${stage}`);
    return keyOf({
      engine: ENGINE_VERSION, stage, version: s.version, inputs: s.inputs(def, params),
      deps: s.deps(params).map((d) => this.keyOf(d, def, params)),
    });
  }

  /** A stage's product for a definition: from the cache, or made (with whatever it needs). */
  async product(stage: string, def: PlanetDefinition, params: StageParams, opts: ProductOptions = {}): Promise<Product> {
    const key = this.keyOf(stage, def, params);
    const hit = this.cache.get(key);
    if (hit) return { key, stage, data: hit, cached: true, ms: 0 };
    const t0 = performance.now();
    let making = this.pending.get(key);
    if (!making) {
      making = this.make(stage, def, params, opts).finally(() => this.pending.delete(key));
      this.pending.set(key, making);
    }
    const data = await making;
    this.cache.set(key, data);
    return { key, stage, data, cached: false, ms: performance.now() - t0 };
  }

  private async make(stage: string, def: PlanetDefinition, params: StageParams, opts: ProductOptions): Promise<ProductData> {
    const s = STAGES[stage];
    const deps: Record<string, ProductData> = {};
    for (const d of s.deps(params)) deps[d] = (await this.product(d, def, params, { signal: opts.signal })).data;
    const inputs = s.inputs(def, params);
    if (!s.parts || !s.join) {
      return (await this.executor.run('stage', { stage, inputs, deps, ...(opts.hints ? { hints: opts.hints } : {}) }, opts)) as ProductData;
    }
    const n = s.parts(inputs);
    const ranges: Array<[number, number]> = [];
    for (let a = 0; a < n; a += PART_SIZE) ranges.push([a, Math.min(n, a + PART_SIZE)]);
    let done = 0;
    const parts = await Promise.all(ranges.map((range) =>
      this.executor.run('stage', { stage, inputs, deps, range }, { signal: opts.signal }).then((r) => {
        opts.onProgress?.(++done, ranges.length);
        return r as ProductData;
      })));
    return s.join(parts, inputs);
  }
}
