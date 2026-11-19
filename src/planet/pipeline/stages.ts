// The planetary engine's stages (Stage 14, D152): each makes a product from a slice of the planet's definition and
// the products of the stages it uses. A product's key is a hash of exactly that (the stage, its version, the
// engine's version, its inputs and its dependencies' keys), so changing a setting re-runs only the stages that
// read it, and anything already made for the same inputs is reused (scheduler.ts).
//
// The same registry runs in the interface (to work out inputs and keys, and to join parts) and in the workers (to
// run stages). A stage that works cell by cell can be run in parts: fixed ranges of cells, whatever the number of
// workers, joined in order, so the result is the same bytes on one worker or on many.
import type { PlanetDefinition } from '../model/definition.ts';
import { derive } from '../model/physics.ts';
import { cellsAt, meshAt } from '../mesh/icosphere.ts';
import { rasterize } from '../mesh/transfer.ts';
import { insolationCells, sunlightOf, type Sunlight } from '../climate/insolation.ts';
import type { FieldArray } from '../state/codec.ts';

/** Changes whenever any model changes its results, so nothing made before is reused. */
export const ENGINE_VERSION = 1;

export interface StageParams {
  /** The mesh level to work at. */
  level: number;
  /** For pictures: the size and the layer. */
  width?: number;
  height?: number;
  layer?: LayerId;
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

/** The layers a picture can show: which stage and field, and the unit. */
export const LAYERS = {
  insolation: { stage: 'insolation', field: 'annual', unit: 'W/m²', label: 'Sunlight (yearly mean)' },
} as const;
export type LayerId = keyof typeof LAYERS;

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

  /** A picture of a layer: the field drawn on an equirectangular grid, with its range. */
  raster: {
    id: 'raster',
    version: 1,
    deps: (p) => [LAYERS[p.layer ?? 'insolation'].stage],
    inputs: (_def, p) => ({ level: p.level, width: p.width ?? 512, height: p.height ?? 256, layer: p.layer ?? 'insolation' }),
    run: (inputs, deps, ctx) => {
      const layer = LAYERS[inputs.layer as LayerId];
      const field = deps[layer.stage][layer.field] as Float32Array;
      const raster = rasterize(meshAt(inputs.level as number), field, inputs.width as number, inputs.height as number);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < raster.length; i++) { const v = raster[i]; if (v < min) min = v; if (v > max) max = v; }
      ctx.progress(1, 1);
      return { raster, width: inputs.width as number, height: inputs.height as number, min, max, unit: layer.unit };
    },
  },
};
