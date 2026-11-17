// A long session of random work in the real interface, checked as it goes: strokes of every kind,
// undo and redo, jumps in time, moving and zooming the map, tools and selections, events moved and
// deleted. Everything the app works out from what was there before is also worked out afresh
// (the app's verify mode) and any difference, any error in the page, or a picture on screen that
// differs from one drawn afresh, stops the run. Also reports frame times and how memory grows.
//
// Usage: node --disable-warning=ExperimentalWarning bench/stress.ts <fixtures folder> "<project>" [--steps 400] [--seed 1]
//          [--throttle 4] (a computer that many times slower) [--scale 2] (a screen with that many pixels per point) [--no-verify]
//          [--preset fastest|best] (the working view's speed settings) [--dump <folder>] (where to write the two pictures when they differ)
//          [--projection equalEarth|naturalEarth|mercator] (the session starts in that projection; Equal Earth and Natural Earth hold their middle meridian while the map moves)
//          [--only "moving the map,zooming"] (only these kinds of step) [--profile out.cpuprofile] (a CPU profile of the session; summarise with bench/top.mjs)
// Build first (node scripts/build.mjs). The project is not changed: the run works on a copy.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { workCopy } from './tools/workcopy.ts';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name: string) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const steps = Number(flag('--steps') ?? 400), seed = Number(flag('--seed') ?? 1), throttle = Number(flag('--throttle') ?? 1), scale = Number(flag('--scale') ?? 1);
const verify = !has('--no-verify');
const preset = flag('--preset');
const dump = flag('--dump');
const projection = flag('--projection');
const only = flag('--only')?.split(',').map((q) => q.trim()) ?? null, profile = flag('--profile');
const [folder, name] = args;
if (!folder || !name) { console.error('Give the fixtures folder and the project name.'); process.exit(1); }

