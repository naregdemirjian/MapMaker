// How country labels look: one general style for the project (meta row 'label_style'), and per-country
// overrides (entity.style.label). Pure functions; the renderer and the interface share them.

export interface LabelStyle {
  /** Font family name (one of LABEL_FONTS, or any installed font). */
  font: string;
  weight: number;
  italic: boolean;
  uppercase: boolean;
  /** Extra space between letters, as a fraction of the text size. */
  letterSpacing: number;
  color: string;
  haloColor: string;
  /** Outline width, as a fraction of the text size. */
  haloWidth: number;
  /** Multiplies the size the label gets from its territory's area. */
  sizeScale: number;
  /** Smallest and largest text size, in pixels of a 1920-wide frame. */
  minSize: number;
  maxSize: number;
  opacity: number;
}

/** Per-country settings: any style field, plus whether the label shows and what it says. */
export interface CountryLabel extends Partial<LabelStyle> {
  hidden?: boolean;
  /** Text shown instead of the country's name. */
  text?: string;
}

export const DEFAULT_LABEL_STYLE: LabelStyle = {
  font: 'Segoe UI', weight: 600, italic: false, uppercase: false, letterSpacing: 0,
  color: '#f4efe6', haloColor: '#0a1018', haloWidth: 0.16, sizeScale: 1, minSize: 10, maxSize: 44, opacity: 1,
};

export const LABEL_FONTS = [
  'Segoe UI', 'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino Linotype',
  'Garamond', 'Book Antiqua', 'Cambria', 'Constantia', 'Copperplate', 'Courier New', 'Impact',
];

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** A complete, valid style from stored settings (unknown or broken values fall back). */
export function resolveLabelStyle(...layers: Array<Partial<LabelStyle> | null | undefined>): LabelStyle {
  const m: Record<string, unknown> = {};
  for (const l of layers) if (l) for (const [k, v] of Object.entries(l)) if (v !== undefined && v !== null) m[k] = v;
  const d = DEFAULT_LABEL_STYLE;
  const s: LabelStyle = {
    font: str(m.font, d.font), weight: num(m.weight, 100, 900, d.weight), italic: bool(m.italic, d.italic), uppercase: bool(m.uppercase, d.uppercase),
    letterSpacing: num(m.letterSpacing, -0.2, 1, d.letterSpacing), color: str(m.color, d.color), haloColor: str(m.haloColor, d.haloColor),
    haloWidth: num(m.haloWidth, 0, 0.6, d.haloWidth), sizeScale: num(m.sizeScale, 0.1, 10, d.sizeScale),
    minSize: num(m.minSize, 2, 400, d.minSize), maxSize: num(m.maxSize, 2, 400, d.maxSize), opacity: num(m.opacity, 0, 1, d.opacity),
  };
  if (s.maxSize < s.minSize) s.maxSize = s.minSize;
  return s;
}

/** The text size of a label: from its territory (`natural`, design pixels), scaled and clamped. */
export function labelSize(style: LabelStyle, natural: number): number {
  return Math.max(style.minSize, Math.min(style.maxSize, natural * style.sizeScale));
}

/** The canvas font string. */
export function labelFont(style: LabelStyle, sizePx: number): string {
  const family = /[\s,]/.test(style.font) && !style.font.includes('"') ? `"${style.font}"` : style.font;
  return `${style.italic ? 'italic ' : ''}${Math.round(style.weight)} ${sizePx.toFixed(1)}px ${family}, "Segoe UI", Arial, sans-serif`;
}

export function labelText(name: string, style: LabelStyle, override?: CountryLabel | null): string {
  const t = override?.text?.trim() ? override.text.trim() : name;
  return style.uppercase ? t.toLocaleUpperCase() : t;
}

/**
 * How cities are drawn (D219), for the whole project: meta row 'city_style'. As maps online draw them by default:
 * a small white dot (a ring round a dot for a country's capital) and the name beside it in white with a dark edge,
 * larger and bolder for bigger and more important cities, the same size on screen at every scale; zoomed out, only
 * the most important are shown, more and more appearing as the map is closed in on.
 */
export interface CityStyle {
  /** A dot at each city, and how it is drawn: as maps online ('map'), filled, a ring, or a square. */
  dots: boolean;
  dotStyle: 'map' | 'filled' | 'ring' | 'square';
  /** The dot's size and the name's size, as multiples of the design. */
  dotSize: number;
  nameSize: number;
  /** The names' lettering, colour and edge (its width in pixels of a 1920-wide frame). */
  font: string;
  color: string;
  haloColor: string;
  haloWidth: number;
  /** How much larger and bolder the bigger and more important cities are (0: all alike; 1: as maps online). */
  byImportance: number;
  /** Fewer cities zoomed out, the most important staying longest; and how many show at a scale (1: as maps online). */
  fade: boolean;
  density: number;
  /** Dots and names growing as the map is closed in on (as before), instead of keeping their size on screen. */
  growWithZoom: boolean;
}

export const DEFAULT_CITY_STYLE: CityStyle = {
  dots: true, dotStyle: 'map', dotSize: 1, nameSize: 1, font: 'Segoe UI', color: '#ffffff', haloColor: '#1d2126', haloWidth: 3,
  byImportance: 1, fade: true, density: 1, growWithZoom: false,
};

