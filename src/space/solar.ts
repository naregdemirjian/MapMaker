// The solar system (Stage 11, D113): the planets and Pluto where they are on any date, from the
// Keplerian elements and their rates of JPL's "Approximate Positions of the Planets" (E. M. Standish,
// table 1: the mean ecliptic and equinox of J2000, fitted to 1800-2050; outside that span the orbits
// stay right in shape and slowly drift in phase). Positions are astronomical units from the Sun on
// ecliptic axes (x toward the vernal equinox, z toward the ecliptic's north pole).
import type { Instant } from '../core-time/index.ts';
import type { Star, StarCatalogue } from './catalogue.ts';

export interface Body {
  /** Ids as stars have them on a star map (the Sun 0, then the planets outward, Pluto 9). */
  id: number; name: string; color: string; size: number;
  /** a (au), e, I (deg), L (deg), longitude of perihelion (deg), longitude of the ascending node (deg), and their rates per Julian century. */
  el: [number, number, number, number, number, number]; rate: [number, number, number, number, number, number];
}

export const BODIES: Body[] = [
  { id: 1, name: 'Mercury', color: '#b8b2aa', size: 3.2, el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  { id: 2, name: 'Venus', color: '#e8d6a8', size: 4.4, el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418] },
  { id: 3, name: 'Earth', color: '#6fa8ff', size: 4.6, el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0] },
  { id: 4, name: 'Mars', color: '#e0704a', size: 3.8, el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  { id: 5, name: 'Jupiter', color: '#d9b48a', size: 7.5, el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  { id: 6, name: 'Saturn', color: '#e6cf8f', size: 6.8, el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  { id: 7, name: 'Uranus', color: '#9fe3e8', size: 5.6, el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  { id: 8, name: 'Neptune', color: '#6f8ff0', size: 5.4, el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
  { id: 9, name: 'Pluto', color: '#c9a98a', size: 2.6, el: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684], rate: [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482] },
];

/** Julian centuries from J2000 (2000 January 1, 12:00) to an instant. */
export function centuriesSinceJ2000(t: Instant): number {
  return (t.day + t.ms / 86_400_000 + 2440587.5 - 2451545.0) / 36525;
}

const RAD = Math.PI / 180;

/** Where a body is (au, ecliptic) at T Julian centuries from J2000. */
export function bodyAt(b: Body, T: number): [number, number, number] {
  const [a, e, I, L, wbar, node] = b.el.map((v, i) => v + b.rate[i] * T);
  const w = wbar - node;
  let M = (((L - wbar) % 360) + 540) % 360 - 180;
  // Kepler's equation, solved by Newton's method (in degrees, as the elements are).
  const estar = e / RAD;
  let E = M + estar * Math.sin(M * RAD);
  for (let i = 0; i < 30; i++) {
    const dM = M - (E - estar * Math.sin(E * RAD)), dE = dM / (1 - e * Math.cos(E * RAD));
    E += dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  const xp = a * (Math.cos(E * RAD) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E * RAD);
  const cw = Math.cos(w * RAD), sw = Math.sin(w * RAD), cO = Math.cos(node * RAD), sO = Math.sin(node * RAD), cI = Math.cos(I * RAD), sI = Math.sin(I * RAD);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** The points of a body's orbit (au, ecliptic) as it is at T, `n` of them round it. */
export function orbitAt(b: Body, T: number, n = 180): Array<[number, number, number]> {
  const [a, e, I, , wbar, node] = b.el.map((v, i) => v + b.rate[i] * T);
  const w = wbar - node;
  const cw = Math.cos(w * RAD), sw = Math.sin(w * RAD), cO = Math.cos(node * RAD), sO = Math.sin(node * RAD), cI = Math.cos(I * RAD), sI = Math.sin(I * RAD);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const E = (i / n) * Math.PI * 2, xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    out.push([(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp]);
  }
  return out;
}

/** How long a body takes to go round the Sun (years), from its orbit's size. */
export const orbitalYears = (b: Body) => Math.pow(b.el[0], 1.5);

/** How far out the solar system map reaches (au): Pluto's farthest. */
export const SOLAR_RADIUS_AU = 50;

/**
 * Distances as drawn: true, or compressed (the square root of the distance, scaled to keep the
 * outermost orbits where they are), so that the inner planets are not crowded together.
 */
export type SolarScale = 'true' | 'compressed';
export function scalePoint(p: [number, number, number], scale: SolarScale): [number, number, number] {
  if (scale === 'true') return p;
  const r = Math.hypot(p[0], p[1], p[2]);
  if (!r) return p;
  const k = Math.sqrt(r * SOLAR_RADIUS_AU) / r;
  return [p[0] * k, p[1] * k, p[2] * k];
}

/**
 * The large moons (D117), going round their planets at their true periods. They are drawn round their
 * planet far wider than they are (at true scale they would sit on it), on the plane of the planets' orbits.
 * The Moon's place is its mean longitude for the date, and Jupiter's four large moons' their mean
 * longitudes (J. Meeus, Astronomical Algorithms, ch. 44, lower accuracy): each where it is, roughly;
 * the others go round at their periods from a starting place of no meaning (`placed`: false).
 */
export interface Moon { id: number; name: string; planet: number; days: number; L0: number; placed: boolean; color: string; retrograde?: boolean }
export const MOONS: Moon[] = [
  { id: 31, name: 'Moon', planet: 3, days: 27.321661, L0: 218.3165, placed: true, color: '#d8d4cc' },
  { id: 41, name: 'Phobos', planet: 4, days: 0.31891, L0: 0, placed: false, color: '#a89a8c' },
  { id: 42, name: 'Deimos', planet: 4, days: 1.26244, L0: 120, placed: false, color: '#b8ab9c' },
  { id: 51, name: 'Io', planet: 5, days: 360 / 203.48895579, L0: 106.07719, placed: true, color: '#f2dc7a' },
  { id: 52, name: 'Europa', planet: 5, days: 360 / 101.374724735, L0: 175.73161, placed: true, color: '#e6d9c2' },
  { id: 53, name: 'Ganymede', planet: 5, days: 360 / 50.317609207, L0: 120.55883, placed: true, color: '#b9ad9e' },
  { id: 54, name: 'Callisto', planet: 5, days: 360 / 21.571071177, L0: 84.44459, placed: true, color: '#8f8578' },
  { id: 62, name: 'Enceladus', planet: 6, days: 1.370218, L0: 40, placed: false, color: '#f4f7fb' },
  { id: 63, name: 'Rhea', planet: 6, days: 4.518212, L0: 200, placed: false, color: '#d6d1c9' },
  { id: 61, name: 'Titan', planet: 6, days: 15.945421, L0: 300, placed: false, color: '#e3b46a' },
  { id: 71, name: 'Titania', planet: 7, days: 8.706234, L0: 60, placed: false, color: '#c9c3bd' },
  { id: 72, name: 'Oberon', planet: 7, days: 13.463234, L0: 250, placed: false, color: '#b8b0a8' },
  { id: 81, name: 'Triton', planet: 8, days: 5.876854, L0: 90, placed: false, color: '#d9e3e8', retrograde: true },
  { id: 91, name: 'Charon', planet: 9, days: 6.38723, L0: 30, placed: false, color: '#b5ada6' },
];

/** The moons' mean distances from their planets (km). */
export const MOON_ORBIT_KM: Readonly<Record<number, number>> = {
  31: 384400, 41: 9376, 42: 23463, 51: 421700, 52: 671034, 53: 1070412, 54: 1882709, 62: 238042, 63: 527108, 61: 1221870, 71: 435910, 72: 583520, 81: 354759, 91: 19591,
};
export const AU_KM = 149597870.7;

/**
 * How far from its planet a moon is drawn (au as drawn): true to scale, its true distance (D208); compressed, the inner
 * moons nearer and each a step further out (at true distances they would sit on their planet's dot).
 */
function moonRadius(m: Moon, scale: SolarScale): number {
  if (scale === 'true') return (MOON_ORBIT_KM[m.id] ?? 400000) / AU_KM;
  const rank = MOONS.filter((x) => x.planet === m.planet && x.days < m.days).length;
  return 0.38 * (1 + 0.55 * rank);
}

/** Where a moon is drawn (au, ecliptic, as drawn) at T centuries from J2000, given its planet's place as drawn. */
export function moonAt(m: Moon, T: number, planet: [number, number, number], scale: SolarScale): [number, number, number] {
  const days = T * 36525, a = ((m.L0 + (m.retrograde ? -1 : 1) * (360 * days) / m.days) % 360) * (Math.PI / 180), r = moonRadius(m, scale);
  return [planet[0] + r * Math.cos(a), planet[1] + r * Math.sin(a), planet[2]];
}

/** The Sun, the planets and their large moons as a catalogue the space renderer draws (positions as drawn), at an instant. */
export function solarCatalogue(t: Instant, scale: SolarScale): StarCatalogue {
  const T = centuriesSinceJ2000(t);
  // (True to scale, D208: each body at its true size too, in au.)
  const radius = (id: number) => (scale === 'true' ? (RADIUS_KM[id] ?? 1000) / AU_KM : undefined);
  const stars: Star[] = [{ id: 0, name: 'Sun', alt: '', x: 0, y: 0, z: 0, dist: 0, absmag: 4.83, spect: 'G2V', system: 0, color: '#ffd76a', size: 9, radius: radius(0) }];
  const drawn = new Map<number, [number, number, number]>();
  for (const b of BODIES) {
    const p = bodyAt(b, T), q = scalePoint(p, scale);
    drawn.set(b.id, q);
    stars.push({ id: b.id, name: b.name, alt: '', x: q[0], y: q[1], z: q[2], dist: Math.hypot(p[0], p[1], p[2]), absmag: 0, spect: '', system: 0, color: b.color, size: b.size, radius: radius(b.id) });
  }
  for (const m of MOONS) {
    const q = moonAt(m, T, drawn.get(m.planet)!, scale), planet = stars[m.planet];
    stars.push({ id: m.id, name: m.name, alt: `a moon of ${planet.name}`, x: q[0], y: q[1], z: q[2], dist: planet.dist, absmag: 0, spect: '', system: 0, color: m.color, size: 2.3, kind: 'moon', minor: true, around: m.planet , radius: radius(m.id) });
  }
  return { radiusLy: SOLAR_RADIUS_AU, stars, byId: new Map(stars.map((s) => [s.id, s])) };
}

/**
 * The solar system side by side (D133): not where the bodies are but who they are, in order: the Sun at the
 * left, the planets in a row, each planet's large moons in a column below it, inner first. Units as drawn (the
 * row is `ROW_STEP` from body to body when even, centred on the middle of the map); distances from the Sun stay
 * true for the panels. How it is drawn can be chosen (D192, `SolarRow`): the bodies' sizes, the spacing of the row,
 * which moons. Every body keeps its id, so who holds what and the lanes between them stay.
 */
export const ROW_STEP = 10;
const MOON_STEP = 3.4, ROW_Y = 6, DWARF_Y = ROW_Y - 6;
export const ROW_RADIUS = 33;

/**
 * Sizes: as drawn before (picked to read well), all alike, true to each other, or compressed (by the square root);
 * or as a poster (D208): true to each other, the Sun too (only its edge showing at the left), the names slanting
 * up from the planets, and the dwarf planets (Ceres, Pluto, Eris) in a row of their own below.
 */
export type RowSizes = 'styled' | 'equal' | 'true' | 'compressed' | 'poster';
/** Spacing: even steps, true to the distances from the Sun, or compressed (by the square root). */
export type RowSpacing = 'even' | 'true' | 'compressed';
export interface SolarRow { sizes: RowSizes; spacing: RowSpacing; moons: 'all' | 'none' | 'chosen'; chosen: number[] }
export const DEFAULT_SOLAR_ROW: SolarRow = { sizes: 'styled', spacing: 'even', moons: 'all', chosen: [] };

/** A side-by-side solar system's settings as stored, checked. */
export function solarRowOf(v: unknown): SolarRow {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<SolarRow>;
  const ids = new Set(MOONS.map((m) => m.id));
  return {
    sizes: (['styled', 'equal', 'true', 'compressed', 'poster'] as const).includes(o.sizes as RowSizes) ? (o.sizes as RowSizes) : 'styled',
    spacing: (['even', 'true', 'compressed'] as const).includes(o.spacing as RowSpacing) ? (o.spacing as RowSpacing) : 'even',
    moons: o.moons === 'none' || o.moons === 'chosen' ? o.moons : 'all',
    chosen: Array.isArray(o.chosen) ? [...new Set(o.chosen.filter((x): x is number => typeof x === 'number' && ids.has(x)))] : [],
  };
}

/** Mean radii (km): the Sun, the planets and Pluto by id, and the moons. */
export const RADIUS_KM: Readonly<Record<number, number>> = {
  0: 695700, 1: 2439.7, 2: 6051.8, 3: 6371, 4: 3389.5, 5: 69911, 6: 58232, 7: 25362, 8: 24622, 9: 1188.3,
  31: 1737.4, 41: 11.3, 42: 6.2, 51: 1821.6, 52: 1560.8, 53: 2634.1, 54: 2410.3, 61: 2574.7, 62: 252.1, 63: 763.8, 71: 788.4, 72: 761.4, 81: 1353.4, 91: 606,
  101: 469.7, 102: 1163,
};

/** The dwarf planets shown in a poster row besides Pluto (D208): only there, where where they are does not matter. Mean distances from the Sun (au). */
export const DWARFS: Array<{ id: number; name: string; color: string; au: number }> = [
  { id: 101, name: 'Ceres', color: '#a8a29a', au: 2.7675 },
  { id: 102, name: 'Eris', color: '#dcd6cf', au: 67.86 },
];

/**
 * The size a body is drawn at in a row (as a planet's `size`): true sizes have Jupiter 13 across its radius and the
 * rest to scale (the Sun, ten times wider, held at three Jupiters so the row still shows); compressed by the square
 * root of that; equal all alike; styled as before.
 */
export function rowSize(id: number, sizes: RowSizes, styled: number): number {
  const rel = (RADIUS_KM[id] ?? 1000) / RADIUS_KM[5];
  if (sizes === 'styled') return styled;
  if (sizes === 'equal') return id === 0 ? 9 : id > 10 ? 3 : 6;
  if (sizes === 'true') return id === 0 ? 39 : Math.max(id > 10 ? 0.7 : 0.9, 13 * rel);
  if (sizes === 'poster') return Math.max(id > 10 && id < 100 ? 0.7 : 0.9, 13 * rel);
  return id === 0 ? 26 : Math.max(id > 10 ? 1.2 : 2, 13 * Math.sqrt(rel));
}

export function solarRowCatalogue(t: Instant, row: SolarRow = DEFAULT_SOLAR_ROW): StarCatalogue {
  const T = centuriesSinceJ2000(t), span = BODIES.length * ROW_STEP, x0 = -span / 2, far = Math.max(...BODIES.map((b) => b.el[0]));
  const xOf = (b: Body, i: number) => (row.spacing === 'true' ? x0 + span * (b.el[0] / far) : row.spacing === 'compressed' ? x0 + span * Math.sqrt(b.el[0] / far) : x0 + (i + 1) * ROW_STEP);
  const poster = row.sizes === 'poster';
  // (As a poster, the Sun's edge just short of Mercury, its disc off to the left.)
  const stars: Star[] = [{ id: 0, name: 'Sun', alt: '', x: poster ? x0 + ROW_STEP * 0.55 : x0, y: ROW_Y, z: 0, dist: 0, absmag: 4.83, spect: 'G2V', system: 0, color: '#ffd76a', size: rowSize(0, row.sizes, 15), ...(poster ? { limb: true } : {}) }];
  BODIES.forEach((b, i) => {
    const p = bodyAt(b, T);
    // (As a poster, Pluto is with the dwarf planets, below the row, past Neptune.)
    const dwarf = poster && b.id === 9;
    stars.push({ id: b.id, name: b.name, alt: '', x: dwarf ? x0 + 8.6 * ROW_STEP : xOf(b, i), y: dwarf ? DWARF_Y : ROW_Y, z: 0, dist: Math.hypot(p[0], p[1], p[2]), absmag: 0, spect: '', system: 0, color: b.color, size: rowSize(b.id, row.sizes, b.size * 1.5), ...(dwarf ? { dwarf: true } : {}) });
  });
  if (poster) {
    // Ceres between Mars and Jupiter, Eris past Pluto.
    const at: Record<number, number> = { 101: x0 + 4.5 * ROW_STEP, 102: x0 + 9.4 * ROW_STEP };
    for (const d of DWARFS) stars.push({ id: d.id, name: d.name, alt: 'a dwarf planet', x: at[d.id], y: DWARF_Y, z: 0, dist: d.au, absmag: 0, spect: '', system: 0, color: d.color, size: rowSize(d.id, row.sizes, 2), dwarf: true });
  }
  const shown = MOONS.filter((m) => row.moons === 'all' || (row.moons === 'chosen' && row.chosen.includes(m.id)));
  for (const m of shown) {
    const planet = stars[m.planet], rank = shown.filter((x) => x.planet === m.planet && x.days < m.days).length;
    stars.push({ id: m.id, name: m.name, alt: `a moon of ${planet.name}`, x: planet.x, y: ROW_Y - 4.6 - MOON_STEP * rank, z: 0, dist: planet.dist, absmag: 0, spect: '', system: 0, color: m.color, size: rowSize(m.id, row.sizes, 2.8), kind: 'moon', minor: true, around: m.planet });
  }
  return { radiusLy: ROW_RADIUS, stars, byId: new Map(stars.map((s) => [s.id, s])) };
}

/** The lines of the side-by-side solar system (D133): the row from the Sun to the last planet, and each planet's column of moons. */
export function solarRowLines(cat: StarCatalogue): Array<{ color: string; points: Array<[number, number, number]> }> {
  const sun = cat.byId.get(0)!, last = [...BODIES].reverse().map((b) => cat.byId.get(b.id)!).find((s) => !s.dwarf)!;
  const out: Array<{ color: string; points: Array<[number, number, number]> }> = [{ color: 'rgba(170,190,220,0.6)', points: [[sun.x, sun.y, 0], [last.x, last.y, 0]] }];
  for (const b of BODIES) {
    const moons = cat.stars.filter((s) => s.around === b.id);
    if (!moons.length) continue;
    const p = cat.byId.get(b.id)!, low = Math.min(...moons.map((m) => m.y));
    out.push({ color: 'rgba(170,190,220,0.45)', points: [[p.x, p.y, 0], [p.x, low, 0]] });
  }
  return out;
}

/** The planets' orbits as drawn, at an instant, and the circles the moons are drawn on round their planets. */
export function solarOrbits(t: Instant, scale: SolarScale): Array<{ id: number; color: string; points: Array<[number, number, number]>; small?: boolean }> {
  const T = centuriesSinceJ2000(t);
  const planets = BODIES.map((b) => ({ id: b.id, color: b.color, points: orbitAt(b, T, b.id >= 5 ? 240 : 160).map((p) => scalePoint(p, scale)) }));
  const moons = MOONS.map((m) => {
    const c = scalePoint(bodyAt(BODIES.find((b) => b.id === m.planet)!, T), scale), r = moonRadius(m, scale);
    return { id: m.id, color: 'rgba(200,210,230,0.35)', points: Array.from({ length: 49 }, (_, i) => [c[0] + r * Math.cos((i / 48) * Math.PI * 2), c[1] + r * Math.sin((i / 48) * Math.PI * 2), c[2]] as [number, number, number]), small: true };
  });
  return [...planets, ...moons];
}
