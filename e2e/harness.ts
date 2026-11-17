// Shared helpers for the interface tests: the local service, test steps, map/page conversions, PNG reading.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

export type LL = [number, number];
export type Pt = [number, number];
export const ROOT = resolve(import.meta.dirname, '..');

export class Harness {
  server: ChildProcess | null = null;
  baseUrl = '';
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  results: Array<{ name: string; ok: boolean; ms: number }> = [];
  pageErrors: string[] = [];
  private shotNo = 0;
  readonly projects: string;
  readonly out: string;
  readonly port: number;

  constructor(name: string, port: number) {
    this.projects = join(ROOT, '.tmp', `${name}-projects`);
    this.out = join(ROOT, 'e2e', 'output', name);
    this.port = port;
    rmSync(this.projects, { recursive: true, force: true });
    rmSync(this.out, { recursive: true, force: true });
    mkdirSync(this.projects, { recursive: true });
    mkdirSync(this.out, { recursive: true });
  }

  async startServer(): Promise<void> {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs'), '--port', String(this.port), '--projects', this.projects], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.server = p;
    this.baseUrl = await new Promise<string>((res, rej) => {
      let out = '';
      const timer = setTimeout(() => rej(new Error(`The service did not start:\n${out}`)), 20000);
      p.stdout!.on('data', (d) => { out += d; const m = /running at (http:\/\/\S+)/.exec(out); if (m) { clearTimeout(timer); res(m[1]); } });
      p.stderr!.on('data', (d) => { out += d; });
      p.on('exit', (code) => { clearTimeout(timer); rej(new Error(`The service exited (${code}):\n${out}`)); });
    });
  }

  async stopServer(): Promise<void> {
    const p = this.server;
    this.server = null;
    if (!p || p.exitCode !== null) return;
    await new Promise<void>((res) => { p.once('exit', () => res()); p.kill('SIGTERM'); setTimeout(res, 5000); });
  }

  async open(): Promise<void> {
    await this.startServer();
    this.browser = await chromium.launch({ channel: 'chrome', headless: true });
    // (MAPMAKER_E2E_VIEWPORT=1500x900 tries another window size: no step should depend on exactly
    // where things fall on screen, since fonts differ between systems and with them the map's size.)
    const size = /^(\d+)x(\d+)$/.exec(process.env.MAPMAKER_E2E_VIEWPORT ?? '');
    const viewport = size ? { width: Number(size[1]), height: Number(size[2]) } : { width: 1600, height: 950 };
    this.context = await this.browser.newContext({ viewport, deviceScaleFactor: 1 });
    this.page = this.watch(await this.context.newPage());
    await this.page.goto(this.baseUrl);
    // Everything worked out from what was there before is also worked out afresh, and must be the same (see main.tsx).
    await this.page.waitForFunction(() => !!(window as any).__mapmaker);
    await this.page.evaluate(() => (window as any).__mapmaker.verify());
  }

