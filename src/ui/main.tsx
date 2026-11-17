import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { store } from './store.ts';
import { gregorian } from '../core-time/index.ts';
import { lonLatToVec } from '../geo-kernel/vec.ts';
import { makeView, screenToLonLat, lonLatToScreen } from '../render-engine/camera.ts';
import { cameraAt, timeAt } from '../presentation/sequence.ts';
import { currentShot, frameRect, shotOverlayRects } from './components/MapView.tsx';

// A small read-only window into the live state, used by the automated interface tests.
// It changes nothing; everything the tests do to the project goes through the interface itself.
(window as unknown as { __mapmaker: unknown }).__mapmaker = {
  store,
  /** A view of the map for a camera and size (for off-screen comparisons in tests). */
  viewOf(camera: Parameters<typeof makeView>[0], width: number, height: number) { return makeView(camera, width, height); },
  /** Who owns the place at (lon, lat) on the date written in `date`, on the layer being drawn on. */
  ownerAt(lon: number, lat: number, date: string) {
    const s = store;
    const t = gregorian.parse(date)?.instant;
    if (!s.engine || !t) return undefined;
    const id = s.engine.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(lon, lat), t);
    return id ? s.world!.get('entity', id)?.name ?? id : null;
  },
  /** The map position under a point of the page, in world-building mode. */
  pageToLonLat(pageX: number, pageY: number) {
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return screenToLonLat(makeView(store.camera, r.width, r.height), pageX - r.left, pageY - r.top);
  },
  /** The point of the page where a map position is drawn, in world-building mode. */
  lonLatToPage(lon: number, lat: number) {
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const p = lonLatToScreen(makeView(store.camera, r.width, r.height), lon, lat);
    return p ? [p[0] + r.left, p[1] + r.top] : null;
  },
  /** The historical instant shown by a frame of the current shot. */
  shotInstantAt(frame: number) {
    const shot = currentShot();
    return shot ? timeAt(shot, frame) : null;
  },
  /** The current world-building camera framed for an output of the given size (for benchmarks). */
  viewFor(width: number, height: number) {
    return makeView(store.camera, width, height);
  },
  /** The point of the page where a map position is drawn in the shot preview (presentation mode). */
  previewToPage(lon: number, lat: number) {
    const shot = currentShot();
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    if (!shot || !c) return null;
    const r = c.getBoundingClientRect();
    const fr = frameRect(shot, r.width, r.height);
    const p = lonLatToScreen(makeView(store.presentCamera ?? cameraAt(shot, store.shotFrame), fr.w, fr.h), lon, lat);
    return p ? [p[0] + fr.x + r.left, p[1] + fr.y + r.top] : null;
  },
  /** Where the shot preview drew its texts and events box, as page rectangles (id, x, y, w, h). */
  previewOverlays() {
    const shot = currentShot();
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    if (!shot || !c) return [];
    const r = c.getBoundingClientRect();
    const fr = frameRect(shot, r.width, r.height);
    return shotOverlayRects().map((o) => ({ ...o, x: o.x + fr.x + r.left, y: o.y + fr.y + r.top }));
  },
  /** Where a map position lands in an exported frame of the current shot (scale 1 = full size). */
  exportPixel(lon: number, lat: number, frame: number, scale: number) {
    const shot = currentShot();
    if (!shot) return null;
    const w = Math.max(16, Math.round(shot.width * scale)), h = Math.max(16, Math.round(shot.height * scale));
    return lonLatToScreen(makeView(cameraAt(shot, frame), w, h), lon, lat);
  },
};

createRoot(document.getElementById('root')!).render(<App />);
