// REFERENCE COPY, frozen on 17 November 2026: the map renderer as it was before drawing moved to
// prepared geometry (render-engine/plane.ts). It projects everything through d3-geo for every view,
// which is slow but simple; e2e/render-compare.e2e.ts draws the same scenes with both and compares
// the pictures. Not part of the app.
//
// The map renderer: draws a map space at a moment in time from the world model and the temporal
// engine. Nothing here is stored history: every pixel is computed from parcels, effects and styles.
//
// This is the Canvas 2D backend. The approved architecture uses deck.gl (WebGL) for the final
// renderer; deck.gl could not be installed in the offline build environment, so this backend sits
// behind the same inputs (world, engine, view, time, options) and can be replaced without touching
// the world model, the engine, the interface or the export pipeline.
import { geoPath, geoGraticule10, geoGraticule, geoCircle, geoCentroid, geoArea, type GeoPermissibleObjects } from 'd3-geo';
import type { World } from '../../src/world-model/world.ts';
import type { Engine, FaceState, Assignment, CompiledTransition } from '../../src/temporal-engine/engine.ts';
import { parseJSON, slerpLonLat } from '../../src/temporal-engine/engine.ts';
import { type Instant, compare, diffMs } from '../../src/core-time/index.ts';
import { BASE_EVENT_ID } from '../../src/world-model/schema.ts';
import type { Vec3 } from '../../src/geo-kernel/vec.ts';
import { screenToLonLat, FLAT_EXTENT_DEG, type View } from '../../src/render-engine/camera.ts';
import type { Arrangement } from '../../src/geo-kernel/arrangement.ts';
import { E7 } from '../../src/geo-kernel/vec.ts';
import { BasemapPainter, landMaskOf, visibleBounds, type Basemap, type LandMask } from './basemap.ts';
import { planeShape, placeLabel, lineChoices, textWidthEm, blockHeightEm, LINE_HEIGHT, type PlaneShape } from '../../src/render-engine/label-place.ts';
import { resolveLabelStyle, resolvePointStyle, labelSize, labelFont, labelText, type LabelStyle, type CountryLabel } from '../../src/render-engine/label-style.ts';
import { imageNow, videoNow, drawImageFit, type MediaChannel } from '../../src/render-engine/assets.ts';
import { buildFrontField, frontRings } from '../../src/render-engine/front-field.ts';
import { frontSourceOf } from '../../src/render-engine/front-source.ts';

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
}

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

/** An owner's main piece of territory (for its label). */
interface OwnerPiece { owner: string; key: string; arcs: Float64Array; centreLon: number; area: number; total: number }
interface PlacedLabel { lon: number; lat: number; font: number; lines: string[] }

interface FaceGeo { geo: GeoPermissibleObjects; area: number; centroid: [number, number] }

interface TransitionGroup {
  a: Assignment;
  faces: number[];
  states: FaceState[];
  /** A front moves across the change (advancing circle or straight wipe); otherwise it fades. */
  advance: boolean;
  spec: CompiledTransition;
  /** How far the change has progressed (0 to 1, eased). */
  progress: number;
  /** For a moving front: the area reached so far (null before anything is reached). */
  disc: Path2D | null;
  /** How `disc` is filled: an advancing front from a border is a union of overlapping shapes. */
  discRule: CanvasFillRule;
  /** For a front from a border: the reach builder, to draw the front line as a band. */
  border: BorderFront | null;
  region: Path2D;
  /** The parcels whose owner actually changes. */
  changing: Path2D;
}

/** Everything except the given shape (use with the even-odd rule). */
function outsideOf(shape: Path2D): Path2D {
  const p = new Path2D();
  p.rect(-1e6, -1e6, 2e6, 2e6);
  p.addPath(shape);
  return p;
}

export class MapRenderer {
  private geoCache = new WeakMap<Arrangement, { rev: number; faces: Map<number, FaceGeo> }>();
  private pathCache = new Map<string, Path2D>();
  private pathCacheView = '';
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

  /** Spherical geometry of a parcel (cached until the parcel map changes). */
  faceGeo(arr: Arrangement, face: number): FaceGeo {
    let c = this.geoCache.get(arr);
    if (!c || c.rev !== arr.revision) { c = { rev: arr.revision, faces: new Map() }; this.geoCache.set(arr, c); }
    let g = c.faces.get(face);
    if (!g) {
      const rings = arr.faceRingsLonLat(face);
      const geo: GeoPermissibleObjects = rings.length === 0
        ? { type: 'Sphere' }
        : { type: 'Polygon', coordinates: rings.map((r) => { const rr = [...r].reverse(); rr.push(rr[0]); return rr; }) };
      const area = arr.faceArea(face);
      const centroid = rings.length === 0 ? [0, 0] as [number, number] : geoCentroid(geo as GeoJSON.Polygon) as [number, number];
      g = { geo, area, centroid };
      c.faces.set(face, g);
    }
    return g;
  }

  facePath(view: View, arr: Arrangement, face: number): Path2D {
    const vk = `${view.key}|${arr.spaceId}|${arr.revision}`;
    if (vk !== this.pathCacheView) { this.pathCache.clear(); this.pathCacheView = vk; }
    let p = this.pathCache.get(String(face));
    if (!p) {
      const d = geoPath(view.projection)(this.faceGeo(arr, face).geo);
      p = new Path2D(d ?? '');
      this.pathCache.set(String(face), p);
    }
    return p;
  }

