// How borders look (D183): a style for the borders between countries, another for their edges against nobody
// (coasts and unclaimed land), and special borders between two named countries (a ceasefire line, a frontier of an
// empire). Each style: colour, width, strength, a dash pattern, a double line, a casing under it, railway ticks, a
// sketched (hand-drawn) look, a soft edge, a glow, and dashes that march along it. Pure data here; the renderer draws.

export const DASHES = ['solid', 'dashed', 'long-dash', 'dotted', 'dash-dot', 'dash-dot-dot'] as const;
export type DashKind = (typeof DASHES)[number];
export const DASH_NAMES: Record<DashKind, string> = { solid: 'Solid', dashed: 'Dashed', 'long-dash': 'Long dashes', dotted: 'Dotted', 'dash-dot': 'Dash and dot', 'dash-dot-dot': 'Dash and two dots' };

export interface BorderStyle {
  /** Its colour (null: the map's border colour) and strength. */
  color: string | null; opacity: number;
  /** Its width in pixels of a 1920-wide frame (null: the layer's border width). */
  width: number | null;
  dash: DashKind;
  /** The dashes' length, as a share of the usual (1). */
  dashScale: number;
  /** Two lines with this gap between them (0: one line). */
  double: number;
  /** A wider line under it in another colour (0: none). */
  casing: number; casingColor: string;
  /** Short lines across it every so many pixels, as on old maps' railways and frontiers (0: none), and their length. */
  ticks: number; tickLength: number;
  /** Drawn as if by hand: several strokes a little apart (0: none, up to 3). */
  sketch: number;
  /** Its edge softened by this many pixels (0: sharp). */
  soft: number;
  /** A glow round it (0: none) in a colour. */
  glow: number; glowColor: string;
  /** Its dashes march along it by this many pixels a second (0: still). */
  march: number;
}

export const DEFAULT_BORDER: BorderStyle = {
  color: null, opacity: 1, width: null, dash: 'solid', dashScale: 1, double: 0, casing: 0, casingColor: '#ffffff',
  ticks: 0, tickLength: 6, sketch: 0, soft: 0, glow: 0, glowColor: '#ffe9a6', march: 0,
};

/** The borders of a layer: between countries, against nobody, and between two named countries. */
export interface LayerBorders {
  between: BorderStyle | null;
  coast: BorderStyle | null;
  pairs: Array<{ a: string; b: string; style: BorderStyle }>;
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const colour = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);

/** A border style as stored, checked and kept in range; null if none. */
export function borderStyleOf(o: unknown): BorderStyle | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>, d = DEFAULT_BORDER;
  return {
    color: s.color === null || s.color === undefined ? null : colour(s.color, '#101820'),
    opacity: num(s.opacity, 0, 1, d.opacity),
    width: s.width === null || s.width === undefined ? null : num(s.width, 0, 40, 1.4),
    dash: (DASHES as readonly string[]).includes(s.dash as string) ? (s.dash as DashKind) : d.dash,
    dashScale: num(s.dashScale, 0.25, 8, d.dashScale),
    double: num(s.double, 0, 30, d.double),
    casing: num(s.casing, 0, 30, d.casing), casingColor: colour(s.casingColor, d.casingColor),
    ticks: num(s.ticks, 0, 200, d.ticks), tickLength: num(s.tickLength, 1, 40, d.tickLength),
    sketch: Math.round(num(s.sketch, 0, 3, d.sketch)),
    soft: num(s.soft, 0, 40, d.soft),
    glow: num(s.glow, 0, 80, d.glow), glowColor: colour(s.glowColor, d.glowColor),
    march: num(s.march, -400, 400, d.march),
  };
}

/** A layer's borders as stored, checked; null when it has none. Pairs need two different countries; one style a pair. */
export function layerBordersOf(o: unknown): LayerBorders | null {
  if (!o || typeof o !== 'object') return null;
  const l = o as Record<string, unknown>;
  const pairs: LayerBorders['pairs'] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(l.pairs) ? l.pairs : []) {
    const q = p as Record<string, unknown>;
    const style = borderStyleOf(q?.style);
    if (typeof q?.a !== 'string' || typeof q?.b !== 'string' || !q.a || !q.b || q.a === q.b || !style) continue;
    const key = pairKey(q.a, q.b);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ a: q.a, b: q.b, style });
  }
  const between = borderStyleOf(l.between), coast = borderStyleOf(l.coast);
  return between || coast || pairs.length ? { between, coast, pairs } : null;
}

/** The same pair of countries either way round. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** A dash pattern in pixels for a line `width` wide (empty: solid). Dots are round caps on dashes of no length. */
export function dashPattern(kind: DashKind, width: number, scale: number): number[] {
  const w = Math.max(1, width), k = scale;
  switch (kind) {
    case 'dashed': return [6 * w * k, 4 * w * k];
    case 'long-dash': return [14 * w * k, 5 * w * k];
    case 'dotted': return [0.001, 2.6 * w * k];
    case 'dash-dot': return [8 * w * k, 3 * w * k, 0.001, 3 * w * k];
    case 'dash-dot-dot': return [8 * w * k, 3 * w * k, 0.001, 3 * w * k, 0.001, 3 * w * k];
    default: return [];
  }
}

/** Whether a style is drawn as a plain line of the layer (so layers without border styles are drawn exactly as before). */
export const plainBorder = (s: BorderStyle | null): boolean => !s || JSON.stringify(s) === JSON.stringify(DEFAULT_BORDER);

/** Whether any of a layer's borders moves on its own (its picture is then drawn again as time on screen passes). */
export const bordersMove = (l: LayerBorders | null): boolean => !!l && [l.between, l.coast, ...l.pairs.map((p) => p.style)].some((s) => !!s && s.march !== 0 && s.dash !== 'solid');
