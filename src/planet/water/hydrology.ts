// Water on the land (Stage 14.8, D159): what the climate's rain becomes. Physically based water balance with
// empirical evaporation, routed through the land's depressions and down its rivers.
//
// - Evaporation that could happen (potential, PET) follows the temperature and the sunlight reaching the top of the
//   air (Hargreaves and Samani 1985, with a typical daily range of 12 K); what does happen (actual, AET) follows
//   Budyko's curve in Fu's form (Fu 1981; Zhang et al. 2004, ω = 2.6): nearly all the rain where PET far exceeds
//   it, nearly all of PET where rain far exceeds it. What is left runs off.
// - Depressions (closed hollows in the land) form a hierarchy (Barnes, Callaghan and Wickert 2020): flooding the
//   land from its pits and the sea, each hollow fills until it spills over its lowest outlet into a neighbour or the
//   sea; two that meet at an outlet merge into one, which spills at a higher outlet, and so on.
// - Lakes (Fill-Spill-Merge, Barnes, Callaghan and Wickert 2021), here at the steady state of the climate: water
//   runs into each hollow from its catchment; a hollow fills until either it spills (an open lake, overflowing on
//   towards the sea) or the evaporation from its surface (open water evaporating at PET, less the land's own
//   evaporation it replaces) balances what flows in (a closed lake, salty, with no outlet: the Caspian, the Great
//   Salt Lake, Lake Chad). A hollow full to its outlet spills into its neighbour; when both are full they become one
//   lake rising above the outlet between them. The same hierarchy filled with a given volume of water instead
//   (`fillVolume`) conserves that volume exactly.
// - Rivers: the water's surface (lakes flat at their levels) is drained from the sea and the closed lakes upwards
//   (Priority-Flood), so every drop runs downhill to the sea, a closed lake or a dry closed basin; discharge is
//   summed down the tree; rivers are where it passes a threshold scaled to the cells, with Strahler orders;
//   floodplains where large rivers run on gentle slopes; wetlands where water gathers on flat ground (a topographic
//   wetness index, Beven and Kirkby 1979) in a wet climate, or on cold, flat, poorly drained lowlands; deltas where
//   large rivers carrying sediment from high ground reach a shallow sea.
import type { Mesh } from '../mesh/icosphere.ts';
import { accumulate, drainage } from '../surface/drainage.ts';

/** Kinds of water per cell (the `water` layer). */
export const WATER = { land: 0, sea: 1, lake: 2, saltLake: 3, saltFlat: 4, river: 5, floodplain: 6, wetland: 7, delta: 8, ice: 9 } as const;

const LATENT = 2.45e6; // J/kg: so 1 W/m² evaporates 0.0353 mm a day.
const FU_OMEGA = 2.6;

export interface WaterBalance {
  /** Per cell, mm over the planet's year: rain and snow, potential and actual evaporation, what runs off (land). */
  precip: Float64Array;
  pet: Float64Array;
  aet: Float64Array;
  runoff: Float64Array;
}

/**
 * The year's water balance of every land cell from its monthly temperatures (°C), rain and snow (mm) and the sunlight
 * at the top of its air (W/m²), months of `dayLength` Earth days... (each month m of cell c at [m·n + c]).
 */
export function waterBalance(n: number, temp: ArrayLike<number>, precip: ArrayLike<number>, sun: ArrayLike<number>, land: ArrayLike<number>, daysPerMonth: number): WaterBalance {
  const P = new Float64Array(n), pet = new Float64Array(n), aet = new Float64Array(n), runoff = new Float64Array(n);
  const months = 12, range = Math.sqrt(12);
  for (let c = 0; c < n; c++) {
    let p = 0, e = 0;
    for (let m = 0; m < months; m++) {
      p += Math.max(0, precip[m * n + c]);
      const ra = (Math.max(0, sun[m * n + c]) * 86_400) / LATENT; // mm a day
      e += 0.0023 * ra * Math.max(0, temp[m * n + c] + 17.8) * range * daysPerMonth;
    }
    P[c] = p; pet[c] = e;
    aet[c] = budyko(p, e);
    runoff[c] = land[c] ? Math.max(0, p - aet[c]) : 0;
  }
  return { precip: P, pet, aet, runoff };
}

/** Actual evaporation (Fu's form of Budyko's curve) from rain P and potential evaporation E. */
export function budyko(P: number, E: number): number {
  if (P <= 0 || E <= 0) return 0;
  const phi = E / P;
  return P * (1 + phi - (1 + phi ** FU_OMEGA) ** (1 / FU_OMEGA));
}

/**
 * Straits narrower than a cell (D166): a basin below sea level as deep as an ocean's floor whose lowest way to the
 * sea crosses no more than a low sill joins the sea (the Black Sea's Bosphorus, the Red Sea's Bab-el-Mandeb, a
 * remnant ocean between continents), as a cell's mean height hides a narrow strait. A shallower hollow stays land (the
 * Caspian's basin, which reaches the sea only over the Manych and through the Black Sea).
 */
export const STRAIT = { floor: -1000, sill: 150, near: 100 };
/**
 * Rivers keep cutting the outlets of the hollows they spill from (D166): a cell's mean height hides the gorge a river
 * runs in (the Congo's through the Crystal Mountains, the Columbia's through the Cascades), so each hollow's outlet is
 * notched below the cells' heights by a share of the relief around it (at most `max` m), and the water finds its
 * hollows, lakes and rivers on that ground. Calibrated on the Earth's fresh lakes at the preview level.
 */
