// Settings stored with each world (map_space.settings, JSON).
import type { MapSpaceRow } from './schema.ts';
import { terrainLookOf, type TerrainLook } from '../terrain/look.ts';
import { cleanSeaLevel, type SeaLevelPoint } from '../terrain/sea-level.ts';
import { planetParamsOf, type PlanetParams } from '../terrain/planet.ts';
import { cleanStamps, type TerrainStamp } from '../terrain/sculpt.ts';

/** The reference geography a world shows under its territories. */
export type BasemapSource = 'natural-earth' | 'none';

/** What is shown on a map (D84): each true unless set false. */
export interface ShowSet { lakes?: boolean; coastline?: boolean; graticule?: boolean; borders?: boolean; names?: boolean; cities?: boolean; characters?: boolean; features?: boolean; terrain?: boolean }
export const SHOW_ITEMS: Array<{ key: keyof ShowSet; name: string }> = [
  { key: 'borders', name: 'Borders' },
  { key: 'names', name: 'Country names' },
  { key: 'cities', name: 'Cities' },
  { key: 'characters', name: 'Characters' },
  { key: 'features', name: 'Areas, lines and points' },
  { key: 'lakes', name: 'Lakes' },
  { key: 'coastline', name: 'Coastlines' },
  { key: 'graticule', name: 'Latitude and longitude lines' },
  { key: 'terrain', name: 'Terrain' },
];
/** While working, and in presentation and exports; lakes smaller than minLakeKm2 are not shown in either. */
export interface ShowSettings { working?: ShowSet; export?: ShowSet; minLakeKm2?: number }

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
export function terrainSourceOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): 'earth' | 'planet' | null {
  if (!space || space.kind === 'plane') return null;
  if (basemapSourceOf(space) === 'natural-earth') return 'earth';
  return planetParamsOf(worldSettings(space).planet) ? 'planet' : null;
}

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
