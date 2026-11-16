// End-to-end test of the first vertical slice, driven through the real interface in Google Chrome.
// Everything is done the way a person would do it (clicks, drags, typing); the page's small read-only
// test hook (window.__mapmaker) is only used to read results and to convert between map and page positions.
//
//   npm run build && npm run e2e
//
// Screenshots are written to e2e/output/. The test uses its own projects folder under .tmp/.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { geoContains } from 'd3-geo';
import { decodeBasemap, type BasemapFile } from '../src/render-engine/basemap.ts';

type LL = [number, number];
type Pt = [number, number];

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'e2e', 'output');
const PROJECTS = join(ROOT, '.tmp', 'e2e-projects');
const PORT = 4391;
const A = 'Test Country A', B = 'Test Country B', EVENT = 'Test border war';

rmSync(PROJECTS, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(PROJECTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------------------------
// The local data service
let server: ChildProcess | null = null;
let baseUrl = '';

async function startServer(): Promise<void> {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs'), '--port', String(PORT), '--projects', PROJECTS], { stdio: ['ignore', 'pipe', 'pipe'] });
  server = p;
  baseUrl = await new Promise<string>((res, rej) => {
    let out = '';
    const timer = setTimeout(() => rej(new Error(`The service did not start:\n${out}`)), 20000);
    p.stdout!.on('data', (d) => { out += d; const m = /running at (http:\/\/\S+)/.exec(out); if (m) { clearTimeout(timer); res(m[1]); } });
    p.stderr!.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(timer); rej(new Error(`The service exited (${code}):\n${out}`)); });
  });
}

async function stopServer(): Promise<void> {
  const p = server;
  server = null;
  if (!p || p.exitCode !== null) return;
  await new Promise<void>((res) => { p.once('exit', () => res()); p.kill('SIGTERM'); setTimeout(res, 5000); });
}

// ---------------------------------------------------------------------------------------------
// Steps and reporting
const results: Array<{ name: string; ok: boolean; ms: number }> = [];
const pageErrors: string[] = [];
let browser: Browser;
let context: BrowserContext;
let page: Page;
let shotNo = 0;

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0 });
    console.log('FAILED');
    await page?.screenshot({ path: join(OUT, 'FAILED.png') }).catch(() => undefined);
    throw e;
  }
}

async function screenshot(name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`) });
}

function watch(p: Page): Page {
  p.on('pageerror', (e) => pageErrors.push(`page error: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  return p;
}

// ---------------------------------------------------------------------------------------------
// Map helpers
async function centre(): Promise<{ cx: number; cy: number }> {
  const b = (await page.getByTestId('map-canvas').boundingBox())!;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/** A closed, slightly irregular loop around (cx, cy), like a hand-drawn outline. */
function blob(cx: number, cy: number, rx: number, ry: number, n = 40): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 1 + 0.05 * Math.sin(5 * a) + 0.03 * Math.cos(3 * a + 1);
    pts.push([cx + rx * wob * Math.cos(a), cy + ry * wob * Math.sin(a)]);
  }
  return pts;
}

async function drawLasso(pts: Pt[]): Promise<void> {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 3 });
  await page.mouse.move(pts[0][0], pts[0][1], { steps: 3 });
  await page.mouse.up();
}

const hook = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, a]) => (window as any).__mapmaker[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
const toLL = async (p: Pt): Promise<LL> => { const ll = await hook<LL | null>('pageToLonLat', p[0], p[1]); assert.ok(ll, `point ${p} is not on the map`); return ll; };
const toPage = async (ll: LL): Promise<Pt> => { const p = await hook<Pt | null>('lonLatToPage', ll[0], ll[1]); assert.ok(p, `${ll} is not visible`); return p; };
const ownerAt = (ll: LL, date: string) => hook<string | null>('ownerAt', ll[0], ll[1], date);
const entityId = (name: string) => page.evaluate((n) => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === n)?.id as string, name);

/** The colour drawn at a map position in the world-building view. */
const canvasPixel = (ll: LL) => page.evaluate(([lon, lat]) => {
  const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
  const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
  const r = c.getBoundingClientRect(), k = c.width / r.width;
  return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
}, ll);
const colourDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

