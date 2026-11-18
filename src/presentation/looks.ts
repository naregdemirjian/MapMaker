// Looks for shots (Stage 10, D108): the colours of the sea, the land, the coast and the borders, a
// colour grade over the map, a darkening toward the frame's edges and the grain of paper. A look is
// chosen per shot (with its colours changed if wanted) and applies to its preview and its exports;
// the world-building view keeps its own colours.
import type { MapStyle } from '../render-engine/map-renderer.ts';
import type { BasemapStyle } from '../render-engine/basemap.ts';

export type LookId = 'classic' | 'parchment' | 'atlas' | 'night' | 'blueprint' | 'minimal' | 'wartime';
export type GradeId = 'none' | 'sepia' | 'faded' | 'vivid' | 'cool' | 'warm' | 'mono';

/** The colour grades: CSS filters laid over the map (never over the texts). */
export const GRADES: Record<GradeId, { name: string; filter: string }> = {
  none: { name: 'None', filter: '' },
  sepia: { name: 'Sepia (old paper)', filter: 'sepia(0.45) saturate(0.85)' },
  faded: { name: 'Faded', filter: 'saturate(0.6) contrast(0.92) brightness(1.04)' },
  vivid: { name: 'Vivid', filter: 'saturate(1.35) contrast(1.06)' },
  cool: { name: 'Cool', filter: 'hue-rotate(-8deg) saturate(0.9) brightness(0.97)' },
  warm: { name: 'Warm', filter: 'sepia(0.18) saturate(1.1) hue-rotate(-4deg)' },
  mono: { name: 'Black and white', filter: 'grayscale(1) contrast(1.05)' },
};

/** A look: the colours it gives the map and its finish. */
export interface Look {
  ocean: string; land: string; coast: string; lake: string; graticule: string;
  border: string; borderWidth: number;
  grade: GradeId;
  /** How dark the frame's edges become (0 to 1). */
  vignette: number;
  /** How strong the grain of paper is (0 to 1); `blotches`: soft stains of old paper too. */
  grain: number; blotches: boolean;
}

export const LOOKS: Record<LookId, { name: string; about: string; look: Look }> = {
  classic: {
    name: 'Classic', about: 'Dark sea, the colours as you drew them',
    look: { ocean: '#14324a', land: '#38443a', coast: 'rgba(176, 204, 214, 0.55)', lake: '#14324a', graticule: 'rgba(255,255,255,0.08)', border: '#101820', borderWidth: 1.3, grade: 'none', vignette: 0, grain: 0, blotches: false },
  },
  parchment: {
    name: 'Parchment', about: 'An old map on paper: pale sea, tan land, brown ink, stained edges',
    look: { ocean: '#c9c3a4', land: '#e6d6ad', coast: 'rgba(92, 64, 36, 0.75)', lake: '#c9c3a4', graticule: 'rgba(92,64,36,0.16)', border: '#3e2a17', borderWidth: 1.5, grade: 'sepia', vignette: 0.55, grain: 0.55, blotches: true },
  },
  atlas: {
    name: 'Atlas', about: 'A light school atlas: blue sea, pale land, grey borders',
    look: { ocean: '#a8cbe0', land: '#f2eee4', coast: 'rgba(56, 96, 130, 0.65)', lake: '#a8cbe0', graticule: 'rgba(40,70,110,0.14)', border: '#4b4b4b', borderWidth: 1.2, grade: 'none', vignette: 0, grain: 0, blotches: false },
  },
  night: {
    name: 'Night', about: 'Near black, borders glowing pale blue',
    look: { ocean: '#04070c', land: '#121820', coast: 'rgba(110, 160, 220, 0.5)', lake: '#04070c', graticule: 'rgba(120,170,255,0.07)', border: '#a9c8ff', borderWidth: 1.2, grade: 'cool', vignette: 0.45, grain: 0, blotches: false },
  },
  blueprint: {
    name: 'Blueprint', about: 'White lines on deep blue',
    look: { ocean: '#0e3a64', land: '#124878', coast: 'rgba(225, 238, 255, 0.85)', lake: '#0e3a64', graticule: 'rgba(255,255,255,0.16)', border: '#eef5ff', borderWidth: 1.3, grade: 'faded', vignette: 0.25, grain: 0.15, blotches: false },
  },
  minimal: {
    name: 'Minimal', about: 'Quiet greys, white borders',
    look: { ocean: '#e7ebee', land: '#d3d8dc', coast: 'rgba(80, 92, 104, 0.4)', lake: '#e7ebee', graticule: 'rgba(0,0,0,0.05)', border: '#ffffff', borderWidth: 1.1, grade: 'none', vignette: 0, grain: 0, blotches: false },
  },
  wartime: {
    name: 'Wartime map', about: 'A printed campaign map: grey-blue sea, buff land, black borders, a little worn',
    look: { ocean: '#7f99a8', land: '#d8cdb0', coast: 'rgba(40, 46, 52, 0.7)', lake: '#7f99a8', graticule: 'rgba(30,30,30,0.12)', border: '#1f1f1f', borderWidth: 1.4, grade: 'faded', vignette: 0.3, grain: 0.35, blotches: false },
  },
};

