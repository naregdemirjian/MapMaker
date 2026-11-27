import { createRoot } from 'react-dom/client';
import { setGalaxyGL } from '../space/galaxy-gl.ts';
import { forgetBakedGalaxies, galaxyBakeState, galaxyImageNow } from '../space/galaxy-pictures.ts';
import { spaceSettingsOf as galaxySettingsOf } from '../world-model/world-settings.ts';
import { App } from './App.tsx';
import { installNumberScrub } from './number-scrub.ts';
import { store } from './store.ts';
import { gregorian, compare } from '../core-time/index.ts';
import { activeSources } from '../domain/fields.ts';
import { lonLatToVec } from '../geo-kernel/vec.ts';
import { makeView, screenToLonLat, lonLatToScreen } from '../render-engine/camera.ts';
import { cameraAt, timeAt, defaultShot, newTextBox } from '../presentation/sequence.ts';
import { currentShot, frameRect, shotOverlayRects, shownMapView, shapeNow, SIDE_GAP } from './components/MapView.tsx';
import { shownSpace } from './components/SpaceView.tsx';
import * as commands from '../domain/commands.ts';
import { runExport, renderFrame, terrainFor, PASS_DEFS } from '../presentation/export-driver.ts';
import { svgFrame } from '../presentation/svg-frame.ts';
import { decodeCountries, COUNTRY_GROUP_COLORS } from '../domain/countries.ts';
import { MapRenderer, EXPORT_QUALITY } from '../render-engine/map-renderer.ts';
import { labelStats } from '../render-engine/label-place.ts';
import { Engine } from '../temporal-engine/engine.ts';
import { chooseScale } from '../render-engine/basemap.ts';
import { heightAt } from '../terrain/grid.ts';
import { sculpted } from '../terrain/sculpt-cache.ts';
import { planetBench } from './planet-engine.ts';
import * as dock from './shell/dock.ts';
import { defaultDock, type Page } from './shell/studios.ts';

/** The lists, in the order the one column of all of them had before they were panels of their own (D199, D234). */
const LISTS = ['maps', 'layers', 'countries', 'places', 'areas', 'events'];
const withAllLists = (n: dock.DockNode): dock.DockNode => n.kind === 'stack'
  ? (n.panels.some((p) => LISTS.includes(p)) ? dock.split('col', LISTS.map((p) => dock.stack([p])), n.size)
    // (In the Timeline studio, the lists under its own panels, D241.)
    : n.panels.includes('groups') ? dock.split('col', [n, ...LISTS.map((p) => dock.stack([p]))], n.size) : n)
  : { ...n, children: n.children.map(withAllLists) };

/** The working map's view as it is shown (it may hold a meridian while the map moves), or the camera's own for that size. */
function shown(width: number, height: number) {
  // (Two timelines or dates side by side, D150: the map is the left half; the other side shows the same place.)
  if (store.compare.on && store.compare.side && store.mode === 'world') width = Math.max(25, Math.floor((width - SIDE_GAP) / 2));
  const v = shownMapView();
  return v && !v.preview && v.view.width === width && v.view.height === height ? v.view : makeView(store.camera, width, height);
}

