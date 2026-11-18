// Invented star maps (Stage 11, D114): a field of stars of the user's own around a home star, made
// from a seed (the same seed, the same stars), for settings that are not our own neighbourhood. The
// kinds of star come in about the shares they have around the Sun (most of them red dwarfs), each
// with a brightness of its kind; names are made from syllables, the faintest given catalogue numbers.
import { seeded } from '../presentation/looks.ts';
import type { Star, StarCatalogue } from './catalogue.ts';

export interface InventedSettings { seed: number; count: number; radiusLy: number; shape: 'sphere' | 'disc' }
export const DEFAULT_INVENTED: InventedSettings = { seed: 1, count: 300, radiusLy: 50, shape: 'sphere' };

/** Kinds of star, their share, spectral type and range of absolute magnitude. */
const KINDS: Array<{ share: number; types: string[]; mag: [number, number] }> = [
  { share: 0.72, types: ['M0V', 'M1V', 'M2V', 'M3V', 'M4V', 'M5V', 'M6V'], mag: [8.8, 16] },
  { share: 0.12, types: ['K0V', 'K2V', 'K4V', 'K5V', 'K7V'], mag: [5.9, 8.4] },
  { share: 0.07, types: ['G0V', 'G2V', 'G5V', 'G8V'], mag: [4.2, 5.6] },
  { share: 0.03, types: ['F0V', 'F5V', 'F8V'], mag: [2.6, 4.0] },
  { share: 0.008, types: ['A0V', 'A5V'], mag: [0.6, 2.2] },
  { share: 0.002, types: ['B5V', 'B8V'], mag: [-1.2, 0.2] },
  { share: 0.045, types: ['DA2', 'DA5', 'DC9'], mag: [10.5, 15] },
  { share: 0.005, types: ['K0III', 'G8III'], mag: [-0.5, 1.2] },
];

const START = ['Ka', 'Ve', 'Tor', 'Al', 'Ser', 'Mi', 'Dra', 'Ory', 'Zen', 'Lu', 'Ca', 'Thal', 'Ny', 'Ar', 'Bel', 'Cor', 'Eph', 'Gal', 'Hy', 'Is', 'Jor', 'Kel', 'Lyr', 'Mor', 'Nax', 'Ost', 'Pyr', 'Quel', 'Rhe', 'Sel', 'Tav', 'Ul', 'Vor', 'Wyn', 'Xe', 'Yr', 'Zar', 'Ae', 'Bra', 'Cyr'];
const MIDDLE = ['ra', 'li', 'ne', 'to', 'va', 'ri', 'do', 'sa', 'mi', 'the', 'lo', 'na', 'ce', 'ru', 'ma', 'di'];
const END = ['n', 's', 'x', 'th', 'ra', 'ia', 'on', 'us', 'is', 'ar', 'el', 'or', 'ion', 'eth', 'a', 'e', 'ix', 'ane'];

/** The invented stars of a seed: the home star (id 0) in the middle, then the others, nearest first. */
export function inventedStars(o: InventedSettings): StarCatalogue {
  const rnd = seeded(o.seed * 7919 + 17);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const used = new Set<string>();
  const name = (bright: boolean): string => {
    for (let tries = 0; tries < 20; tries++) {
      const n = pick(START) + (rnd() < 0.55 ? pick(MIDDLE) : '') + pick(END);
      if (!used.has(n)) { used.add(n); return n; }
    }
    return `${bright ? 'Star' : 'KX'}-${Math.floor(1000 + rnd() * 9000)}`;
  };
  const kindOf = () => {
    let x = rnd();
    for (const k of KINDS) { if (x < k.share) return k; x -= k.share; }
    return KINDS[0];
  };
  const raw: Array<Omit<Star, 'id'>> = [];
  for (let i = 1; i < Math.max(2, o.count); i++) {
    // Evenly through the sphere (or a disc a fifth as thick), never right on top of the home star.
    let x = 0, y = 0, z = 0;
    for (let tries = 0; tries < 50; tries++) {
      x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1;
      if (o.shape === 'disc') z *= 0.2;
      const r = Math.hypot(x, y, z);
      if (r <= 1 && r > 0.04) break;
    }
    const k = kindOf(), spect = pick(k.types), absmag = Math.round((k.mag[0] + rnd() * (k.mag[1] - k.mag[0])) * 100) / 100;
    const X = x * o.radiusLy, Y = y * o.radiusLy, Z = z * o.radiusLy;
    // The faint ones mostly go by catalogue numbers, as faint stars do.
    const named = absmag < 9 || rnd() < 0.35;
    raw.push({ name: named ? name(absmag < 6) : `KX-${String(1000 + i).padStart(4, '0')}`, alt: '', x: X, y: Y, z: Z, dist: Math.hypot(X, Y, Z), absmag, spect, system: 0 });
  }
  raw.sort((a, b) => a.dist - b.dist);
  const home: Star = { id: 0, name: name(true), alt: 'Home', x: 0, y: 0, z: 0, dist: 0, absmag: 4.8, spect: 'G2V', system: 0 };
  const stars: Star[] = [home, ...raw.map((s, i) => ({ ...s, id: i + 1 }))];
  return { radiusLy: o.radiusLy, stars, byId: new Map(stars.map((s) => [s.id, s])) };
}

/** Invented stars once made (by their settings): made again only when the settings change. */
const made = new Map<string, StarCatalogue>();
export function inventedStarsCached(o: InventedSettings): StarCatalogue {
  const key = `${o.seed}|${o.count}|${o.radiusLy}|${o.shape}`;
  let c = made.get(key);
  if (!c) { c = inventedStars(o); made.set(key, c); if (made.size > 8) made.delete(made.keys().next().value!); }
  return c;
}