export const BREACH = { share: 0.25, max: 1000, depth: 0.85 };
export function notchOutlets(mesh: Mesh, height: ArrayLike<number>): Float64Array {
  const z = Float64Array.from(height);
  if (!(BREACH.share > 0)) return z;
  const ocean = straits(mesh, height, oceanMask(mesh, height)), dh = depressions(mesh, height, ocean);
  // Whether a cell floods from depression d (its leaf lies in d's tree).
  const within = (c: number, d: number) => { for (let a = dh.label[c]; a > 0; a = dh.parent[a]) if (a === d) return true; return false; };
  for (let d = 1; d < dh.count; d++) {
    const s0 = dh.spillCell[d], top = dh.outlet[d];
    if (s0 < 0 || !(top < Infinity)) continue;
    let hi = height[s0], lo = height[s0];
    for (let e = mesh.nbrStart[s0]; e < mesh.nbrStart[s0 + 1]; e++) { const j = mesh.nbr[e]; hi = Math.max(hi, height[j]); lo = Math.min(lo, height[j]); }
    // (Its deepest point: how much a river spilling from it has had to cut through.)
    let bottom = top;
    for (let a = dh.leafLo[d]; a < dh.leafHi[d]; a++) { const c = dh.cells[dh.cellStart[a]]; if (c >= 0) bottom = Math.min(bottom, height[c]); }
    const floor = top - Math.min(BREACH.max, Math.max(BREACH.share * Math.max(0, hi - Math.max(lo, 0)), BREACH.depth * (top - bottom)));
    if (!(floor < top)) continue;
    // The rim on the hollow's side, then a channel from the outlet downhill until the ground is lower already (or
    // the sea): carved, never dug, so it makes no new hollow.
    // From the lowest rim cell inward, down the hollow's slope until below the notch (crossing a plateau to its hollow).
    let rim = -1;
    for (let e = mesh.nbrStart[s0]; e < mesh.nbrStart[s0 + 1]; e++) { const a = mesh.nbr[e]; if (!ocean[a] && within(a, d) && (rim < 0 || height[a] < height[rim])) rim = a; }
    // (Each channel falls a centimetre a cell towards the outlet and beyond, so the water's way along it is never flat.)
    for (let cur = rim, steps = 0; cur >= 0 && steps < 64 && height[cur] >= floor; steps++) {
      z[cur] = Math.min(z[cur], floor + 0.01 * (steps + 1));
      let next = -1, best = Infinity;
      for (let e = mesh.nbrStart[cur]; e < mesh.nbrStart[cur + 1]; e++) { const j = mesh.nbr[e]; if (within(j, d) && height[j] < best) { best = height[j]; next = j; } }
      if (next < 0 || best >= height[cur]) {
        // (A flat: carry on towards the lowest neighbour, or stop.)
        if (next < 0 || best > height[cur]) break;
      }
      cur = next;
    }
    for (let cur = s0, steps = 0; steps < 64 && !ocean[cur] && height[cur] >= floor; steps++) {
      z[cur] = Math.min(z[cur], floor - 0.01 * steps);
      let next = -1, best = Infinity;
      for (let e = mesh.nbrStart[cur]; e < mesh.nbrStart[cur + 1]; e++) { const j = mesh.nbr[e]; if (!within(j, d) && height[j] < best) { best = height[j]; next = j; } }
      if (next < 0) break;
      cur = next;
    }
  }
  return z;
}
export function straits(mesh: Mesh, z: ArrayLike<number>, ocean: Uint8Array): Uint8Array {
  const n = mesh.n, pass = new Float64Array(n).fill(Infinity), heap = new Heap();
  // The lowest pass on the way from the sea to each cell (flooding from the sea by level).
  for (let c = 0; c < n; c++) if (ocean[c]) { pass[c] = z[c]; heap.push(z[c], c); }
  const done = new Uint8Array(n);
  while (heap.size) {
    const c = heap.pop();
    if (done[c]) continue;
    done[c] = 1;
    for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
      const j = mesh.nbr[e], v = Math.max(pass[c], z[j]);
      if (v < pass[j]) { pass[j] = v; heap.push(v, j); }
    }
  }
  const out = Uint8Array.from(ocean), comp = new Int32Array(n).fill(-1), stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || ocean[s] || !(z[s] < 0)) continue;
    const cells: number[] = [];
    let floor = 0, sill = Infinity;
    comp[s] = s; stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c); floor = Math.min(floor, z[c]); sill = Math.min(sill, pass[c]);
      for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
        const j = mesh.nbr[e];
        if (comp[j] < 0 && !ocean[j] && z[j] < 0) { comp[j] = s; stack.push(j); }
      }
    }
    if (floor < STRAIT.floor && sill < STRAIT.sill) for (const c of cells) out[c] = 1;
  }
  return out;
}

/** The sea: cells below sea level joined to large bodies (a hollow below sea level far inland is land, as the Caspian's basin). */
export function oceanMask(mesh: Mesh, z: ArrayLike<number>, minShare = 0.005): Uint8Array {
  const n = mesh.n, comp = new Int32Array(n).fill(-1), out = new Uint8Array(n);
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || !(z[s] < 0)) continue;
    const cells: number[] = [];
    let area = 0;
    comp[s] = s; stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c); area += mesh.area[c];
      for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
        const j = mesh.nbr[e];
        if (comp[j] < 0 && z[j] < 0) { comp[j] = s; stack.push(j); }
      }
    }
    if (area >= minShare * 4 * Math.PI) for (const c of cells) out[c] = 1;
  }
  return out;
}

