// One step of plate tectonics (Stage 14.2, D153): plates turn; the world is assembled from their frames; where
// plates overlap they converge (oceanic crust goes down at a trench, the denser and older first; continents,
// too buoyant to sink, collide and thicken); where they part, the gap fills with new oceanic crust split between
// them; boundaries are classified by the plates' relative motion; arcs grow above the slabs at the distance where
// a slab reaches about 110 km depth; crust ages; heights follow the crust (isostasy.ts); sea level follows the
// water. Every so often the plates' motions are reconsidered: slabs pull their plates towards their trenches
// (Forsyth and Uyeda 1975), ridges push a little, and a plate keeps part of its old motion.
import { quatRotate, velocityAt, walkNearest, advancePlate, CRUST, TAG, type Plate } from './plates.ts';
import { BOUNDARY, maxThickness, groupOf, type TectonicState } from './state.ts';
import { crustHeight, seaLevelFor } from './isostasy.ts';
import { reorganise } from './reorganise.ts';
import { applyEvents } from './events.ts';

/** What one step did (areas in steradians). */
export interface StepReport {
  created: number;
  consumed: number;
  collided: number;
  gaps: number;
  overlaps: number;
}

/** Arc magmatism: thickening at the arc's axis, km per Myr per km/Myr of convergence (0.2 km/Myr at 5 cm a year). */
const ARC_RATE = 0.004;
/** Hotspot volcanism: crust added over a plume, km per Myr at strength 1, on oceanic and on continental crust. */
const PLUME_OCEAN = 0.3, PLUME_CONTINENT = 0.08;
/** New oceanic crust, km (thicker from a hotter mantle). */
const oceanicThickness = (vigor: number) => 7 * Math.min(2.2, Math.max(1, vigor) ** 0.4);

/** A small deterministic hash of integers to [0, 1). */
export function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** How buoyant crust is (who stays on top where two plates meet): continents, then arcs, then young ocean. */
function buoyancy(p: Plate, r: number): number {
  const k = p.kind[r];
  if (k === CRUST.continental) return 1e6 + p.thickness[r];
  // Arcs and oceanic plateaus (thick oceanic crust) are too buoyant to go down: they are scraped onto margins.
  if (k === CRUST.arc || p.thickness[r] > 15) return 1e5 + p.thickness[r];
  return 1e4 - p.age[r];
}

