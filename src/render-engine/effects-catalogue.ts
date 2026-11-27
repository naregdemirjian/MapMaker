// The Effects panel's catalogue (S4 of the studios plan, D238): every effect the software has, in folders, each with
// what it can be given to and what giving it does. Pure: the interface gives an effect with the commands of what
// receives it (a country's or a group's look, a layer's borders, label settings, an event's or a shot's changes, a
// shot's graphics); more effects are added to the folders over time.
import { EFFECT_DEFAULTS, EFFECT_KINDS, EFFECTS, takesMapLight, type CountryLook, type Effect, type EffectKind, type LookPreset } from './country-look.ts';
import { DEFAULT_BORDER, type BorderStyle } from './border-look.ts';
import type { CountryLabel } from './label-style.ts';
import { GRAPHIC_TEMPLATES } from '../presentation/graphic-style.ts';
import { TRANSITION_LOOKS } from '../presentation/sequence.ts';

export type FolderId = 'countries' | 'borders' | 'labels' | 'graphics' | 'transitions' | 'saved';

/** The folders, in the panel's order: what each holds and what its effects are given to. */
export const FOLDERS: Array<{ id: FolderId; name: string; note: string }> = [
  { id: 'countries', name: 'Countries', note: 'Shadows, strokes, glows, bevels, gradients, patterns, textures: added to the look of a country, of a group (all its members), or of a layer (its countries without a look of their own)' },
  { id: 'borders', name: 'Borders', note: 'Dashes, double lines, casings, ticks, a hand-drawn line, glows: laid on the borders between countries of a layer' },
  { id: 'labels', name: 'Labels', note: 'Capitals, italics, outlines, sizes, old-map lettering: laid on the label of a country, or of a group\'s members' },
  { id: 'graphics', name: 'Graphics', note: 'Whole looks for a shot\'s events box: give them to a shot, in Presentation' },
  { id: 'transitions', name: 'Transitions', note: 'How changes of territory animate: for an event\'s changes, or a shot\'s' },
  { id: 'saved', name: 'Saved by you', note: 'Looks kept under a name (Keep this look…, in a country\'s Looks): the whole look given at once' },
];

/** What an effect can be given to: a country (or faction), a group, a layer of territory, an event, or a shot. */
export type Receiver = 'country' | 'group' | 'layer' | 'event' | 'shot';

export type EffectItem =
  | { id: string; folder: 'countries'; name: string; note: string; kind: EffectKind }
  | { id: string; folder: 'borders'; name: string; note: string; patch: Partial<BorderStyle> }
  | { id: string; folder: 'labels'; name: string; note: string; patch: CountryLabel }
  | { id: string; folder: 'graphics'; name: string; note: string; template: string }
  | { id: string; folder: 'transitions'; name: string; note: string; look: string }
  | { id: string; folder: 'saved'; name: string; note: string; look: CountryLook };

const COUNTRY_NOTES: Record<EffectKind, string> = {
  shadow: 'A shadow cast on the land below, away from the light',
  stroke: 'A line round the edge: inside it, on it or outside it',
  'inner-shadow': 'A shadow inside the edge, as if sunk into the map',
  'outer-glow': 'A glow over the land and sea about it',
  'inner-glow': 'A glow inside, along the edge',
  bevel: 'Light and shade along the edge: raised like a tile, or sunk',
  gradient: 'Colour running from one to another across it',
  pattern: 'Stripes, dots or a grid over it: occupied, disputed, under mandate',
  shine: 'A band of light sweeping across it again and again',
  extrude: 'Raised as a slab, its walls in its colour darkened',
  texture: 'Paper, parchment, canvas, metal or stone over its colour',
};

/** Border effects: each laid on a layer's border between countries (the rest of its settings kept). */
const BORDERS: Array<{ id: string; name: string; note: string; patch: Partial<BorderStyle> }> = [
  { id: 'dashed', name: 'Dashed', note: 'Broken into dashes', patch: { dash: 'dashed' } },
  { id: 'long-dash', name: 'Long dashes', note: 'Broken into long dashes', patch: { dash: 'long-dash' } },
  { id: 'dotted', name: 'Dotted', note: 'A line of dots', patch: { dash: 'dotted' } },
  { id: 'dash-dot', name: 'Dash and dot', note: 'Dashes and dots by turns, as on old maps\' frontiers', patch: { dash: 'dash-dot' } },
  { id: 'double', name: 'Double line', note: 'Two lines a little apart', patch: { double: 3 } },
  { id: 'casing', name: 'Casing', note: 'A wider line under it in another colour, so it reads over anything', patch: { casing: 3, casingColor: '#ffffff' } },
  { id: 'ticks', name: 'Ticks', note: 'Short lines across it, as on old maps\' railways and frontiers', patch: { ticks: 14, tickLength: 6 } },
  { id: 'sketch', name: 'Hand-drawn', note: 'Drawn as if by hand, in strokes a little apart', patch: { sketch: 2 } },
  { id: 'soft', name: 'Soft edge', note: 'The line softened', patch: { soft: 3 } },
  { id: 'glow', name: 'Glow', note: 'A glow round the line', patch: { glow: 12, glowColor: '#ffe9a6' } },
  { id: 'march', name: 'Marching ants', note: 'Dashes moving along the border as time on screen passes', patch: { dash: 'dashed', march: 40 } },
  { id: 'plain', name: 'Plain line', note: 'Every border effect taken away: a plain line again', patch: { ...DEFAULT_BORDER } },
];

