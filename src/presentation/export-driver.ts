// Renders a shot frame by frame, pass by pass, offscreen at the exact output size, and streams the
// pixels to the data service, which writes the image sequences. Frames are pure functions of
// (project state, shot, frame number): nothing depends on the screen, the window or timing.
import { Api } from '../ui/api.ts';
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import { MapRenderer, DEFAULT_STYLE, EXPORT_QUALITY, type PassName, type MapStyle, type RenderOptions } from '../render-engine/map-renderer.ts';
import { resolveLook, isPlainLook, mapStyleOf, basemapStyleOf, finishLook, type Look } from './looks.ts';
import { makeView, viewBounds, metresPerPixel, lonLatToScreen, type View } from '../render-engine/camera.ts';
import { type ShotSettings, type OverlayRect, EVENTS_BOX_ID, timeAt, cameraAt, overlaysAt, drawOverlays, shotTransitions, screenSecondsSince, isVideoFormat } from './sequence.ts';
import { planVideo, VideoFileEncoder, UploadSink, type VideoPlan } from './video-encoder.ts';
import { videoBytes } from '../export/video-codecs.ts';
import { gregorian, type Instant } from '../core-time/index.ts';
import { encodeTiff, deflateInBrowser } from '../export/tiff.ts';
import { eventsBoxOf, currentEvents, drawEventsBox } from './events-box.ts';
import { eventShown, entityStyle } from '../domain/commands.ts';
import { isFeatureKind } from '../render-engine/feature-style.ts';
import { preloadImages, prepareVideos } from '../render-engine/assets.ts';
import { basemapSourceOf, loadBasemap, loadBasemapDetail, loadDatasetRecords, DEFAULT_BASEMAP_STYLE, type Basemap, type BasemapStyle } from '../render-engine/basemap.ts';
import { shown, minLakeKm2, terrainLook, seaLevelPoints, planetOf, sculptOf, terrainSourceOf, isSpaceMap, spaceSettingsOf, isPaleoEarth } from '../world-model/world-settings.ts';
import { makeSpaceView } from '../space/space-view.ts';
import { SpaceRenderer } from '../space/space-renderer.ts';
import { loadNearbyStars } from '../space/catalogue.ts';
import { loadExoplanets } from '../space/exoplanets.ts';
import { spaceScene } from '../space/scene.ts';
import { holdingsAt, lanesFor, warsAmong } from '../space/realms.ts';
import { loadPaleo, paleoGridAt, ageOf, glacialSeaAt, type PaleoSet } from '../terrain/paleo.ts';
import { stampsAt } from '../terrain/sculpt.ts';
import { sculpted } from '../terrain/sculpt-cache.ts';
import { riversNow } from '../terrain/river-cache.ts';
import { planetKey } from '../terrain/planet.ts';
import { planetTerrain } from '../terrain/planet-cache.ts';
import { seaLevelAt } from '../terrain/sea-level.ts';
import { loadEarthTerrain, EARTH_TERRAIN_KEY, type ElevationGrid } from '../terrain/grid.ts';
import { loadEarthCover, coverNow, type TerrainCover } from '../terrain/cover.ts';
import { detailNeed, type DetailGrid } from '../terrain/detail.ts';
import { detailNow } from '../terrain/detail-cache.ts';
import { climateOf } from '../terrain/biomes.ts';
import { PALETTES } from '../terrain/look.ts';

export interface ExportPassDef { name: string; label: string; blend: string; passes: PassName[]; overlays: boolean; background: boolean; note?: string; /** A layer pass (D124): only this layer is drawn. */ layerId?: string }