/** The hierarchy of a surface's depressions (heights in m; `ocean` marks the sea). Depression 0 is the sea. */
export interface Depressions {
  /** Per cell: the leaf depression it floods from (0: the sea), and its flood level (the lowest level at which water from there reaches it, m). */
  label: Int32Array;
  /** Per cell: the leaf depression (0: the sea) its water runs down into, always downhill (steepest descent to a pit). */
  drain: Int32Array;
  level: Float64Array;
  /** Depressions 1 … count − 1: leaves (a pit each) and merged ones (two children each). */
  count: number;
  parent: Int32Array;
  kidA: Int32Array;
  kidB: Int32Array;
  /** The level it spills at (Infinity: never), and the cell beyond its outlet it spills into (-1: none). */
  outlet: Float64Array;
  spillCell: Int32Array;
  /** For depressions that spill towards the sea (directly or through others): the order in which they joined it (-1: never). */
  joined: Int32Array;
  /** Each depression's cells: cells[cellStart[leafLo[d]] … cellStart[leafHi[d]]), each leaf's in flood order. */
  leafLo: Int32Array;
  leafHi: Int32Array;
  cellStart: Int32Array;
  cells: Int32Array;
  rank: Int32Array;
}

/** A binary heap of cells by key (ties by cell index, so results never depend on the heap's order). */
class Heap {
  k: number[] = [];
  c: number[] = [];
  get size() { return this.k.length; }
  push(key: number, cell: number) {
    const hk = this.k, hc = this.c;
    let i = hk.length;
    hk.push(key); hc.push(cell);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] < key || (hk[p] === key && hc[p] < cell)) break;
      hk[i] = hk[p]; hc[i] = hc[p]; i = p;
    }
    hk[i] = key; hc[i] = cell;
  }
  pop(): number {
    const hk = this.k, hc = this.c;
    const top = hc[0], k = hk.pop()!, c = hc.pop()!;
    const m = hk.length;
    if (m) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let j = i, jk = k, jc = c;
        if (a < m && (hk[a] < jk || (hk[a] === jk && hc[a] < jc))) { j = a; jk = hk[a]; jc = hc[a]; }
        if (b < m && (hk[b] < jk || (hk[b] === jk && hc[b] < jc))) j = b;
        if (j === i) break;
        hk[i] = hk[j]; hc[i] = hc[j]; i = j;
      }
      hk[i] = k; hc[i] = c;
    }
    return top;
  }
}

