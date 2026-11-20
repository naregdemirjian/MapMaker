// The examples' kit (D171, D176): what the example projects are built with, through the same commands the interface
// uses. A builder holds the project being made (its world, engine, map and political layer, which can change to
// another map), saves each command as one step, and offers today's countries, their regions and places as material;
// helpers make events, territorial changes (whole countries, regions, outlines), features, cities, characters,
// statistics and shots in a few words each.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectRegistry, ProjectInfo } from '../server/projects.ts';
import { World } from '../world-model/world.ts';
import { Engine } from '../temporal-engine/engine.ts';
import * as cmd from '../domain/commands.ts';
import { decodeCountries, COUNTRY_GROUP_COLORS, type CountriesFile, type CountryShape } from '../domain/countries.ts';
import { decodeRegions, type RegionsFile, type PickRegion } from '../domain/regions.ts';
import { decodePlaces, type PlacesFile, type TodayPlace } from '../domain/places.ts';
import { gregorian, NEG_INF, toJSONValue, type Instant } from '../core-time/index.ts';
import { DEFAULT_TEXT_BOX, DEFAULT_TRANSITIONS, withTransitionLook, type Overlay, type ShotSettings, type Ease, type TextBox } from '../presentation/sequence.ts';
import { statKey, type Statistic } from '../presentation/statistics.ts';
import type { Camera } from '../render-engine/camera.ts';
import type { TransitionSpec } from '../temporal-engine/engine.ts';

export type Place = [number, number];

/** A moment, in the Gregorian calendar (UTC). */
export const D = (year: number, month = 1, day = 1, hour = 0, minute = 0): Instant => gregorian.fromCivil({ year, month, day, hour, minute });

/** A small circle (a ring of places) around a place, `km` across its radius. */
export function circle([lon, lat]: Place, km: number, n = 24): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dLat = km / 111.2, dLon = km / (111.2 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return out;
}

/** An outline (one ring of places) as land to give. */
export const outline = (name: string, ...rings: Array<Array<[number, number]>>): cmd.CountryToAdd => ({ name, polygons: rings.map((r) => [r]) });

/** The builder's handle on the project as it is being made. */
export interface Builder {
  world: World; engine: Engine;
  /** The map and political layer the helpers work on (see useMap). */
  space: string; layer: string;
  commit<T>(r: cmd.CommandResult<T>): T;
  /** Several commands saved as one step. */
  commitAll(label: string, rs: Array<cmd.CommandResult<unknown>>): void;
  /** A country or faction by name (made, in this colour, if `color` is given and there is none). */
  country(name: string, color?: string): string;
  readonly countries: CountryShape[]; readonly regions: PickRegion[]; readonly places: TodayPlace[];
  /** Regions of a country: all, by name, or by a test. */
  regionsOf(country: string, pick?: string[] | ((r: PickRegion) => boolean)): cmd.CountryToAdd[];
  shape(name: string): cmd.CountryToAdd;
  group(name: string, color?: string): string;
  /** Work on another map (its first political layer). */
  useMap(spaceId: string): void;
  /**
   * Record into a branch (D179), with an engine of its own answering what is where in it ("land of these owners"
   * is that branch's land, not the main timeline's); or into the main timeline again.
   */
  useBranch(branch: string): void;
  /** Events made so far by `event` (simple and with changes). */
  events: number;
}

/**
 * A new project in the registry's folder, with the data the examples draw on (read when first used); its first
 * map the Earth, or a round map of the name and radius given (D179: a world of one's own).
 */
