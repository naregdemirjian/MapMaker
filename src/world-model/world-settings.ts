// Settings stored with each world (map_space.settings, JSON).
import type { MapSpaceRow } from './schema.ts';
import { terrainLookOf, type TerrainLook } from '../terrain/look.ts';
import { cleanSeaLevel, type SeaLevelPoint } from '../terrain/sea-level.ts';

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
 * The terrain a world has (D95): Earth's elevation for worlds showing Earth's geography; none
 * otherwise (generated planets come later).
 */
export function terrainSourceOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): 'earth' | null {
  return space && space.kind !== 'plane' && basemapSourceOf(space) === 'natural-earth' ? 'earth' : null;
}

/** How a world's terrain is drawn, or null when it shows none. */
export function terrainLook(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): TerrainLook | null {
  return space && terrainSourceOf(space) ? terrainLookOf(worldSettings(space).terrain) : null;
}

/** A world's sea level over time (D96): its points, checked and in time order (none on worlds without terrain). */
export function seaLevelPoints(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): SeaLevelPoint[] {
  return space && terrainSourceOf(space) ? cleanSeaLevel(worldSettings(space).seaLevel) : [];
}
