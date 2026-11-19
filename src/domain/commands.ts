// Domain commands: every user action is one of these. Each runs inside a transaction against the
// in-memory world and returns the exact row diffs to save (and to undo). Commands never draw anything.
import { calendarProblems, type CalendarDef } from '../core-time/index.ts';
import { World, Tx, newId } from '../world-model/world.ts';
import {
  Engine, canonicalFaces, leafDescendants, childrenMap, hashFaces, parseJSON, effectTime, eventStart, type Resolution, type TransitionSpec, type AnnexIntent, type PlaceIntent, type RenameIntent, type ShapeIntent, type RelateIntent, type SystemIntent, type LaneIntent, laneKey, type FeatureAnimStyle, isFeatureAnim,
} from '../temporal-engine/engine.ts';
import { type Instant, toStore, fromStore, NEG_INF, compare, isFiniteInstant } from '../core-time/index.ts';
import { branchAt, branchCuts, seenAt, branchName, branchAndBelow, branchLine } from '../temporal-engine/branches.ts';
import {
  BASE_EVENT_ID, MAIN_BRANCH, SCHEMA_VERSION, baseEventOf, isBaseEvent, type RowDiff, type EffectRow, type EventRow, type EntityRow, type LayerKind, type FeatureRow, type RelationRow,
} from '../world-model/schema.ts';
import { type Vec3, vecToLonLat, normalize } from '../geo-kernel/vec.ts';
import { TopologyError, type PathStep } from '../geo-kernel/arrangement.ts';
import { worldSettings, terrainSourceOf, EARTH_RADIUS_KM, type BasemapSource, type ShowSet, type ShowSettings } from '../world-model/world-settings.ts';
import { skyLookOf, type SkyLook } from '../space/sky-look.ts';
import { terrainLookOf, DEFAULT_TERRAIN_LOOK, type TerrainLook } from '../terrain/look.ts';
import { cleanSeaLevel, type SeaLevelPoint } from '../terrain/sea-level.ts';
import { planetParamsOf, PLANET_PRESETS, type PlanetParams } from '../terrain/planet.ts';
import { cleanStamps, isSculptTool, SCULPT_TOOLS, type TerrainStamp } from '../terrain/sculpt.ts';
import { resolvePointStyle, type LabelStyle, type CountryLabel, type PointStyle } from '../render-engine/label-style.ts';
import { DEFAULT_FEATURE_STYLE, isFeatureKind, type FeatureKind, type FeatureStyle } from '../render-engine/feature-style.ts';
import { relationKind, isRelationKind, type RelationKind } from './relations.ts';
import { DEFAULT_SOURCES, fieldLayerStyleOf, fieldSourceOf, isFieldType, FIELD_TYPES, type FieldSource, type FieldType } from './fields.ts';
import { planDisaster, isDisasterId, type DisasterId } from './disasters.ts';
import { cleanIcon, type CharacterIcon, type RouteStyle } from '../render-engine/icons.ts';
import type { TerritoryFill, FrontTeeth } from '../render-engine/map-renderer.ts';
export type { CharacterIcon } from '../render-engine/icons.ts';
export { FEATURE_KINDS, DEFAULT_FEATURE_STYLE, isFeatureKind, featureStyle, type FeatureKind, type FeatureStyle } from '../render-engine/feature-style.ts';
import { ringFromMapPoints } from '../render-engine/stroke.ts';
import { TRANSITION_LOOKS } from '../presentation/sequence.ts';
import { flatRadiusKm } from '../render-engine/camera.ts';

export interface CommandResult<T = unknown> { label: string; diffs: RowDiff[]; result: T }

export function run<T>(world: World, label: string, fn: (tx: Tx) => T): CommandResult<T> {
  const tx = new Tx(world);
  try {
    const result = fn(tx);
    return { label, diffs: tx.finish(), result };
  } catch (e) {
    tx.rollback();
    throw e;
  }
}

export const BUILTIN_ENTITY_TYPES = [
  { id: 'polity', name: 'Country or territory', category: 'political' },
  { id: 'faction', name: 'Faction or organisation', category: 'political' },
  { id: 'character', name: 'Character', category: 'people' },
  { id: 'settlement', name: 'City or settlement', category: 'places' },
  { id: 'unit', name: 'Military unit', category: 'military' },
  { id: 'body', name: 'Planet, moon or habitat', category: 'astronomy' },
];

export const BUILTIN_EVENT_TYPES = [
  { id: 'base', name: 'Base world' },
  { id: 'general', name: 'Event' },
  { id: 'founding', name: 'Founding' },
  { id: 'conquest', name: 'Conquest' },
  { id: 'war', name: 'War' },
  { id: 'treaty', name: 'Treaty' },
  { id: 'revolution', name: 'Revolution' },
  { id: 'collapse', name: 'Collapse' },
  { id: 'disaster', name: 'Disaster' },
];

const PALETTE = ['#c8553d', '#2f7f8f', '#d9a441', '#6a4c93', '#3a7d44', '#b5446e', '#3d5a80', '#e07a5f', '#81b29a', '#9c6644', '#5e60ce', '#c9a227'];

export function suggestColor(world: World): string {
  const used = new Set(world.all('entity').map((e) => e.color));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[world.all('entity').length % PALETTE.length];
}

// ---------------------------------------------------------------- project and worlds

/** Initial content of a new project: types, the base-world event and a first world. */
export function seedProject(world: World, name: string, firstWorld = { name: 'Earth', radiusKm: 6371.0088 }): CommandResult<{ spaceId: string }> {
  return run(world, 'Create project', (tx) => {
    tx.insert('meta', { key: 'schema_version', value: String(SCHEMA_VERSION) });
    tx.insert('meta', { key: 'project_name', value: name });
    tx.insert('meta', { key: 'created_at', value: new Date().toISOString() });
    for (const t of BUILTIN_ENTITY_TYPES) tx.insert('entity_type', { ...t, builtin: 1 });
    for (const t of BUILTIN_EVENT_TYPES) tx.insert('event_type', { ...t, builtin: 1, fields: '{}' });
    const [sd, sm] = toStore(NEG_INF);
    tx.insert('event', {
      id: BASE_EVENT_ID, type_id: 'base', branch_id: MAIN_BRANCH, name: 'Base world', start_day: sd, start_ms: sm,
      end_day: null, end_ms: null, precision: 'exact', precedence: 0, description: 'How the world is before any recorded event.',
      fields: '{}', presentation: '{}', created_seq: 0, variant_group: null, variant_active: 1,
    });
    return { spaceId: createWorldIn(tx, firstWorld.name, firstWorld.radiusKm, 'natural-earth') };
  });
}

/**
 * A flat map (a city, a region): a plan of the given width, with no geography. Stored as a small part
 * of a large sphere (see camera.ts FLAT_EXTENT_DEG), so it uses the same kernel at no extra cost.
 */
export function createFlatMap(world: World, name: string, widthKm: number): CommandResult<string> {
  if (!(widthKm > 0) || widthKm > 5000) throw new Error('A flat map is between a few metres and 5,000 km wide.');
  return run(world, `Create flat map "${name}"`, (tx) => createWorldIn(tx, name, flatRadiusKm(widthKm), 'none', { kind: 'flat', widthKm }));
}

function createWorldIn(tx: Tx, name: string, radiusKm: number, basemap: BasemapSource, flat?: { kind: 'flat'; widthKm: number }): string {
  const w = tx.world;
  const spaceId = newId('space');
  const bodyId = newId('ent');
  tx.insert('entity', { id: bodyId, type_id: 'body', branch_id: MAIN_BRANCH, name, color: '#7a8b99', notes: '', created_seq: w.nextSeq('entity'), style: '{}', group_id: '' });
  const root = w.ids.next('face');
  tx.insert('map_space', {
    id: spaceId, name, kind: flat ? 'plane' : 'sphere', body_id: bodyId, radius_m: radiusKm * 1000, unit: null, parent_space_id: null,
    root_face: root, sort_order: w.all('map_space').length,
    settings: JSON.stringify(flat ? { projection: 'flat', basemap: 'none', widthKm: flat.widthKm } : { projection: 'equirectangular', basemap }),
  });
  tx.insert('face', { id: root, space_id: spaceId, parent_id: null, is_leaf: 1 });
  tx.insert('layer', {
    id: newId('layer'), space_id: spaceId, kind: 'partition', name: 'Political', sort_order: 0, visible: 1,
    style: JSON.stringify({ fillOpacity: 0.78, borderWidth: 1.4 }), export_pass: 'political',
  });
  return spaceId;
}

/**
 * A generated planet (D97): a round map whose terrain is made from the settings given (the same every
 * time), shown in its preset's colours.
 */
export function createPlanet(world: World, name: string, radiusKm: number, params: PlanetParams): CommandResult<string> {
  if (!(radiusKm > 0)) throw new Error('A round map needs a positive radius.');
  const planet = planetParamsOf(params);
  if (!planet) throw new Error('Those are not settings for a planet.');
  const preset = PLANET_PRESETS[planet.preset];
  return run(world, `Create planet "${name}"`, (tx) => {
    const id = createWorldIn(tx, name, radiusKm, 'none');
    const space = tx.world.get('map_space', id)!;
    tx.update('map_space', { ...space, settings: JSON.stringify({ ...worldSettings(space), planet, terrain: terrainLookOf({ palette: preset.palette, relief: preset.relief }) }) });
    return id;
  });
}

/**
 * A map of the Earth through geological time (D134): the Earth's radius, no present-day geography; its land
 * and sea, mountains and sea floor at the moment shown, from 540 million years ago to today, drawn with relief.
 */
export function createPaleoEarth(world: World, name: string): CommandResult<string> {
  return run(world, `Create map "${name}"`, (tx) => {
    const id = createWorldIn(tx, name, EARTH_RADIUS_KM, 'none');
    const space = tx.world.get('map_space', id)!;
    tx.update('map_space', { ...space, settings: JSON.stringify({ ...worldSettings(space), paleo: true, terrain: terrainLookOf({ palette: 'natural', relief: true, detail: false }) }) });
    return id;
  });
}

/** Makes a planet anew from other settings (D97): its terrain changes everywhere, its history stays. */
export function setWorldPlanet(world: World, spaceId: string, params: PlanetParams): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  if (terrainSourceOf(space) !== 'planet') throw new Error('Only a generated planet can be made anew.');
  const planet = planetParamsOf(params);
  if (!planet) throw new Error('Those are not settings for a planet.');
  return run(world, `Make "${space.name}" anew`, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify({ ...worldSettings(space), planet }) }); });
}

/**
 * A stroke of the sculpting brush (D98), kept in the base world (`from` null) or from a date on: one
 * undoable step. Its path is rounded to about a metre and kept to 600 points at most.
 */
export function addTerrainStamp(world: World, spaceId: string, stamp: Omit<TerrainStamp, 'id'>): CommandResult<string> {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  if (!terrainSourceOf(space)) throw new Error('Only maps of the Earth and generated planets have terrain to sculpt.');
  if (!isSculptTool(stamp.tool)) throw new Error(`Unknown sculpting brush: ${String(stamp.tool)}`);
  let path = (stamp.path ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90).map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] as [number, number]);
  if (!path.length) throw new Error('A stroke needs at least one place on the map.');
  if (path.length > 600) { const step = path.length / 600; path = Array.from({ length: 600 }, (_, i) => path[Math.min(path.length - 1, Math.round(i * step))]); }
  if (!(stamp.radiusKm > 0) || !Number.isFinite(stamp.strength)) throw new Error('A stroke needs a size and a strength.');
  const settings = worldSettings(space);
  return run(world, `Sculpt the terrain (${SCULPT_TOOLS.find((t) => t.id === stamp.tool)!.name.toLowerCase()})`, (tx) => {
    const id = newId('stamp');
    const next = [...cleanStamps(settings.sculpt), ...cleanStamps([{ ...stamp, id, path }])];
    tx.update('map_space', { ...space, settings: JSON.stringify({ ...settings, sculpt: next }) });
    return id;
  });
}

/** Takes every sculpting stroke away (D98), in one undoable step. */
export function clearTerrainStamps(world: World, spaceId: string): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  const { sculpt: _old, ...rest } = worldSettings(space);
  return run(world, `Remove the sculpting of "${space.name}"`, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify(rest) }); });
}

/**
 * A map of the stars around the Sun (D110): the HYG database's stars within 50 light-years, seen in
 * three dimensions. It keeps an empty parcel map, like every map, so that what asks for one finds it.
 */
export function createSpaceMap(world: World, name: string, catalogue: 'nearby' | 'solar' | 'invented' | 'galaxy' = 'nearby', invented?: { seed: number; count: number; radiusLy: number; shape: 'sphere' | 'disc' }, galaxy?: GalaxyChoice): CommandResult<string> {
  if (catalogue === 'invented' && (!invented || !(invented.count >= 2 && invented.count <= 3000) || !(invented.radiusLy >= 5 && invented.radiusLy <= 5000))) throw new Error('An invented star map has between 2 and 3,000 stars, within 5 to 5,000 light-years.');
  if (catalogue === 'galaxy') checkGalaxy(galaxy);
  return run(world, catalogue === 'solar' ? `Create solar system map "${name}"` : catalogue === 'galaxy' ? `Create galaxy map "${name}"` : `Create star map "${name}"`, (tx) => {
    const id = createWorldIn(tx, name, 6371.0088, 'none');
    const space = tx.world.get('map_space', id)!;
    const sp = catalogue === 'solar' ? { catalogue: 'solar', radiusLy: 50, scale: 'compressed' }
      : catalogue === 'invented' ? { catalogue: 'invented', radiusLy: invented!.radiusLy, invented: { ...invented, seed: Math.round(invented!.seed), count: Math.round(invented!.count) } }
      : catalogue === 'galaxy' ? { catalogue: 'galaxy', radiusLy: galaxy!.kind === 'milkyway' ? 60000 : Math.round(galaxy!.radiusLy * 1.2), galaxy: { ...galaxy!, seed: Math.round(galaxy!.seed), systems: Math.round(galaxy!.systems), arms: Math.round(galaxy!.arms) } }
      : { catalogue: 'nearby', radiusLy: 50 };
    tx.update('map_space', { ...space, kind: 'space', settings: JSON.stringify({ projection: 'equirectangular', basemap: 'none', space: sp }) });
    return id;
  });
}

/** A galaxy map's settings (D116): the Milky Way or one's own, how many star systems, its arms, size and bar. */
export interface GalaxyChoice { kind: 'milkyway' | 'invented'; seed: number; systems: number; arms: number; pitch: number; radiusLy: number; bar: boolean }
function checkGalaxy(g: GalaxyChoice | undefined): void {
  if (!g || !(g.systems >= 0 && g.systems <= 5000)) throw new Error('A galaxy map has up to 5,000 star systems.');
  if (g.kind === 'invented' && (!(g.arms >= 1 && g.arms <= 8) || !(g.pitch >= 4 && g.pitch <= 40) || !(g.radiusLy >= 1000 && g.radiusLy <= 500000))) throw new Error('A galaxy of your own has 1 to 8 arms wound at 4° to 40°, and a radius of 1,000 to 500,000 light-years.');
}

/**
 * A galaxy map made again from other settings (D116): other star systems, or for one's own another
 * shape. Systems keep their numbers, so what is held and the lanes stay with the same numbers.
 */
export function setGalaxy(world: World, spaceId: string, galaxy: GalaxyChoice): CommandResult {
  const space = world.get('map_space', spaceId);
  const o = space ? (worldSettings(space) as { space?: Record<string, unknown> }) : null;
  if (!space || space.kind !== 'space' || o?.space?.catalogue !== 'galaxy') throw new Error('Only a galaxy map can be made again.');
  checkGalaxy(galaxy);
  return run(world, 'Make the galaxy again', (tx) => tx.update('map_space', { ...space, settings: JSON.stringify({ ...o, space: { ...o.space, radiusLy: galaxy.kind === 'milkyway' ? 60000 : Math.round(galaxy.radiusLy * 1.2), galaxy: { ...galaxy, seed: Math.round(galaxy.seed), systems: Math.round(galaxy.systems), arms: Math.round(galaxy.arms) } } }) }));
}

/**
 * An invented star map made again from other settings (D114): another seed, more or fewer stars, another
 * size or shape. Stars keep their numbers, so what is held and the lanes stay with the same numbers.
 */
export function setInventedStars(world: World, spaceId: string, invented: { seed: number; count: number; radiusLy: number; shape: 'sphere' | 'disc' }): CommandResult {
  const space = world.get('map_space', spaceId);
  const o = space ? (worldSettings(space) as { space?: Record<string, unknown> }) : null;
  if (!space || space.kind !== 'space' || o?.space?.catalogue !== 'invented') throw new Error('Only an invented star map can be made again.');
  if (!(invented.count >= 2 && invented.count <= 3000) || !(invented.radiusLy >= 5 && invented.radiusLy <= 5000)) throw new Error('An invented star map has between 2 and 3,000 stars, within 5 to 5,000 light-years.');
  return run(world, 'Make the stars again', (tx) => tx.update('map_space', { ...space, settings: JSON.stringify({ ...o, space: { ...o.space, radiusLy: invented.radiusLy, invented: { ...invented, seed: Math.round(invented.seed), count: Math.round(invented.count) } } }) }));
}

/** How a space map looks (D130, D131, D132): its stars, sky, grid and names, a flat chart, its realms; one undo step. */
export function setSkyLook(world: World, spaceId: string, look: SkyLook, label = 'Change how the stars look'): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space || space.kind !== 'space') throw new Error('That is not a map of space.');
  const o = worldSettings(space) as { space?: Record<string, unknown> };
  return run(world, label, (tx) => tx.update('map_space', { ...space, settings: JSON.stringify({ ...o, space: { ...o.space, look: skyLookOf(look) } }) }));
}

/** How a solar system map lays out its bodies (D133): where they are, with their orbits, or side by side. */
export function setSolarLayout(world: World, spaceId: string, layout: 'orbits' | 'side-by-side'): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space || space.kind !== 'space') throw new Error('That is not a map of space.');
  const o = worldSettings(space) as { space?: Record<string, unknown> };
  if (o.space?.catalogue !== 'solar') throw new Error('Only the solar system can be laid out side by side.');
  return run(world, layout === 'side-by-side' ? 'The solar system side by side' : 'The solar system as it moves', (tx) => tx.update('map_space', { ...space, settings: JSON.stringify({ ...o, space: { ...o.space, layout } }) }));
}

