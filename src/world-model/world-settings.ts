// Settings stored with each world (map_space.settings, JSON).
import type { MapSpaceRow } from './schema.ts';
import { terrainLookOf, type TerrainLook } from '../terrain/look.ts';
import { cleanSeaLevel, type SeaLevelPoint } from '../terrain/sea-level.ts';
import { planetParamsOf, type PlanetParams } from '../terrain/planet.ts';
import { definitionOf, type PlanetDefinition } from '../planet/model/definition.ts';
import { cleanStamps, type TerrainStamp } from '../terrain/sculpt.ts';
import { skyLookOf, type SkyLook } from '../space/sky-look.ts';
import { solarRowOf, type SolarRow } from '../space/solar.ts';
import { calendarOf, calendarProblems, gregorian, type Calendar, type CalendarDef } from '../core-time/index.ts';
import { cleanStatistics, type Statistic } from '../presentation/statistics.ts';
import { cityFilterOf, type CityFilter } from '../domain/places.ts';

/** The reference geography a world shows under its territories. */
export type BasemapSource = 'natural-earth' | 'none';

/** What is shown on a map (D84): each true unless set false. */
export interface ShowSet { lakes?: boolean; coastline?: boolean; rivers?: boolean; graticule?: boolean; borders?: boolean; names?: boolean; cities?: boolean; characters?: boolean; features?: boolean; fields?: boolean; terrain?: boolean }
export const SHOW_ITEMS: Array<{ key: keyof ShowSet; name: string }> = [
  { key: 'borders', name: 'Borders' },
  { key: 'names', name: 'Country names' },
  { key: 'cities', name: 'Cities' },
  { key: 'characters', name: 'Characters' },
  { key: 'features', name: 'Areas, lines and points' },
  { key: 'fields', name: 'Conditions (radiation, fire, floods, heatmaps)' },
  { key: 'lakes', name: 'Lakes' },
  { key: 'rivers', name: 'Rivers' },
  { key: 'coastline', name: 'Coastlines' },
  { key: 'graticule', name: 'Latitude and longitude lines' },
  { key: 'terrain', name: 'Terrain' },
];
/** While working, and in presentation and exports; lakes smaller than minLakeKm2 are not shown in either. */
export interface ShowSettings { working?: ShowSet; export?: ShowSet; minLakeKm2?: number; cities?: unknown }

export interface WorldSettings {
  projection?: string; basemap?: BasemapSource; show?: ShowSettings;
  /** How the world's terrain is drawn (D95); absent: no terrain. */
  terrain?: TerrainLook;
  /** The sea level at dates (D96), in time order; absent: today's, always. */
  seaLevel?: SeaLevelPoint[];
  /** A generated planet's settings (D97): its terrain is made from them whenever the map is opened. */
  planet?: PlanetParams;
  /** Strokes of the sculpting brush (D98), in the order drawn. */
  sculpt?: TerrainStamp[];
  /** The Earth through geological time (D134): its land and sea at the moment shown, from the PALEOMAP PaleoDEMs. */
  paleo?: boolean;
  /** A simulated planet (D156): its definition; its land and sea at the moment shown come from its simulated history. */
  sim?: { definition: unknown };
  /** The world's own calendar (D149); absent: the Gregorian. */
  calendar?: CalendarDef;
  /** Numbers kept over time (D171), shown in shots' texts by their names in braces. */
  statistics?: Statistic[];
  /** Where the map's one light comes from (D186), degrees (0 from the right, 90 from above): shadows and bevels that take it. */
  light?: number;
}

/** A map's statistics (D171), cleaned. */
export function statisticsOf(space: Pick<MapSpaceRow, 'settings'> | null | undefined): Statistic[] {
  return space ? cleanStatistics(worldSettings(space).statistics) : [];
}

/** Where a map's light comes from (D186): its own angle, or from the upper left (120°). */
export function mapLightOf(space: Pick<MapSpaceRow, 'settings'> | null | undefined): number {
  const v = space ? worldSettings(space).light : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? ((v % 360) + 360) % 360 : 120;
}