const work = workCopy(folder, [name]);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs'), '--port', '4458', '--projects', work.folder], { stdio: ['ignore', 'pipe', 'pipe'] });
const baseUrl = await new Promise<string>((res) => { let t = ''; server.stdout!.on('data', (d) => { t += d; const m = /running at (http:\/\/\S+)/.exec(t); if (m) res(m[1]); }); });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 600)}`); });
  await page.goto(baseUrl);
  await page.waitForFunction(() => (window as any).__mapmaker?.store.projects.length > 0);
  await page.evaluate((n) => { const s = (window as any).__mapmaker.store; return s.openProject(s.projects.find((x: any) => x.name === n).id); }, name);
  await page.getByTestId('map-canvas').waitFor();
  await page.waitForFunction(() => !!(window as any).__mapmaker.store.basemap);
  if (verify) await page.evaluate(() => (window as any).__mapmaker.verify());
  // The working view's speed settings (Settings in the app): 'fastest' or 'best'; the default is 'balanced'.
  if (preset === 'fastest') await page.evaluate(() => (window as any).__mapmaker.store.setViewSettings({ resolution: 0.75, detail: 'coarse', whileMoving: 'carry', names: 'hide', coast: 'medium', showSpeed: false }));
  if (projection) await page.evaluate((p) => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, projection: p }); }, projection);
  if (preset === 'best') await page.evaluate(() => (window as any).__mapmaker.store.setViewSettings({ resolution: 1, detail: 'fine', whileMoving: 'redraw', names: 'place', coast: 'full', showSpeed: false }));
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const t0 = Date.now();
  const result = await page.evaluate(async ({ steps, seed, only }) => {
    const m = (window as any).__mapmaker, s = m.store, B = m.bench;
    let x = seed >>> 0;
    const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
    const pick = <T,>(l: T[]): T => l[Math.floor(rnd() * l.length)];
    const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const Y = (y: number, mo = 1, d = 1) => B.gregorian.fromCivil({ year: y, month: mo, day: d });
    const events = () => s.world.all('event').filter((e: any) => e.id !== 'evt_base' && !/base/i.test(e.id));
    const owners = () => s.world.all('entity').filter((e: any) => e.type_id === 'polity').map((e: any) => e.id);
    const years = (() => { const ys = events().map((e: any) => B.gregorian.toCivil({ day: e.start_day, ms: e.start_ms }).year); return ys.length ? [Math.min(...ys) - 20, Math.max(...ys) + 20] : [1900, 2000]; })();
    const year = () => Math.round(years[0] + rnd() * (years[1] - years[0]));
    const ring = (cx: number, cy: number, r: number, n = 40) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, k = r * (1 + 0.25 * Math.sin(3 * a + cx)); return B.lonLatToVec(cx + k * 1.3 * Math.cos(a), cy + k * Math.sin(a)); });
    const cam = () => s.camera;
    const here = (): [number, number] => [cam().lon + (rnd() - 0.5) * 30 / (1 + cam().zoom), Math.max(-70, Math.min(75, cam().lat + (rnd() - 0.5) * 16 / (1 + cam().zoom)))];
    const counts: Record<string, number> = {}, refused: Record<string, number> = {};
    const took: Record<string, number[]> = {};
    const frames: number[] = [], heap: number[] = [];
    let compared = 0, worstDiff = 0;
    let pictures: { shown: string; fresh: string } | null = null;

    /** The picture on screen, once the view has come to rest, against the same view drawn by a renderer that keeps nothing. */
    const compare = async (): Promise<string | null> => {
      await wait(260); await raf();
      // (At rest the view is laid out around the camera: a meridian is held only while the map moves, see MapView.)
      if (m.heldMeridian() !== null) return `the view still holds the meridian ${m.heldMeridian()} at rest`;
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const W = c.width, H = c.height;
      const k = W / c.getBoundingClientRect().width;
      const view = B.makeView(s.camera, W / k, H / k);
      const off = new OffscreenCanvas(W, H);
      const ctx = off.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const fresh = new B.MapRenderer();
      fresh.caching = 'off';
      fresh.quality = { ...s.renderer.quality };
      const layers = s.world.all('layer').filter((l: any) => l.space_id === s.spaceId && l.kind === 'partition' && l.visible).sort((a: any, b: any) => a.sort_order - b.sort_order).map((l: any) => l.id);
      const earth = /natural-earth/.test(s.world.get('map_space', s.spaceId).settings ?? '') ? s.basemap : null;
      const what = { passes: new Set(['background', 'land', 'fills', 'borders', 'graticule']), transparent: false, layerIds: layers, basemap: earth, referenceBorders: s.referenceBorders };
      // Like with like: geometry prepared for one zoom serves from half to 1.42 times its scale, at
      // the detail of the scale it was prepared for. When the app's was prepared for another zoom
      // than the one shown, the fresh renderer prepares its own for that zoom too (by drawing that
      // view first); otherwise the two pictures show the coasts at two levels of detail.
      const ratio = s.renderer.sheet ? view.projection.scale() / s.renderer.sheet.S : 1;
      if (Math.abs(ratio - 1) > 1e-6 && ratio >= 0.5 && ratio <= 1.42) {
        fresh.render(ctx, B.makeView({ ...s.camera, zoom: s.camera.zoom - Math.log2(ratio) }, W / k, H / k), s.world, s.engine, s.spaceId, s.time, what);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.setTransform(k, 0, 0, k, 0, 0);
      }
      fresh.render(ctx, view, s.world, s.engine, s.spaceId, s.time, what);
      // Only the map itself is compared (names, cities and the tools' own drawings lie over it on screen).
      const mine = new OffscreenCanvas(W, H);
      const mctx = mine.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      mctx.setTransform(k, 0, 0, k, 0, 0);
      s.renderer.render(mctx, view, s.world, s.engine, s.spaceId, s.time, what);
      const a = mctx.getImageData(0, 0, W, H).data, b = ctx.getImageData(0, 0, W, H).data;
      // (Where the planet's east and west ends stand, a carried picture ends on a whole pixel and a
      // fresh one part way into it: the columns around them are left out.)
      const half = Math.PI * view.projection.scale();
      const sides = ['equirectangular', 'mercator'].includes(s.camera.projection) && !s.camera.rotation ? [k * (view.width / 2 - half), k * (view.width / 2 + half)] : [];
      let differing = 0, x0 = W, y0 = H, x1 = -1, y1 = -1, dense = 0;
      // (Also counted by squares of 8 by 8 pixels: a part of the picture that was not drawn again
      // fills squares, while outlines that fall a fraction of a pixel apart leave single pixels.)
      const bw = Math.ceil(W / 8), squares = new Uint8Array(bw * Math.ceil(H / 8));
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) <= 90) continue;
        const px = (i / 4) % W, py = Math.floor(i / 4 / W);
        if (sides.length && (Math.abs(px + 0.5 - sides[0]) <= 1.5 || Math.abs(px + 0.5 - sides[1]) <= 1.5)) continue;
        differing++;
        const q = (py >> 3) * bw + (px >> 3);
        if (++squares[q] > dense) dense = squares[q];
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      // (The geometry the app's renderer holds may have been prepared for another zoom: it serves from half to 1.42 times its own scale.)
      const freshRatio = fresh.sheet ? view.projection.scale() / fresh.sheet.S : 1;
      const where = differing ? ` in ${x0},${y0} to ${x1},${y1} of ${W} x ${H}; view ${JSON.stringify(s.camera)}; parts ${JSON.stringify(s.renderer.lastParts)}; geometry prepared for ${(1 / ratio).toFixed(3)} of this scale (the fresh picture's for ${(1 / freshRatio).toFixed(3)})` : '';
      compared++;
      worstDiff = Math.max(worstDiff, differing / (W * H));
      s.notify();
      // With the coarsest outlines (the "Fastest" preset) the picture shown and the fresh one are
      // drawn from outlines simplified for slightly different scales, and differ in single pixels
      // along borders and coasts: more of those are allowed, never a filled square.
      const allowed = s.viewSettings.detail === 'coarse' ? 0.002 : 0.0006;
      if (differing / (W * H) <= allowed && dense < 28) return null;
      // Both pictures, for looking at (written to --dump, if given).
      const url = async (c: OffscreenCanvas) => { const blob = await c.convertToBlob(); return await new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(String(f.result)); f.readAsDataURL(blob); }); };
      pictures = { shown: await url(mine), fresh: await url(off) };
      return `${differing} pixels of the map differ from a fresh drawing (${((differing / (W * H)) * 100).toFixed(3)}%, up to ${dense} in a square of 8 by 8)${where}`;
    };

    const actions: Array<[string, number, () => void | Promise<void>]> = [
      ['a stroke from the date viewed on', 10, () => { const [lon, lat] = here(); s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(lon, lat, 0.3 + rnd() * 2.5 / (1 + cam().zoom / 2)), value: pick([...owners(), null]), snap: 1e-7, mode: { kind: 'change', t: s.time } })); }],
      ['a correction', 4, () => { const [lon, lat] = here(); s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(lon, lat, 0.3 + rnd() * 2 / (1 + cam().zoom / 2)), value: pick(owners()), snap: 1e-7, mode: { kind: 'correct', t: s.time } })); }],
      ['a stroke in a new animated event', 5, () => {
        const [lon, lat] = here(), y = year();
        s.execute((w: any, e: any) => B.commands.paintWithNewEvent(w, e, { name: `Stress ${y}`, start: Y(y), end: rnd() < 0.6 ? Y(y + 1 + Math.floor(rnd() * 8)) : null },
          { spaceId: s.spaceId, layerId: s.layerId, ring: ring(lon, lat, 0.4 + rnd() * 2 / (1 + cam().zoom / 2)), value: pick(owners()), snap: 1e-7, transition: pick([null, { style: 'fade' }, { style: 'border' }, { style: 'advance', origin: [lon, lat] }]) }));
      }],
      ['a stroke into an event there is', 3, () => { const ev = pick(events()) as any; if (!ev) return; const [lon, lat] = here(); s.execute((w: any, e: any) => B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(lon, lat, 0.4 + rnd()), value: pick(owners()), snap: 1e-7, mode: { kind: 'new', eventId: ev.id } })); }],
      ['undo', 6, async () => { s.undo(); await s.flush(); }],
      ['redo', 3, async () => { s.redo(); await s.flush(); }],
      ['a jump in time', 8, () => s.setTime(Y(year(), 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)))],
      ['a drag along the timeline', 6, async () => { let y = year(); for (let i = 0; i < 12; i++) { y += rnd() < 0.8 ? 1 : -3; s.setTime(Y(y, 1 + Math.floor(rnd() * 12)), true); const t = performance.now(); await raf(); frames.push(performance.now() - t); } }],
      ['moving the map', 8, async () => { const c = cam(); const dx = (rnd() - 0.5) * 40 / (1 + c.zoom), dy = (rnd() - 0.5) * 20 / (1 + c.zoom); for (let i = 1; i <= 10; i++) { s.setCamera({ ...c, lon: c.lon + (dx * i) / 10, lat: Math.max(-80, Math.min(80, c.lat + (dy * i) / 10)) }); const t = performance.now(); await raf(); frames.push(performance.now() - t); } }],
      ['zooming', 6, async () => { const c = cam(); const to = Math.max(0, Math.min(9, c.zoom + (rnd() - 0.45) * 3)); for (let i = 1; i <= 8; i++) { s.setCamera({ ...c, zoom: c.zoom + ((to - c.zoom) * i) / 8 }); const t = performance.now(); await raf(); frames.push(performance.now() - t); } }],
      ['another projection', 1, () => s.setCamera({ ...cam(), projection: pick(['equirectangular', 'mercator', 'equalEarth', 'naturalEarth']) })],
      ['another tool', 4, () => s.set({ tool: pick(['select', 'lasso', 'polygon', 'pen', 'vertex', 'erase', 'place']) })],
      ['choosing a country', 4, () => s.set({ selection: { kind: 'entity', id: pick(owners()) } })],
      ['choosing an event', 3, () => { const ev = pick(events()) as any; if (ev) s.set({ selection: { kind: 'event', id: ev.id } }); }],
      ['an event moved in time', 3, () => { const ev = pick(events()) as any; if (!ev) return; const y = year(); s.execute((w: any) => B.commands.updateEvent(w, ev.id, { start: Y(y), end: ev.end_day !== null ? Y(y + 2) : null })); }],
      ['an event deleted', 2, () => { const ev = pick(events()) as any; if (ev) s.execute((w: any) => B.commands.deleteEvent(w, ev.id)); }],
      ['a new country', 1, () => { s.execute((w: any) => B.commands.createEntity(w, { type_id: 'polity', name: `Stressland ${Math.floor(rnd() * 1e6)}` })); }],
      ['a country recoloured', 2, () => { s.execute((w: any) => B.commands.updateEntity(w, pick(owners()), { color: `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}` })); }],
      ['a border point moved', 3, () => {
        const arr = s.world.arrangement(s.spaceId), ids = [...arr.vertices.keys()];
        const v = arr.vertices.get(ids[Math.floor(rnd() * ids.length)]);
        s.execute((w: any) => B.commands.moveVertex(w, { spaceId: s.spaceId, vertexId: v.id, to: B.lonLatToVec(v.lon / 1e7 + (rnd() - 0.5) * 0.05, v.lat / 1e7 + (rnd() - 0.5) * 0.05), snap: 1e-7 }));
      }],
      ['a layer hidden or shown', 1, () => { const l = pick(s.world.all('layer').filter((q: any) => q.space_id === s.spaceId)) as any; s.execute((w: any) => B.commands.updateLayer(w, l.id, { visible: l.visible ? 0 : 1 })); }],
    ];
    const unknown = (only ?? []).filter((n) => !actions.some(([a]) => a === n));
    if (unknown.length) return { failed: `no such kind of step: ${unknown.join(', ')} (there are: ${actions.map(([a]) => a).join(', ')})`, counts };
    const bag = actions.flatMap(([n, weight], i) => (only && !only.includes(n as string) ? [] : Array.from({ length: weight }, () => i)));
    const toasts = () => s.toasts.filter((t: any) => t.kind === 'error').length;
    for (let step = 0; step < steps; step++) {
      const [what, , act] = actions[bag[Math.floor(rnd() * bag.length)]];
      const before = toasts();
      const t = performance.now();
      try { await act(); } catch (e) { return { failed: `step ${step} (${what}): ${(e as Error).stack ?? e}`, counts }; }
      await raf();
      frames.push(performance.now() - t);
      (took[what] ??= []).push(performance.now() - t);
      // (A refused edit, such as a shape that cannot be drawn there, says so and changes nothing.)
      if (toasts() > before) refused[what] = (refused[what] ?? 0) + 1; else counts[what] = (counts[what] ?? 0) + 1;
      if (s.offline) return { failed: `step ${step} (${what}): editing stopped: ${s.offline}`, counts };
      if (B.Engine.verifyFailures.length) return { failed: `step ${step} (${what}): ${B.Engine.verifyFailures[0]}`, counts };
      if (step % 10 === 9) {
        await s.flush();
        const bad = await compare();
        if (bad) return { failed: `step ${step} (after ${what}): ${bad}`, counts, pictures };
        // (What is still held after a full collection: growth here is memory that is being kept.)
        (window as any).gc?.();
        heap.push(Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6));
      }
    }
    await s.flush();
    const sorted = [...frames].sort((p, q) => p - q);
    const at = (f: number) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))].toFixed(1);
    return {
      failed: null, counts, refused, compared, worstDifferencePercent: +(worstDiff * 100).toFixed(4),
      frames: { count: frames.length, median: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) },
      // How long each kind of step took until the next frame was on screen: median and longest (ms).
      took: Object.fromEntries(Object.entries(took).map(([k, l]) => { const o = [...l].sort((p, q) => p - q); return [k, `${o[Math.floor(o.length / 2)].toFixed(0)} / ${o[o.length - 1].toFixed(0)}`]; })),
      heapMB: { first: heap[0], middle: heap[Math.floor(heap.length / 2)], last: heap[heap.length - 1], max: Math.max(...heap), every50steps: heap.filter((_, i) => i % 5 === 4) },
      engine: s.engine.stats, renderer: s.renderer.stats,
      parcels: s.world.arrangement(s.spaceId).leafFaces().length, events: s.world.all('event').length,
    };
  }, { steps, seed, only });
  if (profile) { const { profile: prof } = await cdp.send('Profiler.stop'); writeFileSync(profile, JSON.stringify(prof)); console.log(`wrote ${profile}`); }
  const shown = (result as { pictures?: { shown: string; fresh: string } | null }).pictures;
  if (shown && dump) {
    mkdirSync(dump, { recursive: true });
    for (const [k, v] of Object.entries(shown)) writeFileSync(join(dump, `${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
    console.log(`The picture shown and the fresh one are in ${dump}`);
  }
  console.log(JSON.stringify({ project: name, steps, seed, throttle, scale, verify, preset: preset ?? 'balanced', seconds: Math.round((Date.now() - t0) / 1000), ...result, pictures: undefined }, null, 1));
  if (result.failed || errors.length) {
    failed = true;
    if (errors.length) console.log(`Errors in the page:\n${[...new Set(errors)].slice(0, 12).join('\n')}`);
  }
} finally {
  await browser.close();
  server.kill('SIGTERM');
  work.done();
}
process.exit(failed ? 1 : 0);