/** How a solar system map draws its distances (D113): true, or compressed so the inner planets have room. */
export function setSolarScale(world: World, spaceId: string, scale: 'true' | 'compressed'): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space || space.kind !== 'space') throw new Error('That is not a map of space.');
  const o = worldSettings(space) as { space?: Record<string, unknown> };
  if (o.space?.catalogue !== 'solar') throw new Error('Only the solar system has a choice of scale.');
  return run(world, scale === 'true' ? 'Distances true to scale' : 'Distances compressed', (tx) => tx.update('map_space', { ...space, settings: JSON.stringify({ ...o, space: { ...o.space, scale } }) }));
}

export function createWorld(world: World, name: string, radiusKm: number, basemap: BasemapSource = 'none'): CommandResult<string> {
  if (!(radiusKm > 0)) throw new Error('A round map needs a positive radius.');
  return run(world, `Create map "${name}"`, (tx) => createWorldIn(tx, name, radiusKm, basemap));
}

/** Show or hide Earth's geography (Natural Earth) under a world's territories. */
export function setWorldBasemap(world: World, spaceId: string, basemap: BasemapSource): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  const label = basemap === 'none' ? `Hide Earth's geography on "${space.name}"` : `Show Earth's geography on "${space.name}"`;
  return run(world, label, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify({ ...worldSettings(space), basemap }) }); });
}

/** What a map shows while working and in exports, and its smallest lake (D84). */
export function setWorldShow(world: World, spaceId: string, patch: { working?: ShowSet; export?: ShowSet; minLakeKm2?: number }): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  const cur = worldSettings(space).show ?? {};
  const show: ShowSettings = {
    ...cur,
    ...(patch.working ? { working: { ...cur.working, ...patch.working } } : {}),
    ...(patch.export ? { export: { ...cur.export, ...patch.export } } : {}),
    ...(patch.minLakeKm2 !== undefined ? { minLakeKm2: Math.max(0, patch.minLakeKm2) } : {}),
  };
  return run(world, `Change what "${space.name}" shows`, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify({ ...worldSettings(space), show }) }); });
}

/** Turns a world's terrain on (with the look given, completed with the defaults), changes its look, or (null) turns it off (D95). */
export function setWorldTerrain(world: World, spaceId: string, patch: Partial<TerrainLook> | null): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  if (patch && !terrainSourceOf(space)) throw new Error('Only maps of the Earth and generated planets have terrain.');
  const settings = worldSettings(space);
  const cur = terrainLookOf(settings.terrain);
  const next = patch ? terrainLookOf({ ...(cur ?? DEFAULT_TERRAIN_LOOK), ...patch }) : null;
  const { terrain: _old, ...rest } = settings;
  const label = !patch ? `Hide the terrain of "${space.name}"` : cur ? `Change the terrain of "${space.name}"` : `Show the terrain of "${space.name}"`;
  return run(world, label, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify(next ? { ...rest, terrain: next } : rest) }); });
}

/** Gives a map a calendar of its own (D149), or (null) the Gregorian again. Nothing stored is changed: only how its dates are written. */
export function setMapCalendar(world: World, spaceId: string, def: CalendarDef | null): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  if (def) {
    const problems = calendarProblems(def);
    if (problems.length) throw new Error(problems[0]);
  }
  const { calendar: _old, ...rest } = worldSettings(space);
  const label = def ? `Give "${space.name}" the ${def.name} calendar` : `Use the Gregorian calendar for "${space.name}"`;
  return run(world, label, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify(def ? { ...rest, calendar: def } : rest) }); });
}

/** Sets a world's sea level over time (D96): the whole list of dated levels, in one step; none for today's. */
export function setWorldSeaLevel(world: World, spaceId: string, points: SeaLevelPoint[]): CommandResult {
  const space = world.get('map_space', spaceId);
  if (!space) throw new Error('That map no longer exists.');
  if (!terrainSourceOf(space)) throw new Error('Only maps of the Earth and generated planets have a sea level.');
  const clean = cleanSeaLevel(points);
  if (clean.length !== points.length && points.some((p) => !Number.isFinite(p?.day) || !Number.isFinite(p?.m))) throw new Error('A sea level needs a date and a height in metres.');
  const { seaLevel: _old, ...rest } = worldSettings(space);
  return run(world, `Change the sea level of "${space.name}"`, (tx) => { tx.update('map_space', { ...space, settings: JSON.stringify(clean.length ? { ...rest, seaLevel: clean } : rest) }); });
}

export function createLayer(world: World, spaceId: string, name: string, kind: LayerKind = 'partition'): CommandResult<string> {
  return run(world, `Create layer "${name}"`, (tx) => {
    const id = newId('layer');
    const order = world.all('layer').filter((l) => l.space_id === spaceId).length;
    const style = kind === 'partition' ? { fillOpacity: 0.6, borderWidth: 1 } : { ...DEFAULT_FEATURE_STYLE[kind as FeatureKind] };
    tx.insert('layer', { id, space_id: spaceId, kind, name, sort_order: order, visible: 1, style: JSON.stringify(style), export_pass: name.toLowerCase().replace(/\W+/g, '-') });
    return id;
  });
}

export function updateLayer(world: World, id: string, patch: Partial<{ name: string; visible: number; style: string; sort_order: number }>): CommandResult {
  return run(world, 'Change layer', (tx) => tx.patch('layer', id, patch));
}

/** Whether a layer's territory ends at the coast (on worlds that show Earth's geography). */
export function setLayerClipToLand(world: World, id: string, clip: boolean): CommandResult {
  const layer = world.get('layer', id);
  if (!layer) throw new Error('That layer no longer exists.');
  const style = { ...parseJSON<Record<string, unknown>>(layer.style, {}), clipToLand: clip };
  return run(world, clip ? `End "${layer.name}" at the coast` : `Let "${layer.name}" cover the sea`, (tx) => tx.patch('layer', id, { style: JSON.stringify(style) }));
}

/**
 * How strongly a territory layer's colours cover what is under them (0 to 1) and how wide its borders are (in
 * pixels at 1920 wide); one undo step. (The renderer and exports always read them; now they can be changed.)
 */
export function setLayerLook(world: World, id: string, patch: { fillOpacity?: number; borderWidth?: number }): CommandResult {
  const layer = world.get('layer', id);
  if (!layer) throw new Error('That layer no longer exists.');
  const style = parseJSON<Record<string, unknown>>(layer.style, {});
  if (patch.fillOpacity !== undefined) { if (!Number.isFinite(patch.fillOpacity)) throw new Error('Opacity must be a number.'); style.fillOpacity = Math.round(Math.max(0, Math.min(1, patch.fillOpacity)) * 100) / 100; }
  if (patch.borderWidth !== undefined) { if (!Number.isFinite(patch.borderWidth)) throw new Error('Border width must be a number.'); style.borderWidth = Math.round(Math.max(0, Math.min(20, patch.borderWidth)) * 100) / 100; }
  return run(world, `Restyle "${layer.name}"`, (tx) => tx.patch('layer', id, { style: JSON.stringify(style) }));
}

/**
 * How a territory layer is filled (D88): solid, or see-through stripes, crossed stripes or dots in each
 * owner's colour (occupation and control over the political map).
 */
export function setLayerFill(world: World, id: string, fill: TerritoryFill): CommandResult {
  const layer = world.get('layer', id);
  if (!layer) throw new Error('That layer no longer exists.');
  if (!['solid', 'hatch', 'cross', 'dots'].includes(fill)) throw new Error('Unknown fill.');
  const style = parseJSON<Record<string, unknown>>(layer.style, {});
  if (fill === 'solid') delete style.fill; else style.fill = fill;
  return run(world, `Fill "${layer.name}" ${fill === 'solid' ? 'solid' : fill === 'dots' ? 'with dots' : 'with stripes'}`, (tx) => tx.patch('layer', id, { style: JSON.stringify(style) }));
}

/**
 * Front lines on a territory layer (D89): the border between two countries at war, while the war
 * holds, drawn as a front line with teeth toward the second country of the war (or the first, or none);
 * null: none. Its colour, if given.
 */
export function setLayerFronts(world: World, id: string, fronts: FrontTeeth | null, color?: string): CommandResult {
  const layer = world.get('layer', id);
  if (!layer) throw new Error('That layer no longer exists.');
  if (fronts !== null && !['second', 'first', 'plain'].includes(fronts)) throw new Error('Unknown kind of front line.');
  if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose a colour.');
  const style = parseJSON<Record<string, unknown>>(layer.style, {});
  if (fronts === null) delete style.fronts; else style.fronts = fronts;
  if (color !== undefined) style.frontColor = color;
  return run(world, fronts === null ? `No front lines on "${layer.name}"` : `Front lines on "${layer.name}"`, (tx) => tx.patch('layer', id, { style: JSON.stringify(style) }));
}

// ---------------------------------------------------------------- looks: label styles, entity styles

/** How a country's territory is filled: its colour (default), a picture, or a video. */
export interface CountryFill {
  kind: 'color' | 'image' | 'video';
  /** A project asset name, or a file shipped with the app (for example 'data/flags/fr.svg'). */
  asset?: string;
  /** How the picture covers the territory: fill (covering, stretched up to twice rather than cropped; the default), cover (cropped), contain, stretch, or tile (repeat). */
  fit?: 'cover' | 'contain' | 'stretch' | 'tile' | 'fill';
  /**
   * Land in several pieces (D82): auto (pieces far from the rest get their own copy), whole (one
   * picture over everything), each (a copy per piece), near (pieces farther apart than gapKm get their own).
   */
  pieces?: 'auto' | 'whole' | 'each' | 'near';
  gapKm?: number;
  /** Tile size in pixels of a 1920-wide frame. */
  tileSize?: number;
  /** Videos: loop, or play once and hold the last frame. */
  play?: 'loop' | 'once';
  speed?: number;
  /** Videos: seconds into the video at the start of a shot. */
  start?: number;
  /** Switched off for now: the country shows its colour; the picture is kept for switching back. */
  off?: boolean;
}

/** What is stored in entity.style (JSON). */
export interface EntityStyle {
  label?: CountryLabel; fill?: CountryFill; pictures?: string[]; icon?: CharacterIcon;
  /** Locked (D87): its land and borders stay as they are. */
  locked?: boolean;
  /** A character as a unit (D90): the country or faction it belongs to (drawn in its colour), and how its route is shown. */
  side?: string; route?: RouteStyle;
}

export function entityStyle(e: { style?: string } | null | undefined): EntityStyle {
  return parseJSON<EntityStyle>(e?.style ?? '{}', {}) ?? {};
}

/** The project's general label style (all country labels), as stored. */
export function generalLabelStyle(world: World): Partial<LabelStyle> {
  return parseJSON<Partial<LabelStyle>>(world.get('meta', 'label_style')?.value ?? '{}', {}) ?? {};
}

/** Change the general label style (only the fields given; null resets a field to the default). */
export function pointStyle(world: World): PointStyle {
  return resolvePointStyle(world.get('meta', 'point_style')?.value);
}

export function setPointStyle(world: World, patch: Partial<PointStyle>): CommandResult {
  const value = JSON.stringify({ ...pointStyle(world), ...patch });
  return run(world, 'Change the size of cities and characters', (tx) => {
    if (world.get('meta', 'point_style')) tx.update('meta', { key: 'point_style', value }); else tx.insert('meta', { key: 'point_style', value });
  });
}

export function setGeneralLabelStyle(world: World, patch: Partial<Record<keyof LabelStyle, unknown>>): CommandResult {
  const next: Record<string, unknown> = { ...generalLabelStyle(world) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
  return run(world, 'Change the look of all labels', (tx) => {
    const row = world.get('meta', 'label_style');
    const value = JSON.stringify(next);
    if (row) tx.update('meta', { key: 'label_style', value }); else tx.insert('meta', { key: 'label_style', value });
  });
}

/** Change parts of an entity's look. `label: null` returns its label to the general style. */
export function setEntityStyle(world: World, id: string, patch: { label?: CountryLabel | null; fill?: CountryFill | null; icon?: CharacterIcon | null; side?: string | null; route?: RouteStyle | null }): CommandResult {
  const e = world.get('entity', id);
  if (!e) throw new Error('That country no longer exists.');
  const next: EntityStyle = { ...entityStyle(e) };
  if (patch.label === null) delete next.label;
  else if (patch.label !== undefined) {
    const clean = Object.fromEntries(Object.entries(patch.label).filter(([, v]) => v !== undefined && v !== null && v !== '')) as CountryLabel;
    if (Object.keys(clean).length) next.label = clean; else delete next.label;
  }
  if (patch.fill === null || patch.fill?.kind === 'color') delete next.fill;
  else if (patch.fill) {
    if (!patch.fill.asset) throw new Error('Choose a picture or video first.');
    next.fill = patch.fill;
  }
  if (patch.icon !== undefined) {
    const icon = cleanIcon(patch.icon);
    if (patch.icon && !icon) throw new Error('That icon is not known.');
    if (icon) next.icon = icon; else delete next.icon;
  }
  if (patch.side !== undefined) {
    const side = patch.side ? world.get('entity', patch.side) : null;
    if (patch.side && (!side || (side.type_id !== 'polity' && side.type_id !== 'faction'))) throw new Error('A unit belongs to a country or a faction.');
    if (side) next.side = side.id; else delete next.side;
  }
  if (patch.route !== undefined) {
    if (patch.route !== null && patch.route !== 'trail' && patch.route !== 'arrow') throw new Error('Unknown route.');
    if (patch.route) next.route = patch.route; else delete next.route;
  }
  return run(world, `Change the look of "${e.name}"`, (tx) => { tx.patch('entity', id, { style: JSON.stringify(next) }); });
}

/** Where pictures for notes are kept: a country (or other entity), an area, line or point, or an event. */
export type PictureHolder = { kind: 'entity' | 'feature' | 'event'; id: string };

/** The pictures kept with the notes of something (project asset file names, in order). */
export function picturesOf(world: World, h: PictureHolder): string[] {
  const row = h.kind === 'entity' ? world.get('entity', h.id) : h.kind === 'feature' ? world.get('feature', h.id) : world.get('event', h.id);
  if (!row) return [];
  const text = h.kind === 'event' ? (row as EventRow).fields : (row as { style: string }).style;
  const list = parseJSON<{ pictures?: unknown } | null>(text, null)?.pictures;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && !!x) : [];
}

/** Set the pictures kept with the notes of something (one undo step). */
export function setPictures(world: World, h: PictureHolder, pictures: string[]): CommandResult {
  const list = pictures.filter((x) => typeof x === 'string' && /^[\w\-.]+$/.test(x));
  const label = list.length > picturesOf(world, h).length ? 'Add picture' : 'Remove picture';
  if (h.kind === 'entity') {
    const e = world.get('entity', h.id);
    if (!e) throw new Error('That no longer exists.');
    const next: EntityStyle = { ...entityStyle(e), pictures: list };
    if (!list.length) delete next.pictures;
    return run(world, label, (tx) => { tx.patch('entity', h.id, { style: JSON.stringify(next) }); });
  }
  if (h.kind === 'feature') {
    const f = world.get('feature', h.id);
    if (!f) throw new Error('That no longer exists.');
    const next: Record<string, unknown> = { ...parseJSON<Record<string, unknown>>(f.style, {}), pictures: list };
    if (!list.length) delete next.pictures;
    return run(world, label, (tx) => { tx.patch('feature', h.id, { style: JSON.stringify(next) }); });
  }
  const ev = world.get('event', h.id);
  if (!ev) throw new Error('That event no longer exists.');
  const next: Record<string, unknown> = { ...parseJSON<Record<string, unknown>>(ev.fields, {}), pictures: list };
  if (!list.length) delete next.pictures;
  return run(world, label, (tx) => { tx.patch('event', h.id, { fields: JSON.stringify(next) }); });
}

// ---------------------------------------------------------------- entities

export function createEntity(world: World, e: { type_id: string; name: string; color?: string; notes?: string }): CommandResult<string> {
  if (!e.name.trim()) throw new Error('Give it a name.');
  return run(world, `Create "${e.name}"`, (tx) => {
    const id = newId('ent');
    tx.insert('entity', { id, type_id: e.type_id, branch_id: MAIN_BRANCH, name: e.name.trim(), color: e.color ?? suggestColor(world), notes: e.notes ?? '', created_seq: world.nextSeq('entity'), style: '{}', group_id: '' });
    return id;
  });
}

export function updateEntity(world: World, id: string, patch: Partial<Pick<EntityRow, 'name' | 'color' | 'notes' | 'type_id'>>): CommandResult {
  return run(world, 'Edit entity', (tx) => tx.patch('entity', id, patch));
}

export function deleteEntity(world: World, id: string): CommandResult {
  return deleteEntities(world, [id]);
}

/**
 * Delete countries, characters or cities, and take them out of history: the land they were given goes
 * back to whoever held it before, their places and annexations go, changes left empty are removed.
 * One undo step however many.
 */
export function deleteEntities(world: World, ids: string[]): CommandResult {
  const set = new Set(ids.filter((id) => world.get('entity', id)));
  if (!set.size) throw new Error('Those no longer exist.');
  const first = world.get('entity', [...set][0])!.name;
  return run(world, set.size === 1 ? `Delete "${first}"` : `Delete ${set.size} items`, (tx) => {
    purgeFromHistory(tx, set);
    // Areas, lines and points that belonged to them stay, belonging to nothing.
    for (const f of tx.world.all('feature')) if (set.has(f.entity_id)) tx.patch('feature', f.id, { entity_id: '' });
    // Their relationships go, with the changes that began and ended them.
    removeRelations(tx, new Set(tx.world.all('relation').filter((r) => set.has(r.a) || set.has(r.b)).map((r) => r.id)));
    for (const id of set) tx.remove('entity', id);
  });
}

