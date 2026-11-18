// Planets of other stars (Stage 11, D118): the confirmed planets of the stars on the nearby star map,
// from the Open Exoplanet Catalogue (data/stars/exoplanets-50ly.json, made by scripts/fetch-exoplanets.mjs).

export interface Exoplanet {
  /** The star of the nearby star map it goes round. */
  star: number;
  name: string;
  /** Days to go round its star; its distance from it (au); its mass and radius (Earth's); when and how it was found. Null where not known. */
  days: number | null; au: number | null; mass: number | null; radius: number | null; year: number | null; method: string | null;
}

export interface ExoplanetList { planets: Exoplanet[]; byStar: Map<number, Exoplanet[]> }

type RawPlanet = [number, string, number | null, number | null, number | null, number | null, number | null, string | null];

/** The list from the stored file. */
export function decodeExoplanets(file: { format: string; planets: RawPlanet[] }): ExoplanetList {
  if (file.format !== 'mapmaker-exoplanets-1') throw new Error('Not a list of planets of Map Maker.');
  const planets = file.planets.map(([star, name, days, au, mass, radius, year, method]) => ({ star, name, days, au, mass, radius, year, method }));
  const byStar = new Map<number, Exoplanet[]>();
  for (const p of planets) { const l = byStar.get(p.star); if (l) l.push(p); else byStar.set(p.star, [p]); }
  return { planets, byStar };
}

let loading: Promise<ExoplanetList> | null = null;
let loaded: ExoplanetList | null = null;
let announced = false;
/** The planets (loaded once: exoplanetsNow has them once this has resolved). */
export function loadExoplanets(): Promise<ExoplanetList> {
  loading ??= fetch('data/stars/exoplanets-50ly.json').then((r) => {
    if (!r.ok) throw new Error(`Could not load the planets of other stars (${r.status}).`);
    return r.json();
  }).then(decodeExoplanets).then((l) => { loaded = l; return l; });
  return loading;
}
/** The planets if they are loaded, else null (loading them, and calling `onLoad` once when they are in). */
export function exoplanetsNow(onLoad?: () => void): ExoplanetList | null {
  if (!loaded) void loadExoplanets().then(() => { if (!announced) { announced = true; onLoad?.(); } }, () => undefined);
  return loaded;
}

/** How a planet was found, in words. */
export function foundBy(method: string | null): string {
  switch (method) {
    case 'RV': return 'by the wobble it gives its star';
    case 'transit': return 'passing in front of its star';
    case 'imaging': return 'seen directly';
    case 'microlensing': return 'by the light it bent';
    case 'timing': return 'by timing';
    case 'astrometry': return 'by its star\'s movement across the sky';
    default: return method ?? '';
  }
}

/** A planet's size in words: from its radius or, failing that, its mass. */
export function planetSize(p: Exoplanet): string {
  if (p.radius !== null) return `${p.radius < 10 ? p.radius.toFixed(2) : Math.round(p.radius)} × the Earth's size`;
  if (p.mass !== null) return `${p.mass < 10 ? p.mass.toFixed(2) : Math.round(p.mass).toLocaleString('en-GB')} × the Earth's mass${p.method === 'RV' ? ' (at least)' : ''}`;
  return 'size not known';
}
