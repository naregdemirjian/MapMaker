// Sea level over time (Stage 8, D96): a world's sea can stand higher or lower than today's at given
// dates, and rises or falls steadily between them. The coasts follow it (the terrain decides what is
// land), and so does territory that ends at the coast.
import type { Instant } from '../core-time/index.ts';

/** The sea level at a date: metres above (or below) today's. */
export interface SeaLevelPoint { day: number; ms: number; m: number }

export const SEA_LEVEL_MIN = -11000, SEA_LEVEL_MAX = 9000;
const DAY_MS = 86_400_000;

/** Points as stored, checked and in time order (one per instant: the last given wins). */
export function cleanSeaLevel(raw: unknown): SeaLevelPoint[] {
  if (!Array.isArray(raw)) return [];
  const byTime = new Map<string, SeaLevelPoint>();
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const { day, ms, m } = p as Partial<SeaLevelPoint>;
    if (typeof day !== 'number' || !Number.isFinite(day) || typeof m !== 'number' || !Number.isFinite(m)) continue;
    const t = typeof ms === 'number' && Number.isFinite(ms) ? Math.min(DAY_MS - 1, Math.max(0, Math.round(ms))) : 0;
    byTime.set(`${Math.round(day)}:${t}`, { day: Math.round(day), ms: t, m: Math.min(SEA_LEVEL_MAX, Math.max(SEA_LEVEL_MIN, m)) });
  }
  return [...byTime.values()].sort((a, b) => a.day - b.day || a.ms - b.ms);
}

/**
 * The sea level at a moment: steady between the points, as at the first before it and as at the last
 * after it; 0 (today's) when there are none.
 */
export function seaLevelAt(points: readonly SeaLevelPoint[], t: Instant): number {
  if (!points.length) return 0;
  const first = points[0], last = points[points.length - 1];
  if (t.day === -Infinity) return first.m;
  if (t.day === Infinity) return last.m;
  const x = t.day + t.ms / DAY_MS;
  if (x <= first.day + first.ms / DAY_MS) return first.m;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], xa = a.day + a.ms / DAY_MS, xb = b.day + b.ms / DAY_MS;
    if (x <= xb) return xb > xa ? a.m + ((b.m - a.m) * (x - xa)) / (xb - xa) : b.m;
  }
  return last.m;
}

/**
 * The height above the sea a place stands at (D96), as the terrain shader works it out: the terrain's
 * height, except that where the coastline drawn (Natural Earth's) says land it is never below 0.5 m,
 * and where it says sea never above -0.5 m. At today's sea level, land is then exactly what the
 * coastline encloses; as the sea rises, land goes under from its lowest places, and as it falls the
 * sea floor comes up from its highest, the coast moving steadily either way. `onLand` null: no
 * coastline drawn (the terrain's own coast).
 */
export function heightAboveSea(metres: number, onLand: boolean | null, seaLevel: number): number {
  const h = onLand === null ? metres : onLand ? Math.max(metres, 0.5) : Math.min(metres, -0.5);
  return h - seaLevel;
}
