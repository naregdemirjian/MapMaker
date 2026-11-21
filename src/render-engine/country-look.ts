// How countries look beyond their colour (D181, D182): a stack of effects, as in a photo editor's layer styles, for a
// country of its own or for every country of a layer. Each effect is drawn in the order of the stack; a country's
// elevation decides whose shadows fall on whose land (higher countries cast onto lower ones; countries of the same
// elevation never shade each other). Pure data here: what each kind of effect has, how it is stored, checked and
// merged; the renderer draws it, the interface edits it from the same description of its fields.

/** Blend modes a layer of countries, or an effect, can be laid on with. */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export const BLEND_NAMES: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', 'soft-light': 'Soft light', 'hard-light': 'Hard light',
  darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'Colour dodge', 'color-burn': 'Colour burn', difference: 'Difference', exclusion: 'Exclusion',
  hue: 'Hue', saturation: 'Saturation', color: 'Colour', luminosity: 'Luminosity',
};
/** The canvas's name for a blend mode. */
export const compositeOf = (b: BlendMode | undefined): GlobalCompositeOperation => (!b || b === 'normal' ? 'source-over' : b);

export const PATTERNS = ['stripes', 'cross', 'dots', 'grid', 'lines', 'waves', 'checks'] as const;
export type PatternKind = (typeof PATTERNS)[number];
export const TEXTURES = ['paper', 'parchment', 'canvas', 'grain', 'metal', 'stone'] as const;
export type TextureKind = (typeof TEXTURES)[number];

/** A shadow cast by the country: light from `angle` degrees (0 from the right, 90 from above), `distance` and `blur` in pixels of a 1920-wide frame, grown by `spread`. */
export interface ShadowEffect { kind: 'shadow'; on: boolean; color: string; opacity: number; angle: number; distance: number; blur: number; spread: number }
/** A line round the country: inside its edge, on it, or outside it; several stack (a white line inside a black one). */
export interface StrokeEffect { kind: 'stroke'; on: boolean; color: string; opacity: number; width: number; position: 'inside' | 'center' | 'outside' }
/** A shadow inside the country's edge, as if it were sunk into the map. */
export interface InnerShadowEffect { kind: 'inner-shadow'; on: boolean; color: string; opacity: number; angle: number; distance: number; blur: number }
/** A glow round the country, on the land and sea about it. */
export interface OuterGlowEffect { kind: 'outer-glow'; on: boolean; color: string; opacity: number; blur: number; spread: number }
/** A glow inside the country, along its edge. */
export interface InnerGlowEffect { kind: 'inner-glow'; on: boolean; color: string; opacity: number; blur: number }
/** Light and shade along the edge: the country raised like a tile, or sunk. */
export interface BevelEffect { kind: 'bevel'; on: boolean; style: 'raised' | 'sunken'; angle: number; depth: number; size: number; highlight: string; highlightOpacity: number; shade: string; shadeOpacity: number }
/** Colour running from one to another across the country. */
export interface GradientEffect { kind: 'gradient'; on: boolean; from: string; to: string; style: 'linear' | 'radial'; angle: number; opacity: number; blend: BlendMode }
/** Stripes, dots, a grid… over the country (occupied, disputed, under mandate). */
export interface PatternEffect { kind: 'pattern'; on: boolean; pattern: PatternKind; color: string; opacity: number; scale: number; angle: number; blend: BlendMode }
/** Paper, parchment, canvas, metal… laid over the country's colour. */
export interface TextureEffect { kind: 'texture'; on: boolean; texture: TextureKind; opacity: number; scale: number; blend: BlendMode }
export type Effect = ShadowEffect | StrokeEffect | InnerShadowEffect | OuterGlowEffect | InnerGlowEffect | BevelEffect | GradientEffect | PatternEffect | TextureEffect;
export type EffectKind = Effect['kind'];

export interface CountryLook {
  /** Higher countries are drawn over lower ones and cast their shadows on them. */
  elevation: number;
  /** How strongly the country's own fill shows (its effects keep theirs): 0 to 1. */
  opacity: number;
  /** The effects, drawn in this order. */
  effects: Effect[];
}
/** A layer's look: the default for its countries without one of their own, and how the layer is laid on the map. */
export interface LayerLook extends CountryLook { blend: BlendMode }

/** A setting of an effect: what it is and its range (strengths are kept 0 to 1 and shown as percentages). */
export type EffectField =
  | { key: string; label: string; type: 'colour' }
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number }
  | { key: string; label: string; type: 'percent' }
  | { key: string; label: string; type: 'choice'; choices: ReadonlyArray<readonly [string, string]> };

