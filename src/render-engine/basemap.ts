// The Earth basemap: land, lakes, coastlines and present-day country borders from Natural Earth,
// drawn beneath the territories. It is reference geography only: it is not part of the parcel map
// and never changes history. Files are produced by scripts/fetch-natural-earth.mjs.
import { geoArea, geoPath, geoEquirectangular } from 'd3-geo';
import { screenToLonLat, lonLatToScreen, type View } from './camera.ts';
import { makeRing, rankRing, addLine, type Ring, type Sheet } from './plane.ts';
import type { BlockPath } from './blocks.ts';

export interface BasemapFile {
  format: string; dataset: string; version: string; scale: string; quantum: number;
  layers: Record<string, { kind: 'polygons' | 'lines'; items: number[][][] | number[][] }>;
}

export interface BasemapScale {
  scale: string;
  land: GeoJSON.MultiPolygon;
  lakes: GeoJSON.MultiPolygon;
  coastline: GeoJSON.MultiLineString;
  borders: GeoJSON.MultiLineString;
  /** The longitude/latitude box of every item of each layer, in the same order, for culling. */
  boxes: Record<'land' | 'lakes' | 'coastline' | 'borders', Box[]>;
}

/** [west, south, east, north] in degrees, west <= east (Natural Earth items never cross 180°). */
export type Box = [number, number, number, number];

function boxOf(points: Iterable<number[]>): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  return b;
}

/** Every scale loaded so far, coarsest first (1:10m joins later, see loadBasemapDetail). */
export interface Basemap { version: string; scales: BasemapScale[] }

/**
 * Above this many pixels per degree the finest scale (1:10m, about 200 m) is used, and above
 * MEDIUM_PIXELS_PER_DEGREE the 1:50m one. Each is drawn at the detail the view can show (see
 * plane.ts), so the finer data can come in early without slowing wide views down.
 */
export const DETAIL_PIXELS_PER_DEGREE = 14;
export const MEDIUM_PIXELS_PER_DEGREE = 2.5;

export { basemapSourceOf, type BasemapSource } from '../world-model/world-settings.ts';

function decodeLine(flat: number[], q: number): number[][] {
  const out: number[][] = [];
  let x = 0, y = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x += flat[i]; y += flat[i + 1];
    // Round to the quantum's decimals so decoded values are exactly what was encoded.
    out.push([Math.round(x * q * 1e7) / 1e7, Math.round(y * q * 1e7) / 1e7]);
  }
  return out;
}

function closeRing(r: number[][]): number[][] {
  const a = r[0], b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
}

/** Decoding, a few shapes at a time (each step is a pause point for decodeGently). */
function* decodeSteps(file: BasemapFile): Generator<void, BasemapScale> {
  if (file.format !== 'mapmaker-basemap-1') throw new Error(`Unknown basemap format "${file.format}".`);
  const q = file.quantum;
  function* polygons(name: string): Generator<void, GeoJSON.MultiPolygon> {
    const items = (file.layers[name]?.items ?? []) as number[][][];
    const coordinates: GeoJSON.Position[][][] = [];
    for (const rings of items) {
      const poly = rings.map((r) => closeRing(decodeLine(r, q)));
      // d3-geo reads winding strictly (a ring the wrong way round encloses the rest of the planet):
      // any polygon that comes out larger than a hemisphere is turned round.
      if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) for (const r of poly) r.reverse();
      coordinates.push(poly);
      yield;
    }
    return { type: 'MultiPolygon', coordinates };
  }
  function* lines(name: string): Generator<void, GeoJSON.MultiLineString> {
    const coordinates: GeoJSON.Position[][] = [];
    for (const l of (file.layers[name]?.items ?? []) as number[][]) { coordinates.push(decodeLine(l, q)); yield; }
    return { type: 'MultiLineString', coordinates };
  }
  const land = yield* polygons('land'), lakes = yield* polygons('lakes'), coastline = yield* lines('coastline'), borders = yield* lines('borders');
  yield;
  return {
    scale: file.scale, land, lakes, coastline, borders,
    boxes: {
      land: land.coordinates.map((p) => boxOf(p[0])), lakes: lakes.coordinates.map((p) => boxOf(p[0])),
      coastline: coastline.coordinates.map(boxOf), borders: borders.coordinates.map(boxOf),
    },
  };
}

