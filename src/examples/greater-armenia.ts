// An example project (D171): "Greater Armenia", a future history from 2039 to 2178 built from an outline,
// through the same commands the interface uses. Today's countries; a revolution in Armenia; a week-long war
// across Anatolia and the Caucasus; the Gulf; a golden age; Pakistan; an embargo; a world war; a nuclear
// exchange; the aftermath. Statistics count in its shots, missiles fly in its salvos, fronts advance in its
// conquests. The data service builds it into the projects folder when it is chosen among the examples.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectRegistry, ProjectInfo } from '../server/projects.ts';
import { World } from '../world-model/world.ts';
import { Engine } from '../temporal-engine/engine.ts';
import * as cmd from '../domain/commands.ts';
import { decodeCountries, COUNTRY_GROUP_COLORS, type CountriesFile, type CountryShape } from '../domain/countries.ts';
import { decodeRegions, type RegionsFile, type PickRegion } from '../domain/regions.ts';
import { gregorian, NEG_INF, toJSONValue, type Instant } from '../core-time/index.ts';
import { DEFAULT_TEXT_BOX, DEFAULT_TRANSITIONS, withTransitionLook, type Overlay, type ShotSettings, type Ease, type TextBox } from '../presentation/sequence.ts';
import { statKey, type Statistic } from '../presentation/statistics.ts';
import type { Camera } from '../render-engine/camera.ts';
import type { TransitionSpec } from '../temporal-engine/engine.ts';
import { story, type Place } from './greater-armenia-story.ts';

export const GREATER_ARMENIA = { id: 'greater-armenia', name: 'Greater Armenia, 2039 to 2178', about: 'A future history from an outline: a revolution in Armenia, the Week War, the Gulf, a golden age in space mining, Pakistan, a world war and a nuclear exchange, and what was left. Nine shots, statistics counting, missiles flying.' };

/** A moment, in the Gregorian calendar (UTC). */
export const D = (year: number, month = 1, day = 1, hour = 0, minute = 0): Instant => gregorian.fromCivil({ year, month, day, hour, minute });

/** A small circle (a ring of places) around a place, `km` across its radius. */
export function circle([lon, lat]: Place, km: number, n = 24): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dLat = km / 111.2, dLon = km / (111.2 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return out;
}

/** The builder's handle on the project as it is being made. */
export interface Builder {
  world: World; engine: Engine; space: string; layer: string;
  commit<T>(r: cmd.CommandResult<T>): T;
  /** Several commands saved as one step. */
  commitAll(label: string, rs: Array<cmd.CommandResult<unknown>>): void;
  country(name: string): string;
  countries: CountryShape[]; regions: PickRegion[];
  /** Regions of a country: all, by name, or by a test. */
  regionsOf(country: string, pick?: string[] | ((r: PickRegion) => boolean)): cmd.CountryToAdd[];
  shape(name: string): cmd.CountryToAdd;
  group(name: string): string;
}

