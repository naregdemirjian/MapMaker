// How a space map looks (D130): its stars (colours, shape, size, glow, spikes, halos, twinkle), its sky
// (colour, a glow toward the middle, nebulae, far stars), its grid and names, whether it is seen in three
// dimensions or as a flat chart (D131), and how realms are drawn (D132). Kept with the map; presets to start
// from, every part adjustable.

export type StarColours = 'natural' | 'vivid' | 'pastel' | 'mono' | 'temperature' | 'owner';
export type StarShape = 'disc' | 'soft' | 'diamond' | 'sparkle4' | 'sparkle6' | 'ring' | 'square' | 'cross' | 'dot';
export type ChartGrid = 'rings' | 'squares' | 'hexes' | 'none';
export type NameFont = 'sans' | 'serif' | 'mono' | 'display';
export type RealmStyle = 'borders' | 'glow' | 'none';

export interface SkyLook {
  /** The preset it was made from (for the dialog). */
  preset: string;
  // The stars.
  colours: StarColours;
  /** The colour of 'mono' stars, and the one mixed into the others by `tintAmount`. */
  tint: string;
  tintAmount: number;
  /** 'temperature': the colour of the coolest stars and of the hottest. */
  cool: string;
  hot: string;
  size: number;
  /** How much larger brighter stars are drawn (0: all alike, 1: by their brightness). */
  sizeByBrightness: number;
  shape: StarShape;
  /** How far the glow reaches (0: none, 3: far) and how strong it is (0 to 1). */
  glow: number;
  glowStrength: number;
  /** Diffraction spikes: how many (0, 2, 4, 6 or 8), how long, turned how far (degrees). */
  spikes: number;
  spikeLength: number;
  spikeAngle: number;
  /** A thin ring round the brighter stars (0 to 1). */
  halo: number;
  /** Stars flickering in shots (0 to 1). */
  twinkle: number;
  /** An outline round each star, as on a printed chart (0: none). */
  outline: number;
  outlineColour: string;
  // The sky.
  background: string;
  /** A second colour toward the middle of the picture (null: one colour). */
  backgroundGlow: string | null;
  /** Soft clouds of colour (0 to 1), and their two colours. */
  nebula: number;
  nebulaA: string;
  nebulaB: string;
  /** The faint stars far beyond the map (0: none, 2: twice as many and as bright). */
  farStars: number;
  // The map's lines and names.
  grid: string;
  gridOpacity: number;
  names: string;
  nameFont: NameFont;
  /** Lines from each star down to the plane (in three dimensions). */
  dropLines: boolean;
  // A flat chart (D131).
  chart: boolean;
  chartGrid: ChartGrid;
  /** Light-years between the chart's lines (0: as the map's rings). */
  chartSpacing: number;
  /** How a star's height above or below the plane shows on a chart: its number, a filled or open symbol, or not at all. */
  heights: 'numbers' | 'symbols' | 'none';
  // Realms (D132).
  realms: RealmStyle;
  /** How strongly a realm's space is filled (0 to 1), how wide its border, how much it glows along it. */
  realmFill: number;
  realmBorder: number;
  realmGlow: number;
  /** The Sun, the planets and the Moon as photographed (D191): spheres wrapped in pictures of them, lit from the Sun. */
  photo: boolean;
  /** The Sun seen as a star (D217): a blazing point of light with rays, as a telescope sees it from far off, not a disc. */
  sunAsStar: boolean;
}

export const DEFAULT_SKY: SkyLook = {
  preset: 'natural',
  colours: 'natural', tint: '#9fd8ff', tintAmount: 0, cool: '#ff8a5c', hot: '#9fc4ff',
  size: 1, sizeByBrightness: 1, shape: 'disc', glow: 1, glowStrength: 0.35, spikes: 0, spikeLength: 1, spikeAngle: 0, halo: 0, twinkle: 0,
  outline: 0, outlineColour: '#10161d',
  background: '#04070d', backgroundGlow: null, nebula: 0, nebulaA: '#5b3a8f', nebulaB: '#1f5f8b', farStars: 1,
  grid: '#8cafdc', gridOpacity: 0.32, names: '#e1e8f5', nameFont: 'sans', dropLines: true,
  chart: false, chartGrid: 'rings', chartSpacing: 0, heights: 'numbers',
  realms: 'borders', realmFill: 0.22, realmBorder: 1.6, realmGlow: 0.5, photo: false, sunAsStar: false,
};

