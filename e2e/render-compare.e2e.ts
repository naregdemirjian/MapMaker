// The map is drawn from prepared geometry (render-engine/plane.ts). This test draws the same scenes
// with the renderer as it was before (e2e/reference: everything through d3-geo, slow but simple) and
// compares the pictures: every projection, the 180° meridian, the poles, deep zoom, turned views,
// animated changes, coastline clipping. Run after building:
//   node --disable-warning=ExperimentalWarning e2e/render-compare.e2e.ts
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Harness, ROOT } from './harness.ts';

const h = new Harness('render-compare', 4397);

interface Scene { name: string; camera: { lon: number; lat: number; zoom: number; rotation: number; projection: string }; year: number; month?: number; basemap?: boolean; transitions?: string; loose?: boolean }

const cam = (projection: string, lon: number, lat: number, zoom: number, rotation = 0) => ({ lon, lat, zoom, rotation, projection });
const scenes: Scene[] = [];
for (const p of ['equirectangular', 'equalEarth', 'naturalEarth', 'mercator']) {
  scenes.push({ name: `${p} world`, camera: cam(p, 0, 0, 0), year: 1900 });
  scenes.push({ name: `${p} world from the Pacific`, camera: cam(p, 170, 0, 0), year: 1900 });
  scenes.push({ name: `${p} Europe`, camera: cam(p, 15, 50, 2.5), year: 1900 });
  scenes.push({ name: `${p} across 180°`, camera: cam(p, -178, 62, 2.2), year: 1900 });
  scenes.push({ name: `${p} Europe with coasts`, camera: cam(p, 12, 47, 3), year: 1900, basemap: true });
}
scenes.push({ name: 'small world (zoomed out)', camera: cam('equirectangular', 40, 10, -0.8), year: 1900 });
scenes.push({ name: 'Antarctica', camera: cam('equirectangular', 0, -75, 1.5), year: 1900 });
scenes.push({ name: 'turned 30°', camera: cam('equirectangular', 20, 45, 2, 30), year: 1900 });
scenes.push({ name: 'turned world', camera: cam('equalEarth', 100, 0, 0, -20), year: 1900 });
scenes.push({ name: 'close in', camera: cam('equirectangular', 6.13, 49.61, 8), year: 1900 });
scenes.push({ name: 'very close in', camera: cam('equirectangular', 6.13, 49.61, 14), year: 1900 });
scenes.push({ name: 'deep, on a long straight border', camera: cam('equirectangular', -100, 49, 11), year: 1900 });
scenes.push({ name: 'Mercator close in, north', camera: cam('mercator', 25, 68, 6), year: 1900 });
scenes.push({ name: 'world with coasts', camera: cam('equirectangular', 0, 10, 0), year: 1900, basemap: true });
scenes.push({ name: 'coasts close in', camera: cam('equirectangular', 23.7, 38, 6.5), year: 1900, basemap: true });
// Animated changes: a fade, an expansion and an advancing front, part of the way through; and a shot animating every change.
scenes.push({ name: 'fade under way', camera: cam('equirectangular', 20, 50, 2.5), year: 1951, month: 7 });
scenes.push({ name: 'expansion under way', camera: cam('equirectangular', 20, 50, 2.5), year: 1961, month: 7 });
scenes.push({ name: 'advancing front under way', camera: cam('equalEarth', 20, 50, 2.5), year: 1971, month: 7 });
scenes.push({ name: 'advancing front with coasts', camera: cam('equirectangular', 20, 50, 3), year: 1971, month: 4, basemap: true });
scenes.push({ name: 'after the changes', camera: cam('equirectangular', 20, 50, 2.5), year: 1990 });