export function startProject(reg: ProjectRegistry, dataDir: string, name: string, firstWorld?: { name: string; radiusKm: number }): { info: ProjectInfo; b: Builder } {
  const info = reg.create(name, firstWorld);
  const db = reg.get(info.id);
  const world = World.fromSnapshot(db.snapshot());
  const engine = new Engine(world);
  const commit = <T>(r: cmd.CommandResult<T>): T => { if (r.diffs.length) db.commit(r.label, r.diffs, db.journalState().head); return r.result; };
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(dataDir, 'natural-earth', f), 'utf8')) as T;
  let countries: CountryShape[] | null = null, regions: PickRegion[] | null = null, places: TodayPlace[] | null = null;
  const groups = new Map<string, string>();
  const space = world.all('map_space')[0].id;
  const engines = new Map<string, Engine>([[world.branch, engine]]);
  const b: Builder = {
    world, engine, space, layer: world.all('layer').find((l) => l.space_id === space && l.kind === 'partition')!.id, commit, events: 0,
    commitAll(label, rs) { const diffs = rs.flatMap((r) => r.diffs); if (diffs.length) db.commit(label, diffs, db.journalState().head); },
    get countries() { return (countries ??= decodeCountries(read<CountriesFile>('countries-50m.json'))); },
    get regions() { return (regions ??= decodeRegions(read<RegionsFile>('regions-10m.json'))); },
    get places() { return (places ??= decodePlaces(read<PlacesFile>('places-10m.json'))); },
    country(n, color) {
      const e = world.all('entity').find((x) => (x.type_id === 'polity' || x.type_id === 'faction') && x.name === n);
      if (e) return e.id;
      if (color === undefined) throw new Error(`No country called ${n}.`);
      return commit(cmd.createEntity(world, { type_id: 'polity', name: n, color }));
    },
    regionsOf(country, pick) {
      const all = b.regions.filter((r) => r.country === country);
      const chosen = !pick ? all : Array.isArray(pick) ? all.filter((r) => pick.includes(r.name)) : all.filter(pick);
      if (Array.isArray(pick)) for (const n of pick) if (!all.some((r) => r.name === n)) throw new Error(`No region ${n} in ${country}.`);
      return chosen.map((r) => ({ name: r.name, polygons: r.polygons }));
    },
    shape(n) {
      const c = b.countries.find((x) => x.name === n);
      if (!c) throw new Error(`No shape for ${n}.`);
      return { name: c.name, polygons: c.polygons };
    },
    group(n, color) {
      let id = groups.get(n);
      if (!id) { id = commit(cmd.createEventGroup(world, n, color)); groups.set(n, id); }
      return id;
    },
    useMap(spaceId) {
      b.space = spaceId;
      b.layer = world.all('layer').find((l) => l.space_id === spaceId && l.kind === 'partition')?.id ?? '';
    },
    useBranch(branch) {
      world.branch = branch;
      let e = engines.get(branch);
      if (!e) engines.set(branch, (e = new Engine(world, branch)));
      b.engine = e;
    },
  };
  return { info, b };
}

/** Today's countries on the builder's map, from the beginning, in the map's colours (a list of names: those only). */
export function todaysCountries(b: Builder, names?: string[]): void {
  const list = names ? b.countries.filter((c) => names.includes(c.name)) : b.countries;
  if (names) for (const n of names) if (!list.some((c) => c.name === n)) throw new Error(`No country ${n} today.`);
  b.commit(cmd.addCountries(b.world, b.engine, {
    spaceId: b.space, layerId: b.layer, mode: { kind: 'correct', t: NEG_INF },
    countries: list.map((c) => ({ name: c.name, polygons: c.polygons, color: COUNTRY_GROUP_COLORS[(c.colorGroup - 1 + COUNTRY_GROUP_COLORS.length) % COUNTRY_GROUP_COLORS.length] })),
  }));
}

// ---------------------------------------------------------------- events and changes

/** An event in a group, with its description. */
export function event(b: Builder, name: string, start: Instant, end: Instant | null, o: { type?: string; about?: string; group?: string; look?: string; precision?: string } = {}): string {
  const id = b.commit(cmd.createEvent(b.world, { name, start, end, type_id: o.type ?? 'general', description: o.about ?? '', precision: o.precision ?? (start.ms ? 'minute' : 'day'), groups: o.group ? [b.group(o.group)] : [] }));
  if (o.look) b.commit(cmd.setEventLook(b.world, id, o.look));
  b.events++;
  return id;
}

export const ADVANCE: TransitionSpec = { style: 'border', easing: 'smooth' };

/** Land inside the regions or outlines given goes to `to` at `at` of an event (its start when absent); with `from`, only land they hold. */
export function take(b: Builder, eventId: string, to: string, from: string[] | null, regions: cmd.CountryToAdd[], at: Instant | null = null, transition: TransitionSpec | null = ADVANCE): void {
  if (!regions.length) throw new Error('No regions to take.');
  b.commit(cmd.addCountries(b.world, b.engine, { spaceId: b.space, layerId: b.layer, countries: regions, mode: { kind: 'new', eventId, at }, into: to, onlyFrom: from ?? undefined, transition }));
}

