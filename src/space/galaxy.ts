// Galaxy maps (Stage 11, D116): the Milky Way, or a galaxy of one's own, seen whole. Spiral arms, a
// bar and a bulge are drawn as a glow of many faint points; star systems along the arms are held by
// countries and factions and joined by lanes as on star maps (D111, D112), and the Milky Way's best
// known places are where they are seen from the Sun.
//
// Positions are light-years on galactic axes centred on the galaxy's middle: x from the Sun's side
// toward the middle, y the way the galaxy turns at the Sun (galactic longitude 90°), z toward the
// north galactic pole. The Sun lies 26,670 light-years from the middle (GRAVITY Collaboration 2019).
// The Milky Way's arms are logarithmic spirals with the reference radii, angles and pitches of Reid
// et al. 2014 (ApJ 783, 130), scaled to that distance, carried on round the far side of the galaxy
// (where they are less well known); the long bar points 27° from the line to the Sun. Places are
// placed from their galactic longitude, latitude and distance (rounded values from the literature).
import { seeded } from '../presentation/looks.ts';
import type { Star, StarCatalogue } from './catalogue.ts';
import type { Vec3 } from './space-view.ts';
import { nameMaker } from './invented.ts';

/** A galaxy map's settings: the Milky Way, or one of the user's own; how many star systems; and for one's own its shape. */
export interface GalaxySettings {
  kind: 'milkyway' | 'invented';
  /** Where the star systems lie (and, for a galaxy of one's own, its shape). */
  seed: number;
  systems: number;
  /** A galaxy of one's own: how many arms, how tightly wound (degrees), its size (light-years) and whether it has a bar. */
  arms: number; pitch: number; radiusLy: number; bar: boolean;
}
export const DEFAULT_GALAXY: GalaxySettings = { kind: 'milkyway', seed: 1, systems: 600, arms: 4, pitch: 14, radiusLy: 50000, bar: true };

/** Light-years in a kiloparsec. */
const KPC = 3261.56;
/** The Sun's distance from the Milky Way's middle, light-years (8.178 kpc). */
export const SUN_FROM_CENTRE_LY = 26670;

/** An arm: a logarithmic spiral, ln(R / rRef) = -(beta - betaRef) tan(pitch), over angles from..to (degrees), so wide (light-years) and so bright. */
export interface GalaxyArm { name: string; rRef: number; betaRef: number; pitch: number; from: number; to: number; width: number; weight: number }
export interface GalaxyModel {
  name: string; radiusLy: number; arms: GalaxyArm[];
  /** The bar: half its length and its width (light-years), and its angle from the line to the Sun (degrees). */
  bar: { half: number; width: number; angle: number } | null;
  /** The bulge's and the disc's sizes, and how thick the disc is (light-years). */
  bulge: number; disc: number; thickness: number;
  /** Where the Sun (or the home system) is. */
  home: Vec3;
}

// (Reid et al. 2014, table 2, with R0 = 8.34 kpc: scaled to the Sun's distance used here.)
const REID = SUN_FROM_CENTRE_LY / (8.34 * KPC);
const MILKY_WAY: GalaxyModel = {
  name: 'The Milky Way', radiusLy: 60000,
  arms: [
    { name: 'Scutum–Centaurus Arm', rRef: 5.0 * KPC * REID, betaRef: 27.6, pitch: 19.8, from: -165, to: 200, width: 2300, weight: 1 },
    { name: 'Perseus Arm', rRef: 9.9 * KPC * REID, betaRef: 14.2, pitch: 9.4, from: -210, to: 170, width: 2300, weight: 1 },
    { name: 'Sagittarius–Carina Arm', rRef: 6.6 * KPC * REID, betaRef: 25.6, pitch: 6.9, from: -120, to: 190, width: 1700, weight: 0.7 },
    { name: 'Norma–Outer Arm', rRef: 13.0 * KPC * REID, betaRef: 18.6, pitch: 13.8, from: -110, to: 265, width: 2000, weight: 0.55 },
    { name: 'Orion–Cygnus Arm', rRef: 8.4 * KPC * REID, betaRef: 8.9, pitch: 12.8, from: -45, to: 55, width: 1300, weight: 0.5 },
  ],
  bar: { half: 4.5 * KPC, width: 1.3 * KPC, angle: 27 },
  bulge: 1.1 * KPC, disc: 2.6 * KPC, thickness: 1000,
  home: [-SUN_FROM_CENTRE_LY, 0, 0],
};

