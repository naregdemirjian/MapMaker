// Fields (Stage 9, D102): conditions that cover the map with a strength at every place and moment,
// such as radiation, fire, smoke and ash, floodwater, destruction, or heat for a heatmap. A field
// layer holds sources: a strike, a fire, a release of something. Each source starts at its moment
// (the change that places it, in an event or not), rises to its peak, holds, then decays (a half-life)
// and is gone; its footprint grows from its place to its size, a circle with uneven edges, or a plume
// carried downwind. The layer's value at a place is the sum of its sources there, coloured by the
// field's ramp (see FIELD_TYPES). Temporary conditions are kept apart from permanent changes, which
// change the terrain itself (sculpting, D98; the sea level, D96).
//
// The arithmetic here is the reference the field shader follows (render-engine/fields-gl.ts), and
// what tests check.
import type { Instant } from '../core-time/index.ts';

/** The kinds of field, each with its own colours. */
export type FieldType = 'radiation' | 'fire' | 'smoke' | 'flood' | 'damage' | 'drought' | 'heat' | 'custom';

/** A colour ramp: [share of the full value (0 to 1), red, green, blue, opacity (0 to 1)], in order. */
export type FieldRamp = Array<[number, number, number, number, number]>;

export const FIELD_TYPES: Record<FieldType, { name: string; unit: string; full: number; ramp: FieldRamp; about: string }> = {
  radiation: { name: 'Radiation', unit: 'mSv/h', full: 1000, about: 'Fallout and contamination: yellow, red, then purple where it is deadly', ramp: [[0, 250, 230, 60, 0], [0.02, 250, 230, 60, 0.35], [0.15, 250, 160, 30, 0.55], [0.45, 225, 40, 30, 0.7], [1, 120, 20, 120, 0.8]] },
  fire: { name: 'Fire', unit: 'intensity', full: 1, about: 'Burning ground and lava: bright yellow where hottest, through orange and red to dark embers', ramp: [[0, 90, 10, 5, 0], [0.05, 120, 20, 10, 0.55], [0.35, 200, 50, 15, 0.85], [0.7, 250, 140, 30, 0.95], [1, 255, 230, 120, 0.95]] },
  smoke: { name: 'Smoke and ash', unit: 'cm of ash', full: 50, about: 'Smoke, dust and ashfall: light grey to near black', ramp: [[0, 200, 200, 200, 0], [0.05, 190, 190, 190, 0.3], [0.4, 120, 118, 115, 0.6], [1, 40, 38, 36, 0.85]] },
  flood: { name: 'Flood', unit: 'm of water', full: 5, about: 'Floodwater: pale where shallow, deep blue where deep', ramp: [[0, 120, 180, 230, 0], [0.02, 120, 180, 230, 0.45], [0.3, 60, 120, 210, 0.7], [1, 20, 50, 140, 0.85]] },
  damage: { name: 'Destruction', unit: '% destroyed', full: 100, about: 'Ruin and burnt ground: brown to black', ramp: [[0, 120, 90, 60, 0], [0.05, 140, 100, 60, 0.35], [0.5, 80, 55, 35, 0.65], [1, 25, 20, 18, 0.85]] },
  drought: { name: 'Drought', unit: 'dryness', full: 1, about: 'Land drying out: pale ochre to deep tan', ramp: [[0, 210, 180, 110, 0], [0.05, 215, 185, 115, 0.3], [0.5, 200, 160, 90, 0.55], [1, 170, 120, 60, 0.75]] },
  heat: { name: 'Heatmap', unit: 'value', full: 1, about: 'Any quantity: blue for little, through green and yellow, to red for most', ramp: [[0, 40, 80, 220, 0], [0.05, 40, 80, 220, 0.4], [0.3, 40, 200, 120, 0.55], [0.6, 250, 220, 50, 0.7], [1, 230, 40, 30, 0.8]] },
  custom: { name: 'Custom', unit: 'value', full: 1, about: 'One colour, more opaque where stronger', ramp: [[0, 230, 120, 200, 0], [1, 230, 120, 200, 0.8]] },
};
export const isFieldType = (v: unknown): v is FieldType => typeof v === 'string' && v in FIELD_TYPES;

/**
 * A field layer's look: its kind, and how opaque it is drawn (1 as its ramp says). A heatmap may be
 * worked out from a layer of points (D105: `from`, a point layer's id): each point in force there is a
 * soft spot `kernelKm` across, worth 1, and the colours are full where `full` of them overlap.
 */