/** Label effects: each laid on label settings (the rest kept). */
const LABELS: Array<{ id: string; name: string; note: string; patch: CountryLabel }> = [
  { id: 'capitals', name: 'Capitals', note: 'In capitals, a little spaced', patch: { uppercase: true, letterSpacing: 0.12 } },
  { id: 'italic', name: 'Italic', note: 'Slanted letters', patch: { italic: true } },
  { id: 'bold', name: 'Bold', note: 'Heavier letters', patch: { weight: 800 } },
  { id: 'light', name: 'Light', note: 'Lighter letters', patch: { weight: 300 } },
  { id: 'spaced', name: 'Spaced letters', note: 'Letters far apart, as across a wide country on old maps', patch: { letterSpacing: 0.35 } },
  { id: 'outline', name: 'Thick outline', note: 'A wide outline round the letters, readable over anything', patch: { haloWidth: 0.3 } },
  { id: 'no-outline', name: 'No outline', note: 'The letters alone', patch: { haloWidth: 0 } },
  { id: 'larger', name: 'Larger', note: 'Half as large again', patch: { sizeScale: 1.5 } },
  { id: 'smaller', name: 'Smaller', note: 'Two thirds of the size', patch: { sizeScale: 0.66 } },
  { id: 'old-map', name: 'Old map', note: 'Serif capitals in dark ink on a pale edge, widely spaced', patch: { font: 'Palatino Linotype', italic: true, uppercase: true, letterSpacing: 0.22, color: '#3b2a1a', haloColor: '#f3e7c9', haloWidth: 0.18 } },
  { id: 'hidden', name: 'Hidden', note: 'No label', patch: { hidden: true } },
];

/** Every effect, by folder, with the looks kept under names (D185) in "Saved by you". */
export function catalogue(presets: LookPreset[] = []): EffectItem[] {
  return [
    ...EFFECT_KINDS.map((kind) => ({ id: `countries:${kind}`, folder: 'countries' as const, name: EFFECTS[kind].name, note: COUNTRY_NOTES[kind], kind })),
    ...BORDERS.map((b) => ({ id: `borders:${b.id}`, folder: 'borders' as const, name: b.name, note: b.note, patch: b.patch })),
    ...LABELS.map((l) => ({ id: `labels:${l.id}`, folder: 'labels' as const, name: l.name, note: l.note, patch: l.patch })),
    ...GRAPHIC_TEMPLATES.map((t) => ({ id: `graphics:${t.id}`, folder: 'graphics' as const, name: t.name, note: 'A whole look for the events box of a shot', template: t.id })),
    ...TRANSITION_LOOKS.map((t) => ({ id: `transitions:${t.id}`, folder: 'transitions' as const, name: t.name, note: t.note, look: t.id })),
    ...presets.map((p) => ({ id: `saved:${p.id}`, folder: 'saved' as const, name: p.name, note: `The look "${p.name}", kept: ${p.look.effects.length} effect${p.look.effects.length === 1 ? '' : 's'}`, look: p.look })),
  ];
}

/** What each folder's effects are given to. A border effect given to a country or a group goes to the layer drawn on. */
const RECEIVERS: Record<FolderId, Receiver[]> = {
  countries: ['country', 'group', 'layer'],
  borders: ['layer', 'country', 'group'],
  labels: ['country', 'group'],
  graphics: ['shot'],
  transitions: ['event', 'shot'],
  saved: ['country', 'group', 'layer'],
};

/** Whether an effect can be given to a kind of thing. */
export const givesTo = (item: EffectItem, to: Receiver): boolean => RECEIVERS[item.folder].includes(to);
/** What an effect can be given to, in words, for when it is given to something else. */
export function receiversText(item: EffectItem): string {
  const words: Record<Receiver, string> = { country: 'a country', group: 'a group', layer: 'a layer', event: 'an event', shot: 'a shot' };
  const list = RECEIVERS[item.folder].filter((r) => !(item.folder === 'borders' && r !== 'layer')).map((r) => words[r]);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0];
}

const EMPTY: CountryLook = { elevation: 0, opacity: 1, effects: [] };

/** A look with an effect of a kind added at the end of its stack: its defaults, in the map's light where it takes one (as new effects are, D186). */
export function withEffect<L extends CountryLook>(look: L | null, kind: EffectKind): L | CountryLook {
  const base = look ?? EMPTY;
  const e = { ...EFFECT_DEFAULTS[kind], ...(takesMapLight(kind) ? { light: 'map' } : {}) } as Effect;
  return { ...base, effects: [...base.effects, e].slice(-16) };
}

/** A border style with an effect laid on it (from the plain line where there was none). */
export function borderWith(style: BorderStyle | null, patch: Partial<BorderStyle>): BorderStyle {
  return { ...(style ?? DEFAULT_BORDER), ...patch };
}

/** Label settings with an effect laid on them (its text kept). */
export function labelWith(label: CountryLabel | undefined, patch: CountryLabel): CountryLabel {
  return { ...(label ?? {}), ...patch };
}

/** Effects whose name answers a filter (any word of it, at the start of a word of the name), folders kept in order. */
export function filterItems(items: EffectItem[], filter: string): EffectItem[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const name = ` ${it.name.toLowerCase()}`;
    return words.every((w) => name.includes(` ${w}`) || name.replace(/[^a-z0-9 ]/g, ' ').includes(` ${w}`));
  });
}