async function setDate(text: string): Promise<void> {
  const f = page.getByTestId('current-date');
  await f.fill(text);
  await f.press('Enter');
  await page.waitForTimeout(60);
}

/** Wait until the date box shows `text` (it updates just after the change is handled). */
async function expectDate(text: string, message: string): Promise<void> {
  try {
    await page.waitForFunction((t) => (document.querySelector('[data-testid=current-date]') as HTMLInputElement | null)?.value === t, text, { timeout: 5000 });
  } catch {
    assert.equal(await page.getByTestId('current-date').inputValue(), text, message);
  }
}

/** Click a place with the Select tool and read who owns it from the Place panel. */
async function inspect(ll: LL): Promise<string> {
  await page.getByTestId('tool-select').click();
  const p = await toPage(ll);
  await page.mouse.click(p[0], p[1]);
  return (await page.getByTestId('point-owner').textContent()) ?? '';
}

async function waitOwner(ll: LL, date: string, owner: string | null): Promise<void> {
  await page.waitForFunction(([lon, lat, d, o]) => (window as any).__mapmaker.ownerAt(lon, lat, d) === o, [ll[0], ll[1], date, owner] as const, { timeout: 8000 });
}

/** Wait until every change has been written to the project file. */
const saved = () => page.evaluate(() => (window as any).__mapmaker.store.flush());

