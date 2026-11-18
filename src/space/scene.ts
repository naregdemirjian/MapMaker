// What a space map shows at a moment (Stage 11): the nearby stars (D110), or the Sun and the planets
// where they are then (D113), with the rings and orbits that go with them.
import type { Instant } from '../core-time/index.ts';
import type { SpaceSettings } from '../world-model/world-settings.ts';
import { nearbyStarsNow, type StarCatalogue } from './catalogue.ts';
import { solarCatalogue, solarOrbits, scalePoint, SOLAR_RADIUS_AU } from './solar.ts';
import { inventedStarsCached } from './invented.ts';
import type { Vec3 } from './space-view.ts';

export interface SpaceScene {
  cat: StarCatalogue | null;
  /** How far the map reaches, in its units (light-years, or astronomical units as drawn). */
  radius: number;
  rings?: Array<{ r: number; label: string }>;
  axisLabel?: string | null;
  orbits?: Array<{ color: string; points: Vec3[] }>;
  realmReach?: number;
  /** The unit of distances in panels. */
  unit: 'ly' | 'au';
}

/** The scene of a space map at instant t (`onLoad`: called once the nearby stars have loaded). */
export function spaceScene(settings: SpaceSettings | null, t: Instant, onLoad?: () => void): SpaceScene {
  if (settings?.catalogue === 'solar') {
    const scale = settings.scale ?? 'compressed';
    const rings = [1, 5, 10, 20, 30, 40, 50].map((au) => ({ r: Math.hypot(...scalePoint([au, 0, 0], scale)), label: `${au} au` }));
    return { cat: solarCatalogue(t, scale), radius: SOLAR_RADIUS_AU, rings, axisLabel: '→ vernal equinox', orbits: solarOrbits(t, scale), realmReach: scale === 'true' ? 0.6 : 1.4, unit: 'au' };
  }
  if (settings?.catalogue === 'invented' && settings.invented) {
    // Rings every tenth of the way out (in round numbers of light-years).
    const R = settings.invented.radiusLy, step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((x) => R / x <= 6) ?? 1000;
    const rings = Array.from({ length: Math.floor(R / step + 1e-9) }, (_, i) => ({ r: step * (i + 1), label: `${step * (i + 1)} ly` }));
    return { cat: inventedStarsCached(settings.invented), radius: R, rings, axisLabel: null, unit: 'ly' };
  }
  return { cat: nearbyStarsNow(onLoad), radius: settings?.radiusLy ?? 50, unit: 'ly' };
}
