// The view of a space map (Stage 11, D110): the stars in three dimensions. Dragging turns the view
// around what it looks at (Shift or the right button moves that point), the wheel zooms, a click
// chooses a star. In presentation mode it shows the shot's frame, its texts and its look, and
// framing it sets the shot's still camera, as on other maps.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLive, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { makeSpaceView, orbitCamera, panSpaceCamera, turnChart, type SpaceView as View3 } from '../../space/space-view.ts';
import { SpaceRenderer, type DrawnStar } from '../../space/space-renderer.ts';
import { spaceScene } from '../../space/scene.ts';
import { primaryOf as starPrimary, systemOf as starSystem } from '../../space/catalogue.ts';
import { fmt } from './Panels.tsx';
import { spaceSettingsOf } from '../../world-model/world-settings.ts';
import { cameraAt, timeAt, moveOverlay, withStillCamera, screenSecondsSince } from '../../presentation/sequence.ts';
import { drawShotOverlays, lookStyles } from '../../presentation/export-driver.ts';
import { finishLook } from '../../presentation/looks.ts';
import { currentShot, frameRect } from './MapView.tsx';
import { placementMode } from './Characters.tsx';
import { holdingsAt, lanesFor, warsAmong } from '../../space/realms.ts';
import { DEFAULT_SKY } from '../../space/sky-look.ts';
import type { OverlayRect } from '../../presentation/sequence.ts';
import type { Camera } from '../../render-engine/camera.ts';

let shown: { view: View3; frame: { x: number; y: number; w: number; h: number }; stars: DrawnStar[]; names: string[] } | null = null;
let overlayRects: OverlayRect[] = [];
/** Where the stars were last drawn (page-independent: canvas pixels of the frame), for tests. */
export function shownSpace() { return shown; }

/** What a galaxy map shows (D116), for the note on the map. */
function galaxyNote(g: NonNullable<ReturnType<typeof spaceSettingsOf>>['galaxy'] & object, cat: { stars: Array<{ minor?: boolean }> }, ring: string): string {
  const systems = cat.stars.filter((s) => s.minor).length;
  return `${g.kind === 'milkyway' ? 'The Milky Way' : 'A galaxy of your own'} · ${systems.toLocaleString('en-GB')} star systems${g.kind === 'milkyway' ? ` and ${cat.stars.length - systems} places` : ''} · rings every ${ring}`;
}

