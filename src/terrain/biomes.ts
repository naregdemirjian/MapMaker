// Biomes (Stage 8, D100): the land's cover worked out from its heights, for the satellite look of a
// generated planet (Earth's comes from Natural Earth I, recoloured to the same colours: see
// scripts/fetch-land-cover.mjs). A place's warmth comes from its latitude and height (6.5 °C cooler
// for every kilometre up); its moisture from the belts of rain and drought by latitude (wet near the
// equator and in the middle latitudes, dry around 25° and towards the poles) and from the air that
// reaches it: moist off the sea, drying as it crosses land and losing its rain on the mountains it
// climbs (deserts in the rain shadow of a range), carried by the winds of each latitude (from the
// east in the tropics and near the poles, from the west between 30° and 60°). Warmth and moisture
// give the cover: ice, tundra, northern forest, forest, grassland, steppe, desert, savanna or
// rainforest, bare rock high up, each in the colours it has from space, blended across the borders.
import type { ElevationGrid } from './grid.ts';
import { PALETTES, rampAt, type TerrainPalette } from './look.ts';
import type { PlanetParams } from './planet.ts';

/** Land-cover colours seen from space, by biome (Earth's land cover is recoloured to these too). */
export const BIOMES = {
  ice: [236, 240, 244], tundra: [120, 118, 96], boreal: [44, 66, 46], forest: [58, 86, 46], grass: [124, 132, 80],
  steppe: [166, 148, 106], desert: [214, 182, 128], savanna: [150, 138, 80], rainforest: [32, 64, 30], rock: [118, 106, 96],
} as const satisfies Record<string, readonly [number, number, number]>;
export type Biome = keyof typeof BIOMES;

/**
 * A world's climate: how much warmer or colder than the Earth (°C), how wet (1 as the Earth), from
 * which latitude its ice caps cover the land (90: none), or, for a world without life, the palette its
 * bare ground takes instead.
 */
export interface Climate { warmth: number; wetness: number; iceFrom: number; barren: TerrainPalette | null }
export const EARTH_CLIMATE: Climate = { warmth: 0, wetness: 1, iceFrom: 90, barren: null };

/** A generated planet's climate, from its preset and its ice caps (as the generator lays them). */
export function climateOf(p: PlanetParams): Climate {
  const iceFrom = p.ice > 0 ? 90 - p.ice * 70 : 90;
  switch (p.preset) {
    case 'desert': return { warmth: 6, wetness: 0.3, iceFrom, barren: null };
    case 'ice': return { warmth: -24, wetness: 0.8, iceFrom, barren: null };
    case 'volcanic': return { warmth: 0, wetness: 0, iceFrom, barren: 'volcanic' };
    case 'moon': return { warmth: 0, wetness: 0, iceFrom, barren: 'moon' };
    case 'gas': return { warmth: 0, wetness: 0, iceFrom: 90, barren: 'gas' };
    default: return { warmth: 0, wetness: 1, iceFrom, barren: null };
  }
}

/** The biome of a place from its warmth (°C, a year's mean) and moisture (0 dry to 1 wet). */
export function biomeOf(warmth: number, moisture: number): Biome {
  if (warmth < -17) return 'ice';
  if (warmth < -6) return 'tundra';
  if (warmth < 4) return moisture > 0.25 ? 'boreal' : 'tundra';
  if (warmth < 18) return moisture > 0.45 ? 'forest' : moisture > 0.28 ? 'grass' : moisture > 0.17 ? 'steppe' : 'desert';
  return moisture > 0.72 ? 'rainforest' : moisture > 0.52 ? 'forest' : moisture > 0.36 ? 'savanna' : moisture > 0.2 ? 'steppe' : 'desert';
}

/** Warmth (°C, a year's mean) at a latitude and height: 28 at the equator, about 1 at 60°, -20 at 80°. */
export const warmthAt = (latDeg: number, metres: number) => 28 - 0.0075 * latDeg * latDeg - 0.0065 * Math.max(0, metres);

