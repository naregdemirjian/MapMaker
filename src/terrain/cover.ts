// Land cover (Stage 8, D100): the colours of the land in the satellite look, laid like the heights
// (equirectangular, from the north-west corner). Earth's is Natural Earth I's land cover recoloured
// (data/terrain/earth-cover-4096.webp, made by scripts/fetch-land-cover.mjs); a generated planet's
// is worked out from its heights (terrain/biomes.ts), once for each set of heights (its own, or
// sculpted), and kept for the last few. The sea has the colour of the land nearest it, shown where
// the sea falls or land is sculpted out of it.
import type { ElevationGrid } from './grid.ts';
import { biomeColours, type Climate } from './biomes.ts';
import { loadEarthPhoto, EARTH_PHOTO_KEY } from './photo-cache.ts';
import { paleoBetween } from './paleo.ts';
import { underBrush, type TerrainStamp } from './sculpt.ts';
import { BIOMES } from './biomes.ts';

/**
 * A world's land cover: RGBA pixels (or a decoded picture), and a name for its content. The Earth's comes with
 * the picture of the whole planet as photographed (D138), drawn instead of it where the look asks for photographs.
 */
export interface TerrainCover { width: number; height: number; pixels: Uint8Array | ImageBitmap; key: string; photo?: { pixels: ImageBitmap; key: string } | null }

export const EARTH_COVER_KEY = 'earth-cover-4096';
let earth: Promise<TerrainCover> | null = null;

/** Earth's land cover, loaded once (in the browser: the picture is decoded as it is, no colour management). */
export function loadEarthCover(url = 'data/terrain/earth-cover-4096.webp'): Promise<TerrainCover> {
  if (!earth) {
    earth = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Earth's land cover could not be loaded.");
      const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const photo = await loadEarthPhoto();
      return { width: bitmap.width, height: bitmap.height, pixels: bitmap, key: EARTH_COVER_KEY, photo: photo ? { pixels: photo, key: EARTH_PHOTO_KEY } : null };
    })();
    earth.catch(() => { earth = null; });
  }
  return earth;
}

const kept = new Map<string, TerrainCover | 'working'>();
const KEEP = 3;
function keep(key: string, value: TerrainCover | 'working'): void {
  kept.delete(key);
  kept.set(key, value);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value!);
}
const coverKey = (key: string, radiusKm: number, climate: Climate) => `cover:${key}:${radiusKm}:${climate.warmth}:${climate.wetness}:${climate.iceFrom}:${climate.barren ?? ''}`;
const make = (grid: ElevationGrid, key: string, radiusKm: number, climate: Climate): TerrainCover => ({ width: grid.width, height: grid.height, pixels: biomeColours(grid, radiusKm, climate), key });

/** A planet's land cover if worked out; otherwise null, and `onReady` is called once it is. */
export function coverSoon(grid: ElevationGrid, key: string, radiusKm: number, climate: Climate, onReady: () => void): TerrainCover | null {
  const k = coverKey(key, radiusKm, climate), have = kept.get(k);
  if (have && have !== 'working') return have;
  if (!have) {
    keep(k, 'working');
    setTimeout(() => { keep(k, make(grid, k, radiusKm, climate)); onReady(); }, 0);
  }
  return null;
}

/** A planet's land cover, worked out now if need be. */
export function coverNow(grid: ElevationGrid, key: string, radiusKm: number, climate: Climate): TerrainCover {
  const k = coverKey(key, radiusKm, climate), have = kept.get(k);
  if (have && have !== 'working') return have;
  const c = make(grid, k, radiusKm, climate);
  keep(k, c);
  return c;
}

/**
 * A simulated planet's land seen from space through its history (D167): a cover for each of its pictures, youngest
 * first as its heights' pictures are kept (D156), null until made. `key` names the set.
 */
export interface CoverSet { ages: number[]; covers: Array<TerrainCover | null>; key: string }

/** Steps between two pictures' covers: the colours change in sixteenths of the way from one to the next. */
const BLEND_STEPS = 16;
const blends = new Map<string, TerrainCover>();

/**
 * The land seen from space at an age (million years ago): the covers of the two pictures either side of it blended
 * (as the heights are, D156), or the nearer one while the other is still being made; null when neither is ready.
 */
export function coverAt(set: CoverSet, age: number): TerrainCover | null {
  const { a, b, f } = paleoBetween(set, age);
  const q = Math.round(f * BLEND_STEPS) / BLEND_STEPS;
  const A = set.covers[a], B = set.covers[b];
  if (a === b || q === 0) return A ?? B;
  if (q === 1) return B ?? A;
  if (!A || !B) return (q < 0.5 ? A ?? B : B ?? A);
  if (!(A.pixels instanceof Uint8Array) || !(B.pixels instanceof Uint8Array) || A.width !== B.width || A.height !== B.height) return q < 0.5 ? A : B;
  const key = `${set.key}:${a}:${b}:${q}`, kept = blends.get(key);
  if (kept) { blends.delete(key); blends.set(key, kept); return kept; }
  const pa = A.pixels, pb = B.pixels, out = new Uint8Array(pa.length), wb = Math.round(q * 256), wa = 256 - wb;
  for (let i = 0; i < out.length; i++) out[i] = (pa[i] * wa + pb[i] * wb + 128) >> 8;
  const c: TerrainCover = { width: A.width, height: A.height, pixels: out, key };
  blends.set(key, c);
  while (blends.size > 4) blends.delete(blends.keys().next().value!);
  return c;
}

const painted = new Map<string, TerrainCover>();

/**
 * A land cover with biomes painted over it (D169): each painted stroke, in order, lays its biome's colour over the
 * cover under its brush, its edge soft. (Covers kept as pixels: a generated or simulated planet's; the Earth's
 * picture is left as it is.) `radiusKm` is the planet's.
 */
export function paintedCover(cover: TerrainCover, paint: readonly TerrainStamp[], radiusKm: number): TerrainCover {
  const strokes = paint.filter((s) => s.tool === 'biome' && s.biome);
  if (!strokes.length || !(cover.pixels instanceof Uint8Array)) return cover;
  const key = `${cover.key}+paint:${strokes.map((s) => s.id).join(',')}`;
  const have = painted.get(key);
  if (have) { painted.delete(key); painted.set(key, have); return have; }
  const px = cover.pixels.slice(), W = cover.width, H = cover.height;
  for (const s of strokes) {
    const rgb = BIOMES[s.biome!];
    underBrush(W, H, s, radiusKm, (k, w) => {
      const a = Math.min(1, w * 2.5);
      for (let q = 0; q < 3; q++) px[4 * k + q] = Math.round(px[4 * k + q] + (rgb[q] - px[4 * k + q]) * a);
    });
  }
  const out: TerrainCover = { width: W, height: H, pixels: px, key };
  painted.set(key, out);
  while (painted.size > 4) painted.delete(painted.keys().next().value!);
  return out;
}