export function depressions(mesh: Mesh, z: ArrayLike<number>, ocean: ArrayLike<number>): Depressions {
  const { n, nbrStart, nbr } = mesh;
  const label = new Int32Array(n).fill(-1), level = new Float64Array(n);
  const heap = new Heap();
  for (let c = 0; c < n; c++) if (ocean[c]) { label[c] = 0; level[c] = z[c]; heap.push(z[c], c); }
  // Pits: land cells with no lower land neighbour (ties by index) and no sea beside them.
  let count = 1;
  const pits: number[] = [0];
  for (let c = 0; c < n; c++) {
    if (ocean[c]) continue;
    let pit = true;
    for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) {
      const j = nbr[e];
      if (ocean[j] || z[j] < z[c] || (z[j] === z[c] && j < c)) { pit = false; break; }
    }
    if (pit) { label[c] = count++; pits.push(c); level[c] = z[c]; heap.push(z[c], c); }
  }
  // Flood from the sea and every pit at once, by level: each cell is reached from where water reaches it lowest.
  const order: number[] = [];
  while (heap.size) {
    const c = heap.pop();
    if (!ocean[c]) order.push(c);
    for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) {
      const j = nbr[e];
      if (label[j] >= 0) continue;
      label[j] = label[c]; level[j] = Math.max(z[j], level[c]);
      heap.push(level[j], j);
    }
  }
  // Where each cell's water runs: down to its lowest neighbour (ties by index) until a pit or the sea.
  const drain = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) if (label[c] >= 0 && (ocean[c] || pits[label[c]] === c)) drain[c] = ocean[c] ? 0 : label[c];
  const path: number[] = [];
  for (let s0 = 0; s0 < n; s0++) {
    let c = s0;
    while (drain[c] < 0) {
      path.push(c);
      let low = -1;
      for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) {
        const j = nbr[e];
        if (ocean[j]) { low = j; break; }
        if (z[j] < z[c] || (z[j] === z[c] && j < c)) { if (low < 0 || z[j] < z[low] || (z[j] === z[low] && j < low)) low = j; }
      }
      c = low < 0 ? c : low;
      if (low < 0) { drain[c] = label[c]; break; }
    }
    const to = drain[c];
    for (const k of path) drain[k] = to;
    path.length = 0;
  }
  // Outlets between neighbouring depressions: the lowest level at which their floods meet.
  const best = new Map<number, number>();
  const pe: number[] = [], pa: number[] = [], pb: number[] = [], ca: number[] = [], cb: number[] = [];
  for (let c = 0; c < n; c++) {
    for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) {
      const j = nbr[e];
      if (j < c || label[j] === label[c]) continue;
      const a = Math.min(label[c], label[j]), b = Math.max(label[c], label[j]);
      const lv = Math.max(level[c], level[j]), key = a * count + b;
      const i = best.get(key);
      const inA = label[c] === a ? c : j, inB = label[c] === a ? j : c;
      if (i === undefined) { best.set(key, pe.length); pe.push(lv); pa.push(a); pb.push(b); ca.push(inA); cb.push(inB); }
      else if (lv < pe[i] || (lv === pe[i] && inA + inB * n < ca[i] + cb[i] * n)) { pe[i] = lv; ca[i] = inA; cb[i] = inB; }
    }
  }
  const idx = Array.from(pe.keys()).sort((x, y) => pe[x] - pe[y] || pa[x] - pa[y] || pb[x] - pb[y]);
  // Merging in order of their outlets (Kruskal): a set of depressions is topped by the one holding them all.
  const max = 2 * count + 1;
  const parent = new Int32Array(max).fill(-1), kidA = new Int32Array(max).fill(-1), kidB = new Int32Array(max).fill(-1);
  const outlet = new Float64Array(max).fill(Infinity), spillCell = new Int32Array(max).fill(-1), joined = new Int32Array(max).fill(-1);
  const uf = Int32Array.from({ length: count }, (_, i) => i), top = Int32Array.from({ length: count }, (_, i) => i);
  const find = (a: number) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
  let next = count, joins = 0;
  for (const i of idx) {
    const ra = find(pa[i]), rb = find(pb[i]);
    if (ra === rb) continue;
    const sea = find(0);
    if (ra === sea || rb === sea) {
      // The other side spills towards the sea: into the cell beyond its outlet, on the sea's side.
      const X = top[ra === sea ? rb : ra];
      outlet[X] = pe[i]; spillCell[X] = ra === sea ? ca[i] : cb[i]; joined[X] = joins++;
      uf[ra === sea ? rb : ra] = sea;
      continue;
    }
    const M = next++, A = top[ra], B = top[rb];
    kidA[M] = A; kidB[M] = B; parent[A] = M; parent[B] = M;
    outlet[A] = pe[i]; outlet[B] = pe[i];
    spillCell[A] = cb[i]; spillCell[B] = ca[i];
    uf[rb] = ra; top[ra] = M;
  }
  const total = next;
  // Each depression's leaves in depth-first order, so its cells are one contiguous run.
  const rank = new Int32Array(total).fill(-1), leafLo = new Int32Array(total), leafHi = new Int32Array(total);
  let r = 0;
  const visit = (root: number) => {
    const stack: Array<[number, boolean]> = [[root, false]];
    while (stack.length) {
      const [d, done] = stack.pop()!;
      if (done) { leafHi[d] = r; continue; }
      leafLo[d] = r;
      if (kidA[d] < 0) { rank[d] = r++; leafHi[d] = r; continue; }
      stack.push([d, true], [kidB[d], false], [kidA[d], false]);
    }
  };
  for (let d = 1; d < total; d++) if (parent[d] < 0) visit(d);
  const cellStart = new Int32Array(r + 1);
  for (const c of order) cellStart[rank[label[c]] + 1]++;
  for (let i = 0; i < r; i++) cellStart[i + 1] += cellStart[i];
  const fill = cellStart.slice(0, r), cells = new Int32Array(order.length);
  for (const c of order) cells[fill[rank[label[c]]]++] = c;
  return {
    label, drain, level, count: total, parent: parent.subarray(0, total), kidA: kidA.subarray(0, total), kidB: kidB.subarray(0, total),
    outlet: outlet.subarray(0, total), spillCell: spillCell.subarray(0, total), joined: joined.subarray(0, total),
    leafLo, leafHi, cellStart, cells, rank,
  };
}

export interface LakeResult {
  /** Per cell: the water's surface where a lake lies (m; NaN elsewhere) and the depression it belongs to (-1: none). */
  surface: Float64Array;
  lakeOf: Int32Array;
  /** Per depression: whether it is full to its outlet (spilling), and the water flowing into it (per year, or the volume). */
  full: Uint8Array;
  inflow: Float64Array;
  /** What reached the sea, in the same units. */
  toSea: number;
  /** What the lakes took (lost by evaporation, or held), in the same units; and of that, what closed lakes and basins took. */
  held: number;
  closed: number;
}

/**
 * Lakes from water arriving on every land cell (`supply`, per cell, in m³ a year or m³) and, per cell, what a lake
 * there takes (`take`: m³ a year evaporated beyond what the land evaporated, for a lake at the climate's steady state;
 * null to fill with volumes instead: the lake then holds its volume).
 */
