// Elevation grids: the height of a planet's surface, land and sea floor alike, on a longitude/latitude
// grid, and the compact file format they are kept in (scripts/fetch-terrain.mjs writes Earth's).
//
// Cell (i, j) covers longitudes -180 + i·360/width to -180 + (i+1)·360/width, and latitudes from
// 90 - j·180/height down to 90 - (j+1)·180/height. Its value is the mean height of that area in
// metres above sea level, stored as a whole number of `step` metres.
//
// File format "MMT1" (little-endian):
//   0   "MMT1"
//   4   width (uint32)      8   height (uint32)      12  metres per step (float32)
//   16  a zlib stream of two byte planes (every low byte, then every high byte) of the cells'
//       residuals, row by row from the north-west corner. A residual is the cell's value less the
//       value predicted from its west, north and north-west neighbours (LOCO-I's median predictor;
//       the first row and column predict from their single neighbour), taken modulo 2^16 and
//       zigzag-coded so small negatives stay small. Earth at 4096 × 2048 and 1 m takes 7.6 MB.

export interface ElevationGrid {
  width: number;
  height: number;
  /** Metres per stored unit. */
  step: number;
  /** Heights in steps, row by row from the north-west corner. */
  data: Int16Array;
}

export const TERRAIN_MAGIC = 'MMT1';
const HEADER = 16;

function predict(g: Int16Array, k: number, x: number, y: number, w: number): number {
  if (y === 0) return x === 0 ? 0 : g[k - 1];
  if (x === 0) return g[k - w];
  const a = g[k - 1], b = g[k - w], c = g[k - w - 1];
  const lo = a < b ? a : b, hi = a < b ? b : a;
  return c >= hi ? lo : c <= lo ? hi : a + b - c;
}

/** The 16-byte header of a grid's file. */
export function terrainHeader(grid: ElevationGrid): Uint8Array {
  const head = new Uint8Array(HEADER), view = new DataView(head.buffer);
  for (let i = 0; i < 4; i++) head[i] = TERRAIN_MAGIC.charCodeAt(i);
  view.setUint32(4, grid.width, true);
  view.setUint32(8, grid.height, true);
  view.setFloat32(12, grid.step, true);
  return head;
}

/** The residual planes of a grid (what the file holds after the header, before compression). */
export function terrainPlanes(grid: ElevationGrid): Uint8Array {
  const { width: w, height: h, data: g } = grid, n = w * h;
  const out = new Uint8Array(2 * n);
  for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k++) {
    const r = ((g[k] - predict(g, k, x, y, w)) << 16) >> 16;
    const z = ((r << 1) ^ (r >> 15)) & 0xffff;
    out[k] = z & 255;
    out[n + k] = z >> 8;
  }
  return out;
}

export function readTerrainHeader(bytes: Uint8Array): { width: number; height: number; step: number } {
  if (bytes.length < HEADER || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== TERRAIN_MAGIC) throw new Error('Not a Map Maker terrain file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  const width = view.getUint32(4, true), height = view.getUint32(8, true), step = view.getFloat32(12, true);
  if (!width || !height || width > 65536 || height > 65536 || !(step > 0)) throw new Error('Damaged terrain file');
  return { width, height, step };
}

/** Rebuilds a grid from its residual planes (the inverse of terrainPlanes). */
export function gridFromPlanes(width: number, height: number, step: number, planes: Uint8Array): ElevationGrid {
  const n = width * height;
  if (planes.length !== 2 * n) throw new Error('Damaged terrain file');
  const g = new Int16Array(n);
  for (let y = 0, k = 0; y < height; y++) for (let x = 0; x < width; x++, k++) {
    const z = planes[k] | (planes[n + k] << 8);
    const r = (z >>> 1) ^ -(z & 1);
    g[k] = predict(g, k, x, y, width) + r; // Int16Array wraps modulo 2^16, as the encoder did
  }
  return { width, height, step, data: g };
}

/** Reads a terrain file, given a zlib inflater (node:zlib in Node, DecompressionStream in the app). */
export async function decodeTerrain(bytes: Uint8Array, inflate: (zlib: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<ElevationGrid> {
  const { width, height, step } = readTerrainHeader(bytes);
  return gridFromPlanes(width, height, step, await inflate(bytes.subarray(HEADER)));
}

/** Inflates a zlib stream with the browser's DecompressionStream. */
export async function inflateInBrowser(zlib: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The value (metres) of the cell that holds a place. */
export function cellHeight(grid: ElevationGrid, lon: number, lat: number): number {
  const { width: w, height: h } = grid;
  const i = (((Math.floor(((lon + 180) / 360) * w)) % w) + w) % w;
  const j = Math.max(0, Math.min(h - 1, Math.floor(((90 - lat) / 180) * h)));
  return grid.data[j * w + i] * grid.step;
}

/** The height (metres) at a place, interpolated between the centres of the four nearest cells. */
export function heightAt(grid: ElevationGrid, lon: number, lat: number): number {
  const { width: w, height: h, data } = grid;
  const fx = ((lon + 180) / 360) * w - 0.5, fy = ((90 - lat) / 180) * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const col = (x: number) => ((x % w) + w) % w, row = (y: number) => Math.max(0, Math.min(h - 1, y));
  const a = col(x0), b = col(x0 + 1), r0 = row(y0) * w, r1 = row(y0 + 1) * w;
  const top = data[r0 + a] * (1 - tx) + data[r0 + b] * tx, bottom = data[r1 + a] * (1 - tx) + data[r1 + b] * tx;
  return (top * (1 - ty) + bottom * ty) * grid.step;
}