/** A map's own calendar (D149), if it has one that can be a calendar. */
export function calendarDefOf(space: Pick<MapSpaceRow, 'settings'> | null | undefined): CalendarDef | null {
  const d = space ? worldSettings(space).calendar : undefined;
  if (!d || typeof d !== 'object' || !Array.isArray(d.months) || !Array.isArray(d.eras)) return null;
  try { return calendarProblems(d).length ? null : d; } catch { return null; }
}

/** The calendar a map's dates are shown, typed and stepped in (D149): its own, or the Gregorian. */
export function calendarOfSpace(space: Pick<MapSpaceRow, 'settings'> | null | undefined): Calendar {
  const d = calendarDefOf(space);
  return d ? calendarOf(d) : gregorian;
}

/** Whether something is shown, while working or in exports. */
export function shown(space: Pick<MapSpaceRow, 'settings'> | null | undefined, where: 'working' | 'export', key: keyof ShowSet): boolean {
  return space ? worldSettings(space).show?.[where]?.[key] !== false : true;
}

/** The smallest lake shown (square kilometres; 0: all). */
export function minLakeKm2(space: Pick<MapSpaceRow, 'settings'> | null | undefined): number {
  const v = space ? worldSettings(space).show?.minLakeKm2 : 0;
  return typeof v === 'number' && v > 0 ? v : 0;
}

/** Which cities a map shows (D173). */
export function cityFilterOfSpace(space: Pick<MapSpaceRow, 'settings'> | null | undefined): CityFilter {
  return cityFilterOf(space ? worldSettings(space).show?.cities : undefined);
}

export const EARTH_RADIUS_KM = 6371.0088;

export function worldSettings(space: Pick<MapSpaceRow, 'settings'>): WorldSettings {
  try { return (JSON.parse(space.settings) as WorldSettings | null) ?? {}; } catch { return {}; }
}

/**
 * The basemap a world shows. New worlds store it explicitly; worlds made before the basemap existed
 * show Earth's geography when they have Earth's radius.
 */
export function basemapSourceOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m'> | null | undefined): BasemapSource {
  if (!space) return 'none';
  const b = worldSettings(space).basemap;
  if (b === 'natural-earth' || b === 'none') return b;
  return space.radius_m !== null && Math.abs(space.radius_m - EARTH_RADIUS_KM * 1000) < 1 ? 'natural-earth' : 'none';
}

/**
 * The terrain a world has: Earth's elevation for worlds showing Earth's geography (D95), its own for a
 * generated planet (D97); none otherwise.
 */
export function terrainSourceOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): 'earth' | 'planet' | 'paleo' | 'sim' | null {
  if (!space || space.kind === 'plane') return null;
  // (The Earth through geological time, D134: its land and sea at the moment shown.)
  if (worldSettings(space).paleo === true && space.kind === 'sphere') return 'paleo';
  // (A simulated planet, D156: its own history.)
  if (space.kind === 'sphere' && definitionOf(worldSettings(space).sim?.definition)) return 'sim';
  if (basemapSourceOf(space) === 'natural-earth') return 'earth';
  return planetParamsOf(worldSettings(space).planet) ? 'planet' : null;
}

/** Whether a map is the Earth through geological time (D134). */
export const isPaleoEarth = (space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): boolean => terrainSourceOf(space) === 'paleo';

/** A simulated planet's definition (D156), or null. */
export function simOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): PlanetDefinition | null {
  return space && terrainSourceOf(space) === 'sim' ? definitionOf(worldSettings(space).sim?.definition) : null;
}

/** Whether a map's time is geological time (the Earth's, D134, or a simulated planet's, D156): its land and sea change with the date. */
export const isGeologicalMap = (space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): boolean => {
  const s = terrainSourceOf(space);
  return s === 'paleo' || s === 'sim';
};

/** A generated planet's settings (D97), or null. */
export function planetOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): PlanetParams | null {
  return space && terrainSourceOf(space) === 'planet' ? planetParamsOf(worldSettings(space).planet) : null;
}