/** Advances the state by dt Myr. */
export function step(state: TectonicState, dt: number): StepReport {
  const { mesh, plates, params } = state;
  const { n, xyz, area, nbrStart, nbr } = mesh;
  const R = params.radiusKm;
  const report: StepReport = { created: 0, consumed: 0, collided: 0, gaps: 0, overlaps: 0 };
  applyEvents(state, dt);
  const vigorNow = regimeVigor(state);
  // 1. Plates turn; crust ages.
  for (const p of plates) {
    if (vigorNow > 0) advancePlate(p, dt * vigorNow);
    for (let r = 0; r < n; r++) if (p.member[r]) { p.age[r] += dt; p.orogeny[r] += dt; }
  }
  // 2. Assemble: which plates claim each world cell (up to four claims each).
  const prevOwner = state.owner, prevRef = state.ref;
  const MAXC = 4;
  const claimP = new Int32Array(MAXC * n).fill(-1), claimR = new Int32Array(MAXC * n), claims = new Uint8Array(n);
  const v = [0, 0, 0];
  const cand = new Int32Array(8);
  for (let c = 0; c < n; c++) {
    let nc = 0;
    const add = (p: number) => { if (p < 0) return; for (let i = 0; i < nc; i++) if (cand[i] === p) return; if (nc < 8) cand[nc++] = p; };
    add(prevOwner[c]);
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) add(prevOwner[nbr[k]]);
    const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
    for (let i = 0; i < nc; i++) {
      const pid = cand[i], p = plates[pid];
      let hint = -1;
      if (prevOwner[c] === pid) hint = prevRef[c];
      else for (let k = nbrStart[c]; k < nbrStart[c + 1] && hint < 0; k++) if (prevOwner[nbr[k]] === pid) hint = prevRef[nbr[k]];
      quatRotate(p.q, x, y, z, v, true);
      const r = walkNearest(mesh, v[0], v[1], v[2], hint >= 0 ? hint : c);
      if (!p.member[r] || claims[c] >= MAXC) continue;
      claimP[MAXC * c + claims[c]] = pid; claimR[MAXC * c + claims[c]] = r; claims[c]++;
    }
  }
  // How plate b moves against plate a at cell c across their boundary: the opening rate (km/Myr; negative when
  // closing) and the whole relative speed, the boundary's direction taken from where each plate was a step ago.
  // A plate's edge sampled cell by cell is ragged, so as plates move a fraction of a cell, cells along every
  // boundary seem to open or overlap; only those where the plates really part (or close) make (or consume) crust.
  const va = [0, 0, 0], vb = [0, 0, 0];
  const motion = (c: number, a: number, b: number): { opening: number; speed: number } | null => {
    const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
    let ax = prevOwner[c] === a ? x : 0, ay = prevOwner[c] === a ? y : 0, az = prevOwner[c] === a ? z : 0;
    let bx = prevOwner[c] === b ? x : 0, by = prevOwner[c] === b ? y : 0, bz = prevOwner[c] === b ? z : 0;
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
      const j = nbr[k], o = prevOwner[j];
      if (o === a) { ax += xyz[3 * j]; ay += xyz[3 * j + 1]; az += xyz[3 * j + 2]; }
      else if (o === b) { bx += xyz[3 * j]; by += xyz[3 * j + 1]; bz += xyz[3 * j + 2]; }
    }
    if ((!ax && !ay && !az) || (!bx && !by && !bz)) return null;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    let nx = bx / lb - ax / la, ny = by / lb - ay / la, nz = bz / lb - az / la;
    const d = nx * x + ny * y + nz * z;
    nx -= d * x; ny -= d * y; nz -= d * z;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) return null;
    velocityAt(plates[a], x, y, z, va); velocityAt(plates[b], x, y, z, vb);
    const rx = vb[0] - va[0], ry = vb[1] - va[1], rz = vb[2] - va[2];
    const k = R * vigorNow;
    return { opening: ((rx * nx + ry * ny + rz * nz) / nl) * k, speed: Math.hypot(rx, ry, rz) * k };
  };
  const real = (m: { opening: number; speed: number } | null, sign: 1 | -1) => !!m && sign * m.opening > 0.25 * m.speed && sign * m.opening > 1e-9;
  // 3. Each cell's owner; where plates really converge, the one underneath loses its crust here.
  const owner = new Int32Array(n).fill(-1), ref = new Int32Array(n).fill(-1);
  const subducting = new Int32Array(n).fill(-1), slabAge = new Float32Array(n), closing = new Float32Array(n);
  const overlapCells = new Set<number>();
  const vmax = maxThickness(params.gravity);
  const order = [0, 1, 2, 3];
  for (let c = 0; c < n; c++) {
    const k = claims[c], base = MAXC * c;
    if (k === 1) { owner[c] = claimP[base]; ref[c] = claimR[base]; continue; }
    if (k === 0) continue;
    // The most buoyant claim stays on top.
    const ord = order.slice(0, k).sort((i, j) => {
      const bi = buoyancy(plates[claimP[base + i]], claimR[base + i]), bj = buoyancy(plates[claimP[base + j]], claimR[base + j]);
      return bj - bi || claimP[base + i] - claimP[base + j];
    });
    const ui = ord[0], upper = plates[claimP[base + ui]], ru = claimR[base + ui];
    let converged = false;
    for (let t = 1; t < k; t++) {
      const li = ord[t], lower = plates[claimP[base + li]], rl = claimR[base + li];
      if (!lower.member[rl]) continue;
      const m = motion(c, upper.id, lower.id);
      // Closing: the lower plate moving towards the upper's side.
      if (!m || !(m.opening < 0 && -m.opening > 0.25 * m.speed)) continue;
      converged = true;
      const rate = -m.opening;
      if (lower.kind[rl] === CRUST.oceanic) {
        report.consumed += area[c];
        subducting[c] = lower.id;
        slabAge[c] = lower.age[rl];
        closing[c] = Math.max(closing[c], rate);
        // An accretionary wedge: some of the sediment is scraped onto the plate above.
        upper.sediment[ru] += 0.3 * lower.sediment[rl];
      } else {
        // Continents (or arcs) meet: too buoyant to go down; the crust above thickens, up to what gravity allows.
        report.collided += area[c];
        const ga = groupOf(state, upper.id), gb = groupOf(state, lower.id), key = Math.min(ga, gb) * 4096 + Math.max(ga, gb);
        state.contact.set(key, (state.contact.get(key) ?? 0) + area[c]);
        // Shortening keeps the crust's volume: what is overridden thickens the crust above (beyond what gravity lets
        // it hold, the excess is taken as spread and worn away).
        upper.thickness[ru] = Math.min(vmax, upper.thickness[ru] + lower.thickness[rl]);
        if (upper.kind[ru] !== CRUST.continental && upper.thickness[ru] > 25) upper.kind[ru] = CRUST.continental;
        upper.orogeny[ru] = 0;
        upper.tags[ru] |= lower.kind[rl] === CRUST.continental && upper.kind[ru] === CRUST.continental ? TAG.suture : TAG.accreted;
        closing[c] = Math.max(closing[c], rate);
      }
      lower.member[rl] = 0;
      lower.kind[rl] = CRUST.none;
    }
    if (converged) { overlapCells.add(c); owner[c] = upper.id; ref[c] = ru; continue; }
    // Only the ragged edges overlapping: the cell stays with whoever held it.
    let pick = ui;
    for (let t = 0; t < k; t++) if (claimP[base + t] === prevOwner[c]) pick = t;
    owner[c] = claimP[base + pick]; ref[c] = claimR[base + pick];
  }
  report.overlaps = overlapCells.size;
  weld(state);
  // A cell whose crust was just consumed through another cell sharing it (two cells can fall in one cell of a
  // plate's frame) is left to the gaps below.
  for (let c = 0; c < n; c++) {
    const o = owner[c];
    if (o >= 0 && !plates[o].member[ref[c]]) { owner[c] = -1; ref[c] = -1; claims[c] = 0; }
  }
  // Cells no plate claims: a real gap where plates part; elsewhere a ragged edge, kept by the plate that held it.
  for (let c = 0; c < n; c++) {
    if (claims[c] !== 0) continue;
    const a = prevOwner[c];
    if (a < 0) continue;
    let b = -1;
    for (let k = nbrStart[c]; k < nbrStart[c + 1] && b < 0; k++) {
      const j = nbr[k];
      for (let t = 0; t < claims[j]; t++) if (claimP[MAXC * j + t] !== a) { b = claimP[MAXC * j + t]; break; }
    }
    if (b >= 0 && real(motion(c, a, b), 1)) continue;
    // Kept: the nearest of the plate's own cells around the point.
    const p = plates[a];
    quatRotate(p.q, xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], v, true);
    const r = walkNearest(mesh, v[0], v[1], v[2], prevRef[c] >= 0 ? prevRef[c] : c);
    let best = -1, bd = -Infinity;
    for (let e = nbrStart[r]; e < nbrStart[r + 1]; e++) {
      const r2 = nbr[e];
      if (!p.member[r2]) continue;
      const d = v[0] * xyz[3 * r2] + v[1] * xyz[3 * r2 + 1] + v[2] * xyz[3 * r2 + 2];
      if (d > bd) { bd = d; best = r2; }
    }
    if (best >= 0) { owner[c] = a; ref[c] = best; }
  }
  // 4. Divergence: gaps fill with new oceanic crust, split between the plates on either side.
  const gapPlate = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < n; c++) if (owner[c] < 0) frontier.push(c);
  report.gaps = frontier.length;
  // Gap cells go to a neighbouring plate. Which side of a ridge gets a step's new crust alternates from step to step
  // for each pair of plates (not cell by cell), so each side gets half, in stripes, like the sea floor's own
  // magnetic stripes, instead of a speckle of both plates' crust.
  const pairWinner = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return ((state.steps + Math.floor(hash01(params.seed, lo, hi) * 2)) & 1) ? hi : lo;
  };
  const tally = new Map<number, number>();
  let pending = frontier;
  while (pending.length) {
    const next: number[] = [], chosen: Array<[number, number]> = [];
    for (const c of pending) {
      tally.clear();
      for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
        const j = nbr[k], o = owner[j] >= 0 ? owner[j] : gapPlate[j];
        if (o >= 0) tally.set(o, (tally.get(o) ?? 0) + 1);
      }
      if (!tally.size) { next.push(c); continue; }
      // The two plates most around the cell; the pair's turn decides.
      const ranked = [...tally.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
      chosen.push([c, ranked.length === 1 ? ranked[0][0] : pairWinner(ranked[0][0], ranked[1][0])]);
    }
    if (!chosen.length) break;
    for (const [c, p] of chosen) gapPlate[c] = p;
    pending = next;
  }
  const thick = oceanicThickness(params.vigor);
  const flood: number[] = [];
  for (const c of frontier) {
    const pid = gapPlate[c];
    if (pid < 0) continue;
    const p = plates[pid];
    let hint = -1;
    for (let k = nbrStart[c]; k < nbrStart[c + 1] && hint < 0; k++) if (owner[nbr[k]] === pid) hint = ref[nbr[k]];
    quatRotate(p.q, xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], v, true);
    const r = walkNearest(mesh, v[0], v[1], v[2], hint >= 0 ? hint : c);
    owner[c] = pid; ref[c] = r;
    report.created += area[c];
    if (!p.member[r]) { newCrust(state, p, r, c, thick, dt); flood.push(pid, r, c); }
  }
  // Cells of a plate's frame whose centres lie in its share of the gap get crust too (none is left out).
  while (flood.length) {
    const c = flood.pop()!, r = flood.pop()!, pid = flood.pop()!;
    const p = plates[pid];
    for (let k = nbrStart[r]; k < nbrStart[r + 1]; k++) {
      const r2 = nbr[k];
      if (p.member[r2]) continue;
      quatRotate(p.q, xyz[3 * r2], xyz[3 * r2 + 1], xyz[3 * r2 + 2], v);
      const g = walkNearest(mesh, v[0], v[1], v[2], c);
      if (gapPlate[g] !== pid || owner[g] !== pid) continue;
      copyCrust(p, r, r2);
      flood.push(pid, r2, g);
    }
  }
  state.owner = owner; state.ref = ref;
  // 5. Boundaries, by relative motion across them: for each pair of plates meeting at a cell, the boundary's normal
  // from where each plate lies around it, and the relative velocity split into opening (or closing) and sliding.
  const vi = [0, 0, 0], vj = [0, 0, 0];
  state.boundary.fill(0); state.boundaryRate.fill(0);
  for (let c = 0; c < n; c++) {
    const pc = owner[c];
    if (pc < 0) continue;
    const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
    let bestKind = 0, bestRate = 0, bestMag = 0;
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
      const pj = owner[nbr[k]];
      if (pj === pc || pj < 0) continue;
      let seen = false;
      for (let k2 = nbrStart[c]; k2 < k; k2++) if (owner[nbr[k2]] === pj) seen = true;
      if (seen) continue;
      let ax = x, ay = y, az = z, bx = 0, by = 0, bz = 0;
      for (let k2 = nbrStart[c]; k2 < nbrStart[c + 1]; k2++) {
        const j = nbr[k2];
        if (owner[j] === pc) { ax += xyz[3 * j]; ay += xyz[3 * j + 1]; az += xyz[3 * j + 2]; }
        else if (owner[j] === pj) { bx += xyz[3 * j]; by += xyz[3 * j + 1]; bz += xyz[3 * j + 2]; }
      }
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
      let nx = bx / lb - ax / la, ny = by / lb - ay / la, nz = bz / lb - az / la;
      const d = nx * x + ny * y + nz * z;
      nx -= d * x; ny -= d * y; nz -= d * z;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      velocityAt(plates[pc], x, y, z, vi); velocityAt(plates[pj], x, y, z, vj);
      const rx = (vj[0] - vi[0]) * R * vigorNow, ry = (vj[1] - vi[1]) * R * vigorNow, rz = (vj[2] - vi[2]) * R * vigorNow;
      const vn = rx * nx + ry * ny + rz * nz, vt = Math.hypot(rx - vn * nx, ry - vn * ny, rz - vn * nz);
      const mag = Math.hypot(vn, vt);
      if (mag <= bestMag) continue;
      bestMag = mag;
      bestKind = Math.abs(vn) >= 0.5 * vt ? (vn > 0 ? BOUNDARY.divergent : BOUNDARY.convergent) : BOUNDARY.transform;
      bestRate = vn;
    }
    if (gapPlate[c] >= 0) { bestKind = BOUNDARY.divergent; bestRate = Math.max(bestRate, 1e-6); }
    if (overlapCells.has(c)) { bestKind = BOUNDARY.convergent; bestRate = -Math.max(Math.abs(bestRate), closing[c]); }
    state.boundary[c] = bestKind; state.boundaryRate[c] = bestRate;
  }
  // The trench: the cells of the plate going down next to where it goes down.
  state.trench.fill(0);
  for (let c = 0; c < n; c++) {
    if (subducting[c] < 0) continue;
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) if (owner[nbr[k]] === subducting[c]) state.trench[nbr[k]] = 1;
  }
  state.subducting = subducting;
  // 6. Arcs above the slabs.
  growArcs(state, subducting, slabAge, closing, dt, vmax);
  // Hotspots.
  plumes(state, dt, vmax);
  // 7. Heights and the sea.
  heights(state);
  // 8. Motions reconsidered now and then.
  state.time += dt; state.steps++;
  if (state.time >= state.nextReorganisation) reorganise(state);
  state.totals.created += report.created; state.totals.consumed += report.consumed; state.totals.collided += report.collided;
  return report;
}