  render(ctx: CanvasRenderingContext2D, view: View, world: World, engine: Engine, spaceId: string, t: Instant, opts: RenderOptions): void {
    const style = opts.style ?? DEFAULT_STYLE;
    const arr = world.arrangement(spaceId);
    const u = view.unit;
    ctx.save();
    ctx.clearRect(0, 0, view.width, view.height);
    if (view.rotation) {
      ctx.translate(view.width / 2, view.height / 2);
      ctx.rotate((view.rotation * Math.PI) / 180);
      ctx.translate(-view.width / 2, -view.height / 2);
    }
    const sphere = new Path2D(geoPath(view.projection)({ type: 'Sphere' }) ?? '');
    if (opts.passes.has('background') && !opts.transparent) {
      ctx.fillStyle = style.ocean;
      ctx.fill(sphere);
    }
    if (opts.passes.has('graticule')) {
      ctx.strokeStyle = style.graticule;
      ctx.lineWidth = 0.8 * u;
      const space = world.get('map_space', spaceId);
      if (view.camera.projection === 'flat' && space?.radius_m) {
        // A flat map: a grid in round kilometres or metres, about eight lines across the view.
        const kmPerRad = space.radius_m / 1000, viewKm = (view.width / view.projection.scale()) * kmPerRad;
        const raw = viewKm / 8, mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const stepKm = [1, 2, 5, 10].map((k) => k * mag).find((k) => k >= raw) ?? 10 * mag;
        const stepDeg = (stepKm / kmPerRad) * (180 / Math.PI), ext = FLAT_EXTENT_DEG * 1.6;
        ctx.stroke(new Path2D(geoPath(view.projection)(geoGraticule().extent([[-ext, -ext], [ext, ext]]).step([stepDeg, stepDeg]).precision(stepDeg)()) ?? ''));
      } else ctx.stroke(new Path2D(geoPath(view.projection)(geoGraticule10()) ?? ''));
    }
    if (opts.passes.has('land') && opts.basemap) {
      const oceanBelow = opts.passes.has('background') && !opts.transparent;
      this.basemapPainter.draw(ctx, view, opts.basemap, { referenceBorders: !!opts.referenceBorders, oceanColor: oceanBelow ? style.ocean : undefined });
    }

    // Each name as it is at this moment (names can change over time).
    const entities = new Map(world.all('entity').map((e) => { const n = engine.nameAt(e.id, t); return [e.id, n ? { ...e, name: n } : e]; }));
    this.mediaSeconds = opts.mediaSeconds ?? 0;
    this.mediaChannel = opts.mediaChannel ?? 'live';
    // Pictures and videos filling territory, by owner.
    const fills = new Map<string, CountryFillLike | null>();
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
    const prepared: Array<{ ls: LayerStyle; states: Map<number, FaceState>; tg: ReturnType<MapRenderer['transitionGroups']>; clip: boolean }> = [];
    for (const layerId of drawsLayers ? opts.layerIds : []) {
      const layer = world.get('layer', layerId);
      if (!layer || layer.space_id !== spaceId || layer.kind !== 'partition') continue;
      const states = opts.transitions ? this.shotStates(engine, spaceId, layerId, t, engine.partitionState(spaceId, layerId, t), opts.transitions) : engine.partitionState(spaceId, layerId, t);
      const ls = parseJSON<LayerStyle>(layer.style, {});
      // Coastline clipping: territory ends at the coast unless the layer is set to cover the sea.
      const clip = !!opts.basemap && ls.clipToLand !== false;
      prepared.push({ ls, states, tg: this.transitionGroups(view, arr, engine, states, t), clip });
    }

    this.lastTransitions = prepared.flatMap((p) => [...p.tg.groups.values()].map((g) => ({ style: g.spec.style, progress: g.progress })));
    const land = (): Path2D => this.basemapPainter.pathsFor(view, opts.basemap!).land;
    if (opts.passes.has('fills')) for (const { ls, states, tg, clip } of prepared) {
      // Each layer is painted fully opaque in a scratch buffer and laid onto the map once at the
      // layer's opacity: neighbouring parcels then never show seams, and fades mix correctly.
      const lc = this.scratch(ctx);
      // Owners filled with a picture or video are drawn on their own; the rest are grouped by colour.
      const byColor = new Map<string, number[]>(), byMedia = new Map<string, number[]>();
      for (const [face, st] of states) {
        const v = tg.of.has(face) ? st.transition!.from : st.value;
        if (!v) continue;
        if (fillOf(v)) { const l = byMedia.get(v); if (l) l.push(face); else byMedia.set(v, [face]); continue; }
        const c = colorOf(v);
        if (!c) continue;
        const l = byColor.get(c);
        if (l) l.push(face); else byColor.set(c, [face]);
      }
      // Land along the coastline that no parcel covers takes the look of the territory beside it (D83):
      // outlines stroked a few kilometres wide under the fills, kept only in a band along the coastline.
      if (clip) {
        const rim = Math.min(48, Math.max(1, (5 / 6371) * view.projection.scale()));
        const rc = this.scratch(ctx, 1);
        rc.lineJoin = 'round'; rc.lineCap = 'round'; rc.lineWidth = 2 * rim;
        for (const [c, faces] of byColor) { rc.strokeStyle = c; rc.stroke(this.groupPath(view, arr, faces)); }
        for (const [v, faces] of byMedia) { rc.strokeStyle = colorOf(v) ?? '#888'; rc.stroke(this.groupPath(view, arr, faces)); }
        const band = this.scratch(ctx, 2);
        band.lineJoin = 'round'; band.lineCap = 'round'; band.lineWidth = 2 * rim; band.strokeStyle = '#000';
        band.stroke(this.basemapPainter.pathsFor(view, opts.basemap!).coastline);
        rc.setTransform(1, 0, 0, 1, 0, 0);
        rc.globalCompositeOperation = 'destination-in';
        rc.drawImage(band.canvas as CanvasImageSource, 0, 0);
        rc.globalCompositeOperation = 'source-over';
        lc.save();
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.drawImage(rc.canvas as CanvasImageSource, 0, 0);
        lc.restore();
      }
      for (const [c, faces] of byColor) { lc.fillStyle = c; lc.fill(this.groupPath(view, arr, faces), 'evenodd'); }
      // Pictures are placed by the bounding box of the owner's whole territory (so a flag does not
      // jump between the owner's pieces); an owner whose picture is not loaded yet shows its colour.
      const ownerBox = new Map<string, Box2>();
      const boxOf = (v: string) => {
        let b = ownerBox.get(v);
        if (!b) {
          const faces: number[] = [];
          for (const [f, st] of states) if (st.value === v || (tg.of.has(f) && st.transition!.from === v)) faces.push(f);
          b = this.screenBox(view, arr, faces);
          ownerBox.set(v, b);
        }
        return b;
      };
      const paint = (c: CanvasRenderingContext2D, v: string | null, shape: Path2D) => {
        const media = v ? fillOf(v) : null;
        if (v && media && this.paintMedia(c, media, shape, boxOf(v), view.unit)) return;
        const col = colorOf(v);
        if (col) { c.fillStyle = col; c.fill(shape, 'evenodd'); }
        else { c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fill(shape, 'evenodd'); c.restore(); }
      };
      for (const [v, faces] of byMedia) paint(lc, v, this.groupPath(view, arr, faces));
      for (const g of tg.groups.values()) this.drawTransition(lc, g, paint);
      if (clip) this.basemapPainter.maskToLand(lc, view, opts.basemap!);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = ls.fillOpacity ?? 0.78;
      ctx.drawImage(lc.canvas as CanvasImageSource, 0, 0);
      ctx.restore();
      // The advancing front is highlighted on top, at full strength.
      const front = opts.transitions?.front ?? { show: true, color: style.frontGlow, width: 2.2, glow: 10 };
      if (front.show) for (const g of tg.groups.values()) {
        if (!g.advance || !g.disc) continue;
        ctx.save();
        if (clip) ctx.clip(land());
        ctx.clip(g.changing, 'evenodd');
        if (g.discRule === 'nonzero') {
          // The edge of the reached area: from a border, the area minus the area reached a line-width
          // earlier; from several points, each circle's outline less every circle's inside.
          const w = Math.max(0.5, front.width * view.unit);
          const band = this.scratch(ctx);
          band.fillStyle = front.color;
          band.strokeStyle = front.color;
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
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.shadowColor = front.color;
          ctx.shadowBlur = front.glow * view.unit;
          ctx.drawImage(band.canvas as CanvasImageSource, 0, 0);
        } else {
          ctx.strokeStyle = front.color;
          ctx.lineWidth = front.width * view.unit;
          ctx.shadowColor = front.color;
          ctx.shadowBlur = front.glow * view.unit;
          ctx.stroke(g.disc);
        }
        ctx.restore();
      }
    }

    if (opts.passes.has('borders')) for (const { ls, states, tg, clip } of prepared) {
      ctx.save();
      if (clip) ctx.clip(land());
      if (!clip) this.drawBorders(ctx, view, arr, states, tg, style, (ls.borderWidth ?? style.borderWidth) * u);
      else {
        // A border against nobody is left out along the coastline, where the coastline is the edge (D83).
        this.drawBorders(ctx, view, arr, states, tg, style, (ls.borderWidth ?? style.borderWidth) * u, 'shared');
        const oc = this.scratch(ctx, 1);
        this.drawBorders(oc, view, arr, states, tg, style, (ls.borderWidth ?? style.borderWidth) * u, 'open');
        const rim = Math.min(48, Math.max(1, (5 / 6371) * view.projection.scale()));
        oc.save();
        oc.globalCompositeOperation = 'destination-out';
        oc.lineJoin = 'round'; oc.lineCap = 'round'; oc.lineWidth = 2 * rim; oc.strokeStyle = '#000';
        oc.stroke(this.basemapPainter.pathsFor(view, opts.basemap!).coastline);
        oc.restore();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(oc.canvas as CanvasImageSource, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    // One label per country: a country on several layers (its land, and its military control, say) is
    // labelled from the lowest layer it is on.
    if (placesText && layout.labels) for (const { states, clip } of prepared) {
      for (const l of this.layerLabels(view, arr, states, entities, clip ? landMaskOf(opts.basemap!) : null)) if (!labels.some((x) => x.entityId === l.entityId)) labels.push(l);
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

  private groupCache = new Map<string, Path2D>();

  /**
   * One path for a group of parcels drawn in the same colour. Reused while the group is unchanged
   * (between events, every frame of a scrub or a shot reuses it), rebuilt when parcels change hands.
   */
  private groupPath(view: View, arr: Arrangement, faces: number[]): Path2D {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (const f of faces) { h1 = Math.imul(h1 ^ f, 16777619) >>> 0; h2 = Math.imul(h2 + f, 2246822519) >>> 0; }
    const key = `${view.key}|${arr.spaceId}|${arr.revision}|${faces.length}|${h1}|${h2}`;
    let p = this.groupCache.get(key);
    if (!p) {
      p = new Path2D();
      for (const f of faces) p.addPath(this.facePath(view, arr, f));
      if (this.groupCache.size > 400) this.groupCache.clear();
      this.groupCache.set(key, p);
    }
    return p;
  }

  /**
   * A shot's way of animating changes, applied to the recorded states: no animation at all, every
   * change animated, or recorded animations restyled. History is never changed, only what is drawn.
   */
  private shotStates(engine: Engine, spaceId: string, layerId: string, t: Instant, states: Map<number, FaceState>, o: ShotTransitionOptions): Map<number, FaceState> {
    if (o.mode === 'recorded' && !o.restyleRecorded) return states;
    const spec: CompiledTransition = { style: o.style, origin: null, maxDist: 0, easing: o.easing, angle: o.angle, shot: true };
    const progressOf = (a: Assignment): number => {
      if (o.timing === 'event' && compare(a.end, a.t) > 0) return diffMs(a.t, t) / Math.max(1, diffMs(a.t, a.end));
      return o.secondsSince(a.t) / Math.max(1e-3, o.seconds);
    };
    const out = new Map<number, FaceState>();
    for (const [f, st] of states) {
      const a = st.assignment;
      if (o.mode === 'instant') { out.set(f, st.transition ? { value: st.value, assignment: a } : st); continue; }
      if (st.transition) {
        if (!o.restyleRecorded) { out.set(f, st); continue; }
        const p = progressOf(a!);
        out.set(f, p >= 1 || !(p >= 0) ? { value: st.value, assignment: a } : { ...st, transition: { ...st.transition, progress: p, spec } });
        continue;
      }
      // The starting map is never animated; changes made without an event are, like any other change.
      if (o.mode !== 'all' || !a || (a.eventId === BASE_EVENT_ID && a.t.day === -Infinity)) { out.set(f, st); continue; }
      const p = progressOf(a);
      if (!(p >= 0 && p < 1)) { out.set(f, st); continue; }
      const prior = engine.latest(spaceId, layerId, f, t, a);
      const from = prior ? prior.value : null;
      if ((from ?? '') === (st.value ?? '')) { out.set(f, st); continue; }
      out.set(f, { value: st.value, assignment: a, transition: { from, progress: p, spec, prior } });
    }
    return out;
  }

  /** Parcels that are part of an animated change at this moment, grouped by the change they belong to. */
  private transitionGroups(view: View, arr: Arrangement, engine: Engine, states: Map<number, FaceState>, t: Instant): { groups: Map<string, TransitionGroup>; of: Map<number, TransitionGroup> } {
    void engine; void t;
    const groups = new Map<string, TransitionGroup>(), of = new Map<number, TransitionGroup>();
    for (const [face, st] of states) {
      if (!st.transition || !st.assignment) continue;
      const spec = st.transition.spec;
      const key = st.assignment.effectId;
      let g = groups.get(key);
      if (!g) {
        const advance = spec.style === 'advance' || spec.style === 'wipe' || spec.style === 'border';
        // Shot-made animations use the shot's easing; recorded fronts their own; recorded fades stay even.
        const progress = spec.shot || spec.style === 'advance' || spec.style === 'border' ? ease(spec.easing, st.transition.progress) : st.transition.progress;
        g = { a: st.assignment, faces: [], states: [], advance, spec, progress, disc: null, discRule: 'evenodd', border: null, region: new Path2D(), changing: new Path2D() };
        groups.set(key, g);
      }
      g.faces.push(face);
      g.states.push(st);
      of.set(face, g);
      const path = this.facePath(view, arr, face);
      g.region.addPath(path);
      if ((st.transition.from ?? '') !== (st.value ?? '')) g.changing.addPath(path);
    }
    // The area each moving front has reached: grown from the border with the new owner's land, a
    // circle from its origin, or a straight wipe (older shots).
    for (const g of groups.values()) {
      if (!g.advance || g.progress <= 0) continue;
      if (g.spec.style === 'wipe') { g.disc = this.wipeShape(view, arr, g); continue; }
      // Fronts that follow the land (D136), as the renderer has them.
      const changing = g.faces.filter((_, i) => (g.states[i].transition!.from ?? '') !== (g.states[i].value ?? ''));
      const src = changing.length ? frontSourceOf(arr, changing, g.a.value, g.spec, g.spec.style === 'advance' ? 'advance' : 'border', states) : null;
      const field = src ? buildFrontField(src.rings, src.source, { roughness: 0, seed: 0 }) : null;
      if (field) {
        const rings = frontRings(field, g.progress);
        if (rings.length) {
          const polys = rings.map((r) => (geoArea({ type: 'Polygon', coordinates: [r] }) > 2 * Math.PI ? [r.slice().reverse()] : [r]));
          g.disc = new Path2D(geoPath(view.projection)({ type: 'MultiPolygon', coordinates: polys }) ?? '');
          g.discRule = 'evenodd';
        }
        continue;
      }
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

  /** Where a front starts when the change has no recorded origin: the middle of the change, and how far it must go. */
  private reachOf(arr: Arrangement, faces: number[]): { origin: Vec3; maxDist: number } {
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
    return { origin, maxDist };
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
  private drawTransition(lc: CanvasRenderingContext2D, g: TransitionGroup, paint: (c: CanvasRenderingContext2D, v: string | null, shape: Path2D) => void): void {
    const shape = g.advance ? g.disc : g.changing;
    if (!shape) return; // the front has not reached anything yet
    lc.save();
    if (g.advance && g.discRule === 'nonzero') {
      // The reached area is a union of shapes: clip to it and paint the changing parcels.
      lc.clip(g.changing, 'evenodd');
      lc.clip(shape, 'nonzero');
      paint(lc, g.a.value, g.changing);
    } else {
      if (g.advance) lc.clip(g.changing, 'evenodd');
      else lc.globalAlpha = Math.min(1, Math.max(0, g.progress));
      paint(lc, g.a.value, shape);
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
    const changing: number[] = [];
    g.faces.forEach((f, i) => { if ((g.states[i].transition?.from ?? '') !== (g.states[i].value ?? '')) changing.push(f); });
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
        // wound the same way so that filled with the nonzero rule they make one area.
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
            p.closePath();
          }
          for (const [x, y] of [[ax, ay], [bx, by]]) {
            if (Math.hypot(x - lx, y - ly) < minLen) continue;
            p.moveTo(x + r, y);
            p.arc(x, y, r, 0, Math.PI * 2, false);
            p.closePath();
            lx = x; ly = y;
          }
        }
        return p;
      },
    };
    this.borderViewCache.set(vk, bf);
    return bf;
  }

  /** The screen rectangle of a set of parcels (the whole view for a parcel covering the planet). */
  private screenBox(view: View, arr: Arrangement, faces: number[]): Box2 {
    const polys: number[][][][] = [];
    for (const f of faces) {
      const g = this.faceGeo(arr, f);
      if ((g.geo as { type: string }).type !== 'Polygon') return [0, 0, view.width, view.height];
      polys.push((g.geo as GeoJSON.Polygon).coordinates);
    }
    if (!polys.length) return [0, 0, view.width, view.height];
    const [[x0, y0], [x1, y1]] = geoPath(view.projection).bounds({ type: 'MultiPolygon', coordinates: polys });
    return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, view.width, view.height];
  }

  /** Fill a shape with a picture or video frame; false if it cannot be drawn yet. */
  private paintMedia(c: CanvasRenderingContext2D, fill: CountryFillLike, shape: Path2D, box: Box2, unit: number): boolean {
    const src = fill.kind === 'video' ? videoNow(fill.asset, this.mediaSeconds, fill, this.mediaChannel) : imageNow(fill.asset);
    if (!src) return false;
    c.save();
    c.clip(shape, 'evenodd');
    if (fill.fit === 'tile') {
      const w = (src as HTMLVideoElement).videoWidth || src.width, h = (src as HTMLVideoElement).videoHeight || src.height;
      const pattern = c.createPattern(src, 'repeat');
      if (pattern && w && h) {
        const size = (fill.tileSize ?? 120) * unit;
        pattern.setTransform(new DOMMatrix().translate(box[0], box[1]).scale(size / w));
        c.fillStyle = pattern;
        c.fill(shape, 'evenodd');
      }
    } else drawImageFit(c, src, box[0], box[1], box[2], box[3], fill.fit ?? 'cover');
    c.restore();
    return true;
  }

  /** Screen seconds into the shot (videos show the frame for this moment); 0 while editing. */
  private mediaSeconds = 0;
  private mediaChannel: MediaChannel = 'live';

  private scratchCanvases: Array<{ canvas: OffscreenCanvas; ctx: CanvasRenderingContext2D }> = [];

  /** A cleared buffer the size of the target, with the target's current transform. */
  /** A cleared buffer the size of the target; `i` picks one of several (used at the same time). */
  private scratch(ctx: CanvasRenderingContext2D, i = 0): CanvasRenderingContext2D {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    let b = this.scratchCanvases[i];
    if (!b || b.canvas.width !== w || b.canvas.height !== h) {
      const canvas = new OffscreenCanvas(w, h);
      // Match the target's memory placement so copying between them stays cheap.
      const willReadFrequently = !!ctx.getContextAttributes?.().willReadFrequently;
      b = this.scratchCanvases[i] = { canvas, ctx: canvas.getContext('2d', { willReadFrequently }) as unknown as CanvasRenderingContext2D };
    }
    const sc = b.ctx;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, w, h);
    sc.setTransform(ctx.getTransform());
    return sc;
  }

  /**
   * Borders are drawn where neighbouring parcels have different owners. During an animated change
   * they follow the animation: inside the advancing front the new owners decide, outside it the
   * previous owners do, and the front itself is the moving border. Fades cross-fade the two sets.
   */
  private drawBorders(
    ctx: CanvasRenderingContext2D, view: View, arr: Arrangement, states: Map<number, FaceState>,
    tg: { groups: Map<string, TransitionGroup>; of: Map<number, TransitionGroup> }, style: MapStyle, width: number,
    which: 'all' | 'shared' | 'open' = 'all',
  ): void {
    const differs = (x: string | null, y: string | null) => (x ?? '') !== (y ?? '');
    const plain: number[][][] = [];
    const inside = new Map<TransitionGroup, number[][][]>(), outside = new Map<TransitionGroup, number[][][]>();
    const add = (m: Map<TransitionGroup, number[][][]>, g: TransitionGroup, line: number[][]) => { let l = m.get(g); if (!l) m.set(g, (l = [])); l.push(line); };
    // Where two animations meet: by the pair, the lines shown for each combination of the two fronts
    // having come or not (2 * reached by a + reached by b); each side shows the owner before or after its own change.
    const meet = new Map<string, { a: TransitionGroup; b: TransitionGroup; lines: number[][][][] }>();
    for (const s of arr.segments.values()) {
      const a = states.get(s.left_face), b = states.get(s.right_face);
      if (!a || !b) continue;
      const ga = tg.of.get(s.left_face), gb = tg.of.get(s.right_face);
      const va = arr.vertices.get(s.a)!, vb = arr.vertices.get(s.b)!;
      const line = [[va.lon / E7, va.lat / E7], [vb.lon / E7, vb.lat / E7]];
      if (ga && gb && ga !== gb) {
        if (which === 'open') continue;
        const oa = [a.transition!.from, a.value], ob = [b.transition!.from, b.value];
        const shows = [0, 1, 2, 3].map((k) => differs(oa[k >> 1], ob[k & 1]));
        if (shows.every(Boolean)) { plain.push(line); continue; }
        const key = `${ga.a.effectId}|${gb.a.effectId}`;
        let m = meet.get(key);
        if (!m) meet.set(key, (m = { a: ga, b: gb, lines: [[], [], [], []] }));
        shows.forEach((on, k) => { if (on) m!.lines[k].push(line); });
        continue;
      }
      const now = differs(a.value, b.value);
      const before = ga || gb ? differs(ga ? a.transition!.from : a.value, gb ? b.transition!.from : b.value) : now;
      if (!now && !before) continue;
      // Unaffected by any animation, or a border both before and after.
      if ((!ga && !gb) || (now && before)) {
        // (Against nobody, away from any animation: 'open'; the rest 'shared'.)
        const open = !ga && !gb && (!a.value || !b.value);
        if (which === 'all' || (which === 'open') === open) plain.push(line);
        continue;
      }
      if (which === 'open') continue;
      add(now ? inside : outside, (ga ?? gb)!, line);
    }
    const path = (lines: number[][][]) => new Path2D(geoPath(view.projection)({ type: 'MultiLineString', coordinates: lines }) ?? '');
    ctx.save();
    ctx.strokeStyle = style.border;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (plain.length) ctx.stroke(path(plain));
    // Lines shown where every front in `ins` has come and none in `outs` has. (A front from a border
    // reaches a union of overlapping pieces: its outside is no clip, so the lines are drawn apart and
    // the reached area taken out of them.)
    const where = (lines: number[][][], ins: TransitionGroup[], outs: TransitionGroup[], alpha: number) => {
      if (!lines.length || ins.some((g) => !g.disc)) return;
      const out = outs.filter((g) => g.disc), apart = out.filter((g) => g.discRule !== 'evenodd');
      const on = apart.length ? this.scratch(ctx, 2) : ctx;
      on.save();
      on.strokeStyle = style.border; on.lineWidth = width; on.lineJoin = 'round'; on.lineCap = 'round';
      for (const g of ins) on.clip(g.disc!, g.discRule);
      for (const g of out) if (g.discRule === 'evenodd') on.clip(outsideOf(g.disc!), 'evenodd');
      if (on === ctx) on.globalAlpha *= alpha;
      on.stroke(path(lines));
      on.restore();
      if (on === ctx) return;
      on.globalCompositeOperation = 'destination-out';
      for (const g of apart) on.fill(g.disc!, 'nonzero');
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= alpha; ctx.drawImage(on.canvas as CanvasImageSource, 0, 0); ctx.restore();
    };
    for (const g of tg.groups.values()) {
      const ins = inside.get(g), outs = outside.get(g);
      if (g.advance) {
        if (ins) where(ins, [g], [], 1);
        if (outs) where(outs, [], [g], 1);
        if (!g.disc) continue;
        // The front itself is the moving border; the edge of a union of pieces is drawn as a band.
        ctx.save(); ctx.clip(g.changing, 'evenodd');
        if (g.discRule === 'evenodd') ctx.stroke(g.disc);
        else {
          const band = this.scratch(ctx, 3);
          band.fillStyle = style.border; band.strokeStyle = style.border;
          if (g.border) {
            const r = g.progress * g.border.maxDist;
            band.fill(g.border.reach(r + width / 2), 'nonzero');
            band.globalCompositeOperation = 'destination-out';
            band.fill(g.border.reach(r - width / 2), 'nonzero');
          } else {
            band.lineWidth = 2 * width; band.stroke(g.disc);
            band.globalCompositeOperation = 'destination-out';
            band.fill(g.disc, 'nonzero');
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(band.canvas as CanvasImageSource, 0, 0);
        }
        ctx.restore();
      } else {
        if (ins) { ctx.globalAlpha = g.progress; ctx.stroke(path(ins)); }
        if (outs) { ctx.globalAlpha = 1 - g.progress; ctx.stroke(path(outs)); }
        ctx.globalAlpha = 1;
      }
    }
    for (const { a, b, lines } of meet.values()) for (let k = 0; k < 4; k++) {
      const ins: TransitionGroup[] = [], outs: TransitionGroup[] = [];
      let alpha = 1;
      for (const [g, reached] of [[a, k >> 1], [b, k & 1]] as const) {
        if (!g.advance) alpha *= reached ? g.progress : 1 - g.progress;
        else (reached ? ins : outs).push(g);
      }
      if (alpha > 0) where(lines[k], ins, outs, alpha);
    }
    ctx.restore();
  }

  private landCache = new WeakMap<Arrangement, { rev: number; mask: LandMask; faces: Map<number, LandSample> }>();

  /**
   * The part of a parcel that is on land, as a grid of sample points (each standing for an equal share
   * of the parcel's area). Cached until the parcel map changes.
   */
  private landSample(arr: Arrangement, face: number, mask: LandMask): LandSample {
    let c = this.landCache.get(arr);
    if (!c || c.rev !== arr.revision || c.mask !== mask) { c = { rev: arr.revision, mask, faces: new Map() }; this.landCache.set(arr, c); }
    let s = c.faces.get(face);
    if (s) return s;
    const g = this.faceGeo(arr, face);
    const rings = (g.geo as GeoJSON.Polygon).coordinates ?? [];
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    for (const r of rings) for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < so) so = y; if (y > n) n = y; }
    const N = 10, pts: number[] = [];
    let inside = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const p: [number, number] = [w + ((i + 0.5) / N) * (e - w), so + ((j + 0.5) / N) * (n - so)];
      if (!insideGeo(g.geo, p)) continue;
      inside++;
      if (mask.onLand(p[0], p[1])) pts.push(p[0], p[1]);
    }
    if (inside === 0) { // a thin sliver the grid missed: judge it by its centre
      inside = 1;
      if (mask.onLand(g.centroid[0], g.centroid[1])) pts.push(g.centroid[0], g.centroid[1]);
    }
    // Unit vectors of the samples and their sum, so labels need no trigonometry per frame.
    const vec = new Float64Array((pts.length / 2) * 3);
    const sum: [number, number, number] = [0, 0, 0];
    for (let i = 0, k = 0; i < pts.length; i += 2, k += 3) {
      const lon = (pts[i] * Math.PI) / 180, lat = (pts[i + 1] * Math.PI) / 180;
      vec[k] = Math.cos(lat) * Math.cos(lon); vec[k + 1] = Math.cos(lat) * Math.sin(lon); vec[k + 2] = Math.sin(lat);
      sum[0] += vec[k]; sum[1] += vec[k + 1]; sum[2] += vec[k + 2];
    }
    s = { pts, vec, sum, weight: g.area / inside, land: (g.area * (pts.length / 2)) / inside };
    c.faces.set(face, s);
    return s;
  }

  // ---------------------------------------------------------------- labels
  //
  // Each country is labelled once, in its main piece of territory (the largest connected part; on a
  // layer that ends at the coast, the piece with the most land), at the place with the most room for
  // the label (label-place.ts), and sized to fit there. Larger countries are placed first, so they
  // keep their labels where labels would collide. During an animated change the label glides from
  // where it was before the change to where it will be after it.

  private pieceCache = new Map<string, Map<string, OwnerPiece>>();
  private shapeCache = new Map<string, PlaneShape>();
  private spotCache = new Map<string, PlacedLabel[]>();
  private viewSpotCache = new Map<string, PlacedLabel[]>();
  private viewSpotKey = '';

  /** Each owner's main piece and its outline, for one assignment of parcels to owners. */
  private ownerPieces(arr: Arrangement, owners: Map<number, string>, mask: LandMask | null): Map<string, OwnerPiece> {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (const [f, o] of owners) {
      h1 = Math.imul(h1 ^ f, 16777619);
      for (let i = 0; i < o.length; i++) { const c = o.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c + f, 2246822519); }
    }
    const key = `${arr.spaceId}|${arr.revision}|${mask ? 'land' : 'all'}|${owners.size}|${h1 >>> 0}|${h2 >>> 0}`;
    const hit = this.pieceCache.get(key);
    if (hit) return hit;
    // Connected pieces: parcels of the same owner that share a border.
    const parent = new Map<number, number>();
    const find = (f: number): number => { let r = f; while (parent.get(r) !== r) r = parent.get(r)!; let x = f; while (x !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
    for (const f of owners.keys()) parent.set(f, f);
    for (const s of arr.segments.values()) {
      const lo = owners.get(s.left_face);
      if (lo !== undefined && lo === owners.get(s.right_face)) { const a = find(s.left_face), b = find(s.right_face); if (a !== b) parent.set(a, b); }
    }
    type Comp = { owner: string; faces: number[]; area: number; sx: number; sy: number; sz: number };
    const comps = new Map<number, Comp>();
    const total = new Map<string, number>();
    for (const [f, o] of owners) {
      const g = this.faceGeo(arr, f);
      const area = mask ? this.landSample(arr, f, mask).land : g.area;
      const r = find(f);
      let c = comps.get(r);
      if (!c) comps.set(r, (c = { owner: o, faces: [], area: 0, sx: 0, sy: 0, sz: 0 }));
      c.faces.push(f);
      c.area += area;
      const lon = g.centroid[0] * Math.PI / 180, lat = g.centroid[1] * Math.PI / 180;
      c.sx += g.area * Math.cos(lat) * Math.cos(lon); c.sy += g.area * Math.cos(lat) * Math.sin(lon); c.sz += g.area * Math.sin(lat);
      total.set(o, (total.get(o) ?? 0) + area);
    }
    const main = new Map<string, Comp & { root: number }>();
    for (const [root, c] of comps) {
      if (c.area <= 0) continue;
      const m = main.get(c.owner);
      if (!m || c.area > m.area) main.set(c.owner, { ...c, root });
    }
    const mainOf = new Map<number, string>(); // face -> owner, for faces in an owner's main piece
    for (const [o, c] of main) for (const f of c.faces) mainOf.set(f, o);
    const arcs = new Map<string, number[]>();
    for (const s of arr.segments.values()) {
      const lo = mainOf.get(s.left_face), ro = mainOf.get(s.right_face);
      if (lo === ro) continue;
      const a = arr.vertices.get(s.a)!, b = arr.vertices.get(s.b)!;
      for (const o of [lo, ro]) {
        if (o === undefined) continue;
        let l = arcs.get(o);
        if (!l) arcs.set(o, (l = []));
        l.push(a.lon / 1e7, a.lat / 1e7, b.lon / 1e7, b.lat / 1e7);
      }
    }
    const out = new Map<string, OwnerPiece>();
    for (const [o, c] of main) {
      const lon = Math.atan2(c.sy, c.sx) * 180 / Math.PI;
      const a = Float64Array.from(arcs.get(o) ?? []);
      // Keyed by the outline itself, so an edit elsewhere keeps this label's place.
      let k1 = 0x811c9dc5, k2 = 0x9e3779b9;
      for (let i = 0; i < a.length; i++) { const v = Math.round(a[i] * 1e7) | 0; k1 = Math.imul(k1 ^ v, 16777619); k2 = Math.imul(k2 + v, 2246822519) ^ (k2 >>> 13); }
      out.set(o, {
        owner: o, key: `${a.length}|${k1 >>> 0}|${k2 >>> 0}${mask ? '|land' : ''}`,
        arcs: a, centreLon: Number.isFinite(lon) ? lon : 0, area: c.area, total: total.get(o) ?? c.area,
      });
    }
    if (this.pieceCache.size > 8) this.pieceCache.clear();
    this.pieceCache.set(key, out);
    return out;
  }

  /** Where a piece's label can go, for each way of breaking its text into lines (projection units). */
  private placePiece(piece: OwnerPiece, view: View, text: string, st: LabelStyle, accept: ((lon: number, lat: number) => boolean) | null, cacheKey: string, cache: Map<string, PlacedLabel[]>, onScreenOnly = false): PlacedLabel[] {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const proj = view.camera.projection;
    const sk = `${piece.key}|${proj}`;
    let shape = this.shapeCache.get(sk);
    if (!shape) {
      shape = planeShape(piece.arcs, proj, piece.centreLon);
      if (this.shapeCache.size > 1500) this.shapeCache.clear();
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
    const res: PlacedLabel[] = [];
    for (const lines of lineChoices(text)) {
      const wEm = Math.max(...lines.map((l) => textWidthEm(l, false, st.letterSpacing)));
      const hEm = blockHeightEm(lines.length);
      const spot = placeLabel(shape, wEm / hEm, accept ?? undefined, within);
      // A box with the label's proportions fits inside the ellipse found when its height is sqrt(2)
      // times the ellipse's half-height. Labels may spill a little past narrow places.
      if (spot) res.push({ lon: spot.lon, lat: spot.lat, font: (Math.SQRT2 * spot.room * 1.15) / hEm, lines });
    }
    if (cache.size > 3000) cache.clear();
    cache.set(cacheKey, res);
    return res;
  }

  /**
   * Of the ways to place a label, the one with the fewest lines that reaches the size wanted (design
   * pixels); when none does, the largest, with one line preferred over more.
   */
  private chooseLines(choices: PlacedLabel[], wanted: number, scale: number, unit: number): PlacedLabel | null {
    for (const c of choices) if ((c.font * scale) / unit >= wanted * 0.92) return c;
    let best: PlacedLabel | null = null, bestScore = -Infinity;
    for (const c of choices) {
      const score = c.font * (c.lines.length === 1 ? 1.3 : c.lines.length === 2 ? 1 : 0.85);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  private layerLabels(view: View, arr: Arrangement, states: Map<number, FaceState>, entities: Map<string, LabelEntity>, mask: LandMask | null = null): LabelInfo[] {
    // Who holds each parcel before and after the changes animating now (the same when none is).
    const before = new Map<number, string>(), after = new Map<number, string>();
    const progress = new Map<string, { w: number; p: number }>();
    let animating = false;
    for (const [face, st] of states) {
      const g = this.faceGeo(arr, face);
      if (g.area <= 0 || g.area > 2 * Math.PI) continue;
      if (st.value) after.set(face, st.value);
      const from = st.transition ? st.transition.from : st.value;
      if (from) before.set(face, from);
      if (st.transition && st.transition.from !== st.value) {
        animating = true;
        const p = Math.min(1, Math.max(0, st.transition.progress));
        for (const o of [st.transition.from, st.value]) {
          if (!o) continue;
          const e = progress.get(o) ?? { w: 0, p: 0 };
          e.w += g.area; e.p += g.area * p;
          progress.set(o, e);
        }
      }
    }
    const piecesAfter = this.ownerPieces(arr, after, mask);
    const piecesBefore = animating ? this.ownerPieces(arr, before, mask) : piecesAfter;
    const scale = view.projection.scale();
    const vis = visibleBounds(view);
    if (view.key !== this.viewSpotKey) { this.viewSpotCache.clear(); this.viewSpotKey = view.key; }
    const margin = LABEL_MARGIN;
    const onScreen = (p: [number, number] | null) => !!p && p[0] >= view.width * margin && p[0] <= view.width * (1 - margin) && p[1] >= view.height * margin && p[1] <= view.height * (1 - margin);
    const landOk = mask ? (lon: number, lat: number) => mask.onLand(lon, lat) : null;

    const place = (piece: OwnerPiece, text: string, st: LabelStyle): { pos: [number, number]; fontPx: number; lines: string[] } | null => {
      const ck = `${piece.key}|${view.camera.projection}|${text}|${st.letterSpacing}|${mask ? 1 : 0}`;
      // The size the territory's area suggests (design pixels): the label is never larger.
      const wanted = Math.min(st.maxSize, (Math.sqrt(piece.total) * scale * 0.18 * st.sizeScale) / view.unit);
      let pl = this.chooseLines(this.placePiece(piece, view, text, st, landOk, ck, this.spotCache), wanted, scale, view.unit);
      let p = pl ? view.projection([pl.lon, pl.lat]) as [number, number] | null : null;
      // The best place is off screen while part of the territory is in view (zoomed in on a large
      // country): place the label in the part that is in view.
      if ((!pl || !onScreen(p)) && vis !== null) {
        const inView = (lon: number, lat: number) => onScreen(view.projection([lon, lat]) as [number, number] | null) && (!landOk || landOk(lon, lat));
        const alt = this.chooseLines(this.placePiece(piece, view, text, st, inView, `${ck}|view`, this.viewSpotCache, true), wanted, scale, view.unit);
        if (alt && (alt.font * scale) / view.unit >= 6) { pl = alt; p = view.projection([alt.lon, alt.lat]) as [number, number] | null; }
      }
      if (!pl || !p) return null;
      return { pos: [pl.lon, pl.lat], fontPx: pl.font * scale, lines: pl.lines };
    };

    const out: LabelInfo[] = [];
    const owners = new Set([...piecesAfter.keys(), ...piecesBefore.keys()]);
    for (const id of owners) {
      const name = entities.get(id)?.name;
      if (!name) continue;
      const look = this.labelLook(id, name);
      if (!look) continue;
      const pa = piecesAfter.get(id), pb = piecesBefore.get(id);
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
      ctx.font = cityFont(c.size);
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

  /**
   * Place country labels and city names so that none overlap. In order of priority (larger countries,
   * smaller countries, cities), each takes the first free place among a few near its own: a country
   * label its centre, then a little above, below or to the side; a city name right of its dot, then
   * left, above or below. One that finds no free place is hidden.
   */
  private placeTexts(ctx: CanvasRenderingContext2D, labels: LabelInfo[], cities: CityItem[]): void {
    type Box = [number, number, number, number];
    const placed: Box[] = [];
    const dots: Box[] = cities.map((c) => [c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r]);
    const hits = (b: Box, list: Box[]) => list.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]));
    ctx.save();
    const sorted = [...labels].sort((a, b) => b.priority - a.priority || b.size - a.size || a.text.localeCompare(b.text));
    for (const l of sorted) {
      l.drawn = false;
      const st = l.style;
      ctx.font = labelFont(st, l.size);
      const spacing = st.letterSpacing * l.size;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing.toFixed(2)}px`;
      const lines = l.lines.length ? l.lines : [l.text];
      const w = Math.max(...lines.map((t) => ctx.measureText(t).width));
      const h = l.size + (lines.length - 1) * l.size * LINE_HEIGHT;
      const at = (dx: number, dy: number): Box => [l.x + dx - w / 2, l.y + dy - h / 2, l.x + dx + w / 2, l.y + dy + h / 2];
      const tries: Array<[number, number]> = [[0, 0], [0, -0.75 * h], [0, 0.75 * h], [-0.3 * w, 0], [0.3 * w, 0], [0, -1.4 * h], [0, 1.4 * h]];
      // First keeping clear of city dots too; failing that, only of other labels.
      let found: [number, number] | null = null;
      for (const avoidDots of [true, false]) {
        for (const [dx, dy] of tries) { const b = at(dx, dy); if (!hits(b, placed) && (!avoidDots || !hits(b, dots))) { found = [dx, dy]; break; } }
        if (found) break;
      }
      if (!found) continue;
      l.x += found[0]; l.y += found[1];
      l.box = [l.x - w / 2, l.y - h / 2, l.x + w / 2, l.y + h / 2];
      l.drawn = true;
      placed.push(l.box);
    }
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    for (const c of cities) {
      if (!c.size) { c.drawn = false; continue; }
      ctx.font = cityFont(c.size);
      const w = ctx.measureText(c.name).width, h = c.size, gap = c.r + 4 * (c.size / 17);
      const others = dots.filter((d) => !(d[0] === c.x - c.r && d[1] === c.y - c.r));
      const options: Array<{ tx: number; ty: number; align: CanvasTextAlign; box: Box }> = [
        { tx: c.x + gap, ty: c.y, align: 'left', box: [c.x + gap, c.y - h / 2, c.x + gap + w, c.y + h / 2] },
        { tx: c.x - gap, ty: c.y, align: 'right', box: [c.x - gap - w, c.y - h / 2, c.x - gap, c.y + h / 2] },
        { tx: c.x + gap * 0.6, ty: c.y - h * 0.8, align: 'left', box: [c.x + gap * 0.6, c.y - h * 1.3, c.x + gap * 0.6 + w, c.y - h * 0.3] },
        { tx: c.x + gap * 0.6, ty: c.y + h * 0.8, align: 'left', box: [c.x + gap * 0.6, c.y + h * 0.3, c.x + gap * 0.6 + w, c.y + h * 1.3] },
        { tx: c.x - gap * 0.6, ty: c.y - h * 0.8, align: 'right', box: [c.x - gap * 0.6 - w, c.y - h * 1.3, c.x - gap * 0.6, c.y - h * 0.3] },
        { tx: c.x - gap * 0.6, ty: c.y + h * 0.8, align: 'right', box: [c.x - gap * 0.6 - w, c.y + h * 0.3, c.x - gap * 0.6, c.y + h * 1.3] },
      ];
      const ok = options.find((o) => !hits(o.box, placed) && !hits(o.box, others));
      c.drawn = !!ok;
      if (!ok) continue;
      c.tx = ok.tx; c.ty = ok.ty; c.align = ok.align; c.box = ok.box;
      placed.push(ok.box);
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

  private drawLabels(ctx: CanvasRenderingContext2D, labels: LabelInfo[], _style: MapStyle, _u: number): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of labels) {
      if (!l.drawn) continue; // no free place (see placeTexts)
      const st = l.style;
      ctx.font = labelFont(st, l.size);
      const spacing = st.letterSpacing * l.size;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing.toFixed(2)}px`;
      const lines = l.lines.length ? l.lines : [l.text];
      const lh = l.size * LINE_HEIGHT;
      // With letter spacing the text grows to the right; shift it back so it stays centred.
      const x = l.x + spacing / 2;
      ctx.globalAlpha = st.opacity;
      lines.forEach((t, i) => {
        const y = l.y - ((lines.length - 1) * lh) / 2 + i * lh;
        if (st.haloWidth > 0) {
          ctx.lineWidth = Math.max(1, l.size * st.haloWidth);
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

/** An advancing front from a border: how far it must travel, and the area reached at a distance. */
interface BorderFront { maxDist: number; reach: (r: number) => Path2D }

function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

interface LandSample { pts: number[]; vec: Float64Array; sum: [number, number, number]; weight: number; land: number }

function vec3(p: [number, number]): [number, number, number] {
  const lon = (p[0] * Math.PI) / 180, lat = (p[1] * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

function toLonLat(v: [number, number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.atan2(v[1], v[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, v[2] / len))) * 180 / Math.PI];
}

function insideGeo(geo: GeoPermissibleObjects, p: [number, number]): boolean {
  if ((geo as { type: string }).type === 'Sphere') return true;
  // Signed spherical area of the polygon with p's antipode excluded: cheap test via d3's area of a tiny cap
  // is overkill; use winding of the projected ring around p instead (good enough for label placement).
  const poly = geo as GeoJSON.Polygon;
  let inside = false;
  for (const ring of poly.coordinates) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (Math.abs(xi - xj) > 180) continue;
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