export interface FieldLayerStyle { type: FieldType; opacity: number; from: string | null; kernelKm: number; full: number | null }
export function fieldLayerStyleOf(styleJson: string | undefined): FieldLayerStyle {
  let o: Record<string, unknown> = {};
  try { o = styleJson ? (JSON.parse(styleJson) as Record<string, unknown>) ?? {} : {}; } catch { o = {}; }
  const f = (o.field ?? {}) as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
  return {
    type: isFieldType(f.type) ? f.type : 'custom', opacity: n(f.opacity, 0, 1) ?? 1,
    from: typeof f.from === 'string' && f.from ? f.from : null, kernelKm: n(f.kernelKm, 1, 5000) ?? 200, full: n(f.full, 0.01, 1e6),
  };
}

/**
 * A source of a field: how strong at its peak (in the field's unit), how large (km), its shape, and
 * its life in days: rising to its peak, holding, then halving every `decay` days (0: gone at once
 * after holding); its footprint grows to full size over `grow` days. `noise` makes a circle's edge
 * uneven (0 round, 1 very ragged; `seed` chooses how). A plume is carried by the wind towards
 * `windDeg` (0 north, 90 east) at `windKmPerDay`, widening as it goes.
 */
export interface FieldSource {
  /** A circle, a plume, or a spread over the terrain (`spread`: a fire, lava or a flood, D103). */
  shape: 'circle' | 'plume' | 'spread';
  spread: 'fire' | 'lava' | 'flood';
  intensity: number; radiusKm: number;
  rise: number; hold: number; decay: number; grow: number;
  noise: number; seed: number;
  windDeg: number; windKmPerDay: number;
}

/** Each kind's usual source (what a click places before anything is changed). */
export const DEFAULT_SOURCES: Record<FieldType, FieldSource> = {
  radiation: { shape: 'plume', spread: 'fire', intensity: 600, radiusKm: 15, rise: 0.05, hold: 0.5, decay: 8, grow: 0, noise: 0.3, seed: 1, windDeg: 90, windKmPerDay: 120 },
  fire: { shape: 'spread', spread: 'fire', intensity: 0.9, radiusKm: 40, rise: 0.3, hold: 2, decay: 1.5, grow: 6, noise: 0.5, seed: 1, windDeg: 90, windKmPerDay: 0 },
  smoke: { shape: 'plume', spread: 'fire', intensity: 20, radiusKm: 25, rise: 0.2, hold: 2, decay: 4, grow: 0, noise: 0.3, seed: 1, windDeg: 90, windKmPerDay: 300 },
  flood: { shape: 'spread', spread: 'flood', intensity: 3, radiusKm: 60, rise: 2, hold: 5, decay: 6, grow: 2, noise: 0.6, seed: 1, windDeg: 0, windKmPerDay: 0 },
  damage: { shape: 'circle', spread: 'fire', intensity: 90, radiusKm: 8, rise: 0, hold: 3650, decay: 3650, grow: 0, noise: 0.25, seed: 1, windDeg: 0, windKmPerDay: 0 },
  drought: { shape: 'circle', spread: 'fire', intensity: 0.8, radiusKm: 300, rise: 180, hold: 3650, decay: 3650, grow: 365, noise: 0.6, seed: 1, windDeg: 0, windKmPerDay: 0 },
  heat: { shape: 'circle', spread: 'fire', intensity: 0.5, radiusKm: 300, rise: 0, hold: 36500, decay: 0, grow: 0, noise: 0, seed: 1, windDeg: 0, windKmPerDay: 0 },
  custom: { shape: 'circle', spread: 'fire', intensity: 1, radiusKm: 100, rise: 1, hold: 10, decay: 10, grow: 1, noise: 0.3, seed: 1, windDeg: 0, windKmPerDay: 0 },
};

