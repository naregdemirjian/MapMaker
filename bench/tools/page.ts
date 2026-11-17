// Open a benchmark project in Chrome and run a snippet in the page (for looking into rendering).
// Usage: node --disable-warning=ExperimentalWarning bench/tools/page.ts <fixtures folder> "<project>" <snippet.js> [screenshot.png]
// The snippet is the body of an async function with `m` (window.__mapmaker), `s` (the store) and `B` (m.bench).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { workCopy } from './workcopy.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const [folder, name, snippet, shot] = process.argv.slice(2);
const work = workCopy(folder, [name]);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs'), '--port', '4457', '--projects', work.folder], { stdio: ['ignore', 'pipe', 'pipe'] });
const baseUrl = await new Promise<string>((res) => { let t = ''; server.stdout!.on('data', (d) => { t += d; const m = /running at (http:\/\/\S+)/.exec(t); if (m) res(m[1]); }); });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  page.on('console', (msg) => console.log(`console: ${msg.text()}`));
  await page.goto(baseUrl);
  await page.waitForFunction(() => (window as any).__mapmaker?.store.projects.length > 0);
  await page.evaluate((n) => { const s = (window as any).__mapmaker.store; return s.openProject(s.projects.find((x: any) => x.name === n).id); }, name);
  await page.getByTestId('map-canvas').waitFor();
  await page.waitForFunction(() => !!(window as any).__mapmaker.store.basemap);
  await page.waitForTimeout(500);
  // With REFERENCE=<bundle.js> the old renderer (e2e/reference) is added as window.__reference.
  if (process.env.REFERENCE) await page.addScriptTag({ path: process.env.REFERENCE });
  const body = readFileSync(snippet, 'utf8');
  const result = await page.evaluate(`(async () => { const m = window.__mapmaker, s = m.store, B = m.bench; ${body} })()`);
  console.log(JSON.stringify(result, null, 1));
  if (shot) { await page.waitForTimeout(300); await page.screenshot({ path: shot }); }
} finally {
  await browser.close();
  server.kill('SIGTERM');
  work.done();
}