function purgeFromHistory(tx: Tx, gone: Set<string>): number {
  let n = 0;
  for (const ef of tx.world.all('effect')) {
    if (ef.kind === 'place' || ef.kind === 'rename' || ef.kind === 'system' || ef.kind === 'lane') {
      const it = parseJSON<{ entity?: string } | null>(ef.intent, null);
      if (it?.entity && gone.has(it.entity)) { tx.remove('effect', ef.id); n++; }
      continue;
    }
    if (ef.kind === 'annex') {
      const it = parseJSON<AnnexIntent | null>(ef.intent, null);
      if (it && (gone.has(it.from) || gone.has(it.to))) { tx.remove('effect', ef.id); n++; }
      continue;
    }
    const res = parseJSON<Resolution>(ef.resolution, { set: [] });
    const kept = (res.set ?? []).filter(([, v]) => !v || !gone.has(v));
    if (kept.length === (res.set ?? []).length) continue;
    n++;
    if (kept.length) tx.patch('effect', ef.id, { resolution: JSON.stringify({ ...res, set: kept }) });
    else tx.remove('effect', ef.id);
  }
  return n;
}

/** History Health: take countries that no longer exist out of history (their land goes back to its previous holders). */
export function purgeDeletedOwners(world: World): CommandResult<number> {
  const exists = new Set(world.all('entity').map((e) => e.id));
  const gone = new Set<string>();
  for (const ef of world.all('effect')) {
    for (const [, v] of parseJSON<Resolution>(ef.resolution, { set: [] }).set ?? []) if (v && !exists.has(v)) gone.add(v);
    const it = parseJSON<{ entity?: string; from?: string; to?: string } | null>(ef.intent, null);
    for (const v of [it?.entity, it?.from, it?.to]) if (v && !exists.has(v) && (ef.kind === 'place' || ef.kind === 'annex' || ef.kind === 'rename' || ef.kind === 'system' || ef.kind === 'lane')) gone.add(v);
  }
  return run(world, 'Remove deleted countries from history', (tx) => purgeFromHistory(tx, gone));
}

// ---------------------------------------------------------------- events

export interface EventInput {
  name: string; type_id?: string; start: Instant; end?: Instant | null; precision?: string; description?: string; precedence?: number;
}

function insertEventIn(tx: Tx, e: EventInput): string {
  if (!e.name.trim()) throw new Error('Give the event a name.');
  if (e.end && compare(e.end, e.start) < 0) throw new Error('An event cannot end before it starts.');
  const id = newId('evt');
  const [sd, sm] = toStore(e.start);
  const end = e.end ? toStore(e.end) : null;
  tx.insert('event', {
    id, type_id: e.type_id ?? 'general', branch_id: branchAt(tx.world, tx.world.branch, e.start), name: e.name.trim(), start_day: sd, start_ms: sm,
    end_day: end ? end[0] : null, end_ms: end ? end[1] : null, precision: e.precision ?? 'day', precedence: e.precedence ?? 0,
    description: e.description ?? '', fields: '{}', presentation: '{}', created_seq: tx.world.nextSeq('event'), variant_group: null, variant_active: 1,
  });
  return id;
}

/** Create an event; `groups` puts it in those event groups in the same step. */
export function createEvent(world: World, e: EventInput & { groups?: string[] }): CommandResult<string> {
  for (const g of e.groups ?? []) if (!world.get('event_group', g)) throw new Error('That group no longer exists.');
  return run(world, `Create event "${e.name}"`, (tx) => {
    const id = insertEventIn(tx, e);
    for (const g of e.groups ?? []) insertMember(tx, g, id);
    return id;
  });
}

export function updateEvent(world: World, id: string, patch: Partial<EventInput> & { variant_group?: string | null; variant_active?: number }): CommandResult {
  if (isBaseEvent(id) && (patch.start || patch.end)) throw new Error('The starting map has no date.');
  return run(world, 'Edit event', (tx) => {
    const ev = world.get('event', id);
    if (!ev) throw new Error('Unknown event');
    const next: EventRow = { ...ev };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.type_id !== undefined) next.type_id = patch.type_id;
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.precision !== undefined) next.precision = patch.precision;
    if (patch.precedence !== undefined) next.precedence = patch.precedence;
    if (patch.start) [next.start_day, next.start_ms] = toStore(patch.start);
    if (patch.end !== undefined) {
      if (patch.end === null) { next.end_day = null; next.end_ms = null; } else [next.end_day, next.end_ms] = toStore(patch.end);
    }
    if (patch.variant_group !== undefined) next.variant_group = patch.variant_group;
    if (patch.variant_active !== undefined) next.variant_active = patch.variant_active;
    if (next.end_day !== null && (next.end_day < next.start_day || (next.end_day === next.start_day && (next.end_ms ?? 0) < next.start_ms))) {
      throw new Error('An event cannot end before it starts.');
    }
    tx.update('event', next);
  });
}

export function deleteEvent(world: World, id: string): CommandResult {
  if (isBaseEvent(id)) throw new Error('The starting map cannot be deleted.');
  return deleteEvents(world, [id]);
}

/** Delete many events and their changes at once (one undo step). The starting map is never deleted. */
export function deleteEvents(world: World, ids: string[]): CommandResult {
  const set = new Set(ids.filter((id) => !isBaseEvent(id) && world.get('event', id)));
  if (!set.size) throw new Error('Choose at least one event.');
  const first = world.get('event', [...set][0])!.name;
  return run(world, set.size === 1 ? `Delete event "${first}"` : `Delete ${set.size} events`, (tx) => {
    for (const ef of world.all('effect')) if (set.has(ef.event_id)) tx.remove('effect', ef.id);
    for (const m of world.all('event_group_member')) if (set.has(m.event_id)) tx.remove('event_group_member', m.id);
    for (const id of set) tx.remove('event', id);
  });
}

// ---------------------------------------------------------------- branches: alternative timelines (D150)

/** Colours given to branches in turn (their mark in the title bar and lists). */
export const BRANCH_COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#6d9dc5', '#b07aa1', '#e15759', '#59a14f', '#edc948'];

export interface BranchInput { name: string; from: Instant; parent?: string; color?: string; notes?: string }

/**
 * A branch that splits from `parent` (the timeline being viewed, unless given) at the moment `from`: its history
 * is the parent's up to and including that moment, live, then its own (D150).
 */
export function createBranch(world: World, b: BranchInput): CommandResult<string> {
  const name = b.name.trim();
  if (!name) throw new Error('Give the branch a name.');
  const parent = b.parent ?? world.branch;
  if (parent !== MAIN_BRANCH && !world.get('branch', parent)) throw new Error('The timeline to branch from no longer exists.');
  if (!isFiniteInstant(b.from)) throw new Error('A branch splits off at a date.');
  if (name.toLowerCase() === 'main timeline' || world.all('branch').some((r) => r.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`There is already a branch called "${name}".`);
  return run(world, `Branch "${name}" from ${branchName(world, parent)}`, (tx) => {
    const id = newId('br');
    const [d, ms] = toStore(b.from);
    const n = tx.world.all('branch').length;
    tx.insert('branch', { id, name, parent_id: parent, from_day: d, from_ms: ms, color: b.color ?? BRANCH_COLORS[n % BRANCH_COLORS.length], notes: b.notes ?? '', created_seq: tx.world.nextSeq('branch') });
    insertBranchBase(tx, id);
    return id;
  });
}

/** A branch renamed, recoloured, described, or split off at another moment (what it shares changes with it, live). */
export function updateBranch(world: World, id: string, patch: { name?: string; color?: string; notes?: string; from?: Instant }): CommandResult {
  const row = world.get('branch', id);
  if (!row) throw new Error('That branch no longer exists.');
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) throw new Error('Give the branch a name.');
  if (name && (name.toLowerCase() === 'main timeline' || world.all('branch').some((r) => r.id !== id && r.name.trim().toLowerCase() === name.toLowerCase()))) throw new Error(`There is already a branch called "${name}".`);
  if (patch.from && !isFiniteInstant(patch.from)) throw new Error('A branch splits off at a date.');
  return run(world, patch.from ? `Branch "${row.name}" splits off at another date` : `Edit branch "${row.name}"`, (tx) => {
    const next = { ...row };
    if (name) next.name = name;
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.notes !== undefined) next.notes = patch.notes;
    if (patch.from) [next.from_day, next.from_ms] = toStore(patch.from);
    tx.update('branch', next);
  });
}

/**
 * A branch deleted with every branch that splits from it, and their own events and changes (one step to undo).
 * What they shared with the timeline they came from is that timeline's and stays.
 */
export function deleteBranch(world: World, id: string): CommandResult<number> {
  const row = world.get('branch', id);
  if (!row) throw new Error('That branch no longer exists.');
  const gone = branchAndBelow(world, id);
  return run(world, gone.size > 1 ? `Delete branch "${row.name}" and the ${gone.size - 1} branch${gone.size === 2 ? '' : 'es'} from it` : `Delete branch "${row.name}"`, (tx) => {
    const events = new Set(world.all('event').filter((e) => gone.has(e.branch_id)).map((e) => e.id));
    for (const ef of world.all('effect')) if (events.has(ef.event_id)) tx.remove('effect', ef.id);
    for (const m of world.all('event_group_member')) if (events.has(m.event_id)) tx.remove('event_group_member', m.id);
    for (const e of events) tx.remove('event', e);
    for (const b of gone) tx.remove('branch', b);
    return [...events].filter((e) => !isBaseEvent(e)).length;
  });
}

/** A branch's own place for changes made without an event (see baseEventOf), made like the starting map. */
function insertBranchBase(tx: Tx, branch: string): void {
  const base = tx.world.get('event', BASE_EVENT_ID);
  if (!base) throw new Error('The starting map is missing.');
  tx.insert('event', { ...base, id: baseEventOf(branch), branch_id: branch, name: 'Changes without an event', created_seq: tx.world.nextSeq('event'), variant_group: null, variant_active: 1 });
}

/**
 * Where a change made without an event at `t` is kept (D150): the starting map's (from the beginning, or a date
 * of the main timeline), or that of the branch the date belongs to in the branch being edited (see branchAt).
 */
function correctionEvent(tx: Tx, t: Instant | null): string {
  const w = tx.world;
  const branch = t && t.day !== -Infinity ? branchAt(w, w.branch, t) : MAIN_BRANCH;
  const id = baseEventOf(branch);
  if (!w.get('event', id)) insertBranchBase(tx, branch);
  return id;
}

/** The event a change in this edit mode goes into: the event recorded into, or the place for changes without an event (see correctionEvent). */
function eventForMode(tx: Tx, mode: EditMode): string {
  return mode.kind === 'new' ? mode.eventId : correctionEvent(tx, mode.t);
}

/**
 * A change recorded into an event at `at` (null: from the event's start) must be part of the history of the
 * branch being edited (D150), or it would vanish as it is made: an event of the history the branch shares with
 * the timeline it split from takes no change dated after the split, and another branch's events none at all.
 */
function recordable(world: World, eventId: string, at: [number, number] | null): void {
  const ev = world.get('event', eventId);
  if (!ev || isBaseEvent(ev.id)) return;
  const owner = ev.branch_id || MAIN_BRANCH;
  if (owner === world.branch) return;
  const t = at ? fromStore(at[0], at[1]) : eventStart(ev);
  if (seenAt(branchCuts(world, world.branch), owner, t)) return;
  if (branchLine(world, world.branch).includes(owner)) throw new Error(`"${ev.name}" is part of the history this branch shares with ${branchName(world, owner)}, up to the moment it split off. A change after that would not be part of this branch: record it in an event of this branch.`);
  throw new Error(`"${ev.name}" is an event of ${branchName(world, owner)}, not of ${branchName(world, world.branch)}.`);
}

// ---------------------------------------------------------------- groups of countries (folders) and changes to many at once

/** Make a group (folder) in the list, optionally moving some countries (or cities, characters) into it. */
export function createEntityGroup(world: World, name: string, members: string[] = []): CommandResult<string> {
  if (!name.trim()) throw new Error('Give the group a name.');
  return run(world, `Create group "${name.trim()}"`, (tx) => {
    const id = newId('egrp');
    const n = world.all('entity_group').length;
    tx.insert('entity_group', { id, name: name.trim(), color: GROUP_COLORS[n % GROUP_COLORS.length], sort_order: n, created_seq: world.nextSeq('entity_group') });
    for (const m of members) if (world.get('entity', m)) tx.patch('entity', m, { group_id: id });
    return id;
  });
}

export function renameEntityGroup(world: World, id: string, name: string): CommandResult {
  if (!world.get('entity_group', id)) throw new Error('That group no longer exists.');
  if (!name.trim()) throw new Error('Give the group a name.');
  return run(world, 'Rename group', (tx) => tx.patch('entity_group', id, { name: name.trim() }));
}

/** Delete a group; what was in it stays, ungrouped. */
export function deleteEntityGroup(world: World, id: string): CommandResult {
  const g = world.get('entity_group', id);
  if (!g) throw new Error('That group no longer exists.');
  return run(world, `Delete group "${g.name}"`, (tx) => {
    for (const e of world.all('entity')) if (e.group_id === id) tx.patch('entity', e.id, { group_id: '' });
    tx.remove('entity_group', id);
  });
}

/** Put countries (or cities, characters) into a group, or take them out ('' = no group). */
export function setEntitiesGroup(world: World, ids: string[], groupId: string): CommandResult {
  if (groupId && !world.get('entity_group', groupId)) throw new Error('That group no longer exists.');
  return run(world, groupId ? `Move to "${world.get('entity_group', groupId)!.name}"` : 'Take out of the group', (tx) => {
    for (const id of ids) { const e = world.get('entity', id); if (e && e.group_id !== groupId) tx.patch('entity', id, { group_id: groupId }); }
  });
}

/** Hide or show the labels of many countries at once (one undo step). */
export function setLabelsHidden(world: World, ids: string[], hidden: boolean): CommandResult {
  return run(world, hidden ? 'Hide labels' : 'Show labels', (tx) => {
    for (const id of ids) {
      const e = world.get('entity', id);
      if (!e) continue;
      const st = entityStyle(e);
      const label: CountryLabel = { ...(st.label ?? {}) };
      if (hidden) label.hidden = true; else delete label.hidden;
      const next: EntityStyle = { ...st, label };
      if (!Object.keys(label).length) delete next.label;
      const json = JSON.stringify(next);
      if (json !== (e.style || '{}')) tx.patch('entity', id, { style: json });
    }
  });
}

/**
 * Switch the pictures and videos of many countries off (they show their colours) or back on. The
 * picture each one had is kept, so switching back restores it.
 */
export function setFillsShown(world: World, ids: string[], shown: boolean): CommandResult {
  return run(world, shown ? 'Show pictures' : 'Use colours', (tx) => {
    for (const id of ids) {
      const e = world.get('entity', id);
      const st = entityStyle(e);
      if (!e || !st.fill?.asset) continue;
      const fill: CountryFill = { ...st.fill };
      if (shown) delete fill.off; else fill.off = true;
      tx.patch('entity', id, { style: JSON.stringify({ ...st, fill }) });
    }
  });
}

/** Make an alternative version of an event (story planning): the copy becomes the active version. */
export function createVariant(world: World, eventId: string, name: string): CommandResult<string> {
  return run(world, `Create alternative "${name}"`, (tx) => {
    const ev = world.get('event', eventId);
    if (!ev || isBaseEvent(ev.id)) throw new Error('Choose an event first.');
    const group = ev.variant_group ?? newId('alt');
    if (!ev.variant_group) tx.patch('event', ev.id, { variant_group: group, variant_active: 0 });
    for (const other of world.all('event')) if (other.variant_group === group && other.id !== ev.id) tx.patch('event', other.id, { variant_active: 0 });
    if (ev.variant_group) tx.patch('event', ev.id, { variant_active: 0 });
    const id = newId('evt');
    tx.insert('event', { ...ev, id, name, variant_group: group, variant_active: 1, created_seq: world.nextSeq('event') });
    for (const ef of world.all('effect').filter((f) => f.event_id === ev.id)) tx.insert('effect', { ...ef, id: newId('eff'), event_id: id });
    // The alternative belongs to the same groups as the original.
    for (const m of world.all('event_group_member').filter((g) => g.event_id === ev.id)) insertMember(tx, m.group_id, id);
    return id;
  });
}

export function activateVariant(world: World, eventId: string): CommandResult {
  return run(world, 'Switch alternative', (tx) => {
    const ev = world.get('event', eventId);
    if (!ev?.variant_group) throw new Error('This event has no alternatives.');
    for (const other of world.all('event')) if (other.variant_group === ev.variant_group) tx.patch('event', other.id, { variant_active: other.id === eventId ? 1 : 0 });
  });
}

// ---------------------------------------------------------------- event groups
// Events belong to the project; the user groups them (by country, by world, or groups of their own)
// and chooses which groups the timeline shows (DECISIONS D8). An event can be in several groups.

const GROUP_COLORS = ['#4f9bd9', '#e0a458', '#7bc47f', '#d1495b', '#a77dc2', '#5fb7b0', '#c9b458', '#e07a9a'];

function insertMember(tx: Tx, groupId: string, eventId: string): void {
  const id = `${groupId}|${eventId}`;
  if (!tx.world.get('event_group_member', id)) tx.insert('event_group_member', { id, group_id: groupId, event_id: eventId });
}

