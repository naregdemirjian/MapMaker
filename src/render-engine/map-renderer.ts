// The map renderer: draws a map space at a moment in time from the world model and the temporal
// engine. Nothing here is stored history: every pixel is computed from parcels, effects and styles.
//
// This is the Canvas 2D backend. The approved architecture uses deck.gl (WebGL) for the final
// renderer; deck.gl could not be installed in the offline build environment, so this backend sits
// behind the same inputs (world, engine, view, time, options) and can be replaced without touching
// the world model, the engine, the interface or the export pipeline.
import { geoPath, geoGraticule10, geoCircle, geoCentroid, geoArea, type GeoPermissibleObjects } from 'd3-geo';
import type { World } from '../world-model/world.ts';
import type { Engine, FaceState, Assignment, CompiledTransition } from '../temporal-engine/engine.ts';
import { parseJSON } from '../temporal-engine/engine.ts';
import { type Instant, compare, diffMs } from '../core-time/index.ts';
import { BASE_EVENT_ID } from '../world-model/schema.ts';
import type { Vec3 } from '../geo-kernel/vec.ts';
import type { View } from './camera.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import { E7 } from '../geo-kernel/vec.ts';
import { BasemapPainter, landMaskOf, type Basemap, type LandMask } from './basemap.ts';
import { resolveLabelStyle, labelSize, labelFont, labelText, type LabelStyle, type CountryLabel } from './label-style.ts';
import { imageNow, videoNow, drawImageFit, type MediaChannel } from './assets.ts';

type LabelEntity = { name: string; style?: string };

export type PassName = 'background' | 'graticule' | 'land' | 'fills' | 'borders' | 'labels';
/** Drawing order. The grid lies under the land, so stacked export passes match the full picture. */
export const ALL_PASSES: PassName[] = ['background', 'graticule', 'land', 'fills', 'borders', 'labels'];

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
}

/** A picture or video fill (see domain/commands.ts CountryFill). */
interface CountryFillLike { kind: 'color' | 'image' | 'video'; asset?: string; fit?: 'cover' | 'contain' | 'stretch' | 'tile'; tileSize?: number; play?: 'loop' | 'once'; speed?: number; start?: number }

/** x, y, width, height on screen. */
type Box2 = [number, number, number, number];

export type TransitionEase = 'linear' | 'smooth' | 'in' | 'out';

