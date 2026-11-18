import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLive, store } from '../store.ts';
import {
  makeView, screenToLonLat, lonLatToScreen, panCamera, zoomCameraAt, radiansPerPixel, cameraKey, shapedByMeridian, rotatePoint, type View, type Camera,
} from '../../render-engine/camera.ts';
import { DEFAULT_STYLE, type PassName } from '../../render-engine/map-renderer.ts';
import { isFeatureKind } from '../../render-engine/feature-style.ts';
import { finishFeatureDrawing } from './Features.tsx';
import { placementMode } from './Characters.tsx';
import { regionIndex } from './Regions.tsx';
import { bordersAt } from '../../domain/border-points.ts';
import { periodChangesNow, GAINED_COLOR, LOST_COLOR } from './CountryHistory.tsx';
import { processLasso, densify, orientInteriorLeft, signedArea, splitLoops, simplify, smooth, type Pt, dedupe, ringFromMapPoints } from '../../render-engine/stroke.ts';
import { geoCentroid } from 'd3-geo';
import { lonLatToVec, E7 } from '../../geo-kernel/vec.ts';
import { cameraAt, timeAt, overlaysAt, drawOverlays, withStillCamera, moveOverlay, type ShotSettings, type OverlayRect } from '../../presentation/sequence.ts';
import { transitionOptions, drawShotOverlays } from '../../presentation/export-driver.ts';
import { parseJSON, slerpLonLat } from '../../temporal-engine/engine.ts';
import { compare, fromStore, gregorian } from '../../core-time/index.ts';
import { basemapSourceOf, shown, minLakeKm2, terrainLook, seaLevelPoints, planetOf, sculptOf } from '../../world-model/world-settings.ts';
import { stampsAt } from '../../terrain/sculpt.ts';
import { sculpted } from '../../terrain/sculpt-cache.ts';
import { seaLevelAt } from '../../terrain/sea-level.ts';
import { recordTransition } from '../record-length.ts';
import { loadBasemapDetail, pixelsPerDegree, visibleBounds, DETAIL_PIXELS_PER_DEGREE, type Basemap } from '../../render-engine/basemap.ts';
import * as cmd from '../../domain/commands.ts';

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; x: number; y: number; moved: number; startX: number; startY: number }
  // Brush points are kept as map positions (longitude, latitude), so zooming or panning in the
  // middle of a stroke never changes the shape being drawn.
  | { kind: 'lasso'; points: Pt[] }
  | { kind: 'vertex'; vid: number; x: number; y: number; moved: number }
  // The border pen: points go straight into the current draft (map positions).
  | { kind: 'pen' }
  // A text or the current-events box dragged on the shot preview.
  | { kind: 'overlay'; id: string; x: number; y: number; from: { x: number; y: number } }
  // A character's marker dragged to a new place (from the date being viewed).
  | { kind: 'character'; entity: string; from: Pt; moved: number }
  // The border eraser's stroke (map positions).
  | { kind: 'erase'; points: Pt[] }
  // A stroke of the sculpting brush (map positions; D98).
  | { kind: 'sculpt'; points: Pt[] }
  // A freehand area or line on a feature layer (map positions).
  | { kind: 'feature'; points: Pt[] }
  // The line between two dates being compared, dragged across the map.
  | { kind: 'swipe' }
  // The Split tool: a line drawn across a country, or a click on the part that changes hands (map positions; D76).
  | { kind: 'cut'; points: Pt[]; x: number; y: number; moved: number }
  // The region picker: a click on a region, or a box dragged around several (screen pixels; D78).
  | { kind: 'pickbox'; x: number; y: number; cx: number; cy: number; moved: number };

/** Where the shot preview last drew its texts and the events box (frame pixels), to pick them up. */
let overlayRects: OverlayRect[] = [];
/** The same, for the tests. */
export function shotOverlayRects(): OverlayRect[] { return overlayRects; }

export function currentShot(): ShotSettings | null {
  const w = store.world;
  if (!w || !store.shotId) return null;
  const row = w.get('sequence', store.shotId);
  return row ? parseJSON<ShotSettings | null>(row.settings, null) : null;
}

/** The frame rectangle of a shot inside the viewport (letterboxed). */
export function frameRect(shot: ShotSettings, w: number, h: number) {
  const aspect = shot.width / shot.height;
  let fw = w - 24, fh = fw / aspect;
  if (fh > h - 24) { fh = h - 24; fw = fh * aspect; }
  return { x: (w - fw) / 2, y: (h - fh) / 2, w: Math.max(1, fw), h: Math.max(1, fh) };
}

/**
 * The border eraser: every border the stroke crosses (or passes within a few pixels of) is erased:
 * the country where the stroke starts takes the land on the other side of each, from the date being
 * viewed (or in the event being recorded). One undo step.
 */
/** A stroke of the sculpting brush (D98), kept in the base world or from the date viewed. */
function sculptStroke(points: Pt[]): void {
  const s = store, b = s.sculpt;
  if (!points.length || !s.world) return;
  s.execute((wd) => cmd.addTerrainStamp(wd, s.spaceId, {
    tool: b.tool, path: points.map((q) => [q[0], q[1]] as [number, number]), radiusKm: b.radiusKm, strength: b.strength,
    seed: 1 + Math.floor(Math.random() * 999_999), from: b.dated && Number.isFinite(s.time.day) ? { day: s.time.day, ms: s.time.ms } : null,
  }));
}

function eraseBorders(stroke: Pt[], view: View): void {
  const s = store, w = s.world!, e = s.engine!;
  if (stroke.length < 2 || !s.layerId) return;
  const arr = w.arrangement(s.spaceId);
  const scr = stroke.map((q) => lonLatToScreen(view, q[0], q[1])).filter((q): q is Pt => !!q);
  if (scr.length < 2) return;
  const states = e.partitionState(s.spaceId, s.layerId, s.time);
  const ownerOf = (f: number) => states.get(f)?.value ?? null;
  const start = e.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(stroke[0][0], stroke[0][1]), s.time);
  // Only borders on screen near the stroke: a box test first, then the distance in pixels.
  const lons = stroke.map((q) => q[0]), lats = stroke.map((q) => q[1]);
  const pad = 2;
  const box = [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad];
  const near = (a: Pt, b: Pt) => {
    for (let i = 1; i < scr.length; i++) if (segSegDist(a, b, scr[i - 1], scr[i]) <= 5) return true;
    return false;
  };
  const take = new Set<number>();
  let crossed = 0;
  for (const sg of arr.segments.values()) {
    const va = arr.vertices.get(sg.a)!, vb = arr.vertices.get(sg.b)!;
    const ax = va.lon / E7, ay = va.lat / E7, bx = vb.lon / E7, by = vb.lat / E7;
    if (Math.max(ax, bx) < box[0] || Math.min(ax, bx) > box[2] || Math.max(ay, by) < box[1] || Math.min(ay, by) > box[3]) continue;
    const l = ownerOf(sg.left_face), r = ownerOf(sg.right_face);
    if ((l ?? '') === (r ?? '')) continue; // not a border at this date
    const pa = lonLatToScreen(view, ax, ay), pb = lonLatToScreen(view, bx, by);
    if (!pa || !pb || !near(pa, pb)) continue;
    crossed++;
    if ((l ?? '') !== (start ?? '')) take.add(sg.left_face);
    if ((r ?? '') !== (start ?? '')) take.add(sg.right_face);
  }
  if (!take.size) { s.toast(crossed ? 'Nothing to erase there.' : 'Drag across a border to erase it.'); return; }
  // The whole touching piece across each border goes (a country drawn in several parcels is still one
  // piece), so no border reappears further on.
  const sameOwner = new Map<number, number[]>();
  for (const sg of arr.segments.values()) {
    const l = sg.left_face, r = sg.right_face;
    if (l === r || (ownerOf(l) ?? '') !== (ownerOf(r) ?? '')) continue;
    (sameOwner.get(l) ?? sameOwner.set(l, []).get(l)!).push(r);
    (sameOwner.get(r) ?? sameOwner.set(r, []).get(r)!).push(l);
  }
  const stack = [...take];
  while (stack.length) {
    const f = stack.pop()!;
    for (const g of sameOwner.get(f) ?? []) if (!take.has(g) && ownerOf(g) !== null) { take.add(g); stack.push(g); }
  }
  const who = start ? w.get('entity', start)?.name ?? 'the country' : 'nobody';
  const rev = w.revision;
  s.execute((wd, en) => cmd.assignFaces(wd, en, { spaceId: s.spaceId, layerId: s.layerId, leaves: [...take], value: start, mode: placementMode() }));
  if (w.revision !== rev) s.toast(`Erased: the land across went to ${who}.`);
}

