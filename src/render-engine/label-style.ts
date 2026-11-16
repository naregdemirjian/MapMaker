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