export const PASS_DEFS: ExportPassDef[] = [
  { name: 'all', label: 'All', blend: 'Normal', passes: ['background', 'terrain', 'graticule', 'land', 'fills', 'borders', 'fields', 'features', 'cities', 'labels', 'characters'], overlays: true, background: true, note: 'everything combined in one image sequence' },
  { name: 'background', label: 'Background', blend: 'Normal', passes: ['background', 'terrain', 'graticule'], overlays: false, background: true, note: 'ocean, terrain colours and grid' },
  { name: 'land', label: 'Land (Natural Earth)', blend: 'Normal', passes: ['land'], overlays: false, background: false, note: 'land, lakes and coastlines (with terrain colours, only the coastlines; relief without colours lies here); empty for worlds without the Earth basemap' },
  { name: 'fills', label: 'Territory fills', blend: 'Normal', passes: ['fills'], overlays: false, background: false, note: 'lower the opacity in Premiere to taste' },
  { name: 'borders', label: 'Borders', blend: 'Normal', passes: ['borders'], overlays: false, background: false },
  { name: 'fields', label: 'Conditions', blend: 'Normal', passes: ['fields'], overlays: false, background: false, note: 'radiation, fire, smoke and ash, floods, destruction, heatmaps' },
  { name: 'features', label: 'Areas, lines and points', blend: 'Normal', passes: ['features'], overlays: false, background: false, note: 'claims, zones, routes, front lines, battles' },
  { name: 'cities', label: 'Cities', blend: 'Normal', passes: ['cities'], overlays: false, background: false, note: 'city dots and names' },
  { name: 'labels', label: 'Labels', blend: 'Normal', passes: ['labels'], overlays: false, background: false },
  { name: 'characters', label: 'Characters', blend: 'Normal', passes: ['characters'], overlays: false, background: false, note: 'character markers and names' },
  { name: 'overlays', label: 'Text overlays', blend: 'Normal', passes: [], overlays: true, background: false, note: 'dates and titles' },
];

/**
 * Each layer on its own (D124): a pass for every layer the shot shows, in their order, bottom first: a territory
 * layer's fills and borders, a layer of areas, lines and points, a layer of conditions. For compositing a layer
 * apart (an occupation over the political map, faded in its own time).
 */
export function layerPassDefs(world: World, shot: ShotSettings): ExportPassDef[] {
  return visibleLayers(world, shot).map((id) => {
    const l = world.get('layer', id)!;
    const passes: PassName[] = l.kind === 'partition' ? ['fills', 'borders'] : l.kind === 'field' ? ['fields'] : ['features'];
    return { name: `layer-${id}`, label: `Layer: ${l.name}`, blend: 'Normal', passes, overlays: false, background: false, layerId: id, note: l.kind === 'partition' ? 'its fills and borders' : l.kind === 'field' ? 'its conditions' : 'its areas, lines and points' };
  });
}

/** Every pass a shot can export, in stacking order (bottom first; "All" first, as the list shows it): the kinds, with each layer's own after the land. */
export function passDefsFor(world: World, shot: ShotSettings): ExportPassDef[] {
  const at = PASS_DEFS.findIndex((d) => d.name === 'land') + 1;
  return [...PASS_DEFS.slice(0, at), ...layerPassDefs(world, shot), ...PASS_DEFS.slice(at)];
}

/** What a shot exports: its own choice, or everything combined ('all') when it has none. */
export function exportPassesOf(shot: ShotSettings): string[] {
  const known = new Set(PASS_DEFS.map((d) => d.name));
  // (Layer passes are checked against the map's layers when exporting.)
  const chosen = (shot.exportPasses ?? ['all']).filter((p) => known.has(p) || p.startsWith('layer-'));
  return chosen;
}

