// How close today's countries are to one another (D174): in arms (the alliances they share), in trade (the
// blocs), in faith (the religion most of their people hold) and in language (the language of government), each
// from 0 (nothing shared) to 1, and all four together. A map can colour its countries by how close each is to one
// of them, without changing their own colours.
import { MILITARY, ECONOMIC, RELIGION, LANGUAGE, LANGUAGE_FAMILY } from './affinity-data.ts';

export type AffinityKind = 'military' | 'economic' | 'religious' | 'language' | 'overall';
export const AFFINITY_KINDS: Array<{ id: AffinityKind; name: string; about: string }> = [
  { id: 'military', name: 'Militarily', about: 'Alliances and mutual-defence treaties they share (NATO, the CSTO, treaties of two)' },
  { id: 'economic', name: 'Economically', about: 'Single markets, customs unions, trade areas and economic clubs they share' },
  { id: 'religious', name: 'Religiously', about: 'The religion most of their people hold: the same church, the same faith, or related ones' },
  { id: 'language', name: 'By language', about: 'The language they govern in: the same, the same branch (Romance, Turkic…), or the same family' },
  { id: 'overall', name: 'Overall', about: 'The four together, equally' },
];

/** Shared groups, each counting by its weight: 1 − Π(1 − w). */
function groups(list: Array<{ weight: number; members: string[] }>, a: string, b: string): number {
  let far = 1;
  for (const g of list) if (g.members.includes(a) && g.members.includes(b)) far *= 1 - g.weight;
  return 1 - far;
}

const CHRISTIAN = new Set(['CAT', 'PRO', 'ORT', 'OOR', 'CHR']), MUSLIM = new Set(['SUN', 'SHI', 'IBA', 'MUS']), ABRAHAMIC = new Set([...CHRISTIAN, ...MUSLIM, 'JEW']);
const EASTERN = new Set(['HIN', 'BUD', 'JPN', 'FOLK']);

function religious(a: string, b: string): number | null {
  const x = RELIGION[a], y = RELIGION[b];
  if (!x || !y) return null;
  if (x === y) return 1;
  const pair = new Set([x, y]);
  if (pair.has('ORT') && pair.has('OOR')) return 0.8;
  if ((pair.has('MUS') && (pair.has('SUN') || pair.has('SHI'))) || (pair.has('CHR') && CHRISTIAN.has(x) && CHRISTIAN.has(y))) return 0.8;
  if (CHRISTIAN.has(x) && CHRISTIAN.has(y)) return 0.6;
  if (MUSLIM.has(x) && MUSLIM.has(y)) return 0.6;
  if (ABRAHAMIC.has(x) && ABRAHAMIC.has(y)) return 0.25;
  if (EASTERN.has(x) && EASTERN.has(y)) return 0.45;
  if (pair.has('NONE') && (pair.has('FOLK') || pair.has('JPN') || CHRISTIAN.has(x) || CHRISTIAN.has(y))) return 0.3;
  return 0.05;
}

function linguistic(a: string, b: string): number | null {
  const x = LANGUAGE[a], y = LANGUAGE[b];
  if (!x || !y) return null;
  if (x === y) return 1;
  const fx = LANGUAGE_FAMILY[x], fy = LANGUAGE_FAMILY[y];
  if (!fx || !fy) return 0;
  if (fx[1] === fy[1]) return 0.65;
  if (fx[0] === fy[0]) return 0.35;
  return 0;
}

/** How close two of today's countries are (0 to 1), by one measure or all; null when nothing is known of one of them. */
export function affinity(a: string, b: string, kind: AffinityKind): number | null {
  if (a === b) return 1;
  const known = (n: string) => n in RELIGION || n in LANGUAGE;
  if (!known(a) || !known(b)) return null;
  switch (kind) {
    case 'military': return groups(MILITARY, a, b);
    case 'economic': return groups(ECONOMIC, a, b);
    case 'religious': return religious(a, b);
    case 'language': return linguistic(a, b);
    case 'overall': {
      const parts = [groups(MILITARY, a, b), groups(ECONOMIC, a, b), religious(a, b), linguistic(a, b)].filter((v): v is number => v !== null);
      return parts.reduce((s, v) => s + v, 0) / parts.length;
    }
  }
}

