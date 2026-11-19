// A planet's tectonic history (Stage 14.2, D153): from its first state, step by step, with pictures of the world
// kept at fixed intervals (heights, plates and crust) for the timeline, and the present's crust in full.
import { initialState, checkpoint, EARTH_SPEED, type TectonicParams, type TectonicState } from './state.ts';
import { step, heights, regimeVigor } from './step.ts';
import { erodeCrust } from './erode.ts';

/** The grid steps keep to, Myr. */
export const GRID_MYR = 5;

export interface HistoryOptions {
  /** How long the history runs, Myr (it ends at the present). */
  durationMyr: number;
  /** A picture every so many Myr (a whole number of GRID_MYR; and at the start and the end). */
  frameEveryMyr: number;
  /** The longest step, Myr. */
  maxStepMyr?: number;
  onProgress?: (doneMyr: number, totalMyr: number) => void;
  /** Keep a checkpoint (the whole state) every so many Myr, on the grid, to go on from (D154). */
  checkpointEveryMyr?: number;
}

export interface TectonicHistory {
  /** Each picture's moment, Myr before the present (decreasing to 0). */
  times: Float64Array;
  /** Per picture, per cell: height above the sea of that moment, m; the plate; the kind of crust. */
  heights: Int16Array;
  plates: Uint8Array;
  kinds: Uint8Array;
  /** The present, per cell: the crust's age (Myr) and thickness (km), the boundary and its rate (km/Myr). */
  age: Float32Array;
  thickness: Float32Array;
  boundary: Uint8Array;
  boundaryRate: Float32Array;
  /** The plates' angular velocities now (x y z per plate, rad/Myr) and how many there are. */
  omega: Float64Array;
  plateCount: number;
  stats: { steps: number; created: number; consumed: number; collided: number; eroded: number; deposited: number; landShare: number; continentalShare: number; ms: number };
  /** Checkpoints kept (when asked), by their time (Myr since the history began). Not part of a stage's product. */
  checkpoints?: Map<number, TectonicState>;
  /** The present's crust history (TAG bits) per cell, sediment on it (km), and the water draining through it (km²). */
  tags: Uint8Array;
  sediment: Float32Array;
  discharge: Float32Array;
}

/** The step that keeps every plate within a fraction of a cell per step. */
export function stepLength(state: TectonicState, maxStep: number): number {
  const spacing = Math.sqrt((4 * Math.PI) / state.mesh.n) * state.params.radiusKm;
  let fastest = 0;
  for (const p of state.plates) fastest = Math.max(fastest, Math.hypot(p.omega[0], p.omega[1], p.omega[2]) * state.params.radiusKm);
  fastest *= regimeVigor(state);
  if (fastest <= 0) return maxStep;
  return Math.max(0.05, Math.min(maxStep, (0.6 * spacing) / Math.max(fastest, 0.2 * EARTH_SPEED)));
}

