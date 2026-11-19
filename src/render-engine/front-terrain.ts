// Fronts slowed by the land (D142): how much slower a front is at a place than on open flat land, from the
// map's heights. Mountains (rugged country, and high ground) and water to cross slow it; the front's field
// (front-field.ts) then takes it round them where that is quicker, and through them late.
import { heightAt, type ElevationGrid } from '../terrain/grid.ts';

/** Degrees each way over which the land's ruggedness is measured at the least (about 20 km on the Earth: ranges and valleys, not hillsides). */
const REACH = 0.18;

/**
 * The slowness of a place (1: open flat land) for a front that minds the land by `amount` (0 to 1), on heights
 * `grid` with the sea at `seaLevel` metres:
 *  - rugged country: how far the land rises and falls within reach of the place (the highest less the lowest
 *    of the place and four places round it, the sea bed counted as the sea), full at 900 m (up to 3 times slower
 *    at `amount` 1);
 *  - high ground: from 1,500 m, full at 4,000 m (up to 1.5 times more);
 *  - water (below the sea of the moment): 2.5 times more.
 * The reach is half the size of the cell asked about when that is longer, so that a coarse field does not miss
 * a range between its cells.
 */
export function terrainSlowness(grid: ElevationGrid, seaLevel: number, amount: number): (lon: number, lat: number, cellDeg?: number) => number {
  const a = Math.max(0, Math.min(1, amount));
  const land = (lon: number, lat: number) => Math.max(0, heightAt(grid, lon, Math.max(-89.9, Math.min(89.9, lat))) - seaLevel);
  return (lon, lat, cellDeg = 0) => {
    const h = heightAt(grid, lon, lat) - seaLevel;
    if (h < 0) return 1 + 2.5 * a;
    const reach = Math.max(REACH, cellDeg / 2), k = reach / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const e = land(lon + k, lat), w = land(lon - k, lat), n = land(lon, lat + reach), s = land(lon, lat - reach);
    const relief = Math.max(h, e, w, n, s) - Math.min(h, e, w, n, s);
    const rugged = Math.min(1, relief / (900 * (reach / REACH) ** 0.5)), high = Math.min(1, Math.max(0, (h - 1500) / 2500));
    return 1 + a * (3 * rugged + 1.5 * high);
  };
}
