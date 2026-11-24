// Close-up terrain (Stage 8, D101). Earth's bundled heights have cells of about 10 km, soft close in.
// When a view's pixels are much smaller than that, the heights of the place in view come from the
// Terrain Tiles on AWS Open Data (the source of the bundled grid, at finer zooms): fetched through
// the local data service, which keeps them on this computer, and laid into a grid of the region in
// view (and around it, for moving the map), in the bundled grid's layout (longitude and latitude),
// which the terrain shader reads instead of the bundled grid inside the region. The tiles have the
// rock beneath the ice sheets, so there the bundled grid's ice surface is kept (as it was made, D94);
// so is every place sculpted (D98), and every place whose tile could not be had (offline).
import { heightAt, type ElevationGrid } from './grid.ts';

/** Pixels across a tile. */
export const TILE = 256;
/** The finest zoom fetched (about 38 m a pixel at the equator) and the coarsest worth fetching. */
export const MAX_ZOOM = 12, MIN_ZOOM = 6;
/** Metres a pixel of a zoom-0 tile covers at the equator. */
const Z0 = (2 * Math.PI * 6378137) / TILE;

/** Tile coordinates (fractional: the tile and where in it) of a place at zoom `z`, as the tiles are laid (Web Mercator). */
export function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z, phi = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n];
}

/** The longitude and latitude of tile coordinates at zoom `z`. */
export function tileLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}

/** Heights (metres) from a Terrain Tile's pixels (RGBA, "terrarium": red × 256 + green + blue / 256 − 32,768). */
export function terrariumHeights(rgba: Uint8Array | Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let k = 0; k < out.length; k++) out[k] = rgba[k * 4] * 256 + rgba[k * 4 + 1] + rgba[k * 4 + 2] / 256 - 32768;
  return out;
}

/** Where the bundled grid's heights are kept: the ice sheets (the tiles have the rock beneath them). */
export const underIce = (lon: number, lat: number) => {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return lat < -60 || (lat >= 59 && lat < 84 && l >= -74 && l < -10);
};

/** The tiles a view needs: zoom `z`, columns `x0`..`x1` (they may run past the last and round again) and rows `y0`..`y1`. */
export interface DetailNeed { z: number; x0: number; x1: number; y0: number; y1: number; key: string }

/**
 * The tiles for a region (`west`..`east` may cross the 180th meridian: `east` is then more than 180)
 * seen at `metresPerPixel` (at its middle): the zoom whose pixels are about a screen pixel or finer,
 * coarser when that would take more than `maxTiles`. Null when the bundled grid is fine enough there,
 * or the region is too large even at the coarsest zoom worth fetching.
 */
export function detailNeed(region: { west: number; south: number; east: number; north: number }, metresPerPixel: number, maxTiles = 48): DetailNeed | null {
  const mid = (region.south + region.north) / 2, cos = Math.max(0.05, Math.cos((mid * Math.PI) / 180));
  // The bundled grid's cells are about 9.8 km north to south: worth more only when a pixel is well under half that.
  if (!(metresPerPixel > 0) || metresPerPixel > 4000) return null;
  let z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.ceil(Math.log2((Z0 * cos) / metresPerPixel))));
  for (; z >= MIN_ZOOM; z--) {
    const [ax, ay] = tileXY(region.west, Math.min(85, region.north), z), [bx, by] = tileXY(region.east, Math.max(-85, region.south), z);
    const x0 = Math.floor(ax), x1 = Math.floor(bx - 1e-9), y0 = Math.max(0, Math.floor(ay)), y1 = Math.min(2 ** z - 1, Math.floor(by - 1e-9));
    if (x1 < x0 || y1 < y0) return null;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= maxTiles && x1 - x0 + 1 <= 2 ** z) return { z, x0, x1, y0, y1, key: `${z}/${x0}-${x1}/${y0}-${y1}` };
  }
  return null;
}

/**
 * A grid of heights over a region, in the bundled grid's layout: cells of `dLon` × `dLat` degrees
 * from the region's north-west corner (`west` may be less than −180 or `west + width × dLon` more than
 * 180: the region runs on round the planet). `key` names its content.
 */
export interface DetailGrid extends ElevationGrid {
  west: number; north: number; dLon: number; dLat: number; z: number; key: string;
  /** Every height from the tiles (none kept from the bundled grid: no tile missing, no ice sheet, nothing sculpted): fine enough to draw the coast close in (D176). */
  whole?: boolean;
}

/** The height a grid has at a place (longitudes taken round to the grid's side of the planet); null outside it. */
export function detailHeightAt(g: DetailGrid, lon: number, lat: number): number | null {
  const l = lon + 360 * Math.round((g.west + (g.width * g.dLon) / 2 - lon) / 360);
  const i = Math.floor((l - g.west) / g.dLon), j = Math.floor((g.north - lat) / g.dLat);
  if (i < 0 || j < 0 || i >= g.width || j >= g.height) return null;
  return g.data[j * g.width + i] * g.step;
}

