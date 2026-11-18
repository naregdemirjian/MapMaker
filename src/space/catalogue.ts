// The nearby stars (Stage 11, D110): every star of the HYG database within 50 light-years of the Sun,
// from data/stars/nearby-50ly.json (scripts/fetch-stars.mjs). Positions are light-years from the Sun
// on galactic axes: x toward the galactic centre, y the way the galaxy turns, z toward its north pole.

export interface Star {
  /** The HYG id (0: the Sun). */
  id: number;
  name: string;
  /** Another name: the Bayer letter or Flamsteed number written out ("Epsilon Eridani"), or the Gliese number; '' if none. */
  alt: string;
  x: number; y: number; z: number;
  /** Light-years from the Sun. */
  dist: number;
  /** Absolute visual magnitude. */
  absmag: number;
  /** Spectral type as catalogued ("G2V", "M5Ve", "DA2"…). */
  spect: string;
  /** The primary star of its system when it is a companion; 0 otherwise. */
  system: number;
  /** Drawn in this colour and at this size (design pixels) instead of by its type (the planets, D113). */
  color?: string; size?: number;
  /** What it is, where it is not a star of a kind its spectrum says (a galaxy map's nebulae and clusters, D116). */
  kind?: string;
  /** Named on the map only close in, or when held or chosen (a galaxy's many star systems, D116). */
  minor?: boolean;
  /** The body it goes round (a moon's planet, D117): shown only once the view sets it apart from that body. */
  around?: number;
}

export interface StarCatalogue { radiusLy: number; stars: Star[]; byId: Map<number, Star> }

/** The primary star of a star's system: its primary when it is a companion, else itself. */
export function primaryOf(cat: StarCatalogue, id: number): number {
  const st = cat.byId.get(id);
  return st?.system && cat.byId.has(st.system) ? st.system : id;
}

/**
 * Every star of a star's system: the primary and its companions. (`system` 0 means "no primary", so
 * star 0 (the Sun, or an invented map's home star) is nobody's primary: it is a system of its own.)
 */
export function systemOf(cat: StarCatalogue, id: number): number[] {
  const p = primaryOf(cat, id);
  return cat.stars.filter((x) => x.id === p || (p !== 0 && x.system === p)).map((x) => x.id);
}

type RawStar = [number, string, number, number, number, number, string, number, string?];

/** A catalogue from the stored file. */
export function decodeStars(file: { format: string; radiusLy: number; stars: RawStar[] }): StarCatalogue {
  if (file.format !== 'mapmaker-stars-1') throw new Error('Not a star catalogue of Map Maker.');
  const stars = file.stars.map(([id, name, x, y, z, absmag, spect, system, alt]) => ({ id, name, alt: alt ?? '', x, y, z, dist: Math.hypot(x, y, z), absmag, spect, system }));
  return { radiusLy: file.radiusLy, stars, byId: new Map(stars.map((s) => [s.id, s])) };
}

let loading: Promise<StarCatalogue> | null = null;
/** The catalogue once loaded (null until then), for drawing without waiting. */
let loaded: StarCatalogue | null = null;
let announced = false;
/**
 * The nearby stars (loaded once). Once this has resolved, nearbyStarsNow has them too (an export
 * that waits for it draws every frame with the stars, even of a map not shown yet).
 */
export function loadNearbyStars(): Promise<StarCatalogue> {
  loading ??= fetch('data/stars/nearby-50ly.json').then((r) => {
    if (!r.ok) throw new Error(`Could not load the nearby stars (${r.status}).`);
    return r.json();
  }).then(decodeStars).then((c) => { loaded = c; return c; });
  return loading;
}

/** The nearby stars if they are loaded, else null (loading them, and calling `onLoad` once, for the first to ask, when they are in). */
export function nearbyStarsNow(onLoad?: () => void): StarCatalogue | null {
  if (!loaded) void loadNearbyStars().then(() => { if (!announced) { announced = true; onLoad?.(); } }, () => undefined);
  return loaded;
}

/** The colour of a star by its spectral class (as stars look: blue-white O to orange-red M; white dwarfs bluish white). */
export function starColour(spect: string): string {
  const s = spect.replace(/^(sd|d|esd|g|c)/, '').trim().toUpperCase();
  if (/^D/.test(spect) || /^W?D[ABOQZCX]/.test(s)) return '#dfe8ff';
  switch (s[0]) {
    case 'O': return '#9bb0ff';
    case 'B': return '#aabfff';
    case 'A': return '#cad7ff';
    case 'F': return '#f8f7ff';
    case 'G': return '#fff4ea';
    case 'K': return '#ffd2a1';
    case 'M': return '#ffad6a';
    case 'L': case 'T': case 'Y': return '#c46a5a';
    default: return '#fff4ea';
  }
}

/** A star's class in words, for its panel ("Red dwarf", "Sun-like star"…). */
export function starKind(spect: string): string {
  const s = spect.trim();
  if (/^D/.test(s) || /^W?D[ABOQZCX]/.test(s.toUpperCase())) return 'White dwarf';
  // (The luminosity class follows the class letter and its number: "F5IV-V", "K0IIIvar", "M5Ve".)
  const lum = /^[OBAFGKMLTY][\d.]*\s*(IV|III|II|I|V)?/i.exec(s.replace(/^(sd|d|esd)/, ''))?.[1]?.toUpperCase();
  const c = s.replace(/^(sd|d|esd)/, '')[0]?.toUpperCase();
  if (c === 'L' || c === 'T' || c === 'Y') return 'Brown dwarf';
  if (lum === 'III' || lum === 'II' || lum === 'I') return c === 'K' || c === 'M' ? 'Red giant' : 'Giant';
  if (lum === 'IV') return 'Subgiant';
  switch (c) {
    case 'M': return 'Red dwarf';
    case 'K': return 'Orange dwarf';
    case 'G': return 'Sun-like star';
    case 'F': return 'Yellow-white star';
    case 'A': return 'White star';
    case 'B': case 'O': return 'Blue star';
    default: return 'Star';
  }
}

/** How large a star is drawn (design pixels): brighter stars larger, every star at least visible. */
export function starSize(absmag: number): number {
  const m = Number.isFinite(absmag) ? absmag : 12;
  return Math.max(1.6, Math.min(7.5, 6.2 - 0.32 * m));
}

/** Stars whose name or other name holds the text (accents and case ignored), nearest first. */
export function findStars(cat: StarCatalogue, text: string, limit = 20): Star[] {
  const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(text.trim());
  if (!q) return [];
  return cat.stars.filter((s) => norm(s.name).includes(q) || norm(s.alt).includes(q)).slice(0, limit);
}

/** Galactic longitude and latitude of a position (degrees). */
export function galacticOf(x: number, y: number, z: number): { l: number; b: number } {
  const d = Math.hypot(x, y, z) || 1;
  return { l: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, b: (Math.asin(Math.max(-1, Math.min(1, z / d))) * 180) / Math.PI };
}