/** Build the example into the registry's folder; returns the project made. */
export function buildGreaterArmenia(reg: ProjectRegistry, dataDir: string, name = 'Greater Armenia (example)'): ProjectInfo {
  const info = reg.create(name);
  const db = reg.get(info.id);
  const world = World.fromSnapshot(db.snapshot());
  const engine = new Engine(world);
  const space = world.all('map_space')[0].id, layer = world.all('layer').find((l) => l.space_id === space && l.kind === 'partition')!.id;
  const commit = <T>(r: cmd.CommandResult<T>): T => { if (r.diffs.length) db.commit(r.label, r.diffs, db.journalState().head); return r.result; };
  const countries = decodeCountries(JSON.parse(readFileSync(join(dataDir, 'natural-earth', 'countries-50m.json'), 'utf8')) as CountriesFile);
  const regions = decodeRegions(JSON.parse(readFileSync(join(dataDir, 'natural-earth', 'regions-10m.json'), 'utf8')) as RegionsFile);
  const groups = new Map<string, string>();
  const b: Builder = {
    world, engine, space, layer, commit, countries, regions,
    commitAll(label, rs) { const diffs = rs.flatMap((r) => r.diffs); if (diffs.length) db.commit(label, diffs, db.journalState().head); },
    country(n) {
      const e = world.all('entity').find((x) => (x.type_id === 'polity' || x.type_id === 'faction') && x.name === n);
      if (!e) throw new Error(`No country called ${n}.`);
      return e.id;
    },
    regionsOf(country, pick) {
      const all = regions.filter((r) => r.country === country);
      const chosen = !pick ? all : Array.isArray(pick) ? all.filter((r) => pick.includes(r.name)) : all.filter(pick);
      if (Array.isArray(pick)) for (const n of pick) if (!all.some((r) => r.name === n)) throw new Error(`No region ${n} in ${country}.`);
      return chosen.map((r) => ({ name: r.name, polygons: r.polygons }));
    },
    shape(n) {
      const c = countries.find((x) => x.name === n);
      if (!c) throw new Error(`No shape for ${n}.`);
      return { name: c.name, polygons: c.polygons };
    },
    group(n) {
      let id = groups.get(n);
      if (!id) { id = commit(cmd.createEventGroup(world, n)); groups.set(n, id); }
      return id;
    },
  };
  // The map: the Earth's geography, today's countries as they are drawn in 2026.
  commit(cmd.setWorldBasemap(world, space, 'natural-earth'));
  commit(cmd.updateLayer(world, layer, { name: 'Countries' }));
  commit(cmd.setLayerClipToLand(world, layer, true));
  commit(cmd.setWorldShow(world, space, { minLakeKm2: 1000 }));
  commit(cmd.addCountries(world, engine, {
    spaceId: space, layerId: layer, mode: { kind: 'correct', t: NEG_INF },
    countries: countries.map((c) => ({ name: c.name, polygons: c.polygons, color: COUNTRY_GROUP_COLORS[c.colorGroup - 1] })),
  }));
  story(b);
  return info;
}

// ---------------------------------------------------------------- helpers for the story

/** An event in a group, with its description. */
export function event(b: Builder, name: string, start: Instant, end: Instant | null, o: { type?: string; about?: string; group?: string; look?: string } = {}): string {
  const id = b.commit(cmd.createEvent(b.world, { name, start, end, type_id: o.type ?? 'general', description: o.about ?? '', precision: start.ms ? 'minute' : 'day', groups: o.group ? [b.group(o.group)] : [] }));
  if (o.look) b.commit(cmd.setEventLook(b.world, id, o.look));
  return id;
}

const ADVANCE: TransitionSpec = { style: 'border', easing: 'smooth' };

/** Land of `from` inside the regions given goes to `to` at `at` of an event (its start when absent). */
export function take(b: Builder, eventId: string, to: string, from: string[], regions: cmd.CountryToAdd[], at: Instant | null = null, transition: TransitionSpec | null = ADVANCE): void {
  if (!regions.length) throw new Error('No regions to take.');
  b.commit(cmd.addCountries(b.world, b.engine, { spaceId: b.space, layerId: b.layer, countries: regions, mode: { kind: 'new', eventId, at }, into: to, onlyFrom: from, transition }));
}

/** Everything `from` holds goes to `to`. */
export function annex(b: Builder, eventId: string, to: string, from: string[], at: Instant | null = null, transition: TransitionSpec | null = ADVANCE): void {
  for (const f of from) b.commit(cmd.annex(b.world, b.engine, { spaceId: b.space, layerId: b.layer, eventId, from: b.country(f), to, at, transition }));
}

/** Land of these owners inside (or with `outside`, outside) the regions becomes nobody's. */
export function clear(b: Builder, eventId: string, from: string[], regions: cmd.CountryToAdd[], o: { at?: Instant | null; outside?: boolean; transition?: TransitionSpec | null } = {}): void {
  b.commit(cmd.addCountries(b.world, b.engine, { spaceId: b.space, layerId: b.layer, countries: regions, mode: { kind: 'new', eventId, at: o.at ?? null }, onlyFrom: from, clear: true, outside: o.outside, transition: o.transition === undefined ? { style: 'dissolve' } : o.transition }));
}