/**
 * New crust in a gap at world cell c, for plate p at cell r of its frame. Where the plate's crust beside the gap is
 * continental, the continent stretches (McKenzie 1978): the new cell takes half the thickness of its continental
 * neighbours, which thin by as much, so the crust's volume is kept while it spreads and thins step by step; warm,
 * marked as rifted. Once the margin is thinner than about 24 km it breaks, and the sea floor starts. Elsewhere new
 * oceanic crust.
 */
function newCrust(state: TectonicState, p: Plate, r: number, c: number, oceanic: number, dt: number) {
  const { mesh, owner, ref } = state;
  const from: number[] = [];
  let thick = 0, age = 0;
  for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
    const j = mesh.nbr[e];
    if (owner[j] !== p.id || ref[j] < 0) continue;
    const rj = ref[j];
    if (!p.member[rj] || p.kind[rj] !== CRUST.continental || from.includes(rj)) continue;
    from.push(rj); thick += p.thickness[rj]; age += p.age[rj];
  }
  p.member[r] = 1; p.orogeny[r] = 1e4; p.sediment[r] = 0; p.tags[r] = 0;
  const k = from.length, mean = k ? thick / k : 0;
  if (k >= 2 && mean >= 24) {
    const share = 0.5 * mean;
    for (const rj of from) { p.thickness[rj] -= share / k; p.orogeny[rj] = 0; p.tags[rj] |= TAG.rift; }
    p.kind[r] = CRUST.continental; p.thickness[r] = share; p.age[r] = age / k; p.orogeny[r] = 0; p.tags[r] = TAG.rift;
  } else {
    p.kind[r] = CRUST.oceanic; p.thickness[r] = oceanic; p.age[r] = dt / 2;
  }
}