/** A size in bytes for people: "850 MB", "2.4 GB", "120 KB". */
export function formatBytes(n: number): string {
  if (!(n > 0)) return '0 KB';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/**
 * How the PNG of a map grows with the picture: a picture twice as wide and high takes about two and a
 * half times the bytes, not four times (flat colour packs to next to nothing; outlines and names,
 * which grow with the width, are what is left). Measured on the benchmark projects from 320 to 1920
 * pixels wide: between 2.3 and 2.7 times for every pass, at every size.
 */
const SIZE_GROWTH = 1.35;
/** The bytes of a picture `times` as wide and high as one of `bytes` (see SIZE_GROWTH). */
export function scaledBytes(bytes: number, times: number): number { return bytes * Math.pow(times, SIZE_GROWTH); }

/**
 * About how many bytes an export will write: one frame from the middle of the shot is drawn for each
 * chosen pass and compressed as PNG, then multiplied by the number of frames. The frame is drawn at
 * most 960 pixels wide and its size worked up from that (scaledBytes): drawing it at full size took
 * twice as long, in the middle of work on the shot. Real frames vary, so this is an estimate.
 */
export async function estimateExportBytes(world: World, engine: Engine, shot: ShotSettings, passNames: string[], scale = 1): Promise<number> {
  // A video (D121): its bit rate over its length.
  if (isVideoFormat(shot.format)) return videoBytes(Math.max(16, Math.round(shot.width * scale)), Math.max(16, Math.round(shot.height * scale)), shot.fps, shot.frames, shot.videoQuality);
  const defs = passDefsFor(world, shot).filter((d) => passNames.includes(d.name));
  if (!defs.length) return 0;
  const W = Math.max(16, Math.round(shot.width * scale)), H = Math.max(16, Math.round(shot.height * scale));
  const k = Math.min(1, 960 / W);
  const w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
  if (spaceSettingsOf(world.get('map_space', shot.spaceId))?.catalogue === 'nearby') await loadNearbyStars();
  const basemap = await basemapFor(world, shot.spaceId);
  const terrain = await terrainFor(world, shot.spaceId);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  // One renderer for all estimates: what it has prepared (outlines, label places) serves the next estimate too.
  estimator ??= new MapRenderer();
  const renderer = estimator;
  renderer.quality = { ...EXPORT_QUALITY };
  renderer.caching = 'off';
  const frame = Math.floor(shot.frames / 2);
  const detail = await detailForFrame(world, shot, frame, w, h, terrain);
  let perFrame = 0;
  for (const def of defs) {
    renderFrame(ctx, renderer, world, engine, shot, frame, def, w, h, basemap, terrain, detail);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    perFrame += blob.size;
  }
  // Uncompressed TIFF (D109): four bytes a pixel; ZIP about a fifth more than PNG.
  if (shot.format === 'tiff') return W * H * 4 * defs.length * shot.frames;
  return scaledBytes(perFrame, W / w) * shot.frames * (shot.format === 'tiff-zip' ? 1.2 : 1);
}

let estimator: MapRenderer | null = null;

export function visibleLayers(world: World, shot: ShotSettings): string[] {
  return world.all('layer')
    .filter((l) => l.space_id === shot.spaceId && (l.kind === 'partition' || l.kind === 'field' || isFeatureKind(l.kind)) && (shot.layers.length ? shot.layers.includes(l.id) : !!l.visible))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => l.id);
}

/** Text overlays and the current-events box of a shot frame (the same in the preview and exports). */
export function drawShotOverlays(ctx: CanvasRenderingContext2D, width: number, height: number, world: World, shot: ShotSettings, frame: number, t: Instant, view?: View): OverlayRect[] {
  // (Callouts point at places on the map: where the frame's view shows them, D107.)
  const project = view ? (lon: number, lat: number) => lonLatToScreen(view, lon, lat) as [number, number] | null : undefined;
  const rects = drawOverlays(ctx, width, height, overlaysAt(shot, frame, t), width / 1920, DEFAULT_STYLE.font, project);
  const box = eventsBoxOf(shot.eventsBox);
  if (!box.show) return rects;
  const groups = box.groups ? new Set(box.groups) : null;
  const events = currentEvents(world, box, t, (t0) => screenSecondsSince(shot, frame, t0), (id) => eventShown(world, id, groups));
  const r = drawEventsBox(ctx, width, height, width / 1920, box, t, events);
  if (r) rects.push({ id: EVENTS_BOX_ID, ...r });
  return rects;
}

/**
 * The renderer's colours for a shot's look (D108), and whether it needs finishing (a grade, darker
 * edges, paper); null for the classic look as it is (drawn exactly as before looks existed).
 */
export function lookStyles(shot: ShotSettings): { look: Look; style: MapStyle; basemap: BasemapStyle; finish: boolean } | null {
  const look = resolveLook(shot.look);
  if (isPlainLook(look)) return null;
  return { look, style: mapStyleOf(look, DEFAULT_STYLE), basemap: basemapStyleOf(look, DEFAULT_BASEMAP_STYLE), finish: look.grade !== 'none' || look.vignette > 0 || look.grain > 0 || look.blotches };
}

/** The shot's transition settings for one frame, as the renderer takes them. */
export function transitionOptions(shot: ShotSettings, frame: number) {
  return { ...shotTransitions(shot), secondsSince: (t0: Parameters<typeof screenSecondsSince>[2]) => screenSecondsSince(shot, frame, t0) };
}

