// A planet's foundation (D269): everything worked out for it at every point (its land through its history, where
// its sea stands, its temperatures and rain by month, its winds, ice, rivers and lakes, its kinds of surface and
// their colours), gathered into one file kept with the project.
//
// Why keep it: a planet's pictures are made from its definition by the engine as it is. An engine improved later
// would make another planet from the same definition, and a map drawn on the first would no longer fit. With its
// foundation kept, a planet stays as it was made for as long as its definition stays; and opening its map takes a
// file read, not a simulation.
//
// The file is the engine's own format (MMS1, state/codec.ts): each product's arrays as fields, kept exactly (no
// rounding: what is read back is what was made, bit for bit), the rest of each product as JSON in the header.
import type { PlanetDefinition } from './model/definition.ts';
import { keyOf } from './state/hash.ts';
import { decodeState, encodeState, type Deflate, type FieldArray, type FieldOut } from './state/codec.ts';
import type { Pipeline, ProductOptions } from './pipeline/scheduler.ts';
import type { ProductData, ProductValue, StageParams } from './pipeline/stages.ts';

/** The products a foundation holds, in the order they are made: the planet's present, and its land through its history. */
export const FOUNDATION_STAGES = ['tectonics', 'insolation', 'sea', 'temperature', 'climate', 'water', 'biomes'] as const;
export type FoundationStage = (typeof FOUNDATION_STAGES)[number];

export const FOUNDATION_FORMAT = 1;

export interface Foundation {
  /** What it was made from (`foundationKey`). */
  of: string;
  /** The mesh level its fields are on. */
  level: number;
  products: Record<FoundationStage, ProductData>;
}

/**
 * What names a planet's foundation: its definition but for its name and the preset it came from (neither changes the
 * planet), with what it is simulated with. Not the engine's version: a foundation is kept so that the planet stays
 * as it was made whatever the engine becomes.
 */
export function foundationKey(def: PlanetDefinition, params: StageParams): string {
  const { name: _n, preset: _p, ...rest } = def;
  return keyOf({ foundation: FOUNDATION_FORMAT, definition: rest, level: params.level, durationMyr: params.durationMyr ?? null, frameEveryMyr: params.frameEveryMyr ?? null });
}

/** A planet's foundation, made (or taken from what is already made) by a pipeline. Only for the second calculation. */
export async function gatherFoundation(p: Pipeline, def: PlanetDefinition, params: StageParams, opts: ProductOptions = {}): Promise<Foundation> {
  if (def.engine !== 2 || !params.sea) throw new Error('Only a planet of the second calculation has a foundation.');
  const products = {} as Record<FoundationStage, ProductData>;
  for (const stage of FOUNDATION_STAGES) products[stage] = (await p.product(stage, def, params, stage === 'tectonics' ? opts : { signal: opts.signal })).data;
  return { of: foundationKey(def, params), level: params.level, products };
}

/** Gives a pipeline a foundation's products as those of this definition: asked for again, they are these, not made anew. */
export function adoptFoundation(p: Pipeline, def: PlanetDefinition, params: StageParams, f: Foundation): void {
  if (f.of !== foundationKey(def, params)) throw new Error('That foundation is of another planet.');
  p.adopt(f.of, FOUNDATION_STAGES.map((stage) => ({ key: p.keyOf(stage, def, params), data: f.products[stage] })));
}

const isView = (v: unknown): v is FieldArray => ArrayBuffer.isView(v) && !(v instanceof DataView);

/** A product's values without its arrays: each array a reference to a field, numbers JSON cannot hold by name. */
function strip(v: ProductValue | undefined, path: string, fields: FieldOut[]): unknown {
  if (v === undefined) return undefined;
  if (isView(v)) { fields.push({ name: path, data: v }); return { $field: path }; }
  if (typeof v === 'number' && !Number.isFinite(v)) return { $number: String(v) };
  if (Array.isArray(v)) return v.map((x, i) => strip(x, `${path}/${i}`, fields) ?? null);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const s = strip(x as ProductValue, `${path}/${k}`, fields); if (s !== undefined) out[k] = s; }
    return out;
  }
  return v;
}
function restore(v: unknown, fields: Map<string, FieldArray>): ProductValue {
  if (Array.isArray(v)) return v.map((x) => restore(x, fields));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$field === 'string' && Object.keys(o).length === 1) {
      const f = fields.get(o.$field);
      if (!f) throw new Error('Damaged planet file');
      return f;
    }
    if (typeof o.$number === 'string' && Object.keys(o).length === 1) return Number(o.$number);
    const out: { [k: string]: ProductValue } = {};
    for (const [k, x] of Object.entries(o)) out[k] = restore(x, fields);
    return out;
  }
  return v as ProductValue;
}

