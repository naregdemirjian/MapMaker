// The Earth basemap: land, lakes, coastlines and present-day country borders from Natural Earth,
// drawn beneath the territories. It is reference geography only: it is not part of the parcel map
// and never changes history. Files are produced by scripts/fetch-natural-earth.mjs.
import { geoArea, geoPath, geoEquirectangular } from 'd3-geo';
import { screenToLonLat, lonLatToScreen, type View } from './camera.ts';
import { makeRing, rankRing, addLine, type Ring, type Sheet } from './plane.ts';
import type { BlockPath } from './blocks.ts';
import type { RiverShape } from '../terrain/river-course.ts';

export interface BasemapFile {
  format: string; dataset: string; version: string; scale: string; quantum: number;
  /** (A rivers file's lines carry their Natural Earth scalerank in `ranks`.) */
  layers: Record<string, { kind: 'polygons' | 'lines'; items: number[][][] | number[][]; ranks?: number[] }>;
}

export interface BasemapScale {
  scale: string;
  land: GeoJSON.MultiPolygon;
  lakes: GeoJSON.MultiPolygon;
  coastline: GeoJSON.MultiLineString;
  borders: GeoJSON.MultiLineString;
  /** The longitude/latitude box of every item of each layer, in the same order, for culling. */
  boxes: Record<'land' | 'lakes' | 'coastline' | 'borders', Box[]>;
  /** Rivers (D99), with each line's scalerank (0 the greatest); loaded beside the scale, absent until then. */
  rivers?: { lines: GeoJSON.MultiLineString; ranks: number[] };
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
    })).then(async (scales) => {
      // Rivers (D99): 1:50m for both scales (the smallest views keep the greater rivers only).
      const rivers = await loadRivers(`${baseUrl}rivers-50m.json`);
      if (rivers) {
        scales[1].rivers = rivers;
        const keep = rivers.ranks.map((r, i) => (r <= 4 ? i : -1)).filter((i) => i >= 0);
        scales[0].rivers = { lines: { type: 'MultiLineString', coordinates: keep.map((i) => rivers.lines.coordinates[i]) }, ranks: keep.map((i) => rivers.ranks[i]) };
      }
      return { version: 'natural-earth', scales };
    });
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** Rivers from a rivers file (D99); null when it cannot be had (the map is drawn without them). */
async function loadRivers(url: string): Promise<BasemapScale['rivers'] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return decodeRivers(await res.json() as BasemapFile);
  } catch { return null; }
}