/** The basemap a shot's world shows (loaded on first use), or null. */
export async function basemapFor(world: World, spaceId: string): Promise<Basemap | null> {
  // Every detail level is loaded before exporting, so frames never depend on what was loaded when.
  return basemapSourceOf(world.get('map_space', spaceId)) === 'natural-earth' ? loadBasemapDetail(await loadBasemap()) : null;
}

/** Terrain heights and a name for them (for what pictures of them are kept by); Earth's land cover when the look needs it (D100). */
export interface Ground { grid: ElevationGrid; key: string; cover?: TerrainCover | null; paleo?: PaleoSet }

/**
 * The terrain a shot's world needs in exports, or null: a generated planet's always (D97, made on
 * first use); Earth's (loaded on first use) when its terrain is shown (D95) or its sea level changes
 * over time (D96), with its land cover in the satellite look (D100).
 */
export async function terrainFor(world: World, spaceId: string): Promise<Ground | null> {
  const space = world.get('map_space', spaceId);
  const planet = planetOf(space);
  if (planet) return { grid: await planetTerrain(planet), key: planetKey(planet) };
  // (The Earth through geological time, D134: each frame takes the heights of its moment, see frameSetup.)
  if (isPaleoEarth(space)) { const p = await loadPaleo(); return { grid: p.grids[0], key: paleoGridAt(p, 0).key, paleo: p }; }
  const look = terrainLook(space), shownLook = !!look && shown(space, 'export', 'terrain');
  // (Conditions spreading over the terrain need its heights too, D103.)
  const fields = world.all('layer').some((l) => l.kind === 'field' && l.space_id === spaceId);
  if (!shownLook && !seaLevelPoints(space).length && !sculptOf(space).length && !fields) return null;
  return { grid: await loadEarthTerrain(), key: EARTH_TERRAIN_KEY, cover: shownLook && PALETTES[look.palette].cover ? await loadEarthCover() : null };
}

/**
 * Close in on the Earth (D101): the finer heights for a frame's view, once their tiles are in (null
 * where they are not wanted: another world, the look's detail turned off, or zoomed out).
 */
export async function detailForFrame(world: World, shot: ShotSettings, frame: number, width: number, height: number, ground: Ground | null): Promise<DetailGrid | null> {
  const space = world.get('map_space', shot.spaceId);
  if (!ground || !terrainLook(space)?.detail || terrainSourceOf(space) !== 'earth') return null;
  const radius = (space?.radius_m ?? 6371008.8) / 1000;
  const carved = sculpted(ground.grid, ground.key, stampsAt(sculptOf(space), timeAt(shot, frame)), radius);
  const view = makeView(cameraAt(shot, frame), width, height);
  const shows = viewBounds(view), around = shows && viewBounds(view, 0.25);
  const need = around ? detailNeed(around, metresPerPixel(view, radius)) : null;
  return need && shows ? detailNow(shows, need, carved) : null;
}

/** Render one frame of one pass into a 2D context of the given size (`detail`: from detailForFrame). */
export function renderFrame(ctx: CanvasRenderingContext2D, renderer: MapRenderer, world: World, engine: Engine, shot: ShotSettings, frame: number, def: ExportPassDef, width: number, height: number, basemap: Basemap | null = null, ground: Ground | null = null, detail: DetailGrid | null = null): void {
  const space = world.get('map_space', shot.spaceId);
  if (isSpaceMap(space)) { drawSpaceFrame(ctx, world, engine, shot, frame, def, width, height); return; }
  const { view, t, options, ls } = frameSetup(world, shot, frame, def, width, height, basemap, ground, detail);
  ctx.clearRect(0, 0, width, height);
  if (options.passes.size) {
    renderer.render(ctx, view, world, engine, shot.spaceId, t, options);
    // The look's finish (D108): its grade, darker edges and paper, over the map and under the texts.
    if (ls?.finish) finishLook(ctx, 0, 0, width, height, ls.look, width / 1920);
  }
  if (def.overlays) drawShotOverlays(ctx, width, height, world, shot, frame, t, view);
}

/**
 * What a frame of a pass is drawn with: its view, its moment and the renderer's options (the passes
 * the shot and the map show among the pass's own), and the shot's look. (Exports and SVG frames, D115.)
 */