/** A foundation as a file's bytes. */
export async function encodeFoundation(f: Foundation, deflate: Deflate): Promise<Uint8Array> {
  const fields: FieldOut[] = [], products: Record<string, unknown> = {};
  for (const stage of FOUNDATION_STAGES) products[stage] = strip(f.products[stage], stage, fields);
  return encodeState({ engine: `foundation-${FOUNDATION_FORMAT}`, kind: 'foundation', level: f.level, meta: { of: f.of, products } }, fields, deflate);
}

/** A foundation read from a file's bytes; fails on anything that is not one, or is damaged. */
export async function decodeFoundation(bytes: Uint8Array, inflate: Deflate): Promise<Foundation> {
  const s = await decodeState(bytes, inflate);
  const meta = s.header.meta as { of?: unknown; products?: Record<string, unknown> } | undefined;
  if (s.header.kind !== 'foundation' || s.header.engine !== `foundation-${FOUNDATION_FORMAT}` || typeof meta?.of !== 'string' || !meta.products) throw new Error('Not a planet\'s foundation');
  const products = {} as Record<FoundationStage, ProductData>;
  for (const stage of FOUNDATION_STAGES) {
    if (!meta.products[stage]) throw new Error('Damaged planet file');
    products[stage] = restore(meta.products[stage], s.fields) as ProductData;
  }
  return { of: meta.of, level: s.header.level ?? 0, products };
}

/** What a foundation holds for one place (a cell of its mesh), by name: the data kept at every point. */
export interface PointData {
  /** Height against the sea (m; against the lowest ground on a world with none), the kind of crust and its age (million years). */
  heightM: number;
  crust: number;
  crustAgeMyr: number;
  /** The twelve months' temperatures (°C) and rain and snow (mm); the day's high and the night's low where the ground has a day of its own. */
  tempC: number[];
  rainMm: number[];
  dayHighC: number | null;
  nightLowC: number | null;
  /** The winds of the first and the seventh month (m/s, east and north). */
  windJan: [number, number];
  windJul: [number, number];
  /** The share of the year the place lies frozen (sea ice, snow); an ice sheet's thickness (m). */
  frozenShare: number;
  iceSheetM: number;
  /** The kind of water (hydrology.ts WATER), a river's flow (m³/s), a lake's depth (m). */
  water: number;
  dischargeM3s: number;
  lakeDepthM: number;
  /** The kind of surface (life/biomes.ts BIOME_IDS), its Köppen class (0: none) and its colour seen from space. */
  biome: number;
  koppen: number;
  colour: [number, number, number];
}

/** The data kept for a cell. */
export function pointData(f: Foundation, cell: number): PointData {
  const { tectonics: T, sea: S, climate: C, water: W, biomes: B } = f.products;
  const n = (S.heights as Int16Array).length;
  if (!(cell >= 0 && cell < n)) throw new Error('No such place');
  const months = (a: unknown) => Array.from({ length: 12 }, (_, m) => (a as Float32Array)[m * n + cell]);
  return {
    heightM: (S.heights as Int16Array)[cell], crust: (S.crust as Uint8Array)[cell], crustAgeMyr: (T.age as Float32Array)[cell],
    tempC: months(C.monthly), rainMm: months(C.precipMonthly),
    dayHighC: C.dayHigh ? (C.dayHigh as Float32Array)[cell] : null, nightLowC: C.nightLow ? (C.nightLow as Float32Array)[cell] : null,
    windJan: [(C.windJan as Float32Array)[2 * cell], (C.windJan as Float32Array)[2 * cell + 1]], windJul: [(C.windJul as Float32Array)[2 * cell], (C.windJul as Float32Array)[2 * cell + 1]],
    frozenShare: (C.ice as Float32Array)[cell], iceSheetM: (W.ice as Float32Array)[cell],
    water: (W.kind as Uint8Array)[cell], dischargeM3s: (W.discharge as Float32Array)[cell], lakeDepthM: (W.lakeDepth as Float32Array)[cell],
    biome: (B.biome as Uint8Array)[cell], koppen: (B.koppen as Uint8Array)[cell],
    colour: [(B.colour as Uint8Array)[3 * cell], (B.colour as Uint8Array)[3 * cell + 1], (B.colour as Uint8Array)[3 * cell + 2]],
  };
}