function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const cross = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  const pd = (p: Pt, u: Pt, v: Pt) => {
    const dx = v[0] - u[0], dy = v[1] - u[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy);
  };
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
}

/** Store the preview's view as the current shot's camera (still for the whole shot). */
function commitShotCamera(): void {
  const sh = currentShot(), cam = store.presentCamera, id = store.shotId;
  if (!sh || !cam || !id) return;
  store.execute((w) => cmd.updateSequence(w, id, { settings: withStillCamera(sh, cam) }));
  store.set({ presentCamera: null });
}

/** The view the map was last drawn with (it may be holding a meridian while the map moves; see MapView), and whether that was a shot's preview. */
let shownView: { view: View; preview: boolean } | null = null;
export function shownMapView(): { view: View; preview: boolean } | null { return shownView; }

/** How long after the last movement of the view the picture is drawn afresh, sharp (milliseconds). */
const SETTLE_MS = 110;
/** After this long at rest, the room around the map's kept pictures is drawn (see MapRenderer.slide). */
const FILL_AFTER_MS = 260;

/** The basemap without its most detailed coastlines (the working view's "medium coasts" setting). */
const mediumCoasts = new WeakMap<Basemap, { n: number; basemap: Basemap }>();
function withoutDetail(b: Basemap): Basemap {
  let m = mediumCoasts.get(b);
  if (!m || m.n !== b.scales.length) mediumCoasts.set(b, (m = { n: b.scales.length, basemap: { ...b, scales: b.scales.filter((sc) => sc.scale !== '10m') } }));
  return m.basemap;
}

