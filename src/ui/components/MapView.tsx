import { useEffect, useRef, useState } from 'react';
import { useStore, store } from '../store.ts';
import {
  makeView, screenToLonLat, lonLatToScreen, panCamera, zoomCameraAt, radiansPerPixel, type View, type Camera,
} from '../../render-engine/camera.ts';
import { DEFAULT_STYLE, type PassName } from '../../render-engine/map-renderer.ts';
import { processLasso, densify, orientInteriorLeft, signedArea, splitLoops, type Pt, dedupe } from '../../render-engine/stroke.ts';
import { lonLatToVec, E7 } from '../../geo-kernel/vec.ts';
import { cameraAt, timeAt, overlaysAt, drawOverlays, type ShotSettings } from '../../presentation/sequence.ts';
import { transitionOptions, drawShotOverlays } from '../../presentation/export-driver.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { compare, fromStore } from '../../core-time/index.ts';
import { basemapSourceOf } from '../../world-model/world-settings.ts';
import { loadBasemapDetail, pixelsPerDegree, DETAIL_PIXELS_PER_DEGREE } from '../../render-engine/basemap.ts';
import * as cmd from '../../domain/commands.ts';

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; x: number; y: number; moved: number; startX: number; startY: number }
  // Brush points are kept as map positions (longitude, latitude), so zooming or panning in the
  // middle of a stroke never changes the shape being drawn.
  | { kind: 'lasso'; points: Pt[] }
  | { kind: 'vertex'; vid: number; x: number; y: number; moved: number };

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

