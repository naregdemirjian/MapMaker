// Sculpted heights (D98), kept for the last few sets of strokes applied to a map's heights (the working
// view and exports share them; scrubbing the timeline back and forth across a dated stroke reuses them).
import type { ElevationGrid } from './grid.ts';
import { applyStamps, changesHeights, stampsKey, type Sculpted, type TerrainStamp } from './sculpt.ts';

const kept = new Map<string, Sculpted>();
const KEEP = 4;

/** The heights with the strokes applied (the heights themselves when there are none), and their name. */
export function sculpted(grid: ElevationGrid, key: string, all: readonly TerrainStamp[], radiusKm: number): Sculpted & { key: string } {
  // (Painted biomes change no heights: they are left out, so painting does not make the heights or rivers again, D169.)
  const stamps = all.filter(changesHeights);
  const k = stampsKey(key, stamps);
  if (!stamps.length) return { grid, touched: null, rivers: [], key: k };
  let s = kept.get(k);
  if (s) { kept.delete(k); kept.set(k, s); return { ...s, key: k }; }
  s = applyStamps(grid, stamps, radiusKm);
  kept.set(k, s);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value!);
  return { ...s, key: k };
}