/** The Milky Way's places: name, kind, galactic longitude and latitude (degrees), distance from the Sun (light-years), another name. */
const PLACES: Array<[string, string, number, number, number, string?]> = [
  ['Sun', 'our star', 0, 0, 0, 'Sol'],
  ['Sagittarius A*', 'supermassive black hole', 359.944, -0.046, 26670, 'the black hole at the middle'],
  ['Orion Nebula', 'nebula', 209.01, -19.38, 1344, 'M42'],
  ['Pleiades', 'star cluster', 166.57, -23.52, 444, 'M45, the Seven Sisters'],
  ['Crab Nebula', 'supernova remnant', 184.56, -5.78, 6500, 'M1, the supernova of 1054'],
  ['Eagle Nebula', 'nebula', 16.95, 0.79, 5700, 'M16, the Pillars of Creation'],
  ['Carina Nebula', 'nebula', 287.6, -0.6, 8500, 'NGC 3372'],
  ['Eta Carinae', 'star', 287.6, -0.63, 7500, 'a giant star near its end'],
  ['Omega Centauri', 'globular cluster', 309.1, 14.97, 17090, 'NGC 5139'],
  ['47 Tucanae', 'globular cluster', 305.89, -44.89, 14700, 'NGC 104'],
  ['Hercules Cluster', 'globular cluster', 59.01, 40.91, 22200, 'M13'],
  ['Betelgeuse', 'star', 199.79, -8.96, 548, 'Alpha Orionis'],
  ['Rigel', 'star', 209.24, -25.25, 860, 'Beta Orionis'],
  ['Deneb', 'star', 84.28, 1.99, 2600, 'Alpha Cygni'],
  ['Polaris', 'star', 123.28, 26.46, 433, 'the North Star'],
  ['Antares', 'star', 351.95, 15.06, 550, 'Alpha Scorpii'],
  ['VY Canis Majoris', 'star', 239.36, -5.07, 3900, 'one of the largest stars known'],
  ['Cygnus X-1', 'black hole', 71.33, 3.07, 7240],
  ['Lagoon Nebula', 'nebula', 6.0, -1.2, 4100, 'M8'],
  ['Ring Nebula', 'nebula', 63.17, 13.98, 2570, 'M57'],
  ['Helix Nebula', 'nebula', 36.16, -57.12, 650, 'NGC 7293'],
  ["Cat's Eye Nebula", 'nebula', 96.47, 29.95, 3300, 'NGC 6543'],
  ['Horsehead Nebula', 'nebula', 206.9, -16.6, 1375, 'Barnard 33'],
  ['Vela Pulsar', 'pulsar', 263.55, -2.79, 936],
  ['Cassiopeia A', 'supernova remnant', 111.73, -2.13, 11000],
  ['Westerlund 1', 'star cluster', 339.55, -0.4, 12700],
  ['Rosette Nebula', 'nebula', 206.3, -2.1, 5200, 'NGC 2237'],
  ['North America Nebula', 'nebula', 85.6, -0.7, 2590, 'NGC 7000'],
  ["Tycho's Supernova Remnant", 'supernova remnant', 120.09, 1.42, 9000, 'SN 1572'],
  ["Kepler's Supernova Remnant", 'supernova remnant', 4.53, 6.82, 17000, 'SN 1604'],
  ['Sagittarius Dwarf Galaxy', 'dwarf galaxy', 5.6, -14.2, 65000],
  ['Large Magellanic Cloud', 'dwarf galaxy', 280.47, -32.89, 163000],
  ['Small Magellanic Cloud', 'dwarf galaxy', 302.8, -44.3, 200000],
];

/** Colours of places by their kind. */
const PLACE_COLOURS: Record<string, string> = {
  'our star': '#fff1c9', 'supermassive black hole': '#ffb066', 'black hole': '#ffb066', nebula: '#ff8fc0', 'star cluster': '#a9c8ff',
  'globular cluster': '#ffe2a8', 'supernova remnant': '#9ff0e0', star: '#ffffff', pulsar: '#9ff0e0', 'dwarf galaxy': '#d7c8ff',
};

const RAD = Math.PI / 180;
/** Where a place seen from the Sun at longitude l, latitude b, distance d lies on the galaxy's axes. */
export function placeAt(l: number, b: number, d: number, home: Vec3 = MILKY_WAY.home): Vec3 {
  return [home[0] + d * Math.cos(b * RAD) * Math.cos(l * RAD), home[1] + d * Math.cos(b * RAD) * Math.sin(l * RAD), home[2] + d * Math.sin(b * RAD)];
}