export function createEventGroup(world: World, name: string, color?: string): CommandResult<string> {
  const n = name.trim();
  if (!n) throw new Error('Give the group a name.');
  if (world.all('event_group').some((g) => g.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a group called "${n}".`);
  return run(world, `Create event group "${n}"`, (tx) => {
    const id = newId('grp');
    const count = world.all('event_group').length;
    tx.insert('event_group', { id, name: n, color: color ?? GROUP_COLORS[count % GROUP_COLORS.length], sort_order: count, created_seq: world.nextSeq('event_group') });
    return id;
  });
}

/**
 * An event's own time on screen in presentations (D92): its changes take this many screen seconds from
 * the moment they happen, however fast a shot's clock runs ("out of sync with the clock"); null: they
 * follow the clock.
 */
export function setEventScreenSeconds(world: World, id: string, seconds: number | null): CommandResult {
  const e = world.get('event', id);
  if (!e) throw new Error('That event no longer exists.');
  if (seconds !== null && !(seconds > 0 && seconds <= 600)) throw new Error('Choose between a tenth of a second and ten minutes.');
  const p = parseJSON<Record<string, unknown>>(e.presentation, {}) ?? {};
  if (seconds === null) delete p.screen; else p.screen = { seconds: Math.round(seconds * 100) / 100 };
  return run(world, seconds === null ? `"${e.name}" follows the clock` : `"${e.name}" takes ${seconds} s on screen`, (tx) => tx.patch('event', id, { presentation: JSON.stringify(p) }));
}

/**
 * An event's own transition look (D137): its changes look this way wherever they animate (the working view and
 * every shot), and take the look's style where a shot animates them; null: the shot's look.
 */
export function setEventLook(world: World, id: string, look: string | null): CommandResult {
  const e = world.get('event', id);
  if (!e) throw new Error('That event no longer exists.');
  const l = look === null ? null : TRANSITION_LOOKS.find((x) => x.id === look);
  if (look !== null && !l) throw new Error('There is no look of that name.');
  const p = parseJSON<Record<string, unknown>>(e.presentation, {}) ?? {};
  if (!l) delete p.look; else p.look = l.id;
  return run(world, l ? `"${e.name}" looks ${l.name}` : `"${e.name}" looks as the shot does`, (tx) => tx.patch('event', id, { presentation: JSON.stringify(p) }));
}

export function updateEventGroup(world: World, id: string, patch: { name?: string; color?: string }): CommandResult {
  const g = world.get('event_group', id);
  if (!g) throw new Error('That group no longer exists.');
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) throw new Error('Give the group a name.');
  if (name && world.all('event_group').some((o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a group called "${name}".`);
  return run(world, `Change event group "${g.name}"`, (tx) => { tx.patch('event_group', id, { ...(name ? { name } : {}), ...(patch.color ? { color: patch.color } : {}) }); });
}

/** Delete a group. Its events stay; they only leave the group. */
export function deleteEventGroup(world: World, id: string): CommandResult {
  const g = world.get('event_group', id);
  if (!g) throw new Error('That group no longer exists.');
  return run(world, `Delete event group "${g.name}"`, (tx) => {
    for (const m of world.all('event_group_member').filter((x) => x.group_id === id)) tx.remove('event_group_member', m.id);
    tx.remove('event_group', id);
  });
}

/** Put an event in exactly these groups (taking it out of any others). */
export function setEventGroups(world: World, eventId: string, groupIds: string[]): CommandResult {
  const ev = world.get('event', eventId);
  if (!ev || isBaseEvent(ev.id)) throw new Error('Choose an event first.');
  for (const g of groupIds) if (!world.get('event_group', g)) throw new Error('That group no longer exists.');
  const want = new Set(groupIds);
  return run(world, `Change the groups of "${ev.name}"`, (tx) => {
    for (const m of world.all('event_group_member').filter((x) => x.event_id === eventId)) if (!want.has(m.group_id)) tx.remove('event_group_member', m.id);
    for (const g of want) insertMember(tx, g, eventId);
  });
}

/** Add many events to one event group (one undo step); events already in it are left as they are. */
export function addEventsToGroup(world: World, eventIds: string[], groupId: string): CommandResult {
  const g = world.get('event_group', groupId);
  if (!g) throw new Error('That group no longer exists.');
  return run(world, `Add to "${g.name}"`, (tx) => {
    for (const id of eventIds) if (!isBaseEvent(id) && world.get('event', id)) insertMember(tx, groupId, id);
  });
}

/** The groups an event belongs to, in display order. */
export function groupsOfEvent(world: World, eventId: string): string[] {
  return eventGroupIndex(world).get(eventId) ?? [];
}

/** The groups of every event that is in any (in the groups' order), kept until groups or memberships change. */
const groupIndexes = new WeakMap<World, { key: string; index: Map<string, string[]> }>();
function eventGroupIndex(world: World): Map<string, string[]> {
  const key = `${world.tableRevision('event_group')}|${world.tableRevision('event_group_member')}`;
  let kept = groupIndexes.get(world);
  if (!kept || kept.key !== key) {
    const order = new Map(world.rows('event_group').map((g) => [g.id, g.sort_order]));
    const index = new Map<string, string[]>();
    for (const m of world.rows('event_group_member')) {
      const l = index.get(m.event_id);
      if (l) l.push(m.group_id); else index.set(m.event_id, [m.group_id]);
    }
    for (const l of index.values()) l.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    groupIndexes.set(world, (kept = { key, index }));
  }
  return kept.index;
}

/**
 * Whether an event is shown under a group filter: null shows every event; otherwise the event shows
 * if it is in a chosen group, or if it is in no group and 'ungrouped' is chosen.
 */
export function eventShown(world: World, eventId: string, filter: Set<string> | null): boolean {
  if (!filter) return true;
  const groups = eventGroupIndex(world).get(eventId);
  if (!groups || !groups.length) return filter.has(UNGROUPED);
  return groups.some((g) => filter.has(g));
}
export const UNGROUPED = '__ungrouped';

// ---------------------------------------------------------------- today's countries

export interface CountryToAdd {
  name: string;
  /** Each polygon: its outline, then its holes, as [lon, lat] points. */
  polygons: Array<Array<Array<[number, number]>>>;
  color?: string;
  /** A picture to fill it with (for example its flag), for countries created now. */
  fill?: CountryFill;
}

/**
 * Add countries and their territory in one step: each country is created (or an existing one with
 * the same name is used) and its land is painted as a correction or as part of an event. All outlines
 * go into the map together, so the map's structure is rebuilt once however many countries there are.
 * With `into`, their land is given to that existing country instead (Greece's borders added to a
 * country of the user's own, say), and no countries are created.
 */
export function addCountries(world: World, engine: Engine, o: { spaceId: string; layerId: string; countries: CountryToAdd[]; mode: EditMode; snap?: number; newEvent?: EventInput; into?: NewOwner; transition?: TransitionSpec | null }): CommandResult<{ entities: string[]; eventId: string | null }> {
  checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, mode: o.newEvent ? undefined : o.mode, value: typeof o.into === 'string' ? o.into : undefined });
  if (!o.countries.length) throw new Error('Choose at least one country.');
  const intoName = o.into === undefined ? '' : typeof o.into === 'string' ? world.get('entity', o.into)!.name : o.into.name.trim();
  const label = o.into
    ? `Add ${o.countries.length === 1 ? o.countries[0].name : `${o.countries.length} countries`} to ${intoName}`
    : o.countries.length === 1 ? `Add ${o.countries[0].name}` : `Add ${o.countries.length} countries`;
  return run(world, label, (tx) => {
    // Optionally the event they belong to is created in the same step (one undo).
    const eventId = o.newEvent ? insertEventIn(tx, o.newEvent) : null;
    if (eventId) o = { ...o, mode: { kind: 'new', eventId } };
    // Into a country made in the same step (the region picker's "a new country").
    const into = o.into === undefined ? undefined : ownerIn(tx, o.into);
    const existing = new Map(world.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').map((e) => [e.name.toLowerCase(), e.id]));
    const entities: string[] = [];
    // Outlines: each polygon's outer ring and holes, oriented with the area they surround on the left.
    const rings: Vec3[][] = [];
    const parts: Array<Array<{ outer: number; holes: number[] }>> = [];
    for (const c of o.countries) {
      const polys: Array<{ outer: number; holes: number[] }> = [];
      for (const poly of c.polygons) {
        const outer = ringFromMapPoints(poly[0], 1);
        if (!outer) continue;
        const entry = { outer: rings.push(outer) - 1, holes: [] as number[] };
        for (const h of poly.slice(1)) { const hr = ringFromMapPoints(h, 1); if (hr) entry.holes.push(rings.push(hr) - 1); }
        polys.push(entry);
      }
      parts.push(polys);
    }
    const paths = tx.kernel(o.spaceId, (arr) => arr.insertPaths(rings, { closed: true, snap: o.snap ?? 1e-8 }));
    const arr = world.arrangement(o.spaceId);
    const lefts = arr.facesLeftOfMany(paths);
    const insideOf = (i: number) => (arr.isSimpleCycle(paths[i]) && arr.separatesFaces(paths[i]) ? lefts[i] : arr.facesWoundBy(paths[i]));
    const items: Array<{ leaves: Iterable<number>; value: string | null }> = [];
    o.countries.forEach((c, k) => {
      // Into an existing country: its territory grows; no country of this name is created.
      let id = into ?? existing.get(c.name.toLowerCase());
      if (!id) {
        id = newId('ent');
        const style = c.fill?.asset ? JSON.stringify({ fill: c.fill }) : '{}';
        tx.insert('entity', { id, type_id: 'polity', branch_id: MAIN_BRANCH, name: c.name, color: c.color ?? suggestColor(world), notes: '', created_seq: world.nextSeq('entity'), style, group_id: '' });
        existing.set(c.name.toLowerCase(), id);
      }
      if (!entities.includes(id)) entities.push(id);
      const faces = new Set<number>();
      for (const p of parts[k]) {
        const holes = new Set<number>();
        for (const h of p.holes) for (const f of leafDescendants(arr, insideOf(h))) holes.add(f);
        for (const f of leafDescendants(arr, insideOf(p.outer))) if (!holes.has(f)) faces.add(f);
      }
      if (!faces.size) return;
      if (o.mode.kind === 'new') {
        const [kept] = withoutLocked(world, engine, o.spaceId, o.layerId, o.mode, [{ leaves: faces, value: id }]);
        faces.clear();
        for (const f of kept.leaves) faces.add(f);
        if (!faces.size) return;
      }
      if (o.mode.kind === 'new') chainRecorded(tx, insertAssignEffect(tx, { eventId: o.mode.eventId, spaceId: o.spaceId, layerId: o.layerId, faces: canonicalFaces(arr, [...faces]), value: id, at: o.mode.at ?? null, transition: o.transition ?? null, intent: { op: 'paint', value: id } }));
      else items.push({ leaves: faces, value: id });
    });
    if (o.mode.kind !== 'new' && items.length) writeAssignments(tx, engine, o.spaceId, o.layerId, o.mode, items);
    return { entities, eventId };
  });
}

/**
 * Territories from a map of a date (improvement B, D120; read from GeoJSON by domain/geojson-import.ts): each
 * country given the land the map shows from date `t` (or, at the beginning of time, as the starting map). A
 * country of the same name already in the project goes on, its land changing; others are created. With
 * `replace`, land of the layer that the map does not show becomes nobody's at that date, so that a series of
 * maps, each of its year, plays as the history between them. One undo step.
 */
export function importTerritories(world: World, engine: Engine, o: { spaceId: string; layerId: string; t: Instant; countries: CountryToAdd[]; replace: boolean; label?: string; snap?: number; matchKm?: number }): CommandResult<{ entities: string[]; created: number; cleared: number; skipped: string[] }> {
  const start = o.t.day === -Infinity;
  const mode: EditMode = start ? { kind: 'correct', t: NEG_INF } : { kind: 'change', t: o.t };
  checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, mode });
  if (!o.countries.length) throw new Error('The map holds no countries to import.');
  const tol = matchTolerance(world, o.spaceId, o.matchKm);
  return run(world, o.label ?? `Import ${o.countries.length} ${o.countries.length === 1 ? 'country' : 'countries'}`, (tx) => {
    // Who holds what at that date, before the new outlines cut the parcels.
    const before = o.replace ? engine.partitionState(o.spaceId, o.layerId, o.t) : null;
    const placed = placeOutlines(tx, o.spaceId, o.countries, tol, o.snap ?? 1e-8);
    const arr = world.arrangement(o.spaceId);
    const owners = ownersByName(world);
    const items: Array<{ leaves: Iterable<number>; value: string | null }> = [];
    const entities: string[] = [], covered = new Set<number>();
    let created = 0;
    o.countries.forEach((c, k) => {
      const faces = [...placed.faces[k]].filter((f) => !covered.has(f));
      if (!faces.length) return;
      const r = owners.idFor(tx, c);
      if (r.created) created++;
      if (!entities.includes(r.id)) entities.push(r.id);
      for (const f of faces) covered.add(f);
      items.push({ leaves: faces, value: r.id });
    });
    // Land the map does not show: nobody's from that date.
    let cleared = 0;
    if (before) {
      const gone = new Set<number>();
      for (const [face, st] of before) if (st.value) for (const leaf of leafDescendants(arr, [face])) if (!covered.has(leaf)) gone.add(leaf);
      if (gone.size) { items.push({ leaves: gone, value: null }); cleared = gone.size; }
    }
    if (items.length) writeAssignments(tx, engine, o.spaceId, o.layerId, mode, items);
    return { entities, created, cleared, skipped: placed.skipped };
  });
}

/**
 * Territories from a dataset that dates each of its shapes (as CShapes does, D123): a shape is its country's
 * land from its first date to its last. At every date where shapes begin or end, those beginning take their land
 * (their outlines put in then, following the borders already there) and the land of those ending that no shape
 * of the time covers becomes nobody's. The earliest shapes can be the starting map. One undo step for it all.
 */
export function importDatedTerritories(world: World, engine: Engine, o: { spaceId: string; layerId: string; shapes: Array<CountryToAdd & { from: Instant; to: Instant }>; earliestAsStart: boolean; label?: string; snap?: number; matchKm?: number }): CommandResult<{ entities: string[]; created: number; dates: number; skipped: string[]; from: Instant | null; to: Instant | null }> {
  checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, mode: { kind: 'correct', t: NEG_INF } });
  if (!o.shapes.length) throw new Error('The file holds no dated shapes to import.');
  const tol = matchTolerance(world, o.spaceId, o.matchKm);
  // Every moment where something begins or ends, in order.
  const key = (t: Instant) => `${t.day}|${t.ms}`;
  const moments = new Map<string, Instant>();
  for (const sh of o.shapes) { moments.set(key(sh.from), sh.from); if (Number.isFinite(sh.to.day)) moments.set(key(sh.to), sh.to); }
  const times = [...moments.values()].sort(compare);
  const finite = times.filter((t) => Number.isFinite(t.day));
  const earliest = finite[0] ?? null;
  return run(world, o.label ?? `Import ${o.shapes.length} dated ${o.shapes.length === 1 ? 'shape' : 'shapes'}`, (tx) => {
    const arr = world.arrangement(o.spaceId);
    const owners = ownersByName(world);
    const faces: Array<Set<number> | null> = o.shapes.map(() => null);
    const entities: string[] = [], skipped: string[] = [];
    let created = 0, dates = 0;
    for (const t of times) {
      const starting = o.shapes.map((sh, i) => [sh, i] as const).filter(([sh]) => compare(sh.from, t) === 0);
      if (starting.length) {
        const placed = placeOutlines(tx, o.spaceId, starting.map(([sh]) => sh), tol, o.snap ?? 1e-8);
        starting.forEach(([, i], k) => { faces[i] = placed.faces[k]; });
        for (const n of placed.skipped) if (!skipped.includes(n)) skipped.push(n);
      }
      const kids = childrenMap(arr);
      const now = (i: number) => leafDescendants(arr, faces[i] ?? [], kids);
      // The land of every shape of the time.
      const covered = new Set<number>();
      o.shapes.forEach((sh, i) => { if (faces[i] && compare(sh.from, t) <= 0 && compare(t, sh.to) < 0) for (const f of now(i)) covered.add(f); });
      const items: Array<{ leaves: Iterable<number>; value: string | null }> = [], taken = new Set<number>();
      for (const [sh, i] of starting) {
        const land = [...now(i)].filter((f) => !taken.has(f));
        if (!land.length) continue;
        const r = owners.idFor(tx, sh);
        if (r.created) created++;
        if (!entities.includes(r.id)) entities.push(r.id);
        for (const f of land) taken.add(f);
        items.push({ leaves: land, value: r.id });
      }
      const gone = new Set<number>();
      o.shapes.forEach((sh, i) => { if (faces[i] && compare(sh.to, t) === 0) for (const f of now(i)) if (!covered.has(f)) gone.add(f); });
      if (gone.size) items.push({ leaves: gone, value: null });
      if (!items.length) continue;
      dates++;
      const start = !Number.isFinite(t.day) || (o.earliestAsStart && earliest && compare(t, earliest) === 0 && !times.some((x) => !Number.isFinite(x.day)));
      writeAssignments(tx, engine, o.spaceId, o.layerId, start ? { kind: 'correct', t: NEG_INF } : { kind: 'change', t }, items);
    }
    return { entities, created, dates, skipped, from: earliest, to: finite.length ? finite[finite.length - 1] : null };
  });
}

/** How close (radians) a border must be to one already on the map to be taken as it (imports, D120): `km` on this map's planet, 5 km unless given. */
function matchTolerance(world: World, spaceId: string, km?: number): number {
  const radiusKm = (world.get('map_space', spaceId)?.radius_m ?? 6371008.8) / 1000;
  return Math.max(0, km ?? 5) / radiusKm;
}

