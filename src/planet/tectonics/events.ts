// Timeline events in a tectonic history (Stage 14.3, D154): what the user puts on the geological timeline acts
// through the same processes as everything else.
//  - supercontinent: continents move towards a centre (the one given, or the centre of all continental crust)
//    while it lasts, collide there and weld into one;
//  - breakup: welded continents part along their sutures and the largest continental plates split, then
//    continents move away from their common centre while it lasts;
//  - rift: the plate under the place given splits there, its parts moving apart;
//  - collision: continents near the place given move towards it while it lasts;
//  - volcanic period: plumes and arcs make more crust while it lasts (a multiple of usual: 1 + strength);
//  - large igneous province (lip): a flood basalt plateau, several kilometres thick, up to about a thousand
//    kilometres across, laid down over the event's length;
//  - hotspot: a new plume under the place given, while it lasts;
//  - impact: a basin with a raised rim, larger under weaker gravity;
//  - reorganisation: plate motions are reconsidered at once.
// Climate events (ice ages, greenhouse pulses, sea level) act through the climate and water stages (14.6 to 14.8).
import { CRUST, TAG } from './plates.ts';
import { rand, randomPole, groups, maxThickness, breakWelds, type TectonicEvent, type TectonicState } from './state.ts';
import { continentalCentre, plateStats, riftPlate } from './reorganise.ts';

type V3 = [number, number, number];

/** A rift's parts move apart at twice this (each way this), km/Myr per unit of strength (D154). */
export const RIFT_SPEED = 25;
/** A large igneous province: basalt `centreKm` thick at its centre, thinning over `radiusKm` (to 1/e), out to 1.5 × that. */
export const plateauSize = (strength: number) => ({ centreKm: 8 * strength, radiusKm: 800 * Math.sqrt(Math.max(0.1, strength)) });
/** An impact basin: its radius and how far its floor is lowered at the centre (km), larger under weaker gravity. */
export function craterSize(strength: number, gravity: number) {
  const radiusKm = 300 * Math.cbrt(strength) * (9.81 / Math.max(0.5, gravity)) ** 0.25;
  return { radiusKm, depthKm: Math.min(12, radiusKm / 100) };
}