function copyCrust(p: Plate, from: number, to: number) {
  p.member[to] = 1; p.kind[to] = p.kind[from]; p.thickness[to] = p.thickness[from]; p.age[to] = p.age[from];
  p.orogeny[to] = p.orogeny[from]; p.sediment[to] = p.sediment[from]; p.tags[to] = p.tags[from];
}

/**
 * Continents that have collided over a wide enough front are welded into one: the plates move together until their
 * motions are next reconsidered, as their convergence would have slowed and stopped (India and Asia still converge,
 * slowly). The threshold is about the area India's front has consumed: 0.3 per cent of the planet's surface.
 */
function weld(state: TectonicState) {
  const limit = 0.003 * 4 * Math.PI;
  for (const [key, a] of state.contact) {
    if (a < limit) continue;
    state.contact.delete(key);
    const ga = groupOf(state, Math.floor(key / 4096)), gb = groupOf(state, key % 4096);
    if (ga === gb) continue;
    state.group[gb] = ga;
    for (const p of state.plates) { const g = groupOf(state, p.id); if (g === ga && state.weldTime[p.id] === Infinity) state.weldTime[p.id] = state.time; }
    // The welded group turns about the area-weighted mean of its plates' rotations.
    const members = state.plates.filter((p) => groupOf(state, p.id) === ga);
    const o = [0, 0, 0];
    for (const p of members) {
      let A = 0;
      for (let c = 0; c < state.mesh.n; c++) if (p.member[c]) A += state.mesh.area[c];
      for (let i = 0; i < 3; i++) o[i] += A * p.omega[i];
    }
    let total = 0;
    for (const p of members) for (let c = 0; c < state.mesh.n; c++) if (p.member[c]) total += state.mesh.area[c];
    for (const p of members) for (let i = 0; i < 3; i++) p.omega[i] = o[i] / (total || 1);
  }
}

