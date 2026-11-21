// Ready-made maps of a region (D175): the Middle East today, and Armenia with its neighbours. Each is a map of the
// Earth at its finest: the Earth as photographed (Sentinel-2, about 10 m a pixel close in), heights to about 40 m
// with relief and fine ground; today's countries in light colours under clear borders; the built-up areas of
// cities (Natural Earth, 1:10m); today's cities and capitals; the view framed on the region; and a 4K shot of it,
// ready to export. Made with the same commands as by hand, so all of it can be changed afterwards.
import * as cmd from './commands.ts';
import { NEG_INF, gregorian } from '../core-time/index.ts';
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import type { CountryShape } from './countries.ts';
import { COUNTRY_GROUP_COLORS } from './countries.ts';
import type { PickRegion } from './regions.ts';
import { pickPlaces, type CityFilter, type TodayPlace } from './places.ts';
import type { Camera } from '../render-engine/camera.ts';
import { DEFAULT_TRANSITIONS } from '../presentation/sequence.ts';

export interface UrbanFile { format: string; quantum: number; bounds: { west: number; south: number; east: number; north: number }; areas: Array<{ km2: number; rings: number[][] }> }
export interface Bounds { west: number; south: number; east: number; north: number }

export interface RegionMap {
  id: string; name: string; about: string;
  /** The land the map is about: today's countries reaching into it are added, its cities and urban areas. */
  bounds: Bounds;
  camera: Camera;
  /** Which cities: the filter, and a margin around the bounds. */
  cities: CityFilter;
  fillOpacity: number; borderWidth: number;
  /** Today's provinces of these countries drawn as thin lines with their names. */
  provincesOf?: string[];
}

export const REGION_MAPS: RegionMap[] = [
  {
    id: 'middle-east', name: 'The Middle East today', about: 'From Egypt to Iran and from the Caucasus to Yemen, as photographed from space, with the terrain, today\'s borders, the built-up areas of its cities, and its capitals and largest cities. A 4K shot of it, ready to export.',
    bounds: { west: 25, south: 12, east: 63, north: 42.5 },
    camera: { lon: 43.5, lat: 28, zoom: 3.05, rotation: 0, projection: 'mercator' },
    cities: { minSharePct: 3, capitals: 'national', economic: 2, minPopulation: 250_000, only: null },
    fillOpacity: 0.14, borderWidth: 2,
  },
  {
    id: 'armenia', name: 'Armenia and its neighbours', about: 'Armenia and the borders it shares with Turkey, Azerbaijan, Georgia and Iran, as photographed from space, with the terrain, the built-up areas of the cities, Armenia\'s provinces and its cities and the neighbours\' capitals and largest cities. A 4K shot of it, ready to export.',
    bounds: { west: 40.2, south: 37.2, east: 50.6, north: 43.2 },
    camera: { lon: 45.2, lat: 40.15, zoom: 5.05, rotation: 0, projection: 'mercator' },
    cities: { minSharePct: 0.6, capitals: 'all', economic: 2, minPopulation: 20_000, only: null },
    fillOpacity: 0.16, borderWidth: 3.2,
    provincesOf: ['Armenia'],
  },
];

const inside = (b: Bounds, lon: number, lat: number, margin = 0) => lon >= b.west - margin && lon <= b.east + margin && lat >= b.south - margin && lat <= b.north + margin;

/** Today's countries with land in the bounds. */
export function countriesIn(countries: CountryShape[], b: Bounds): CountryShape[] {
  return countries.filter((c) => c.polygons.some((poly) => poly[0].some(([lon, lat]) => inside(b, lon, lat))));
}

/** The urban areas in the bounds, as rings of places. */
export function urbanIn(file: UrbanFile, b: Bounds): Array<Array<[number, number]>> {
  const q = file.quantum, out: Array<Array<[number, number]>> = [];
  for (const a of file.areas) for (const flat of a.rings) {
    const ring: Array<[number, number]> = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; ring.push([Math.round(x * q * 1e6) / 1e6, Math.round(y * q * 1e6) / 1e6]); }
    if (ring.length >= 3 && ring.some(([lon, lat]) => inside(b, lon, lat))) out.push(ring);
  }
  return out;
}

export interface RegionData { countries: CountryShape[]; places: TodayPlace[]; urban: UrbanFile; regions: PickRegion[] }

