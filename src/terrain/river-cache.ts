// A planet's rivers (D99), worked out once for each set of heights (its own, or sculpted) and kept for
// the last few: the working view gets them a moment after the heights (the map is drawn without them
// meanwhile), an export waits for them.
import { heightAt, type ElevationGrid } from './grid.ts';
import { riversOf, type RiverLines } from './rivers.ts';
import type { TerrainStamp } from './sculpt.ts';

const kept = new Map<string, RiverLines | 'working'>();
const KEEP = 4;

function keep(key: string, value: RiverLines | 'working'): void {
  kept.delete(key);
  kept.set(key, value);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value!);
}

/**
 * The rivers of the heights named `key` if worked out (with the rivers drawn on them, D169: their strokes are part of
 * the heights, so of `key`); otherwise null, and `onReady` is called once they are.
 */
export function riversSoon(grid: ElevationGrid, key: string, onReady: () => void, drawn: readonly TerrainStamp[] = []): RiverLines | null {
  const have = kept.get(key);
  if (have && have !== 'working') return have;
  if (!have) {
    keep(key, 'working');
    setTimeout(() => { keep(key, withDrawn(riversOf(grid), drawn, grid)); onReady(); }, 0);
  }
  return null;
}

/** The rivers of the heights named `key`, worked out now if need be (with the rivers drawn on them). */
export function riversNow(grid: ElevationGrid, key: string, drawn: readonly TerrainStamp[] = []): RiverLines {
  const have = kept.get(key);
  if (have && have !== 'working') return have;
  const r = withDrawn(riversOf(grid), drawn, grid);
  keep(key, r);
  return r;
}

/**
 * A river drawn (D169) is a river whatever water the map works out reaches it: its stroke from its source, to where it
 * first reaches the sea (its mouth).
 */
function withDrawn(r: RiverLines, drawn: readonly TerrainStamp[], grid: ElevationGrid): RiverLines {
  const lines: number[][][] = [];
  for (const s of drawn) {
    if (s.tool !== 'river' || s.path.length < 2) continue;
    const line: number[][] = [];
    let mouth = false;
    for (let i = 0; i + 1 < s.path.length && !mouth; i++) {
      const [a, b] = [s.path[i], s.path[i + 1]];
      const dLon = ((((b[0] - a[0]) % 360) + 540) % 360) - 180, steps = Math.max(1, Math.ceil(Math.hypot(dLon, b[1] - a[1]) / 0.1));
      for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
        const lon = a[0] + (dLon * k) / steps, lat = a[1] + ((b[1] - a[1]) * k) / steps;
        line.push([((((lon + 180) % 360) + 360) % 360) - 180, lat]);
        if (heightAt(grid, lon, lat) < 0) { mouth = true; break; }
      }
    }
    if (line.length > 1) lines.push(line);
  }
  if (!lines.length) return r;
  return { lines: { type: 'MultiLineString', coordinates: [...r.lines.coordinates, ...lines] }, ranks: [...r.ranks, ...lines.map(() => 4)] };
}