/** A point of an arm at angle beta (degrees, 0 toward the Sun, growing the way the galaxy turns). */
export function armPoint(a: GalaxyArm, beta: number): [number, number] {
  const R = a.rRef * Math.exp(-(beta - a.betaRef) * RAD * Math.tan(a.pitch * RAD));
  // (Measured from the Sun's direction, the way the galaxy turns: clockwise seen from the north.)
  const th = Math.PI - beta * RAD;
  return [R * Math.cos(th), R * Math.sin(th)];
}

/** The model of a galaxy map: the Milky Way, or one's own made from its settings. */
export function galaxyModel(g: GalaxySettings): GalaxyModel {
  if (g.kind === 'milkyway') return MILKY_WAY;
  const rnd = seeded(g.seed * 104729 + 7);
  const name = nameMaker(rnd);
  const R = g.radiusLy, n = Math.max(1, Math.min(8, Math.round(g.arms)));
  const arms: GalaxyArm[] = [];
  for (let i = 0; i < n; i++) {
    const strong = n <= 2 || i % 2 === 0;
    arms.push({ name: `${name(true)} Arm`, rRef: R * 0.45, betaRef: (360 / n) * i + rnd() * 20, pitch: g.pitch * (0.85 + rnd() * 0.3), from: -200, to: 220, width: R * (strong ? 0.042 : 0.032), weight: strong ? 1 : 0.6 });
  }
  return {
    name: 'A galaxy of your own', radiusLy: R * 1.2, arms,
    bar: g.bar ? { half: R * 0.17, width: R * 0.05, angle: 20 + rnd() * 30 } : null,
    bulge: R * 0.045, disc: R * 0.17, thickness: R * 0.02,
    // (The home system half way out, on the first arm.)
    home: (() => { const a = arms[0]; const beta = a.betaRef - Math.log(0.55 * R / a.rRef) / Math.tan(a.pitch * RAD) / RAD; const [x, y] = armPoint(a, beta); return [x, y, 0] as Vec3; })(),
  };
}

/** A normally distributed number (Box–Muller) from a random source. */
const gauss = (rnd: () => number) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

/**
 * A point of the galaxy drawn at random as its stars lie: in the bar and bulge, along an arm, or in the
 * disc between them. Also says which (0 bulge, 1 arm, 2 disc), for its colour.
 */
function samplePoint(m: GalaxyModel, rnd: () => number, parts = { bulge: 0.13, arms: 0.55 }): { p: Vec3; part: 0 | 1 | 2 } {
  const x = rnd();
  if (x < parts.bulge) {
    if (m.bar && rnd() < 0.6) {
      // Along the bar.
      const t = (rnd() * 2 - 1) * m.bar.half, w = gauss(rnd) * m.bar.width * 0.45;
      const th = Math.PI - m.bar.angle * RAD;
      return { p: [t * Math.cos(th) - w * Math.sin(th), t * Math.sin(th) + w * Math.cos(th), gauss(rnd) * m.bar.width * 0.35], part: 0 };
    }
    return { p: [gauss(rnd) * m.bulge, gauss(rnd) * m.bulge, gauss(rnd) * m.bulge * 0.7], part: 0 };
  }
  if (x < parts.bulge + parts.arms) {
    let total = 0;
    for (const a of m.arms) total += a.weight * (a.to - a.from);
    let pick = rnd() * total, arm = m.arms[0];
    for (const a of m.arms) { pick -= a.weight * (a.to - a.from); if (pick <= 0) { arm = a; break; } }
    const beta = arm.from + rnd() * (arm.to - arm.from);
    const [ax, ay] = armPoint(arm, beta);
    const r = Math.hypot(ax, ay);
    // (Arms fade toward their ends, and inside the bulge.)
    if (r < m.bulge * 2.5 || r > m.radiusLy) return samplePoint(m, rnd, parts);
    const w = arm.width * (0.6 + 0.5 * Math.min(1, r / (m.radiusLy * 0.5)));
    return { p: [ax + gauss(rnd) * w, ay + gauss(rnd) * w, gauss(rnd) * m.thickness * 0.35], part: 1 };
  }
  // The disc: exponential outward.
  const r = -m.disc * Math.log(1 - rnd() * 0.995), th = rnd() * Math.PI * 2;
  if (r > m.radiusLy) return samplePoint(m, rnd, parts);
  return { p: [r * Math.cos(th), r * Math.sin(th), gauss(rnd) * m.thickness * 0.5], part: 2 };
}

/** The glow of a galaxy (its colours: 0 bulge, 1 arms, 2 disc, 3 star-forming clouds): x, y, z and colour for each point. */
export interface GalaxyDust { points: Float32Array; count: number; colors: string[]; size: number }

