// The tectonic state and how a history starts (Stage 14.2, D153; 14.3, D154: hotspots, events, splitting,
// checkpoints).
//
// Plates are seeded across the sphere and grown by a flood whose cost is shaped by noise and by each plate's own
// weight, so a few are large and many small, with irregular edges (Earth's plates follow such a size distribution;
// Bird 2003). Continental crust is laid down in irregular blocks to the share asked for, oceanic crust everywhere
// else with ages from 0 to about 180 million years (all of it recycled within a couple of hundred million years
// of history, as on Earth). Each plate turns about an Euler pole at a speed set by the interior's vigour, slower
// for plates carrying more continent (keel drag).
import { meshAt, type Mesh } from '../mesh/icosphere.ts';
import { random, simplex3 } from '../../terrain/planet.ts';
import { CRUST, newPlate, type Plate } from './plates.ts';
import type { GeoEventKind } from '../model/definition.ts';

/** A timeline event as the history sees it: its kind, when it starts and ends (Myr since the history began), how strong, where. */
export interface TectonicEvent {
  kind: GeoEventKind;
  start: number;
  end: number;
  strength: number;
  /** Longitude and latitude, degrees (or chosen by the history). */
  at?: [number, number];
}

/** A mantle plume, fixed in the mantle's frame (the world's): where, how strong, and when it is active. */
export interface Hotspot {
  x: number; y: number; z: number;
  strength: number;
  start: number;
  end: number;
  /** The world cell above it (kept to find it again quickly). */
  cell: number;
}

export interface TectonicParams {
  level: number;
  seed: number;
  radiusKm: number;
  /** Surface gravity, m/s² (the thickest crust a planet can hold scales as 1/g). */
  gravity: number;
  plates: number;
  /** Plate speeds as a multiple of Earth's (the interior's vigour × the activity setting); 0: no motion. */
  vigor: number;
  continentalFraction: number;
  oceanFraction: number;
  regime: 'mobile-lid' | 'stagnant-lid' | 'episodic';
  /** How many mantle plumes there are (and events that add or change things, D154). */
  hotspots?: number;
  events?: TectonicEvent[];
  /** Landscape (D155): wear the surface down every 5 Myr of a history (default yes), how easily (× Earth's: water
   * and air), and the edge of the Hadley cells (degrees) for the rain belts standing in for the climate. */
  erosion?: boolean;
  erodibility?: number;
  hadleyDeg?: number;
}

export interface TectonicState {
  mesh: Mesh;
  params: TectonicParams;
  plates: Plate[];
  /** Myr since the history began, and the steps taken. */
  time: number;
  steps: number;
  /** Per world cell: the plate holding it and the cell of that plate's frame under it. */
  owner: Int32Array;
  ref: Int32Array;
  /** Per world cell, from the last step: boundary kind (BOUNDARY) and its rate (km/Myr, closing negative). */
  boundary: Uint8Array;
  boundaryRate: Float32Array;
  /** Per world cell: the plate going down beneath it at a trench (-1 none), and the trench's side (cells of the plate going down next to it). */
  subducting: Int32Array;
  trench: Uint8Array;
  /** Heights, km above the datum, and the sea level on it. */
  height: Float32Array;
  seaLevel: number;
  /** When plate motions are next reconsidered (Myr). */
  nextReorganisation: number;
  /** Totals over the history: area made at ridges, consumed at trenches and in collisions (steradians); rock
   * removed by rivers and sediment laid down (km³). */
  totals: { created: number; consumed: number; collided: number; eroded: number; deposited: number };
  /** Water draining through each cell at the last landscape step (km², weighted by rain). */
  discharge: Float32Array;
  /**
   * Plates welded together where their continents collided (a suture): each plate's group (the plate it was welded
   * to, as a union-find), and the area collided so far between two groups (key a·4096 + b, a < b).
   */
  group: number[];
  contact: Map<number, number>;
  /** When each plate was welded into its group (Infinity: not welded), and when it was made (split off). */
  weldTime: number[];
  born: number[];
  /** The random generator's state (kept with checkpoints, so a history re-run from one is the same). */
  rngState: number;
  hotspots: Hotspot[];
  /** Events of the timeline, and which have begun. */
  events: TectonicEvent[];
  begun: boolean[];
  /** While an event gathers continents (a point they move towards) or scatters them (a point they move from). */
  gather: [number, number, number] | null;
  scatter: [number, number, number] | null;
  /** Volcanism as a multiple of usual (volcanic periods). */
  volcanism: number;
}

