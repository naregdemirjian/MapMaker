// What edits do, in numbers (Stage 15.2, D164). Before the history is re-run: an estimate of each edit from the
// engine's own rules for its event (the same constants the tectonics use), the planet's size and gravity, and the
// place as the history shown has it at that moment (its height, its crust, how fast its plate moves). After: what
// the re-run made, measured by comparing the two histories' present (heights, land, rain, lakes, biomes) around
// each edit and over the planet, or, for edits of the sea and the air, the moment they were under way.
import type { GeoEvent } from './model/definition.ts';
import type { Mesh } from './mesh/icosphere.ts';
import { CRUST, TAG } from './tectonics/plates.ts';
import { EARTH_SPEED, maxThickness } from './tectonics/state.ts';
import { airyHeight, oceanDepth } from './tectonics/isostasy.ts';
import { craterSize, plateauSize, RIFT_SPEED } from './tectonics/events.ts';
import { PLUME_CONTINENT, PLUME_OCEAN } from './tectonics/step.ts';
import { co2Factor } from './climate/paleo.ts';
import { cellAt } from './explain.ts';
import { BIOME, BIOME_IDS } from './life/biomes.ts';
import { followCrust } from './reconstruct.ts';

/** A number with what it is. */
export interface Figure { label: string; value: string }

/** An edit's estimate: its figures, and where to measure it afterwards. */
export interface Estimate {
  figures: Figure[];
  /** Around its place (km), or the whole planet (Infinity). */
  radiusKm: number;
  /** When to compare the histories (Ma): the present, or for a passing change of the sea or the air, while it lasts. */
  atMa: number;
}

/** What estimates and measurements read from a history (a tectonics product's data, as plain arrays). */
export interface HistoryData {
  times: ArrayLike<number>;
  /** Per picture and cell, m against that moment's sea; the crust's kind per picture and cell. */
  heights: ArrayLike<number>;
  kinds: ArrayLike<number>;
  /** The present's crust bits (TAG). */
  tags: ArrayLike<number>;
  seaLevels?: ArrayLike<number>;
  meanTemps?: ArrayLike<number>;
  iceVolumes?: ArrayLike<number>;
  /** Packed checkpoints (D163): each plate's motion at those moments. */
  resume?: { times: number[]; states: Array<{ [k: string]: unknown }> };
  /** Plates per picture and cell, and their rotations per picture (D164): to follow crust through the history. */
  plates?: ArrayLike<number>;
  frameRotations?: ArrayLike<Float64Array>;
}

/** A planet as an estimate needs it. */
export interface PlanetFacts {
  mesh: Mesh;
  radiusKm: number;
  gravity: number;
  /** How vigorous its plates are (1: the Earth's), and how long its history runs (Myr). */
  vigor: number;
  spanMyr: number;
}

