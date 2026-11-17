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
        const opts = { passes: new Set(['background', 'graticule', 'land', 'fills']), transparent: false, layerIds: layers, basemap: sc.basemap ? only50 : null };
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
        const bo = { passes: new Set(['borders']), transparent: true, layerIds: layers, basemap: sc.basemap ? only50 : null };
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
      const out: Array<{ name: string; parts: string; differing: number; worst: number; approximate: boolean }> = [];
      const compare = () => {
        const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
        let differing = 0, worst = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
          if (d > 6) differing++;
          if (d > worst) worst = d;
        }
        return { differing: differing / (W * H), worst };
      };
      const cases = [
        { name: 'the world', zoom: 0.4, lon: 10, lat: 20, basemap: true },
        { name: 'a region with coasts', zoom: 3.2, lon: 12, lat: 46, basemap: true },
        { name: 'a region without the Earth', zoom: 2.4, lon: 60, lat: 40, basemap: false },
        { name: 'close in', zoom: 6.5, lon: 14, lat: 50, basemap: true },
      ];
      // Moves by whole pixels (right, down), one after the other.
      const moves = [[37, 0], [-5, 23], [120, -61], [0, 1], [-333, 40], [9, -200], [1, 1]];
      for (const c of cases) {
        const carried = new B.MapRenderer(), fresh = new B.MapRenderer();
        carried.carry = true;
        fresh.caching = 'off';
        const opts = { passes: new Set(['background', 'graticule', 'land', 'fills', 'borders']), transparent: false, layerIds: layers, basemap: c.basemap ? s.basemap : null };
        const cam = { lon: c.lon, lat: c.lat, zoom: c.zoom, rotation: 0, projection: 'equirectangular' };
        let view = B.makeView(cam, W, H);
        const perDegree = (view.projection.scale() * Math.PI) / 180;
        carried.render(a, view, s.world, s.engine, s.spaceId, t, opts);
        let x = 0, y = 0;
        for (const [dx, dy] of moves) {
          x += dx; y += dy;
          view = B.makeView({ ...cam, lon: c.lon + x / perDegree, lat: c.lat - y / perDegree }, W, H);
          carried.render(a, view, s.world, s.engine, s.spaceId, t, opts);
          fresh.render(b, view, s.world, s.engine, s.spaceId, t, opts);
          out.push({ name: `${c.name}, moved by ${dx}, ${dy}`, parts: Object.values(carried.lastParts).join(' '), approximate: carried.lastApproximate, ...compare() });
        }
        // A move by part of a pixel, and a zoom, while moving: approximate; drawn afresh once at rest.
        const off = B.makeView({ ...cam, lon: c.lon + (x + 10.4) / perDegree, lat: c.lat - y / perDegree, zoom: c.zoom + 0.2 }, W, H);
        carried.render(a, off, s.world, s.engine, s.spaceId, t, { ...opts, moving: true });
        const during = { parts: Object.values(carried.lastParts).join(' '), approximate: carried.lastApproximate };
        carried.render(a, off, s.world, s.engine, s.spaceId, t, opts);
        fresh.render(b, off, s.world, s.engine, s.spaceId, t, opts);
        out.push({ name: `${c.name}, at rest after a zoom (${during.parts}, approximate: ${during.approximate})`, parts: during.approximate ? 'moved moved' : 'not approximate', approximate: carried.lastApproximate, ...compare() });
      }
      return out;
    }, { W, H });
    let failed = 0;
    for (const r of results) {
      const ok = r.parts.split(' ').every((p) => p === 'moved') && !r.approximate && r.differing <= 0.0002;
      if (!ok) failed++;
      if (!ok || process.env.VERBOSE) console.log(`    ${ok ? 'same' : 'DIFFERENT'}  ${r.name}: parts ${r.parts}; ${(r.differing * 100).toFixed(4)}% of pixels differ (largest difference ${r.worst})`);
    }
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
      const compare = () => {
        const da = a.getImageData(0, 0, W, H).data, db = b.getImageData(0, 0, W, H).data;
        let differing = 0, worst = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
          if (d > 6) differing++;
          if (d > worst) worst = d;
        }
        return { differing: differing / (W * H), worst };
      };
      for (const c of [{ name: 'a region with coasts', zoom: 3.2, lon: 12, lat: 46, basemap: true }, { name: 'a region without the Earth', zoom: 2.6, lon: 20, lat: 48, basemap: false }]) {
        const working = new B.MapRenderer(), fresh = new B.MapRenderer();
        working.carry = true;
        fresh.caching = 'off';
        const opts = { passes: new Set(['background', 'graticule', 'land', 'fills', 'borders']), transparent: false, layerIds: layers, basemap: c.basemap ? s.basemap : null };
        const view = B.makeView({ lon: c.lon, lat: c.lat, zoom: c.zoom, rotation: 0, projection: 'equirectangular' }, W, H);
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
        }
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
      const ok = (r.part === 'patched' || (/undone/.test(r.name) && r.part === 'drawn')) && r.differing <= (/before any stroke/.test(r.name) ? 0.0005 : 0.00005);
      if (!ok) failed++;
      if (!ok || process.env.VERBOSE) console.log(`    ${ok ? 'same' : 'DIFFERENT'}  ${r.name}: territory ${r.part}; ${(r.differing * 100).toFixed(4)}% of pixels differ (largest difference ${r.worst})`);
    }
    assert.equal(failed, 0, `${failed} of ${results.length} patched pictures differ from fresh ones`);
  });

  await h.finish();
} catch (e) {
  await h.finish(e);
}
