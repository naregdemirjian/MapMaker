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
/** A band of light sweeping across the country again and again, as on a newly won prize (D185). */
export interface ShineEffect { kind: 'shine'; on: boolean; color: string; opacity: number; width: number; angle: number; period: number; pause: number }
export type Effect = (ShadowEffect | StrokeEffect | InnerShadowEffect | OuterGlowEffect | InnerGlowEffect | BevelEffect | GradientEffect | PatternEffect | TextureEffect | ShineEffect) & {
  /** Settings changing over history (D185): from one value to another between two dates. */
  motions?: Motion[];
  /** Settings moving as time on screen passes (D185): a pulse, or a flicker. */
  pulses?: Pulse[];
};

/** How a change speeds up and slows down. */
export type Ease = 'linear' | 'smooth' | 'in' | 'out';
/** A setting going from one value to another between two moments of history (days and milliseconds). */
export interface Motion { field: string; from: number; to: number; start: [number, number]; end: [number, number]; ease: Ease }
/** A setting moving by up to `amount` with a `period` of seconds on screen: evenly (sine) or unevenly (wiggle). */
export interface Pulse { field: string; amount: number; period: number; kind: 'sine' | 'wiggle' }
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
  shine: {
    name: 'Light sweep', fields: [C('color', 'Colour'), P('opacity', 'Strength (%)'), N('width', 'Width', 10, 800, 5), N('angle', 'Angle (°)', -360, 360, 5), N('period', 'Sweep (s)', 0.3, 30, 0.1), N('pause', 'Pause (s)', 0, 60, 0.1)],
    defaults: { kind: 'shine', on: true, color: '#ffffff', opacity: 0.5, width: 120, angle: 60, period: 1.6, pause: 2.5 },
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
  // (Motions and pulses of its number settings, kept in their ranges.)
  const range = (field: unknown): [number, number] | null => {
    const f = def.fields.find((x) => x.key === field);
    return !f ? null : f.type === 'percent' ? [0, 1] : f.type === 'number' ? [f.min, f.max] : null;
  };
  const at = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1]] : null);
  const motions = (Array.isArray(e.motions) ? e.motions : []).flatMap((m: Record<string, unknown>) => {
    const r = range(m?.field), start = at(m?.start), end = at(m?.end);
    if (!r || !start || !end) return [];
    return [{ field: m.field as string, from: num(m.from, r[0], r[1], r[0]), to: num(m.to, r[0], r[1], r[1]), start, end, ease: (['linear', 'smooth', 'in', 'out'] as const).includes(m.ease as Ease) ? (m.ease as Ease) : 'smooth' }];
  }).slice(0, 8);
  const pulses = (Array.isArray(e.pulses) ? e.pulses : []).flatMap((q: Record<string, unknown>) => {
    const r = range(q?.field);
    if (!r) return [];
    return [{ field: q.field as string, amount: num(q.amount, 0, r[1] - r[0], 0), period: num(q.period, 0.05, 120, 1), kind: q.kind === 'wiggle' ? 'wiggle' as const : 'sine' as const }];
  }).slice(0, 8);
  if (motions.length) out.motions = motions;
  if (pulses.length) out.pulses = pulses;
  return out as unknown as Effect;
}

const eased = (x: number, e: Ease) => (e === 'linear' ? x : e === 'in' ? x * x * x : e === 'out' ? 1 - (1 - x) ** 3 : x * x * (3 - 2 * x));
/** Smooth noise of one variable, -1 to 1 (the same every time). */
function noise1(x: number): number {
  const i = Math.floor(x), f = x - i, h = (n: number) => { let v = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0; v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35) >>> 0; return ((v ^ (v >>> 16)) >>> 0) / 4294967296 * 2 - 1; };
  const s = f * f * (3 - 2 * f);
  return h(i) * (1 - s) + h(i + 1) * s;
}

/**
 * An effect as it is at a moment of history (`day`: days, with their fraction) and `seconds` of time on screen
 * (D185): each motion's value where history is between its dates (before the first, its first value; after, its last),
 * then each pulse added, all kept in their ranges.
 */