/** The rivers of a rivers file (D99). */
export function decodeRivers(file: BasemapFile): NonNullable<BasemapScale['rivers']> {
  const layer = file.layers.rivers;
  const items = (layer?.items ?? []) as number[][];
  return { lines: { type: 'MultiLineString', coordinates: items.map((l) => decodeLine(l, file.quantum)) }, ranks: items.map((_, i) => layer?.ranks?.[i] ?? 6) };
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
      const rivers = await loadRivers(`${baseUrl}rivers-10m.json`);
      if (rivers) scale.rivers = rivers;
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

/**
 * A scale's shapes as rings and lines ready for drawing (made on first use). lakePoly gives the
 * lake (polygon) each lake ring belongs to: its outline or one of its islands.
 */
interface ScaleRings { land: Ring[]; lakes: Ring[]; lakePoly: Int32Array; coastline: Ring[]; borders: Ring[] }

/** Rivers as lines with their ranks (0 the greatest): Natural Earth's, or a planet's (D99). */
export interface RiverSet { lines: GeoJSON.MultiLineString; ranks: number[] }
const riverRings = new WeakMap<RiverSet, Ring[]>();
const riverPathsKey = new WeakMap<RiverSet, string>();
let riverSets = 0;

/**
 * Strokes rivers on a sheet (D99): the greatest widest, the least thinnest, each the same width on
 * screen at any zoom. Their paths are kept with the sheet.
 */
export function drawRiverLines(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, rivers: RiverSet, color: string): void {
  let rings = riverRings.get(rivers);
  if (!rings) {
    rings = rivers.lines.coordinates.map((line) => makeRing(Float64Array.from(line, (q) => q[0]), Float64Array.from(line, (q) => q[1]), false, false));
    riverRings.set(rivers, rings);
    riverPathsKey.set(rivers, `rivers:${++riverSets}`);
  }
  const key = riverPathsKey.get(rivers)!;
  let paths = sheet.cache.get(key) as BlockPath[] | undefined;
  if (!paths) {
    paths = [sheet.blocks(), sheet.blocks(), sheet.blocks()];
    rings.forEach((r, i) => {
      if (!sheet.copies(r.box).length) return;
      rankRing(r);
      const rank = rivers.ranks[i] ?? 6, cls = rank <= 2 ? 0 : rank <= 5 ? 1 : 2;
      for (const l of sheet.lines(r)) paths![cls].addLine(l);
    });
    sheet.cache.set(key, paths);
  }
  const [k, e, f] = sheet.placement(view);
  const px = view.unit / k;
  ctx.save();
  ctx.transform(k, 0, 0, k, e, f);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  [1.6, 1.05, 0.65].forEach((w, c) => { ctx.lineWidth = w * px; paths![c].paint(ctx, (w * px) / 2 + 1, (p) => ctx.stroke(p)); });
  ctx.restore();
}

/**
 * Rivers drawn on a map (D220): each stretch as wide as the water it carries there (a multiple of the usual line: 1.9
 * pixels of a 1920-wide frame at 1), the same on screen at any zoom, and whatever the height of the ground beneath.
 * Their paths are kept with the sheet.
 */
const drawnRings = new WeakMap<readonly RiverShape[], { key: string; rings: Array<{ ring: Ring; w: number }> }>();
export function drawDrawnRivers(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, rivers: readonly RiverShape[], color: string): void {
  if (!rivers.length) return;
  let made = drawnRings.get(rivers);
  if (!made) {
    const rings: Array<{ ring: Ring; w: number }> = [], step = 0.15, q = (w: number) => Math.max(1, Math.round(w / step));
    // (Stretches of like width, each a line of its own sharing its ends with the next.)
    const add = (pts: Array<[number, number]>, widths: number[]) => {
      let start = 0;
      for (let i = 1; i < pts.length; i++) {
        if (i < pts.length - 1 && q(widths[i]) === q(widths[start])) continue;
        const seg = pts.slice(start, i + 1);
        rings.push({ ring: makeRing(Float64Array.from(seg, (p) => p[0]), Float64Array.from(seg, (p) => p[1]), false, false), w: q(widths[start]) * step });
        start = i;
      }
    };
    for (const r of rivers) { for (const b of r.branches) add(b.line, b.widths); add(r.course, r.widths); }
    made = { key: `drawn-rivers:${++riverSets}`, rings };
    drawnRings.set(rivers, made);
  }
  let paths = sheet.cache.get(made.key) as Array<[number, BlockPath]> | undefined;
  if (!paths) {
    const by = new Map<number, BlockPath>();
    for (const { ring, w } of made.rings) {
      if (!sheet.copies(ring.box).length) continue;
      rankRing(ring);
      let p = by.get(w);
      if (!p) { p = sheet.blocks(); by.set(w, p); }
      for (const l of sheet.lines(ring)) p.addLine(l);
    }
    // (The narrowest first, so the river lies over its tributaries where they join.)
    paths = [...by].sort((a, b) => a[0] - b[0]);
    sheet.cache.set(made.key, paths);
  }
  const [k, e, f] = sheet.placement(view);
  const px = view.unit / k;
  ctx.save();
  ctx.transform(k, 0, 0, k, e, f);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  for (const [w, p] of paths) { const lw = 1.9 * w * px; ctx.lineWidth = lw; p.paint(ctx, lw / 2 + 1, (path) => ctx.stroke(path)); }
  ctx.restore();
}
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
    const lakePoly = new Int32Array(b.lakes.coordinates.reduce((n, p) => n + p.length, 0));
    let at = 0;
    b.lakes.coordinates.forEach((p, i) => { for (let k = 0; k < p.length; k++) lakePoly[at++] = i; });
    r = { land: closed(b.land), lakes: closed(b.lakes), lakePoly, coastline: open(b.coastline), borders: open(b.borders) };
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
/** Which lakes are shown (D84): none, or those of at least `minKm2` square kilometres. */
export interface LakeFilter { show: boolean; minKm2: number }

const RAD = Math.PI / 180;
/**
 * A ring's area on the Earth in square kilometres: its area on an equal-area map (longitude against
 * the sine of the latitude), which for rings as small and as finely drawn as lakes is the true area.
 */
export function ringAreaKm2(r: Pick<Ring, 'lon' | 'lat'>): number {
  let sum = 0;
  const n = r.lon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) sum += (r.lon[j] - r.lon[i]) * (Math.sin(r.lat[j] * RAD) + Math.sin(r.lat[i] * RAD));
  return Math.abs(sum / 2) * RAD * 6371.0088 * 6371.0088;
}

