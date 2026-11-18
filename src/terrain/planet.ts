// Generated planets (Stage 8, D97): a world's terrain made from a seed and a few settings, the same
// every time (so only the settings are stored; the heights are made again when the map is opened).
//
// The continents are noise over the sphere, of a size set by how many there are to be; plates (a
// handful of centres on the sphere, their edges bent by noise) raise mountain belts where they meet on
// land and ridges where they meet at sea; finer noise gives the rest its texture. The sea then covers
// the share of the surface asked for (by area), and the heights are scaled to metres. Presets set the
// character (and the colours) of a few kinds of world; a barren moon gets craters, a gas giant bands.
import type { ElevationGrid } from './grid.ts';
import type { TerrainPalette } from './look.ts';

export type PlanetPreset = 'earthlike' | 'desert' | 'ocean' | 'ice' | 'volcanic' | 'moon' | 'gas';

export interface PlanetParams {
  seed: number;
  preset: PlanetPreset;
  /** The share of the surface under the sea, 0 to 0.98. */
  sea: number;
  /** How many continents (roughly), 1 to 12. */
  continents: number;
  /** How high mountains rise, 0 to 2 (1: Earth-like). */
  mountains: number;
  /** How rough the land and the sea floor are, 0 to 1. */
  roughness: number;
  /** How far ice caps reach from the poles, 0 (none) to 1 (to the tropics). */
  ice: number;
}

export const PLANET_PRESETS: Record<PlanetPreset, { name: string; about: string; palette: TerrainPalette; relief: boolean; params: Omit<PlanetParams, 'seed' | 'preset'> }> = {
  earthlike: { name: 'Earth-like', about: 'Continents and oceans, mountains where plates meet', palette: 'natural', relief: true, params: { sea: 0.68, continents: 5, mountains: 1, roughness: 0.5, ice: 0.15 } },
  desert: { name: 'Desert', about: 'Mostly dry land with a few small seas', palette: 'desert', relief: true, params: { sea: 0.12, continents: 7, mountains: 0.8, roughness: 0.6, ice: 0 } },
  ocean: { name: 'Ocean', about: 'Almost all sea, with island chains', palette: 'natural', relief: true, params: { sea: 0.95, continents: 3, mountains: 1.2, roughness: 0.6, ice: 0.1 } },
  ice: { name: 'Ice', about: 'A frozen world: ice far from the poles', palette: 'ice', relief: true, params: { sea: 0.55, continents: 5, mountains: 0.9, roughness: 0.5, ice: 0.85 } },
  volcanic: { name: 'Volcanic', about: 'Young, high and rough, with dark seas', palette: 'volcanic', relief: true, params: { sea: 0.35, continents: 8, mountains: 1.7, roughness: 0.85, ice: 0 } },
  moon: { name: 'Barren moon', about: 'No sea, grey plains and highlands, craters', palette: 'moon', relief: true, params: { sea: 0, continents: 4, mountains: 0.5, roughness: 0.7, ice: 0 } },
  gas: { name: 'Gas giant', about: 'No surface: coloured bands of cloud', palette: 'gas', relief: false, params: { sea: 0, continents: 1, mountains: 0, roughness: 0.6, ice: 0 } },
};

/** Settings as stored, checked and completed (anything unknown takes the preset's value). */
export function planetParamsOf(raw: unknown): PlanetParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof PlanetParams, unknown>>;
  const preset = typeof r.preset === 'string' && r.preset in PLANET_PRESETS ? (r.preset as PlanetPreset) : 'earthlike';
  const d = PLANET_PRESETS[preset].params;
  const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  return {
    seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? Math.abs(Math.round(r.seed)) % 2147483647 : 1,
    preset,
    sea: num(r.sea, d.sea, 0, 0.98),
    continents: Math.round(num(r.continents, d.continents, 1, 12)),
    mountains: num(r.mountains, d.mountains, 0, 2),
    roughness: num(r.roughness, d.roughness, 0, 1),
    ice: num(r.ice, d.ice, 0, 1),
  };
}

/** A name for a planet's heights: the same settings give the same name (and the same heights). */
export const planetKey = (p: PlanetParams) => `planet:${p.preset}:${p.seed}:${p.sea}:${p.continents}:${p.mountains}:${p.roughness}:${p.ice}`;

// ---------------------------------------------------------------- noise

/** A small, fast, seeded random number generator (mulberry32): numbers in [0, 1). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD3 = new Float64Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

/** Seeded 3D simplex noise (after Stefan Gustavson's public-domain version): values in about [-1, 1]. */
export function simplex3(seed: number): (x: number, y: number, z: number) => number {
  const rnd = random(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), mod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; mod12[i] = perm[i] % 12; }
  const F3 = 1 / 3, G3 = 1 / 6;
  return (xin, yin, zin) => {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = mod12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = mod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = mod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = mod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    return 32 * n;
  };
}

// ---------------------------------------------------------------- the planet

