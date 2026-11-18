// Territories from files (improvement B, D120): maps of borders as GeoJSON (a FeatureCollection of polygons in
// longitude and latitude, one feature per country or several), read into countries to add at a date. A series of
// files, each the map of its year (as historical border datasets come), becomes the history between them.
import type { CountryToAdd } from './commands.ts';

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