/** The tiles the finest scale is cut into (scripts/fetch-natural-earth.mjs), in degrees. */
const TILE_DEG = 10;
const onTileLine = (v: number) => Math.abs(v / TILE_DEG - Math.round(v / TILE_DEG)) < 1e-9;

/**
 * The size of the lake each lake ring belongs to, in square kilometres: its outline less its islands,
 * and at 1:10m, where large lakes are cut into tiles, the pieces of one lake (those sharing a point on
 * a tile's edge) counted together, so a lake is shown or hidden whole.
 */
export function lakeSizes(lakes: ReadonlyArray<Pick<Ring, 'lon' | 'lat'>>, lakePoly: ArrayLike<number>): { size: Float64Array; lake: Int32Array } {
  const polys = lakes.length ? lakePoly[lakes.length - 1] + 1 : 0;
  const area = new Float64Array(polys), outline = new Int32Array(polys).fill(-1);
  for (let i = 0; i < lakes.length; i++) {
    const p = lakePoly[i];
    if (outline[p] < 0) { outline[p] = i; area[p] += ringAreaKm2(lakes[i]); } else area[p] -= ringAreaKm2(lakes[i]);
  }
  // Pieces of one lake: joined where they share a point on a tile's edge.
  const parent = Int32Array.from({ length: polys }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map<string, number>();
  for (let i = 0; i < lakes.length; i++) {
    const r = lakes[i], p = lakePoly[i];
    for (let k = 0; k < r.lon.length; k++) {
      if (!onTileLine(r.lon[k]) && !onTileLine(r.lat[k])) continue;
      const key = `${r.lon[k]},${r.lat[k]}`;
      const q = seen.get(key);
      if (q === undefined) seen.set(key, p);
      else { const a = find(p), b = find(q); if (a !== b) parent[a] = b; }
    }
  }
  const whole = new Float64Array(polys);
  for (let p = 0; p < polys; p++) whole[find(p)] += Math.max(0, area[p]);
  const size = new Float64Array(lakes.length), lake = new Int32Array(lakes.length);
  for (let i = 0; i < lakes.length; i++) { lake[i] = find(lakePoly[i]); size[i] = whole[lake[i]]; }
  return { size, lake };
}
const lakeSizesOf = new WeakMap<ScaleRings, { size: Float64Array; lake: Int32Array }>();
function sizesOf(rings: ScaleRings) {
  let sizes = lakeSizesOf.get(rings);
  if (!sizes) { sizes = lakeSizes(rings.lakes, rings.lakePoly); lakeSizesOf.set(rings, sizes); }
  return sizes;
}

/** How many lakes the most detailed scale loaded has, and how many of them are at least `minKm2`. */
export function lakeCount(basemap: Basemap, minKm2: number): { shown: number; total: number } {
  const b = basemap.scales[basemap.scales.length - 1];
  if (!b) return { shown: 0, total: 0 };
  const { size, lake } = sizesOf(ringsOf(b));
  const all = new Set<number>(), kept = new Set<number>();
  for (let i = 0; i < lake.length; i++) { all.add(lake[i]); if (size[i] >= minKm2) kept.add(lake[i]); }
  return { shown: kept.size, total: all.size };
}

export class BasemapPainter {
  /** Which lakes are drawn (and cut out of territory that ends at the coast). */
  lakeFilter: LakeFilter = { show: true, minKm2: 0 };
  /** How many river lines the last picture drew from (0 with rivers hidden); for the tests. */
  lastRivers = 0;
  private filterKey(): string { return this.lakeFilter.show ? `l${this.lakeFilter.minKm2}` : 'nolakes'; }
  private shownLakes = new WeakMap<ScaleRings, { min: number; rings: Ring[] }>();

  /** The lake rings shown at a scale: whole lakes (with their islands) of at least the smallest size. */
  private lakesOf(rings: ScaleRings): Ring[] {
    if (!this.lakeFilter.show) return [];
    const min = this.lakeFilter.minKm2;
    if (!(min > 0)) return rings.lakes;
    const kept = this.shownLakes.get(rings);
    if (kept && kept.min === min) return kept.rings;
    const { size } = sizesOf(rings);
    const out: Ring[] = [];
    for (let i = 0; i < rings.lakes.length; i++) if (size[i] >= min) out.push(rings.lakes[i]);
    this.shownLakes.set(rings, { min, rings: out });
    return out;
  }

  /** The paths for this sheet (land, lakes, coastline; the reference borders on request). */
  pathsFor(view: View, sheet: Sheet, basemap: Basemap, referenceBorders = false): Paths {
    const b = chooseScale(basemap, view);
    const key = `basemap:${b.scale}|${this.filterKey()}`;
    let paths = sheet.cache.get(key) as Paths | undefined;
    const rings = ringsOf(b);
    if (!paths) {
      const fill = (list: Ring[]) => { const p = sheet.blocks(); for (const r of list) { if (sheet.copies(r.box).length) { rankRing(r); sheet.ring(p, r); } } return p; };
      sheet.touched = false;
      const shownLakes = this.lakesOf(rings);
      const land = fill(rings.land), lakes = fill(shownLakes);
      // No shore anywhere on the sheet: it is all land or all sea, as its middle is.
      const coast = sheet.touched ? 'mixed' : insideRings(rings.land, sheet.centre[0], sheet.centre[1]) && !insideRings(shownLakes, sheet.centre[0], sheet.centre[1]) ? 'land' : 'sea';
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

  /**
   * Draws the land and lakes (unless `fills` is false: terrain colours stand for them), then whatever
   * `afterFills` lays over them (relief), then the coastline and the reference borders.
   */
  draw(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, o: { referenceBorders: boolean; style?: BasemapStyle; oceanColor?: string; coastline?: boolean; fills?: boolean | 'lakes'; afterFills?: () => void; rivers?: string | null }): void {
    const paths = this.pathsFor(view, sheet, basemap, o.referenceBorders);
    const st = o.style ?? DEFAULT_BASEMAP_STYLE;
    const [k, e, f] = sheet.placement(view);
    const px = view.unit / k; // a design pixel, in sheet units
    const fill = (p: Path2D) => ctx.fill(p, 'evenodd'), stroke = (p: Path2D) => ctx.stroke(p);
    if (o.fills === 'lakes') {
      // The lakes alone, in the colour given (the land is drawn otherwise).
      if (o.oceanColor) {
        ctx.save();
        ctx.transform(k, 0, 0, k, e, f);
        ctx.fillStyle = o.oceanColor;
        paths.lakes.paint(ctx, 1, fill);
        ctx.restore();
      }
    } else if (o.fills !== false) {
      ctx.save();
      ctx.transform(k, 0, 0, k, e, f);
      ctx.fillStyle = st.land;
      paths.land.paint(ctx, 1, fill);
      // Lakes are cut out of the land, so they show whatever lies beneath (the ocean, or nothing).
      ctx.globalCompositeOperation = 'destination-out';
      paths.lakes.paint(ctx, 1, fill);
      ctx.globalCompositeOperation = 'source-over';
      if (o.oceanColor) { ctx.fillStyle = o.oceanColor; paths.lakes.paint(ctx, 1, fill); }
      ctx.restore();
    }
    o.afterFills?.();
    if (o.rivers) this.rivers(ctx, view, sheet, basemap, o.rivers);
    else this.lastRivers = 0;
    if (o.coastline !== false) this.coastline(ctx, view, sheet, basemap, st);
    ctx.save();
    ctx.transform(k, 0, 0, k, e, f);
    if (o.referenceBorders && paths.borders) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = st.reference;
      ctx.lineWidth = 0.9 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      paths.borders.paint(ctx, 0.45 * px + 1, stroke);
    }
    ctx.restore();
  }

  /**
   * Strokes the rivers (D99) of the scale the view is drawn at: the greatest widest, the least
   * thinnest, each the same width on screen at any zoom.
   */
  rivers(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, color: string): void {
    const b = chooseScale(basemap, view);
    this.lastRivers = b.rivers?.ranks.length ?? 0;
    if (b.rivers) drawRiverLines(ctx, view, sheet, b.rivers, color);
  }

  /** Strokes the coastline as the basemap shows it. */
  coastline(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, style?: BasemapStyle): void {
    const paths = this.pathsFor(view, sheet, basemap);
    const st = style ?? DEFAULT_BASEMAP_STYLE;
    const [k, e, f] = sheet.placement(view);
    const px = view.unit / k;
    ctx.save();
    ctx.transform(k, 0, 0, k, e, f);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = st.coast;
    ctx.lineWidth = 0.8 * px;
    paths.coastline.paint(ctx, 0.4 * px + 1, (p) => ctx.stroke(p));
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
