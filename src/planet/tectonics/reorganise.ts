// Plate motions reconsidered (Stage 14.2, D153; 14.3, D154). Every 40 to 90 million years:
//  - slabs pull a plate towards the trenches where it goes down, ridges push it away from where it parts (Forsyth
//    and Uyeda 1975), and a plate keeps half its old direction;
//  - continents welded at a collision stay welded until the weld breaks where it was sewn (the Wilson cycle):
//    welded groups that have grown large or old rift apart along their old sutures;
//  - a plate grown too large, or carrying a large continent for long (heat builds up beneath it), splits along a
//    ragged line, its parts moving apart: rifts, and in time new oceans;
//  - where old oceanic crust has long bordered a continent on the same plate, subduction may begin there: the ocean
//    becomes a plate of its own moving towards the continent (Stern 2004); old sea floor far from any trench
//    founders within the ocean, the plate splitting across it with its parts closing;
//  - while a timeline event gathers continents (a supercontinent) or scatters them (a break-up), continents move
//    towards or away from its centre.
import { BOUNDARY, groupOf, groups, rand, randomPole, setMotion, splitPlate, memberCounts, type TectonicState } from './state.ts';
import { CRUST, TAG, quatRotate, type Plate } from './plates.ts';
import { simplex3 } from '../../terrain/planet.ts';

type V3 = [number, number, number];

/**
 * When old sea floor begins to go down (D154; D166): at a passive margin, crust older than `marginAge` Myr along a
 * continent on the same plate, with a `marginChance` at each reorganisation; anywhere (on a welded plate too, with
 * trenches or not: `trenchShare`, `welded`), a plate's floor older than `founderAge` covering more than `founderArea`
 * of the sphere founders with a `founderChance`. Calibrated so the sea floor's mean age is about the Earth's (64 Myr)
 * and almost none outlives 180 Myr (D166: before, a tenth of it was older than 300 Myr and the deep sea too deep).
 */
export const SUBDUCTION = { marginAge: 120, marginChance: 0.5, founderAge: 130, founderArea: 0.01, founderChance: 0.5, trenchShare: 1, welded: true };
const norm = (v: number[]): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Area (sr) and continental area of each plate, and their centroids (unit vectors), from the world's cells now. */
export function plateStats(state: TectonicState) {
  const { mesh, plates, owner, ref } = state;
  const P = plates.length;
  const area = new Float64Array(P), cont = new Float64Array(P);
  const cen = plates.map(() => [0, 0, 0]), ccen = plates.map(() => [0, 0, 0]);
  for (let c = 0; c < mesh.n; c++) {
    const o = owner[c];
    if (o < 0) continue;
    const a = mesh.area[c], x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], z = mesh.xyz[3 * c + 2];
    area[o] += a; cen[o][0] += a * x; cen[o][1] += a * y; cen[o][2] += a * z;
    if (plates[o].kind[ref[c]] === CRUST.continental) { cont[o] += a; ccen[o][0] += a * x; ccen[o][1] += a * y; ccen[o][2] += a * z; }
  }
  return { area, cont, centroid: cen.map(norm), contCentroid: ccen.map((v, i) => (cont[i] > 0 ? norm(v) : norm(cen[i]))) };
}

/** The centre of all continental crust (unit), or null when there is none. */
export function continentalCentre(state: TectonicState): V3 | null {
  const s = plateStats(state);
  const v = [0, 0, 0];
  let total = 0;
  s.cont.forEach((a, i) => { total += a; for (let k = 0; k < 3; k++) v[k] += a * s.contCentroid[i][k]; });
  return total > 0 && Math.hypot(v[0], v[1], v[2]) > 1e-9 ? norm(v) : null;
}

/**
 * Splits a plate along a ragged line through a point (unit vector) in a direction (the line's normal at the point),
 * and sets the two parts moving apart at `speed` km/Myr each, on top of the motion they had. Returns the new plate.
 */
export function riftPlate(state: TectonicState, p: Plate, through: V3, normal: V3, speed: number): Plate | null {
  const { mesh } = state;
  const m = norm(normal);
  const noise = simplex3(Math.floor(rand(state) * 1e9));
  const w = [0, 0, 0];
  const side = (r: number) => {
    quatRotate(p.q, mesh.xyz[3 * r], mesh.xyz[3 * r + 1], mesh.xyz[3 * r + 2], w);
    return w[0] * m[0] + w[1] * m[1] + w[2] * m[2] + 0.12 * noise(w[0] * 4, w[1] * 4, w[2] * 4) > 0;
  };
  const q = splitPlate(state, p, side);
  if (!q) return null;
  // Rotations about an axis in the line's plane, through the point's side: each part moves away from the line.
  const e = norm(cross(m, through));
  const k = speed / state.params.radiusKm;
  for (let i = 0; i < 3; i++) { q.omega[i] -= k * e[i]; p.omega[i] += k * e[i]; }
  return q;
}

