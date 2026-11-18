// Territories from files (improvement B, D120): maps of borders as GeoJSON (a FeatureCollection of polygons in
// longitude and latitude, one feature per country or several), read into countries to add at a date. A series of
// files, each the map of its year (as historical border datasets come), becomes the history between them.
import type { CountryToAdd } from './commands.ts';
import { gregorian, NEG_INF, POS_INF, compare, add, type Instant } from '../core-time/index.ts';

type Ring = Array<[number, number]>;
export interface ImportedFeature { props: Record<string, unknown>; polygons: Ring[][] }
export interface ImportedFile { features: ImportedFeature[]; keys: string[]; skipped: number }

/** A ring of [lon, lat] points, or null when it is not one (too short, not numbers, latitudes beyond the poles). */
function ringOf(raw: unknown): Ring | null {
  if (!Array.isArray(raw)) return null;
  const out: Ring = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const lon = Number(p[0]), lat = Number(p[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90.0001) return null;
    out.push([lon, Math.max(-90, Math.min(90, lat))]);
  }
  // (A closing point repeating the first is not needed.)
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

/** A polygon's rings (outline first, then holes), or null. */
function polygonOf(raw: unknown): Ring[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const outer = ringOf(raw[0]);
  if (!outer) return null;
  return [outer, ...raw.slice(1).map(ringOf).filter((r): r is Ring => !!r)];
}

/** The polygons of a geometry (Polygon, MultiPolygon, or a GeometryCollection of them); others give none. */
function polygonsOf(g: unknown): Ring[][] {
  const geom = g as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
  if (!geom || typeof geom !== 'object') return [];
  if (geom.type === 'Polygon') { const p = polygonOf(geom.coordinates); return p ? [p] : []; }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) return geom.coordinates.map(polygonOf).filter((p): p is Ring[] => !!p);
  if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) return geom.geometries.flatMap(polygonsOf);
  return [];
}

/** A GeoJSON text read: its features with polygons, the names of their properties, and how many were left out (no area). */
export function readGeoJSON(text: string): ImportedFile {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('This file is not GeoJSON (it could not be read as JSON).'); }
  const root = json as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown };
  const raw: unknown[] = root?.type === 'FeatureCollection' && Array.isArray(root.features) ? root.features
    : root?.type === 'Feature' ? [root]
    : root?.type === 'Polygon' || root?.type === 'MultiPolygon' || root?.type === 'GeometryCollection' ? [{ type: 'Feature', geometry: root, properties: {} }]
    : [];
  if (!raw.length) throw new Error('This file holds no GeoJSON features (a FeatureCollection of polygons is expected).');
  const features: ImportedFeature[] = [];
  const keys = new Set<string>();
  let skipped = 0;
  for (const f of raw) {
    const feat = f as { geometry?: unknown; properties?: Record<string, unknown> | null };
    const polygons = polygonsOf(feat?.geometry);
    if (!polygons.length) { skipped++; continue; }
    const props = feat.properties && typeof feat.properties === 'object' ? feat.properties : {};
    for (const [k, v] of Object.entries(props)) if (typeof v === 'string' || typeof v === 'number') keys.add(k);
    features.push({ props, polygons });
  }
  if (!features.length) throw new Error('No feature of this file has an area (polygons are needed for territories).');
  return { features, keys: [...keys], skipped };
}

const NAME_KEYS = ['NAME', 'name', 'Name', 'NAME_EN', 'name_en', 'ADMIN', 'admin', 'NAME_LONG', 'country', 'COUNTRY', 'Country', 'SOVEREIGNT', 'sovereignt', 'title', 'label', 'NAME_0'];

/** The property that most likely holds the countries' names: a usual name for it, else the one with most different words. */
export function guessNameKey(file: ImportedFile): string | null {
  const texts = (k: string) => file.features.map((f) => f.props[k]).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  for (const k of NAME_KEYS) if (file.keys.includes(k) && texts(k).length >= file.features.length * 0.5) return k;
  let best: string | null = null, most = 0;
  for (const k of file.keys) { const n = new Set(texts(k)).size; if (n > most) { most = n; best = k; } }
  return best;
}