/** Every country's land but these owners' becomes nobody's, at `at` of the event. */
export function clearAllBut(b: Builder, eventId: string, keep: string[], at: Instant | null, transition: TransitionSpec | null): void {
  const t = at ?? gregorian.fromCivil({ year: 3000 });
  const kept = new Set(keep);
  const leaves: number[] = [];
  for (const [f, st] of b.engine.partitionState(b.space, b.layer, at ?? t)) if (st.value && !kept.has(st.value)) leaves.push(f);
  if (leaves.length) b.commit(cmd.assignFaces(b.world, b.engine, { spaceId: b.space, layerId: b.layer, leaves, value: null, mode: { kind: 'new', eventId, at }, transition }));
}

/** A layer of areas, lines or points with a look. */
export function featureLayer(b: Builder, name: string, kind: 'area' | 'line' | 'point', style: Record<string, unknown>): string {
  const id = b.commit(cmd.createLayer(b.world, b.space, name, kind));
  b.commit(cmd.updateLayer(b.world, id, { style: JSON.stringify(style) }));
  return id;
}

/** A line or point drawn in an event (drawing itself, or appearing), and gone at `until` if given. */
export function feature(b: Builder, layerId: string, name: string, parts: Array<Array<[number, number]>>, eventId: string, o: { at?: Instant | null; anim?: 'draw' | 'grow' | 'fade' | null; until?: Instant; entity?: string; style?: Record<string, unknown> } = {}): string {
  const id = b.commit(cmd.createFeature(b.world, { layerId, name, parts, entity: o.entity, mode: { kind: 'new', eventId, at: o.at ?? null }, anim: o.anim === undefined ? 'draw' : o.anim, style: o.style }));
  if (o.until) b.commit(cmd.endFeature(b.world, b.engine, { feature: id, mode: { kind: 'change', t: o.until } }));
  return id;
}

/** A city (a dated point of the cities layer), there from the beginning. */
export function city(b: Builder, name: string, [lon, lat]: Place): string {
  const id = b.commit(cmd.createEntity(b.world, { type_id: 'settlement', name }));
  b.commit(cmd.placeCharacter(b.world, { spaceId: b.space, entity: id, lon, lat, mode: { kind: 'correct', t: NEG_INF } }));
  return id;
}

/** A statistic from (date, value) pairs. */
export function stat(name: string, format: Statistic['format'], ease: Statistic['ease'], keys: Array<[Instant, number]>): Statistic {
  return { name, format, ease, keys: keys.map(([t, v]) => statKey(t, v)) };
}

// ---------------------------------------------------------------- shots

export interface Caption {
  text: string; from: Instant; to: Instant | null;
  /** Where (0 to 1 of the frame); a callout points at `anchor`. */
  x?: number; y?: number; anchor?: Place; size?: number; align?: Overlay['align']; color?: string; enter?: TextBox['enter'];
}

export interface ShotPlan {
  name: string; title: string; subtitle?: string;
  /** Seconds of screen time and the moment shown then (in order). */
  time: Array<[number, Instant, Ease?]>;
  /** Seconds and the camera then (one: still). */
  camera: Array<[number, Partial<Camera>]>;
  captions: Caption[];
  /** A box of statistics, top right, for the whole shot. */
  stats?: string;
  look?: 'classic' | 'wartime' | 'night' | 'atlas' | 'parchment';
  transitions?: string;
  eventsBox?: boolean | { groups: string[] };
  cities?: boolean;
  /** Characters' markers (absent: hidden). */
  characters?: boolean;
  /** Layers (by name) left out of the shot. */
  hide?: string[];
  precision?: 'day' | 'minute' | 'year' | 'month';
}

const FPS = 30;
let boxes = 0;