/** The kinds of looks (D217): drawn for the story (basic), as an illustrated chart, or as photographed. */
export type SkyKind = 'basic' | 'chart' | 'photo';
export const SKY_KINDS: Array<{ id: SkyKind; name: string; hint: string }> = [
  { id: 'basic', name: 'Basic', hint: 'Looks drawn to tell the story: natural colours, a telescope\'s sharp stars, deep-field nebulae, displays and themes' },
  { id: 'chart', name: 'Charts', hint: 'Flat charts as people draw and print them: atlases, paper, blueprint, parchment, chalk' },
  { id: 'photo', name: 'Photographic', hint: 'As cameras and telescopes record it: the planets as photographed, stars as points of light' },
];

/** Presets: each a whole look (the dialog starts from one, then any part can be changed), of a kind (D217). */
const PRESETS: Array<{ id: string; name: string; kind?: SkyKind; look: Partial<SkyLook> }> = [
  { id: 'natural', name: 'Natural', look: {} },
  { id: 'photographic', name: 'Photographic (planets as photographed)', kind: 'photo', look: { photo: true, shape: 'disc', size: 1.5, glow: 0.6, glowStrength: 0.22, background: '#010204', farStars: 1.2 } },
  // Photographic (D217): as cameras and telescopes record the sky.
  { id: 'photo-telescope', name: 'Through a telescope (the Sun a star)', kind: 'photo', look: { photo: true, sunAsStar: true, shape: 'disc', size: 0.7, sizeByBrightness: 1, glow: 1.1, glowStrength: 0.55, spikes: 4, spikeLength: 1.6, spikeAngle: 45, halo: 0.12, farStars: 2, background: '#000000', names: '#c9d4e3' } },
  { id: 'photo-long-exposure', name: 'Long exposure (soft, glowing)', kind: 'photo', look: { photo: true, shape: 'soft', size: 1, glow: 1.8, glowStrength: 0.6, nebula: 0.3, nebulaA: '#4a2a5a', nebulaB: '#1b3a52', farStars: 2, background: '#020306', backgroundGlow: '#0a0c14' } },
  { id: 'photo-infrared', name: 'Infrared telescope (six-pointed stars)', kind: 'photo', look: { photo: true, sunAsStar: true, tint: '#ffcf8a', tintAmount: 0.35, shape: 'disc', size: 0.8, glow: 1.2, glowStrength: 0.5, spikes: 6, spikeLength: 2, spikeAngle: 30, nebula: 0.4, nebulaA: '#7a3b1f', nebulaB: '#2b2350', farStars: 1.8, background: '#030204' } },
  { id: 'photo-naked-eye', name: 'Naked eye (as the night sky looks)', kind: 'photo', look: { photo: true, shape: 'disc', size: 0.6, sizeByBrightness: 1, glow: 0.8, glowStrength: 0.3, farStars: 1.4, background: '#05070c', backgroundGlow: '#0b1220', names: '#aab6c6' } },
  { id: 'telescope', name: 'Telescope (sharp, with spikes)', look: { shape: 'disc', size: 0.8, glow: 0.7, glowStrength: 0.45, spikes: 6, spikeLength: 1.3, spikeAngle: 30, halo: 0.25, farStars: 1.6, background: '#020308' } },
  { id: 'deep-field', name: 'Deep field (nebulae)', look: { shape: 'soft', glow: 1.6, glowStrength: 0.5, spikes: 4, spikeLength: 0.8, spikeAngle: 45, nebula: 0.75, nebulaA: '#6a2c8f', nebulaB: '#145a7a', farStars: 2, background: '#030308', backgroundGlow: '#0d0a1e' } },
  { id: 'scifi-hud', name: 'Sci-fi display', look: { colours: 'mono', tint: '#5ef2ff', shape: 'ring', size: 1.1, sizeByBrightness: 0.4, glow: 0.8, glowStrength: 0.5, halo: 0.6, background: '#020b12', backgroundGlow: '#06202c', grid: '#36e1ff', gridOpacity: 0.45, names: '#a8f6ff', nameFont: 'mono', farStars: 0.4, realmFill: 0.16, realmBorder: 2, realmGlow: 1 } },
  { id: 'neon', name: 'Neon', look: { colours: 'vivid', shape: 'sparkle4', size: 1.2, glow: 2, glowStrength: 0.7, halo: 0.3, background: '#05010d', backgroundGlow: '#170a2b', nebula: 0.35, nebulaA: '#8f1fa8', nebulaB: '#1f3fa8', grid: '#d36bff', gridOpacity: 0.35, names: '#ffd6ff', nameFont: 'display', realmGlow: 1.2 } },
  { id: 'pastel', name: 'Pastel dream', look: { colours: 'pastel', shape: 'soft', size: 1.3, glow: 2.2, glowStrength: 0.45, nebula: 0.5, nebulaA: '#ff9fd1', nebulaB: '#9fc9ff', background: '#1a1630', backgroundGlow: '#2c2550', farStars: 0.8, grid: '#c9b8ff', names: '#fff0fa', nameFont: 'serif' } },
  { id: 'ember', name: 'Ember (warm)', look: { colours: 'mono', tint: '#ffb35c', tintAmount: 0, shape: 'sparkle6', glow: 1.4, glowStrength: 0.55, spikes: 0, background: '#0d0503', backgroundGlow: '#1f0c05', nebula: 0.3, nebulaA: '#8f2a0f', nebulaB: '#5a1f0a', grid: '#ff9a5c', gridOpacity: 0.28, names: '#ffe2c4', nameFont: 'serif' } },
  { id: 'imperial', name: 'Imperial (gold)', look: { colours: 'natural', tint: '#ffd27a', tintAmount: 0.45, shape: 'diamond', size: 1.1, glow: 1, glowStrength: 0.4, halo: 0.4, background: '#07060a', backgroundGlow: '#14100a', grid: '#d8b46a', gridOpacity: 0.35, names: '#f3dca6', nameFont: 'serif', realmBorder: 2.2 } },
  { id: 'heat', name: 'Heat (by temperature)', look: { colours: 'temperature', cool: '#ff4b2b', hot: '#4bb3ff', shape: 'disc', glow: 1.2, glowStrength: 0.5 } },
  { id: 'by-realm', name: 'By realm (stars in their holders\' colours)', look: { colours: 'owner', tint: '#6c7a8c', shape: 'disc', size: 1.15, glow: 1.3, glowStrength: 0.5, realmFill: 0.12 } },
  { id: 'minimal', name: 'Minimal', look: { shape: 'dot', size: 1.4, sizeByBrightness: 0.3, glow: 0, glowStrength: 0, farStars: 0, background: '#0b0f14', grid: '#5f6b78', gridOpacity: 0.25, dropLines: false } },
  // Flat charts (D131).
  { id: 'chart-paper', name: 'Chart: paper', look: { chart: true, chartGrid: 'squares', heights: 'numbers', colours: 'mono', tint: '#1b1d22', shape: 'disc', size: 0.9, sizeByBrightness: 0.6, glow: 0, glowStrength: 0, outline: 1.2, outlineColour: '#f3ead6', farStars: 0, background: '#efe6d0', grid: '#4f6f9a', gridOpacity: 0.35, names: '#22262d', nameFont: 'serif', dropLines: false, realmFill: 0.18, realmBorder: 2, realmGlow: 0 } },
  { id: 'chart-blueprint', name: 'Chart: blueprint', look: { chart: true, chartGrid: 'squares', heights: 'symbols', colours: 'mono', tint: '#eaf4ff', shape: 'ring', size: 1, sizeByBrightness: 0.5, glow: 0, glowStrength: 0, farStars: 0, background: '#123a6b', backgroundGlow: '#1a4c86', grid: '#cfe3ff', gridOpacity: 0.3, names: '#eaf4ff', nameFont: 'mono', dropLines: false, realmFill: 0.16, realmBorder: 2, realmGlow: 0 } },
  { id: 'chart-sectors', name: 'Chart: sectors (hexes)', look: { chart: true, chartGrid: 'hexes', heights: 'none', colours: 'natural', shape: 'disc', size: 1, glow: 0.6, glowStrength: 0.35, farStars: 0.3, background: '#081019', grid: '#6f8fb5', gridOpacity: 0.4, names: '#dfe9f7', nameFont: 'display', dropLines: false, realmFill: 0.3, realmBorder: 2, realmGlow: 0.6 } },
  { id: 'chart-night', name: 'Chart: night', look: { chart: true, chartGrid: 'rings', heights: 'numbers', colours: 'natural', tintAmount: 0.2, tint: '#ffd27a', shape: 'sparkle4', glow: 0.8, glowStrength: 0.4, farStars: 0.6, background: '#0b1530', backgroundGlow: '#142249', grid: '#d8b46a', gridOpacity: 0.3, names: '#f3dca6', nameFont: 'serif', dropLines: false } },
  // More charts (D217), as star atlases and old maps of the sky are drawn.
  { id: 'chart-atlas', name: 'Chart: star atlas (black on white)', look: { chart: true, chartGrid: 'squares', heights: 'numbers', colours: 'mono', tint: '#101317', shape: 'disc', size: 1, sizeByBrightness: 1, glow: 0, glowStrength: 0, outline: 1, outlineColour: '#ffffff', farStars: 0, background: '#fbfaf6', grid: '#5a83b8', gridOpacity: 0.4, names: '#1d2430', nameFont: 'serif', dropLines: false, realmFill: 0.15, realmBorder: 2, realmGlow: 0 } },
  { id: 'chart-desk', name: 'Chart: desk atlas (white on blue)', look: { chart: true, chartGrid: 'rings', heights: 'numbers', colours: 'mono', tint: '#ffffff', shape: 'disc', size: 0.95, sizeByBrightness: 1, glow: 0.3, glowStrength: 0.2, farStars: 0, background: '#173563', grid: '#e8c96a', gridOpacity: 0.45, names: '#f2f5fa', nameFont: 'serif', dropLines: false, realmFill: 0.2, realmBorder: 2, realmGlow: 0 } },
  { id: 'chart-antique', name: 'Chart: antique (engraved, on parchment)', look: { chart: true, chartGrid: 'rings', heights: 'none', colours: 'mono', tint: '#3a2716', shape: 'sparkle6', size: 1, sizeByBrightness: 0.9, glow: 0, glowStrength: 0, outline: 0.8, outlineColour: '#efe0bb', farStars: 0, background: '#e7d5ab', backgroundGlow: '#f2e6c6', grid: '#7a5a33', gridOpacity: 0.4, names: '#3a2716', nameFont: 'serif', dropLines: false, realmFill: 0.22, realmBorder: 2.2, realmGlow: 0 } },
  { id: 'chart-navigator', name: 'Chart: navigator', look: { chart: true, chartGrid: 'rings', heights: 'symbols', colours: 'mono', tint: '#13315c', shape: 'sparkle4', size: 1, sizeByBrightness: 0.8, glow: 0, glowStrength: 0, outline: 0.8, outlineColour: '#e6eef0', farStars: 0, background: '#dbe7ea', backgroundGlow: '#eaf1f2', grid: '#2c5a8a', gridOpacity: 0.35, names: '#13315c', nameFont: 'serif', dropLines: false, realmFill: 0.16, realmBorder: 2, realmGlow: 0 } },
  { id: 'chart-chalk', name: 'Chart: chalkboard', look: { chart: true, chartGrid: 'squares', heights: 'numbers', colours: 'mono', tint: '#f1f3ee', shape: 'cross', size: 0.9, sizeByBrightness: 0.6, glow: 0.25, glowStrength: 0.15, farStars: 0, background: '#26352e', backgroundGlow: '#2e4038', grid: '#e8ece4', gridOpacity: 0.22, names: '#f1f3ee', nameFont: 'display', dropLines: false, realmFill: 0.18, realmBorder: 2, realmGlow: 0.2 } },
  { id: 'chart-ink', name: 'Chart: ink (technical)', look: { chart: true, chartGrid: 'hexes', heights: 'symbols', colours: 'mono', tint: '#111111', shape: 'ring', size: 0.9, sizeByBrightness: 0.5, glow: 0, glowStrength: 0, farStars: 0, background: '#f6f4ef', grid: '#9b9b9b', gridOpacity: 0.35, names: '#111111', nameFont: 'mono', dropLines: false, realmFill: 0.14, realmBorder: 1.6, realmGlow: 0 } },
];
export const SKY_PRESETS: Array<{ id: string; name: string; kind: SkyKind; look: Partial<SkyLook> }> = PRESETS.map((p) => ({ ...p, kind: p.kind ?? (p.look.chart ? 'chart' : 'basic') }));

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const colour = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);