/** Countries and factions by name (case ignored), and a new country for a name not yet in the project. */
function ownersByName(world: World): { idFor: (tx: Tx, c: { name: string; color?: string }) => { id: string; created: boolean } } {
  const existing = new Map(world.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').map((e) => [e.name.toLowerCase(), e.id]));
  return {
    idFor(tx, c) {
      const known = existing.get(c.name.toLowerCase());
      if (known) return { id: known, created: false };
      const id = newId('ent');
      tx.insert('entity', { id, type_id: 'polity', branch_id: MAIN_BRANCH, name: c.name, color: c.color ?? suggestColor(world), notes: '', created_seq: world.nextSeq('entity'), style: '{}', group_id: '' });
      existing.set(c.name.toLowerCase(), id);
      return { id, created: true };
    },
  };
}

/**
 * Puts the outlines of countries into the parcel map and gives each its leaf parcels (its pieces less their
 * holes; a parcel goes to the first country covering it). Borders within `tol` of borders already there follow
 * them (D120: no slivers between a border and the same border drawn again). An outline that cannot be joined to
 * the borders around it is found by halves (the others go in), tried as drawn, and otherwise left out: its
 * country is named in `skipped`.
 */
function placeOutlines(tx: Tx, spaceId: string, countries: CountryToAdd[], tol: number, snap: number): { faces: Array<Set<number>>; skipped: string[] } {
  const world = tx.world;
  const rings: Vec3[][] = [];
  const parts: Array<Array<{ outer: number; holes: number[] }>> = [];
  for (const c of countries) {
    const polys: Array<{ outer: number; holes: number[] }> = [];
    for (const poly of c.polygons) {
      const outer = ringFromMapPoints(poly[0], 1);
      if (!outer) continue;
      const entry = { outer: rings.push(outer) - 1, holes: [] as number[] };
      for (const h of poly.slice(1)) { const hr = ringFromMapPoints(h, 1); if (hr) entry.holes.push(rings.push(hr) - 1); }
      polys.push(entry);
    }
    parts.push(polys);
  }
  const arr = world.arrangement(spaceId);
  // Each outline along the borders already there (kept as drawn where that leaves too few points for an area).
  const use = rings.map((r) => { if (!tol) return r; const f = arr.followBorders(r, tol, true); return f.length >= 3 ? f : r; });
  // The parcels inside each outline, worked out as soon as it is in (and followed through later splits below):
  // an outline put in by itself, when the whole set could not go in at once, is never put in again.
  const inside: Array<Set<number> | null> = rings.map(() => null);
  const tryInsert = (idx: number[]): boolean => {
    try {
      const ps = tx.kernel(spaceId, (a) => a.insertPaths(idx.map((i) => use[i]), { closed: true, snap }));
      const lefts = arr.facesLeftOfMany(ps);
      idx.forEach((i, k) => { const p = ps[k]; inside[i] = arr.isSimpleCycle(p) && arr.separatesFaces(p) ? lefts[k] : arr.facesWoundBy(p); });
      return true;
    } catch (e) {
      if (!(e instanceof TopologyError)) throw e;
      return false;
    }
  };
  const all = rings.map((_, i) => i), failed = new Set<number>();
  if (all.length && !tryInsert(all)) {
    const halves = (idx: number[]): void => {
      if (!idx.length || tryInsert(idx)) return;
      if (idx.length === 1) {
        const i = idx[0];
        if (use[i] !== rings[i]) { use[i] = rings[i]; if (tryInsert(idx)) return; }
        failed.add(i);
        return;
      }
      halves(idx.slice(0, idx.length >> 1));
      halves(idx.slice(idx.length >> 1));
    };
    halves(all);
  }
  const kids = childrenMap(arr);
  const insideOf = (i: number): Set<number> => leafDescendants(arr, inside[i] ?? [], kids);
  const covered = new Set<number>(), skipped: string[] = [];
  const faces = countries.map((c, k) => {
    const mine = new Set<number>();
    for (const p of parts[k]) {
      if (failed.has(p.outer)) continue;
      const holes = new Set<number>();
      for (const h of p.holes) for (const f of insideOf(h)) holes.add(f);
      for (const f of insideOf(p.outer)) if (!holes.has(f) && !covered.has(f)) mine.add(f);
    }
    if (parts[k].some((p) => failed.has(p.outer) || p.holes.some((h) => failed.has(h)))) skipped.push(c.name);
    for (const f of mine) covered.add(f);
    return mine;
  });
  return { faces, skipped };
}

// ---------------------------------------------------------------- locked countries (D87)

/** Whether a country is locked: its land and borders stay as they are until it is unlocked. */
export function isLocked(world: World, id: string | null | undefined): boolean {
  if (!id) return false;
  const e = world.get('entity', id);
  return !!e && e.style.includes('"locked"') && entityStyle(e).locked === true;
}

/** Lock or unlock countries (one undo step); the rest of their look is kept. */
export function setLocked(world: World, ids: string[], locked: boolean): CommandResult {
  for (const id of ids) if (!world.get('entity', id)) throw new Error('One of them no longer exists.');
  const what = ids.length === 1 ? `"${world.get('entity', ids[0])!.name}"` : `${ids.length} countries`;
  return run(world, `${locked ? 'Lock' : 'Unlock'} ${what}`, (tx) => {
    for (const id of ids) {
      if (isLocked(world, id) === locked) continue;
      const st = entityStyle(world.get('entity', id));
      if (locked) st.locked = true; else delete st.locked;
      tx.patch('entity', id, { style: JSON.stringify(st) });
    }
  });
}

/** The locked countries whose land edits left out since this was last asked (their names). */
let lockedLeftOut = new Set<string>();
export function takeLockedSkipped(): string[] {
  const out = [...lockedLeftOut];
  lockedLeftOut = new Set();
  return out;
}

/** Refuse an edit that would change a locked country. */
function refuseLocked(world: World, ids: Iterable<string | null | undefined>): void {
  for (const id of ids) if (id && isLocked(world, id)) throw new Error(`"${world.get('entity', id)!.name}" is locked: unlock it to change its land.`);
}

/** The moment an edit takes effect: who holds the land then is what a lock keeps. */
function editMoment(world: World, mode: EditMode): Instant {
  if (mode.kind !== 'new') return mode.t;
  if (mode.at) return mode.at;
  const ev = world.get('event', mode.eventId);
  return ev ? eventStart(ev) : NEG_INF;
}

/**
 * An edit's land without what locked countries hold at the edit's moment (named for takeLockedSkipped);
 * land is never given to a locked country (refused). Nothing to do when no country is locked.
 */
function withoutLocked<T extends { leaves: Iterable<number>; value: string | null }>(world: World, engine: Engine, spaceId: string, layerId: string, mode: EditMode, items: T[]): Array<{ leaves: number[]; value: string | null }> {
  if (!world.all('entity').some((e) => e.style.includes('"locked"') && isLocked(world, e.id))) return items.map((x) => ({ leaves: [...x.leaves], value: x.value }));
  refuseLocked(world, items.map((x) => x.value));
  const t = editMoment(world, mode);
  return items.map((x) => ({
    value: x.value,
    leaves: [...x.leaves].filter((leaf) => {
      const held = engine.latest(spaceId, layerId, leaf, t)?.value ?? null;
      if (!held || !isLocked(world, held)) return true;
      lockedLeftOut.add(world.get('entity', held)!.name);
      return false;
    }),
  }));
}

// ---------------------------------------------------------------- territory

export type EditMode =
  | { kind: 'new'; eventId: string; at?: Instant | null }
  /** Retroactive: fixes the period being viewed inside the change that started it (the starting map at NEG_INF). */
  | { kind: 'correct'; t: Instant }
  /** "Correct this period": a change from `t` on, until something later changes the area; no event. */
  | { kind: 'change'; t: Instant };

/** Write territory changes as the edit mode says (one change for all the items). */
function writeAssignments(tx: Tx, engine: Engine, spaceId: string, layerId: string, mode: EditMode, items: Array<{ leaves: Iterable<number>; value: string | null }>, extra: { transition?: TransitionSpec | null; intent?: unknown } = {}): void {
  items = withoutLocked(tx.world, engine, spaceId, layerId, mode, items);
  const arr = tx.world.arrangement(spaceId);
  if (mode.kind === 'correct' || (mode.kind === 'change' && mode.t.day === -Infinity)) {
    correctPeriods(tx, engine, spaceId, layerId, items, mode.t);
    return;
  }
  const sets: Array<[number[], string | null]> = items.map((x) => [canonicalFaces(arr, x.leaves), x.value]);
  const nonEmpty = sets.filter(([f]) => f.length);
  if (!nonEmpty.length) return;
  const id = mode.kind === 'new'
    ? insertAssignEffect(tx, { eventId: mode.eventId, spaceId, layerId, faces: nonEmpty[0][0], value: nonEmpty[0][1], at: mode.at ?? null, transition: extra.transition ?? null, intent: extra.intent })
    : insertAssignEffect(tx, { eventId: correctionEvent(tx, mode.t), spaceId, layerId, faces: nonEmpty[0][0], value: nonEmpty[0][1], at: mode.t, intent: extra.intent });
  if (nonEmpty.length > 1) tx.patch('effect', id, { resolution: JSON.stringify({ set: nonEmpty } satisfies Resolution) });
  if (mode.kind === 'new') chainRecorded(tx, id);
}

/**
 * Changes recorded to last "until the next change recorded into the event" (D86): a change put into
 * an event ends the one just before it on the same layer, if that one was recorded so; and one so
 * recorded itself lasts until the change just after it, if there is one (else until the event ends).
 */
function chainRecorded(tx: Tx, effectId: string): void {
  const world = tx.world;
  const ef = world.get('effect', effectId);
  const ev = ef ? world.get('event', ef.event_id) : undefined;
  if (!ef || !ev || isBaseEvent(ev.id) || ef.kind !== 'assign') return;
  const t = effectTime(ef, ev);
  let before: Instant | null = null, after: Instant | null = null;
  const others = world.all('effect').filter((f) => f.id !== ef.id && f.event_id === ev.id && f.kind === 'assign' && f.layer_id === ef.layer_id);
  for (const f of others) {
    const ft = effectTime(f, ev);
    const c = compare(ft, t);
    if (c < 0 && (!before || compare(ft, before) > 0)) before = ft;
    if (c > 0 && (!after || compare(ft, after) < 0)) after = ft;
  }
  if (before) {
    for (const f of others) {
      const spec = parseJSON<TransitionSpec | null>(f.transition, null);
      if (spec?.next && compare(effectTime(f, ev), before) === 0) tx.patch('effect', f.id, { transition: JSON.stringify({ ...spec, until: toStore(t) }) });
    }
  }
  const own = parseJSON<TransitionSpec | null>(ef.transition, null);
  if (own?.next) {
    const { until: _old, ...rest } = own;
    tx.patch('effect', ef.id, { transition: JSON.stringify(after ? { ...rest, until: toStore(after) } : rest) });
  }
}

/**
 * How long a change in an event takes (D86): until a moment, for a while from its own time, or (null)
 * until its event ends. It keeps how it spreads; it is no longer tied to the next change recorded.
 */
export function setEffectLength(world: World, effectId: string, length: { until: Instant } | { for: { n: number; unit: 'day' | 'month' | 'year' } } | null): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef) throw new Error('That change no longer exists.');
  const spec = parseJSON<TransitionSpec | null>(ef.transition, null);
  if (!spec || spec.style === 'instant') throw new Error('This change happens at once: choose how it spreads first.');
  const { until: _u, for: _f, next: _n, ...rest } = spec;
  let next: TransitionSpec = rest;
  if (length && 'until' in length) next = { ...rest, until: toStore(length.until) };
  else if (length && 'for' in length) {
    const n = Math.round(length.for.n);
    if (!(n >= 1)) throw new Error('A change takes at least one day, month or year.');
    if (!['day', 'month', 'year'].includes(length.for.unit)) throw new Error('Unknown unit of time.');
    next = { ...rest, for: { n, unit: length.for.unit } };
  }
  return run(world, 'Change how long a change takes', (tx) => tx.patch('effect', effectId, { transition: JSON.stringify(next) }));
}

function nextOrdinal(world: World, eventId: string): number {
  return world.all('effect').filter((f) => f.event_id === eventId).reduce((m, f) => Math.max(m, f.ordinal), 0) + 1;
}

function insertAssignEffect(tx: Tx, o: { eventId: string; spaceId: string; layerId: string; faces: number[]; value: string | null; at?: Instant | null; transition?: TransitionSpec | null; intent?: unknown }): string {
  const id = newId('eff');
  const at = o.at ? toStore(o.at) : null;
  recordable(tx.world, o.eventId, at);
  tx.insert('effect', {
    id, event_id: o.eventId, ordinal: nextOrdinal(tx.world, o.eventId), kind: 'assign', space_id: o.spaceId, layer_id: o.layerId,
    at_day: at ? at[0] : null, at_ms: at ? at[1] : null,
    transition: o.transition ? JSON.stringify(o.transition) : '',
    intent: JSON.stringify(o.intent ?? { op: 'set', value: o.value }),
    resolution: JSON.stringify({ set: [[o.faces, o.value]] } satisfies Resolution), basis_hash: '',
  });
  return id;
}

/** "Correct this period": change the value from the moment the current one was set, inside that same change. */
function correctPeriod(tx: Tx, engine: Engine, spaceId: string, layerId: string, leaves: Iterable<number>, value: string | null, t: Instant): void {
  correctPeriods(tx, engine, spaceId, layerId, [{ leaves, value }], t);
}

/**
 * Several corrections of the period being viewed at once: every change they fall under is read
 * first, then each is written once (one re-reading of history however many items there are).
 */
function correctPeriods(tx: Tx, engine: Engine, spaceId: string, layerId: string, items: Array<{ leaves: Iterable<number>; value: string | null }>, t: Instant): void {
  const world = tx.world;
  const arr = world.arrangement(spaceId);
  // effect id ('' = nothing set it yet) -> the sets of parcels and their new owners, in item order
  const byEffect = new Map<string, Array<[number[], string | null]>>();
  for (const { leaves, value } of items) {
    const groups = new Map<string, number[]>();
    for (const leaf of leaves) {
      const a = engine.latest(spaceId, layerId, leaf, t);
      const key = a ? a.effectId : '';
      let l = groups.get(key);
      if (!l) groups.set(key, (l = []));
      l.push(leaf);
    }
    for (const [effectId, faces] of groups) {
      let l = byEffect.get(effectId);
      if (!l) byEffect.set(effectId, (l = []));
      l.push([canonicalFaces(arr, faces), value]);
    }
  }
  for (const [effectId, sets] of byEffect) {
    if (effectId) {
      const ef = world.get('effect', effectId)!;
      const res = parseJSON<Resolution>(ef.resolution, { set: [] });
      res.set.push(...sets);
      tx.patch('effect', effectId, { resolution: JSON.stringify(res) });
      continue;
    }
    // Nothing set it yet: correct the base world (its undated change; dated ones are changes made
    // without an event).
    const base = world.all('effect').find((f) => f.event_id === BASE_EVENT_ID && f.layer_id === layerId && f.kind === 'assign' && f.at_day === null);
    if (base) {
      const res = parseJSON<Resolution>(base.resolution, { set: [] });
      res.set.push(...sets);
      tx.patch('effect', base.id, { resolution: JSON.stringify(res) });
    } else {
      const id = insertAssignEffect(tx, { eventId: BASE_EVENT_ID, spaceId, layerId, faces: sets[0][0], value: sets[0][1] });
      // The change's assignments are its resolution sets: the first is written by insertAssignEffect.
      if (sets.length > 1) tx.patch('effect', id, { resolution: JSON.stringify({ set: sets }) });
    }
  }
}

export interface PaintInput {
  spaceId: string; layerId: string;
  /** Closed ring as unit vectors, interior on the left (counter-clockwise on the map). */
  ring?: Vec3[];
  /** Several rings painted together (e.g. a lasso split where it crossed itself). */
  rings?: Vec3[][];
  value: string | null;
  snap: number;
  mode: EditMode;
  transition?: TransitionSpec | null;
}

/** Give an area to an owner (or clear it). The area's outline permanently cuts the parcel map. */
export function paintTerritory(world: World, engine: Engine, p: PaintInput): CommandResult<{ faces: number[] }> {
  const who = p.value ? world.get('entity', p.value)?.name ?? 'someone' : 'nobody';
  return run(world, p.mode.kind === 'new' ? `Give territory to ${who}` : p.mode.kind === 'change' ? `Change territory to ${who}` : `Correct territory to ${who}`, (tx) => {
    const faces: number[] = [];
    paintInside(tx, engine, p, faces);
    return { faces };
  });
}

/** Refuse territory edits that would refer to the wrong map, a missing layer, event or owner. */
function checkTarget(world: World, o: { spaceId: string; layerId: string; value?: string | null; mode?: EditMode; eventId?: string }): void {
  const layer = world.get('layer', o.layerId);
  if (!world.get('map_space', o.spaceId)) throw new Error('That map no longer exists.');
  if (!layer) throw new Error('That layer no longer exists.');
  if (layer.space_id !== o.spaceId) throw new Error(`The layer "${layer.name}" belongs to another map.`);
  if (layer.kind !== 'partition') throw new Error(`The layer "${layer.name}" does not hold territory.`);
  if (o.value && !world.get('entity', o.value)) throw new Error('That owner no longer exists.');
  const eventId = o.eventId ?? (o.mode?.kind === 'new' ? o.mode.eventId : undefined);
  if (eventId && !world.get('event', eventId)) throw new Error('That event no longer exists.');
}

function paintInside(tx: Tx, engine: Engine, p: PaintInput, out: number[] = []): string {
  const world = tx.world;
  checkTarget(world, p);
  const rings = p.rings ?? (p.ring ? [p.ring] : []);
  if (rings.length === 0) throw new Error('Nothing to paint.');
  // Collect each ring's inside right after inserting it: a later ring may split earlier borders,
  // and pieces of split parcels are covered through their parent (children inherit).
  const insideAll = new Set<number>();
  // All rings go in together (one rebuild of the map's structure); each is then read in turn.
  const paths = tx.kernel(p.spaceId, (arr) => arr.insertPaths(rings, { closed: true, snap: p.snap }));
  for (const path of paths) {
    const arr = world.arrangement(p.spaceId);
    // A simple outline paints what lies on its left (so shapes larger than a hemisphere work).
    // Check that against the area the outline encloses, computed independently from its points: if
    // they differ, the outline crosses, folds back or overlaps itself, and it paints every area it
    // goes around instead (DECISIONS D23), exactly as drawn.
    let inside = arr.facesLeftOf(path);
    const enclosed = arr.pathLeftArea(path);
    const full = 4 * Math.PI;
    // A simple loop encloses exactly its left side; only other outlines need the area comparison
    // (which on a large map costs more than the rest of the edit).
    const simple = enclosed > 1e-15 && enclosed < full - 1e-15 && arr.isSimpleCycle(path) && arr.separatesFaces(path);
    let covered = enclosed;
    if (!simple) { covered = 0; for (const f of leafDescendants(arr, inside)) covered += arr.faceArea(f); }
    if (!simple && (enclosed < 1e-15 || enclosed > full - 1e-15 || Math.abs(covered - enclosed) > 1e-9 + 1e-6 * enclosed)) {
      inside = arr.facesWoundBy(path);
      let wound = 0;
      for (const f of leafDescendants(arr, inside)) wound += arr.faceArea(f);
      if (wound < 1e-15) throw new Error('This outline encloses no area (it may be too thin at this zoom level). Draw it a little wider.');
    }
    for (const f of inside) insideAll.add(f);
  }
  const arr = world.arrangement(p.spaceId);
  const inside = [...leafDescendants(arr, insideAll)];
  writeAssignments(tx, engine, p.spaceId, p.layerId, p.mode, [{ leaves: inside, value: p.value }], { transition: p.mode.kind === 'new' ? p.transition ?? null : null, intent: { op: 'paint', value: p.value } });
  for (const f of inside) out.push(f);
  return 'paint';
}

/** Create an event and give it a territorial change, as one undoable step. */
export function paintWithNewEvent(world: World, engine: Engine, e: EventInput, p: Omit<PaintInput, 'mode'>): CommandResult<{ eventId: string }> {
  const painted = { label: '' };
  const r = run(world, `Create event "${e.name}"`, (tx) => {
    const eventId = insertEventIn(tx, e);
    const inner = paintInside(tx, engine, { ...p, mode: { kind: 'new', eventId } });
    painted.label = inner;
    return { eventId };
  });
  return r;
}

