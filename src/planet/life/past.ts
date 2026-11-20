// Life at the moments of a history (Stage 15.5, D167): what a picture of an earlier moment shows of its climate and
// life (climate/paleo.ts, momentPicture), coloured as seen from space as the present's are (D160): the plants after
// the star's light, the planet's own biomes where their conditions are met.
import type { LifeSpec } from '../model/definition.ts';
import { BIOME_IDS, biomeColour, customBiomeFor } from './biomes.ts';

/** What the moment stage makes of a picture (per cell): the biome, the year's mean temperature (°C), rain (mm), seasonality (0 to 255) and height (m). */
export interface Moment {
  biome: Uint8Array;
  temp: Int8Array;
  rain: Uint16Array;
  season: Uint8Array;
  height: Int16Array;
}

const SEA = BIOME_IDS.indexOf('sea'), LAKE = BIOME_IDS.indexOf('lake');

/** A moment's colours seen from space (RGB per cell). */
export function momentColours(m: Moment, life: Pick<LifeSpec, 'vegetation' | 'biomeSet' | 'customBiomes'>): Uint8Array {
  const n = m.biome.length, colour = new Uint8Array(3 * n);
  const palette = BIOME_IDS.map((b) => biomeColour(b, life));
  const rules = life.biomeSet === 'custom' ? [...life.customBiomes].sort((a, b) => a.priority - b.priority) : [];
  for (let c = 0; c < n; c++) {
    const b = m.biome[c];
    let rgb: readonly number[] = palette[b];
    if (rules.length && b !== SEA && b !== LAKE) {
      const own = customBiomeFor(m.temp[c], m.rain[c], m.season[c] / 255, m.height[c], rules);
      if (own) rgb = own.color;
    }
    colour[3 * c] = rgb[0]; colour[3 * c + 1] = rgb[1]; colour[3 * c + 2] = rgb[2];
  }
  return colour;
}