/** Land inside the regions or outlines is `to`'s from the beginning (the starting map). */
export function startWith(b: Builder, to: string, regions: cmd.CountryToAdd[], from?: string[]): void {
  b.commit(cmd.addCountries(b.world, b.engine, { spaceId: b.space, layerId: b.layer, countries: regions, mode: { kind: 'correct', t: NEG_INF }, into: to, onlyFrom: from }));
}

/** Everything each of `from` holds goes to `to`. */
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

/** A country's name from an event on. */
export function rename(b: Builder, eventId: string, entity: string, name: string): void {
  b.commit(cmd.renameFrom(b.world, { entity, name, mode: { kind: 'new', eventId } }));
}

// ---------------------------------------------------------------- features, cities, characters

/** A layer of areas, lines or points with a look. */
export function featureLayer(b: Builder, name: string, kind: 'area' | 'line' | 'point', style: Record<string, unknown>): string {
  const id = b.commit(cmd.createLayer(b.world, b.space, name, kind));
  b.commit(cmd.updateLayer(b.world, id, { style: JSON.stringify(style) }));
  return id;
}

/**
 * A line, area or point drawn in an event (drawing itself, or appearing: over the rest of the event, or until
 * `animUntil`), and gone at `until` if given.
 */
export function feature(b: Builder, layerId: string, name: string, parts: Array<Array<[number, number]>>, eventId: string, o: { at?: Instant | null; anim?: 'draw' | 'grow' | 'fade' | null; animUntil?: Instant; until?: Instant; entity?: string; style?: Record<string, unknown> } = {}): string {
  const id = b.commit(cmd.createFeature(b.world, { layerId, name, parts, entity: o.entity, mode: { kind: 'new', eventId, at: o.at ?? null }, anim: o.anim === undefined ? 'draw' : o.anim, animUntil: o.animUntil ?? null, style: o.style }));
  if (o.until) b.commit(cmd.endFeature(b.world, b.engine, { feature: id, mode: { kind: 'change', t: o.until } }));
  return id;
}

/** A feature there from the beginning (a wall, a road, a river). */
export function fixture(b: Builder, layerId: string, name: string, parts: Array<Array<[number, number]>>, style?: Record<string, unknown>): string {
  return b.commit(cmd.createFeature(b.world, { layerId, name, parts, mode: { kind: 'correct', t: NEG_INF }, style }));
}

/** A city (a dated point of the cities layer), there from the beginning, or founded at a date. */
export function city(b: Builder, name: string, [lon, lat]: Place, founded?: Instant): string {
  const id = b.commit(cmd.createEntity(b.world, { type_id: 'settlement', name }));
  b.commit(cmd.placeCharacter(b.world, { spaceId: b.space, entity: id, lon, lat, mode: founded ? { kind: 'change', t: founded } : { kind: 'correct', t: NEG_INF } }));
  return id;
}

/** A character travelling: at each (moment, place), in an event or not. */
export function journey(b: Builder, name: string, legs: Array<[Instant, Place]>, o: { notes?: string; eventId?: string; leaves?: Instant; icon?: string } = {}): string {
  const id = b.commit(cmd.createEntity(b.world, { type_id: 'character', name, notes: o.notes }));
  legs.forEach(([t, [lon, lat]], i) => b.commit(cmd.placeCharacter(b.world, { spaceId: b.space, entity: id, lon, lat, mode: o.eventId ? { kind: 'new', eventId: o.eventId, at: t } : { kind: 'change', t }, arrive: i === 0 ? 'jump' : 'travel' })));
  if (o.leaves) b.commit(cmd.characterLeaves(b.world, { spaceId: b.space, entity: id, mode: { kind: 'change', t: o.leaves } }));
  return id;
}

/** A statistic from (date, value) pairs (`decimals`: digits after the point, absent: as the format says). */
export function stat(name: string, format: Statistic['format'], ease: Statistic['ease'], keys: Array<[Instant, number]>, decimals?: number): Statistic {
  return { name, format, ease, keys: keys.map(([t, v]) => statKey(t, v)), ...(decimals !== undefined ? { decimals } : {}) };
}

/** A moment `days` (and `hours`; either may have a fraction) after another. */
export const later = (t: Instant, days: number, hours = 0): Instant => {
  const ms = t.ms + Math.round(days * 86_400_000 + hours * 3_600_000);
  return { day: t.day + Math.floor(ms / 86_400_000), ms: ((ms % 86_400_000) + 86_400_000) % 86_400_000 };
};