/** A look as kept (any part may be missing or out of range), made whole and within bounds. */
export function skyLookOf(o: unknown): SkyLook {
  const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const d = DEFAULT_SKY;
  return {
    preset: typeof x.preset === 'string' ? x.preset : d.preset,
    colours: pick(x.colours, ['natural', 'vivid', 'pastel', 'mono', 'temperature', 'owner'] as const, d.colours),
    tint: colour(x.tint, d.tint), tintAmount: num(x.tintAmount, 0, 1, d.tintAmount),
    cool: colour(x.cool, d.cool), hot: colour(x.hot, d.hot),
    size: num(x.size, 0.2, 5, d.size), sizeByBrightness: num(x.sizeByBrightness, 0, 1, d.sizeByBrightness),
    shape: pick(x.shape, ['disc', 'soft', 'diamond', 'sparkle4', 'sparkle6', 'ring', 'square', 'cross', 'dot'] as const, d.shape),
    glow: num(x.glow, 0, 4, d.glow), glowStrength: num(x.glowStrength, 0, 1, d.glowStrength),
    spikes: [0, 2, 4, 6, 8].includes(x.spikes as number) ? (x.spikes as number) : d.spikes,
    spikeLength: num(x.spikeLength, 0.2, 4, d.spikeLength), spikeAngle: num(x.spikeAngle, -180, 180, d.spikeAngle),
    halo: num(x.halo, 0, 1, d.halo), twinkle: num(x.twinkle, 0, 1, d.twinkle),
    outline: num(x.outline, 0, 4, d.outline), outlineColour: colour(x.outlineColour, d.outlineColour),
    background: colour(x.background, d.background), backgroundGlow: x.backgroundGlow === null ? null : typeof x.backgroundGlow === 'string' ? colour(x.backgroundGlow, '#0d0a1e') : d.backgroundGlow,
    nebula: num(x.nebula, 0, 1, d.nebula), nebulaA: colour(x.nebulaA, d.nebulaA), nebulaB: colour(x.nebulaB, d.nebulaB),
    farStars: num(x.farStars, 0, 2, d.farStars),
    grid: colour(x.grid, d.grid), gridOpacity: num(x.gridOpacity, 0, 1, d.gridOpacity),
    names: colour(x.names, d.names), nameFont: pick(x.nameFont, ['sans', 'serif', 'mono', 'display'] as const, d.nameFont),
    dropLines: typeof x.dropLines === 'boolean' ? x.dropLines : d.dropLines,
    chart: x.chart === true,
    photo: x.photo === true,
    sunAsStar: x.sunAsStar === true,
    chartGrid: pick(x.chartGrid, ['rings', 'squares', 'hexes', 'none'] as const, d.chartGrid), chartSpacing: num(x.chartSpacing, 0, 1e6, d.chartSpacing),
    heights: pick(x.heights, ['numbers', 'symbols', 'none'] as const, d.heights),
    realms: pick(x.realms, ['borders', 'glow', 'none'] as const, d.realms),
    realmFill: num(x.realmFill, 0, 1, d.realmFill), realmBorder: num(x.realmBorder, 0, 8, d.realmBorder), realmGlow: num(x.realmGlow, 0, 2, d.realmGlow),
  };
}