// A small read-only window into the live state, used by the automated interface tests.
// It changes nothing; everything the tests do to the project goes through the interface itself.
(window as unknown as { __mapmaker: unknown }).__mapmaker = {
  // (Galaxy pictures, D193: for the tests, drawing without the graphics card, and forgetting what was baked.)
  setGalaxyGL, forgetBakedGalaxies,
  /** The picture the galaxy map shown draws now: how large, and whether it is the baked one. */
  galaxyPicture() {
    const g = galaxySettingsOf(store.world?.get('map_space', store.spaceId) ?? null)?.galaxy;
    const im = g ? galaxyImageNow(g) : null;
    return im ? { size: im.size, baked: im.baked, bake: galaxyBakeState(g!) } : null;
  },
  store,
  /** For the performance benchmarks (bench/): the commands, dates and the export, to drive large projects directly. */
  /**
   * For the interface tests: everything worked out from what was there before (history followed
   * change by change, states and snapshots made from the ones before) is also worked out afresh,
   * and any difference stops the drawing with an error. Slow; never on in normal use.
   */
  verify(on = true) { Engine.verify = on; store.renderer.verify = on; },
  /** The docking panels (D234): the functions on layouts, and each page's first layout. */
  dock: { ...dock, defaultDock },
  /**
   * For the interface tests written before the lists were panels of their own (D234): in every page on the world, every
   * list open at once, each in a group of its own down the left, where the one column of all the lists was.
   */
  allLists() {
    for (const page of ['map', 'history', 'timeline', 'looks'] as Page[]) store.setDock({ root: withAllLists(defaultDock(page).root), floats: [] }, page);
  },
  bench: { commands, gregorian, lonLatToVec, runExport, renderFrame, terrainFor, svgFrame, newTextBox, PASS_DEFS, defaultShot, cameraAt, EXPORT_QUALITY, decodeCountries, COUNTRY_GROUP_COLORS, MapRenderer, makeView, Engine, labelStats, chooseScale, heightAt, sculpted, activeSources, compare, planet: planetBench },
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
    return screenToLonLat(shown(r.width, r.height), pageX - r.left, pageY - r.top);
  },
  /** The point of the page where a map position is drawn, in world-building mode. */
  lonLatToPage(lon: number, lat: number) {
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const p = lonLatToScreen(shown(r.width, r.height), lon, lat);
    return p ? [p[0] + r.left, p[1] + r.top] : null;
  },
  /** The meridian the working map is laid out around while it is being moved, or null (see Camera.meridian). */
  heldMeridian() { return shownMapView()?.view.camera.meridian ?? null; },
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
    const v = shownMapView();
    const p = lonLatToScreen(v && v.preview && v.view.width === fr.w && v.view.height === fr.h ? v.view : makeView(store.presentCamera ?? cameraAt(shot, store.shotFrame), fr.w, fr.h), lon, lat);
    return p ? [p[0] + fr.x + r.left, p[1] + fr.y + r.top] : null;
  },
  /** Where a star of a space map was drawn on the page (D110), or null (not drawn, or not a space map). */
  starToPage(id: number) {
    const v = shownSpace();
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    const st = v?.stars.find((x) => x.id === id);
    if (!v || !c || !st || c.dataset.space !== 'stars') return null;
    const r = c.getBoundingClientRect();
    return [r.left + v.frame.x + st.x, r.top + v.frame.y + st.y];
  },
  /** The precise shape being drawn (D232): its anchors and handles. */
  shapeAnchors() { return shapeNow(); },
  /** How big a star of a space map was drawn (pixels across its radius), or null. */
  starRadius(id: number) { return shownSpace()?.stars.find((x) => x.id === id)?.r ?? null; },
  /** The star names written on the space map (D110). */
  spaceNames() { return shownSpace()?.names ?? []; },
  /** The middle of the space map's picture on the page (D110), or null. */
  spaceMiddle() {
    const v = shownSpace();
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    if (!v || !c || c.dataset.space !== 'stars') return null;
    const r = c.getBoundingClientRect();
    return [r.left + v.frame.x + v.frame.w / 2, r.top + v.frame.y + v.frame.h / 2];
  },
  /** The shot preview's frame on the page (x, y, w, h), or null. */
  previewFrame() {
    const shot = currentShot();
    const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement | null;
    if (!shot || !c) return null;
    const r = c.getBoundingClientRect();
    const fr = frameRect(shot, r.width, r.height);
    return { x: fr.x + r.left, y: fr.y + r.top, w: fr.w, h: fr.h };
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

installNumberScrub();
createRoot(document.getElementById('root')!).render(<App />);
