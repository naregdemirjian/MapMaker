// Planets as photographed (D191): the Sun, the planets and the Moon drawn as spheres wrapped in Solar System Scope's
// pictures of them (CC BY 4.0, data/solar-textures), lit from the Sun, Saturn with its rings. Pictures of each
// sphere are made once for each size (sizes a fifth apart) and kept; the light is laid over them as they are drawn.

/** The picture of each body by its id on a solar system map (the Sun 0, the planets 1 to 8, the Moon 31). */
export const PHOTO_TEXTURES: Readonly<Record<number, string>> = {
  0: 'data/solar-textures/2k_sun.jpg', 1: 'data/solar-textures/2k_mercury.jpg', 2: 'data/solar-textures/2k_venus_atmosphere.jpg',
  3: 'data/solar-textures/2k_earth_daymap.jpg', 4: 'data/solar-textures/2k_mars.jpg', 5: 'data/solar-textures/2k_jupiter.jpg',
  6: 'data/solar-textures/2k_saturn.jpg', 7: 'data/solar-textures/2k_uranus.jpg', 8: 'data/solar-textures/2k_neptune.jpg',
  31: 'data/solar-textures/2k_moon.jpg',
};
export const RING_TEXTURE = 'data/solar-textures/2k_saturn_ring_alpha.png';
export const PHOTO_CREDIT = 'Pictures of the planets: Solar System Scope (solarsystemscope.com), CC BY 4.0';

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/**
 * A sphere `d` pixels across wrapped in an equirectangular picture, seen from straight on, its middle at longitude
 * `lon0` (degrees): RGBA, clear outside the disc, the edge softened over a pixel.
 */
export function sphereImage(tex: Pixels, d: number, lon0 = 0): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d * d * 4), R = d / 2, W = tex.width, H = tex.height, t = tex.data;
  for (let j = 0; j < d; j++) {
    const y = (R - (j + 0.5)) / R;
    for (let i = 0; i < d; i++) {
      const x = (i + 0.5 - R) / R, rr = x * x + y * y;
      if (rr >= 1 + 2 / d) continue;
      const z = Math.sqrt(Math.max(0, 1 - rr));
      const lon = Math.atan2(x, z) + (lon0 * Math.PI) / 180, lat = Math.asin(Math.max(-1, Math.min(1, y)));
      const u = ((((lon / (2 * Math.PI) + 0.5) % 1) + 1) % 1) * W, v = (0.5 - lat / Math.PI) * H;
      const k = (Math.min(H - 1, Math.max(0, Math.floor(v))) * W + Math.min(W - 1, Math.floor(u))) * 4, o = (j * d + i) * 4;
      out[o] = t[k]; out[o + 1] = t[k + 1]; out[o + 2] = t[k + 2];
      // (Soft at the rim: a pixel's share inside the disc.)
      out[o + 3] = Math.round(255 * Math.max(0, Math.min(1, (1 - Math.sqrt(rr)) * R + 0.5)));
    }
  }
  return out;
}

/**
 * Saturn's rings seen face on, `d` pixels across: the ring picture is a strip from the inner edge (left) to the
 * outer (right), its colour and clearness; `inner` and `outer` are the rings' radii as shares of half of `d`.
 */
export function ringImage(strip: Pixels, d: number, inner = 0.56, outer = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d * d * 4), R = d / 2, W = strip.width, row = Math.floor(strip.height / 2) * W;
  for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
    const r = Math.hypot(i + 0.5 - R, j + 0.5 - R) / R;
    if (r < inner || r > outer) continue;
    const k = (row + Math.min(W - 1, Math.floor(((r - inner) / (outer - inner)) * W))) * 4, o = (j * d + i) * 4;
    out[o] = strip.data[k]; out[o + 1] = strip.data[k + 1]; out[o + 2] = strip.data[k + 2]; out[o + 3] = strip.data[k + 3];
  }
  return out;
}

/** The size a sphere's picture is made at for a disc `d` pixels across: one of sizes a fifth apart, at least 4. */
export const photoSize = (d: number) => Math.max(4, Math.round(Math.pow(1.2, Math.ceil(Math.log(Math.max(4, d)) / Math.log(1.2)))));