/** A small random number generator (the same numbers each time for the same seed). */
export function seeded(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
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
  /** A box of statistics, bottom left, for the whole shot. */
  stats?: string;
  look?: 'classic' | 'wartime' | 'night' | 'atlas' | 'parchment' | 'blueprint' | 'minimal';
  transitions?: string;
  eventsBox?: boolean | { groups: string[] };
  cities?: boolean;
  /** Characters' markers (absent: hidden). */
  characters?: boolean;
  /** Each character's route so far. */
  trails?: boolean;
  /** Layers (by name) left out of the shot. */
  hide?: string[];
  precision?: 'day' | 'minute' | 'year' | 'month';
  /** The projection (absent: Equal Earth). */
  projection?: Camera['projection'];
  /** The timeline shown (a branch's id). */
  branch?: string;
}

const FPS = 30;
let boxes = 0;

export function captionOverlay(c: Caption, frames: number): Overlay {
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
  const base: Camera = { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: p.projection ?? 'equalEarth' };
  const first = p.time[0][1];
  const s: ShotSettings = {
    spaceId: b.space, width: 1920, height: 1080, fps: FPS, frames,
    ...(p.branch ? { branch: p.branch } : {}),
    time: p.time.map(([sec, t, ease]) => ({ frame: Math.round(sec * FPS), at: toJSONValue(t), ease: ease ?? 'linear' })),
    camera: (p.camera.length === 1 ? [p.camera[0], [seconds, p.camera[0][1]] as [number, Partial<Camera>]] : p.camera).map(([sec, c]) => ({ frame: Math.round(sec * FPS), camera: { ...base, ...c }, ease: 'smooth' as Ease })),
    overlays: [
      { id: 'date', kind: 'date', text: '{date}', x: 0.04, y: 0.92, size: 46, color: '#f6f1e7', background: 'rgba(10,14,22,0.7)', align: 'left', inFrame: 0, outFrame: frames - 1, fade: 0, datePrecision: p.precision ?? 'day' },
      { id: 'title', kind: 'text', text: p.title, x: 0.5, y: 0.06, size: 50, color: '#f6f1e7', background: 'rgba(10,14,22,0.7)', align: 'center', inFrame: 0, outFrame: Math.min(frames - 1, 6 * FPS), fade: Math.round(0.8 * FPS), datePrecision: 'day' },
      // (On a box of its own, readable over light land and sea.)
      ...(p.subtitle ? [{ id: 'subtitle', kind: 'text' as const, text: p.subtitle, x: 0.5, y: 0.128, size: 28, color: '#e6dfd1', background: 'rgba(10,14,22,0.6)', align: 'center' as const, inFrame: 0, outFrame: Math.min(frames - 1, 6 * FPS), fade: Math.round(0.8 * FPS), datePrecision: 'day' as const }] : []),
      // (The statistics box shows from long before the shot's first moment, whatever its calendar.)
      ...(p.stats ? [{ ...captionOverlay({ text: p.stats, from: { day: first.day - 1e7, ms: 0 }, to: null, x: 0.04, y: 0.79, size: 28, align: 'left', enter: 'fade' }, frames) }] : []),
      ...p.captions.map((c) => captionOverlay(c, frames)),
    ],
    layers: p.hide ? b.world.all('layer').filter((l) => l.space_id === b.space && l.visible && !p.hide!.includes(l.name)).map((l) => l.id) : [], graticule: false, labels: true, cities: p.cities ?? true, characters: p.characters ?? false, trails: p.trails ?? false, ...(p.trails ? { trailsFrom: 'shot' as const } : {}), transparent: false,
    look: { id: p.look ?? 'classic' },
    transitions: withTransitionLook({ ...DEFAULT_TRANSITIONS, mode: 'recorded', restyleRecorded: false, seconds: 1.2 }, p.transitions ?? 'clean'),
    ...(p.eventsBox ? { eventsBox: { show: true, corner: 'bottom-right', maxEvents: 3, showDescription: true, linger: 4, width: 500, title: 'Events', hideWhenEmpty: true, datePrecision: p.precision ?? 'day', ...(typeof p.eventsBox === 'object' ? { groups: p.eventsBox.groups.map((g) => b.group(g)) } : {}) } } : {}),
  };
  return b.commit(cmd.createSequence(b.world, p.name, s));
}
