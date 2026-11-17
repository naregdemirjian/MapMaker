// Regions to pick from (Stage 2, D78): today's countries (Natural Earth 1:50m) or their states and
// provinces (Natural Earth admin-1, 1:10m), found by a point (the region under the pointer) or by a
// box, so the region picker can give them to an owner (commands.ts addCountries with `into`).
import type { CountryShape } from './countries.ts';

export interface RegionsFile {
  format: string; version: string; scale: string; quantum: number;
  regions: Array<{ name: string; country: string; type: string; iso: string; polygons: number[][][] }>;
}

export interface PickRegion {
  /** "France" or "Bretagne". */
  name: string;
  /** The country it is part of (its own name for a country). */
  country: string;
  /** "State", "Province", "Country"… */
  type: string;
  /** Each polygon: its outline, then its holes; points as [lon, lat]. */
  polygons: Array<Array<Array<[number, number]>>>;
}

export function decodeRegions(file: RegionsFile): PickRegion[] {
  if (file.format !== 'mapmaker-regions-1') throw new Error(`Unknown regions format "${file.format}".`);
  const q = file.quantum;
  const ring = (flat: number[]): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; out.push([Math.round(x * q * 1e7) / 1e7, Math.round(y * q * 1e7) / 1e7]); }
    return out;
  };
  return file.regions.map((r) => ({ name: r.name, country: r.country, type: r.type, polygons: r.polygons.map((poly) => poly.map(ring)) }));
}

export function countriesAsRegions(countries: CountryShape[]): PickRegion[] {
  return countries.map((c) => ({ name: c.name, country: c.name, type: c.nation ? 'Country' : 'Territory', polygons: c.polygons }));
}

/** Inside a ring (lon, lat as a plane: Natural Earth cuts shapes at ±180°). */
function inRing(r: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const CELL = 10;

/** Regions found by a point or a box, through a grid of their polygons' bounding boxes. */
export class RegionIndex {
  readonly regions: PickRegion[];
  /** A point inside each region (in its largest polygon), for choosing by box and for names. */
  readonly anchors: Array<[number, number]>;
  private boxes: Array<{ region: number; poly: number; box: [number, number, number, number] }> = [];
  private grid = new Map<string, number[]>();

  constructor(regions: PickRegion[]) {
    this.regions = regions;
    this.anchors = regions.map((r) => {
      let best: Array<[number, number]> = r.polygons[0]?.[0] ?? [[0, 0]], area = -1;
      for (const poly of r.polygons) {
        const o = poly[0];
        let a = 0;
        for (let i = 0, j = o.length - 1; i < o.length; j = i++) a += (o[j][0] - o[i][0]) * (o[j][1] + o[i][1]);
        if (Math.abs(a) > area) { area = Math.abs(a); best = o; }
      }
      return anchorOf(best, r.polygons.find((p) => p[0] === best) ?? [best]);
    });
    regions.forEach((r, ri) => r.polygons.forEach((poly, pi) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of poly[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const k = this.boxes.push({ region: ri, poly: pi, box: [x0, y0, x1, y1] }) - 1;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const key = `${cx},${cy}`;
        (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(k);
      }
    }));
  }

  /** The region at a point (null: none, the sea). */
  at(lon: number, lat: number): number | null {
    const x = ((((lon + 180) % 360) + 360) % 360) - 180;
    for (const k of this.grid.get(`${Math.floor(x / CELL)},${Math.floor(lat / CELL)}`) ?? []) {
      const b = this.boxes[k];
      if (x < b.box[0] || x > b.box[2] || lat < b.box[1] || lat > b.box[3]) continue;
      const poly = this.regions[b.region].polygons[b.poly];
      if (inRing(poly[0], x, lat) && !poly.slice(1).some((h) => inRing(h, x, lat))) return b.region;
    }
    return null;
  }
}

/** A point inside a polygon: the middle of the widest stretch of the horizontal line through its middle. */
function anchorOf(outer: Array<[number, number]>, poly: Array<Array<[number, number]>>): [number, number] {
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of outer) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const y = y0 + (y1 - y0) * f + 1e-9;
    const xs: number[] = [];
    for (const r of poly) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    let best: [number, number] | null = null, w = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; }
    if (best) return best;
  }
  return outer[0];
}