export const BOUNDARY = { none: 0, divergent: 1, convergent: 2, transform: 3 } as const;

/** The thickest crust gravity lets a planet keep, km (about 70 under Tibet on Earth). */
export const maxThickness = (gravity: number) => (70 * 9.81) / Math.max(1, gravity);
/** Plate speed of an Earth-like vigour, km/Myr (5 cm a year). */
export const EARTH_SPEED = 60;

/** A history's first moment: plates and crust. */
export function initialState(params: TectonicParams): TectonicState {
  const mesh = meshAt(params.level), n = mesh.n;
  const rng = random((params.seed * 2654435761) >>> 0 || 1);
  const noise = simplex3(params.seed + 101), noise2 = simplex3(params.seed + 202);
  const P = Math.max(1, Math.round(params.plates));
  // Seeds spread over the sphere (no two closer than a share of the mean spacing).
  const minDot = Math.cos(0.55 * Math.sqrt((4 * Math.PI) / P));
  const seeds: number[] = [];
  for (let tries = 0; seeds.length < P && tries < 20_000; tries++) {
    const c = Math.floor(rng() * n);
    let ok = true;
    for (const s of seeds) {
      const d = mesh.xyz[3 * c] * mesh.xyz[3 * s] + mesh.xyz[3 * c + 1] * mesh.xyz[3 * s + 1] + mesh.xyz[3 * c + 2] * mesh.xyz[3 * s + 2];
      if (d > minDot) { ok = false; break; }
    }
    if (ok || tries > 10_000) seeds.push(c);
  }
  // A few large plates, many small: weights from a steep distribution.
  const weight = seeds.map(() => 0.45 + 1.6 * rng() ** 2.2);
  // The flood: each cell to the seed it is cheapest to reach, the cost shaped by noise for ragged edges.
  const owner = new Int32Array(n).fill(-1), cost = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap();
  seeds.forEach((s, p) => { cost[s] = 0; heap.push(0, s, p); });
  while (heap.size) {
    const [k, c, p] = heap.pop();
    if (owner[c] >= 0) continue;
    owner[c] = p;
    for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
      const j = mesh.nbr[e];
      if (owner[j] >= 0) continue;
      const mx = mesh.xyz[3 * c] + mesh.xyz[3 * j], my = mesh.xyz[3 * c + 1] + mesh.xyz[3 * j + 1], mz = mesh.xyz[3 * c + 2] + mesh.xyz[3 * j + 2];
      const rough = 0.55 + 0.9 * (0.5 + 0.5 * fbm(noise, mx * 1.6, my * 1.6, mz * 1.6, 3));
      const nk = k + (mesh.edgeDist[e] * rough) / weight[p];
      if (nk < cost[j]) { cost[j] = nk; heap.push(nk, j, p); }
    }
  }
  // Continental crust: irregular blocks to the share asked for, inside plates rather than across their edges (on
  // Earth most plate boundaries run through the oceans), more on some plates than others.
  const hops = new Int32Array(n).fill(-1);
  let ring: number[] = [];
  for (let c = 0; c < n; c++) {
    for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) if (owner[mesh.nbr[e]] !== owner[c]) { hops[c] = 0; ring.push(c); break; }
  }
  for (let d = 1; ring.length; d++) {
    const next: number[] = [];
    for (const c of ring) for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
      const j = mesh.nbr[e];
      if (hops[j] < 0) { hops[j] = d; next.push(j); }
    }
    ring = next;
  }
  const spacingKm = Math.sqrt((4 * Math.PI) / n) * params.radiusKm;
  const plateBias = seeds.map(() => rng() - 0.5);
  const score = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], z = mesh.xyz[3 * c + 2];
    const inland = Math.min(1, (Math.max(0, hops[c]) * spacingKm) / 700);
    score[c] = 0.7 * fbm(noise2, x * 1.3, y * 1.3, z * 1.3, 4) + 0.15 * fbm(noise, x * 4, y * 4, z * 4, 2) + 0.55 * inland + 0.5 * plateBias[owner[c]]
      - (hops[c] === 0 ? 10 : 0);
  }
  const threshold = quantileByArea(score, mesh.area, 1 - params.continentalFraction);
  const plates = seeds.map((_, p) => newPlate(p, n));
  const ageNoise = simplex3(params.seed + 303);
  for (let c = 0; c < n; c++) {
    const p = plates[owner[c]];
    const x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], z = mesh.xyz[3 * c + 2];
    p.member[c] = 1;
    if (params.continentalFraction > 0 && score[c] >= threshold) {
      const inland = Math.min(1, (score[c] - threshold) * 4);
      p.kind[c] = CRUST.continental;
      p.thickness[c] = 30 + 10 * inland + 2 * ageNoise(x * 5, y * 5, z * 5);
      p.age[c] = 600 + 2400 * (0.5 + 0.5 * ageNoise(x * 2, y * 2, z * 2));
    } else {
      p.kind[c] = CRUST.oceanic;
      p.thickness[c] = 7;
      p.age[c] = 180 * (0.5 + 0.5 * ageNoise(x * 2.5 + 7, y * 2.5, z * 2.5));
    }
  }
  const state = baseState(params, plates, owner, (params.seed * 747796405 + 2891336453) >>> 0);
  state.nextReorganisation = 0;
  // Plumes, spread over the sphere, each for the whole history.
  for (let i = 0; i < Math.max(0, Math.round(params.hotspots ?? 0)); i++) {
    const [x, y, z] = randomPole(rng);
    state.hotspots.push({ x, y, z, strength: 0.6 + 0.8 * rng(), start: -Infinity, end: Infinity, cell: 0 });
  }
  for (const p of plates) setMotion(state, p, randomPole(rng), 1);
  return state;
}

