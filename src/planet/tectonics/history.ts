// A planet's tectonic history (Stage 14.2, D153): from its first state, step by step, with pictures of the world
// kept at fixed intervals (heights, plates and crust) for the timeline, and the present's crust in full.
import { initialState, checkpoint, EARTH_SPEED, type TectonicParams, type TectonicState } from './state.ts';
import { step, heights, regimeVigor } from './step.ts';
import { erodeCrust } from './erode.ts';
import { paleoClimate, co2Factor } from '../climate/paleo.ts';
import { oceanVolume, seaLevelForVolume } from '../water/sealevel.ts';
import { packState, unpackState, paramsBesidesEvents, firstDifference, type Packed } from './resume.ts';

/** The grid steps keep to, Myr; and how often the climate of the moment is worked out (D159). */
export const GRID_MYR = 5;
export const PALEO_MYR = 50;

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
  /** Keep packed checkpoints in the history every so many Myr (D163; default 50; 0: none). */
  resumeEveryMyr?: number;
  /**
   * An earlier history of the same planet (D163): if it ran with the same settings and through the same events up to
   * some moment, this one continues from its last packed checkpoint before that moment (and takes its pictures from
   * before it), arriving at exactly what running from the beginning would.
   */
  base?: TectonicHistory | null;
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
  /**
   * Per picture (D159): the sea's level (m, against the present's) from the ocean's conserved water, less what ice on
   * land held then, and the moment's own rises (sea-level events); the ice on land (km³); the planet's mean
   * temperature (K, 0 without a climate).
   */
  seaLevels: Float32Array;
  iceVolumes: Float32Array;
  meanTemps: Float32Array;
  /** Per picture: the sea's level on the heights' datum (km) it was drawn against (a moment rebuilt from a checkpoint is pictured the same against it). */
  frameSea: Float64Array;
  /** Per picture, as the run itself had them (D163): the sea's level on the datum, the ice on land (m³), the sea's own rise (km). */
  frameDatum: Float64Array;
  frameIce: Float64Array;
  frameRise: Float64Array;
  /** The settings it ran with, and packed checkpoints by their moment (Myr since the beginning) (D163). */
  params: TectonicParams;
  resume: { times: number[]; states: Packed[] };
  /** Where this history began (Myr since the beginning): 0, or the checkpoint an earlier history lent it (D163). */
  resumedFrom: number;
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
  const D = opts.durationMyr;
  // Steps never cross a whole multiple of GRID_MYR, whatever pictures are kept, so the history is the same
  // whichever interval the pictures are taken at (pictures are taken on that grid).
  const every = Math.max(GRID_MYR, Math.round(opts.frameEveryMyr / GRID_MYR) * GRID_MYR);
  const frameTimes: number[] = [];
  for (let t = 0; t < D - 1e-9; t += every) frameTimes.push(t);
  frameTimes.push(D);
  const F = frameTimes.length;
  const resumeEvery = opts.resumeEveryMyr === 0 ? 0 : Math.max(GRID_MYR, Math.round((opts.resumeEveryMyr ?? 50) / GRID_MYR) * GRID_MYR);
  const packed: { times: number[]; states: Packed[] } = { times: [], states: [] };
  // Going on from an earlier history (D163): the last of its packed checkpoints before the first moment its events
  // and these differ, if it ran with the same settings over the same span and pictures.
  let state: TectonicState | null = null, f = 1, from = 0;
  const base = opts.base;
  if (base && base.params && base.resume && paramsBesidesEvents(base.params) === paramsBesidesEvents(params) && base.times.length === F
    && Math.abs(base.times[0] - D) < 1e-9 && resumeEvery) {
    const T = Math.min(D, firstDifference(base.params.events ?? [], params.events ?? []));
    let k = -1;
    for (let i = 0; i < base.resume.times.length; i++) if (base.resume.times[i] <= T + 1e-9 && base.resume.times[i] > 0 && (k < 0 || base.resume.times[i] > base.resume.times[k])) k = i;
    if (k >= 0) {
      from = base.resume.times[k];
      state = unpackState(base.resume.states[k], params);
      // The events: those begun before this moment as they ran (places drawn for them kept), then these ones' later events.
      const later = (params.events ?? []).filter((e) => e.start >= from - 1e-9).map((e) => ({ ...e, ...(e.at ? { at: [...e.at] as [number, number] } : {}) }));
      const earlier = state.events.filter((e) => e.start < from - 1e-9);
      const begun = state.begun.filter((_, i) => state!.events[i].start < from - 1e-9);
      state.events = [...earlier, ...later].sort((a, b) => a.start - b.start);
      state.begun = state.events.map((e) => (e.start < from - 1e-9 ? begun[earlier.indexOf(e)] : false));
      for (let i = 0; i < base.resume.times.length; i++) if (base.resume.times[i] <= from + 1e-9) { packed.times.push(base.resume.times[i]); packed.states.push(base.resume.states[i]); }
    }
  }
  if (!state) { state = initialState(params); heights(state); }
  const st = state;
  const n = st.mesh.n;
  const H = new Int16Array(F * n), Pl = new Uint8Array(F * n), K = new Uint8Array(F * n);
  const datumSea = new Float64Array(F), iceAt = new Float64Array(F), riseAt = new Float64Array(F), tempAt = new Float32Array(F);
  const record = (f: number) => {
    recordFrame(st, f, H, Pl, K);
    datumSea[f] = st.seaLevel; iceAt[f] = st.paleo?.ice ?? 0; riseAt[f] = seaRise(st); tempAt[f] = st.paleo?.meanK ?? 0;
  };
  if (from > 0) {
    // The pictures up to the checkpoint are the earlier history's (as its run had them, before its sea was redrawn).
    const b = base!;
    for (f = 0; f < F && frameTimes[f] <= from + 1e-9; f++) {
      const unshift = Math.round((b.frameSea[f] - b.frameDatum[f]) * 1000);
      for (let c = 0; c < n; c++) H[f * n + c] = Math.max(-32_000, Math.min(32_000, b.heights[f * n + c] + unshift));
      Pl.set(b.plates.subarray(f * n, (f + 1) * n), f * n); K.set(b.kinds.subarray(f * n, (f + 1) * n), f * n);
      datumSea[f] = b.frameDatum[f]; iceAt[f] = b.frameIce[f]; riseAt[f] = b.frameRise[f]; tempAt[f] = b.meanTemps[f];
    }
  } else {
    updatePaleo(st);
    record(0);
    if (resumeEvery) { packed.times.push(0); packed.states.push(packState(st)); }
  }
  const ckEvery = opts.checkpointEveryMyr ? Math.max(GRID_MYR, Math.round(opts.checkpointEveryMyr / GRID_MYR) * GRID_MYR) : 0;
  const checkpoints = ckEvery ? new Map<number, TectonicState>([[Math.round(st.time), checkpoint(st)]]) : undefined;
  while (st.time < D - 1e-9) {
    advanceToGrid(st, D, opts.maxStepMyr ?? 5);
    if (f < F && st.time >= frameTimes[f] - 1e-9) { record(f); f++; opts.onProgress?.(st.time, D); }
    const on = (k: number) => Math.abs(st.time / k - Math.round(st.time / k)) < 1e-9;
    if (checkpoints && on(ckEvery)) checkpoints.set(Math.round(st.time), checkpoint(st));
    if (resumeEvery && on(resumeEvery) && st.time < D - 1e-9) { packed.times.push(Math.round(st.time)); packed.states.push(packState(st)); }
  }
  const state2 = st;
  // The present in full.
  const age = new Float32Array(n), thickness = new Float32Array(n), tags = new Uint8Array(n), sediment = new Float32Array(n);
  let land = 0, cont = 0;
  for (let c = 0; c < n; c++) {
    const p = state2.plates[state2.owner[c]], r = state2.ref[c];
    if (!p) continue;
    age[c] = p.age[r]; thickness[c] = p.thickness[r]; tags[c] = p.tags[r]; sediment[c] = p.sediment[r];
    if (state2.height[c] > state2.seaLevel) land += state2.mesh.area[c];
    if (p.kind[r] === 2) cont += state2.mesh.area[c];
  }
  const omega = new Float64Array(3 * state2.plates.length);
  state2.plates.forEach((p, i) => omega.set(p.omega, 3 * i));
  // The sea's level in each picture from the water's volume (D159): the present's ocean and ice together hold the
  // planet's water; at each moment the sea holds that less the ice on land then, over that moment's heights.
  const seaLevels = new Float32Array(F), iceVolumes = new Float32Array(F), frameSea = Float64Array.from(datumSea);
  const frameDatum = Float64Array.from(datumSea);
  if (Number.isFinite(state2.seaLevel) && params.oceanFraction > 0 && params.oceanFraction < 1) {
    const area = state2.mesh.area, Rkm = params.radiusKm, toKmSr = 1e-9 / (Rkm * Rkm);
    const datum = (f: number) => Float64Array.from({ length: n }, (_, c) => H[f * n + c] / 1000 + datumSea[f]);
    const present = datum(F - 1);
    const water = oceanVolume(present, area, datumSea[F - 1]) + iceAt[F - 1] * toKmSr;
    const presentLevel = datumSea[F - 1] + riseAt[F - 1];
    for (let f = 0; f < F; f++) {
      const h = f === F - 1 ? present : datum(f);
      const level = seaLevelForVolume(h, area, Math.max(0, water - iceAt[f] * toKmSr)) + riseAt[f];
      const shift = Math.round((level - datumSea[f]) * 1000);
      frameSea[f] = datumSea[f] + shift / 1000;
      if (shift) for (let c = 0; c < n; c++) H[f * n + c] = Math.max(-32_000, Math.min(32_000, H[f * n + c] - shift));
      seaLevels[f] = (level - presentLevel) * 1000;
      iceVolumes[f] = iceAt[f] / 1e9;
    }
  }
  return {
    times: Float64Array.from(frameTimes, (t) => D - t), heights: H, plates: Pl, kinds: K, age, thickness,
    boundary: state2.boundary.slice(), boundaryRate: state2.boundaryRate.slice(), omega, plateCount: state2.plates.length,
    stats: { steps: state2.steps, ...state2.totals, landShare: land / (4 * Math.PI), continentalShare: cont / (4 * Math.PI), ms: performance.now() - t0 },
    tags, sediment, discharge: state2.discharge.slice(), seaLevels, iceVolumes, meanTemps: tempAt, frameSea,
    frameDatum, frameIce: Float64Array.from(iceAt), frameRise: Float64Array.from(riseAt), params, resume: packed, resumedFrom: from,
    ...(checkpoints ? { checkpoints } : {}),
  };
}