/** Give a set of existing parcels to an owner (used by the region picker and fill tool). */
export function assignFaces(world: World, engine: Engine, o: { spaceId: string; layerId: string; leaves: number[]; value: string | null; mode: EditMode; transition?: TransitionSpec | null }): CommandResult {
  const who = o.value ? world.get('entity', o.value)?.name ?? 'someone' : 'nobody';
  return run(world, `Give territory to ${who}`, (tx) => {
    checkTarget(world, o);
    writeAssignments(tx, engine, o.spaceId, o.layerId, o.mode, [{ leaves: o.leaves, value: o.value }], { transition: o.transition ?? null });
  });
}

// ---------------------------------------------------------------- splitting and merging (Stage 2, D76)

/** Who gets the land: an existing owner, or a new country made in the same step. */
export type NewOwner = string | { name: string; color?: string; type_id?: string };

function ownerIn(tx: Tx, to: NewOwner): string {
  if (typeof to === 'string') {
    if (!tx.world.get('entity', to)) throw new Error('That owner no longer exists.');
    return to;
  }
  if (!to.name.trim()) throw new Error('Give the new country a name.');
  const id = newId('ent');
  tx.insert('entity', { id, type_id: to.type_id ?? 'polity', branch_id: MAIN_BRANCH, name: to.name.trim(), color: to.color ?? suggestColor(tx.world), notes: '', created_seq: tx.world.nextSeq('entity'), style: '{}', group_id: '' });
  return id;
}

/** The owner of every parcel at a date, also for parcels split since the date was read (children inherit). */
function ownerReader(arr: ReturnType<World['arrangement']>, states: Map<number, { value: string | null }>): (f: number) => string | null {
  return (f) => {
    const st = states.get(f);
    if (st) return st.value;
    for (const a of arr.ancestors(f)) { const x = states.get(a); if (x) return x.value; }
    return null;
  };
}

/**
 * Split a country along a line: the line becomes a border (it cuts the parcel map, as an outline
 * does), and the part of the country on the side that was clicked (`pick`: its land reached from
 * there without crossing the line) goes to `to`, an existing owner or a new country. The country is
 * the one holding `pick` on date `t`. With `newEvent`, an event is made for it in the same step.
 */
export function splitTerritory(world: World, engine: Engine, o: { spaceId: string; layerId: string; line: Vec3[]; pick: Vec3; t: Instant; snap: number; to: NewOwner; mode: EditMode; newEvent?: EventInput; transition?: TransitionSpec | null }): CommandResult<{ owner: string; faces: number[]; eventId?: string }> {
  checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, mode: o.newEvent ? undefined : o.mode });
  if (o.line.length < 2) throw new Error('Draw a line across the country.');
  const states = engine.partitionState(o.spaceId, o.layerId, o.t);
  const country = engine.valueAtPoint(o.spaceId, o.layerId, o.pick, o.t);
  if (!country) throw new Error('Click the part of a country that changes hands.');
  refuseLocked(world, [country, typeof o.to === 'string' ? o.to : null]);
  const name = world.get('entity', country)?.name ?? 'the country';
  if (typeof o.to === 'string' && o.to === country) throw new Error(`That part already belongs to ${name}.`);
  return run(world, `Split ${name}`, (tx) => {
    const [path] = tx.kernel(o.spaceId, (arr) => arr.insertPaths([o.line], { closed: false, snap: o.snap }));
    const arr = world.arrangement(o.spaceId);
    const ownerOf = ownerReader(arr, states);
    const barrier = new Set(path.map((st) => st.seg));
    // The country's land reached from the click without crossing the line.
    const start = arr.locate(o.pick);
    const part = new Set([start]);
    const queue = [start];
    const topo = arr.topology();
    while (queue.length) {
      const f = queue.pop()!;
      for (const c of topo.facesCycles.get(f) ?? []) for (const h of topo.cycles.get(c)!) {
        const sid = h >> 1;
        if (barrier.has(sid)) continue;
        const sg = arr.segments.get(sid)!;
        const g = (h & 1) === 0 ? sg.right_face : sg.left_face;
        if (g !== f && !part.has(g) && ownerOf(g) === country) { part.add(g); queue.push(g); }
      }
    }
    // The line must divide the country: somewhere along it, the country lies on both sides, one side in the part and the other not.
    let divides = false;
    for (const id of barrier) {
      const sg = arr.segments.get(id)!;
      if (ownerOf(sg.left_face) === country && ownerOf(sg.right_face) === country && part.has(sg.left_face) !== part.has(sg.right_face)) { divides = true; break; }
    }
    if (!divides) throw new Error(`The line does not cut ${name} in two. Draw it right across, from outside the country to outside it (or from border to border).`);
    const owner = ownerIn(tx, o.to);
    const eventId = o.newEvent ? insertEventIn(tx, o.newEvent) : undefined;
    const mode: EditMode = eventId ? { kind: 'new', eventId } : o.mode;
    const faces = [...part];
    writeAssignments(tx, engine, o.spaceId, o.layerId, mode, [{ leaves: faces, value: owner }], { transition: mode.kind === 'new' ? o.transition ?? null : null, intent: { op: 'paint', value: owner } });
    return { owner, faces, eventId };
  });
}

/**
 * Merge countries: all the land the others hold on date `t` goes to `into` (one of them, another
 * owner, or a new country made in the same step). The others keep their names and history; from then
 * on they hold no land there.
 */
export function mergeTerritory(world: World, engine: Engine, o: { spaceId: string; layerId: string; ids: string[]; into: NewOwner; t: Instant; mode: EditMode; newEvent?: EventInput; transition?: TransitionSpec | null }): CommandResult<{ owner: string; faces: number[]; eventId?: string }> {
  checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, mode: o.newEvent ? undefined : o.mode });
  for (const id of o.ids) if (!world.get('entity', id)) throw new Error('One of them no longer exists.');
  refuseLocked(world, [...o.ids, typeof o.into === 'string' ? o.into : null]);
  // (Into one of them, another country, or a new one: at least one country's land moves.)
  const moving = new Set(o.ids.filter((id) => id !== o.into));
  if (!moving.size) throw new Error('Choose at least two countries to merge.');
  const leaves: number[] = [];
  for (const [f, st] of engine.partitionState(o.spaceId, o.layerId, o.t)) if (st.value && moving.has(st.value)) leaves.push(f);
  const names = o.ids.map((id) => world.get('entity', id)!.name);
  if (!leaves.length) throw new Error(`${moving.size === 1 ? `${world.get('entity', [...moving][0])!.name} holds` : 'They hold'} no land on this map at this date.`);
  return run(world, `Merge ${names.join(', ')}`, (tx) => {
    const owner = ownerIn(tx, o.into);
    const eventId = o.newEvent ? insertEventIn(tx, o.newEvent) : undefined;
    const mode: EditMode = eventId ? { kind: 'new', eventId } : o.mode;
    writeAssignments(tx, engine, o.spaceId, o.layerId, mode, [{ leaves, value: owner }], { transition: mode.kind === 'new' ? o.transition ?? null : null, intent: { op: 'paint', value: owner } });
    return { owner, faces: leaves, eventId };
  });
}

/** Intention-bearing change: everything `from` holds just before the event goes to `to`. */
export function annex(world: World, engine: Engine, o: { spaceId: string; layerId: string; eventId: string; from: string; to: string; at?: Instant | null; transition?: TransitionSpec | null }): CommandResult<string> {
  const a = world.get('entity', o.from)?.name ?? '?', b = world.get('entity', o.to)?.name ?? '?';
  return run(world, `${b} annexes ${a}`, (tx) => {
    checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, value: o.to, eventId: o.eventId });
    if (!world.get('entity', o.from)) throw new Error('That owner no longer exists.');
    refuseLocked(world, [o.from, o.to]);
    const id = newId('eff');
    const at = o.at ? toStore(o.at) : null;
    recordable(world, o.eventId, at);
    const row: EffectRow = {
      id, event_id: o.eventId, ordinal: nextOrdinal(world, o.eventId), kind: 'annex', space_id: o.spaceId, layer_id: o.layerId,
      at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition: o.transition ? JSON.stringify(o.transition) : '',
      intent: JSON.stringify({ op: 'annex', from: o.from, to: o.to } satisfies AnnexIntent), resolution: JSON.stringify({ set: [] }), basis_hash: '',
    };
    tx.insert('effect', row);
    const basis = engine.basisFor(row, o.from);
    tx.patch('effect', id, { resolution: JSON.stringify({ set: [[basis, o.to]] }), basis_hash: hashFaces(basis) });
    return id;
  });
}

/** History Health: accept a stale intention as stored. */
export function keepAsStored(world: World, engine: Engine, effectId: string): CommandResult {
  return run(world, 'Keep change as stored', (tx) => {
    const ef = world.get('effect', effectId);
    const intent = ef ? parseJSON<AnnexIntent | null>(ef.intent, null) : null;
    if (!ef || !intent) throw new Error('Nothing to keep.');
    tx.patch('effect', effectId, { basis_hash: hashFaces(engine.basisFor(ef, intent.from)) });
  });
}

/** History Health: work the intention out again from history as it now stands. */
export function reapplyIntent(world: World, engine: Engine, effectId: string): CommandResult {
  return run(world, 'Re-apply intention', (tx) => {
    const ef = world.get('effect', effectId);
    const intent = ef ? parseJSON<AnnexIntent | null>(ef.intent, null) : null;
    if (!ef || !intent) throw new Error('Nothing to re-apply.');
    const basis = engine.basisFor(ef, intent.from);
    tx.patch('effect', effectId, { resolution: JSON.stringify({ set: [[basis, intent.to]] }), basis_hash: hashFaces(basis) });
  });
}

// ---------------------------------------------------------------- characters (points, never territory)

/**
 * Place a character on a map from a date on: a point, with no borders. Without an event (mode
 * 'change') or as part of an event (mode 'new'). Placing a character again at the same moment moves
 * that placement instead of adding another. `arrive`: travels here from its previous place
 * (moving steadily between the two dates), or appears here at the date.
 */
export function placeCharacter(world: World, o: { spaceId: string; entity: string; lon: number; lat: number; mode: EditMode; arrive?: 'travel' | 'jump' }): CommandResult<string> {
  const e = world.get('entity', o.entity);
  if (!e) throw new Error('That character no longer exists.');
  if (!world.get('map_space', o.spaceId)) throw new Error('That map no longer exists.');
  if (!Number.isFinite(o.lon) || !Number.isFinite(o.lat) || Math.abs(o.lat) > 90) throw new Error('That place is not on the map.');
  const lon = ((((o.lon + 180) % 360) + 360) % 360) - 180;
  // Characters travel between their places; cities and other places move (if at all) at once.
  const arrive = o.arrive ?? (e.type_id === 'character' ? undefined : 'jump');
  return run(world, `Place ${e.name}`, (tx) => writePlacement(tx, o.spaceId, o.entity, o.mode, { lon, lat: o.lat, arrive }));
}

/**
 * Stars of a space map held by a country or faction from a date on (D111): without an event (mode
 * 'change'), in an event (mode 'new'), or from the beginning (mode 'correct' at NEG_INF). `entity` ''
 * gives them to nobody from then on. One undo step; giving a star again at the same moment, in the
 * same event, replaces that change. `label` names them for the undo list.
 */
export function holdStars(world: World, o: { spaceId: string; stars: number[]; entity: string; mode: EditMode; label?: string }): CommandResult<number> {
  const space = world.get('map_space', o.spaceId);
  if (!space || space.kind !== 'space') throw new Error('Stars are held on star maps.');
  const e = o.entity ? world.get('entity', o.entity) : null;
  if (o.entity && !e) throw new Error('That country or faction no longer exists.');
  const stars = [...new Set(o.stars.filter((x) => Number.isInteger(x) && x >= 0))];
  if (!stars.length) throw new Error('Choose at least one star.');
  const what = o.label ?? (stars.length === 1 ? 'a star' : `${stars.length} stars`);
  return run(world, e ? `Give ${what} to ${e.name}` : `${what[0].toUpperCase()}${what.slice(1)} held by nobody`, (tx) => {
    if (o.mode.kind === 'new' && !tx.world.get('event', o.mode.eventId)) throw new Error('That event no longer exists.');
    const eventId = eventForMode(tx, o.mode);
    const t: Instant | null = o.mode.kind === 'new' ? o.mode.at ?? null : o.mode.t;
    const at = t && t.day !== -Infinity ? toStore(t) : null;
    recordable(tx.world, eventId, at);
    for (const star of stars) {
      const intent: SystemIntent = { op: 'system', star, entity: o.entity };
      const same = tx.world.all('effect').find((f) => f.kind === 'system' && f.space_id === o.spaceId && f.event_id === eventId && f.at_day === (at ? at[0] : null) && f.at_ms === (at ? at[1] : null) && parseJSON<SystemIntent | null>(f.intent, null)?.star === star);
      if (same) { tx.patch('effect', same.id, { intent: JSON.stringify(intent) }); continue; }
      tx.insert('effect', {
        id: newId('eff'), event_id: eventId, ordinal: nextOrdinal(tx.world, eventId), kind: 'system', space_id: o.spaceId, layer_id: null,
        at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition: '', intent: JSON.stringify(intent), resolution: JSON.stringify({ set: [] }), basis_hash: '',
      });
    }
    return stars.length;
  });
}

/**
 * A lane between two stars of a space map from a date on (D112): opened (belonging to a country or
 * faction, or to nobody) or closed. Opened in an event with a length and `grow`, it grows from star `a`
 * to star `b` over the rest of the event (an expedition, a fleet on its way). One undo step; the same
 * lane at the same moment in the same event replaces that change.
 */
export function setLane(world: World, o: { spaceId: string; a: number; b: number; on: boolean; entity: string; mode: EditMode; grow?: boolean; label?: string }): CommandResult<string> {
  const space = world.get('map_space', o.spaceId);
  if (!space || space.kind !== 'space') throw new Error('Lanes join stars on star maps.');
  if (!Number.isInteger(o.a) || !Number.isInteger(o.b) || o.a < 0 || o.b < 0) throw new Error('Choose two stars.');
  if (o.a === o.b) throw new Error('A lane joins two different stars.');
  const e = o.entity ? world.get('entity', o.entity) : null;
  if (o.entity && !e) throw new Error('That country or faction no longer exists.');
  const what = o.label ?? 'a lane';
  return run(world, o.on ? `Open ${what}${e ? ` (${e.name})` : ''}` : `Close ${what}`, (tx) => {
    if (o.mode.kind === 'new' && !tx.world.get('event', o.mode.eventId)) throw new Error('That event no longer exists.');
    const eventId = eventForMode(tx, o.mode);
    const t: Instant | null = o.mode.kind === 'new' ? o.mode.at ?? null : o.mode.t;
    const at = t && t.day !== -Infinity ? toStore(t) : null;
    recordable(tx.world, eventId, at);
    const intent: LaneIntent = { op: 'lane', a: o.a, b: o.b, on: o.on, entity: o.entity };
    const transition = o.on && o.grow && o.mode.kind === 'new' ? JSON.stringify({ grow: true }) : '';
    const key = laneKey(o.a, o.b);
    const same = tx.world.all('effect').find((f) => {
      if (f.kind !== 'lane' || f.space_id !== o.spaceId || f.event_id !== eventId || f.at_day !== (at ? at[0] : null) || f.at_ms !== (at ? at[1] : null)) return false;
      const it = parseJSON<LaneIntent | null>(f.intent, null);
      return !!it && laneKey(it.a, it.b) === key;
    });
    if (same) { tx.patch('effect', same.id, { intent: JSON.stringify(intent), transition }); return same.id; }
    const id = newId('eff');
    tx.insert('effect', {
      id, event_id: eventId, ordinal: nextOrdinal(tx.world, eventId), kind: 'lane', space_id: o.spaceId, layer_id: null,
      at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition, intent: JSON.stringify(intent), resolution: JSON.stringify({ set: [] }), basis_hash: '',
    });
    return id;
  });
}

/** A character leaves the map from a date on (until placed again). */
export function characterLeaves(world: World, o: { spaceId: string; entity: string; mode: EditMode }): CommandResult<string> {
  const e = world.get('entity', o.entity);
  if (!e) throw new Error('That character no longer exists.');
  return run(world, `${e.name} leaves the map`, (tx) => writePlacement(tx, o.spaceId, o.entity, o.mode, { off: true }));
}

/** Whether a character travels to a placement from the previous one, or appears there. */
export function setPlacementArrival(world: World, effectId: string, arrive: 'travel' | 'jump'): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef || ef.kind !== 'place') throw new Error('That placement no longer exists.');
  const it = parseJSON<PlaceIntent>(ef.intent, { op: 'place', entity: '' });
  return run(world, arrive === 'travel' ? 'Travels there' : 'Appears there', (tx) => tx.patch('effect', effectId, { intent: JSON.stringify({ ...it, arrive }) }));
}

/**
 * A new name from a date on (Constantinople becomes Istanbul): for a country, city or character.
 * Without an event (mode 'change'), in an event (mode 'new'), or from the beginning (mode 'correct' at
 * NEG_INF). Renaming again at the same moment replaces that name.
 */
export function renameFrom(world: World, o: { entity: string; name: string; mode: EditMode }): CommandResult<string> {
  const e = world.get('entity', o.entity);
  if (!e) throw new Error('That no longer exists.');
  const name = o.name.trim();
  if (!name) throw new Error('Give the new name.');
  return run(world, `${e.name} is called ${name}`, (tx) => {
    if (o.mode.kind === 'new' && !world.get('event', o.mode.eventId)) throw new Error('That event no longer exists.');
    const eventId = eventForMode(tx, o.mode);
    const t: Instant | null = o.mode.kind === 'new' ? o.mode.at ?? null : o.mode.t;
    const at = t && t.day !== -Infinity ? toStore(t) : null;
    recordable(world, eventId, at);
    const same = world.all('effect').find((f) => f.kind === 'rename' && f.event_id === eventId && f.at_day === (at ? at[0] : null) && f.at_ms === (at ? at[1] : null)
      && parseJSON<RenameIntent | null>(f.intent, null)?.entity === o.entity);
    const intent = JSON.stringify({ op: 'rename', entity: o.entity, name } satisfies RenameIntent);
    if (same) { tx.patch('effect', same.id, { intent }); return same.id; }
    const id = newId('eff');
    tx.insert('effect', {
      id, event_id: eventId, ordinal: nextOrdinal(world, eventId), kind: 'rename', space_id: null, layer_id: null,
      at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition: '', intent, resolution: JSON.stringify({ set: [] }), basis_hash: '',
    });
    return id;
  });
}