  watch(p: Page): Page {
    p.on('pageerror', (e) => this.pageErrors.push(`page error: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') this.pageErrors.push(`console: ${m.text()}`); });
    return p;
  }

  async step(name: string, fn: () => Promise<void>): Promise<void> {
    const t0 = Date.now();
    process.stdout.write(`• ${name} … `);
    try {
      await fn();
      this.results.push({ name, ok: true, ms: Date.now() - t0 });
      console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      this.results.push({ name, ok: false, ms: Date.now() - t0 });
      console.log('FAILED');
      await this.page?.screenshot({ path: join(this.out, 'FAILED.png') }).catch(() => undefined);
      throw e;
    }
  }

  async screenshot(name: string): Promise<void> {
    await this.page.waitForTimeout(150);
    await this.page.screenshot({ path: join(this.out, `${String(++this.shotNo).padStart(2, '0')}-${name}.png`) });
  }

  async finish(error?: unknown): Promise<void> {
    if (error) { console.error(error); process.exitCode = 1; }
    await this.browser?.close().catch(() => undefined);
    await this.stopServer();
    const ok = this.results.filter((r) => r.ok).length;
    console.log(`\n${ok} of ${this.results.length} steps passed${process.exitCode ? ' (stopped at the first failure)' : ''}. Screenshots: ${this.out}`);
    if (this.pageErrors.length) { console.log('Browser errors:\n' + this.pageErrors.join('\n')); process.exitCode = 1; }
  }

  // --- the map
  async centre(): Promise<{ cx: number; cy: number }> {
    const b = (await this.page.getByTestId('map-canvas').boundingBox())!;
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  }
  hook<T>(fn: string, ...args: unknown[]): Promise<T> {
    return this.page.evaluate(([f, a]) => (window as any).__mapmaker[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
  }
  async toLL(p: Pt): Promise<LL> { const ll = await this.hook<LL | null>('pageToLonLat', p[0], p[1]); assert.ok(ll, `point ${p} is not on the map`); return ll; }
  async toPage(ll: LL): Promise<Pt> { const p = await this.hook<Pt | null>('lonLatToPage', ll[0], ll[1]); assert.ok(p, `${ll} is not visible`); return p; }
  ownerAt(ll: LL, date: string): Promise<string | null> { return this.hook<string | null>('ownerAt', ll[0], ll[1], date); }
  /** Owner on a named layer of the world being viewed. */
  ownerOnLayer(ll: LL, date: string, layerName: string): Promise<string | null> {
    return this.page.evaluate(([lon, lat, d, ln]) => {
      const m = (window as any).__mapmaker, s = m.store;
      const layer = s.world.all('layer').find((l: any) => l.space_id === s.spaceId && l.name === ln);
      const saved = s.layerId;
      s.layerId = layer.id;
      try { return m.ownerAt(lon, lat, d); } finally { s.layerId = saved; }
    }, [ll[0], ll[1], date, layerName] as const);
  }
  async waitOwner(ll: LL, date: string, owner: string | null): Promise<void> {
    await this.page.waitForFunction(([lon, lat, d, o]) => (window as any).__mapmaker.ownerAt(lon, lat, d) === o, [ll[0], ll[1], date, owner] as const, { timeout: 8000 });
  }
  saved(): Promise<unknown> { return this.page.evaluate(() => (window as any).__mapmaker.store.flush()); }
  async setDate(text: string): Promise<void> {
    const f = this.page.getByTestId('current-date');
    await f.fill(text);
    await f.press('Enter');
    await this.page.waitForTimeout(60);
  }
  async drawLasso(pts: Pt[]): Promise<void> {
    const { page } = this;
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 3 });
    await page.mouse.move(pts[0][0], pts[0][1], { steps: 3 });
    await page.mouse.up();
  }
  async newCountry(name: string): Promise<void> {
    await this.page.getByRole('button', { name: '+ New' }).click();
    await this.page.getByTestId('new-entity-name').fill(name);
    await this.page.getByTestId('new-entity-create').click();
    await this.page.getByTestId('entity-panel').waitFor();
  }
}

export function blob(cx: number, cy: number, rx: number, ry: number, n = 40): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 1 + 0.05 * Math.sin(5 * a) + 0.03 * Math.cos(3 * a + 1);
    pts.push([cx + rx * wob * Math.cos(a), cy + ry * wob * Math.sin(a)]);
  }
  return pts;
}

export function decodePNG(buf: Buffer): { width: number; height: number; data: Uint8Array } {
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
export const readPNG = (file: string) => decodePNG(readFileSync(file));
export const pixel = (img: { width: number; data: Uint8Array }, x: number, y: number) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};
export const hexRGB = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const near = (a: number[], b: number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/** Composite RGBA layers bottom to top with Premiere's Normal blend (straight alpha "over"). */
export function compositeOver(layers: Array<{ data: Uint8Array }>, n: number): Float64Array {
  const out = new Float64Array(n * 4);
  for (const L of layers) {
    const d = L.data;
    for (let i = 0; i < n; i++) {
      const a = d[i * 4 + 3] / 255, ab = out[i * 4 + 3];
      const ao = a + ab * (1 - a);
      for (let c = 0; c < 3; c++) out[i * 4 + c] = ao > 0 ? (d[i * 4 + c] * a + out[i * 4 + c] * ab * (1 - a)) / ao : 0;
      out[i * 4 + 3] = ao;
    }
  }
  return out;
}