export function decodeBasemap(file: BasemapFile): BasemapScale {
  const steps = decodeSteps(file);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Let the page draw and answer the pointer before carrying on. */
const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Run steps a few milliseconds at a time, so that the page stays responsive meanwhile. */
async function gently<T>(steps: Generator<void, T>, slice = 5): Promise<T> {
  let r = steps.next(), t = performance.now();
  while (!r.done) {
    if (performance.now() - t > slice) { await breathe(); t = performance.now(); }
    r = steps.next();
  }
  return r.value;
}

/** A scale's shapes made ready for drawing (rings, and the order their points are left out in), a few at a time. */
function* readySteps(b: BasemapScale): Generator<void, void> {
  const r = ringsOf(b);
  yield;
  for (const list of [r.land, r.lakes, r.coastline, r.borders]) for (const ring of list) { rankRing(ring); yield; }
}

/** A dataset's record as kept in data/datasets.json (source, version, licence and credit line). */
export interface DatasetRecord { id: string; name: string; version: string; source: string; licence: string; credit: string; usedFor: string; retrieved: string; converted?: string }

let records: Promise<DatasetRecord[]> | null = null;

/** The records of every dataset the app ships with. */
export function loadDatasetRecords(url = 'data/datasets.json'): Promise<DatasetRecord[]> {
  if (!records) {
    records = fetch(url).then((r) => { if (!r.ok) throw new Error('The dataset records could not be loaded.'); return r.json() as Promise<DatasetRecord[]>; });
    records.catch(() => { records = null; });
  }
  return records;
}

let loading: Promise<Basemap> | null = null;

/** Load the basemap once (both scales) from the interface's data folder. */
export function loadBasemap(baseUrl = 'data/natural-earth/'): Promise<Basemap> {
  if (!loading) {
    loading = Promise.all(['110m', '50m'].map(async (s) => {
      const res = await fetch(`${baseUrl}ne-${s}.json`);
      if (!res.ok) throw new Error(`The Earth basemap (${s}) could not be loaded.`);
      return decodeBasemap(await res.json() as BasemapFile);
    })).then((scales) => ({ version: 'natural-earth', scales }));
    loading.catch(() => { loading = null; });
  }
  return loading;
}

let loadingDetail: Promise<BasemapScale> | null = null;

/** Add the finest scale (1:10m, 9 MB) to a loaded basemap; downloaded once, when first needed. */
export function loadBasemapDetail(base: Basemap, baseUrl = 'data/natural-earth/'): Promise<Basemap> {
  if (base.scales.some((s) => s.scale === '10m')) return Promise.resolve(base);
  if (!loadingDetail) {
    loadingDetail = fetch(`${baseUrl}ne-10m.json`).then(async (res) => {
      if (!res.ok) throw new Error('The detailed coastlines could not be loaded.');
      // Decoded and made ready a little at a time: the page stays responsive while 9 MB of coast arrive.
      const scale = await gently(decodeSteps(await res.json() as BasemapFile));
      await gently(readySteps(scale));
      return scale;
    });
    loadingDetail.catch(() => { loadingDetail = null; });
  }
  return loadingDetail.then((scale) => {
    if (!base.scales.some((s) => s.scale === '10m')) base.scales.push(scale);
    return base;
  });
}

/** Pixels per degree of longitude at the centre of the view. */
export function pixelsPerDegree(view: View): number {
  return (view.projection.scale() * Math.PI) / 180;
}

/**
 * The data to draw from: 1:110m for very small views of the whole world, 1:50m from there on,
 * 1:10m (when loaded) above DETAIL_PIXELS_PER_DEGREE. Measured in design pixels (as if the view
 * were 1920 wide), so a preview and a large export choose alike.
 */
export function chooseScale(basemap: Basemap, view: View): BasemapScale {
  const by = (name: string) => basemap.scales.find((s) => s.scale === name);
  const ppd = pixelsPerDegree(view) / view.unit;
  if (ppd > DETAIL_PIXELS_PER_DEGREE) { const d = by('10m'); if (d) return d; }
  if (ppd > MEDIUM_PIXELS_PER_DEGREE) { const m = by('50m'); if (m) return m; }
  return by('110m') ?? basemap.scales[0];
}

/** A scale's shapes as rings and lines ready for drawing (made on first use). */
interface ScaleRings { land: Ring[]; lakes: Ring[]; coastline: Ring[]; borders: Ring[] }
const ringsOfScale = new WeakMap<BasemapScale, ScaleRings>();

function ringsOf(b: BasemapScale): ScaleRings {
  let r = ringsOfScale.get(b);
  if (!r) {
    const closed = (mp: GeoJSON.MultiPolygon): Ring[] => mp.coordinates.flatMap((poly) => poly.map((ring) => {
      // GeoJSON repeats a ring's first point at its end; rings here close by themselves.
      const n = ring.length - 1;
      const lon = new Float64Array(n), lat = new Float64Array(n);
      for (let i = 0; i < n; i++) { lon[i] = ring[i][0]; lat[i] = ring[i][1]; }
      return makeRing(lon, lat, true, false);
    }));
    const open = (ml: GeoJSON.MultiLineString): Ring[] => ml.coordinates.map((line) => makeRing(Float64Array.from(line, (q) => q[0]), Float64Array.from(line, (q) => q[1]), false, false));
    r = { land: closed(b.land), lakes: closed(b.lakes), coastline: open(b.coastline), borders: open(b.borders) };
    ringsOfScale.set(b, r);
  }
  return r;
}

/**
 * The part of the planet a view can show, as a longitude range (unwrapped around the camera, so it
 * may run past ±180°) and a latitude range, with a margin; null when the view shows (nearly) the
 * whole planet or its outline cannot be traced. Every projection used here keeps longitude and
 * latitude monotonic across the screen, so the screen's outline bounds what lies inside it.
 */
export function visibleBounds(view: View): { west: number; east: number; south: number; north: number } | null {
  const { width: w, height: h } = view;
  const ref = view.camera.lon;
  let dMin = Infinity, dMax = -Infinity, south = Infinity, north = -Infinity;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    for (const [x, y] of [[f * w, 0], [f * w, h], [0, f * h], [w, f * h]]) {
      const ll = screenToLonLat(view, x, y);
      if (!ll) return null; // the edge of the map is on screen: the view is (nearly) global anyway
      const d = ((((ll[0] - ref) % 360) + 540) % 360) - 180;
      if (d < dMin) dMin = d; if (d > dMax) dMax = d;
      if (ll[1] < south) south = ll[1]; if (ll[1] > north) north = ll[1];
    }
  }
  const onScreen = (lat: number) => { const p = lonLatToScreen(view, ref, lat); return !!p && p[0] >= 0 && p[1] >= 0 && p[0] <= w && p[1] <= h; };
  if (onScreen(90)) { north = 90; dMin = -180; dMax = 180; }
  if (onScreen(-90)) { south = -90; dMin = -180; dMax = 180; }
  const mLon = 1 + 0.1 * (dMax - dMin), mLat = 1 + 0.1 * (north - south);
  if (dMax - dMin + 2 * mLon >= 340) return null;
  return { west: ref + dMin - mLon, east: ref + dMax + mLon, south: Math.max(-90, south - mLat), north: Math.min(90, north + mLat) };
}