export function runHistory(params: TectonicParams, opts: HistoryOptions): TectonicHistory {
  const t0 = performance.now();
  const state = initialState(params);
  heights(state);
  const n = state.mesh.n, D = opts.durationMyr;
  // Steps never cross a whole multiple of GRID_MYR, whatever pictures are kept, so the history is the same
  // whichever interval the pictures are taken at (pictures are taken on that grid).
  const every = Math.max(GRID_MYR, Math.round(opts.frameEveryMyr / GRID_MYR) * GRID_MYR);
  const frameTimes: number[] = [];
  for (let t = 0; t < D - 1e-9; t += every) frameTimes.push(t);
  frameTimes.push(D);
  const F = frameTimes.length;
  const H = new Int16Array(F * n), Pl = new Uint8Array(F * n), K = new Uint8Array(F * n);
  const record = (f: number) => recordFrame(state, f, H, Pl, K);
  record(0);
  const ckEvery = opts.checkpointEveryMyr ? Math.max(GRID_MYR, Math.round(opts.checkpointEveryMyr / GRID_MYR) * GRID_MYR) : 0;
  const checkpoints = ckEvery ? new Map<number, TectonicState>([[0, checkpoint(state)]]) : undefined;
  let f = 1;
  while (state.time < D - 1e-9) {
    advanceToGrid(state, D, opts.maxStepMyr ?? 5);
    if (f < F && state.time >= frameTimes[f] - 1e-9) { record(f); f++; opts.onProgress?.(state.time, D); }
    if (checkpoints && Math.abs(state.time / ckEvery - Math.round(state.time / ckEvery)) < 1e-9) checkpoints.set(Math.round(state.time), checkpoint(state));
  }
  // The present in full.
  const age = new Float32Array(n), thickness = new Float32Array(n), tags = new Uint8Array(n), sediment = new Float32Array(n);
  let land = 0, cont = 0;
  for (let c = 0; c < n; c++) {
    const p = state.plates[state.owner[c]], r = state.ref[c];
    if (!p) continue;
    age[c] = p.age[r]; thickness[c] = p.thickness[r]; tags[c] = p.tags[r]; sediment[c] = p.sediment[r];
    if (state.height[c] > state.seaLevel) land += state.mesh.area[c];
    if (p.kind[r] === 2) cont += state.mesh.area[c];
  }
  const omega = new Float64Array(3 * state.plates.length);
  state.plates.forEach((p, i) => omega.set(p.omega, 3 * i));
  return {
    times: Float64Array.from(frameTimes, (t) => D - t), heights: H, plates: Pl, kinds: K, age, thickness,
    boundary: state.boundary.slice(), boundaryRate: state.boundaryRate.slice(), omega, plateCount: state.plates.length,
    stats: { steps: state.steps, ...state.totals, landShare: land / (4 * Math.PI), continentalShare: cont / (4 * Math.PI), ms: performance.now() - t0 },
    tags, sediment, discharge: state.discharge.slice(), ...(checkpoints ? { checkpoints } : {}),
  };
}

/** One step, or as many as it takes, to the next whole GRID_MYR (or the end); then the landscape for that span. */
function advanceToGrid(state: TectonicState, end: number, maxStep: number) {
  const from = state.time;
  const grid = Math.min(end, (Math.floor(state.time / GRID_MYR + 1e-9) + 1) * GRID_MYR);
  while (state.time < grid - 1e-9) step(state, Math.min(stepLength(state, maxStep), grid - state.time));
  if (state.params.erosion !== false && state.time > from) erodeCrust(state, state.time - from);
}

/** Writes the world's heights (m above the sea), plates and crust as picture f. */
function recordFrame(state: TectonicState, f: number, H: Int16Array, Pl: Uint8Array, K: Uint8Array) {
  const n = state.mesh.n;
  for (let c = 0; c < n; c++) {
    const o = state.owner[c], p = state.plates[o];
    H[f * n + c] = Math.max(-32_000, Math.min(32_000, Math.round((state.height[c] - state.seaLevel) * 1000)));
    Pl[f * n + c] = o < 0 ? 255 : o;
    K[f * n + c] = p ? p.kind[state.ref[c]] : 0;
  }
}

/**
 * The world at any moment of a history (Myr since it began): from the last checkpoint at or before it, the history
 * run on to that moment, exactly as it ran the first time (every step is decided by the state alone, the random
 * generator included). Returns the state there (the checkpoint itself is not changed).
 */
export function reconstructAt(checkpoints: Map<number, TectonicState>, time: number, maxStepMyr = 5): TectonicState {
  let best = -Infinity;
  for (const t of checkpoints.keys()) if (t <= time + 1e-9 && t > best) best = t;
  if (best === -Infinity) throw new Error('No checkpoint before that moment');
  const state = checkpoint(checkpoints.get(best)!);
  while (state.time < time - 1e-9) advanceToGrid(state, time, maxStepMyr);
  return state;
}
