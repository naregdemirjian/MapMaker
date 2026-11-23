// SVG frames (Stage 10, D115): one frame of a shot as an SVG file for drawing programs (Illustrator,
// Inkscape, Affinity) and print. Territories, borders, areas, lines and points, cities, names,
// characters and texts are shapes and text in named groups (layers), stacked as the export passes
// are; the sea, terrain, grid, land and conditions are pictures beneath and among them. The pictures
// are drawn by the same renderer as the image sequences, and the map's own drawing of features,
// cities, names, characters and texts writes its shapes through an SVG pen (svg-pen.ts), so the file
// shows what the frame shows. Territories and borders are made from the parcels' outlines here (the
// renderer draws them through kept pictures and masks): ending at the coast through masks of the
// land made by the renderer, borders against nobody left out along the coast as the renderer does.
// What a frame is in the middle of (a change being animated) is shown as the map is at that moment,
// without the animation; front lines along wars keep their teeth; the look's grade is an SVG filter.
import { geoPath, geoBounds, geoClipRectangle, type GeoProjection } from 'd3-geo';
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import type { Instant } from '../core-time/index.ts';
import { MapRenderer, DEFAULT_STYLE, EXPORT_QUALITY, FRONT_COLOR, FRONT_SIDE, mediaBox, drawTeeth, warsAt, type PassName, type TerritoryFill, type RenderOptions, type FrontTeeth } from '../render-engine/map-renderer.ts';
import { SvgPen, SvgPath, withSvgPaths, esc, num } from '../export/svg-pen.ts';
import { frameSetup, basemapFor, terrainFor, detailForFrame, drawShotOverlays, drawSpaceFrame, lookStyles, PASS_DEFS, type ExportPassDef } from './export-driver.ts';
import { territoryPolygons, facesPolygons } from '../domain/data-export.ts';
import { parcelGeometry } from '../render-engine/parcel-geometry.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import { entityStyle } from '../domain/commands.ts';
import { preloadImages, prepareVideos, imageNow, videoNow, drawImageFit } from '../render-engine/assets.ts';
import { eventsBoxOf } from './events-box.ts';
import { timeAt, type ShotSettings } from './sequence.ts';
import { GRADES, drawPaper, vignetteOf } from './looks.ts';
import { isSpaceMap, spaceSettingsOf, calendarOfSpace } from '../world-model/world-settings.ts';
import { loadNearbyStars } from '../space/catalogue.ts';
import { loadExoplanets } from '../space/exoplanets.ts';
import { parseJSON } from '../temporal-engine/engine.ts';
import { coastBorderOf, overSeaOf } from '../render-engine/border-look.ts';
import { chooseScale, pixelsPerDegree, type Box } from '../render-engine/basemap.ts';
import type { View } from '../render-engine/camera.ts';

type Position = [number, number];

/**
 * A CSS filter of a look's grade (sepia, saturate, hue-rotate, grayscale, brightness, contrast) as
 * an SVG filter with the same effect (the Filter Effects specification's equivalents, worked in
 * sRGB as CSS filters are). Null when there is nothing to do.
 */
export function gradeFilter(css: string, id: string, width: number, height: number): string | null {
  const steps: string[] = [];
  const matrix = (m: number[]) => `<feColorMatrix type="matrix" values="${m.map((v) => num(v, 5)).join(' ')}"/>`;
  const linear = (slope: number, intercept = 0) => `<feComponentTransfer>${['R', 'G', 'B'].map((c) => `<feFunc${c} type="linear" slope="${num(slope, 5)}" intercept="${num(intercept, 5)}"/>`).join('')}</feComponentTransfer>`;
  for (const m of css.matchAll(/([a-z-]+)\(\s*(-?[\d.]+)(deg|%)?\s*\)/g)) {
    const f = m[1], v = Number(m[2]) / (m[3] === '%' ? 100 : 1);
    if (!Number.isFinite(v)) continue;
    if (f === 'sepia') {
      const a = 1 - Math.min(1, Math.max(0, v));
      steps.push(matrix([0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0, 0, 0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0, 0, 0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a, 0, 0, 0, 0, 0, 1, 0]));
    } else if (f === 'grayscale') {
      const a = 1 - Math.min(1, Math.max(0, v));
      steps.push(matrix([0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0, 0, 0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0, 0, 0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a, 0, 0, 0, 0, 0, 1, 0]));
    } else if (f === 'saturate') steps.push(`<feColorMatrix type="saturate" values="${num(v, 4)}"/>`);
    else if (f === 'hue-rotate') steps.push(`<feColorMatrix type="hueRotate" values="${num(v, 3)}"/>`);
    else if (f === 'brightness') steps.push(linear(v));
    else if (f === 'contrast') steps.push(linear(v, 0.5 - 0.5 * v));
  }
  if (!steps.length) return null;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">${steps.join('')}</filter>`;
}

