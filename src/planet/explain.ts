// "Why is this here?" (Stage 14.10, D161): what the simulation knows about a place, in numbers and in words: the
// crust under it and what made it, the plate boundary it lies on or near, why it stands high or low, its climate and
// the circulation that gives it (the convergence zone's rains, the subtropical high's sinking air, the storm belts,
// a rain shadow, a monsoon, a warm or cold current), the water on it and its biome's rule; and whether it carries the
// mark of an edit (an event placed on the timeline).
import type { PlanetDefinition } from './model/definition.ts';
import type { Derived } from './model/physics.ts';
import type { Mesh } from './mesh/icosphere.ts';
import { CRUST, TAG } from './tectonics/plates.ts';
import { BOUNDARY } from './tectonics/state.ts';
import { WATER } from './water/hydrology.ts';
import { BIOME, BIOME_IDS, KOPPEN, MOLTEN_FROM, SCORCHED_FROM, TOO_HOT_FOR_PLANTS, seasonality } from './life/biomes.ts';

export interface ExplainData {
  mesh: Mesh;
  def: PlanetDefinition;
  x: Derived;
  /** The present's heights (m above the sea), crust (kind, age Myr, thickness km, TAG bits) and boundaries (kind, km/Myr). */
  heights: ArrayLike<number>;
  /** A world with no sea (D258, D259): its heights are above its lowest ground. */
  dry?: boolean;
  kinds: ArrayLike<number>;
  age: ArrayLike<number>;
  thickness: ArrayLike<number>;
  tags: ArrayLike<number>;
  boundary: ArrayLike<number>;
  boundaryRate: ArrayLike<number>;
  climate?: { monthly: ArrayLike<number>; precipMonthly: ArrayLike<number>; currents: ArrayLike<number>; windJan: ArrayLike<number>; windJul: ArrayLike<number> } | null;
  water?: { kind: ArrayLike<number>; discharge: ArrayLike<number>; lakeDepth: ArrayLike<number>; ice: ArrayLike<number>; pet: ArrayLike<number> } | null;
  biomes?: { koppen: ArrayLike<number>; biome: ArrayLike<number>; custom: ArrayLike<number>; customNames: string[] } | null;
}

export interface Explanation {
  title: string;
  sections: Array<{ heading: string; lines: string[] }>;
}

const fmt = (v: number, d = 0) => v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
const age = (myr: number) => (myr >= 1000 ? `${fmt(myr / 1000, 1)} billion years` : `${fmt(myr)} million years`);
const deg = (r: number) => (r * 180) / Math.PI;