export const LOOK_IDS = Object.keys(LOOKS) as LookId[];

/** A shot's look as stored: which one, and anything changed from it. Absent: classic, as before. */
export interface ShotLook extends Partial<Look> { id: LookId }

const isColour = (v: unknown): v is string => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(v.trim());
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** The look a shot asks for: the chosen one (classic if unknown) with its own changes (those that make sense). */
export function resolveLook(stored: Partial<ShotLook> | null | undefined): Look & { id: LookId } {
  const id: LookId = stored && LOOK_IDS.includes(stored.id as LookId) ? (stored.id as LookId) : 'classic';
  const base = LOOKS[id].look, o = stored ?? {};
  return {
    id,
    ocean: isColour(o.ocean) ? o.ocean : base.ocean, land: isColour(o.land) ? o.land : base.land,
    coast: isColour(o.coast) ? o.coast : base.coast, lake: isColour(o.lake) ? o.lake : isColour(o.ocean) ? o.ocean : base.lake,
    graticule: isColour(o.graticule) ? o.graticule : base.graticule, border: isColour(o.border) ? o.border : base.border,
    borderWidth: num(o.borderWidth, 0, 20, base.borderWidth),
    grade: o.grade && o.grade in GRADES ? o.grade : base.grade,
    vignette: num(o.vignette, 0, 1, base.vignette), grain: num(o.grain, 0, 1, base.grain),
    blotches: typeof o.blotches === 'boolean' ? o.blotches : base.blotches,
  };
}

/** Whether a look changes nothing (classic as it is): the shot is then drawn exactly as before looks existed. */
export function isPlainLook(l: Look): boolean {
  const c = LOOKS.classic.look;
  return l.ocean === c.ocean && l.land === c.land && l.coast === c.coast && l.lake === c.lake && l.graticule === c.graticule && l.border === c.border
    && l.borderWidth === c.borderWidth && l.grade === 'none' && l.vignette === 0 && l.grain === 0 && !l.blotches;
}

/** The renderer's style for a look (fonts and the rest from `base`). */
export function mapStyleOf(l: Look, base: MapStyle): MapStyle {
  return { ...base, ocean: l.ocean, graticule: l.graticule, border: l.border, borderWidth: l.borderWidth };
}

/** The basemap's colours for a look (the drawing guide's colour from `base`). */
export function basemapStyleOf(l: Look, base: BasemapStyle): BasemapStyle {
  return { ...base, land: l.land, coast: l.coast, lake: l.lake };
}

/** A small random number generator (mulberry32): the same grain in every frame and every export. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The texture of paper as RGBA (a `size` square that tiles): fine grain of light and dark specks, and
 * with `blotches` soft brown stains (value noise over a coarse grid that wraps round).
 */