/** A preset's whole look. */
export function presetLook(id: string): SkyLook {
  const p = SKY_PRESETS.find((x) => x.id === id) ?? SKY_PRESETS[0];
  return skyLookOf({ ...DEFAULT_SKY, ...p.look, preset: p.id });
}

export const NAME_FONTS: Record<NameFont, string> = {
  sans: '"Segoe UI", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Courier New", monospace',
  display: '"Trebuchet MS", "Segoe UI", sans-serif',
};

// Colours.
export function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export const mix = (a: string, b: string, f: number): string => {
  const x = hexRgb(a), y = hexRgb(b);
  return rgbHex([x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f]);
};
function saturate(h: string, amount: number): string {
  const [r, g, b] = hexRgb(h), m = (r + g + b) / 3;
  return rgbHex([m + (r - m) * amount, m + (g - m) * amount, m + (b - m) * amount]);
}

/** How hot a star is from its spectral class (0: the coolest, M; 1: the hottest, O), or 0.6 when unknown. */
export function warmth(spect: string): number {
  const i = 'MKGFABO'.indexOf((spect || 'G').trim().charAt(0).toUpperCase());
  if (i < 0) return 0.6;
  const n = Number.parseFloat(spect.trim().slice(1)), sub = Number.isFinite(n) ? n : 5;
  return Math.max(0, Math.min(1, (i + (9 - Math.min(9, sub)) / 10) / 7));
}