export function resolveCityStyle(stored: string | null | undefined): CityStyle {
  let st: Partial<CityStyle> = {};
  try { st = (JSON.parse(stored || '{}') as Partial<CityStyle> | null) ?? {}; } catch { /* a damaged setting falls back */ }
  const d = DEFAULT_CITY_STYLE;
  return {
    dots: bool(st.dots, d.dots), dotStyle: (['map', 'filled', 'ring', 'square'] as const).includes(st.dotStyle as CityStyle['dotStyle']) ? st.dotStyle! : d.dotStyle,
    dotSize: num(st.dotSize, 0.2, 4, d.dotSize), nameSize: num(st.nameSize, 0.3, 4, d.nameSize),
    font: str(st.font, d.font), color: str(st.color, d.color), haloColor: str(st.haloColor, d.haloColor), haloWidth: num(st.haloWidth, 0, 10, d.haloWidth),
    byImportance: num(st.byImportance, 0, 1.5, d.byImportance), fade: bool(st.fade, d.fade), density: num(st.density, 0.2, 5, d.density), growWithZoom: bool(st.growWithZoom, d.growWithZoom),
  };
}

/**
 * How important a city is (D219), for which show first and how large: the order of magnitude of its people, a
 * country's capital a whole step more (a region's a little), an economic centre a little more. About 7.5 for a capital
 * of millions, 6 for a city of a million, 5 for a town of a hundred thousand. Cities of one's own have none (always shown).
 */
export function cityImportance(meta: { population: number; capital: 'national' | 'regional' | null; economic?: number } | null, set?: number | null): number | null {
  if (typeof set === 'number' && Number.isFinite(set)) return Math.max(3, Math.min(9, set));
  if (!meta) return null;
  return Math.log10(Math.max(1000, meta.population)) + (meta.capital === 'national' ? 1 : meta.capital === 'regional' ? 0.3 : 0) + 0.12 * Math.max(0, Math.min(3, meta.economic ?? 0));
}

/**
 * The least importance a city needs to be shown at a scale (pixels of a 1920-wide frame per degree), as maps online
 * thin them out: only capitals of millions and the largest cities seen whole, towns of a hundred thousand at the scale
 * of a region; `density` 2 shows about as many again (the bar lower by 0.8).
 */
export function cityThreshold(pxPerDeg: number, density = 1): number {
  const bar = 6 - 1.15 * Math.log2(Math.max(1e-6, pxPerDeg) / 33);
  return Math.max(3.2, Math.min(7.3, bar)) - 0.8 * Math.log2(Math.max(0.05, density));
}

/**
 * How much of the cities is shown at a scale (D229), 0 to 1: seen so far out that a country is small, none at all (as
 * maps online, which name only countries seen whole), fading in over a short span; a city set to be always shown is
 * not left out. Pixels of a 1920-wide frame per degree: below 12 (a view more than some 160 degrees across), none.
 */
export const CITIES_FROM = 12;
export function citiesShown(pxPerDeg: number): number {
  return Math.max(0, Math.min(1, (pxPerDeg - CITIES_FROM) / 3));
}

/**
 * The size of a city's name (D229), design pixels: by its class (0 the most important), smaller than a country's name
 * as maps online draw them (13, 12 and 11 pixels closed in, 15% less seen far out). `byImportance` 0 draws all alike.
 */
export function cityNameSize(cls: number, pxPerDeg: number, byImportance = 1): number {
  const sizes = [13, 12, 11];
  const far = Math.max(0.85, Math.min(1, 0.85 + 0.075 * Math.log2(Math.max(1e-6, pxPerDeg) / 15)));
  return (12 + (sizes[Math.max(0, Math.min(2, cls))] - 12) * byImportance) * far;
}

/**
 * How important a city can be said to be (D219), for cities of one's own (or to rate one of today's otherwise): a
 * country's capital, a large city, a city, a town, a village.
 */
export const CITY_RANKS: ReadonlyArray<{ id: string; name: string; importance: number }> = [
  { id: 'capital', name: 'A country\'s capital', importance: 7.6 },
  { id: 'large', name: 'A large city', importance: 6.8 },
  { id: 'city', name: 'A city', importance: 6 },
  { id: 'town', name: 'A town', importance: 5.2 },
  { id: 'village', name: 'A village', importance: 4.4 },
];
/** A city of one's own that is not rated: its dot always shown, its name from the scale at which a city's is. */
export const UNRATED_CITY = 6;

/** A city's class by its importance: 0 the most important (capitals of millions, the largest cities), 1, 2 the rest. */
export const cityClass = (importance: number | null) => (importance === null ? 1 : importance >= 7.2 ? 0 : importance >= 6.2 ? 1 : 2);

/** Sizes of city and character markers and names (multipliers, 1 = as designed). Meta row 'point_style'. */
export interface PointStyle { city: number; character: number }

export function resolvePointStyle(stored: string | null | undefined): PointStyle {
  let st: Partial<PointStyle> = {};
  try { st = (JSON.parse(stored || '{}') as Partial<PointStyle> | null) ?? {}; } catch { /* a damaged setting falls back */ }
  const ok = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(4, Math.max(0.25, v)) : 1);
  return { city: ok(st.city), character: ok(st.character) };
}
