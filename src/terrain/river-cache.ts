// A planet's rivers (D99), worked out once for each set of heights (its own, or sculpted) and kept for
// the last few: the working view gets them a moment after the heights (the map is drawn without them
// meanwhile), an export waits for them. (Rivers drawn on a map, D220, are drawn on their own: see river-course.ts.)
import type { ElevationGrid } from './grid.ts';
import { riversOf, type RiverLines } from './rivers.ts';
import type { RiverShape } from './river-course.ts';

const kept = new Map<string, RiverLines | 'working'>();
const KEEP = 4;

function keep(key: string, value: RiverLines | 'working'): void {
  kept.delete(key);
  kept.set(key, value);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value!);
}

/** The rivers of the heights named `key` if worked out; otherwise null, and `onReady` is called once they are. */
export function riversSoon(grid: ElevationGrid, key: string, onReady: () => void): RiverLines | null {
  const have = kept.get(key);
  if (have && have !== 'working') return have;
  if (!have) {
    keep(key, 'working');
    setTimeout(() => { keep(key, riversOf(grid)); onReady(); }, 0);
  }
  return null;
}

/** The rivers of the heights named `key`, worked out now if need be. */
export function riversNow(grid: ElevationGrid, key: string): RiverLines {
  const have = kept.get(key);
  if (have && have !== 'working') return have;
  const r = riversOf(grid);
  keep(key, r);
  return r;
}

/**
 * A planet's rivers with the rivers drawn on the map (D220): their courses and tributaries as lines too (for what
 * follows rivers, such as the smart brushes).
 */
export function withDrawnRivers(r: RiverLines | null, drawn: readonly RiverShape[]): RiverLines | null {
  if (!drawn.length) return r;
  const lines: number[][][] = [], ranks: number[] = [];
  for (const d of drawn) {
    lines.push(d.course.map(([x, y]) => [x, y]));
    ranks.push(3);
    for (const b of d.branches) { lines.push(b.line.map(([x, y]) => [x, y])); ranks.push(6); }
  }
  return { lines: { type: 'MultiLineString', coordinates: [...(r?.lines.coordinates ?? []), ...lines] }, ranks: [...(r?.ranks ?? []), ...ranks] };
}