export function boxIntersects(b: Box, v: { west: number; east: number; south: number; north: number }): boolean {
  if (b[3] < v.south || b[1] > v.north) return false;
  for (const k of [-360, 0, 360]) if (b[0] + k <= v.east && b[2] + k >= v.west) return true;
  return false;
}

export interface BasemapStyle { land: string; coast: string; lake: string; reference: string }

export const DEFAULT_BASEMAP_STYLE: BasemapStyle = {
  land: '#38443a', coast: 'rgba(176, 204, 214, 0.55)', lake: '#14324a', reference: 'rgba(235, 240, 245, 0.42)',
};

interface Paths {
  land: BlockPath; lakes: BlockPath; coastline: BlockPath; borders: BlockPath | null;
  /**
   * What the sheet's window holds: 'mixed' (a coast or a lake shore passes through it), or nothing
   * but 'land' or nothing but 'sea' (territory then needs no trimming at the coast, or is not seen at all).
   */
  coast: 'land' | 'sea' | 'mixed';
}

/** Is a point inside rings drawn with straight edges in longitude/latitude (even-odd)? */
function insideRings(rings: Ring[], lon: number, lat: number): boolean {
  let inside = false;
  for (const r of rings) {
    if (lat < r.box[1] || lat > r.box[3]) continue;
    // The ring as it lies, or a turn east or west of it.
    for (const turn of [-360, 0, 360]) {
      const x = lon - turn;
      if (x < r.box[0] || x > r.box[2]) continue;
      const n = r.lon.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = r.lat[i], yj = r.lat[j];
        if ((yi > lat) !== (yj > lat) && x < ((r.lon[j] - r.lon[i]) * (lat - yi)) / (yj - yi) + r.lon[i]) inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Draws the basemap from paths prepared on the current sheet (see plane.ts): only what the sheet
 * shows, at the detail its scale can show; kept while the view stays on the sheet.
 */
export class BasemapPainter {
  /** The paths for this sheet (land, lakes, coastline; the reference borders on request). */
  pathsFor(view: View, sheet: Sheet, basemap: Basemap, referenceBorders = false): Paths {
    const b = chooseScale(basemap, view);
    const key = `basemap:${b.scale}`;
    let paths = sheet.cache.get(key) as Paths | undefined;
    const rings = ringsOf(b);
    if (!paths) {
      const fill = (list: Ring[]) => { const p = sheet.blocks(); for (const r of list) { if (sheet.copies(r.box).length) { rankRing(r); sheet.ring(p, r); } } return p; };
      sheet.touched = false;
      const land = fill(rings.land), lakes = fill(rings.lakes);
      // No shore anywhere on the sheet: it is all land or all sea, as its middle is.
      const coast = sheet.touched ? 'mixed' : insideRings(rings.land, sheet.centre[0], sheet.centre[1]) && !insideRings(rings.lakes, sheet.centre[0], sheet.centre[1]) ? 'land' : 'sea';
      paths = { land, lakes, coastline: this.lines(sheet, rings.coastline), borders: null, coast };
      sheet.cache.set(key, paths);
    }
    if (referenceBorders && !paths.borders) paths.borders = this.lines(sheet, rings.borders);
    return paths;
  }

  private lines(sheet: Sheet, list: Ring[]): BlockPath {
    const p = sheet.blocks();
    for (const r of list) { if (!sheet.copies(r.box).length) continue; rankRing(r); for (const l of sheet.lines(r)) p.addLine(l); }
    return p;
  }

  draw(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, o: { referenceBorders: boolean; style?: BasemapStyle; oceanColor?: string }): void {
    const paths = this.pathsFor(view, sheet, basemap, o.referenceBorders);
    const st = o.style ?? DEFAULT_BASEMAP_STYLE;
    const [k, e, f] = sheet.placement(view);
    const px = view.unit / k; // a design pixel, in sheet units
    ctx.save();
    ctx.transform(k, 0, 0, k, e, f);
    const fill = (p: Path2D) => ctx.fill(p, 'evenodd'), stroke = (p: Path2D) => ctx.stroke(p);
    ctx.fillStyle = st.land;
    paths.land.paint(ctx, 1, fill);
    // Lakes are cut out of the land, so they show whatever lies beneath (the ocean, or nothing).
    ctx.globalCompositeOperation = 'destination-out';
    paths.lakes.paint(ctx, 1, fill);
    ctx.globalCompositeOperation = 'source-over';
    if (o.oceanColor) { ctx.fillStyle = o.oceanColor; paths.lakes.paint(ctx, 1, fill); }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = st.coast;
    ctx.lineWidth = 0.8 * px;
    paths.coastline.paint(ctx, 0.4 * px + 1, stroke);
    if (o.referenceBorders && paths.borders) {
      ctx.strokeStyle = st.reference;
      ctx.lineWidth = 0.9 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      paths.borders.paint(ctx, 0.45 * px + 1, stroke);
    }
    ctx.restore();
  }

  /**
   * Keep only what lies on land in a buffer: everything over the sea (and, with `lakes`, over lakes)
   * is erased. Used to end territory at the coast (coastline clipping).
   */
  maskToLand(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, lakes = true): void {
    const paths = this.pathsFor(view, sheet, basemap);
    const [k, e, f] = sheet.placement(view);
    ctx.save();
    ctx.transform(k, 0, 0, k, e, f);
    ctx.fillStyle = '#000';
    paths.land.keepInside(ctx);
    if (lakes) { ctx.globalCompositeOperation = 'destination-out'; paths.lakes.paint(ctx, 1, (p) => ctx.fill(p, 'evenodd')); }
    ctx.restore();
  }

  /** Stroke the coastline `width` screen pixels wide (the band along the coast that gaps are filled in, D83). */
  strokeCoastline(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, width: number): void {
    const paths = this.pathsFor(view, sheet, basemap);
    const [k, e, f] = sheet.placement(view);
    ctx.save();
    ctx.transform(k, 0, 0, k, e, f);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = width / k;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    paths.coastline.paint(ctx, width / k / 2 + 1, (p) => ctx.stroke(p));
    ctx.restore();
  }

  /** Paint the land solid (for a mask of the land, see MapRenderer). */
  fillLand(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap): void {
    const paths = this.pathsFor(view, sheet, basemap);
    const [k, e, f] = sheet.placement(view);
    ctx.save();
    ctx.transform(k, 0, 0, k, e, f);
    ctx.fillStyle = '#000';
    paths.land.paint(ctx, 1, (p) => ctx.fill(p, 'evenodd'));
    ctx.restore();
  }

  /** Erase what lies over lakes from a buffer. */
  eraseLakes(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap): void {
    const paths = this.pathsFor(view, sheet, basemap);
    const [k, e, f] = sheet.placement(view);
    ctx.save();
    ctx.transform(k, 0, 0, k, e, f);
    ctx.fillStyle = '#000';
    ctx.globalCompositeOperation = 'destination-out';
    paths.lakes.paint(ctx, 1, (p) => ctx.fill(p, 'evenodd'));
    ctx.restore();
  }
}

/**
 * Land as a grid of cells (1/8 degree, about 14 km), for fast "is this on land?" questions such as
 * where to put a label once the coastline has clipped a territory. Lakes count as water.
 */
export class LandMask {
  readonly width: number;
  readonly height: number;
  private readonly bits: Uint8Array;

  constructor(width: number, height: number, bits: Uint8Array) {
    this.width = width; this.height = height; this.bits = bits;
  }

  /** Rasterised in the browser (needs OffscreenCanvas); null elsewhere. */
  static build(basemap: Basemap, width = 2880): LandMask | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const height = width / 2;
    // Always 1:50m, so where labels go never depends on whether 1:10m has loaded yet.
    const b = basemap.scales.find((s) => s.scale === '50m') ?? basemap.scales[basemap.scales.length - 1];
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
    const projection = geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2]).precision(0);
    // (Rings are left for the fill to close: in Chrome each closePath takes time in proportion to
    // the whole path so far, which made this mask of 1,900 rings slow to make.)
    const sink = { beginPath: () => ctx.beginPath(), moveTo: (x: number, y: number) => ctx.moveTo(x, y), lineTo: (x: number, y: number) => ctx.lineTo(x, y), arc: (x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) => ctx.arc(x, y, r, a0, a1, ccw), closePath: () => undefined };
    const path = geoPath(projection, sink);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); path(b.land); ctx.fill('nonzero');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); path(b.lakes); ctx.fill();
    const data = ctx.getImageData(0, 0, width, height).data;
    const bits = new Uint8Array(width * height);
    for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    return new LandMask(width, height, bits);
  }

  onLand(lon: number, lat: number): boolean {
    const x = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * this.width);
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * this.height)));
    return this.bits[y * this.width + Math.min(this.width - 1, x)] === 1;
  }

  /** Land cells in each block of BLOCK by BLOCK cells, summed from the top left, made on first use. */
  private sums: Int32Array | null = null;
  private static readonly BLOCK = 8;

  /** Is there any land in a box of longitudes and latitudes (degrees)? Exact to the mask's cells. */
  anyLand(west: number, south: number, east: number, north: number): boolean {
    const W = this.width, H = this.height, K = LandMask.BLOCK, nx = Math.ceil(W / K), ny = Math.ceil(H / K);
    if (!this.sums) {
      const sums = new Int32Array((nx + 1) * (ny + 1));
      for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
        let n = 0;
        for (let y = by * K; y < Math.min(H, (by + 1) * K); y++) for (let x = bx * K; x < Math.min(W, (bx + 1) * K); x++) n += this.bits[y * W + x];
        sums[(by + 1) * (nx + 1) + bx + 1] = n + sums[by * (nx + 1) + bx + 1] + sums[(by + 1) * (nx + 1) + bx] - sums[by * (nx + 1) + bx];
      }
      this.sums = sums;
    }
    const sums = this.sums;
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(((90 - north) / 180) * H))), y1 = Math.max(y0, Math.min(H - 1, Math.floor(((90 - south) / 180) * H)));
    // Columns x0..x1 of rows y0..y1 (no wrapping): whole blocks by their sums, the cells around them one by one.
    const any = (x0: number, x1: number): boolean => {
      const bx0 = Math.ceil(x0 / K), bx1 = Math.floor((x1 + 1) / K) - 1, by0 = Math.ceil(y0 / K), by1 = Math.floor((y1 + 1) / K) - 1;
      const whole = bx1 >= bx0 && by1 >= by0;
      if (whole && sums[(by1 + 1) * (nx + 1) + bx1 + 1] - sums[by0 * (nx + 1) + bx1 + 1] - sums[(by1 + 1) * (nx + 1) + bx0] + sums[by0 * (nx + 1) + bx0] > 0) return true;
      const scan = (ax0: number, ay0: number, ax1: number, ay1: number): boolean => {
        for (let y = ay0; y <= ay1; y++) { const row = y * W; for (let x = ax0; x <= ax1; x++) if (this.bits[row + x]) return true; }
        return false;
      };
      if (!whole) return scan(x0, y0, x1, y1);
      const ix0 = bx0 * K, ix1 = (bx1 + 1) * K - 1, iy0 = by0 * K, iy1 = (by1 + 1) * K - 1;
      return scan(x0, y0, x1, iy0 - 1) || scan(x0, iy1 + 1, x1, y1) || scan(x0, iy0, ix0 - 1, iy1) || scan(ix1 + 1, iy0, x1, iy1);
    };
    if (!(east - west < 360 - 360 / W)) return any(0, W - 1);
    const x0 = Math.floor(((((west + 180) % 360) + 360) % 360) / 360 * W), x1 = x0 + Math.floor(((east - west) / 360) * W) + 1;
    return x1 <= W - 1 ? any(x0, x1) : any(x0, W - 1) || any(0, Math.min(W - 1, x1 - W));
  }
}

const masks = new WeakMap<Basemap, LandMask | null>();

/** The land mask of a basemap, built on first use. */
export function landMaskOf(basemap: Basemap): LandMask | null {
  if (!masks.has(basemap)) masks.set(basemap, LandMask.build(basemap));
  return masks.get(basemap) ?? null;
}