export function effectAt(e: Effect, day: number, seconds: number): Effect {
  if (!e.motions?.length && !e.pulses?.length) return e;
  const def = EFFECTS[e.kind];
  const out = { ...e } as unknown as Record<string, number>;
  const lim = (field: string, v: number) => { const f = def.fields.find((x) => x.key === field); return !f ? v : f.type === 'percent' ? Math.max(0, Math.min(1, v)) : f.type === 'number' ? Math.max(f.min, Math.min(f.max, v)) : v; };
  const sorted = [...(e.motions ?? [])].sort((a, b) => a.start[0] + a.start[1] / 864e5 - (b.start[0] + b.start[1] / 864e5));
  const touched = new Set<string>();
  for (const m of sorted) {
    const a = m.start[0] + m.start[1] / 864e5, b = m.end[0] + m.end[1] / 864e5;
    if (day < a && touched.has(m.field)) continue;
    const x = b > a ? Math.max(0, Math.min(1, (day - a) / (b - a))) : day >= a ? 1 : 0;
    out[m.field] = m.from + (m.to - m.from) * eased(x, m.ease);
    touched.add(m.field);
  }
  for (const p of e.pulses ?? []) {
    const phase = seconds / p.period;
    out[p.field] = lim(p.field, (out[p.field] ?? 0) + p.amount * (p.kind === 'sine' ? Math.sin(phase * 2 * Math.PI) : noise1(phase * 4)));
  }
  for (const m of e.motions ?? []) out[m.field] = lim(m.field, out[m.field]);
  return out as unknown as Effect;
}

/** A look as it is at a moment of history and of time on screen: each effect through `effectAt`. */
export function lookAt<L extends CountryLook>(l: L | null, day: number, seconds: number): L | null {
  if (!l || !l.effects.some((e) => e.motions?.length || e.pulses?.length)) return l;
  return { ...l, effects: l.effects.map((e) => effectAt(e, day, seconds)) };
}

/** A colour (#rrggbb) at a strength, for gradients that fade it out. */
export function rgbaOf(c: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : c;
}

/** Where a light sweep is at `seconds` (D185): 0 to 1 while it crosses, null while it waits for the next. */
export function sweepAt(period: number, pause: number, seconds: number): number | null {
  const cycle = period + pause, t = ((seconds % cycle) + cycle) % cycle;
  return t <= period ? t / period : null;
}

/** Whether a look changes as history goes (its picture is then drawn again at each moment), or as time on screen passes. */
export const changesInHistory = (l: CountryLook | null) => !!l && l.effects.some((e) => e.on && !!e.motions?.length);
export const movesOnScreen = (l: CountryLook | null) => !!l && l.effects.some((e) => e.on && (!!e.pulses?.length || e.kind === 'shine'));

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
export const INSIDE: ReadonlySet<EffectKind> = new Set(['inner-shadow', 'inner-glow', 'bevel', 'gradient', 'pattern', 'texture', 'shine']);

/** The same shadow (for drawing countries that share one in a single pass). */
export const shadowKey = (s: ShadowEffect) => `${s.color}|${s.opacity}|${s.angle}|${s.distance}|${s.blur}|${s.spread}`;

/** A look kept under a name (D185), to give to many countries, and to take to other projects in a file. */
export interface LookPreset { id: string; name: string; look: CountryLook }
/** What a file of presets says it is. */
export const PRESET_FILE_KIND = 'map-maker-looks';

/** Presets as stored or read from a file, checked: named, with a look; at most 200. */
export function lookPresetsOf(v: unknown): LookPreset[] {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { presets?: unknown }).presets) ? (v as { presets: unknown[] }).presets : [];
  const out: LookPreset[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const look = countryLookOf(o.look);
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
    if (!look || !name) continue;
    out.push({ id: typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : `preset-${out.length + 1}`, name, look });
  }
  return out.slice(0, 200);
}