/** A placement made without an event holds from the beginning instead of from its date (the starting map). */
export function placementFromBeginning(world: World, effectId: string): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef || ef.kind !== 'place') throw new Error('That placement no longer exists.');
  if (!isBaseEvent(ef.event_id)) throw new Error('This place belongs to an event; change the event instead.');
  return run(world, 'From the beginning', (tx) => tx.patch('effect', effectId, { at_day: null, at_ms: null }));
}

// ---------------------------------------------------------------- areas, lines and points (feature layers)

/** The kind of a feature (its layer's), or null when its layer is gone or is not a feature layer. */
export function featureKind(world: World, f: Pick<FeatureRow, 'layer_id'>): FeatureKind | null {
  const k = world.get('layer', f.layer_id)?.kind;
  return k && isFeatureKind(k) ? k : null;
}

/**
 * Checked shape parts for a kind of feature (see ShapeIntent): longitudes brought into -180..180 for
 * the first point of each part and kept continuous along it, latitudes within the poles, consecutive
 * repeats dropped. An area needs a ring of three places or more, a line two, a point one.
 */
export function shapeParts(kind: FeatureKind, parts: Array<Array<[number, number]>>): number[][] {
  const out: number[][] = [];
  const need = kind === 'area' ? 3 : kind === 'line' ? 2 : 1;
  for (const pts of kind === 'point' ? parts.slice(0, 1) : parts) {
    const flat: number[] = [];
    let prevLon = NaN, prevLat = NaN;
    for (const [lon0, lat0] of kind === 'point' ? pts.slice(0, 1) : pts) {
      if (!Number.isFinite(lon0) || !Number.isFinite(lat0)) continue;
      const lat = Math.max(-90, Math.min(90, lat0));
      let lon = ((((lon0 + 180) % 360) + 360) % 360) - 180;
      // Continuous along the part: never a jump of more than half a turn between neighbours.
      if (prevLon === prevLon) lon += 360 * Math.round((prevLon - lon) / 360);
      if (lon === prevLon && lat === prevLat) continue;
      flat.push(+lon.toFixed(7), +lat.toFixed(7));
      prevLon = lon; prevLat = lat;
    }
    // A ring given closed (its last place repeats its first) is kept open: rings close themselves.
    if (kind === 'area' && flat.length >= 4 && Math.abs(flat[0] - flat[flat.length - 2]) < 1e-9 && Math.abs(flat[1] - flat[flat.length - 1]) < 1e-9) flat.splice(-2, 2);
    if (flat.length >= 2 * need) out.push(flat);
  }
  if (!out.length) throw new Error(kind === 'area' ? 'An area needs at least three places.' : kind === 'line' ? 'A line needs at least two places.' : 'That place is not on the map.');
  return out;
}

/**
 * Draw a new area, line or point on a feature layer: it exists from the date the edit mode gives
 * ('correct' at the beginning of time: always), as part of an event (mode 'new') or not.
 */
export function createFeature(world: World, o: { layerId: string; name: string; entity?: string; parts: Array<Array<[number, number]>>; mode: EditMode; style?: FeatureStyle; anim?: FeatureAnimStyle | null }): CommandResult<string> {
  const layer = world.get('layer', o.layerId);
  if (!layer || !isFeatureKind(layer.kind)) throw new Error('Choose a layer of areas, lines or points first.');
  if (o.entity && !world.get('entity', o.entity)) throw new Error('That country or faction no longer exists.');
  const parts = shapeParts(layer.kind, o.parts);
  const name = o.name.trim() || ({ area: 'Area', line: 'Line', point: 'Point' } as const)[layer.kind];
  return run(world, `Draw "${name}"`, (tx) => {
    const id = newId('feat');
    tx.insert('feature', { id, layer_id: layer.id, name, entity_id: o.entity ?? '', style: o.style ? JSON.stringify(o.style) : '{}', notes: '', created_seq: world.nextSeq('feature') });
    writeShape(tx, id, o.mode, { parts, anim: o.anim ?? null });
    return id;
  });
}

/**
 * A new shape for a feature. Mode 'new' (in an event) or 'change' (no event): from that date on,
 * until it is shaped again. Mode 'correct': the shape the feature has at that date is redrawn,
 * wherever it began (at the beginning of time when the feature does not exist yet).
 */
export function reshapeFeature(world: World, engine: Engine, o: { feature: string; parts: Array<Array<[number, number]>>; mode: EditMode; anim?: FeatureAnimStyle | null }): CommandResult<string> {
  const f = world.get('feature', o.feature);
  const kind = f ? featureKind(world, f) : null;
  if (!f || !kind) throw new Error('That area, line or point no longer exists.');
  const parts = shapeParts(kind, o.parts);
  return run(world, `Reshape "${f.name}"`, (tx) => correctOrWrite(tx, engine, f, o.mode, { parts, anim: o.anim ?? null }));
}

/** A feature stops existing from a date on (until shaped again): a city wall torn down, a claim given up. */
export function endFeature(world: World, engine: Engine, o: { feature: string; mode: EditMode }): CommandResult<string> {
  const f = world.get('feature', o.feature);
  if (!f) throw new Error('That area, line or point no longer exists.');
  if (o.mode.kind === 'correct' && o.mode.t.day === -Infinity) throw new Error('To remove it altogether, delete it.');
  return run(world, `"${f.name}" ends`, (tx) => correctOrWrite(tx, engine, f, o.mode.kind === 'correct' ? { kind: 'change', t: o.mode.t } : o.mode, { off: true }));
}

/** Name, what it belongs to, look and notes of a feature (not dated). */
export function updateFeature(world: World, id: string, patch: Partial<{ name: string; entity_id: string; style: FeatureStyle | null; notes: string; layer_id: string }>): CommandResult {
  const f = world.get('feature', id);
  if (!f) throw new Error('That area, line or point no longer exists.');
  if (patch.entity_id && !world.get('entity', patch.entity_id)) throw new Error('That country or faction no longer exists.');
  if (patch.layer_id !== undefined) {
    const to = world.get('layer', patch.layer_id), from = world.get('layer', f.layer_id);
    if (!to || to.kind !== from?.kind || to.space_id !== from.space_id) throw new Error('It can only move to another layer of the same kind on the same map.');
  }
  const row: Partial<FeatureRow> = {};
  if (patch.name !== undefined) row.name = patch.name.trim() || f.name;
  if (patch.entity_id !== undefined) row.entity_id = patch.entity_id;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.layer_id !== undefined) row.layer_id = patch.layer_id;
  if (patch.style !== undefined) row.style = patch.style ? JSON.stringify({ ...parseJSON<object>(f.style, {}), ...patch.style }) : '{}';
  return run(world, `Change "${f.name}"`, (tx) => tx.patch('feature', id, row));
}

/** A new field layer (D102): radiation, fire, smoke and ash, flood, destruction, a heatmap or a custom one. */
export function createFieldLayer(world: World, spaceId: string, name: string, type: FieldType): CommandResult<string> {
  if (!world.get('map_space', spaceId)) throw new Error('That map no longer exists.');
  if (!isFieldType(type)) throw new Error('Unknown kind of field.');
  const n = name.trim() || FIELD_TYPES[type].name;
  return run(world, `Create layer "${n}"`, (tx) => {
    const id = newId('layer');
    const order = world.all('layer').filter((l) => l.space_id === spaceId).length;
    tx.insert('layer', { id, space_id: spaceId, kind: 'field', name: n, sort_order: order, visible: 1, style: JSON.stringify({ field: { type, opacity: 1 } }), export_pass: n.toLowerCase().replace(/\W+/g, '-') });
    return id;
  });
}

/**
 * A field layer's kind, opacity, and for a heatmap the layer of points it is worked out from, how far
 * each point spreads and how many make the colours full (D105); not dated: how it is drawn.
 */
export function setFieldLayerStyle(world: World, layerId: string, patch: Partial<{ type: FieldType; opacity: number; from: string | null; kernelKm: number; full: number | null }>): CommandResult {
  const layer = world.get('layer', layerId);
  if (!layer || layer.kind !== 'field') throw new Error('That field layer no longer exists.');
  if (patch.type !== undefined && !isFieldType(patch.type)) throw new Error('Unknown kind of field.');
  if (patch.from) {
    const from = world.get('layer', patch.from);
    if (!from || from.kind !== 'point' || from.space_id !== layer.space_id) throw new Error('A heatmap is worked out from a layer of points on the same map.');
  }
  let o: Record<string, unknown> = {};
  try { o = JSON.parse(layer.style || '{}') ?? {}; } catch { o = {}; }
  const next = { ...fieldLayerStyleOf(layer.style), ...patch };
  next.opacity = Math.max(0, Math.min(1, Number.isFinite(next.opacity) ? next.opacity : 1));
  return run(world, `Change "${layer.name}"`, (tx) => tx.patch('layer', layerId, { style: JSON.stringify({ ...o, field: next }) }));
}

/**
 * A source of a field at a place (a strike, a fire, a release), starting at the moment the edit mode
 * gives (in an event, or not); its strength, size, shape and life are the field's usual ones unless given.
 */
export function addFieldSource(world: World, o: { layerId: string; name: string; at: [number, number]; mode: EditMode; source?: Partial<FieldSource> }): CommandResult<string> {
  const layer = world.get('layer', o.layerId);
  if (!layer || layer.kind !== 'field') throw new Error('Choose a field layer first.');
  const [lon, lat] = o.at;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) throw new Error('That place is not on the map.');
  const type = fieldLayerStyleOf(layer.style).type;
  const source = fieldSourceOf({ ...DEFAULT_SOURCES[type], ...o.source }, type);
  const name = o.name.trim() || FIELD_TYPES[type].name;
  return run(world, `Add "${name}"`, (tx) => {
    const id = newId('feat');
    tx.insert('feature', { id, layer_id: layer.id, name, entity_id: '', style: JSON.stringify({ source }), notes: '', created_seq: world.nextSeq('feature') });
    writeShape(tx, id, o.mode, { parts: [[((lon + 540) % 360) - 180, lat]], anim: null });
    return id;
  });
}

/**
 * Many sources of a field at once (in one step): imported strikes, a scenario's sites. Each starts at
 * the moment the edit mode gives, with the field's usual settings unless given.
 */
export function addFieldSources(world: World, o: { layerId: string; sources: Array<{ name: string; at: [number, number]; source?: Partial<FieldSource> }>; mode: EditMode }): CommandResult<string[]> {
  const layer = world.get('layer', o.layerId);
  if (!layer || layer.kind !== 'field') throw new Error('Choose a field layer first.');
  const type = fieldLayerStyleOf(layer.style).type;
  for (const s of o.sources) if (!Number.isFinite(s.at[0]) || !Number.isFinite(s.at[1]) || Math.abs(s.at[1]) > 90) throw new Error('A place is not on the map.');
  return run(world, `Add ${o.sources.length} sources to "${layer.name}"`, (tx) => o.sources.map((s) => {
    const id = newId('feat');
    const source = fieldSourceOf({ ...DEFAULT_SOURCES[type], ...s.source }, type);
    tx.insert('feature', { id, layer_id: layer.id, name: s.name.trim() || FIELD_TYPES[type].name, entity_id: '', style: JSON.stringify({ source }), notes: '', created_seq: tx.world.nextSeq('feature') });
    writeShape(tx, id, o.mode, { parts: [[((s.at[0] + 540) % 360) - 180, s.at[1]]], anim: null });
    return id;
  }));
}

/**
 * A disaster from a template (D104): its conditions, each on the map's first field layer of its kind
 * (made if there is none), and an impact's crater in the terrain (from moment `t` on), all in a new
 * event named after it starting at `t`, or in the event being recorded (`eventId`); one undoable step.
 * Returns the event.
 */
export function addDisaster(world: World, o: { spaceId: string; disaster: DisasterId; size: number; windDeg?: number; at: [number, number]; t: Instant; eventId?: string | null; seed?: number }): CommandResult<string> {
  const space = world.get('map_space', o.spaceId);
  if (!space || space.kind !== 'sphere') throw new Error('Disasters are placed on round maps.');
  if (!isDisasterId(o.disaster)) throw new Error('Unknown kind of disaster.');
  const [lon0, lat] = o.at;
  if (!Number.isFinite(lon0) || !Number.isFinite(lat) || Math.abs(lat) > 90) throw new Error('That place is not on the map.');
  const lon = ((lon0 + 540) % 360) - 180;
  const ev = o.eventId ? world.get('event', o.eventId) : null;
  if (o.eventId && !ev) throw new Error('That event no longer exists.');
  const plan = planDisaster(o.disaster, o.size, o.windDeg ?? 90);
  return run(world, plan.name, (tx) => {
    const eventId = ev ? ev.id : insertEventIn(tx, { name: plan.name, start: o.t, end: null });
    const at = ev && compare(o.t, fromStore(ev.start_day, ev.start_ms)) > 0 ? o.t : null;
    for (const p of plan.sources) {
      let layer = tx.world.all('layer').filter((l) => l.space_id === space.id && l.kind === 'field' && fieldLayerStyleOf(l.style).type === p.type).sort((a, b) => a.sort_order - b.sort_order)[0];
      if (!layer) {
        const name = FIELD_TYPES[p.type].name;
        layer = tx.insert('layer', { id: newId('layer'), space_id: space.id, kind: 'field', name, sort_order: tx.world.all('layer').filter((l) => l.space_id === space.id).length, visible: 1, style: JSON.stringify({ field: { type: p.type, opacity: 1 } }), export_pass: name.toLowerCase().replace(/\W+/g, '-') });
      }
      const source = fieldSourceOf({ ...DEFAULT_SOURCES[p.type], ...p.source, seed: o.seed ?? 1 }, p.type);
      const id = newId('feat');
      tx.insert('feature', { id, layer_id: layer.id, name: `${plan.name.replace(/ \(.*\)$/, '')}: ${p.name.toLowerCase()}`, entity_id: '', style: JSON.stringify({ source }), notes: '', created_seq: tx.world.nextSeq('feature') });
      writeShape(tx, id, { kind: 'new', eventId, at }, { parts: [[lon, lat]], anim: null });
    }
    // The crater stays for good: a change to the terrain from the moment of the impact.
    if (plan.crater && terrainSourceOf(space)) {
      const settings = worldSettings(tx.world.get('map_space', space.id)!);
      const stamp = { id: newId('stamp'), tool: 'crater' as const, path: [[Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]] as Array<[number, number]>, radiusKm: plan.crater.radiusKm, strength: plan.crater.depthM, seed: o.seed ?? 1, from: { day: o.t.day, ms: o.t.ms } };
      tx.update('map_space', { ...tx.world.get('map_space', space.id)!, settings: JSON.stringify({ ...settings, sculpt: [...cleanStamps(settings.sculpt), ...cleanStamps([stamp])] }) });
    }
    return eventId;
  });
}

/** A source's strength, size, shape or life (not dated: they are told from when it starts). */
export function updateFieldSource(world: World, id: string, patch: Partial<FieldSource>): CommandResult {
  const f = world.get('feature', id), layer = f ? world.get('layer', f.layer_id) : undefined;
  if (!f || !layer || layer.kind !== 'field') throw new Error('That source no longer exists.');
  const type = fieldLayerStyleOf(layer.style).type;
  let own: Record<string, unknown> = {};
  try { own = JSON.parse(f.style || '{}') ?? {}; } catch { own = {}; }
  const source = fieldSourceOf({ ...fieldSourceOf(own.source, type), ...patch }, type);
  return run(world, `Change "${f.name}"`, (tx) => tx.patch('feature', id, { style: JSON.stringify({ ...own, source }) }));
}

/** Delete features and all their shapes over time (one undo step). */
export function deleteFeatures(world: World, ids: string[]): CommandResult {
  const set = new Set(ids.filter((id) => world.get('feature', id)));
  if (!set.size) throw new Error('Those no longer exist.');
  const first = world.get('feature', [...set][0])!.name;
  return run(world, set.size === 1 ? `Delete "${first}"` : `Delete ${set.size} areas, lines and points`, (tx) => {
    for (const ef of tx.world.all('effect')) if (ef.kind === 'shape' && set.has(parseJSON<ShapeIntent | null>(ef.intent, null)?.feature ?? '')) tx.remove('effect', ef.id);
    for (const id of set) tx.remove('feature', id);
  });
}

/** A shape made without an event holds from the beginning instead of from its date. */
export function shapeFromBeginning(world: World, effectId: string): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef || ef.kind !== 'shape') throw new Error('That shape no longer exists.');
  if (!isBaseEvent(ef.event_id)) throw new Error('This shape belongs to an event; change the event instead.');
  return run(world, 'From the beginning', (tx) => tx.patch('effect', effectId, { at_day: null, at_ms: null }));
}

/** 'correct': redraw the shape in force at the date; otherwise write a new step as the mode says. */
function correctOrWrite(tx: Tx, engine: Engine, f: FeatureRow, mode: EditMode, what: { parts?: number[][]; off?: boolean; anim?: FeatureAnimStyle | null }): string {
  if (mode.kind === 'correct') {
    const steps = engine.featureHistory(f.id);
    let k = -1;
    for (let i = 0; i < steps.length; i++) if (compare(steps[i].t, mode.t) <= 0) k = i;
    const st = k >= 0 ? steps[k] : null;
    if (st && st.parts) {
      const ef = tx.world.get('effect', st.effectId)!;
      tx.patch('effect', ef.id, { intent: JSON.stringify({ op: 'shape', feature: f.id, ...(what.off ? { off: true } : { parts: what.parts }) } satisfies ShapeIntent) });
      return ef.id;
    }
    // Not there at that date (not yet, or no longer): it is given this shape from that date.
    if (st && !st.parts) return writeShape(tx, f.id, { kind: 'change', t: mode.t }, what);
    return writeShape(tx, f.id, { kind: 'correct', t: NEG_INF }, what);
  }
  return writeShape(tx, f.id, mode, what);
}