/** A state's common parts. */
function baseState(params: TectonicParams, plates: Plate[], owner: Int32Array, rngState: number): TectonicState {
  const mesh = meshAt(params.level), n = mesh.n;
  return {
    mesh, params, plates, time: 0, steps: 0, owner, ref: Int32Array.from({ length: n }, (_, i) => i),
    boundary: new Uint8Array(n), boundaryRate: new Float32Array(n), subducting: new Int32Array(n).fill(-1), trench: new Uint8Array(n),
    height: new Float32Array(n), seaLevel: 0, nextReorganisation: Infinity, totals: { created: 0, consumed: 0, collided: 0, eroded: 0, deposited: 0 },
    discharge: new Float32Array(n),
    group: plates.map((_, i) => i), contact: new Map(), weldTime: plates.map(() => Infinity), born: plates.map(() => 0),
    rngState: rngState || 1, hotspots: [], events: (params.events ?? []).slice().sort((a, b) => a.start - b.start), begun: [],
    gather: null, scatter: null, volcanism: 1,
  };
}

/** The next random number of a state's generator, in [0, 1) (mulberry32, its state kept in the state). */
export function rand(state: TectonicState): number {
  const a = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The plates' total members (cells of their own frames), per plate. */
export function memberCounts(state: TectonicState): number[] {
  return state.plates.map((p) => { let k = 0; for (let r = 0; r < state.mesh.n; r++) k += p.member[r]; return k; });
}

/** A plate free for a new one (one that has lost all its crust, reset), or a new plate. Null at the limit (250). */
export function freePlate(state: TectonicState): Plate | null {
  const counts = memberCounts(state);
  const n = state.mesh.n;
  for (let i = 0; i < state.plates.length; i++) {
    if (counts[i] > 0 || state.plates.some((q) => q.id !== i && groupOf(state, q.id) === i)) continue;
    const p = state.plates[i];
    p.kind.fill(0); p.thickness.fill(0); p.age.fill(0); p.orogeny.fill(1e4); p.sediment.fill(0); p.tags.fill(0);
    p.q.set([1, 0, 0, 0]); p.omega.fill(0);
    state.group[i] = i; state.weldTime[i] = Infinity; state.born[i] = state.time;
    return p;
  }
  if (state.plates.length >= 250) return null;
  const p = newPlate(state.plates.length, n);
  state.plates.push(p); state.group.push(p.id); state.weldTime.push(Infinity); state.born.push(state.time);
  return p;
}

/**
 * Splits off from a plate the cells of its frame for which `take` says so, as a new plate in the same frame (so
 * the cells keep their indices), carrying the same motion until it is given its own. Null when nothing (or
 * everything) would move, or no plate is free.
 */
export function splitPlate(state: TectonicState, p: Plate, take: (r: number) => boolean): Plate | null {
  const n = state.mesh.n;
  let moving = 0, staying = 0;
  for (let r = 0; r < n; r++) if (p.member[r]) { if (take(r)) moving++; else staying++; }
  if (!moving || !staying) return null;
  const q = freePlate(state);
  if (!q || q === p) return null;
  q.q.set(p.q); q.omega.set(p.omega);
  for (let r = 0; r < n; r++) {
    if (!p.member[r] || !take(r)) continue;
    q.member[r] = 1; q.kind[r] = p.kind[r]; q.thickness[r] = p.thickness[r]; q.age[r] = p.age[r];
    q.orogeny[r] = p.orogeny[r]; q.sediment[r] = p.sediment[r]; q.tags[r] = p.tags[r];
    p.member[r] = 0; p.kind[r] = CRUST.none;
  }
  for (let c = 0; c < n; c++) if (state.owner[c] === p.id && q.member[state.ref[c]]) state.owner[c] = q.id;
  // The new plate leaves any group the old one was in.
  state.group[q.id] = q.id; state.weldTime[q.id] = Infinity; state.born[q.id] = state.time; state.born[p.id] = state.time;
  return q;
}

/** Everything a history needs to go on from a moment, copied (a checkpoint). */
export function checkpoint(state: TectonicState): TectonicState {
  return {
    ...state,
    plates: state.plates.map((p) => ({
      id: p.id, q: p.q.slice(), omega: p.omega.slice(), member: p.member.slice(), kind: p.kind.slice(), thickness: p.thickness.slice(),
      age: p.age.slice(), orogeny: p.orogeny.slice(), sediment: p.sediment.slice(), tags: p.tags.slice(),
    })),
    owner: state.owner.slice(), ref: state.ref.slice(), boundary: state.boundary.slice(), boundaryRate: state.boundaryRate.slice(),
    subducting: state.subducting.slice(), trench: state.trench.slice(), height: state.height.slice(), totals: { ...state.totals },
    discharge: state.discharge.slice(),
    group: state.group.slice(), contact: new Map(state.contact), weldTime: state.weldTime.slice(), born: state.born.slice(),
    hotspots: state.hotspots.map((h) => ({ ...h })), events: state.events.map((e) => ({ ...e })), begun: state.begun.slice(),
    gather: state.gather ? [...state.gather] as [number, number, number] : null, scatter: state.scatter ? [...state.scatter] as [number, number, number] : null,
  };
}

/** The group a plate is welded into (union-find, with path halving). */
export function groupOf(state: { group: number[] }, p: number): number {
  const g = state.group;
  while (g[p] !== p) { g[p] = g[g[p]]; p = g[p]; }
  return p;
}

/** A random axis, uniform over the sphere. */
export function randomPole(rng: () => number): [number, number, number] {
  const z = 2 * rng() - 1, a = 2 * Math.PI * rng(), r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}

/** The share of a plate's area that is continental crust. */
export function continentalShare(state: TectonicState, p: Plate): number {
  let all = 0, cont = 0;
  const A = state.mesh.area;
  for (let c = 0; c < state.mesh.n; c++) {
    if (!p.member[c]) continue;
    all += A[c];
    if (p.kind[c] === CRUST.continental) cont += A[c];
  }
  return all > 0 ? cont / all : 0;
}

/**
 * Sets plates welded together (or one plate) turning as one about an axis at the speed their vigour and load give
 * (km/Myr at 90° from the pole): with Earth-like vigour an oceanic plate pulled by long slabs moves about 9 cm a year
 * (the Pacific), a continental one with no trench about 1.5 (keel drag; Forsyth and Uyeda 1975). `slabShare` is the
 * share of the plates' edges where they go down at a trench.
 */
export function setMotion(state: TectonicState, plates: Plate | Plate[], axis: [number, number, number], jitter: number, slabShare = 0.35) {
  const { params } = state;
  const list = Array.isArray(plates) ? plates : [plates];
  const A = state.mesh.area;
  let all = 0, cont = 0;
  for (const p of list) for (let c = 0; c < state.mesh.n; c++) {
    if (!p.member[c]) continue;
    all += A[c];
    if (p.kind[c] === CRUST.continental) cont += A[c];
  }
  const share = all > 0 ? cont / all : 0;
  const vigor = params.regime === 'stagnant-lid' ? 0 : params.vigor;
  // Slab pull dominates (Forsyth and Uyeda 1975): plates with long trenches move fastest.
  const speed = EARTH_SPEED * vigor * (0.45 + 1.3 * slabShare) * (1.2 - 0.7 * share) * jitter; // km/Myr
  const w = speed / params.radiusKm; // rad/Myr
  const r = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  for (const p of list) { p.omega[0] = (axis[0] / r) * w; p.omega[1] = (axis[1] / r) * w; p.omega[2] = (axis[2] / r) * w; }
}

/** The plates of each group (welded plates together), by the group's id. */
export function groups(state: TectonicState): Map<number, Plate[]> {
  const out = new Map<number, Plate[]>();
  for (const p of state.plates) {
    const g = groupOf(state, p.id);
    let list = out.get(g);
    if (!list) out.set(g, (list = []));
    list.push(p);
  }
  return out;
}

/** Fractal noise in [-1, 1] (about). */
export function fbm(noise: (x: number, y: number, z: number) => number, x: number, y: number, z: number, octaves: number): number {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { s += a * noise(x * f, y * f, z * f); norm += a; a *= 0.5; f *= 2; }
  return s / norm;
}

/** The value below which the given share of the area lies. */
export function quantileByArea(v: ArrayLike<number>, area: ArrayLike<number>, share: number): number {
  const n = v.length;
  if (share <= 0) return -Infinity;
  if (share >= 1) return Infinity;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b]);
  let total = 0;
  for (let i = 0; i < n; i++) total += area[i];
  let acc = 0;
  for (const i of order) { acc += area[i]; if (acc >= share * total) return v[i]; }
  return v[order[n - 1]];
}