interface Plate { x: number; y: number; z: number; push: number }

/** Grid size of generated planets: 2048 × 1024 cells (about 20 km on an Earth-sized world). */
export const PLANET_WIDTH = 2048, PLANET_HEIGHT = 1024;

/** Makes a planet's heights (a couple of seconds' work for the default size; see generatePlanetAsync). */
export function generatePlanet(params: PlanetParams, width = PLANET_WIDTH, height = PLANET_HEIGHT): ElevationGrid {
  const g = startPlanet(params, width, height);
  for (let j = 0; j < height; j++) g.row(j);
  return g.finish();
}

/** The same, a few rows at a time, letting the interface breathe in between. */
export async function generatePlanetAsync(params: PlanetParams, width = PLANET_WIDTH, height = PLANET_HEIGHT, onProgress?: (done: number) => void): Promise<ElevationGrid> {
  const g = startPlanet(params, width, height);
  for (let j = 0; j < height; j++) {
    g.row(j);
    if (j % 48 === 47) { onProgress?.(j / height); await new Promise((r) => setTimeout(r, 0)); }
  }
  return g.finish();
}

function startPlanet(params: PlanetParams, width: number, height: number): { row: (j: number) => void; finish: () => ElevationGrid } {
  const rnd = random(params.seed * 7919 + 17);
  const noise = simplex3(params.seed), warpX = simplex3(params.seed + 101), warpY = simplex3(params.seed + 202), warpZ = simplex3(params.seed + 303);
  const shape = simplex3(params.seed + 404);
  const gas = params.preset === 'gas', moon = params.preset === 'moon';
  // Plates: centres spread over the sphere; where two meet, mountains rise on land and ridges at sea.
  const count = Math.max(params.continents + 6, 10);
  const plates: Plate[] = [];
  for (let i = 0; i < count; i++) {
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
    plates.push({ x: r * Math.cos(a), y: r * Math.sin(a), z, push: rnd() });
  }
  const raw = new Float32Array(width * height);
  const fbm = (n: typeof noise, x: number, y: number, z: number, octaves: number, gain: number) => {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += amp * n(x * f, y * f, z * f); norm += amp; amp *= gain; f *= 2.03; }
    return sum / norm;
  };
  // The continents: noise of a size set by how many there are to be.
  const fc = 0.35 + 0.1 * params.continents;
  const continent = (x: number, y: number, z: number) => fbm(shape, x * fc, y * fc, z * fc, 6, 0.5);
  // Where the coast will roughly be (the continents' value at the share of sea asked for, from a sample):
  // mountains and ridges are weighed by how far inland a place is.
  const sample: number[] = [];
  for (let k = 0; k < 4096; k++) { const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z); sample.push(continent(r * Math.cos(a), r * Math.sin(a), z)); }
  sample.sort((a, b) => a - b);
  const coast = sample[Math.min(sample.length - 1, Math.floor(params.sea * sample.length))];
  const smooth = (e0: number, e1: number, v: number) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const row = (j: number) => {
    const lat = Math.PI / 2 - ((j + 0.5) / height) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * 2 * Math.PI - Math.PI;
      const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = sl;
      let v: number;
      if (gas) {
        // Bands of cloud: latitude, bent by swirling noise.
        const swirl = 0.25 * fbm(noise, x * 2.5, y * 2.5, z * 2.5, 5, 0.55);
        v = Math.sin((sl + swirl * (0.4 + params.roughness)) * 9.5) + 0.25 * fbm(noise, x * 6, y * 6, z * 12, 4, 0.5);
      } else {
        const c = continent(x, y, z);
        const inland = smooth(coast - 0.04, coast + 0.18, c);
        // The plate a place is on, its edges bent by noise; how close the next plate is.
        const w = 0.3;
        const qx = x + w * warpX(x * 1.4, y * 1.4, z * 1.4), qy = y + w * warpY(x * 1.4, y * 1.4, z * 1.4), qz = z + w * warpZ(x * 1.4, y * 1.4, z * 1.4);
        let b1 = -2, b2 = -2, p1 = 0, p2 = 0;
        for (let k = 0; k < plates.length; k++) {
          const pl = plates[k], d = qx * pl.x + qy * pl.y + qz * pl.z;
          if (d > b1) { b2 = b1; p2 = p1; b1 = d; p1 = k; } else if (d > b2) { b2 = d; p2 = k; }
        }
        const edge = (b1 - b2) / Math.max(1e-6, Math.hypot(qx, qy, qz));
        const meet = 0.35 + 0.65 * Math.abs(plates[p1].push - plates[p2].push);
        v = c;
        // Mountain belts where plates meet on land; mid-ocean ridges where they meet at sea.
        v += params.mountains * 0.3 * meet * Math.exp(-edge / 0.07) * inland;
        v += 0.05 * Math.exp(-edge / 0.015) * (1 - inland);
        // Texture: rolling noise everywhere, sharper ridges in the mountains.
        v += (0.04 + 0.1 * params.roughness) * fbm(noise, x * 4, y * 4, z * 4, 6, 0.55);
        if (inland > 0 && params.mountains > 0 && params.roughness > 0) {
          const ridged = 1 - Math.abs(fbm(noise, x * 6, y * 6, z * 6, 5, 0.5));
          v += 0.12 * params.mountains * params.roughness * ridged * ridged * inland * (0.3 + Math.exp(-edge / 0.05));
        }
      }
      raw[j * width + i] = v;
    }
  };
  const finish = (): ElevationGrid => {
    if (moon) craters(raw, width, height, random(params.seed * 31 + 7), params.roughness);
    // The sea: the level under which the share of the surface asked for lies (weighted by area), from
    // a fine histogram of the heights.
    const n = raw.length;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < n; k++) { if (raw[k] < lo) lo = raw[k]; if (raw[k] > hi) hi = raw[k]; }
    const BINS = 1 << 16, bins = new Float64Array(BINS), span = Math.max(1e-9, hi - lo);
    let total = 0;
    for (let j = 0; j < height; j++) {
      const wgt = Math.cos(Math.PI / 2 - ((j + 0.5) / height) * Math.PI);
      total += wgt * width;
      for (let i = 0, k = j * width; i < width; i++, k++) bins[Math.min(BINS - 1, Math.floor(((raw[k] - lo) / span) * BINS))] += wgt;
    }
    let level = lo - 1e-6;
    if (params.sea > 0) {
      const target = params.sea * total;
      let acc = 0;
      for (let b = 0; b < BINS; b++) { acc += bins[b]; if (acc >= target) { level = lo + ((b + 1) / BINS) * span; break; } }
    }
    const data = new Int16Array(n);
    const landTop = gas ? 6000 : 1200 + (5200 * Math.min(1.6, params.mountains)) / 1.6 + 600, seaBottom = 6500;
    for (let k = 0; k < n; k++) {
      const v = raw[k];
      let m = v > level ? landTop * Math.pow((v - level) / Math.max(1e-6, hi - level), 1.25) : -seaBottom * Math.pow((level - v) / Math.max(1e-6, level - lo), 0.8) - 1;
      // Ice caps: ice lies on the land towards the poles, a few hundred to a few thousand metres thick.
      if (params.ice > 0 && !gas) {
        const lat = Math.abs(90 - ((Math.floor(k / width) + 0.5) / height) * 180), from = 90 - params.ice * 70;
        if (lat > from && m > 0) m += 2600 * Math.min(1, (lat - from) / 12);
      }
      data[k] = Math.max(-11000, Math.min(9000, Math.round(m)));
    }
    return { width, height, step: 1, data };
  };
  return { row, finish };
}