/**
 * The border lines an owner draws, in longitude and latitude, as the renderer chooses them: each
 * border between two owners once (from the side fixed by the line itself), and every border against
 * land nobody holds (`open`; often a coast).
 */
export function borderLines(arr: Arrangement, states: ReadonlyMap<number, { value: string | null }>, owner: string, faces: number[]): { shared: Position[][]; open: Position[][] } {
  const geom = parcelGeometry(arr), t = arr.topology();
  const gr = geom.graph(faces, t);
  const shared: Position[][] = [], open: Position[][] = [];
  for (let q = 0; q < gr.n; q++) {
    if (gr.across[q] >= 0) continue;
    const c = gr.cycle[q], i = gr.index[q];
    const across = states.get(arr.halfEdgeFace(c.heads[i] ^ 1));
    if (across === undefined) continue;
    if (across.value !== null && (across.value === owner || !c.canonical[i])) continue;
    const last = i === c.starts.length - 1;
    const line: Position[] = [];
    for (let k = c.starts[i]; k < (last ? c.lon.length : c.starts[i + 1] + 1); k++) line.push([c.lon[k], c.lat[k]]);
    // (The last chain runs back to the ring's first point, a whole turn on where the ring goes round.)
    if (last) line.push([c.lon[0] + 360 * c.wind, c.lat[0]]);
    if (line.length >= 2) (across.value === null ? open : shared).push(line);
  }
  return { shared, open };
}

/**
 * The front line an owner at war draws (D89): its border chains facing the enemy, in longitude and
 * latitude, each the way the owner's outline runs (its land on one side: the teeth go to the other).
 */
export function frontLines(arr: Arrangement, states: ReadonlyMap<number, { value: string | null }>, from: string, toward: string, faces: number[]): Position[][] {
  const geom = parcelGeometry(arr), t = arr.topology();
  const gr = geom.graph(faces, t);
  const out: Position[][] = [];
  for (let q = 0; q < gr.n; q++) {
    if (gr.across[q] >= 0) continue;
    const c = gr.cycle[q], i = gr.index[q];
    if (states.get(arr.halfEdgeFace(c.heads[i] ^ 1))?.value !== toward) continue;
    const last = i === c.starts.length - 1, line: Position[] = [];
    for (let k = c.starts[i]; k < (last ? c.lon.length : c.starts[i + 1] + 1); k++) line.push([c.lon[k], c.lat[k]]);
    if (last) line.push([c.lon[0] + 360 * c.wind, c.lat[0]]);
    if (line.length >= 2) out.push(line);
  }
  return out;
}

/** Lines in longitude and latitude as the view projects them (resampled, cut where the view cuts them): screen polylines. */
function projectLines(projection: GeoProjection, lines: Position[][]): Float32Array[] {
  const out: number[][] = [];
  let cur: number[] | null = null;
  const sink = {
    moveTo(x: number, y: number) { cur = [x, y]; out.push(cur); },
    lineTo(x: number, y: number) { (cur ??= (out.push([]), out[out.length - 1])).push(x, y); },
    closePath() { /* lines are open */ },
    arc() { /* (points have none) */ },
  };
  geoPath(projection, sink as unknown as CanvasRenderingContext2D)({ type: 'MultiLineString', coordinates: lines });
  return out.filter((l) => l.length >= 4).map((l) => Float32Array.from(l));
}

/** GeoJSON polygons (outer rings anticlockwise) as d3 reads them (outer rings clockwise). */
const forD3 = (polys: Position[][][]): GeoJSON.MultiPolygon => ({ type: 'MultiPolygon', coordinates: polys.map((p) => p.map((r) => r.slice().reverse())) });