export function frameSetup(world: World, shot: ShotSettings, frame: number, def: ExportPassDef, width: number, height: number, basemap: Basemap | null = null, ground: Ground | null = null, detail: DetailGrid | null = null): { view: View; t: Instant; options: RenderOptions; ls: ReturnType<typeof lookStyles> } {
  const t = timeAt(shot, frame);
  const space = world.get('map_space', shot.spaceId);
  const view = makeView(cameraAt(shot, frame), width, height);
  // The Earth through geological time (D134): the heights of the frame's moment, and the sea of the last glacial cycle.
  const paleo = ground?.paleo ? paleoGridAt(ground.paleo, ageOf(t)) : null;
  if (paleo && ground) ground = { grid: paleo.grid, key: paleo.key };
  const glacial = paleo ? glacialSeaAt(ageOf(t)) : 0;
  // What the map shows in exports (D84), on top of the shot's own choices.
  const on = (k: Parameters<typeof shown>[2]) => shown(space, 'export', k);
  const labels = !!shot.labels && on('names'), cities = shot.cities !== false && on('cities');
  const look = terrainLook(space), terrainShown = !!look && on('terrain');
  const seaPoints = seaLevelPoints(space);
  // Sculpting (D98): the strokes holding at the frame's moment, applied to the heights.
  const strokes = stampsAt(sculptOf(space), t);
  const fieldsHere = world.all('layer').some((l) => l.kind === 'field' && l.space_id === shot.spaceId);
  const carved = ground && (terrainShown || seaPoints.length || planetOf(space) || paleo || strokes.length || fieldsHere) ? sculpted(ground.grid, ground.key, strokes, (space?.radius_m ?? 6371008.8) / 1000) : null;
  const rivers = carved && planetOf(space) && on('rivers') ? riversNow(carved.grid, carved.key) : null;
  // The land's colours in the satellite look (D100): Earth's land cover, or the planet's biomes.
  const planet = planetOf(space);
  const cover = carved && terrainShown && PALETTES[look.palette].cover ? (planet ? coverNow(carved.grid, carved.key, (space?.radius_m ?? 6371008.8) / 1000, climateOf(planet)) : ground?.cover ?? null) : null;
  const terrain = carved ? { grid: carved.grid, key: carved.key, look: terrainShown ? look : null, seaLevel: seaLevelAt(seaPoints, t) + glacial, override: carved.touched && basemap ? { data: carved.touched, key: carved.key } : null, rivers, cover, detail } : null;
  const passes = new Set<PassName>(def.passes.filter((p) => (p !== 'graticule' || (shot.graticule && on('graticule'))) && (p !== 'labels' || labels) && (p !== 'characters' || (shot.characters !== false && on('characters'))) && (p !== 'cities' || cities) && (p !== 'borders' || on('borders')) && (p !== 'features' || on('features')) && (p !== 'fields' || on('fields')) && (p !== 'terrain' || !!terrain?.look)));
  const transparent = def.name === 'all' ? shot.transparent : !def.background;
  const ls = lookStyles(shot);
  return { view, t, ls, options: { passes, transparent, layerIds: def.layerId ? [def.layerId] : visibleLayers(world, shot), basemap, transitions: transitionOptions(shot, frame), mediaSeconds: frame / shot.fps, mediaChannel: 'export', trails: !!shot.trails, layout: { labels, cities }, show: { lakes: on('lakes'), coastline: on('coastline'), rivers: on('rivers'), minLakeKm2: minLakeKm2(space) }, terrain, style: ls?.style, basemapStyle: ls?.basemap } };
}

/** One space renderer for exports (it keeps nothing between frames but where it drew). */
let spaceRenderer: SpaceRenderer | null = null;

/**
 * A frame of a space map (D110): the stars from the shot's camera (`finish`: with the look's finish). "All" draws everything; the
 * background pass the dark sky, the far stars and the rings; the labels pass the names; the texts
 * pass the texts. Other passes are empty on a space map.
 */