/** The climate events under way at a state's moment. */
function climateEvents(state: TectonicState) {
  return state.events.filter((e) => (e.kind === 'ice-age' || e.kind === 'greenhouse' || e.kind === 'sea-level') && e.start <= state.time + 1e-9 && e.end > state.time + 1e-9);
}

/** The sea's own rise at a moment from sea-level events (km: 50 m for each unit of strength). */
function seaRise(state: TectonicState): number {
  let r = 0;
  for (const e of climateEvents(state)) if (e.kind === 'sea-level') r += 0.05 * Math.max(0, e.strength);
  return r;
}

/** Works out the moment's climate when PALEO_MYR has passed since the last, or the climate events have changed (D159). */
function updatePaleo(state: TectonicState) {
  const climate = state.params.climate;
  if (!climate) return;
  const co2 = co2Factor(climateEvents(state));
  const last = state.paleo;
  if (last && state.time - last.at < PALEO_MYR - 1e-9 && last.co2 === co2) return;
  const n = state.mesh.n, heightM = new Float64Array(n);
  for (let c = 0; c < n; c++) heightM[c] = (state.height[c] - state.seaLevel) * 1000;
  const p = paleoClimate(state.mesh, heightM, climate, co2, last ? { rain: last.rain, ice: last.ice, coarseK: last.coarseK, meanK: last.meanK } : null);
  state.paleo = { at: state.time, co2, rain: p.rain, ice: p.ice, coarseK: p.coarseK, meanK: p.meanK };
}

/** One step, or as many as it takes, to the next whole GRID_MYR (or the end); then the landscape for that span. */
function advanceToGrid(state: TectonicState, end: number, maxStep: number) {
  const from = state.time;
  const grid = Math.min(end, (Math.floor(state.time / GRID_MYR + 1e-9) + 1) * GRID_MYR);
  while (state.time < grid - 1e-9) step(state, Math.min(stepLength(state, maxStep), grid - state.time));
  if (state.params.erosion !== false && state.time > from) erodeCrust(state, state.time - from);
  updatePaleo(state);
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