/** What ties two countries, in words (the groups they share, or their religions or languages). */
export function affinityWhy(a: string, b: string, kind: AffinityKind): string[] {
  const shared = (list: typeof MILITARY) => list.filter((g) => g.members.includes(a) && g.members.includes(b)).map((g) => g.name);
  if (kind === 'military') return shared(MILITARY);
  if (kind === 'economic') return shared(ECONOMIC);
  if (kind === 'religious') return RELIGION[a] && RELIGION[b] ? [`${RELIGION_NAMES[RELIGION[a]] ?? RELIGION[a]} and ${RELIGION_NAMES[RELIGION[b]] ?? RELIGION[b]}`] : [];
  if (kind === 'language') return LANGUAGE[a] && LANGUAGE[b] ? [`${LANGUAGE_FAMILY[LANGUAGE[a]]?.[1] ?? LANGUAGE[a]} and ${LANGUAGE_FAMILY[LANGUAGE[b]]?.[1] ?? LANGUAGE[b]}`] : [];
  return [...shared(MILITARY), ...shared(ECONOMIC)];
}

export const RELIGION_NAMES: Record<string, string> = {
  CAT: 'Catholic', PRO: 'Protestant', ORT: 'Eastern Orthodox', OOR: 'Oriental Orthodox', CHR: 'Christian (several churches)', SUN: 'Sunni Muslim', SHI: 'Shia Muslim', IBA: 'Ibadi Muslim', MUS: 'Muslim (Sunni and Shia)',
  JEW: 'Jewish', HIN: 'Hindu', BUD: 'Buddhist', JPN: 'Shinto and Buddhist', FOLK: 'folk religion', NONE: 'mostly without religion',
};

/** A map's colouring by closeness (D174): off, or by a measure from a country of the map. */
export interface ColourBy { kind: AffinityKind; focus: string; legend: boolean }
export function colourByOf(v: unknown): ColourBy | null {
  const o = v && typeof v === 'object' ? (v as Partial<ColourBy>) : null;
  if (!o || typeof o.focus !== 'string' || !o.focus || !AFFINITY_KINDS.some((k) => k.id === o.kind)) return null;
  return { kind: o.kind!, focus: o.focus, legend: o.legend !== false };
}

/** The ramp (viridis, readable by all): far, dark blue-violet, to close, yellow. */
const RAMP: Array<[number, number, number]> = [[59, 45, 98], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
export const FOCUS_COLOUR = '#ff4d6d', UNKNOWN_COLOUR = '#5a6070';
export function closenessColour(v: number): string {
  const x = Math.max(0, Math.min(1, v)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const c = RAMP[i].map((a, k) => Math.round(a + (RAMP[i + 1][k] - a) * f));
  return `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
export const RAMP_STOPS = RAMP.map((_, i) => closenessColour(i / (RAMP.length - 1)));

/**
 * The colour each country is drawn in when a map is coloured by closeness (D174): the country measured from in
 * FOCUS_COLOUR, each of today's countries by how close it is (by its name now or its name in the project, the
 * closer of the two), the others grey. Null for countries that keep their own colours (not countries).
 */
export function closenessColours(by: ColourBy, countries: Array<{ id: string; type_id: string; name: string; nameNow?: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const focus = countries.find((c) => c.id === by.focus);
  if (!focus) return out;
  const fnames = [...new Set([focus.nameNow ?? focus.name, focus.name])];
  for (const c of countries) {
    if (c.type_id !== 'polity' && c.type_id !== 'faction') continue;
    if (c.id === by.focus) { out.set(c.id, FOCUS_COLOUR); continue; }
    let v: number | null = null;
    for (const a of fnames) for (const b of new Set([c.nameNow ?? c.name, c.name])) { const x = affinity(a, b, by.kind); if (x !== null) v = Math.max(v ?? 0, x); }
    out.set(c.id, v === null ? UNKNOWN_COLOUR : closenessColour(v));
  }
  return out;
}