const blendChoices = BLEND_MODES.map((b) => [b, BLEND_NAMES[b]] as const);
const C = (key: string, label: string): EffectField => ({ key, label, type: 'colour' });
const P = (key: string, label: string): EffectField => ({ key, label, type: 'percent' });
const N = (key: string, label: string, min: number, max: number, step: number): EffectField => ({ key, label, type: 'number', min, max, step });
const angle = N('angle', 'Light from (°)', -360, 360, 5);

/** Each kind of effect: its name, its settings and their defaults. */
export const EFFECTS: { [K in EffectKind]: { name: string; fields: EffectField[]; defaults: Extract<Effect, { kind: K }> } } = {
  shadow: {
    name: 'Drop shadow', fields: [C('color', 'Colour'), P('opacity', 'Strength (%)'), angle, N('distance', 'Distance', 0, 200, 1), N('blur', 'Blur', 0, 200, 1), N('spread', 'Spread', 0, 100, 1)],
    defaults: { kind: 'shadow', on: true, color: '#000000', opacity: 0.55, angle: 120, distance: 6, blur: 10, spread: 0 },
  },
  stroke: {
    name: 'Stroke', fields: [C('color', 'Colour'), P('opacity', 'Strength (%)'), N('width', 'Width', 0, 60, 0.5), { key: 'position', label: 'Where', type: 'choice', choices: [['inside', 'Inside the edge'], ['center', 'On the edge'], ['outside', 'Outside the edge']] }],
    defaults: { kind: 'stroke', on: true, color: '#ffffff', opacity: 1, width: 2, position: 'inside' },
  },
  'inner-shadow': {
    name: 'Inner shadow', fields: [C('color', 'Colour'), P('opacity', 'Strength (%)'), angle, N('distance', 'Distance', 0, 200, 1), N('blur', 'Blur', 0, 200, 1)],
    defaults: { kind: 'inner-shadow', on: true, color: '#000000', opacity: 0.5, angle: 120, distance: 5, blur: 10 },
  },
  'outer-glow': {
    name: 'Outer glow', fields: [C('color', 'Colour'), P('opacity', 'Strength (%)'), N('blur', 'Size', 0, 200, 1), N('spread', 'Spread', 0, 100, 1)],
    defaults: { kind: 'outer-glow', on: true, color: '#ffe9a6', opacity: 0.7, blur: 18, spread: 2 },
  },
  'inner-glow': {
    name: 'Inner glow', fields: [C('color', 'Colour'), P('opacity', 'Strength (%)'), N('blur', 'Size', 0, 200, 1)],
    defaults: { kind: 'inner-glow', on: true, color: '#ffffff', opacity: 0.6, blur: 14 },
  },
  bevel: {
    name: 'Bevel', fields: [
      { key: 'style', label: 'Style', type: 'choice', choices: [['raised', 'Raised'], ['sunken', 'Sunken']] }, angle, N('depth', 'Depth', 0, 60, 0.5), N('size', 'Softness', 0, 60, 0.5),
      C('highlight', 'Light'), P('highlightOpacity', 'Light (%)'), C('shade', 'Shade'), P('shadeOpacity', 'Shade (%)'),
    ],
    defaults: { kind: 'bevel', on: true, style: 'raised', angle: 120, depth: 3, size: 4, highlight: '#ffffff', highlightOpacity: 0.65, shade: '#000000', shadeOpacity: 0.5 },
  },
  gradient: {
    name: 'Gradient', fields: [
      C('from', 'From'), C('to', 'To'), { key: 'style', label: 'Style', type: 'choice', choices: [['linear', 'Straight'], ['radial', 'From the middle']] }, N('angle', 'Angle (°)', -360, 360, 5),
      P('opacity', 'Strength (%)'), { key: 'blend', label: 'Blend', type: 'choice', choices: blendChoices },
    ],
    defaults: { kind: 'gradient', on: true, from: '#ffffff', to: '#000000', style: 'linear', angle: 90, opacity: 0.35, blend: 'soft-light' },
  },
  pattern: {
    name: 'Pattern', fields: [
      { key: 'pattern', label: 'Pattern', type: 'choice', choices: [['stripes', 'Stripes'], ['cross', 'Crossed stripes'], ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Lines'], ['waves', 'Waves'], ['checks', 'Checks']] },
      C('color', 'Colour'), P('opacity', 'Strength (%)'), N('scale', 'Size', 0.25, 8, 0.25), N('angle', 'Turn (°)', -360, 360, 5), { key: 'blend', label: 'Blend', type: 'choice', choices: blendChoices },
    ],
    defaults: { kind: 'pattern', on: true, pattern: 'stripes', color: '#000000', opacity: 0.35, scale: 1, angle: 0, blend: 'normal' },
  },
  texture: {
    name: 'Texture', fields: [
      { key: 'texture', label: 'Texture', type: 'choice', choices: [['paper', 'Paper'], ['parchment', 'Parchment'], ['canvas', 'Canvas'], ['grain', 'Grain'], ['metal', 'Brushed metal'], ['stone', 'Stone']] },
      P('opacity', 'Strength (%)'), N('scale', 'Size', 0.25, 8, 0.25), { key: 'blend', label: 'Blend', type: 'choice', choices: blendChoices },
    ],
    defaults: { kind: 'texture', on: true, texture: 'paper', opacity: 0.5, scale: 1, blend: 'multiply' },
  },
};
export const EFFECT_KINDS = Object.keys(EFFECTS) as EffectKind[];
export const EFFECT_DEFAULTS = Object.fromEntries(EFFECT_KINDS.map((k) => [k, EFFECTS[k].defaults])) as { [K in EffectKind]: Extract<Effect, { kind: K }> };
export const EFFECT_NAMES = Object.fromEntries(EFFECT_KINDS.map((k) => [k, EFFECTS[k].name])) as Record<EffectKind, string>;

const colour = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** One effect as stored, checked (unknown kinds dropped, every setting kept in range); null if not an effect. */
export function effectOf(o: unknown): Effect | null {
  if (!o || typeof o !== 'object') return null;
  const e = o as Record<string, unknown>;
  const def = EFFECTS[e.kind as EffectKind];
  if (!def) return null;
  const out: Record<string, unknown> = { kind: e.kind, on: e.on !== false };
  const d = def.defaults as unknown as Record<string, unknown>;
  for (const f of def.fields) {
    const v = e[f.key];
    out[f.key] = f.type === 'colour' ? colour(v, d[f.key] as string)
      : f.type === 'percent' ? num(v, 0, 1, d[f.key] as number)
      : f.type === 'number' ? num(v, f.min, f.max, d[f.key] as number)
      : f.choices.some(([k]) => k === v) ? v : d[f.key];
  }
  return out as unknown as Effect;
}

/** A country's look as stored, checked; null when it has none. */
export function countryLookOf(o: unknown): CountryLook | null {
  if (!o || typeof o !== 'object') return null;
  const l = o as Record<string, unknown>;
  const effects = Array.isArray(l.effects) ? l.effects.map(effectOf).filter((e): e is Effect => !!e).slice(0, 16) : [];
  return { elevation: Math.round(num(l.elevation, -100, 100, 0)), opacity: num(l.opacity, 0, 1, 1), effects };
}

/** A layer's look as stored, checked; null when it has none. */
export function layerLookOf(o: unknown): LayerLook | null {
  const base = countryLookOf(o);
  if (!base) return null;
  const b = (o as { blend?: unknown }).blend;
  return { ...base, blend: (BLEND_MODES as readonly string[]).includes(b as string) ? (b as BlendMode) : 'normal' };
}

/** The look a country is drawn with: its own if it has one, else its layer's (with no layer look, nothing to do: null). */
export function lookFor(own: CountryLook | null, layer: LayerLook | null): CountryLook | null {
  return own ?? (layer ? { elevation: layer.elevation, opacity: layer.opacity, effects: layer.effects } : null);
}

/** Whether a look changes anything (so countries without one are drawn exactly as before). */
export const looksPlain = (l: CountryLook | null): boolean => !l || (l.opacity >= 1 && !l.effects.some((e) => e.on));

/** An offset away from the light at `angle` (`unit`: frame pixels per pixel of a 1920-wide frame). */
export function awayFromLight(angleDeg: number, distance: number, unit: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [-Math.cos(a) * distance * unit, Math.sin(a) * distance * unit];
}

/** A shadow's offset in pixels of the frame: away from the light. */
export const shadowOffset = (s: { angle: number; distance: number }, unit: number): [number, number] => awayFromLight(s.angle, s.distance, unit);

/** What is cast on the land below a country before it is drawn: its drop shadows and outer glows, as shadows. */
export function castOf(e: Effect): ShadowEffect | null {
  if (!e.on) return null;
  if (e.kind === 'shadow') return e.opacity > 0 ? e : null;
  if (e.kind === 'outer-glow' && e.opacity > 0) return { kind: 'shadow', on: true, color: e.color, opacity: e.opacity, angle: 0, distance: 0, blur: e.blur, spread: e.spread };
  return null;
}

/** Effects drawn inside the country, over its fill, in the stack's order. */
export const INSIDE: ReadonlySet<EffectKind> = new Set(['inner-shadow', 'inner-glow', 'bevel', 'gradient', 'pattern', 'texture']);

/** The same shadow (for drawing countries that share one in a single pass). */
export const shadowKey = (s: ShadowEffect) => `${s.color}|${s.opacity}|${s.angle}|${s.distance}|${s.blur}|${s.spread}`;
