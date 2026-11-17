// How long opening a project takes, and where the time goes: a CPU profile (and the browser's own
// timings) from the click on the project until the map is drawn and the page is idle.
// Usage: node --disable-warning=ExperimentalWarning bench/open.ts <fixtures folder> "<project>" <out.cpuprofile>
// Summarise the profile with bench/top.mjs. Build first (node scripts/build.mjs).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { workCopy } from './tools/workcopy.ts';

const ROOT = resolve(import.meta.dirname, '..');
const [folder, name, outFile] = process.argv.slice(2);
const work = workCopy(folder, [name]);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs'), '--port', '4459', '--projects', work.folder], { stdio: ['ignore', 'pipe', 'pipe'] });
const baseUrl = await new Promise<string>((res) => { let t = ''; server.stdout!.on('data', (d) => { t += d; const m = /running at (http:\/\/\S+)/.exec(t); if (m) res(m[1]); }); });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  await page.goto(baseUrl);
  await page.waitForFunction(() => (window as any).__mapmaker?.store.projects.length > 0);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const times = await page.evaluate(async (n) => {
    const s = (window as any).__mapmaker.store;
    const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
    const t0 = performance.now();
    const marks: Record<string, number> = {};
    const opening = s.openProject(s.projects.find((x: any) => x.name === n).id);
    await opening;
    marks.projectLoaded = performance.now() - t0;
    while (!document.querySelector('[data-testid=map-canvas]')) await raf();
    marks.mapShown = performance.now() - t0;
    while (!s.basemap) await raf();
    marks.basemapLoaded = performance.now() - t0;
    await raf(); await raf();
    marks.firstFrames = performance.now() - t0;
    // Until nothing more is being drawn (names placed, the room around the map filled).
    await new Promise((r) => setTimeout(r, 700));
    await raf();
    marks.settled = performance.now() - t0 - 700;
    return marks;
  }, name);
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync(outFile, JSON.stringify(profile));
  console.log(JSON.stringify({ project: name, ...Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v as number)])) }));
} finally {
  await browser.close();
  server.kill('SIGTERM');
  work.done();
}