export function drawSpaceFrame(ctx: CanvasRenderingContext2D, world: World, engine: Engine, shot: ShotSettings, frame: number, def: ExportPassDef, width: number, height: number, finish = true): void {
  const t = timeAt(shot, frame);
  const settings = spaceSettingsOf(world.get('map_space', shot.spaceId));
  const scene = spaceScene(settings, t);
  const look = settings?.look;
  const view = makeSpaceView(cameraAt(shot, frame), width, height, scene.radius, !!look?.chart || !!scene.row);
  const all = def.name === 'all', back = def.passes.includes('background'), names = def.passes.includes('labels');
  const realms = !all && def.passes.includes('fills'), lanes = !all && def.passes.includes('features');
  ctx.clearRect(0, 0, width, height);
  if (all || back || (names && shot.labels) || realms || lanes) {
    spaceRenderer ??= new SpaceRenderer();
    spaceRenderer.render(ctx, view, scene.cat, {
      rings: scene.rings, axisLabel: scene.axisLabel, orbits: scene.orbits, realmReach: scene.realmReach, dust: scene.dust, armNames: scene.armNames, planets: all ? scene.planets : undefined,
      transparent: all ? shot.transparent : !def.background, grid: !scene.row && shot.graticule && (all || back), dropLines: all && scene.dropLines !== false, names: shot.labels && (all || names) ? 'auto' : 'none', row: scene.row,
      only: all ? undefined : back ? 'background' : realms ? 'realms' : lanes ? 'lanes' : 'names',
      holdings: holdingsAt(world, engine, shot.spaceId, t, (t0) => screenSecondsSince(shot, frame, t0)), lanes: lanesFor(world, engine, shot.spaceId, t),
      look, wars: warsAmong(world, engine, t), seconds: frame / shot.fps,
    });
    const ls = lookStyles(shot);
    if (finish && ls?.finish) finishLook(ctx, 0, 0, width, height, ls.look, width / 1920);
  }
  if (def.overlays) drawShotOverlays(ctx, width, height, world, shot, frame, t);
}

/** Two 32-bit hashes of a frame's pixels: frames with the same pair are taken to be the same picture. */
export function pixelHash(rgba: Uint8ClampedArray): [number, number] {
  const u = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < u.length; i++) {
    const v = u[i];
    h1 = Math.imul(h1 ^ v, 16777619);
    h2 = (Math.imul(h2 + v, 2246822519) ^ (h2 >>> 15)) | 0;
  }
  return [h1 >>> 0, h2 >>> 0];
}

export interface ExportResult { dir: string; checksums: Record<string, Record<number, string>>; frames: number; seconds: number; file?: string; bytes?: number }