const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
/** A stored source, completed and checked (anything missing or wrong takes the kind's usual value). */
export function fieldSourceOf(raw: unknown, type: FieldType = 'custom'): FieldSource {
  const d = DEFAULT_SOURCES[type], r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof FieldSource, unknown>>;
  return {
    shape: r.shape === 'plume' || r.shape === 'circle' || r.shape === 'spread' ? r.shape : d.shape,
    spread: r.spread === 'fire' || r.spread === 'lava' || r.spread === 'flood' ? r.spread : d.spread,
    intensity: num(r.intensity, d.intensity, 0, 1e9), radiusKm: num(r.radiusKm, d.radiusKm, 0.01, 20000),
    rise: num(r.rise, d.rise, 0, 1e6), hold: num(r.hold, d.hold, 0, 1e7), decay: num(r.decay, d.decay, 0, 1e7), grow: num(r.grow, d.grow, 0, 1e6),
    noise: num(r.noise, d.noise, 0, 1), seed: Math.round(num(r.seed, d.seed, 0, 1e9)),
    windDeg: ((num(r.windDeg, d.windDeg, -1e6, 1e6) % 360) + 360) % 360, windKmPerDay: num(r.windKmPerDay, d.windKmPerDay, 0, 1e5),
  };
}

/** Days from one moment to another. */
export const daysBetween = (a: Instant, b: Instant) => (b.day - a.day) + (b.ms - a.ms) / 86_400_000;

/** How strong a source is `age` days after it starts, as a share of its peak (0 before it starts and once it has faded). */
export function strengthAt(s: FieldSource, age: number): number {
  if (!(age >= 0)) return 0;
  if (age < s.rise) { const x = age / s.rise; return x * x * (3 - 2 * x); }
  if (age <= s.rise + s.hold) return 1;
  if (s.decay <= 0) return 0;
  const v = 0.5 ** ((age - s.rise - s.hold) / s.decay);
  return v < FADED ? 0 : v;
}
/** Below this share of its peak a source counts as gone (it is not drawn). */
export const FADED = 0.004;

/** How long a source lasts (days), until it has faded. */
export function lifespan(s: FieldSource): number {
  return s.rise + s.hold + (s.decay > 0 ? s.decay * Math.log2(1 / FADED) : 0);
}

/** The share of its full size a source's footprint has `age` days after it starts. */
export const sizeAt = (s: FieldSource, age: number) => (s.grow > 0 ? Math.sqrt(Math.max(0, Math.min(1, age / s.grow))) : age >= 0 ? 1 : 0);

/** The uneven edge of a circle: how much farther (or nearer) it reaches towards a bearing (radians). */
export function edgeAt(s: FieldSource, bearing: number): number {
  if (s.noise <= 0) return 1;
  const p = (k: number) => ((s.seed * 9301 + k * 49297) % 233280) / 233280 * 2 * Math.PI;
  const n = 0.5 * Math.sin(3 * bearing + p(1)) + 0.3 * Math.sin(5 * bearing + p(2)) + 0.2 * Math.sin(11 * bearing + p(3));
  return Math.max(0.2, 1 + 0.45 * s.noise * n);
}

const R = 6371.0088;
/** Distance (km) and bearing (radians from north, clockwise) from one place to another on the Earth's sphere (of radius `radiusKm`). */
export function distanceBearing(from: [number, number], to: [number, number], radiusKm = R): [number, number] {
  const r = Math.PI / 180, p1 = from[1] * r, p2 = to[1] * r, dl = (to[0] - from[0]) * r;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
  const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return [d, b];
}

/**
 * The value of a source at a place (`d` km away, towards `bearing`), `age` days after it starts: its
 * strength times its footprint there. A circle: full at its middle, falling smoothly to nothing at
 * its edge. A plume: from its place downwind, as far as the wind has carried it, widening and
 * thinning as it goes.
 */
export function sourceValue(s: FieldSource, d: number, bearing: number, age: number): number {
  const k = strengthAt(s, age);
  if (k <= 0) return 0;
  const r = s.radiusKm * sizeAt(s, age);
  if (r <= 0) return 0;
  let f: number;
  if (s.shape === 'plume' && s.windKmPerDay > 0) {
    // Along the wind (a) and across it (c), in km on the ground near the source.
    const w = (s.windDeg * Math.PI) / 180, a = d * Math.cos(bearing - w), c = d * Math.sin(bearing - w);
    const L = s.windKmPerDay * age, along = Math.max(0, Math.min(L, a));
    const width = r * (1 + (1.5 * along) / Math.max(r, 1e-6) * 0.25);
    // (Its front thins out over a distance that grows as it travels.)
    const front = r + 0.3 * L;
    const ends = a < 0 ? Math.exp(-2 * (a / r) ** 2) : a > L ? Math.exp(-2 * ((a - L) / front) ** 2) : 1;
    f = Math.exp(-2 * (c / width) ** 2) * ends * (r / width);
  } else {
    const u = d / (r * edgeAt(s, bearing));
    f = u >= 1 ? 0 : (1 - u * u) ** 2;
  }
  return s.intensity * k * f;
}