function captionOverlay(c: Caption, frames: number): Overlay {
  const box: TextBox = {
    ...DEFAULT_TEXT_BOX, wrap: c.anchor ? 460 : 760, outline: null, padding: 16, radius: 10,
    timing: { by: 'history', from: toJSONValue(c.from) as [number, number], to: c.to ? toJSONValue(c.to) as [number, number] : null },
    enter: c.enter ?? 'rise', exit: 'fade', seconds: 0.6, anchor: c.anchor ?? null, pointer: '#ffd27a',
  };
  return {
    id: `text-${++boxes}`, kind: 'text', text: c.text, x: c.x ?? (c.anchor ? 0.66 : 0.5), y: c.y ?? (c.anchor ? 0.3 : 0.2), size: c.size ?? 32,
    color: c.color ?? '#f6f1e7', background: 'rgba(10,14,22,0.78)', align: c.align ?? (c.anchor ? 'left' : 'center'), inFrame: 0, outFrame: frames - 1, fade: 0, datePrecision: 'day', box,
  };
}

/** A shot from a plan: its time and camera keys, title, date, captions, statistics and the events box. */
export function shot(b: Builder, p: ShotPlan): string {
  const seconds = p.time[p.time.length - 1][0];
  const frames = Math.round(seconds * FPS) + 1;
  const base: Camera = { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equalEarth' };
  const s: ShotSettings = {
    spaceId: b.space, width: 1920, height: 1080, fps: FPS, frames,
    time: p.time.map(([sec, t, ease]) => ({ frame: Math.round(sec * FPS), at: toJSONValue(t), ease: ease ?? 'linear' })),
    camera: (p.camera.length === 1 ? [p.camera[0], [seconds, p.camera[0][1]] as [number, Partial<Camera>]] : p.camera).map(([sec, c]) => ({ frame: Math.round(sec * FPS), camera: { ...base, ...c }, ease: 'smooth' as Ease })),
    overlays: [
      { id: 'date', kind: 'date', text: '{date}', x: 0.04, y: 0.92, size: 46, color: '#f6f1e7', background: 'rgba(10,14,22,0.7)', align: 'left', inFrame: 0, outFrame: frames - 1, fade: 0, datePrecision: p.precision ?? 'day' },
      { id: 'title', kind: 'text', text: p.title, x: 0.5, y: 0.06, size: 50, color: '#f6f1e7', background: 'rgba(10,14,22,0.7)', align: 'center', inFrame: 0, outFrame: Math.min(frames - 1, 6 * FPS), fade: Math.round(0.8 * FPS), datePrecision: 'day' },
      ...(p.subtitle ? [{ id: 'subtitle', kind: 'text' as const, text: p.subtitle, x: 0.5, y: 0.125, size: 28, color: '#d9d2c4', background: null, align: 'center' as const, inFrame: 0, outFrame: Math.min(frames - 1, 6 * FPS), fade: Math.round(0.8 * FPS), datePrecision: 'day' as const }] : []),
      ...(p.stats ? [{ ...captionOverlay({ text: p.stats, from: gregorian.fromCivil({ year: 1 }), to: null, x: 0.04, y: 0.79, size: 28, align: 'left', enter: 'fade' }, frames) }] : []),
      ...p.captions.map((c) => captionOverlay(c, frames)),
    ],
    layers: p.hide ? b.world.all('layer').filter((l) => l.space_id === b.space && l.visible && !p.hide!.includes(l.name)).map((l) => l.id) : [], graticule: false, labels: true, cities: p.cities ?? true, characters: p.characters ?? false, transparent: false,
    look: { id: p.look ?? 'classic' },
    transitions: withTransitionLook({ ...DEFAULT_TRANSITIONS, mode: 'recorded', restyleRecorded: false, seconds: 1.2 }, p.transitions ?? 'clean'),
    ...(p.eventsBox ? { eventsBox: { show: true, corner: 'bottom-right', maxEvents: 3, showDescription: true, linger: 4, width: 500, title: 'Events', ...(typeof p.eventsBox === 'object' ? { groups: p.eventsBox.groups.map((g) => b.group(g)) } : {}) } } : {}),
  };
  return b.commit(cmd.createSequence(b.world, p.name, s));
}