const BELT: Array<[number, number]> = [[0, 1], [10, 0.9], [18, 0.55], [23, 0.38], [30, 0.5], [36, 0.68], [42, 0.8], [55, 0.85], [65, 0.6], [80, 0.35], [90, 0.3]];
/** How wet the belt of a latitude is, before the air that reaches a place: 1 wet, 0 dry. */
export function rainBelt(latDeg: number): number {
  const a = Math.min(90, Math.abs(latDeg));
  for (let i = 1; i < BELT.length; i++) {
    if (a <= BELT[i][0]) {
      const [a0, v0] = BELT[i - 1], [a1, v1] = BELT[i], t = (a - a0) / (a1 - a0);
      return v0 + (v1 - v0) * (t * t * (3 - 2 * t));
    }
  }
  return BELT[BELT.length - 1][1];
}

/** How far every cell is from the sea (km; 0 at sea), measured across the cells and their diagonals. */
export function seaDistance(grid: ElevationGrid, radiusKm: number): Float32Array {
  const { width: W, height: H, data, step } = grid, n = W * H;
  const dist = new Float32Array(n);
  for (let k = 0; k < n; k++) dist[k] = data[k] * step <= 0 ? 0 : Infinity;
  const ns = (Math.PI * radiusKm) / H;
  const ewOf = (j: number) => ((2 * Math.PI * radiusKm) / W) * Math.max(0.02, Math.sin(((j + 0.5) / H) * Math.PI));
  // Down the rows, then up them; each row along both ways, twice round (the row joins up at 180°).
  for (const down of [true, false]) {
    for (let r = 0; r < H; r++) {
      const j = down ? r : H - 1 - r, from = down ? j - 1 : j + 1, ew = ewOf(j), diag = Math.hypot(ew, ns);
      if (from >= 0 && from < H) {
        for (let i = 0; i < W; i++) {
          const k = j * W + i, f = from * W;
          const d = Math.min(dist[f + i] + ns, dist[f + ((i + W - 1) % W)] + diag, dist[f + ((i + 1) % W)] + diag);
          if (d < dist[k]) dist[k] = d;
        }
      }
      for (let t = 1; t < 2 * W; t++) {
        const i = t % W, k = j * W + i, d = dist[j * W + ((i + W - 1) % W)] + ew;
        if (d < dist[k]) dist[k] = d;
      }
      for (let t = 1; t < 2 * W; t++) {
        const i = W - 1 - (t % W), k = j * W + i, d = dist[j * W + ((i + 1) % W)] + ew;
        if (d < dist[k]) dist[k] = d;
      }
    }
  }
  return dist;
}

/**
 * How moist the air reaching every cell is (0 to 1). Air from the sea is moist; over land it dries
 * with the distance travelled (keeping about two thirds over 1,000 km) and loses its rain on the
 * mountains it climbs (a climb of 1,800 m keeps about a third); crossing a sea it takes up water
 * again, over some hundreds of kilometres. It is followed along each row from the west and from the
 * east, and weighed by the winds of the latitude: from the east in the tropics and near the poles,
 * from the west between 30° and 60° (with some from the east there too, as the monsoons bring).
 * Near any coast the air stays fairly moist whichever way the wind blows (sea breezes).
 */
export function airMoisture(grid: ElevationGrid, radiusKm: number): Float32Array {
  const { width: W, height: H, data, step } = grid, n = W * H;
  const air = new Float32Array(n), dist = seaDistance(grid, radiusKm);
  const fromW = new Float32Array(W), fromE = new Float32Array(W);
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180, a = Math.abs(lat);
    const cellKm = ((2 * Math.PI * radiusKm) / W) * Math.max(0.02, Math.cos((lat * Math.PI) / 180));
    const dry = Math.exp(-cellKm / 3500), wet = 1 - Math.exp(-cellKm / 700);
    for (const [out, east] of [[fromW, false], [fromE, true]] as const) {
      // Twice along the row: the air reaching the first cells has crossed the far end of the row.
      let m = 1, prev = 0;
      for (let t = 0; t < 2 * W; t++) {
        const i = east ? W - 1 - (t % W) : t % W, e = data[j * W + i] * step;
        if (e <= 0) { m += (1 - m) * wet; prev = 0; } else { m *= dry * Math.exp(-Math.max(0, e - prev) / 1800); prev = e; }
        if (t >= W) out[i] = m;
      }
    }
    // The winds' weights: from the east in the tropics (the sea off a west coast there gives little
    // rain: its air sinks), from the west in the middle latitudes, from the east again near the poles.
    const ramp = (x: number, a0: number, a1: number) => Math.min(1, Math.max(0, (x - a0) / (a1 - a0)));
    const wWest = 0.2 + 0.8 * ramp(a, 32, 40) - 0.5 * ramp(a, 60, 70);
    const wEast = 1 - 0.4 * ramp(a, 35, 42) + 0.4 * ramp(a, 58, 66);
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      air[k] = data[k] * step <= 0 ? 1 : Math.max(wWest * fromW[i], wEast * fromE[i], 0.8 * Math.exp(-dist[k] / 350));
    }
  }
  return air;
}