/** Craters on a barren world: many small, a few large; a bowl with a raised rim. */
export function craters(raw: Float32Array, width: number, height: number, rnd: () => number, roughness: number): void {
  const count = Math.round(300 + 500 * roughness);
  for (let c = 0; c < count; c++) {
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
    const cx = r * Math.cos(a), cy = r * Math.sin(a);
    // Radius in radians: a power law between about 0.4° and 12°.
    const rad = (0.4 + 11.6 * Math.pow(rnd(), 4)) * (Math.PI / 180), depth = 0.15 + 0.5 * (rad / (12 * (Math.PI / 180)));
    const clat = Math.asin(z), clon = Math.atan2(cy, cx), reach = rad * 1.6;
    const j0 = Math.max(0, Math.floor(((Math.PI / 2 - (clat + reach)) / Math.PI) * height)), j1 = Math.min(height - 1, Math.ceil(((Math.PI / 2 - (clat - reach)) / Math.PI) * height));
    for (let j = j0; j <= j1; j++) {
      const lat = Math.PI / 2 - ((j + 0.5) / height) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      // Only the columns the crater can reach on this row (the whole row near a pole).
      const dlon = cl > Math.sin(reach) ? Math.asin(Math.min(1, Math.sin(reach) / cl)) : Math.PI;
      const span = Math.min(width, Math.ceil((dlon / Math.PI) * width) + 2), mid = Math.floor(((clon + Math.PI) / (2 * Math.PI)) * width);
      for (let q = -span; q <= span && q < width - span; q++) {
        const i = (((mid + q) % width) + width) % width;
        const lon = ((i + 0.5) / width) * 2 * Math.PI - Math.PI;
        const d = Math.acos(Math.max(-1, Math.min(1, cl * Math.cos(lon) * cx + cl * Math.sin(lon) * cy + sl * z)));
        if (d > reach) continue;
        const u = d / rad;
        // A bowl inside, a rim just outside, fading to nothing.
        raw[j * width + i] += u < 1 ? depth * (u * u - 1) + 0.25 * depth : 0.25 * depth * Math.exp(-(((u - 1) / 0.25) ** 2));
      }
    }
  }
}
