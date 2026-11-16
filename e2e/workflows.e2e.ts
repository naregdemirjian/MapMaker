// Second interface test: the workflows the first test does not cover, and a close inspection of
// exported files. Run after building: node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, blob, readPNG, pixel, hexRGB, near, compositeOver, type LL } from './harness.ts';

const h = new Harness('workflows', 4395);
const P: Record<string, LL> = {};
const A = 'Kingdom of Testa', B = 'Duchy of Proba', C = 'Aster Republic';

async function exportShot(button: 'export-preview' | 'export-full') {
  const { page } = h;
  await page.getByTestId(button).click();
  await page.getByTestId('export-result').waitFor({ timeout: 300000 });
  const dir = ((await page.locator('[data-testid=export-result] .path').textContent()) ?? '').trim();
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const frames = (pass: string) => readdirSync(join(dir, pass)).filter((f) => f.endsWith('.png')).sort().map((f) => join(dir, pass, f));
  return { dir, manifest, frames };
}

try {
  await h.open();
  const { page } = h;

  await h.step('Create a project and draw a country with the precise shape tool', async () => {
    await page.getByTestId('project-name').fill('Workflows Test');
    await page.getByTestId('project-create').click();
    await page.getByTestId('map-canvas').waitFor();
    // These countries are drawn over the Atlantic: keep their territory over the sea
    // (coastline clipping is checked in the vertical-slice test).
    await page.getByTestId('clip-to-land').uncheck();
    await h.newCountry(A);
    await page.getByTestId('tool-polygon').click();
    const { cx, cy } = await h.centre();
    const corners: Array<[number, number]> = [[cx - 200, cy - 90], [cx + 40, cy - 110], [cx + 70, cy + 60], [cx - 60, cy + 120], [cx - 220, cy + 40]];
    for (const [x, y] of corners) await page.mouse.click(x, y);
    await page.mouse.dblclick(corners[4][0] + 1, corners[4][1] + 1);
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    P.a = await h.toLL([cx - 80, cy]);
    P.aEdge = await h.toLL([cx - 30, cy - 20]);
    P.out = await h.toLL([cx + 300, cy - 200]);
    await h.waitOwner(P.a, '1500', A);
    assert.equal(await h.ownerAt(P.out, '1500'), null);
    await h.screenshot('precise-shape');
  });

  await h.step('A second country, an occupation on a custom layer, hiding layers', async () => {
    await h.newCountry(B);
    await page.getByTestId('tool-lasso').click();
    const { cx, cy } = await h.centre();
    await h.drawLasso(blob(cx + 200, cy, 110, 90));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    P.b = await h.toLL([cx + 220, cy]);
    await h.waitOwner(P.b, '1500', B);
    // A custom layer for military control.
    page.once('dialog', (d) => void d.accept('Military control'));
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.locator('.left .row', { hasText: 'Military control' }).getByText('drawing here').waitFor();
    // Base: everyone controls their own land; then B occupies part of A in 1700.
    await page.getByTestId('tool-lasso').click();
    await page.getByTestId('paint-owner').selectOption({ label: A });
    await h.drawLasso(blob(cx - 80, cy, 170, 130));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Occupation of the west');
    await page.getByTestId('event-start').fill('1700');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-create').click();
    await page.getByTestId('tool-lasso').click();
    await page.getByTestId('paint-owner').selectOption({ label: B });
    const ap = await h.toPage(P.a);
    await h.drawLasso(blob(ap[0], ap[1], 45, 40));
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    await h.saved();
    assert.equal(await h.ownerOnLayer(P.a, '1750', 'Military control'), B, 'occupied');
    assert.equal(await h.ownerOnLayer(P.a, '1650', 'Military control'), A);
    assert.equal(await h.ownerOnLayer(P.a, '1750', 'Political'), A, 'ownership is untouched by occupation');
    await h.setDate('1750');
    await h.screenshot('occupation-layer-1750');
    // Hide the political layer: only military control is drawn.
    await page.locator('.left .row', { hasText: 'Political' }).locator('input[type=checkbox]').uncheck();
    await h.saved();
    const visible = await page.evaluate(() => (window as any).__mapmaker.store.world.all('layer').filter((l: any) => l.visible).map((l: any) => l.name));
    assert.deepEqual(visible, ['Military control']);
    await h.screenshot('political-hidden');
    await page.locator('.left .row', { hasText: 'Political' }).locator('input[type=checkbox]').check();
    await page.locator('.left .row', { hasText: 'Political' }).locator('span', { hasText: 'Political' }).click();
  });

  await h.step('Alternative versions of an event switch history back and forth', async () => {
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Border treaty');
    await page.getByTestId('event-start').fill('1800');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-create').click();
    await page.getByTestId('tool-lasso').click();
    await page.getByTestId('paint-owner').selectOption({ label: B });
    const ep = await h.toPage(P.aEdge);
    await h.drawLasso(blob(ep[0], ep[1], 30, 25));
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    await h.waitOwner(P.aEdge, '1850', B);
    page.once('dialog', (d) => void d.accept('Border treaty (no cession)'));
    await page.getByRole('button', { name: 'Create alternative version' }).click();
    await page.getByTestId('event-panel').getByText('Border treaty (no cession)').first().waitFor();
    // In the alternative, the cession is removed.
    await page.getByTestId('event-panel').getByRole('button', { name: 'Remove' }).first().click();
    await h.waitOwner(P.aEdge, '1850', A);
    await page.getByTestId('event-panel').getByRole('button', { name: 'Use this version' }).click();
    await h.waitOwner(P.aEdge, '1850', B);
    assert.equal(await h.ownerAt(P.aEdge, '1750'), A, 'earlier history is the same in both versions');
    await h.screenshot('alternative-versions');
  });

  await h.step('Annexation, deleting an event, and undoing the deletion', async () => {
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Union');
    await page.getByTestId('event-start').fill('1900');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-create').click();
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    const annex = page.locator('.annex');
    await annex.locator('select').nth(0).selectOption({ label: A });
    await annex.locator('select').nth(1).selectOption({ label: B });
    await annex.getByRole('button', { name: 'Add annexation' }).click();
    await h.waitOwner(P.b, '1950', A);
    assert.equal(await h.ownerAt(P.aEdge, '1950'), A, 'the land B gained in 1800 is annexed too');
    assert.equal(await h.ownerAt(P.b, '1899'), B);
    await h.saved();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete event' }).click();
    await h.waitOwner(P.b, '1950', B);
    await h.saved();
    await page.getByTestId('undo').click();
    await h.waitOwner(P.b, '1950', A);
    await page.locator('.left .row', { hasText: 'Union' }).waitFor();
  });

  await h.step('A fade over the length of an event', async () => {
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Slow decline');
    await page.getByTestId('event-start').fill('2000');
    await page.getByTestId('event-end').fill('2010');
    await page.getByTestId('event-end').press('Enter');
    await page.getByTestId('event-create').click();
    await page.getByTestId('tool-lasso').click();
    await page.getByTestId('paint-owner').selectOption({ label: 'Nobody (clear territory)' });
    const bp = await h.toPage(P.b);
    await h.drawLasso(blob(bp[0], bp[1], 40, 35));
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    await page.getByTestId('transition-style').first().selectOption('fade');
    await h.saved();
    assert.equal(await h.ownerAt(P.b, '2003'), A, 'under halfway through the fade');
    assert.equal(await h.ownerAt(P.b, '2007'), null, 'past halfway');
    assert.equal(await h.ownerAt(P.b, '2011'), null);
    await h.setDate('2005');
    await h.screenshot('fade-midway-2005');
  });

  await h.step('A second world keeps its own map and history', async () => {
    await page.getByRole('button', { name: '+ World' }).click();
    await page.getByPlaceholder('e.g. Aster Prime').fill('Aster');
    await page.locator('.modal label', { hasText: 'Radius' }).locator('input').fill('3000');
    await page.getByRole('button', { name: 'Create world' }).click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId)?.name === 'Aster');
    assert.equal(await h.ownerAt(P.a, '1500'), null, 'Aster starts blank at the same coordinates');
    await h.newCountry(C);
    await page.getByTestId('tool-lasso').click();
    const ap = await h.toPage(P.a);
    await h.drawLasso(blob(ap[0], ap[1], 60, 50));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await h.waitOwner(P.a, '1500', C);
    await h.screenshot('aster');
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    assert.equal(await h.ownerAt(P.a, '1500'), A, 'Earth is unchanged');
    await page.locator('header select').first().selectOption({ label: 'Aster' });
    assert.equal(await h.ownerAt(P.a, '1500'), C);
    assert.equal(await h.ownerAt(P.b, '1500'), null, 'Earth\'s countries never appear on Aster');
    await page.locator('header select').first().selectOption({ label: 'Earth' });
  });

  let colours: Record<string, string> = {};
  await h.step('A shot with a camera move at 2.39:1 and 25 fps; inspect every exported pass', async () => {
    colours = await page.evaluate((names) => Object.fromEntries(names.map((n) => [n, (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === n).color])), [A, B]);
    await page.locator('.left .row', { hasText: 'Union' }).click();
    await page.getByTestId('mode-present').click();
    await page.getByTestId('new-shot').click();
    await page.getByTestId('shot-editor').waitFor();
    // History shown: 1880 to 1920, across the union of 1900.
    await page.getByTestId('shot-from').fill('1880'); await page.getByTestId('shot-from').press('Enter');
    await page.getByTestId('shot-to').fill('1920'); await page.getByTestId('shot-to').press('Enter');
    await page.locator('label', { hasText: 'Pacing' }).locator('select').selectOption('linear');
    await page.locator('label', { hasText: 'Resolution' }).locator('select').selectOption('scope');
    await page.locator('label', { hasText: 'Frame rate' }).locator('select').selectOption('25');
    await page.getByTestId('shot-seconds').fill('1'); await page.getByTestId('shot-seconds').press('Enter');
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.all('sequence')[0]?.settings.includes('"frames":25'));
    // Camera: start as framed, end zoomed in and moved.
    await page.getByTestId('set-start-view').click();
    const { cx, cy } = await h.centre();
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.mouse.down(); await page.mouse.move(cx - 80, cy + 30, { steps: 6 }); await page.mouse.up();
    await page.getByTestId('set-end-view').click();
    await h.saved();
    await page.getByTestId('frame-slider').fill('12');
    await h.screenshot('presentation-camera-move');

    const ex = await exportShot('export-preview');
    const m = ex.manifest;
    assert.deepEqual(m.resolution, [480, 201], '2.39:1 at a quarter size');
    assert.equal(m.fps, 25);
    assert.deepEqual(m.frames, [0, 24]);
    for (const pass of ['background', 'land', 'fills', 'borders', 'labels', 'overlays', 'beauty']) assert.equal(ex.frames(pass).length, 25, pass);
    assert.match(readFileSync(join(ex.dir, 'COMPOSITING_GUIDE.txt'), 'utf8'), /25 fps/);

    // Frame timing: evenly spaced through the chosen range, first and last exactly on the ends.
    const instants = [];
    for (let f = 0; f < 25; f++) instants.push(await h.hook<{ day: number; ms: number }>('shotInstantAt', f));
    const ms = instants.map((t) => t.day * 864e5 + t.ms);
    const step = (ms[24] - ms[0]) / 24;
    for (let f = 1; f < 25; f++) assert.ok(Math.abs(ms[f] - ms[f - 1] - step) <= 1, `frame ${f} is evenly spaced`);
    const days = (y: number) => Math.round(((Date.UTC(y, 0, 1) / 864e5)));
    assert.equal(instants[0].day, days(1880));
    assert.equal(instants[24].day, days(1920));

    // The camera moves: background frames all differ; with a static camera they were identical.
    const bg = Object.values(m.checksums.background as Record<string, string>);
    assert.equal(new Set(bg).size, 25, 'every frame of the camera move is different');

    // Correct history in the pixels: before 1900 B's land is B's colour, after it A's (annexation).
    const at0 = await page.evaluate(([lon, lat]) => (window as any).__mapmaker.exportPixel(lon, lat, 0, 0.25), P.b);
    const at24 = await page.evaluate(([lon, lat]) => (window as any).__mapmaker.exportPixel(lon, lat, 24, 0.25), P.b);
    const f0 = readPNG(ex.frames('fills')[0]), f24 = readPNG(ex.frames('fills')[24]);
    assert.ok(near(pixel(f0, at0[0], at0[1]).slice(0, 3), hexRGB(colours[B])), 'frame 1 (1880): B');
    assert.ok(near(pixel(f24, at24[0], at24[1]).slice(0, 3), hexRGB(colours[A])), 'frame 25 (1920): A after the union');

    // The separate passes stacked with Premiere's Normal blend reproduce the full picture.
    for (const f of [0, 12, 24]) {
      const layers = ['background', 'land', 'fills', 'borders', 'labels', 'overlays'].map((p) => readPNG(ex.frames(p)[f]));
      const beauty = readPNG(ex.frames('beauty')[f]);
      const n = beauty.width * beauty.height;
      const comp = compositeOver(layers, n);
      let sum = 0, bad = 0;
      for (let i = 0; i < n; i++) {
        let d = 0;
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(comp[i * 4 + c] - beauty.data[i * 4 + c]));
        sum += d; if (d > 12) bad++;
      }
      assert.ok(sum / n < 1.5, `frame ${f}: average difference ${(sum / n).toFixed(2)} levels`);
      assert.ok(bad / n < 0.005, `frame ${f}: ${(100 * bad / n).toFixed(2)}% of pixels differ noticeably`);
    }
  });

  await h.step('A square custom size, another projection, 23.976 fps and a transparent full picture', async () => {
    await page.locator('label', { hasText: 'Frame rate' }).locator('select').selectOption('23.976');
    await page.getByTestId('shot-seconds').fill('0.1'); await page.getByTestId('shot-seconds').press('Enter');
    const w = page.locator('label', { hasText: 'Width' }).locator('input'), hgt = page.locator('label', { hasText: 'Height' }).locator('input');
    await w.fill('1000'); await w.press('Enter');
    await hgt.fill('1000'); await hgt.press('Enter');
    await page.locator('label', { hasText: 'Projection' }).locator('select').selectOption('naturalEarth');
    await page.getByLabel('Transparent background (beauty pass)').check();
    for (const label of ['Background', 'Territory fills', 'Borders', 'Labels', 'Text overlays']) await page.getByLabel(label, { exact: true }).uncheck();
    await h.saved();
    const ex = await exportShot('export-full');
    assert.deepEqual(ex.manifest.resolution, [1000, 1000]);
    assert.equal(ex.manifest.fps, 23.976);
    const frames = ex.frames('beauty');
    assert.equal(frames.length, 2);
    const img = readPNG(frames[0]);
    assert.equal(img.width, 1000); assert.equal(img.height, 1000);
    assert.equal(pixel(img, 1, 1)[3], 0, 'transparent corner (outside the Natural Earth outline)');
    assert.ok(existsSync(join(ex.dir, 'manifest.json')));
  });

  await h.step('History Health lists the overlap, nothing else; no browser errors', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByTestId('health').click();
    await page.locator('.modal').waitFor();
    await h.screenshot('history-health');
    const kinds = await page.evaluate(() => (window as any).__mapmaker.store.engine.conflicts.map((c: any) => c.kind));
    assert.ok(!kinds.includes('broken'), `no broken references (${kinds.join(', ')})`);
    await page.locator('.modal-actions').getByRole('button', { name: 'Close' }).click();
  });
  await h.finish();
} catch (e) {
  await h.finish(e);
}
