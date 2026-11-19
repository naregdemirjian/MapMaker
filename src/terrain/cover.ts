// Land cover (Stage 8, D100): the colours of the land in the satellite look, laid like the heights
// (equirectangular, from the north-west corner). Earth's is Natural Earth I's land cover recoloured
// (data/terrain/earth-cover-4096.webp, made by scripts/fetch-land-cover.mjs); a generated planet's
// is worked out from its heights (terrain/biomes.ts), once for each set of heights (its own, or
// sculpted), and kept for the last few. The sea has the colour of the land nearest it, shown where
// the sea falls or land is sculpted out of it.
import type { ElevationGrid } from './grid.ts';
import { biomeColours, type Climate } from './biomes.ts';
import { loadEarthPhoto, EARTH_PHOTO_KEY } from './photo-cache.ts';

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