/** A colour as a property gives it ("#c0392b", "c0392b", "#abc"), or undefined. */
function colourOf(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/**
 * The countries of a file, by the name in `nameKey`: features of the same name are one country (its pieces
 * together); features without a name are left out (counted). Colours from `colorKey` where it holds one.
 */
export function countriesOf(file: ImportedFile, nameKey: string, colorKey?: string | null): { countries: CountryToAdd[]; unnamed: number } {
  const byName = new Map<string, CountryToAdd>();
  let unnamed = 0;
  for (const f of file.features) {
    const raw = f.props[nameKey];
    const name = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (!name) { unnamed++; continue; }
    const key = name.toLowerCase();
    let c = byName.get(key);
    if (!c) { c = { name, polygons: [] }; const col = colorKey ? colourOf(f.props[colorKey]) : undefined; if (col) c.color = col; byName.set(key, c); }
    c.polygons.push(...f.polygons);
  }
  return { countries: [...byName.values()], unnamed };
}

/**
 * The year a file's name gives, as historical datasets name their maps ("world_1492.geojson", "world_bc1000.geojson",
 * "europe-1914", "map 500 BC"), in astronomical years (1000 BC is -999); null when it gives none.
 */
export function yearOfFileName(name: string): number | null {
  const base = name.replace(/\.[^.]+$/, '');
  const bc = /(?:^|[^a-z])bce?[\s_-]*(\d{1,6})(?!\d)/i.exec(base) ?? /(?:^|\D)(\d{1,6})[\s_-]*bce?(?![a-z])/i.exec(base);
  if (bc) return 1 - Number(bc[1]);
  const ad = /(?:^|\D)(\d{1,4})(?!\d)/.exec(base.replace(/\bad\b/ig, ''));
  return ad ? Number(ad[1]) : null;
}

// ---------------------------------------------------------------- shapes with dates of their own

/** A shape of a dataset that dates each of its shapes (as CShapes does): its country, from when, until when (both inclusive). */
export interface DatedShape extends CountryToAdd { from: Instant; to: Instant }

const OPEN_WORDS = /^(present|now|today|current|ongoing|open|none|null|-|\.\.)$/i;

/**
 * A date as datasets write it, as the instant it starts: a year (negative ones BC: -500 is 500 BC), "1886-01-01",
 * "1886/1/1", "1.1.1886", "1886-05", "1886"; with how precise it is. Open (null) for nothing, "present", 9999 and
 * later; undefined when it is not a date.
 */
export function dateOfValue(v: unknown): { t: Instant; precision: 'year' | 'month' | 'day' } | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const civil = (year: number, month?: number, day?: number) => {
    if (!Number.isInteger(year) || (month !== undefined && (month < 1 || month > 12)) || (day !== undefined && (day < 1 || day > 31))) return undefined;
    if (year >= 9999) return null;
    return { t: gregorian.fromCivil({ year, month: month ?? 1, day: day ?? 1 }), precision: day !== undefined ? 'day' as const : month !== undefined ? 'month' as const : 'year' as const };
  };
  // (Negative years are BC, as historical datasets write them: no year 0.)
  const bcYear = (y: number) => (y < 0 ? y + 1 : y);
  if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? civil(bcYear(v)) : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (OPEN_WORDS.test(s)) return null;
  let m = /^(-?\d{1,6})$/.exec(s);
  if (m) return civil(bcYear(Number(m[1])));
  m = /^(-?\d{1,6})[-/](\d{1,2})(?:[-/](\d{1,2}))?(?:[T ].*)?$/.exec(s);
  if (m) return civil(bcYear(Number(m[1])), Number(m[2]), m[3] ? Number(m[3]) : undefined);
  m = /^(\d{1,2})[./](\d{1,2})[./](-?\d{1,6})$/.exec(s);
  if (m) return civil(bcYear(Number(m[3])), Number(m[2]), Number(m[1]));
  m = /^(\d{1,6})\s*(bce?|bc)$/i.exec(s);
  if (m) return civil(1 - Number(m[1]));
  return undefined;
}

/** The first moment after a date of that precision: the day, month or year after (an inclusive end's change). */
export function afterDate(d: { t: Instant; precision: 'year' | 'month' | 'day' }): Instant {
  const c = gregorian.toCivil(d.t);
  if (d.precision === 'day') return add(d.t, 1);
  if (d.precision === 'month') return gregorian.fromCivil({ year: c.month === 12 ? c.year + 1 : c.year, month: c.month === 12 ? 1 : c.month + 1, day: 1 });
  return gregorian.fromCivil({ year: c.year + 1 });
}

const FROM_KEYS = ['from', 'start', 'begin', 'start_date', 'startdate', 'date_start', 'valid_from', 'validfrom', 'year_start', 'start_year', 'gwsdate', 'gwsyear', 'cowsdate', 'cowsyear', 'since', 'founded'];
const TO_KEYS = ['to', 'end', 'until', 'end_date', 'enddate', 'date_end', 'valid_to', 'validto', 'year_end', 'end_year', 'gwedate', 'gweyear', 'cowedate', 'coweyear', 'dissolved'];

/**
 * The properties that most likely hold each shape's first and last dates: one of the usual names whose values are
 * dates for most shapes (case ignored). Nulls when the file does not date its shapes.
 */
export function guessDateKeys(file: ImportedFile): { from: string | null; to: string | null } {
  // (An end may be open for most shapes: countries still there. It counts, as long as some end is a date.)
  const dated = (k: string, open: boolean) => {
    let ok = 0, real = 0;
    for (const f of file.features) { const d = dateOfValue(f.props[k]); if (d) { ok++; real++; } else if (d === null && open) ok++; }
    return real ? ok : 0;
  };
  const pick = (names: string[], open: boolean) => {
    for (const n of names) {
      const k = file.keys.find((x) => x.toLowerCase() === n);
      if (k && dated(k, open) >= file.features.length * 0.6) return k;
    }
    return null;
  };
  const from = pick(FROM_KEYS, false);
  return { from, to: from ? pick(TO_KEYS, true) : null };
}

/**
 * The dated shapes of a file: each feature a shape of the country its name says, from its first date to its last
 * (both included). A feature without a first date is there from the beginning; without a last, to the end.
 * Features without a name, or with dates that are not dates, are left out (counted).
 */
export function datedShapesOf(file: ImportedFile, nameKey: string, fromKey: string, toKey: string | null, colorKey?: string | null): { shapes: DatedShape[]; unnamed: number; undated: number } {
  const shapes: DatedShape[] = [];
  let unnamed = 0, undated = 0;
  for (const f of file.features) {
    const raw = f.props[nameKey];
    const name = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (!name) { unnamed++; continue; }
    const a = dateOfValue(f.props[fromKey]), b = toKey ? dateOfValue(f.props[toKey]) : null;
    if (a === undefined || b === undefined) { undated++; continue; }
    const from = a ? a.t : NEG_INF, to = b ? afterDate(b) : POS_INF;
    if (compare(to, from) <= 0) { undated++; continue; }
    const shape: DatedShape = { name, polygons: f.polygons, from, to };
    const col = colorKey ? colourOf(f.props[colorKey]) : undefined;
    if (col) shape.color = col;
    shapes.push(shape);
  }
  return { shapes, unnamed, undated };
}