function settleLakes(dh: Depressions, z: ArrayLike<number>, area: ArrayLike<number>, supply: ArrayLike<number>, take: ArrayLike<number> | null): LakeResult {
  const { count, parent, kidA, kidB, outlet, spillCell, label, level, cells, cellStart, leafLo, leafHi } = dh;
  const n = label.length;
  const own = new Float64Array(count), extra = new Float64Array(count), cap = new Float64Array(count);
  const capA = new Float64Array(count), capZ = new Float64Array(count);
  // What runs into each depression (down its slopes to its pit), and what it can take when full to its outlet.
  for (let c = 0; c < n; c++) if (dh.drain[c] > 0) own[dh.drain[c]] += supply[c];
  for (let d = 1; d < count; d++) {
    if (kidA[d] >= 0) continue;
    for (let k = cellStart[dh.rank[d]]; k < cellStart[dh.rank[d] + 1]; k++) {
      const c = cells[k];
      // The lowest depression whose outlet lies above this cell's flood level holds it when full (and all above it).
      let a = d;
      while (a >= 0 && !(level[c] < outlet[a])) a = parent[a];
      if (a < 0) continue;
      if (take) cap[a] += take[c]; else { capA[a] += area[c]; capZ[a] += z[c] * area[c]; }
    }
  }
  // Sums up the tree (children are made before their parents).
  for (let d = 1; d < count; d++) {
    const p = parent[d];
    if (p < 0) continue;
    own[p] += own[d];
    if (take) cap[p] += cap[d]; else { capA[p] += capA[d]; capZ[p] += capZ[d]; }
  }
  if (!take) for (let d = 1; d < count; d++) cap[d] = outlet[d] === Infinity ? Infinity : outlet[d] * capA[d] - capZ[d];
  for (let d = 1; d < count; d++) if (outlet[d] === Infinity) cap[d] = Infinity;
  const surface = new Float64Array(n).fill(NaN), lakeOf = new Int32Array(n).fill(-1), full = new Uint8Array(count), inflow = new Float64Array(count);
  let closed = 0;
  const inTree = (leaf: number, d: number) => dh.rank[leaf] >= leafLo[d] && dh.rank[leaf] < leafHi[d];
  /** The leaf water spilling over into cell c runs down into, within `within` if given (else the flood's own). */
  const leafOf = (c: number, within = -1) => {
    const d = dh.drain[c];
    if (d > 0 && (within < 0 || inTree(d, within))) return d;
    return label[c];
  };
  const add = (from: number, x: number, upTo: number) => {
    for (let d = from; d >= 0; d = parent[d]) { extra[d] += x; if (d === upTo) return; }
  };
  const rootOf = (d: number) => { while (parent[d] >= 0) d = parent[d]; return d; };
  const into = (d: number) => own[d] + extra[d];
  /** Covers a depression's cells below a level with water at that level. */
  const cover = (d: number, h: number) => {
    for (let k = cellStart[leafLo[d]]; k < cellStart[leafHi[d]]; k++) {
      const c = cells[k];
      if (level[c] < h) { surface[c] = h; lakeOf[c] = d; }
    }
  };
  /** The level a depression's water stands at when it takes in `I` without filling (below its outlet). */
  const levelFor = (d: number, I: number): number => {
    const list: number[] = [];
    for (let k = cellStart[leafLo[d]]; k < cellStart[leafHi[d]]; k++) { const c = cells[k]; if (level[c] < outlet[d]) list.push(c); }
    list.sort((a, b) => level[a] - level[b] || a - b);
    if (!list.length || I <= 0) return list.length ? level[list[0]] : -Infinity;
    let sum = 0, A = 0, ZA = 0;
    for (let k = 0; k < list.length;) {
      // Cells at the same level go under water together.
      const L = level[list[k]];
      let g = 0, j = k;
      for (; j < list.length && level[list[j]] === L; j++) { const c = list[j]; if (take) g += take[c]; else { A += area[c]; ZA += z[c] * area[c]; } }
      const nextLevel = j < list.length ? level[list[j]] : outlet[d];
      if (take) {
        if (sum + g >= I) {
          // Water covering less than half of these cells leaves them out (a lake is drawn by whole cells).
          const frac = g > 0 ? (I - sum) / g : 1, top = Number.isFinite(nextLevel) ? nextLevel : L + 1;
          return frac < 0.5 ? L : L + Math.min(1, frac) * (top - L);
        }
        sum += g;
      } else if (!Number.isFinite(nextLevel) || nextLevel * A - ZA >= I) {
        // Volume held at the next level with every cell so far under water: the level holding I lies before it.
        return Math.max(L + 1e-9, (I + ZA) / A);
      }
      k = j;
    }
    return outlet[d];
  };
  /** Settles a depression taking in I (its own and spilled water): returns what spills out of it. */
  const settle = (d: number, I: number): number => {
    inflow[d] = I;
    if (I >= cap[d]) { full[d] = 1; cover(d, outlet[d]); fillKids(d); return I - cap[d]; }
    if (kidA[d] < 0) { cover(d, levelFor(d, I)); closed += I; return 0; }
    const a = kidA[d], b = kidB[d];
    let Ia = into(a), Ib = into(b);
    let fa = Ia >= cap[a], fb = Ib >= cap[b];
    if (fa && !fb) {
      const x = Ia - cap[a];
      add(leafOf(spillCell[a], b), x, b); Ib += x; fb = Ib >= cap[b];
      if (!fb) { inflow[a] = Ia; full[a] = 1; cover(a, outlet[a]); fillKids(a); settle(b, Ib); return 0; }
    } else if (fb && !fa) {
      const x = Ib - cap[b];
      add(leafOf(spillCell[b], a), x, a); Ia += x; fa = Ia >= cap[a];
      if (!fa) { inflow[b] = Ib; full[b] = 1; cover(b, outlet[b]); fillKids(b); settle(a, Ia); return 0; }
    }
    if (fa && fb) { inflow[a] = Ia; inflow[b] = Ib; full[a] = full[b] = 1; fillKids(a); fillKids(b); cover(d, levelFor(d, I)); closed += I; return 0; }
    settle(a, Ia); settle(b, Ib);
    return 0;
  };
  /** Marks everything under a full depression full (its water stands at its outlet over all of it). */
  const fillKids = (d: number) => {
    const stack = [kidA[d], kidB[d]];
    while (stack.length) { const k = stack.pop()!; if (k < 0) continue; full[k] = 1; stack.push(kidA[k], kidB[k]); }
  };
  // Roots: those spilling towards the sea last-joined first (what they spill goes into ones that joined earlier).
  const roots: number[] = [];
  for (let d = 1; d < count; d++) if (parent[d] < 0) roots.push(d);
  roots.sort((a, b) => dh.joined[b] - dh.joined[a] || a - b);
  // Land the sea's own flood reached (it drains straight to the sea, through no depression).
  let toSea = 0, held = 0;
  for (let c = 0; c < n; c++) if (dh.drain[c] === 0) toSea += supply[c];
  const settled = new Uint8Array(count);
  for (const R of roots) {
    const x = settle(R, into(R));
    settled[R] = 1;
    held += into(R) - x;
    if (x <= 0) continue;
    const s = spillCell[R];
    if (s < 0 || label[s] === 0 || dh.drain[s] === 0) { toSea += x; continue; }
    // Downhill from the outlet, unless that leads into a tree already settled (then where the flood leads, which joined earlier).
    let leaf = dh.drain[s] > 0 ? dh.drain[s] : label[s];
    if (settled[rootOf(leaf)]) leaf = label[s];
    add(leaf, x, rootOf(leaf));
  }
  return { surface, lakeOf, full, inflow, toSea, held, closed };
}

