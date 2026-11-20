// Downloads Natural Earth's populated places (1:10m) and its countries' populations, and writes Map Maker's
// compact places file (data/natural-earth/places-10m.json): today's cities and capitals (D173), each with its
// country (as named in countries-50m.json), whether it is the national or a regional capital, its population
// (Natural Earth's POP_MAX, the urban area's), and whether Natural Earth counts it a world city. The converted
// file is committed, so the app and the tests never need the network.
//
//   node scripts/fetch-places.mjs [--from <ne_10m_populated_places.geojson> <ne_50m_admin_0_countries.geojson>]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v5.1.2';
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data', 'natural-earth', 'places-10m.json');
const from = process.argv.indexOf('--from');
const get = async (name, i) => JSON.parse(from > 0 ? readFileSync(process.argv[from + 1 + i], 'utf8') : await (await fetch(BASE + name)).text());
const placesGeo = await get('ne_10m_populated_places.geojson', 0);
const adminGeo = await get('ne_50m_admin_0_countries.geojson', 1);
const ours = JSON.parse(readFileSync(join(root, 'data', 'natural-earth', 'countries-50m.json'), 'utf8')).countries;

// Each Natural Earth country code to a country of countries-50m.json, and its population.
const byIso3 = new Map(ours.filter((c) => c.iso3 && c.iso3 !== '-99').map((c) => [c.iso3, c.name]));
const byName = new Map(ours.map((c) => [c.name.toLowerCase(), c.name]));
// (Named differently in the two files.)
for (const [a, b] of [['northern cyprus', 'Turkish Republic of Northern Cyprus'], ['indian ocean territories', 'Australian Indian Ocean Territories']]) byName.set(a, b);
const nameOf = new Map(), pop = {};
for (const f of adminGeo.features) {
  const p = f.properties;
  const name = byIso3.get(p.ISO_A3) ?? byIso3.get(p.ADM0_A3) ?? byName.get(String(p.ADMIN).toLowerCase()) ?? byName.get(String(p.NAME_LONG).toLowerCase()) ?? byName.get(String(p.NAME).toLowerCase());
  if (!name) { console.warn('No country for', p.ADMIN, p.ADM0_A3); continue; }
  nameOf.set(p.ADM0_A3, name);
  pop[name] = Math.max(pop[name] ?? 0, Math.round(p.POP_EST));
}
nameOf.set('SSD', nameOf.get('SDS')); // (South Sudan's places use the other code)
const KIND = { 'Admin-0 capital': 2, 'Admin-0 capital alt': 3, 'Admin-1 capital': 1, 'Admin-1 region capital': 1, 'Admin-0 region capital': 1, 'Populated place': 0, 'Populated Place': 0 };
const places = [];
let skipped = 0;
for (const f of placesGeo.features) {
  const p = f.properties;
  const kind = KIND[p.FEATURECLA];
  const country = nameOf.get(p.ADM0_A3) ?? byName.get(String(p.ADM0NAME).toLowerCase());
  if (kind === undefined || !country || !(p.POP_MAX > 0)) { skipped++; continue; }
  const [lon, lat] = f.geometry.coordinates;
  places.push([p.NAME, Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, country, kind, Math.round(p.POP_MAX), p.WORLDCITY ? 1 : 0, p.ADM1NAME ?? '']);
}
places.sort((a, b) => b[5] - a[5]);
writeFileSync(out, JSON.stringify({ format: 'mapmaker-places-1', version: VERSION, fields: ['name', 'lon', 'lat', 'country', 'kind', 'population', 'worldCity', 'region'], kinds: ['place', 'regional capital', 'national capital', 'other national capital'], countries: pop, places }));
console.log(`${places.length} places (${skipped} left out) in ${Object.keys(pop).length} countries -> ${out}`);
