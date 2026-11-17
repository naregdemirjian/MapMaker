// Times the interface on large projects in Chrome: panning, zooming, scrubbing through time, playing
// and exporting a shot, and a brush stroke, as milliseconds per frame.
// Usage: node --disable-warning=ExperimentalWarning bench/render.bench.ts <fixtures folder> [project names...] [--label text] [--only scenario,...]
// Build first (node scripts/build.mjs) and make the projects with bench/make-fixtures.ts.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import { workCopy } from './tools/workcopy.ts';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const label = flag('--label') ?? 'run', only = flag('--only')?.split(',') ?? null, out = flag('--out');
const folder = args[0];
const names = args.slice(1).length ? args.slice(1) : ['Bench Earth 242', 'Bench Heavy', 'Bench Random 1000'];
const port = 4455;

const work = workCopy(folder, names);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs'), '--port', String(port), '--projects', work.folder], { stdio: ['ignore', 'pipe', 'pipe'] });
const baseUrl = await new Promise<string>((res, rej) => {
  let text = '';
  const timer = setTimeout(() => rej(new Error(`The service did not start:\n${text}`)), 20000);
  server.stdout!.on('data', (d) => { text += d; const m = /running at (http:\/\/\S+)/.exec(text); if (m) { clearTimeout(timer); res(m[1]); } });
  server.stderr!.on('data', (d) => { text += d; });
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: Array<Record<string, unknown>> = [];
try {
  for (const name of names) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
    await page.goto(baseUrl);
    await page.waitForFunction(() => (window as any).__mapmaker?.store.projects.length > 0);
    const t0 = Date.now();
    await page.evaluate((n) => { const s = (window as any).__mapmaker.store; const p = s.projects.find((x: any) => x.name === n); return s.openProject(p.id); }, name);
    await page.getByTestId('map-canvas').waitFor();
    await page.waitForFunction(() => !!(window as any).__mapmaker.store.basemap);
    await page.waitForTimeout(500);
    const openMs = Date.now() - t0;
    const res = await page.evaluate(async ({ only }) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const Y = (y: number) => B.gregorian.fromCivil({ year: y });
      const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
      const hop = () => new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
      // Time inside the map renderer, accumulated.
      let inRender = 0;
      const orig = s.renderer.render.bind(s.renderer);
      s.renderer.render = (...a: unknown[]) => { const t = performance.now(); try { return orig(...a); } finally { inRender += performance.now() - t; } };
      const stats = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q); return { median: +a[Math.floor(a.length / 2)].toFixed(1), p90: +a[Math.floor(a.length * 0.9)].toFixed(1), max: +a[a.length - 1].toFixed(1) }; };
      /** Run steps one per frame; for each: the whole cost until the page is idle again, and the part inside the renderer. */
      const run = async (steps: number, step: (i: number) => void, warm = 2) => {
        const whole: number[] = [], render: number[] = [];
        for (let i = 0; i < steps + warm; i++) {
          await raf();
          inRender = 0;
          const t = performance.now();
          step(i);
          await hop(); await hop();
          if (i >= warm) { whole.push(performance.now() - t); render.push(inRender); }
        }
        const w = stats(whole), r = stats(render);
        return { ms: w.median, p90: w.p90, max: w.max, renderMs: r.median, fps: +(1000 / Math.max(16.7, w.median)).toFixed(0) };
      };
      const out: Record<string, unknown> = {};
      const want = (n: string) => !only || only.includes(n);
      const base = { lon: 15, lat: 48, zoom: 0, rotation: 0, projection: 'equirectangular' };
      s.set({ time: Y(1950), tool: 'select', selection: null });
      if (want('idle')) out.idle = await run(20, () => s.notify()); // a click that changes nothing on the map: every panel follows
      if (want('select')) { const ids = s.world.all('entity').filter((e: any) => e.type_id === 'polity').map((e: any) => e.id); out.select = await run(20, (i) => s.set({ selection: { kind: 'entity', id: ids[i % ids.length] } })); s.set({ selection: null }); }
      if (want('panWorld')) out.panWorld = await run(40, (i) => s.setCamera({ ...base, lon: 15 + i * 1.5 }));
      if (want('zoom')) out.zoom = await run(40, (i) => s.setCamera({ ...base, zoom: i * 0.15 }));
      if (want('panRegion')) out.panRegion = await run(40, (i) => s.setCamera({ ...base, zoom: 3.5, lon: 5 + i * 0.25, lat: 50 - i * 0.05 }));
      if (want('panClose')) out.panClose = await run(40, (i) => s.setCamera({ ...base, zoom: 7, lon: 10 + i * 0.02, lat: 48 }));
      if (want('panDeep')) out.panDeep = await run(40, (i) => s.setCamera({ ...base, zoom: 13, lon: 10 + i * 0.0003, lat: 48 }));
      if (want('panVeryDeep')) out.panVeryDeep = await run(40, (i) => s.setCamera({ ...base, zoom: 19, lon: 10 + i * 0.000005, lat: 48 }));
      s.setCamera({ ...base, zoom: 2.2 });
      if (want('scrub')) out.scrub = await run(40, (i) => s.setTime(Y(1000 + i * 25), true)); // as dragging along the timeline does
      if (want('scrubSmall')) out.scrubSmall = await run(40, (i) => s.setTime(B.gregorian.fromCivil({ year: 1950, month: 1, day: 1 + (i % 27) }), true));
      // A brush stroke over central Europe (in its own event), and the frame after it.
      if (want('stroke')) {
        const owners = s.world.all('entity').filter((e: any) => e.type_id === 'polity').map((e: any) => e.id);
        const ring = (cx: number, cy: number, r: number) => Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2; return B.lonLatToVec(cx + r * 1.4 * Math.cos(a), cy + r * Math.sin(a)); });
        out.stroke = await run(12, (i) => {
          s.execute((w: any, e: any) => {
            const ev = B.commands.createEvent(w, { name: `Bench stroke ${i}`, start: Y(1960 + i) });
            const p = B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(8 + i * 2.5, 47 + (i % 3), 1.2), value: owners[i % owners.length], snap: 1e-7, mode: { kind: 'new', eventId: ev.result } });
            return { label: p.label, diffs: [...ev.diffs, ...p.diffs], result: null };
          });
        }, 1);
        await s.flush();
      }
      // A shot: stepping through its frames (as playing does), still and moving camera.
      const shots = s.world.all('sequence');
      for (const [key, sh] of [['playStill', shots[0]], ['playMoving', shots[1]]] as const) {
        if (!sh || !want(key)) continue;
        s.set({ mode: 'present', shotId: sh.id, shotFrame: 0, presentCamera: null });
        await raf(); await hop();
        out[key] = await run(60, (i) => s.setLive({ shotFrame: i * 4, presentCamera: null })); // as playing does
      }
      // Export: 24 frames of the still shot, everything combined, at 1080p and at 4K.
      for (const [key, w, h] of [['export1080', 1920, 1080], ['export4k', 3840, 2160]] as const) {
        if (!shots[0] || !want(key)) continue;
        const shot = { ...JSON.parse(shots[0].settings), width: w, height: h };
        const t = performance.now();
        const r = await B.runExport({ projectId: s.projectId, world: s.world, engine: s.engine, shot, shotName: `bench ${key}`, passNames: ['all'], scale: 1, frameRange: [100, 123] });
        out[key] = { msPerFrame: +((performance.now() - t) / r.frames).toFixed(0), frames: r.frames };
      }
      if (shots[0] && want('exportPasses')) {
        const shot = { ...JSON.parse(shots[0].settings), width: 1920, height: 1080 };
        const t = performance.now();
        const r = await B.runExport({ projectId: s.projectId, world: s.world, engine: s.engine, shot, shotName: 'bench passes', passNames: ['background', 'land', 'fills', 'borders', 'cities', 'labels', 'characters', 'overlays'], scale: 1, frameRange: [100, 111] });
        out.exportPasses = { msPerFrame: +((performance.now() - t) / r.frames).toFixed(0), frames: r.frames, passes: 8 };
      }
      s.set({ mode: 'world', presentCamera: null });
      return out;
    }, { only });
    const row = { label, project: name, openMs, ...res };
    results.push(row);
    console.log(JSON.stringify(row));
    await context.close();
  }
} finally {
  await browser.close();
  server.kill('SIGTERM');
  work.done();
}
if (out) appendFileSync(out, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