/** Lakes at the climate's steady state: `runoff` and `take` per cell in m³ a year (see settleLakes). */
export const steadyLakes = (dh: Depressions, z: ArrayLike<number>, area: ArrayLike<number>, runoff: ArrayLike<number>, take: ArrayLike<number>) => settleLakes(dh, z, area, runoff, take);

/** Fill-Spill-Merge with a volume of water (m³) poured on each cell: lakes hold it; the rest reaches the sea. */
export const fillVolume = (dh: Depressions, z: ArrayLike<number>, area: ArrayLike<number>, water: ArrayLike<number>) => settleLakes(dh, z, area, water, null);

export interface Hydrology {
  balance: WaterBalance;
  /** Kind of water per cell (WATER). */
  kind: Uint8Array;
  /** Discharge, m³/s (of Earth seconds), river (Strahler) order where a river runs (0 elsewhere), lake depth (m). */
  discharge: Float32Array;
  order: Uint8Array;
  lakeDepth: Float32Array;
  /** Per cell: the cell its water goes to (itself at the sea, a closed lake or a dry closed basin), and the water's
   * surface it runs down (lakes flat, depressions filled to where water leaves them; m). */
  receiver: Int32Array;
  filled: Float64Array;
  /** The sea (1), with inland hollows below sea level counted as sea only where they would fill and overflow into it. */
  ocean: Uint8Array;
  /** The threshold a river passes, m³/s. */
  riverMin: number;
  /**
   * The year's water on land, km³ (as the rivers carry it): rain and snow, evaporated by the land (all of it, as if no
   * lakes), what runs off; of that, what lakes evaporate beyond the land they cover (closed lakes and basins: all that
   * reaches them) and what reaches the sea (and what the lakes' balance alone sends there); the water standing in
   * open lakes and in salt lakes (km³).
   */
  budget: { precip: number; landEvaporation: number; runoff: number; lakeEvaporation: number; closedLakes: number; toSea: number; settledToSea: number; lakes: number; saltLakes: number };
  depressions: number;
}

export interface HydrologyInput {
  mesh: Mesh;
  radiusKm: number;
  /** Heights, m above the sea. */
  height: ArrayLike<number>;
  /** Monthly temperature (°C), rain and snow (mm), and sunlight at the top of the air (W/m²), [m·n + c]. */
  temp: ArrayLike<number>;
  precip: ArrayLike<number>;
  sun: ArrayLike<number>;
  /** Earth days in the planet's year. */
  yearDays: number;
  /** Ice thickness per cell (m): ice-covered land sheds only its meltwater, `iceRunoff` (mm a year). */
  ice?: ArrayLike<number> | null;
  iceRunoff?: ArrayLike<number> | null;
  /** A world with no sea at all (D258): no ground counts as sea, however low the gorges at its hollows' outlets cut. */
  dry?: boolean;
}