export function MapView() {
  const s = useLive();
  /** The view last drawn and when it last changed; the timer that sharpens the picture once it rests. */
  const motion = useRef({ sig: '', at: 0, timer: 0 });
  /**
   * The meridian the working view is laid out around while the map is being moved (maps shaped by
   * their middle meridian only, see Camera.meridian): the camera last seen, when it last changed,
   * and the meridian held since.
   */
  const held = useRef({ cam: '', at: -Infinity, meridian: Number.NaN });
  /** Filling the room around the map's kept pictures once the view rests: the view it was last done for, the timer, and whether the next frame does it. */
  const filling = useRef({ sig: '', timer: 0, due: false });
  const speedRef = useRef<HTMLDivElement | null>(null);
  const frameTimes = useRef<number[]>([]);
  // The picture of the other date being compared (Stage 3), drawn by its own renderer.
  const compareCanvas = useRef<OffscreenCanvas | null>(null);
  useEffect(() => () => { window.clearTimeout(motion.current.timer); window.clearTimeout(filling.current.timer); }, []);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<Drag>({ kind: 'none' });
  const wheelTimer = useRef(0);
  /** Points of the precise shape being placed, as map positions (longitude, latitude). */
  const [polygon, setPolygon] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hoverVertex, setHoverVertex] = useState<number | null>(null);
  const [, force] = useState(0);
  const [overOverlay, setOverOverlay] = useState(false);
  const [overSplit, setOverSplit] = useState(false);
  // The region under the pointer with the Regions tool (D78).
  const hoverRegion = useRef<number | null>(null);
  // The Border points tool shows and picks only points of borders at the date viewed: where the owners
  // on the two sides differ on a visible territory layer (an erased border's points stay in the map, for
  // the dates it existed, but are not shown). Worked out again when the map or the date changes.
  const borderPts = useRef<{ key: string; vertices: Set<number>; segments: Set<number> } | null>(null);
  function bordersNow(): { vertices: Set<number>; segments: Set<number> } {
    const w = store.world!, en = store.engine!;
    const layers = w.all('layer').filter((l) => l.space_id === store.spaceId && l.kind === 'partition' && l.visible);
    const key = `${store.spaceId}|${w.revision}|${store.time.day}|${store.time.ms}|${layers.map((l) => l.id).join(',')}`;
    if (borderPts.current?.key === key) return borderPts.current;
    borderPts.current = { key, ...bordersAt(w, en, store.spaceId, layers.map((l) => l.id), store.time) };
    return borderPts.current;
  }
  const presentation = s.mode === 'present';
  const shot = presentation ? currentShot() : null;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(50, el.clientWidth), h: Math.max(50, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The region of the canvas where the map is drawn, and the camera used.
  const frame = shot ? frameRect(shot, size.w, size.h) : { x: 0, y: 0, w: size.w, h: size.h };
  const camera: Camera = shot ? (s.presentCamera ?? cameraAt(shot, s.shotFrame)) : s.camera;
  // Equal Earth and Natural Earth give everything another shape for every middle meridian, so that
  // moving such a map east or west meant preparing and drawing all of it again in every frame
  // (a shot's projection is chosen in its settings, and its camera is framed by dragging the
  // preview). While the map is being moved by hand, the view therefore keeps the meridian it had:
  // the picture only shifts and is carried along like any other. Once the map rests (or has moved
  // further than the prepared part of the map reaches) it is laid out around the camera again, as
  // a shot's frames and exports always are. A shot that is playing is never held.
  let viewCamera = camera;
  const hm = held.current;
  if ((shot ? !!s.presentCamera : true) && s.viewSettings.whileMoving === 'carry' && shapedByMeridian(camera.projection)) {
    const now = performance.now(), ck = cameraKey(camera, frame.w, frame.h);
    if (hm.cam !== ck) { hm.cam = ck; hm.at = now; }
    const off = Math.abs(((((camera.lon - hm.meridian) % 360) + 540) % 360) - 180);
    // (The view is about 375° / 2^zoom wide; the prepared part of the map reaches 0.6 of that beyond it.)
    const reach = Math.min(45, (0.5 * 375) / Math.pow(2, camera.zoom));
    if (!(now - hm.at < SETTLE_MS) || !(off <= reach)) hm.meridian = camera.lon;
    if (hm.meridian !== camera.lon) viewCamera = { ...camera, meridian: hm.meridian };
  } else { hm.cam = ''; hm.meridian = Number.NaN; }
  const holding = viewCamera !== camera;
  const view: View = makeView(viewCamera, frame.w, frame.h);
  const time = shot ? timeAt(shot, s.shotFrame) : s.time;

  // Drawn before the browser paints (a passive effect would show each movement a frame late).
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !s.world || !s.engine || !s.spaceId) return;
    const vs = s.viewSettings;
    const started = performance.now();
    // (The working view's sharpness setting: fewer pixels to draw, shown at the same size.)
    const dpr = (window.devicePixelRatio || 1) * vs.resolution;
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // (The renderer clears or replaces the frame itself; only a shot's frame leaves canvas around it.)
    if (shot) ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, frame.x * dpr, frame.y * dpr);
    const layers = s.world.all('layer').filter((l) => l.space_id === s.spaceId && (l.kind === 'partition' || isFeatureKind(l.kind)) && (shot ? (shot.layers.length ? shot.layers.includes(l.id) : l.visible) : l.visible)).sort((a, b) => a.sort_order - b.sort_order).map((l) => l.id);
    // What the map shows (D84): while working, or (the shot's preview) in exports.
    const space = s.world.get('map_space', s.spaceId);
    const where = shot ? 'export' as const : 'working' as const;
    const on = (k: Parameters<typeof shown>[2]) => shown(space, where, k);
    const show = { lakes: on('lakes'), coastline: on('coastline'), minLakeKm2: minLakeKm2(space) };
    const passes = new Set<PassName>(['background', 'land', 'fills']);
    // Terrain (D95): Earth's, loaded on first use.
    // Terrain (D95), the sea level of the moment (D96) and generated planets (D97, whose land and sea
    // are their terrain's): Earth's heights loaded, a planet's made, on first use.
    const look = terrainLook(space), terrainShown = !!look && on('terrain');
    const seaPoints = seaLevelPoints(space), seaLevel = seaLevelAt(seaPoints, time);
    // Sculpting (D98): the strokes holding at the date viewed, applied to the heights.
    const strokes = stampsAt(sculptOf(space), time);
    const needsGrid = terrainShown || seaPoints.length > 0 || !!planetOf(space) || strokes.length > 0;
    const ground = needsGrid ? s.terrainOf(space) : null;
    const carved = ground ? sculpted(ground.grid, ground.key, strokes, (space?.radius_m ?? 6371008.8) / 1000) : null;
    const terrain = ground && carved ? { grid: carved.grid, key: carved.key, look: terrainShown ? look : null, seaLevel, override: carved.touched && basemapSourceOf(space) === 'natural-earth' ? { data: carved.touched, key: carved.key } : null } : null;
    if (terrain?.look) passes.add('terrain');
    if (on('borders')) passes.add('borders');
    if (on('features')) passes.add('features');
    const full = basemapSourceOf(s.world.get('map_space', s.spaceId)) === 'natural-earth' ? s.basemap : null;
    const basemap = full && vs.coast === 'medium' ? withoutDetail(full) : full;
    // Close up, load the detailed coastlines (once) and redraw when they arrive.
    if (basemap && vs.coast === 'full' && pixelsPerDegree(view) > DETAIL_PIXELS_PER_DEGREE && !basemap.scales.some((sc) => sc.scale === '10m')) {
      loadBasemapDetail(basemap).then(() => store.notify(), (e: Error) => store.toast(e.message, 'error'));
    }
    if ((!shot || shot.graticule) && on('graticule')) passes.add('graticule');
    // The view counts as moving from when it changes until it has rested for a moment: meanwhile the
    // picture may be carried along (see MapRenderer.carry), and it is drawn afresh once it rests.
    const mo = motion.current;
    // (What the view is of, not how it is laid out: taking the camera's meridian again at rest is no movement.)
    const sig = `${cameraKey(camera, frame.w, frame.h)}|${frame.x},${frame.y}|${c.width}x${c.height}`;
    shownView = { view, preview: !!shot };
    if (sig !== mo.sig) { mo.at = mo.sig ? started : -Infinity; mo.sig = sig; }
    const moving = started - mo.at < SETTLE_MS;
    // The moment shown is being dragged along the timeline: names are placed less finely until it rests.
    const hurried = !shot && started - s.timeDraggedAt < SETTLE_MS;
    const fl = filling.current;
    const fillAround = fl.due && !moving && !shot;
    fl.due = false;
    const namesHidden = moving && vs.names === 'hide';
    const namesOn = (!shot || shot.labels) && on('names'), citiesOn = (!shot || shot.cities !== false) && on('cities');
    if (namesOn && !namesHidden) passes.add('labels');
    if ((!shot || shot.characters !== false) && on('characters')) passes.add('characters');
    if (citiesOn) passes.add('cities');
    try {
      s.renderer.render(ctx, view, s.world, s.engine, s.spaceId, time, { passes, transparent: !!shot?.transparent, layerIds: layers, basemap, referenceBorders: !shot && s.referenceBorders, transitions: shot ? transitionOptions(shot, s.shotFrame) : undefined, mediaSeconds: shot ? s.shotFrame / shot.fps : 0, trails: !!shot?.trails, layout: { labels: namesOn && !namesHidden, cities: citiesOn }, moving: moving && vs.whileMoving === 'carry', holdNames: moving && vs.names === 'hold', fillAround, hurried, show, terrain });
    } catch (e) {
      console.error(e);
    }
    window.clearTimeout(mo.timer);
    // (Counted from the end of this frame, not from the movement that caused it: a frame that itself
    // takes longer than the wait would otherwise be followed at once by the sharp redraw, in the
    // middle of the movement, and a slow computer would draw everything twice.)
    if ((moving || hurried) && (s.renderer.lastApproximate || namesHidden || holding)) mo.timer = window.setTimeout(() => force((n) => n + 1), SETTLE_MS + 4);
    // Once the view has rested a moment after moving, the room around the kept pictures is drawn (once
    // per view): the next move, or zooming out a little, then starts with nothing to draw.
    window.clearTimeout(fl.timer);
    if (fillAround && !s.renderer.roomToFill) fl.sig = sig;
    else if (!shot && vs.whileMoving === 'carry' && fl.sig !== sig && (moving || s.renderer.roomToFill)) fl.timer = window.setTimeout(() => { fl.due = true; force((n) => n + 1); }, FILL_AFTER_MS);
    if (speedRef.current) {
      const times = frameTimes.current;
      times.push(performance.now() - started);
      if (times.length > 20) times.shift();
      speedRef.current.textContent = `${times[times.length - 1].toFixed(0)} ms (last ${times.length}: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)} ms)`;
    }
    if (shot) {
      const o = s.presentOverlay;
      overlayRects = drawShotOverlays(ctx, frame.w, frame.h, s.world, o ? moveOverlay(shot, o.id, o.dx, o.dy, o.from) : shot, s.shotFrame, time);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(frame.x - 0.5, frame.y - 0.5, frame.w + 1, frame.h + 1);
      return;
    }
    // Comparing two dates: the other date drawn by its own renderer, laid on the right of the line.
    if (s.compare.on && s.mode === 'world') {
      const cmpCanvas = (compareCanvas.current ??= new OffscreenCanvas(c.width, c.height));
      if (cmpCanvas.width !== c.width || cmpCanvas.height !== c.height) { cmpCanvas.width = c.width; cmpCanvas.height = c.height; }
      const cc = cmpCanvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      cc.setTransform(dpr, 0, 0, dpr, frame.x * dpr, frame.y * dpr);
      try {
        s.compareRenderer.render(cc, view, s.world, s.engine, s.spaceId, s.compare.time, { passes, transparent: false, layerIds: layers, basemap, referenceBorders: s.referenceBorders, layout: { labels: namesOn && !namesHidden, cities: citiesOn }, moving: moving && vs.whileMoving === 'carry', holdNames: moving && vs.names === 'hold', fillAround, show, terrain: terrain && { ...terrain, seaLevel: seaLevelAt(seaPoints, s.compare.time) } });
      } catch (e) {
        console.error(e);
      }
      // (Drawn roughly while moving: drawn afresh once the view rests, as the main picture is.)
      if (moving && s.compareRenderer.lastApproximate) { window.clearTimeout(mo.timer); mo.timer = window.setTimeout(() => force((n) => n + 1), SETTLE_MS + 4); }
      const x = Math.round((frame.x + Math.max(0, Math.min(1, s.compare.split)) * frame.w) * dpr);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cmpCanvas as unknown as CanvasImageSource, x, 0, c.width - x, c.height, x, 0, c.width - x, c.height);
      // The line, its handle, and the two dates.
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(x - Math.round(dpr), 0, Math.max(2, Math.round(2 * dpr)), c.height);
      ctx.beginPath(); ctx.arc(x, c.height / 2, 9 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#10161d'; ctx.font = `bold ${11 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⇔', x, c.height / 2);
      ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
      const tag = (text: string, tx: number, align: CanvasTextAlign) => {
        ctx.textAlign = align;
        const w = ctx.measureText(text).width + 14 * dpr;
        const bx = align === 'right' ? tx - w : tx;
        ctx.fillStyle = 'rgba(10,16,24,0.78)'; ctx.fillRect(bx, 8 * dpr, w, 22 * dpr);
        ctx.fillStyle = '#ffd166'; ctx.fillText(text, align === 'right' ? tx - 7 * dpr : tx + 7 * dpr, 19 * dpr);
      };
      tag(gregorian.format(s.time, 'day'), x - 8 * dpr, 'right');
      tag(gregorian.format(s.compare.time, 'day'), x + 8 * dpr, 'left');
      ctx.restore();
    }
    drawEditingOverlay(ctx, view);
  });

  function drawEditingOverlay(ctx: CanvasRenderingContext2D, v: View) {
    const w = s.world!, arr = w.arrangement(s.spaceId);
    // The chosen area, line or point is outlined (where the last frame drew it).
    if (s.selection?.kind === 'feature') {
      const id = s.selection.id;
      const drawn = s.renderer.lastFeatures.filter((f) => f.id === id);
      if (drawn.length) {
        ctx.save();
        if (v.rotation) { ctx.translate(v.width / 2, v.height / 2); ctx.rotate((v.rotation * Math.PI) / 180); ctx.translate(-v.width / 2, -v.height / 2); }
        ctx.strokeStyle = '#ffd166'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const f of drawn) {
          if (f.kind === 'point') { ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 5, 0, Math.PI * 2); ctx.stroke(); continue; }
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          for (const l of f.lines) { ctx.beginPath(); ctx.moveTo(l[0], l[1]); for (let i = 2; i + 1 < l.length; i += 2) ctx.lineTo(l[i], l[i + 1]); ctx.stroke(); }
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }
    // "Changes over time": the country lightly, what it gained (green) and lost (red) in the period strongly.
    const selEnt = s.selection?.kind === 'entity' ? w.get('entity', s.selection.id) : null;
    if (s.historyView.on && selEnt && (selEnt.type_id === 'polity' || selEnt.type_id === 'faction') && s.layerId) {
      const pc = periodChangesNow(w, s.engine!, s.spaceId, s.layerId, selEnt.id);
      ctx.save();
      s.renderer.withFaces(ctx, v, arr, pc.held, (held, px) => {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(held, 'evenodd');
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2 * px; ctx.setLineDash([4 * px, 4 * px]); ctx.stroke(held);
      });
      for (const [faces, color] of [[pc.gained, GAINED_COLOR], [pc.lost, LOST_COLOR]] as const) {
        s.renderer.withFaces(ctx, v, arr, faces, (p, px) => {
          ctx.globalAlpha = 0.5; ctx.fillStyle = color; ctx.fill(p, 'evenodd');
          ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2.5 * px; ctx.stroke(p);
        });
      }
      ctx.restore();
    } else
    // Selected owner: outline its territory at the current date.
    if (s.selection?.kind === 'entity' && s.layerId) {
      const states = s.engine!.partitionState(s.spaceId, s.layerId, s.time);
      const id = s.selection.id;
      const faces: number[] = [];
      for (const [f, st] of states) if (st.value === id) faces.push(f);
      s.renderer.withFaces(ctx, v, arr, faces, (p, px) => { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.stroke(p); });
    }
    // Selected character: its route through its places (dashed), each place a small ring.
    if (s.selection?.kind === 'entity' && w.get('entity', s.selection.id)?.type_id === 'character') {
      const track = s.engine!.characterTrack(s.spaceId, s.selection.id);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1], b = track[i];
        if (a.off || b.off || b.arrive !== 'travel') continue;
        ctx.beginPath();
        for (let k = 0; k <= 32; k++) {
          const [lon, lat] = slerpLonLat(a.lon, a.lat, b.lon, b.lat, k / 32);
          const q = lonLatToScreen(v, lon, lat);
          if (!q) continue;
          if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const wp of track) {
        if (wp.off) continue;
        const q = lonLatToScreen(v, wp.lon, wp.lat);
        if (q) { ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.restore();
    }
    // A stroke of the sculpting brush, as wide as the brush (D98).
    if (drag.current.kind === 'sculpt') {
      const pts = drag.current.points.map((q) => lonLatToScreen(v, q[0], q[1])).filter((q): q is Pt => !!q);
      const sp = s.world?.get('map_space', s.spaceId);
      const px = Math.max(2, (s.sculpt.radiusKm / ((sp?.radius_m ?? 6371008.8) / 1000)) / radiansPerPixel(v));
      if (pts.length) {
        ctx.save(); ctx.strokeStyle = 'rgba(255, 214, 102, 0.35)'; ctx.lineWidth = 2 * px; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); ctx.stroke();
        const last = pts[pts.length - 1];
        ctx.beginPath(); ctx.arc(last[0], last[1], px, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255, 214, 102, 0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
    }
    // The border eraser's stroke.
    if (drag.current.kind === 'erase') {
      const pts = drag.current.points.map((q) => lonLatToScreen(v, q[0], q[1])).filter((q): q is Pt => !!q);
      if (pts.length > 1) {
        ctx.save(); ctx.strokeStyle = 'rgba(255,107,107,0.9)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.5;
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke(); ctx.restore();
      }
    }
    // A character being dragged: where it will go.
    if (drag.current.kind === 'character' && cursor) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cursor[0], cursor[1], 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.stroke();
      ctx.restore();
    }
    if (s.selection?.kind === 'point') {
      const p = lonLatToScreen(v, s.selection.lon, s.selection.lat);
      if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    if (s.tool === 'vertex') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      let n = 0;
      // Only points in the part of the planet in view are worked out on screen (a map with a
      // hundred thousand border points took 20 ms a frame to find the few hundred in view).
      const vb = visibleBounds(v);
      const mid = vb ? (vb.west + vb.east) / 2 : 0, half = vb ? (vb.east - vb.west) / 2 : 0;
      const onBorder = bordersNow().vertices;
      for (const vr of arr.vertices.values()) {
        if (!onBorder.has(vr.id)) continue;
        const lon = vr.lon / E7, lat = vr.lat / E7;
        if (vb && (lat < vb.south || lat > vb.north || Math.abs(((((lon - mid) % 360) + 540) % 360) - 180) > half)) continue;
        const p = lonLatToScreen(v, lon, lat);
        if (!p || p[0] < -5 || p[1] < -5 || p[0] > v.width + 5 || p[1] > v.height + 5) continue;
        if (++n > 6000) break;
        ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
      }
      const hv = drag.current.kind === 'vertex' ? drag.current.vid : hoverVertex;
      if (hv !== null && arr.vertices.has(hv)) {
        const r = arr.vertices.get(hv)!;
        let p = lonLatToScreen(v, r.lon / E7, r.lat / E7);
        if (drag.current.kind === 'vertex' && cursor) p = cursor;
        if (p) {
          ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
          ctx.strokeRect(p[0] - 5, p[1] - 5, 10, 10);
          if (drag.current.kind === 'vertex') {
            for (const sid of arr.segments.values()) {
              if (sid.a !== hv && sid.b !== hv) continue;
              const o = arr.vertices.get(sid.a === hv ? sid.b : sid.a)!;
              const q = lonLatToScreen(v, o.lon / E7, o.lat / E7);
              if (q) { ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(p[0], p[1]); ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); }
            }
          }
        }
      }
    }
    const toScreen = (ll: Pt[]) => ll.map((q) => lonLatToScreen(v, q[0], q[1])).filter((q): q is Pt => !!q);
    // The border pen's current draft: its line, where it started (it closes there) and where it ends.
    const draft = s.tool === 'pen' ? s.draft : null;
    if (draft && draft.spaceId === s.spaceId && draft.points.length) {
      const pts = toScreen(draft.points);
      const owner = draft.owner ? w.get('entity', draft.owner) : null;
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = owner?.color ?? '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
      // How it will close: a dashed line from the end back to the start.
      if (pts.length > 2) { ctx.setLineDash([5, 5]); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); ctx.lineTo(pts[0][0], pts[0][1]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 5, 0, Math.PI * 2); ctx.fill();
      const end = pts[pts.length - 1];
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(end[0], end[1], 4, 0, Math.PI * 2); ctx.fill();
      if (cursor && drag.current.kind !== 'pen') { ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(end[0], end[1]); ctx.lineTo(cursor[0], cursor[1]); ctx.stroke(); }
      ctx.restore();
    }
    // The region picker: the chosen regions filled lightly, the one under the pointer outlined, the box being dragged.
    if (s.tool === 'regions') {
      const ix = regionIndex(s.regionLevel);
      const outline = (i: number) => {
        ctx.beginPath();
        for (const poly of ix!.regions[i].polygons) for (const r of poly) {
          let open = false;
          for (const [lon, lat] of r) { const q = lonLatToScreen(v, lon, lat); if (!q) { open = false; continue; } if (open) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); open = true; } }
          ctx.closePath();
        }
      };
      if (ix) {
        ctx.save();
        ctx.lineJoin = 'round';
        for (const i of s.regionPicks) { if (!ix.regions[i]) continue; outline(i); ctx.fillStyle = 'rgba(255,209,102,0.28)'; ctx.fill('evenodd'); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.stroke(); }
        const h = hoverRegion.current;
        if (h !== null && ix.regions[h]) {
          outline(h); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
          const a = lonLatToScreen(v, ix.anchors[h][0], ix.anchors[h][1]);
          if (a) {
            const label = ix.regions[h].name === ix.regions[h].country ? ix.regions[h].name : `${ix.regions[h].name} (${ix.regions[h].country})`;
            ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,16,24,0.85)'; ctx.strokeText(label, a[0], a[1]); ctx.fillStyle = '#fff'; ctx.fillText(label, a[0], a[1]);
          }
        }
        ctx.restore();
      }
      const d = drag.current;
      if (d.kind === 'pickbox' && d.moved >= 4) {
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5;
        ctx.strokeRect(Math.min(d.x, d.cx), Math.min(d.y, d.cy), Math.abs(d.cx - d.x), Math.abs(d.cy - d.y));
        ctx.restore();
      }
    }
    // The Split tool's line: being drawn, or waiting for the click on the part that changes hands.
    const cutLine = drag.current.kind === 'cut' && drag.current.moved >= 4 ? toScreen(drag.current.points) : s.tool === 'split' && s.splitLine ? toScreen(s.splitLine) : null;
    if (cutLine && cutLine.length > 1) {
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(10,16,24,0.8)'; ctx.lineWidth = 5;
      ctx.beginPath(); cutLine.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.restore();
    }
    const featureLayer = s.tool === 'feature' ? w.get('layer', s.featureLayerId) : null;
    const pts = drag.current.kind === 'lasso' || drag.current.kind === 'feature' ? toScreen(drag.current.points) : polygon.length ? [...toScreen(polygon), ...(cursor ? [cursor] : [])] : null;
    if (pts && pts.length > 1 && featureLayer?.kind === 'line') {
      // A line being drawn: open, in a light colour.
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5;
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
      ctx.restore();
      if (polygon.length) for (const q of toScreen(polygon)) { ctx.fillStyle = '#fff'; ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6); }
    } else if (pts && pts.length > 1) {
      const owner = s.paintValue ? w.get('entity', s.paintValue) : null;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fillStyle = (owner?.color ?? '#ffffff') + '55';
      ctx.fill();
      ctx.strokeStyle = owner?.color ?? '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      if (polygon.length) for (const p of toScreen(polygon)) { ctx.fillStyle = '#fff'; ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6); }
    }
  }

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left - frame.x, e.clientY - r.top - frame.y];
  };

  function finishShape(screenRings: Pt[][], originScreen: Pt) {
    const w = store.world!;
    const rings: ReturnType<typeof lonLatToVec>[][] = [];
    for (const r of screenRings) {
      const ll = r.map((p) => screenToLonLat(view, p[0], p[1]));
      if (ll.some((x) => !x)) { store.toast('Part of the shape is outside the map. Draw inside the map area.', 'error'); return; }
      rings.push((ll as [number, number][]).map(([lo, la]) => lonLatToVec(lo, la)));
    }
    if (!rings.length) { store.toast('The shape is too small. Zoom in or draw a larger area.', 'error'); return; }
    const origin = screenToLonLat(view, originScreen[0], originScreen[1]) ?? [0, 0];
    const sample = interiorSample(screenRings[0]);
    const sampleLL = sample ? screenToLonLat(view, sample[0], sample[1]) : null;
    const layerId = store.layerId;
    if (!layerId) { store.toast('This map has no political layer to draw on.', 'error'); return; }
    if (store.recordEventId) {
      const ev = w.get('event', store.recordEventId);
      if (!ev) return;
      const start = fromStore(ev.start_day, ev.start_ms);
      const at = compare(store.time, start) > 0 ? store.time : null;
      // As long as the recording bar says (D86); an expansion spreads from where the drawing began.
      const transition = recordTransition(store.recordLength, origin);
      store.execute((world, engine) => cmd.paintTerritory(world, engine, {
        spaceId: store.spaceId, layerId, rings, value: store.paintValue, snap: snapRadians(), mode: { kind: 'new', eventId: ev.id, at }, transition,
      }));
      return;
    }
    store.set({ pending: { kind: 'paint', spaceId: store.spaceId, layerId, rings, value: store.paintValue, sample: sampleLL, origin, snap: snapRadians() } });
  }

  const snapRadians = () => Math.max(5e-9, 4 * radiansPerPixel(view));

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!s.world) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    // Comparing two dates: the line between them is picked up (a few pixels either side).
    if (!presentation && e.button === 0 && s.compare.on && Math.abs(p[0] - s.compare.split * frame.w) <= 8) { drag.current = { kind: 'swipe' }; return; }
    // In the shot preview, a text or the events box under the pointer is picked up and moved.
    if (presentation && e.button === 0) {
      const hit = overlayAt(p);
      if (hit) { drag.current = { kind: 'overlay', id: hit.id, x: p[0], y: p[1], from: { x: hit.x / frame.w, y: hit.y / frame.h } }; return; }
    }
    // Another starting point for an expansion (D91), chosen in the event's panel: this click is it.
    if (!presentation && e.button === 0 && s.pickOrigin) {
      const ll = screenToLonLat(view, p[0], p[1]);
      const id = s.pickOrigin;
      store.set({ pickOrigin: null });
      if (ll) store.execute((wd) => cmd.addTransitionOrigin(wd, id, [ll[0], ll[1]]));
      return;
    }
    // Sculpting (D98): a stroke of the brush (a click for a crater or an island).
    if (!presentation && e.button === 0 && s.tool === 'sculpt') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll) { drag.current = { kind: 'sculpt', points: [ll] }; force((n) => n + 1); }
      return;
    }
    // Border eraser: a stroke across borders.
    if (!presentation && e.button === 0 && s.tool === 'erase') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll) { drag.current = { kind: 'erase', points: [ll] }; force((n) => n + 1); }
      return;
    }
    // Regions: a click toggles the region under it; a drag draws a box around several.
    if (!presentation && e.button === 0 && s.tool === 'regions') {
      drag.current = { kind: 'pickbox', x: p[0], y: p[1], cx: p[0], cy: p[1], moved: 0 };
      return;
    }
    // Split: a drag draws the line across a country; then a click chooses the part that changes hands.
    if (!presentation && e.button === 0 && s.tool === 'split') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll) { drag.current = { kind: 'cut', points: [ll], x: p[0], y: p[1], moved: 0 }; force((n) => n + 1); }
      return;
    }
    // Areas, lines and points: a click puts a point; a drag draws an area or line freehand; or click by click.
    if (!presentation && e.button === 0 && s.tool === 'feature') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) return;
      const layer = s.world.get('layer', s.featureLayerId);
      if (!layer || !isFeatureKind(layer.kind)) { store.toast('Choose or make a layer of areas, lines or points first.', 'error'); return; }
      if (layer.kind === 'point') { finishFeatureDrawing(layer.id, [[ll]]); return; }
      if (s.featureDraw === 'clicks') { setPolygon((poly) => [...poly, ll]); return; }
      drag.current = { kind: 'feature', points: [ll] };
      force((n) => n + 1);
      return;
    }
    // Characters tool: a click puts the chosen character here, from the date being viewed.
    if (!presentation && e.button === 0 && s.tool === 'place') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) return;
      if (!s.placeValue) { store.toast('Choose the character to place first.', 'error'); return; }
      const who = s.placeValue;
      store.execute((wd) => cmd.placeCharacter(wd, { spaceId: s.spaceId, entity: who, lon: ll[0], lat: ll[1], mode: placementMode() }));
      store.set({ selection: { kind: 'entity', id: who } });
      return;
    }
    // Select tool: a character's marker is picked up (dragged to move it, clicked to select it).
    if (!presentation && e.button === 0 && s.tool === 'select') {
      const hit = [...s.renderer.lastCharacters, ...s.renderer.lastCities].find((c) => { const q = lonLatToScreen(view, c.lon, c.lat); return !!q && Math.hypot(q[0] - p[0], q[1] - p[1]) <= Math.max(11, 'r' in c ? (c.r as number) * view.unit : 0); });
      if (hit) { drag.current = { kind: 'character', entity: hit.entity, from: p, moved: 0 }; setCursor(p); return; }
    }
    const wantsPan = e.button === 1 || e.button === 2 || presentation || s.tool === 'select' || (e as unknown as KeyboardEvent).shiftKey;
    if (!presentation && e.button === 0 && s.tool === 'vertex') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll) {
        const on = bordersNow().vertices;
        const vid = s.world.arrangement(s.spaceId).nearestVertex(lonLatToVec(ll[0], ll[1]), 8 * radiansPerPixel(view), (id) => !on.has(id));
        if (vid !== null) { drag.current = { kind: 'vertex', vid, x: p[0], y: p[1], moved: 0 }; setCursor(p); return; }
      }
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, moved: 0, startX: p[0], startY: p[1] };
      return;
    }
    if (!presentation && e.button === 0 && s.tool === 'pen') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) return;
      drag.current = { kind: 'pen' };
      store.penAdd(ll, true); // a new piece, joined straight to where the draft ended
      return;
    }
    if (!presentation && e.button === 0 && (s.tool === 'lasso' || s.tool === 'polygon')) {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) return; // outside the map
      if (s.tool === 'lasso') { drag.current = { kind: 'lasso', points: [ll] }; force((n) => n + 1); }
      else setPolygon((poly) => [...poly, ll]);
      return;
    }
    if (wantsPan) drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, moved: 0, startX: p[0], startY: p[1] };
  }

  /** The text or events box drawn under a point of the frame (the topmost), if any. */
  function overlayAt(p: Pt): OverlayRect | null {
    for (let i = overlayRects.length - 1; i >= 0; i--) {
      const r = overlayRects[i];
      if (p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h) return r;
    }
    return null;
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = local(e);
    const d = drag.current;
    if (d.kind === 'swipe') { store.setLive({ compare: { ...store.compare, split: Math.max(0.02, Math.min(0.98, p[0] / frame.w)) } }); return; }
    if (d.kind === 'overlay') {
      store.setLive({ presentOverlay: { id: d.id, dx: (p[0] - d.x) / frame.w, dy: (p[1] - d.y) / frame.h, from: d.from } });
      return;
    }
    // (Moved once the pointer is a few pixels from where it went down, however few movements were reported.)
    if (d.kind === 'character') { d.moved = Math.max(d.moved, Math.hypot(p[0] - d.from[0], p[1] - d.from[1])); setCursor(p); return; }
    if (d.kind === 'pickbox') { d.cx = p[0]; d.cy = p[1]; d.moved = Math.max(d.moved, Math.hypot(p[0] - d.x, p[1] - d.y)); force((n) => n + 1); return; }
    if (d.kind === 'none' && s.tool === 'regions' && !presentation) {
      const ix = regionIndex(store.regionLevel), ll = screenToLonLat(view, p[0], p[1]);
      const r = ix && ll ? ix.at(ll[0], ll[1]) : null;
      if (r !== hoverRegion.current) { hoverRegion.current = r; force((n) => n + 1); }
    }
    if (d.kind === 'cut') d.moved = Math.max(d.moved, Math.hypot(p[0] - d.x, p[1] - d.y));
    if (d.kind === 'erase' || d.kind === 'feature' || d.kind === 'cut' || d.kind === 'sculpt') {
      const ll = screenToLonLat(view, p[0], p[1]);
      const last = d.points[d.points.length - 1];
      const ls = lonLatToScreen(view, last[0], last[1]);
      if (ll && (!ls || Math.hypot(p[0] - ls[0], p[1] - ls[1]) > 2)) { d.points.push(ll); force((n) => n + 1); }
      return;
    }
    if (presentation && d.kind === 'none') {
      const over = !!overlayAt(p);
      if (over !== overOverlay) setOverOverlay(over);
    }
    if (!presentation && d.kind === 'none') {
      const over = s.compare.on && Math.abs(p[0] - s.compare.split * frame.w) <= 8;
      if (over !== overSplit) setOverSplit(over);
    }
    if (d.kind === 'pan') {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      const next = panCamera(camera, view, dx, dy);
      if (shot) store.setLive({ presentCamera: next }); else store.setCamera(next);
      return;
    }
    if (d.kind === 'lasso') {
      const last = d.points[d.points.length - 1];
      const lastScreen = lonLatToScreen(view, last[0], last[1]);
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll && (!lastScreen || Math.hypot(p[0] - lastScreen[0], p[1] - lastScreen[1]) > 2)) { d.points.push(ll); force((n) => n + 1); }
      return;
    }
    if (d.kind === 'vertex') { d.moved = Math.max(d.moved, Math.hypot(p[0] - d.x, p[1] - d.y)); setCursor(p); return; }
    if (d.kind === 'pen') {
      const pts = store.draft?.points ?? [];
      const last = pts[pts.length - 1];
      const lastScreen = last ? lonLatToScreen(view, last[0], last[1]) : null;
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll && (!lastScreen || Math.hypot(p[0] - lastScreen[0], p[1] - lastScreen[1]) > 2)) store.penAdd(ll, false);
      return;
    }
    if (s.tool === 'pen' && !presentation) setCursor(p);
    if (polygon.length) setCursor(p);
    if (s.tool === 'vertex' && s.world && !presentation) {
      const ll = screenToLonLat(view, p[0], p[1]);
      const on = bordersNow().vertices;
      const vid = ll ? s.world.arrangement(s.spaceId).nearestVertex(lonLatToVec(ll[0], ll[1]), 8 * radiansPerPixel(view), (id) => !on.has(id)) : null;
      if (vid !== hoverVertex) setHoverVertex(vid);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    drag.current = { kind: 'none' };
    const p = local(e);
    // Framing the shot: the view dragged to becomes the shot's camera (still for the whole shot).
    if (presentation && d.kind === 'pan') { if (d.moved >= 1) commitShotCamera(); return; }
    if (d.kind === 'erase') { eraseBorders(d.points, view); force((n) => n + 1); return; }
    if (d.kind === 'sculpt') { sculptStroke(d.points); force((n) => n + 1); return; }
    // A character dropped: it is there from the date being viewed (a click just selects it).
    if (d.kind === 'character') {
      setCursor(null);
      const ll = Math.max(d.moved, Math.hypot(p[0] - d.from[0], p[1] - d.from[1])) > 4 ? screenToLonLat(view, p[0], p[1]) : null;
      if (ll) store.execute((wd) => cmd.placeCharacter(wd, { spaceId: store.spaceId, entity: d.entity, lon: ll[0], lat: ll[1], mode: placementMode() }));
      store.set({ selection: { kind: 'entity', id: d.entity } });
      return;
    }
    // A text or the events box dropped where it was dragged (one undo step).
    if (d.kind === 'overlay') {
      const o = store.presentOverlay, sh = currentShot(), id = store.shotId;
      store.set({ presentOverlay: null });
      if (o && sh && id && (Math.abs(o.dx) > 1e-4 || Math.abs(o.dy) > 1e-4)) store.execute((w) => cmd.updateSequence(w, id, { settings: moveOverlay(sh, o.id, o.dx, o.dy, o.from) }));
      return;
    }
    // A right-click (without dragging) deselects everything.
    if (d.kind === 'pan' && d.moved < 4 && !presentation && e.button === 2) { store.set({ selection: null }); return; }
    if (d.kind === 'pan' && d.moved < 4 && !presentation && e.button === 0) {
      // An area, line or point under the pointer is chosen (the topmost drawn).
      const [ux, uy] = rotatePoint(d.startX, d.startY, view.width / 2, view.height / 2, -view.rotation);
      const hitFeature = s.tool === 'select' ? store.renderer.featureAt(ux, uy) : null;
      if (hitFeature) { store.set({ selection: { kind: 'feature', id: hitFeature } }); return; }
      const ll = screenToLonLat(view, d.startX, d.startY);
      if (ll) store.set({ selection: { kind: 'point', lon: ll[0], lat: ll[1] } });
      return;
    }
    if (d.kind === 'pen') return; // the draft is saved; carry on whenever you like
    if (d.kind === 'pickbox') {
      force((n) => n + 1);
      const ix = regionIndex(store.regionLevel);
      if (!ix) return;
      const picks = new Set(store.regionPicks);
      if (d.moved < 4) {
        // A click: the region under it is chosen, or left out again.
        const ll = screenToLonLat(view, d.x, d.y);
        const r = ll ? ix.at(ll[0], ll[1]) : null;
        if (r === null) return;
        if (picks.has(r)) picks.delete(r); else picks.add(r);
      } else {
        // A box: every region whose middle is inside it.
        const x0 = Math.min(d.x, d.cx), x1 = Math.max(d.x, d.cx), y0 = Math.min(d.y, d.cy), y1 = Math.max(d.y, d.cy);
        ix.anchors.forEach((a, i) => { const q = lonLatToScreen(view, a[0], a[1]); if (q && q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) picks.add(i); });
      }
      store.set({ regionPicks: [...picks] });
      return;
    }
    if (d.kind === 'cut') {
      force((n) => n + 1);
      // A click with a line waiting: the part clicked changes hands (the question follows).
      if (d.moved < 4) {
        const line = store.splitLine;
        if (!line) { store.toast('Drag a line right across the country first.'); return; }
        if (!store.layerId) { store.toast('This map has no political layer to split.', 'error'); return; }
        store.set({ pending: { kind: 'split', spaceId: store.spaceId, layerId: store.layerId, line, pick: d.points[0], snap: snapRadians() } });
        return;
      }
      // A line: cleaned up at the current zoom, as a feature line is; it waits for the click.
      const screen = d.points.map((q) => lonLatToScreen(view, q[0], q[1])).filter((q): q is Pt => !!q);
      const clean = simplify(smooth(dedupe(screen, 1), Math.min(2, store.stroke.smoothness), false), 0.6);
      const line = clean.map((q) => screenToLonLat(view, q[0], q[1])).filter((q): q is [number, number] => !!q);
      if (line.length < 2) return;
      store.set({ splitLine: line });
      return;
    }
    if (d.kind === 'feature') {
      // Cleaned up at the current zoom (as the brush is): an area as one or more rings, a line as one line.
      const layer = store.world!.get('layer', store.featureLayerId);
      const screen = d.points.map((q) => lonLatToScreen(view, q[0], q[1])).filter((q): q is Pt => !!q);
      force((n) => n + 1);
      if (!layer || screen.length < 2) return;
      const back = (pts: Pt[]) => pts.map((q) => screenToLonLat(view, q[0], q[1])).filter((q): q is [number, number] => !!q);
      if (layer.kind === 'area') {
        if (screen.length < 4) return;
        const loops = processLasso(screen, store.stroke);
        const parts = loops.map(back).filter((r) => r.length >= 3);
        if (!parts.length) { store.toast('The shape is too small. Zoom in or draw a larger area.', 'error'); return; }
        finishFeatureDrawing(layer.id, parts);
      } else {
        const line = simplify(smooth(dedupe(screen, 1), Math.min(2, store.stroke.smoothness), false), 0.6);
        if (line.length < 2 || Math.hypot(line[line.length - 1][0] - line[0][0], line[line.length - 1][1] - line[0][1]) < 3) return;
        finishFeatureDrawing(layer.id, [back(line)]);
      }
      return;
    }
    if (d.kind === 'lasso') {
      // Cleaned up at the current zoom, so smoothing and detail match what is on screen now.
      const screen = d.points.map((q) => lonLatToScreen(view, q[0], q[1])).filter((q): q is Pt => !!q);
      if (screen.length < 4) { force((n) => n + 1); return; }
      const loops = processLasso(screen, store.stroke);
      finishShape(loops, screen[0]);
      force((n) => n + 1);
      return;
    }
    if (d.kind === 'vertex') {
      setCursor(null);
      if (Math.max(d.moved, Math.hypot(p[0] - d.x, p[1] - d.y)) < 3) { setHoverVertex(d.vid); return; }
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) { store.toast('That is outside the map.', 'error'); return; }
      const to = lonLatToVec(ll[0], ll[1]);
      // (A move for all time that would cross a border is refused; a move from a date may still do.)
      const check = store.world!.arrangement(store.spaceId).canMoveVertex(d.vid, to, snapRadians());
      store.set({ pending: { kind: 'vertex', spaceId: store.spaceId, vertexId: d.vid, to, layerId: store.layerId, blocked: check.ok ? null : check.reason } });
    }
  }

  /** Close the current border-pen draft into an area and ask what it means (as for the brush). */
  function finishDraft() {
    const d = store.draft;
    if (!d) return;
    const ring = ringFromMapPoints(d.points);
    if (!ring) { store.toast('Draw at least three points before finishing the border.', 'error'); return; }
    const layerId = store.layerId;
    if (!layerId) { store.toast('This map has no political layer to draw on.', 'error'); return; }
    if (d.spaceId !== store.spaceId) { store.toast('This draft belongs to another map.', 'error'); return; }
    const c = geoCentroid({ type: 'Polygon', coordinates: [[...d.points, d.points[0]]] }) as [number, number];
    store.set({ pending: { kind: 'paint', spaceId: store.spaceId, layerId, rings: [ring], value: d.owner, sample: Number.isFinite(c[0]) ? c : null, origin: d.points[0], snap: snapRadians(), draftId: d.id } });
  }
  store.finishDraft = finishDraft;

  function finishPolygon() {
    if (store.tool === 'feature') {
      const layer = store.world!.get('layer', store.featureLayerId);
      const need = layer?.kind === 'area' ? 3 : 2;
      const pts = dedupe(polygon.map((q) => lonLatToScreen(view, q[0], q[1])).filter((q): q is Pt => !!q), 1);
      setPolygon([]);
      setCursor(null);
      if (!layer || pts.length < need) return;
      finishFeatureDrawing(layer.id, [pts.map((q) => screenToLonLat(view, q[0], q[1])).filter((q): q is [number, number] => !!q)]);
      return;
    }
    // A double-click to finish also places its point twice; repeated points are dropped.
    const pts = dedupe(polygon.map((q) => lonLatToScreen(view, q[0], q[1])).filter((q): q is Pt => !!q), 1);
    if (pts.length < 3) { setPolygon([]); setCursor(null); return; }
    const loops = splitLoops(pts).map(orientInteriorLeft).map((r) => densify(r, 6, true));
    finishShape(loops, pts[0]);
    setPolygon([]);
    setCursor(null);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = local(e);
    if (e.altKey && !presentation) { store.setCamera({ ...camera, rotation: (camera.rotation + (e.deltaY > 0 ? 3 : -3)) % 360 }); return; }
    // (Worked out on the map as it is shown; the meridian held meanwhile is the view's, not the camera's.)
    const { meridian: _held, ...next } = zoomCameraAt(viewCamera, frame.w, frame.h, p[0], p[1], -e.deltaY / 400);
    if (shot) {
      store.setLive({ presentCamera: next });
      // Stored once the wheel has been still for a moment (one undo step per zoom gesture).
      clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(commitShotCamera, 350);
    } else store.setCamera(next);
  }

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => onWheel(e);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { setPolygon([]); setCursor(null); drag.current = { kind: 'none' }; if (store.splitLine && !store.pending) store.set({ splitLine: null }); if (store.tool === 'regions' && !store.dialog && store.regionPicks.length) store.set({ regionPicks: [] }); if (store.pickOrigin) store.set({ pickOrigin: null }); force((n) => n + 1); }
      if (e.key === 'Enter' && store.tool === 'regions' && !store.dialog && store.regionPicks.length) store.set({ dialog: 'give-regions' });
      if (e.key === 'Enter' && polygon.length) finishPolygon();
      if (e.key === 'Enter' && store.tool === 'pen' && !store.pending) finishDraft();
      if ((e.key === 'Backspace' || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey))) && store.tool === 'pen' && store.draft?.pieces.length) {
        e.preventDefault(); e.stopImmediatePropagation(); store.penUndoPiece();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.tool === 'vertex' && hoverVertex !== null && !presentation) {
        const vid = hoverVertex;
        setHoverVertex(null);
        store.execute((w, en) => cmd.removeBorderVertex(w, { spaceId: store.spaceId, vertexId: vid, guard: store.layerId ? { engine: en, layerId: store.layerId, t: store.time } : undefined }));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (presentation) return;
    if (s.tool === 'polygon' || (s.tool === 'feature' && polygon.length)) { finishPolygon(); return; }
    if (s.tool === 'vertex' && s.world) {
      const p = local(e);
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) return;
      const at = lonLatToVec(ll[0], ll[1]);
      const on = bordersNow().segments;
      const seg = s.world.arrangement(s.spaceId).nearestSegment(at, 8 * radiansPerPixel(view), (id) => !on.has(id));
      if (seg) store.execute((w) => cmd.insertBorderVertex(w, { spaceId: store.spaceId, segmentId: seg.s.id, at }));
    }
  }

  const cursorStyle = drag.current.kind === 'swipe' || (overSplit && s.compare.on && !presentation) ? 'ew-resize' : presentation ? (drag.current.kind === 'overlay' || overOverlay ? 'move' : 'grab') : s.tool === 'select' ? 'grab' : s.tool === 'vertex' ? (hoverVertex !== null ? 'move' : 'default') : 'crosshair';
  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        style={{ width: size.w, height: size.h, cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="map-canvas"
      />
      {!presentation && <MapHud view={view} />}
      {s.viewSettings.showSpeed && <div className="draw-speed" ref={speedRef} title="How long the map took to draw (the working view only)" data-testid="draw-speed" />}
    </div>
  );
}