function worldSummary() {
  return page.evaluate(() => {
    const w = (window as any).__mapmaker.store.world;
    const arr = w.arrangement((window as any).__mapmaker.store.spaceId);
    return {
      entities: w.all('entity').map((e: any) => `${e.type_id}:${e.name}:${e.color}`).sort(),
      events: w.all('event').map((e: any) => `${e.name}:${e.start_day}:${e.end_day}`).sort(),
      effects: w.all('effect').map((f: any) => `${f.event_id}:${f.ordinal}:${f.resolution}:${f.transition}`).sort(),
      vertices: arr.vertices.size, segments: arr.segments.size, faces: arr.faces.size, valid: arr.validate(),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// PNG reading (for checking exported frames)
function decodePNG(buf: Buffer): { width: number; height: number; data: Uint8Array } {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG file');
  let off = 8, width = 0, height = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.equal(body[8], 8); assert.equal(body[9], 6, 'expected RGBA'); }
    if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 4, out = new Uint8Array(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++], row = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[row + x - 4] : 0, b = y ? out[prev + x] : 0, c = y && x >= 4 ? out[prev + x - 4] : 0;
      let v = raw[p++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row + x] = v & 255;
    }
  }
  return { width, height, data: out };
}

const pixel = (img: { width: number; data: Uint8Array }, x: number, y: number) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};
const hexRGB = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const near = (a: number[], b: number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function runExport(button: 'export-preview' | 'export-full'): Promise<{ dir: string; manifest: any }> {
  await page.getByTestId(button).click();
  await page.getByTestId('export-result').waitFor({ timeout: 300000 });
  const dir = ((await page.locator('[data-testid=export-result] .path').textContent()) ?? '').trim();
  assert.ok(existsSync(dir), `export folder ${dir} exists`);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return { dir, manifest };
}

// ---------------------------------------------------------------------------------------------
// The test
const P: Record<string, LL> = {};
let colours: Record<string, string> = {};

try {
  await startServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
  page = watch(await context.newPage());

  await step('Open Map Maker and create a project', async () => {
    await page.goto(baseUrl);
    await page.getByTestId('project-name').fill('Vertical Slice Test');
    await screenshot('project-picker');
    await page.getByTestId('project-create').click();
    await page.getByTestId('map-canvas').waitFor();
    assert.ok(existsSync(join(PROJECTS, 'Vertical Slice Test.mapmaker', 'project.db')), 'the project file was created on disk');
    await screenshot('new-project');
  });

  await step('Zoom and move the map', async () => {
    const { cx, cy } = await centre();
    const before = await page.evaluate(() => ({ ...(window as any).__mapmaker.store.camera }));
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(100);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 140, cy + 40, { steps: 8 });
    await page.mouse.up();
    const after = await page.evaluate(() => ({ ...(window as any).__mapmaker.store.camera }));
    assert.ok(after.zoom > before.zoom + 0.9, 'zoomed in');
    assert.ok(after.lon < before.lon - 10, 'moved the map');
    await screenshot('zoomed-and-moved');
  });

  await step("Earth's geography: land drawn, present-day borders as a guide, data sources listed", async () => {
    // Land and sea differ in the picture: a pixel in Africa and one in the Atlantic.
    await page.waitForFunction(() => (window as any).__mapmaker.store.basemap);
    const land = await canvasPixel([20, 5]), sea = await canvasPixel([-30, 10]);
    assert.ok(colourDiff(land, sea) > 20, `land ${land} and sea ${sea} look different`);
    await page.getByTestId('reference-borders-toggle').check();
    await screenshot('present-day-borders-guide');
    await page.getByTestId('reference-borders-toggle').uncheck();
    await page.getByTestId('data-sources').click();
    await page.getByTestId('dataset-natural-earth').waitFor();
    assert.match(await page.getByTestId('dataset-natural-earth').innerText(), /Public domain/);
    await screenshot('data-sources');
    await page.locator('.modal button.primary', { hasText: 'Close' }).click();
    await page.locator('.modal').waitFor({ state: 'detached' });
    // The test countries are drawn over the Atlantic; their territory is kept over the sea until the
    // coastline clipping step switches clipping back on.
    assert.ok(await page.getByTestId('clip-to-land').isChecked(), 'territory ends at the coast by default');
    await page.getByTestId('clip-to-land').uncheck();
  });

  await step('Create a country and draw its territory', async () => {
    await page.getByRole('button', { name: '+ New' }).click();
    await page.getByTestId('new-entity-name').fill(A);
    await page.getByTestId('new-entity-create').click();
    await page.getByTestId('entity-panel').waitFor();
    await page.getByTestId('tool-lasso').click();
    assert.equal(await page.getByTestId('paint-owner').inputValue(), await entityId(A), 'the new country is chosen in "Give to"');
    const { cx, cy } = await centre();
    await drawLasso(blob(cx - 120, cy, 110, 80));
    await page.getByTestId('choice-new').waitFor();
    assert.match((await page.getByTestId('new-change-lasts').textContent()) ?? '', /Nothing later changes this area yet/);
    await screenshot('what-does-this-drawing-mean');
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    P.westA = await toLL([cx - 190, cy]);
    P.conq = await toLL([cx - 75, cy]);
    P.conqEdge = await toLL([cx - 105, cy]);
    P.north = await toLL([cx - 120, cy - 150]);
    await waitOwner(P.westA, '2000', A);
    assert.equal(await ownerAt(P.westA, '1000'), A, 'a correction with no history before it is part of the base world');
    assert.equal(await ownerAt(P.north, '2000'), null);
    assert.match(await inspect(P.westA), new RegExp(A));
    await screenshot('country-a');
  });

  await step('Create a second country beside it; undo and redo', async () => {
    await page.getByRole('button', { name: '+ New' }).click();
    await page.getByTestId('new-entity-name').fill(B);
    await page.getByTestId('new-entity-create').click();
    await page.getByTestId('tool-lasso').click();
    const { cx, cy } = await centre();
    await drawLasso(blob(cx + 75, cy, 100, 75));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    P.eastB = await toLL([cx + 110, cy]);
    await waitOwner(P.eastB, '2000', B);
    assert.equal(await ownerAt(P.westA, '2000'), A);
    await saved();
    await page.getByTestId('undo').click();
    await waitOwner(P.eastB, '2000', null);
    await page.getByRole('button', { name: 'Redo' }).click();
    await waitOwner(P.eastB, '2000', B);
    await saved();
    await screenshot('two-countries');
  });

  await step('Edit a border by dragging one of its points', async () => {
    await page.getByTestId('tool-vertex').click();
    const v = await page.evaluate(() => {
      const s = (window as any).__mapmaker.store, arr = s.world.arrangement(s.spaceId);
      let best: any = null;
      for (const r of arr.vertices.values()) if (!best || r.lon < best.lon) best = r;
      return { lon: best.lon / 1e7, lat: best.lat / 1e7 };
    });
    const vp = await toPage([v.lon, v.lat]);
    P.spike = await toLL([vp[0] - 18, vp[1]]);
    assert.equal(await ownerAt(P.spike, '2000'), null, 'just outside the border before the edit');
    await page.mouse.move(vp[0], vp[1]);
    await page.mouse.down();
    await page.mouse.move(vp[0] - 60, vp[1], { steps: 10 });
    await page.mouse.up();
    await page.getByTestId('confirm-vertex').waitFor();
    await screenshot('move-border-point');
    await page.getByTestId('confirm-vertex').click();
    await waitOwner(P.spike, '2000', A);
    assert.equal(await ownerAt(P.spike, '1000'), A, 'a border correction applies to all dates');
    await saved();
    await screenshot('border-edited');
  });

  await step('Save a named version', async () => {
    await page.getByRole('button', { name: 'Versions' }).click();
    await page.getByPlaceholder('Version name').fill('Two countries drawn');
    await page.getByRole('button', { name: 'Save version' }).click();
    await page.getByText('Two countries drawn').waitFor();
    await screenshot('versions');
    await page.locator('.modal-actions').getByRole('button', { name: 'Close' }).click();
  });

  await step('Create a historical event that changes the map', async () => {
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill(EVENT);
    await page.getByTestId('event-start').fill('1450');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-create').click();
    await page.getByTestId('recording').waitFor();
    await expectDate('1 January 1450', 'creating the event moves to its start date');
    await page.getByTestId('tool-lasso').click();
    await page.getByTestId('paint-owner').selectOption({ label: B });
    const { cx, cy } = await centre();
    await drawLasso(blob(cx - 75, cy, 40, 34));
    await waitOwner(P.conq, '1451', B);
    await saved();
    await screenshot('event-recorded');
  });

  await step('Go to dates before and after the event', async () => {
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    await setDate('1449');
    assert.match(await inspect(P.conq), new RegExp(A), 'before the event the area belongs to A');
    await screenshot('before-the-event-1449');
    await setDate('1451');
    assert.match(await inspect(P.conq), new RegExp(B), 'after the event the area belongs to B');
    await screenshot('after-the-event-1451');
    for (const d of ['1000', '1449', '1450', '1451', '2000']) {
      assert.equal(await ownerAt(P.westA, d), A, `west of A on ${d}`);
      assert.equal(await ownerAt(P.eastB, d), B, `east of B on ${d}`);
      assert.equal(await ownerAt(P.spike, d), A, `corrected border on ${d}`);
    }
    assert.equal(await ownerAt(P.conq, '31 December 1449 23:59'), A);
    assert.equal(await ownerAt(P.conq, '1 January 1450'), B);
    await setDate('1300');
    // Drawing over the area at an earlier date: the prompt says how long such a change would last.
    await page.getByTestId('tool-lasso').click();
    const c = await toPage(P.conq);
    await drawLasso(blob(c[0], c[1], 12, 10));
    assert.match((await page.getByTestId('new-change-lasts').textContent()) ?? '', /until 1 January 1450, when “Test border war” changes it/);
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await ownerAt(P.conq, '1300'), A, 'cancelling changes nothing');
    await page.getByTitle('Next change').click();
    await expectDate('1 January 1450', 'the "next change" button jumps to the event');
  });

  await step('Restore the saved version, then undo the restore', async () => {
    await saved();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Versions' }).click();
    await page.locator('.modal .row', { hasText: 'Two countries drawn' }).getByRole('button', { name: 'Restore' }).click();
    await waitOwner(P.conq, '1451', A);
    assert.equal(await page.locator('.left .row', { hasText: EVENT }).count(), 0, 'the event recorded after that version is gone');
    assert.ok((await page.locator('.modal .row', { hasText: 'KB' }).getByRole('button', { name: 'Restore' }).count()) >= 1, 'automatic backups can be restored too');
    await screenshot('versions-and-backups');
    await page.locator('.modal-actions').getByRole('button', { name: 'Close' }).click();
    await saved();
    await page.getByTestId('undo').click();
    await waitOwner(P.conq, '1451', B);
    await page.locator('.left .row', { hasText: EVENT }).waitFor();
  });

  await step('Close Map Maker completely, start it again and reopen the project', async () => {
    const before = await worldSummary();
    assert.deepEqual(before.valid, [], 'the map geometry is valid');
    const cam = await page.evaluate(() => ({ ...(window as any).__mapmaker.store.camera }));
    await page.waitForTimeout(700); // let the browser remember the view
    await page.close();
    await stopServer();
    await startServer();
    page = watch(await context.newPage());
    await page.goto(baseUrl);
    await page.getByText('Vertical Slice Test').click();
    await page.getByTestId('map-canvas').waitFor();
    const after = await worldSummary();
    assert.deepEqual(after, before, 'everything came back exactly as it was');
    const cam2 = await page.evaluate(() => ({ ...(window as any).__mapmaker.store.camera }));
    assert.deepEqual(cam2, cam, 'the view is restored');
    await expectDate('1 January 1450', 'the date being viewed is restored');
    for (const d of ['1449', '1451']) assert.equal(await ownerAt(P.conq, d), d === '1449' ? A : B);
    await setDate('1449');
    assert.match(await inspect(P.conq), new RegExp(A));
    await setDate('1451');
    assert.match(await inspect(P.conq), new RegExp(B));
    await screenshot('reopened-1451');
  });

  await step('Animate the change over the length of the event', async () => {
    await page.locator('.left .row', { hasText: EVENT }).click();
    await page.getByTestId('event-panel').waitFor();
    await page.getByTestId('event-panel-end').fill('1455');
    await page.getByTestId('event-panel-end').press('Enter');
    await page.getByTestId('transition-style').selectOption('advance');
    await saved();
    await setDate('1 July 1452');
    assert.equal(await ownerAt(P.conq, '1 July 1452'), B, 'the middle of the area has already changed hands');
    assert.equal(await ownerAt(P.conqEdge, '1 July 1452'), A, 'the edge of the area has not yet');
    assert.equal(await ownerAt(P.conqEdge, '1455'), B, 'by the end of the event all of it has');
    assert.equal(await ownerAt(P.conq, '1449'), A, 'before the event nothing has changed');
    await screenshot('transition-halfway-1452');
    await setDate('1 January 1454');
    await screenshot('transition-later-1454');
    colours = await page.evaluate(([a, b]) => { const w = (window as any).__mapmaker.store.world; const c = (n: string) => w.all('entity').find((e: any) => e.name === n).color; return { [a]: c(a), [b]: c(b) }; }, [A, B]);
  });

  let first: { dir: string; manifest: any } | null = null;
  await step('Make a shot of the event and export a preview image sequence', async () => {
    await page.locator('.left .row', { hasText: EVENT }).click();
    await page.getByTestId('mode-present').click();
    await page.getByTestId('new-shot').click();
    await page.getByTestId('shot-editor').waitFor();
    await page.getByTestId('shot-seconds').fill('1');
    await page.getByTestId('shot-seconds').press('Enter');
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.all('sequence')[0]?.settings.includes('"frames":24'));
    await page.getByTestId('frame-slider').fill('12');
    await screenshot('presentation-mode');
    const ex = await runExport('export-preview');
    first = ex;
    const m = ex.manifest;
    assert.deepEqual(m.resolution, [480, 270]);
    assert.deepEqual(m.frames, [0, 23]);
    const passes: string[] = m.passes.map((p: any) => p.name);
    assert.deepEqual(passes.sort(), ['all', 'background', 'borders', 'fills', 'labels', 'land', 'overlays']);
    for (const pass of passes) {
      const files: string[] = readdirSync(join(ex.dir, pass)).filter((f) => f.endsWith('.png'));
      assert.equal(files.length, 24, `${pass}: 24 frames`);
    }
    assert.ok(existsSync(join(ex.dir, 'COMPOSITING_GUIDE.txt')));
    // Earth's geography is drawn, and its credit travels with the export.
    assert.equal(m.dataCredits.length, 1);
    assert.match(m.dataCredits[0], /^Natural Earth v5\.1\.2 \(Public domain\)/);
    assert.match(readFileSync(join(ex.dir, 'COMPOSITING_GUIDE.txt'), 'utf8'), /Made with Natural Earth/);
    assert.equal(new Set(Object.values(m.checksums.land as Record<string, string>)).size, 1, 'the land pass is the same in every frame');
    // The background does not change during the shot; the territory does.
    const bg = Object.values(m.checksums.background as Record<string, string>);
    assert.equal(new Set(bg).size, 1, 'the background pass is the same in every frame');
    assert.notEqual(m.checksums.fills[0], m.checksums.fills[23], 'the territory changes during the shot');
    // Check the actual pixels: the middle of the area is A's colour at the start and B's at the end.
    const file = (pass: string, f: number) => join(ex.dir, pass, readdirSync(join(ex.dir, pass)).sort()[f]);
    const f0 = decodePNG(readFileSync(file('fills', 0))), f23 = decodePNG(readFileSync(file('fills', 23)));
    const at0 = (await hook<Pt>('exportPixel', P.conq[0], P.conq[1], 0, 0.25)), at23 = (await hook<Pt>('exportPixel', P.conq[0], P.conq[1], 23, 0.25));
    const c0 = pixel(f0, at0[0], at0[1]), c23 = pixel(f23, at23[0], at23[1]);
    assert.ok(near(c0.slice(0, 3), hexRGB(colours[A])), `frame 1 shows A's colour (${c0} vs ${colours[A]})`);
    assert.ok(near(c23.slice(0, 3), hexRGB(colours[B])), `frame 24 shows B's colour (${c23} vs ${colours[B]})`);
    assert.ok(c0[3] > 150 && c0[3] < 255, 'territory fills are semi-transparent');
    assert.equal(pixel(f0, 2, 2)[3], 0, 'the fills pass has a transparent background');
    const beauty = decodePNG(readFileSync(file('all', 0)));
    assert.equal(pixel(beauty, 2, 2)[3], 255, 'the All pass has a solid background');
  });

  await step('Export the same shot again after reloading: identical pixels', async () => {
    await page.reload();
    await page.getByText('Vertical Slice Test').click();
    await page.getByTestId('mode-present').click();
    await page.locator('.left .row', { hasText: 'Shot 1' }).click();
    await page.getByTestId('shot-editor').waitFor();
    const second = await runExport('export-preview');
    assert.notEqual(second.dir, first!.dir);
    assert.deepEqual(second.manifest.checksums, first!.manifest.checksums, 'every frame of every pass is identical');
  });

  await step('Export full-size 1080p frames', async () => {
    for (const label of ['Background', 'Labels', 'Text overlays']) await page.getByLabel(label, { exact: true }).uncheck();
    const full = await runExport('export-full');
    assert.deepEqual(full.manifest.resolution, [1920, 1080]);
    for (const pass of ['fills', 'borders', 'all']) assert.equal(readdirSync(join(full.dir, pass)).filter((f) => f.endsWith('.png')).length, 24);
    const frames = readdirSync(join(full.dir, 'all')).sort();
    const img = decodePNG(readFileSync(join(full.dir, 'all', frames[12])));
    assert.equal(img.width, 1920);
    copyFileSync(join(full.dir, 'all', frames[12]), join(OUT, 'exported-all-frame-13.png'));
    for (const pass of ['fills', 'borders']) copyFileSync(join(full.dir, pass, readdirSync(join(full.dir, pass)).sort()[12]), join(OUT, `exported-${pass}-frame-13.png`));
  });

  await step('Shot transitions: as recorded, none at all, or every change restyled (a wipe)', async () => {
    const drawn = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastTransitions as Array<{ style: string; progress: number }>);
    await page.getByTestId('mode-present').click();
    await page.getByTestId('shot-editor').waitFor();
    await page.getByTestId('frame-slider').fill('12');
    await page.waitForTimeout(100);
    let tr = await drawn();
    assert.ok(tr.length === 1 && tr[0].style === 'advance' && tr[0].progress > 0 && tr[0].progress < 1, `as recorded: the advancing front is mid-way (${JSON.stringify(tr)})`);
    await page.getByTestId('transition-mode').selectOption('instant');
    await page.waitForTimeout(100);
    assert.deepEqual(await drawn(), [], 'no animation: the border changes at once');
    await screenshot('shot-no-animation');
    await page.getByTestId('transition-mode').selectOption('all');
    await page.getByTestId('transition-restyle').check();
    await page.getByTestId('transition-style-shot').selectOption('wipe');
    await page.locator('label', { hasText: 'Length' }).locator('select').selectOption('event');
    await page.waitForTimeout(100);
    tr = await drawn();
    assert.ok(tr.length === 1 && tr[0].style === 'wipe' && tr[0].progress > 0 && tr[0].progress < 1, `restyled as a wipe over the event's length (${JSON.stringify(tr)})`);
    await screenshot('shot-wipe');
    // Back to the recorded animation, so later steps see the shot as it was.
    await page.getByTestId('transition-mode').selectOption('recorded');
    await page.getByTestId('transition-restyle').uncheck();
    await page.evaluate(() => (window as any).__mapmaker.store.flush());
    await page.getByTestId('mode-world').click();
  });

  await step('Coastline clipping: territory over the sea disappears, territory on land stays', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByTestId('map-canvas').waitFor();
    await setDate('2000');
    const b = decodeBasemap(JSON.parse(readFileSync(join(ROOT, 'data', 'natural-earth', 'ne-110m.json'), 'utf8')) as BasemapFile);
    const onLand = (ll: LL) => geoContains(b.land, ll);
    const clearOfCoast = (ll: LL) => [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) => onLand([ll[0] + dx, ll[1] + dy]) === onLand(ll));
    // Sample a grid over the map; keep owned points well away from any coast.
    const { cx, cy } = await centre();
    const samples: Array<{ ll: LL; land: boolean }> = [];
    for (let x = cx - 360; x <= cx + 360; x += 24) for (let y = cy - 200; y <= cy + 200; y += 24) {
      const ll = await hook<LL | null>('pageToLonLat', x, y);
      if (!ll || !clearOfCoast(ll) || !(await ownerAt(ll, '2000'))) continue;
      samples.push({ ll, land: onLand(ll) });
    }
    // Labels are drawn on top of everything; points under them (before or after clipping) are left out.
    type Label = { text: string; x: number; y: number; size: number };
    const readLabels = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastLabels as Label[]);
    const canvasBox = await page.getByTestId('map-canvas').boundingBox();
    const labelsBefore = await readLabels();
    const underLabel = async (ll: LL, labels: Label[]) => {
      const [px, py] = await toPage(ll);
      const x = px - canvasBox!.x, y = py - canvasBox!.y;
      return labels.some((l) => Math.abs(x - l.x) < l.text.length * l.size * 0.35 + 6 && Math.abs(y - l.y) < l.size * 0.6 + 6);
    };
    for (let i = samples.length - 1; i >= 0; i--) if (await underLabel(samples[i].ll, labelsBefore)) samples.splice(i, 1);
    let seaSamples = samples.filter((p) => !p.land), landSamples = samples.filter((p) => p.land);
    assert.ok(seaSamples.length >= 10 && landSamples.length >= 5, `${seaSamples.length} sea and ${landSamples.length} land samples inside the countries`);
    const before = new Map<string, number[]>();
    for (const p of samples) before.set(String(p.ll), await canvasPixel(p.ll));
    const ocean = await canvasPixel([-30, 40]); // open sea, no territory
    for (const p of seaSamples) assert.ok(colourDiff(before.get(String(p.ll))!, ocean) > 20, 'unclipped: territory is drawn over the sea');

    await page.getByTestId('clip-to-land').check();
    await page.waitForTimeout(150);
    // Once clipped, every label stands on land.
    const labelsAfter = await readLabels();
    assert.equal(labelsAfter.length, 2);
    for (const l of labelsAfter) {
      const ll = await toLL([l.x + canvasBox!.x, l.y + canvasBox!.y]);
      assert.ok(onLand(ll), `the label "${l.text}" is on land (${ll})`);
    }
    for (let i = samples.length - 1; i >= 0; i--) if (await underLabel(samples[i].ll, labelsAfter)) samples.splice(i, 1);
    seaSamples = samples.filter((p) => !p.land); landSamples = samples.filter((p) => p.land);
    for (const p of seaSamples) assert.ok(colourDiff(await canvasPixel(p.ll), ocean) <= 8, `clipped: the sea at ${p.ll} shows the ocean`);
    for (const p of landSamples) assert.ok(colourDiff(await canvasPixel(p.ll), before.get(String(p.ll))!) <= 8, `clipped: the land at ${p.ll} keeps its territory colour`);
    await screenshot('coastline-clipping');
    // Undo brings the territory back over the sea.
    await page.getByTestId('undo').click();
    await page.waitForFunction(() => !(document.querySelector('[data-testid=clip-to-land]') as HTMLInputElement).checked);
  });

  await step('Label looks: one style for all labels, and a country with its own text and colour, another hidden', async () => {
    type L = { text: string; style: { color: string; uppercase: boolean; font: string } };
    const labels = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastLabels.map((l: any) => ({ text: l.text, style: l.style }))) as Promise<L[]>;
    await page.getByTestId('open-label-style').click();
    await page.getByTestId('label-style-dialog').waitFor();
    await page.getByTestId('general-label-uppercase').check();
    await page.getByTestId('general-label-font').selectOption('Georgia');
    await page.getByTestId('general-label-color').fill('#ffe08a');
    await screenshot('label-style-dialog');
    await page.getByTestId('label-style-dialog').getByRole('button', { name: 'Done' }).click();
    let ls = await labels();
    assert.ok(ls.length >= 1 && ls.every((l) => l.text === l.text.toUpperCase() && l.style.font === 'Georgia' && l.style.color === '#ffe08a'), `all labels follow the general style: ${JSON.stringify(ls)}`);
    // Country A: its own text and colour. Country B: no label.
    await page.locator('.left .row', { hasText: A }).click();
    await page.getByTestId('label-text').fill('Republic of A');
    await page.getByTestId('label-text').press('Tab');
    await page.locator('.own-look > summary').click();
    await page.getByTestId('country-label-color').fill('#ff4040');
    await page.locator('.left .row', { hasText: B }).click();
    await page.getByTestId('label-shown').uncheck();
    await page.waitForTimeout(150);
    ls = await labels();
    assert.deepEqual(ls.map((l) => l.text).sort(), ['REPUBLIC OF A'], `A shows its own text in capitals, B is hidden: ${ls.map((l) => l.text)}`);
    assert.equal(ls[0].style.color, '#ff4040', "A's own colour");
    assert.equal(ls[0].style.font, 'Georgia', 'other settings still come from the general style');
    await screenshot('label-looks');
    // The look is saved with the project.
    await page.evaluate(() => (window as any).__mapmaker.store.flush());
  });

  await step("A country filled with a flag (France) instead of its colour", async () => {
    await page.getByTestId('mode-world').click().catch(() => undefined);
    await page.locator('.left .row', { hasText: A }).click();
    await setDate('1451');
    await page.getByTestId('label-shown').uncheck(); // the label would cover the point measured
    await page.waitForTimeout(150);
    const before = await canvasPixel(P.westA);
    await page.getByTestId('choose-flag').click();
    await page.getByTestId('flag-search').fill('France');
    await page.getByTestId('flag-fr').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.all('entity').some((e: any) => e.style.includes('data/flags/fr.svg')));
    await page.waitForTimeout(400); // the flag picture loads, then the map redraws
    const after = await canvasPixel(P.westA);
    assert.ok(before[0] > before[2] + 40, `A's own colour is red-orange (${before})`);
    const orange = (c: number[]) => c[0] > c[2] + 40 && c[1] < 140;
    assert.ok(!orange(after) && colourDiff(after, before) > 60, `A shows the French flag, not its colour (${before} -> ${after})`);
    assert.match(await page.getByTestId('country-fill').innerText(), /Filled with a flag/);
    await screenshot('flag-fill');
    // Back to its colour.
    await page.getByTestId('fill-color').click();
    await page.waitForTimeout(150);
    const back = await canvasPixel(P.westA);
    assert.ok(back[0] > back[2] + 40, `colour again (${back})`);
    await page.getByTestId('label-shown').check();
  });

  await step('History Health reports no problems', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByTestId('health').click();
    await page.getByText('No problems found').waitFor();
    await screenshot('history-health');
    await page.locator('.modal-actions').getByRole('button', { name: 'Close' }).click();
  });

  assert.deepEqual(pageErrors, [], 'no errors in the browser console');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser!?.close().catch(() => undefined);
  await stopServer();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok} of ${results.length} steps passed${process.exitCode ? ' (stopped at the first failure)' : ''}. Screenshots: e2e/output/`);
  if (pageErrors.length) console.log('Browser errors:\n' + pageErrors.join('\n'));
}
