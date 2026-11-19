// Satellite photographs of the Earth (D138). The satellite look shows the Earth as photographed: a picture of
// the whole planet ships with the app (data/terrain/earth-photo-4096.webp, about 10 km a pixel), and close in the
// photographs of the place in view come as tiles, fetched through the local data service, which keeps them on
// this computer, and laid side by side into one picture of the region in view (and around it, for moving the
// map), which the terrain shader reads inside the region. Both are Sentinel-2 cloudless 2016 by EOX (CC BY 4.0),
// whose tiles are laid in longitude and latitude: level L has 2^(L+1) columns and 2^L rows of 256-pixel tiles
// from the north-west corner, a pixel of level 13 about 10 m, the photographs' own detail.

/** Pixels across a tile. */
export const PHOTO_TILE = 256;
/** The bundled picture's level (4096 by 2048 pixels), the coarsest level worth fetching and the finest there is. */
export const PHOTO_BUNDLED_LEVEL = 3, PHOTO_MIN_LEVEL = 4, PHOTO_MAX_LEVEL = 13;
/** Degrees a tile of a level covers each way. */
export const photoTileDegrees = (level: number) => 180 / 2 ** level;
/** Degrees a pixel of a level covers each way. */
export const photoPixelDegrees = (level: number) => photoTileDegrees(level) / PHOTO_TILE;

/** Metres to a degree of latitude on the Earth. */
export const METRES_PER_DEGREE = (6371008.8 * Math.PI) / 180;
/** The credit the photographs' makers ask for (CC BY 4.0), as shown on the map. */
export const PHOTO_CREDIT = 'Sentinel-2 cloudless by EOX (contains modified Copernicus Sentinel data 2016)';

export interface Bounds { west: number; south: number; east: number; north: number }

/** The tiles a view needs: `level`, columns `c0`..`c1` (they may run past the last and round again) and rows `r0`..`r1`. */
export interface PhotoNeed { level: number; c0: number; c1: number; r0: number; r1: number; key: string }

/**
 * The tiles for a region (`west`..`east` may cross the 180th meridian: `east` is then more than 180) seen at
 * `degreesPerPixel` (north to south): the level whose pixels are about a screen pixel or finer, coarser when
 * that would take more than `maxTiles`. Null when the bundled picture is fine enough there, or the region is too
 * large even at the coarsest level fetched.
 */
export function photoNeed(region: Bounds, degreesPerPixel: number, maxTiles = 160): PhotoNeed | null {
  // (The bundled picture serves until its pixels are about a pixel and a half on screen.)
  if (!(degreesPerPixel > 0) || degreesPerPixel > photoPixelDegrees(PHOTO_BUNDLED_LEVEL) / 1.5) return null;
  if (!(region.east > region.west) || !(region.north > region.south)) return null;
  let level = Math.min(PHOTO_MAX_LEVEL, Math.max(PHOTO_MIN_LEVEL, Math.ceil(Math.log2(180 / (PHOTO_TILE * degreesPerPixel)) - 1e-9)));
  for (; level >= PHOTO_MIN_LEVEL; level--) {
    const d = photoTileDegrees(level), rows = 2 ** level, cols = 2 * rows;
    const c0 = Math.floor((region.west + 180) / d), c1 = Math.floor((region.east + 180) / d - 1e-9);
    const r0 = Math.max(0, Math.floor((90 - Math.min(90, region.north)) / d)), r1 = Math.min(rows - 1, Math.floor((90 - Math.max(-90, region.south)) / d - 1e-9));
    if (c1 < c0 || r1 < r0) return null;
    if ((c1 - c0 + 1) * (r1 - r0 + 1) <= maxTiles && c1 - c0 + 1 <= cols) return { level, c0, c1, r0, r1, key: `${level}/${c0}-${c1}/${r0}-${r1}` };
  }
  return null;
}

/**
 * The photographs of a region as one picture: `width` by `height` pixels from the region's north-west corner
 * (`west` may be less than −180 or `west + widthDeg` more than 180: the region runs on round the planet),
 * see-through where a tile could not be had. `key` names its content.
 */
export interface PhotoRegion {
  west: number; north: number; widthDeg: number; heightDeg: number;
  width: number; height: number; level: number;
  image: TexImageSource;
  key: string;
}

/** Where a need's picture lies, and its size in pixels. */
export function photoPlace(need: PhotoNeed): { west: number; north: number; widthDeg: number; heightDeg: number; width: number; height: number } {
  const d = photoTileDegrees(need.level), nx = need.c1 - need.c0 + 1, ny = need.r1 - need.r0 + 1;
  return { west: need.c0 * d - 180, north: 90 - need.r0 * d, widthDeg: nx * d, heightDeg: ny * d, width: nx * PHOTO_TILE, height: ny * PHOTO_TILE };
}

/** Whether a region's picture covers a view (longitudes compared on the picture's side of the planet). */
export function photoCovers(p: Pick<PhotoRegion, 'west' | 'north' | 'widthDeg' | 'heightDeg'>, r: Bounds): boolean {
  const shift = 360 * Math.round((p.west + p.widthDeg / 2 - (r.west + r.east) / 2) / 360);
  return p.west <= r.west + shift && p.west + p.widthDeg >= r.east + shift && p.north >= Math.min(90, r.north) && p.north - p.heightDeg <= Math.max(-90, r.south);
}