/** Whether a grid covers a region (longitudes compared on the grid's side of the planet). */
export function covers(g: DetailGrid, r: { west: number; south: number; east: number; north: number }): boolean {
  const shift = 360 * Math.round((g.west + (g.width * g.dLon) / 2 - (r.west + r.east) / 2) / 360);
  return g.west <= r.west + shift && g.west + g.width * g.dLon >= r.east + shift && g.north >= r.north && g.north - g.height * g.dLat <= r.south;
}

/**
 * The grid of a need's region. `tile(x, y)` gives a tile's heights (`x` within 0..2^z − 1), or null
 * when it could not be had; `base` gives the heights kept (the bundled grid, sculpted: `touched`
 * marks its cells changed by sculpting). At most `maxCells` cells along each side.
 */
export function buildDetail(need: DetailNeed, tile: (x: number, y: number) => Float32Array | null, base: { grid: ElevationGrid; key: string; touched?: Uint8Array | null; under?: ElevationGrid }, maxCells = 2048): DetailGrid {
  const { z } = need, n = 2 ** z;
  const [west, north] = tileLonLat(need.x0, need.y0, z), [east, south] = tileLonLat(need.x1 + 1, need.y1 + 1, z);
  const midLat = (north + south) / 2;
  // Cells about as large as the tiles' pixels (square on the ground at the region's middle).
  let dLon = 360 / (n * TILE);
  dLon = Math.max(dLon, (east - west) / maxCells, ((north - south) / maxCells) / Math.max(0.05, Math.cos((midLat * Math.PI) / 180)));
  const dLat = dLon * Math.max(0.05, Math.cos((midLat * Math.PI) / 180));
  const width = Math.max(1, Math.ceil((east - west) / dLon)), height = Math.max(1, Math.ceil((north - south) / dLat));
  const data = new Int16Array(width * height);
  const g = base.grid, touched = base.touched ?? null;
  // Whether sculpting changed the heights at a place or beside it (the cells whose heights reach it between cells).
  const under = base.under ?? null;
  const sculptedAt = (lon: number, lat: number) => {
    if (!touched) return false;
    const fi = ((lon + 180) / 360) * g.width - 0.5, fj = ((90 - lat) / 180) * g.height - 0.5;
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) {
      const i = (((i0 + di) % g.width) + g.width) % g.width, j = Math.max(0, Math.min(g.height - 1, j0 + dj));
      if (touched[j * g.width + i] === 1) return true;
    }
    return false;
  };
  // A height from the tiles at global pixel coordinates (bilinear across tile edges), or NaN.
  const cache = new Map<number, Float32Array | null>();
  const tileAt = (tx: number, ty: number) => {
    const wx = ((tx % n) + n) % n, k = ty * n + wx;
    if (!cache.has(k)) cache.set(k, ty < 0 || ty >= n ? null : tile(wx, ty));
    return cache.get(k)!;
  };
  const pixel = (X: number, Y: number) => {
    const t = tileAt(Math.floor(X / TILE), Math.floor(Y / TILE));
    return t ? t[(Y - Math.floor(Y / TILE) * TILE) * TILE + (X - Math.floor(X / TILE) * TILE)] : NaN;
  };
  let whole = true;
  for (let j = 0; j < height; j++) {
    const lat = north - (j + 0.5) * dLat;
    for (let i = 0; i < width; i++) {
      const lon = west + (i + 0.5) * dLon;
      let v = NaN;
      // Where the ground was sculpted (D98): the finer heights with what sculpting did laid over them (the difference
      // it made to the map's own heights, smooth between their cells), so a valley cut or a hill raised keeps the
      // ground's own detail and no cell's outline shows (D225). Without the heights from before: the map's own, as ever.
      const carved = sculptedAt(lon, lat);
      if (!underIce(lon, lat) && (!carved || under)) {
        const [tx, ty] = tileXY(lon, lat, z);
        const fx = tx * TILE - 0.5, fy = Math.max(0, Math.min(n * TILE - 1, ty * TILE - 0.5));
        const X = Math.floor(fx), Y = Math.floor(fy), ax = fx - X, ay = fy - Y;
        const a = pixel(X, Y), b = pixel(X + 1, Y), c = pixel(X, Math.min(n * TILE - 1, Y + 1)), d = pixel(X + 1, Math.min(n * TILE - 1, Y + 1));
        // (At the region's edge a neighbour may lie in a tile not fetched: the others are used.)
        const wa = (1 - ax) * (1 - ay), wb = ax * (1 - ay), wc = (1 - ax) * ay, wd = ax * ay;
        let sum = 0, weight = 0, some = NaN;
        if (a === a) { sum += a * wa; weight += wa; some = a; }
        if (b === b) { sum += b * wb; weight += wb; some = b; }
        if (c === c) { sum += c * wc; weight += wc; some = c; }
        if (d === d) { sum += d * wd; weight += wd; some = d; }
        v = weight > 0 ? sum / weight : some;
        if (carved && under && Number.isFinite(v)) { v += heightAt(g, lon, lat) - heightAt(under, lon, lat); whole = false; }
      }
      if (!Number.isFinite(v)) whole = false;
      data[j * width + i] = Math.max(-32768, Math.min(32767, Math.round(Number.isFinite(v) ? v : heightAt(g, lon, lat))));
    }
  }
  return { width, height, step: 1, data, west, north, dLon, dLat, z, key: `detail:${need.key}:${base.key}`, whole };
}