export function paperTexture(size: number, blotches: boolean, seed = 7): Uint8ClampedArray<ArrayBuffer> {
  const rnd = seeded(seed), out = new Uint8ClampedArray(size * size * 4);
  const cells = 6, grid = Array.from({ length: cells * cells }, () => rnd());
  const at = (i: number, j: number) => grid[((j + cells) % cells) * cells + ((i + cells) % cells)];
  const smooth = (f: number) => f * f * (3 - 2 * f);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = 4 * (y * size + x), speck = rnd();
    let r = 0, g = 0, b = 0, a = 0;
    // Fine grain: a light or a dark speck.
    if (speck < 0.5) { r = g = b = 0; a = (0.5 - speck) * 2 * 120; } else { r = g = b = 255; a = (speck - 0.5) * 2 * 90; }
    if (blotches) {
      const gx = (x / size) * cells, gy = (y / size) * cells, i = Math.floor(gx), j = Math.floor(gy), fx = smooth(gx - i), fy = smooth(gy - j);
      const v = at(i, j) * (1 - fx) * (1 - fy) + at(i + 1, j) * fx * (1 - fy) + at(i, j + 1) * (1 - fx) * fy + at(i + 1, j + 1) * fx * fy;
      // A stain where the noise is high: brown, laid over the grain.
      const stain = Math.max(0, v - 0.55) * 2.2;
      if (stain > 0) { const k = Math.min(1, stain); r = Math.round(r * (1 - k) + 110 * k); g = Math.round(g * (1 - k) + 72 * k); b = Math.round(b * (1 - k) + 30 * k); a = Math.max(a, 150 * k); }
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return out;
}

let paper: { key: string; canvas: OffscreenCanvas } | null = null;
let scratch: OffscreenCanvas | null = null;

/**
 * Finishes a frame of the map in a look (before its texts): the colour grade, then the edges
 * darkened, then the paper's grain, all where the map is (what is transparent stays so). `x, y, w, h`:
 * the frame on the canvas, in its pixels; `unit`: the frame's width / 1920.
 */
export function finishLook(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, l: Look, unit: number): void {
  if (w < 1 || h < 1) return;
  const W = Math.round(w), H = Math.round(h), X = Math.round(x), Y = Math.round(y);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const filter = GRADES[l.grade]?.filter ?? '';
  if (filter) {
    // (Drawn back through the filter from a copy: a canvas drawn onto itself through a filter is not reliable.)
    if (!scratch || scratch.width !== W || scratch.height !== H) scratch = new OffscreenCanvas(W, H);
    const sc = scratch.getContext('2d')!;
    sc.clearRect(0, 0, W, H);
    sc.drawImage(ctx.canvas as CanvasImageSource, X, Y, W, H, 0, 0, W, H);
    ctx.clearRect(X, Y, W, H);
    ctx.filter = filter;
    ctx.drawImage(scratch, X, Y);
    ctx.filter = 'none';
  }
  ctx.globalCompositeOperation = 'source-atop';
  if (l.vignette > 0) {
    const cx = X + W / 2, cy = Y + H / 2, r = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(${l.blotches ? '40,24,8' : '0,0,0'},${(0.75 * l.vignette).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(X, Y, W, H);
  }
  if (l.grain > 0 || l.blotches) {
    const key = `${l.blotches}`;
    if (!paper || paper.key !== key) {
      const size = 256, c = new OffscreenCanvas(size, size);
      c.getContext('2d')!.putImageData(new ImageData(paperTexture(size, l.blotches), size, size), 0, 0);
      paper = { key, canvas: c };
    }
    const pattern = ctx.createPattern(paper.canvas, 'repeat');
    if (pattern) {
      // (The grain keeps its size on screen: a 1920-wide frame shows it at its own size.)
      const k = Math.max(0.25, unit);
      pattern.setTransform(new DOMMatrix([k, 0, 0, k, X, Y]));
      ctx.globalAlpha = Math.min(1, 0.35 * Math.max(l.grain, l.blotches ? 0.6 : 0));
      ctx.fillStyle = pattern;
      ctx.fillRect(X, Y, W, H);
    }
  }
  ctx.restore();
}
