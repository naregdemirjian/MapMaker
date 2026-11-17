// CPU profile of one benchmark scenario in Chrome, written as a .cpuprofile (open in Chrome DevTools,
// or summarise with bench/top.mjs).
// Usage: node --disable-warning=ExperimentalWarning bench/profile.ts <fixtures folder> "<project>" <scenario> <out.cpuprofile>
// With an output name ending in .trace.json, a browser trace is recorded instead (everything the browser
// does around the script: style, layout, painting, presenting the canvas); summarise with bench/trace.mjs.
// Scenarios: idle, select, panWorld, panRegion, panDeep, zoomIn, zoomOut, scrub, scrubYears, scrubSmall, stroke, play, playMoving
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { workCopy } from './tools/workcopy.ts';

const ROOT = resolve(import.meta.dirname, '..');
const [folder, name, scenario, outFile] = process.argv.slice(2);
const work = workCopy(folder, [name]);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs'), '--port', '4456', '--projects', work.folder], { stdio: ['ignore', 'pipe', 'pipe'] });
const baseUrl = await new Promise<string>((res) => { let t = ''; server.stdout!.on('data', (d) => { t += d; const m = /running at (http:\/\/\S+)/.exec(t); if (m) res(m[1]); }); });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  await page.goto(baseUrl);
  await page.waitForFunction(() => (window as any).__mapmaker?.store.projects.length > 0);
  await page.evaluate((n) => { const s = (window as any).__mapmaker.store; return s.openProject(s.projects.find((x: any) => x.name === n).id); }, name);
  await page.getByTestId('map-canvas').waitFor();
  await page.waitForFunction(() => !!(window as any).__mapmaker.store.basemap);
  await page.waitForTimeout(800);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await page.evaluate(async (sc) => {
    const m = (window as any).__mapmaker, s = m.store, B = m.bench;
    const Y = (y: number) => B.gregorian.fromCivil({ year: y });
    const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
    const base = { lon: 15, lat: 48, zoom: 2.2, rotation: 0, projection: 'equirectangular' };
    s.set({ time: Y(1950) }); s.setCamera(base);
    if (sc === 'play' || sc === 'playMoving') { const sh = s.world.all('sequence')[sc === 'play' ? 0 : 1]; s.set({ mode: 'present', shotId: sh.id, shotFrame: 0 }); }
    for (let i = 0; i < 3; i++) await raf();
    // (At rest for a moment, as before any real movement: the app then draws the room around its kept pictures.)
    await new Promise((r) => setTimeout(r, 500));
  }, scenario);
  const tracing = outFile.endsWith('.trace.json');
  if (tracing) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'blink', 'cc', 'viz', 'gpu'] });
  else await cdp.send('Profiler.start');
  await page.evaluate(async (sc) => {
    const m = (window as any).__mapmaker, s = m.store, B = m.bench;
    const Y = (y: number) => B.gregorian.fromCivil({ year: y });
    const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
    const hop = () => new Promise<void>((r) => setTimeout(r, 0));
    const base = { lon: 15, lat: 48, zoom: 2.2, rotation: 0, projection: 'equirectangular' };
    for (let i = 0; i < 25; i++) {
      await raf();
      if (sc === 'idle') s.notify();
      else if (sc === 'panWorld') s.setCamera({ ...base, zoom: 0, lon: 15 + i * 1.5 });
      else if (sc === 'panRegion') s.setCamera({ ...base, zoom: 3.5, lon: 5 + i * 0.25 });
      else if (sc === 'panDeep') s.setCamera({ ...base, zoom: 13, lon: 10 + i * 0.0003 });
      else if (sc === 'zoomIn') s.setCamera({ ...base, zoom: 2.2 + i * 0.04 });
      else if (sc === 'zoomOut') s.setCamera({ ...base, zoom: 3.2 - i * 0.04 });
      else if (sc === 'scrub') s.setTime(Y(1000 + i * 25), true);
      else if (sc === 'scrubYears') s.setTime(Y(1900 + i), true);
      else if (sc === 'scrubSmall') s.setTime(B.gregorian.fromCivil({ year: 1950, month: 1, day: 1 + (i % 27) }), true);
      else if (sc === 'select') { const ids = s.world.all('entity').filter((e: any) => e.type_id === 'polity').map((e: any) => e.id); s.set({ selection: { kind: 'entity', id: ids[i % ids.length] } }); }
      else if (sc === 'stroke') {
        const owners = s.world.all('entity').filter((e: any) => e.type_id === 'polity').map((e: any) => e.id);
        const ring = (cx: number, cy: number, r: number) => Array.from({ length: 60 }, (_, k) => { const a = (k / 60) * Math.PI * 2; return B.lonLatToVec(cx + r * 1.4 * Math.cos(a), cy + r * Math.sin(a)); });
        s.execute((w: any, e: any) => {
          const ev = B.commands.createEvent(w, { name: `Profile stroke ${i}`, start: Y(1960 + i) });
          const p = B.commands.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(8 + i * 1.2, 47 + (i % 3), 1.2), value: owners[i % owners.length], snap: 1e-7, mode: { kind: 'new', eventId: ev.result } });
          return { label: p.label, diffs: [...ev.diffs, ...p.diffs], result: null };
        });
      }
      else if (sc === 'play' || sc === 'playMoving') s.setLive({ shotFrame: i * 4, presentCamera: null });
      await hop(); await hop();
    }
  }, scenario);
  if (tracing) writeFileSync(outFile, await browser.stopTracing());
  else {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(outFile, JSON.stringify(profile));
  }
  console.log(`wrote ${outFile}`);
} finally {
  await browser.close();
  server.kill('SIGTERM');
  work.done();
}