export async function runExport(o: {
  projectId: string; world: World; engine: Engine; shot: ShotSettings; shotName: string; passNames: string[]; scale: number;
  frameRange?: [number, number]; onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean;
}): Promise<ExportResult> {
  const width = Math.max(16, Math.round(o.shot.width * o.scale));
  const height = Math.max(16, Math.round(o.shot.height * o.scale));
  // A video (D121) is the whole picture; image sequences are written in stacking order, bottom first
  // (the compositing guide lists them so), the combined picture last.
  const video = isVideoFormat(o.shot.format);
  const known = passDefsFor(o.world, o.shot);
  const defs = video ? PASS_DEFS.filter((d) => d.name === 'all') : [...known.filter((d) => d.name !== 'all'), ...known.filter((d) => d.name === 'all')].filter((d) => o.passNames.includes(d.name));
  if (!defs.length) throw new Error('Choose at least one thing to export.');
  const [f0, f1] = o.frameRange ?? [0, o.shot.frames - 1];
  const started = performance.now();
  // The video's encoder is found first: a video this computer cannot make stops before anything is written.
  const plan = video ? await planVideo(o.shot.format as VideoPlan['format'], width, height, o.shot.fps, o.shot.videoQuality ?? 'good') : null;
  if (plan && 'error' in plan) throw new Error(plan.error);
  // TIFF files (D109) are encoded here from the frame's pixels; PNG by the browser's own encoder.
  const tiff = o.shot.format === 'tiff' || o.shot.format === 'tiff-zip', zipped = o.shot.format === 'tiff-zip';
  // Loaded before the first frame, so every frame is drawn from the same complete data.
  const spaceMap = isSpaceMap(o.world.get('map_space', o.shot.spaceId));
  // (Only the map of the stars around the Sun draws the HYG catalogue: invented stars, galaxies and the solar system are made here.)
  const nearbyStars = spaceMap && spaceSettingsOf(o.world.get('map_space', o.shot.spaceId))?.catalogue === 'nearby';
  if (nearbyStars) { await loadNearbyStars(); await loadExoplanets(); }
  const basemap = await basemapFor(o.world, o.shot.spaceId);
  const terrain = await terrainFor(o.world, o.shot.spaceId);
  // Pictures and videos: every picture loaded, and every video sought to its frame before drawing.
  const fills = o.world.all('entity').map((e) => entityStyle(e).fill).filter((f): f is NonNullable<typeof f> => !!f?.asset);
  const videoFills = fills.filter((f) => f.kind === 'video').map((f) => ({ file: f.asset!, play: f }));
  // (and characters' own pictures used as their icons)
  const iconPictures = o.world.all('entity').map((e) => entityStyle(e).icon?.asset);
  await preloadImages([eventsBoxOf(o.shot.eventsBox).image, ...fills.filter((f) => f.kind === 'image').map((f) => f.asset), ...iconPictures]);
  // Credit lines for the data drawn in these frames (written into the manifest and the guide).
  // (Close-up tiles credited whenever the map may use them: the Earth with finer heights close in, D101.)
  const closeUp = !!terrain?.key.startsWith(EARTH_TERRAIN_KEY) && !!terrainLook(o.world.get('map_space', o.shot.spaceId))?.detail;
  const drawn = new Set([...(basemap || terrain?.cover ? ['natural-earth'] : []), ...(terrain?.key.startsWith(EARTH_TERRAIN_KEY) ? ['terrain-tiles', 'copernicus-dem'] : []), ...(closeUp ? ['terrain-tiles-close'] : []), ...(nearbyStars ? ['hyg', 'oec'] : []), ...(isPaleoEarth(o.world.get('map_space', o.shot.spaceId)) ? ['paleomap'] : [])]);
  const credits = drawn.size ? (await loadDatasetRecords()).filter((d) => drawn.has(d.id)).map((d) => `${d.name} ${d.version} (${d.licence}): ${d.credit}`) : [];
  const job = await Api.startExport(o.projectId, {
    credits,
    exportDir: o.shot.exportDir ?? null,
    shotName: o.scale === 1 ? o.shotName : `${o.shotName} (preview)`, width: plan ? plan.width : width, height: plan ? plan.height : height, fps: o.shot.fps, frameStart: f0, frameEnd: f1,
    format: plan ? plan.format : tiff ? 'tiff' : 'png',
    ...(plan ? { video: { codec: plan.config.codec, bitrate: plan.bitrate, quality: plan.quality } } : {}),
    passes: defs.map((d) => ({ name: d.name, label: d.label, blend: d.blend, note: d.note })), transparent: plan ? false : o.shot.transparent,
    historicalRange: [gregorian.format(timeAt(o.shot, f0), 'minute'), gregorian.format(timeAt(o.shot, f1), 'minute')],
  });
  // A fresh renderer per export: no state shared with the interface, so output never depends on it
  // (nor on the working view's performance settings: exports always draw at their own, finest quality).
  const renderer = new MapRenderer();
  renderer.quality = { ...EXPORT_QUALITY };
  renderer.caching = 'always';
  if (plan) return exportVideo(o, plan, job.jobId, renderer, { basemap, terrain, videoFills, f0, f1, started });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
  const total = (f1 - f0 + 1) * defs.length;
  let done = 0;
  // Each frame is drawn, then encoded as a PNG by the browser while the next one is being drawn, and
  // sent to be written. A frame that is pixel for pixel the picture before it in its pass (a still
  // camera between events; the land and the background all through) is not encoded again: its file
  // is copied. Several frames may be on their way at once; each pass's frames are written in order.
  const last = new Map<string, { a: number; b: number; frame: number }>();
  // How many frames may be on their way at once: one for each processor (encoding is what an export
  // of a simple map waits for, and it runs beside the drawing), at least four and at most twelve,
  // and no more than fit in about 400 MB (each holds a whole frame until it is encoded).
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const inFlight = Math.max(2, Math.min(Math.max(4, Math.min(12, cores)), Math.floor(400_000_000 / (width * height * 4))));
  const pending = new Set<Promise<unknown>>();
  const queues = new Map<string, Promise<unknown>>();
  let failure: unknown = null;
  const queue = (pass: string, work: () => Promise<unknown>): void => {
    const p = (queues.get(pass) ?? Promise.resolve()).then(work).then(() => { o.onProgress?.(++done, total); }, (e) => { failure ??= e; });
    queues.set(pass, p);
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };
  for (let frame = f0; frame <= f1; frame++) {
    // Close in on the Earth, the frame's finer heights (D101), waited for.
    const detail = await detailForFrame(o.world, o.shot, frame, width, height, terrain);
    for (const def of defs) {
      if (failure) throw failure;
      if (o.isCancelled?.()) { await Promise.allSettled(pending); throw new Error('Export cancelled.'); }
      if (videoFills.length) await prepareVideos(videoFills, frame / o.shot.fps);
      renderFrame(ctx, renderer, o.world, o.engine, o.shot, frame, def, width, height, basemap, terrain, detail);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const [a, b] = pixelHash(pixels);
      const before = last.get(def.name);
      if (before && before.a === a && before.b === b) {
        const sameAs = before.frame;
        queue(def.name, () => Api.repeatFrame(o.projectId, job.jobId, def.name, frame, sameAs));
      } else if (tiff) {
        last.set(def.name, { a, b, frame });
        // (The pixels are this frame's own copy: encoded while the next frame is drawn.)
        queue(def.name, async () => Api.sendTiffFrame(o.projectId, job.jobId, def.name, frame, new Blob([(await encodeTiff(pixels, width, height, zipped ? 'zip' : 'none', deflateInBrowser)) as BlobPart], { type: 'image/tiff' })));
      } else {
        last.set(def.name, { a, b, frame });
        // The canvas is copied now; encoding goes on in the background.
        const png = canvas.convertToBlob({ type: 'image/png' });
        queue(def.name, async () => Api.sendPngFrame(o.projectId, job.jobId, def.name, frame, await png));
      }
      // Not too many pictures waiting to be encoded and written (each holds a whole frame).
      while (pending.size >= inFlight) await Promise.race(pending);
    }
  }
  await Promise.all(pending);
  if (failure) throw failure;
  const fin = await Api.finishExport(o.projectId, job.jobId);
  return { dir: fin.dir, checksums: fin.checksums, frames: f1 - f0 + 1, seconds: (performance.now() - started) / 1000 };
}