/** A colour from hue (degrees), saturation and lightness (0 to 1). */
export function hsl(h: number, sat: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/**
 * A look made up by chance ("Surprise me"): a dark sky of one hue, lines and names of another, stars of
 * any colouring and shape, sometimes nebulae, spikes or halos; a chart when `chart`.
 */
export function randomLook(rnd: () => number, chart: boolean): SkyLook {
  const pickOf = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length];
  const h1 = rnd() * 360, h2 = (h1 + 90 + rnd() * 180) % 360, h3 = (h1 + 40 + rnd() * 60) % 360;
  const light = chart && rnd() < 0.3;
  const shape = pickOf(['disc', 'disc', 'soft', 'diamond', 'sparkle4', 'sparkle6', 'ring', 'square', 'cross', 'dot'] as const);
  const spikes = pickOf([0, 0, 0, 2, 4, 4, 6, 8] as const);
  return skyLookOf({
    preset: 'surprise',
    colours: light ? 'mono' : pickOf(['natural', 'vivid', 'pastel', 'mono', 'temperature'] as const),
    tint: light ? hsl(h1, 0.35, 0.16) : hsl(h3, 0.7, 0.72), tintAmount: rnd() < 0.3 ? rnd() * 0.5 : 0,
    cool: hsl(h1 + 10, 0.85, 0.6), hot: hsl(h2, 0.85, 0.72),
    size: 0.7 + rnd() * 0.9, sizeByBrightness: 0.3 + rnd() * 0.7, shape,
    glow: light ? 0 : rnd() * 2.4, glowStrength: light ? 0 : 0.2 + rnd() * 0.5,
    spikes, spikeLength: 0.6 + rnd() * 1.2, spikeAngle: pickOf([0, 15, 30, 45] as const), halo: rnd() < 0.35 ? rnd() * 0.7 : 0,
    twinkle: rnd() < 0.4 ? rnd() * 0.6 : 0, outline: light ? 1.2 : 0, outlineColour: light ? hsl(h1, 0.4, 0.92) : '#10161d',
    background: light ? hsl(h1, 0.35, 0.88) : hsl(h1, 0.55, 0.025 + rnd() * 0.05),
    backgroundGlow: rnd() < 0.6 ? (light ? hsl(h1, 0.35, 0.94) : hsl(h1, 0.5, 0.09 + rnd() * 0.06)) : null,
    nebula: !light && rnd() < 0.5 ? 0.25 + rnd() * 0.55 : 0, nebulaA: hsl(h2, 0.6, 0.38), nebulaB: hsl(h3 + 60, 0.6, 0.32),
    farStars: light ? 0 : rnd() * 2,
    grid: light ? hsl(h2, 0.45, 0.35) : hsl(h2, 0.6, 0.68), gridOpacity: 0.2 + rnd() * 0.25,
    names: light ? hsl(h1, 0.4, 0.15) : hsl(h2, 0.5, 0.9), nameFont: pickOf(['sans', 'serif', 'mono', 'display'] as const),
    dropLines: rnd() < 0.7,
    chart, chartGrid: pickOf(['rings', 'squares', 'squares', 'hexes', 'hexes'] as const), chartSpacing: 0, heights: pickOf(['numbers', 'symbols', 'none'] as const),
    realms: pickOf(['borders', 'borders', 'borders', 'glow'] as const), realmFill: 0.12 + rnd() * 0.22, realmBorder: 1 + rnd() * 2, realmGlow: rnd() * 1.4,
  });
}

/** A star's colour in a look, from its natural colour, its spectral class and its holder's colour. */
export function starColourIn(look: SkyLook, natural: string, spect: string, owner?: string | null): string {
  let c: string;
  switch (look.colours) {
    case 'vivid': c = saturate(natural, 2.4); break;
    case 'pastel': c = mix(natural, '#ffffff', 0.45); break;
    case 'mono': c = look.tint; break;
    case 'temperature': c = mix(look.cool, look.hot, warmth(spect)); break;
    case 'owner': c = owner ?? mix(look.tint, '#000000', 0.25); break;
    default: c = natural;
  }
  return look.tintAmount > 0 && look.colours !== 'mono' ? mix(c, look.tint, look.tintAmount) : c;
}