export function hydrology(input: HydrologyInput): Hydrology {
  const { mesh } = input;
  const n = mesh.n, R = input.radiusKm * 1000;
  // The ground as the water finds it: each hollow's outlet notched by the gorge a cell's mean height hides (D166).
  const z = notchOutlets(mesh, input.height);
  const area = new Float64Array(n);
  for (let c = 0; c < n; c++) area[c] = mesh.area[c] * R * R;
  const iced = (c: number) => !!input.ice && input.ice[c] > 50;
  let ocean = input.dry ? new Uint8Array(n) : straits(mesh, z, oceanMask(mesh, z));
  let land = new Uint8Array(n);
  for (let c = 0; c < n; c++) land[c] = ocean[c] ? 0 : 1;
  const balance = waterBalance(n, input.temp, input.precip, input.sun, land, input.yearDays / 12);
  const supply = new Float64Array(n), take = new Float64Array(n);
  const prepare = () => {
    // Per cell (m³ a year): water running off the land, and what a lake there would evaporate beyond the land's own.
    supply.fill(0); take.fill(0);
    for (let c = 0; c < n; c++) {
      if (!land[c]) continue;
      supply[c] = ((iced(c) ? (input.iceRunoff ? input.iceRunoff[c] : 0) : balance.runoff[c]) / 1000) * area[c];
      take[c] = iced(c) ? 0 : (Math.max(0, balance.pet[c] - balance.aet[c]) / 1000) * area[c];
    }
  };
  prepare();
  let dh = depressions(mesh, z, ocean);
  let lakes = steadyLakes(dh, z, area, supply, take);
  // An inland hollow below sea level whose water would rise to sea level or above joins the sea (its outlet is soon
  // cut down: the Black Sea); one whose lake evaporates all it gets below sea level stays a closed lake there (the
  // Caspian, the Dead Sea), or dry. A basin as deep as an ocean's whose water stands within STRAIT.near of sea level
  // joins it too (D166): a sea cut off only by a strait narrower than a cell (a Mediterranean), not a salt lake.
  const deep = new Uint8Array(lakes.surface.length > 0 ? n : 0);
  {
    const floorOf = new Map<number, number>();
    for (let c = 0; c < n; c++) { const d = lakes.lakeOf[c]; if (d >= 0) floorOf.set(d, Math.min(floorOf.get(d) ?? 0, z[c])); }
    for (let c = 0; c < n; c++) { const d = lakes.lakeOf[c]; if (d >= 0 && (floorOf.get(d) ?? 0) < STRAIT.floor) deep[c] = 1; }
  }
  const joins = (c: number) => lakes.lakeOf[c] >= 0 && (lakes.surface[c] >= 0 || (deep[c] === 1 && lakes.surface[c] >= -STRAIT.near));
  let joined = false;
  if (!input.dry) for (let c = 0; c < n; c++) {
    if (ocean[c] || !(z[c] < 0)) continue;
    if (joins(c)) { joined = true; break; }
  }
  if (joined) {
    const sea = Uint8Array.from(ocean);
    const stack: number[] = [];
    for (let c = 0; c < n; c++) {
      if (sea[c] || !(z[c] < 0) || !joins(c)) continue;
      sea[c] = 1; stack.push(c);
      while (stack.length) {
        const k = stack.pop()!;
        for (let e = mesh.nbrStart[k]; e < mesh.nbrStart[k + 1]; e++) { const j = mesh.nbr[e]; if (!sea[j] && z[j] < 0) { sea[j] = 1; stack.push(j); } }
      }
    }
    ocean = sea;
    land = new Uint8Array(n);
    for (let c = 0; c < n; c++) land[c] = ocean[c] ? 0 : 1;
    prepare();
    dh = depressions(mesh, z, ocean);
    lakes = steadyLakes(dh, z, area, supply, take);
  }
  // The water's surface: lakes flat at their levels. It drains to the sea, closed lakes and dry closed basins.
  const surface = new Float64Array(n), sink = new Uint8Array(n), hasLake = new Uint8Array(dh.count);
  for (let c = 0; c < n; c++) {
    surface[c] = Number.isNaN(lakes.surface[c]) ? z[c] : lakes.surface[c];
    if (ocean[c]) sink[c] = 1;
    else if (lakes.lakeOf[c] >= 0) { hasLake[lakes.lakeOf[c]] = 1; if (!lakes.full[lakes.lakeOf[c]]) sink[c] = 1; }
  }
  // A closed basin with no lake at all (it gets almost no water: a salt flat) drains to its pit.
  for (let d = 1; d < dh.count; d++) if (dh.kidA[d] < 0 && !lakes.full[d] && !hasLake[d]) sink[dh.cells[dh.cellStart[dh.rank[d]]]] = 1;
  const dr = drainage(mesh, surface, sink, input.radiusKm);
  // What each cell adds to the flow (m³ a year): its runoff; an open lake's evaporation is taken where its water
  // leaves it (so water running round a lake's edge straight to its outlet is reckoned the same).
  const own = new Float64Array(n);
  let precip = 0, landEvaporation = 0, runoff = 0;
  for (let c = 0; c < n; c++) {
    if (!land[c]) continue;
    const p = (balance.precip[c] / 1000) * area[c];
    precip += p; runoff += supply[c]; landEvaporation += p - supply[c];
    own[c] = supply[c];
  }
  const acc = accumulate(dr, own), accArea = accumulate(dr, area);
  // An open lake evaporates (beyond the land it covers) as much as its whole surface can, or as much as reaches it if
  // less: taken from the flow where its water leaves the lake and all the way down.
  const lakeTake = new Float64Array(dh.count), exitOf = new Int32Array(dh.count).fill(-1);
  for (let c = 0; c < n; c++) {
    const d = lakes.lakeOf[c];
    if (d < 0 || !lakes.full[d]) continue;
    lakeTake[d] += take[c];
    if (lakes.lakeOf[dr.receiver[c]] !== d || dr.receiver[c] === c) exitOf[d] = c;
  }
  let lakeEvaporation = 0;
  for (let d = 1; d < dh.count; d++) {
    const e = exitOf[d];
    if (e < 0) continue;
    const ev = Math.max(0, Math.min(lakeTake[d], acc[e]));
    lakeEvaporation += ev;
    for (let k = e, steps = 0; steps < n; steps++) { acc[k] -= ev; if (dr.receiver[k] === k) break; k = dr.receiver[k]; }
  }
  const year = input.yearDays * 86_400;
  const discharge = new Float32Array(n), kind = new Uint8Array(n), order = new Uint8Array(n), lakeDepth = new Float32Array(n);
  let landRunoff = 0, landCells = 0, routedToSea = 0, closedIn = 0;
  for (let c = 0; c < n; c++) {
    discharge[c] = Math.max(0, acc[c]) / year;
    if (land[c] && lakes.lakeOf[c] < 0) { landRunoff += supply[c]; landCells++; }
    if (ocean[c]) routedToSea += acc[c];
    else if (dr.receiver[c] === c) closedIn += acc[c];
  }
  // Rivers: three cells' worth of the land's mean runoff (at least 50 mm a year's worth).
  const cellArea = (4 * Math.PI * R * R) / n, width = Math.sqrt(cellArea);
  const riverMin = (3 * Math.max(landRunoff / Math.max(1, landCells), 0.05 * cellArea)) / year;
  // Strahler orders down the drainage tree (upstream first).
  const maxIn = new Uint8Array(n), countIn = new Uint8Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const c = dr.order[k];
    if (!land[c] || discharge[c] < riverMin) continue;
    const o = maxIn[c] === 0 ? 1 : countIn[c] >= 2 ? maxIn[c] + 1 : maxIn[c];
    order[c] = Math.min(255, o);
    const r = dr.receiver[c];
    if (r === c) continue;
    if (order[c] > maxIn[r]) { maxIn[r] = order[c]; countIn[r] = 1; } else if (order[c] === maxIn[r]) countIn[r]++;
  }
  // Highest ground upstream (sediment from mountains builds deltas).
  const highest = new Float64Array(n);
  for (let c = 0; c < n; c++) highest[c] = land[c] ? z[c] : -Infinity;
  for (let k = n - 1; k >= 0; k--) { const c = dr.order[k], r = dr.receiver[c]; if (r !== c && highest[c] > highest[r]) highest[r] = highest[c]; }
  // A lake nowhere deeper than LAKE_MIN_DEPTH over cells this large is a marsh or a seasonal flat, not a lake.
  const deepest = new Float64Array(dh.count);
  for (let c = 0; c < n; c++) { const d = lakes.lakeOf[c]; if (d >= 0) deepest[d] = Math.max(deepest[d], lakes.surface[c] - z[c]); }
  let lakeKm3 = 0, saltKm3 = 0;
  for (let c = 0; c < n; c++) {
    if (ocean[c]) { kind[c] = WATER.sea; continue; }
    // (A world with no water at all, D258: its hollows hold none, and nothing of it is lake, marsh or salt.)
    if (input.dry) continue;
    const d = lakes.lakeOf[c];
    if (d >= 0) {
      lakeDepth[c] = lakes.surface[c] - z[c];
      kind[c] = deepest[d] < LAKE_MIN_DEPTH ? (lakes.full[d] ? WATER.wetland : WATER.saltFlat) : lakes.full[d] ? WATER.lake : WATER.saltLake;
      if (lakes.full[d]) lakeKm3 += (lakeDepth[c] * area[c]) / 1e9; else saltKm3 += (lakeDepth[c] * area[c]) / 1e9;
      continue;
    }
    if (iced(c)) { kind[c] = WATER.ice; continue; }
    if (sink[c]) { kind[c] = WATER.saltFlat; continue; }
    const r = dr.receiver[c];
    const slope = r === c ? 0 : Math.max(0, z[c] - z[r]) / (dr.length[c] * 1000);
    if (order[c]) {
      kind[c] = WATER.river;
      if (order[c] >= 3 && slope < 3e-4) kind[c] = WATER.floodplain;
      // A delta: a large river bringing sediment from high ground to a shallow sea.
      if (ocean[r] && discharge[c] >= 20 * riverMin && highest[c] > 1500) {
        let shallow = false;
        for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) { const j = mesh.nbr[e]; if (ocean[j] && z[j] > -500) shallow = true; }
        if (shallow) kind[c] = WATER.delta;
      }
      continue;
    }
    // Wetlands: water gathering on flat ground (the wetness index ln(a / tan β), a the area drained per unit of
    // width) in a wet climate; or cold, flat, poorly drained lowlands (bogs over frozen ground).
    let steepest = 0;
    for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
      const j = mesh.nbr[e];
      if (!ocean[j]) steepest = Math.max(steepest, Math.abs(z[c] - z[j]) / (mesh.edgeDist[e] * R));
    }
    const twi = Math.log(accArea[c] / width / Math.max(1e-5, steepest));
    if ((twi > WETLAND.index && balance.runoff[c] > WETLAND.runoff) || (meanOf(input.temp, n, c) < -1 && steepest < WETLAND.coldSlope && balance.runoff[c] > 80 && z[c] < 500)) kind[c] = WATER.wetland;
  }
  return {
    balance, kind, discharge, order, lakeDepth, receiver: dr.receiver, filled: dr.filled, ocean, riverMin,
    budget: {
      precip: precip / 1e9, landEvaporation: landEvaporation / 1e9, runoff: runoff / 1e9, lakeEvaporation: (lakeEvaporation + closedIn) / 1e9,
      closedLakes: closedIn / 1e9, toSea: routedToSea / 1e9, settledToSea: lakes.toSea / 1e9, lakes: lakeKm3, saltLakes: saltKm3,
    },
    depressions: dh.count - 1,
  };
}

/** The least depth (m) a lake reaches somewhere to be drawn as one (shallower water over whole cells is marsh or flat). */
export const LAKE_MIN_DEPTH = 5;
/** Wetland thresholds (calibrated on the Earth, D159). */
export const WETLAND = { index: 19, runoff: 250, coldSlope: 4e-4 };

function meanOf(temp: ArrayLike<number>, n: number, c: number): number {
  let s = 0;
  for (let m = 0; m < 12; m++) s += temp[m * n + c];
  return s / 12;
}
