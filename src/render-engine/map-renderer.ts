// The map renderer: draws a map space at a moment in time from the world model and the temporal
// engine. Nothing here is stored history: every pixel is computed from parcels, effects and styles.
//
// This is the Canvas 2D backend. Parcels, borders and the Earth basemap are drawn from geometry
// prepared on a "sheet" of the projection's plane (plane.ts): while the view stays on the sheet,
// panning and zooming cost no geometry work, only drawing; an edit prepares only the parcels it
// changed; and what stays the same through a stretch of time (who holds what, which borders show)
// is worked out once for the stretch (LayerSnap), not once per frame.
import { layerBordersOf, bordersMove, plainBorder, dashPattern, type BorderStyle, type LayerBorders } from './border-look.ts';
import { countryLookOf, layerLookOf, lookFor, lookAt, litBy, slabHeight, looksPlain, shadowKey, shadowOffset, compositeOf, castOf, awayFromLight, sweepAt, rgbaOf, changesInHistory, movesOnScreen, INSIDE, type CountryLook, type Effect, type ShadowEffect, type StrokeEffect } from './country-look.ts';
import { patternTile, textureTile } from './textures.ts';
import { geoPath, geoCircle, geoCentroid, geoArea, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import type { World } from '../world-model/world.ts';
import type { Engine, FaceState, Assignment, CompiledTransition } from '../temporal-engine/engine.ts';
import { globeGL, globeInView } from './globe-gl.ts';
import { parseJSON, slerpLonLat } from '../temporal-engine/engine.ts';
import { type Instant, compare, diffMs } from '../core-time/index.ts';
import { isBaseEvent } from '../world-model/schema.ts';
import { lonLatToVec, type Vec3 } from '../geo-kernel/vec.ts';
import { buildFrontField, frontRings, frontLines, bandBounds, bandBoxes, type FrontField, type Rings } from './front-field.ts';
import { frontSourceOf } from './front-source.ts';
import { terrainSlowness } from './front-terrain.ts';
import { screenToLonLat, meridianOf, makeView, FLAT_EXTENT_DEG, type View, type Camera } from './camera.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import { BasemapPainter, chooseScale, landMaskOf, visibleBounds, boxIntersects, drawRiverLines, DEFAULT_BASEMAP_STYLE, LandMask, type Basemap, type BasemapStyle, type RiverSet } from './basemap.ts';
import { planeShape, placeLabel, lineChoices, textWidthEm, blockHeightEm, LINE_HEIGHT, type PlaneShape } from './label-place.ts';
import { resolveLabelStyle, resolvePointStyle, labelSize, labelFont, labelText, type LabelStyle, type CountryLabel } from './label-style.ts';
import { imageNow, videoNow, drawImageFit, assetEpoch, type MediaChannel } from './assets.ts';
import { clusterPieces, joinBoxes, fitScales, type GeoBox, type FillPieces } from './fill-clusters.ts';
import { Sheet, makeRing, addLine, projectPoint, isCylindrical, SHARP_UP_TO, type Ring } from './plane.ts';
import { BlockPath, setPaintRegion, type DeviceRect } from './blocks.ts';
import { Kept as Weighed } from './kept.ts';
import { parcelGeometry, type ParcelGeometry, type CycleGeom } from './parcel-geometry.ts';
import { featureStyle, featureColor, isFeatureKind, type FeatureKind, type FeatureStyle } from './feature-style.ts';
import { cityShown, placeMetaOf, DEFAULT_CITY_FILTER, type CityFilter } from '../domain/places.ts';
import { cityFilterOfSpace, colourByOfSpace, mapLightOf, statisticsOf } from '../world-model/world-settings.ts';
import { closenessColours } from '../domain/affinity.ts';
import { campaignArrow, smoothLine, lineLength, arrowBodyLength, marksAlong, cutLineBetween, mixColor } from './routes.ts';
import { shotProgress, eventScreenSeconds, eventTransitionLook, TRANSITION_LOOKS } from '../presentation/sequence.ts';
import { iconById, iconOfStyle, unitOfStyle, drawIcon, type CharacterIcon, type RouteStyle } from './icons.ts';
import { TerrainPictures, terrainDrawable, type TerrainFrame, type TerrainImageKind, type TerrainSea, type TerrainOverride } from './terrain-gl.ts';
import { heightAt, type ElevationGrid } from '../terrain/grid.ts';
import type { TerrainCover } from '../terrain/cover.ts';
import { detailHeightAt, type DetailGrid } from '../terrain/detail.ts';
import type { PhotoRegion } from '../terrain/photo.ts';
import { FieldPictures, edgePhases, type FieldInstance, type FieldRaster } from './fields-gl.ts';
import { spreadRaster, type SpreadRaster, type SpreadKind } from '../domain/spread.ts';
import { activeSources, fieldLayerStyleOf, sourceReach, sizeAt, DEFAULT_SOURCES, type FieldSource } from '../domain/fields.ts';
import { PALETTES, rampAt, DEFAULT_TERRAIN_LOOK, type TerrainLook } from '../terrain/look.ts';

type LabelEntity = { name: string; style?: string; color?: string; type_id?: string };

/** How a territory layer is filled (D88): solid, or see-through stripes, crossed stripes or dots in each owner's colour. */
export type TerritoryFill = 'solid' | 'hatch' | 'cross' | 'dots';

export type PassName = 'background' | 'terrain' | 'graticule' | 'land' | 'fills' | 'borders' | 'fields' | 'features' | 'cities' | 'labels' | 'characters';
/** Drawing order. The grid lies under the land, so stacked export passes match the full picture. */
export const ALL_PASSES: PassName[] = ['background', 'terrain', 'graticule', 'land', 'fills', 'borders', 'fields', 'features', 'cities', 'labels', 'characters'];

/**
 * The terrain a picture shows (D95): the grid, a name for its content, and how it is drawn (null: not
 * drawn, but the sea level of the moment still decides the coasts); the sea level of the moment (D96,
 * metres above today's).
 */
export interface TerrainShown {
  grid: ElevationGrid; key: string; look: TerrainLook | null; seaLevel?: number;
  /** Where sculpting changed Earth's terrain (D98): there the terrain's own coast, not Natural Earth's. */
  override?: TerrainOverride | null;
  /** A planet's rivers (D99; Earth's are the basemap's). */
  rivers?: RiverSet | null;
  /** The land's colours for a look with land cover (the satellite look, D100); its ramp until it is there. */
  cover?: TerrainCover | null;
  /** Close in on the Earth, finer heights over the region in view (D101); the grid's own elsewhere. */
  detail?: DetailGrid | null;
  /** Close in on the Earth in the satellite look (D138): the photographs of the region in view. */
  photo?: PhotoRegion | null;
}
const rgbOf = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
/** A CSS colour given as #rgb, #rrggbb or rgb()/rgba(), as 0-255 values (null for anything else). */
function parseCss(c: string): [number, number, number] | null {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (h) { const x = h[1].length === 3 ? h[1].split('').map((d) => d + d).join('') : h[1]; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number]; }
  const r = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c.trim());
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
}
/** Spreads worked out (D103), the last few hundred: each once for its source's settings, place and the heights. */
const spreads = new Map<string, SpreadRaster>();
function spreadFor(kind: SpreadKind, s: FieldSource, centre: [number, number], grid: ElevationGrid, gridKey: string, planetKm: number): SpreadRaster {
  const key = `${kind}|${gridKey}|${centre[0]},${centre[1]}|${planetKm}|${s.radiusKm}|${s.grow}|${s.windDeg}|${s.windKmPerDay}|${s.seed}`;
  let g = spreads.get(key);
  if (!g) {
    g = spreadRaster(kind, s, centre, grid, gridKey, planetKm);
    spreads.set(key, g);
    while (spreads.size > 300) spreads.delete(spreads.keys().next().value!);
  }
  return g;
}
/** A short name for the sources of a field picture: a hash of everything the shader is given (FNV-1a over the numbers). */
function hashInstances(inst: FieldInstance[]): string {
  const f = new Float32Array(inst.length * 16);
  inst.forEach((s, i) => f.set([...s.rect, s.lon, s.lat, s.radius, s.value, s.noise, s.plume ? 1 : 0, s.plume?.dir ?? 0, s.plume?.length ?? 0, ...s.phases, 0], i * 16));
  const u = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return `${inst.length}:${h.toString(36)}`;
}
/** The coarsest zoom of finer heights that draws the coast close in (D176): cells of about 150 m at the equator, finer than Natural Earth's coastline. */
export const CLOSE_COAST_ZOOM = 10;
/**
 * Whether the coast is the finer heights' close in (D176): on the Earth (Natural Earth's coastline given) at today's
 * sea level, unsculpted, where the heights in view are all from the tiles and fine enough. There the heights draw
 * the coast (a city's harbour, a strait a few hundred metres across), the coastline only saying where land lies below
 * the sea.
 */
export const closeCoastOf = (terrain: TerrainShown | null, basemap: unknown, seaLevel: number) => !!terrain && !!basemap && seaLevel === 0 && !terrain.override && !!terrain.detail?.whole && terrain.detail.z >= CLOSE_COAST_ZOOM;
/** Whether territories' pictures depend on the finer grid close in (D101): relief over them, or their coast of the moment. */
const reliefKeyNeedsDetail = (look: TerrainLook | null, fills: boolean, terrainLand: boolean) => (!!look?.overTerritories && fills) || terrainLand;
/** Rivers in a blue that suits the terrain's palette (D99). */
const riverColour = (look: TerrainLook | null) => (look?.palette === 'atlas' ? '#4f8cc4' : look?.palette === 'satellite' ? '#2f5d86' : '#4f86ad');

export interface MapStyle {
  ocean: string;
  graticule: string;
  border: string;
  borderWidth: number;
  frontGlow: string;
  labelColor: string;
  labelHalo: string;
  font: string;
}

export const DEFAULT_STYLE: MapStyle = {
  ocean: '#14324a', graticule: 'rgba(255,255,255,0.08)', border: '#101820', borderWidth: 1.3,
  frontGlow: '#ffe9a6', labelColor: '#f4efe6', labelHalo: 'rgba(10,16,24,0.85)',
  font: '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif',
};

/**
 * How closely prepared geometry follows the true shapes, and how far a sheet reaches beyond the
 * view. `tolerance` is the largest error simplification may cause, in pixels of the picture drawn.
 */
export interface RenderQuality { tolerance: number; margin: number }
/** The working view: errors of a third of a pixel at most, and room to pan before a new sheet is needed. */
/** How many times its own scale a sheet may be drawn at while the view is on the move (see MapRenderer.render). */
const MOVING_UP_TO = 2 * SHARP_UP_TO;

export const VIEW_QUALITY: RenderQuality = { tolerance: 0.35, margin: 0.6 };
/** Exports: a tenth of a pixel, whatever the working view is set to. */
export const EXPORT_QUALITY: RenderQuality = { tolerance: 0.1, margin: 0.3 };

export interface RenderOptions {
  passes: Set<PassName>;
  transparent: boolean;
  layerIds: string[]; // partition layers to draw, bottom to top
  style?: MapStyle;
  /** The colours of the land, lakes and coast (a shot's look, D108); absent: the usual ones. */
  basemapStyle?: BasemapStyle;
  /** Earth's geography under the territories (the 'land' pass); null or absent draws none. */
  basemap?: Basemap | null;
  /** Present-day country borders over the land, as a drawing aid (never part of an export). */
  referenceBorders?: boolean;
  /** The heights fronts mind where their look says so (D142); the terrain's when absent. */
  frontGround?: { grid: ElevationGrid; key: string; seaLevel?: number } | null;
  /** What of the geography is shown (D84): lakes (and from what size), rivers (D99), the coastline. All shown when absent. */
  show?: { lakes?: boolean; minLakeKm2?: number; coastline?: boolean; rivers?: boolean };
  /**
   * The terrain the full picture shows (D95), or none. Its colours are drawn in the 'terrain' pass (the
   * land's own flat colour is then left out of the 'land' pass); relief without colours is laid over
   * the land in the 'land' pass, and relief over the territories over the fills in the 'fills' pass.
   */
  terrain?: TerrainShown | null;
  /** A shot's way of animating border changes; absent: as recorded (world-building view). */
  transitions?: ShotTransitionOptions;
  /** Screen seconds into the shot, for video fills (0 or absent: the first frame). */
  mediaSeconds?: number;
  /** 'export' for exports (videos sought beforehand by prepareVideos); 'live' otherwise. */
  mediaChannel?: MediaChannel;
  /** Draw each character's route so far (shots with trails on). */
  trails?: boolean;
  /** Trails from this moment on (D176: a shot's first moment; absent, the whole route so far). */
  trailsSince?: Instant | null;
  /**
   * Boxes of the frame (view pixels: west, north, east, south) that a shot's texts cover, its date, title,
   * statistics, captions and events box: names on the map keep clear of them (D178).
   */
  keepOut?: Array<[number, number, number, number]>;
  /**
   * What the full picture shows, when only some passes are drawn (exports): texts are placed as in
   * the full picture. Default: as the passes drawn.
   */
  layout?: { labels: boolean; cities: boolean };
  /**
   * The view is on the move (the working view, see MapRenderer.carry): parts already drawn may be
   * shown moved or scaled to the new view instead of being drawn again.
   * `lastApproximate` then tells whether a fresh drawing would differ.
   */
  moving?: boolean;
  /**
   * The view is on the move: a country name placed in the part of the country in view stays where it
   * was on the map for as long as that is in view (instead of being placed again for every movement).
   */
  holdNames?: boolean;
  /**
   * The view has come to rest after moving (the working view): also draw the room around the kept
   * pictures (see MapRenderer.slide), so that the next move, or zooming out a little, starts with
   * nothing to draw. `roomToFill` says after a frame whether there is any left to draw.
   */
  fillAround?: boolean;
  /**
   * The moment shown is changing quickly (the timeline is being dragged in the working view): the
   * names of countries whose land changed are placed less finely, and `lastApproximate` says that a
   * calmer frame would differ. Placing them finely for every moment passed through was a fifth of
   * such a frame on a large map, for places nobody sees for longer than that frame.
   */
  hurried?: boolean;
  /**
   * (The globe, D127) Texts are placed but not drawn: the globe draws the names upright over the
   * sphere from where they were placed on its flat picture.
   */
  textsApart?: boolean;
}

/** Where the map's plane lies on the canvas: the transform's linear part, the plane's origin in device pixels and its scale. */
interface Placing { a: number; b: number; c: number; d: number; x: number; y: number; s: number }
/** What a kept part of the picture shows: exactly (the same pixels) and loosely (the same things, at whatever detail). */
interface PartKey { strict: string; loose: string }
interface Kept {
  canvas: OffscreenCanvas | null; ctx: CanvasRenderingContext2D | null; key: string; seen: string; strict: string; loose: string; at: Placing | null;
  /** The moment the parts that change from frame to frame were drawn for (see Renew). */
  moment: string;
  /** Where the frame's top left pixel lies in the buffer (a carried picture has room around the frame, see MapRenderer.slide). */
  ox: number; oy: number;
  /** The part of the buffer that holds the picture, as x0, y0, x1, y1 in buffer pixels (it always takes in the frame). */
  valid: [number, number, number, number];
  /** Changes whenever what the frame's window shows of the buffer may have changed. */
  stamp: number;
}
type KeptOn = Kept & { canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D };
/** What says a kept picture shows exactly this: what it shows, the size of the frame and where the map lies on it. */
const exactKey = (strict: string, w: number, h: number, at: Placing) => `${strict}|${w}x${h}|${at.a},${at.b},${at.c},${at.d},${at.x},${at.y},${at.s}`;
const newKept = (): Kept => ({ canvas: null, ctx: null, key: '', seen: '', strict: '', loose: '', at: null, moment: '', ox: 0, oy: 0, valid: [0, 0, 0, 0], stamp: 0 });
/** Rectangles of a kept picture that change from frame to frame (where a change is animating), and what says which frame this is. */
interface Renew { rects: DeviceRect[]; moment: string }

/** A picture or video fill (see domain/commands.ts CountryFill). */
/** How far land along the coast that no territory covers takes the look of the territory beside it (D83). */
const COAST_RIM_KM = 5;
const EARTH_RADIUS_KM = 6371;
/** That distance in view pixels (at least one, at most 48). */
const coastRim = (view: View) => Math.min(48, Math.max(1, (COAST_RIM_KM / EARTH_RADIUS_KM) * view.projection.scale()));

interface CountryFillLike { kind: 'color' | 'image' | 'video'; asset?: string; off?: boolean; fit?: 'cover' | 'contain' | 'stretch' | 'tile' | 'fill'; tileSize?: number; play?: 'loop' | 'once'; speed?: number; start?: number; pieces?: FillPieces; gapKm?: number }

/** x, y, width, height on screen. */
type Box2 = [number, number, number, number];

export type TransitionEase = 'linear' | 'smooth' | 'in' | 'out';

/** Shot transition settings as the renderer needs them (see presentation/sequence.ts ShotTransitions). */
export interface ShotTransitionOptions {
  mode: 'recorded' | 'all' | 'instant';
  style: 'border' | 'advance' | 'fade' | 'wipe' | 'dissolve';
  angle: number;
  timing: 'seconds' | 'event';
  seconds: number;
  easing: TransitionEase;
  restyleRecorded: boolean;
  /** The line along moving fronts; its colour 'auto': the new owner's, lightened (D137). */
  front: { show: boolean; color: string; width: number; glow: number };
  /** How fronts look (D137), each 0 to 1: ragged; the new colour running softly ahead; a glow over the land just taken. */
  roughness?: number; soft?: number; wake?: number;
  /** How much fronts mind the land (D142), 0 to 1: slowed by mountains and by water to cross. */
  terrain?: number;
  /** Screen seconds since the frame that showed instant t (Infinity if before the shot). */
  secondsSince: (t: Instant) => number;
}

/** The events with a transition look of their own (D137), by id: the look's id. Worked out once per state of the events. */
const ownLooksOf = new WeakMap<World, { revision: number; map: Map<string, string>; land: boolean }>();
function ownLooks(world: World): { map: Map<string, string>; land: boolean } {
  const revision = world.tableRevision('event');
  let kept = ownLooksOf.get(world);
  if (!kept || kept.revision !== revision) {
    const map = new Map<string, string>();
    let land = false;
    for (const e of world.all('event')) {
      if (!e.presentation?.includes('"look"')) continue;
      const l = eventTransitionLook(e.presentation);
      if (!l) continue;
      map.set(e.id, l);
      land ||= (TRANSITION_LOOKS.find((x) => x.id === l)?.set.terrain ?? 0) > 0;
    }
    ownLooksOf.set(world, (kept = { revision, map, land }));
  }
  return kept;
}
const eventLooksOf = (world: World): Map<string, string> => ownLooks(world).map;

/**
 * Whether a front of this map may mind the land (D142): the look of the shot shown does (`tr`; none in the
 * working view), or an event's own look. The map's heights are then wanted, shown or not.
 */
export function frontsMindLand(world: World, tr?: { mode?: string; terrain?: number } | null): boolean {
  if (tr?.mode === 'instant') return false;
  return (tr?.terrain ?? 0) > 0 || ownLooks(world).land;
}

/** The events with a time of their own on screen (D92), by id: seconds. Worked out once per state of the events. */
const ownSecondsOf = new WeakMap<World, { revision: number; map: Map<string, number> }>();
function eventSecondsOf(world: World): Map<string, number> {
  const revision = world.tableRevision('event');
  let kept = ownSecondsOf.get(world);
  if (!kept || kept.revision !== revision) {
    const map = new Map<string, number>();
    for (const e of world.all('event')) { if (!e.presentation?.includes('"screen"')) continue; const s = eventScreenSeconds(e.presentation); if (s) map.set(e.id, s); }
    ownSecondsOf.set(world, (kept = { revision, map }));
  }
  return kept.map;
}

function ease(kind: string | undefined, p: number): number {
  const x = Math.min(1, Math.max(0, p));
  if (kind === 'smooth') return x * x * (3 - 2 * x);
  if (kind === 'in') return x * x;
  if (kind === 'out') return 1 - (1 - x) * (1 - x);
  return x;
}

export interface LabelInfo {
  text: string;
  /** The text as drawn, broken into lines (long names may take two or three). */
  lines: string[];
  x: number; y: number; size: number; style: LabelStyle; entityId: string;
  /** Larger territories are placed first where labels would collide. */
  priority: number;
  /** Set when drawn: whether the label was drawn (not hidden by a larger one) and its box. */
  drawn?: boolean;
  box?: [number, number, number, number];
}

/** Labels keep this share of the frame's width and height clear of its edges. */
const LABEL_MARGIN = 0.04;
/** A label placed in the part of a country in view is at least this large (design pixels); smaller, the country goes without. */
const MIN_VIEW_LABEL = 6;

/** An owner's main piece of territory (for its label). */
interface OwnerPiece {
  owner: string; key: string; arcs: Float64Array; centreLon: number; area: number; total: number; /** Its outline's box: west, south, east, north. */ box: [number, number, number, number];
  /** The owner's other large pieces, largest first (an empire's colonies apart from its largest; islands): named where the main piece is not in view (D178). */
  others?: OwnerPiece[];
}
interface PlacedLabel { lon: number; lat: number; font: number; lines: string[] }
/**
 * The ways of writing a label (on one line, two, three), each placed when it is first asked for:
 * most names fit on one line, and then the others are never searched for.
 */
interface Placings {
  count: number; at: (i: number) => PlacedLabel | null;
  /** How much it holds on to (the points of the outline searched). */
  weight: number;
  /** For a search of the part in view: the middle of that view on the map and its scale (see layerLabels: what is held while the map moves). */
  from?: { ll: [number, number] | null; scale: number };
}

interface FaceGeo { geo: GeoPermissibleObjects; area: number; centroid: [number, number] }

/**
 * A path, and the space it is drawn in: on the sheet (prepared geometry, placed on the view by the
 * sheet's transform) or on the screen itself (shapes made for one frame).
 */
interface Shape { path: Path2D | BlockPath; onSheet: boolean }
/** How much a kept path weighs: the points it holds. */
const pathWeight = (p: BlockPath | null) => (p ? p.size + 16 : 1);
/** A shape as one path (for clipping to it). */
const solid = (p: Path2D | BlockPath): Path2D => (p instanceof BlockPath ? p.whole() : p);

/** The parcels of one owner (or one change), with a key that says exactly which outlines they are. */
interface FaceSet { faces: number[]; key: string }

/** One animated change, as far as it stays the same throughout a stretch of time. */
interface ChangeGroup {
  id: string;
  /** Every parcel in the change, and those whose owner actually changes. */
  region: FaceSet;
  changing: FaceSet;
}

/**
 * What stays the same about a layer throughout a stretch of time (between two changes, and while
 * the same changes are animating): who holds each parcel, which parcels are changing hands, which
 * borders show. Worked out once and used for every frame of the stretch.
 */
interface LayerSnap {
  key: string;
  /** Parcels by the owner they are filled for (during an animated change: the owner before it). */
  byOwner: Map<string, FaceSet>;
  groups: Map<string, ChangeGroup>;
  groupOf: Map<number, ChangeGroup>;
  /** For labels: each owner's parcels before and after the changes animating now (the same when none is). */
  before: Map<string, FaceSet>;
  after: Map<string, FaceSet>;
  animating: boolean;
  /** Each owner's parcels including those it is losing or gaining (where its picture is placed). */
  reach: Map<string, number[]>;
  /** Label pieces, worked out when labels are first drawn. */
  pieces: Map<string, { after: Map<string, OwnerPiece>; before: Map<string, OwnerPiece> }>;
  /** The parcel map and the states this was made from. */
  arr: Arrangement;
  states: Map<number, FaceState>;
  /** Which border chains each owner draws (see ownerBorder), worked out when borders are first drawn. */
  borders: Map<string, OwnerBorder> | null;
  /** When this was made from the snapshot before it: that snapshot, the owners whose parcels changed and the parcels worked out again. */
  from: { prev: LayerSnap; owners: Set<string>; changed: number[] } | null;
}

/** The border chains an owner draws: `take` are positions in `b` (see boundaryOf); `key` says which lines those are. */
interface OwnerBorder { key: string; b: Int32Array; take: number[]; /** Of those, the chains against nobody. */ open: Set<number> }

/**
 * Where a change is on the picture (device pixels, with room round it), where a part of it is (its west, south,
 * east, north in degrees), and the pixels to a unit of the view.
 */
interface FrontFx { view: View; k: number; box: (pad: number) => Box2; part: (deg: readonly [number, number, number, number], pad: number) => Box2 }

interface TransitionGroup {
  a: Assignment;
  faces: number[];
  /** The parcels whose owner actually changes. */
  changingFaces: number[];
  /** A front moves across the change (advancing circle or straight wipe); otherwise it fades. */
  advance: boolean;
  spec: CompiledTransition;
  /** How far the change has progressed (0 to 1, eased). */
  progress: number;
  /** For a moving front: the area reached so far (null before anything is reached), in screen space. */
  disc: Path2D | null;
  /** How `disc` is filled: an advancing front from a border is a union of overlapping shapes. */
  discRule: CanvasFillRule;
  /** For a front from a border: the reach builder, to draw the front line as a band. */
  border: BorderFront | null;
  /** A front that follows the land (D136): its field of arrival times. */
  field?: FrontField | null;
  /** How its front looks (D137). */
  look: FrontLookOptions;
  /** Who held the land before (the first parcel's previous owner). */
  from: string | null;
  /** Where it is on screen, for a view (see groupBox, groupRects): kept with the change from frame to frame. */
  boxes: { key: string; changing: Box2 | null; all: Box2 | null; rectsKey?: string; rects?: number[][] | null };
  /** The front itself (with a field): the lines between the land reached and not yet reached, within the change, on screen. */
  line?: Path2D | null;
  /** All the parcels of the change, and those changing owner (null: none of it is on the sheet). */
  region: Shape | null;
  changing: Shape | null;
}

interface BorderPaths {
  plain: Array<Path2D | BlockPath>;
  /** Each owner's border against nobody (often a coast), apart (D83). */ open: Array<Path2D | BlockPath>; openBy: Map<string, Path2D | BlockPath>;
  /** Around each animated change: the borders after it (shown where its front has come) and before it (where it has not yet). */
  inside: Map<string, Path2D>; outside: Map<string, Path2D>;
  /**
   * Where two animated changes meet (`a` and `b`, their group ids): the borders shown for each of the
   * four combinations of a point being reached by `a`'s front or not and by `b`'s or not (index
   * 2 * reachedA + reachedB). Each side's owner there is the one before or after its own change.
   */
  meet: Array<{ a: string; b: string; paths: Array<Path2D | null> }>;
}

/** Paths prepared on one sheet for one parcel map. */
interface SheetParcels {
  arr: Arrangement;
  chains: Map<number, Array<Float32Array[] | undefined>>;
  sets: Weighed<string, BlockPath | null>;
  /** Each owner's share of the borders, by the owner's parcels and which of its chains it draws. */
  ownerBorders: Weighed<string, BlockPath | null>;
  borders: Map<string, BorderPaths>;
}

/** Everything except the given shape (use with the even-odd rule). */
function outsideOf(shape: Path2D): Path2D {
  const p = new Path2D();
  p.rect(-1e6, -1e6, 2e6, 2e6);
  p.addPath(shape);
  return p;
}

/** Is any of the view (and `pad` view pixels around it) outside the planet's outline, so that the outline must clip what is drawn? */
function outlineInView(view: View, pad = 0): boolean {
  if (view.camera.projection === 'flat') return false;
  const w = view.width, h = view.height, a = -pad, b = w + pad, c = h + pad;
  for (const [x, y] of [[a, a], [b, a], [a, c], [b, c], [w / 2, a], [w / 2, c], [a, h / 2], [b, h / 2]]) if (!screenToLonLat(view, x, y)) return true;
  return false;
}

/** The grid of meridians and parallels every 10° (as d3's geoGraticule10), as lines for sheets. */
let graticuleLines: Ring[] | null = null;
function graticule10(): Ring[] {
  if (!graticuleLines) {
    graticuleLines = [];
    for (let lat = -80; lat <= 80; lat += 10) {
      const n = 145;
      graticuleLines.push(makeRing(Float64Array.from({ length: n }, (_, i) => -180 + i * 2.5), new Float64Array(n).fill(lat), false, false));
    }
    for (let lon = -180; lon < 180; lon += 10) {
      const top = lon % 90 === 0 ? 90 : 80, n = Math.round((2 * top) / 2.5) + 1;
      graticuleLines.push(makeRing(new Float64Array(n).fill(lon), Float64Array.from({ length: n }, (_, i) => -top + i * 2.5), false, false));
    }
  }
  return graticuleLines;
}

/** Boxes on the frame (x0, y0, x1, y1), found by the squares they reach into: does a box touch any of them? */
class BoxGrid {
  private static readonly CELL = 128;
  private cells = new Map<number, Array<[number, number, number, number]>>();

  private span(b: readonly [number, number, number, number]): [number, number, number, number] {
    const c = BoxGrid.CELL, lim = (v: number) => Math.max(-64, Math.min(1000, Math.floor(v / c)));
    return [lim(b[0]), lim(b[1]), lim(b[2]), lim(b[3])];
  }

  add(b: [number, number, number, number]): void {
    const [x0, y0, x1, y1] = this.span(b);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = (y + 64) * 2048 + x + 64;
      const list = this.cells.get(k);
      if (list) list.push(b); else this.cells.set(k, [b]);
    }
  }

  /** `except`: a box that does not count, nor any box with the same corner as it (a city's own dot). */
  hits(b: readonly [number, number, number, number], except: readonly [number, number, number, number] | null = null): boolean {
    const [x0, y0, x1, y1] = this.span(b);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const list = this.cells.get((y + 64) * 2048 + x + 64);
      if (!list) continue;
      for (const o of list) {
        if (b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]) continue;
        if (except && o[0] === except[0] && o[1] === except[1]) continue;
        return true;
      }
    }
    return false;
  }
}

export class MapRenderer {
  /** How closely prepared geometry follows the true shapes (exports use EXPORT_QUALITY whatever this is). */
  quality: RenderQuality = { ...VIEW_QUALITY };
  private basemapPainter = new BasemapPainter();
  private terrainPictures = new TerrainPictures();
  private fieldPictures = new FieldPictures();
  /** The field layers drawn last (D102): how many sources each had in force, and how many rectangles were drawn (for the tests). */
  lastFields: Array<{ layer: string; sources: number; drawn: number }> = [];
  lastLabels: LabelInfo[] = [];
  /** The cities of the last frame as placed (with their dots' sizes), for the globe (D127). */
  private lastCityItems: CityItem[] = [];
  /** The last globe drawn (D127): its flat picture's size, pixels to a radian, whether it went all the way round, and the time it took (ms). */
  lastGlobe: { picture: [number, number]; perRad: number; round: boolean; ms: number; reused: boolean } | null = null;
  private globeFlat: MapRenderer | null = null;
  /** The last globe frame when nothing on it was moving (see renderGlobe), and what the graphics card holds. */
  private globeFrame: { key: string; canvas: OffscreenCanvas; labels: LabelInfo[]; cities: MapRenderer['lastCities'] } | null = null;
  private globeUploaded: string | null = null;
  /** The flat picture last laid on the globe: where it lies, what it shows (see renderGlobe). */
  private globeLast: { content: string; west: number; east: number; south: number; north: number; round: boolean; pw: number; ph: number; lonMid: number; latMid: number; perRad: number } | null = null;
  private globePicture: { canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D } | null = null;
  /** The characters drawn in the last frame, where (screen) and on the map, for picking and tests. */
  /** (r: how far the marker or icon reaches from its middle, in design pixels; icon: its icon, 'picture' or 'marker'.) */
  lastCharacters: Array<{ entity: string; name: string; x: number; y: number; lon: number; lat: number; moving: boolean; r: number; icon: string; angle: number; mirror: boolean; color: string }> = [];
  /** How many units' arrows of advance the last frame drew (D90). */
  lastAdvances = 0;
  private unitStyles = new Map<string, { side: string | null; route: RouteStyle | null }>();
  private unitOf(style: string | undefined): { side: string | null; route: RouteStyle | null } {
    if (!style) return { side: null, route: null };
    let u = this.unitStyles.get(style);
    if (!u) { if (this.unitStyles.size > 2000) this.unitStyles.clear(); u = unitOfStyle(style); this.unitStyles.set(style, u); }
    return u;
  }
  /** Characters' icons by their stored style (parsed once per style). */
  private iconStyles = new Map<string, CharacterIcon | null>();
  /** The areas, lines and points drawn in the last frame, topmost last (for finding what is under the pointer: see featureAt). */
  lastFeatures: Array<{ id: string; kind: FeatureKind; path: Path2D | null; place: [number, number, number]; lines: Float32Array[]; x: number; y: number; r: number; width: number }> = [];
  /** The project's sizes for cities and characters (set for each frame by render()). */
  private pointSizes = { city: 1, character: 1 };
  /** Which cities the map shows (D173); set for each frame by render(). */
  private cityFilter: CityFilter = DEFAULT_CITY_FILTER;
  /** How many characters' trails the last frame drew. */
  lastTrails = 0;
  /** The cities drawn in the last frame (same form; `named`: whether its name had room). */
  lastCities: Array<{ entity: string; name: string; x: number; y: number; lon: number; lat: number; moving: boolean; named: boolean; box?: [number, number, number, number] }> = [];
  /** The animated changes drawn in the last frame (style and eased progress), for checks and tests. */
  lastTransitions: Array<{ style: string; progress: number }> = [];
  /** The wars shown as front lines in the last frame (D89): on which layer, drawn from whose side, teeth toward whom. */
  lastFronts: Array<{ layerId: string; from: string; toward: string }> = [];
  /** What of the terrain the last frame drew (D95): its colours, relief over the plain land, relief over the territories; the sea level (D96). */
  lastTerrain = { colours: false, relief: false, overTerritories: false, seaLevel: 0, cover: false, detail: '', photo: '' };
  /** For benchmarks and tests: how many sheets have been made, and snapshots of layers worked out. */
  stats = { sheets: 0, snaps: 0, snapsFollowed: 0 };

  // ---------------------------------------------------------------- sheets (prepared geometry)

  private sheet: Sheet | null = null;
  private sheetSpace = '';
  /** The transform that puts the current sheet on the view being drawn: scale, x, y. */
  private place: [number, number, number] = [1, 0, 0];

  /** The sheet to draw a view from: the current one while the view stays on it, else a new one. */
  /** The sheet to draw the view on; `pad`: view pixels around the view that are drawn on too (the room around carried pictures). */
  private sheetFor(view: View, spaceId: string, pad = 0, upTo = SHARP_UP_TO): Sheet {
    if (!this.sheet || this.sheetSpace !== spaceId || !this.sheet.covers(view, this.quality.tolerance, pad, upTo)) {
      this.sheet = new Sheet(view, this.quality);
      this.sheetSpace = spaceId;
      this.stats.sheets++;
    }
    this.place = this.sheet.placement(view);
    return this.sheet;
  }

  private parcelsOn(sheet: Sheet, arr: Arrangement): SheetParcels {
    let p = sheet.cache.get('parcels') as SheetParcels | undefined;
    if (!p || p.arr !== arr) { p = { arr, chains: new Map(), sets: new Weighed(4_000_000, pathWeight), ownerBorders: new Weighed(2_500_000, pathWeight), borders: new Map() }; sheet.cache.set('parcels', p); }
    return p;
  }

  /**
   * One path for a set of parcels (even-odd), built from the cycles' own paths and kept while the
   * set and its outlines stay the same. A parcel whose area includes the rest of the planet beyond
   * its rings (there is at most one such parcel on a map) brings a frame around everything.
   */
  private setPath(sp: SheetParcels, sheet: Sheet, arr: Arrangement, set: FaceSet): Shape | null {
    let p = sp.sets.get(set.key);
    if (p === undefined) {
      const geom = parcelGeometry(arr), t = arr.topology();
      const path = sheet.blocks();
      let any = false;
      // Several parcels: their outline taken together (the borders between them are not drawn, nor
      // worked through when filling). One parcel, or a set that cannot be joined so: ring by ring.
      const rings = set.faces.length > 1 ? geom.dissolve(set.faces, t, set.key) : null;
      if (rings) for (const r of rings) { if (sheet.ringOf(path, r.parts, r.box)) any = true; }
      else for (const f of set.faces) {
        for (const c of t.facesCycles.get(f) ?? []) if (sheet.ring(path, geom.cycle(c))) any = true;
        if (geom.needsOutline(f)) { path.rect(-(1 << 19), -(1 << 19), 1 << 20, 1 << 20); any = true; }
      }
      p = any ? path : null;
      sp.sets.set(set.key, p);
    }
    return p ? { path: p, onSheet: true } : null;
  }

  /** A set of parcels with its key: the parcels and the state of their outlines. */
  private faceSet(arr: Arrangement, faces: number[]): FaceSet {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    const t = arr.topology();
    for (const f of faces) {
      const st = t.faceStamps.get(f) ?? 0;
      h1 = Math.imul(h1 ^ f, 16777619) >>> 0; h1 = Math.imul(h1 ^ st, 16777619) >>> 0;
      h2 = (Math.imul(h2 + f, 2246822519) ^ st) >>> 0;
    }
    return { faces, key: `${faces.length}|${h1}|${h2}` };
  }

  private fill(c: CanvasRenderingContext2D, s: Shape, rule: CanvasFillRule = 'evenodd'): void {
    if (!s.onSheet) { c.fill(solid(s.path), rule); return; }
    const [k, e, f] = this.place;
    c.save();
    c.transform(k, 0, 0, k, e, f);
    this.fitHatch(c.fillStyle, k);
    if (s.path instanceof BlockPath) s.path.paint(c, 1, (p) => c.fill(p, rule));
    else c.fill(s.path, rule);
    c.restore();
  }

  /**
   * See-through fills for a territory layer (D88): stripes, crossed stripes or dots in the owner's
   * colour, so a layer of occupation or control shows the map under it. Made once per colour and size.
   */
  private hatchPatterns = new Map<string, CanvasPattern | null>();
  private hatches = new WeakSet<CanvasPattern>();
  private hatch(c: CanvasRenderingContext2D, color: string, kind: TerritoryFill, unit: number): CanvasPattern | null {
    if (kind === 'solid' || typeof OffscreenCanvas === 'undefined') return null;
    const size = Math.max(4, Math.round(11 * unit));
    const key = `${kind}|${color}|${size}`;
    let p = this.hatchPatterns.get(key);
    if (p === undefined) {
      const tile = new OffscreenCanvas(size, size);
      const t = tile.getContext('2d')!;
      t.fillStyle = color;
      t.strokeStyle = color;
      t.lineWidth = Math.max(1, size * 0.26);
      t.lineCap = 'square';
      if (kind === 'dots') { t.beginPath(); t.arc(size / 2, size / 2, size * 0.2, 0, Math.PI * 2); t.fill(); }
      else {
        // Stripes at 45°, drawn across the tile and its corners so that tiles join without seams.
        const line = (x0: number, y0: number, x1: number, y1: number) => { t.beginPath(); t.moveTo(x0, y0); t.lineTo(x1, y1); t.stroke(); };
        for (const d of [-size, 0, size]) line(d, size, d + size, 0);
        if (kind === 'cross') for (const d of [-size, 0, size]) line(d, 0, d + size, size);
      }
      p = c.createPattern(tile as unknown as CanvasImageSource, 'repeat');
      if (p) this.hatches.add(p);
      if (this.hatchPatterns.size > 300) this.hatchPatterns.clear();
      this.hatchPatterns.set(key, p);
    }
    return p;
  }

  /** A hatch keeps its spacing on screen when drawn on a sheet scaled by k (and moves with the map). */
  private fitHatch(style: string | CanvasGradient | CanvasPattern, k: number): void {
    if (style instanceof CanvasPattern && this.hatches.has(style)) style.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]));
  }

  private clip(c: CanvasRenderingContext2D, s: Shape, rule: CanvasFillRule = 'evenodd'): void {
    if (!s.onSheet) { c.clip(solid(s.path), rule); return; }
    const [k, e, f] = this.place;
    c.transform(k, 0, 0, k, e, f);
    c.clip(solid(s.path), rule);
    c.transform(1 / k, 0, 0, 1 / k, -e / k, -f / k);
  }

  /** Clip to everything but a shape (for lines outside a country's edge). */
  private clipOutside(c: CanvasRenderingContext2D, s: Shape): void {
    const p = new Path2D();
    p.rect(-1e7, -1e7, 2e7, 2e7);
    p.addPath(solid(s.path));
    if (!s.onSheet) { c.clip(p, 'evenodd'); return; }
    const [k, e, f] = this.place;
    c.transform(k, 0, 0, k, e, f);
    c.clip(p, 'evenodd');
    c.transform(1 / k, 0, 0, 1 / k, -e / k, -f / k);
  }

  /** Stroke a shape's outline `width` screen pixels wide, on the sheet or not. */
  private strokeShape(c: CanvasRenderingContext2D, s: Shape, width: number): void {
    if (s.onSheet) { this.strokeOnSheet(c, s.path, width); return; }
    c.lineWidth = width;
    c.stroke(solid(s.path));
  }

  /**
   * The shadow some countries cast (D181), on the land drawn before them: their shapes, grown by the spread, painted
   * in the shadow's colour in a buffer, then laid on blurred, moved away from the light, at the shadow's strength.
   */
  private castShadow(target: CanvasRenderingContext2D, tmp: CanvasRenderingContext2D, sh: ShadowEffect, shapes: Shape[], u: number): void {
    tmp.save();
    tmp.setTransform(1, 0, 0, 1, 0, 0);
    tmp.clearRect(0, 0, tmp.canvas.width, tmp.canvas.height);
    tmp.restore();
    tmp.save();
    tmp.fillStyle = sh.color;
    tmp.strokeStyle = sh.color;
    tmp.lineJoin = 'round';
    for (const s of shapes) {
      this.fill(tmp, s);
      if (sh.spread > 0) this.strokeShape(tmp, s, 2 * sh.spread * u);
    }
    tmp.restore();
    const [dx, dy] = shadowOffset(sh, u);
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = sh.opacity;
    if (sh.blur > 0) target.filter = `blur(${((sh.blur * u) / 2).toFixed(2)}px)`;
    target.drawImage(tmp.canvas as CanvasImageSource, dx, dy);
    target.restore();
  }

  /**
   * A shadow inside a country's edge (D182): the land all round it, in the shadow's colour, blurred and moved by
   * `dx, dy`, seen only within the country. Worked within the country's box (`box`, device pixels, with room for the
   * blur and the move) so that a layer of many countries does not blur the whole frame for each.
   */
  private innerShadow(target: CanvasRenderingContext2D, tmp: CanvasRenderingContext2D, s: Shape, color: string, opacity: number, dx: number, dy: number, blur: number, box: Box2): void {
    const [bx, by, bw, bh] = box;
    if (bw <= 0 || bh <= 0 || opacity <= 0) return;
    tmp.save();
    tmp.setTransform(1, 0, 0, 1, 0, 0);
    tmp.clearRect(bx, by, bw, bh);
    tmp.fillStyle = color;
    tmp.fillRect(bx, by, bw, bh);
    tmp.restore();
    tmp.save();
    tmp.globalCompositeOperation = 'destination-out';
    tmp.fillStyle = '#000';
    this.fill(tmp, s);
    tmp.restore();
    target.save();
    this.clip(target, s);
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = opacity;
    if (blur > 0) target.filter = `blur(${(blur / 2).toFixed(2)}px)`;
    target.drawImage(tmp.canvas as CanvasImageSource, bx, by, bw, bh, bx + dx, by + dy, bw, bh);
    target.restore();
  }

  /** An effect drawn inside a country, over its fill (D182); `boxOf(pad)`: the country's box in device pixels, with room. */
  /**
   * An effect inside a country's edge. `boxOf`: the box of all its land on the canvas, padded; `mainOf`: the box of its
   * main body (France without its lands overseas), not cut at the canvas's edge, which gradients and light sweeps cross
   * (so they do not change as the map moves, nor cross half the world for a country with islands far away).
   */
  private insideEffect(c: CanvasRenderingContext2D, tmp: CanvasRenderingContext2D, s: Shape, e: Effect, boxOf: (pad: number) => Box2, u: number, mainOf: () => Box2 = () => boxOf(0)): void {
    if (e.kind === 'inner-shadow') {
      const [dx, dy] = shadowOffset(e, u);
      this.innerShadow(c, tmp, s, e.color, e.opacity, dx, dy, e.blur * u, boxOf((e.distance + 3 * e.blur) * u + 4));
    } else if (e.kind === 'inner-glow') {
      this.innerShadow(c, tmp, s, e.color, e.opacity, 0, 0, e.blur * u, boxOf(3 * e.blur * u + 4));
    } else if (e.kind === 'bevel') {
      // Raised: the edges facing the light lit, those away from it shaded (sunken: the other way round).
      const [dx, dy] = awayFromLight(e.angle, e.depth, u), box = boxOf((e.depth + 3 * e.size) * u + 4);
      const lit = e.style === 'raised' ? 1 : -1;
      this.innerShadow(c, tmp, s, e.highlight, e.highlightOpacity, lit * dx, lit * dy, e.size * u, box);
      this.innerShadow(c, tmp, s, e.shade, e.shadeOpacity, -lit * dx, -lit * dy, e.size * u, box);
    } else if (e.kind === 'shine') {
      // A band of light across the country, from one side of its box to the other, then a pause (D185).
      const at = sweepAt(e.period, e.pause, this.mediaSeconds);
      if (at === null || e.opacity <= 0) return;
      const [bx, by, bw, bh] = boxOf(0), [mx, my, mw, mh] = mainOf();
      if (bw <= 0 || bh <= 0) return;
      const a = (e.angle * Math.PI) / 180, ux = Math.cos(a), uy = -Math.sin(a), half = Math.abs((mw / 2) * ux) + Math.abs((mh / 2) * uy);
      const w = e.width * u, cx = mx + mw / 2, cy = my + mh / 2, d = -half - w + at * (2 * half + 2 * w);
      const g = c.createLinearGradient(cx + ux * (d - w), cy + uy * (d - w), cx + ux * (d + w), cy + uy * (d + w));
      g.addColorStop(0, rgbaOf(e.color, 0));
      g.addColorStop(0.5, rgbaOf(e.color, 1));
      g.addColorStop(1, rgbaOf(e.color, 0));
      c.save();
      this.clip(c, s);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = e.opacity;
      c.globalCompositeOperation = 'screen';
      c.fillStyle = g;
      c.fillRect(bx, by, bw, bh);
      c.restore();
    } else if (e.kind === 'gradient' || e.kind === 'pattern' || e.kind === 'texture') {
      if (e.opacity <= 0) return;
      const [bx, by, bw, bh] = boxOf(0);
      if (bw <= 0 || bh <= 0) return;
      c.save();
      this.clip(c, s);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = e.opacity;
      c.globalCompositeOperation = compositeOf(e.blend);
      if (e.kind === 'gradient') {
        const [mx, my, mw, mh] = mainOf(), cx = mx + mw / 2, cy = my + mh / 2;
        let g: CanvasGradient;
        if (e.style === 'radial') g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(mw, mh) * 0.55);
        else {
          const a = (e.angle * Math.PI) / 180, ux = Math.cos(a), uy = -Math.sin(a), h = Math.abs((mw / 2) * ux) + Math.abs((mh / 2) * uy);
          g = c.createLinearGradient(cx - ux * h, cy - uy * h, cx + ux * h, cy + uy * h);
        }
        g.addColorStop(0, e.from);
        g.addColorStop(1, e.to);
        c.fillStyle = g;
      } else {
        const tile = e.kind === 'pattern' ? patternTile(e.pattern, e.color, 10 * e.scale * u) : textureTile(e.texture);
        const p = c.createPattern(tile as unknown as CanvasImageSource, 'repeat');
        if (!p) { c.restore(); return; }
        const k = e.kind === 'texture' ? e.scale * Math.max(0.5, u) : 1;
        p.setTransform(new DOMMatrix().rotateSelf(e.kind === 'pattern' ? e.angle : 0).scaleSelf(k, k));
        c.fillStyle = p;
      }
      c.fillRect(bx, by, bw, bh);
      c.restore();
    }
  }

  /**
   * The walls of a raised country (D186): its shape in its colour, darkened by `shade`, laid again and again from its
   * place to `dx, dy` pixels away (the farthest first), so that its fill drawn after stands on them as a slab's top.
   * Worked within the country's box on the canvas (`box`, device pixels).
   */
  private drawSlab(target: CanvasRenderingContext2D, tmp: CanvasRenderingContext2D, s: Shape, color: string, shade: number, dx: number, dy: number, box: Box2): void {
    const [bx, by, bw, bh] = box, n = Math.min(240, Math.ceil(Math.hypot(dx, dy)));
    if (bw <= 0 || bh <= 0 || n < 1) return;
    tmp.save();
    tmp.setTransform(1, 0, 0, 1, 0, 0);
    tmp.clearRect(bx, by, bw, bh);
    tmp.restore();
    tmp.save();
    tmp.fillStyle = color;
    this.fill(tmp, s);
    tmp.setTransform(1, 0, 0, 1, 0, 0);
    tmp.globalCompositeOperation = 'source-atop';
    tmp.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, shade))})`;
    tmp.fillRect(bx, by, bw, bh);
    tmp.restore();
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = n; k >= 1; k--) target.drawImage(tmp.canvas as CanvasImageSource, bx, by, bw, bh, bx + (dx * k) / n, by + (dy * k) / n, bw, bh);
    target.restore();
  }

  /** A line round a country (D181): inside its edge (clipped to it), on it, or outside it (clipped away from it). */
  private strokeCountry(c: CanvasRenderingContext2D, s: Shape, e: StrokeEffect, u: number): void {
    c.save();
    c.strokeStyle = e.color;
    c.globalAlpha = e.opacity;
    c.lineJoin = 'round';
    const w = e.width * u;
    if (e.position === 'inside') { this.clip(c, s); this.strokeShape(c, s, 2 * w); }
    else if (e.position === 'outside') { this.clipOutside(c, s); this.strokeShape(c, s, 2 * w); }
    else this.strokeShape(c, s, w);
    c.restore();
  }

  /** Stroke a sheet path with a line `width` screen pixels wide. */
  private strokeOnSheet(c: CanvasRenderingContext2D, path: Path2D | BlockPath, width: number): void {
    const [k, e, f] = this.place;
    c.save();
    c.transform(k, 0, 0, k, e, f);
    this.fitHatch(c.strokeStyle, k);
    c.lineWidth = width / k;
    if (path instanceof BlockPath) path.paint(c, width / k / 2 + 1, (p) => c.stroke(p));
    else c.stroke(path);
    c.restore();
  }

  /**
   * Draw with the outline of some parcels (the selected country, say): `draw` is given their path
   * with the context set so that the path lands on the view; `px` is one screen pixel in the path's
   * units (for line widths and dashes).
   */
  withFaces(ctx: CanvasRenderingContext2D, view: View, arr: Arrangement, faces: number[], draw: (path: Path2D, px: number) => void): void {
    if (!faces.length) return;
    const sheet = this.sheetFor(view, arr.spaceId);
    const shape = this.setPath(this.parcelsOn(sheet, arr), sheet, arr, this.faceSet(arr, faces));
    if (!shape) return;
    const [k, e, f] = this.place;
    ctx.save();
    if (view.rotation) {
      ctx.translate(view.width / 2, view.height / 2);
      ctx.rotate((view.rotation * Math.PI) / 180);
      ctx.translate(-view.width / 2, -view.height / 2);
    }
    ctx.transform(k, 0, 0, k, e, f);
    draw(solid(shape.path), 1 / k);
    ctx.restore();
  }

  // ---------------------------------------------------------------- per-face geometry (labels, animation origins)

  private geoCache = new WeakMap<Arrangement, Map<number, { stamp: number; g: FaceGeo }>>();

  /** Spherical geometry of a parcel (kept until the parcel's outline changes). */
  faceGeo(arr: Arrangement, face: number): FaceGeo {
    let c = this.geoCache.get(arr);
    if (!c) this.geoCache.set(arr, (c = new Map()));
    // (Parcels that are gone are forgotten now and then.)
    if (c.size > 3 * arr.faces.size + 2000) c.clear();
    const stamp = arr.faceStamp(face);
    const hit = c.get(face);
    if (hit && hit.stamp === stamp) return hit.g;
    const rings = arr.faceRingsLonLat(face);
    const geo: GeoPermissibleObjects = rings.length === 0
      ? { type: 'Sphere' }
      : { type: 'Polygon', coordinates: rings.map((r) => { const rr = [...r].reverse(); rr.push(rr[0]); return rr; }) };
    const area = arr.faceArea(face);
    const centroid = rings.length === 0 ? [0, 0] as [number, number] : geoCentroid(geo as GeoJSON.Polygon) as [number, number];
    const g = { geo, area, centroid };
    c.set(face, { stamp, g });
    return g;
  }

  // ---------------------------------------------------------------- what stays the same through a stretch of time

  private snaps = new Map<string, LayerSnap>();

  /** The snapshot made from each state (for making the next one from it). */
  private snapOf = new WeakMap<Map<number, FaceState>, LayerSnap>();
  /** For tests: every snapshot made from the one before is compared with one made from scratch. */
  verify = false;

  private snapFor(key: string, arr: Arrangement, states: Map<number, FaceState>, changing: number[], engine: Engine): LayerSnap {
    const hit = this.snaps.get(key);
    if (hit) return hit;
    this.stats.snaps++;
    let snap = this.snapFromBefore(key, arr, states, changing, engine);
    if (snap) {
      this.stats.snapsFollowed++;
      if (this.verify) this.sameSnap(snap, this.snapWhole(key, arr, states, changing), states);
    } else snap = this.snapWhole(key, arr, states, changing);
    this.snapOf.set(states, snap);
    if (this.snaps.size >= 12) this.snaps.delete(this.snaps.keys().next().value!);
    this.snaps.set(key, snap);
    return snap;
  }

  /** Owners in a fixed order (by their ids), each with its parcels in order: the same however the states were worked out. */
  private ordered<T>(m: Map<string, T>): Map<string, T> {
    return new Map([...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
  }

  /** A snapshot worked out from the states of every parcel. */
  private snapWhole(key: string, arr: Arrangement, states: Map<number, FaceState>, changing: number[]): LayerSnap {
    const groups = new Map<string, ChangeGroup>(), groupOf = new Map<number, ChangeGroup>();
    const members = new Map<string, { all: number[]; changing: number[] }>();
    for (const f of [...changing].sort((x, y) => x - y)) {
      const st = states.get(f);
      if (!st?.transition || !st.assignment) continue;
      const id = st.assignment.effectId;
      let m = members.get(id);
      if (!m) members.set(id, (m = { all: [], changing: [] }));
      m.all.push(f);
      if ((st.transition.from ?? '') !== (st.value ?? '')) m.changing.push(f);
    }
    for (const [id, m] of members) {
      const g: ChangeGroup = { id, region: this.faceSet(arr, m.all), changing: this.faceSet(arr, m.changing) };
      groups.set(id, g);
      for (const f of m.all) groupOf.set(f, g);
    }
    const owned = new Map<string, number[]>(), reach = new Map<string, number[]>();
    const before = new Map<string, number[]>(), after = new Map<string, number[]>();
    let animating = false;
    const add = (m: Map<string, number[]>, v: string, f: number) => { const l = m.get(v); if (l) l.push(f); else m.set(v, [f]); };
    for (const [face, st] of states) {
      const inGroup = groupOf.has(face);
      const from = inGroup ? st.transition!.from : st.value;
      if (from) add(owned, from, face);
      if (st.value) add(reach, st.value, face);
      if (inGroup && from && from !== st.value) add(reach, from, face);
      // Labels leave out parcels with no area, and one covering most of the planet.
      const area = arr.faceArea(face);
      if (area <= 0 || area > 2 * Math.PI) continue;
      if (st.value) add(after, st.value, face);
      const was = st.transition ? st.transition.from : st.value;
      if (was) add(before, was, face);
      if (st.transition && st.transition.from !== st.value) animating = true;
    }
    const num = (x: number, y: number) => x - y;
    const sets = (m: Map<string, number[]>) => { const o = new Map<string, FaceSet>(); for (const [v, faces] of this.ordered(m)) o.set(v, this.faceSet(arr, faces.sort(num))); return o; };
    for (const l of reach.values()) l.sort(num);
    const afterSets = sets(after);
    return { key, byOwner: sets(owned), groups, groupOf, before: animating ? sets(before) : afterSets, after: afterSets, animating, reach: this.ordered(reach), pieces: new Map(), arr, states, borders: null, from: null };
  }

  /**
   * A snapshot made from the one before it, when the states were worked out from the states that
   * one was made from (Engine.stateDelta) and nothing is animating in either: only the owners of
   * the parcels worked out again get new sets of parcels; every other owner keeps its own (and with
   * them its outline, its borders and its label). Null when it has to be made from every parcel.
   */
  private snapFromBefore(key: string, arr: Arrangement, states: Map<number, FaceState>, changing: number[], engine: Engine): LayerSnap | null {
    if (changing.length) return null;
    const delta = engine.stateDelta(states);
    const prev = delta ? this.snapOf.get(delta.from) : undefined;
    if (!delta || !prev || prev.arr !== arr || prev.animating || prev.groups.size) return null;
    const moved = new Set<number>(delta.changed);
    for (const f of delta.removed) moved.add(f);
    if (moved.size > states.size / 4 + 16) return null;
    // The owners of those parcels, before and now; and the parcels each owner gains.
    const owners = new Set<string>();
    const gains = new Map<string, number[]>(), gainsLabelled = new Map<string, number[]>();
    for (const f of moved) { const was = delta.from.get(f)?.value; if (was) owners.add(was); }
    for (const f of delta.changed) {
      const now = states.get(f)?.value;
      if (!now) continue;
      owners.add(now);
      const l = gains.get(now);
      if (l) l.push(f); else gains.set(now, [f]);
      const area = arr.faceArea(f);
      if (area <= 0 || area > 2 * Math.PI) continue;
      const g = gainsLabelled.get(now);
      if (g) g.push(f); else gainsLabelled.set(now, [f]);
    }
    const byOwner = new Map(prev.byOwner), reach = new Map(prev.reach), after = new Map(prev.after);
    const num = (x: number, y: number) => x - y;
    const rest = (l: number[] | undefined, more: number[] | undefined) => { const o = (l ?? []).filter((f) => !moved.has(f)); if (more) for (const f of more) o.push(f); return o.sort(num); };
    let cameOrWent = false;
    for (const owner of owners) {
      const o = rest(prev.byOwner.get(owner)?.faces, gains.get(owner));
      if (byOwner.has(owner) !== o.length > 0 ) cameOrWent = true;
      if (o.length) { byOwner.set(owner, this.faceSet(arr, o)); reach.set(owner, o); } else { byOwner.delete(owner); reach.delete(owner); }
      const a = rest(prev.after.get(owner)?.faces, gainsLabelled.get(owner));
      if (after.has(owner) !== a.length > 0) cameOrWent = true;
      if (a.length) after.set(owner, this.faceSet(arr, a)); else after.delete(owner);
    }
    // (An owner new to the map takes its place in the order.)
    const inOrder = <T>(m: Map<string, T>) => (cameOrWent ? this.ordered(m) : m);
    const afterSets = inOrder(after);
    // The snapshot before keeps no hold on the one before it.
    prev.from = null;
    return { key, byOwner: inOrder(byOwner), groups: new Map(), groupOf: new Map(), before: afterSets, after: afterSets, animating: false, reach: inOrder(reach), pieces: new Map(), arr, states, borders: null, from: { prev, owners, changed: delta.changed } };
  }

  /** For tests: a snapshot made from the one before must be the snapshot made from every parcel. */
  private sameSnap(got: LayerSnap, want: LayerSnap, states: Map<number, FaceState>): void {
    const show = (m: Map<string, FaceSet>) => [...m.entries()].map(([o, s]) => `${o}=${s.key}:${s.faces.join(',')}`).join(' ');
    const showLists = (m: Map<string, number[]>) => [...m.entries()].map(([o, l]) => `${o}=${l.join(',')}`).join(' ');
    for (const [name, a, b] of [['owners', show(got.byOwner), show(want.byOwner)], ['labels', show(got.after), show(want.after)], ['before', show(got.before), show(want.before)], ['reach', showLists(got.reach), showLists(want.reach)]]) {
      if (a !== b) throw new Error(`A snapshot made from the one before differs from one made afresh (${name}):\n  made from before: ${a.slice(0, 600)}\n  made afresh:      ${b.slice(0, 600)}`);
    }
    const borders = (snap: LayerSnap) => [...this.bordersOf(snap.arr, snap, states).entries()].map(([o, e]) => `${o}=${e.key}`).join(' ');
    const a = borders(got), b = borders(want);
    if (a !== b) throw new Error(`Borders worked out from the snapshot before differ from those worked out afresh:\n  from before: ${a.slice(0, 600)}\n  afresh:      ${b.slice(0, 600)}`);
  }

  /**
   * Per set of parcels: the border chains around it, as (cycle, chain, drawn-from-this-side flag)
   * triples. The parcel across a chain is not kept: it gets a new number when it is split, without
   * anything about this set changing; it is looked up when the chain is used.
   */
  private boundaryCache = new Weighed<string, Int32Array>(4_000_000, (b) => b.length + 16);

  private boundaryOf(arr: Arrangement, set: FaceSet): Int32Array {
    const key = `${arr.spaceId}|${set.key}`;
    let b = this.boundaryCache.get(key);
    if (!b) {
      const gr = parcelGeometry(arr).graph(set.faces, arr.topology(), set.key);
      const out: number[] = [];
      for (let q = 0; q < gr.n; q++) if (gr.across[q] < 0) out.push(gr.cycle[q].id, gr.index[q], gr.cycle[q].canonical[gr.index[q]]);
      b = Int32Array.from(out);
      this.boundaryCache.set(key, b);
    }
    return b;
  }

  /** The polylines of one border chain on a sheet. */
  private chainLines(sp: SheetParcels, sheet: Sheet, geom: ParcelGeometry, cycle: number, i: number): Float32Array[] {
    let list = sp.chains.get(cycle);
    if (!list) sp.chains.set(cycle, (list = []));
    let l = list[i];
    if (!l) {
      const g = geom.cycle(cycle);
      const last = i === g.starts.length - 1;
      l = list[i] = sheet.lines(g, g.starts[i], last ? g.lon.length : g.starts[i + 1] + 1, last);
    }
    return l;
  }

  /**
   * Which of its boundary chains an owner draws: one facing unowned land always; one shared with
   * another owner from the side fixed by the chain itself. Chains touching an animated change are
   * left out (they are drawn chain by chain, see borderPaths). Null when it draws none.
   */
  private ownerBorder(arr: Arrangement, owner: string, set: FaceSet, states: Map<number, FaceState>, inGroup: Map<number, ChangeGroup>): OwnerBorder | null {
    const geom = parcelGeometry(arr), t = arr.topology();
    const b = this.boundaryOf(arr, set);
    let h1 = 0x811c9dc5, h2 = 0x9e3779b9, n = 0;
    const take: number[] = [], open = new Set<number>();
    for (let q = 0; q < b.length; q += 3) {
      const other = arr.halfEdgeFace(geom.cycle(b[q], t).heads[b[q + 1]] ^ 1);
      if (inGroup.size && (inGroup.has(other) || inGroup.has(t.cycleLabel.get(b[q])!))) continue;
      const across = states.get(other);
      if (across === undefined) continue;
      if (across.value !== null && (across.value === owner || !b[q + 2])) continue;
      take.push(q);
      if (across.value === null) open.add(q);
      h1 = Math.imul(h1 ^ q, 16777619) >>> 0; h2 = (Math.imul(h2 + q, 2246822519) ^ (h2 >>> 13)) >>> 0; n++;
    }
    return n ? { key: `${set.key}|${n}|${h1}|${h2}`, b, take, open } : null;
  }

  /**
   * The border chains each owner draws in a snapshot (the same on every sheet). In a snapshot made
   * from the one before, only the owners whose parcels changed and the owners next to a parcel that
   * was worked out again are gone through; the others draw what they drew.
   */
  private bordersOf(arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>): Map<string, OwnerBorder> {
    if (snap.borders) return snap.borders;
    const out = new Map<string, OwnerBorder>();
    const before = snap.from?.prev.borders ?? null;
    let again: Set<string> | null = null;
    if (snap.from && before) {
      const geom = parcelGeometry(arr), t = arr.topology();
      again = new Set(snap.from.owners);
      for (const f of snap.from.changed) for (const c of t.facesCycles.get(f) ?? []) {
        for (const h of geom.cycle(c, t).heads) { const o = states.get(arr.halfEdgeFace(h ^ 1))?.value; if (o) again.add(o); }
      }
    }
    for (const [owner, set] of snap.byOwner) {
      const e = again && !again.has(owner) ? before!.get(owner) ?? null : this.ownerBorder(arr, owner, set, states, snap.groupOf);
      if (e) out.set(owner, e);
    }
    snap.borders = out;
    snap.from = null;
    return out;
  }

  /**
   * The borders of a snapshot on a sheet. A border lies between parcels of different owners; each
   * owner's share of them (every border chain is drawn from one side) is a path kept while the
   * owner's parcels and neighbours stay as they are, so crossing an event rebuilds only the paths
   * of the owners it touches. Around parcels in an animated change the borders are sorted by how
   * they relate to the change: those of the new state ('inside') and of the old ('outside').
   */
  private borderPaths(sp: SheetParcels, sheet: Sheet, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>): BorderPaths {
    let bp = sp.borders.get(snap.key);
    if (bp) return bp;
    const geom = parcelGeometry(arr), t = arr.topology();
    const inGroup = snap.groupOf;
    const plain: Array<Path2D | BlockPath> = [], open: Array<Path2D | BlockPath> = [], openBy = new Map<string, Path2D | BlockPath>();
    // (Borders both before and after an animated change, chain by chain: see step 2.)
    const loose = new Path2D();
    let anyLoose = false;
    // 1. Away from any animated change: owner by owner; against other owners, and against nobody.
    for (const [owner, e] of this.bordersOf(arr, snap, states)) {
      for (const against of ['owner', 'nobody'] as const) {
        const key = `${e.key}|${against}`;
        let p = sp.ownerBorders.get(key);
        if (p === undefined) {
          const path = sheet.blocks();
          let any = false;
          for (const q of e.take) {
            if (e.open.has(q) !== (against === 'nobody')) continue;
            for (const l of this.chainLines(sp, sheet, geom, e.b[q], e.b[q + 1])) { path.addLine(l); any = true; }
          }
          p = any ? path : null;
          sp.ownerBorders.set(key, p);
        }
        if (p) { (against === 'owner' ? plain : open).push(p); if (against === 'nobody') openBy.set(owner, p); }
      }
    }
    // 2. Around the parcels of animated changes: chain by chain.
    const inside = new Map<string, Path2D>(), outside = new Map<string, Path2D>();
    const meet = new Map<string, { a: string; b: string; paths: Array<Path2D | null> }>();
    if (inGroup.size) {
      const differs = (x: string | null, y: string | null) => (x ?? '') !== (y ?? '');
      const addTo = (m: Map<string, Path2D>, g: ChangeGroup, lines: Float32Array[]) => { if (!lines.length) return; let p = m.get(g.id); if (!p) m.set(g.id, (p = new Path2D())); for (const l of lines) addLine(p, l); };
      for (const [face, ga] of inGroup) {
        const a = states.get(face)!;
        for (const c of t.facesCycles.get(face) ?? []) {
          const cg = geom.cycle(c, t);
          for (let i = 0; i < cg.heads.length; i++) {
            const other = arr.halfEdgeFace(cg.heads[i] ^ 1);
            const gb = inGroup.get(other);
            // Between two parcels in animated changes: taken from one side only.
            if (gb && !cg.canonical[i]) continue;
            const b = states.get(other);
            if (!b) continue;
            if (gb && gb !== ga) {
              // Where two changes meet, each side shows the owner before or after its own change, as
              // far as its own front has come: a border wherever those two differ.
              const oa = [a.transition!.from, a.value], ob = [b.transition!.from, b.value];
              let mask = 0;
              for (let k = 0; k < 4; k++) if (differs(oa[k >> 1], ob[k & 1])) mask |= 1 << k;
              if (!mask) continue;
              const lines = this.chainLines(sp, sheet, geom, c, i);
              if (mask === 15) { for (const l of lines) { addLine(loose, l); anyLoose = true; } continue; }
              const mk = `${ga.id}|${gb.id}`;
              let m = meet.get(mk);
              if (!m) meet.set(mk, (m = { a: ga.id, b: gb.id, paths: [null, null, null, null] }));
              for (let k = 0; k < 4; k++) if (mask & (1 << k)) { const p = m.paths[k] ?? (m.paths[k] = new Path2D()); for (const l of lines) addLine(p, l); }
              continue;
            }
            const now = differs(a.value, b.value);
            const was = differs(a.transition!.from, gb ? b.transition!.from : b.value);
            if (!now && !was) continue;
            const lines = this.chainLines(sp, sheet, geom, c, i);
            // A border both before and after: drawn throughout.
            if (now && was) { for (const l of lines) { addLine(loose, l); anyLoose = true; } }
            else addTo(now ? inside : outside, ga, lines);
          }
        }
      }
    }
    if (anyLoose) plain.push(loose);
    bp = { plain, open, openBy, inside, outside, meet: [...meet.values()] };
    if (sp.borders.size >= 8) sp.borders.delete(sp.borders.keys().next().value!);
    sp.borders.set(snap.key, bp);
    return bp;
  }

  // ---------------------------------------------------------------- kept pictures of what does not change

  /**
   * Parts of the picture that stay the same from frame to frame are kept as pictures and copied
   * instead of drawn again: the base map (ocean, grid, land) while the view stays put, and the
   * territories and borders while nothing changes hands (scrubbing or playing between events,
   * redrawing after a click). 'lazy' (the working view): a part is kept from the second time the same
   * frame is asked for, so panning draws straight to the screen. 'always' (exports): every frame is
   * drawn through the kept pictures, so a frame's pixels never depend on the frames before it.
   */
  caching: 'lazy' | 'always' | 'off' = 'lazy';
  /**
   * The working view only (never exports): when the view moves, the parts of the picture already
   * drawn move with it and only what comes into view is drawn. A move by whole pixels gives exactly
   * the picture a fresh drawing would; anything else (a zoom, a move by part of a pixel) is allowed
   * only while `moving` is asked for, and reported in `lastApproximate`.
   */
  carry = false;
  /** Whether the last frame showed parts a fresh drawing would put slightly differently (see carry). */
  lastApproximate = false;
  /** For benchmarks and tests: how the parts of the last frame were made ('kept', 'moved', 'scaled' or 'drawn'). */
  lastParts: Record<string, string> = {};
  private moving = false;
  private holdNames = false;
  /** While only part of a frame is drawn: the device rectangles being drawn (buffers are limited to them). */
  private region: DeviceRect[] | null = null;
  /** The region is the whole frame (a kept picture with room around it is drawn in its middle). */
  private regionWhole = false;
  /**
   * For this frame, where pictures are carried and the map repeats east and west (see render): the
   * planet's north and south ends (view pixels), and its sides when they are in view.
   */
  private band: [number, number] | null = null;
  private bandCut: [number, number] | null = null;
  /** Set while a carried picture of a repeating map is being drawn: the band it is ended by (instead of the planet's outline). */
  private periodic: [number, number] | null = null;
  private kept = new Map<string, Kept>();
  /** Kept pictures are used up to this many pixels (a 4K frame); the land mask up to an 8K frame. */
  private static readonly KEEP_LIMIT = 10_000_000;
  private static readonly MASK_LIMIT = 40_000_000;

  /** Kept pictures may take this much memory together (the least recently used go first). */
  private static readonly KEEP_BYTES = 420_000_000;

  /** The buffer of a kept picture: the size of the target, and `margin` pixels more on every side. */
  private keptBuffer(name: string, target: CanvasRenderingContext2D, margin = 0): KeptOn {
    const w = target.canvas.width + 2 * margin, h = target.canvas.height + 2 * margin;
    let b = this.kept.get(name);
    if (!b) b = newKept();
    // Most recently used last.
    this.kept.delete(name);
    this.kept.set(name, b);
    if (!b.canvas || b.canvas.width !== w || b.canvas.height !== h) {
      // Room for it: pictures not used for longest give theirs up (an export of many passes keeps one or two per pass).
      let held = 0;
      for (const [k, o] of this.kept) if (k !== name && o.canvas) held += o.canvas.width * o.canvas.height * 4;
      for (const [k, o] of this.kept) {
        if (held + w * h * 4 <= MapRenderer.KEEP_BYTES) break;
        if (k === name || !o.canvas) continue;
        held -= o.canvas.width * o.canvas.height * 4;
        o.canvas = null; o.ctx = null; o.key = '';
      }
      b.canvas = new OffscreenCanvas(w, h);
      const willReadFrequently = !!target.getContextAttributes?.().willReadFrequently;
      b.ctx = b.canvas.getContext('2d', { willReadFrequently }) as unknown as CanvasRenderingContext2D;
      b.key = '';
      b.ox = b.oy = margin;
      b.valid = [0, 0, 0, 0];
    }
    return b as KeptOn;
  }

  /**
   * Room kept around the frame in a picture that is carried along as the view moves (device pixels
   * on every side; none where pictures are not carried: exports).
   */
  private marginFor(w: number, h: number): number {
    return this.carry ? Math.max(48, Math.min(192, Math.round(0.14 * Math.min(w, h)))) : 0;
  }

  /**
   * The frame moves over a kept picture by whole pixels: (nx, ny) is how far the picture moves on
   * the canvas. The picture stays where it is in its buffer, which is larger than the frame, and the
   * frame's window moves over it; what the window then lacks is drawn (`paint`, rectangles of the
   * buffer), with `lead` pixels to spare on that side, so that the frames that follow need nothing
   * drawn at all: drawing a strip costs about as much whether it is narrow or wide, since most of the
   * cost is in the number of shapes it crosses. When the window runs out of buffer, the picture is
   * moved within it, leaving the most room ahead. (It is copied, moved over, into a spare buffer that
   * then takes its place: a canvas copied onto itself is first copied whole by the browser.)
   */
  private slide(b: KeptOn, w: number, h: number, nx: number, ny: number, lead: number, paint: (rects: DeviceRect[]) => void): void {
    const W = b.canvas.width, H = b.canvas.height;
    let ox = b.ox - nx, oy = b.oy - ny;
    let v = b.valid;
    b.stamp = ++this.stamps;
    if (ox < 0 || oy < 0 || ox + w > W || oy + h > H) {
      const tx = nx > 0 ? W - w : nx < 0 ? 0 : Math.max(0, Math.min(W - w, ox));
      const ty = ny > 0 ? H - h : ny < 0 ? 0 : Math.max(0, Math.min(H - h, oy));
      const sx = tx - ox, sy = ty - oy;
      const spare = this.spareFor(b);
      const sc = spare.ctx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = 'copy';
      sc.drawImage(b.canvas as CanvasImageSource, sx, sy);
      sc.globalCompositeOperation = 'source-over';
      this.spare = { canvas: b.canvas, ctx: b.ctx };
      b.canvas = spare.canvas; b.ctx = spare.ctx;
      v = [Math.max(0, v[0] + sx), Math.max(0, v[1] + sy), Math.min(W, v[2] + sx), Math.min(H, v[3] + sy)];
      ox = tx; oy = ty;
    }
    b.ox = ox; b.oy = oy;
    b.valid = v;
    // What the picture must hold now: the window, and on the sides where it lacks something, the room ahead.
    this.extend(b, ox < v[0] ? Math.max(0, ox - lead) : ox, oy < v[1] ? Math.max(0, oy - lead) : oy,
      ox + w > v[2] ? Math.min(W, ox + w + lead) : ox + w, oy + h > v[3] ? Math.min(H, oy + h + lead) : oy + h, paint);
  }

  /** Make a kept picture hold at least the rectangle x0..x1 by y0..y1 of its buffer, besides what it holds: what is lacking is drawn (`paint`). */
  private extend(b: KeptOn, x0: number, y0: number, x1: number, y1: number, paint: (rects: DeviceRect[]) => void): void {
    let v = b.valid;
    // (Holding nothing: everything asked for is drawn.)
    if (v[2] <= v[0] || v[3] <= v[1]) v = [x0, y0, x0, y0];
    x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); x1 = Math.max(x1, v[2]); y1 = Math.max(y1, v[3]);
    if (x0 === v[0] && y0 === v[1] && x1 === v[2] && y1 === v[3]) return;
    const rects: DeviceRect[] = [];
    if (x0 < v[0]) rects.push([x0, y0, v[0] - x0, y1 - y0]);
    if (x1 > v[2]) rects.push([v[2], y0, x1 - v[2], y1 - y0]);
    if (y0 < v[1] && v[2] > v[0]) rects.push([v[0], y0, v[2] - v[0], v[1] - y0]);
    if (y1 > v[3] && v[2] > v[0]) rects.push([v[0], v[3], v[2] - v[0], y1 - v[3]]);
    paint(rects);
    b.valid = [x0, y0, x1, y1];
  }

  /** A buffer to move a kept picture into (see layered); the picture's old buffer becomes the next spare. */
  private spare: { canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D } | null = null;

  private spareFor(b: { canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D }): { canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D } {
    const w = b.canvas.width, h = b.canvas.height;
    const willReadFrequently = !!b.ctx.getContextAttributes?.().willReadFrequently;
    const sp = this.spare;
    if (sp && sp.canvas.width === w && sp.canvas.height === h && !!sp.ctx.getContextAttributes?.().willReadFrequently === willReadFrequently) return sp;
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d', { willReadFrequently }) as unknown as CanvasRenderingContext2D };
  }

  /** What the territory picture last showed: its key, what besides ownership it depends on, who held each parcel, and the map's state. */
  private patchPrev = new Map<string, { strict: string; stable: string; arr: Arrangement; revision: number; layers: Array<Map<number, FaceState>> }>();
  /** The changes that were under way in a territory picture as last drawn (see patchPrev): its key, the frame it was drawn for, and the rectangles around them there. */
  private animPrev = new Map<string, { strict: string; frame: string; rects: DeviceRect[] }>();

  /**
   * After an edit (or a step in time) that changed little: the rectangles of the canvas where the
   * territory picture changed, so that only they are drawn again (see layered). Null when the whole
   * picture must be drawn: nothing to compare with, something other than ownership or borders
   * changed, the changes cover much of the frame, or the view shows the planet more than once.
   *
   * The picture changes only (1) where borders were added, removed or moved (the kernel keeps the box
   * around those), (2) inside parcels that have a new owner, and (3) inside parcels that are new and
   * are not a piece of a parcel that had the same owner (a piece keeps its fill, and its new borders
   * lie along the borders added). A parcel that takes in the rest of the planet has no box: when one
   * is among those, everything is drawn.
   */
  private changesSince(name: string, view: View, arr: Arrangement, engine: Engine, layers: Array<Map<number, FaceState>>, strict: string, stable: string, m: DOMMatrix, width: number, height: number, pad: number): { from: string; rects: DeviceRect[] } | null {
    const prev = this.patchPrev.get(name);
    if (prev && prev.strict === strict) return null;
    let out: { from: string; rects: DeviceRect[] } | null = null;
    if (prev && prev.arr === arr && prev.stable === stable && prev.layers.length === layers.length && m.b === 0 && m.c === 0) {
      const borders = arr.bordersChangedSince(prev.revision);
      let ok = borders !== null, changed = 0;
      // Boxes as x0, y0, x1, y1; joined while joining wastes little, a handful at most.
      const boxes: number[][] = [];
      if (ok && borders) this.joinBox(boxes, view, borders, m, pad, width, height);
      if (ok) outer: for (let i = 0; i < layers.length; i++) {
        const was = prev.layers[i], now = layers[i];
        // Where the states were worked out from those of before, only the parcels worked out again can differ.
        const delta = engine.stateDelta(now);
        const faces: Iterable<number> = delta && delta.from === was ? delta.changed : now.keys();
        for (const face of faces) {
          const st = now.get(face);
          if (!st) continue;
          const b = was.get(face);
          if (b !== undefined && b.value === st.value) continue;
          if (b === undefined) {
            // A piece of a parcel that had this owner: nothing in it changed.
            let piece = false;
            for (let up = arr.faces.get(face)?.parent_id; up !== null && up !== undefined; up = arr.faces.get(up)?.parent_id) {
              const p = was.get(up);
              if (p) { piece = p.value === st.value; break; }
            }
            if (piece) continue;
          }
          if (++changed > 600 || !this.joinFace(boxes, view, arr, face, m, pad, width, height)) { ok = false; break outer; }
        }
      }
      if (ok) {
        let total = 0;
        for (const q of boxes) total += (q[2] - q[0]) * (q[3] - q[1]);
        if (total <= 0.5 * width * height) out = { from: prev.strict, rects: boxes.map((q) => [q[0], q[1], q[2] - q[0], q[3] - q[1]] as DeviceRect) };
      }
    }
    this.patchPrev.set(name, { strict, stable, arr, revision: arr.revision, layers });
    return out;
  }

  /** Limit a context to some device rectangles (the caller saves and restores around it). */
  private clipTo(c: CanvasRenderingContext2D, rects: DeviceRect[]): void {
    const t = c.getTransform();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.beginPath();
    for (const [x, y, w, h] of rects) c.rect(x, y, w, h);
    c.clip();
    c.setTransform(t);
  }

  private stamps = 0;
  /** The rectangles around the changes animating, for the view and the changes they were found for (null: too large, or not to be had). */
  private renewRects: { key: string; rects: DeviceRect[] | null } | null = null;
  /** This frame is one of many in quick succession through time (RenderOptions.hurried). */
  private hurried = false;
  /** This frame draws the room around kept pictures at rest (RenderOptions.fillAround). */
  private fillRoom = false;
  /** After a frame: a kept picture has room around the frame that is not drawn yet (the working view fills it once the view rests). */
  roomToFill = false;

  /**
   * Limit drawing to the turn of a repeating map inside the planet's sides (`cut`, view pixels; `t`:
   * the frame's transform). On an upright frame the sides are taken to the nearest whole pixel:
   * copying through a clip that falls between pixels is half as slow again, and an upright edge
   * shows no steps. (The caller saves and restores around it; the transform may be left changed.)
   */
  private cutToSides(ctx: CanvasRenderingContext2D, t: DOMMatrix, cut: [number, number]): void {
    ctx.beginPath();
    if (t.b === 0 && t.c === 0) {
      const x0 = Math.round(t.a * cut[0] + t.e), x1 = Math.round(t.a * cut[1] + t.e);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.rect(x0, 0, x1 - x0, ctx.canvas.height);
    } else ctx.rect(cut[0], -1e6, cut[1] - cut[0], 2e6);
    ctx.clip();
  }

  /**
   * While zooming: would this part be shown through its kept picture at another size (as layered
   * does)? Then the picture, and how it lies on the frame: its pixel p belongs at r * p + (tx, ty).
   */
  private zoomed(name: string, ctx: CanvasRenderingContext2D, key: PartKey | null, at: Placing, patch: { from: string; rects: DeviceRect[] } | null, renew: Renew | null): { b: KeptOn; r: number; tx: number; ty: number } | null {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (key === null || this.caching === 'off' || !this.carry || !this.moving || w * h > MapRenderer.KEEP_LIMIT) return null;
    const b = this.kept.get(name), M = this.marginFor(w, h);
    if (!b || !b.canvas || !b.ctx || !b.key || !b.at || b.canvas.width !== w + 2 * M || b.canvas.height !== h + 2 * M) return null;
    if (b.key === exactKey(key.strict, w, h, at) || (patch && b.key === exactKey(patch.from, w, h, at))) return null;
    const o = b.at;
    if (b.loose !== key.loose || o.a !== at.a || o.b !== at.b || o.c !== at.c || o.d !== at.d) return null;
    const r = at.s / o.s;
    if (Math.abs(r - 1) < 1e-9 || r < 0.75 || r > 1.7 || (renew && b.moment !== renew.moment)) return null;
    return { b: b as KeptOn, r, tx: at.x - r * o.x, ty: at.y - r * o.y };
  }

  /**
   * While zooming, the parts of the picture that are shown through their kept pictures at another
   * size are shown through one: the kept pictures are laid together once (for as long as they stay
   * as they are), and that one picture is drawn at the new size in each frame. Drawing a picture at
   * another size is by far the dearest way of copying it (about seven times a plain copy), and each
   * part used to be drawn so by itself. What lies around the picture is drawn part by part, as
   * layered does. False (and nothing drawn) when the parts do not lie alike on the frame.
   */
  private zoomTogether(ctx: CanvasRenderingContext2D, opening: boolean, parts: Array<{ name: string; z: { b: KeptOn; r: number; tx: number; ty: number }; draw: (c: CanvasRenderingContext2D) => void }>): boolean {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const { r, tx, ty } = parts[0].z;
    if (parts.some((p) => Math.abs(p.z.r - r) > 1e-9 || Math.abs(p.z.tx - tx) > 1e-6 || Math.abs(p.z.ty - ty) > 1e-6)) return false;
    // What every part holds, around the frame too (frame pixels: the frame is 0..w by 0..h), less a
    // pixel that smoothing would mix with what lies beyond.
    const M = (parts[0].z.b.canvas.width - w) / 2, e = M ? 1 : 0;
    let vx0 = -M, vy0 = -M, vx1 = w + M, vy1 = h + M;
    for (const { z: { b } } of parts) {
      vx0 = Math.max(vx0, b.valid[0] - b.ox); vy0 = Math.max(vy0, b.valid[1] - b.oy);
      vx1 = Math.min(vx1, b.valid[2] - b.ox); vy1 = Math.min(vy1, b.valid[3] - b.oy);
    }
    const x0 = Math.max(0, Math.ceil(tx + r * (vx0 + e))), y0 = Math.max(0, Math.ceil(ty + r * (vy0 + e)));
    const x1 = Math.min(w, Math.floor(tx + r * (vx1 - e))), y1 = Math.min(h, Math.floor(ty + r * (vy1 - e)));
    if (!(x1 > x0 && y1 > y0)) return false;
    // The parts laid together, the frame's corner at (M, M) of the buffer.
    const both = this.keptBuffer('zoom', ctx, M);
    const what = parts.map((p) => `${p.name}:${p.z.b.stamp}`).join('|');
    if (both.key !== what) {
      const zc = both.ctx;
      zc.setTransform(1, 0, 0, 1, 0, 0);
      zc.globalAlpha = 1;
      parts.forEach((p, i) => { zc.globalCompositeOperation = i ? 'source-over' : 'copy'; zc.drawImage(p.z.b.canvas as CanvasImageSource, M - p.z.b.ox, M - p.z.b.oy); });
      zc.globalCompositeOperation = 'source-over';
      both.key = what;
    }
    const t = ctx.getTransform();
    ctx.save();
    if (opening) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); ctx.setTransform(t); }
    if (this.bandCut) this.cutToSides(ctx, t, this.bandCut);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(r, 0, 0, r, tx, ty);
    ctx.drawImage(both.canvas as CanvasImageSource, -M, -M);
    ctx.restore();
    const rects = ([[0, 0, w, y0], [0, y1, w, h - y1], [0, y0, x0, y1 - y0], [x1, y0, w - x1, y1 - y0]] as DeviceRect[]).filter((q) => q[2] > 0 && q[3] > 0);
    for (const p of parts) {
      if (rects.length) {
        ctx.save();
        this.clipTo(ctx, rects);
        this.region = rects; setPaintRegion(rects);
        try { p.draw(ctx); } finally { this.region = null; setPaintRegion(null); }
        ctx.restore();
      }
      this.lastParts[p.name] = 'scaled';
    }
    this.lastApproximate = true;
    return true;
  }

  /**
   * Draw a part of the picture, through its kept picture when it may be kept (`key` says what it
   * shows; null: never kept; `at`: where the map lies on the canvas in this frame).
   */
  private layered(name: string, ctx: CanvasRenderingContext2D, key: PartKey | null, at: Placing, draw: (c: CanvasRenderingContext2D) => void, patch: { from: string; rects: DeviceRect[] } | null = null, renew: Renew | null = null, opening = false): void {
    const mode = this.caching;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const usable = key !== null && mode !== 'off' && w * h <= MapRenderer.KEEP_LIMIT;
    let rec = this.kept.get(name);
    if (!rec) this.kept.set(name, (rec = newKept()));
    const exactOf = (strict: string) => exactKey(strict, w, h, at);
    const exact = key ? exactOf(key.strict) : '';
    // `opening`: this part is the first thing drawn in a frame that fills the canvas, and the canvas
    // still shows the frame before. Its kept picture then replaces everything in one copy; drawn
    // straight onto the canvas, the canvas is cleared first.
    const wipe = () => {
      if (!opening) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.restore();
    };
    if (!usable || (mode === 'lazy' && !this.carry && rec.seen !== exact)) {
      rec.seen = exact;
      this.lastParts[name] = 'drawn';
      wipe();
      draw(ctx);
      return;
    }
    // While pictures are carried along, a kept picture has room around the frame (see slide).
    const M = this.marginFor(w, h);
    const b = this.keptBuffer(name, ctx, M);
    const t = ctx.getTransform();
    // A carried picture of a repeating map: only the turn inside the planet's sides is shown.
    const cut = M ? this.bandCut : null;
    const cutSides = () => { if (cut) this.cutToSides(ctx, t, cut); };
    const blit = () => {
      if (cut) wipe();
      ctx.save();
      cutSides();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (opening && !cut) ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(b.canvas as CanvasImageSource, -b.ox, -b.oy);
      ctx.restore();
    };
    const windowOf = (): [number, number, number, number] => [b.ox, b.oy, b.ox + w, b.oy + h];
    /** Rectangles of the frame as rectangles of the buffer. */
    const inBuffer = (rects: DeviceRect[]) => rects.map(([x, y, rw, rh]) => [x + b.ox, y + b.oy, rw, rh] as DeviceRect);
    /**
     * Draw again what lies in some rectangles of the buffer. (dx, dy): how far the kept picture
     * stands from the view asked for (at most half a pixel); `whole`: the rectangle is the frame.
     */
    const paint = (rects: DeviceRect[], dx: number, dy: number, whole = false) => {
      const bc = b.ctx;
      bc.save();
      bc.setTransform(1, 0, 0, 1, 0, 0);
      bc.globalAlpha = 1;
      bc.globalCompositeOperation = 'source-over';
      for (const [x, y, rw, rh] of rects) bc.clearRect(x, y, rw, rh);
      b.stamp = ++this.stamps;
      if (rects.length) {
        this.clipTo(bc, rects);
        bc.setTransform(t.a, t.b, t.c, t.d, t.e - dx + b.ox, t.f - dy + b.oy);
        this.region = rects; this.regionWhole = whole; setPaintRegion(rects);
        this.periodic = M ? this.band : null;
        try { draw(bc); } finally { this.region = null; this.regionWhole = false; this.periodic = null; setPaintRegion(null); }
      }
      bc.restore();
    };
    // Where a change is animating, the kept picture is right everywhere else: only that is drawn again for a new moment.
    const again = (dx: number, dy: number): boolean => {
      if (!renew || b.moment === renew.moment) return false;
      paint(inBuffer(renew.rects), dx, dy);
      // (Only what is in the frame was drawn again: the room around it no longer counts.)
      b.valid = windowOf();
      b.moment = renew.moment;
      return true;
    };
    // The room around the frame that a picture at rest should hold (see RenderOptions.fillAround): a margin's width on every side.
    const room = (): [number, number, number, number] => [Math.max(0, b.ox - M), Math.max(0, b.oy - M), Math.min(b.canvas.width, b.ox + w + M), Math.min(b.canvas.height, b.oy + h + M)];
    // (A picture that is drawn again for every moment of an animation gets nothing drawn ahead or around it; one that stays at its moment while the view moves does.)
    const playing = !!renew && b.moment !== renew.moment;
    const noteRoom = () => { if (M && !playing) { const q = room(), v = b.valid; if (v[0] > q[0] || v[1] > q[1] || v[2] < q[2] || v[3] < q[3]) this.roomToFill = true; } };
    if (b.key === exact) {
      this.lastParts[name] = again(0, 0) ? 'renewed' : 'kept';
      if (this.fillRoom && M && !playing) { const q = room(); this.extend(b, q[0], q[1], q[2], q[3], (rects) => paint(rects, 0, 0)); }
      noteRoom();
      blit();
      return;
    }
    if (patch && (this.carry || mode === 'always') && b.key === exactOf(patch.from)) {
      // Patched: the kept picture shows the state before a change that touched only these rectangles; they alone are drawn again.
      paint(inBuffer(patch.rects), 0, 0);
      b.valid = windowOf();
      b.key = exact; b.strict = key!.strict; b.loose = key!.loose;
      b.moment = renew ? renew.moment : '';
      this.lastParts[name] = 'patched';
      noteRoom();
      blit();
      return;
    }
    const o = b.at;
    if (this.carry && b.key && o && b.loose === key!.loose && o.a === at.a && o.b === at.b && o.c === at.c && o.d === at.d) {
      // The kept picture's pixel p now belongs at r * p + (tx, ty).
      const r = at.s / o.s, tx = at.x - r * o.x, ty = at.y - r * o.y;
      if (Math.abs(r - 1) < 1e-9 && b.strict === key!.strict) {
        const nx = Math.round(tx), ny = Math.round(ty), rx = tx - nx, ry = ty - ny;
        const whole = Math.abs(rx) < 0.02 && Math.abs(ry) < 0.02;
        if ((whole || this.moving) && Math.abs(nx) < w * 0.9 && Math.abs(ny) < h * 0.9) {
          // Moved: the frame's window moves over the kept picture by whole pixels, and what it lacks is drawn
          // (where the kept picture stands: at most half a pixel from the view asked for). While a change
          // animates the picture changes in every frame, so nothing is drawn ahead.
          if (nx || ny) this.slide(b, w, h, nx, ny, playing ? 0 : M, (rects) => paint(rects, rx, ry));
          b.at = { ...at, x: at.x - rx, y: at.y - ry };
          b.key = whole ? exact : 'moved';
          if (!whole) this.lastApproximate = true;
          again(rx, ry);
          this.lastParts[name] = 'moved';
          noteRoom();
          blit();
          return;
        }
      } else if (this.moving && Math.abs(r - 1) >= 1e-9 && r >= 0.75 && r <= 1.7 && !(renew && b.moment !== renew.moment)) {
        // Scaled (a zoom under way): the kept picture is shown at the new size, with what it holds around
        // the frame (less a pixel, which smoothing would mix with what lies beyond), and the rest is drawn.
        const v = b.valid, e = M ? 1 : 0;
        const x0 = Math.max(0, Math.ceil(tx + r * (v[0] + e - b.ox))), y0 = Math.max(0, Math.ceil(ty + r * (v[1] + e - b.oy)));
        const x1 = Math.min(w, Math.floor(tx + r * (v[2] - e - b.ox))), y1 = Math.min(h, Math.floor(ty + r * (v[3] - e - b.oy)));
        if (x1 > x0 && y1 > y0) {
          wipe();
          ctx.save();
          cutSides();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.beginPath();
          ctx.rect(x0, y0, x1 - x0, y1 - y0);
          ctx.clip();
          ctx.imageSmoothingEnabled = true;
          ctx.setTransform(r, 0, 0, r, tx, ty);
          ctx.drawImage(b.canvas as CanvasImageSource, -b.ox, -b.oy);
          ctx.restore();
          const rects = ([[0, 0, w, y0], [0, y1, w, h - y1], [0, y0, x0, y1 - y0], [x1, y0, w - x1, y1 - y0]] as DeviceRect[]).filter((q) => q[2] > 0 && q[3] > 0);
          if (rects.length) {
            ctx.save();
            this.clipTo(ctx, rects);
            this.region = rects; setPaintRegion(rects);
            try { draw(ctx); } finally { this.region = null; setPaintRegion(null); }
            ctx.restore();
          }
          this.lastApproximate = true;
          this.lastParts[name] = 'scaled';
          return;
        }
      }
    }
    let drawnTo: [number, number, number, number] | null = null;
    if (M) {
      // Drawn afresh, in the middle of the buffer: the frame alone (the room around it fills as the
      // view moves, or once it rests). While zooming out, the room around it is drawn at once: the
      // frames that follow show this picture smaller, and would each draw what lies around it.
      b.ox = b.oy = M;
      drawnTo = this.zoomOut && !playing ? room() : [M, M, M + w, M + h];
      paint([[drawnTo[0], drawnTo[1], drawnTo[2] - drawnTo[0], drawnTo[3] - drawnTo[1]]], 0, 0, true);
    } else {
      b.ctx.setTransform(1, 0, 0, 1, 0, 0);
      b.ctx.globalAlpha = 1;
      b.ctx.globalCompositeOperation = 'source-over';
      b.ctx.clearRect(0, 0, b.canvas.width, b.canvas.height);
      b.ctx.setTransform(t);
      b.ctx.save();
      draw(b.ctx);
      b.ctx.restore();
      b.ox = b.oy = 0;
      b.stamp = ++this.stamps;
    }
    b.valid = drawnTo ?? windowOf();
    b.key = exact;
    b.strict = key!.strict; b.loose = key!.loose; b.at = at;
    b.moment = renew ? renew.moment : '';
    this.lastParts[name] = 'drawn';
    noteRoom();
    blit();
  }

  /**
   * Keep only what lies on land in a buffer (coastline clipping). The land is painted once per view
   * into a mask that every layer's fills and borders then use, instead of each tracing the coast.
   */
  /**
   * The band along the coastline (D83), `width` pixels wide, in the target's pixels: kept from frame to
   * frame while the view stays (a brush stroke redraws territory, not the coast). Drawn afresh where only
   * part of the frame is being drawn and none is kept yet.
   */
  private coastBand(target: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, frameKey: string, width: number): CanvasImageSource {
    const t = target.getTransform();
    const draw = (c: CanvasRenderingContext2D) => { c.setTransform(t); this.basemapPainter.strokeCoastline(c, view, sheet, basemap, width); };
    if (this.caching === 'off' || target.canvas.width * target.canvas.height > MapRenderer.MASK_LIMIT) {
      const sc = this.scratch(target);
      draw(sc);
      return sc.canvas as CanvasImageSource;
    }
    const b = this.keptBuffer('coastband', target);
    const key = `${frameKey}|${sheet.id}|${basemap.scales.length}|${t.e},${t.f}|${width.toFixed(2)}`;
    if (b.key !== key) {
      b.ctx!.setTransform(1, 0, 0, 1, 0, 0);
      b.ctx!.clearRect(0, 0, b.canvas!.width, b.canvas!.height);
      // (The whole band, even when only part of the frame is being drawn: it is kept for the rest.)
      draw(b.ctx!);
      b.key = key;
    }
    return b.canvas as CanvasImageSource;
  }

  /**
   * The sea of the moment for a picture of the terrain on a canvas (D96): its level and, where Natural
   * Earth's coastline is drawn, a picture of the land it encloses on that canvas (kept while the view
   * stays put).
   */
  private seaOf(c: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap | null, level: number, at?: DOMMatrix, close = false): TerrainSea {
    if (!basemap) return { level, mask: null, maskKey: '' };
    const m = at ?? c.getTransform();
    const key = `${c.canvas.width}x${c.canvas.height}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}|${sheet.id}|${view.key}|${basemap.scales.length}`;
    let k = this.coastMasks;
    if (!k || k.canvas.width !== c.canvas.width || k.canvas.height !== c.canvas.height) {
      const canvas = new OffscreenCanvas(c.canvas.width, c.canvas.height);
      k = this.coastMasks = { canvas, ctx: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, key: '' };
    }
    if (k.key !== key) {
      k.ctx.setTransform(1, 0, 0, 1, 0, 0);
      k.ctx.clearRect(0, 0, k.canvas.width, k.canvas.height);
      k.ctx.setTransform(m);
      this.basemapPainter.fillLand(k.ctx, view, sheet, basemap);
      k.key = key;
    }
    return { level, mask: k.canvas, maskKey: key, close };
  }
  private coastMasks: { canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D; key: string } | null = null;

  /**
   * Ends what a buffer holds at the coast: Natural Earth's at today's sea level; at another level
   * (`terrain` given, D96), the terrain's coast of the moment.
   */
  private trimToLand(lc: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap | null, frameKey: string, lakes: boolean, terrain: TerrainShown | null, seaLevel: number, at: DOMMatrix): void {
    if (!terrain) { if (basemap) this.maskLand(lc, view, sheet, basemap, frameKey, lakes); return; }
    lc.save();
    lc.globalCompositeOperation = 'destination-in';
    this.layTerrain(lc, view, sheet, terrain, 'landmask', at, this.seaOf(lc, view, sheet, basemap, seaLevel, at, closeCoastOf(terrain, basemap, seaLevel)));
    lc.restore();
    if (lakes && basemap) this.basemapPainter.eraseLakes(lc, view, sheet, basemap);
  }

  /**
   * Lays a picture of the terrain (D95) on a canvas, made for where the canvas shows the sheet (`at`:
   * the frame's transform on it, when the canvas's own has changed since).
   */
  private layTerrain(c: CanvasRenderingContext2D, view: View, sheet: Sheet, terrain: TerrainShown, kind: TerrainImageKind, at?: DOMMatrix, sea?: TerrainSea): void {
    const [k, e, f] = sheet.placement(view);
    const m = (at ?? c.getTransform()).multiply(new DOMMatrix([k, 0, 0, k, e, f]));
    const frame: TerrainFrame = { kind: sheet.kind, S: sheet.S, ox: sheet.ox, oy: sheet.oy, lonRef: sheet.lonRef, m, width: c.canvas.width, height: c.canvas.height };
    // Only part of the picture being drawn again: only that part of the terrain is made.
    let part: [number, number, number, number] | undefined;
    if (this.region && !this.regionWhole && this.region.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y, w, h] of this.region) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
      part = [x0, y0, x1 - x0, y1 - y0];
    }
    const look = terrain.look ?? DEFAULT_TERRAIN_LOOK;
    // (The sea's picture takes the cover too where the Earth is drawn as photographed, D138: its sea is the photograph's.)
    const coverOf = PALETTES[look.palette].cover ? terrain.cover ?? null : null;
    const cover = kind === 'land' || kind === 'both' || (kind === 'sea' && look.photo && coverOf?.photo) ? coverOf : null;
    const out = this.terrainPictures.image(terrain.grid, terrain.key, look, kind, frame, part, sea, terrain.override ?? null, cover, kind === 'override' ? null : terrain.detail ?? null, cover ? terrain.photo ?? null : null);
    if (!out) return;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(out.image, out.x, out.y);
    c.restore();
  }

  private maskLand(lc: CanvasRenderingContext2D, view: View, sheet: Sheet, basemap: Basemap, frameKey: string, lakes: boolean): void {
    const direct = () => this.basemapPainter.maskToLand(lc, view, sheet, basemap, lakes);
    if (this.caching === 'off' || lc.canvas.width * lc.canvas.height > MapRenderer.MASK_LIMIT) { direct(); return; }
    const b = this.keptBuffer('mask', lc);
    const lt = lc.getTransform();
    const key = `${frameKey}|${sheet.id}|${basemap.scales.length}|${lt.e},${lt.f}`;
    const part = this.region && !this.regionWhole ? this.region : null;
    if (b.key !== key) {
      // Only part of the frame is being drawn and there is no mask of this view yet: trimmed there directly.
      if (part) { direct(); return; }
      b.ctx.setTransform(1, 0, 0, 1, 0, 0);
      b.ctx.clearRect(0, 0, b.canvas.width, b.canvas.height);
      b.ctx.setTransform(lt);
      this.basemapPainter.fillLand(b.ctx, view, sheet, basemap);
      b.key = key;
      // (The mask holds the land where drawing was going on: the frame, or the whole buffer.)
      const q = this.region?.[0];
      b.valid = q ? [q[0], q[1], q[0] + q[2], q[1] + q[3]] : [0, 0, b.canvas.width, b.canvas.height];
    } else if (part && !part.every(([x, y, rw, rh]) => x >= b.valid[0] && y >= b.valid[1] && x + rw <= b.valid[2] && y + rh <= b.valid[3])) { direct(); return; }
    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(b.canvas as CanvasImageSource, 0, 0);
    lc.restore();
    if (lakes) this.basemapPainter.eraseLakes(lc, view, sheet, basemap);
  }

  /**
   * For SVG frames (D115), where territory ending at the coast is kept, as pictures of the frame
   * (white where kept): the land with its lakes cut out (for fills) and with them (for borders); and,
   * where the coastline runs through the view, the band along it in which land takes the look of the
   * territory beside it (D83), and the frame without that band. `coast` says which case the view is
   * ('terrain': the terrain decides the coast). Null where nothing ends at a coast.
   */
  svgMasks(view: View, spaceId: string, opts: RenderOptions): { fills: OffscreenCanvas; borders: OffscreenCanvas; band: OffscreenCanvas | null; outsideBand: OffscreenCanvas | null; rim: number; coast: 'land' | 'sea' | 'mixed' | 'terrain' } | null {
    const terrain = opts.terrain && view.camera.projection !== 'flat' && terrainDrawable() ? opts.terrain : null;
    const seaLevel = terrain ? Math.round((terrain.seaLevel ?? 0) * 100) / 100 : 0;
    const terrainLand = !!terrain && (seaLevel !== 0 || !opts.basemap || !!terrain.override || closeCoastOf(terrain, opts.basemap, seaLevel));
    if (!opts.basemap && !terrainLand) return null;
    const sheet = this.sheetFor(view, spaceId);
    this.basemapPainter.lakeFilter = { show: opts.show?.lakes !== false, minKm2: Math.max(0, opts.show?.minLakeKm2 ?? 0) };
    this.region = null;
    const coast = terrainLand ? 'terrain' as const : this.basemapPainter.pathsFor(view, sheet, opts.basemap!).coast;
    const frame = (fill: boolean) => {
      const c = new OffscreenCanvas(view.width, view.height);
      const g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
      if (fill) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, view.width, view.height); }
      if (view.rotation) {
        g.translate(view.width / 2, view.height / 2);
        g.rotate((view.rotation * Math.PI) / 180);
        g.translate(-view.width / 2, -view.height / 2);
      }
      return { c, g };
    };
    const land = (lakes: boolean) => {
      const { c, g } = frame(true);
      const was = this.caching;
      this.caching = 'off';
      try { this.trimToLand(g, view, sheet, opts.basemap ?? null, '', lakes, terrainLand ? terrain : null, seaLevel, g.getTransform()); } finally { this.caching = was; }
      return c;
    };
    let band: OffscreenCanvas | null = null, outsideBand: OffscreenCanvas | null = null;
    const rim = coastRim(view);
    if (coast === 'mixed') {
      const b = frame(false);
      this.basemapPainter.strokeCoastline(b.g, view, sheet, opts.basemap!, 2 * rim);
      // (Stroked in black: made white, for a mask.)
      b.g.setTransform(1, 0, 0, 1, 0, 0);
      b.g.globalCompositeOperation = 'source-in';
      b.g.fillStyle = '#ffffff';
      b.g.fillRect(0, 0, view.width, view.height);
      band = b.c;
      const o = frame(true);
      o.g.setTransform(1, 0, 0, 1, 0, 0);
      o.g.globalCompositeOperation = 'destination-out';
      o.g.drawImage(band, 0, 0);
      outsideBand = o.c;
    }
    return { fills: land(true), borders: land(false), band, outsideBand, rim, coast };
  }

  // ---------------------------------------------------------------- a frame

  render(ctx: CanvasRenderingContext2D, view: View, world: World, engine: Engine, spaceId: string, t: Instant, opts: RenderOptions): void {
    if (view.camera.projection === 'globe') { this.renderGlobe(ctx, view, world, engine, spaceId, t, opts); return; }
    const style = opts.style ?? DEFAULT_STYLE;
    const arr = world.arrangement(spaceId);
    const u = view.unit;
    this.frameUnit = u;
    // Carried pictures hold some of the map around the frame (see slide): the sheet must reach that
    // far, and the planet's outline counts as in view when it lies there.
    const m00 = ctx.getTransform();
    const keepPad = this.caching !== 'off' && this.carry ? (this.marginFor(ctx.canvas.width, ctx.canvas.height) + 2) / (Math.hypot(m00.a, m00.b) || 1) : 0;
    this.moving = !!opts.moving;
    // While the view is on the move (zooming in), the geometry prepared for the zoom it started from
    // serves on to twice as far as it stays sharp: preparing it again every half level of zoom, in
    // the middle of the movement, for a picture that is shown enlarged from the one before anyway,
    // is what made zooming in stutter on large maps. The frame counts as approximate, so the view
    // is drawn from geometry prepared for its own zoom once it rests.
    const sheet = this.sheetFor(view, spaceId, keepPad, this.moving ? MOVING_UP_TO : SHARP_UP_TO);
    const sp = this.parcelsOn(sheet, arr);
    this.holdNames = !!opts.holdNames;
    this.lastApproximate = view.projection.scale() / sheet.S > SHARP_UP_TO + 1e-9;
    this.lastParts = {};
    this.scratchReset();
    this.hurried = !!opts.hurried;
    this.fillRoom = !!opts.fillAround && !opts.moving;
    this.roomToFill = false;
    const scaleNow = view.projection.scale();
    this.zooming = this.moving && this.lastScale > 0 && Math.abs(scaleNow / this.lastScale - 1) > 1e-9;
    this.zoomOut = this.zooming && scaleNow < this.lastScale;
    this.lastScale = scaleNow;
    ctx.save();
    // ---- The base map: ocean, grid and land. The same picture for as long as the view stays put.
    const wantsBackground = opts.passes.has('background') && !opts.transparent;
    const wantsLand = opts.passes.has('land') && !!opts.basemap;
    // Terrain (D95): on round maps, where the graphics card can draw it.
    const terrain = opts.terrain && view.camera.projection !== 'flat' && terrainDrawable() ? opts.terrain : null;
    const tLook = terrain?.look ?? null;
    const terrainColours = !!tLook?.colours, wantsTerrain = terrainColours && opts.passes.has('terrain');
    // The sea of the moment (D96): another level than today's moves the coasts off Natural Earth's.
    const seaLevel = terrain ? Math.round((terrain.seaLevel ?? 0) * 100) / 100 : 0, shifted = seaLevel !== 0;
    // Where the terrain decides what is land: at another sea level than today's, and on a world without
    // Natural Earth's coastline (a generated planet, D97).
    // Close in on the Earth's finer heights (D176), the terrain decides too: they are finer than the coastline.
    const closeCoast = closeCoastOf(terrain, opts.basemap, seaLevel);
    const terrainLand = !!terrain && (shifted || !opts.basemap || !!terrain.override || closeCoast);
    // The Earth drawn as photographed (D138): the satellite look with its photographs, at today's sea level.
    const photographed = terrainColours && !shifted && !!tLook?.photo && !!PALETTES[tLook.palette].cover && !!terrain?.cover?.photo;
    // The plain land the terrain decides (without terrain colours), in the land pass.
    const landByTerrain = terrainLand && !terrainColours && opts.passes.has('land');
    // Relief without colours lies over the plain land (in the land pass); with colours it is part of them.
    const reliefOnLand = !!tLook && !terrainColours && tLook.relief && (wantsLand || landByTerrain);
    // A planet's own rivers (D99), in the land pass.
    const planetRivers = !opts.basemap && !!terrain?.rivers && opts.passes.has('land') && opts.show?.rivers !== false;
    const wantsBase = wantsBackground || opts.passes.has('graticule') || wantsLand || wantsTerrain || landByTerrain || planetRivers;
    this.lastTerrain = { colours: wantsTerrain, relief: reliefOnLand, overTerritories: !!tLook?.overTerritories && opts.passes.has('fills'), seaLevel, cover: wantsTerrain && !!terrain?.cover && !!PALETTES[tLook!.palette].cover, detail: terrain?.detail?.key ?? '', photo: wantsTerrain && !!tLook?.photo && !!PALETTES[tLook.palette].cover && terrain?.cover?.photo ? terrain.photo?.key ?? 'world' : '' };
    // Where the frame fills the canvas and starts with the base map, the base map's kept picture
    // replaces what the canvas showed in one copy (see layered); otherwise the frame's area is cleared.
    const m0 = ctx.getTransform();
    const opens = wantsBase && m0.b === 0 && m0.c === 0 && Math.abs(m0.e) < 0.5 && Math.abs(m0.f) < 0.5
      && Math.abs(m0.a * view.width - ctx.canvas.width) < 1 && Math.abs(m0.d * view.height - ctx.canvas.height) < 1;
    if (!opens) ctx.clearRect(0, 0, view.width, view.height);
    if (view.rotation) {
      ctx.translate(view.width / 2, view.height / 2);
      ctx.rotate((view.rotation * Math.PI) / 180);
      ctx.translate(-view.width / 2, -view.height / 2);
    }
    // What this frame is drawn on: the view, the size of the canvas and where the frame sits on it.
    const m = ctx.getTransform();
    // Which lakes are shown (and cut out of territory ending at the coast): part of everything kept of this frame.
    this.basemapPainter.lakeFilter = { show: opts.show?.lakes !== false, minKm2: Math.max(0, opts.show?.minLakeKm2 ?? 0) };
    const lakeKey = `${opts.show?.lakes === false ? 'nolakes' : `l${Math.max(0, opts.show?.minLakeKm2 ?? 0)}`}`;
    const frameKey = `${view.key}|${ctx.canvas.width}x${ctx.canvas.height}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}|${spaceId}|${lakeKey}`;
    // Where the map's plane lies on the canvas, and what a part of the picture depends on besides its
    // own content: the frame's size and the kind of map (loosely), and the detail it is drawn at (strictly).
    const [pk, pe, pf] = this.place, px = pe - pk * sheet.S * sheet.ox, py = pf - pk * sheet.S * sheet.oy;
    const at: Placing = { a: m.a, b: m.b, c: m.c, d: m.d, x: m.a * px + m.c * py + m.e, y: m.b * px + m.d * py + m.f, s: pk * sheet.S };
    const looseBase = `${spaceId}|${sheet.kind}|${sheet.lonRef}|${view.width}x${view.height}|${u}`;
    const detail = `${sheet.S}|${sheet.tolerance}|${opts.basemap ? chooseScale(opts.basemap, view).scale : ''}`;
    const partKey = (content: string, more = ''): PartKey => ({ loose: `${looseBase}|${content}`, strict: `${looseBase}|${content}|${detail}|${more}` });
    const sphere = new Path2D(geoPath(view.projection)({ type: 'Sphere' }) ?? '');
    // A map with upright meridians (equirectangular, Mercator) repeats east and west, and the planet's
    // outline, whose sides move with the view, shows one turn of it. A picture that is carried along
    // holds the repeating map, ended north and south where the planet ends: that stays right however
    // far the view moves east or west. The outline's sides are cut when the picture is laid on the
    // canvas, where they are in view (see layered). What is drawn straight onto the canvas, and
    // every export, is cut by the outline itself.
    this.band = null; this.bandCut = null;
    if (this.carry && this.caching !== 'off' && isCylindrical(view.camera.projection)) {
      const [[bx0, by0], [bx1, by1]] = geoPath(view.projection).bounds({ type: 'Sphere' });
      if (bx1 > bx0 && by1 > by0) {
        this.band = [by0, by1];
        const reach = (view.rotation ? Math.hypot(view.width, view.height) : view.width) / 2 + 1;
        if (bx0 > view.width / 2 - reach || bx1 < view.width / 2 + reach) this.bandCut = [bx0, bx1];
      }
    }
    // Prepared geometry runs on past the planet's outline (a ring is drawn again a turn east or
    // west where that copy shows): where the outline is in view, it clips everything on the map.
    const clipSphere = outlineInView(view, this.band ? 0 : keepPad);
    /** Clip to the planet: its outline, or in a carried picture of a repeating map the band between its north and south ends. */
    const clipPlanet = (c: CanvasRenderingContext2D) => {
      const band = this.periodic;
      if (band) { c.beginPath(); c.rect(-1e6, band[0], 2e6, band[1] - band[0]); c.clip(); }
      else if (clipSphere) c.clip(sphere);
    };

    const space = world.get('map_space', spaceId);
    // (The base map is drawn first, but only once the territories are known: while zooming, the two are shown through one picture, see zoomTogether.)
    let base: { name: string; key: PartKey; draw: (c: CanvasRenderingContext2D) => void } | null = null;
    if (wantsBase) {
      // (A flat map's grid changes its spacing with the zoom.)
      const gridStep = opts.passes.has('graticule') && view.camera.projection === 'flat' && space?.radius_m ? Math.floor(Math.log10(view.width / view.projection.scale()) * 3) : 0;
      const terrainKey = terrain && (wantsTerrain || landByTerrain || planetRivers || (wantsLand && (terrainColours || reliefOnLand || shifted))) ? `|t:${terrain.key}|${JSON.stringify(tLook)}|${wantsTerrain ? 'c' : ''}|${landByTerrain ? 'l' : ''}|${planetRivers ? 'r' : ''}|${seaLevel}|${terrain.cover?.key ?? ''}|${terrain.detail?.key ?? ''}|${terrain.cover?.photo?.key ?? ''}|${terrain.photo?.key ?? ''}` : '';
      const landStyle = opts.basemapStyle ?? DEFAULT_BASEMAP_STYLE;
      const baseKey = partKey(`${wantsBackground ? style.ocean : ''}|${opts.passes.has('graticule') ? style.graticule : ''}|${wantsLand ? `${opts.basemap!.scales.length}${opts.referenceBorders ? 'r' : ''}|${lakeKey}|${opts.show?.coastline === false ? 'nocoast' : ''}|${opts.show?.rivers === false ? 'norivers' : ''}` : ''}|${landByTerrain || wantsLand ? `${landStyle.land}|${landStyle.coast}|${landStyle.lake}` : ''}|${space?.radius_m ?? 0}${terrainKey}`, `${gridStep}`);
      // (One kept picture per combination of parts: an export draws several passes of each frame.)
      base = { name: `base:${wantsBackground ? 'o' : ''}${wantsTerrain ? 't' : ''}${opts.passes.has('graticule') ? 'g' : ''}${wantsLand ? 'l' : ''}`, key: baseKey, draw: (c) => {
        if (wantsBackground) {
          c.fillStyle = style.ocean;
          const band = this.periodic;
          if (band) c.fillRect(-1e6, band[0], 2e6, band[1] - band[0]); else c.fill(sphere);
        }
        c.save();
        clipPlanet(c);
        if (wantsTerrain && terrainLand) {
          // The coasts of the moment (D96), or of a world without a coastline drawn: the terrain's.
          this.layTerrain(c, view, sheet, terrain!, 'both', undefined, this.seaOf(c, view, sheet, opts.basemap ?? null, seaLevel, undefined, closeCoast));
        } else if (wantsTerrain) {
          // The sea's colours over the whole planet, then the land's inside the coastline (lakes keep
          // the sea's).
          this.layTerrain(c, view, sheet, terrain!, 'sea');
          const lc = this.scratch(c);
          this.layTerrain(lc, view, sheet, terrain!, 'land');
          this.maskLand(lc, view, sheet, opts.basemap!, frameKey, true);
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.drawImage(lc.canvas as CanvasImageSource, 0, 0);
          c.restore();
        }
        if (opts.passes.has('graticule')) {
          c.strokeStyle = style.graticule;
          let key = 'graticule', lines: Ring[] | null = null;
          if (view.camera.projection === 'flat' && space?.radius_m) {
            // A flat map: a grid in round kilometres or metres, about eight lines across the view.
            const kmPerRad = space.radius_m / 1000, viewKm = (view.width / view.projection.scale()) * kmPerRad;
            const raw = viewKm / 8, mag = Math.pow(10, Math.floor(Math.log10(raw)));
            const stepKm = [1, 2, 5, 10].map((k) => k * mag).find((k) => k >= raw) ?? 10 * mag;
            const stepDeg = (stepKm / kmPerRad) * (180 / Math.PI), ext = FLAT_EXTENT_DEG * 1.6;
            key = `graticule:${stepDeg}`;
            if (!sheet.cache.has(key)) {
              lines = [];
              const n = Math.floor(ext / stepDeg);
              for (let i = -n; i <= n; i++) {
                lines.push(makeRing(Float64Array.of(i * stepDeg, i * stepDeg), Float64Array.of(-ext, ext), false, true));
                lines.push(makeRing(Float64Array.of(-ext, ext), Float64Array.of(i * stepDeg, i * stepDeg), false, false));
              }
            }
          } else if (!sheet.cache.has(key)) lines = graticule10();
          if (lines) { const p = new Path2D(); for (const l of lines) sheet.line(p, l); sheet.cache.set(key, p); }
          this.strokeOnSheet(c, sheet.cache.get(key) as Path2D, 0.8 * u);
        }
        // Land the terrain decides, without terrain colours: the plain land where the terrain has land.
        if (landByTerrain) {
          const lc = this.scratch(c);
          this.layTerrain(lc, view, sheet, terrain!, 'landmask', undefined, this.seaOf(c, view, sheet, opts.basemap ?? null, seaLevel, undefined, closeCoast));
          lc.save();
          lc.setTransform(1, 0, 0, 1, 0, 0);
          lc.globalCompositeOperation = 'source-in';
          lc.fillStyle = landStyle.land;
          lc.fillRect(0, 0, lc.canvas.width, lc.canvas.height);
          lc.restore();
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.drawImage(lc.canvas as CanvasImageSource, 0, 0);
          c.restore();
        }
        if (wantsLand) this.basemapPainter.draw(c, view, sheet, opts.basemap!, {
          referenceBorders: !!opts.referenceBorders,
          style: opts.basemapStyle,
          // Rivers (D99), in a water colour that shows on the plain land and on terrain colours.
          // (Drawn as photographed, D138, the Earth has its own rivers and coasts: none are drawn over it.)
          rivers: opts.show?.rivers !== false && !photographed ? riverColour(tLook) : null,
          // Lakes stay water whatever the sea does; with terrain colours (and today's sea) they take the sea's colours beneath.
          oceanColor: terrainColours ? rgbOf(rampAt(PALETTES[tLook!.palette].sea, -60)) : wantsBackground ? (opts.basemapStyle?.lake ?? style.ocean) : undefined,
          // Natural Earth's coastline is the coast only at today's sea level, and not where sculpting changed it (below).
          coastline: opts.show?.coastline !== false && !terrainLand && !photographed,
          // With terrain colours, the land is those colours (in the terrain pass); where the terrain decides, the terrain's land.
          fills: terrainLand ? 'lakes' : !terrainColours,
          afterFills: reliefOnLand ? () => this.layTerrain(c, view, sheet, terrain!, 'relief', undefined, shifted || closeCoast ? this.seaOf(c, view, sheet, opts.basemap!, seaLevel, undefined, closeCoast) : undefined) : undefined,
        });
        else if (reliefOnLand) this.layTerrain(c, view, sheet, terrain!, 'relief', undefined, this.seaOf(c, view, sheet, null, seaLevel));
        if (planetRivers) drawRiverLines(c, view, sheet, terrain!.rivers!, riverColour(tLook));
        // Sculpted Earth at today's sea level (D98): Natural Earth's coastline, except where sculpting changed the terrain.
        if (wantsLand && terrain?.override && !shifted && opts.show?.coastline !== false && !photographed) {
          const lc = this.scratch(c);
          this.basemapPainter.coastline(lc, view, sheet, opts.basemap!, opts.basemapStyle);
          lc.save();
          lc.globalCompositeOperation = 'destination-out';
          this.layTerrain(lc, view, sheet, terrain, 'override', undefined, this.seaOf(c, view, sheet, opts.basemap!, seaLevel));
          lc.restore();
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.drawImage(lc.canvas as CanvasImageSource, 0, 0);
          c.restore();
        }
        c.restore();
      } };
    }

    // Each name as it is at this moment (names can change over time).
    const entities = new Map(world.all('entity').map((e) => { const n = engine.nameAt(e.id, t); return [e.id, n ? { ...e, name: n } : e]; }));
    // Coloured by closeness to one country (D174): each of today's countries by how close it is, the rest grey.
    const colourBy = colourByOfSpace(world.get('map_space', spaceId));
    if (colourBy) {
      const colours = closenessColours(colourBy, world.all('entity').map((e) => ({ id: e.id, type_id: e.type_id, name: e.name, nameNow: entities.get(e.id)?.name })));
      for (const [id, color] of colours) {
        const e = entities.get(id)!;
        // (A picture filling it gives way to the colour.)
        const st = parseJSON<Record<string, unknown>>(e.style ?? '{}', {}) ?? {};
        delete st.fill;
        entities.set(id, { ...e, color, style: JSON.stringify(st) });
      }
    }
    this.mediaSeconds = opts.mediaSeconds ?? 0;
    this.mediaChannel = opts.mediaChannel ?? 'live';
    // Pictures and videos filling territory, by owner.
    const fills = new Map<string, CountryFillLike | null>();
    let anyMedia = false, looksInHistory = false;
    const fillOf = (v: string): CountryFillLike | null => {
      if (fills.has(v)) return fills.get(v)!;
      const f = parseJSON<{ fill?: CountryFillLike }>(entities.get(v)?.style ?? '{}', {})?.fill ?? null;
      const ok = f && f.asset && !f.off && (f.kind === 'image' || f.kind === 'video') ? f : null;
      fills.set(v, ok);
      return ok;
    };
    // Label looks: the project's general style, then each country's own settings.
    const general = parseJSON<Partial<LabelStyle>>(world.get('meta', 'label_style')?.value ?? '{}', {});
    this.labelLook = (id: string, name: string) => {
      const own = parseJSON<{ label?: CountryLabel }>(entities.get(id)?.style ?? '{}', {})?.label ?? null;
      if (own?.hidden) return null;
      const st = resolveLabelStyle(general, own);
      return { style: st, text: labelText(name, st, own) };
    };
    const colorOf = (v: string | null) => (v ? entities.get(v)?.color ?? '#888888' : null);
    // Countries' looks of their own (D181): elevation, opacity, effects.
    const ownLooks = new Map<string, CountryLook | null>();
    // (The map's one light, D186, and its statistics, for slabs as tall as one.)
    const mapRow = world.get('map_space', spaceId), mapLight = mapLightOf(mapRow);
    let mapStats: ReturnType<typeof statisticsOf> | null = null;
    const statsNow = () => (mapStats ??= statisticsOf(mapRow));
    const ownLookOf = (v: string): CountryLook | null => {
      if (!ownLooks.has(v)) ownLooks.set(v, countryLookOf(parseJSON<{ look?: unknown }>(entities.get(v)?.style ?? '{}', {})?.look));
      return ownLooks.get(v)!;
    };
    this.pointSizes = resolvePointStyle(world.get('meta', 'point_style')?.value);
    this.cityFilter = cityFilterOfSpace(world.get('map_space', spaceId));
    const labels: LabelInfo[] = [];

    // Draw in the same order whether everything is drawn at once or pass by pass (as exported):
    // the fills of every layer, then the borders of every layer, then the labels. Stacking the
    // exported passes in Premiere then reproduces the full picture exactly, with several layers too.
    // What the full picture shows (an export pass drawn on its own still places its texts as the full
    // picture does, so stacked passes match it).
    const layout = opts.layout ?? { labels: opts.passes.has('labels'), cities: opts.passes.has('cities') };
    const placesText = opts.passes.has('labels') || opts.passes.has('cities');
    const drawsLayers = opts.passes.has('fills') || opts.passes.has('borders') || (placesText && layout.labels);
    type LayerStyle = { fillOpacity?: number; borderWidth?: number; clipToLand?: boolean; fill?: TerritoryFill; fronts?: FrontTeeth; frontColor?: string; look?: unknown; borders?: unknown };
    // How fronts look (D137): the shot's look (the plain one in the working view), or an event's own.
    const tr = opts.transitions;
    const baseLook: FrontLookOptions = {
      roughness: tr?.roughness ?? 0, soft: tr?.soft ?? 0, wake: tr?.wake ?? 0, terrain: tr?.terrain ?? 0,
      front: tr?.front ?? { show: true, color: style.frontGlow, width: 2.2, glow: 10 },
    };
    // The heights fronts mind (D142), and what names them in pictures kept: other heights, another picture.
    const fg = frontsMindLand(world, tr) ? opts.frontGround ?? opts.terrain ?? null : null;
    this.frontGround = fg ? { grid: fg.grid, key: fg.key, seaLevel: Math.round((fg.seaLevel ?? 0) / 10) * 10 } : null;
    const groundSig = this.frontGround ? `|${tr?.terrain ?? 0}|${this.frontGround.key}|${this.frontGround.seaLevel}` : '';
    const eventLooks = eventLooksOf(world);
    // (How the shot's changes look: a picture of the same moment in another look is another picture.)
    const lookSig = tr ? `${tr.style}|${tr.easing}|${tr.roughness ?? 0}|${tr.soft ?? 0}|${tr.wake ?? 0}|${tr.front.show ? 1 : 0}|${tr.front.color}|${tr.front.width}|${tr.front.glow}${groundSig}` : groundSig;
    const looks = new Map<string, FrontLookOptions>();
    const lookOf = (a: Assignment): FrontLookOptions => {
      const id = eventLooks.get(a.eventId);
      if (!id) return baseLook;
      let l = looks.get(id);
      if (!l) looks.set(id, (l = lookById(id, baseLook) ?? baseLook));
      return l;
    };
    const prepared: Array<{ ls: LayerStyle; states: Map<number, FaceState>; snap: LayerSnap; tg: { groups: Map<string, TransitionGroup>; of: Map<number, TransitionGroup> }; clip: boolean; wars: Array<[string, string]> }> = [];
    this.lastFronts = [];
    let landKey = '', layerSig = '', animated = false;
    for (const layerId of drawsLayers ? opts.layerIds : []) {
      const layer = world.get('layer', layerId);
      if (!layer || layer.space_id !== spaceId || layer.kind !== 'partition') continue;
      let states = engine.partitionState(spaceId, layerId, t);
      let changing = engine.partitionChanging(spaceId, layerId, t);
      let sig = '';
      if (opts.transitions) ({ states, changing, sig } = this.shotStates(engine, spaceId, layerId, t, states, changing, opts.transitions, eventSecondsOf(world), eventLooks));
      const snap = this.snapFor(`${engine.revision}|${arr.revision}|${spaceId}|${layerId}|${engine.stretchOf(t)}|${sig}`, arr, states, changing, engine);
      const ls = parseJSON<LayerStyle>(layer.style, {});
      // Coastline clipping: territory ends at the coast unless the layer is set to cover the sea.
      // Away from any coast there is nothing to trim (all land), or nothing to see (all sea).
      let clip = (!!opts.basemap || terrainLand) && ls.clipToLand !== false;
      // (Where the terrain decides the coast, D96 and D97, land and sea are anywhere: always trimmed.)
      if (clip && !terrainLand) {
        const coast = this.basemapPainter.pathsFor(view, sheet, opts.basemap!).coast;
        if (coast === 'land') clip = false;
        else if (coast === 'sea') continue;
      }
      const tg = this.transitionGroups(view, sheet, sp, arr, snap, states, lookOf);
      // Front lines (D89): the wars holding now, each as the side it is drawn from and the side its teeth face.
      const wars = ls.fronts ? warsAt(world, engine, t, ls.fronts) : [];
      for (const [from, toward] of wars) this.lastFronts.push({ layerId, from, toward });
      prepared.push({ ls, states, snap, tg, clip, wars });
      landKey += `|${snap.key}|${layer.style}|${clip ? 1 : 0}`;
      layerSig += `|${layerId}|${layer.style}|${clip ? 1 : 0}${wars.length ? `|w:${wars.map((w) => w.join('>')).join(',')}` : ''}`;
      if (tg.groups.size) animated = true;
      for (const owner of snap.byOwner.keys()) if (fillOf(owner)) anyMedia = true;
      // (Borders whose dashes march, D183: the picture changes as time on screen passes, as a video's does.)
      if (bordersMove(layerBordersOf(ls.borders))) anyMedia = true;
      // (Looks that change as history goes or as time on screen passes, D185: drawn afresh at each moment.)
      const ll = layerLookOf(ls.look);
      for (const owner of snap.byOwner.keys()) {
        const l = lookFor(ownLookOf(owner), ll);
        if (movesOnScreen(l)) anyMedia = true;
        if (changesInHistory(l)) { anyMedia = true; looksInHistory = true; }
      }
    }

    this.lastTransitions = prepared.flatMap((p) => [...p.tg.groups.values()].map((g) => ({ style: g.spec.style, progress: g.progress })));
    const land = (): Shape => ({ path: this.basemapPainter.pathsFor(view, sheet, opts.basemap!).land, onSheet: true });
    const wantsFills = opts.passes.has('fills'), wantsBorders = opts.passes.has('borders');

    // ---- Territories and borders. The same picture while nothing changes hands (and nothing animates).
    if ((wantsFills || wantsBorders) && prepared.length) {
      // (The widest line and glow of any front in use, for the room drawn again round the changes.)
      let frontGlow = baseLook.front.glow, frontWidth = baseLook.front.width;
      for (const p of prepared) for (const g of p.tg.groups.values()) { frontGlow = Math.max(frontGlow, g.look.front.glow); frontWidth = Math.max(frontWidth, g.look.front.width); }
      // A change under way looks different at every instant (and in a shot, at every frame, which is
      // drawn afresh); so do videos. Pictures are kept until one loads.
      // While a change animates, everything outside its area stays as it is throughout the stretch of
      // time: the picture is kept, and only the rectangles around the animated changes are drawn again
      // for each moment (unless they take up most of the frame, or the view is turned).
      const widestLine = Math.max(...prepared.map((p) => p.ls.borderWidth ?? style.borderWidth));
      let renew: Renew | null = null;
      const terrName = `territory:${wantsFills ? 'f' : ''}${wantsBorders ? 'b' : ''}`;
      const moment = `${t.day}:${t.ms}|${opts.mediaSeconds ?? 0}|${lookSig}`;
      const keptNow = this.kept.get(terrName);
      // The kept picture is of this very moment (the view moves while the date stays): none of it is
      // drawn again for the animation, so the rectangles around the changes are not needed.
      // (The rectangles are the same for as long as the view and the changes animating stay the
      // same: finding them again in every frame, parcel by parcel, cost 9 ms a frame on a map
      // with many changes under way, in frames that changed nothing.)
      const animPad = 3 * frontGlow * u + (frontWidth + widestLine) * u + 6;
      const rk = animated ? `${frameKey}|${animPad}|${prepared.map((p) => `${p.snap.key}:${[...p.tg.groups.keys()].join(',')}`).join('|')}` : '';
      if (animated && !anyMedia && m.b === 0 && m.c === 0 && keptNow?.canvas && keptNow.key && keptNow.moment === moment) renew = { rects: [], moment };
      else if (animated && !anyMedia && m.b === 0 && m.c === 0) {
        const pad = animPad;
        if (this.renewRects?.key !== rk) {
          const boxes: number[][] = [];
          let ok = true, total = 0;
          outer: for (const p of prepared) for (const g of p.tg.groups.values()) for (const f of g.faces) {
            if (!this.joinFace(boxes, view, arr, f, m, pad, ctx.canvas.width, ctx.canvas.height)) { ok = false; break outer; }
          }
          for (const q of boxes) total += (q[2] - q[0]) * (q[3] - q[1]);
          this.renewRects = { key: rk, rects: ok && total <= 0.6 * ctx.canvas.width * ctx.canvas.height ? boxes.map((q) => [q[0], q[1], q[2] - q[0], q[3] - q[1]] as DeviceRect) : null };
        }
        let rects = this.renewRects.rects;
        // The picture kept shows these very changes a moment ago: only the strip each front has crossed since
        // is drawn again (D140).
        const shown = this.shownFronts.get(terrName);
        if (shown && shown.rk === rk && shown.look === lookSig && keptNow?.canvas && keptNow.key && keptNow.moment === shown.moment) {
          rects = this.frontRects(view, arr, prepared, shown.groups, m, pad, ctx.canvas.width, ctx.canvas.height) ?? rects;
        }
        if (rects) renew = { rects, moment };
      }
      const reliefKey = (tLook?.overTerritories && wantsFills ? `|r:${terrain!.key}|${JSON.stringify(tLook)}` : '') + (terrainLand && prepared.some((p) => p.clip) ? `|sea:${terrain!.key}|${seaLevel}` : '') + (reliefKeyNeedsDetail(tLook, wantsFills, terrainLand) ? `|d:${terrain?.detail?.key ?? ''}` : '');
      const key = animated && !renew && opts.transitions ? null : partKey(`${animated && !renew ? `${t.day}:${t.ms}|` : ''}${renew ? 'animated|' : ''}${lookSig}|${wantsFills ? 'f' : ''}${wantsBorders ? 'b' : ''}|${world.revision}|${style.border}|${style.borderWidth}|${opts.basemap ? `${opts.basemap.scales.length}|${lakeKey}` : ''}${landKey}${reliefKey}${anyMedia ? `|${assetEpoch()}|${this.mediaSeconds}|${this.mediaChannel}` : ''}${looksInHistory ? `|${t.day}:${t.ms}` : ''}`);
      // The working view, after an edit or a step in time that changed few parcels: only where they lie is drawn again.
      // A change under way looks different at every moment, and different again once it is over: where
      // the picture before showed one, and where this one does, is drawn again along with the parcels
      // that changed hands. (Stepping into a change, out of it, or from one to the next used to draw the
      // whole picture: every few frames when the timeline is dragged through a history full of them.)
      // `under`: the rectangles around the changes under way in this picture, for this view (null: not
      // known, or too much of the frame; then the picture is not patched, nor the one after it).
      const under: DeviceRect[] | null = !animated ? [] : this.renewRects && this.renewRects.key === rk ? this.renewRects.rects : null;
      let patch: { from: string; rects: DeviceRect[] } | null = null;
      if (key && (this.carry || this.caching === 'always') && !anyMedia && m.b === 0 && m.c === 0 && under) {
        // (How every country looks, whoever holds land now: a changed colour means the whole picture.)
        let colours = 0;
        for (const e of entities.values()) {
          const look = `${e.id}|${e.color}|${e.style}`;
          let hsh = 0x811c9dc5;
          for (let i = 0; i < look.length; i++) hsh = Math.imul(hsh ^ look.charCodeAt(i), 16777619);
          colours = (colours + (hsh >>> 0)) % 4294967291;
        }
        const stable = `${key.loose.slice(0, looseBase.length)}|${detail}|${wantsFills ? 'f' : ''}${wantsBorders ? 'b' : ''}|${style.border}|${style.borderWidth}|${opts.basemap ? `${opts.basemap.scales.length}|${lakeKey}` : ''}${layerSig}${reliefKey}|${colours}`;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const own = this.changesSince(terrName, view, arr, engine, prepared.map((p) => p.states), key.strict, stable, m, W, H, widestLine * u + 3);
        const before = this.animPrev.get(terrName);
        if (own && before && before.strict === own.from) {
          if (!before.rects.length && !under.length) patch = own;
          else if (before.frame === frameKey) {
            // Changes under way in both pictures are drawn again only where their fronts have moved (D140);
            // those that began or ended between them, and any without a front, everywhere they lie.
            const shown = this.shownFronts.get(terrName);
            const moved = shown && shown.strict === own.from && shown.frame === frameKey && shown.look === lookSig && keptNow?.canvas && keptNow.moment === shown.moment
              ? this.frontRects(view, arr, prepared, shown.groups, m, animPad, W, H) : null;
            const boxes: number[][] = [];
            for (const [x, y, rw, rh] of moved ? [...own.rects, ...moved] : [...own.rects, ...before.rects, ...under]) this.joinRect(boxes, [x, y, x + rw, y + rh], 24);
            let total = 0;
            for (const q of boxes) total += (q[2] - q[0]) * (q[3] - q[1]);
            if (total <= 0.6 * W * H) patch = { from: own.from, rects: boxes.map((q) => [q[0], q[1], q[2] - q[0], q[3] - q[1]] as DeviceRect) };
          }
        }
        this.animPrev.set(terrName, { strict: key.strict, frame: frameKey, rects: under });
      } else { this.patchPrev.delete(terrName); this.animPrev.delete(terrName); }
      // (How much of the frame each way of drawing only part of the picture again would take: for tests and measurements.)
      const share = (rects: DeviceRect[] | undefined) => (rects ? rects.reduce((a, q) => a + q[2] * q[3], 0) / Math.max(1, ctx.canvas.width * ctx.canvas.height) : 1);
      this.lastRedraw = { renew: share(renew?.rects), patch: share(patch?.rects) };
      const terrDraw = (c: CanvasRenderingContext2D) => {
        // (Where the frame lies on what is drawn on: the canvas itself, or a kept picture with room around the frame.)
        const cm = c.getTransform();
        // (Where a change is on the picture, and how many of its pixels to a unit of the view: for soft edges and glows.)
        const fxOf = (g: TransitionGroup): FrontFx => ({
          view, k: Math.hypot(cm.a, cm.b) || 1,
          box: (pad) => this.deviceBox(this.groupBox(view, arr, g, true), cm, pad, c.canvas.width, c.canvas.height),
          part: (deg, pad) => {
            // (With room past the picture's edges: a blur that ended at an edge would fade there.)
            const k = Math.hypot(cm.a, cm.b) || 1, beyond = Math.ceil(pad * k);
            // (Where whole outlines are needed, the projection bends boxes: the change's own box then.)
            if (parcelGeometry(arr).needsOutline(g.changingFaces[0] ?? -1)) return this.deviceBox(this.groupBox(view, arr, g, true), cm, pad, c.canvas.width, c.canvas.height, beyond);
            const acc: Box2 = [Infinity, Infinity, -Infinity, -Infinity];
            this.boxOnScreen(view, deg, acc);
            if (!(acc[2] > acc[0] && acc[3] > acc[1])) return [0, 0, 0, 0];
            const own = this.deviceBox(this.groupBox(view, arr, g, true), cm, pad, c.canvas.width, c.canvas.height, beyond);
            const part = this.deviceBox([acc[0], acc[1], acc[2] - acc[0], acc[3] - acc[1]], cm, pad, c.canvas.width, c.canvas.height, beyond);
            // (Within the change's own box.)
            const x0 = Math.max(own[0], part[0]), y0 = Math.max(own[1], part[1]), x1 = Math.min(own[0] + own[2], part[0] + part[2]), y1 = Math.min(own[1] + own[3], part[1] + part[3]);
            return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, 0, 0];
          },
        });
        c.save();
        clipPlanet(c);
        if (wantsFills) for (const { ls, snap, tg, clip } of prepared) {
          // Each layer is painted fully opaque in a scratch buffer and laid onto the map once at the
          // layer's opacity: neighbouring parcels then never show seams, and fades mix correctly.
          const lc = this.scratch(c);
          // Pictures are placed by clusters of the owner's pieces (D82): pieces close together share a
          // picture, placed by their box; pieces far off have their own. An owner whose picture is not
          // loaded yet shows its colour. (A change under way is painted with the largest cluster's box.)
          const ownerBox = new Map<string, Box2>();
          const boxOf = (v: string) => {
            let b = ownerBox.get(v);
            if (!b) {
              const set = snap.byOwner.get(v), media = fillOf(v);
              const main = set && media ? this.fillClusters(arr, set, media)[0] : null;
              const on = main ? this.boxesOnScreen(view, main.box)[0] : null;
              ownerBox.set(v, (b = on ? [on[0], on[1], on[2] - on[0], on[3] - on[1]] : this.screenBox(view, arr, snap.reach.get(v) ?? [])));
            }
            return b;
          };
          // (A hatched layer, D88: its owners' colours as stripes or dots.)
          const look = (pc: CanvasRenderingContext2D, col: string) => (ls.fill && ls.fill !== 'solid' ? this.hatch(pc, col, ls.fill, view.unit) ?? col : col);
          const plain = (pc: CanvasRenderingContext2D, v: string | null, shape: Shape) => {
            const col = colorOf(v);
            if (col) { pc.fillStyle = look(pc, col); this.fill(pc, shape); }
            else { pc.save(); pc.globalCompositeOperation = 'destination-out'; pc.fillStyle = '#000'; this.fill(pc, shape); pc.restore(); }
          };
          const paint = (pc: CanvasRenderingContext2D, v: string | null, shape: Shape) => {
            const media = v ? fillOf(v) : null;
            if (v && media && this.paintMedia(pc, media, shape, boxOf(v), view.unit)) return;
            plain(pc, v, shape);
          };
          // Where territory ends at the coast (D83): land along the coastline that no parcel covers
          // (today's countries are drawn from 1:50m shapes, the coast close up from 1:10m ones, and a
          // brushed outline rarely follows the coast) takes the look of the territory beside it: each
          // owner's outline is stroked a few kilometres wide under the fills, kept only in a band along
          // the coastline, and the land mask then trims it to the land.
          if (clip && opts.basemap && !terrainLand && this.basemapPainter.pathsFor(view, sheet, opts.basemap).coast === 'mixed') {
            const rim = coastRim(view);
            const rc = this.scratch(c);
            rc.lineJoin = 'round';
            rc.lineCap = 'round';
            // (Each owner's borders against nobody: its coasts, kept as paths for its border lines.)
            for (const [owner, path] of this.borderPaths(sp, sheet, arr, snap, snap.states).openBy) {
              const media = fillOf(owner);
              let style: string | CanvasPattern = look(rc, colorOf(owner) ?? '#888');
              if (media) {
                const set = snap.byOwner.get(owner);
                const main = set ? this.fillClusters(arr, set, media)[0] : null;
                const b = main ? this.boxesOnScreen(view, main.box)[0] : null, k = main ? this.boxesOnScreen(view, main.core)[0] ?? b : null;
                const pattern = b && k ? this.mediaPattern(rc, media, [k[0], k[1], k[2] - k[0], k[3] - k[1]], [b[0], b[1], b[2] - b[0], b[3] - b[1]], view.unit) : null;
                if (pattern) style = pattern;
              }
              rc.strokeStyle = style;
              this.strokeOnSheet(rc, path, 2 * rim);
            }
            const band = this.coastBand(c, view, sheet, opts.basemap, frameKey, 2 * rim);
            rc.globalCompositeOperation = 'destination-in';
            rc.setTransform(1, 0, 0, 1, 0, 0);
            rc.drawImage(band, 0, 0);
            rc.globalCompositeOperation = 'source-over';
            // (The buffers share the target's pixels: laid on without its transform.)
            lc.save();
            lc.setTransform(1, 0, 0, 1, 0, 0);
            lc.drawImage(rc.canvas as CanvasImageSource, 0, 0);
            lc.restore();
          }
          // Every owner's parcels as one shape (those not on this sheet are skipped altogether).
          const layerLook = layerLookOf(ls.look);
          const items: Array<{ owner: string; set: FaceSet; shape: Shape; look: CountryLook | null }> = [];
          for (const [owner, set] of snap.byOwner) {
            const shape = this.setPath(sp, sheet, arr, set);
            if (shape) items.push({ owner, set, shape, look: litBy(lookAt(lookFor(ownLookOf(owner), layerLook), t.day + t.ms / 864e5, this.mediaSeconds), mapLight) });
          }
          const styled = items.some((it) => !looksPlain(it.look));
          const paintOwner = (owner: string, set: FaceSet, shape: Shape) => {
            const media = fillOf(owner);
            if (media) {
              // Each cluster: its own shape, and a copy of the picture in each place its box shows on screen.
              const clusters = this.fillClusters(arr, set, media);
              let drawn = true;
              for (const cl of clusters) {
                const cs = cl.set === set ? shape : this.setPath(sp, sheet, arr, cl.set);
                if (!cs) continue;
                const boxes = this.boxesOnScreen(view, cl.box), cores = this.boxesOnScreen(view, cl.core);
                for (const b of boxes) {
                  const rect: Box2 = [b[0], b[1], b[2] - b[0], b[3] - b[1]];
                  // Placed by the core where it shows in this copy; covering the whole copy.
                  const k = cores.find((q) => q[0] < b[2] && q[2] > b[0] && q[1] < b[3] && q[3] > b[1]);
                  const at: Box2 = k ? [k[0], k[1], k[2] - k[0], k[3] - k[1]] : rect;
                  if (!this.paintMedia(lc, media, cs, at, view.unit, boxes.length > 1 ? rect : null, rect)) drawn = false;
                }
                if (!boxes.length && !this.paintMedia(lc, media, cs, this.screenBox(view, arr, cl.set.faces), view.unit)) drawn = false;
              }
              if (!drawn) plain(lc, owner, shape);
              return;
            }
            const col = colorOf(owner);
            if (col) { lc.fillStyle = look(lc, col); this.fill(lc, shape); }
          };
          // With looks of their own (D181): lowest elevation first; at each elevation, the shadows its countries cast
          // (on the lower land drawn before), then the countries themselves (over each other's shadows: countries of
          // the same height never shade one another), each at its own opacity.
          const order = styled ? [...items].sort((a, b) => (a.look?.elevation ?? 0) - (b.look?.elevation ?? 0)) : items;
          // What countries cast beyond their land (shadows, glows, slabs' walls), drawn again after the layer is cut to
          // the land, so that it still falls on the sea (D186).
          const spillOps: Array<(target: CanvasRenderingContext2D, scratch: CanvasRenderingContext2D) => void> = [];
          if (!styled) for (const it of items) paintOwner(it.owner, it.set, it.shape);
          else {
            const tmp = this.scratch(c);
            for (let i = 0; i < order.length;) {
              const elevation = order[i].look?.elevation ?? 0;
              let j = i;
              while (j < order.length && (order[j].look?.elevation ?? 0) === elevation) j++;
              const shadows = new Map<string, { sh: ShadowEffect; shapes: Shape[] }>();
              // (Drop shadows and outer glows: what a country casts on the land below it.)
              for (let k = i; k < j; k++) for (const e of order[k].look?.effects ?? []) {
                const sh = castOf(e);
                if (!sh) continue;
                const key = shadowKey(sh);
                let g = shadows.get(key);
                if (!g) shadows.set(key, (g = { sh, shapes: [] }));
                g.shapes.push(order[k].shape);
              }
              for (const g of shadows.values()) {
                this.castShadow(lc, tmp, g.sh, g.shapes, u);
                if (clip) spillOps.push((target, scratch) => this.castShadow(target, scratch, g.sh, g.shapes, u));
              }
              // (3D slabs, D186: the walls of each country raised, over the shadows on the land below and under the tops.)
              for (let k = i; k < j; k++) for (const e of order[k].look?.effects ?? []) {
                if (!e.on || e.kind !== 'extrude') continue;
                const h = slabHeight(e, entities.get(order[k].owner)?.name ?? '', e.stat ? statsNow() : [], t);
                if (h <= 0) continue;
                const a = (e.angle * Math.PI) / 180, box = this.deviceBox(this.screenBox(view, arr, order[k].set.faces), cm, 0, lc.canvas.width, lc.canvas.height);
                const slab = [order[k].shape, colorOf(order[k].owner) ?? '#888888', e.shade, Math.cos(a) * h * u, -Math.sin(a) * h * u, box] as const;
                this.drawSlab(lc, tmp, ...slab);
                if (clip) spillOps.push((target, scratch) => this.drawSlab(target, scratch, ...slab));
              }
              for (let k = i; k < j; k++) {
                const it = order[k];
                lc.globalAlpha = it.look?.opacity ?? 1;
                paintOwner(it.owner, it.set, it.shape);
                lc.globalAlpha = 1;
                // Over its fill, inside its edge: overlays, inner shadows and glows, bevels, in the stack's order.
                const inside = (it.look?.effects ?? []).filter((e) => e.on && INSIDE.has(e.kind));
                if (inside.length) {
                  const box = this.screenBox(view, arr, it.set.faces);
                  let main: Box2 | null = null;
                  const mainOf = (): Box2 => {
                    if (main) return main;
                    const core = this.fillClusters(arr, it.set, { kind: 'color' })[0]?.core, on = core ? this.boxesOnScreen(view, core)[0] : undefined;
                    return (main = this.deviceBox(on ? [on[0], on[1], on[2] - on[0], on[3] - on[1]] : box, cm, 0, lc.canvas.width, lc.canvas.height, Infinity));
                  };
                  for (const e of inside) this.insideEffect(lc, tmp, it.shape, e, (pad) => this.deviceBox(box, cm, pad, lc.canvas.width, lc.canvas.height), u, mainOf);
                }
              }
              i = j;
            }
          }
          // (A new owner of one colour paints its own land beside the change too: no seam between them.)
          const solidLook = !ls.fill || ls.fill === 'solid';
          for (const [id, g] of tg.groups) this.drawTransition(lc, g, paint, solidLook && g.a.value && !fillOf(g.a.value) ? this.withOwnLand(sp, sheet, arr, snap, id, g) : null, fxOf(g));
          // Relief over the territories (D95): shadows and light laid on the layer's colours only.
          if (tLook?.overTerritories) {
            lc.save();
            lc.globalCompositeOperation = 'source-atop';
            this.layTerrain(lc, view, sheet, terrain!, 'relief', cm, terrainLand ? this.seaOf(lc, view, sheet, opts.basemap ?? null, seaLevel, cm, closeCoast) : undefined);
            lc.restore();
          }
          if (clip) this.trimToLand(lc, view, sheet, opts.basemap ?? null, frameKey, true, terrainLand ? terrain : null, seaLevel, cm);
          // (Shadows, glows and walls cut away with the sea, D186: laid under the layer where it has no colour of its own.
          // Not on frames so large that the spare canvases are too few to hold them.)
          if (spillOps.length && lc.canvas.width * lc.canvas.height * 3 <= 40_000_000) {
            const spill = this.ownCanvas(0, c), scratch = this.ownCanvas(1, c);
            for (const op of spillOps) op(spill, scratch);
            spill.save();
            spill.setTransform(1, 0, 0, 1, 0, 0);
            spill.globalCompositeOperation = 'destination-out';
            spill.drawImage(lc.canvas as CanvasImageSource, 0, 0);
            spill.restore();
            c.save();
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.globalAlpha = ls.fillOpacity ?? 0.78;
            c.drawImage(spill.canvas as CanvasImageSource, 0, 0);
            c.restore();
          }
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.globalAlpha = ls.fillOpacity ?? 0.78;
          // (Laid on the map in the layer's blend mode, D181: multiplied, the relief shows through the colours.)
          c.globalCompositeOperation = compositeOf(layerLook?.blend);
          c.drawImage(lc.canvas as CanvasImageSource, 0, 0);
          c.restore();
          // The countries' strokes (D181), at their own strength over the fills, in the order of elevation.
          if (styled && order.some((it) => it.look?.effects.some((e) => e.on && e.kind === 'stroke'))) {
            const ec = this.scratch(c);
            ec.lineJoin = 'round';
            for (const it of order) for (const e of it.look?.effects ?? []) if (e.on && e.kind === 'stroke' && e.width > 0 && e.opacity > 0) this.strokeCountry(ec, it.shape, e, u);
            if (clip) this.trimToLand(ec, view, sheet, opts.basemap ?? null, frameKey, true, terrainLand ? terrain : null, seaLevel, cm);
            c.save();
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.drawImage(ec.canvas as CanvasImageSource, 0, 0);
            c.restore();
          }
          // The advancing front is highlighted on top, at full strength: the glow over the land just taken (D137),
          // then the line along the front.
          // (Within the land where territory ends at the coast: cut once for all of them. Cutting each change's
          // highlight to the whole coastline took most of a frame with seventy changes under way.)
          const lit = [...tg.groups.values()].filter((g) => g.advance && g.disc && g.changing && (g.look.front.show || (!!g.field && g.look.wake > 0.01 && g.progress < 1)));
          // Where the terrain decides the land (a planet, another sea level; D96, D97) there is no outline to cut
          // to: the highlights are drawn apart and cut by the land's mask, as the fills are (D145).
          const apart = lit.length > 0 && clip && terrainLand && !!terrain && lit.every((g) => !!g.field);
          const hc = apart ? this.scratch(c) : c;
          if (lit.length) hc.save();
          if (lit.length && clip && opts.basemap && !terrainLand) this.clip(hc, land());
          for (const g of lit) {
            if (!g.disc || !g.changing) continue;
            const fr = g.look.front;
            const wake = !!g.field && g.look.wake > 0.01 && g.progress < 1;
            const color = fr.color === 'auto' ? lighten(colorOf(g.a.value) ?? colorOf(g.from) ?? style.frontGlow, 0.45) : fr.color;
            hc.save();
            this.clip(hc, g.changing);
            if (wake) this.drawWake(hc, g, fxOf(g), color);
            if (!fr.show) { hc.restore(); continue; }
            if (g.field) {
              // The front itself, within the change (D137): never along its edges.
              if (g.line) {
                hc.strokeStyle = color;
                hc.lineWidth = fr.width * view.unit;
                hc.lineJoin = 'round';
                hc.lineCap = 'round';
                hc.shadowColor = color;
                hc.shadowBlur = fr.glow * view.unit;
                hc.stroke(g.line);
              }
            } else if (g.discRule === 'nonzero') {
              // The edge of the reached area: from a border, the area minus the area reached a
              // line-width earlier; from several points, each circle's outline less every circle's inside.
              const w = Math.max(0.5, fr.width * view.unit);
              const band = this.scratch(hc);
              band.fillStyle = color;
              band.strokeStyle = color;
              if (g.border) {
                band.fill(g.disc, 'nonzero');
                band.globalCompositeOperation = 'destination-out';
                band.fill(g.border.reach(g.progress * g.border.maxDist - w), 'nonzero');
              } else {
                band.lineWidth = 2 * w;
                band.stroke(g.disc);
                band.globalCompositeOperation = 'destination-out';
                band.fill(g.disc, 'nonzero');
              }
              band.globalCompositeOperation = 'source-over';
              hc.setTransform(1, 0, 0, 1, 0, 0);
              hc.shadowColor = color;
              hc.shadowBlur = fr.glow * view.unit;
              // Only the part of the buffer around the change (blurring the glow over the whole frame is slow).
              const [bx, by, bw, bh] = this.deviceBox(this.groupBox(view, arr, g, true), cm, 3 * fr.glow * view.unit + w + 4, hc.canvas.width, hc.canvas.height);
              if (bw > 0 && bh > 0) hc.drawImage(band.canvas as CanvasImageSource, bx, by, bw, bh, bx, by, bw, bh);
            } else {
              hc.strokeStyle = color;
              hc.lineWidth = fr.width * view.unit;
              hc.shadowColor = color;
              hc.shadowBlur = fr.glow * view.unit;
              hc.stroke(g.disc);
            }
            hc.restore();
          }
          if (lit.length) hc.restore();
          if (apart) {
            this.trimToLand(hc, view, sheet, opts.basemap ?? null, frameKey, true, terrain, seaLevel, cm);
            c.save();
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.drawImage(hc.canvas as CanvasImageSource, 0, 0);
            c.restore();
          }
        }
        // (The device box of an animated change: lines drawn apart around it are laid on only there.)
        const boxOf = (g: TransitionGroup, pad: number): Box2 => this.deviceBox(this.groupBox(view, arr, g, false), cm, pad, c.canvas.width, c.canvas.height);
        if (wantsBorders) for (const { ls, states, snap, tg, clip, wars } of prepared) {
          const width = (ls.borderWidth ?? style.borderWidth) * u;
          const fronts = (on: CanvasRenderingContext2D) => { if (wars.length) this.drawFronts(on, sheet, sp, arr, snap, states, wars, ls.fronts === 'plain', ls.frontColor ?? FRONT_COLOR, Math.max(2.5, 4 * u)); };
          const bl = layerBordersOf(ls.borders);
          if (!clip) { this.drawBorders(c, sheet, sp, arr, snap, states, tg, style, width, 'all', boxOf, bl); fronts(c); continue; }
          // Ending at the coast: drawn in the scratch buffer, masked by the land, then laid on. Where land
          // along the coast takes the look of the territory beside it (D83), an owner's border against
          // nobody is left out in that band (the coastline is the edge there); borders between owners stay.
          const lc = this.scratch(c);
          if (!terrainLand && this.basemapPainter.pathsFor(view, sheet, opts.basemap!).coast === 'mixed') {
            this.drawBorders(lc, sheet, sp, arr, snap, states, tg, style, width, 'shared', boxOf, bl);
            const oc = this.scratch(c);
            this.drawBorders(oc, sheet, sp, arr, snap, states, tg, style, width, 'open', null, bl);
            const band = this.coastBand(c, view, sheet, opts.basemap!, frameKey, 2 * coastRim(view));
            oc.save();
            oc.setTransform(1, 0, 0, 1, 0, 0);
            oc.globalCompositeOperation = 'destination-out';
            oc.drawImage(band, 0, 0);
            oc.restore();
            lc.save();
            lc.setTransform(1, 0, 0, 1, 0, 0);
            lc.drawImage(oc.canvas as CanvasImageSource, 0, 0);
            lc.restore();
          } else this.drawBorders(lc, sheet, sp, arr, snap, states, tg, style, width, 'all', boxOf, bl);
          fronts(lc);
          this.trimToLand(lc, view, sheet, opts.basemap ?? null, frameKey, false, terrainLand ? terrain : null, seaLevel, cm);
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.drawImage(lc.canvas as CanvasImageSource, 0, 0);
          c.restore();
        }
        c.restore();
      };
      const b0 = base;
      const zb = b0 && key ? this.zoomed(b0.name, ctx, b0.key, at, null, null) : null;
      const zt = zb && key ? this.zoomed(terrName, ctx, key, at, patch, renew) : null;
      if (!(b0 && zb && zt && this.zoomTogether(ctx, opens, [{ name: b0.name, z: zb, draw: b0.draw }, { name: terrName, z: zt, draw: terrDraw }]))) {
        if (b0) this.layered(b0.name, ctx, b0.key, at, b0.draw, null, null, opens);
        this.layered(terrName, ctx, key, at, terrDraw, patch, renew);
      }
      // How far each front had come in the picture now kept (for the strips of the next moment).
      if (animated && renew && key) {
        const groups = new Map<string, { progress: number; field: FrontField | null; rects: number[][] | null }>();
        prepared.forEach((p, i) => { for (const [id, g] of p.tg.groups) groups.set(`${i}:${id}`, { progress: g.progress, field: g.advance ? g.field ?? null : null, rects: this.groupRects(view, arr, g, m, animPad, ctx.canvas.width, ctx.canvas.height) }); });
        this.shownFronts.set(terrName, { rk, look: lookSig, frame: frameKey, strict: key.strict, moment: renew.moment, groups });
      } else this.shownFronts.delete(terrName);
    } else if (base) this.layered(base.name, ctx, base.key, at, base.draw, null, null, opens);

    // Fields (D102): radiation, fire, floods, heatmaps, over the territories and under the features.
    if (opts.passes.has('fields')) this.drawFields(ctx, view, sheet, world, engine, spaceId, t, opts.layerIds, opts.terrain ?? null);
    else this.lastFields = [];
    // Areas, lines and points of the feature layers, over the territories and under the names.
    if (opts.passes.has('features')) this.drawFeatures(ctx, view, sheet, world, engine, spaceId, t, opts.layerIds, u, clipSphere ? sphere : null);
    else this.lastFeatures = [];

    // One label per country: a country on several layers (its land, and its military control, say) is
    // labelled from the lowest layer it is on.
    // (Close in, where the finer heights draw the coast, D176, a name in view goes on their land: the coarser mask
    // cannot tell a strait from the land beside it.)
    const fineLand = closeCoast && terrain?.detail ? ((g: DetailGrid) => (lon: number, lat: number) => (detailHeightAt(g, lon, lat) ?? 1) > 0.5)(terrain.detail) : null;
    // (On a world without the Earth's coastline, a generated planet, names stand on the land its own heights make, D179.)
    const labelMask = opts.basemap ? landMaskOf(opts.basemap) : terrainLand && terrain ? this.terrainMask(terrain.grid, terrain.key, seaLevel) : null;
    if (placesText && layout.labels) for (const { states, snap, clip } of prepared) {
      for (const l of this.layerLabels(view, arr, snap, states, entities, clip ? labelMask : null, clip ? fineLand : null)) if (!labels.some((x) => x.entityId === l.entityId)) labels.push(l);
    }
    // Country labels and city names are placed together: they move apart where they would overlap,
    // and where they cannot the one with less priority is hidden (larger countries, then smaller
    // ones, then cities).
    const cities = placesText && layout.cities ? this.cityItems(view, engine, spaceId, t, entities) : [];
    if (placesText) this.placeTexts(ctx, labels, cities, view.rotation ? null : [view.width, view.height], opts.keepOut);
    this.lastCities = cities.map((c) => ({ entity: c.entity, name: c.name, x: c.x, y: c.y, lon: c.lon, lat: c.lat, moving: false, named: c.drawn, box: c.box }));
    if (opts.passes.has('cities') && !opts.textsApart) this.drawCities(ctx, cities, u);
    if (opts.passes.has('labels') && !opts.textsApart) this.drawLabels(ctx, labels, style, u);
    this.lastLabels = labels;
    this.lastCityItems = cities;
    this.lastCharacters = [];
    this.lastTrails = 0;
    if (opts.passes.has('characters')) this.drawCharacters(ctx, view, engine, spaceId, t, entities, !!opts.trails, opts.trailsSince ?? null);
    ctx.restore();
  }

  /**
   * The area, line or point under a place of the view (in the view's own, unturned coordinates) in
   * the last frame drawn; `tolerance` in view pixels. Null when there is none. Small targets come
   * first: a point near the place, then a line or an area's outline, then the inside of an area
   * (each the topmost drawn), so a battle inside a claim can be clicked.
   */
  featureAt(x: number, y: number, tolerance = 5): string | null {
    const probe = (this.hitCtx ??= (new OffscreenCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D));
    const list = this.lastFeatures;
    for (let i = list.length - 1; i >= 0; i--) { const f = list[i]; if (f.kind === 'point' && Math.hypot(x - f.x, y - f.y) <= f.r + tolerance) return f.id; }
    probe.setTransform(1, 0, 0, 1, 0, 0);
    probe.lineCap = 'round';
    probe.lineJoin = 'round';
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      if (f.kind === 'point') continue;
      probe.lineWidth = f.width + 2 * tolerance;
      for (const l of f.lines) {
        const p = new Path2D();
        addLine(p, l);
        if (probe.isPointInStroke(p, x, y)) return f.id;
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      if (f.kind !== 'area' || !f.path) continue;
      const [k, e, g] = f.place;
      probe.setTransform(k, 0, 0, k, e, g);
      if (probe.isPointInPath(f.path, x, y, 'evenodd')) return f.id;
    }
    return null;
  }
  private hitCtx: CanvasRenderingContext2D | null = null;

  /**
   * Areas, lines and points of the feature layers among `layerIds`, as they are at t, layer by layer
   * in the order given. Their outlines are worked out once per sheet (like borders); what is drawn in
   * screen pixels (dashes, teeth, arrowheads, symbols, names) keeps its size at every zoom.
   */
  /** The world whose features are being drawn (for the colours of contested areas' rivals, D93). */
  private featureWorld: World | null = null;
  /**
   * The field layers (D102), each a picture made on the graphics card from the sources in force at
   * `t`: every source drawn as a rectangle around its reach, in each copy of the planet the sheet shows.
   */
  private drawFields(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, world: World, engine: Engine, spaceId: string, t: Instant, layerIds: string[], terrain: TerrainShown | null): void {
    this.lastFields = [];
    const space = world.get('map_space', spaceId);
    if (!space || space.kind !== 'sphere' || sheet.kind === 'flat') return;
    const radiusKm = (space.radius_m ?? 6371008.8) / 1000;
    const [k, e, f] = sheet.placement(view);
    const m = ctx.getTransform().multiply(new DOMMatrix([k, 0, 0, k, e, f]));
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const frame: TerrainFrame = { kind: sheet.kind, S: sheet.S, ox: sheet.ox, oy: sheet.oy, lonRef: sheet.lonRef, m, width: W, height: H };
    const maxLat = sheet.kind === 'mercator' ? 85.05 : 90;
    /** The rectangles on the picture of a box of longitude and latitude, one for each copy of the planet shown (sampled across, as the projection curves the box). */
    const rects = (box: [number, number, number, number]): Array<{ copy: number; rect: [number, number, number, number] }> => {
      const out: Array<{ copy: number; rect: [number, number, number, number] }> = [];
      for (const copy of sheet.copies(box)) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
          const lon = box[0] + ((box[2] - box[0]) * i) / 6 + 360 * copy - sheet.lonRef, lat = Math.max(-maxLat, Math.min(maxLat, box[1] + ((box[3] - box[1]) * j) / 6));
          const [px, py] = projectPoint(sheet.kind, lon, lat);
          const sx = (px - sheet.ox) * sheet.S, sy = (py - sheet.oy) * sheet.S;
          const X = m.a * sx + m.c * sy + m.e, Y = m.b * sx + m.d * sy + m.f;
          if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        }
        x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2); x1 = Math.min(W, Math.ceil(x1) + 2); y1 = Math.min(H, Math.ceil(y1) + 2);
        if (x1 > x0 && y1 > y0) out.push({ copy, rect: [x0, y0, x1, y1] });
      }
      return out;
    };
    for (const layerId of layerIds) {
      const layer = world.get('layer', layerId);
      if (!layer || layer.kind !== 'field' || layer.space_id !== spaceId) continue;
      const style = fieldLayerStyleOf(layer.style);
      const active = activeSources(world, engine, layerId, t, compare);
      // A heatmap worked out from a layer of points (D105): each point in force a soft spot, worth 1.
      const from = style.from ? world.get('layer', style.from) : undefined;
      if (from && from.kind === 'point' && from.space_id === spaceId) {
        const spot = { ...DEFAULT_SOURCES.heat, shape: 'circle' as const, intensity: 1, radiusKm: style.kernelKm, noise: 0, rise: 0, hold: 1e7, decay: 0, grow: 0 };
        for (const fa of engine.featuresAt(from.id, t)) {
          const p = fa.parts[0];
          if (p && p.length >= 2) active.push({ id: fa.feature, name: '', lon: p[0], lat: p[1], source: spot, age: 1, strength: 1 });
        }
      }
      const inst: FieldInstance[] = [], spreads: FieldRaster[] = [];
      for (const a of active) {
        // Spreading over the terrain (D103), where there is terrain; elsewhere a circle.
        if (a.source.shape === 'spread' && terrain) {
          const g = spreadFor(a.source.spread, a.source, [a.lon, a.lat], terrain.grid, terrain.key, radiusKm);
          const box: [number, number, number, number] = [g.west, g.north - g.height * g.dLat, g.west + g.width * g.dLon, g.north];
          for (const { rect } of rects(box)) {
            spreads.push({ raster: g, rect, age: a.age, rise: a.source.rise, hold: a.source.hold, decay: a.source.decay, value: a.source.intensity, level: a.source.intensity * a.strength });
          }
          continue;
        }
        const reach = sourceReach(a.source, a.age), rho = reach / radiusKm, rhoDeg = (rho * 180) / Math.PI;
        const south = Math.max(-maxLat, a.lat - rhoDeg), north = Math.min(maxLat, a.lat + rhoDeg);
        if (south >= north) continue;
        const half = Math.abs(a.lat) + rhoDeg >= 89.9 ? 180 : (Math.asin(Math.min(1, Math.sin(rho) / Math.cos((a.lat * Math.PI) / 180))) * 180) / Math.PI;
        const box: [number, number, number, number] = [a.lon - half, south, a.lon + half, north];
        const r = a.source.radiusKm * sizeAt(a.source, a.age);
        for (const { copy, rect: [x0, y0, x1, y1] } of rects(box)) {
          inst.push({
            rect: [x0, y0, x1, y1], lon: ((a.lon + 360 * copy) * Math.PI) / 180, lat: (a.lat * Math.PI) / 180,
            radius: r, value: a.source.intensity * a.strength, noise: a.source.noise,
            plume: a.source.shape === 'plume' && a.source.windKmPerDay > 0 ? { dir: (a.source.windDeg * Math.PI) / 180, length: a.source.windKmPerDay * a.age } : null,
            phases: edgePhases(a.source.seed),
          });
        }
      }
      this.lastFields.push({ layer: layerId, sources: active.length, drawn: inst.length + spreads.length });
      if (!inst.length && !spreads.length) continue;
      // (What the picture shows: every rectangle and setting, and where the sheet lies on it.)
      const spreadKey = spreads.map((r) => `${r.raster.key}@${r.rect.join(',')}:${r.age}:${r.value}:${r.level}`).join(';');
      const key = `${hashInstances(inst)}|${spreadKey}|${style.type}|${style.opacity}|${style.full}|${sheet.kind}|${sheet.S}|${sheet.ox}|${sheet.oy}|${sheet.lonRef}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}|${radiusKm}`;
      const image = this.fieldPictures.image(layerId, key, style.type, style.opacity, inst, frame, radiusKm, spreads, style.full);
      if (!image) continue;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }
  }

  private drawFeatures(ctx: CanvasRenderingContext2D, view: View, sheet: Sheet, world: World, engine: Engine, spaceId: string, t: Instant, layerIds: string[], u: number, clip: Path2D | null): void {
    this.featureWorld = world;
    this.lastFeatures = [];
    this.pointNames = [];
    const [k, e, g] = this.place;
    const toScreen = (l: Float32Array) => { const o = new Float32Array(l.length); for (let i = 0; i < l.length; i += 2) { o[i] = l[i] * k + e; o[i + 1] = l[i + 1] * k + g; } return o; };
    let cache = sheet.cache.get('features') as WeakMap<number[][], { path: Path2D | null; lines: Float32Array[] }> | undefined;
    if (!cache) sheet.cache.set('features', (cache = new WeakMap()));
    const shapeOf = (kind: FeatureKind, parts: number[][]) => {
      let c = cache!.get(parts);
      if (c) return c;
      c = { path: null, lines: [] };
      if (kind === 'area') c.path = new Path2D();
      for (const p of parts) {
        const n = p.length >> 1;
        const lon = new Float64Array(n), lat = new Float64Array(n);
        for (let i = 0; i < n; i++) { lon[i] = p[2 * i]; lat[i] = p[2 * i + 1]; }
        if (kind === 'area') {
          sheet.ring(c.path!, makeRing(lon, lat, true, true));
          // The outline: the ring followed back to its first place.
          const closedLon = Float64Array.from([...lon, lon[0]]), closedLat = Float64Array.from([...lat, lat[0]]);
          c.lines.push(...sheet.lines(makeRing(closedLon, closedLat, false, true)));
        } else c.lines.push(...sheet.lines(makeRing(lon, lat, false, true)));
      }
      cache!.set(parts, c);
      return c;
    };
    const entities = new Map(world.rows('entity').map((x) => [x.id, x]));
    // Symbols and names grow and shrink with the zoom as cities do (and with the cities' size setting);
    // names too small to read are left out.
    const kDot = pointScale(view, 0.5, 1.3), kName = pointScale(view, 0.3, 1.15) * this.pointSizes.city;
    const nameSize = 15 * kName >= MIN_CITY_NAME ? 15 * kName * u : 0;
    ctx.save();
    if (clip) ctx.clip(clip);
    for (const layerId of layerIds) {
      const layer = world.get('layer', layerId);
      if (!layer || !isFeatureKind(layer.kind) || layer.space_id !== spaceId) continue;
      const kind = layer.kind;
      for (const fa of engine.featuresAt(layerId, t)) {
        const row = world.get('feature', fa.feature);
        if (!row) continue;
        const st = featureStyle(kind, layer.style, row.style);
        const color = featureColor(kind, layer.style, row.style, entities.get(row.entity_id)?.color);
        const width = Math.max(0.5, (st.width ?? 2) * u);
        const dash = st.dash === 'dashed' ? [4 * width, 2.5 * width] : st.dash === 'dotted' ? [0.01, 2 * width] : [];
        // While a new shape appears (D79): the shape before fades out, the new one comes in as its event goes on.
        const p = fa.progress;
        const appearing = p !== undefined && fa.style ? fa.style : null;
        if (appearing && fa.before) this.drawFeatureShape(ctx, view, kind, fa.before, row.name, st, color, width, dash, 1 - p!, null, null, shapeOf, toScreen, kDot, nameSize, u, null);
        const hit = this.drawFeatureShape(ctx, view, kind, fa.parts, row.name, st, color, width, dash,
          appearing === 'fade' || (appearing && kind === 'point') || (appearing === 'draw' && kind === 'area') ? p! : 1,
          appearing === 'draw' || (appearing === 'grow' && kind === 'line') ? p! : null,
          appearing === 'grow' && kind === 'area' ? p! : null,
          shapeOf, toScreen, kDot, nameSize, u, appearing === 'grow' && kind === 'point' ? p! : null);
        for (const h of hit) this.lastFeatures.push({ id: row.id, kind, place: [k, e, g], ...h });
      }
    }
    ctx.restore();
  }

  /**
   * One shape of an area, line or point: whole, or appearing (D79): `alpha` to fade it, `cut` to draw
   * its lines only that far along (0 to 1), `grow` to show an area only within a circle from its
   * middle growing to its farthest point, `scale` to grow a point's symbol. Returns where it was drawn
   * (for choosing it by clicking).
   */
  private drawFeatureShape(ctx: CanvasRenderingContext2D, view: View, kind: FeatureKind, parts: number[][], name: string, st: ReturnType<typeof featureStyle>, color: string, width: number, dash: number[],
    alpha: number, cut: number | null, grow: number | null,
    shapeOf: (kind: FeatureKind, parts: number[][]) => { path: Path2D | null; lines: Float32Array[] }, toScreen: (l: Float32Array) => Float32Array,
    kDot: number, nameSize: number, u: number, scale: number | null): Array<{ path: Path2D | null; lines: Float32Array[]; x: number; y: number; r: number; width: number }> {
    const [k, e, g] = this.place;
    const out: Array<{ path: Path2D | null; lines: Float32Array[]; x: number; y: number; r: number; width: number }> = [];
    if (alpha <= 0.001) return out;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    if (kind === 'point') {
      const lon = parts[0][0], lat = parts[0][1];
      for (const [x, y] of this.pointCopies(view, lon, lat)) {
        const r = Math.max(2, ((st.size ?? 9) / 2) * kDot * u) * (scale ?? 1);
        this.drawSymbol(ctx, st.symbol ?? 'circle', x, y, r, color, u);
        if (st.showName && nameSize && this.pointNameFree(ctx, name, x + r + 4 * u, y, nameSize)) this.featureName(ctx, name, x + r + 4 * u, y, 'left', 0, u, nameSize);
        out.push({ path: null, lines: [], x, y, r, width });
      }
      ctx.restore();
      return out;
    }
    // A missile (D171): only in flight, while its line draws itself.
    if (kind === 'line' && st.look === 'missile' && (cut === null || cut <= 0)) { ctx.restore(); return out; }
    const sh = shapeOf(kind, parts);
    const screen = sh.lines.map(toScreen);
    if (!screen.length && !sh.path) { ctx.restore(); return out; }
    if (kind === 'line' && st.look === 'missile') {
      for (const l of screen) this.drawMissile(ctx, l, cut!, color, width);
      ctx.restore();
      out.push({ path: null, lines: screen, x: 0, y: 0, r: 0, width });
      return out;
    }
    if (grow !== null && screen.length) {
      // Growing from its middle: everything outside the circle is left out.
      const m = areaMiddle(screen);
      if (m) {
        let far = 0;
        for (const l of screen) for (let i = 0; i < l.length; i += 2) far = Math.max(far, Math.hypot(l[i] - m[0], l[i + 1] - m[1]));
        const clip = new Path2D();
        clip.arc(m[0], m[1], Math.max(0.5, grow * far), 0, Math.PI * 2);
        ctx.clip(clip);
      }
    }
    if (kind === 'area' && sh.path) {
      ctx.save();
      ctx.transform(k, 0, 0, k, e, g);
      // Contested (D93): stripes of its own colour and the other claimant's, instead of the plain fill.
      const rival = st.contested ? this.featureWorld?.get('entity', st.contested)?.color : undefined;
      if (rival) {
        const mt = ctx.getTransform();
        ctx.save();
        ctx.clip(sh.path, 'evenodd');
        ctx.setTransform(mt.a / k, mt.b / k, mt.c / k, mt.d / k, mt.e - (mt.a * e + mt.c * g) / k, mt.f - (mt.b * e + mt.d * g) / k);
        ctx.globalAlpha = Math.max(0.45, Math.min(1, st.fillOpacity ?? 0)) * Math.min(1, alpha);
        ctx.fillStyle = this.contestPattern(ctx, color, rival, u);
        ctx.fillRect(-view.width, -view.height, 3 * view.width, 3 * view.height);
        ctx.restore();
        ctx.globalAlpha = Math.min(1, alpha);
      } else if ((st.fillOpacity ?? 0) > 0) { ctx.globalAlpha = Math.min(1, st.fillOpacity!) * Math.min(1, alpha); ctx.fillStyle = color; ctx.fill(sh.path, 'evenodd'); ctx.globalAlpha = Math.min(1, alpha); }
      if (st.hatch && st.hatch !== 'none') {
        const mt = ctx.getTransform();
        ctx.clip(sh.path, 'evenodd');
        ctx.setTransform(mt.a / k, mt.b / k, mt.c / k, mt.d / k, mt.e - (mt.a * e + mt.c * g) / k, mt.f - (mt.b * e + mt.d * g) / k);
        ctx.fillStyle = this.hatchPattern(ctx, st.hatch, color, u);
        ctx.fillRect(-view.width, -view.height, 3 * view.width, 3 * view.height);
      }
      ctx.restore();
    }
    // Drawn so far along: an arrow's head travels with the end of what is drawn.
    const drawn = cut === null ? screen : screen.map((l) => cutLine(l, cut)).filter((l) => l.length >= 4);
    // A campaign arrow (D106): a broad body narrowing to its tail, its head at the end of what is drawn.
    if (kind === 'line' && st.look === 'arrow' && width > 0 && drawn.length) {
      ctx.save();
      ctx.lineJoin = 'round';
      for (const l of drawn) {
        const ring = campaignArrow(l, width);
        if (!ring) continue;
        ctx.beginPath();
        addLine(ctx, ring);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill('nonzero');
        ctx.strokeStyle = mixColor(color, '#000000', 0.55);
        ctx.lineWidth = Math.max(1, width * 0.07);
        ctx.stroke();
      }
      if (st.flow && st.flow !== 'none') this.drawFlow(ctx, drawn, st, color, width, u, true);
      ctx.restore();
    } else if (width > 0 && drawn.length) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = st.dash === 'dotted' ? 'round' : 'butt';
      ctx.setLineDash(dash);
      for (const l of drawn) { ctx.beginPath(); addLine(ctx, l); ctx.stroke(); }
      ctx.setLineDash([]);
      if (kind === 'line') {
        ctx.fillStyle = color;
        if (st.teeth && st.teeth !== 'none') for (const l of drawn) this.drawTeeth(ctx, l, width, st.teeth === 'left' ? -1 : 1);
        if (st.arrow && st.arrow !== 'none') for (const l of drawn) {
          this.drawArrowhead(ctx, l, width, true);
          if (st.arrow === 'both' && cut === null) this.drawArrowhead(ctx, l, width, false);
        }
        if (st.flow && st.flow !== 'none') this.drawFlow(ctx, drawn, st, color, width, u, false);
      }
      ctx.restore();
    }
    if (st.showName && nameSize && screen.length && (cut === null || cut > 0.5)) {
      const at: [number, number, number] | null = kind === 'area' ? (() => { const m = areaMiddle(screen); return m ? [m[0], m[1], 0] as [number, number, number] : null; })() : lineMiddle(screen);
      if (at) this.featureName(ctx, name, at[0], at[1], 'center', at[2], u, nameSize, kind === 'line' ? -(width / 2 + nameSize / 2 + 2 * u) : 0);
    }
    ctx.restore();
    out.push({ path: sh.path, lines: screen, x: 0, y: 0, r: 0, width });
    return out;
  }

  /**
   * A missile in flight (D171): `f` of the way along its line (screen points). Its trail, a fifth of the
   * line's length (at most a third of the frame), widens and brightens towards the head, a white-hot
   * point in a glow of the line's colour.
   */
  private drawMissile(ctx: CanvasRenderingContext2D, l: Float32Array, f: number, color: string, width: number): void {
    const n = l.length >> 1;
    if (n < 2) return;
    let total = 0;
    for (let i = 1; i < n; i++) total += Math.hypot(l[2 * i] - l[2 * i - 2], l[2 * i + 1] - l[2 * i - 1]);
    if (!(total > 0)) return;
    const head = total * Math.min(1, f);
    const tail = Math.min(total * 0.2, Math.max(ctx.canvas.width, ctx.canvas.height) / 3, head);
    const pieces = 12;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    for (let k = 0; k < pieces; k++) {
      const a = head - tail + (tail * k) / pieces, b = head - tail + (tail * (k + 1)) / pieces;
      const part = cutLineBetween(l, a, b);
      if (part.length < 4) continue;
      const w = (k + 1) / pieces;
      ctx.globalAlpha = 0.08 + 0.8 * w * w;
      ctx.lineWidth = Math.max(0.6, width * (0.35 + 0.65 * w));
      ctx.beginPath(); addLine(ctx, part); ctx.stroke();
    }
    const tip = cutLineBetween(l, Math.max(0, head - 0.5), head);
    if (tip.length >= 2) {
      const x = tip[tip.length - 2], y = tip[tip.length - 1], r = Math.max(2, width * 1.6);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.25, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Marks flowing along lines in their direction (D106): dashes, chevrons or dots in a light tint of
   * the line's colour, carried along at the line's flow speed by the shot's clock (still while
   * world-building). On a campaign arrow they run down the middle of its body.
   */
  private drawFlow(ctx: CanvasRenderingContext2D, lines: Float32Array[], st: FeatureStyle, color: string, width: number, u: number, arrow: boolean): void {
    const speed = Math.max(0, st.flowSpeed ?? 40) * u, moved = this.mediaSeconds * speed;
    const light = mixColor(color, '#ffffff', 0.6);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const raw of lines) {
      const l = arrow ? smoothLine(raw, 3) : raw;
      const len = lineLength(l);
      // (On an arrow, from a little past its tail to a little before its head.)
      const from = arrow ? Math.min(len, width * 0.6) : 0, to = arrow ? arrowBodyLength(len, width) - width * 0.35 : len;
      if (to <= from) continue;
      if (st.flow === 'dashes') {
        const dash = arrow ? width * 0.9 : Math.max(5 * u, 3 * width), gap = dash;
        ctx.strokeStyle = arrow ? 'rgba(255,255,255,0.55)' : light;
        ctx.lineWidth = arrow ? Math.max(1, width * 0.18) : Math.max(1, width * 0.55);
        ctx.setLineDash([dash, gap]);
        // (A falling offset carries the dashes toward the line's end.)
        ctx.lineDashOffset = -(moved % (dash + gap)) - from;
        ctx.beginPath();
        addLine(ctx, arrow ? cutLineBetween(l, from, to) : l);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const size = arrow ? width * 0.32 : Math.max(3 * u, 1.6 * width);
      const spacing = arrow ? width * 0.95 : st.flow === 'dots' ? Math.max(9 * u, 3.5 * width) : Math.max(14 * u, 4.5 * width);
      ctx.fillStyle = ctx.strokeStyle = arrow ? 'rgba(255,255,255,0.6)' : light;
      for (const [x, y, a] of marksAlong(l, spacing, moved, from, to)) {
        if (st.flow === 'dots') {
          ctx.beginPath();
          ctx.arc(x, y, arrow ? width * 0.11 : Math.max(1.2 * u, width * 0.55), 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        // A chevron pointing the way the line goes.
        const c = Math.cos(a), s = Math.sin(a);
        ctx.lineWidth = arrow ? Math.max(1, width * 0.12) : Math.max(1, width * 0.6);
        ctx.beginPath();
        ctx.moveTo(x - c * size - -s * size * 0.9, y - s * size - c * size * 0.9);
        ctx.lineTo(x, y);
        ctx.lineTo(x - c * size + -s * size * 0.9, y - s * size + c * size * 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Where a place shows in the view (unturned): once, or once for each turn of a repeating map in view. */
  private pointCopies(view: View, lon: number, lat: number): Array<[number, number]> {
    const p = view.projection([lon, lat]);
    if (!p) return [];
    const out: Array<[number, number]> = [];
    const turn = isCylindrical(view.camera.projection) ? 2 * Math.PI * view.projection.scale() : 0;
    for (const n of turn ? [-1, 0, 1] : [0]) {
      const x = p[0] + n * turn, y = p[1];
      if (x >= -50 && x <= view.width + 50 && y >= -50 && y <= view.height + 50) out.push([x, y]);
    }
    return out;
  }

  private drawSymbol(ctx: CanvasRenderingContext2D, symbol: NonNullable<FeatureStyle['symbol']>, x: number, y: number, r: number, color: string, u: number): void {
    ctx.save();
    ctx.beginPath();
    const poly = (n: number, rot: number, rr = r) => { for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; if (i) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.lineTo(x + rr * Math.cos(rot), y + rr * Math.sin(rot)); };
    if (symbol === 'square') poly(4, Math.PI / 4, r * 1.2);
    else if (symbol === 'diamond') poly(4, 0, r * 1.25);
    else if (symbol === 'triangle') poly(3, -Math.PI / 2, r * 1.3);
    else if (symbol === 'star') {
      for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.5 : r * 1.35; if (i) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
    } else if (symbol === 'cross' || symbol === 'battle') {
      // Two crossed bars (a battle: crossed swords, with hilts).
      const w = r * 0.42;
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const c = Math.cos(a), sn = Math.sin(a);
        const pts: Array<[number, number]> = [[-r * 1.2, -w / 2], [r * 1.2, -w / 2], [r * 1.2, w / 2], [-r * 1.2, w / 2]];
        pts.forEach(([px, py], i) => { const X = x + px * c - py * sn, Y = y + px * sn + py * c; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.lineTo(x + pts[0][0] * c - pts[0][1] * sn, y + pts[0][0] * sn + pts[0][1] * c);
        if (symbol === 'battle') for (const s of [-1, 1]) {
          const hx = s * r * 0.7, q: Array<[number, number]> = [[hx - w * 0.3, -w * 1.4], [hx + w * 0.3, -w * 1.4], [hx + w * 0.3, w * 1.4], [hx - w * 0.3, w * 1.4]];
          q.forEach(([px, py], i) => { const X = x + px * c - py * sn, Y = y + px * sn + py * c; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
          ctx.lineTo(x + q[0][0] * c - q[0][1] * sn, y + q[0][0] * sn + q[0][1] * c);
        }
      }
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill('nonzero');
    ctx.lineWidth = 1.4 * u;
    ctx.strokeStyle = '#0a1018';
    ctx.stroke();
    ctx.restore();
  }

  /** Teeth along a line (a front line), pointing to one side: -1 left, 1 right of its direction. */
  /**
   * Front lines (D89): the border between two countries at war, from the side of `from`, as a line in
   * the front's colour on a dark edge, with teeth facing the other side (unless plain).
   */
  private drawFronts(c: CanvasRenderingContext2D, sheet: Sheet, sp: SheetParcels, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>, wars: Array<[string, string]>, plain: boolean, color: string, width: number): void {
    const geom = parcelGeometry(arr), t = arr.topology();
    const [k, e, f] = this.place;
    c.save();
    c.transform(k, 0, 0, k, e, f);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for (const [from, toward] of wars) {
      const set = snap.byOwner.get(from);
      if (!set) continue;
      const b = this.boundaryOf(arr, set);
      const lines: Float32Array[] = [];
      for (let q = 0; q < b.length; q += 3) {
        const other = arr.halfEdgeFace(geom.cycle(b[q], t).heads[b[q + 1]] ^ 1);
        if (states.get(other)?.value !== toward) continue;
        for (const l of this.chainLines(sp, sheet, geom, b[q], b[q + 1])) lines.push(l);
      }
      if (!lines.length) continue;
      const path = new Path2D();
      for (const l of lines) addLine(path, l);
      c.strokeStyle = 'rgba(10,16,24,0.75)';
      c.lineWidth = (width * 2) / k;
      c.stroke(path);
      c.strokeStyle = color;
      c.lineWidth = width / k;
      c.stroke(path);
      if (plain) continue;
      // (An owner's outline runs with its land on one side, the same for every chain: the teeth go to the other.)
      c.fillStyle = color;
      for (const l of lines) this.drawTeeth(c, l, (width * 2) / k, FRONT_SIDE);
    }
    c.restore();
  }

  private drawTeeth(ctx: CanvasRenderingContext2D, l: Float32Array, width: number, side: number): void { drawTeeth(ctx, l, width, side); }

  /** An arrowhead at the end of a line (or at its start). */
  private drawArrowhead(ctx: CanvasRenderingContext2D, l: Float32Array, width: number, atEnd: boolean): void {
    const n = l.length >> 1;
    if (n < 2) return;
    const tip = atEnd ? n - 1 : 0;
    const tx = l[2 * tip], ty = l[2 * tip + 1];
    // The direction over the last few pixels of the line.
    let j = tip;
    for (let s = 0; s < n - 1; s++) { j = atEnd ? j - 1 : j + 1; if (Math.hypot(l[2 * j] - tx, l[2 * j + 1] - ty) >= 3 * width || j === 0 || j === n - 1) break; }
    const dx = tx - l[2 * j], dy = ty - l[2 * j + 1], len = Math.hypot(dx, dy);
    if (!len) return;
    const ux = dx / len, uy = dy / len, size = 4.5 * width + 4;
    ctx.beginPath();
    ctx.moveTo(tx + ux * size * 0.35, ty + uy * size * 0.35);
    ctx.lineTo(tx - ux * size + -uy * size * 0.6, ty - uy * size + ux * size * 0.6);
    ctx.lineTo(tx - ux * size - -uy * size * 0.6, ty - uy * size - ux * size * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  private patterns = new Map<string, CanvasPattern>();
  /** Wide stripes at 45° alternating two colours, for a contested area (D93). */
  private contestPattern(ctx: CanvasRenderingContext2D, a: string, b: string, u: number): CanvasPattern {
    const size = Math.max(8, Math.round(22 * u));
    const key = `contest|${a}|${b}|${size}`;
    let p = this.patterns.get(key);
    if (p) return p;
    const c = new OffscreenCanvas(size, size), x = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    x.fillStyle = a;
    x.fillRect(0, 0, size, size);
    x.strokeStyle = b;
    x.lineWidth = size / (2 * Math.SQRT2);
    x.beginPath();
    for (const o of [-size, 0, size]) { x.moveTo(o, size); x.lineTo(o + size, 0); }
    x.stroke();
    p = ctx.createPattern(c as unknown as CanvasImageSource, 'repeat')!;
    if (this.patterns.size > 64) this.patterns.clear();
    this.patterns.set(key, p);
    return p;
  }

  private hatchPattern(ctx: CanvasRenderingContext2D, hatch: 'diagonal' | 'cross' | 'dots', color: string, u: number): CanvasPattern {
    const size = Math.max(4, Math.round(9 * u));
    const key = `${hatch}|${color}|${size}`;
    let p = this.patterns.get(key);
    if (p) return p;
    const c = new OffscreenCanvas(size, size), x = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    x.strokeStyle = color; x.fillStyle = color;
    x.lineWidth = Math.max(1, 1.4 * u);
    if (hatch === 'dots') { x.beginPath(); x.arc(size / 2, size / 2, Math.max(0.8, size / 7), 0, Math.PI * 2); x.fill(); }
    else {
      x.beginPath();
      for (const o of [-size, 0, size]) { x.moveTo(o, size); x.lineTo(o + size, 0); }
      if (hatch === 'cross') for (const o of [-size, 0, size]) { x.moveTo(o, 0); x.lineTo(o + size, size); }
      x.stroke();
    }
    p = ctx.createPattern(c as unknown as CanvasImageSource, 'repeat')!;
    if (this.patterns.size > 64) this.patterns.clear();
    this.patterns.set(key, p);
    return p;
  }

  /** The name of a feature, with a dark halo (`angle`: along a line; `lift`: moved across it). */
  /** The names of points written in this frame (D176): one that would overlap another is left out, so points crowded together when seen from afar stay legible. */
  private pointNames: Array<[number, number, number, number]> = [];
  private pointNameFree(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number): boolean {
    if (!name) return false;
    ctx.save();
    ctx.font = `italic 600 ${size.toFixed(1)}px Georgia, "Times New Roman", serif`;
    const w = ctx.measureText(name).width;
    ctx.restore();
    const box: [number, number, number, number] = [x - 2, y - size * 0.6, x + w + 2, y + size * 0.6];
    if (this.pointNames.some((q) => !(box[2] <= q[0] || box[0] >= q[2] || box[3] <= q[1] || box[1] >= q[3]))) return false;
    this.pointNames.push(box);
    return true;
  }

  private featureName(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, align: CanvasTextAlign, angle: number, u: number, size: number, lift = 0): void {
    if (!name) return;
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.font = `italic 600 ${size.toFixed(1)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5 * u;
    ctx.strokeStyle = 'rgba(10,16,24,0.85)';
    ctx.strokeText(name, 0, lift);
    ctx.fillStyle = '#f4efe6';
    ctx.fillText(name, 0, lift);
    ctx.restore();
  }

  /** Per stretch of time: the parcels of each change that a shot may animate (not recorded as animated), with what they were before. */
  private shotIndex = new Map<string, Map<string, { a: Assignment; faces: number[]; from: Array<{ value: string | null; prior: Assignment | null }>; next?: Instant | null }>>();

  /**
   * A shot's way of animating changes, applied to the recorded states: no animation at all, every
   * change animated, or recorded animations restyled. History is never changed, only what is drawn.
   * Only the parcels in a change being animated get states of their own; `sig` says which changes
   * those are (so that what stays the same between frames can be kept).
   */
  private shotStates(engine: Engine, spaceId: string, layerId: string, t: Instant, states: Map<number, FaceState>, changing: number[], o: ShotTransitionOptions, eventSeconds: ReadonlyMap<string, number> = new Map(), eventLooks: ReadonlyMap<string, string> = new Map()): { states: Map<number, FaceState>; changing: number[]; sig: string } {
    // Events with a time of their own on screen (D92) animate in any shot that animates at all.
    const own = (a: Assignment | null | undefined) => (a ? eventSeconds.get(a.eventId) : undefined);
    if (o.mode === 'recorded' && !o.restyleRecorded && !eventSeconds.size) return { states, changing, sig: '' };
    const spec: CompiledTransition = { style: o.style, origin: null, maxDist: 0, easing: o.easing, angle: o.angle, shot: true };
    // An event with a look of its own (D137): the changes the shot animates take that look's style and easing.
    const specs = new Map<string, CompiledTransition>();
    const specOf = (a: Assignment): CompiledTransition => {
      const id = eventLooks.get(a.eventId);
      if (!id) return spec;
      let sp = specs.get(id);
      if (!sp) {
        const l = TRANSITION_LOOKS.find((x) => x.id === id)?.set;
        specs.set(id, (sp = l ? { ...spec, style: l.style ?? spec.style, easing: l.easing ?? spec.easing } : spec));
      }
      return sp;
    };
    const progressOf = (a: Assignment): number => shotProgress(a, t, o, own(a));
    /** How far a change has come when it must be over by `next` (its progress `p` otherwise). */
    const endingBy = (a: Assignment, next: Instant, p: number): number => {
      const ownS = own(a);
      if (!ownS && o.timing === 'event' && compare(a.end, a.t) > 0) {
        const span = diffMs(a.t, a.end), gap = diffMs(a.t, next);
        return gap < span ? diffMs(a.t, t) / Math.max(1, gap) : p;
      }
      const length = ownS && ownS > 0 ? ownS : Math.max(1e-3, o.seconds);
      const since = o.secondsSince(a.t), gap = since - o.secondsSince(next);
      return gap < length ? since / Math.max(1e-3, gap) : p;
    };
    let out: Map<number, FaceState> | null = null;
    const put = (f: number, st: FaceState) => { (out ??= new Map(states)).set(f, st); };
    const now: number[] = [];
    const active = new Set<string>();
    // Changes recorded as animated.
    for (const f of changing) {
      const st = states.get(f)!, a = st.assignment;
      if (o.mode === 'instant') { put(f, { value: st.value, assignment: a }); continue; }
      if (own(a)) {
        // Its own time on screen, in its own style.
        const p = progressOf(a!);
        if (p >= 1 || !(p >= 0)) put(f, { value: st.value, assignment: a });
        else { put(f, { ...st, transition: { ...st.transition!, progress: p } }); now.push(f); active.add(a!.effectId); }
        continue;
      }
      if (!o.restyleRecorded) { now.push(f); active.add(a!.effectId); continue; }
      const p = progressOf(a!);
      if (p >= 1 || !(p >= 0)) put(f, { value: st.value, assignment: a });
      else { put(f, { ...st, transition: { ...st.transition!, progress: p, spec: specOf(a!) } }); now.push(f); active.add(a!.effectId); }
    }
    // Every other change, animated by the shot ('all'), or by its event's own time on screen (D92): only
    // those under way at this frame.
    if (o.mode === 'all' || (o.mode !== 'instant' && eventSeconds.size)) {
      const key = `${engine.revision}|${engine.stretchOf(t)}|${spaceId}|${layerId}|${states.size}`;
      let index = this.shotIndex.get(key);
      if (!index) {
        index = new Map();
        for (const [f, st] of states) {
          const a = st.assignment;
          // The starting map is never animated; changes made without an event are, like any other change.
          if (st.transition || !a || (isBaseEvent(a.eventId) && a.t.day === -Infinity)) continue;
          let e = index.get(a.effectId);
          if (!e) index.set(a.effectId, (e = { a, faces: [], from: [] }));
          e.faces.push(f);
        }
        if (this.shotIndex.size >= 6) this.shotIndex.delete(this.shotIndex.keys().next().value!);
        this.shotIndex.set(key, index);
      }
      for (const [id, e] of index) {
        if (o.mode !== 'all' && !own(e.a)) continue;
        let p = progressOf(e.a);
        if (!(p >= 0 && p < 1)) continue;
        // Its land changing hands again before this animation would end (maps of years close together, a
        // shot's whole history at a few years a second): it ends then, so that the next change starts from
        // all of it instead of what it had not reached jumping to its end.
        if (e.next === undefined) e.next = engine.nextHandover(spaceId, layerId, e.faces, e.a.t, e.a.value);
        if (e.next) p = endingBy(e.a, e.next, p);
        if (!(p >= 0 && p < 1)) continue;
        // (A change recorded with an animation of its own keeps it when its event takes its own time.)
        const tspec = own(e.a) && e.a.transition ? e.a.transition : specOf(e.a);
        for (let i = 0; i < e.faces.length; i++) {
          const f = e.faces[i], st = states.get(f)!;
          let was = e.from[i];
          if (!was) { const prior = engine.latest(spaceId, layerId, f, t, st.assignment!); was = e.from[i] = { value: prior ? prior.value : null, prior }; }
          if ((was.value ?? '') === (st.value ?? '')) continue;
          put(f, { value: st.value, assignment: st.assignment, transition: { from: was.value, progress: p, spec: tspec, prior: was.prior } });
          now.push(f);
          active.add(id);
        }
      }
    }
    return { states: out ?? states, changing: now, sig: `${o.mode}|${o.restyleRecorded ? 1 : 0}|${now.length}|${[...active].sort().join(',')}` };
  }

  /** The animated changes at this moment: the parcels of each (from the snapshot) and how far each has come. */
  private transitionGroups(view: View, sheet: Sheet, sp: SheetParcels, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>, lookOf: (a: Assignment) => FrontLookOptions): { groups: Map<string, TransitionGroup>; of: Map<number, TransitionGroup> } {
    const groups = new Map<string, TransitionGroup>(), of = new Map<number, TransitionGroup>();
    for (const cg of snap.groups.values()) {
      const st = states.get(cg.region.faces[0])!;
      const spec = st.transition!.spec;
      const advance = spec.style === 'advance' || spec.style === 'wipe' || spec.style === 'border' || spec.style === 'dissolve';
      // Shot-made animations use the shot's easing; recorded fronts their own; recorded fades stay even.
      const progress = spec.shot || spec.style === 'advance' || spec.style === 'border' || spec.style === 'dissolve' ? ease(spec.easing, st.transition!.progress) : st.transition!.progress;
      const g: TransitionGroup = {
        a: st.assignment!, faces: cg.region.faces, changingFaces: cg.changing.faces, advance, spec, progress, disc: null, discRule: 'evenodd', border: null,
        region: this.setPath(sp, sheet, arr, cg.region), changing: cg.changing.faces.length ? this.setPath(sp, sheet, arr, cg.changing) : null,
        look: lookOf(st.assignment!), from: st.transition!.from,
        boxes: this.groupBoxes.get(cg) ?? (() => { const b: TransitionGroup['boxes'] = { key: '', changing: null, all: null }; this.groupBoxes.set(cg, b); return b; })(),
      };
      groups.set(cg.id, g);
      for (const f of cg.region.faces) of.set(f, g);
    }
    // The area each moving front has reached: through the land from where it starts (D136); failing that, grown
    // from the border with the new owner's land, a circle from its origin, or a straight wipe (older shots).
    for (const g of groups.values()) {
      if (!g.advance || g.progress <= 0) continue;
      if (g.spec.style === 'wipe') { g.disc = this.wipeShape(view, arr, g); continue; }
      const field = this.frontField(view, arr, g, states);
      if (field) {
        g.field = field;
        g.disc = this.reachedPath(view, field, g.progress);
        g.discRule = 'evenodd';
        g.line = g.progress < 1 ? this.linesPath(view, frontLines(field, g.progress), field) : null;
        continue;
      }
      // (Patches need the field: without one, the change fades.)
      if (g.spec.style === 'dissolve') { g.advance = false; continue; }
      if (g.spec.style === 'border') {
        const bf = this.borderFront(view, arr, g, states);
        if (bf) {
          g.border = bf;
          g.disc = bf.reach(g.progress * bf.maxDist);
          g.discRule = 'nonzero';
          continue;
        }
        // The new owner held no land before: it grows from the middle, like an expansion.
      }
      let origin = g.spec.origin, maxDist = g.spec.maxDist;
      if (!origin || !maxDist) ({ origin, maxDist } = this.reachOf(arr, g.faces));
      const r = (g.progress * maxDist * 180) / Math.PI;
      if (r <= 0) continue;
      // From every starting point at once (D91): the circles together.
      const centres = g.spec.origins && g.spec.origins.length > 1 ? g.spec.origins : [origin];
      const disc = new Path2D();
      for (const o of centres) disc.addPath(new Path2D(geoPath(view.projection)(geoCircle().center(toLonLat(o)).radius(Math.min(r, 179.9)).precision(0.5)()) ?? ''));
      g.disc = disc;
      if (centres.length > 1) g.discRule = 'nonzero';
    }
    return { groups, of };
  }

  /** Fields of the changes under way, the last used last, with the cells they hold together. */
  private fieldCache = new Map<string, FrontField | null>();
  /** The heights fronts mind in the picture being drawn (D142); null: none do, or the map has none. */
  private frontGround: { grid: ElevationGrid; key: string; seaLevel: number } | null = null;
  private fieldCells = 0;

  /**
   * The field of a moving front (D136): worked out once for the change (kept while it is under way), from
   * where its front starts (front-source.ts). Null when the change cannot have one (round the whole planet).
   * As fine as the change is large on screen (a cell about two and a half pixels, in a few steps of fineness:
   * a small change far away takes a ninth of the work of one filling the view); a ragged front keeps its
   * pattern at every fineness.
   */
  private frontField(view: View, arr: Arrangement, g: TransitionGroup, states: Map<number, FaceState>): FrontField | null {
    const changing = g.changingFaces;
    if (!changing.length) return null;
    const kind = g.spec.style === 'advance' ? 'advance' : g.spec.style === 'dissolve' ? 'scatter' : 'border';
    const roughness = g.look.roughness;
    // (Minding the land, D142: the heights of the map and its sea, to the nearest 10 m; patches mind nothing.)
    const ground = kind !== 'scatter' && g.look.terrain > 0 ? this.frontGround : null;
    const origins = kind === 'advance' ? JSON.stringify(g.spec.origins ?? g.spec.origin ?? null) : '';
    const box = this.groupBox(view, arr, g, true);
    const want = Math.max(box[2], box[3]) / 2.5;
    const cells = FIELD_CELLS.find((c) => c >= want) ?? FIELD_CELLS[FIELD_CELLS.length - 1];
    const key = `${arr.spaceId}|${arr.revision}|${g.a.effectId}|${g.a.value}|${kind}|${origins}|${changing.length}|${changing[0]}|${changing[changing.length - 1]}|${roughness}|${cells}${ground ? `|${g.look.terrain}|${ground.key}|${ground.seaLevel}` : ''}`;
    let f = this.fieldCache.get(key);
    if (f === undefined) {
      const src = frontSourceOf(arr, changing, g.a.value, g.spec, kind, states);
      f = src ? buildFrontField(src.rings, src.source, { roughness, seed: seedOf(g.a.effectId), cells, slowAt: ground ? terrainSlowness(ground.grid, ground.seaLevel, g.look.terrain) : undefined }) : null;
      this.fieldCells += f ? f.nx * f.ny : 0;
    } else this.fieldCache.delete(key);
    this.fieldCache.set(key, f);
    // (Kept: as many as hold four million cells together, 600 at most; the longest unused go first.)
    while (this.fieldCache.size > 1 && (this.fieldCells > 4_000_000 || this.fieldCache.size > 600)) {
      const [old, gone] = this.fieldCache.entries().next().value!;
      this.fieldCache.delete(old);
      this.fieldCells -= gone ? gone.nx * gone.ny : 0;
    }
    return f;
  }

  /** The land a front has reached by `level` (0 to 1) on screen: its closed lines, filled by the even-odd rule; null when none. */
  private reachedPath(view: View, f: FrontField, level: number, smooth = true): Path2D | null {
    const rings = frontRings(f, level, smooth);
    if (!rings.length) return null;
    const direct = this.directProjection(view, f);
    if (direct) {
      const path = new Path2D();
      for (const r of rings) this.trail(path, r, direct, true);
      return path;
    }
    // (d3 wants each line round the land it holds on its right: one the other way round would hold the whole
    // planet. The lines go round clockwise in longitude and latitude, which is the right way unless one is huge.)
    const polys = rings.map((r) => {
      let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
      for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
      return e - w < 90 && n - s < 60 ? [r] : geoArea({ type: 'Polygon', coordinates: [r] }) > 2 * Math.PI ? [r.slice().reverse()] : [r];
    });
    // (Drawn straight into the path: no text made and read again.)
    const path = new Path2D();
    geoPath(view.projection, path as unknown as CanvasRenderingContext2D)({ type: 'MultiPolygon', coordinates: polys });
    return path;
  }

  /** Open lines (longitude and latitude) on screen; null when none. */
  private linesPath(view: View, lines: Rings, f: FrontField): Path2D | null {
    if (!lines.length) return null;
    const path = new Path2D();
    const direct = this.directProjection(view, f);
    if (direct) { for (const l of lines) this.trail(path, l, direct, false); return path; }
    geoPath(view.projection, path as unknown as CanvasRenderingContext2D)({ type: 'MultiLineString', coordinates: lines });
    return path;
  }

  /**
   * The view's projection used point by point for a front's lines, when nothing of the field lies across the edge
   * of the map (where d3 cuts lines in two) and the map is not the globe: much quicker than d3's paths, which
   * also cut and bend long lines (a front's lines are made of short pieces). Null: use d3's paths.
   */
  private directProjection(view: View, f: FrontField): GeoProjection | null {
    if (view.camera.projection === 'globe') return null;
    const mid = -(view.projection.rotate?.()[0] ?? 0);
    const a = ((((f.west - mid) % 360) + 540) % 360) - 180;
    return a > -179.9 && a + f.nx * f.dlon < 179.9 ? view.projection : null;
  }

  /** A line (longitude and latitude) added to a path through the projection, closed or not. */
  private trail(path: Path2D, line: Array<[number, number]>, project: GeoProjection, closed: boolean): void {
    let first = true;
    for (const p of line) {
      const q = project(p);
      if (!q) continue;
      if (first) { path.moveTo(q[0], q[1]); first = false; } else path.lineTo(q[0], q[1]);
    }
    if (closed && !first) path.closePath();
  }

  private reachCache = new Map<string, { origin: Vec3; maxDist: number }>();

  /** Where a front starts when the change has no recorded origin: the middle of the change, and how far it must go. */
  private reachOf(arr: Arrangement, faces: number[]): { origin: Vec3; maxDist: number } {
    const key = `${arr.spaceId}|${this.faceSet(arr, faces).key}`;
    const hit = this.reachCache.get(key);
    if (hit) return hit;
    let sx = 0, sy = 0, sz = 0;
    for (const f of faces) {
      const g = this.faceGeo(arr, f);
      const [lon, lat] = g.centroid.map((d) => (d * Math.PI) / 180);
      sx += g.area * Math.cos(lat) * Math.cos(lon); sy += g.area * Math.cos(lat) * Math.sin(lon); sz += g.area * Math.sin(lat);
    }
    const len = Math.hypot(sx, sy, sz) || 1;
    const origin: Vec3 = [sx / len, sy / len, sz / len];
    let maxDist = 1e-6;
    for (const f of faces) for (const ring of arr.faceRingsLonLat(f)) for (const [lon, lat] of ring) {
      const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
      const d = Math.acos(Math.max(-1, Math.min(1, origin[0] * Math.cos(la) * Math.cos(lo) + origin[1] * Math.cos(la) * Math.sin(lo) + origin[2] * Math.sin(la))));
      if (d > maxDist) maxDist = d;
    }
    const res = { origin, maxDist };
    if (this.reachCache.size > 64) this.reachCache.clear();
    this.reachCache.set(key, res);
    return res;
  }

  /** A straight front sweeping across the change in the shot's direction (in longitude/latitude). */
  private wipeShape(view: View, arr: Arrangement, g: TransitionGroup): Path2D | null {
    const ang = (((g.spec as CompiledTransition & { angle?: number }).angle ?? 0) * Math.PI) / 180;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let lo = Infinity, hi = -Infinity;
    for (const f of g.faces) for (const ring of arr.faceRingsLonLat(f)) for (const [lon, lat] of ring) {
      const u = lon * dx + lat * dy;
      if (u < lo) lo = u; if (u > hi) hi = u;
    }
    if (!(hi > lo)) return null;
    const u = lo + g.progress * (hi - lo);
    // The half of the longitude/latitude rectangle behind the front, densified so it follows the projection.
    const rect: Array<[number, number]> = [[-180, -90], [180, -90], [180, 90], [-180, 90]];
    const behind: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      const a = rect[i], b = rect[(i + 1) % 4];
      const ua = a[0] * dx + a[1] * dy - u, ub = b[0] * dx + b[1] * dy - u;
      if (ua <= 0) behind.push(a);
      if ((ua < 0) !== (ub < 0)) { const k = ua / (ua - ub); behind.push([a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])]); }
    }
    if (behind.length < 3) return null;
    const dense: Array<[number, number]> = [];
    for (let i = 0; i < behind.length; i++) {
      const a = behind[i], b = behind[(i + 1) % behind.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1));
      for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, Math.max(-89.999, Math.min(89.999, a[1] + ((b[1] - a[1]) * k) / n))]);
    }
    dense.push(dense[0]);
    // d3 wants the inside on the right (clockwise); try one way round and keep it if it is not inside-out.
    const poly = { type: 'Polygon' as const, coordinates: [dense.slice().reverse()] };
    const p = new Path2D(geoPath(view.projection)(geoArea(poly) > 2 * Math.PI ? { type: 'Polygon', coordinates: [dense] } : poly) ?? '');
    return p;
  }

  /**
   * Paint a change in progress over the previous owners (already painted), in the opaque layer
   * buffer: an advancing front fills the reached area with the new owner; a fade mixes the new
   * owner in. Territory that becomes nobody's is erased from the layer, never from the map below.
   */
  private drawTransition(lc: CanvasRenderingContext2D, g: TransitionGroup, paint: (c: CanvasRenderingContext2D, v: string | null, shape: Shape) => void, within: Shape | null = null, fx: FrontFx | null = null): void {
    if (!g.changing) return; // nothing changes owner, or none of it is in view
    // A soft edge (D137): the new owner's look running ahead of the front, even before it has reached anything.
    const soft = g.advance && !!g.field && !!fx && g.look.soft > 0.01 && g.progress < 1;
    if (g.advance && !g.disc && !soft) return; // the front has not reached anything yet
    // Painted over the changing parcels, or over them and the new owner's own parcels beside them
    // taken as one shape (see withOwnLand): two shapes painted apart leave a hairline of what was
    // under them along the edge they share (each covers its side of an edge pixel only in part).
    const area = within ?? g.changing;
    lc.save();
    // (Only round the change: the shapes cut to below can be far larger than it, a whole empire beside a village,
    // and cutting to them over the whole picture for each change under way took most of a frame.)
    if (fx) this.clipBox(lc, fx.box(2));
    if (g.advance) {
      // The area the front has reached (a union of shapes for a front from a border), within the changing parcels.
      this.clip(lc, area);
      if (g.disc) {
        if (g.discRule === 'nonzero') { lc.save(); lc.clip(g.disc, 'nonzero'); paint(lc, g.a.value, area); lc.restore(); }
        else paint(lc, g.a.value, { path: g.disc, onSheet: false });
      }
      if (soft) this.softEdge(lc, g, paint, area, fx!);
    } else {
      lc.globalAlpha = Math.min(1, Math.max(0, g.progress));
      paint(lc, g.a.value, area);
    }
    lc.restore();
  }

  /** Device pixels a front travels from 0 to 1 (`f.travel` degrees of arc at the view's scale). */
  private levelPixels(f: FrontField, fx: FrontFx): number {
    return ((f.travel * Math.PI) / 180) * fx.view.projection.scale() * fx.k;
  }

  /**
   * A soft mask over `box` (device pixels of `ref`): what `draw` lays on (with `ref`'s transform), blurred by `sigma`
   * device pixels. Made at a fraction of the size when the blur is wide (`s` device pixels to one of it): cheaper,
   * and the same to the eye. The part of the buffer used is `w` by `h`.
   */
  private softMask(ref: CanvasRenderingContext2D, box: Box2, sigma: number, draw: (m: CanvasRenderingContext2D) => void): { c: CanvasRenderingContext2D; w: number; h: number; s: number } {
    const [bx, by, bw, bh] = box;
    const s = Math.max(1, Math.min(4, Math.floor(sigma / 2)));
    const w = Math.max(1, Math.ceil(bw / s)), h = Math.max(1, Math.ceil(bh / s));
    const m = this.boxBuffer(ref, [bx, by, w, h]);
    const t = ref.getTransform();
    m.setTransform(t.a / s, t.b / s, t.c / s, t.d / s, (t.e - bx) / s, (t.f - by) / s);
    draw(m);
    const b = this.boxBuffer(ref, [bx, by, w, h]);
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.filter = `blur(${(sigma / s).toFixed(2)}px)`;
    b.drawImage(m.canvas as CanvasImageSource, 0, 0, w, h, 0, 0, w, h);
    b.filter = 'none';
    return { c: b, w, h, s };
  }

  /**
   * The new owner's look running softly ahead of the front (D137): over the land the front reaches a little later,
   * the later the fainter (six steps, softened), within the change (`lc` is clipped to it). Land given up to
   * nobody is let go of softly instead.
   */
  private softEdge(lc: CanvasRenderingContext2D, g: TransitionGroup, paint: (c: CanvasRenderingContext2D, v: string | null, shape: Shape) => void, area: Shape, fx: FrontFx): void {
    const f = g.field!, p = g.progress, span = g.look.soft * 0.25, K = 6;
    const sigma = Math.min(48, Math.max(0.6, (span / K) * this.levelPixels(f, fx) * 0.6));
    // (Only round the land the soft edge covers.)
    const deg = bandBounds(f, p, p + span);
    if (!deg) return;
    const box = fx.part(deg, (3 * sigma) / fx.k + 2);
    const [bx, by, bw, bh] = box;
    if (bw <= 0 || bh <= 0) return;
    let any = false;
    const mask = this.softMask(lc, box, sigma, (m) => {
      m.globalCompositeOperation = 'lighter';
      m.fillStyle = '#000';
      m.globalAlpha = 1 / (K + 1);
      for (let i = 1; i <= K; i++) {
        const path = this.reachedPath(fx.view, f, Math.min(1, p + (span * i) / K), false);
        if (path) { m.fill(path, 'evenodd'); any = true; }
      }
    });
    if (!any) return;
    const { c: mc, w, h, s } = mask;
    if (g.a.value) {
      const o = this.boxBuffer(lc, box);
      o.save();
      this.clip(o, area);
      // (Shapes are painted block by block where drawing is going on, which is told in the picture's own
      // pixels: the buffer's lie `bx`, `by` from them. Left as it was, blocks of the new owner's shape were
      // skipped whenever only part of a kept picture was drawn again, and the soft edge had holes.)
      setPaintRegion(this.region ? this.region.map(([x, y, rw, rh]) => [x - bx, y - by, rw, rh] as DeviceRect) : null);
      try { paint(o, g.a.value, area); } finally { setPaintRegion(this.region); }
      o.restore();
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'destination-in';
      o.drawImage(mc.canvas as CanvasImageSource, 0, 0, w, h, 0, 0, w * s, h * s);
      o.restore();
      this.layOn(lc, o, 1, box);
    } else {
      lc.save();
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'destination-out';
      lc.drawImage(mc.canvas as CanvasImageSource, 0, 0, w, h, bx, by, w * s, h * s);
      lc.restore();
    }
  }

  /**
   * A glow over the land a front has just taken (D137): brightest at the front, fading over the land reached
   * before (five steps back, softened), cut sharply at the front, laid on lightening what is under it. `c` is
   * clipped to the change.
   */
  private drawWake(c: CanvasRenderingContext2D, g: TransitionGroup, fx: FrontFx, color: string): void {
    const f = g.field!, p = g.progress, span = g.look.wake * 0.35, K = 5;
    const disc = g.disc;
    if (!disc) return;
    const sigma = Math.min(48, Math.max(0.6, (span / K) * this.levelPixels(f, fx) * 0.6));
    // (Only round the land the glow covers.)
    const deg = bandBounds(f, p - span, Math.min(1, p + 0.1));
    if (!deg) return;
    const box = fx.part(deg, (3 * sigma) / fx.k + 2);
    if (box[2] <= 0 || box[3] <= 0) return;
    // (The glow is laid a little past the front before it is softened, then cut at the front: brightest there.)
    const ahead = Math.min(0.1, (2 * sigma) / Math.max(1, this.levelPixels(f, fx)));
    const outer = this.reachedPath(fx.view, f, Math.min(1, p + ahead), false) ?? disc;
    const { c: mc, w, h, s } = this.softMask(c, box, sigma, (m) => {
      m.globalCompositeOperation = 'lighter';
      m.fillStyle = color;
      m.globalAlpha = 1 / K;
      for (let i = 1; i <= K; i++) {
        // The land reached since a little earlier: what is reached now less what was reached then.
        const band = new Path2D();
        band.addPath(outer);
        const back = this.reachedPath(fx.view, f, p - (span * i) / K, false);
        if (back) band.addPath(back);
        m.fill(band, 'evenodd');
      }
    });
    const o = this.boxBuffer(c, box);
    o.save();
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.drawImage(mc.canvas as CanvasImageSource, 0, 0, w, h, 0, 0, w * s, h * s);
    o.restore();
    o.globalCompositeOperation = 'destination-in';
    o.fill(disc, 'evenodd');
    o.globalCompositeOperation = 'source-over';
    c.save();
    c.globalCompositeOperation = 'screen';
    this.layOn(c, o, 0.3 + 0.6 * g.look.wake, box);
    c.restore();
  }

  /**
   * The globe (D127): the part of the planet in view drawn flat (an equirectangular picture, by a
   * renderer of its own, as many pixels to a radian as the globe has at its middle) and laid onto the
   * sphere by the graphics card (globe-gl.ts). Country and city names are placed on the flat picture
   * and drawn upright over the sphere, where their places are, placed again so that none overlap.
   */
  private renderGlobe(ctx: CanvasRenderingContext2D, view: View, world: World, engine: Engine, spaceId: string, t: Instant, opts: RenderOptions): void {
    const started = performance.now();
    const style = opts.style ?? DEFAULT_STYLE;
    const m = ctx.getTransform();
    const k = Math.hypot(m.a, m.b) || 1;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cam = view.camera, RAD = Math.PI / 180;
    const Rv = view.projection.scale(), R = Rv * k;
    const cx = m.a * (view.width / 2) + m.c * (view.height / 2) + m.e, cy = m.b * (view.width / 2) + m.d * (view.height / 2) + m.f;
    const lat0d = Math.max(-89.9, Math.min(89.9, cam.lat));
    const lon0 = cam.lon * RAD, lat0 = lat0d * RAD, roll = (view.rotation ?? 0) * RAD + Math.atan2(m.b, m.a);
    // The frame's area is cleared (as any frame not opening with a kept picture).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fx0 = Math.max(0, Math.floor(m.e)), fy0 = Math.max(0, Math.floor(m.f));
    const fx1 = Math.min(W, Math.ceil(m.e + m.a * view.width)), fy1 = Math.min(H, Math.ceil(m.f + m.d * view.height));
    ctx.clearRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
    ctx.restore();
    this.lastLabels = []; this.lastCities = []; this.lastCharacters = []; this.lastFeatures = []; this.lastTransitions = []; this.lastFronts = [];
    this.lastApproximate = false; this.lastParts = { globe: 'drawn' };
    const gl = globeGL();
    // (Without WebGL2 there is no globe: the flat map, centred on the same place, rather than nothing.)
    if (!gl) { this.lastGlobe = null; this.render(ctx, makeView({ ...cam, projection: 'equirectangular' }, view.width, view.height), world, engine, spaceId, t, opts); return; }
    const area = globeInView(W, H, cx, cy, R, lon0, lat0, roll);
    if (!area) { this.lastGlobe = null; return; }
    // What the flat picture shows (it is drawn again when any of this changes).
    const steady = `${engine.revision}|${world.revision}|${spaceId}|${[...opts.passes].join(',')}|${opts.layerIds.join(',')}|${opts.transparent ? 1 : 0}|${opts.basemap ? `${opts.basemap.version}|${opts.basemap.scales.length}` : '-'}|${JSON.stringify(opts.style ?? null)}|${JSON.stringify(opts.basemapStyle ?? null)}|${JSON.stringify(opts.show ?? null)}|${opts.terrain ? `${JSON.stringify(opts.terrain.look)}|${opts.terrain.detail?.key ?? ''}|${opts.terrain.photo?.key ?? ''}|${opts.terrain.seaLevel ?? 0}` : '-'}|${JSON.stringify(opts.transitions ?? null)}|${opts.trails ? `1${opts.trailsSince ? `:${opts.trailsSince.day},${opts.trailsSince.ms}` : ''}` : 0}|${JSON.stringify(opts.layout ?? null)}|${opts.hurried ? 1 : 0}|${assetEpoch()}|${view.unit * k}`;
    // (Video fills follow the shot's clock: a moment of their own, see timeMoves.)
    const content = `${steady}|${t.day}|${t.ms}|${opts.mediaSeconds ?? 0}`;
    // The flat picture: around the middle of what is in view (on a grid of 2 degrees, and its pixels to a
    // radian on steps of an eighth of a doubling, so that the same picture serves while the globe turns a
    // little), within what the graphics card takes.
    const STEP = 2 * RAD;
    let west: number, east: number;
    if (area.round) { west = -Math.PI; east = Math.PI; }
    else { west = Math.floor((lon0 + area.west) / STEP) * STEP; east = Math.ceil((lon0 + area.east) / STEP) * STEP; }
    const south = Math.max(-Math.PI / 2, Math.floor(area.south / STEP) * STEP), north = Math.min(Math.PI / 2, Math.ceil(area.north / STEP) * STEP);
    const limit = Math.min(gl.maxTexture, 8192);
    let perRad = 2 ** (Math.ceil(Math.log2(Math.max(1, R)) * 8) / 8);
    perRad = Math.min(perRad, limit / (east - west), limit / (north - south), Math.sqrt(40e6 / ((east - west) * (north - south))));
    let pw = Math.max(2, Math.ceil((east - west) * perRad)), ph = Math.max(2, Math.ceil((north - south) * perRad));
    // (All the way round: exactly, so the picture's two ends meet.)
    if (area.round) perRad = pw / (2 * Math.PI);
    let lonMid = (west + east) / 2, latMid = (north + south) / 2;
    // The last picture serves again: when it is this very picture, or while the view moves, when it
    // holds all that is in view and is about as sharp (the view is drawn afresh once it rests).
    const last = this.globeLast;
    let reuse = false;
    if (last && last.content === content) {
      if (last.pw === pw && last.ph === ph && last.lonMid === lonMid && last.latMid === latMid && last.perRad === perRad) reuse = true;
      else if (opts.moving && last.perRad >= 0.6 * R && last.perRad <= 2.5 * R && area.south >= last.south && area.north <= last.north) {
        const d = ((((lon0 + area.west - last.west) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
        if (last.round || d + (area.east - area.west) <= last.east - last.west) { reuse = true; this.lastApproximate = true; }
      }
    }
    const inner = (this.globeFlat ??= new MapRenderer());
    let pc = this.globePicture;
    if (reuse && last && pc) ({ pw, ph, lonMid, latMid, perRad } = last);
    else {
      const flatCam: Camera = { lon: lonMid / RAD, lat: latMid / RAD, zoom: 0, rotation: 0, projection: 'equirectangular' };
      // (makeView fits 0.96 of the world's width at zoom 0: the zoom that gives perRad.)
      const unitWorld = 2 * Math.PI * (359.998 / 360);
      flatCam.zoom = Math.log2((perRad * unitWorld) / (0.96 * pw));
      const flat = makeView(flatCam, pw, ph);
      // Lines and names as wide and as large at the globe's middle as on a flat map of the frame's size.
      flat.unit = view.unit * k * (perRad / R);
      flat.key += `|u${flat.unit.toFixed(5)}`;
      if (!pc || pc.canvas.width !== pw || pc.canvas.height !== ph) {
        const canvas = new OffscreenCanvas(pw, ph);
        pc = this.globePicture = { canvas, ctx: canvas.getContext('2d') as unknown as CanvasRenderingContext2D };
      }
      pc.ctx.setTransform(1, 0, 0, 1, 0, 0);
      pc.ctx.clearRect(0, 0, pw, ph);
      inner.quality = this.quality;
      inner.caching = this.caching === 'off' ? 'off' : 'always';
      inner.render(pc.ctx, flat, world, engine, spaceId, t, { ...opts, moving: false, holdNames: false, fillAround: false, textsApart: true });
      this.globeLast = { content, west: area.round ? -Math.PI : lon0 + area.west, east: area.round ? Math.PI : lon0 + area.east, south: area.south, north: area.north, round: area.round, pw, ph, lonMid, latMid, perRad };
      if (area.round) Object.assign(this.globeLast, { west, east, south, north });
    }
    const textsWanted = opts.passes.has('labels') || opts.passes.has('cities');
    this.lastTransitions = inner.lastTransitions;
    this.lastFronts = inner.lastFronts;
    // Between two changes, with nothing on the flat picture moving (no change animating, no character on
    // its way, no areas, lines or points, which may animate, no conditions, no video fills, every part of
    // it kept), the picture is the one drawn last: it is not sent to the graphics card again, and for the
    // same view of it the whole frame, names included, is the one drawn last.
    const still = !reuse && inner.lastTransitions.length === 0 && !inner.lastCharacters.some((c) => c.moving) && inner.lastFeatures.length === 0
      && Object.values(inner.lastParts).every((v) => v === 'kept') && !this.timeMoves(world, spaceId);
    const pictureKey = `${steady}|${engine.stretchOf(t)}|${pw}x${ph}|${lonMid}|${latMid}|${perRad}`;
    const frameKey = `${pictureKey}|${W}x${H}|${cx}|${cy}|${R}|${lon0}|${lat0}|${roll}`;
    const keptFrame = this.globeFrame;
    if (still && keptFrame && keptFrame.key === frameKey) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(keptFrame.canvas as unknown as CanvasImageSource, 0, 0);
      ctx.restore();
      this.lastLabels = keptFrame.labels;
      this.lastCities = keptFrame.cities;
      this.lastGlobe = { picture: [pw, ph], perRad, round: area.round, ms: performance.now() - started, reused: true };
      return;
    }
    const upload = !reuse && !(still && this.globeUploaded === pictureKey);
    // The sphere: lit, and in a picture with a background, with the air's glow and space around it.
    const background = opts.passes.has('background') && !opts.transparent;
    const ocean = parseCss(style.ocean) ?? [20, 50, 74];
    const air: [number, number, number] = [0.55 + 0.45 * (ocean[0] / 255) * 0.3, 0.72 + 0.28 * (ocean[1] / 255) * 0.3, 0.95];
    const out = gl.draw(
      { image: pc!.canvas, width: pw, height: ph, lonMid, latMid, perRad, round: reuse && last ? last.round : area.round },
      {
        width: W, height: H, cx, cy, R, lon0, lat0, roll, shade: 0.55,
        air: background ? { rgb: air, width: Math.max(4, 0.06 * R) } : null,
        space: background ? [(ocean[0] / 255) * 0.22, (ocean[1] / 255) * 0.22, (ocean[2] / 255) * 0.26, 1] : null,
      },
      upload,
    );
    if (upload) this.globeUploaded = still ? pictureKey : null;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(out as unknown as CanvasImageSource, 0, 0);
    ctx.restore();
    // Names over the sphere, upright: from their places on the flat picture, where those face the viewer.
    if (textsWanted) {
      const toLonLat = (x: number, y: number): [number, number] => [(lonMid + (x - pw / 2) / perRad) / RAD, (latMid - (y - ph / 2) / perRad) / RAD];
      const c0 = Math.cos(lat0), s0 = Math.sin(lat0);
      const facing = (lon: number, lat: number) => { const la = lat * RAD; return s0 * Math.sin(la) + c0 * Math.cos(la) * Math.cos(lon * RAD - lon0); };
      const f = Rv / perRad; // view pixels for a pixel of the flat picture, at the globe's middle
      const labels: LabelInfo[] = [];
      for (const l of inner.lastLabels) {
        const [lon, lat] = toLonLat(l.x, l.y);
        // (Names far round towards the edge fade out, and are left out where they would lie on land seen
        // edge-on: a turning globe brings them in and takes them away gently.)
        const fc = facing(lon, lat);
        if (fc < 0.2) continue;
        const p = view.projection([lon, lat]);
        if (!p) continue;
        const fade = Math.min(1, (fc - 0.2) / 0.25);
        labels.push({ ...l, x: p[0], y: p[1], size: l.size * f, drawn: false, box: undefined, style: fade < 1 ? { ...l.style, opacity: l.style.opacity * fade } : l.style });
      }
      const cities: CityItem[] = [];
      for (const c of inner.lastCityItems) {
        if (facing(c.lon, c.lat) < 0.15) continue;
        const p = view.projection([c.lon, c.lat]);
        if (!p) continue;
        cities.push({ ...c, x: p[0], y: p[1], tx: p[0], ty: p[1], r: c.r * f, size: c.size * f, drawn: false, box: undefined });
      }
      ctx.save();
      if (view.rotation) {
        ctx.translate(view.width / 2, view.height / 2);
        ctx.rotate((view.rotation * Math.PI) / 180);
        ctx.translate(-view.width / 2, -view.height / 2);
      }
      this.placeTexts(ctx, labels, cities, view.rotation ? null : [view.width, view.height], opts.keepOut);
      if (opts.passes.has('cities')) this.drawCities(ctx, cities, view.unit);
      if (opts.passes.has('labels')) this.drawLabels(ctx, labels, style, view.unit);
      ctx.restore();
      this.lastLabels = labels;
      this.lastCities = cities.map((c) => ({ entity: c.entity, name: c.name, x: c.x, y: c.y, lon: c.lon, lat: c.lat, moving: false, named: c.drawn, box: c.box }));
    }
    if (still) {
      let fc = this.globeFrame?.canvas ?? null;
      if (!fc || fc.width !== W || fc.height !== H) fc = new OffscreenCanvas(W, H);
      const fx = fc.getContext('2d') as unknown as CanvasRenderingContext2D;
      fx.setTransform(1, 0, 0, 1, 0, 0);
      fx.clearRect(0, 0, W, H);
      fx.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
      this.globeFrame = { key: frameKey, canvas: fc, labels: this.lastLabels, cities: this.lastCities };
    } else this.globeFrame = null;
    this.lastGlobe = { picture: [pw, ph], perRad, round: reuse && last ? last.round : area.round, ms: performance.now() - started, reused: reuse || !upload };
  }

  private timeMovesKey = '';
  private timeMovesValue = false;
  /** Whether anything of a map changes from moment to moment apart from its changes: conditions, or video fills. */
  private timeMoves(world: World, spaceId: string): boolean {
    const key = `${world.revision}|${spaceId}`;
    if (key !== this.timeMovesKey) {
      this.timeMovesKey = key;
      this.timeMovesValue = world.all('layer').some((l) => l.kind === 'field' && l.space_id === spaceId)
        || world.all('entity').some((e) => typeof e.style === 'string' && e.style.includes('"video"'));
    }
    return this.timeMovesValue;
  }

  private ownLandCache = new Map<string, number[]>();

  /**
   * The parcels a change gives to its new owner together with the owner's parcels beside them (as
   * one shape, its outline taken as a whole): painting the owner's colour over both leaves no seam
   * along the old border between them as the front crosses it. Null when the owner holds none beside the change.
   */
  private withOwnLand(sp: SheetParcels, sheet: Sheet, arr: Arrangement, snap: LayerSnap, id: string, g: TransitionGroup): Shape | null {
    const key = `${snap.key}|${id}`;
    let faces = this.ownLandCache.get(key);
    if (!faces) {
      const owner = g.a.value, geom = parcelGeometry(arr), t = arr.topology();
      const inChange = new Set(g.changingFaces), beside = new Set<number>();
      for (const f of g.changingFaces) for (const c of t.facesCycles.get(f) ?? []) for (const h of geom.cycle(c, t).heads) {
        const o = arr.halfEdgeFace(h ^ 1);
        if (inChange.has(o) || beside.has(o)) continue;
        const st = snap.states.get(o);
        if (st && (st.transition ? st.transition.from : st.value) === owner) beside.add(o);
      }
      faces = beside.size ? [...g.changingFaces, ...[...beside].sort((x, y) => x - y)] : [];
      if (this.ownLandCache.size > 256) this.ownLandCache.clear();
      this.ownLandCache.set(key, faces);
    }
    return faces.length ? this.setPath(sp, sheet, arr, this.faceSet(arr, faces)) : null;
  }

  private borderCache = new Map<string, { lonlat: Float64Array; line: boolean } | null>();
  private borderViewCache = new Map<string, BorderFront | null>();
  private borderViewKey = '';

  /**
   * An advancing front from a border: the changing parcels are reached outward from the border they
   * share with the new owner's land (as it was before the change). A piece that does not touch that
   * land grows from its side facing the owner's nearest land, as a straight front. Null when the new
   * owner held no land before the change.
   */
  private borderFront(view: View, arr: Arrangement, g: TransitionGroup, states: Map<number, FaceState>): BorderFront | null {
    const owner = g.a.value;
    if (!owner) return null;
    const changing = g.changingFaces;
    if (!changing.length) return null;
    const key = `${arr.spaceId}|${arr.revision}|${g.a.effectId}|${owner}|${changing.length}|${changing[0]}|${changing[changing.length - 1]}`;
    // 1. The source, in longitude/latitude (independent of the view): the shared border, or failing that
    //    the point of the change nearest to the owner's land and the direction it lies in.
    let src = this.borderCache.get(key);
    if (src === undefined) {
      const inChange = new Set(changing);
      const held = new Set<number>();
      for (const [f, st] of states) if ((st.transition ? st.transition.from : st.value) === owner && !inChange.has(f)) held.add(f);
      const pts: number[] = [];
      for (const sg of arr.segments.values()) {
        const l = sg.left_face, r = sg.right_face;
        if ((inChange.has(l) && held.has(r)) || (inChange.has(r) && held.has(l))) {
          const a = arr.vertices.get(sg.a)!, b = arr.vertices.get(sg.b)!;
          pts.push(a.lon / 1e7, a.lat / 1e7, b.lon / 1e7, b.lat / 1e7);
        }
      }
      if (pts.length) src = { lonlat: Float64Array.from(pts), line: false };
      else if (held.size) {
        // Not touching: the nearest pair of points between the change and the owner's land.
        const sample = (faces: Iterable<number>, max: number) => {
          const all: Array<[number, number]> = [];
          for (const f of faces) for (const ring of arr.faceRingsLonLat(f)) for (const p of ring) all.push(p);
          const step = Math.max(1, Math.floor(all.length / max));
          return all.filter((_, i) => i % step === 0);
        };
        const cs = sample(changing, 300), hs = sample(held, 3000);
        // (Each point's direction is worked out once, not once for every pair: a million pairs.)
        const dirs = (pts: Array<[number, number]>) => { const o = new Float64Array(3 * pts.length); pts.forEach((q, i) => { const v = vec3(q); o[3 * i] = v[0]; o[3 * i + 1] = v[1]; o[3 * i + 2] = v[2]; }); return o; };
        const vc = dirs(cs), vh = dirs(hs);
        let best = Infinity, ic = 0, ih = 0;
        for (let i = 0; i < cs.length; i++) {
          const x = vc[3 * i], y = vc[3 * i + 1], z = vc[3 * i + 2];
          for (let j = 0; j < hs.length; j++) { const d = -(x * vh[3 * j] + y * vh[3 * j + 1] + z * vh[3 * j + 2]); if (d < best) { best = d; ic = i; ih = j; } }
        }
        const pc = cs[ic], ph = hs[ih];
        src = { lonlat: Float64Array.from([pc[0], pc[1], ph[0], ph[1]]), line: true };
      } else src = null;
      if (this.borderCache.size > 200) this.borderCache.clear();
      this.borderCache.set(key, src);
    }
    if (!src) return null;
    // 2. On screen: the source segments, and how far the front must travel to cover the change.
    if (view.key !== this.borderViewKey) { this.borderViewCache.clear(); this.borderViewKey = view.key; }
    const vk = key;
    let bf = this.borderViewCache.get(vk);
    if (bf !== undefined) return bf;
    const P = (lon: number, lat: number) => view.projection([lon, lat]);
    const changePts: Array<[number, number]> = [];
    for (const f of changing) for (const ring of arr.faceRingsLonLat(f)) for (const [lon, lat] of ring) { const q = P(lon, lat); if (q) changePts.push(q as [number, number]); }
    if (!changePts.length) { this.borderViewCache.set(vk, null); return null; }
    let segs: number[] = [];
    if (!src.line) {
      for (let i = 0; i < src.lonlat.length; i += 4) {
        const a = P(src.lonlat[i], src.lonlat[i + 1]), b = P(src.lonlat[i + 2], src.lonlat[i + 3]);
        if (a && b) segs.push(a[0], a[1], b[0], b[1]);
      }
    } else {
      // A straight front across the change, at its point nearest the owner's land, facing that land.
      const c = P(src.lonlat[0], src.lonlat[1]), h = P(src.lonlat[2], src.lonlat[3]);
      if (c && h) {
        let dx = h[0] - c[0], dy = h[1] - c[1];
        const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of changePts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
        const half = Math.hypot(x1 - x0, y1 - y0) + 10;
        segs = [c[0] - dy * half, c[1] + dx * half, c[0] + dy * half, c[1] - dx * half];
      }
    }
    if (!segs.length) { this.borderViewCache.set(vk, null); return null; }
    // Fewer, longer pieces for drawing (a pixel apart at most).
    const simplified: number[] = [];
    for (let i = 0; i < segs.length; i += 4) {
      const n = simplified.length;
      if (n && Math.hypot(simplified[n - 2] - segs[i], simplified[n - 1] - segs[i + 1]) < 1e-9 && Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]) < 1.5) {
        simplified[n - 2] = segs[i + 2]; simplified[n - 1] = segs[i + 3];
        continue;
      }
      simplified.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
    }
    const S = Float64Array.from(simplified);
    // The farthest point of the change from the source (sampled), plus a margin.
    const step = Math.max(1, Math.floor(changePts.length / 500));
    const sstep = Math.max(1, Math.floor(S.length / 4 / 500)) * 4;
    let maxDist = 1;
    for (let i = 0; i < changePts.length; i += step) {
      const [x, y] = changePts[i];
      let m = Infinity;
      for (let k = 0; k < S.length; k += sstep) m = Math.min(m, segDist(x, y, S[k], S[k + 1], S[k + 2], S[k + 3]));
      if (m > maxDist) maxDist = m;
    }
    maxDist *= 1.04;
    bf = {
      maxDist,
      reach: (r: number) => {
        const p = new Path2D();
        if (r <= 0) return p;
        // Every piece of the source widened by r: a rectangle along it and a circle at each end, all
        // wound the same way so that filled with the nonzero rule they make one area. (None is closed
        // with closePath: in Chrome each closePath takes time in proportion to the whole path so far,
        // and a long border made this the dearest part of every frame of an advancing front. A
        // rectangle goes back to its first corner instead; a circle ends where it began.)
        let lx = NaN, ly = NaN;
        const minLen = Math.max(0.5, r / 6);
        for (let i = 0; i < S.length; i += 4) {
          const ax = S[i], ay = S[i + 1], bx = S[i + 2], by = S[i + 3];
          const L = Math.hypot(bx - ax, by - ay);
          if (L > 1e-9) {
            const nx = (-(by - ay) / L) * r, ny = ((bx - ax) / L) * r;
            const quad: Array<[number, number]> = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
            let area = 0;
            for (let k = 0; k < 4; k++) { const u = quad[k], v = quad[(k + 1) % 4]; area += u[0] * v[1] - v[0] * u[1]; }
            if (area < 0) quad.reverse();
            p.moveTo(quad[0][0], quad[0][1]);
            for (let k = 1; k < 4; k++) p.lineTo(quad[k][0], quad[k][1]);
            p.lineTo(quad[0][0], quad[0][1]);
          }
          for (const [x, y] of [[ax, ay], [bx, by]]) {
            if (Math.hypot(x - lx, y - ly) < minLen) continue;
            p.moveTo(x + r, y);
            p.arc(x, y, r, 0, Math.PI * 2, false);
            lx = x; ly = y;
          }
        }
        return p;
      },
    };
    this.borderViewCache.set(vk, bf);
    return bf;
  }


  /**
   * The screen rectangle of a set of parcels (the whole view for a parcel covering the rest of the
   * planet): from the boxes of their outlines, each taken at the turn nearest the camera.
   */
  private screenBox(view: View, arr: Arrangement, faces: number[]): Box2 {
    const whole: Box2 = [0, 0, view.width, view.height];
    if (!faces.length) return whole;
    const geom = parcelGeometry(arr), t = arr.topology();
    const acc: Box2 = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of faces) {
      if (geom.needsOutline(f)) return whole;
      for (const c of t.facesCycles.get(f) ?? []) this.boxOnScreen(view, geom.cycle(c, t).box, acc);
    }
    const [x0, y0, x1, y1] = acc;
    return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : whole;
  }

  /**
   * The boxes on screen (x0, y0, x1, y1) of a box given in degrees (west, south, east, north;
   * longitudes may be unwrapped): one for each copy of the world it shows in. On a map that repeats
   * east and west, the copies a turn either way; on one drawn inside the planet's outline, the parts
   * either side of the outline's edge.
   */
  private boxesOnScreen(view: View, box: readonly [number, number, number, number]): Box2[] {
    const kind = view.camera.projection, flat = kind === 'flat', ref = flat ? 0 : meridianOf(view.camera);
    const s = view.projection.scale(), [tx, ty] = view.projection.translate();
    const [w, so, e, n] = box;
    const turn = flat ? 0 : 360 * Math.round((ref - (w + e) / 2) / 360);
    const a = w + turn - ref, b = e + turn - ref;
    // The corners, and the latitude nearest the equator (where the map is widest).
    const mid = so > 0 ? so : n < 0 ? n : 0;
    const out: Box2[] = [];
    const one = (lo: number, hi: number) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const lat of [so, n, mid]) for (const lon of [lo, hi]) {
        const [px, py] = projectPoint(kind, lon, lat);
        const x = tx + s * px, y = ty + s * py;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
      if (x1 >= 0 && y1 >= 0 && x0 <= view.width && y0 <= view.height) out.push([x0, y0, x1, y1]);
    };
    if (flat) one(a, b);
    else if (isCylindrical(kind)) for (const k of [-1, 0, 1]) one(a + 360 * k, b + 360 * k);
    else for (const k of [-1, 0, 1]) { const lo = Math.max(-180, a + 360 * k), hi = Math.min(180, b + 360 * k); if (hi > lo) one(lo, hi); }
    return out;
  }

  /** Join a rectangle of canvas pixels (x0, y0, x1, y1) to a short list of them: with one it nearly fills together with, or (beyond six) with any. */
  private joinRect(list: number[][], add: number[], most = 6): void {
    const area = (q: number[]) => (q[2] - q[0]) * (q[3] - q[1]);
    let box = add;
    for (let again = true; again;) {
      again = false;
      for (let j = 0; j < list.length; j++) {
        const o = list[j];
        const u = [Math.min(o[0], box[0]), Math.min(o[1], box[1]), Math.max(o[2], box[2]), Math.max(o[3], box[3])];
        if (area(u) <= 1.3 * (area(o) + area(box)) + 4096 || list.length >= most) { list.splice(j, 1); box = u; again = true; break; }
      }
    }
    list.push(box);
  }

  /** Join to `list` the rectangles of the canvas that a box in degrees shows in, grown by `pad` view pixels. */
  private joinBox(list: number[][], view: View, box: readonly [number, number, number, number], m: DOMMatrix, pad: number, width: number, height: number, most = 6): void {
    for (const sb of this.boxesOnScreen(view, box)) {
      const d = this.deviceBox([sb[0], sb[1], sb[2] - sb[0], sb[3] - sb[1]], m, pad, width, height);
      if (d[2] > 0 && d[3] > 0) this.joinRect(list, [d[0], d[1], d[0] + d[2], d[1] + d[3]], most);
    }
  }

  /** Join to `list` the rectangles of the canvas a parcel shows in; false when it has none to give (it takes in the rest of the planet). */
  private joinFace(list: number[][], view: View, arr: Arrangement, face: number, m: DOMMatrix, pad: number, width: number, height: number): boolean {
    const geom = parcelGeometry(arr), t = arr.topology();
    if (geom.needsOutline(face)) return false;
    for (const c of t.facesCycles.get(face) ?? []) {
      const g = geom.cycle(c, t);
      if (g.wind !== 0) return false;
      this.joinBox(list, view, g.box, m, pad, width, height);
    }
    return true;
  }

  /** Grow `acc` (x0, y0, x1, y1 on screen) to hold a box given in degrees (west, south, east, north; longitudes may be unwrapped). */
  private boxOnScreen(view: View, box: readonly [number, number, number, number], acc: Box2): void {
    const kind = view.camera.projection, flat = kind === 'flat', ref = flat ? 0 : meridianOf(view.camera);
    const s = view.projection.scale(), [tx, ty] = view.projection.translate();
    const [w, so, e, n] = box;
    const turn = flat ? 0 : 360 * Math.round((ref - (w + e) / 2) / 360);
    const lo = Math.max(-180, w + turn - ref), hi = Math.min(180, e + turn - ref);
    // The corners, and the latitude nearest the equator (where the map is widest).
    const mid = so > 0 ? so : n < 0 ? n : 0;
    for (const lat of [so, n, mid]) for (const lon of [lo, hi]) {
      const [px, py] = projectPoint(kind, lon, lat);
      const x = tx + s * px, y = ty + s * py;
      if (x < acc[0]) acc[0] = x; if (y < acc[1]) acc[1] = y; if (x > acc[2]) acc[2] = x; if (y > acc[3]) acc[3] = y;
    }
  }

  /** A box of the view in the canvas's own pixels (under the frame's transform), grown by `pad` and kept inside the canvas. */
  private deviceBox(box: Box2, m: DOMMatrix, pad: number, width: number, height: number, beyond = 0): Box2 {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]]) {
      const dx = m.a * x + m.c * y + m.e, dy = m.b * x + m.d * y + m.f;
      if (dx < x0) x0 = dx; if (dx > x1) x1 = dx; if (dy < y0) y0 = dy; if (dy > y1) y1 = dy;
    }
    const k = Math.hypot(m.a, m.b) || 1;
    // (`beyond`: so many pixels past the canvas's edges are kept, for what is blurred and must not end at an edge.)
    x0 = Math.max(-beyond, Math.floor(x0 - pad * k)); y0 = Math.max(-beyond, Math.floor(y0 - pad * k));
    x1 = Math.min(width + beyond, Math.ceil(x1 + pad * k)); y1 = Math.min(height + beyond, Math.ceil(y1 + pad * k));
    return [x0, y0, x1 - x0, y1 - y0];
  }

  /**
   * The clusters of an owner's pieces that share a copy of its picture (D82), largest first: each
   * with its parcels (the owner's whole set when there is one cluster) and its box in degrees.
   * Pieces are the owner's parcels that touch; kept per set of parcels and rule.
   */
  private fillClusters(arr: Arrangement, set: FaceSet, fill: CountryFillLike): Array<{ set: FaceSet; box: GeoBox; core: GeoBox }> {
    const rule = `${fill.pieces ?? 'auto'}${fill.pieces === 'near' ? `:${fill.gapKm ?? 500}` : ''}`;
    const key = `${set.key}|${rule}`;
    const hit = this.clusterCache.get(key);
    if (hit && hit.arr === arr) return hit.clusters;
    const t = arr.topology(), geom = parcelGeometry(arr);
    const gr = geom.graph(set.faces, t, set.key);
    const count = set.faces.length;
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let q = 0; q < gr.n; q++) {
      const o = gr.across[q];
      if (o < 0 || o === gr.of[q]) continue;
      const a = find(gr.of[q]), b = find(o);
      if (a !== b) parent[a] = b;
    }
    const pieceOf = new Map<number, number>();
    const pieces: Array<{ faces: number[]; box: GeoBox; area: number }> = [];
    for (let i = 0; i < count; i++) {
      const r = find(i);
      let k = pieceOf.get(r);
      if (k === undefined) { k = pieces.length; pieceOf.set(r, k); pieces.push({ faces: [], box: [0, 0, 0, 0], area: 0 }); }
      const pc = pieces[k], f = set.faces[i];
      let fb: GeoBox | null = null;
      for (const c of t.facesCycles.get(f) ?? []) { const b = geom.cycle(c, t).box; fb = fb ? joinBoxes(fb, [b[0], b[1], b[2], b[3]]) : [b[0], b[1], b[2], b[3]]; }
      if (!fb) continue;
      pc.box = pc.faces.length ? joinBoxes(pc.box, fb) : fb;
      pc.faces.push(f);
      pc.area += arr.faceArea(f);
    }
    const found = clusterPieces(pieces.filter((p) => p.faces.length), fill);
    const live = pieces.filter((p) => p.faces.length);
    const whole: GeoBox = [-180, -90, 180, 90];
    const clusters = found.length <= 1
      ? [{ set, box: found[0]?.box ?? whole, core: found[0]?.core ?? whole }]
      : found.map((c, i) => ({ set: { faces: c.members.flatMap((m) => live[m].faces).sort((a, b) => a - b), key: `${key}#${i}` }, box: c.box, core: c.core }));
    if (this.clusterCache.size > 4000) this.clusterCache.clear();
    this.clusterCache.set(key, { arr, clusters });
    return clusters;
  }
  private clusterCache = new Map<string, { arr: Arrangement; clusters: Array<{ set: FaceSet; box: GeoBox; core: GeoBox }> }>();

  /** A picture or video frame as a pattern laid where paintMedia puts it (for the coastal band, D83); null if not loaded. */
  private mediaPattern(c: CanvasRenderingContext2D, fill: CountryFillLike, box: Box2, cover: Box2 | null, unit: number): CanvasPattern | null {
    const src = fill.kind === 'video' ? videoNow(fill.asset, this.mediaSeconds, fill, this.mediaChannel) : imageNow(fill.asset);
    if (!src) return null;
    const iw = (src as HTMLVideoElement).videoWidth || src.width, ih = (src as HTMLVideoElement).videoHeight || src.height;
    const pattern = iw && ih ? c.createPattern(src, 'repeat') : null;
    if (!pattern) return null;
    if (fill.fit === 'tile') {
      const size = (fill.tileSize ?? 120) * unit;
      pattern.setTransform(new DOMMatrix().translate(box[0], box[1]).scale(size / iw));
      return pattern;
    }
    const fit = !fill.fit || (fill.fit === 'cover' && fill.asset?.startsWith('data/flags/')) ? 'fill' : fill.fit;
    let [x, y, w, h] = box;
    let [sx, sy] = fit === 'stretch' ? [w / iw, h / ih] : fitScales(iw, ih, w, h, fit);
    if (cover && fit !== 'contain' && fit !== 'stretch') {
      const dw = iw * sx, dh = ih * sy, cx = x + w / 2, cy = y + h / 2;
      const k = Math.max(1, (cx - cover[0]) / (dw / 2), (cover[0] + cover[2] - cx) / (dw / 2), (cy - cover[1]) / (dh / 2), (cover[1] + cover[3] - cy) / (dh / 2));
      if (k > 1) { w *= k; h *= k; x = cx - w / 2; y = cy - h / 2; [sx, sy] = fitScales(iw, ih, w, h, fit); }
    }
    const dw = iw * sx, dh = ih * sy;
    pattern.setTransform(new DOMMatrix([sx, 0, 0, sy, x + (w - dw) / 2, y + (h - dh) / 2]));
    return pattern;
  }

  /** Fill a shape with a picture or video frame; false if it cannot be drawn yet. */
  private paintMedia(c: CanvasRenderingContext2D, fill: CountryFillLike, shape: Shape, box: Box2, unit: number, rect: Box2 | null = null, cover: Box2 | null = null): boolean {
    const src = fill.kind === 'video' ? videoNow(fill.asset, this.mediaSeconds, fill, this.mediaChannel) : imageNow(fill.asset);
    if (!src) return false;
    c.save();
    this.clip(c, shape);
    // (One copy of several, where a cluster shows more than once: only its own part of the screen.)
    if (rect) { c.beginPath(); c.rect(rect[0], rect[1], rect[2], rect[3]); c.clip(); }
    if (fill.fit === 'tile') {
      const w = (src as HTMLVideoElement).videoWidth || src.width, h = (src as HTMLVideoElement).videoHeight || src.height;
      const pattern = c.createPattern(src, 'repeat');
      if (pattern && w && h) {
        const size = (fill.tileSize ?? 120) * unit;
        pattern.setTransform(new DOMMatrix().translate(box[0], box[1]).scale(size / w));
        c.fillStyle = pattern;
        // The shape clips; the pattern is laid over everything in screen space.
        c.fillRect(-1e5, -1e5, 2e5, 2e5);
      }
    } else {
      const m = mediaBox(src, fill, box, cover);
      drawImageFit(c, src, m.box[0], m.box[1], m.box[2], m.box[3], m.fit);
    }
    c.restore();
    return true;
  }

  /**
   * For SVG frames (D115): where an owner's picture fill goes on screen, as frames place it (D82):
   * each cluster of its parcels, and for each copy of it in view the box the picture is fitted to
   * (`at`), the box it must cover, and where a cluster shows more than once the part of the screen
   * that copy keeps (`rect`).
   */
  mediaPlacements(view: View, world: World, spaceId: string, faces: number[], fill: CountryFillLike): Array<{ faces: number[]; at: Box2; cover: Box2 | null; rect: Box2 | null }> {
    const arr = world.arrangement(spaceId);
    const out: Array<{ faces: number[]; at: Box2; cover: Box2 | null; rect: Box2 | null }> = [];
    for (const cl of this.fillClusters(arr, this.faceSet(arr, faces), fill)) {
      const boxes = this.boxesOnScreen(view, cl.box), cores = this.boxesOnScreen(view, cl.core);
      for (const b of boxes) {
        const rect: Box2 = [b[0], b[1], b[2] - b[0], b[3] - b[1]];
        const k = cores.find((q) => q[0] < b[2] && q[2] > b[0] && q[1] < b[3] && q[3] > b[1]);
        out.push({ faces: cl.set.faces, at: k ? [k[0], k[1], k[2] - k[0], k[3] - k[1]] : rect, cover: rect, rect: boxes.length > 1 ? rect : null });
      }
      if (!boxes.length) out.push({ faces: cl.set.faces, at: this.screenBox(view, arr, cl.set.faces), cover: null, rect: null });
    }
    return out;
  }

  /** Screen seconds into the shot (videos show the frame for this moment); 0 while editing. */
  private mediaSeconds = 0;
  private mediaChannel: MediaChannel = 'live';

  /**
   * Scratch buffers, one for each use within a frame. A buffer that has been drawn onto another
   * canvas is copied whole by the browser when it is drawn on again before that canvas has been
   * painted (the browser keeps what the first drawing showed): about 3 ms each time at the size of a
   * window, several times that for a 4K frame. So a frame's uses each get a buffer of their own, up
   * to four (fewer for very large frames); beyond that they take turns.
   */
  private scratches: Array<{ canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D; /** Limited to the part of the frame being drawn (see region). */ limited: boolean; /** Where it was last drawn on (null: anywhere). */ used: DeviceRect[] | null }> = [];
  private scratchNext = 0;
  private scratchIdle = 0;
  /** The largest target (in pixels) a buffer was asked for in this frame, and for how many frames the buffers have been much larger than that. */
  private scratchWant = 0;
  private scratchLarge = 0;

  /** At the start of a frame: the buffers are free again; those beyond two that have long gone unused are given up, and all of them when they have long been much larger than needed. */
  private scratchReset(): void {
    if (this.scratches.length > 2 && this.scratchNext < this.scratches.length) {
      if (++this.scratchIdle > 120) { this.scratches.length = Math.max(2, this.scratchNext); this.scratchIdle = 0; }
    } else this.scratchIdle = 0;
    const first = this.scratches[0];
    if (first && this.scratchWant > 0) {
      if (first.canvas.width * first.canvas.height > 1.5 * this.scratchWant) { if (++this.scratchLarge > 240) { this.scratches = []; this.scratchLarge = 0; } }
      else this.scratchLarge = 0;
    }
    this.scratchWant = 0;
    this.scratchNext = 0;
  }

  /**
   * A cleared buffer with the target's current transform, at least the size of the target (one left
   * by a larger target serves as well: the working view draws now on the canvas, now on a kept picture
   * that is larger, and making new buffers at every change of size would cost more than it saves).
   */
  private scratch(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
    let w = ctx.canvas.width, h = ctx.canvas.height;
    this.scratchWant = Math.max(this.scratchWant, w * h);
    const first = this.scratches[0];
    if (first && (first.canvas.width < w || first.canvas.height < h)) this.scratches = [];
    else if (first) { w = first.canvas.width; h = first.canvas.height; }
    const most = Math.max(1, Math.min(4, Math.floor(40_000_000 / (w * h))));
    const i = this.scratchNext++ % most;
    let s = this.scratches[i];
    if (!s) {
      const canvas = new OffscreenCanvas(w, h);
      // Match the target's memory placement so copying between them stays cheap.
      const willReadFrequently = !!ctx.getContextAttributes?.().willReadFrequently;
      s = this.scratches[i] = { canvas, ctx: canvas.getContext('2d', { willReadFrequently }) as unknown as CanvasRenderingContext2D, limited: false, used: null };
    }
    const sc = s.ctx;
    if (s.limited) { sc.restore(); s.limited = false; }
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    // Only what was drawn on last needs clearing.
    if (s.used) for (const [x, y, rw, rh] of s.used) sc.clearRect(x, y, rw, rh);
    else sc.clearRect(0, 0, w, h);
    s.used = this.region;
    sc.setTransform(ctx.getTransform());
    if (this.region) { sc.save(); this.clipTo(sc, this.region); s.limited = true; }
    return sc;
  }

  /**
   * Borders are drawn where neighbouring parcels have different owners. During an animated change
   * they follow the animation: inside the advancing front the new owners decide, outside it the
   * previous owners do, and the front itself is the moving border. Fades cross-fade the two sets.
   * Which borders those are is kept per stretch of time, and their paths per sheet.
   */
  private drawBorders(
    ctx: CanvasRenderingContext2D, sheet: Sheet, sp: SheetParcels, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>,
    tg: { groups: Map<string, TransitionGroup>; of: Map<number, TransitionGroup> }, style: MapStyle, width: number,
    which: 'all' | 'shared' | 'open' = 'all', boxOf: ((g: TransitionGroup, pad: number) => Box2) | null = null, look: LayerBorders | null = null,
  ): void {
    const bp = this.borderPaths(sp, sheet, arr, snap, states);
    const stroke = (p: Path2D | BlockPath | null | undefined) => { if (p) this.strokeOnSheet(ctx, p, width); };
    const u = this.frameUnit;
    ctx.save();
    ctx.strokeStyle = style.border;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // (Owner by owner: each owner's lines are skipped where none of them shows. In the layer's border styles, D183,
    // where it has them: one for the borders between countries, one for their edges against nobody.)
    const between = look && !plainBorder(look.between) ? look.between : null, coast = look && !plainBorder(look.coast) ? look.coast : null;
    if (which !== 'open') for (const p of bp.plain) if (between) this.strokeBorder(ctx, p, between, width, style.border, u); else stroke(p);
    if (which !== 'shared') for (const p of bp.open) if (coast) this.strokeBorder(ctx, p, coast, width, style.border, u); else stroke(p);
    if (which === 'open') { ctx.restore(); return; }
    // Special borders between two named countries (D183), over the others.
    for (const pr of look?.pairs ?? []) {
      const p = this.pairPath(sp, sheet, arr, snap, states, pr.a, pr.b);
      if (p) this.strokeBorder(ctx, p, pr.style, width, style.border, u);
    }
    for (const [id, g] of tg.groups) {
      const ins = bp.inside.get(id), outs = bp.outside.get(id);
      if (g.advance) {
        if (ins) this.strokeWhere(ctx, ins, width, [g], [], 1, [g], boxOf);
        if (outs) this.strokeWhere(ctx, outs, width, [], [g], 1, [g], boxOf);
        this.frontLine(ctx, g, width, boxOf);
      } else {
        if (ins) { ctx.globalAlpha = g.progress; stroke(ins); }
        if (outs) { ctx.globalAlpha = 1 - g.progress; stroke(outs); }
        ctx.globalAlpha = 1;
      }
    }
    // Where two changes meet: each combination of the two fronts having come or not, where it holds.
    for (const m of bp.meet) {
      const A = tg.groups.get(m.a), B = tg.groups.get(m.b);
      if (!A || !B) continue;
      for (let k = 0; k < 4; k++) {
        const path = m.paths[k];
        if (!path) continue;
        const inside: TransitionGroup[] = [], outside: TransitionGroup[] = [];
        let alpha = 1;
        for (const [g, reached] of [[A, k >> 1], [B, k & 1]] as const) {
          // A fade is everywhere at once: before and after mixed by its progress.
          if (!g.advance) alpha *= reached ? g.progress : 1 - g.progress;
          else (reached ? inside : outside).push(g);
        }
        if (alpha > 0) this.strokeWhere(ctx, path, width, inside, outside, alpha, [A, B], boxOf);
      }
    }
    ctx.restore();
  }

  /**
   * The borders between two named countries on a sheet (D183): the chains of either one's boundary whose other side
   * is the other (kept while both keep their parcels and neighbours). Null when they do not meet.
   */
  private pairPath(sp: SheetParcels, sheet: Sheet, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>, a: string, b: string): BlockPath | null {
    const all = this.bordersOf(arr, snap, states), ea = all.get(a), eb = all.get(b);
    if (!ea && !eb) return null;
    const key = `pair|${a}|${b}|${ea?.key ?? ''}|${eb?.key ?? ''}`;
    const kept = sp.ownerBorders.get(key);
    if (kept !== undefined) return kept as BlockPath | null;
    const geom = parcelGeometry(arr), t = arr.topology();
    const path = sheet.blocks();
    let any = false;
    for (const [e, other] of [[ea, b], [eb, a]] as const) {
      if (!e) continue;
      for (const q of e.take) {
        if (e.open.has(q)) continue;
        const face = arr.halfEdgeFace(geom.cycle(e.b[q], t).heads[e.b[q + 1]] ^ 1);
        if (states.get(face)?.value !== other) continue;
        for (const l of this.chainLines(sp, sheet, geom, e.b[q], e.b[q + 1])) { path.addLine(l); any = true; }
      }
    }
    const p = any ? path : null;
    sp.ownerBorders.set(key, p);
    return p;
  }

  /** A line along a sheet path: `lw` pixels wide, dashed (pixels), the dashes moved by `offset` pixels. */
  private strokeLine(c: CanvasRenderingContext2D, p: Path2D | BlockPath, lw: number, color: string, dash: number[], offset: number): void {
    const [k, e, f] = this.place;
    c.save();
    c.strokeStyle = color;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.transform(k, 0, 0, k, e, f);
    c.lineWidth = lw / k;
    c.setLineDash(dash.map((x) => x / k));
    c.lineDashOffset = offset / k;
    if (p instanceof BlockPath) p.paint(c, lw / k / 2 + 1, (q) => c.stroke(q));
    else c.stroke(p);
    c.restore();
  }

  /** A buffer of the frame's size for borders drawn apart (doubled, softened), cleared, with the target's transform. */
  private borderBuf: OffscreenCanvas | null = null;
  /** Canvases of the renderer's own, cleared, the size of `c` (not from the pool of scratch canvases, which rotate). */
  private ownCanvas(i: number, c: CanvasRenderingContext2D): CanvasRenderingContext2D {
    const W = c.canvas.width, H = c.canvas.height;
    let b = this.ownBufs[i];
    if (!b || b.width !== W || b.height !== H) b = this.ownBufs[i] = new OffscreenCanvas(W, H);
    const g = b.getContext('2d') as unknown as CanvasRenderingContext2D;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    g.setTransform(c.getTransform());
    return g;
  }
  private ownBufs: OffscreenCanvas[] = [];
  /** Pixels of the frame being drawn to a pixel of a 1920-wide frame. */
  private frameUnit = 1;
  private borderLayer(c: CanvasRenderingContext2D): CanvasRenderingContext2D {
    const W = c.canvas.width, H = c.canvas.height;
    if (!this.borderBuf || this.borderBuf.width !== W || this.borderBuf.height !== H) this.borderBuf = new OffscreenCanvas(W, H);
    const g = this.borderBuf.getContext('2d') as unknown as CanvasRenderingContext2D;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.setTransform(c.getTransform());
    return g;
  }

  /**
   * A border in a style of its own (D183): a glow and a casing under it, the line (dashed, doubled, sketched), ticks
   * across it; softened and at its strength. `width`: the layer's width (pixels), `colour`: the map's border colour.
   */
  private strokeBorder(c: CanvasRenderingContext2D, p: Path2D | BlockPath, bs: BorderStyle, width: number, colour: string, u: number): void {
    const w = bs.width === null ? width : bs.width * u, col = bs.color ?? colour;
    if (w <= 0 || bs.opacity <= 0) return;
    const dash = dashPattern(bs.dash, w, bs.dashScale), offset = -this.mediaSeconds * bs.march * u;
    const apart = bs.soft > 0 || bs.double > 0;
    const g = apart ? this.borderLayer(c) : c;
    g.save();
    if (!apart) g.globalAlpha *= bs.opacity;
    if (bs.casing > 0) this.strokeLine(g, p, w + 2 * bs.casing * u + (bs.double > 0 ? bs.double * u + w : 0), bs.casingColor, [], 0);
    if (bs.glow > 0) { g.shadowColor = bs.glowColor; g.shadowBlur = bs.glow * u; }
    if (bs.double > 0) {
      // Two lines: one as wide as both and the gap, the gap then taken out of it (in the buffer only).
      const gap = bs.double * u;
      this.strokeLine(g, p, 2 * w + gap, col, dash, offset);
      g.shadowBlur = 0;
      g.globalCompositeOperation = 'destination-out';
      this.strokeLine(g, p, gap, '#000', [], 0);
      g.globalCompositeOperation = 'source-over';
    } else this.strokeLine(g, p, w, col, dash, offset);
    g.shadowBlur = 0;
    // Drawn as if by hand: the line again a little to each side, fainter, its dashes out of step.
    for (let i = 1; i <= bs.sketch; i++) {
      g.save();
      const d = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.8 * u;
      g.translate(d, -d * 0.6);
      g.globalAlpha *= 0.45;
      this.strokeLine(g, p, Math.max(0.6, w * 0.7), col, dash.length ? dash : [18 * u, 2.5 * u], offset + i * 7 * u);
      g.restore();
    }
    // Ticks across it: a line as wide as the ticks are long, dashed thin.
    if (bs.ticks > 0) this.strokeLine(g, p, bs.tickLength * u, col, [Math.max(1, w * 0.8), bs.ticks * u], offset);
    g.restore();
    if (apart) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha *= bs.opacity;
      if (bs.soft > 0) c.filter = `blur(${((bs.soft * u) / 2).toFixed(2)}px)`;
      c.drawImage(g.canvas as CanvasImageSource, 0, 0);
      c.restore();
    }
  }

  /**
   * Border lines shown only where every front in `inside` has come and none in `outside` has (at
   * `alpha`). A front from a border reaches a union of overlapping pieces, whose outside cannot be
   * a clip: there the lines are drawn apart, the reached area is taken out of them, and the rest is
   * laid on (within the boxes of the changes `near`).
   */
  private strokeWhere(
    ctx: CanvasRenderingContext2D, path: Path2D | BlockPath, width: number, inside: TransitionGroup[], outside: TransitionGroup[],
    alpha: number, near: TransitionGroup[], boxOf: ((g: TransitionGroup, pad: number) => Box2) | null,
  ): void {
    if (inside.some((g) => !g.disc)) return; // (a front that has not set off yet has reached nowhere)
    const out = outside.filter((g) => g.disc);
    const apart = out.filter((g) => g.discRule !== 'evenodd');
    const box = apart.length ? this.unionBox(ctx, boxOf ? near.map((g) => boxOf(g, width + 2)) : null) : null;
    if (apart.length && !box) return; // (none of it on the picture)
    const on = box ? this.boxBuffer(ctx, box) : ctx;
    on.save();
    if (on !== ctx) { on.strokeStyle = ctx.strokeStyle; on.lineJoin = ctx.lineJoin; on.lineCap = ctx.lineCap; on.lineWidth = ctx.lineWidth; }
    else if (boxOf && near.length) {
      // (Only round the changes: "everywhere a front has not come" is the whole picture less a shape.)
      const round = this.unionBox(ctx, near.map((g) => boxOf(g, width + 2)));
      if (!round) { on.restore(); return; }
      this.clipBox(on, round);
    }
    for (const g of inside) on.clip(g.disc!, g.discRule);
    for (const g of out) if (g.discRule === 'evenodd') on.clip(outsideOf(g.disc!), 'evenodd');
    if (on === ctx) on.globalAlpha *= alpha;
    // (In a buffer of a box, where drawing is going on is told from the box's corner: see softEdge.)
    if (on !== ctx && box) setPaintRegion(this.region ? this.region.map(([x, y, rw, rh]) => [x - box[0], y - box[1], rw, rh] as DeviceRect) : null);
    try { this.strokeOnSheet(on, path, width); } finally { if (on !== ctx) setPaintRegion(this.region); }
    on.restore();
    if (on === ctx) return;
    on.save();
    on.globalCompositeOperation = 'destination-out';
    for (const g of apart) on.fill(g.disc!, g.discRule);
    on.restore();
    this.layOn(ctx, on, alpha, box!);
  }

  /**
   * The moving border: the edge of the area a front has reached, within the parcels changing hands.
   * The edge of a union of pieces (a front from a border, or from several points) is drawn as a band:
   * from a border, the area reached half a line-width later less that reached half a line-width
   * earlier; from several points, each circle's outline less every circle's inside.
   */
  private frontLine(ctx: CanvasRenderingContext2D, g: TransitionGroup, width: number, boxOf: ((g: TransitionGroup, pad: number) => Box2) | null): void {
    if (!g.disc || !g.changing) return;
    if (g.field) {
      // The front itself, within the change (D137); a soft edge has none, a little soft a fainter one.
      const alpha = Math.max(0, 1 - g.look.soft / 0.3);
      if (!g.line || alpha <= 0) return;
      ctx.save();
      this.clip(ctx, g.changing);
      ctx.globalAlpha *= alpha;
      ctx.stroke(g.line);
      ctx.restore();
      return;
    }
    ctx.save();
    this.clip(ctx, g.changing);
    if (g.discRule === 'evenodd') { ctx.stroke(g.disc); ctx.restore(); return; }
    const box = this.unionBox(ctx, boxOf ? [boxOf(g, width + 2)] : null);
    if (!box) { ctx.restore(); return; }
    const band = this.boxBuffer(ctx, box);
    band.fillStyle = ctx.strokeStyle;
    band.strokeStyle = ctx.strokeStyle;
    if (g.border) {
      const r = g.progress * g.border.maxDist;
      band.fill(g.border.reach(r + width / 2), 'nonzero');
      band.globalCompositeOperation = 'destination-out';
      band.fill(g.border.reach(r - width / 2), 'nonzero');
    } else {
      band.lineWidth = 2 * width;
      band.stroke(g.disc);
      band.globalCompositeOperation = 'destination-out';
      band.fill(g.disc, 'nonzero');
    }
    band.globalCompositeOperation = 'source-over';
    this.layOn(ctx, band, 1, box);
    ctx.restore();
  }

  private groupBoxes = new WeakMap<object, TransitionGroup['boxes']>();
  /** The share of the frame the territories' picture would be drawn again in, renewed for a new moment or patched from the picture before (1: all of it). */
  lastRedraw = { renew: 1, patch: 1 };

  /**
   * For each kept picture of territories with changes under way: which picture it is (the stretch and view), the
   * moment it shows, and each change then: how far its front had come, its field, and where it lies.
   */
  private shownFronts = new Map<string, { rk: string; look: string; frame: string; strict: string; moment: string; groups: Map<string, { progress: number; field: FrontField | null; rects: number[][] | null }> }>();

  /** The rectangles of the picture a change under way lies in (x0, y0, x1, y1, grown by `pad` view pixels): found once for a view; null when it has none to give. */
  private groupRects(view: View, arr: Arrangement, g: TransitionGroup, m: DOMMatrix, pad: number, width: number, height: number): number[][] | null {
    const key = `${view.key}|${pad}|${m.e},${m.f}|${width}x${height}`;
    if (g.boxes.rectsKey !== key) {
      const list: number[][] = [];
      let ok = true;
      for (const face of g.faces) if (!this.joinFace(list, view, arr, face, m, pad, width, height)) { ok = false; break; }
      g.boxes.rectsKey = key;
      g.boxes.rects = ok ? list : null;
    }
    return g.boxes.rects ?? null;
  }

  /**
   * The rectangles of the picture (x, y, width, height) that differ between a kept picture (each change under way
   * then as in `before`) and now, for the changes under way (D140): for a front with the same field in both, the
   * strip it has crossed since, with room for its line, its glow and its soft edges; for any other change under
   * way now or then (a fade, a change that began or ended between the two), all of it. Null when a change has no
   * rectangles to give, or together they are most of the picture.
   */
  private frontRects(view: View, arr: Arrangement, prepared: Array<{ tg: { groups: Map<string, TransitionGroup> } }>, before: Map<string, { progress: number; field: FrontField | null; rects: number[][] | null }>, m: DOMMatrix, pad: number, width: number, height: number): DeviceRect[] | null {
    const boxes: number[][] = [];
    const k = Math.hypot(m.a, m.b) || 1, perDegree = (Math.PI / 180) * view.projection.scale();
    const now = new Set<string>();
    for (let i = 0; i < prepared.length; i++) for (const [id, g] of prepared[i].tg.groups) {
      now.add(`${i}:${id}`);
      const was = before.get(`${i}:${id}`), f = g.field;
      if (!g.advance || !f || !was || was.field !== f) {
        const all = this.groupRects(view, arr, g, m, pad, width, height);
        if (!all) return null;
        for (const q of all) this.joinRect(boxes, q, 24);
        continue;
      }
      if (was.progress === g.progress) continue;
      const soft = g.look.soft > 0.01 ? g.look.soft * 0.25 : 0, wake = g.look.wake > 0.01 ? g.look.wake * 0.35 : 0;
      // (The soft edge and the glow are blurred: three widths of their blur, in view pixels; and a cell, for the lines' rounding.)
      const across = f.travel * perDegree * k;
      const blur = (3 * Math.min(48, Math.max(0.6, Math.max((soft / 6) * across * 0.6, (wake / 5) * across * 0.6)))) / k;
      const room = pad + (soft || wake ? blur : 0) + f.dlat * perDegree + 2;
      for (const box of bandBoxes(f, Math.min(was.progress, g.progress) - wake, Math.max(was.progress, g.progress) + Math.max(soft, wake ? 0.1 : 0))) this.joinBox(boxes, view, box, m, room, width, height, 24);
    }
    for (const [gk, was] of before) {
      if (now.has(gk)) continue;
      if (!was.rects) return null;
      for (const q of was.rects) this.joinRect(boxes, q, 24);
    }
    let total = 0;
    for (const q of boxes) total += (q[2] - q[0]) * (q[3] - q[1]);
    return total <= 0.6 * width * height ? boxes.map((q) => [q[0], q[1], q[2] - q[0], q[3] - q[1]] as DeviceRect) : null;
  }

  /** Where a change under way is on screen (the parcels changing hands, or all its parcels): found once for the view. */
  private groupBox(view: View, arr: Arrangement, g: TransitionGroup, changing: boolean): Box2 {
    if (g.boxes.key !== view.key) { g.boxes.key = view.key; g.boxes.changing = null; g.boxes.all = null; }
    if (changing) return (g.boxes.changing ??= this.screenBox(view, arr, g.changingFaces));
    return (g.boxes.all ??= this.screenBox(view, arr, g.faces));
  }

  /** Cuts what is drawn next to a box of the picture (device pixels), whatever the transform. */
  private clipBox(ctx: CanvasRenderingContext2D, box: Box2): void {
    const m = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(box[0], box[1], Math.max(0, box[2]), Math.max(0, box[3]));
    ctx.clip();
    ctx.setTransform(m);
  }

  /** The box (device pixels) around the boxes given, within the picture; all of it for none; null when empty. */
  private unionBox(ctx: CanvasRenderingContext2D, boxes: Box2[] | null): Box2 | null {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (!boxes) return [0, 0, W, H];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y, w, h] of boxes) { if (w <= 0 || h <= 0) continue; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
  }

  private boxBuffers: Array<{ canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D; used: [number, number] | null; limited: boolean }> = [];
  private boxNext = 0;

  /**
   * A cleared buffer for drawing a part of the picture apart (border lines with an area taken out of
   * them, the edge of a front): the size of `box` (device pixels of `ctx`), with `ctx`'s transform
   * moved so that what is drawn lands there. Four take turns (a buffer drawn on again soon after it
   * was laid on another costs a copy of it, see scratch), apart from the scratch buffers, whose turns
   * a frame relies on (one taken here in their turn was one still being drawn on).
   */
  private boxBuffer(ctx: CanvasRenderingContext2D, box: Box2): CanvasRenderingContext2D {
    const [bx, by, bw, bh] = box;
    const i = this.boxNext++ % 4;
    let b = this.boxBuffers[i];
    if (!b || b.canvas.width < bw || b.canvas.height < bh) {
      const canvas = new OffscreenCanvas(Math.max(bw, b?.canvas.width ?? 1), Math.max(bh, b?.canvas.height ?? 1));
      b = this.boxBuffers[i] = { canvas, ctx: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, used: null, limited: false };
    }
    const c = b.ctx;
    if (b.limited) { c.restore(); b.limited = false; }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, b.used ? b.used[0] : b.canvas.width, b.used ? b.used[1] : b.canvas.height);
    b.used = [bw, bh];
    // Nothing is drawn beyond the box: only the box is cleared for the next to take the buffer, and lines,
    // shapes and blurs that ran past it were left there for a later, larger box to show. (Found by comparing
    // frames of an intense look drawn in part with frames drawn afresh: differences of a few levels that
    // came and went with what had used the buffer before.)
    c.save();
    c.beginPath();
    c.rect(0, 0, bw, bh);
    c.clip();
    b.limited = true;
    const m = ctx.getTransform();
    c.setTransform(m.a, m.b, m.c, m.d, m.e - bx, m.f - by);
    return c;
  }

  /** A box buffer's pixels laid on the target, where its box is, at an opacity. */
  private layOn(ctx: CanvasRenderingContext2D, from: CanvasRenderingContext2D, alpha: number, box: Box2): void {
    const [x, y, w, h] = box;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= alpha;
    ctx.drawImage(from.canvas as CanvasImageSource, 0, 0, w, h, x, y, w, h);
    ctx.restore();
  }

  private infoCache = new WeakMap<Arrangement, { mask: LandMask | null; faces: Map<number, FaceInfo> }>();

  /**
   * What labels need to know of a parcel: its area, how much of that is on land (all of it without
   * a land mask), and a point in its middle (as a unit vector). Kept until the parcel's outline
   * changes. The share on land is counted on a grid of 10 by 10 points over the parcel's box, row by
   * row: where a row crosses the outline is worked out once for the whole row.
   */
  private faceInfo(arr: Arrangement, face: number, mask: LandMask | null): FaceInfo {
    let c = this.infoCache.get(arr);
    if (!c || c.mask !== mask) { c = { mask, faces: new Map() }; this.infoCache.set(arr, c); }
    const t = arr.topology();
    const stamp = t.faceStamps.get(face) ?? 0;
    const hit = c.faces.get(face);
    if (hit && hit.stamp === stamp) return hit;
    const geom = parcelGeometry(arr);
    const cycles: CycleGeom[] = [];
    let w = Infinity, so = Infinity, e = -Infinity, no = -Infinity, round = false;
    for (const id of t.facesCycles.get(face) ?? []) {
      const g = geom.cycle(id, t);
      cycles.push(g);
      if (g.wind !== 0) round = true;
      if (g.box[0] < w) w = g.box[0]; if (g.box[1] < so) so = g.box[1]; if (g.box[2] > e) e = g.box[2]; if (g.box[3] > no) no = g.box[3];
    }
    const area = arr.faceArea(face);
    const lon = ((w + e) / 2) * Math.PI / 180, lat = ((so + no) / 2) * Math.PI / 180;
    const middle = cycles.length ? [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)] : [1, 0, 0];
    let land = area;
    if (mask && cycles.length && !round) {
      const N = 10, xs: number[] = [];
      let inside = 0, onLand = 0;
      for (let j = 0; j < N; j++) {
        const y = so + ((j + 0.5) / N) * (no - so);
        xs.length = 0;
        for (const g of cycles) {
          const lo = g.lon, la = g.lat, n = lo.length;
          for (let i = 0, k = n - 1; i < n; k = i++) {
            const yi = la[i], yk = la[k];
            if ((yi > y) !== (yk > y)) xs.push(lo[i] + ((y - yi) * (lo[k] - lo[i])) / (yk - yi));
          }
        }
        xs.sort((p, q) => p - q);
        let q = 0;
        for (let i = 0; i < N; i++) {
          const x = w + ((i + 0.5) / N) * (e - w);
          while (q < xs.length && xs[q] < x) q++;
          if (!(q & 1)) continue;
          inside++;
          if (mask.onLand(x, y)) onLand++;
        }
      }
      // (A thin sliver the grid missed is judged by its middle.)
      land = inside ? (area * onLand) / inside : mask.onLand((w + e) / 2, (so + no) / 2) ? area : 0;
    }
    const info: FaceInfo = { stamp, area, land, x: middle[0], y: middle[1], z: middle[2] };
    if (c.faces.size > 4 * t.facesCycles.size + 4096) c.faces.clear();
    c.faces.set(face, info);
    return info;
  }

  // ---------------------------------------------------------------- labels
  //
  // Each country is labelled once, in its main piece of territory (the largest connected part; on a
  // layer that ends at the coast, the piece with the most land), at the place with the most room for
  // the label (label-place.ts), and sized to fit there. Larger countries are placed first, so they
  // keep their labels where labels would collide. During an animated change the label glides from
  // where it was before the change to where it will be after it.

  // (Limited by the number of points held: outlines of large countries are heavy.)
  private pieceCache = new Weighed<string, OwnerPiece | null>(6_000_000, (p) => (p ? p.arcs.length + 32 : 1));
  private shapeCache = new Weighed<string, PlaneShape>(6_000_000, (sh) => 2 * sh.edges.length + 64);
  private spotCache = new Weighed<string, Placings>(4_000_000, (pl) => pl.weight);
  private viewSpotCache = new Map<string, Placings>();
  private viewSpotKey = '';

  /**
   * Each owner's main piece and its outline. Worked out owner by owner and kept while the owner's
   * parcels stay the same: crossing an event, or an edit, works out again only the owners it touches.
   */
  private ownerPieces(arr: Arrangement, sets: Map<string, FaceSet>, mask: LandMask | null): Map<string, OwnerPiece> {
    const out = new Map<string, OwnerPiece>();
    for (const [owner, set] of sets) {
      const key = `${arr.spaceId}|${set.key}|${mask ? 'land' : 'all'}`;
      let p = this.pieceCache.get(key);
      if (p === undefined) {
        p = this.ownerPiece(arr, owner, set, mask);
        this.pieceCache.set(key, p);
      }
      // (The same parcels may have passed to another owner.)
      if (p) out.set(owner, p.owner === owner ? p : { ...p, owner, others: p.others?.map((o) => ({ ...o, owner })) });
    }
    return out;
  }

  private ownerPiece(arr: Arrangement, owner: string, set: FaceSet, mask: LandMask | null): OwnerPiece | null {
    const gr = parcelGeometry(arr).graph(set.faces, arr.topology(), set.key);
    const faces = set.faces, count = faces.length;
    // Connected pieces: parcels of the owner that share a border.
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let q = 0; q < gr.n; q++) {
      const o = gr.across[q];
      if (o < 0 || o === gr.of[q]) continue;
      const a = find(gr.of[q]), b = find(o);
      if (a !== b) parent[a] = b;
    }
    type Comp = { root: number; area: number; sx: number; sy: number; sz: number };
    const comps = new Map<number, Comp>();
    let total = 0;
    for (let i = 0; i < count; i++) {
      const f = faces[i];
      const g = this.faceInfo(arr, f, mask);
      const area = g.land;
      const r = find(i);
      let c = comps.get(r);
      if (!c) comps.set(r, (c = { root: r, area: 0, sx: 0, sy: 0, sz: 0 }));
      c.area += area;
      c.sx += g.area * g.x; c.sy += g.area * g.y; c.sz += g.area * g.z;
      total += area;
    }
    let main: Comp | null = null;
    for (const c of comps.values()) if (c.area > 0 && (!main || c.area > main.area)) main = c;
    if (!main) return null;
    const piece = this.pieceOutline(owner, gr, find, main, total, mask);
    // The other pieces of at least a hundredth of the main one's land (D178): an empire's India while its largest
    // piece is in Africa, a country's large islands. The twelve largest are kept, for a view that shows one of them
    // and not the main piece.
    const others = [...comps.values()].filter((c) => c !== main && c.area > 0 && c.area >= 0.01 * main!.area).sort((x, y) => y.area - x.area).slice(0, 12);
    if (others.length) piece.others = others.map((c) => this.pieceOutline(owner, gr, find, c, c.area, mask));
    return piece;
  }

  /** The outline of one connected piece of an owner's parcels (`total`: the land its label's size is worked from). */
  private pieceOutline(owner: string, gr: ReturnType<ReturnType<typeof parcelGeometry>['graph']>, find: (i: number) => number, main: { root: number; area: number; sx: number; sy: number; sz: number }, total: number, mask: LandMask | null): OwnerPiece {
    // The outline of the piece: the border chains with the piece on one side only.
    const root = main.root;
    const edge = (q: number) => find(gr.of[q]) === root && (gr.across[q] < 0 || find(gr.across[q]) !== root);
    // The outline is taken at a detail that suits its size (points that matter less than a
    // five-hundredth of its extent are left out): finding room for a name needs no more, and takes
    // far less time on a detailed coast.
    let w = Infinity, so = Infinity, e = -Infinity, no = -Infinity;
    for (let q = 0; q < gr.n; q++) {
      if (!edge(q)) continue;
      const bx = gr.cycle[q].box;
      if (bx[0] < w) w = bx[0]; if (bx[1] < so) so = bx[1]; if (bx[2] > e) e = bx[2]; if (bx[3] > no) no = bx[3];
    }
    const eps = Math.max(e - w, no - so) / 500;
    const out: number[] = [];
    for (let q = 0; q < gr.n; q++) {
      if (!edge(q)) continue;
      const g = gr.cycle[q], i = gr.index[q], n = g.lon.length, imp = g.imp;
      const from = g.starts[i], to = i === g.starts.length - 1 ? n : g.starts[i + 1];
      let last = from;
      for (let j = from + 1; j <= to; j++) {
        // (The chain's last piece ends on the first point of the next chain: of the cycle, after its last chain.)
        const k = j < n ? j : 0;
        if (j < to && imp && imp[j] < eps) continue;
        out.push(g.lon[last], g.lat[last], k === 0 ? g.lon[0] + 360 * g.wind : g.lon[k], g.lat[k]);
        last = j;
      }
    }
    const arcs = Float64Array.from(out);
    const lon = Math.atan2(main.sy, main.sx) * 180 / Math.PI;
    const a = arcs;
    // Keyed by the outline itself, so an edit elsewhere keeps this label's place.
    let k1 = 0x811c9dc5, k2 = 0x9e3779b9;
    for (let i = 0; i < a.length; i++) { const v = Math.round(a[i] * 1e7) | 0; k1 = Math.imul(k1 ^ v, 16777619); k2 = Math.imul(k2 + v, 2246822519) ^ (k2 >>> 13); }
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 2) { if (a[i] < box[0]) box[0] = a[i]; if (a[i] > box[2]) box[2] = a[i]; if (a[i + 1] < box[1]) box[1] = a[i + 1]; if (a[i + 1] > box[3]) box[3] = a[i + 1]; }
    return {
      owner, key: `${a.length}|${k1 >>> 0}|${k2 >>> 0}${mask ? '|land' : ''}`,
      arcs: a, centreLon: Number.isFinite(lon) ? lon : 0, area: main.area, total, box,
    };
  }

  /** Where a piece's label can go, for each way of breaking its text into lines (projection units). */
  private placePiece(piece: OwnerPiece, view: View, text: string, st: LabelStyle, accept: ((lon: number, lat: number) => boolean) | null, cacheKey: string, cache: Map<string, Placings> | Weighed<string, Placings>, onScreenOnly = false, wantedFont = Infinity, minFont = 0, rough = 1, mask: LandMask | null = null): Placings {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const proj = view.camera.projection;
    const sk = `${piece.key}|${proj}`;
    let shape = this.shapeCache.get(sk);
    if (!shape) {
      shape = planeShape(piece.arcs, proj, piece.centreLon);
      this.shapeCache.set(sk, shape);
    }
    // The part of the plane on screen (from points along the screen's edges), to search only there.
    let within: [number, number, number, number] | undefined;
    if (onScreenOnly) {
      within = [Infinity, Infinity, -Infinity, -Infinity];
      const m = LABEL_MARGIN, N = 16;
      for (let i = 0; i <= N; i++) {
        const f = m + (i / N) * (1 - 2 * m);
        for (const [x, y] of [[f, m], [f, 1 - m], [m, f], [1 - m, f]]) {
          const ll = screenToLonLat(view, x * view.width, y * view.height);
          const q = ll ? shape.projection(ll) : null;
          if (!q) continue;
          within[0] = Math.min(within[0], q[0]); within[1] = Math.min(within[1], q[1]);
          within[2] = Math.max(within[2], q[0]); within[3] = Math.max(within[3], q[1]);
        }
      }
    }
    const choices = lineChoices(text);
    const found: Array<PlacedLabel | null | undefined> = choices.map(() => undefined);
    const outline = shape;
    // Where territory ends at the coast: is there any land in a box of the plane? (The box in degrees
    // is taken from its corners and middle, with room for the projection's curve between them.)
    const anyLand = !mask ? undefined : (x0: number, y0: number, x1: number, y1: number): boolean => {
      let w = Infinity, so = Infinity, e = -Infinity, no = -Infinity;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2]]) {
        const ll = outline.projection.invert?.([x, y]);
        if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return true;
        if (ll[0] < w) w = ll[0]; if (ll[0] > e) e = ll[0]; if (ll[1] < so) so = ll[1]; if (ll[1] > no) no = ll[1];
      }
      // (A box across the line where longitudes start again spans nearly all of them: counted whole.
      // A cell of the mask more on every side; and where meridians curve, room for the curve.)
      const pad = (isCylindrical(proj) ? 0 : 0.15 * Math.max(e - w, no - so)) + 360 / mask.width;
      return mask.anyLand(w - pad, so - pad, e + pad, no + pad);
    };
    const res: Placings = {
      count: choices.length,
      weight: outline.edges.length + 16,
      at: (i) => {
        if (found[i] !== undefined) return found[i]!;
        const lines = choices[i];
        const wEm = Math.max(...lines.map((l) => textWidthEm(l, false, st.letterSpacing)));
        const hEm = blockHeightEm(lines.length);
        // Room for more than the size given is worth nothing: the label then stands as near the
        // middle as it can at that size (and the search is short).
        const cap = wantedFont < Infinity ? (wantedFont * hEm * 1.1) / (Math.SQRT2 * 1.15) : Infinity;
        // A place where the label would be smaller than `minFont` is of no use: not searched for.
        const floor = minFont > 0 ? (minFont * hEm) / (Math.SQRT2 * 1.15) : 0;
        const spot = placeLabel(outline, wEm / hEm, accept ?? undefined, within, cap, { floor, rough, anyAccepted: anyLand });
        // A box with the label's proportions fits inside the ellipse found when its height is sqrt(2)
        // times the ellipse's half-height. Labels may spill a little past narrow places.
        return (found[i] = spot ? { lon: spot.lon, lat: spot.lat, font: (Math.SQRT2 * spot.room * 1.15) / hEm, lines } : null);
      },
    };
    if (onScreenOnly) res.from = { ll: screenToLonLat(view, view.width / 2, view.height / 2), scale: view.projection.scale() };
    if (cache instanceof Map && cache.size > 3000) cache.clear();
    cache.set(cacheKey, res);
    return res;
  }

  /** Whether the view has moved little since a search of the part in view was made (a twentieth of the frame, a fifth in scale). */
  private nearSearch(view: View, pl: Placings): boolean {
    const f = pl.from;
    if (!f || !f.ll) return false;
    const p = view.projection(f.ll);
    const k = view.projection.scale() / f.scale;
    return !!p && k > 0.83 && k < 1.2 && Math.hypot(p[0] - view.width / 2, p[1] - view.height / 2) < 0.05 * Math.max(view.width, view.height);
  }

  /**
   * Of the ways to place a label, the one with the fewest lines that reaches the size wanted (design
   * pixels); when none does, the largest, with one line preferred over more.
   */
  private chooseLines(choices: Placings, wanted: number, scale: number, unit: number): PlacedLabel | null {
    for (let i = 0; i < choices.count; i++) { const c = choices.at(i); if (c && (c.font * scale) / unit >= wanted * 0.92) return c; }
    let best: PlacedLabel | null = null, bestScore = -Infinity;
    for (let i = 0; i < choices.count; i++) {
      const c = choices.at(i);
      if (!c) continue;
      const score = c.font * (c.lines.length === 1 ? 1.3 : c.lines.length === 2 ? 1 : 0.85);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  private layerLabels(view: View, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>, entities: Map<string, LabelEntity>, mask: LandMask | null = null, fineLand: ((lon: number, lat: number) => boolean) | null = null): LabelInfo[] {
    // How far each owner's changes have come (by area), for labels gliding with an animated change.
    // (Kept for the states it was worked out from: the same for every frame of the same moment.)
    let progress = this.progressOf.get(states);
    if (!progress) {
      progress = new Map<string, { w: number; p: number }>();
      if (snap.animating) for (const g of snap.groups.values()) for (const face of g.changing.faces) {
        const st = states.get(face);
        if (!st?.transition) continue;
        const area = arr.faceArea(face);
        if (area <= 0 || area > 2 * Math.PI) continue;
        const p = Math.min(1, Math.max(0, st.transition.progress));
        for (const o of [st.transition.from, st.value]) {
          if (!o) continue;
          const e = progress.get(o) ?? { w: 0, p: 0 };
          e.w += area; e.p += area * p;
          progress.set(o, e);
        }
      }
      this.progressOf.set(states, progress);
    }
    // Each owner's main piece before and after the changes animating now (the same when none is):
    // worked out once for the stretch of time.
    const pk = mask ? 'land' : 'all';
    let pieces = snap.pieces.get(pk);
    if (!pieces) {
      const after = this.ownerPieces(arr, snap.after, mask);
      pieces = { after, before: snap.animating ? this.ownerPieces(arr, snap.before, mask) : after };
      snap.pieces.set(pk, pieces);
    }
    const piecesAfter = pieces.after, piecesBefore = pieces.before;
    const scale = view.projection.scale();
    const vis = visibleBounds(view);
    // Places found in the part of a country in view hold for that view; while the view is moving they
    // are kept for as long as they stay in view (the names then travel with the map instead of sliding over it).
    const held = this.holdNames ? this.viewSpotCache : null;
    if (view.key !== this.viewSpotKey) { if (held) this.viewSpotCache = new Map(); else this.viewSpotCache.clear(); this.viewSpotKey = view.key; }
    const margin = LABEL_MARGIN;
    const onScreen = (p: [number, number] | null) => !!p && p[0] >= view.width * margin && p[0] <= view.width * (1 - margin) && p[1] >= view.height * margin && p[1] <= view.height * (1 - margin);
    const landOk = mask ? (lon: number, lat: number) => mask.onLand(lon, lat) : null;

    const place = (piece: OwnerPiece, text: string, st: LabelStyle): { pos: [number, number]; fontPx: number; lines: string[] } | null => {
      const ck = `${piece.key}|${view.camera.projection}|${text}|${st.letterSpacing}|${st.sizeScale}|${mask ? 1 : 0}`;
      // The size the territory's area suggests (design pixels): the label is never larger.
      const wanted = Math.min(st.maxSize, (Math.sqrt(piece.total) * scale * 0.18 * st.sizeScale) / view.unit);
      // The label is never larger than the territory's area suggests: where there is room for more
      // than twice that, more room is worth nothing (and looking for it takes long in a large country).
      const natural = Math.sqrt(piece.total) * 0.18 * st.sizeScale;
      // (In a hurry, a place found less finely will do, unless the fine one is already known.)
      const quick = this.hurried && !this.spotCache.has(ck);
      if (quick) this.lastApproximate = true;
      let pl = this.chooseLines(this.placePiece(piece, view, text, st, landOk, quick ? `${ck}|quick` : ck, this.spotCache, false, 2 * natural, 0, quick ? 12 : 1, mask), wanted, scale, view.unit);
      let p = pl ? view.projection([pl.lon, pl.lat]) as [number, number] | null : null;
      // The best place is off screen while part of the territory is in view (zoomed in on a large
      // country): place the label in the part that is in view.
      if ((!pl || !onScreen(p)) && vis !== null && boxIntersects(piece.box, vis)) {
        // (The outline searched is the whole territory's, drawn at a detail that suits its size: close in, a hole in it
        // smaller than that detail, a city of another, say, is not in it. The place is checked against the territory
        // itself, D176.)
        const own = (lon: number, lat: number) => { try { return states.get(arr.locate(lonLatToVec(lon, lat)))?.value === piece.owner; } catch { return true; } };
        const inView = (lon: number, lat: number) => onScreen(view.projection([lon, lat]) as [number, number] | null) && (!landOk || landOk(lon, lat)) && (!fineLand || fineLand(lon, lat)) && own(lon, lat);
        // (While the map moves the place is found less finely: it is found again, finely, when the map rests.)
        const rough = this.moving ? 4 : 1, vk = `${ck}|view${rough > 1 ? '|rough' : ''}${fineLand ? '|fine' : ''}`;
        const before = held?.get(vk);
        if (before) {
          // Held while the map moves: a place found, for as long as it stays in view; and that none
          // was found, until the view has moved on a little (looking again in every frame is what
          // made moving the map slow next to large countries).
          const kept = this.chooseLines(before, wanted, scale, view.unit);
          if (kept ? onScreen(view.projection([kept.lon, kept.lat]) as [number, number] | null) : this.nearSearch(view, before)) { this.viewSpotCache.set(vk, before); this.lastApproximate = true; }
        }
        const alt = this.chooseLines(this.placePiece(piece, view, text, st, inView, vk, this.viewSpotCache, true, (wanted * view.unit) / scale, (MIN_VIEW_LABEL * view.unit) / scale, rough, mask), wanted, scale, view.unit);
        if (rough > 1) this.lastApproximate = true;
        if (alt && (alt.font * scale) / view.unit >= MIN_VIEW_LABEL) { pl = alt; p = view.projection([alt.lon, alt.lat]) as [number, number] | null; }
      }
      if (!pl || !p) return null;
      return { pos: [pl.lon, pl.lat], fontPx: pl.font * scale, lines: pl.lines };
    };
    // The main piece's label; where that is not in view, the label of the largest other piece that is (D178: the
    // British Empire named over India in a view of India, its largest piece being in Africa).
    const placeSome = (piece: OwnerPiece, text: string, st: LabelStyle) => {
      const r = place(piece, text, st);
      if (vis === null || !piece.others || (r && onScreen(view.projection(r.pos) as [number, number] | null))) return r ? { ...r, piece } : null;
      for (const o of piece.others) {
        if (!boxIntersects(o.box, vis)) continue;
        const ro = place(o, text, st);
        if (ro && onScreen(view.projection(ro.pos) as [number, number] | null)) return { ...ro, piece: o };
      }
      return r ? { ...r, piece } : null;
    };
    const near = (p: OwnerPiece | undefined) => !!p && vis !== null && (boxIntersects(p.box, vis) || !!p.others?.some((o) => boxIntersects(o.box, vis)));

    const out: LabelInfo[] = [];
    const owners = new Set([...piecesAfter.keys(), ...piecesBefore.keys()]);
    for (const id of owners) {
      const pa = piecesAfter.get(id), pb = piecesBefore.get(id);
      // A country nowhere near the view has no label to place (most countries, close in).
      if (vis !== null && !near(pa) && !near(pb)) continue;
      const name = entities.get(id)?.name;
      if (!name) continue;
      const look = this.labelLook(id, name);
      if (!look) continue;
      const a = pa ? placeSome(pa, look.text, look.style) : null;
      const b = pb === pa ? a : pb ? placeSome(pb, look.text, look.style) : null;
      if (!a && !b) continue;
      const pr = progress.get(id);
      const f = pr && pr.w > 0 ? pr.p / pr.w : 1;
      let pos: [number, number], fontPx: number, lines: string[], total: number, area: number;
      if (a && b && a !== b) {
        // Glide between the places before and after the change.
        const va = vec3(a.pos), vb = vec3(b.pos);
        pos = toLonLat([vb[0] + (va[0] - vb[0]) * f, vb[1] + (va[1] - vb[1]) * f, vb[2] + (va[2] - vb[2]) * f]);
        fontPx = b.fontPx + (a.fontPx - b.fontPx) * f;
        lines = f >= 0.5 ? a.lines : b.lines;
        total = b.piece.total + (a.piece.total - b.piece.total) * f;
        area = b.piece.area + (a.piece.area - b.piece.area) * f;
      } else if (a) {
        // Appearing: grows with the change.
        ({ pos, fontPx, lines } = a); total = a.piece.total * f; area = a.piece.area * f;
      } else {
        // Disappearing: shrinks with the change.
        ({ pos, fontPx, lines } = b!); total = b!.piece.total * (1 - f); area = b!.piece.area * (1 - f);
      }
      if (total <= 0) continue;
      const p = view.projection(pos);
      if (!p) continue;
      // The size the territory's area suggests, but never more than fits where the label stands.
      const natural = (Math.sqrt(total) * scale * 0.18) / view.unit;
      const size = labelSize(look.style, Math.min(natural, fontPx / view.unit)) * view.unit;
      // Off the frame altogether (with room to spare for the text and for moving aside): not placed.
      const hw = 0.8 * size * Math.max(...lines.map((l) => textWidthEm(l, false, look.style.letterSpacing))) + size, hh = size * (1.5 + 2 * lines.length);
      if (p[0] + hw < 0 || p[0] - hw > view.width || p[1] + hh < 0 || p[1] - hh > view.height) continue;
      out.push({ text: look.text, lines, x: p[0], y: p[1], size, style: look.style, entityId: id, priority: area });
    }
    return out;
  }

  private progressOf = new WeakMap<Map<number, FaceState>, Map<string, { w: number; p: number }>>();

  private terrainMasks = new Map<string, LandMask>();
  /** Land and sea as a terrain's heights have them at a sea level (D179), at most a quarter-degree a cell, kept per terrain. */
  private terrainMask(grid: ElevationGrid, key: string, seaLevel: number): LandMask {
    const k = `${key}|${seaLevel}`;
    let m = this.terrainMasks.get(k);
    if (!m) {
      const W = Math.min(grid.width, 1440), H = W / 2;
      const bits = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        const lat = 90 - ((y + 0.5) / H) * 180;
        for (let x = 0; x < W; x++) bits[y * W + x] = heightAt(grid, -180 + ((x + 0.5) / W) * 360, lat) > seaLevel ? 1 : 0;
      }
      m = new LandMask(W, H, bits);
      if (this.terrainMasks.size >= 6) this.terrainMasks.clear();
      this.terrainMasks.set(k, m);
    }
    return m;
  }

  /** The look of one country's label (null: hidden); set for each frame by render(). */
  private labelLook: (id: string, name: string) => { style: LabelStyle; text: string } | null = (_id, name) => ({ style: resolveLabelStyle(), text: name });

  /** Cities on screen at this moment (their dots), with their names to be placed. */
  private cityItems(view: View, engine: Engine, spaceId: string, t: Instant, entities: Map<string, LabelEntity>): CityItem[] {
    const u = view.unit;
    const out: CityItem[] = [];
    const k = pointScale(view, 0.3, 1.15) * this.pointSizes.city;
    const kDot = pointScale(view, 0.5, 1) * Math.sqrt(this.pointSizes.city);
    for (const c of engine.charactersAt(spaceId, t)) {
      const e = entities.get(c.entity);
      if (!e || e.type_id !== 'settlement') continue;
      if (!cityShown(c.entity, placeMetaOf(e.style), this.cityFilter)) continue;
      const p = view.projection([c.lon, c.lat]);
      if (!p || p[0] < -50 || p[1] < -50 || p[0] > view.width + 50 || p[1] > view.height + 50) continue;
      // Too small to read: no name (marked by a size of 0), only the dot.
      const size = 17 * k >= MIN_CITY_NAME ? 17 * k * u : 0;
      out.push({ entity: c.entity, name: e.name, lon: c.lon, lat: c.lat, x: p[0], y: p[1], r: 4.5 * kDot * u, size, tx: p[0], ty: p[1], align: 'left', drawn: false });
    }
    // A steady order (the same every frame).
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.entity.localeCompare(b.entity));
  }

  /** Cities: a small white dot and, where it has room, the name in a serif face. */
  private drawCities(ctx: CanvasRenderingContext2D, items: CityItem[], u: number): void {
    if (!items.length) return;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const c of items) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = '#f4efe6';
      ctx.fill();
      ctx.lineWidth = 1.6 * u;
      ctx.strokeStyle = '#0a1018';
      ctx.stroke();
      if (!c.drawn) continue;
      ctx.font = cityFont(this.sizeNow(c.size));
      ctx.textAlign = c.align;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5 * u;
      ctx.strokeStyle = 'rgba(10,16,24,0.8)';
      ctx.strokeText(c.name, c.tx, c.ty);
      ctx.fillStyle = '#f4efe6';
      ctx.fillText(c.name, c.tx, c.ty);
    }
    ctx.restore();
  }

  private widths = new Map<string, number>();

  /** The width of a text as it will be drawn (measured once per text, font, size and spacing). */
  private textWidth(ctx: CanvasRenderingContext2D, font: string, spacingPx: number, text: string): number {
    const spacing = `${spacingPx.toFixed(2)}px`;
    const key = `${font}|${spacing}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      ctx.save();
      ctx.font = font;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
      w = ctx.measureText(text).width;
      ctx.restore();
      if (this.widths.size > 8000) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }

  /**
   * Place country labels and city names so that none overlap. In order of priority (larger countries,
   * smaller countries, cities), each takes the first free place among a few near its own: a country
   * label its centre, then a little above, below or to the side; a city name right of its dot, then
   * left, above or below. One that finds no free place is hidden.
   */
  private placeTexts(ctx: CanvasRenderingContext2D, labels: LabelInfo[], cities: CityItem[], frame: [number, number] | null = null, keepOut: Array<[number, number, number, number]> = []): void {
    type Box = [number, number, number, number];
    // (Boxes are kept by the squares of the frame they reach into: with hundreds of names, looking
    // through all of them for each place tried took longer than drawing them.)
    const placed = new BoxGrid(), dotGrid = new BoxGrid();
    const dots: Box[] = cities.map((c) => [c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r]);
    for (const d of dots) dotGrid.add(d);
    const hits = (b: Box, grid: BoxGrid, except: Box | null = null) => grid.hits(b, except);
    // A shot's texts are there first (D178): names move aside from them, or are hidden.
    for (const k of keepOut) placed.add([k[0], k[1], k[2], k[3]]);
    // Names stay inside the frame (D178): one reaching over its edge moves in by as much, when that is less than about
    // half its width (more, and it would leave its land), else it is placed elsewhere or hidden. A city's name goes on
    // a side of its dot that is in the frame.
    const inFrame = (b: Box) => !frame || (b[0] >= 0 && b[1] >= 0 && b[2] <= frame[0] && b[3] <= frame[1]);
    const intoFrame = (b: Box, w: number, h: number): [number, number] | null => {
      if (!frame) return [0, 0];
      const m = 0.12 * h;
      const sx = b[0] < m ? m - b[0] : b[2] > frame[0] - m ? frame[0] - m - b[2] : 0;
      const sy = b[1] < m ? m - b[1] : b[3] > frame[1] - m ? frame[1] - m - b[3] : 0;
      return Math.abs(sx) <= 0.45 * w && Math.abs(sy) <= 0.9 * h ? [sx, sy] : null;
    };
    ctx.save();
    const sorted = [...labels].sort((a, b) => b.priority - a.priority || b.size - a.size || a.text.localeCompare(b.text));
    for (const l of sorted) {
      l.drawn = false;
      const st = l.style;
      const lines = l.lines.length ? l.lines : [l.text];
      const w = (Math.max(...lines.map((t) => this.textWidth(ctx, labelFont(st, MEASURE_AT), st.letterSpacing * MEASURE_AT, t))) * l.size) / MEASURE_AT;
      const h = l.size + (lines.length - 1) * l.size * LINE_HEIGHT;
      const at = (dx: number, dy: number): Box => [l.x + dx - w / 2, l.y + dy - h / 2, l.x + dx + w / 2, l.y + dy + h / 2];
      const tries: Array<[number, number]> = [[0, 0], [0, -0.75 * h], [0, 0.75 * h], [-0.3 * w, 0], [0.3 * w, 0], [0, -1.4 * h], [0, 1.4 * h]];
      // First keeping clear of city dots too; failing that, only of other labels.
      let found: [number, number] | null = null;
      for (const avoidDots of [true, false]) {
        for (const [dx0, dy0] of tries) {
          const into = intoFrame(at(dx0, dy0), w, h);
          if (!into) continue;
          const dx = dx0 + into[0], dy = dy0 + into[1], b = at(dx, dy);
          if (!hits(b, placed) && (!avoidDots || !hits(b, dotGrid))) { found = [dx, dy]; break; }
        }
        if (found) break;
      }
      if (!found) continue;
      l.x += found[0]; l.y += found[1];
      l.box = [l.x - w / 2, l.y - h / 2, l.x + w / 2, l.y + h / 2];
      l.drawn = true;
      placed.add(l.box);
    }
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    for (let i = 0; i < cities.length; i++) {
      const c = cities[i];
      if (!c.size) { c.drawn = false; continue; }
      const w = (this.textWidth(ctx, cityFont(MEASURE_AT), 0, c.name) * c.size) / MEASURE_AT, h = c.size, gap = c.r + 4 * (c.size / 17);
      // (Every dot but the city's own, and any other dot at the very same place.)
      const own = dots[i];
      const options: Array<{ tx: number; ty: number; align: CanvasTextAlign; box: Box }> = [
        { tx: c.x + gap, ty: c.y, align: 'left', box: [c.x + gap, c.y - h / 2, c.x + gap + w, c.y + h / 2] },
        { tx: c.x - gap, ty: c.y, align: 'right', box: [c.x - gap - w, c.y - h / 2, c.x - gap, c.y + h / 2] },
        { tx: c.x + gap * 0.6, ty: c.y - h * 0.8, align: 'left', box: [c.x + gap * 0.6, c.y - h * 1.3, c.x + gap * 0.6 + w, c.y - h * 0.3] },
        { tx: c.x + gap * 0.6, ty: c.y + h * 0.8, align: 'left', box: [c.x + gap * 0.6, c.y + h * 0.3, c.x + gap * 0.6 + w, c.y + h * 1.3] },
        { tx: c.x - gap * 0.6, ty: c.y - h * 0.8, align: 'right', box: [c.x - gap * 0.6 - w, c.y - h * 1.3, c.x - gap * 0.6, c.y - h * 0.3] },
        { tx: c.x - gap * 0.6, ty: c.y + h * 0.8, align: 'right', box: [c.x - gap * 0.6 - w, c.y + h * 0.3, c.x - gap * 0.6, c.y + h * 1.3] },
      ];
      const ok = options.find((o) => inFrame(o.box) && !hits(o.box, placed) && !hits(o.box, dotGrid, own));
      c.drawn = !!ok;
      if (!ok) continue;
      c.tx = ok.tx; c.ty = ok.ty; c.align = ok.align; c.box = ok.box;
      placed.add(ok.box);
    }
    ctx.restore();
  }

  /** Characters: a marker in the character's colour and its name beside it. Points, never territory. */
  private drawCharacters(ctx: CanvasRenderingContext2D, view: View, engine: Engine, spaceId: string, t: Instant, entities: Map<string, LabelEntity>, trails = false, since: Instant | null = null): void {
    const u = view.unit;
    const list = engine.charactersAt(spaceId, t);
    if (!list.length) return;
    ctx.save();
    ctx.lineJoin = 'round';
    // A unit (D90) is drawn in the colour of the country it belongs to.
    const colorOf = (e: LabelEntity) => { const side = this.unitOf(e.style).side; return (side && entities.get(side)?.color) || e.color || '#ffd166'; };
    const k = pointScale(view, 0.6, 1.3) * this.pointSizes.character;
    this.lastAdvances = 0;
    // Routes, under the markers: a trail of the way each character has travelled so far (all of them in a
    // shot showing trails, or one set to show its trail), or a unit's arrow of advance along its leg under way.
    for (const c of list) {
      const e = entities.get(c.entity);
      if (!e || e.type_id === 'settlement') continue;
      const route = this.unitOf(e.style).route ?? (trails ? 'trail' : null);
      if (!route) continue;
      const track = engine.characterTrack(spaceId, c.entity);
      if (route === 'arrow') { if (this.drawAdvance(ctx, view, track, t, colorOf(e), k)) this.lastAdvances++; continue; }
      const path = new Path2D();
      let any = false;
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1], b = track[i];
        if (compare(a.t, t) > 0) break;
        if (a.off || b.off || b.arrive !== 'travel' || a.t.day === -Infinity) continue;
        // (Only the way travelled since the trail's start: a shot's own span, D176.)
        if (since && compare(b.t, since) <= 0) continue;
        // Up to where the character is now on the last leg, from where it was at the trail's start.
        const span = Math.max(1, diffMs(a.t, b.t));
        const done = compare(b.t, t) <= 0 ? 1 : Math.max(0, Math.min(1, diffMs(a.t, t) / span));
        const from = since && compare(a.t, since) < 0 ? Math.max(0, Math.min(done, diffMs(a.t, since) / span)) : 0;
        const n = Math.max(2, Math.ceil(24 * (done - from)));
        for (let k = 0; k <= n; k++) {
          const [lon, lat] = slerpLonLat(a.lon, a.lat, b.lon, b.lat, from + ((done - from) * k) / n);
          const q = view.projection([lon, lat]);
          if (!q) continue;
          if (k === 0) path.moveTo(q[0], q[1]); else path.lineTo(q[0], q[1]);
          any = true;
        }
      }
      if (!any) continue;
      this.lastTrails++;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(10,16,24,0.6)';
      ctx.stroke(path);
      ctx.lineWidth = 1.8 * u;
      ctx.strokeStyle = colorOf(e);
      ctx.setLineDash([6 * u, 4 * u]);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
    // Each name beside its marker where it overlaps no name already written: to the right, else the left, above or
    // below (D176: characters gathered in one place).
    const placed: Array<[number, number, number, number]> = [];
    for (const c of list) {
      const e = entities.get(c.entity);
      if (!e || e.type_id === 'settlement') continue;
      const p = view.projection([c.lon, c.lat]);
      if (!p || p[0] < -80 || p[1] < -80 || p[0] > view.width + 80 || p[1] > view.height + 80) continue;
      const color = colorOf(e);
      const drawn = this.drawCharacterIcon(ctx, view, c, p, k, color, e.style);
      const r = drawn ? drawn.r : 8 * k * u;
      if (!drawn) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 6 * u;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.2 * Math.min(1, k) * u;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.font = `600 ${(20 * k * u).toFixed(1)}px "Segoe UI", Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(e.name).width, th = 22 * k * u, gap = r + 5 * k * u;
      const spots: Array<[number, number, CanvasTextAlign]> = [[p[0] + gap, p[1], 'left'], [p[0] - gap, p[1], 'right'], [p[0], p[1] - gap - th / 2, 'center'], [p[0], p[1] + gap + th / 2, 'center']];
      const boxOf = ([x, y, align]: [number, number, CanvasTextAlign]): [number, number, number, number] => { const x0 = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2; return [x0, y - th / 2, x0 + tw, y + th / 2]; };
      const free = (bx: [number, number, number, number]) => placed.every((q) => bx[2] <= q[0] || bx[0] >= q[2] || bx[3] <= q[1] || bx[1] >= q[3]);
      const spot = spots.find((sp) => free(boxOf(sp))) ?? spots[0];
      placed.push(boxOf(spot));
      ctx.textAlign = spot[2];
      ctx.lineWidth = 4 * k * u;
      ctx.strokeStyle = 'rgba(10,16,24,0.85)';
      ctx.strokeText(e.name, spot[0], spot[1]);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(e.name, spot[0], spot[1]);
      this.lastCharacters.push({ entity: c.entity, name: e.name, x: p[0], y: p[1], lon: c.lon, lat: c.lat, moving: c.moving, r: r / u, icon: drawn?.icon ?? 'marker', angle: drawn?.angle ?? 0, mirror: drawn?.mirror ?? false, color });
    }
    ctx.restore();
  }

  /**
   * A unit's arrow of advance (D90): along the leg it is travelling, from where the leg began to just
   * behind where it is now, in its colour on a dark edge, with a head pointing on. Nothing when it is not
   * travelling. `k`: the size of characters at this zoom.
   */
  private drawAdvance(ctx: CanvasRenderingContext2D, view: View, track: ReturnType<Engine['characterTrack']>, t: Instant, color: string, k: number): boolean {
    let at = -1;
    for (let i = 0; i < track.length && compare(track[i].t, t) <= 0; i++) at = i;
    const a = track[at], b = track[at + 1];
    if (!a || !b || a.off || b.off || b.arrive !== 'travel' || a.t.day === -Infinity) return false;
    const done = Math.max(0, Math.min(1, diffMs(a.t, t) / Math.max(1, diffMs(a.t, b.t))));
    if (!(done > 0)) return false;
    const n = Math.max(2, Math.ceil(40 * done)), pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const [lon, lat] = slerpLonLat(a.lon, a.lat, b.lon, b.lat, (done * i) / n);
      const q = view.projection([lon, lat]);
      if (q) pts.push(q[0], q[1]);
    }
    // Stopped short of the unit, so the head shows in front of its icon's back.
    const u = view.unit, back = 16 * k * u, width = 7 * k * u;
    let cut = pts.length;
    for (let left = back; cut >= 4 && left > 0; cut -= 2) {
      const d = Math.hypot(pts[cut - 2] - pts[cut - 4], pts[cut - 1] - pts[cut - 3]);
      if (d > left) { const f = (d - left) / d; pts[cut - 2] = pts[cut - 4] + (pts[cut - 2] - pts[cut - 4]) * f; pts[cut - 1] = pts[cut - 3] + (pts[cut - 1] - pts[cut - 3]) * f; break; }
      left -= d;
    }
    if (cut < 4) return false;
    const line = Float32Array.from(pts.slice(0, cut));
    const path = new Path2D();
    addLine(path, line);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10,16,24,0.7)';
    ctx.lineWidth = width + 3 * u;
    ctx.stroke(path);
    ctx.fillStyle = 'rgba(10,16,24,0.7)';
    this.drawArrowhead(ctx, line, width + 1.2 * u, true);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(path);
    ctx.fillStyle = color;
    this.drawArrowhead(ctx, line, width, true);
    ctx.restore();
    return true;
  }

  /**
   * A character's icon (D85), if it has one that can be drawn now: an icon of the set, or its own
   * picture once loaded (until then, the round marker). Turned or flipped to face the way it is
   * travelling, or last travelled. Returns how far it reaches from its middle (where the name goes).
   */
  private drawCharacterIcon(ctx: CanvasRenderingContext2D, view: View, c: { lon: number; lat: number; ahead?: [number, number] }, p: [number, number], k: number, color: string, style: string | undefined): { r: number; icon: string; angle: number; mirror: boolean } | null {
    if (!style) return null;
    let icon = this.iconStyles.get(style);
    if (icon === undefined) { if (this.iconStyles.size > 2000) this.iconStyles.clear(); icon = iconOfStyle(style); this.iconStyles.set(style, icon); }
    if (!icon) return null;
    const def = icon.set ? iconById(icon.set) : undefined;
    const img = !def && icon.asset ? imageNow(icon.asset) : null;
    if (!def && !img) return null;
    const u = view.unit;
    const look = icon.look ?? 'plain';
    // Across: an icon on its own is drawn larger than one on a disc (its outline is its edge).
    const size = (look === 'badge' ? 34 : 42) * k * u * (icon.size ?? 1);
    // Which way it faces: aircraft (seen from above) turn to the way they go; ships and vehicles
    // (seen from the side) face east or west; signs stay as they are.
    const turn = icon.turn && icon.turn !== 'auto' ? icon.turn : (def?.turn ?? 'none');
    let angle = 0, mirror = false;
    if (turn !== 'none' && c.ahead) {
      const q = view.projection(c.ahead);
      if (q) {
        const dx = q[0] - p[0], dy = q[1] - p[1];
        if (dx * dx + dy * dy > 1e-10) { if (turn === 'rotate') angle = Math.atan2(dy, dx) + Math.PI / 2; else mirror = dx < 0; }
      }
    }
    const ring = 2.2 * Math.min(1, k) * u;
    if (look === 'badge') {
      const R = size * 0.5;
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 6 * u;
      ctx.beginPath();
      ctx.arc(p[0], p[1], R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (def) drawIcon(ctx, def, p[0], p[1], size * 0.66, { color: '#ffffff', detail: color, angle, mirror });
      else if (img) {
        ctx.save();
        ctx.clip();
        ctx.translate(p[0], p[1]);
        if (angle) ctx.rotate(angle);
        if (mirror) ctx.scale(-1, 1);
        drawImageFit(ctx, img, -R, -R, 2 * R, 2 * R, 'cover');
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(p[0], p[1], R, 0, Math.PI * 2);
      ctx.lineWidth = ring;
      ctx.strokeStyle = def ? '#ffffff' : color;
      ctx.stroke();
      return { r: R + ring / 2, icon: def?.id ?? 'picture', angle, mirror };
    }
    if (def) drawIcon(ctx, def, p[0], p[1], size, { color, detail: 'rgba(10,16,24,0.88)', halo: 3.5, angle, mirror });
    else if (img) {
      ctx.save();
      ctx.translate(p[0], p[1]);
      if (angle) ctx.rotate(angle);
      if (mirror) ctx.scale(-1, 1);
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 5 * u;
      drawImageFit(ctx, img, -size / 2, -size / 2, size, size, 'contain');
      ctx.restore();
    }
    return { r: size * 0.45, icon: def?.id ?? 'picture', angle, mirror };
  }

  /** The map's scale in the frame before, and whether this frame is a step of a zoom (the scale changing while the view moves). */
  private lastScale = 0;
  private zooming = false;
  private zoomOut = false;

  /**
   * The size a text is drawn at. While zooming (and while the timeline is dragged, when names grow
   * and shrink with their countries), sizes go in steps of a twelfth: the browser keeps the letters
   * it has drawn (and their outlines) by size, and a size never seen before in every frame made
   * drawing the names the dearest part of a zoom's frame. Exact again at rest.
   */
  private sizeNow(size: number): number {
    if (!(this.zooming || this.hurried) || !(size > 0)) return size;
    const step = Math.log(1.085), q = Math.exp(Math.round(Math.log(size) / step) * step);
    if (Math.abs(q - size) > 0.02) this.lastApproximate = true;
    return q;
  }

  private drawLabels(ctx: CanvasRenderingContext2D, labels: LabelInfo[], _style: MapStyle, _u: number): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of labels) {
      if (!l.drawn) continue; // no free place (see placeTexts)
      const st = l.style;
      const size = this.sizeNow(l.size);
      ctx.font = labelFont(st, size);
      const spacing = st.letterSpacing * size;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing.toFixed(2)}px`;
      const lines = l.lines.length ? l.lines : [l.text];
      const lh = l.size * LINE_HEIGHT;
      // With letter spacing the text grows to the right; shift it back so it stays centred.
      const x = l.x + spacing / 2;
      ctx.globalAlpha = st.opacity;
      lines.forEach((t, i) => {
        const y = l.y - ((lines.length - 1) * lh) / 2 + i * lh;
        if (st.haloWidth > 0) {
          ctx.lineWidth = Math.max(1, size * st.haloWidth);
          ctx.strokeStyle = st.haloColor;
          ctx.strokeText(t, x, y);
        }
        ctx.fillStyle = st.color;
        ctx.fillText(t, x, y);
      });
    }
    ctx.restore();
  }


}

/**
 * Where a picture filling territory is drawn (D81): placed by `box`, fitted as the fill asks (flags
 * filling it), and enlarged about its middle where it must also cover `cover` (outlying pieces, D82).
 */
export function mediaBox(src: CanvasImageSource & { width: number; height: number }, fill: CountryFillLike, box: Box2, cover: Box2 | null): { box: Box2; fit: 'stretch' | 'cover' | 'contain' | 'fill' } {
  // Flags added before 'fill' existed asked for 'cover', which cropped the stripes of long countries away.
  const fit = !fill.fit || fill.fit === 'tile' || (fill.fit === 'cover' && fill.asset?.startsWith('data/flags/')) ? 'fill' : fill.fit;
  let [x, y, w, h] = box;
  if (cover && fit !== 'contain' && fit !== 'stretch') {
    const iw = (src as HTMLVideoElement).videoWidth || src.width, ih = (src as HTMLVideoElement).videoHeight || src.height;
    if (iw && ih) {
      const [sx, sy] = fitScales(iw, ih, w, h, fit);
      const dw = iw * sx, dh = ih * sy, cx = x + w / 2, cy = y + h / 2;
      const k = Math.max(1, (cx - cover[0]) / (dw / 2), (cover[0] + cover[2] - cx) / (dw / 2), (cy - cover[1]) / (dh / 2), (cover[1] + cover[3] - cy) / (dh / 2));
      if (k > 1) { w *= k; h *= k; x = cx - w / 2; y = cy - h / 2; }
    }
  }
  return { box: [x, y, w, h], fit };
}

/** Which way a front line's teeth face (D89): toward the second country of the war (as entered), the first, or none. */
export type FrontTeeth = 'second' | 'first' | 'plain';
export const FRONT_COLOR = '#d62828';
/** The side of an owner's outline (as drawn on a sheet) that faces away from its land. */
export const FRONT_SIDE = 1;

/** Teeth along a line (of features and front lines), on one side of it, filled in the context's colour. */
export function drawTeeth(ctx: CanvasRenderingContext2D, l: Float32Array, width: number, side: number): void {
  const step = 6 * width, size = 2.4 * width;
  let carry = step / 2;
  ctx.beginPath();
  for (let i = 2; i + 1 < l.length; i += 2) {
    const ax = l[i - 2], ay = l[i - 1], bx = l[i], by = l[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const dx = (bx - ax) / len, dy = (by - ay) / len, nx = -dy * side, ny = dx * side;
    let d = carry;
    for (; d + size / 2 <= len; d += step) {
      const cx = ax + dx * d, cy = ay + dy * d;
      ctx.moveTo(cx - dx * size / 2, cy - dy * size / 2);
      ctx.lineTo(cx + nx * size, cy + ny * size);
      ctx.lineTo(cx + dx * size / 2, cy + dy * size / 2);
    }
    carry = Math.max(0, d - len);
  }
  ctx.fill();
}

/** The wars holding at t (relationships "at war" between two that exist), as [drawn from, teeth toward]. */
export function warsAt(world: World, engine: Engine, t: Instant, teeth: FrontTeeth): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const id of engine.relationsAt(t)) {
    const r = world.get('relation', id);
    if (!r || r.kind !== 'war' || r.a === r.b) continue;
    out.push(teeth === 'first' ? [r.b, r.a] : [r.a, r.b]);
  }
  return out.sort((x, y) => (x.join('>') < y.join('>') ? -1 : 1));
}

/**
 * How large cities and characters are drawn at a zoom: from the design pixels per degree at the
 * view's centre (the same in a preview and an export), small when zoomed out, as designed around a
 * country's scale, a little larger close up.
 */
function pointScale(view: View, lo: number, hi: number): number {
  const designPxPerDeg = (view.projection.scale() * Math.PI) / 180 / view.unit;
  return Math.min(hi, Math.max(lo, Math.sqrt(designPxPerDeg / 25)));
}

/** City names smaller than this (design pixels) are left out; the dot stays. */
const MIN_CITY_NAME = 8;

/** A city on screen: its dot, and where its name goes (if anywhere: `drawn`). */
interface CityItem { entity: string; name: string; lon: number; lat: number; x: number; y: number; r: number; size: number; tx: number; ty: number; align: CanvasTextAlign; drawn: boolean; box?: [number, number, number, number] }

/** The middle of the largest ring of an area on screen (its centroid), or null. */
function areaMiddle(rings: Float32Array[]): [number, number] | null {
  let best: [number, number] | null = null, bestA = 0;
  for (const r of rings) {
    let a = 0, cx = 0, cy = 0;
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const c = r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
      a += c; cx += (r[2 * j] + r[2 * i]) * c; cy += (r[2 * j + 1] + r[2 * i + 1]) * c;
    }
    if (Math.abs(a) > bestA && a) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best;
}

/** The middle of the longest line on screen, and the angle of the line there (kept readable), or null. */
function lineMiddle(lines: Float32Array[]): [number, number, number] | null {
  let best: Float32Array | null = null, bestLen = 0;
  for (const l of lines) { let len = 0; for (let i = 2; i + 1 < l.length; i += 2) len += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]); if (len > bestLen) { bestLen = len; best = l; } }
  if (!best) return null;
  let left = bestLen / 2;
  for (let i = 2; i + 1 < best.length; i += 2) {
    const dx = best[i] - best[i - 2], dy = best[i + 1] - best[i - 1], seg = Math.hypot(dx, dy);
    if (seg < left) { left -= seg; continue; }
    let a = Math.atan2(dy, dx);
    if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
    const f = seg ? left / seg : 0;
    return [best[i - 2] + dx * f, best[i - 1] + dy * f, a];
  }
  return null;
}

const cityFont = (size: number) => `500 ${size.toFixed(1)}px Georgia, "Times New Roman", serif`;
/**
 * Names are measured at this size (pixels) and the width scaled to the size they are drawn at: a
 * text's width grows with its size, and measuring at every size made each step of a zoom measure
 * every name on the map again (the widths only say which names would overlap).
 */
const MEASURE_AT = 100;

/** An advancing front from a border: how far it must travel, and the area reached at a distance. */
interface BorderFront { maxDist: number; reach: (r: number) => Path2D }

/** How a shot's fronts look (D136): how ragged they are. */
/**
 * How a change's front looks (D137): how ragged it is, the new owner's colour running softly ahead of it, a glow
 * over the land just taken, fading behind it (each 0 to 1), and the line along it.
 */
export interface FrontLookOptions {
  roughness: number;
  soft: number;
  wake: number;
  /** How much the front minds the land (D142; 0: not at all). */
  terrain: number;
  front: { show: boolean; color: string; width: number; glow: number };
}

/** How many cells across a change's longer side its front's field may have (D136): the coarsest that suits its size on screen. */
const FIELD_CELLS = [32, 48, 72, 108, 160];

/** A look by its id (presentation/sequence.ts TRANSITION_LOOKS), its front line's width and glow as in `base` unless set. */
function lookById(id: string, base: FrontLookOptions): FrontLookOptions | null {
  const l = TRANSITION_LOOKS.find((x) => x.id === id);
  if (!l) return null;
  return { roughness: l.set.roughness ?? 0, soft: l.set.soft ?? 0, wake: l.set.wake ?? 0, terrain: l.set.terrain ?? 0, front: { ...base.front, ...(l.set.front ?? {}) } };
}

/** A colour mixed toward white (`k` 0 to 1), as #rrggbb; the colour unchanged when it cannot be read. */
function lighten(color: string, k: number): string {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const ch = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) + (255 - parseInt(h.slice(i, i + 2), 16)) * k);
  return `#${[0, 2, 4].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`;
}

/** A number from a change's id, seeding its front's pattern. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

interface FaceInfo { stamp: number; area: number; land: number; x: number; y: number; z: number }

function vec3(p: [number, number]): [number, number, number] {
  const lon = (p[0] * Math.PI) / 180, lat = (p[1] * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

function toLonLat(v: [number, number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.atan2(v[1], v[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, v[2] / len))) * 180 / Math.PI];
}


/** A line (screen points, x and y in turn) drawn only `f` of the way along its length (0 to 1). */
export function cutLine(l: Float32Array, f: number): Float32Array {
  if (f >= 1) return l;
  const n = l.length >> 1;
  if (n < 2 || f <= 0) return l.subarray(0, Math.min(l.length, 2));
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(l[2 * i] - l[2 * i - 2], l[2 * i + 1] - l[2 * i - 1]);
  let left = total * f;
  const out: number[] = [l[0], l[1]];
  for (let i = 1; i < n; i++) {
    const x0 = l[2 * i - 2], y0 = l[2 * i - 1], x1 = l[2 * i], y1 = l[2 * i + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d >= left) { const r = d ? left / d : 0; out.push(x0 + (x1 - x0) * r, y0 + (y1 - y0) * r); break; }
    out.push(x1, y1);
    left -= d;
  }
  return Float32Array.from(out);
}
