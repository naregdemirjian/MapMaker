// The map renderer: draws a map space at a moment in time from the world model and the temporal
// engine. Nothing here is stored history: every pixel is computed from parcels, effects and styles.
//
// This is the Canvas 2D backend. Parcels, borders and the Earth basemap are drawn from geometry
// prepared on a "sheet" of the projection's plane (plane.ts): while the view stays on the sheet,
// panning and zooming cost no geometry work, only drawing; an edit prepares only the parcels it
// changed; and what stays the same through a stretch of time (who holds what, which borders show)
// is worked out once for the stretch (LayerSnap), not once per frame.
import { geoPath, geoCircle, geoCentroid, geoArea, type GeoPermissibleObjects } from 'd3-geo';
import type { World } from '../world-model/world.ts';
import type { Engine, FaceState, Assignment, CompiledTransition } from '../temporal-engine/engine.ts';
import { parseJSON, slerpLonLat } from '../temporal-engine/engine.ts';
import { type Instant, compare, diffMs } from '../core-time/index.ts';
import { BASE_EVENT_ID } from '../world-model/schema.ts';
import type { Vec3 } from '../geo-kernel/vec.ts';
import { screenToLonLat, FLAT_EXTENT_DEG, type View } from './camera.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import { BasemapPainter, chooseScale, landMaskOf, visibleBounds, boxIntersects, type Basemap, type LandMask } from './basemap.ts';
import { planeShape, placeLabel, lineChoices, textWidthEm, blockHeightEm, LINE_HEIGHT, type PlaneShape } from './label-place.ts';
import { resolveLabelStyle, resolvePointStyle, labelSize, labelFont, labelText, type LabelStyle, type CountryLabel } from './label-style.ts';
import { imageNow, videoNow, drawImageFit, assetEpoch, type MediaChannel } from './assets.ts';
import { Sheet, makeRing, addLine, projectPoint, isCylindrical, type Ring } from './plane.ts';
import { BlockPath, setPaintRegion, type DeviceRect } from './blocks.ts';
import { Kept as Weighed } from './kept.ts';
import { parcelGeometry, type ParcelGeometry, type CycleGeom } from './parcel-geometry.ts';

type LabelEntity = { name: string; style?: string; color?: string; type_id?: string };

export type PassName = 'background' | 'graticule' | 'land' | 'fills' | 'borders' | 'cities' | 'labels' | 'characters';
/** Drawing order. The grid lies under the land, so stacked export passes match the full picture. */
export const ALL_PASSES: PassName[] = ['background', 'graticule', 'land', 'fills', 'borders', 'cities', 'labels', 'characters'];

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
export const VIEW_QUALITY: RenderQuality = { tolerance: 0.35, margin: 0.6 };
/** Exports: a tenth of a pixel, whatever the working view is set to. */
export const EXPORT_QUALITY: RenderQuality = { tolerance: 0.1, margin: 0.3 };

export interface RenderOptions {
  passes: Set<PassName>;
  transparent: boolean;
  layerIds: string[]; // partition layers to draw, bottom to top
  style?: MapStyle;
  /** Earth's geography under the territories (the 'land' pass); null or absent draws none. */
  basemap?: Basemap | null;
  /** Present-day country borders over the land, as a drawing aid (never part of an export). */
  referenceBorders?: boolean;
  /** A shot's way of animating border changes; absent: as recorded (world-building view). */
  transitions?: ShotTransitionOptions;
  /** Screen seconds into the shot, for video fills (0 or absent: the first frame). */
  mediaSeconds?: number;
  /** 'export' for exports (videos sought beforehand by prepareVideos); 'live' otherwise. */
  mediaChannel?: MediaChannel;
  /** Draw each character's route so far (shots with trails on). */
  trails?: boolean;
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
interface CountryFillLike { kind: 'color' | 'image' | 'video'; asset?: string; off?: boolean; fit?: 'cover' | 'contain' | 'stretch' | 'tile'; tileSize?: number; play?: 'loop' | 'once'; speed?: number; start?: number }

/** x, y, width, height on screen. */
type Box2 = [number, number, number, number];

export type TransitionEase = 'linear' | 'smooth' | 'in' | 'out';

/** Shot transition settings as the renderer needs them (see presentation/sequence.ts ShotTransitions). */
export interface ShotTransitionOptions {
  mode: 'recorded' | 'all' | 'instant';
  style: 'border' | 'advance' | 'fade' | 'wipe';
  angle: number;
  timing: 'seconds' | 'event';
  seconds: number;
  easing: TransitionEase;
  restyleRecorded: boolean;
  front: { show: boolean; color: string; width: number; glow: number };
  /** Screen seconds since the frame that showed instant t (Infinity if before the shot). */
  secondsSince: (t: Instant) => number;
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
interface OwnerPiece { owner: string; key: string; arcs: Float64Array; centreLon: number; area: number; total: number; /** Its outline's box: west, south, east, north. */ box: [number, number, number, number] }
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
interface OwnerBorder { key: string; b: Int32Array; take: number[] }

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
  /** All the parcels of the change, and those changing owner (null: none of it is on the sheet). */
  region: Shape | null;
  changing: Shape | null;
}

interface BorderPaths { plain: Array<Path2D | BlockPath>; inside: Map<string, Path2D>; outside: Map<string, Path2D> }

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
  lastLabels: LabelInfo[] = [];
  /** The characters drawn in the last frame, where (screen) and on the map, for picking and tests. */
  lastCharacters: Array<{ entity: string; name: string; x: number; y: number; lon: number; lat: number; moving: boolean }> = [];
  /** The project's sizes for cities and characters (set for each frame by render()). */
  private pointSizes = { city: 1, character: 1 };
  /** How many characters' trails the last frame drew. */
  lastTrails = 0;
  /** The cities drawn in the last frame (same form; `named`: whether its name had room). */
  lastCities: Array<{ entity: string; name: string; x: number; y: number; lon: number; lat: number; moving: boolean; named: boolean; box?: [number, number, number, number] }> = [];
  /** The animated changes drawn in the last frame (style and eased progress), for checks and tests. */
  lastTransitions: Array<{ style: string; progress: number }> = [];
  /** For benchmarks and tests: how many sheets have been made, and snapshots of layers worked out. */
  stats = { sheets: 0, snaps: 0, snapsFollowed: 0 };