/** The cell nearest a longitude and latitude (degrees). */
export function cellAt(mesh: Mesh, lonDeg: number, latDeg: number): number {
  const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
  const p = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let best = 0, bd = -2;
  for (let c = 0; c < mesh.n; c++) {
    const d = p[0] * mesh.xyz[3 * c] + p[1] * mesh.xyz[3 * c + 1] + p[2] * mesh.xyz[3 * c + 2];
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

export function explain(d: ExplainData, c: number): Explanation {
  const { mesh, x } = d, n = mesh.n;
  const lat = deg(mesh.lat[c]), lon = deg(mesh.lon[c]), h = d.heights[c];
  const sections: Explanation['sections'] = [];
  const where = `${fmt(Math.abs(lat), 1)}° ${lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(lon), 1)}° ${lon >= 0 ? 'E' : 'W'}`;
  const title = `${where}: ${d.dry ? `${fmt(h)} m above the planet's lowest ground` : h >= 0 ? `${fmt(h)} m above the sea` : `${fmt(-h)} m under the sea`}`;

  // The ground: its crust and what made it.
  const ground: string[] = [];
  const kind = d.kinds[c], tags = d.tags[c];
  if (kind === CRUST.continental) ground.push(`Continental crust ${fmt(d.thickness[c])} km thick, ${age(d.age[c])} old.`);
  else if (kind === CRUST.arc) ground.push(`The thick crust of a volcanic arc, ${fmt(d.thickness[c])} km, built where one plate goes under another.`);
  else ground.push(`Oceanic crust ${age(d.age[c])} old, made at a ridge and sinking as it cools (${fmt(d.thickness[c])} km thick).`);
  const made: string[] = [];
  if (tags & TAG.suture) made.push('a suture, where continents collided and welded');
  if (tags & TAG.accreted) made.push('crust accreted to a continent\'s edge');
  if (tags & TAG.lip) made.push('a flood basalt (a large igneous province)');
  if (tags & TAG.hotspot) made.push('a hotspot\'s volcanoes');
  if (tags & TAG.rift) made.push('a rift where a plate split');
  if (tags & TAG.arc) made.push('a volcanic arc');
  if (tags & TAG.impact) made.push('an impact basin');
  if (made.length) ground.push(`Made or marked by ${made.join(', ')}.`);
  if (tags & TAG.edited) ground.push('It carries the mark of an event placed on the timeline (an edit, not the simulation\'s own).');
  // Why it stands high or low.
  if (h >= 0 && kind === CRUST.continental) {
    if (d.thickness[c] > 45) ground.push(`High because the crust is thick: pushed together to ${fmt(d.thickness[c])} km, it floats higher on the mantle (isostasy).`);
    else if (h < 300) ground.push('Low-lying: the crust is of ordinary thickness and worn down, or covered by sediment.');
  } else if (h < -4500) ground.push('Deep: old oceanic crust has cooled and sunk.');
  else if (h < 0 && kind === CRUST.continental) ground.push('A continental shelf or a flooded margin: continental crust under a shallow sea.');
  sections.push({ heading: 'The ground', lines: ground });

  // The nearest plate boundary (here or beside).
  const plate: string[] = [];
  let b = d.boundary[c], rate = d.boundaryRate[c];
  if (b === BOUNDARY.none) {
    for (let e = mesh.nbrStart[c]; e < mesh.nbrStart[c + 1]; e++) {
      const j = mesh.nbr[e];
      if (d.boundary[j] !== BOUNDARY.none) { b = d.boundary[j]; rate = d.boundaryRate[j]; break; }
    }
  }
  const cmYear = (v: number) => `${fmt(Math.abs(v) / 10, 1)} cm a year`;
  if (b === BOUNDARY.divergent) plate.push(`On a boundary where plates part (${cmYear(rate)}): ${kind === CRUST.continental ? 'a rift valley' : 'a mid-ocean ridge'} making new crust.`);
  else if (b === BOUNDARY.convergent) plate.push(`On a boundary where plates close (${cmYear(rate)}): ${kind === CRUST.continental && d.thickness[c] > 40 ? 'continents colliding, raising mountains' : 'a trench where one plate goes down, with volcanoes behind it'}.`);
  else if (b === BOUNDARY.transform) plate.push(`On a transform fault: plates sliding past each other (${cmYear(rate)}).`);
  else plate.push('Within a plate, away from its edges.');
  sections.push({ heading: 'Plates', lines: plate });

  // The climate, in numbers and in words.
  if (d.climate) {
    const T = new Float64Array(12), P = new Float64Array(12);
    let mean = 0, year = 0, lo = Infinity, hi = -Infinity;
    for (let m = 0; m < 12; m++) {
      T[m] = d.climate.monthly[m * n + c]; P[m] = d.climate.precipMonthly[m * n + c];
      mean += T[m] / 12; year += P[m]; lo = Math.min(lo, T[m]); hi = Math.max(hi, T[m]);
    }
    const lines = [`${fmt(mean, 1)} °C over the year (${fmt(lo)} to ${fmt(hi)} °C between its coldest and warmest months); ${d.dry ? 'no rain or snow: the planet has no water' : `${fmt(year)} mm of rain and snow a year`}.`];
    const a = Math.abs(lat), edge = x.hadleyEdgeDeg;
    const why: string[] = [];
    // (A world with no water, D259: nothing of rain to explain.)
    if (d.dry) { /* nothing */ } else if (x.tidallyLocked) why.push(lon > -60 && lon < 60 ? 'the side facing the star, where air rises' : 'the side turned from the star, where air sinks and cools');
    else {
      if (a < 12) why.push('the equator\'s convergence zone, where the trade winds meet and air rises: rain most of the year');
      else if (Math.abs(a - edge) < 9 && year < 600) why.push('the subtropical high at the edge of the tropics\' circulation: dry air sinking');
      else if (a > edge + 8 && a < edge + 35 && year >= 500) why.push('the storm belt, where the westerlies bring rain the year round');
      // A rain shadow: high ground upwind, and less rain than the latitude's mean.
      const up = upwindHigh(d, c);
      if (up > 1000 && h < up - 500) why.push(`the rain shadow of high ground upwind (${fmt(up)} m)`);
      const season = seasonality(P);
      let summer = 0;
      for (let m = 0; m < 12; m++) if ((lat >= 0) === (m >= 3 && m <= 8)) summer += P[m];
      if (season > 0.6 && year > 300 && summer > 0.7 * year) why.push('a monsoon: the summer brings the rain');
      if (season > 0.6 && year > 200 && summer < 0.3 * year) why.push('winter rain and summer drought');
    }
    const cur = d.dry ? 0 : d.climate.currents[c];
    if (cur > 1) why.push(`a warm current offshore (${fmt(cur, 1)} K warmer)`);
    if (cur < -1) why.push(`a cold current offshore (${fmt(-cur, 1)} K cooler)`);
    if (why.length) lines.push(`Shaped by ${why.join('; ')}.`);
    sections.push({ heading: 'Climate', lines });
  }

  // Water.
  if (d.water) {
    const w = d.water.kind[c], lines: string[] = [];
    if (d.water.ice[c] > 50) lines.push(`Under an ice sheet ${fmt(d.water.ice[c])} m thick, built where snow outlasts the summer.`);
    else if (w === WATER.lake) lines.push(`A lake ${fmt(d.water.lakeDepth[c])} m deep: its hollow fills until it spills on towards the sea.`);
    else if (w === WATER.saltLake) lines.push(`A salt lake ${fmt(d.water.lakeDepth[c])} m deep with no outlet: its surface evaporates all that flows in.`);
    else if (w === WATER.saltFlat) lines.push('A salt flat: a closed basin too dry to hold a lake.');
    else if (w === WATER.river || w === WATER.floodplain || w === WATER.delta) lines.push(`A river carrying ${fmt(d.water.discharge[c])} m³ a second${w === WATER.floodplain ? ' across its floodplain' : w === WATER.delta ? ', building a delta into the sea' : ''}.`);
    else if (w === WATER.wetland) lines.push('A wetland: water gathering on flat, poorly drained ground.');
    if (lines.length) sections.push({ heading: 'Water', lines });
  }

  // Biome and its rule.
  if (d.biomes && d.climate && h >= 0) {
    const k = d.biomes.koppen[c], id = BIOME_IDS[d.biomes.biome[c]];
    const lines: string[] = [];
    let hottest = -Infinity;
    for (let m = 0; m < 12; m++) hottest = Math.max(hottest, d.climate.monthly[m * n + c]);
    if (k) lines.push(`Köppen-Geiger ${KOPPEN[k - 1][0]}: ${KOPPEN[k - 1][1].toLowerCase()}.`);
    const own = d.biomes.custom[c];
    if (own) lines.push(`The planet's own biome "${d.biomes.customNames[own - 1]}", its conditions met here.`);
    else if (id === 'lava' || id === 'scorched' || (id === 'barren' && hottest >= TOO_HOT_FOR_PLANTS)) {
      // (D259) What heat alone made of the ground.
      lines.push(id === 'lava' ? `Molten rock: its warmest month reaches ${fmt(hottest)} °C, and basalt melts at about ${fmt(MOLTEN_FROM)} °C.`
        : id === 'scorched' ? `Scorched rock: its warmest month reaches ${fmt(hottest)} °C; no water lies on ground hotter than ${SCORCHED_FROM} °C, and nothing lives there.`
        : `Bare ground: its warmest month reaches ${fmt(hottest)} °C, and nothing grows above about ${TOO_HOT_FOR_PLANTS} °C.`);
    } else if (id && id !== 'sea') {
      let year = 0;
      for (let m = 0; m < 12; m++) year += d.climate.precipMonthly[m * n + c];
      const pet = d.water?.pet[c] ?? 0;
      lines.push(`${BIOME[id].name}${pet > 0 ? `: rain is ${fmt(year / pet, 2)} of what the warmth and sunlight could evaporate` : ''}.`);
    }
    if (lines.length) sections.push({ heading: 'Life', lines });
  }
  return { title, sections };
}

/** The highest ground within about two cells upwind (the year's winds), m; 0 if none higher than here. */
function upwindHigh(d: ExplainData, c: number): number {
  const { mesh } = d, n = mesh.n;
  if (!d.climate) return 0;
  let best = 0;
  for (const wind of [d.climate.windJan, d.climate.windJul]) {
    const ue = wind[2 * c], vn = wind[2 * c + 1];
    if (Math.hypot(ue, vn) < 0.5) continue;
    // Step against the wind, choosing each time the neighbour lying most upwind.
    let k = c;
    for (let s = 0; s < 3; s++) {
      const lo = mesh.lon[k], la = mesh.lat[k];
      const east = [-Math.sin(lo), Math.cos(lo), 0], north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
      const dir = [-(ue * east[0] + vn * north[0]), -(ue * east[1] + vn * north[1]), -(ue * east[2] + vn * north[2])];
      let next = k, top = -Infinity;
      for (let e = mesh.nbrStart[k]; e < mesh.nbrStart[k + 1]; e++) {
        const j = mesh.nbr[e];
        const t = dir[0] * (mesh.xyz[3 * j] - mesh.xyz[3 * k]) + dir[1] * (mesh.xyz[3 * j + 1] - mesh.xyz[3 * k + 1]) + dir[2] * (mesh.xyz[3 * j + 2] - mesh.xyz[3 * k + 2]);
        if (t > top) { top = t; next = j; }
      }
      k = next;
      if (k < n) best = Math.max(best, d.heights[k]);
    }
  }
  return best;
}