/** How fast plates move now under the regime: steadily, never, or in bursts (a fifth of the time). */
export function regimeVigor(state: TectonicState): number {
  const { regime } = state.params;
  if (regime === 'stagnant-lid') return 0;
  if (regime === 'episodic') {
    const phase = (state.time % 300) / 300;
    return phase < 0.2 ? 4 : 0.05;
  }
  return 1;
}

/**
 * Arcs: on each plate above a slab, the distance from the trench (a search over the plate's cells), and crust
 * added around the arc's axis, where the slab reaches about 110 km depth: 110 km / tan(dip), the dip steeper for
 * older, colder slabs (30° when young, 60° when 100 million years old or more).
 */
function growArcs(state: TectonicState, subducting: Int32Array, slabAge: Float32Array, closing: Float32Array, dt: number, vmax: number) {
  const { mesh, plates, params, owner, ref } = state;
  const { n, nbrStart, nbr, edgeDist } = mesh;
  const R = params.radiusKm;
  const dist = new Float64Array(n).fill(Infinity), seedOf = new Int32Array(n).fill(-1);
  const heap: Array<[number, number]> = [];
  const push = (d: number, c: number) => { heap.push([d, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= d) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let c = 0; c < n; c++) if (subducting[c] >= 0) { dist[c] = 0; seedOf[c] = c; push(0, c); }
  if (!heap.length) return;
  const reach = 450; // km
  while (heap.length) {
    const [d, c] = pop();
    if (d > dist[c] || d > reach) continue;
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
      const j = nbr[k];
      if (owner[j] !== owner[c]) continue;
      const nd = d + edgeDist[k] * R;
      if (nd < dist[j]) { dist[j] = nd; seedOf[j] = seedOf[c]; push(nd, j); }
    }
  }
  // The arc is at least a cell wide, so coarse meshes still show it.
  const spacing = Math.sqrt((4 * Math.PI) / n) * R;
  const sigma = Math.max(45, 0.6 * spacing);
  for (let c = 0; c < n; c++) {
    const s = seedOf[c];
    if (s < 0 || owner[c] < 0) continue;
    const dip = ((30 + 30 * Math.min(1, slabAge[s] / 100)) * Math.PI) / 180;
    const axis = 110 / Math.tan(dip);
    const g = Math.exp(-((dist[c] - axis) ** 2) / (2 * sigma * sigma));
    if (g < 0.02) continue;
    const p = plates[owner[c]], r = ref[c];
    const dh = ARC_RATE * closing[s] * dt * g * state.volcanism;
    p.thickness[r] = Math.min(vmax, p.thickness[r] + dh);
    if (dh > 0.01) p.orogeny[r] = 0;
    if (dh > 0.01) p.tags[r] |= TAG.arc;
    if (p.kind[r] === CRUST.oceanic && p.thickness[r] > 12) p.kind[r] = CRUST.arc;
    if (p.kind[r] === CRUST.arc && p.thickness[r] > 25) p.kind[r] = CRUST.continental;
  }
}