const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d }) : '∞');
/** A large number in words: 16 million, 420,000. */
export function big(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${fmt(v / 1e9, a >= 1e10 ? 0 : 1)} billion`;
  if (a >= 1e6) return `${fmt(v / 1e6, a >= 1e7 ? 0 : 1)} million`;
  const k = a >= 1e4 ? 1000 : a >= 1000 ? 100 : a >= 100 ? 10 : 1;
  return fmt(Math.round(v / k) * k);
}
const metres = (m: number) => `${fmt(Math.round(m / 10) * 10)} m`;
const ago = (ma: number) => (ma <= 0 ? 'today' : `${fmt(ma)} million years ago`);

/** The picture of a history nearest a moment (Ma). */
export function frameAt(times: ArrayLike<number>, ma: number): number {
  let best = 0;
  for (let f = 1; f < times.length; f++) if (Math.abs(times[f] - ma) < Math.abs(times[best] - ma)) best = f;
  return best;
}

/** How fast (km/Myr) the plate under a place moved at a moment (Ma), from the history's checkpoint before it. */
export function plateSpeedAt(h: HistoryData, p: PlanetFacts, c: number, ma: number): number | null {
  if (!h.resume || !h.resume.times.length) return null;
  const t = p.spanMyr - ma;
  let k = 0;
  for (let i = 0; i < h.resume.times.length; i++) if (h.resume.times[i] <= t + 1e-9 && h.resume.times[i] >= h.resume.times[k]) k = i;
  const s = h.resume.states[k], owner = s.owner as Int32Array;
  const plate = (s.plates as Array<{ id: number; omega: Float64Array }>).find((q) => q.id === owner[c]);
  if (!plate) return null;
  const x = p.mesh.xyz[3 * c], y = p.mesh.xyz[3 * c + 1], z = p.mesh.xyz[3 * c + 2], w = plate.omega;
  return Math.hypot(w[1] * z - w[2] * y, w[2] * x - w[0] * z, w[0] * y - w[1] * x) * p.radiusKm;
}

/** An edit's consequences estimated before the re-run (from the history shown before it). */
export function estimateEdit(e: GeoEvent, h: HistoryData, p: PlanetFacts): Estimate {
  const { mesh, radiusKm: R, gravity: g } = p, n = mesh.n;
  const figures: Figure[] = [];
  const f = frameAt(h.times, e.startMa), c = e.at ? cellAt(mesh, e.at[0], e.at[1]) : -1;
  const until = Math.max(0, e.startMa - Math.max(0, e.durationMyr)), lasts = e.startMa - until;
  const cellKm = Math.sqrt((4 * Math.PI * R * R) / n);
  const s = Math.max(0, e.strength);
  const z = c >= 0 ? h.heights[f * n + c] : 0, kind = c >= 0 ? h.kinds[f * n + c] : CRUST.oceanic;
  const continental = kind === CRUST.continental;
  if (c >= 0) {
    const what = kind === CRUST.continental ? 'continental crust' : kind === CRUST.arc ? 'an island arc\'s crust' : 'oceanic crust';
    figures.push({ label: `The place ${ago(e.startMa)}`, value: z >= 0 ? `${metres(z)} above the sea (${what})` : `${metres(-z)} under the sea (${what})` });
  }
  let radiusKm = 1000, atMa = 0;
  switch (e.kind) {
    case 'hotspot': {
      const v = (c >= 0 ? plateSpeedAt(h, p, c, e.startMa) : null) ?? EARTH_SPEED * p.vigor;
      const rate = (continental ? PLUME_CONTINENT : PLUME_OCEAN) * s;
      // A point of the plate stays over the plume for a cell's width at the plate's speed (or all along on a plate
      // that hardly moves); the plume adds to its cell and a quarter as much to each neighbour.
      const over = Math.min(lasts, cellKm / Math.max(v, 1e-6));
      const thick = Math.min(maxThickness(g), rate * over * 1.5);
      // Height per km of crust added, through isostasy: about 0.15 km on the sea floor and on continents alike.
      const rise = 0.15 * thick;
      const volume = rate * (4 * Math.PI * R * R / n) * 2.5 * lasts;
      figures.push({ label: 'The plate there moves', value: v < 2 ? 'hardly at all: one volcanic shield grows in place' : `${fmt(v / 10, 1)} cm a year` });
      if (v >= 2) figures.push({ label: 'The chain of volcanoes', value: `about ${big(v * lasts)} km long by ${until > 0 ? ago(until) : 'today'}, youngest over the plume` });
      figures.push({ label: 'Volcanic rock', value: `about ${big(volume)} km³` });
      figures.push({ label: 'The ground along the track rises', value: `about ${metres(rise * 1000)}${v < 2 ? ' at the shield' : ''}` });
      if (!continental && z < 0) {
        figures.push({ label: 'Islands above the sea', value: rise * 1000 > -z
          ? 'yes, where the track stands highest'
          : `not at this quality: the track stays about ${metres(-z - rise * 1000)} under the sea in cells about ${fmt(Math.round(cellKm / 10) * 10)} km across (single volcanoes are narrower than a cell)` });
      }
      radiusKm = Math.max(600, Math.min(2500, v * Math.min(lasts, 20)));
      break;
    }
    case 'collision': {
      const top = maxThickness(g);
      figures.push({ label: 'Continents within reach move together', value: `for ${fmt(lasts)} million years` });
      figures.push({ label: 'The crust thickens', value: `up to ${fmt(top)} km (the most this gravity lets stand)` });
      figures.push({ label: 'Its peaks', value: `up to about ${metres(airyHeight(top) * 1000)} averaged over cells about ${fmt(Math.round(cellKm / 10) * 10)} km across, then worn down` });
      figures.push({ label: 'Behind the range', value: 'less rain where the winds come down from it (a rain shadow); measured after the re-run' });
      radiusKm = 1500;
      break;
    }
    case 'rift': {
      const opening = 2 * RIFT_SPEED * Math.max(0.5, s);
      figures.push({ label: 'The two parts move apart', value: `${fmt(opening / 10, 1)} cm a year` });
      figures.push({ label: 'New sea floor', value: `up to about ${big(opening * lasts)} km wide by ${ago(until)}, if the plates keep moving so` });
      figures.push({ label: 'Its depth', value: `${metres(oceanDepth(0) * 1000)} at the ridge, ${metres(oceanDepth(e.startMa) * 1000)} where it is oldest today` });
      radiusKm = Math.max(800, Math.min(3000, opening * lasts));
      break;
    }
    case 'lip': {
      const { centreKm, radiusKm: Rl } = plateauSize(s);
      const top = Math.min(maxThickness(g), centreKm);
      // Basalt thickness centre·exp(−(d/R)²), out to 1.5 R: its volume, and where it is over a kilometre thick.
      const volume = centreKm * Math.PI * Rl * Rl * (1 - Math.exp(-2.25));
      const over1 = centreKm > 1 ? Rl * Math.sqrt(Math.log(centreKm)) : 0;
      figures.push({ label: 'Basalt', value: `up to ${fmt(top, 1)} km thick at the centre${over1 ? `, more than 1 km thick within ${big(over1)} km of it` : ''}` });
      figures.push({ label: 'Its volume', value: `about ${big(volume)} km³ (the Siberian Traps: about 3 million)` });
      figures.push({ label: 'The ground stands higher', value: `by up to about ${metres(0.15 * top * 1000)} at the centre` });
      radiusKm = Math.min(3000, 1.5 * Rl);
      break;
    }
    case 'impact': {
      const { radiusKm: Rc, depthKm } = craterSize(Math.max(0.05, s), g);
      figures.push({ label: 'A basin', value: `about ${big(2 * Rc)} km across and ${metres(depthKm * 1000)} deep at first` });
      figures.push({ label: 'Its rim', value: `about ${metres(0.15 * depthKm * 1000)} high` });
      figures.push({ label: 'It would hold', value: `about ${big((Math.PI * Rc * Rc * depthKm) / 2)} km³ of water (a lake if the climate fills it; sediment fills it with time)` });
      radiusKm = 1.4 * Rc;
      break;
    }
    case 'sea-level': {
      const rise = 50 * s, F = frameAt(h.times, e.startMa - lasts / 2);
      let land = 0, flooded = 0;
      for (let k = 0; k < n; k++) {
        const y = h.heights[F * n + k], a = mesh.area[k] * R * R;
        if (y >= 0) { land += a; if (y < rise) flooded += a; }
      }
      figures.push({ label: 'The sea rises', value: `${metres(rise)} from ${ago(e.startMa)} for ${fmt(lasts)} million years` });
      figures.push({ label: 'Land flooded', value: `about ${big(flooded)} km² (${fmt((100 * flooded) / Math.max(1, land), 1)} % of the land then)` });
      radiusKm = Infinity; atMa = h.times[F];
      break;
    }
    case 'ice-age': case 'greenhouse': {
      const k = co2Factor([{ kind: e.kind, strength: s }]);
      figures.push({ label: 'Carbon dioxide', value: `× ${fmt(k, k < 1 ? 2 : 1)} from ${ago(e.startMa)} for ${fmt(lasts)} million years` });
      figures.push({ label: e.kind === 'ice-age' ? 'Colder' : 'Warmer', value: e.kind === 'ice-age' ? 'ice grows on land and the sea falls; measured after the re-run' : 'less ice and a higher sea; measured after the re-run' });
      radiusKm = Infinity; atMa = h.times[frameAt(h.times, e.startMa - lasts / 2)];
      break;
    }
    case 'volcanic-period':
      figures.push({ label: 'Plumes and arcs', value: `make ${fmt(1 + s, 1)} times as much crust for ${fmt(lasts)} million years` });
      radiusKm = Infinity;
      break;
    case 'supercontinent': case 'breakup': case 'reorganisation':
      figures.push({ label: 'Plates', value: e.kind === 'supercontinent' ? `continents gather for ${fmt(lasts)} million years` : e.kind === 'breakup' ? 'continents part along their old sutures' : 'all change direction at once' });
      radiusKm = Infinity;
      break;
    default: break;
  }
  return { figures, radiusKm, atMa };
}

/** A history's present (or a moment of it) as the measurements read it. */
export interface Snapshot {
  history: HistoryData;
  /** The present's rain (mm a year), lakes (m deep) and biomes (BIOME_IDS index), where worked out. */
  precip?: ArrayLike<number> | null;
  lakeDepth?: ArrayLike<number> | null;
  biome?: ArrayLike<number> | null;
}

/** What a re-run made, measured: for each edit around its place (or over the planet), then over the whole planet. */
export function measureEdits(edits: Array<{ event: GeoEvent; estimate: Estimate }>, before: Snapshot, after: Snapshot, p: PlanetFacts): { edits: Array<{ id: string; figures: Figure[] }>; planet: Figure[] } {
  const { mesh, radiusKm: R } = p, n = mesh.n;
  const km2 = (c: number) => mesh.area[c] * R * R;
  const last = (h: HistoryData) => h.times.length - 1;
  const out = edits.map(({ event: e, estimate }) => {
    const figures: Figure[] = [];
    const global = !Number.isFinite(estimate.radiusKm) || !e.at;
    const cosR = global ? -2 : Math.cos(Math.min(Math.PI, estimate.radiusKm / R));
    // Around where the edit's crust is now (followed with its plate from when the edit began); a plume stays put.
    const centre = e.at ? (e.kind === 'hotspot' ? e.at : (after.history.plates ? followCrust(after.history as Required<HistoryData>, mesh, e.at, e.startMa, estimate.atMa) : null) ?? e.at) : null;
    const at = centre ? [Math.cos((centre[1] * Math.PI) / 180) * Math.cos((centre[0] * Math.PI) / 180), Math.cos((centre[1] * Math.PI) / 180) * Math.sin((centre[0] * Math.PI) / 180), Math.sin((centre[1] * Math.PI) / 180)] : [0, 0, 1];
    const inside = (c: number) => global || at[0] * mesh.xyz[3 * c] + at[1] * mesh.xyz[3 * c + 1] + at[2] * mesh.xyz[3 * c + 2] >= cosR;
    const fb = estimate.atMa > 0 ? frameAt(before.history.times, estimate.atMa) : last(before.history);
    const fa = estimate.atMa > 0 ? frameAt(after.history.times, estimate.atMa) : last(after.history);
    let hb = -Infinity, ha = -Infinity, lb = 0, la = 0;
    for (let c = 0; c < n; c++) {
      if (!inside(c)) continue;
      const yb = before.history.heights[fb * n + c], ya = after.history.heights[fa * n + c];
      hb = Math.max(hb, yb); ha = Math.max(ha, ya);
      if (yb >= 0) lb += km2(c);
      if (ya >= 0) la += km2(c);
    }
    const where = global ? (estimate.atMa > 0 ? ` (${ago(estimate.atMa)})` : '') : ` within ${big(estimate.radiusKm)} km${centre && e.kind !== 'hotspot' ? ` of ${fmt(Math.abs(centre[1]), 1)}° ${centre[1] >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(centre[0]), 1)}° ${centre[0] >= 0 ? 'E' : 'W'}` : ''}`;
    if (!global) figures.push({ label: `Highest ground${where}`, value: `${metres(hb)} → ${metres(ha)}` });
    figures.push({ label: `Land${where}`, value: `${big(lb)} → ${big(la)} km²` });
    if (global && estimate.atMa > 0) {
      const sb = before.history.seaLevels?.[fb], sa = after.history.seaLevels?.[fa];
      if (sb !== undefined && sa !== undefined) figures.push({ label: `The sea's level against today's${where}`, value: `${signed(sb)} → ${signed(sa)}` });
      const tb = before.history.meanTemps?.[fb], ta = after.history.meanTemps?.[fa];
      if (tb && ta) figures.push({ label: `Mean temperature${where}`, value: `${fmt(tb - 273.15, 1)} → ${fmt(ta - 273.15, 1)} °C` });
      const ib = before.history.iceVolumes?.[fb], ia = after.history.iceVolumes?.[fa];
      if (ib !== undefined && ia !== undefined) figures.push({ label: `Ice on land${where}`, value: `${big(ib)} → ${big(ia)} km³` });
    }
    if (estimate.atMa === 0 && !global) {
      if (before.precip && after.precip) {
        let wb = 0, wa = 0, ab = 0, aa = 0;
        for (let c = 0; c < n; c++) {
          if (!inside(c)) continue;
          if (before.history.heights[fb * n + c] >= 0) { wb += before.precip[c] * km2(c); ab += km2(c); }
          if (after.history.heights[fa * n + c] >= 0) { wa += after.precip[c] * km2(c); aa += km2(c); }
        }
        if (ab > 0 && aa > 0) figures.push({ label: `Rain on the land${where}`, value: `${fmt(Math.round(wb / ab / 10) * 10)} → ${fmt(Math.round(wa / aa / 10) * 10)} mm a year` });
      }
      if (before.lakeDepth && after.lakeDepth) {
        let vb = 0, va = 0;
        for (let c = 0; c < n; c++) if (inside(c)) { vb += (before.lakeDepth[c] * km2(c)) / 1000; va += (after.lakeDepth[c] * km2(c)) / 1000; }
        if (vb > 1 || va > 1) figures.push({ label: `Water in lakes${where}`, value: `${big(vb)} → ${big(va)} km³` });
      }
      const changed = biomeChange(before.biome, after.biome, (c) => inside(c) && (before.history.heights[fb * n + c] >= 0 || after.history.heights[fa * n + c] >= 0), km2, n);
      if (changed) figures.push({ label: `Biomes changed${where}`, value: changed });
    }
    return { id: e.id, figures };
  });
  // The whole planet today.
  const planet: Figure[] = [];
  const fb = last(before.history), fa = last(after.history);
  let lb = 0, la = 0, edited = 0, all = 0;
  for (let c = 0; c < n; c++) {
    all += km2(c);
    if (before.history.heights[fb * n + c] >= 0) lb += km2(c);
    if (after.history.heights[fa * n + c] >= 0) la += km2(c);
    if ((after.history.tags[c] & TAG.edited) && !(before.history.tags[c] & TAG.edited)) edited += km2(c);
  }
  planet.push({ label: 'Land today', value: `${fmt((100 * lb) / all, 1)} → ${fmt((100 * la) / all, 1)} % of the surface` });
  // Far from the edits the history can take another course: a small change can tip a later collision, split or
  // river's course (as in nature), so say how much of the planet's plates differ today.
  if (before.history.plates && after.history.plates) {
    let moved = 0;
    for (let c = 0; c < n; c++) if (before.history.plates[fb * n + c] !== after.history.plates[fa * n + c]) moved += km2(c);
    planet.push({ label: 'Plates today', value: moved === 0 ? 'as before' : `on another course on ${fmt((100 * moved) / all, 1)} % of the surface (small differences can tip later collisions and splits, as in nature)` });
  }
  planet.push({ label: 'Crust the edits made, today', value: `${big(edited)} km²` });
  const sb = before.history.seaLevels?.[fb], sa = after.history.seaLevels?.[fa];
  if (sb !== undefined && sa !== undefined && Math.abs(sa - sb) >= 1) planet.push({ label: 'The sea\'s level today', value: `${signed(sb)} → ${signed(sa)}` });
  const changed = biomeChange(before.biome, after.biome, (c) => before.history.heights[fb * n + c] >= 0 || after.history.heights[fa * n + c] >= 0, km2, n);
  if (changed) planet.push({ label: 'Biomes changed today', value: changed });
  return { edits: out, planet };
}

const signed = (m: number) => (Math.abs(m) < 1 ? '0 m' : `${m > 0 ? '+' : '−'}${metres(Math.abs(m))}`);

/** The area whose biome changed, and the largest change (in words), or '' if none changed. */
function biomeChange(b: ArrayLike<number> | null | undefined, a: ArrayLike<number> | null | undefined, where: (c: number) => boolean, km2: (c: number) => number, n: number): string {
  if (!b || !a) return '';
  let area = 0;
  const pairs = new Map<number, number>();
  for (let c = 0; c < n; c++) {
    if (!where(c) || b[c] === a[c]) continue;
    area += km2(c);
    const k = b[c] * 256 + a[c];
    pairs.set(k, (pairs.get(k) ?? 0) + km2(c));
  }
  if (area <= 0) return 'none';
  const [k, most] = [...pairs.entries()].sort((x, y) => y[1] - x[1])[0];
  const name = (i: number) => BIOME[BIOME_IDS[i]]?.name.toLowerCase() ?? '?';
  return `on ${big(area)} km² (most: ${name(Math.floor(k / 256))} → ${name(k % 256)}, ${big(most)} km²)`;
}
