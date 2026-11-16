// The Earth basemap: land, lakes, coastlines and present-day country borders from Natural Earth,
// drawn beneath the territories. It is reference geography only: it is not part of the parcel map
// and never changes history. Files are produced by scripts/fetch-natural-earth.mjs.
import { geoArea, geoPath } from 'd3-geo';
import { screenToLonLat, lonLatToScreen, type View } from './camera.ts';

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

/** Every scale available, coarsest first. */
export interface Basemap { version: string; scales: BasemapScale[] }

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

export function decodeBasemap(file: BasemapFile): BasemapScale {
  if (file.format !== 'mapmaker-basemap-1') throw new Error(`Unknown basemap format "${file.format}".`);
  const q = file.quantum;
  const polygons = (name: string): GeoJSON.MultiPolygon => {
    const items = (file.layers[name]?.items ?? []) as number[][][];
    const coordinates = items.map((rings) => {
      const poly = rings.map((r) => closeRing(decodeLine(r, q)));
      // d3-geo reads winding strictly (a ring the wrong way round encloses the rest of the planet):
      // any polygon that comes out larger than a hemisphere is turned round.
      if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) for (const r of poly) r.reverse();
      return poly;
    });
    return { type: 'MultiPolygon', coordinates };
  };
  const lines = (name: string): GeoJSON.MultiLineString => ({
    type: 'MultiLineString', coordinates: ((file.layers[name]?.items ?? []) as number[][]).map((l) => decodeLine(l, q)),
  });
  const land = polygons('land'), lakes = polygons('lakes'), coastline = lines('coastline'), borders = lines('borders');
  return {
    scale: file.scale, land, lakes, coastline, borders,
    boxes: {
      land: land.coordinates.map((p) => boxOf(p[0])), lakes: lakes.coordinates.map((p) => boxOf(p[0])),
      coastline: coastline.coordinates.map(boxOf), borders: borders.coordinates.map(boxOf),
    },
  };
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

/** Pixels per degree of longitude at the centre of the view. */
export function pixelsPerDegree(view: View): number {
  return (view.projection.scale() * Math.PI) / 180;
}

/** The detail to draw: 1:110m for whole-world views, 1:50m once a degree is more than 6 pixels wide. */
export function chooseScale(basemap: Basemap, view: View): BasemapScale {
  const s = basemap.scales;
  return pixelsPerDegree(view) > 6 ? s[s.length - 1] : s[0];
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

interface Paths { land: Path2D; lakes: Path2D; coastline: Path2D; borders: Path2D | null }

/** Draws the basemap; keeps the projected paths while the view is unchanged (scrubbing time reuses them). */
export class BasemapPainter {
  private key = '';
  private paths: Paths | null = null;

  draw(ctx: CanvasRenderingContext2D, view: View, basemap: Basemap, o: { referenceBorders: boolean; style?: BasemapStyle; oceanColor?: string }): void {
    const b = chooseScale(basemap, view);
    const key = `${view.key}|${b.scale}|${o.referenceBorders}`;
    if (key !== this.key || !this.paths) {
      // Only the items that can be on screen are projected (a regional view touches a few percent
      // of the data); d3 writes straight into each Path2D.
      const vis = visibleBounds(view);
      const pick = <T,>(items: T[], boxes: Box[]) => (vis ? items.filter((_, i) => boxIntersects(boxes[i], vis)) : items);
      const draw = (g: GeoJSON.GeometryObject) => { const p2 = new Path2D(); geoPath(view.projection, p2 as unknown as CanvasRenderingContext2D)(g); return p2; };
      const poly = (k: 'land' | 'lakes') => draw({ type: 'MultiPolygon', coordinates: pick(b[k].coordinates, b.boxes[k]) });
      const line = (k: 'coastline' | 'borders') => draw({ type: 'MultiLineString', coordinates: pick(b[k].coordinates, b.boxes[k]) });
      this.paths = { land: poly('land'), lakes: poly('lakes'), coastline: line('coastline'), borders: o.referenceBorders ? line('borders') : null };
      this.key = key;
    }
    const st = o.style ?? DEFAULT_BASEMAP_STYLE;
    const u = view.unit;
    ctx.save();
    ctx.fillStyle = st.land;
    ctx.fill(this.paths.land, 'nonzero');
    // Lakes are cut out of the land, so they show whatever lies beneath (the ocean, or nothing).
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(this.paths.lakes);
    ctx.globalCompositeOperation = 'source-over';
    if (o.oceanColor) { ctx.fillStyle = o.oceanColor; ctx.fill(this.paths.lakes); }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = st.coast;
    ctx.lineWidth = 0.8 * u;
    ctx.stroke(this.paths.coastline);
    if (this.paths.borders) {
      ctx.strokeStyle = st.reference;
      ctx.lineWidth = 0.9 * u;
      ctx.setLineDash([4 * u, 3 * u]);
      ctx.stroke(this.paths.borders);
    }
    ctx.restore();
  }
}
