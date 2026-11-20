// Today's cities and capitals (D173): Natural Earth's populated places (1:10m, data/natural-earth/places-10m.json),
// each with its country, whether it is the national or a regional capital, its population and its share of the
// country's people, its rank by size in the country and an economic importance: a world city (Natural Earth's
// mark, from the Globalization and World Cities network's ranking) 3, the country's largest city 2, among its
// three largest 1. Added to a map as cities (dated points) that remember these, so a map can show only the
// cities that matter to it: the larger shares, the capitals, the economic centres, or a list of its own.

export interface PlacesFile {
  format: string; version: string; countries: Record<string, number>;
  places: Array<[string, number, number, string, number, number, number, string]>;
}

export type CapitalKind = 'national' | 'regional' | null;

export interface TodayPlace {
  name: string; lon: number; lat: number; country: string; region: string;
  capital: CapitalKind;
  population: number;
  /** The share of its country's people living there (per cent). */
  sharePct: number;
  /** 1 for the country's largest. */
  rank: number;
  worldCity: boolean;
  /** 3 a world city, 2 the country's largest, 1 among its three largest, 0 otherwise. */
  economic: number;
}

export function decodePlaces(file: PlacesFile): TodayPlace[] {
  if (file.format !== 'mapmaker-places-1') throw new Error(`Unknown places format "${file.format}".`);
  const ranks = new Map<string, number>();
  // (The file lists places largest first.)
  const sorted = [...file.places].sort((a, b) => b[5] - a[5]);
  return sorted.map(([name, lon, lat, country, kind, population, world, region]) => {
    const rank = (ranks.get(country) ?? 0) + 1;
    ranks.set(country, rank);
    const total = file.countries[country] ?? 0;
    const worldCity = world === 1;
    return {
      name, lon, lat, country, region, population, worldCity, rank,
      capital: kind === 2 || kind === 3 ? 'national' : kind === 1 ? 'regional' : null,
      sharePct: total > 0 ? Math.min(100, (100 * population) / total) : 0,
      economic: worldCity ? 3 : rank === 1 ? 2 : rank <= 3 ? 1 : 0,
    };
  });
}

/** What a city added from today's places remembers (kept in its style as `place`). */
export interface PlaceMeta { country: string; population: number; sharePct: number; capital: CapitalKind; economic: number; rank: number }

export const placeMeta = (p: TodayPlace): PlaceMeta => ({ country: p.country, population: p.population, sharePct: Math.round(p.sharePct * 100) / 100, capital: p.capital, economic: p.economic, rank: p.rank });

export function placeMetaOf(style: string | undefined): PlaceMeta | null {
  if (!style || !style.includes('"place"')) return null;
  try {
    const m = (JSON.parse(style) as { place?: Partial<PlaceMeta> }).place;
    if (!m || typeof m.population !== 'number') return null;
    return { country: String(m.country ?? ''), population: m.population, sharePct: Number(m.sharePct) || 0, capital: m.capital === 'national' || m.capital === 'regional' ? m.capital : null, economic: Number(m.economic) || 0, rank: Number(m.rank) || 0 };
  } catch { return null; }
}

/**
 * Which cities a map shows (D173). A city is shown when its share of its country's people is at least
 * `minSharePct`, or it is a capital of the kind kept, or an economic centre of the importance kept; cities of the
 * map's own making (not from today's places) always are. With `only`, just the cities listed are shown.
 */
export interface CityFilter { minSharePct: number; capitals: 'none' | 'national' | 'all'; economic: 0 | 1 | 2 | 3; minPopulation: number; only: string[] | null }
export const DEFAULT_CITY_FILTER: CityFilter = { minSharePct: 0, capitals: 'none', economic: 0, minPopulation: 0, only: null };

export function cityFilterOf(v: unknown): CityFilter {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<CityFilter>;
  const n = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
  return {
    minSharePct: n(o.minSharePct, 0, 100, 0),
    capitals: o.capitals === 'national' || o.capitals === 'all' ? o.capitals : 'none',
    economic: ([0, 1, 2, 3] as const).includes(o.economic as 0) ? (o.economic as CityFilter['economic']) : 0,
    minPopulation: n(o.minPopulation, 0, 1e9, 0),
    only: Array.isArray(o.only) ? o.only.filter((x): x is string => typeof x === 'string') : null,
  };
}

/** Whether nothing is filtered out. */
export const filtersNothing = (f: CityFilter) => !f.only && f.minSharePct <= 0 && f.minPopulation <= 0;

export function cityShown(id: string, meta: PlaceMeta | null, f: CityFilter): boolean {
  if (f.only) return f.only.includes(id);
  if (!meta || filtersNothing(f)) return true;
  if (f.capitals === 'all' && meta.capital) return true;
  if (f.capitals === 'national' && meta.capital === 'national') return true;
  if (f.economic > 0 && meta.economic >= f.economic) return true;
  return meta.sharePct >= f.minSharePct && meta.population >= f.minPopulation;
}

/** Places to add: of these countries (null: all), passing the filter (as a map would show them). */
export function pickPlaces(places: TodayPlace[], countries: Set<string> | null, f: CityFilter): TodayPlace[] {
  return places.filter((p) => (!countries || countries.has(p.country)) && cityShown(p.name, placeMeta(p), { ...f, only: null }));
}

export const ECONOMIC_LEVELS = [
  { id: 0, name: 'None kept for being economic centres' },
  { id: 3, name: 'World cities (global economic centres)' },
  { id: 2, name: 'World cities and each country\'s largest city' },
  { id: 1, name: 'World cities and each country\'s three largest' },
] as const;