function MapHud({ view }: { view: View }) {
  const s = useLive();
  const radius = s.world?.get('map_space', s.spaceId)?.radius_m ?? 6371000;
  const kmPerPx = (radius / 1000) * radiansPerPixel(view);
  const target = kmPerPx * 120;
  const nice = [1, 2, 5].flatMap((m) => [0.01, 0.1, 1, 10, 100, 1000, 10000].map((e) => m * e)).sort((a, b) => a - b).filter((x) => x <= target).pop() ?? target;
  return (
    <div className="map-hud">
      <div className="scalebar"><div style={{ width: `${nice / kmPerPx}px` }} /><span>{nice >= 1 ? `${nice.toLocaleString()} km` : `${(nice * 1000).toFixed(0)} m`}</span></div>
      <div className="hud-buttons">
        <button title="Zoom in" onClick={() => s.setCamera({ ...s.camera, zoom: s.camera.zoom + 0.5 })}>+</button>
        <button title="Zoom out" onClick={() => s.setCamera({ ...s.camera, zoom: s.camera.zoom - 0.5 })}>−</button>
        <button title="Whole map" onClick={() => s.setCamera({ ...s.camera, lon: 0, lat: 0, zoom: 0, rotation: 0 })}>⌂</button>
      </div>
    </div>
  );
}

/** A point inside a screen polygon (centroid when inside, otherwise a nearby interior point). */
function interiorSample(r: Pt[]): Pt | null {
  if (r.length < 3) return null;
  const a = signedArea(r);
  let cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  const c: Pt = [cx / (6 * a), cy / (6 * a)];
  if (pointIn(r, c)) return c;
  for (let i = 0; i < r.length; i++) {
    const m: Pt = [(r[i][0] + r[(i + 1) % r.length][0]) / 2, (r[i][1] + r[(i + 1) % r.length][1]) / 2];
    for (const t of [0.1, 0.3, 0.5]) {
      const q: Pt = [m[0] + (c[0] - m[0]) * t, m[1] + (c[1] - m[1]) * t];
      if (pointIn(r, q)) return q;
    }
  }
  return null;
}

function pointIn(r: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