/** Shot transition settings as the renderer needs them (see presentation/sequence.ts ShotTransitions). */
export interface ShotTransitionOptions {
  mode: 'recorded' | 'all' | 'instant';
  style: 'advance' | 'fade' | 'wipe';
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

export interface LabelInfo { text: string; x: number; y: number; size: number; style: LabelStyle; entityId: string }

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
      ctx.stroke(new Path2D(geoPath(view.projection)(geoGraticule10()) ?? ''));
    }
    if (opts.passes.has('land') && opts.basemap) {
      const oceanBelow = opts.passes.has('background') && !opts.transparent;
      this.basemapPainter.draw(ctx, view, opts.basemap, { referenceBorders: !!opts.referenceBorders, oceanColor: oceanBelow ? style.ocean : undefined });
    }

    const entities = new Map(world.all('entity').map((e) => [e.id, e]));
    this.mediaSeconds = opts.mediaSeconds ?? 0;
    this.mediaChannel = opts.mediaChannel ?? 'live';
    // Pictures and videos filling territory, by owner.
    const fills = new Map<string, CountryFillLike | null>();
    const fillOf = (v: string): CountryFillLike | null => {
      if (fills.has(v)) return fills.get(v)!;
      const f = parseJSON<{ fill?: CountryFillLike }>(entities.get(v)?.style ?? '{}', {})?.fill ?? null;
      const ok = f && f.asset && (f.kind === 'image' || f.kind === 'video') ? f : null;
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
    const labels: LabelInfo[] = [];

    // Draw in the same order whether everything is drawn at once or pass by pass (as exported):
    // the fills of every layer, then the borders of every layer, then the labels. Stacking the
    // exported passes in Premiere then reproduces the full picture exactly, with several layers too.
    const drawsLayers = opts.passes.has('fills') || opts.passes.has('borders') || opts.passes.has('labels');
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
        ctx.strokeStyle = front.color;
        ctx.lineWidth = front.width * view.unit;
        ctx.shadowColor = front.color;
        ctx.shadowBlur = front.glow * view.unit;
        ctx.stroke(g.disc);
        ctx.restore();
      }
    }

    if (opts.passes.has('borders')) for (const { ls, states, tg, clip } of prepared) {
      ctx.save();
      if (clip) ctx.clip(land());
      this.drawBorders(ctx, view, arr, states, tg, style, (ls.borderWidth ?? style.borderWidth) * u);
      ctx.restore();
    }

    if (opts.passes.has('labels')) for (const { states, clip } of prepared) labels.push(...this.layerLabels(view, arr, states, entities, clip ? landMaskOf(opts.basemap!) : null));

    if (opts.passes.has('labels')) this.drawLabels(ctx, labels, style, u);
    this.lastLabels = labels;
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
      if (o.mode !== 'all' || !a || a.eventId === BASE_EVENT_ID) { out.set(f, st); continue; }
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
        const advance = spec.style === 'advance' || spec.style === 'wipe';
        // Shot-made animations use the shot's easing; recorded fronts their own; recorded fades stay even.
        const progress = spec.shot || spec.style === 'advance' ? ease(spec.easing, st.transition.progress) : st.transition.progress;
        g = { a: st.assignment, faces: [], states: [], advance, spec, progress, disc: null, region: new Path2D(), changing: new Path2D() };
        groups.set(key, g);
      }
      g.faces.push(face);
      g.states.push(st);
      of.set(face, g);
      const path = this.facePath(view, arr, face);
      g.region.addPath(path);
      if ((st.transition.from ?? '') !== (st.value ?? '')) g.changing.addPath(path);
    }
    // The area each moving front has reached: a circle from its origin, or a straight wipe.
    for (const g of groups.values()) {
      if (!g.advance || g.progress <= 0) continue;
      if (g.spec.style === 'wipe') { g.disc = this.wipeShape(view, arr, g); continue; }
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
    if (g.advance) lc.clip(g.changing, 'evenodd');
    else lc.globalAlpha = Math.min(1, Math.max(0, g.progress));
    paint(lc, g.a.value, shape);
    lc.restore();
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

  private scratchCanvas: OffscreenCanvas | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;

  /** A cleared buffer the size of the target, with the target's current transform. */
  private scratch(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (!this.scratchCanvas || this.scratchCanvas.width !== w || this.scratchCanvas.height !== h) {
      this.scratchCanvas = new OffscreenCanvas(w, h);
      // Match the target's memory placement so copying between them stays cheap.
      const willReadFrequently = !!ctx.getContextAttributes?.().willReadFrequently;
      this.scratchCtx = this.scratchCanvas.getContext('2d', { willReadFrequently }) as unknown as CanvasRenderingContext2D;
    }
    const sc = this.scratchCtx!;
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
  ): void {
    const differs = (x: string | null, y: string | null) => (x ?? '') !== (y ?? '');
    const plain: number[][][] = [];
    const inside = new Map<TransitionGroup, number[][][]>(), outside = new Map<TransitionGroup, number[][][]>();
    const add = (m: Map<TransitionGroup, number[][][]>, g: TransitionGroup, line: number[][]) => { let l = m.get(g); if (!l) m.set(g, (l = [])); l.push(line); };
    for (const s of arr.segments.values()) {
      const a = states.get(s.left_face), b = states.get(s.right_face);
      if (!a || !b) continue;
      const ga = tg.of.get(s.left_face), gb = tg.of.get(s.right_face);
      const now = differs(a.value, b.value);
      const before = ga || gb ? differs(ga ? a.transition!.from : a.value, gb ? b.transition!.from : b.value) : now;
      if (!now && !before) continue;
      const va = arr.vertices.get(s.a)!, vb = arr.vertices.get(s.b)!;
      const line = [[va.lon / E7, va.lat / E7], [vb.lon / E7, vb.lat / E7]];
      // Unaffected by any animation, a border both before and after, or where two animations meet.
      if ((!ga && !gb) || (now && before) || (ga && gb && ga !== gb)) { plain.push(line); continue; }
      add(now ? inside : outside, (ga ?? gb)!, line);
    }
    const path = (lines: number[][][]) => new Path2D(geoPath(view.projection)({ type: 'MultiLineString', coordinates: lines }) ?? '');
    ctx.save();
    ctx.strokeStyle = style.border;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (plain.length) ctx.stroke(path(plain));
    for (const g of tg.groups.values()) {
      const ins = inside.get(g), outs = outside.get(g);
      if (g.advance) {
        if (!g.disc) { if (outs) ctx.stroke(path(outs)); continue; }
        if (ins) { ctx.save(); ctx.clip(g.disc, 'evenodd'); ctx.stroke(path(ins)); ctx.restore(); }
        if (outs) { ctx.save(); ctx.clip(outsideOf(g.disc), 'evenodd'); ctx.stroke(path(outs)); ctx.restore(); }
        ctx.save(); ctx.clip(g.changing, 'evenodd'); ctx.stroke(g.disc); ctx.restore();
      } else {
        if (ins) { ctx.globalAlpha = g.progress; ctx.stroke(path(ins)); }
        if (outs) { ctx.globalAlpha = 1 - g.progress; ctx.stroke(path(outs)); }
        ctx.globalAlpha = 1;
      }
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

  private layerLabels(view: View, arr: Arrangement, states: Map<number, FaceState>, entities: Map<string, LabelEntity>, mask: LandMask | null = null): LabelInfo[] {
    if (mask) return this.landLabels(view, arr, states, entities, mask);
    const byOwner = new Map<string, { area: number; sx: number; sy: number; sz: number; best: FaceGeo | null }>();
    const bestArea = new Map<string, number>();
    // During an animated change a parcel counts partly for its previous owner and partly for its new
    // one, in proportion to how far the change has progressed, so labels glide instead of jumping.
    const add = (v: string | null, g: FaceGeo, weight: number) => {
      if (!v || weight <= 0) return;
      const area = g.area * weight;
      let o = byOwner.get(v);
      if (!o) byOwner.set(v, (o = { area: 0, sx: 0, sy: 0, sz: 0, best: null }));
      const [lon, lat] = g.centroid.map((d) => (d * Math.PI) / 180);
      o.sx += area * Math.cos(lat) * Math.cos(lon); o.sy += area * Math.cos(lat) * Math.sin(lon); o.sz += area * Math.sin(lat);
      o.area += area;
      if (!o.best || area > (bestArea.get(v) ?? 0)) { o.best = g; bestArea.set(v, area); }
    };
    for (const [face, st] of states) {
      const g = this.faceGeo(arr, face);
      if (g.area <= 0 || g.area > 2 * Math.PI) continue;
      if (st.transition) {
        const p = Math.min(1, Math.max(0, st.transition.progress));
        add(st.transition.from, g, 1 - p);
        add(st.value, g, p);
      } else add(st.value, g, 1);
    }
    const out: LabelInfo[] = [];
    const scale = view.projection.scale();
    for (const [id, o] of byOwner) {
      const name = entities.get(id)?.name;
      if (!name || !o.best) continue;
      const len = Math.hypot(o.sx, o.sy, o.sz);
      let pos: [number, number] = o.best.centroid;
      if (len > 1e-12) {
        const c: [number, number] = [Math.atan2(o.sy, o.sx) * 180 / Math.PI, Math.asin(o.sz / len) * 180 / Math.PI];
        // use the weighted centre only when it lies inside the owner's largest piece of territory
        if (insideGeo(o.best.geo, c)) pos = c;
      }
      const p = view.projection(pos);
      if (!p) continue;
      const look = this.labelLook(id, name);
      if (!look) continue;
      const size = labelSize(look.style, (Math.sqrt(o.area) * scale * 0.18) / view.unit) * view.unit;
      out.push({ text: look.text, x: p[0], y: p[1], size, style: look.style, entityId: id });
    }
    return out;
  }

  /** The look of one country's label (null: hidden); set for each frame by render(). */
  private labelLook: (id: string, name: string) => { style: LabelStyle; text: string } | null = (_id, name) => ({ style: resolveLabelStyle(), text: name });

  /**
   * Labels for a layer clipped at the coast: placed and sized from the land part of each territory
   * only, so they never sit over the sea. A territory entirely at sea has no label.
   */
  private landLabels(view: View, arr: Arrangement, states: Map<number, FaceState>, entities: Map<string, LabelEntity>, mask: LandMask): LabelInfo[] {
    type Acc = { area: number; sx: number; sy: number; sz: number; samples: LandSample[]; best: FaceGeo | null; bestLand: number };
    const byOwner = new Map<string, Acc>();
    const add = (v: string | null, face: number, weight: number) => {
      if (!v || weight <= 0) return;
      const s = this.landSample(arr, face, mask);
      if (!s.pts.length) return;
      let o = byOwner.get(v);
      if (!o) byOwner.set(v, (o = { area: 0, sx: 0, sy: 0, sz: 0, samples: [], best: null, bestLand: 0 }));
      const wt = s.weight * weight;
      o.sx += wt * s.sum[0]; o.sy += wt * s.sum[1]; o.sz += wt * s.sum[2];
      o.area += s.land * weight;
      o.samples.push(s);
      if (s.land * weight > o.bestLand) { o.bestLand = s.land * weight; o.best = this.faceGeo(arr, face); }
    };
    for (const [face, st] of states) {
      const g = this.faceGeo(arr, face);
      if (g.area <= 0 || g.area > 2 * Math.PI) continue;
      if (st.transition) {
        const p = Math.min(1, Math.max(0, st.transition.progress));
        add(st.transition.from, face, 1 - p);
        add(st.value, face, p);
      } else add(st.value, face, 1);
    }
    const out: LabelInfo[] = [];
    const scale = view.projection.scale();
    for (const [id, o] of byOwner) {
      const name = entities.get(id)?.name;
      const len = Math.hypot(o.sx, o.sy, o.sz);
      if (!name || !o.best || len < 1e-12) continue;
      const ux = o.sx / len, uy = o.sy / len, uz = o.sz / len;
      let pos: [number, number] = [Math.atan2(uy, ux) * 180 / Math.PI, Math.asin(uz) * 180 / Math.PI];
      // The weighted centre, when it is on land inside the largest land piece (labels glide during
      // animations); otherwise the land sample nearest to it.
      if (!(mask.onLand(pos[0], pos[1]) && insideGeo(o.best.geo, pos))) {
        let bestDot = -2;
        for (const s of o.samples) for (let i = 0, k = 0; i < s.pts.length; i += 2, k += 3) {
          const d = ux * s.vec[k] + uy * s.vec[k + 1] + uz * s.vec[k + 2];
          if (d > bestDot) { bestDot = d; pos = [s.pts[i], s.pts[i + 1]]; }
        }
      }
      const p = view.projection(pos);
      if (!p) continue;
      const look = this.labelLook(id, name);
      if (!look) continue;
      const size = labelSize(look.style, (Math.sqrt(o.area) * scale * 0.18) / view.unit) * view.unit;
      out.push({ text: look.text, x: p[0], y: p[1], size, style: look.style, entityId: id });
    }
    return out;
  }

  private drawLabels(ctx: CanvasRenderingContext2D, labels: LabelInfo[], _style: MapStyle, _u: number): void {
    const placed: Array<[number, number, number, number]> = [];
    const sorted = [...labels].sort((a, b) => b.size - a.size || a.text.localeCompare(b.text));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of sorted) {
      const st = l.style;
      ctx.font = labelFont(st, l.size);
      const spacing = st.letterSpacing * l.size;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing.toFixed(2)}px`;
      const w = ctx.measureText(l.text).width;
      // Larger labels win where labels would overlap.
      const box: [number, number, number, number] = [l.x - w / 2, l.y - l.size / 2, l.x + w / 2, l.y + l.size / 2];
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box);
      // With letter spacing the text grows to the right; shift it back so it stays centred.
      const x = l.x + spacing / 2;
      ctx.globalAlpha = st.opacity;
      if (st.haloWidth > 0) {
        ctx.lineWidth = Math.max(1, l.size * st.haloWidth);
        ctx.strokeStyle = st.haloColor;
        ctx.strokeText(l.text, x, l.y);
      }
      ctx.fillStyle = st.color;
      ctx.fillText(l.text, x, l.y);
    }
    ctx.restore();
  }

}

interface LandSample { pts: number[]; vec: Float64Array; sum: [number, number, number]; weight: number; land: number }

function toLonLat(v: [number, number, number]): [number, number] {
  return [Math.atan2(v[1], v[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI];
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