/**
 * Make a region's map in the project, command by command through `exec` (the interface saves each; a test runs
 * them). Returns the new map, its political layer and the shot.
 */
export function buildRegionMap(def: RegionMap, data: RegionData, exec: <T>(fn: (w: World, e: Engine) => cmd.CommandResult<T>) => T | undefined): { spaceId: string; layerId: string; shotId: string } | null {
  const spaceId = exec((w) => cmd.createWorld(w, def.name, 6371.0088, 'natural-earth'));
  if (!spaceId) return null;
  let layerId = '';
  exec((w) => {
    layerId = w.all('layer').find((l) => l.space_id === spaceId && l.kind === 'partition')!.id;
    return cmd.setWorldTerrain(w, spaceId, { palette: 'satellite', colours: true, relief: true, overTerritories: false, seaFloor: true, strength: 1.15, detail: true, photo: true });
  });
  exec((w) => cmd.setLayerLook(w, layerId, { fillOpacity: def.fillOpacity, borderWidth: def.borderWidth }));
  exec((w) => cmd.setLayerClipToLand(w, layerId, true));
  exec((w) => cmd.setWorldShow(w, spaceId, { minLakeKm2: 100 }));
  // Today's countries reaching into the region, in the map's colours.
  const countries = countriesIn(data.countries, def.bounds);
  exec((w, e) => cmd.addCountries(w, e, { spaceId, layerId, mode: { kind: 'correct', t: NEG_INF }, countries: countries.map((c) => ({ name: c.name, polygons: c.polygons, color: COUNTRY_GROUP_COLORS[(c.colorGroup - 1 + COUNTRY_GROUP_COLORS.length) % COUNTRY_GROUP_COLORS.length] })) }));
  // Their provinces as thin lines with names.
  if (def.provincesOf?.length) {
    const lines = exec((w) => cmd.createLayer(w, spaceId, 'Provinces', 'area'));
    if (lines) {
      exec((w) => cmd.updateLayer(w, lines, { style: JSON.stringify({ color: '#fdf6e3', fillOpacity: 0, dash: 'dotted', width: 1.4, showName: false }) }));
      for (const r of data.regions.filter((x) => def.provincesOf!.includes(x.country))) exec((w) => cmd.createFeature(w, { layerId: lines, name: r.name, parts: r.polygons.map((p) => p[0]), mode: { kind: 'correct', t: NEG_INF } }));
    }
  }
  // The built-up areas of cities, as one area of many parts.
  const urban = urbanIn(data.urban, def.bounds);
  if (urban.length) {
    const layer = exec((w) => cmd.createLayer(w, spaceId, 'Urban areas', 'area'));
    if (layer) {
      exec((w) => cmd.updateLayer(w, layer, { style: JSON.stringify({ color: '#ffcf7a', fillOpacity: 0.26, dash: 'solid', width: 0.8, showName: false }) }));
      exec((w) => cmd.createFeature(w, { layerId: layer, name: 'Built-up areas', parts: urban, mode: { kind: 'correct', t: NEG_INF } }));
    }
  }
  // Today's cities and capitals of the region.
  const names = new Set(countries.map((c) => c.name));
  const cities = pickPlaces(data.places, names, def.cities).filter((p) => inside(def.bounds, p.lon, p.lat, 0.3));
  if (cities.length) exec((w) => cmd.addCities(w, { spaceId, places: cities, mode: { kind: 'correct', t: NEG_INF } }));
  // A still shot of it in 4K, of today.
  const today = gregorian.fromCivil({ year: 2026, month: 1, day: 1 }), later = gregorian.fromCivil({ year: 2026, month: 12, day: 31 });
  const frames = 30 * 10;
  const shotId = exec((w) => cmd.createSequence(w, `${def.name} (4K)`, {
    spaceId, width: 3840, height: 2160, fps: 30, frames,
    time: [{ frame: 0, at: [today.day, today.ms], ease: 'linear' }, { frame: frames - 1, at: [later.day, later.ms], ease: 'linear' }],
    camera: [{ frame: 0, camera: def.camera, ease: 'smooth' }, { frame: frames - 1, camera: def.camera, ease: 'smooth' }],
    overlays: [], layers: [], graticule: false, labels: true, cities: true, transparent: false,
    transitions: { ...DEFAULT_TRANSITIONS, mode: 'recorded' },
  })) ?? '';
  return { spaceId, layerId, shotId };
}
