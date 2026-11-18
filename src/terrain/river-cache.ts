// A planet's rivers (D99), worked out once for each set of heights (its own, or sculpted) and kept for
// the last few: the working view gets them a moment after the heights (the map is drawn without them
// meanwhile), an export waits for them.
import type { ElevationGrid } from './grid.ts';
import { riversOf, type RiverLines } from './rivers.ts';

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