const unit = (at: [number, number]): V3 => {
  const lo = (at[0] * Math.PI) / 180, la = (at[1] * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

/** Where an event happens: its own place, or one drawn for it (once, when it begins). */
function placeOf(state: TectonicState, e: TectonicEvent): V3 {
  if (e.at) return unit(e.at);
  const [x, y, z] = randomPole(() => rand(state));
  e.at = [(Math.atan2(y, x) * 180) / Math.PI, (Math.asin(z) * 180) / Math.PI];
  return [x, y, z];
}

/** Starts the events that begin before the end of this step, and applies those under way (for dt Myr). */
export function applyEvents(state: TectonicState, dt: number) {
  const t0 = state.time, t1 = state.time + dt;
  let volcanism = 1;
  let gather: V3 | null = null, scatter: V3 | null = null;
  state.events.forEach((e, i) => {
    if (!state.begun[i] && e.start < t1) { state.begun[i] = true; begin(state, e); }
    const on = e.start < t1 && e.end > t0;
    if (!on) return;
    if (e.kind === 'volcanic-period') volcanism += Math.max(0, e.strength);
    if ((e.kind === 'supercontinent' || e.kind === 'collision') && e.at) gather = unit(e.at);
    if (e.kind === 'breakup' && e.at) scatter = unit(e.at);
    if (e.kind === 'lip') floodBasalt(state, e, Math.max(0, Math.min(t1, e.end) - Math.max(t0, e.start)));
  });
  state.volcanism = volcanism;
  const changed = String(gather) !== String(state.gather) || String(scatter) !== String(state.scatter);
  state.gather = gather; state.scatter = scatter;
  if (changed) state.nextReorganisation = Math.min(state.nextReorganisation, state.time);
}

function begin(state: TectonicState, e: TectonicEvent) {
  switch (e.kind) {
    case 'supercontinent': {
      if (!e.at) {
        const c = continentalCentre(state);
        if (c) e.at = [(Math.atan2(c[1], c[0]) * 180) / Math.PI, (Math.asin(c[2]) * 180) / Math.PI];
        else placeOf(state, e);
      }
      break;
    }
    case 'collision': placeOf(state, e); break;
    case 'breakup': {
      const c = continentalCentre(state) ?? placeOf(state, e);
      e.at = e.at ?? [(Math.atan2(c[1], c[0]) * 180) / Math.PI, (Math.asin(c[2]) * 180) / Math.PI];
      // Welds break where they were sewn.
      for (const [, members] of groups(state)) breakWelds(state, members);
      // The largest continental plates split through their continents.
      const s = plateStats(state);
      const order = state.plates.map((p) => p.id).filter((i) => s.cont[i] > 0.03 * 4 * Math.PI).sort((a, b) => s.cont[b] - s.cont[a]);
      for (const id of order.slice(0, 1 + Math.round(e.strength))) {
        const p = state.plates[id], through = s.contCentroid[id];
        const t = randomPole(() => rand(state));
        const normal: V3 = [through[1] * t[2] - through[2] * t[1], through[2] * t[0] - through[0] * t[2], through[0] * t[1] - through[1] * t[0]];
        riftPlate(state, p, through, normal, RIFT_SPEED * Math.max(0.5, e.strength));
      }
      break;
    }
    case 'rift': {
      const at = placeOf(state, e);
      const c = nearestCell(state, at), o = state.owner[c];
      if (o >= 0) {
        const t = randomPole(() => rand(state));
        riftPlate(state, state.plates[o], at, [at[1] * t[2] - at[2] * t[1], at[2] * t[0] - at[0] * t[2], at[0] * t[1] - at[1] * t[0]], RIFT_SPEED * Math.max(0.5, e.strength));
        mark(state, at, 400 / state.params.radiusKm);
      }
      break;
    }
    case 'hotspot': {
      const [x, y, z] = placeOf(state, e);
      state.hotspots.push({ x, y, z, strength: Math.max(0.1, e.strength), start: e.start, end: e.end, cell: 0, edited: true });
      break;
    }
    case 'lip': placeOf(state, e); if (e.end <= e.start) floodBasalt(state, e, 1); break;
    case 'impact': crater(state, placeOf(state, e), Math.max(0.05, e.strength)); break;
    case 'reorganisation': state.nextReorganisation = state.time; break;
    default: break;
  }
}

/** The world cell nearest a point. */
export function nearestCell(state: TectonicState, p: V3): number {
  const { mesh } = state;
  let best = 0, bd = -2;
  for (let c = 0; c < mesh.n; c++) {
    const d = p[0] * mesh.xyz[3 * c] + p[1] * mesh.xyz[3 * c + 1] + p[2] * mesh.xyz[3 * c + 2];
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

/** Adds to the crust of the cells around a point: `km(d)` at angular distance d (radians). */
function around(state: TectonicState, at: V3, radius: number, km: (d: number) => number, tag: number) {
  const { mesh, plates, owner, ref } = state;
  const vmax = maxThickness(state.params.gravity);
  for (let c = 0; c < mesh.n; c++) {
    const dot = at[0] * mesh.xyz[3 * c] + at[1] * mesh.xyz[3 * c + 1] + at[2] * mesh.xyz[3 * c + 2];
    const d = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (d > radius) continue;
    const p = plates[owner[c]], r = ref[c];
    if (!p) continue;
    const dh = km(d);
    if (!dh) continue;
    p.thickness[r] = Math.max(3, Math.min(vmax, p.thickness[r] + dh));
    p.tags[r] |= tag;
    if (dh > 0) p.orogeny[r] = 0;
  }
}

/** A large igneous province: up to 8 km × strength of basalt at its centre, about 800 km × √strength across. */
function floodBasalt(state: TectonicState, e: TectonicEvent, myr: number) {
  if (!e.at) return;
  const share = e.end > e.start ? myr / (e.end - e.start) : 1;
  const size = plateauSize(e.strength), R = size.radiusKm / state.params.radiusKm;
  around(state, unit(e.at), 1.5 * R, (d) => size.centreKm * share * Math.exp(-((d / R) ** 2)), TAG.lip | TAG.edited);
}

/**
 * An impact basin: radius 300 km × strength^⅓, larger under weaker gravity (× (g⊕/g)^¼); the crust thinned enough
 * to lower the floor by about a tenth of the radius (a basin's depth to width is small at these sizes), a rim raised
 * around it.
 */
function crater(state: TectonicState, at: V3, strength: number) {
  const { radiusKm: Rkm, depthKm: depth } = craterSize(strength, state.params.gravity);
  const R = Rkm / state.params.radiusKm;
  // Thickness changes that lower (or raise) the surface by the amounts wanted, through isostasy (about 0.15 km of
  // height per km of crust).
  around(state, at, 1.4 * R, (d) => {
    const f = d / R;
    if (f <= 1) return -(depth * (1 - f * f)) / 0.15;
    return (0.15 * depth * Math.exp(-(((f - 1.1) / 0.15) ** 2))) / 0.15;
  }, TAG.impact | TAG.edited);
}

/** Marks the crust within `radius` (radians) of a point as made by an edit (D161). */
function mark(state: TectonicState, at: V3, radius: number) {
  const { mesh, plates, owner, ref } = state, cos = Math.cos(radius);
  for (let c = 0; c < mesh.n; c++) {
    if (at[0] * mesh.xyz[3 * c] + at[1] * mesh.xyz[3 * c + 1] + at[2] * mesh.xyz[3 * c + 2] < cos) continue;
    const p = plates[owner[c]];
    if (p) p.tags[ref[c]] |= TAG.edited;
  }
}

/** The crust under a world point (for tests and explanations). */
export function crustUnder(state: TectonicState, at: V3) {
  const c = nearestCell(state, at), o = state.owner[c];
  const p = state.plates[o], r = state.ref[c];
  return { cell: c, plate: o, kind: p.kind[r], thickness: p.thickness[r], age: p.age[r], tags: p.tags[r], continental: p.kind[r] === CRUST.continental };
}