/**
 * A shot as one video file (D121): each frame drawn as the "All" pass is (opaque: a video has no
 * transparency), handed to the browser's encoder while the next is drawn, and the file's bytes sent to
 * the data service as they come. The encoder sets the pace: drawing waits while it has several frames.
 */
async function exportVideo(
  o: Parameters<typeof runExport>[0], plan: VideoPlan, jobId: string, renderer: MapRenderer,
  p: { basemap: Basemap | null; terrain: Ground | null; videoFills: Parameters<typeof prepareVideos>[0]; f0: number; f1: number; started: number },
): Promise<ExportResult> {
  const { width, height } = plan;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
  const shot: ShotSettings = { ...o.shot, transparent: false };
  const all = PASS_DEFS.find((d) => d.name === 'all')!;
  const sink = new UploadSink((at, bytes) => Api.sendVideoBytes(o.projectId, jobId, at, bytes));
  const encoder = new VideoFileEncoder(plan, sink.write);
  const total = p.f1 - p.f0 + 1;
  try {
    for (let frame = p.f0; frame <= p.f1; frame++) {
      if (o.isCancelled?.()) throw new Error('Export cancelled.');
      const detail = await detailForFrame(o.world, shot, frame, width, height, p.terrain);
      if (p.videoFills.length) await prepareVideos(p.videoFills, frame / shot.fps);
      renderFrame(ctx, renderer, o.world, o.engine, shot, frame, all, width, height, p.basemap, p.terrain, detail);
      await encoder.add(canvas);
      await sink.room();
      o.onProgress?.(frame - p.f0 + 1, total);
    }
    await encoder.finish();
    await sink.done();
  } catch (e) {
    encoder.close();
    await sink.done().catch(() => undefined);
    throw e;
  }
  const fin = await Api.finishExport(o.projectId, jobId);
  return { dir: fin.dir, checksums: {}, frames: total, seconds: (performance.now() - p.started) / 1000, file: fin.video, bytes: sink.sent };
}
