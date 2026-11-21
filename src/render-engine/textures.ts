// Tiles for countries' patterns and textures (D182): stripes, dots, grids, waves… in a colour, and paper, parchment,
// canvas, grain, brushed metal and stone in greys, made here once (the same every time) and repeated over a country.
// Textures are greys around the middle so that, multiplied or overlaid on a colour, they shade it without changing it.
import type { PatternKind, TextureKind } from './country-look.ts';

/** A small random number generator (the same numbers for the same seed). */
function seeded(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

/** Smooth value noise of a tile that repeats: `cells` cells across, values 0 to 1. */
function tileNoise(size: number, cells: number, rnd: () => number): Float32Array {
  const grid = Array.from({ length: cells * cells }, () => rnd());
  const at = (i: number, j: number) => grid[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
  const out = new Float32Array(size * size);
  const s = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells, i = Math.floor(fx), j = Math.floor(fy), u = s(fx - i), v = s(fy - j);
    out[y * size + x] = (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  }
  return out;
}

/** A texture's greys (0 to 1, about 0.5 on average) on a repeating tile `size` pixels across. */
export function textureValues(kind: TextureKind, size = 256): Float32Array {
  const rnd = seeded({ paper: 11, parchment: 23, canvas: 37, grain: 41, metal: 53, stone: 67 }[kind]);
  const out = new Float32Array(size * size);
  const n = (cells: number) => tileNoise(size, cells, rnd);
  if (kind === 'grain') for (let i = 0; i < out.length; i++) out[i] = 0.5 + (rnd() - 0.5) * 0.5;
  else if (kind === 'paper') {
    const a = n(32), b = n(8);
    for (let i = 0; i < out.length; i++) out[i] = 0.5 + (a[i] - 0.5) * 0.25 + (b[i] - 0.5) * 0.15 + (rnd() - 0.5) * 0.12;
  } else if (kind === 'parchment') {
    const a = n(4), b = n(16), c = n(64);
    for (let i = 0; i < out.length; i++) out[i] = 0.5 + (a[i] - 0.5) * 0.45 + (b[i] - 0.5) * 0.2 + (c[i] - 0.5) * 0.1 + (rnd() - 0.5) * 0.06;
  } else if (kind === 'stone') {
    const a = n(8), b = n(32);
    for (let i = 0; i < out.length; i++) { const v = a[i] * 0.6 + b[i] * 0.4; out[i] = 0.5 + (Math.abs(v - 0.5) < 0.03 ? -0.25 : (v - 0.5) * 0.4) + (rnd() - 0.5) * 0.1; }
  } else if (kind === 'metal') {
    // Streaks along the tile: each row its own brightness, softened along it.
    const rows = Array.from({ length: size }, () => rnd());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = 0.5 + (rows[y] - 0.5) * 0.35 + (rnd() - 0.5) * 0.08;
  } else {
    // Canvas: a weave of threads over and under.
    const t = 8;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const over = ((Math.floor(x / t) + Math.floor(y / t)) & 1) === 0;
      const along = over ? Math.sin(((x % t) / t) * Math.PI) : Math.sin(((y % t) / t) * Math.PI);
      out[y * size + x] = 0.38 + along * 0.24 + (rnd() - 0.5) * 0.08;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(1, out[i]));
  return out;
}

const textureTiles = new Map<TextureKind, OffscreenCanvas>();
/** A texture's tile, made once. */
export function textureTile(kind: TextureKind): OffscreenCanvas {
  let c = textureTiles.get(kind);
  if (c) return c;
  const size = 256, v = textureValues(kind, size);
  c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d')!, img = g.createImageData(size, size);
  for (let i = 0; i < v.length; i++) { const k = Math.round(v[i] * 255); img.data.set([k, k, k, 255], i * 4); }
  g.putImageData(img, 0, 0);
  textureTiles.set(kind, c);
  return c;
}

const patternTiles = new Map<string, OffscreenCanvas>();
/** A pattern's tile in a colour, `size` pixels across (made once for each). */
export function patternTile(kind: PatternKind, color: string, size: number): OffscreenCanvas {
  size = Math.max(4, Math.round(size));
  const key = `${kind}|${color}|${size}`;
  let c = patternTiles.get(key);
  if (c) return c;
  c = new OffscreenCanvas(size, size);
  const t = c.getContext('2d')!;
  t.fillStyle = color; t.strokeStyle = color;
  const w = Math.max(1, size * 0.18);
  t.lineWidth = w;
  const line = (x0: number, y0: number, x1: number, y1: number) => { t.beginPath(); t.moveTo(x0, y0); t.lineTo(x1, y1); t.stroke(); };
  if (kind === 'dots') { t.beginPath(); t.arc(size / 2, size / 2, size * 0.2, 0, Math.PI * 2); t.fill(); }
  else if (kind === 'checks') { t.fillRect(0, 0, size / 2, size / 2); t.fillRect(size / 2, size / 2, size / 2, size / 2); }
  else if (kind === 'grid') { line(size / 2, 0, size / 2, size); line(0, size / 2, size, size / 2); }
  else if (kind === 'lines') line(0, size / 2, size, size / 2);
  else if (kind === 'waves') {
    t.beginPath();
    for (let x = 0; x <= size; x++) { const y = size / 2 + Math.sin((x / size) * Math.PI * 2) * size * 0.22; if (x) t.lineTo(x, y); else t.moveTo(x, y); }
    t.stroke();
  } else {
    // Stripes (and crossed) at 45° across the tile and its corners, so tiles join without seams.
    for (const d of [-size, 0, size]) line(d, size, d + size, 0);
    if (kind === 'cross') for (const d of [-size, 0, size]) line(d, 0, d + size, size);
  }
  if (patternTiles.size > 200) patternTiles.clear();
  patternTiles.set(key, c);
  return c;
}