/** Whether a box of longitudes and latitudes meets d3's bounds of a shape (which may cross 180°), widened by `pad` degrees. */
function meets(b: Box, [[w, s], [e, n]]: [[number, number], [number, number]], pad: number): boolean {
  if (b[3] < s - pad || b[1] > n + pad) return false;
  if (w <= e) return b[2] >= w - pad && b[0] <= e + pad;
  return b[2] >= w - pad || b[0] <= e + pad;
}

/** A picture as an SVG image of the whole frame. */
const frameImage = (href: string, w: number, h: number) => `<image x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" xlink:href="${href}"/>`;

/** A group drawing programs show as a layer. */
const layer = (id: string, label: string, body: string, attrs = '') => (body.trim() ? `<g id="${esc(id)}" inkscape:groupmode="layer" inkscape:label="${esc(label)}"${attrs}>\n${body}\n</g>` : '');

/** A canvas of the frame's size, its 2D context and its picture as a PNG data URL (null when nothing is on it). */
function frameCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; url: () => string | null } {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return {
    canvas, ctx,
    url: () => {
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return canvas.toDataURL('image/png');
      return null;
    },
  };
}

export interface SvgFrameOptions { world: World; engine: Engine; shot: ShotSettings; shotName: string; frame: number; scale?: number }
export interface SvgFrame { svg: string; width: number; height: number; at: Instant; skipped: string[] }