/** A binary heap of (key, cell, label) with the smallest key on top. */
export class MinHeap {
  private k: number[] = [];
  private c: number[] = [];
  private l: number[] = [];
  get size() { return this.k.length; }
  push(key: number, cell: number, label: number) {
    const { k, c, l } = this;
    let i = k.length;
    k.push(key); c.push(cell); l.push(label);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; c[i] = c[p]; l[i] = l[p];
      i = p;
    }
    k[i] = key; c[i] = cell; l[i] = label;
  }
  pop(): [number, number, number] {
    const { k, c, l } = this;
    const top: [number, number, number] = [k[0], c[0], l[0]];
    const key = k.pop()!, cell = c.pop()!, label = l.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i, mk = key;
        if (a < n && k[a] < mk) { m = a; mk = k[a]; }
        if (b < n && k[b] < mk) { m = b; }
        if (m === i) break;
        k[i] = k[m]; c[i] = c[m]; l[i] = l[m];
        i = m;
      }
      k[i] = key; c[i] = cell; l[i] = label;
    }
    return top;
  }
}

/**
 * A state built by hand (for tests and, later, for events): every cell's plate and crust from a function, each
 * plate's angular velocity given (rad/Myr).
 */
export function stateFrom(params: TectonicParams, cell: (c: number, x: number, y: number, z: number) => { plate: number; kind: number; thickness: number; age: number }, omegas: Array<[number, number, number]>): TectonicState {
  const mesh = meshAt(params.level), n = mesh.n;
  const plates = omegas.map((_, i) => newPlate(i, n));
  const owner = new Int32Array(n);
  for (let c = 0; c < n; c++) {
    const v = cell(c, mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]);
    const p = plates[v.plate];
    owner[c] = v.plate;
    p.member[c] = 1; p.kind[c] = v.kind; p.thickness[c] = v.thickness; p.age[c] = v.age;
  }
  omegas.forEach((o, i) => plates[i].omega.set(o));
  return baseState(params, plates, owner, params.seed || 1);
}