function writeShape(tx: Tx, feature: string, mode: EditMode, what: { parts?: number[][]; off?: boolean; anim?: FeatureAnimStyle | null }): string {
  const world = tx.world;
  if (mode.kind === 'new' && !world.get('event', mode.eventId)) throw new Error('That event no longer exists.');
  const eventId = eventForMode(tx, mode);
  const t: Instant | null = mode.kind === 'new' ? mode.at ?? null : mode.t;
  const at = t && t.day !== -Infinity ? toStore(t) : null;
  recordable(world, eventId, at);
  const intent: ShapeIntent = what.off ? { op: 'shape', feature, off: true } : { op: 'shape', feature, parts: what.parts };
  // The same feature, event and moment: that shape is replaced.
  const same = world.all('effect').find((f) => f.kind === 'shape' && f.event_id === eventId && f.at_day === (at ? at[0] : null) && f.at_ms === (at ? at[1] : null)
    && parseJSON<ShapeIntent | null>(f.intent, null)?.feature === feature);
  const transition = what.anim && mode.kind === 'new' && !what.off ? JSON.stringify({ style: what.anim }) : '';
  if (same) { tx.patch('effect', same.id, { intent: JSON.stringify(intent), ...(what.anim !== undefined ? { transition } : {}) }); return same.id; }
  const layer = world.get('layer', world.get('feature', feature)?.layer_id ?? '');
  const id = newId('eff');
  tx.insert('effect', {
    id, event_id: eventId, ordinal: nextOrdinal(world, eventId), kind: 'shape', space_id: layer?.space_id ?? null, layer_id: layer?.id ?? null,
    at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition, intent: JSON.stringify(intent), resolution: JSON.stringify({ set: [] }), basis_hash: '',
  });
  return id;
}

/** How a shape change appears over the rest of its event (D79): drawn, grown, faded in; null: at once. */
export function setShapeAnimation(world: World, effectId: string, style: FeatureAnimStyle | null): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef || ef.kind !== 'shape') throw new Error('That change of shape no longer exists.');
  if (style && !isFeatureAnim(style)) throw new Error('Unknown way of appearing.');
  return run(world, style ? 'Animate a shape' : 'Shape at once', (tx) => tx.patch('effect', effectId, { transition: style ? JSON.stringify({ style }) : '' }));
}

// ---------------------------------------------------------------- relationships between entities

/** The relationship of a kind between two entities, if there is one (either way round for mutual kinds). */
export function findRelation(world: World, kind: string, a: string, b: string): RelationRow | undefined {
  const mutual = relationKind(kind)?.mutual;
  return world.all('relation').find((r) => r.kind === kind && ((r.a === a && r.b === b) || (mutual && r.a === b && r.b === a)));
}

/**
 * A relationship begins (A is at war with B, A is part of B…) as the edit mode says: in an event,
 * from the date viewed, or always ('correct' at the beginning of time). `until`: it ends then
 * (in the same event, or without one). The same kind between the same two again (a second war)
 * adds a period to the relationship there is.
 */
export function relate(world: World, o: { kind: RelationKind; a: string; b: string; mode: EditMode; until?: Instant | null; notes?: string }): CommandResult<string> {
  if (!isRelationKind(o.kind)) throw new Error('Choose what kind of relationship it is.');
  const ea = world.get('entity', o.a), eb = world.get('entity', o.b);
  if (!ea || !eb) throw new Error('Choose who it is between.');
  if (o.a === o.b) throw new Error('A relationship needs two different parties.');
  const k = relationKind(o.kind)!;
  const start: Instant | null = o.mode.kind === 'new' ? (o.mode.at ?? eventStartOf(world, o.mode.eventId)) : o.mode.t;
  if (o.until && start && compare(o.until, start) <= 0) throw new Error('It must end after it begins.');
  return run(world, `${ea.name} ${k.sentence} ${eb.name}`, (tx) => {
    let r = findRelation(world, o.kind, o.a, o.b);
    if (!r) {
      r = { id: newId('rel'), kind: o.kind, a: o.a, b: o.b, notes: o.notes ?? '', created_seq: world.nextSeq('relation') };
      tx.insert('relation', r);
    }
    writeRelate(tx, r.id, o.mode, true);
    if (o.until) writeRelate(tx, r.id, o.mode.kind === 'new' ? { kind: 'new', eventId: o.mode.eventId, at: o.until } : { kind: 'change', t: o.until }, false);
    return r.id;
  });
}

/** A relationship ends (peace is made, a province breaks away) as the edit mode says. */
export function endRelation(world: World, o: { relation: string; mode: EditMode }): CommandResult<string> {
  const r = world.get('relation', o.relation);
  if (!r) throw new Error('That relationship no longer exists.');
  if (o.mode.kind === 'correct' && o.mode.t.day === -Infinity) throw new Error('To remove it altogether, delete it.');
  return run(world, `End of "${describeRelation(world, r)}"`, (tx) => writeRelate(tx, r.id, o.mode.kind === 'correct' ? { kind: 'change', t: o.mode.t } : o.mode, false));
}

/** A relationship holds again from a date (a second war between the same two). */
export function resumeRelation(world: World, o: { relation: string; mode: EditMode }): CommandResult<string> {
  const r = world.get('relation', o.relation);
  if (!r) throw new Error('That relationship no longer exists.');
  return run(world, `"${describeRelation(world, r)}" again`, (tx) => writeRelate(tx, r.id, o.mode, true));
}

export function updateRelation(world: World, id: string, patch: { notes?: string }): CommandResult {
  if (!world.get('relation', id)) throw new Error('That relationship no longer exists.');
  return run(world, 'Change relationship', (tx) => tx.patch('relation', id, { ...(patch.notes !== undefined ? { notes: patch.notes } : {}) }));
}

/** Delete relationships and every change that began or ended them (one undo step). */
export function deleteRelations(world: World, ids: string[]): CommandResult {
  const set = new Set(ids.filter((id) => world.get('relation', id)));
  if (!set.size) throw new Error('Those no longer exist.');
  return run(world, set.size === 1 ? `Delete "${describeRelation(world, world.get('relation', [...set][0])!)}"` : `Delete ${set.size} relationships`, (tx) => removeRelations(tx, set));
}

/** "Kingdom of Testa is at war with Duchy of Proba". */
export function describeRelation(world: World, r: Pick<RelationRow, 'kind' | 'a' | 'b'>): string {
  const name = (id: string) => world.get('entity', id)?.name ?? '(deleted)';
  return `${name(r.a)} ${relationKind(r.kind)?.sentence ?? r.kind} ${name(r.b)}`;
}

function removeRelations(tx: Tx, ids: Set<string>): void {
  if (!ids.size) return;
  for (const ef of tx.world.all('effect')) if (ef.kind === 'relate' && ids.has(parseJSON<RelateIntent | null>(ef.intent, null)?.relation ?? '')) tx.remove('effect', ef.id);
  for (const id of ids) tx.remove('relation', id);
}

function eventStartOf(world: World, eventId: string): Instant | null {
  const ev = world.get('event', eventId);
  return ev ? fromStore(ev.start_day, ev.start_ms) : null;
}

function writeRelate(tx: Tx, relation: string, mode: EditMode, on: boolean): string {
  const world = tx.world;
  if (mode.kind === 'new' && !world.get('event', mode.eventId)) throw new Error('That event no longer exists.');
  const eventId = eventForMode(tx, mode);
  const t: Instant | null = mode.kind === 'new' ? mode.at ?? null : mode.t;
  const at = t && t.day !== -Infinity ? toStore(t) : null;
  recordable(world, eventId, at);
  const intent = JSON.stringify({ op: 'relate', relation, on } satisfies RelateIntent);
  // The same relationship, event and moment: that step is replaced.
  const same = world.all('effect').find((f) => f.kind === 'relate' && f.event_id === eventId && f.at_day === (at ? at[0] : null) && f.at_ms === (at ? at[1] : null)
    && parseJSON<RelateIntent | null>(f.intent, null)?.relation === relation);
  if (same) { tx.patch('effect', same.id, { intent }); return same.id; }
  const id = newId('eff');
  tx.insert('effect', {
    id, event_id: eventId, ordinal: nextOrdinal(world, eventId), kind: 'relate', space_id: null, layer_id: null,
    at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition: '', intent, resolution: JSON.stringify({ set: [] }), basis_hash: '',
  });
  return id;
}

function writePlacement(tx: Tx, spaceId: string, entity: string, mode: EditMode, what: { lon?: number; lat?: number; off?: boolean; arrive?: 'travel' | 'jump' }): string {
  const world = tx.world;
  if (mode.kind === 'new' && !world.get('event', mode.eventId)) throw new Error('That event no longer exists.');
  const eventId = eventForMode(tx, mode);
  const t: Instant | null = mode.kind === 'new' ? mode.at ?? null : mode.t;
  const at = t && t.day !== -Infinity ? toStore(t) : null;
  recordable(world, eventId, at);
  // The same character, map, event and moment: move that placement.
  const same = world.all('effect').find((f) => {
    if (f.kind !== 'place' || f.space_id !== spaceId || f.event_id !== eventId || f.at_day !== (at ? at[0] : null) || f.at_ms !== (at ? at[1] : null)) return false;
    return parseJSON<PlaceIntent | null>(f.intent, null)?.entity === entity;
  });
  const prev = same ? parseJSON<PlaceIntent | null>(same.intent, null) : null;
  const intent: PlaceIntent = what.off
    ? { op: 'place', entity, off: true }
    : { op: 'place', entity, lon: what.lon, lat: what.lat, arrive: what.arrive ?? prev?.arrive ?? 'travel' };
  if (same) { tx.patch('effect', same.id, { intent: JSON.stringify(intent) }); return same.id; }
  const id = newId('eff');
  tx.insert('effect', {
    id, event_id: eventId, ordinal: nextOrdinal(world, eventId), kind: 'place', space_id: spaceId, layer_id: null,
    // No parcels: an empty resolution, in the same shape as every other change's.
    at_day: at ? at[0] : null, at_ms: at ? at[1] : null, transition: '', intent: JSON.stringify(intent), resolution: JSON.stringify({ set: [] }), basis_hash: '',
  });
  return id;
}

export function deleteEffect(world: World, effectId: string): CommandResult {
  return run(world, 'Remove change', (tx) => tx.remove('effect', effectId));
}

/** Another starting point for an expansion (D91): it spreads from all of them at once (pincers, encirclement). */
export function addTransitionOrigin(world: World, effectId: string, at: [number, number]): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef) throw new Error('That change no longer exists.');
  const spec = parseJSON<TransitionSpec | null>(ef.transition, null);
  if (!spec || spec.style !== 'advance' || !spec.origin) throw new Error('Only an expansion starts from points: choose "Expansion" for it first.');
  if (!Number.isFinite(at[0]) || !Number.isFinite(at[1]) || Math.abs(at[1]) > 90) throw new Error('Click on the map.');
  if ((spec.origins?.length ?? 0) >= 15) throw new Error('An expansion starts from at most 16 points.');
  const next: TransitionSpec = { ...spec, origins: [...(spec.origins ?? []), [at[0], at[1]]] };
  return run(world, 'Add a starting point', (tx) => tx.patch('effect', effectId, { transition: JSON.stringify(next) }));
}

/** An expansion back to its first starting point only (D91). */
export function clearTransitionOrigins(world: World, effectId: string): CommandResult {
  const ef = world.get('effect', effectId);
  if (!ef) throw new Error('That change no longer exists.');
  const spec = parseJSON<TransitionSpec | null>(ef.transition, null);
  if (!spec?.origins) return run(world, 'Only the first starting point', () => undefined);
  const { origins: _o, ...rest } = spec;
  return run(world, 'Only the first starting point', (tx) => tx.patch('effect', effectId, { transition: JSON.stringify(rest) }));
}

export function setEffectTransition(world: World, effectId: string, spec: TransitionSpec | null): CommandResult {
  return run(world, 'Change transition', (tx) => tx.patch('effect', effectId, { transition: spec ? JSON.stringify(spec) : '' }));
}

// ---------------------------------------------------------------- border geometry ("correct for all time")

export function moveVertex(world: World, o: { spaceId: string; vertexId: number; to: Vec3; snap: number; guard?: LockGuard }): CommandResult {
  if (o.guard) refuseLockedAround(world, o.spaceId, o.vertexId, o.guard);
  return run(world, 'Move border point (all time)', (tx) => tx.kernel(o.spaceId, (arr) => arr.moveVertex(o.vertexId, o.to, o.snap)));
}

/** For border points moved or taken away for all time: whose land around the point is read, on which layer and date (D87). */
export interface LockGuard { engine: Engine; layerId: string; t: Instant }

/** Refuse to reshape a border for all time where a locked country holds land around the point (on the date viewed). */
function refuseLockedAround(world: World, spaceId: string, vertexId: number, g: LockGuard): void {
  if (!world.all('entity').some((e) => e.style.includes('"locked"') && isLocked(world, e.id))) return;
  const arr = world.arrangement(spaceId);
  const ownerOf = ownerReader(arr, g.engine.partitionState(spaceId, g.layerId, g.t));
  const around = new Set<string | null>();
  for (const sg of arr.segments.values()) if (sg.a === vertexId || sg.b === vertexId) { around.add(ownerOf(sg.left_face)); around.add(ownerOf(sg.right_face)); }
  refuseLocked(world, around);
}

/**
 * Move a border point from a date on (Stage 3, D77): the border between two countries runs through
 * the new place from then on, and the land between the old and the new line changes hands (it goes to
 * the country the point moved away from). For all time, a border point is moved with moveVertex
 * instead. Only a point on a border between exactly two owners on that date can be moved so.
 */
export function moveBorderFrom(world: World, engine: Engine, o: { spaceId: string; layerId: string; vertexId: number; to: Vec3; t: Instant; mode: EditMode; snap: number }): CommandResult<{ gainer: string | null }> {
  checkTarget(world, { spaceId: o.spaceId, layerId: o.layerId, mode: o.mode });
  const arr = world.arrangement(o.spaceId);
  if (!arr.vertices.has(o.vertexId)) throw new Error('That border point no longer exists.');
  const states = engine.partitionState(o.spaceId, o.layerId, o.t);
  const ownerOf = ownerReader(arr, states);
  // The borders through the point on that date (segments with different owners on their two sides).
  const borders: Array<{ other: number; sides: [string | null, string | null] }> = [];
  for (const sg of arr.segments.values()) {
    if (sg.a !== o.vertexId && sg.b !== o.vertexId) continue;
    const l = ownerOf(sg.left_face), r = ownerOf(sg.right_face);
    if ((l ?? '') !== (r ?? '')) borders.push({ other: sg.a === o.vertexId ? sg.b : sg.a, sides: [l, r] });
  }
  if (borders.length === 0) throw new Error('This point is not on a border on this date.');
  if (borders.length !== 2) throw new Error(`This point joins ${borders.length} borders: only a point on a border between two countries can be moved from a date. Use the Territory brush here.`);
  const pair = new Set(borders.flatMap((b) => b.sides.map((x) => x ?? '')));
  if (pair.size !== 2) throw new Error('This point joins borders of more than two countries: use the Territory brush here.');
  const [x, y] = [...pair].map((v) => v || null);
  refuseLocked(world, [x, y]);
  const v = arr.v(o.vertexId);
  // The land between the old line (P, V, N) and the new one (P, V', N); its owner now loses it.
  const pts = [arr.v(borders[0].other), o.to, arr.v(borders[1].other), v].map((q) => vecToLonLat(q));
  const ring = ringFromMapPoints(pts, 0.25);
  if (!ring) throw new Error('Move the point a little further.');
  const mid = normalize([v[0] + o.to[0], v[1] + o.to[1], v[2] + o.to[2]]);
  // (The new place and the land on the way must belong to the two countries of the border.)
  const before = engine.valueAtPoint(o.spaceId, o.layerId, mid, o.t);
  const dest = engine.valueAtPoint(o.spaceId, o.layerId, o.to, o.t);
  const ours = (v: string | null) => (v ?? '') === (x ?? '') || (v ?? '') === (y ?? '');
  if (!ours(before) || !ours(dest)) throw new Error('The point was moved across another country (or out to sea): move it less far, or use the Territory brush.');
  const gainer = (before ?? '') === (x ?? '') ? y : x;
  const r = paintTerritory(world, engine, { spaceId: o.spaceId, layerId: o.layerId, ring, value: gainer, snap: o.snap, mode: o.mode });
  return { label: `Move a border point from ${o.t.day === -Infinity ? 'the beginning' : 'a date'}`, diffs: r.diffs, result: { gainer } };
}

export function insertBorderVertex(world: World, o: { spaceId: string; segmentId: number; at: Vec3 }): CommandResult<number> {
  return run(world, 'Add border point', (tx) => tx.kernel(o.spaceId, (arr) => arr.insertVertexOnSegment(o.segmentId, o.at)));
}

export function removeBorderVertex(world: World, o: { spaceId: string; vertexId: number; guard?: LockGuard }): CommandResult {
  if (o.guard) refuseLockedAround(world, o.spaceId, o.vertexId, o.guard);
  return run(world, 'Remove border point', (tx) => tx.kernel(o.spaceId, (arr) => arr.removeVertex(o.vertexId)));
}

/** Draw a dividing line (e.g. a new border inside a country) without changing anyone's territory yet. */
export function drawLine(world: World, o: { spaceId: string; points: Vec3[]; snap: number }): CommandResult {
  return run(world, 'Draw border line', (tx) => tx.kernel(o.spaceId, (arr) => arr.insertPath(o.points, { closed: false, snap: o.snap })));
}

// ---------------------------------------------------------------- presentation (kept apart from world data)

export function createSequence(world: World, name: string, settings: unknown): CommandResult<string> {
  return run(world, `Create shot "${name}"`, (tx) => {
    const id = newId('seq');
    tx.insert('sequence', { id, name, created_seq: world.nextSeq('sequence'), settings: JSON.stringify(settings) });
    return id;
  });
}

export function updateSequence(world: World, id: string, patch: { name?: string; settings?: unknown }): CommandResult {
  return run(world, 'Edit shot', (tx) => tx.patch('sequence', id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.settings !== undefined ? { settings: JSON.stringify(patch.settings) } : {}),
  }));
}

export function deleteSequence(world: World, id: string): CommandResult {
  return run(world, 'Delete shot', (tx) => tx.remove('sequence', id));
}
