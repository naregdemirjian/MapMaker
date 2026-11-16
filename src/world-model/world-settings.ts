// Settings stored with each world (map_space.settings, JSON).
import type { MapSpaceRow } from './schema.ts';

/** The reference geography a world shows under its territories. */
export type BasemapSource = 'natural-earth' | 'none';

export interface WorldSettings { projection?: string; basemap?: BasemapSource }

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
