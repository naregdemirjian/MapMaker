// How countries look beyond their colour (D181): a stack of effects, as in a photo editor's layer styles, for a
// country of its own or for every country of a layer. Each effect is drawn in the order of the stack; a country's
// elevation decides whose shadows fall on whose land (higher countries cast onto lower ones; countries of the same
// elevation never shade each other). Pure data here: what is stored, checked and merged; the renderer draws it.

/** Blend modes a layer of countries can be laid on the map with (the map's relief and colours under it). */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
/** The canvas's name for a blend mode. */
export const compositeOf = (b: BlendMode | undefined): GlobalCompositeOperation => (!b || b === 'normal' ? 'source-over' : b);

/** A shadow cast by the country: light from `angle` degrees (0 from the right, 90 from above), `distance` and `blur` in pixels of a 1920-wide frame, grown by `spread`. */
export interface ShadowEffect { kind: 'shadow'; on: boolean; color: string; opacity: number; angle: number; distance: number; blur: number; spread: number }
/** A line round the country: inside its edge, on it, or outside it; several stack (a white line inside a black one). */
export interface StrokeEffect { kind: 'stroke'; on: boolean; color: string; opacity: number; width: number; position: 'inside' | 'center' | 'outside' }
export type Effect = ShadowEffect | StrokeEffect;
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

export const EFFECT_DEFAULTS: { [K in EffectKind]: Extract<Effect, { kind: K }> } = {
  shadow: { kind: 'shadow', on: true, color: '#000000', opacity: 0.55, angle: 120, distance: 6, blur: 10, spread: 0 },
  stroke: { kind: 'stroke', on: true, color: '#ffffff', opacity: 1, width: 2, position: 'inside' },
};
export const EFFECT_NAMES: Record<EffectKind, string> = { shadow: 'Drop shadow', stroke: 'Stroke' };

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const colour = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);

/** One effect as stored, checked (unknown kinds dropped, values kept in range); null if not an effect. */
export function effectOf(o: unknown): Effect | null {
  if (!o || typeof o !== 'object') return null;
  const e = o as Record<string, unknown>;
  const on = e.on !== false;
  if (e.kind === 'shadow') {
    const d = EFFECT_DEFAULTS.shadow;
    return { kind: 'shadow', on, color: colour(e.color, d.color), opacity: num(e.opacity, 0, 1, d.opacity), angle: num(e.angle, -360, 360, d.angle), distance: num(e.distance, 0, 200, d.distance), blur: num(e.blur, 0, 200, d.blur), spread: num(e.spread, 0, 100, d.spread) };
  }
  if (e.kind === 'stroke') {
    const d = EFFECT_DEFAULTS.stroke;
    const position = e.position === 'center' || e.position === 'outside' ? e.position : 'inside';
    return { kind: 'stroke', on, color: colour(e.color, d.color), opacity: num(e.opacity, 0, 1, d.opacity), width: num(e.width, 0, 60, d.width), position };
  }
  return null;
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

/** A shadow's offset in pixels of the frame (`unit`: frame pixels per pixel of a 1920-wide frame): away from the light. */
export function shadowOffset(s: ShadowEffect, unit: number): [number, number] {
  const a = (s.angle * Math.PI) / 180;
  return [-Math.cos(a) * s.distance * unit, Math.sin(a) * s.distance * unit];
}

/** The same shadow (for drawing countries that share one in a single pass). */
export const shadowKey = (s: ShadowEffect) => `${s.color}|${s.opacity}|${s.angle}|${s.distance}|${s.blur}|${s.spread}`;