/** Heights of every cell from its crust, lightly smoothed (regional compensation), trenches, and the sea level. */
export function heights(state: TectonicState) {
  const { mesh, plates, owner, ref, params } = state;
  const { n, nbrStart, nbr, area } = mesh;
  const raw = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const p = plates[owner[c]], r = ref[c];
    if (!p) { raw[c] = -3; continue; }
    let h = crustHeight(p.kind[r], p.thickness[r], p.age[r]);
    // Sediment adds what it weighs less than the mantle it displaces; young mountains and arcs stand higher while hot.
    h += 0.3 * p.sediment[r] + 0.4 * Math.exp(-p.orogeny[r] / 40);
    if (state.trench[c]) h -= 2.5;
    raw[c] = h;
  }
  const out = state.height;
  for (let c = 0; c < n; c++) {
    let s = 0, k = 0;
    for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) { s += raw[nbr[e]]; k++; }
    out[c] = 0.75 * raw[c] + 0.25 * (s / k);
  }
  state.seaLevel = seaLevelFor(out, area, params.oceanFraction);
}

/**
 * Mantle plumes, fixed in the mantle's frame, build volcanoes on whatever plate passes over them: on the sea floor a
 * chain of islands and seamounts ageing away from the plume (and sinking as their crust ages), on continents
 * volcanic provinces; over a plate that never moves (a stagnant lid), one ever larger shield, as tall as the
 * planet's gravity lets it stand (Olympus Mons on Mars).
 */
function plumes(state: TectonicState, dt: number, vmax: number) {
  const { mesh, plates, owner, ref } = state;
  for (const h of state.hotspots) {
    if (state.time + dt <= h.start || state.time >= h.end) continue;
    const c = walkNearest(mesh, h.x, h.y, h.z, h.cell);
    h.cell = c;
    const add = (cell: number, share: number) => {
      const p = plates[owner[cell]], r = ref[cell];
      if (!p || r < 0 || !p.member[r]) return;
      const rate = p.kind[r] === CRUST.continental ? PLUME_CONTINENT : PLUME_OCEAN;
      p.thickness[r] = Math.min(vmax, p.thickness[r] + rate * h.strength * state.volcanism * dt * share);
      p.orogeny[r] = 0;
      p.tags[r] |= TAG.hotspot | (h.edited ? TAG.edited : 0);
    };
    add(c, 1);
    for (let k = mesh.nbrStart[c]; k < mesh.nbrStart[c + 1]; k++) add(mesh.nbr[k], 0.25);
  }
}