try {
  const refFile = join(ROOT, '.tmp', 'render-reference.js');
  await build({ entryPoints: [join(ROOT, 'e2e/reference/entry.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', outfile: refFile, logLevel: 'warning' });
  await h.open();
  const { page } = h;

  await h.step('A project with countries across the world, and animated changes', async () => {
    await page.getByTestId('project-name').fill('Render compare');
    await page.getByTestId('project-create').click();
    await page.getByTestId('map-canvas').waitFor();
    await page.waitForFunction(() => !!(window as any).__mapmaker.store.basemap);
    await page.addScriptTag({ path: refFile });
    const made = await page.evaluate(async () => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const Y = (y: number) => B.gregorian.fromCivil({ year: y });
      const file = await (await fetch('data/natural-earth/countries-50m.json')).json();
      const all = B.decodeCountries(file);
      const want = ['Russia', 'France', 'Germany', 'Poland', 'Ukraine', 'Italy', 'Spain', 'United Kingdom', 'Norway', 'Sweden', 'Finland', 'Turkey', 'Greece', 'Luxembourg', 'Belgium', 'Netherlands', 'Switzerland', 'Austria',
        'United States of America', 'Canada', 'Brazil', 'Fiji', 'New Zealand', 'Antarctica', 'Australia', 'China', 'India', 'Japan', 'Indonesia', 'South Africa', 'Lesotho', 'Egypt', 'Kazakhstan', 'Mongolia', 'Greenland', 'Mexico', 'Argentina', 'Chile'];
      const countries = all.filter((c: any) => want.includes(c.name)).map((c: any) => ({ name: c.name, polygons: c.polygons, color: B.COUNTRY_GROUP_COLORS[c.colorGroup - 1] }));
      s.execute((w: any, e: any) => B.commands.addCountries(w, e, { spaceId: s.spaceId, layerId: s.layerId, countries, mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
      const id = (name: string) => s.world.all('entity').find((e: any) => e.name === name).id;
      const ring = (cx: number, cy: number, rx: number, ry: number) => Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return B.lonLatToVec(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); });
      // Three animated changes (two years each) and a plain one.
      const change = (name: string, year: number, owner: string, shape: unknown, style: string | null) => s.execute((w: any, e: any) => {
        const ev = B.commands.createEvent(w, { name, start: Y(year), end: style ? Y(year + 2) : null });
        const p = B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: shape, value: id(owner), snap: 1e-7, mode: { kind: 'new', eventId: ev.result }, transition: style ? { style } : null });
        return { label: p.label, diffs: [...ev.diffs, ...p.diffs], result: null };
      });
      change('Fade', 1950, 'Germany', ring(17, 52, 5, 3), 'fade');
      change('Expansion', 1960, 'France', ring(8, 46, 4, 3), 'advance');
      change('Front', 1970, 'Poland', ring(27, 51, 6, 4), 'border');
      change('Plain', 1980, 'Italy', ring(14, 45, 3, 2), null);
      // A large country over open sea (so its area includes much water), and a ring round the planet.
      s.execute((w: any) => B.commands.createEntity(w, { type_id: 'polity', name: 'Oceania League', color: '#3d8f8f' }));
      s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(-150, -10, 25, 18), value: id('Oceania League'), snap: 1e-7, mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
      await s.flush();
      const arr = s.world.arrangement(s.spaceId);
      return { parcels: arr.leafFaces().length, segments: arr.segments.size };
    });
    assert.ok(made.parcels > 300 && made.segments > 20000, JSON.stringify(made));
  });

  await h.step(`${scenes.length} scenes drawn both ways are the same picture`, async () => {
    const W = 1100, H = 640;
    const results = await page.evaluate(async ({ scenes, W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench, Ref = (window as any).__reference;
      const fresh = new B.MapRenderer(), old = new Ref.MapRenderer();
      // The comparison is of geometry: both draw at the finest detail, from the same basemap data.
      fresh.quality = { tolerance: 0.05, margin: 0.4 };
      fresh.caching = 'always'; // through the kept pictures, as exports are drawn
      const only50 = { version: s.basemap.version, scales: s.basemap.scales.filter((x: any) => x.scale === '50m') };
      const layers = s.world.all('layer').filter((l: any) => l.space_id === s.spaceId && l.kind === 'partition').map((l: any) => l.id);
      const canvas = () => { const c = new OffscreenCanvas(W, H); return c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; };
      const a = canvas(), b = canvas();
      type Result = { name: string; differing: number; worstBlock: number; mean: number; stray: number; lost: number; ink: number; png?: string; fresh?: string; old?: string };
      const out: Result[] = [];
      const toPng = async (pixels: Uint8ClampedArray) => {
        const c = new OffscreenCanvas(W, H);
        (c.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
        const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(bin);
      };
      for (const sc of scenes) {
        const view = B.makeView(sc.camera, W, H);
        const t = B.gregorian.fromCivil({ year: sc.year, month: sc.month ?? 1, day: 1 });
        // 1. Everything but the border lines: the pictures must be the same.
        // (The reference renderer predates rivers, D99: they are left out of both pictures.)
        const opts = { passes: new Set(['background', 'graticule', 'land', 'fills']), transparent: false, layerIds: layers, basemap: sc.basemap ? only50 : null, show: { rivers: false } };
        fresh.render(a, view, s.world, s.engine, s.spaceId, t, opts);
        old.render(b, view, s.world, s.engine, s.spaceId, t, opts);
        const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
        // Pixels that differ clearly, their share, and the worst 8x8 block (a missing or extra area fills whole blocks).
        let differing = 0, sum = 0;
        const bw = Math.ceil(W / 8), blocks = new Uint16Array(bw * Math.ceil(H / 8));
        const diff = new Uint8ClampedArray(W * H * 4);
        for (let i = 0, p = 0; i < da.length; i += 4, p++) {
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
          sum += d;
          const bad = d > 40;
          if (bad) { differing++; blocks[Math.floor((p % W) / 8) + bw * Math.floor(Math.floor(p / W) / 8)]++; }
          diff[i] = bad ? 255 : da[i] >> 1; diff[i + 1] = bad ? 0 : da[i + 1] >> 1; diff[i + 2] = bad ? 0 : da[i + 2] >> 1; diff[i + 3] = 255;
        }
        let worst = 0;
        for (const n of blocks) if (n > worst) worst = n;
        // 2. The border lines on their own: in the same places. (Their ink is not compared: the old
        // renderer drew every border segment as a stroke of its own, and where segments are smaller
        // than a pixel the overlapping strokes came out darker than the line's width; the lines are
        // now continuous and keep their true width at every zoom.)
        const bo = { passes: new Set(['borders']), transparent: true, layerIds: layers, basemap: sc.basemap ? only50 : null, show: { rivers: false } };
        fresh.render(a, view, s.world, s.engine, s.spaceId, t, bo);
        old.render(b, view, s.world, s.engine, s.spaceId, t, bo);
        const ia = a.getImageData(0, 0, W, H).data, ib = b.getImageData(0, 0, W, H).data;
        const nearInk = (d: Uint8ClampedArray, x: number, y: number, min: number) => {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && d[(yy * W + xx) * 4 + 3] > min) return true;
          }
          return false;
        };
        let inkNew = 0, strayNew = 0, inkOld = 0, lostOld = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4 + 3;
          if (ia[i] > 96) { inkNew++; if (!nearInk(ib, x, y, 24)) { strayNew++; diff[i - 3] = 255; diff[i - 2] = 255; diff[i - 1] = 0; } }
          if (ib[i] > 140 && !nearInk(ia, x, y, 16)) {
            // The old renderer drew a stray line along the south pole's edge of the map (a border
            // segment ending on the pole, which has no longitude of its own): not a border, not counted.
            const ll = view.projection.invert([x, y]);
            if (ll && ll[1] < -89) continue;
            lostOld++; diff[i - 3] = 255; diff[i - 2] = 0; diff[i - 1] = 255;
          }
          if (ib[i] > 140) inkOld++;
        }
        const r: Result = { name: sc.name, differing: differing / (W * H), worstBlock: worst, mean: sum / (W * H), stray: inkNew ? strayNew / inkNew : 0, lost: inkOld ? lostOld / inkOld : 0, ink: inkNew };
        if (r.differing > 0.004 || worst > 40 || r.stray > 0.01 || r.lost > 0.02) { r.png = await toPng(diff); r.fresh = await toPng(da); r.old = await toPng(db); }
        out.push(r);
      }
      return out;
    }, { scenes, W, H });
    let failed = 0;
    for (const r of results) {
      const ok = r.differing <= 0.004 && r.worstBlock <= 40 && r.stray <= 0.01 && r.lost <= 0.02;
      console.log(`    ${ok ? 'same' : 'DIFFERENT'}  ${r.name}: ${(r.differing * 100).toFixed(3)}% of pixels differ (worst 8x8 block ${r.worstBlock}/64); borders: ${(r.stray * 100).toFixed(2)}% of new ink away from the old lines, ${(r.lost * 100).toFixed(2)}% of old lines without new ink`);
      if (!ok) {
        failed++;
        const base = join(h.out, r.name.replace(/[^\w]+/g, '_'));
        if (r.png) writeFileSync(`${base}_DIFFERENCE.png`, Buffer.from(r.png, 'base64'));
        if (r.fresh) writeFileSync(`${base}_new.png`, Buffer.from(r.fresh, 'base64'));
        if (r.old) writeFileSync(`${base}_reference.png`, Buffer.from(r.old, 'base64'));
      }
    }
    assert.equal(failed, 0, `${failed} scenes differ (difference pictures in ${h.out}: red marks pixels that differ, yellow new border ink away from the old lines, magenta old lines without new ink)`);
  });

  await h.step('A picture carried along as the view moves is the picture drawn afresh', async () => {
    const W = 1100, H = 640;
    const results = await page.evaluate(async ({ W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const layers = s.world.all('layer').filter((l: any) => l.space_id === s.spaceId && l.kind === 'partition').map((l: any) => l.id);
      const canvas = () => { const c = new OffscreenCanvas(W, H); return c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; };
      const a = canvas(), b = canvas();
      const t = B.gregorian.fromCivil({ year: 1990 });
      const out: Array<{ name: string; parts: string; differing: number; worst: number; strong: number; dense: number; approximate: boolean }> = [];
      // `sides`: where the planet's east and west ends stand on the canvas. A carried picture ends
      // there on a whole pixel, a fresh one part way into one (and there a fresh picture lets what
      // lies under the land show through twice): the two columns around each end are left out.
      // Counted: pixels that differ at all (by more than 6 of 255), those that differ strongly (by
      // more than 96), and the most differing pixels in any square of 8 by 8.
      const squares = new Uint8Array(Math.ceil(W / 8) * Math.ceil(H / 8));
      const compare = (sides: number[] = []) => {
        const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
        let differing = 0, worst = 0, strong = 0, dense = 0;
        squares.fill(0);
        for (let i = 0; i < da.length; i += 4) {
          // (A colour counts for as much as the pixel is opaque: beyond a planet's outline next to
          // nothing is drawn, and the colour of that nothing is no difference.)
          const oa = da[i + 3] / 255, ob = db[i + 3] / 255;
          const d = Math.max(Math.abs(da[i] * oa - db[i] * ob), Math.abs(da[i + 1] * oa - db[i + 1] * ob), Math.abs(da[i + 2] * oa - db[i + 2] * ob), Math.abs(da[i + 3] - db[i + 3]));
          if (d <= 6) continue;
          const p = i / 4, px = p % W;
          if (sides.some((sx) => Math.abs(px + 0.5 - sx) <= 1.5)) continue;
          differing++;
          if (d > worst) worst = Math.round(d);
          if (d > 96) strong++;
          const q = (px >> 3) + ((p - px) / W >> 3) * Math.ceil(W / 8);
          if (++squares[q] > dense) dense = squares[q];
        }
        return { differing: differing / (W * H), worst, strong, dense };
      };
      // (Only maps with upright meridians have such ends: an equirectangular world is 2 pi wide at scale 1.)
      const sidesOf = (v: any) => (v.camera.projection === 'equirectangular' ? [W / 2 - Math.PI * v.projection.scale(), W / 2 + Math.PI * v.projection.scale()] : []);
      const cases = [
        { name: 'the world', zoom: 0.4, lon: 10, lat: 20, basemap: true },
        // (The planet's east and west ends are in view, or just beyond it: they stay where they are
        // on the canvas while the map moves under them.)
        { name: 'the whole world with its ends in view', zoom: -0.35, lon: -60, lat: 5, basemap: true, tall: 0.25 },
        { name: 'the world with its ends just out of view', zoom: 0.15, lon: 150, lat: 0, basemap: true, tall: 0.4 },
        { name: 'a region with coasts', zoom: 3.2, lon: 12, lat: 46, basemap: true },
        { name: 'a region without the Earth', zoom: 2.4, lon: 60, lat: 40, basemap: false },
        { name: 'close in', zoom: 6.5, lon: 14, lat: 50, basemap: true },
        // Equal Earth gives everything another shape for every middle meridian: the view keeps the
        // meridian it had while the map is moved (see Camera.meridian), so its picture only shifts.
        { name: 'Equal Earth, a region, its meridian held', zoom: 3.2, lon: 12, lat: 46, basemap: true, projection: 'equalEarth', held: true },
        { name: 'Equal Earth, the world inside its outline, its meridian held', zoom: 0.3, lon: 10, lat: 15, basemap: true, projection: 'equalEarth', held: true, tall: 0.3 },
        // Terrain (D95), drawn by the graphics card for the kept picture and its room as for a fresh one.
        { name: 'terrain with relief over the countries', zoom: 2.6, lon: 85, lat: 32, basemap: true, terrain: true },
        { name: 'Equal Earth terrain, its meridian held', zoom: 0.3, lon: 10, lat: 15, basemap: true, projection: 'equalEarth', held: true, tall: 0.3, terrain: true },
        // The sea 120 m lower (D96): the land and the territory that ends at the coast follow the terrain's coast.
        { name: 'the sea 120 m lower, territory to its coast', zoom: 3, lon: 5, lat: 54, basemap: true, sea: -120 },
      ];
      if (cases.some((c) => (c as { terrain?: boolean; sea?: number }).terrain || (c as { sea?: number }).sea) && !s.earthTerrain) {
        s.needEarthTerrain();
        while (!s.earthTerrain) await new Promise((r) => setTimeout(r, 50));
      }
      // Moves by whole pixels (right, down), one after the other.
      const moves = [[37, 0], [-5, 23], [120, -61], [0, 1], [-333, 40], [9, -200], [1, 1]];
      for (const c of cases) {
        const carried = new B.MapRenderer(), fresh = new B.MapRenderer();
        carried.carry = true;
        fresh.caching = 'off';
        const withTerrain = !!(c as { terrain?: boolean }).terrain;
        const opts = {
          passes: new Set(['background', 'graticule', 'land', 'fills', 'borders', ...(withTerrain ? ['terrain'] : [])]), transparent: false, layerIds: layers, basemap: c.basemap ? s.basemap : null,
          terrain: withTerrain ? { grid: s.earthTerrain, key: 'earth-4096', look: { colours: true, relief: true, overTerritories: true, seaFloor: true, strength: 1, palette: 'natural' } }
            : (c as { sea?: number }).sea ? { grid: s.earthTerrain, key: 'earth-4096', look: null, seaLevel: (c as { sea?: number }).sea } : null,
        };
        const held = !!(c as { held?: boolean }).held;
        const cam = { lon: c.lon, lat: c.lat, zoom: c.zoom, rotation: 0, projection: (c as { projection?: string }).projection ?? 'equirectangular', ...(held ? { meridian: c.lon } : {}) };
        let view = B.makeView(cam, W, H);
        const perDegree = (view.projection.scale() * Math.PI) / 180;
        // The view after the map has been moved by x, y pixels from the start: so many degrees a
        // pixel on a map with upright meridians; on one that holds its meridian, the place that
        // comes to the middle is read off the map as it lies (as dragging does, see panCamera).
        const v0 = view;
        const viewAt = (px: number, py: number, more: object = {}) => {
          if (!held) return B.makeView({ ...cam, lon: c.lon + px / perDegree, lat: c.lat - py / perDegree, ...more }, W, H);
          const ll = v0.projection.invert([W / 2 + px, H / 2 + py]);
          return B.makeView({ ...cam, lon: ll[0], lat: ll[1], ...more }, W, H);
        };
        carried.render(a, view, s.world, s.engine, s.spaceId, t, opts);
        let x = 0, y = 0;
        // (Far out, moves north and south are made shorter: the view cannot go past the poles, and
        // a move it cannot make whole is not the move under test.)
        const tall = (c as { tall?: number }).tall ?? 1;
        for (const [dx, dy0] of moves) {
          const dy = Math.round(dy0 * tall);
          if (!dx && !dy) continue;
          x += dx; y += dy;
          view = viewAt(x, y);
          carried.render(a, view, s.world, s.engine, s.spaceId, t, opts);
          fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
          out.push({ name: `${c.name}, moved by ${dx}, ${dy}`, parts: Object.values(carried.lastParts).join(' '), approximate: carried.lastApproximate, ...compare(sidesOf(view)) });
        }
        // Many small moves one way, then another, then back (the kept picture has room around the
        // frame and is drawn ahead of the move: see MapRenderer.slide), checked every few moves.
        // First the room around the frame is drawn, as the working view does once the view rests.
        carried.render(a, view, s.world, s.engine, s.spaceId, t, { ...opts, fillAround: true });
        fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
        out.push({ name: `${c.name}, with the room around it drawn (room left: ${carried.roomToFill})`, parts: carried.roomToFill ? 'room left' : 'moved', approximate: carried.lastApproximate, ...compare(sidesOf(view)) });
        let n = 0;
        for (const [dx, dy0, times] of [[7, 3, 45], [-11, 5, 40], [0, -9, 30], [13, 0, 30], [-4, 4, 25]]) {
          const dy = Math.round(dy0 * tall);
          for (let i = 0; i < times; i++) {
            x += dx; y += dy;
            view = viewAt(x, y);
            carried.render(a, view, s.world, s.engine, s.spaceId, t, { ...opts, moving: true });
            if (++n % 6 && i !== times - 1) continue;
            fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
            out.push({ name: `${c.name}, after ${n} small moves (the last by ${dx}, ${dy})`, parts: Object.values(carried.lastParts).join(' '), approximate: carried.lastApproximate, ...compare(sidesOf(view)) });
          }
        }
        // A move by part of a pixel, and a zoom, while moving: approximate; drawn afresh once at rest.
        const off = viewAt(x + 10.4, y, { zoom: c.zoom + 0.2 });
        carried.render(a, off, s.world, s.engine, s.spaceId, t, { ...opts, moving: true });
        const during = { parts: Object.values(carried.lastParts).join(' '), approximate: carried.lastApproximate };
        carried.render(a, off, s.world, s.engine, s.spaceId, t, opts);
        fresh.render(b, off, s.world, s.engine, s.spaceId, t, opts);
        out.push({ name: `${c.name}, at rest after a zoom (${during.parts}, approximate: ${during.approximate})`, parts: during.approximate ? 'moved moved' : 'not approximate', approximate: carried.lastApproximate, ...compare(sidesOf(off)) });
      }
      return out;
    }, { W, H });
    // The same outline is not shaded the same to the last grey level in two pictures: the browser
    // smooths an edge a little differently according to how much else is in the path it is drawn
    // with, and a carried picture is put together from other paths (other blocks of the plane) than
    // a fresh one. Two fresh pictures of one view differ in the same way when their geometry was
    // prepared around different places: a few dozen pixels along coasts, by a tenth of full
    // contrast. So: at most 0.05% of the pixels may differ at all, no more than a handful strongly,
    // and nowhere many together (an area not drawn, or drawn a pixel off, fails all three).
    let failed = 0, most = 0;
    for (const r of results) {
      const ok = r.parts.split(' ').every((p) => p === 'moved') && !r.approximate && r.differing <= 0.0005 && r.strong <= 6 && r.dense < 28;
      if (!ok) failed++;
      most = Math.max(most, r.differing);
      if (!ok || process.env.VERBOSE) console.log(`    ${ok ? 'same' : 'DIFFERENT'}  ${r.name}: parts ${r.parts}; ${(r.differing * 100).toFixed(4)}% of pixels differ (largest difference ${r.worst}; ${r.strong} strongly; at most ${r.dense} in a square of 8 by 8)`);
    }
    console.log(`    (the most pixels differing in any of ${results.length} comparisons: ${(most * 100).toFixed(4)}%; allowed 0.05%)`);
    assert.equal(failed, 0, `${failed} of ${results.length} carried pictures differ from fresh ones`);
  });

  await h.step('After an edit only the changed area is drawn again, and the picture is the one drawn afresh', async () => {
    const W = 1100, H = 640;
    const results = await page.evaluate(async ({ W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const layers = s.world.all('layer').filter((l: any) => l.space_id === s.spaceId && l.kind === 'partition').map((l: any) => l.id);
      const canvas = () => { const c = new OffscreenCanvas(W, H); return c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; };
      const a = canvas(), b = canvas();
      const t = B.gregorian.fromCivil({ year: 1995 });
      const owners = s.world.all('entity').filter((e: any) => e.type_id === 'polity').map((e: any) => e.id);
      const ring = (cx: number, cy: number, r: number) => Array.from({ length: 48 }, (_, i) => { const q = (i / 48) * Math.PI * 2; return B.lonLatToVec(cx + r * 1.3 * Math.cos(q), cy + r * Math.sin(q)); });
      const out: Array<{ name: string; part: string; differing: number; worst: number }> = [];
      // `sides`: where the planet's east and west ends stand on the canvas. A carried picture ends
      // there on a whole pixel, a fresh one part way into one (and there a fresh picture lets what
      // lies under the land show through twice): the two columns around each end are left out.
      const compare = (sides: number[] = []) => {
        const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
        let differing = 0, worst = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
          if (d <= 6) continue;
          const px = (i / 4) % W;
          if (sides.some((sx) => Math.abs(px + 0.5 - sx) <= 1.5)) continue;
          differing++;
          if (d > worst) worst = d;
        }
        return { differing: differing / (W * H), worst };
      };
      const sidesOf = (v: any) => [W / 2 - Math.PI * v.projection.scale(), W / 2 + Math.PI * v.projection.scale()];
      for (const c of [{ name: 'a region with coasts', zoom: 3.2, lon: 12, lat: 46, basemap: true }, { name: 'a region without the Earth', zoom: 2.6, lon: 20, lat: 48, basemap: false }]) {
        const working = new B.MapRenderer(), fresh = new B.MapRenderer();
        working.carry = true;
        working.verify = true;
        fresh.caching = 'off';
        const opts = { passes: new Set(['background', 'graticule', 'land', 'fills', 'borders']), transparent: false, layerIds: layers, basemap: c.basemap ? s.basemap : null };
        const view = B.makeView({ lon: c.lon, lat: c.lat, zoom: c.zoom, rotation: 0, projection: 'equirectangular' }, W, H);
        // Another view of the same place: everything is drawn again there, from what the renderer keeps about each country.
        const other = B.makeView({ lon: c.lon + 1.5, lat: c.lat - 0.8, zoom: c.zoom + 0.55, rotation: 0, projection: 'equirectangular' }, W, H);
        working.render(a, view, s.world, s.engine, s.spaceId, t, opts);
        fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
        const before = compare();
        // Brush strokes near the middle of the view, each given to another country from now on; then one taken back.
        for (let i = 0; i < 4; i++) {
          s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: layers[0], ring: ring(c.lon - 6 + i * 4, c.lat + (i % 2) * 2, 0.9 + i * 0.3), value: owners[(i * 7) % owners.length], snap: 1e-7, mode: { kind: 'correct', t: B.gregorian.fromCivil({ year: 1900 }) } }));
          working.render(a, view, s.world, s.engine, s.spaceId, t, opts);
          fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
          // (Compared with how far the two ways of drawing were apart before the stroke: a patch must add nothing.)
          const now = compare();
          out.push({ name: `${c.name}, stroke ${i + 1}`, part: working.lastParts['territory:fb'], differing: Math.max(0, now.differing - before.differing), worst: now.worst });
          // The whole picture drawn again elsewhere: borders of the neighbours of a country that was drawn in must still be there.
          working.render(a, other, s.world, s.engine, s.spaceId, t, opts);
          fresh.render(b, other, s.world, s.engine, s.spaceId, t, opts);
          out.push({ name: `${c.name}, stroke ${i + 1}, seen from elsewhere`, part: working.lastParts['territory:fb'] === 'drawn' ? 'patched' : `${working.lastParts['territory:fb']} (expected drawn)`, ...compare() });
          working.render(a, view, s.world, s.engine, s.spaceId, t, opts);
        }
        // Strokes in the middle of countries, touching no border: the country is cut in two parcels with
        // new numbers, and nothing about its neighbours changes; their borders with it must stay.
        const arr = s.world.arrangement(s.spaceId);
        const held = s.engine.partitionState(s.spaceId, layers[0], t);
        const inside: Array<{ face: number; lon: number; lat: number; owner: string }> = [];
        for (const [face, st] of held) {
          if (!st.value || inside.length >= 5) continue;
          const g = working.faceGeo(arr, face);
          if (g.area < 0.0008 || g.area > 0.05 || Math.abs(g.centroid[0] - c.lon) > 9 || Math.abs(g.centroid[1] - c.lat) > 5) continue;
          if (arr.locate(B.lonLatToVec(g.centroid[0], g.centroid[1])) !== face) continue;
          inside.push({ face, lon: g.centroid[0], lat: g.centroid[1], owner: st.value });
        }
        for (const [i, spot] of inside.entries()) {
          s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: layers[0], ring: ring(spot.lon, spot.lat, 0.1), value: owners.find((o: string) => o !== spot.owner), snap: 1e-7, mode: { kind: 'correct', t: B.gregorian.fromCivil({ year: 1900 }) } }));
          working.render(a, view, s.world, s.engine, s.spaceId, t, opts);
          fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
          const now = compare();
          out.push({ name: `${c.name}, a stroke inside country ${i + 1}`, part: working.lastParts['territory:fb'], differing: Math.max(0, now.differing - before.differing), worst: now.worst });
          working.render(a, other, s.world, s.engine, s.spaceId, t, opts);
          fresh.render(b, other, s.world, s.engine, s.spaceId, t, opts);
          out.push({ name: `${c.name}, a stroke inside country ${i + 1}, seen from elsewhere`, part: working.lastParts['territory:fb'] === 'drawn' ? 'patched' : `${working.lastParts['territory:fb']} (expected drawn)`, ...compare() });
          working.render(a, view, s.world, s.engine, s.spaceId, t, opts);
        }
        out.push({ name: `${c.name}: ${inside.length} strokes inside countries`, part: inside.length >= 3 ? 'patched' : 'too few countries in view', differing: 0, worst: 0 });
        await s.flush();
        s.undo();
        await s.flush();
        working.render(a, view, s.world, s.engine, s.spaceId, t, opts);
        fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
        const after = compare();
        out.push({ name: `${c.name}, the last stroke undone`, part: working.lastParts['territory:fb'], differing: Math.max(0, after.differing - before.differing), worst: after.worst });
        out.push({ name: `${c.name}, before any stroke (kept pictures against drawing directly)`, part: 'patched', differing: before.differing, worst: before.worst });
      }
      await s.flush();
      return out;
    }, { W, H });
    let failed = 0;
    for (const r of results) {
      // (An undo may need the whole picture: land going back to no one has no box of its own.)
      const ok = (r.part === 'patched' || (/undone/.test(r.name) && r.part === 'drawn')) && r.differing <= (/before any stroke|from elsewhere/.test(r.name) ? 0.0005 : 0.00005);
      if (!ok) failed++;
      if (!ok || process.env.VERBOSE) console.log(`    ${ok ? 'same' : 'DIFFERENT'}  ${r.name}: territory ${r.part}; ${(r.differing * 100).toFixed(4)}% of pixels differ (largest difference ${r.worst})`);
    }
    assert.equal(failed, 0, `${failed} of ${results.length} patched pictures differ from fresh ones`);
  });

  await h.step('While a change animates only its area is drawn again, and every frame is the picture drawn afresh', async () => {
    const W = 1100, H = 640;
    const animatedScenes = scenes.filter((sc) => /under way|front with coasts/.test(sc.name));
    assert.ok(animatedScenes.length >= 3, 'scenes with a change under way');
    const results = await page.evaluate(async ({ scenes, W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const layers = s.world.all('layer').filter((l: any) => l.space_id === s.spaceId && l.kind === 'partition').map((l: any) => l.id);
      const canvas = () => { const c = new OffscreenCanvas(W, H); return c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; };
      const a = canvas(), b = canvas();
      const out: Array<{ name: string; part: string; animating: number; differing: number; worst: number; crossing?: boolean; share?: number; front?: boolean }> = [];
      const compare = () => {
        const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
        let differing = 0, worst = 0;
        for (let i = 0; i < da.length; i += 4) {
          // (A colour counts for as much as the pixel is opaque: beyond a planet's outline next to nothing is drawn.)
          const oa = da[i + 3] / 255, ob = db[i + 3] / 255;
          const d = Math.max(Math.abs(da[i] * oa - db[i] * ob), Math.abs(da[i + 1] * oa - db[i + 1] * ob), Math.abs(da[i + 2] * oa - db[i + 2] * ob), Math.abs(da[i + 3] - db[i + 3]));
          if (d <= 6) continue;
          differing++;
          if (d > worst) worst = Math.round(d);
        }
        return { differing: differing / (W * H), worst };
      };
      // (Also in an intense look, D137: a ragged front with a soft edge, a glow behind it and a wide glowing line,
      // of which only the strip the front has crossed since the frame before is drawn again, D140.)
      const intense = { mode: 'recorded', style: 'border', angle: 0, timing: 'event', seconds: 1.5, easing: 'smooth', restyleRecorded: false, front: { show: true, color: '#fff4cc', width: 3, glow: 26 }, roughness: 0.5, soft: 0.4, wake: 0.7, secondsSince: () => 0 };
      for (const sc of scenes) for (const way of ['as exports are drawn', 'as the working view is drawn', 'as exports are drawn, in an intense look']) {
        const kept = new B.MapRenderer(), fresh = new B.MapRenderer();
        if (way !== 'as the working view is drawn') kept.caching = 'always'; else kept.carry = true;
        kept.verify = true;
        fresh.caching = 'off';
        const view = B.makeView(sc.camera, W, H);
        const opts = { passes: new Set(['background', 'graticule', 'land', 'fills', 'borders']), transparent: false, layerIds: layers, basemap: sc.basemap ? s.basemap : null, ...(way.endsWith('intense look') ? { transitions: intense } : {}) };
        const t0 = B.gregorian.fromCivil({ year: sc.year, month: sc.month ?? 1, day: 1 });
        // Moments a few days apart, forwards and back (as playing and scrubbing do).
        for (const days of [0, 3, 6, 9, 4, 12, 15]) {
          const t = { day: t0.day + days, ms: t0.ms };
          kept.render(a, view, s.world, s.engine, s.spaceId, t, opts);
          fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
          out.push({ name: `${sc.name}, ${way}, day ${days}`, part: kept.lastParts['territory:fb'], animating: kept.lastTransitions.length, share: kept.lastRedraw.renew, front: kept.lastTransitions.every((q: any) => q.style !== 'fade'), ...compare() });
        }
        // Into a change, out of it at either end, and from one change to another (as dragging the
        // timeline through a history does): in the working view only the areas of the changes, and
        // the land that changed hands, are drawn again.
        if (way === 'as the working view is drawn') {
          const Y = (y: number, mo: number) => B.gregorian.fromCivil({ year: y, month: mo, day: 1 });
          // (Each change runs for two years from the start of its decade: 1950, 1960, 1970.)
          const start = Math.floor(sc.year / 10) * 10;
          const steps: Array<[string, unknown]> = [['back before it starts', Y(start - 1, 6)], ['under way again', Y(start, 9)], ['on to after it ends', Y(start + 3, 2)], ['back to under way', Y(start + 1, 3)],
            ['to another change under way', Y(start === 1970 ? 1961 : start + 11, 2)], ['back to this one under way', Y(start + 1, 8)]];
          for (const [label, t] of steps) {
            kept.render(a, view, s.world, s.engine, s.spaceId, t, opts);
            fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
            out.push({ name: `${sc.name}, ${way}, ${label}`, part: kept.lastParts['territory:fb'], animating: kept.lastTransitions.length, crossing: true, ...compare() });
          }
        }
      }
      return out;
    }, { scenes: animatedScenes, W, H });
    let failed = 0, renewed = 0, crossed = 0;
    for (const r of results) {
      if (r.part === 'renewed') renewed++;
      if (r.crossing && r.part === 'patched') crossed++;
      const ok = r.differing <= 0.0002 && (!r.crossing || r.part === 'patched');
      if (!ok) failed++;
      if (!ok || process.env.VERBOSE) console.log(`    ${ok ? 'same' : 'DIFFERENT'}  ${r.name}: territory ${r.part}${r.share !== undefined ? ` (${(r.share * 100).toFixed(1)}% of the frame)` : ''}, ${r.animating} animating; ${(r.differing * 100).toFixed(4)}% of pixels differ (largest difference ${r.worst})`);
    }
    assert.equal(failed, 0, `${failed} of ${results.length} frames of animated changes differ from frames drawn afresh`);
    assert.ok(renewed >= results.length / 3, `the animated area alone was drawn again in ${renewed} of ${results.length} frames`);
    assert.ok(crossed >= 6 * animatedScenes.length, `stepping into, out of and between changes drew only their areas again in ${crossed} of ${6 * animatedScenes.length} steps`);
  });

  await h.step('The frames of an export, each drawn from the one before, are the frames drawn afresh', async () => {
    const W = 960, H = 540;
    const results = await page.evaluate(async ({ W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const Y = (y: number) => B.gregorian.fromCivil({ year: y });
      const canvas = () => { const c = new OffscreenCanvas(W, H); return c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; };
      const a = canvas(), b = canvas();
      const compare = () => {
        const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
        let differing = 0, worst = 0;
        for (let i = 0; i < da.length; i += 4) {
          const oa = da[i + 3] / 255, ob = db[i + 3] / 255;
          const d = Math.max(Math.abs(da[i] * oa - db[i] * ob), Math.abs(da[i + 1] * oa - db[i + 1] * ob), Math.abs(da[i + 2] * oa - db[i + 2] * ob), Math.abs(da[i + 3] - db[i + 3]));
          if (d <= 6) continue;
          differing++;
          if (d > worst) worst = Math.round(d);
        }
        return { differing: differing / (W * H), worst };
      };
      const out: Array<{ name: string; part: string; differing: number; worst: number }> = [];
      const defs = ['all', 'fills', 'borders'].map((n) => B.PASS_DEFS.find((d: any) => d.name === n));
      const still = { lon: 20, lat: 50, zoom: 2.5, rotation: 0, projection: 'equirectangular' };
      // Forty years in 80 frames: the changes of 1950, 1960 and 1970 animate for two years each, the
      // one of 1980 happens at once. Then a short shot whose camera moves (nothing can be kept).
      const shots: Array<[string, any]> = [['a still camera', B.defaultShot(s.spaceId, still, Y(1945), Y(1985), 24, 80 / 24)]];
      const moving = B.defaultShot(s.spaceId, still, Y(1949), Y(1953), 24, 16 / 24);
      moving.camera[1].camera = { ...still, lon: 26, zoom: 2.8 };
      shots.push(['a moving camera', moving]);
      for (const [label, shot] of shots) {
        // One renderer for every pass of every frame, as an export has; and one that keeps nothing.
        const kept = new B.MapRenderer(), fresh = new B.MapRenderer();
        kept.quality = { ...B.EXPORT_QUALITY }; fresh.quality = { ...B.EXPORT_QUALITY };
        kept.caching = 'always'; fresh.caching = 'off';
        kept.verify = true;
        for (let frame = 0; frame < shot.frames; frame++) for (const def of defs) {
          B.renderFrame(a, kept, s.world, s.engine, shot, frame, def, W, H, s.basemap);
          const part = Object.entries(kept.lastParts).filter(([n]) => n.startsWith('territory')).map(([, v]) => v).join(' ');
          B.renderFrame(b, fresh, s.world, s.engine, shot, frame, def, W, H, s.basemap);
          out.push({ name: `${label}, frame ${frame}, ${def.name}`, part, ...compare() });
        }
      }
      return out;
    }, { W, H });
    let failed = 0;
    const how: Record<string, number> = {};
    for (const r of results) {
      const ok = r.differing <= 0.0002;
      if (!ok) failed++;
      if (/a still camera/.test(r.name)) how[r.part] = (how[r.part] ?? 0) + 1;
      if (!ok || process.env.VERBOSE) console.log(`    ${ok ? 'same' : 'DIFFERENT'}  ${r.name}: territory ${r.part}; ${(r.differing * 100).toFixed(4)}% of pixels differ (largest difference ${r.worst})`);
    }
    console.log(`    (the still shot's ${Object.values(how).reduce((p, q) => p + q, 0)} pictures: ${Object.entries(how).map(([k, n]) => `${n} ${k}`).join(', ')})`);
    assert.equal(failed, 0, `${failed} of ${results.length} exported pictures differ from pictures drawn afresh`);
    // After the first frame nothing is drawn whole again: only where a change is under way, or where land changed hands.
    assert.ok((how.patched ?? 0) >= 9 && (how.renewed ?? 0) >= 9 && (how.drawn ?? 0) <= 3, `how the still shot's pictures were drawn: ${JSON.stringify(how)}`);
  });

  await h.step('Borders while fronts move: inside the land a front has reached only the front itself, no seam behind it; two changes meeting share a border only where a front has come', async () => {
    const W = 1100, H = 640;
    const r = await page.evaluate(async ({ W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const Y = (y: number, mo = 1) => B.gregorian.fromCivil({ year: y, month: mo, day: 1 });
      const V = (lon: number, lat: number) => B.lonLatToVec(lon, lat);
      const box = (w: number, so: number, e: number, n: number) => [V(w, so), V(e, so), V(e, n), V(w, n)];
      // Three countries in the open South Atlantic, west to east: West, Middle and East. West's border
      // with Middle zigzags (48 teeth): a front from it starts from many pieces at once.
      for (const [name, color] of [['Zig West', '#c0392b'], ['Zig Middle', '#2a9d8f'], ['Zig East', '#e9c46a']]) s.execute((w: any) => B.commands.createEntity(w, { type_id: 'polity', name, color }));
      const id = (name: string) => s.world.all('entity').find((e: any) => e.name === name).id;
      const always = { kind: 'correct', t: { day: -Infinity, ms: 0 } };
      const paint = (ring: unknown, owner: string, mode: unknown = always, transition: unknown = null) => s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring, value: id(owner), snap: 1e-7, mode, transition }));
      paint(box(-21, -20, -10, -10), 'Zig Middle');
      paint(box(-10, -20, -5, -10), 'Zig East');
      const zig: Array<[number, number]> = [];
      for (let i = 0; i <= 48; i++) zig.push([i % 2 ? -20.0 : -20.6, -21 + i * 0.25]);
      paint([V(-26, -21), ...zig.map(([lo, la]) => V(lo, la)), V(-26, -9)], 'Zig West');
      // From 2000 to 2002, at once and as two events: West takes Middle's west from the zigzag, East
      // takes Middle's east from its straight border; they meet at 15 °W.
      const change = (name: string, owner: string, ring: unknown) => s.execute((w: any, e: any) => {
        const ev = B.commands.createEvent(w, { name, start: Y(2000), end: Y(2002) });
        const p = B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring, value: id(owner), snap: 1e-7, mode: { kind: 'new', eventId: ev.result }, transition: { style: 'border', easing: 'linear' } });
        return { label: p.label, diffs: [...ev.diffs, ...p.diffs], result: null };
      });
      change('West advances', 'Zig West', box(-21, -19, -15, -11));
      change('East advances', 'Zig East', box(-15, -19, -10, -11));
      await s.flush();
      const view = B.makeView({ lon: -15, lat: -15, zoom: 4, rotation: 0, projection: 'equirectangular' }, W, H);
      const P = (lon: number, lat: number) => view.projection([lon, lat]) as [number, number];
      const fresh = new B.MapRenderer();
      fresh.caching = 'always';
      const c = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      const draw = (t: unknown, passes: string[]) => {
        fresh.render(c, view, s.world, s.engine, s.spaceId, t, { passes: new Set(passes), transparent: passes[0] !== 'background', layerIds: [s.layerId], basemap: null, show: { rivers: false } });
        return c.getImageData(0, 0, W, H).data;
      };
      const mid = Y(2001);
      const ink = draw(mid, ['borders']);
      const progress = fresh.lastTransitions.map((q: any) => Math.round(q.progress * 100) / 100);
      const inked = (x: number, y: number) => ink[(Math.round(y) * W + Math.round(x)) * 4 + 3] > 96;
      // The zigzag where the front starts (between 19 and 11 °S), on screen; distance to it.
      const src = zig.filter(([, la]) => la >= -19 - 1e-9 && la <= -11 + 1e-9).map(([lo, la]) => P(lo, la));
      const toSource = (x: number, y: number) => {
        let d = Infinity;
        for (let i = 0; i + 1 < src.length; i++) {
          const [ax, ay] = src[i], [bx, by] = src[i + 1], dx = bx - ax, dy = by - ay;
          const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
          d = Math.min(d, Math.hypot(x - ax - k * dx, y - ay - k * dy));
        }
        return d;
      };
      // 1. Inside the land West's front has reached (4 px clear of its edges and of the zigzag): every
      //    line there is the front, at one distance from the zigzag.
      const [x0, y0] = P(-19.9, -11), [x1, y1] = P(-15, -19);
      const dists: number[] = [];
      for (let y = Math.ceil(y0 + 4); y < y1 - 4; y++) for (let x = Math.ceil(x0 + 4); x < x1 - 4; x++) if (inked(x, y)) dists.push(toSource(x, y));
      // 2. The old border along the zigzag, behind the front: gone.
      let oldInk = 0, oldAt = 0;
      // (Its first and last two teeth are left out: the reached land's edges meet the zigzag there.)
      for (let i = 2; i + 3 < src.length; i++) {
        const [ax, ay] = src[i], [bx, by] = src[i + 1];
        for (let k = 1; k < 8; k++) { oldAt++; if (inked(ax + ((bx - ax) * k) / 8, ay + ((by - ay) * k) / 8)) oldInk++; }
      }
      // 3. Where the two changes meet (15 °W, between 17 and 13 °S): neither front is there yet, so no border.
      const meetAt = (data: Uint8ClampedArray) => {
        const [mx] = P(-15, -15), [, ya] = P(-15, -13), [, yb] = P(-15, -17);
        let n = 0, on = 0;
        for (let y = Math.ceil(ya); y < yb; y++) { n++; let any = false; for (let dx = -2; dx <= 2; dx++) if (data[(y * W + Math.round(mx) + dx) * 4 + 3] > 96) any = true; if (any) on++; }
        return on / n;
      };
      const meetMid = meetAt(ink);
      // 4. The fills: along the zigzag, behind the front, West's colour exactly as in its own land.
      const fill = draw(mid, ['background', 'fills']);
      const at = (x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [fill[i], fill[i + 1], fill[i + 2]]; };
      const own = at(...P(-23, -15));
      let seam = 0;
      for (let i = 2; i + 3 < src.length; i++) {
        const [ax, ay] = src[i], [bx, by] = src[i + 1];
        for (let k = 0; k <= 8; k++) { const q = at(ax + ((bx - ax) * k) / 8, ay + ((by - ay) * k) / 8); seam = Math.max(seam, ...q.map((v, j) => Math.abs(v - own[j]))); }
      }
      // 5. After both: their border where they met.
      const meetAfter = meetAt(draw(Y(2003), ['borders']));
      return { progress, n: dists.length, spread: dists.length ? Math.max(...dists) - Math.min(...dists) : 0, near: dists.length ? Math.min(...dists) : 0, oldInk, oldAt, meetMid, meetAfter, seam, own };
    }, { W, H });
    console.log(`    halfway (${r.progress.join(', ')}): ${r.n} pixels of line inside the reached land, ${r.near.toFixed(1)} to ${(r.near + r.spread).toFixed(1)} px from the zigzag; old border ${r.oldInk}/${r.oldAt}; where they meet ${(r.meetMid * 100).toFixed(0)}% inked, after ${(r.meetAfter * 100).toFixed(0)}%; seam ${r.seam}`);
    assert.ok(r.progress.length === 2 && r.progress.every((p: number) => p > 0.4 && p < 0.6), `both changes halfway (${r.progress})`);
    assert.ok(r.n >= 40, `the front is drawn inside the land it has reached (${r.n} pixels)`);
    assert.ok(r.spread <= 6, `every line inside the reached land is the front, at one distance from the border it started from (${r.near.toFixed(1)} to ${(r.near + r.spread).toFixed(1)} px)`);
    assert.ok(r.oldInk === 0, `the old border behind the front is gone (${r.oldInk} of ${r.oldAt} places inked)`);
    assert.ok(r.meetMid === 0, `no border where the two changes meet before either front is there (${(r.meetMid * 100).toFixed(0)}% inked)`);
    assert.ok(r.meetAfter > 0.9, `their border once both have passed (${(r.meetAfter * 100).toFixed(0)}% inked)`);
    assert.ok(r.seam <= 6, `no seam behind the front: the land along the old border is the new owner's colour (${r.seam} levels off ${r.own})`);
  });

  await h.step('Looks (D137): a soft edge running ahead of the front, a glow over the land just taken, the line in the new owner\'s colour and only across the land, patches for a dissolve, an event\'s own look', async () => {
    const W = 1100, H = 640;
    const r = await page.evaluate(async ({ W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const Y = (y: number, mo = 1) => B.gregorian.fromCivil({ year: y, month: mo, day: 1 });
      // (The countries and changes of the step before: West takes Middle's west from the zigzag, East its east.)
      const view = B.makeView({ lon: -15, lat: -15, zoom: 4, rotation: 0, projection: 'equirectangular' }, W, H);
      const P = (lon: number, lat: number) => view.projection([lon, lat]) as [number, number];
      const fresh = new B.MapRenderer();
      const c = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      const base = { mode: 'recorded', style: 'border', angle: 0, timing: 'event', seconds: 1.5, easing: 'linear', restyleRecorded: false, front: { show: false, color: '#ffffff', width: 2.2, glow: 0 }, roughness: 0, soft: 0, wake: 0, secondsSince: () => 0 };
      const draw = (look: Record<string, unknown> | null, t = Y(2001)) => {
        fresh.render(c, view, s.world, s.engine, s.spaceId, t, { passes: new Set(['background', 'fills']), transparent: false, layerIds: [s.layerId], basemap: null, show: { rivers: false }, ...(look ? { transitions: { ...base, ...look } } : {}) });
        const d = c.getImageData(0, 0, W, H).data;
        return (x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      };
      const dist = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      const sum = (a: number[]) => a[0] + a[1] + a[2];
      // Along 15 °S, from the zigzag eastward through West's change.
      const y = P(-17, -15)[1], xa = P(-19.9, -15)[0], xb = P(-15.2, -15)[0];
      const clean = draw(base);
      const west = clean(...P(-23, -15)), middle = clean(...P(-17, -19.6)), east = clean(...P(-7, -15));
      // 1. The front: where West's colour ends (clean: a sharp edge).
      let front = xa;
      for (let x = Math.ceil(xa); x < xb; x++) if (dist(clean(x, y), west) <= 8) front = x;
      const mixed = (px: (x: number, y: number) => number[]) => { let n = 0; for (let x = Math.ceil(xa); x < xb; x++) { const q = px(x, y); if (dist(q, west) > 12 && dist(q, middle) > 12) n++; } return n; };
      const soft = draw({ soft: 0.6 });
      let softAhead = 0;
      for (let x = front + 2; x < xb; x++) if (dist(soft(x, y), middle) > 12) softAhead = x - front;
      // 2. The glow behind the front: brighter just behind it, the land long taken as it was.
      const wake = draw({ wake: 0.8 });
      const behind = sum(wake(front - 6, y)) - sum(west), longTaken = dist(wake(xa + 4, y), west);
      // 3. The line in the new owner's colour (lightened), across the land only: none along the change's edge behind it.
      const lined = draw({ front: { show: true, color: 'auto', width: 4, glow: 0 } });
      const want = [192 + (255 - 192) * 0.45, 57 + (255 - 57) * 0.45, 43 + (255 - 43) * 0.45].map(Math.round);
      let onLine = 255;
      for (let x = front - 4; x <= front + 4; x++) onLine = Math.min(onLine, dist(lined(x, y), want));
      const ye = P(-17, -11.12)[1];
      let alongEdge = 255;
      for (let x = Math.ceil(xa + 4); x < front - 12; x++) alongEdge = Math.min(alongEdge, dist(lined(x, ye), want));
      // 4. A dissolve: patches all over the change, not a front from the zigzag.
      const dis = draw({ restyleRecorded: true, style: 'dissolve' });
      const [x0, y0] = P(-20, -11.5), [x1, y1] = P(-15.4, -18.5), third = (x1 - x0) / 3;
      let n = 0, westish = 0, westFar = 0, midNear = 0;
      for (let yy = Math.ceil(y0); yy < y1; yy += 2) for (let x = Math.ceil(x0); x < x1; x += 2) {
        const q = dis(x, yy); n++;
        const w = dist(q, west) <= 16, md = dist(q, middle) <= 16;
        if (w) westish++;
        if (w && x > x1 - third) westFar++;
        if (md && x < x0 + third) midNear++;
      }
      // 5. An event's own look, in the working view: West's change glows behind its front, East's does not.
      const ev = s.world.all('event').find((e: any) => e.name === 'West advances').id;
      s.execute((w: any) => B.commands.setEventLook(w, ev, 'blitz'));
      await s.flush();
      const own = draw(null);
      const glowing = (px: (x: number, y: number) => number[], colour: number[], from: number, to: number) => { let k = 0, all = 0; for (let yy = Math.ceil(y0) + 4; yy < y1 - 4; yy += 2) for (let x = Math.ceil(from); x < to; x += 2) { all++; if (sum(px(x, yy)) - sum(colour) > 30) k++; } return k / Math.max(1, all); };
      const westGlow = glowing(own, west, xa, front);
      const eastFront = (() => { let f = P(-10.2, -15)[0]; for (let x = Math.ceil(P(-10.2, -15)[0]); x > P(-15, -15)[0]; x--) if (dist(clean(x, y), east) <= 8) f = x; return f; })();
      const eastGlow = glowing(own, east, eastFront + 3, P(-10.3, -15)[0]);
      s.execute((w: any) => B.commands.setEventLook(w, ev, null));
      await s.flush();
      return { front: Math.round(front - xa), mixedClean: mixed(clean), mixedSoft: mixed(soft), softAhead, behind, longTaken, onLine, alongEdge, westish: westish / n, westFar, midNear, westGlow, eastGlow };
    }, { W, H });
    console.log(`    front ${r.front} px from the zigzag; mixed colours: clean ${r.mixedClean} px, soft ${r.mixedSoft} px (${r.softAhead} px ahead); glow behind +${r.behind}, long taken ${r.longTaken}; line ${r.onLine} off the owner's colour, along the edge ${r.alongEdge}; dissolve ${(r.westish * 100).toFixed(0)}% taken (${r.westFar} far, ${r.midNear} near still held); event look: West ${(r.westGlow * 100).toFixed(0)}% glowing, East ${(r.eastGlow * 100).toFixed(0)}%`);
    assert.ok(r.front > 40, `the front has come some way (${r.front} px)`);
    assert.ok(r.mixedClean <= 3, `clean: a sharp edge (${r.mixedClean} px of mixed colour)`);
    assert.ok(r.mixedSoft >= 12 && r.softAhead >= 12, `soft: the new colour runs softly ahead (${r.mixedSoft} px mixed, ${r.softAhead} px ahead)`);
    assert.ok(r.behind > 40, `a glow over the land just taken (+${r.behind})`);
    assert.ok(r.longTaken <= 6, `the land taken long before as it was (${r.longTaken} off)`);
    assert.ok(r.onLine <= 30, `the line in the new owner's colour, lightened (${r.onLine} off)`);
    assert.ok(r.alongEdge > 60, `no line along the change's own edge behind the front (${r.alongEdge} off the line's colour at best)`);
    assert.ok(r.westish > 0.15 && r.westish < 0.85, `a dissolve: part of the change taken (${(r.westish * 100).toFixed(0)}%)`);
    assert.ok(r.westFar > 10 && r.midNear > 10, `in patches all over, not from the zigzag (${r.westFar} taken in the far third, ${r.midNear} still held in the near third)`);
    assert.ok(r.westGlow > 0.08 && r.eastGlow < 0.01, `an event's own look: its change glows (${(r.westGlow * 100).toFixed(0)}%), the other's not (${(r.eastGlow * 100).toFixed(0)}%)`);
  });

  await h.step('Fronts that mind the land (D142): slower over mountains, quicker over the plain beside them; as ever without heights or when not asked', async () => {
    const W = 1100, H = 640;
    const r = await page.evaluate(({ W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const view = B.makeView({ lon: -15, lat: -15, zoom: 4, rotation: 0, projection: 'equirectangular' }, W, H);
      const P = (lon: number, lat: number) => view.projection([lon, lat]) as [number, number];
      const fresh = new B.MapRenderer();
      const c = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      // Heights: plains everywhere; rugged mountains over the northern half of West's change (north of 15 °S).
      const gw = 1440, gh = 720, data = new Int16Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const lon = -180 + (i + 0.5) * 0.25, lat = 90 - (j + 0.5) * 0.25;
        data[j * gw + i] = lat > -15 && lat < -10 && lon > -21 && lon < -15 ? (i % 2 ? 2600 : 100) : 100;
      }
      const ground = { grid: { width: gw, height: gh, step: 1, data }, key: 'test-ground', seaLevel: 0 };
      const base = { mode: 'recorded', style: 'border', angle: 0, timing: 'event', seconds: 1.5, easing: 'linear', restyleRecorded: false, front: { show: false, color: '#ffffff', width: 2.2, glow: 0 }, roughness: 0, soft: 0, wake: 0, terrain: 0, secondsSince: () => 0 };
      const mid = B.gregorian.fromCivil({ year: 2001, month: 1, day: 1 }), early = B.gregorian.fromCivil({ year: 2000, month: 4, day: 1 });
      const draw = (terrain: number, heights: unknown, t: unknown = mid) => {
        fresh.render(c, view, s.world, s.engine, s.spaceId, t, { passes: new Set(['background', 'fills']), transparent: false, layerIds: [s.layerId], basemap: null, show: { rivers: false }, frontGround: heights, transitions: { ...base, terrain } });
        return c.getImageData(0, 0, W, H).data;
      };
      const clean = draw(0, ground);
      const at = (d: Uint8ClampedArray, x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      const dist = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      const west = at(clean, ...P(-23, -15));
      const xa = P(-19.9, -15)[0], xb = P(-15.2, -15)[0];
      // How far West's colour has come from the zigzag, in pixels: over the mountains (13 °S) and over the plain (17 °S).
      const come = (d: Uint8ClampedArray) => [-13, -17].map((lat) => { const y = P(-17, lat)[1]; let f = xa; for (let x = Math.ceil(xa); x < xb; x++) if (dist(at(d, x, y), west) <= 8) f = x; return Math.round(f - xa); });
      const differ = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) n++; return n; };
      const minding = draw(1, ground), noHeights = draw(1, null), again = draw(0, ground);
      // (An eighth of the way through, the plain is not all taken yet: how far, by how much the land is minded.)
      const e0 = come(draw(0, ground, early)), eh = come(draw(0.5, ground, early)), e1 = come(draw(1, ground, early));
      return { span: Math.round(xb - xa), clean: come(clean), minding: come(minding), e0, eh, e1, noHeights: differ(noHeights, clean), again: differ(again, clean) };
    }, { W, H });
    console.log(`    of ${r.span} px, over the mountains and over the plain: an eighth through ${r.e0.join(' and ')} px as ever, ${r.eh.join(' and ')} minding the land by half, ${r.e1.join(' and ')} fully; halfway ${r.clean.join(' and ')} as ever, ${r.minding.join(' and ')} minding; without heights ${r.noHeights} pixels differ, not asked again ${r.again}`);
    assert.ok(Math.abs(r.e0[0] - r.e0[1]) <= 10 && Math.abs(r.clean[0] - r.clean[1]) <= 10, `not asked: the front as far over the mountains as over the plain (${r.e0.join(' and ')}, then ${r.clean.join(' and ')} px)`);
    assert.ok(r.e1[1] - r.e1[0] >= 25, `minding the land: behind over the mountains (${r.e1[0]} px against ${r.e1[1]} px over the plain)`);
    assert.ok(r.e1[1] >= r.eh[1] + 8 && r.eh[1] >= r.e0[1] + 8, `the more it minds, the further over the plain meanwhile (${r.e0[1]}, ${r.eh[1]}, ${r.e1[1]} px)`);
    assert.ok(r.e1[0] <= r.e0[0] + 4 && r.eh[0] <= r.e0[0] + 4, `and no further over the mountains (${r.e0[0]}, ${r.eh[0]}, ${r.e1[0]} px)`);
    assert.ok(r.minding[1] >= r.clean[1] + 25 && r.minding[0] < r.span - 40, `halfway: the plain taken while the mountains hold out (${r.minding.join(' and ')} of ${r.span} px)`);
    assert.equal(r.noHeights, 0, 'a map without heights: the front as ever');
    assert.equal(r.again, 0, 'not asked again: the picture as before');
  });

  await h.step('The globe: every place where the flat map has it, lit; nothing beyond its edge or from its far side; a pole and the 180° meridian without a seam; the flat picture kept while it turns, and the whole frame between changes', async () => {
    const W = 1100, H = 640;
    const r = await page.evaluate(({ W, H }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const layers = s.world.all('layer').filter((l: any) => l.space_id === s.spaceId && l.kind === 'partition').map((l: any) => l.id);
      const t = B.gregorian.fromCivil({ year: 1990 });
      const canvas = () => new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      const a = canvas(), b = canvas();
      const globe = new B.MapRenderer(), flat = new B.MapRenderer();
      globe.caching = 'always';
      const opaque = { passes: new Set(['background', 'land', 'fills']), transparent: false, layerIds: layers, basemap: s.basemap, show: { rivers: false } };
      const px = (c: OffscreenCanvasRenderingContext2D, x: number, y: number) => Array.from(c.getImageData(Math.round(x), Math.round(y), 1, 1).data);
      // The light the sphere is shaded with (globe-gl.ts), at a point of it.
      const L = [-0.45, 0.55, 0.7], ll = Math.hypot(...L);
      const shadeAt = (u: number, v: number) => { const z = Math.sqrt(Math.max(0, 1 - u * u - v * v)); const lit = 0.4 + 0.6 * Math.max(0, (u * L[0] + v * L[1] + z * L[2]) / ll); return 1 - 0.55 * (1 - lit); };
      // 1. Places on the near side: the flat map's colour there, as lit.
      const gv = B.makeView({ lon: 10, lat: 42, zoom: 0.5, rotation: 0, projection: 'globe' }, W, H);
      globe.render(a, gv, s.world, s.engine, s.spaceId, t, opaque);
      const first = globe.lastGlobe;
      const R = gv.projection.scale();
      const places: Array<[string, number, number]> = [['France', 2.5, 46.5], ['Spain', -3.7, 40.2], ['Poland', 19.4, 52.1], ['Ukraine', 31, 49], ['Turkey', 35, 39], ['Germany', 10.3, 51], ['Italy', 12.5, 42.8], ['Russia', 45, 58], ['Egypt', 29, 26.5]];
      const worst: number[] = [];
      for (const [, lon, lat] of places) {
        const fv = B.makeView({ lon, lat, zoom: 3, rotation: 0, projection: 'equirectangular' }, W, H);
        flat.render(b, fv, s.world, s.engine, s.spaceId, t, opaque);
        const want = px(b, W / 2, H / 2);
        const [x, y] = gv.projection([lon, lat]);
        const got = px(a, x, y), k = shadeAt((x - W / 2) / R, -(y - H / 2) / R);
        worst.push(Math.max(...[0, 1, 2].map((i) => Math.abs(got[i] - want[i] * k))));
      }
      // 2. Beyond the edge: in a picture without a background, nothing of the sphere (names, upright over it,
      //    may reach a little past its edge); and the far side gives no places or names.
      globe.render(a, gv, s.world, s.engine, s.spaceId, t, { ...opaque, passes: new Set(['fills', 'borders']), transparent: true });
      let beyond = 0, n = 0;
      for (let i = 0; i < 360; i += 3) { const q = (i * Math.PI) / 180; const x = W / 2 + Math.cos(q) * R * 1.04, y = H / 2 + Math.sin(q) * R * 1.04; if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; if (px(a, x, y)[3] > 0) beyond++; }
      globe.render(a, gv, s.world, s.engine, s.spaceId, t, { ...opaque, passes: new Set(['fills', 'borders', 'labels']), transparent: true });
      const names = globe.lastLabels.filter((l: any) => l.drawn).map((l: any) => l.text);
      const outside = globe.lastLabels.filter((l: any) => l.drawn && Math.hypot(l.x - W / 2, l.y - H / 2) > R).length;
      const farSide = gv.projection([134, -25]); // Australia
      // 3. A pole in view: the picture goes all the way round, and the pole is land or sea, not a hole.
      const pv = B.makeView({ lon: 0, lat: 75, zoom: 0, rotation: 0, projection: 'globe' }, W, H);
      globe.render(a, pv, s.world, s.engine, s.spaceId, t, opaque);
      const pole = pv.projection([0, 90]), polePx = px(a, pole[0], pole[1]), round = globe.lastGlobe.round;
      // 4. Across 180°: the open sea on both sides of the meridian the same.
      const dv = B.makeView({ lon: 180, lat: 0, zoom: 1.5, rotation: 0, projection: 'globe' }, W, H);
      globe.render(a, dv, s.world, s.engine, s.spaceId, t, opaque);
      let seam = 0;
      for (let lat = -8; lat <= 8; lat += 2) {
        const [x, y] = dv.projection([180, lat]);
        const mid = px(a, x, y), side = px(a, x + 3, y);
        seam = Math.max(seam, ...[0, 1, 2].map((i) => Math.abs(mid[i] - side[i])));
      }
      // 5. Turned a little while moving (tipped 4° north): the flat picture kept, as it still holds all in
      //    view (only the sphere drawn again); at rest, drawn for the view.
      const mv = (lat: number) => B.makeView({ lon: 10, lat, zoom: 0.5, rotation: 0, projection: 'globe' }, W, H);
      globe.render(a, mv(42), s.world, s.engine, s.spaceId, t, opaque);
      globe.render(a, mv(46), s.world, s.engine, s.spaceId, t, { ...opaque, moving: true });
      const moving = { reused: globe.lastGlobe.reused, approximate: globe.lastApproximate, ms: Math.round(globe.lastGlobe.ms) };
      globe.render(a, mv(46), s.world, s.engine, s.spaceId, t, opaque);
      const rest = { approximate: globe.lastApproximate };
      // 6. Months later, between the same two changes and nothing moving: the frame drawn last serves again
      //    (names too), and it is the frame drawn afresh (as kept pictures are: within a level or few, D57).
      const all = { ...opaque, passes: new Set(['background', 'graticule', 'land', 'fills', 'borders', 'labels']) };
      const later = { day: t.day + 60, ms: t.ms };
      globe.render(a, mv(46), s.world, s.engine, s.spaceId, t, all);
      globe.render(a, mv(46), s.world, s.engine, s.spaceId, { day: t.day + 30, ms: t.ms }, all);
      globe.render(a, mv(46), s.world, s.engine, s.spaceId, later, all);
      const again = { reused: globe.lastGlobe.reused, ms: Math.round(globe.lastGlobe.ms * 10) / 10, names: globe.lastLabels.filter((l: any) => l.drawn).length };
      const afresh = new B.MapRenderer();
      afresh.render(b, mv(46), s.world, s.engine, s.spaceId, later, all);
      const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
      let differ = 0, most = 0;
      for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3])); if (d > 2) differ++; most = Math.max(most, d); }
      return { worst, beyond, n, names, outside, farSide, polePx, round, seam, moving, rest, first, again, differ, most };
    }, { W, H });
    console.log(`    places off their lit colour by at most ${Math.max(...r.worst).toFixed(1)} levels; ${r.beyond}/${r.n} points beyond the edge drawn; ${r.names.length} names (${r.outside} off the globe); pole ${JSON.stringify(r.polePx)} (all round: ${r.round}); across 180° ${r.seam}; turning: ${JSON.stringify(r.moving)}, at rest ${JSON.stringify(r.rest)}; first picture ${JSON.stringify(r.first)}; months later ${JSON.stringify(r.again)}, ${r.differ} pixels off a fresh frame by at most ${r.most}`);
    assert.ok(Math.max(...r.worst) <= 8, `each place has the flat map's colour, lit (${r.worst.map((w: number) => w.toFixed(1)).join(', ')})`);
    assert.equal(r.beyond, 0, 'nothing beyond the globe in a picture without a background');
    assert.ok(r.names.includes('France') && r.names.includes('Egypt') && !r.names.includes('Australia') && r.outside === 0, `names of the near side only, on the globe (${r.names.length})`);
    assert.equal(r.farSide, null, 'a place on the far side has no place on the frame');
    assert.ok(r.round && r.polePx[3] === 255 && r.polePx[0] + r.polePx[1] + r.polePx[2] > 30, `the pole drawn (${r.polePx})`);
    assert.ok(r.seam <= 6, `no seam along 180° (${r.seam})`);
    assert.ok(r.moving.reused && r.moving.approximate && !r.rest.approximate, 'the flat picture kept while turning, drawn afresh at rest');
    assert.ok(r.again.reused && r.again.names > 10, `between two changes, the frame drawn last serves again (${JSON.stringify(r.again)})`);
    assert.ok(r.differ < 0.0005 * W * H && r.most <= 16, `and it is the frame drawn afresh (${r.differ} pixels off, by at most ${r.most})`);
  });

  await h.step('In a shot animating every change, a change whose land changes hands again soon after is over by then: the next starts from all of it, nothing jumps', async () => {
    const r = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const Y = (y: number) => B.gregorian.fromCivil({ year: y });
      const V = (lon: number, lat: number) => B.lonLatToVec(lon, lat);
      const box = (w: number, so: number, e: number, n: number) => [V(w, so), V(e, so), V(e, n), V(w, n)];
      for (const [name, color] of [['Quick A', '#8e44ad'], ['Quick B', '#16a085'], ['Quick C', '#d35400']]) s.execute((w: any) => B.commands.createEntity(w, { type_id: 'polity', name, color }));
      const id = (name: string) => s.world.all('entity').find((e: any) => e.name === name).id;
      // In the open Pacific: A's land; B takes part of it in 2030 and C the same part in 2031, each at once
      // (as imported maps of those years do).
      s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: box(-150, -10, -140, 0), value: id('Quick A'), snap: 1e-7, mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
      const change = (name: string, year: number, owner: string) => s.execute((w: any, e: any) => {
        const ev = B.commands.createEvent(w, { name, start: Y(year), end: null });
        const p = B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: box(-148, -8, -142, -2), value: id(owner), snap: 1e-7, mode: { kind: 'new', eventId: ev.result } });
        return { label: p.label, diffs: [...ev.diffs, ...p.diffs], result: null };
      });
      change('B takes it', 2030, 'Quick B');
      change('C takes it', 2031, 'Quick C');
      // Ten years a second, from 2025 to 2045 at an even pace, every change animated for 1.5 s.
      const shot = B.defaultShot(s.spaceId, { lon: -145, lat: -5, zoom: 3, rotation: 0, projection: 'equirectangular' }, Y(2025), Y(2045), 24, 2);
      shot.time = shot.time.map((k: any) => ({ ...k, ease: 'linear' }));
      shot.width = 640; shot.height = 360; shot.overlays = [];
      shot.transitions = { mode: 'all', style: 'border', angle: 0, timing: 'seconds', seconds: 1.5, easing: 'linear', restyleRecorded: false };
      const frameOf = (y: number) => ((Y(y).day - Y(2025).day) / (Y(2045).day - Y(2025).day)) * (shot.frames - 1);
      const r = new B.MapRenderer();
      const c = new OffscreenCanvas(640, 360).getContext('2d') as OffscreenCanvasRenderingContext2D;
      const all = B.PASS_DEFS.find((d: any) => d.name === 'all');
      const at = (frame: number) => { B.renderFrame(c, r, s.world, s.engine, shot, frame, all, 640, 360); return r.lastTransitions.map((q: any) => Math.round(q.progress * 1000) / 1000); };
      const before = Math.floor(frameOf(2031)), first = Math.ceil(frameOf(2030));
      return { first: at(first), before: at(before), after: at(before + 2), frames: [first, before, frameOf(2030), frameOf(2031)] };
    });
    console.log(`    the first change ${JSON.stringify(r.first)} as it starts, ${JSON.stringify(r.before)} just before the next, then the next ${JSON.stringify(r.after)} (frames ${r.frames.map((f: number) => f.toFixed(2)).join(', ')})`);
    assert.ok(r.first.length === 1 && r.first[0] < 0.6, `the first change under way (${r.first})`);
    assert.ok(r.before.length === 1 && r.before[0] > 0.85, `over (or nearly) just before the land changes hands again, not part way (${r.before})`);
    assert.ok(r.after.length === 1 && r.after[0] < 0.5, `then only the next under way (${r.after})`);
  });

  await h.finish();
} catch (e) {
  await h.finish(e);
}
