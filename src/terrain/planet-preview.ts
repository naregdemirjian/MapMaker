// A small picture of a generated planet (D97) for the New map dialog: its heights made at low
// resolution and coloured as the terrain shader would (palette, or its biomes in the satellite look
// (D100), and relief), on the processor.
import { generatePlanet, PLANET_PRESETS, type PlanetParams } from './planet.ts';
import { PALETTES, rampAt, slopeShade } from './look.ts';
import { biomeColours, climateOf } from './biomes.ts';

/** RGBA pixels of an equirectangular picture of the planet, `width` × `width / 2`. */
export function planetPreview(params: PlanetParams, width = 360): Uint8ClampedArray {
  const w = Math.max(16, Math.round(width)), h = Math.max(8, Math.round(w / 2));
  const g = generatePlanet(params, w, h);
  const preset = PLANET_PRESETS[params.preset], pal = PALETTES[preset.palette];
  const out = new Uint8ClampedArray(w * h * 4);
  const cover = pal.cover ? biomeColours(g, 6371, climateOf(params)) : null;
  const at = (i: number, j: number) => g.data[Math.max(0, Math.min(h - 1, j)) * w + ((i + w) % w)];
  const cell = (6371000 * Math.PI) / h;
  for (let j = 0; j < h; j++) {
    const coslat = Math.max(0.05, Math.cos(Math.PI / 2 - ((j + 0.5) / h) * Math.PI));
    for (let i = 0; i < w; i++) {
      const e = at(i, j);
      const k = j * w + i;
      let c: [number, number, number] = e > 0 ? (cover ? [cover[k * 4], cover[k * 4 + 1], cover[k * 4 + 2]] : rampAt(pal.land, e)) : rampAt(pal.sea, e);
      if (preset.relief) {
        const s = slopeShade((at(i + 1, j) - at(i - 1, j)) / (2 * cell * coslat), (at(i, j - 1) - at(i, j + 1)) / (2 * cell), 6) * (e > 0 ? 1.4 : 0.6);
        c = c.map((v) => (s < 0 ? v * (1 + Math.max(-0.85, s)) : v + (255 - v) * Math.min(0.6, s * 0.6))) as [number, number, number];
      }
      const o = (j * w + i) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }
  return out;
}