  // ---------------------------------------------------------------- sheets (prepared geometry)

  private sheet: Sheet | null = null;
  private sheetSpace = '';
  /** The transform that puts the current sheet on the view being drawn: scale, x, y. */
  private place: [number, number, number] = [1, 0, 0];

  /** The sheet to draw a view from: the current one while the view stays on it, else a new one. */
  /** The sheet to draw the view on; `pad`: view pixels around the view that are drawn on too (the room around carried pictures). */
  private sheetFor(view: View, spaceId: string, pad = 0): Sheet {
    if (!this.sheet || this.sheetSpace !== spaceId || !this.sheet.covers(view, this.quality.tolerance, pad)) {
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
    if (s.path instanceof BlockPath) s.path.paint(c, 1, (p) => c.fill(p, rule));
    else c.fill(s.path, rule);
    c.restore();
  }

  private clip(c: CanvasRenderingContext2D, s: Shape, rule: CanvasFillRule = 'evenodd'): void {
    if (!s.onSheet) { c.clip(solid(s.path), rule); return; }
    const [k, e, f] = this.place;
    c.transform(k, 0, 0, k, e, f);
    c.clip(solid(s.path), rule);
    c.transform(1 / k, 0, 0, 1 / k, -e / k, -f / k);
  }

  /** Stroke a sheet path with a line `width` screen pixels wide. */
  private strokeOnSheet(c: CanvasRenderingContext2D, path: Path2D | BlockPath, width: number): void {
    const [k, e, f] = this.place;
    c.save();
    c.transform(k, 0, 0, k, e, f);
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
    const rest = (l: number[] | undefined, more: number[] | undefined) => { const o = (l ?? []).filter((f) => !moved.has(f)); if (more) o.push(...more); return o.sort(num); };
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
    const take: number[] = [];
    for (let q = 0; q < b.length; q += 3) {
      const other = arr.halfEdgeFace(geom.cycle(b[q], t).heads[b[q + 1]] ^ 1);
      if (inGroup.size && (inGroup.has(other) || inGroup.has(t.cycleLabel.get(b[q])!))) continue;
      const across = states.get(other);
      if (across === undefined) continue;
      if (across.value !== null && (across.value === owner || !b[q + 2])) continue;
      take.push(q);
      h1 = Math.imul(h1 ^ q, 16777619) >>> 0; h2 = (Math.imul(h2 + q, 2246822519) ^ (h2 >>> 13)) >>> 0; n++;
    }
    return n ? { key: `${set.key}|${n}|${h1}|${h2}`, b, take } : null;
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
    const plain: Array<Path2D | BlockPath> = [];
    // (Borders both before and after an animated change, chain by chain: see step 2.)
    const loose = new Path2D();
    let anyLoose = false;
    // 1. Away from any animated change: owner by owner.
    for (const e of this.bordersOf(arr, snap, states).values()) {
      let p = sp.ownerBorders.get(e.key);
      if (p === undefined) {
        const path = sheet.blocks();
        let any = false;
        for (const q of e.take) for (const l of this.chainLines(sp, sheet, geom, e.b[q], e.b[q + 1])) { path.addLine(l); any = true; }
        p = any ? path : null;
        sp.ownerBorders.set(e.key, p);
      }
      if (p) plain.push(p);
    }
    // 2. Around the parcels of animated changes: chain by chain.
    const inside = new Map<string, Path2D>(), outside = new Map<string, Path2D>();
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
            const now = differs(a.value, b.value);
            const was = differs(a.transition!.from, gb ? b.transition!.from : b.value);
            if (!now && !was) continue;
            const lines = this.chainLines(sp, sheet, geom, c, i);
            // A border both before and after, or where two animations meet: drawn throughout.
            if ((now && was) || (gb && gb !== ga)) { for (const l of lines) { addLine(loose, l); anyLoose = true; } }
            else addTo(now ? inside : outside, ga, lines);
          }
        }
      }
    }
    if (anyLoose) plain.push(loose);
    bp = { plain, inside, outside };
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
  private patchPrev: { strict: string; stable: string; arr: Arrangement; revision: number; layers: Array<Map<number, FaceState>> } | null = null;

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
  private changesSince(view: View, arr: Arrangement, engine: Engine, layers: Array<Map<number, FaceState>>, strict: string, stable: string, m: DOMMatrix, width: number, height: number, pad: number): { from: string; rects: DeviceRect[] } | null {
    const prev = this.patchPrev;
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
    this.patchPrev = { strict, stable, arr, revision: arr.revision, layers };
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
    const noteRoom = () => { if (M && !renew) { const q = room(), v = b.valid; if (v[0] > q[0] || v[1] > q[1] || v[2] < q[2] || v[3] < q[3]) this.roomToFill = true; } };
    if (b.key === exact) {
      this.lastParts[name] = again(0, 0) ? 'renewed' : 'kept';
      if (this.fillRoom && M && !renew) { const q = room(); this.extend(b, q[0], q[1], q[2], q[3], (rects) => paint(rects, 0, 0)); }
      noteRoom();
      blit();
      return;
    }
    if (patch && this.carry && b.key === exactOf(patch.from)) {
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
          if (nx || ny) this.slide(b, w, h, nx, ny, renew ? 0 : M, (rects) => paint(rects, rx, ry));
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
      drawnTo = this.zoomOut && !renew ? room() : [M, M, M + w, M + h];
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

  // ---------------------------------------------------------------- a frame

  render(ctx: CanvasRenderingContext2D, view: View, world: World, engine: Engine, spaceId: string, t: Instant, opts: RenderOptions): void {
    const style = opts.style ?? DEFAULT_STYLE;
    const arr = world.arrangement(spaceId);
    const u = view.unit;
    // Carried pictures hold some of the map around the frame (see slide): the sheet must reach that
    // far, and the planet's outline counts as in view when it lies there.
    const m00 = ctx.getTransform();
    const keepPad = this.caching !== 'off' && this.carry ? (this.marginFor(ctx.canvas.width, ctx.canvas.height) + 2) / (Math.hypot(m00.a, m00.b) || 1) : 0;
    const sheet = this.sheetFor(view, spaceId, keepPad);
    const sp = this.parcelsOn(sheet, arr);
    this.moving = !!opts.moving;
    this.holdNames = !!opts.holdNames;
    this.lastApproximate = false;
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
    const wantsBase = wantsBackground || opts.passes.has('graticule') || wantsLand;
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
    const frameKey = `${view.key}|${ctx.canvas.width}x${ctx.canvas.height}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}|${spaceId}`;
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
      const baseKey = partKey(`${wantsBackground ? style.ocean : ''}|${opts.passes.has('graticule') ? style.graticule : ''}|${wantsLand ? `${opts.basemap!.scales.length}${opts.referenceBorders ? 'r' : ''}` : ''}|${space?.radius_m ?? 0}`, `${gridStep}`);
      // (One kept picture per combination of parts: an export draws several passes of each frame.)
      base = { name: `base:${wantsBackground ? 'o' : ''}${opts.passes.has('graticule') ? 'g' : ''}${wantsLand ? 'l' : ''}`, key: baseKey, draw: (c) => {
        if (wantsBackground) {
          c.fillStyle = style.ocean;
          const band = this.periodic;
          if (band) c.fillRect(-1e6, band[0], 2e6, band[1] - band[0]); else c.fill(sphere);
        }
        c.save();
        clipPlanet(c);
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
        if (wantsLand) this.basemapPainter.draw(c, view, sheet, opts.basemap!, { referenceBorders: !!opts.referenceBorders, oceanColor: wantsBackground ? style.ocean : undefined });
        c.restore();
      } };
    }

    // Each name as it is at this moment (names can change over time).
    const entities = new Map(world.all('entity').map((e) => { const n = engine.nameAt(e.id, t); return [e.id, n ? { ...e, name: n } : e]; }));
    this.mediaSeconds = opts.mediaSeconds ?? 0;
    this.mediaChannel = opts.mediaChannel ?? 'live';
    // Pictures and videos filling territory, by owner.
    const fills = new Map<string, CountryFillLike | null>();
    let anyMedia = false;
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
    this.pointSizes = resolvePointStyle(world.get('meta', 'point_style')?.value);
    const labels: LabelInfo[] = [];

    // Draw in the same order whether everything is drawn at once or pass by pass (as exported):
    // the fills of every layer, then the borders of every layer, then the labels. Stacking the
    // exported passes in Premiere then reproduces the full picture exactly, with several layers too.
    // What the full picture shows (an export pass drawn on its own still places its texts as the full
    // picture does, so stacked passes match it).
    const layout = opts.layout ?? { labels: opts.passes.has('labels'), cities: opts.passes.has('cities') };
    const placesText = opts.passes.has('labels') || opts.passes.has('cities');
    const drawsLayers = opts.passes.has('fills') || opts.passes.has('borders') || (placesText && layout.labels);
    type LayerStyle = { fillOpacity?: number; borderWidth?: number; clipToLand?: boolean };
    const prepared: Array<{ ls: LayerStyle; states: Map<number, FaceState>; snap: LayerSnap; tg: { groups: Map<string, TransitionGroup>; of: Map<number, TransitionGroup> }; clip: boolean }> = [];
    let landKey = '', layerSig = '', animated = false;
    for (const layerId of drawsLayers ? opts.layerIds : []) {
      const layer = world.get('layer', layerId);
      if (!layer || layer.space_id !== spaceId || layer.kind !== 'partition') continue;
      let states = engine.partitionState(spaceId, layerId, t);
      let changing = engine.partitionChanging(spaceId, layerId, t);
      let sig = '';
      if (opts.transitions) ({ states, changing, sig } = this.shotStates(engine, spaceId, layerId, t, states, changing, opts.transitions));
      const snap = this.snapFor(`${engine.revision}|${arr.revision}|${spaceId}|${layerId}|${engine.stretchOf(t)}|${sig}`, arr, states, changing, engine);
      const ls = parseJSON<LayerStyle>(layer.style, {});
      // Coastline clipping: territory ends at the coast unless the layer is set to cover the sea.
      // Away from any coast there is nothing to trim (all land), or nothing to see (all sea).
      let clip = !!opts.basemap && ls.clipToLand !== false;
      if (clip) {
        const coast = this.basemapPainter.pathsFor(view, sheet, opts.basemap!).coast;
        if (coast === 'land') clip = false;
        else if (coast === 'sea') continue;
      }
      const tg = this.transitionGroups(view, sheet, sp, arr, snap, states);
      prepared.push({ ls, states, snap, tg, clip });
      landKey += `|${snap.key}|${layer.style}|${clip ? 1 : 0}`;
      layerSig += `|${layerId}|${layer.style}|${clip ? 1 : 0}`;
      if (tg.groups.size) animated = true;
      for (const owner of snap.byOwner.keys()) if (fillOf(owner)) anyMedia = true;
    }

    this.lastTransitions = prepared.flatMap((p) => [...p.tg.groups.values()].map((g) => ({ style: g.spec.style, progress: g.progress })));
    const land = (): Shape => ({ path: this.basemapPainter.pathsFor(view, sheet, opts.basemap!).land, onSheet: true });
    const wantsFills = opts.passes.has('fills'), wantsBorders = opts.passes.has('borders');

    // ---- Territories and borders. The same picture while nothing changes hands (and nothing animates).
    if ((wantsFills || wantsBorders) && prepared.length) {
      const front = opts.transitions?.front ?? { show: true, color: style.frontGlow, width: 2.2, glow: 10 };
      // A change under way looks different at every instant (and in a shot, at every frame, which is
      // drawn afresh); so do videos. Pictures are kept until one loads.
      // While a change animates, everything outside its area stays as it is throughout the stretch of
      // time: the picture is kept, and only the rectangles around the animated changes are drawn again
      // for each moment (unless they take up most of the frame, or the view is turned).
      const widestLine = Math.max(...prepared.map((p) => p.ls.borderWidth ?? style.borderWidth));
      let renew: Renew | null = null;
      if (animated && !anyMedia && m.b === 0 && m.c === 0) {
        const boxes: number[][] = [];
        const pad = 3 * front.glow * u + (front.width + widestLine) * u + 6;
        let ok = true, total = 0;
        outer: for (const p of prepared) for (const g of p.tg.groups.values()) for (const f of g.faces) {
          if (!this.joinFace(boxes, view, arr, f, m, pad, ctx.canvas.width, ctx.canvas.height)) { ok = false; break outer; }
        }
        for (const q of boxes) total += (q[2] - q[0]) * (q[3] - q[1]);
        if (ok && total <= 0.6 * ctx.canvas.width * ctx.canvas.height) renew = { rects: boxes.map((q) => [q[0], q[1], q[2] - q[0], q[3] - q[1]] as DeviceRect), moment: `${t.day}:${t.ms}|${opts.mediaSeconds ?? 0}` };
      }
      const key = animated && !renew && opts.transitions ? null : partKey(`${animated && !renew ? `${t.day}:${t.ms}|` : ''}${renew ? 'animated|' : ''}${wantsFills ? 'f' : ''}${wantsBorders ? 'b' : ''}|${world.revision}|${style.border}|${style.borderWidth}|${opts.basemap ? opts.basemap.scales.length : ''}${landKey}${anyMedia ? `|${assetEpoch()}|${this.mediaSeconds}|${this.mediaChannel}` : ''}`);
      // The working view, after an edit or a step in time that changed few parcels: only where they lie is drawn again.
      let patch: { from: string; rects: DeviceRect[] } | null = null;
      if (key && this.carry && !animated && !anyMedia) {
        // (How every country looks, whoever holds land now: a changed colour means the whole picture.)
        let colours = 0;
        for (const e of entities.values()) {
          const look = `${e.id}|${e.color}|${e.style}`;
          let hsh = 0x811c9dc5;
          for (let i = 0; i < look.length; i++) hsh = Math.imul(hsh ^ look.charCodeAt(i), 16777619);
          colours = (colours + (hsh >>> 0)) % 4294967291;
        }
        const stable = `${key.loose.slice(0, looseBase.length)}|${detail}|${wantsFills ? 'f' : ''}${wantsBorders ? 'b' : ''}|${style.border}|${style.borderWidth}|${opts.basemap ? opts.basemap.scales.length : ''}${layerSig}|${colours}`;
        patch = this.changesSince(view, arr, engine, prepared.map((p) => p.states), key.strict, stable, m, ctx.canvas.width, ctx.canvas.height, widestLine * u + 3);
      } else this.patchPrev = null;
      const terrName = `territory:${wantsFills ? 'f' : ''}${wantsBorders ? 'b' : ''}`;
      const terrDraw = (c: CanvasRenderingContext2D) => {
        // (Where the frame lies on what is drawn on: the canvas itself, or a kept picture with room around the frame.)
        const cm = c.getTransform();
        c.save();
        clipPlanet(c);
        if (wantsFills) for (const { ls, snap, tg, clip } of prepared) {
          // Each layer is painted fully opaque in a scratch buffer and laid onto the map once at the
          // layer's opacity: neighbouring parcels then never show seams, and fades mix correctly.
          const lc = this.scratch(c);
          // Pictures are placed by the bounding box of the owner's whole territory (so a flag does not
          // jump between the owner's pieces); an owner whose picture is not loaded yet shows its colour.
          const ownerBox = new Map<string, Box2>();
          const boxOf = (v: string) => {
            let b = ownerBox.get(v);
            if (!b) ownerBox.set(v, (b = this.screenBox(view, arr, snap.reach.get(v) ?? [])));
            return b;
          };
          const paint = (pc: CanvasRenderingContext2D, v: string | null, shape: Shape) => {
            const media = v ? fillOf(v) : null;
            if (v && media && this.paintMedia(pc, media, shape, boxOf(v), view.unit)) return;
            const col = colorOf(v);
            if (col) { pc.fillStyle = col; this.fill(pc, shape); }
            else { pc.save(); pc.globalCompositeOperation = 'destination-out'; pc.fillStyle = '#000'; this.fill(pc, shape); pc.restore(); }
          };
          // Every owner's parcels as one shape (those not on this sheet are skipped altogether).
          for (const [owner, set] of snap.byOwner) {
            const shape = this.setPath(sp, sheet, arr, set);
            if (!shape) continue;
            if (fillOf(owner)) { paint(lc, owner, shape); continue; }
            const col = colorOf(owner);
            if (col) { lc.fillStyle = col; this.fill(lc, shape); }
          }
          for (const g of tg.groups.values()) this.drawTransition(lc, g, paint);
          if (clip) this.maskLand(lc, view, sheet, opts.basemap!, frameKey, true);
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.globalAlpha = ls.fillOpacity ?? 0.78;
          c.drawImage(lc.canvas as CanvasImageSource, 0, 0);
          c.restore();
          // The advancing front is highlighted on top, at full strength.
          if (front.show) for (const g of tg.groups.values()) {
            if (!g.advance || !g.disc || !g.changing) continue;
            c.save();
            if (clip) this.clip(c, land());
            this.clip(c, g.changing);
            if (g.border) {
              // The edge of the reached area: the area minus the area reached a line-width earlier.
              const r = g.progress * g.border.maxDist, w = Math.max(0.5, front.width * view.unit);
              const band = this.scratch(c);
              band.fillStyle = front.color;
              band.fill(g.disc, 'nonzero');
              band.globalCompositeOperation = 'destination-out';
              band.fill(g.border.reach(r - w), 'nonzero');
              band.globalCompositeOperation = 'source-over';
              c.setTransform(1, 0, 0, 1, 0, 0);
              c.shadowColor = front.color;
              c.shadowBlur = front.glow * view.unit;
              // Only the part of the buffer around the change (blurring the glow over the whole frame is slow).
              const [bx, by, bw, bh] = this.deviceBox(this.screenBox(view, arr, g.changingFaces), cm, 3 * front.glow * view.unit + w + 4, c.canvas.width, c.canvas.height);
              if (bw > 0 && bh > 0) c.drawImage(band.canvas as CanvasImageSource, bx, by, bw, bh, bx, by, bw, bh);
            } else {
              c.strokeStyle = front.color;
              c.lineWidth = front.width * view.unit;
              c.shadowColor = front.color;
              c.shadowBlur = front.glow * view.unit;
              c.stroke(g.disc);
            }
            c.restore();
          }
        }
        if (wantsBorders) for (const { ls, states, snap, tg, clip } of prepared) {
          const width = (ls.borderWidth ?? style.borderWidth) * u;
          if (!clip) { this.drawBorders(c, sheet, sp, arr, snap, states, tg, style, width); continue; }
          // Ending at the coast: drawn in the scratch buffer, masked by the land, then laid on.
          const lc = this.scratch(c);
          this.drawBorders(lc, sheet, sp, arr, snap, states, tg, style, width);
          this.maskLand(lc, view, sheet, opts.basemap!, frameKey, false);
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
    } else if (base) this.layered(base.name, ctx, base.key, at, base.draw, null, null, opens);

    // One label per country: a country on several layers (its land, and its military control, say) is
    // labelled from the lowest layer it is on.
    if (placesText && layout.labels) for (const { states, snap, clip } of prepared) {
      for (const l of this.layerLabels(view, arr, snap, states, entities, clip ? landMaskOf(opts.basemap!) : null)) if (!labels.some((x) => x.entityId === l.entityId)) labels.push(l);
    }
    // Country labels and city names are placed together: they move apart where they would overlap,
    // and where they cannot the one with less priority is hidden (larger countries, then smaller
    // ones, then cities).
    const cities = placesText && layout.cities ? this.cityItems(view, engine, spaceId, t, entities) : [];
    if (placesText) this.placeTexts(ctx, labels, cities);
    this.lastCities = cities.map((c) => ({ entity: c.entity, name: c.name, x: c.x, y: c.y, lon: c.lon, lat: c.lat, moving: false, named: c.drawn, box: c.box }));
    if (opts.passes.has('cities')) this.drawCities(ctx, cities, u);
    if (opts.passes.has('labels')) this.drawLabels(ctx, labels, style, u);
    this.lastLabels = labels;
    this.lastCharacters = [];
    this.lastTrails = 0;
    if (opts.passes.has('characters')) this.drawCharacters(ctx, view, engine, spaceId, t, entities, !!opts.trails);
    ctx.restore();
  }

  /** Per stretch of time: the parcels of each change that a shot may animate (not recorded as animated), with what they were before. */
  private shotIndex = new Map<string, Map<string, { a: Assignment; faces: number[]; from: Array<{ value: string | null; prior: Assignment | null }> }>>();

  /**
   * A shot's way of animating changes, applied to the recorded states: no animation at all, every
   * change animated, or recorded animations restyled. History is never changed, only what is drawn.
   * Only the parcels in a change being animated get states of their own; `sig` says which changes
   * those are (so that what stays the same between frames can be kept).
   */
  private shotStates(engine: Engine, spaceId: string, layerId: string, t: Instant, states: Map<number, FaceState>, changing: number[], o: ShotTransitionOptions): { states: Map<number, FaceState>; changing: number[]; sig: string } {
    if (o.mode === 'recorded' && !o.restyleRecorded) return { states, changing, sig: '' };
    const spec: CompiledTransition = { style: o.style, origin: null, maxDist: 0, easing: o.easing, angle: o.angle, shot: true };
    const progressOf = (a: Assignment): number => {
      if (o.timing === 'event' && compare(a.end, a.t) > 0) return diffMs(a.t, t) / Math.max(1, diffMs(a.t, a.end));
      return o.secondsSince(a.t) / Math.max(1e-3, o.seconds);
    };
    let out: Map<number, FaceState> | null = null;
    const put = (f: number, st: FaceState) => { (out ??= new Map(states)).set(f, st); };
    const now: number[] = [];
    const active = new Set<string>();
    // Changes recorded as animated.
    for (const f of changing) {
      const st = states.get(f)!, a = st.assignment;
      if (o.mode === 'instant') { put(f, { value: st.value, assignment: a }); continue; }
      if (!o.restyleRecorded) { now.push(f); active.add(a!.effectId); continue; }
      const p = progressOf(a!);
      if (p >= 1 || !(p >= 0)) put(f, { value: st.value, assignment: a });
      else { put(f, { ...st, transition: { ...st.transition!, progress: p, spec } }); now.push(f); active.add(a!.effectId); }
    }
    // Every other change, animated by the shot ('all'): only those under way at this frame.
    if (o.mode === 'all') {
      const key = `${engine.revision}|${engine.stretchOf(t)}|${spaceId}|${layerId}|${states.size}`;
      let index = this.shotIndex.get(key);
      if (!index) {
        index = new Map();
        for (const [f, st] of states) {
          const a = st.assignment;
          // The starting map is never animated; changes made without an event are, like any other change.
          if (st.transition || !a || (a.eventId === BASE_EVENT_ID && a.t.day === -Infinity)) continue;
          let e = index.get(a.effectId);
          if (!e) index.set(a.effectId, (e = { a, faces: [], from: [] }));
          e.faces.push(f);
        }
        if (this.shotIndex.size >= 6) this.shotIndex.delete(this.shotIndex.keys().next().value!);
        this.shotIndex.set(key, index);
      }
      for (const [id, e] of index) {
        const p = progressOf(e.a);
        if (!(p >= 0 && p < 1)) continue;
        for (let i = 0; i < e.faces.length; i++) {
          const f = e.faces[i], st = states.get(f)!;
          let was = e.from[i];
          if (!was) { const prior = engine.latest(spaceId, layerId, f, t, st.assignment!); was = e.from[i] = { value: prior ? prior.value : null, prior }; }
          if ((was.value ?? '') === (st.value ?? '')) continue;
          put(f, { value: st.value, assignment: st.assignment, transition: { from: was.value, progress: p, spec, prior: was.prior } });
          now.push(f);
          active.add(id);
        }
      }
    }
    return { states: out ?? states, changing: now, sig: `${o.mode}|${o.restyleRecorded ? 1 : 0}|${now.length}|${[...active].sort().join(',')}` };
  }

  /** The animated changes at this moment: the parcels of each (from the snapshot) and how far each has come. */
  private transitionGroups(view: View, sheet: Sheet, sp: SheetParcels, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>): { groups: Map<string, TransitionGroup>; of: Map<number, TransitionGroup> } {
    const groups = new Map<string, TransitionGroup>(), of = new Map<number, TransitionGroup>();
    for (const cg of snap.groups.values()) {
      const st = states.get(cg.region.faces[0])!;
      const spec = st.transition!.spec;
      const advance = spec.style === 'advance' || spec.style === 'wipe' || spec.style === 'border';
      // Shot-made animations use the shot's easing; recorded fronts their own; recorded fades stay even.
      const progress = spec.shot || spec.style === 'advance' || spec.style === 'border' ? ease(spec.easing, st.transition!.progress) : st.transition!.progress;
      const g: TransitionGroup = {
        a: st.assignment!, faces: cg.region.faces, changingFaces: cg.changing.faces, advance, spec, progress, disc: null, discRule: 'evenodd', border: null,
        region: this.setPath(sp, sheet, arr, cg.region), changing: cg.changing.faces.length ? this.setPath(sp, sheet, arr, cg.changing) : null,
      };
      groups.set(cg.id, g);
      for (const f of cg.region.faces) of.set(f, g);
    }
    // The area each moving front has reached: grown from the border with the new owner's land, a
    // circle from its origin, or a straight wipe (older shots).
    for (const g of groups.values()) {
      if (!g.advance || g.progress <= 0) continue;
      if (g.spec.style === 'wipe') { g.disc = this.wipeShape(view, arr, g); continue; }
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
      const circle = geoCircle().center(toLonLat(origin)).radius(Math.min(r, 179.9)).precision(0.5)();
      g.disc = new Path2D(geoPath(view.projection)(circle) ?? '');
    }
    return { groups, of };
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
  private drawTransition(lc: CanvasRenderingContext2D, g: TransitionGroup, paint: (c: CanvasRenderingContext2D, v: string | null, shape: Shape) => void): void {
    if (!g.changing) return; // nothing changes owner, or none of it is in view
    if (g.advance && !g.disc) return; // the front has not reached anything yet
    lc.save();
    if (g.advance) {
      // The area the front has reached (a union of shapes for a front from a border), within the changing parcels.
      this.clip(lc, g.changing);
      if (g.discRule === 'nonzero') { lc.clip(g.disc!, 'nonzero'); paint(lc, g.a.value, g.changing); }
      else paint(lc, g.a.value, { path: g.disc!, onSheet: false });
    } else {
      lc.globalAlpha = Math.min(1, Math.max(0, g.progress));
      paint(lc, g.a.value, g.changing);
    }
    lc.restore();
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
        let best = Infinity, pc: [number, number] = cs[0], ph: [number, number] = hs[0];
        for (const c of cs) { const vc = vec3(c); for (const h of hs) { const vh = vec3(h); const d = -(vc[0] * vh[0] + vc[1] * vh[1] + vc[2] * vh[2]); if (d < best) { best = d; pc = c; ph = h; } } }
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
    const kind = view.camera.projection, flat = kind === 'flat', ref = flat ? 0 : view.camera.lon;
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
  private joinRect(list: number[][], add: number[]): void {
    const area = (q: number[]) => (q[2] - q[0]) * (q[3] - q[1]);
    let box = add;
    for (let again = true; again;) {
      again = false;
      for (let j = 0; j < list.length; j++) {
        const o = list[j];
        const u = [Math.min(o[0], box[0]), Math.min(o[1], box[1]), Math.max(o[2], box[2]), Math.max(o[3], box[3])];
        if (area(u) <= 1.3 * (area(o) + area(box)) + 4096 || list.length >= 6) { list.splice(j, 1); box = u; again = true; break; }
      }
    }
    list.push(box);
  }

  /** Join to `list` the rectangles of the canvas that a box in degrees shows in, grown by `pad` view pixels. */
  private joinBox(list: number[][], view: View, box: readonly [number, number, number, number], m: DOMMatrix, pad: number, width: number, height: number): void {
    for (const sb of this.boxesOnScreen(view, box)) {
      const d = this.deviceBox([sb[0], sb[1], sb[2] - sb[0], sb[3] - sb[1]], m, pad, width, height);
      if (d[2] > 0 && d[3] > 0) this.joinRect(list, [d[0], d[1], d[0] + d[2], d[1] + d[3]]);
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
    const kind = view.camera.projection, flat = kind === 'flat', ref = flat ? 0 : view.camera.lon;
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
  private deviceBox(box: Box2, m: DOMMatrix, pad: number, width: number, height: number): Box2 {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]]) {
      const dx = m.a * x + m.c * y + m.e, dy = m.b * x + m.d * y + m.f;
      if (dx < x0) x0 = dx; if (dx > x1) x1 = dx; if (dy < y0) y0 = dy; if (dy > y1) y1 = dy;
    }
    const k = Math.hypot(m.a, m.b) || 1;
    x0 = Math.max(0, Math.floor(x0 - pad * k)); y0 = Math.max(0, Math.floor(y0 - pad * k));
    x1 = Math.min(width, Math.ceil(x1 + pad * k)); y1 = Math.min(height, Math.ceil(y1 + pad * k));
    return [x0, y0, x1 - x0, y1 - y0];
  }

  /** Fill a shape with a picture or video frame; false if it cannot be drawn yet. */
  private paintMedia(c: CanvasRenderingContext2D, fill: CountryFillLike, shape: Shape, box: Box2, unit: number): boolean {
    const src = fill.kind === 'video' ? videoNow(fill.asset, this.mediaSeconds, fill, this.mediaChannel) : imageNow(fill.asset);
    if (!src) return false;
    c.save();
    this.clip(c, shape);
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
    } else drawImageFit(c, src, box[0], box[1], box[2], box[3], fill.fit ?? 'cover');
    c.restore();
    return true;
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
  ): void {
    const bp = this.borderPaths(sp, sheet, arr, snap, states);
    const stroke = (p: Path2D | BlockPath | null | undefined) => { if (p) this.strokeOnSheet(ctx, p, width); };
    ctx.save();
    ctx.strokeStyle = style.border;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // (Owner by owner: each owner's lines are skipped where none of them shows.)
    for (const p of bp.plain) stroke(p);
    for (const [id, g] of tg.groups) {
      const ins = bp.inside.get(id), outs = bp.outside.get(id);
      if (g.advance) {
        if (!g.disc) { stroke(outs); continue; }
        if (ins) { ctx.save(); ctx.clip(g.disc, 'evenodd'); stroke(ins); ctx.restore(); }
        if (outs) { ctx.save(); ctx.clip(outsideOf(g.disc), 'evenodd'); stroke(outs); ctx.restore(); }
        if (g.changing) { ctx.save(); this.clip(ctx, g.changing); ctx.stroke(g.disc); ctx.restore(); }
      } else {
        if (ins) { ctx.globalAlpha = g.progress; stroke(ins); }
        if (outs) { ctx.globalAlpha = 1 - g.progress; stroke(outs); }
        ctx.globalAlpha = 1;
      }
    }
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
      if (p) out.set(owner, p.owner === owner ? p : { ...p, owner });
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
    // The outline of the main piece: the border chains with the piece on one side only.
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

  private layerLabels(view: View, arr: Arrangement, snap: LayerSnap, states: Map<number, FaceState>, entities: Map<string, LabelEntity>, mask: LandMask | null = null): LabelInfo[] {
    // How far each owner's changes have come (by area), for labels gliding with an animated change.
    const progress = new Map<string, { w: number; p: number }>();
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
        const inView = (lon: number, lat: number) => onScreen(view.projection([lon, lat]) as [number, number] | null) && (!landOk || landOk(lon, lat));
        // (While the map moves the place is found less finely: it is found again, finely, when the map rests.)
        const rough = this.moving ? 4 : 1, vk = `${ck}|view${rough > 1 ? '|rough' : ''}`;
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

    const out: LabelInfo[] = [];
    const owners = new Set([...piecesAfter.keys(), ...piecesBefore.keys()]);
    for (const id of owners) {
      const pa = piecesAfter.get(id), pb = piecesBefore.get(id);
      // A country nowhere near the view has no label to place (most countries, close in).
      if (vis !== null && !(pa && boxIntersects(pa.box, vis)) && !(pb && boxIntersects(pb.box, vis))) continue;
      const name = entities.get(id)?.name;
      if (!name) continue;
      const look = this.labelLook(id, name);
      if (!look) continue;
      const a = pa ? place(pa, look.text, look.style) : null;
      const b = pb === pa ? a : pb ? place(pb, look.text, look.style) : null;
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
        total = pb!.total + (pa!.total - pb!.total) * f;
        area = pb!.area + (pa!.area - pb!.area) * f;
      } else if (a) {
        // Appearing: grows with the change.
        ({ pos, fontPx, lines } = a); total = pa!.total * f; area = pa!.area * f;
      } else {
        // Disappearing: shrinks with the change.
        ({ pos, fontPx, lines } = b!); total = pb!.total * (1 - f); area = pb!.area * (1 - f);
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
  private placeTexts(ctx: CanvasRenderingContext2D, labels: LabelInfo[], cities: CityItem[]): void {
    type Box = [number, number, number, number];
    // (Boxes are kept by the squares of the frame they reach into: with hundreds of names, looking
    // through all of them for each place tried took longer than drawing them.)
    const placed = new BoxGrid(), dotGrid = new BoxGrid();
    const dots: Box[] = cities.map((c) => [c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r]);
    for (const d of dots) dotGrid.add(d);
    const hits = (b: Box, grid: BoxGrid, except: Box | null = null) => grid.hits(b, except);
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
        for (const [dx, dy] of tries) { const b = at(dx, dy); if (!hits(b, placed) && (!avoidDots || !hits(b, dotGrid))) { found = [dx, dy]; break; } }
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
      const ok = options.find((o) => !hits(o.box, placed) && !hits(o.box, dotGrid, own));
      c.drawn = !!ok;
      if (!ok) continue;
      c.tx = ok.tx; c.ty = ok.ty; c.align = ok.align; c.box = ok.box;
      placed.add(ok.box);
    }
    ctx.restore();
  }

  /** Characters: a marker in the character's colour and its name beside it. Points, never territory. */
  private drawCharacters(ctx: CanvasRenderingContext2D, view: View, engine: Engine, spaceId: string, t: Instant, entities: Map<string, LabelEntity>, trails = false): void {
    const u = view.unit;
    const list = engine.charactersAt(spaceId, t);
    if (!list.length) return;
    ctx.save();
    ctx.lineJoin = 'round';
    // Trails: the route each character has travelled so far, in its colour, under the markers.
    if (trails) for (const c of list) {
      const e = entities.get(c.entity);
      if (!e || e.type_id === 'settlement') continue;
      const track = engine.characterTrack(spaceId, c.entity);
      const path = new Path2D();
      let any = false;
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1], b = track[i];
        if (compare(a.t, t) > 0) break;
        if (a.off || b.off || b.arrive !== 'travel' || a.t.day === -Infinity) continue;
        // Up to where the character is now on the last leg.
        const done = compare(b.t, t) <= 0 ? 1 : Math.max(0, Math.min(1, diffMs(a.t, t) / Math.max(1, diffMs(a.t, b.t))));
        const n = Math.max(2, Math.ceil(24 * done));
        for (let k = 0; k <= n; k++) {
          const [lon, lat] = slerpLonLat(a.lon, a.lat, b.lon, b.lat, (done * k) / n);
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
      ctx.strokeStyle = e.color ?? '#ffd166';
      ctx.setLineDash([6 * u, 4 * u]);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
    for (const c of list) {
      const e = entities.get(c.entity);
      if (!e || e.type_id === 'settlement') continue;
      const p = view.projection([c.lon, c.lat]);
      if (!p || p[0] < -50 || p[1] < -50 || p[0] > view.width + 50 || p[1] > view.height + 50) continue;
      const k = pointScale(view, 0.6, 1.3) * this.pointSizes.character;
      const r = 8 * k * u;
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 6 * u;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = e.color ?? '#ffd166';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.2 * Math.min(1, k) * u;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.font = `600 ${(20 * k * u).toFixed(1)}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4 * k * u;
      ctx.strokeStyle = 'rgba(10,16,24,0.85)';
      ctx.strokeText(e.name, p[0] + r + 5 * k * u, p[1]);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(e.name, p[0] + r + 5 * k * u, p[1]);
      this.lastCharacters.push({ entity: c.entity, name: e.name, x: p[0], y: p[1], lon: c.lon, lat: c.lat, moving: c.moving });
    }
    ctx.restore();
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

const cityFont = (size: number) => `500 ${size.toFixed(1)}px Georgia, "Times New Roman", serif`;
/**
 * Names are measured at this size (pixels) and the width scaled to the size they are drawn at: a
 * text's width grows with its size, and measuring at every size made each step of a zoom measure
 * every name on the map again (the widths only say which names would overlap).
 */
const MEASURE_AT = 100;

/** An advancing front from a border: how far it must travel, and the area reached at a distance. */
interface BorderFront { maxDist: number; reach: (r: number) => Path2D }

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