export function SpaceView() {
  const s = useLive();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef(new SpaceRenderer());
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [, force] = useState(0);
  const drag = useRef<{ kind: 'none' } | { kind: 'orbit' | 'pan'; x: number; y: number; moved: number; start: Camera } | { kind: 'overlay'; id: string; x: number; y: number; from: { x: number; y: number } } | { kind: 'box'; x: number; y: number; cx: number; cy: number }>({ kind: 'none' });
  const wheelTimer = useRef(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(50, el.clientWidth), h: Math.max(50, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const space = s.world?.get('map_space', s.spaceId) ?? null;
  const settings = spaceSettingsOf(space);
  // (The scene depends on the moment shown: the planets move; it is worked out below, once the time is known.)
  const shot = s.mode === 'present' ? currentShot() : null;
  const presentation = !!shot;
  const frame = shot ? frameRect(shot, size.w, size.h) : { x: 0, y: 0, w: size.w, h: size.h };
  const camera: Camera = shot ? (s.presentCamera ?? cameraAt(shot, s.shotFrame)) : s.camera;
  const time = shot ? timeAt(shot, s.shotFrame) : s.time;
  const scene = spaceScene(settings, time, () => force((n) => n + 1));
  const cat = scene.cat;
  // How the map looks (D130), seen as a flat chart or not (D131).
  const look = settings?.look;
  // (Side by side, D133: always flat.)
  const chart = !!look?.chart || !!scene.row;
  const view = makeSpaceView(camera, frame.w, frame.h, scene.radius, chart);
  // Realms and lanes at the moment shown (in a shot, a star newly held grows into its realm).
  // (In a shot, history as the shot's timeline has it, D150.)
  const eng = s.engine && shot ? s.engineFor(shot.branch) : s.engine;
  const holdings = space && eng ? holdingsAt(s.world!, eng, space.id, time, shot ? (t0) => screenSecondsSince(shot, s.shotFrame, t0) : undefined) : undefined;
  const lanes = space && eng ? lanesFor(s.world!, eng, space.id, time) : undefined;
  const wars = s.world && eng ? warsAmong(s.world, eng, time) : undefined;
  // The Lanes tool: the first star clicked, waiting for the second.
  const [laneFrom, setLaneFrom] = useState<number | null>(null);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !s.world) return;
    const dpr = (window.devicePixelRatio || 1) * s.viewSettings.resolution;
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1017';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr, 0, 0, dpr, frame.x * dpr, frame.y * dpr);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, frame.w, frame.h); ctx.clip();
    renderer.current.render(ctx, view, cat, {
      transparent: !!shot?.transparent, grid: !scene.row && (shot ? shot.graticule : true), dropLines: scene.dropLines !== false, row: scene.row,
      names: shot && !shot.labels ? 'none' : 'auto', selected: shot ? null : laneFrom ?? (s.selection?.kind === 'star' ? s.selection.id : null), holdings, lanes,
      rings: scene.rings, axisLabel: scene.axisLabel, orbits: scene.orbits, realmReach: scene.realmReach, dust: scene.dust, armNames: scene.armNames, planets: scene.planets,
      look, wars, seconds: shot ? s.shotFrame / shot.fps : undefined,
    });
    // The box being drawn with the Star systems tool.
    const d = drag.current;
    if (d.kind === 'box') {
      ctx.strokeStyle = '#ffe9a6'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.min(d.x, d.cx), Math.min(d.y, d.cy), Math.abs(d.cx - d.x), Math.abs(d.cy - d.y));
      ctx.setLineDash([]);
    }
    ctx.restore();
    if (shot) {
      const look = lookStyles(shot);
      if (look?.finish) finishLook(ctx, frame.x * dpr, frame.y * dpr, frame.w * dpr, frame.h * dpr, look.look, (frame.w * dpr) / 1920);
      ctx.setTransform(dpr, 0, 0, dpr, frame.x * dpr, frame.y * dpr);
      const o = s.presentOverlay;
      overlayRects = drawShotOverlays(ctx, frame.w, frame.h, s.world, o ? moveOverlay(shot, o.id, o.dx, o.dy, o.from) : shot, s.shotFrame, time, undefined, s.engineFor(shot.branch));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(frame.x - 0.5, frame.y - 0.5, frame.w + 1, frame.h + 1);
    } else overlayRects = [];
    shown = { view, frame, stars: renderer.current.lastStars, names: renderer.current.lastNames };
  });

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left - frame.x, e.clientY - r.top - frame.y];
  };
  const commitShotCamera = () => {
    const sh = currentShot(), cam = store.presentCamera, id = store.shotId;
    if (!sh || !cam || !id) return;
    store.execute((w) => cmd.updateSequence(w, id, { settings: withStillCamera(sh, cam) }));
    store.set({ presentCamera: null });
  };
  const setCamera = (next: Camera) => { if (shot) store.setLive({ presentCamera: next }); else store.setCamera(next); };

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    if (presentation && e.button === 0) {
      const hit = [...overlayRects].reverse().find((r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h);
      if (hit) { drag.current = { kind: 'overlay', id: hit.id, x: p[0], y: p[1], from: { x: hit.x / frame.w, y: hit.y / frame.h } }; return; }
    }
    // The Star systems tool: Ctrl and a drag draws a box around the stars to give.
    if (!presentation && e.button === 0 && store.tool === 'systems' && (e.ctrlKey || e.metaKey)) { drag.current = { kind: 'box', x: p[0], y: p[1], cx: p[0], cy: p[1] }; return; }
    // (On a chart, D131, a drag moves the chart and a right-drag turns it; in three dimensions, a drag turns the view round and a right-drag moves it.)
    const other = e.button === 2 || e.shiftKey;
    drag.current = { kind: chart ? (other ? 'orbit' : 'pan') : other ? 'pan' : 'orbit', x: p[0], y: p[1], moved: 0, start: camera };
  }
  /** The primary star of a star's system (a companion sits where its primary is: a click means the system). */
  const primaryOf = (id: number) => (cat ? starPrimary(cat, id) : id);
  /** Every star of a star's system. */
  const systemOf = (id: number) => (cat ? starSystem(cat, id) : [id]);
  /**
   * Star systems given to the country or faction chosen (or to nobody), from the date viewed or in the
   * event being recorded (D111): every star of each system.
   */
  const giveStars = (ids: number[]) => {
    if (!ids.length || !space) return;
    const primaries = [...new Set(ids.map(primaryOf))];
    const all = [...new Set(primaries.flatMap(systemOf))];
    const label = primaries.length === 1 ? cat?.byId.get(primaries[0])?.name ?? 'a star' : `${primaries.length} star systems`;
    store.execute((w) => cmd.holdStars(w, { spaceId: space.id, stars: all, entity: store.paintValue ?? '', mode: placementMode(), label }));
  };
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current, p = local(e);
    if (d.kind === 'overlay') { store.setLive({ presentOverlay: { id: d.id, dx: (p[0] - d.x) / frame.w, dy: (p[1] - d.y) / frame.h, from: d.from } }); return; }
    if (d.kind === 'box') { d.cx = p[0]; d.cy = p[1]; force((n) => n + 1); return; }
    if (d.kind !== 'orbit' && d.kind !== 'pan') return;
    const dx = p[0] - d.x, dy = p[1] - d.y;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (d.moved < 3) return;
    const start = makeSpaceView(d.start, frame.w, frame.h, scene.radius, chart);
    setCamera(d.kind === 'orbit' ? (chart ? turnChart(d.start, start, d.x, d.y, p[0], p[1]) : orbitCamera(d.start, dx, dy)) : panSpaceCamera(d.start, start, dx, dy));
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current, p = local(e);
    drag.current = { kind: 'none' };
    if (d.kind === 'overlay') {
      const o = store.presentOverlay, sh = currentShot(), id = store.shotId;
      store.set({ presentOverlay: null });
      if (o && sh && id && (Math.abs(o.dx) > 1e-4 || Math.abs(o.dy) > 1e-4)) store.execute((w) => cmd.updateSequence(w, id, { settings: moveOverlay(sh, o.id, o.dx, o.dy, o.from) }));
      return;
    }
    if (d.kind === 'box') {
      const x0 = Math.min(d.x, p[0]), x1 = Math.max(d.x, p[0]), y0 = Math.min(d.y, p[1]), y1 = Math.max(d.y, p[1]);
      force((n) => n + 1);
      giveStars(renderer.current.lastStars.filter((st) => st.x >= x0 && st.x <= x1 && st.y >= y0 && st.y <= y1).map((st) => st.id));
      return;
    }
    if (d.kind !== 'orbit' && d.kind !== 'pan') return;
    if (d.moved >= 3) { if (presentation) commitShotCamera(); return; }
    if (presentation) return;
    // A click: the star under the pointer is chosen (a click on empty space chooses nothing); with the
    // Star systems tool, it is given.
    const hit = renderer.current.starAt(p[0], p[1]);
    const star = hit === null ? null : primaryOf(hit);
    if (e.button === 2) { store.set({ selection: null }); return; }
    if (store.tool === 'systems' && star !== null) { giveStars([star]); store.set({ selection: { kind: 'star', id: star } }); return; }
    // The Lanes tool (D112): a star, then another: a lane between them from the date viewed (or in the
    // event being recorded, where it grows from the first to the second over the event).
    if (store.tool === 'lanes') {
      if (star === null || star === laneFrom) { setLaneFrom(null); return; }
      if (laneFrom === null) { setLaneFrom(star); store.set({ selection: { kind: 'star', id: star } }); return; }
      const mode = placementMode(), a = cat?.byId.get(laneFrom)?.name ?? 'a star', b = cat?.byId.get(star)?.name ?? 'a star';
      if (space) store.execute((w) => cmd.setLane(w, { spaceId: space.id, a: laneFrom, b: star, on: true, entity: store.paintValue ?? '', mode, grow: mode.kind === 'new', label: `a lane from ${a} to ${b}` }));
      setLaneFrom(null);
      store.set({ selection: { kind: 'star', id: star } });
      return;
    }
    store.set({ selection: star !== null ? { kind: 'star', id: star } : null });
  }
  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    // A star double-clicked: the view turns around it.
    const p = local(e);
    const star = renderer.current.starAt(p[0], p[1]);
    const st = star !== null ? cat?.byId.get(star) : null;
    if (st) { setCamera({ ...camera, target: [st.x, st.y, st.z] }); if (presentation) commitShotCamera(); }
  }
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = { ...camera, zoom: Math.max(-1.5, Math.min(6, camera.zoom - e.deltaY / 400)) };
      if (shot) {
        store.setLive({ presentCamera: next });
        clearTimeout(wheelTimer.current);
        wheelTimer.current = window.setTimeout(commitShotCamera, 350);
      } else store.setCamera(next);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="map-canvas" style={{ width: size.w, height: size.h, cursor: "grab" }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()} data-testid="map-canvas" data-space="stars" />
      {!presentation && (
        <div className="map-hud">
          <div className="scalebar space-note" data-testid="space-note">{settings?.catalogue === 'galaxy' && settings.galaxy && cat ? galaxyNote(settings.galaxy, cat, scene.rings?.[0]?.label ?? '') : settings?.catalogue === 'invented' && cat ? `${cat.stars.length} invented stars within ${cat.radiusLy} light-years · seed ${settings.invented?.seed}` : scene.unit === 'au' ? (scene.row ? `The Sun, the planets and their large moons side by side on ${fmt(time)}` : `The Sun and the planets on ${fmt(time)} · ${settings?.scale === 'true' ? 'distances true to scale' : 'distances compressed'}`) : cat ? `${cat.stars.length} stars within ${cat.radiusLy} light-years${scene.planets ? ` · ${scene.planets.size} with known planets (dotted rings)` : ''} · rings every 10 ly` : 'Loading the stars…'}</div>
          {settings?.catalogue === 'galaxy' && settings.galaxy && space && <button className="small space-scale" onClick={() => store.execute((w) => cmd.setGalaxy(w, space.id, { ...settings.galaxy!, seed: settings.galaxy!.seed + 1 }))} data-testid="galaxy-again" title={settings.galaxy.kind === 'milkyway' ? 'Star systems elsewhere along the arms, from the next seed (held systems and lanes keep their numbers)' : 'Another galaxy from the next seed (held systems and lanes keep their numbers)'}>{settings.galaxy.kind === 'milkyway' ? 'Other star systems' : 'Another galaxy'} (seed {settings.galaxy.seed + 1})</button>}
          {settings?.catalogue === 'invented' && settings.invented && space && <button className="small space-scale" onClick={() => store.execute((w) => cmd.setInventedStars(w, space.id, { ...settings.invented!, seed: settings.invented!.seed + 1 }))} data-testid="invented-again" title="Other stars from the next seed (held stars and lanes keep their numbers)">Other stars (seed {settings.invented.seed + 1})</button>}
          {scene.unit === 'au' && space && !scene.row && <button className="small space-scale" onClick={() => store.execute((w) => cmd.setSolarScale(w, space.id, settings?.scale === 'true' ? 'compressed' : 'true'))} data-testid="solar-scale" title="True to scale, the inner planets crowd round the Sun; compressed, every orbit has room">{settings?.scale === 'true' ? 'Compress the distances' : 'Distances true to scale'}</button>}
          {scene.unit === 'au' && space && <button className={`small space-scale ${scene.row ? 'on' : ''}`} onClick={() => store.execute((w) => cmd.setSolarLayout(w, space.id, scene.row ? 'orbits' : 'side-by-side'))} data-testid="solar-layout" title={scene.row ? 'Back to the planets where they are, going round the Sun' : 'Side by side: the Sun and the planets in a row, their moons below them, who holds each over it (for the politics and the story rather than the orbits)'}>{scene.row ? 'Orbits' : 'Side by side'}</button>}
          {space && <div className="hud-buttons space-look-buttons">
            {!scene.row && <button className={chart ? 'on' : ''} onClick={() => store.execute((w) => cmd.setSkyLook(w, space.id, { ...(look ?? DEFAULT_SKY), chart: !chart }, chart ? 'Stars in three dimensions' : 'Stars as a flat chart'))} data-testid="space-chart" title={chart ? 'Back to the stars in three dimensions' : 'A flat chart: the map seen straight down on the plane, like a map of the stars (drag to move it, right-drag to turn it)'}>Chart</button>}
            <button onClick={() => store.set({ dialog: 'sky-look' })} data-testid="space-look" title="How the stars look: colours, shapes, glows, the sky, lines and names, realms">Look…</button>
          </div>}
          <div className="hud-buttons">
            <button title="Zoom in" onClick={() => store.setCamera({ ...camera, zoom: camera.zoom + 0.5 })}>+</button>
            <button title="Zoom out" onClick={() => store.setCamera({ ...camera, zoom: camera.zoom - 0.5 })}>−</button>
            <button title="Back to the Sun, the whole map in view" onClick={() => store.setCamera({ ...camera, zoom: 0, target: undefined })} data-testid="space-home">⌂</button>
          </div>
        </div>
      )}
    </div>
  );
}