export function reorganise(state: TectonicState) {
  const { mesh, plates, owner } = state;
  const { n, xyz, nbrStart, nbr } = mesh;
  const sphere = 4 * Math.PI;
  const stats = plateStats(state);
  // The Wilson cycle: large or old welds break where they were sewn.
  for (const [g, members] of groups(state)) {
    if (members.length < 2) continue;
    const a = members.reduce((s, p) => s + stats.area[p.id], 0);
    const since = state.time - Math.min(...members.map((p) => (p.id === g ? Infinity : state.weldTime[p.id])));
    if ((a > 0.25 * sphere || since > 200) && rand(state) < 0.5) {
      for (const p of members) { state.group[p.id] = p.id; state.weldTime[p.id] = Infinity; }
      // Each part moves away from the group's centre.
      const centre = norm(members.reduce((v, p) => [v[0] + stats.area[p.id] * stats.centroid[p.id][0], v[1] + stats.area[p.id] * stats.centroid[p.id][1], v[2] + stats.area[p.id] * stats.centroid[p.id][2]], [0, 0, 0]));
      for (const p of members) setMotion(state, p, norm(cross(centre, stats.centroid[p.id])), 0.7 + 0.3 * rand(state), 0.3);
    }
  }
  // Plates too large, or carrying a large continent long enough for heat to build beneath it, split.
  const counts = memberCounts(state);
  for (const p of plates.slice()) {
    if (!counts[p.id] || groupOf(state, p.id) !== p.id || plates.some((q) => q.id !== p.id && groupOf(state, q.id) === p.id)) continue;
    const big = stats.area[p.id] > 0.3 * sphere;
    const insulating = stats.cont[p.id] > 0.12 * sphere && state.time - state.born[p.id] > 150 && rand(state) < 0.4;
    if (!big && !insulating) continue;
    const through = insulating ? stats.contCentroid[p.id] : stats.centroid[p.id];
    const t = randomPole(() => rand(state));
    const normal = norm(cross(through, t));
    const q = riftPlate(state, p, through, normal, 20);
    if (q) markRift(state, p, q);
  }
  // Subduction begins where old ocean has long bordered a continent on the same plate.
  const now = plateStats(state);
  const margin = new Float64Array(plates.length);
  for (let c = 0; c < n; c++) {
    const o = owner[c];
    if (o < 0) continue;
    const p = plates[o], r = state.ref[c];
    if (p.kind[r] !== CRUST.oceanic || p.age[r] < SUBDUCTION.marginAge) continue;
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
      const j = nbr[k];
      if (owner[j] === o && p.kind[state.ref[j]] === CRUST.continental) { margin[o]++; break; }
    }
  }
  const minMargin = Math.max(3, 0.0006 * n);
  for (const p of plates.slice()) {
    if (p.id >= now.area.length || margin[p.id] < minMargin || groupOf(state, p.id) !== p.id || rand(state) >= SUBDUCTION.marginChance) continue;
    if (!(now.cont[p.id] > 0)) continue;
    const q = splitPlate(state, p, (r) => p.kind[r] === CRUST.oceanic);
    if (!q) continue;
    // The ocean moves towards the continent, going down beneath it.
    const ocean = norm([0, 0, 0].map((_, i) => now.centroid[p.id][i] - 0.5 * now.contCentroid[p.id][i]));
    setMotion(state, q, norm(cross(ocean, now.contCentroid[p.id])), 0.9 + 0.2 * rand(state), 0.8);
  }
  // Old sea floor far from any trench founders: subduction begins within the ocean (as at Izu-Bonin-Mariana, 52
  // million years ago): the plate splits across its oldest floor, the parts closing on each other.
  const oldArea = new Float64Array(plates.length), oldCen = plates.map(() => [0, 0, 0]);
  const trenchCells = new Float64Array(plates.length), edgeCells = new Float64Array(plates.length);
  for (let c = 0; c < n; c++) {
    const o = owner[c];
    if (o < 0) continue;
    if (state.trench[c]) trenchCells[o]++;
    if (state.boundary[c] !== BOUNDARY.none) edgeCells[o]++;
    const p = plates[o], r = state.ref[c];
    if (p.kind[r] !== CRUST.oceanic || p.age[r] < SUBDUCTION.founderAge) continue;
    const a = mesh.area[c];
    oldArea[o] += a;
    oldCen[o][0] += a * xyz[3 * c]; oldCen[o][1] += a * xyz[3 * c + 1]; oldCen[o][2] += a * xyz[3 * c + 2];
  }
  for (const p of plates.slice()) {
    if (p.id >= oldArea.length || oldArea[p.id] < SUBDUCTION.founderArea * sphere || trenchCells[p.id] > SUBDUCTION.trenchShare * edgeCells[p.id] || (!SUBDUCTION.welded && groupOf(state, p.id) !== p.id)) continue;
    if (rand(state) >= SUBDUCTION.founderChance) continue;
    const through = norm(oldCen[p.id]);
    const t = randomPole(() => rand(state));
    riftPlate(state, p, through, norm(cross(through, t)), -25);
  }
  // Torques: slab pull towards trenches, ridge push away from ridges.
  const torque = plates.map(() => [0, 0, 0]);
  const edge = new Float64Array(plates.length), slab = new Float64Array(plates.length);
  for (let c = 0; c < n; c++) {
    const pc = owner[c];
    if (pc < 0) continue;
    const b = state.boundary[c];
    if (b === BOUNDARY.none) continue;
    edge[pc]++;
    if (state.trench[c]) slab[pc]++;
    const w = state.trench[c] ? 1 : b === BOUNDARY.divergent ? -0.3 : 0;
    if (!w) continue;
    const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
    for (let k = nbrStart[c]; k < nbrStart[c + 1]; k++) {
      const j = nbr[k];
      if (owner[j] === pc || owner[j] < 0) continue;
      const d = norm([xyz[3 * j] - x, xyz[3 * j + 1] - y, xyz[3 * j + 2] - z]);
      const t = torque[pc];
      t[0] += w * (y * d[2] - z * d[1]); t[1] += w * (z * d[0] - x * d[2]); t[2] += w * (x * d[1] - y * d[0]);
    }
  }
  const after = plateStats(state);
  for (const [, members] of groups(state)) {
    const t = [0, 0, 0], o = [0, 0, 0];
    let e = 0, sl = 0, area = 0, cont = 0;
    const cen = [0, 0, 0];
    for (const p of members) {
      e += edge[p.id]; sl += slab[p.id]; area += after.area[p.id]; cont += after.cont[p.id];
      for (let i = 0; i < 3; i++) { t[i] += torque[p.id][i]; o[i] += p.omega[i]; cen[i] += after.cont[p.id] * after.contCentroid[p.id][i]; }
    }
    if (area <= 0) continue;
    const slabShare = e > 0 ? Math.min(1, (2 * sl) / e) : 0;
    // Continents gathering into a supercontinent, or scattering from one.
    if (cont > 0.15 * area && (state.gather || state.scatter)) {
      const c = norm(cen), target = (state.gather ?? state.scatter)!;
      const axis = state.gather ? cross(c, target) : cross(target, c);
      if (Math.hypot(axis[0], axis[1], axis[2]) > 1e-6) { setMotion(state, members, norm(axis), 0.9 + 0.2 * rand(state), 0.7); continue; }
    }
    const tl = Math.hypot(t[0], t[1], t[2]), ol = Math.hypot(o[0], o[1], o[2]);
    const old = ol > 0 ? [o[0] / ol, o[1] / ol, o[2] / ol] : randomPole(() => rand(state));
    const pull = tl > 0 ? [t[0] / tl, t[1] / tl, t[2] / tl] : randomPole(() => rand(state));
    const wobble = randomPole(() => rand(state));
    const axis: V3 = [0.5 * old[0] + 0.45 * pull[0] + 0.15 * wobble[0], 0.5 * old[1] + 0.45 * pull[1] + 0.15 * wobble[1], 0.5 * old[2] + 0.45 * pull[2] + 0.15 * wobble[2]];
    setMotion(state, members, axis, 0.8 + 0.4 * rand(state), slabShare);
  }
  state.nextReorganisation = state.time + 40 + 50 * rand(state);
}

/** Marks the crust either side of a new rift (the cells of each part next to the other) as rifted. */
function markRift(state: TectonicState, p: Plate, q: Plate) {
  const { mesh } = state;
  for (let r = 0; r < mesh.n; r++) {
    if (!q.member[r]) continue;
    for (let k = mesh.nbrStart[r]; k < mesh.nbrStart[r + 1]; k++) {
      const j = mesh.nbr[k];
      if (p.member[j]) { q.tags[r] |= TAG.rift; p.tags[j] |= TAG.rift; }
    }
  }
}