export function MapView() {
  const s = useStore();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<Drag>({ kind: 'none' });
  /** Points of the precise shape being placed, as map positions (longitude, latitude). */
  const [polygon, setPolygon] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hoverVertex, setHoverVertex] = useState<number | null>(null);
  const [, force] = useState(0);
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
  const view: View = makeView(camera, frame.w, frame.h);
  const time = shot ? timeAt(shot, s.shotFrame) : s.time;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !s.world || !s.engine || !s.spaceId) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, frame.x * dpr, frame.y * dpr);
    const layers = s.world.all('layer').filter((l) => l.space_id === s.spaceId && l.kind === 'partition' && (shot ? (shot.layers.length ? shot.layers.includes(l.id) : l.visible) : l.visible)).sort((a, b) => a.sort_order - b.sort_order).map((l) => l.id);
    const passes = new Set<PassName>(['background', 'land', 'fills', 'borders']);
    const basemap = basemapSourceOf(s.world.get('map_space', s.spaceId)) === 'natural-earth' ? s.basemap : null;
    // Close up, load the detailed coastlines (once) and redraw when they arrive.
    if (basemap && pixelsPerDegree(view) > DETAIL_PIXELS_PER_DEGREE && !basemap.scales.some((sc) => sc.scale === '10m')) {
      loadBasemapDetail(basemap).then(() => store.notify(), (e: Error) => store.toast(e.message, 'error'));
    }
    if (!shot || shot.graticule) passes.add('graticule');
    if (!shot || shot.labels) passes.add('labels');
    try {
      s.renderer.render(ctx, view, s.world, s.engine, s.spaceId, time, { passes, transparent: !!shot?.transparent, layerIds: layers, basemap, referenceBorders: !shot && s.referenceBorders, transitions: shot ? transitionOptions(shot, s.shotFrame) : undefined });
    } catch (e) {
      console.error(e);
    }
    if (shot) {
      drawShotOverlays(ctx, frame.w, frame.h, s.world, shot, s.shotFrame, time);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(frame.x - 0.5, frame.y - 0.5, frame.w + 1, frame.h + 1);
      return;
    }
    drawEditingOverlay(ctx, view);
  });

  function drawEditingOverlay(ctx: CanvasRenderingContext2D, v: View) {
    const w = s.world!, arr = w.arrangement(s.spaceId);
    // Selected owner: outline its territory at the current date.
    if (s.selection?.kind === 'entity' && s.layerId) {
      const states = s.engine!.partitionState(s.spaceId, s.layerId, s.time);
      const p = new Path2D();
      let any = false;
      for (const [f, st] of states) if (st.value === s.selection.id) { p.addPath(s.renderer.facePath(v, arr, f)); any = true; }
      if (any) { ctx.save(); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.stroke(p); ctx.restore(); }
    }
    if (s.selection?.kind === 'point') {
      const p = lonLatToScreen(v, s.selection.lon, s.selection.lat);
      if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    if (s.tool === 'vertex') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      let n = 0;
      for (const vr of arr.vertices.values()) {
        const p = lonLatToScreen(v, vr.lon / E7, vr.lat / E7);
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
    const pts = drag.current.kind === 'lasso' ? toScreen(drag.current.points) : polygon.length ? [...toScreen(polygon), ...(cursor ? [cursor] : [])] : null;
    if (pts && pts.length > 1) {
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
      store.execute((world, engine) => cmd.paintTerritory(world, engine, {
        spaceId: store.spaceId, layerId, rings, value: store.paintValue, snap: snapRadians(), mode: { kind: 'new', eventId: ev.id, at },
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
    const wantsPan = e.button === 1 || e.button === 2 || presentation || s.tool === 'select' || (e as unknown as KeyboardEvent).shiftKey;
    if (!presentation && e.button === 0 && s.tool === 'vertex') {
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll) {
        const vid = s.world.arrangement(s.spaceId).nearestVertex(lonLatToVec(ll[0], ll[1]), 8 * radiansPerPixel(view));
        if (vid !== null) { drag.current = { kind: 'vertex', vid, x: p[0], y: p[1], moved: 0 }; setCursor(p); return; }
      }
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, moved: 0, startX: p[0], startY: p[1] };
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

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = local(e);
    const d = drag.current;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      const next = panCamera(camera, view, dx, dy);
      if (shot) store.set({ presentCamera: next }); else store.setCamera(next);
      return;
    }
    if (d.kind === 'lasso') {
      const last = d.points[d.points.length - 1];
      const lastScreen = lonLatToScreen(view, last[0], last[1]);
      const ll = screenToLonLat(view, p[0], p[1]);
      if (ll && (!lastScreen || Math.hypot(p[0] - lastScreen[0], p[1] - lastScreen[1]) > 2)) { d.points.push(ll); force((n) => n + 1); }
      return;
    }
    if (d.kind === 'vertex') { d.moved += 1; setCursor(p); return; }
    if (polygon.length) setCursor(p);
    if (s.tool === 'vertex' && s.world && !presentation) {
      const ll = screenToLonLat(view, p[0], p[1]);
      const vid = ll ? s.world.arrangement(s.spaceId).nearestVertex(lonLatToVec(ll[0], ll[1]), 8 * radiansPerPixel(view)) : null;
      if (vid !== hoverVertex) setHoverVertex(vid);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    drag.current = { kind: 'none' };
    const p = local(e);
    // A right-click (without dragging) deselects everything.
    if (d.kind === 'pan' && d.moved < 4 && !presentation && e.button === 2) { store.set({ selection: null }); return; }
    if (d.kind === 'pan' && d.moved < 4 && !presentation && e.button === 0) {
      const ll = screenToLonLat(view, d.startX, d.startY);
      if (ll) store.set({ selection: { kind: 'point', lon: ll[0], lat: ll[1] } });
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
      if (d.moved < 2) { setHoverVertex(d.vid); return; }
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) { store.toast('That is outside the map.', 'error'); return; }
      const to = lonLatToVec(ll[0], ll[1]);
      const check = store.world!.arrangement(store.spaceId).canMoveVertex(d.vid, to, snapRadians());
      if (!check.ok) { store.toast(check.reason, 'error'); force((n) => n + 1); return; }
      store.set({ pending: { kind: 'vertex', spaceId: store.spaceId, vertexId: d.vid, to } });
    }
  }

  function finishPolygon() {
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
    const next = zoomCameraAt(camera, frame.w, frame.h, p[0], p[1], -e.deltaY / 400);
    if (shot) store.set({ presentCamera: next }); else store.setCamera(next);
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
      if (e.key === 'Escape') { setPolygon([]); setCursor(null); drag.current = { kind: 'none' }; force((n) => n + 1); }
      if (e.key === 'Enter' && polygon.length) finishPolygon();
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.tool === 'vertex' && hoverVertex !== null && !presentation) {
        const vid = hoverVertex;
        setHoverVertex(null);
        store.execute((w) => cmd.removeBorderVertex(w, { spaceId: store.spaceId, vertexId: vid }));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (presentation) return;
    if (s.tool === 'polygon') { finishPolygon(); return; }
    if (s.tool === 'vertex' && s.world) {
      const p = local(e);
      const ll = screenToLonLat(view, p[0], p[1]);
      if (!ll) return;
      const at = lonLatToVec(ll[0], ll[1]);
      const seg = s.world.arrangement(s.spaceId).nearestSegment(at, 8 * radiansPerPixel(view));
      if (seg) store.execute((w) => cmd.insertBorderVertex(w, { spaceId: store.spaceId, segmentId: seg.s.id, at }));
    }
  }

  const cursorStyle = presentation ? 'grab' : s.tool === 'select' ? 'grab' : s.tool === 'vertex' ? (hoverVertex !== null ? 'move' : 'default') : 'crosshair';
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
    </div>
  );
}

function MapHud({ view }: { view: View }) {
  const s = useStore();
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