/** Rain from rising air near the equator, whatever air reaches it (0 to 1). */
export const equatorRain = (latDeg: number) => 0.6 * Math.exp(-((latDeg / 8) ** 2));

/**
 * The colour of every cell (RGBA, opaque), laid like the grid, in a world's climate: its land cover,
 * and under the sea the cover it would have as low land (shown where the sea falls). `radiusKm` is
 * the world's.
 */
export function biomeColours(grid: ElevationGrid, radiusKm: number, climate: Climate = EARTH_CLIMATE): Uint8Array {
  const { width: W, height: H, data, step } = grid, n = W * H;
  const out = new Uint8Array(n * 4);
  if (climate.barren) {
    const ramp = PALETTES[climate.barren].land;
    for (let k = 0; k < n; k++) {
      const c = rampAt(ramp, Math.max(0, data[k] * step));
      out[k * 4] = c[0]; out[k * 4 + 1] = c[1]; out[k * 4 + 2] = c[2]; out[k * 4 + 3] = 255;
    }
    return out;
  }
  const air = airMoisture(grid, radiusKm);
  // The ice caps' edges wander a few degrees either side of their latitude (not along a parallel).
  const edge = (i: number, south: boolean) => {
    const l = ((i + 0.5) / W) * 2 * Math.PI + (south ? 2.4 : 0);
    return climate.iceFrom + 2.5 * (Math.sin(3 * l + 1.3) + 0.6 * Math.sin(7 * l + 0.4) + 0.3 * Math.sin(17 * l + 2.1));
  };
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180, belt = rainBelt(lat) * climate.wetness;
    for (let i = 0; i < W; i++) {
      const icy = climate.iceFrom < 90 && Math.abs(lat) >= edge(i, lat < 0);
      const k = j * W + i, e = data[k] * step;
      const rain = equatorRain(lat) * climate.wetness;
      const moisture = Math.min(1, rain + (1 - rain) * belt * (0.3 + 0.7 * air[k]));
      const warmth = warmthAt(lat, e) + climate.warmth;
      let c: readonly number[] = icy && e > 0 ? BIOMES.ice : BIOMES[biomeOf(warmth, moisture)];
      // Bare rock above the trees on high ground (snow comes from the warmth: ice).
      if (e > 2800 && c !== BIOMES.ice) { const t = Math.min(1, (e - 2800) / 1500); c = c.map((v, q) => v + (BIOMES.rock[q] - v) * t); }
      out[k * 4] = c[0]; out[k * 4 + 1] = c[1]; out[k * 4 + 2] = c[2]; out[k * 4 + 3] = 255;
    }
  }
  // Borders between biomes blended: two passes of averaging with the four neighbours.
  const tmp = new Uint8Array(out.length);
  for (let pass = 0; pass < 2; pass++) {
    tmp.set(out);
    for (let j = 0; j < H; j++) {
      const up = j > 0 ? -W : 0, down = j < H - 1 ? W : 0;
      for (let i = 0; i < W; i++) {
        const k = j * W + i, l = j * W + ((i + W - 1) % W), r = j * W + ((i + 1) % W);
        for (let q = 0; q < 3; q++) out[k * 4 + q] = (tmp[k * 4 + q] * 4 + tmp[l * 4 + q] + tmp[r * 4 + q] + tmp[(k + up) * 4 + q] + tmp[(k + down) * 4 + q] + 4) >> 3;
      }
    }
  }
  return out;
}