/** The galaxy's glow: `count` points as its stars lie (the same every time for the same galaxy). */
export function galaxyDust(m: GalaxyModel, count = 18000, seed = 11): GalaxyDust {
  const rnd = seeded(seed);
  const points = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const { p, part } = samplePoint(m, rnd);
    // (Some of the arms' points are the pink of star-forming clouds.)
    const c = part === 1 && rnd() < 0.08 ? 3 : part;
    points.set([p[0], p[1], p[2], c], i * 4);
  }
  return { points, count, colors: ['#ffcf94', '#9dbcff', '#c9d2ee', '#ff8fc0'], size: m.radiusLy / 190 };
}

/** Where an arm's name is written: on the arm, part way out. */
export function armLabels(m: GalaxyModel): Array<{ name: string; at: Vec3 }> {
  return m.arms.map((a) => {
    const target = Math.min(m.radiusLy * 0.72, Math.max(m.bulge * 4, a.rRef * 1.15));
    let beta = a.betaRef - Math.log(target / a.rRef) / Math.tan(a.pitch * RAD) / RAD;
    beta = Math.max(a.from + 10, Math.min(a.to - 10, beta));
    const [x, y] = armPoint(a, beta);
    return { name: a.name, at: [x, y, 0] as Vec3 };
  });
}

/** Ids of star systems start here (places of the Milky Way have their own, below). */
export const SYSTEM_ID_BASE = 1000;

/**
 * The places and star systems of a galaxy map, as a catalogue the space renderer draws: the Milky
 * Way's places (the Sun id 0), or the home system (id 0) of one's own; then `systems` star systems
 * along the arms and in the disc (ids from 1000), with names of their own, named on the map only
 * close in or when held. `dist` is the distance from the Sun (or home).
 */
export function galaxyCatalogue(g: GalaxySettings): StarCatalogue {
  const m = galaxyModel(g);
  const stars: Star[] = [];
  const from = (p: Vec3) => Math.hypot(p[0] - m.home[0], p[1] - m.home[1], p[2] - m.home[2]);
  if (g.kind === 'milkyway') {
    PLACES.forEach(([name, kind, l, b, d, alt], id) => {
      const p = placeAt(l, b, d, m.home);
      stars.push({ id, name, alt: alt ?? '', x: p[0], y: p[1], z: p[2], dist: d, absmag: id === 0 ? 4.83 : -5, spect: '', system: 0, color: PLACE_COLOURS[kind] ?? '#ffffff', size: id === 0 ? 4.2 : 3.4, kind });
    });
  } else {
    const rnd = seeded(g.seed * 31 + 5);
    stars.push({ id: 0, name: nameMaker(rnd)(true), alt: 'Home', x: m.home[0], y: m.home[1], z: m.home[2], dist: 0, absmag: 4.83, spect: 'G2V', system: 0, color: '#fff1c9', size: 4.2, kind: 'home system' });
  }
  const rnd = seeded(g.seed * 7919 + 101);
  const name = nameMaker(rnd);
  const n = Math.max(0, Math.min(5000, Math.round(g.systems)));
  for (let i = 0; i < n; i++) {
    // (Not in the crowded middle: systems from a little way out.)
    let p: Vec3;
    do p = samplePoint(m, rnd, { bulge: 0, arms: 0.62 }).p; while (Math.hypot(p[0], p[1]) < m.bulge * 2.2);
    stars.push({ id: SYSTEM_ID_BASE + i, name: name(false), alt: '', x: p[0], y: p[1], z: p[2], dist: from(p), absmag: 8, spect: '', system: 0, color: '#dfe7ff', size: 2.1, kind: 'star system', minor: true });
  }
  return { radiusLy: m.radiusLy, stars, byId: new Map(stars.map((s) => [s.id, s])) };
}

/** Galaxy catalogues once made (by their settings). */
const made = new Map<string, { cat: StarCatalogue; dust: GalaxyDust; arms: Array<{ name: string; at: Vec3 }>; model: GalaxyModel }>();
export function galaxyCached(g: GalaxySettings): { cat: StarCatalogue; dust: GalaxyDust; arms: Array<{ name: string; at: Vec3 }>; model: GalaxyModel } {
  const key = JSON.stringify(g.kind === 'milkyway' ? [g.kind, g.seed, g.systems] : g);
  let c = made.get(key);
  if (!c) {
    const model = galaxyModel(g);
    c = { cat: galaxyCatalogue(g), dust: galaxyDust(model, 18000, g.kind === 'milkyway' ? 11 : g.seed + 11), arms: armLabels(model), model };
    made.set(key, c);
    if (made.size > 6) made.delete(made.keys().next().value!);
  }
  return c;
}
