// Today's countries (Natural Earth, 1:50m) as data the interface can offer and the 'add countries'
// command can paint. Decoded from data/natural-earth/countries-50m.json (scripts/fetch-natural-earth.mjs).

export interface CountriesFile {
  format: string; version: string; quantum: number;
  countries: Array<{ name: string; iso2: string | null; iso3: string | null; continent: string; subregion: string; nation: boolean; of?: string; color: number; flag: string | null; polygons: number[][][] }>;
}

export interface CountryShape {
  name: string; iso2: string | null; iso3: string | null; continent: string; subregion: string;
  /** A nation (UN member or similar), as opposed to a dependency or other territory. */
  nation: boolean;
  /** For a territory: the nation it belongs to (Greenland: Denmark), as Natural Earth names it. */
  of: string | null;
  /** Natural Earth's colour group (1-9): neighbours never share one. */
  colorGroup: number;
  /** The file name of its flag in data/flags, if there is one. */
  flag: string | null;
  /** Each polygon: its outline, then its holes; points as [lon, lat]. */
  polygons: Array<Array<Array<[number, number]>>>;
}

export function decodeCountries(file: CountriesFile): CountryShape[] {
  if (file.format !== 'mapmaker-countries-1') throw new Error(`Unknown countries format "${file.format}".`);
  const q = file.quantum;
  const ring = (flat: number[]): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; out.push([Math.round(x * q * 1e7) / 1e7, Math.round(y * q * 1e7) / 1e7]); }
    return out;
  };
  return file.countries.map((c) => ({
    name: c.name, iso2: c.iso2, iso3: c.iso3, continent: c.continent, subregion: c.subregion, nation: c.nation, of: c.of ?? null,
    colorGroup: c.color, flag: c.flag, polygons: c.polygons.map((poly) => poly.map(ring)),
  }));
}

/** Nine muted colours for Natural Earth's colour groups (neighbouring countries get different ones). */
export const COUNTRY_GROUP_COLORS = ['#c8553d', '#4f9bd9', '#7bc47f', '#e0a458', '#a77dc2', '#5fb7b0', '#c9b458', '#e07a9a', '#8d9fb0'];
