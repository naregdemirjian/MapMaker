// Generated planets' heights (D97), made once for each set of settings and kept while they are in use
// (the working view and exports of the same planet share them).
import type { ElevationGrid } from './grid.ts';
import { generatePlanetAsync, planetKey, type PlanetParams } from './planet.ts';

const made = new Map<string, Promise<ElevationGrid>>();
/** How many planets' heights are kept (each is 4 MB). */
const KEEP = 3;

/** A planet's heights, made (a few rows at a time, so the interface stays responsive) unless already made. */
export function planetTerrain(params: PlanetParams, onProgress?: (done: number) => void): Promise<ElevationGrid> {
  const key = planetKey(params);
  let p = made.get(key);
  if (!p) {
    p = generatePlanetAsync(params, undefined, undefined, onProgress);
    made.set(key, p);
    p.catch(() => made.delete(key));
    while (made.size > KEEP) made.delete(made.keys().next().value!);
  } else {
    // (Most recently used last.)
    made.delete(key);
    made.set(key, p);
  }
  return p;
}