/** How far from its place a source can reach at `age` (km): beyond, its value is nothing. */
export function sourceReach(s: FieldSource, age: number): number {
  const r = s.radiusKm * sizeAt(s, age);
  // (A plume: along the wind to its far end and a little beyond, and across it to its widest.)
  if (s.shape === 'plume' && s.windKmPerDay > 0) return 1.6 * s.windKmPerDay * Math.max(0, age) + 3 * r;
  return r * (1 + 0.45 * s.noise);
}

/**
 * When a source started, at moment `t`: the start of the run of its shapes in force at `t` (moving
 * it does not start it again); null when it does not exist at `t`.
 */
export function onsetOf(history: Array<{ t: Instant; parts: number[][] | null }>, t: Instant, compare: (a: Instant, b: Instant) => number): Instant | null {
  let k = -1;
  for (let i = 0; i < history.length; i++) if (compare(history[i].t, t) <= 0) k = i; else break;
  if (k < 0 || !history[k].parts) return null;
  while (k > 0 && history[k - 1].parts) k--;
  return history[k].t;
}

/** A source in force at a moment, as drawn: where, how (its settings), how old (days) and how strong (share of its peak). */
export interface ActiveSource { id: string; name: string; lon: number; lat: number; source: FieldSource; age: number; strength: number }

interface FieldWorld {
  get(table: 'layer', id: string): { style: string } | undefined;
  get(table: 'feature', id: string): { id: string; name: string; style: string } | undefined;
}
interface FieldEngine {
  featuresAt(layerId: string, t: Instant): Array<{ feature: string; parts: number[][]; since: Instant }>;
  featureHistory(featureId: string): Array<{ t: Instant; parts: number[][] | null }>;
}
const parsed = new WeakMap<object, { type: FieldType; source: FieldSource }>();

/**
 * The sources of a field layer in force at moment `t` (placed, and not yet faded), each with its age
 * and strength. `compare` orders moments (core-time's).
 */
export function activeSources(world: FieldWorld, engine: FieldEngine, layerId: string, t: Instant, compare: (a: Instant, b: Instant) => number): ActiveSource[] {
  const layer = world.get('layer', layerId);
  if (!layer) return [];
  const type = fieldLayerStyleOf(layer.style).type, out: ActiveSource[] = [];
  for (const fa of engine.featuresAt(layerId, t)) {
    const f = world.get('feature', fa.feature);
    if (!f || !fa.parts.length) continue;
    // (Each row's settings read once: a changed source is a new row.)
    let p = parsed.get(f);
    if (!p || p.type !== type) {
      let own: Record<string, unknown> = {};
      try { own = JSON.parse(f.style || '{}') ?? {}; } catch { own = {}; }
      p = { type, source: fieldSourceOf(own.source, type) };
      parsed.set(f, p);
    }
    const onset = onsetOf(engine.featureHistory(fa.feature), t, compare) ?? fa.since;
    const age = daysBetween(onset, t), strength = strengthAt(p.source, age);
    if (strength <= 0) continue;
    out.push({ id: f.id, name: f.name, lon: fa.parts[0][0], lat: fa.parts[0][1], source: p.source, age, strength });
  }
  return out;
}

/** A field layer's value at a place (the sum of its sources there), on a planet of `radiusKm`. */
export function fieldValueAt(sources: ActiveSource[], lon: number, lat: number, radiusKm = R): number {
  let v = 0;
  for (const s of sources) {
    const [d, b] = distanceBearing([s.lon, s.lat], [lon, lat], radiusKm);
    if (d <= sourceReach(s.source, s.age)) v += sourceValue(s.source, d, b, s.age);
  }
  return v;
}

/** The colour (red, green, blue 0-255, opacity 0-1) of a value on a field's ramp. */
export function rampColour(type: FieldType, value: number): [number, number, number, number] {
  const { ramp, full } = FIELD_TYPES[type], x = Math.max(0, value / full);
  if (x <= ramp[0][0]) return [ramp[0][1], ramp[0][2], ramp[0][3], ramp[0][4]];
  for (let i = 1; i < ramp.length; i++) {
    if (x <= ramp[i][0]) {
      const a = ramp[i - 1], b = ramp[i], u = (x - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u];
    }
  }
  const z = ramp[ramp.length - 1];
  return [z[1], z[2], z[3], z[4]];
}
