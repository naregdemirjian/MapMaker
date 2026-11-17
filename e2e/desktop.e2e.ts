// End-to-end test of the desktop app (Electron): it starts its own data service, shows the
// interface in its own window, keeps projects on disk, closes cleanly and reopens them.
//
//   node scripts/build.mjs && node --disable-warning=ExperimentalWarning e2e/desktop.e2e.ts
//   (on Linux without a screen: xvfb-run -a node ... e2e/desktop.e2e.ts)
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// The path of the Electron program (the 'electron' package exports it when required from Node).
const electronPath = createRequire(import.meta.url)('electron') as unknown as string;

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'e2e', 'output', 'desktop');
const PROJECTS = join(ROOT, '.tmp', 'desktop-projects');
rmSync(PROJECTS, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(PROJECTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const launch = async (): Promise<{ app: ElectronApplication; page: Page }> => {
  const app = await electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ROOT],
    env: { ...process.env, MAPMAKER_PROJECTS: PROJECTS, MAPMAKER_PORT: '4381' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
};

let passed = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  process.stdout.write(`• ${name} … `);
  const t0 = Date.now();
  await fn();
  passed++;
  console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
};

let { app, page } = await launch();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await step('The desktop app opens its window with the project list', async () => {
    assert.equal(await page.title(), 'Map Maker');
    await page.getByTestId('project-name').waitFor();
    const url = page.url();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the interface is served by the app itself, on this computer only');
    const version = await page.evaluate(async () => (await (await fetch('/api/app')).json()).version);
    assert.match(version, /^\d+\.\d+\.\d+$/);
  });

  await step('Create a project; it is written to the projects folder; Earth is drawn; a layer can be added', async () => {
    await page.getByTestId('project-name').fill('Desktop Test');
    await page.getByTestId('project-create').click();
    await page.getByTestId('map-canvas').waitFor();
    assert.ok(existsSync(join(PROJECTS, 'Desktop Test.mapmaker', 'project.db')));
    await page.waitForFunction(() => (window as any).__mapmaker.store.basemap, null, { timeout: 20000 });
    await page.getByRole('button', { name: '+ New' }).click();
    await page.getByTestId('new-entity-name').fill('Desktop Country');
    await page.getByTestId('new-entity-create').click();
    await page.getByTestId('entity-panel').waitFor();
    // Naming works in the desktop app (it has no browser prompt): a new layer.
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('ask-input').fill('Religion');
    await page.getByTestId('ask-input').press('Enter');
    await page.locator('.left .row', { hasText: 'Religion' }).waitFor();
    await page.screenshot({ path: join(OUT, '01-desktop-window.png') });
  });

  await step('Only one copy runs: starting it again brings the open window forward', async () => {
    const second = spawn(electronPath, [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ROOT], {
      env: { ...process.env, MAPMAKER_PROJECTS: PROJECTS, MAPMAKER_PORT: '4381' }, stdio: 'ignore',
    });
    const exited = await new Promise<boolean>((res) => { second.once('exit', () => res(true)); setTimeout(() => { second.kill(); res(false); }, 15000); });
    assert.ok(exited, 'the second copy quits by itself');
    assert.equal(app.windows().length, 1);
  });

  await step('Close the app, start it again: the project and its contents are still there', async () => {
    await app.close();
    ({ app, page } = await launch());
    page.on('pageerror', (e) => errors.push(e.message));
    const row = page.locator('.project-row', { hasText: 'Desktop Test' });
    await row.waitFor();
    await row.click();
    await page.getByTestId('map-canvas').waitFor();
    await page.locator('.left .row', { hasText: 'Desktop Country' }).waitFor();
    await page.screenshot({ path: join(OUT, '02-reopened.png') });
  });

  await step('No errors in the interface', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await app.close().catch(() => undefined);
}
console.log(`\n${passed} of 5 steps passed. Screenshots: ${OUT}`);