/** How a world's terrain is drawn, or null when it shows none. */
export function terrainLook(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): TerrainLook | null {
  return space && terrainSourceOf(space) ? terrainLookOf(worldSettings(space).terrain) : null;
}

/** A world's sea level over time (D96): its points, checked and in time order (none on worlds without terrain). */
export function seaLevelPoints(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): SeaLevelPoint[] {
  return space && terrainSourceOf(space) ? cleanSeaLevel(worldSettings(space).seaLevel) : [];
}

/** A world's sculpting strokes (D98), checked, in the order drawn (none on worlds without terrain). */
export function sculptOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): TerrainStamp[] {
  return space && terrainSourceOf(space) ? cleanStamps(worldSettings(space).sculpt) : [];
}

/**
 * A space map's settings (D110): which stars it shows: the nearby stars, the solar system (D113) and how
 * its distances are drawn, or stars of the user's own (D114) made from a seed.
 */
export interface SpaceSettings {
  catalogue: 'nearby' | 'solar' | 'invented' | 'galaxy'; radiusLy: number; scale?: 'true' | 'compressed';
  /** The solar system where its bodies are (with their orbits), or side by side (D133). */
  layout?: 'orbits' | 'side-by-side';
  /** How the side-by-side solar system is drawn (D192): sizes, spacing, which moons. */
  row?: SolarRow;
  /** How the map looks (D130): its stars, sky, grid and names, a flat chart (D131), its realms (D132). Always there when read with spaceSettingsOf. */
  look?: SkyLook;
  invented?: { seed: number; count: number; radiusLy: number; shape: 'sphere' | 'disc' };
  /** A galaxy map (D116): the Milky Way or one's own, its star systems and shape. */
  galaxy?: { kind: 'milkyway' | 'invented'; seed: number; systems: number; arms: number; pitch: number; radiusLy: number; bar: boolean };
}

/** Whether a map is a map of the stars (D110). */
export const isSpaceMap = (space: MapSpaceRow | null | undefined): boolean => space?.kind === 'space';

/** A space map's settings, or null for other maps. */
export function spaceSettingsOf(space: MapSpaceRow | null | undefined): SpaceSettings | null {
  if (!space || space.kind !== 'space') return null;
  const o = (worldSettings(space) as { space?: Partial<SpaceSettings> }).space ?? {};
  const look = skyLookOf(o.look);
  if (o.catalogue === 'solar') return { catalogue: 'solar', radiusLy: 50, scale: o.scale === 'true' ? 'true' : 'compressed', layout: o.layout === 'side-by-side' ? 'side-by-side' : 'orbits', row: solarRowOf(o.row), look };
  if (o.catalogue === 'invented') {
    const i = (o.invented ?? {}) as Partial<NonNullable<SpaceSettings['invented']>>;
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
    const inv = { seed: num(i.seed, 1, 1e9, 1), count: num(i.count, 2, 3000, 300), radiusLy: num(i.radiusLy, 5, 5000, 50), shape: i.shape === 'disc' ? 'disc' as const : 'sphere' as const };
    return { catalogue: 'invented', radiusLy: inv.radiusLy, invented: inv, look };
  }
  if (o.catalogue === 'galaxy') {
    const g = (o.galaxy ?? {}) as Partial<NonNullable<SpaceSettings['galaxy']>>;
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const gal = { kind: g.kind === 'invented' ? 'invented' as const : 'milkyway' as const, seed: Math.round(num(g.seed, 1, 1e9, 1)), systems: Math.round(num(g.systems, 0, 5000, 600)), arms: Math.round(num(g.arms, 1, 8, 4)), pitch: num(g.pitch, 4, 40, 14), radiusLy: Math.round(num(g.radiusLy, 1000, 500000, 50000)), bar: g.bar !== false };
    return { catalogue: 'galaxy', radiusLy: gal.kind === 'milkyway' ? 60000 : Math.round(gal.radiusLy * 1.2), galaxy: gal, look };
  }
  return { catalogue: 'nearby', radiusLy: typeof o.radiusLy === 'number' && o.radiusLy > 0 ? o.radiusLy : 50, look };
}