/** One frame of a shot as an SVG document (see the top of this file). */
export async function svgFrame(o: SvgFrameOptions): Promise<SvgFrame> {
  const { world, engine, shot, frame } = o;
  const W = Math.max(16, Math.round(shot.width * (o.scale ?? 1))), H = Math.max(16, Math.round(shot.height * (o.scale ?? 1)));
  const space = world.get('map_space', shot.spaceId);
  const t = timeAt(shot, frame);
  // Everything loaded before drawing, as for exports: pictures, videos at the frame's moment, stars.
  const fills = world.all('entity').map((e) => entityStyle(e).fill).filter((f): f is NonNullable<typeof f> => !!f?.asset);
  const videos = fills.filter((f) => f.kind === 'video').map((f) => ({ file: f.asset!, play: f }));
  await preloadImages([eventsBoxOf(shot.eventsBox).image, ...fills.filter((f) => f.kind === 'image').map((f) => f.asset), ...world.all('entity').map((e) => entityStyle(e).icon?.asset)]);
  if (videos.length) await prepareVideos(videos, frame / shot.fps);
  const skipped = new Set<string>();
  const note = (pen: SvgPen) => { for (const k of pen.skipped.keys()) skipped.add(k); };
  const defs: string[] = [];
  const mapLayers: string[] = [];
  const ls = lookStyles(shot);
  const all = PASS_DEFS.find((d) => d.name === 'all')!;
  let view: View | null = null;

  if (isSpaceMap(space)) {
    // A space map (D110): the stars, realms, lanes and names through the pen (realms come as a picture: they are joined offscreen).
    if (spaceSettingsOf(space)?.catalogue === 'nearby') { await loadNearbyStars(); await loadExoplanets(); }
    const pen = new SvgPen(W, H, 's');
    withSvgPaths(() => drawSpaceFrame(pen.asContext(), world, engine, shot, frame, { ...all, overlays: false }, W, H, false));
    note(pen);
    defs.push(pen.defs());
    mapLayers.push(layer('stars', 'Stars, realms, lanes and names', pen.body()));
  } else {
    const basemap = await basemapFor(world, shot.spaceId);
    const ground = await terrainFor(world, shot.spaceId, shot);
    const detail = await detailForFrame(world, shot, frame, W, H, ground);
    const setup = frameSetup(world, shot, frame, all, W, H, basemap, ground, detail, engine);
    view = setup.view;
    const { options } = setup;
    const style = options.style ?? DEFAULT_STYLE;
    const u = view.unit;
    // Pictures, drawn as the export passes draw them (without the look's finish: that is laid over everything below).
    const pictures = new MapRenderer();
    pictures.quality = { ...EXPORT_QUALITY };
    pictures.caching = 'off';
    const picture = (passes: PassName[], background: boolean): string | null => {
      const def: ExportPassDef = { name: 'svg', label: '', blend: 'Normal', passes, overlays: false, background };
      const s = frameSetup(world, shot, frame, def, W, H, basemap, ground, detail, engine);
      if (!s.options.passes.size) return null;
      const c = frameCanvas(W, H);
      pictures.render(c.ctx, s.view, world, engine, shot.spaceId, s.t, s.options);
      return c.url();
    };
    const under = picture(['background', 'terrain', 'graticule', 'land'], !shot.transparent);
    if (under) mapLayers.push(layer('background', 'Sea, terrain, grid and land (picture)', frameImage(under, W, H)));
    // A globe (D127) is a flat picture laid onto a sphere: its territories and what lies on them come as
    // pictures too (the texts over the frame stay editable).
    const globe = view.camera.projection === 'globe';
    if (globe) {
      const sphere = picture(['fills', 'borders', 'features'], false);
      if (sphere) mapLayers.push(layer('globe', 'Territories, borders, areas and lines on the globe (picture)', frameImage(sphere, W, H)));
    }

    // Territories and borders, layer by layer, as shapes.
    const masks = !globe && (options.passes.has('fills') || options.passes.has('borders')) ? pictures.svgMasks(view, shot.spaceId, options) : null;
    const maskDef = (id: string, c: OffscreenCanvas | null) => {
      if (!c) return false;
      const f = frameCanvas(W, H);
      f.ctx.drawImage(c, 0, 0);
      defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${frameImage(f.canvas.toDataURL('image/png'), W, H)}</mask>`);
      return true;
    };
    const masked = masks && masks.coast !== 'land' ? {
      fills: maskDef('land-fills', masks.fills), borders: maskDef('land-borders', masks.borders),
      band: maskDef('coast-band', masks.band), outside: maskDef('outside-coast-band', masks.outsideBand),
    } : null;
    // Countries whose land carries on over the sea where drawn (D221), and the sea alone (the land turned over) to keep it in.
    const overSea = new Set(world.all('entity').filter((e) => overSeaOf(e.style)).map((e) => e.id));
    let seaOnly: boolean | null = null;
    const seaMask = () => {
      if (seaOnly === null) {
        const land = masked ? masks?.borders : null;
        if (!land) seaOnly = false;
        else {
          const o = new OffscreenCanvas(land.width, land.height), g = o.getContext('2d')!;
          g.fillStyle = '#ffffff'; g.fillRect(0, 0, o.width, o.height);
          g.globalCompositeOperation = 'destination-out'; g.drawImage(land, 0, 0);
          seaOnly = maskDef('sea-only', o);
        }
      }
      return seaOnly;
    };
    const path = geoPath(view.projection as GeoProjection).digits(2);
    // (Long lines such as coastlines only as far as the frame reaches, turned or not.)
    const reach = Math.hypot(W, H) / 2 + 64;
    const framed = geoPath({ stream: (s) => (view!.projection as GeoProjection).stream(geoClipRectangle(W / 2 - reach, H / 2 - reach, W / 2 + reach, H / 2 + reach)(s)) }).digits(2);
    const turned = (pen: SvgPen) => {
      // (The map turned about the frame's middle, as the renderer turns it.)
      if (!view!.rotation) return;
      const c = pen.asContext();
      c.translate(W / 2, H / 2); c.rotate((view!.rotation * Math.PI) / 180); c.translate(-W / 2, -H / 2);
    };
    const fillLayers: string[] = [], borderLayers: string[] = [];
    let n = 0;
    for (const layerId of globe ? [] : options.layerIds) {
      const row = world.get('layer', layerId);
      if (!row || row.kind !== 'partition' || row.space_id !== shot.spaceId) continue;
      n++;
      const lst = parseJSON<{ fillOpacity?: number; borderWidth?: number; clipToLand?: boolean; fill?: TerritoryFill; fronts?: FrontTeeth; frontColor?: string; coastBorder?: unknown }>(row.style, {});
      const clip = !!masks && lst.clipToLand !== false;
      // How the layer's borders meet the coast (D221).
      const mode = coastBorderOf(lst);
      const states = engine.partitionState(shot.spaceId, layerId, t);
      const byOwner = new Map<string, number[]>();
      for (const [face, st] of states) if (st.value) { const l = byOwner.get(st.value); if (l) l.push(face); else byOwner.set(st.value, [face]); }
      // (Owners here whose land carries on over the sea, where the layer ends at the coast.)
      const seaOwners = new Set(clip ? [...byOwner.keys()].filter((o) => overSea.has(o)) : []);
      // (A view all sea shows none of a layer ending at the coast, but what is drawn over the sea.)
      if (clip && masks!.coast === 'sea' && mode !== 'drawn' && !seaOwners.size) continue;
      const polys = territoryPolygons(world, engine, shot.spaceId, layerId, t);
      const arr = world.arrangements.get(shot.spaceId);
      const nameOf = (id: string) => engine.nameAt(id, t) ?? world.get('entity', id)?.name ?? id;
      const colourOf = (id: string) => world.get('entity', id)?.color ?? '#888888';
      const lines = new Map<string, { shared: Position[][]; open: Position[][] }>();
      if (arr) for (const [owner, faces] of byOwner) lines.set(owner, borderLines(arr, states, owner, faces));
      const multi = (ls: Position[][]): string => (ls.length ? path({ type: 'MultiLineString', coordinates: ls }) ?? '' : '');
      // Hatched layers (D88): the owners' colours as stripes or dots, as patterns.
      const hatch = (color: string) => {
        if (!lst.fill || lst.fill === 'solid') return color;
        const size = Math.max(4, Math.round(11 * u)), id = `hatch-${n}-${color.replace(/[^\w]/g, '')}`;
        if (!defs.some((d) => d.includes(`id="${id}"`))) {
          const body = lst.fill === 'dots'
            ? `<circle cx="${num(size / 2)}" cy="${num(size / 2)}" r="${num(size * 0.2)}" fill="${esc(color)}"/>`
            : `<path d="${[-size, 0, size].map((d) => `M${d} ${size}L${d + size} 0`).join('')}${lst.fill === 'cross' ? [-size, 0, size].map((d) => `M${d} 0L${d + size} ${size}`).join('') : ''}" stroke="${esc(color)}" stroke-width="${num(Math.max(1, size * 0.26))}" stroke-linecap="square" fill="none"/>`;
          defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">${body}</pattern>`);
        }
        return `url(#${id})`;
      };
      if (options.passes.has('fills')) {
        // Land along the coast no parcel covers takes the look of the territory beside it (D83): each
        // owner's borders against nobody stroked wide in its colour, kept only in the band along the coast.
        let rim = '';
        if (clip && masks!.coast === 'mixed' && masked?.band) {
          const rp = new SvgPen(W, H, `r${n}`), rc = rp.asContext();
          turned(rp);
          rc.lineWidth = 2 * masks!.rim; rc.lineJoin = 'round'; rc.lineCap = 'round';
          for (const [owner, l] of lines) {
            const d = multi(l.open);
            if (!d) continue;
            rc.strokeStyle = hatch(colourOf(owner));
            rc.stroke(new SvgPath(d) as unknown as Path2D);
          }
          defs.push(rp.defs());
          rim = rp.body() ? `<g mask="url(#coast-band)">\n${rp.body()}\n</g>` : '';
        }
        // The territories (of `only`, when given; `tag` keeps the names of a second drawing apart).
        const territories = (prefix: string, only: ReadonlySet<string> | null, tag: string): string => {
          const pen = new SvgPen(W, H, prefix), c = pen.asContext();
          turned(pen);
          for (const [owner, p] of polys) {
            if (only && !only.has(owner)) continue;
            const geo = forD3(p), d = path(geo);
            if (!d) continue;
            const shape = new SvgPath(d) as unknown as Path2D;
            const media = entityStyle(world.get('entity', owner) ?? { style: '{}' }).fill;
            const src = media?.asset && !media.off ? (media.kind === 'video' ? videoNow(media.asset, frame / shot.fps, media, 'export') : media.kind === 'image' ? imageNow(media.asset) : null) : null;
            if (src && media && arr) {
              // A picture or video filling the territory (D81), placed piece by piece as frames place it (D82).
              const img = src as CanvasImageSource & { width: number; height: number };
              const iw = (src as HTMLVideoElement).videoWidth || img.width, ih = (src as HTMLVideoElement).videoHeight || img.height;
              let k = 0;
              for (const pl of pictures.mediaPlacements(view!, world, shot.spaceId, byOwner.get(owner) ?? [], media)) {
                const cg = forD3(facesPolygons(arr, pl.faces)), cd = path(cg);
                if (!cd) continue;
                c.save();
                c.clip(new SvgPath(cd) as unknown as Path2D, 'evenodd');
                // (One copy of several, where a piece shows more than once: only its own part of the frame.)
                if (pl.rect) { c.beginPath(); c.rect(pl.rect[0], pl.rect[1], pl.rect[2], pl.rect[3]); c.clip(); }
                pen.name(`territory-${owner}${tag}${k++ ? `-${k}` : ''}`, nameOf(owner));
                if (media.fit === 'tile') {
                  const pattern = iw && ih ? c.createPattern(src, 'repeat') : null;
                  if (pattern) {
                    pattern.setTransform(new DOMMatrix().translate(pl.at[0], pl.at[1]).scale(((media.tileSize ?? 120) * u) / iw));
                    const [[x0, y0], [x1, y1]] = path.bounds(cg);
                    c.fillStyle = pattern;
                    c.fillRect(x0, y0, x1 - x0, y1 - y0);
                  }
                } else {
                  const m = mediaBox(img, media, pl.at, pl.cover);
                  drawImageFit(c, img, m.box[0], m.box[1], m.box[2], m.box[3], m.fit);
                }
                c.restore();
              }
              continue;
            }
            pen.name(`territory-${owner}${tag}`, nameOf(owner));
            c.fillStyle = hatch(colourOf(owner));
            c.fill(shape, 'evenodd');
          }
          note(pen);
          defs.push(pen.defs());
          return pen.body();
        };
        const body = [rim, territories(`f${n}`, null, '')].filter(Boolean).join('\n');
        const opacity = (lst.fillOpacity ?? 0.78) < 1 ? ` opacity="${num(lst.fillOpacity ?? 0.78, 3)}"` : '';
        // (Countries whose land carries on over the sea, D221: drawn again, kept to the sea.)
        const over = clip && masked?.fills && seaOwners.size && seaMask() ? territories(`fs${n}`, seaOwners, '-sea') : '';
        if (over) fillLayers.push(layer(`territories-${n}`, `Territories: ${row.name}`, `<g mask="url(#land-fills)">\n${body}\n</g>\n<g mask="url(#sea-only)">\n${over}\n</g>`, opacity));
        else fillLayers.push(layer(`territories-${n}`, `Territories: ${row.name}`, body, `${opacity}${clip && masked?.fills ? ' mask="url(#land-fills)"' : ''}`));
      }
      if (options.passes.has('borders')) {
        const width = (lst.borderWidth ?? style.borderWidth) * u;
        type Lines = { shared: Position[][]; open: Position[][] };
        // (Each owner's lines a stroke takes.)
        const stroke = (prefix: string, pick: (owner: string, l: Lines) => Position[][]) => {
          const pen = new SvgPen(W, H, prefix), c = pen.asContext();
          turned(pen);
          c.strokeStyle = style.border; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round';
          for (const [owner, l] of lines) {
            const d = multi(pick(owner, l));
            if (!d) continue;
            pen.name(`border-${prefix}-${owner}`, `Border of ${nameOf(owner)}`);
            c.stroke(new SvgPath(d) as unknown as Path2D);
          }
          defs.push(pen.defs());
          return pen.body();
        };
        // Edges against nobody drawn whole, out over the sea too (D221): all of them where the layer's borders are drawn as
        // drawn, else those of countries whose land carries on over the sea. The rest end at the coast with the land.
        const whole = (owner: string) => clip && (mode === 'drawn' || seaOwners.has(owner));
        const shared = (_: string, l: Lines) => l.shared, open = (owner: string, l: Lines) => (whole(owner) ? [] : l.open);
        // Along a coast in view, borders against nobody are left out in the band along it (the coastline is the edge there, D83).
        const body = clip && mode === 'drawn' ? stroke(`bs${n}`, shared)
          : clip && masks!.coast === 'mixed' && masked?.outside
            ? [stroke(`bs${n}`, shared), `<g mask="url(#outside-coast-band)">\n${stroke(`bo${n}`, open)}\n</g>`].join('\n')
            : stroke(`b${n}`, (o, l) => [...l.shared, ...open(o, l)]);
        const over = clip && (mode === 'drawn' || seaOwners.size) ? stroke(`bw${n}`, (o, l) => (whole(o) ? l.open : [])) : '';
        // The border along the coast (D221): the coastline where the layer's land meets the sea, kept to its countries and
        // the land beside them along the coast (D83); on a coast the terrain decides, a band along the inside of the land.
        let coastLine = '';
        const coastal = clip && mode === 'coast' && masked ? [...polys.keys()].filter((o) => !seaOwners.has(o)) : [];
        if (coastal.length && masks!.coast === 'mixed' && basemap) {
          const where = new SvgPen(W, H, `cw${n}`), wc = where.asContext();
          turned(where);
          wc.fillStyle = '#ffffff'; wc.strokeStyle = '#ffffff'; wc.lineWidth = 2 * masks!.rim; wc.lineJoin = 'round'; wc.lineCap = 'round';
          const near: [[number, number], [number, number]][] = [];
          for (const o of coastal) {
            const geo = forD3(polys.get(o)!), d = path(geo);
            if (!d) continue;
            wc.fill(new SvgPath(d) as unknown as Path2D, 'evenodd');
            near.push(geoBounds(geo));
            const od = multi(lines.get(o)?.open ?? []);
            if (od) wc.stroke(new SvgPath(od) as unknown as Path2D);
          }
          // (Only the coastline near those countries, and as far as the frame reaches.)
          const b = chooseScale(basemap, view);
          const pad = (2 * masks!.rim + width) / Math.max(1e-9, pixelsPerDegree(view)) + 0.01;
          const items = near.length ? b.coastline.coordinates.filter((_, i) => near.some((x) => meets(b.boxes.coastline[i], x, pad))) : [];
          const d = items.length ? framed({ type: 'MultiLineString', coordinates: items }) ?? '' : '';
          if (d) {
            defs.push(where.defs());
            defs.push(`<mask id="coast-where-${n}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">\n${where.body()}\n</mask>`);
            const pen = new SvgPen(W, H, `bc${n}`), c = pen.asContext();
            turned(pen);
            c.strokeStyle = style.border; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round';
            pen.name(`coast-border-${n}`, 'Border along the coast');
            c.stroke(new SvgPath(d) as unknown as Path2D);
            defs.push(pen.defs());
            coastLine = `<g mask="url(#coast-where-${n})">\n${pen.body()}\n</g>`;
          }
        } else if (coastal.length && masks!.coast === 'terrain') {
          const band = pictures.svgCoastBand(view, shot.spaceId, options, Math.max(1, width));
          if (band && maskDef(`coast-line-${n}`, band)) {
            const pen = new SvgPen(W, H, `bc${n}`), c = pen.asContext();
            turned(pen);
            c.fillStyle = style.border;
            for (const o of coastal) {
              const d = path(forD3(polys.get(o)!));
              if (!d) continue;
              pen.name(`coast-border-${n}-${o}`, `Border along the coast of ${nameOf(o)}`);
              c.fill(new SvgPath(d) as unknown as Path2D, 'evenodd');
            }
            defs.push(pen.defs());
            if (pen.body()) coastLine = `<g mask="url(#coast-line-${n})">\n${pen.body()}\n</g>`;
          }
        }
        // Front lines along the wars of the moment (D89): a dark edge, the line, and teeth toward the enemy.
        let fronts = '';
        const wars = lst.fronts && arr ? warsAt(world, engine, t, lst.fronts) : [];
        if (wars.length) {
          const pen = new SvgPen(W, H, `fr${n}`), c = pen.asContext(), fw = Math.max(2.5, 4 * u), colour = lst.frontColor ?? FRONT_COLOR;
          turned(pen);
          c.lineJoin = 'round'; c.lineCap = 'round';
          for (const [from, toward] of wars) {
            const lines = projectLines(view.projection as GeoProjection, frontLines(arr!, states, from, toward, byOwner.get(from) ?? []));
            if (!lines.length) continue;
            const stroke = (style: string, width: number) => { c.strokeStyle = style; c.lineWidth = width; for (const l of lines) { c.beginPath(); c.moveTo(l[0], l[1]); for (let i = 2; i + 1 < l.length; i += 2) c.lineTo(l[i], l[i + 1]); c.stroke(); } };
            pen.name(`front-${from}-${toward}`, `Front: ${nameOf(from)} against ${nameOf(toward)}`);
            stroke('rgba(10,16,24,0.75)', fw * 2);
            stroke(colour, fw);
            if (lst.fronts !== 'plain') { c.fillStyle = colour; for (const l of lines) drawTeeth(c, l, fw * 2, FRONT_SIDE); }
          }
          defs.push(pen.defs());
          fronts = pen.body();
        }
        const inner = [body, fronts].filter(Boolean).join('\n'), beyond = [over, coastLine].filter(Boolean).join('\n');
        if (beyond && clip && masked?.borders) borderLayers.push(layer(`borders-${n}`, `Borders: ${row.name}`, `<g mask="url(#land-borders)">\n${inner}\n</g>\n${beyond}`));
        else borderLayers.push(layer(`borders-${n}`, `Borders: ${row.name}`, [inner, beyond].filter(Boolean).join('\n'), clip && masked?.borders ? ' mask="url(#land-borders)"' : ''));
      }
    }
    mapLayers.push(...fillLayers, ...borderLayers);
    // Conditions (D102): drawn on the graphics card, kept a picture.
    const fields = options.passes.has('fields') && world.all('layer').some((l) => l.kind === 'field' && l.space_id === shot.spaceId) ? picture(['fields'], false) : null;
    if (fields) mapLayers.push(layer('conditions', 'Conditions (picture)', frameImage(fields, W, H)));
    // Areas, lines and points; cities; names; characters: the renderer's own drawing, written by the pen.
    const vectors = new MapRenderer();
    vectors.quality = { ...EXPORT_QUALITY };
    vectors.caching = 'off';
    const drawn = (pass: PassName, prefix: string): string => {
      if (!options.passes.has(pass)) return '';
      const pen = new SvgPen(W, H, prefix);
      withSvgPaths(() => vectors.render(pen.asContext(), view!, world, engine, shot.spaceId, t, { ...options, passes: new Set([pass]), transparent: true } as RenderOptions));
      note(pen);
      defs.push(pen.defs());
      return pen.body();
    };
    if (globe) {
      const names = picture(['cities', 'labels', 'characters'], false);
      if (names) mapLayers.push(layer('names', 'Cities, names and characters (picture)', frameImage(names, W, H)));
    } else {
      mapLayers.push(layer('features', 'Areas, lines and points', drawn('features', 'ft')));
      mapLayers.push(layer('cities', 'Cities', drawn('cities', 'ct')));
      mapLayers.push(layer('labels', 'Labels', drawn('labels', 'lb')));
      mapLayers.push(layer('characters', 'Characters', drawn('characters', 'ch')));
    }
  }

  // The look (D108): its grade over the whole map; its darker edges and paper laid on top.
  let grade = '';
  const finish: string[] = [];
  if (ls?.finish) {
    const f = gradeFilter(GRADES[ls.look.grade]?.filter ?? '', 'look-grade', W, H);
    if (f) { defs.push(f); grade = ' filter="url(#look-grade)"'; }
    const v = vignetteOf(ls.look);
    if (v) {
      const pen = new SvgPen(W, H, 'vg'), c = pen.asContext();
      const r = Math.hypot(W, H) / 2, g = c.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
      const hex = v.color.replace('#', '');
      g.addColorStop(0, `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},0)`);
      g.addColorStop(1, `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${v.alpha.toFixed(3)})`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      defs.push(pen.defs());
      finish.push(pen.body());
    }
    if (ls.look.blotches || ls.look.grain > 0) {
      const p = frameCanvas(W, H);
      drawPaper(p.ctx, 0, 0, W, H, ls.look, W / 1920);
      const url = p.url();
      if (url) finish.push(frameImage(url, W, H));
    }
  }
  // The texts: dates, titles, text boxes and the current events (D107), over everything.
  const texts = new SvgPen(W, H, 'tx');
  withSvgPaths(() => drawShotOverlays(texts.asContext(), W, H, world, shot, frame, t, view ?? undefined, engine));
  note(texts);
  defs.push(texts.defs());

  const when = calendarOfSpace(world.get('map_space', shot.spaceId)).format(t, 'day');
  const title = `${o.shotName}: ${when}`;
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<title>${esc(title)}</title>`,
    `<desc>${esc(`Frame ${frame + 1} of ${shot.frames} of the shot "${o.shotName}", ${when}, made with Map Maker. Territories, borders, areas, lines and points, cities, names, characters and texts are shapes and text; the sea, terrain, grid, land and conditions are pictures.`)}</desc>`,
    `<defs>\n${defs.filter(Boolean).join('\n')}\n</defs>`,
    `<g id="map"${grade}>\n${mapLayers.filter(Boolean).join('\n')}\n</g>`,
    layer('finish', 'Edges and paper', finish.join('\n')),
    layer('texts', 'Texts', texts.body()),
    '</svg>',
  ].filter(Boolean).join('\n');
  return { svg, width: W, height: H, at: t, skipped: [...skipped] };
}
