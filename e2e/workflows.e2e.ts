// Second interface test: the workflows the first test does not cover, and a close inspection of
// exported files. Run after building: node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, ROOT, blob, readPNG, pixel, hexRGB, near, compositeOver, type LL } from './harness.ts';

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
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByPlaceholder('e.g. Aster Prime').fill('Aster');
    await page.locator('.modal label', { hasText: 'Radius' }).locator('input').fill('3000');
    await page.getByRole('button', { name: 'Create map' }).click();
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

  await h.step('Event groups: make groups on the timeline, put events in several, filter what the timeline lists', async () => {
    const listed = () => page.evaluate(() => Array.from(document.querySelectorAll('.left .row')).map((r) => r.textContent ?? '').filter((t) => /\d{4}/.test(t)));
    const has = (rows: string[], name: string) => rows.some((r) => r.includes(name));
    const groupsOn = page.getByTestId('group-filter-button');
    await groupsOn.click();
    for (const g of ['West', 'Treaties']) {
      await page.getByTestId('new-group-name').fill(g);
      await page.getByTestId('new-group-create').click();
      await page.getByTestId(`group-show-${g}`).waitFor();
    }
    await h.screenshot('event-groups-popover');
    await page.locator('.group-popover .close').click();
    // Occupation of the west: West; Border treaty: West and Treaties (more than one group).
    for (const [event, groups] of [['Occupation of the west', ['West']], ['Border treaty', ['West', 'Treaties']]] as const) {
      await page.locator('.left .row', { hasText: event }).first().click();
      for (const g of groups) await page.getByTestId(`event-group-${g}`).check();
    }
    await h.saved();
    // Filter: only Treaties.
    await groupsOn.click();
    await page.getByTestId('group-show-West').uncheck();
    await page.getByTestId('group-show-ungrouped').uncheck();
    let rows = await listed();
    assert.ok(has(rows, 'Border treaty') && !has(rows, 'Occupation of the west') && !has(rows, 'Union'), `only the Treaties group is listed: ${rows}`);
    assert.match(await page.getByTestId('events-hidden').innerText(), /hidden by the group filter/);
    assert.match(await groupsOn.innerText(), /1 of 3 groups/);
    // A new event made while filtering joins the shown group, so it stays visible.
    await page.locator('.group-popover .close').click();
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Second treaty');
    await page.getByTestId('event-start').fill('1960');
    assert.ok(await page.locator('.modal').getByTestId('event-group-Treaties').isChecked(), 'the shown group is pre-ticked');
    await page.locator('.modal label', { hasText: 'Record what I draw next' }).locator('input').uncheck();
    await page.getByTestId('event-create').click();
    await h.saved();
    rows = await listed();
    assert.ok(has(rows, 'Second treaty'), 'the new event is listed');
    await h.screenshot('timeline-filtered-to-treaties');
    // The filter changes only the lists: the map still shows every event's history.
    assert.equal(await h.ownerAt(P.b, '2011'), null, 'the fade (in no shown group) still applies');
    // Remembered after reloading the page.
    await page.waitForTimeout(800); // the view (with the filter) is remembered half a second after the last change
    await page.reload();
    await page.locator('.project-row').first().click();
    await page.getByTestId('map-canvas').waitFor();
    await page.waitForFunction(() => /1 of 3 groups/.test(document.querySelector('[data-testid=group-filter-button]')?.textContent ?? ''), null, { timeout: 5000 })
      .catch(async () => assert.fail(`the filter is remembered after reloading (button: "${await page.getByTestId('group-filter-button').textContent()}")`));
    // Deleting a group keeps its events; show everything again.
    await page.getByTestId('group-filter-button').click();
    page.once('dialog', (d) => d.accept());
    await page.locator('.group-row', { hasText: 'West' }).getByRole('button', { name: 'Delete' }).click();
    await page.locator('.group-popover').getByRole('button', { name: 'Show all' }).click();
    await page.locator('.group-popover .close').click();
    rows = await listed();
    for (const e of ['Occupation of the west', 'Border treaty', 'Union', 'Second treaty']) assert.ok(has(rows, e), `${e} is listed again`);
    const members = await page.evaluate(() => (window as any).__mapmaker.store.world.all('event_group_member').length);
    assert.equal(members, 2, 'Border treaty and Second treaty remain in Treaties');
    await h.saved();
  });

  await h.step('Zooming in the middle of a brush stroke does not change the shape being drawn', async () => {
    await page.locator('.left .row', { hasText: 'Political' }).locator('span').first().click();
    await h.newCountry('Zoomland');
    await page.getByTestId('tool-lasso').click();
    const { cx, cy } = await h.centre();
    // A circle on the map, about 120 px across at the current zoom, planned in map positions.
    const c = await h.toLL([cx + 220, cy + 140]);
    const edge = await h.toLL([cx + 280, cy + 140]);
    const R = Math.abs(edge[0] - c[0]);
    const at = (k: number): LL => [c[0] + R * Math.cos((2 * Math.PI * k) / 24), c[1] + R * 0.8 * Math.sin((2 * Math.PI * k) / 24)];
    const first = await h.toPage(at(0));
    await page.mouse.move(first[0], first[1]);
    await page.mouse.down();
    for (let k = 1; k <= 24; k++) {
      if (k === 8 || k === 16) { // zoom in (2x), then out a little, while the button is still held
        const z0 = await page.evaluate(() => (window as any).__mapmaker.store.camera.zoom);
        await page.mouse.wheel(0, k === 8 ? -400 : 120);
        await page.waitForTimeout(80);
        assert.notEqual(await page.evaluate(() => (window as any).__mapmaker.store.camera.zoom), z0, 'the map zoomed mid-stroke');
      }
      const q = await h.toPage(at(k % 24));
      await page.mouse.move(q[0], q[1], { steps: 2 });
    }
    await page.mouse.up();
    // The outline the app received spans exactly the circle drawn on the map (within 1.5°).
    const box = await page.evaluate(() => {
      const ring = (window as any).__mapmaker.store.pending.rings[0] as number[][];
      const ll = ring.map((v) => [Math.atan2(v[1], v[0]) * 180 / Math.PI, Math.asin(v[2]) * 180 / Math.PI]);
      return [Math.min(...ll.map((q) => q[0])), Math.max(...ll.map((q) => q[0])), Math.min(...ll.map((q) => q[1])), Math.max(...ll.map((q) => q[1]))];
    });
    const planned = [c[0] - R, c[0] + R, c[1] - 0.8 * R, c[1] + 0.8 * R];
    box.forEach((b, i) => assert.ok(Math.abs(b - planned[i]) < 1.5, `outline extent ${box.map((x) => x.toFixed(1))} matches the circle drawn ${planned.map((x) => x.toFixed(1))}`));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await h.saved();
    const date = await page.getByTestId('current-date').inputValue();
    assert.equal(await h.ownerAt(c, date), 'Zoomland', 'the centre of the drawn circle');
    assert.equal(await h.ownerAt([c[0] + R * 0.7, c[1]], date), 'Zoomland', 'inside, near the edge');
    // Inside the part of the circle drawn before zooming (directions 30° and 60°, 80% of the way out).
    for (const deg of [30, 60]) {
      const q: LL = [c[0] + 0.8 * R * Math.cos((deg * Math.PI) / 180), c[1] + 0.8 * R * 0.8 * Math.sin((deg * Math.PI) / 180)];
      assert.equal(await h.ownerAt(q, date), 'Zoomland', `inside the part drawn before zooming (${deg}°)`);
    }
    assert.notEqual(await h.ownerAt([c[0] + R * 1.5, c[1]], date), 'Zoomland', 'outside the circle drawn on the map');
    assert.notEqual(await h.ownerAt([c[0], c[1] + R * 1.4], date), 'Zoomland', 'outside the circle drawn on the map');
    await h.screenshot('zoomed-mid-stroke');
  });

  await h.step('Drawing flow: correction preselected, Enter applies, several border changes in one event, right-click deselects', async () => {
    await h.setDate('1970');
    const { cx, cy } = await h.centre();
    // 1. A correction needs no clicks at all: draw, press Enter.
    await h.drawLasso(blob(cx - 260, cy + 180, 30, 25));
    await page.getByTestId('choice-correct').waitFor();
    assert.match((await page.getByTestId('choice-correct').getAttribute('class')) ?? '', /\bon\b/, 'correct this period is preselected');
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-correct').waitFor({ state: 'detached' });
    await h.saved();
    assert.equal(await h.ownerAt(await h.toLL([cx - 260, cy + 180]), '1970'), 'Zoomland');
    // 2. Two border changes go into one event: the second drawing offers the first one's event.
    const before = await page.evaluate(() => (window as any).__mapmaker.store.world.all('event').length);
    await h.drawLasso(blob(cx - 180, cy + 180, 30, 25));
    await page.getByTestId('choice-new').click();
    await page.getByTestId('event-target').selectOption('new-event');
    await page.getByTestId('new-event-name').fill('Zoomland expansion');
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-new').waitFor({ state: 'detached' });
    await h.drawLasso(blob(cx - 100, cy + 180, 30, 25));
    await page.getByTestId('choice-new').click();
    const ev = await page.evaluate(() => (window as any).__mapmaker.store.world.all('event').find((e: any) => e.name === 'Zoomland expansion').id);
    assert.equal(await page.getByTestId('event-target').inputValue(), ev, 'the second drawing goes into the same event by default');
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-new').waitFor({ state: 'detached' });
    await h.saved();
    const after = await page.evaluate((id) => {
      const w = (window as any).__mapmaker.store.world;
      return { events: w.all('event').length, effects: w.all('effect').filter((f: any) => f.event_id === id).length };
    }, ev);
    assert.equal(after.events, before + 1, 'one event for both border changes');
    assert.equal(after.effects, 2, 'the event holds both changes');
    // 3. Right-click deselects.
    assert.ok(await page.evaluate(() => (window as any).__mapmaker.store.selection !== null));
    await page.mouse.click(cx + 100, cy - 100, { button: 'right' });
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.selection), null, 'nothing is selected after a right-click');
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
    for (const pass of ['background', 'land', 'fills', 'borders', 'labels', 'overlays', 'all']) assert.equal(ex.frames(pass).length, 25, pass);
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
      const beauty = readPNG(ex.frames('all')[f]);
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
    const w = page.getByRole('spinbutton', { name: 'Width', exact: true }), hgt = page.getByRole('spinbutton', { name: 'Height', exact: true });
    await w.fill('1000'); await w.press('Enter');
    await hgt.fill('1000'); await hgt.press('Enter');
    await page.locator('label', { hasText: 'Projection' }).locator('select').selectOption('naturalEarth');
    await page.getByLabel(/Transparent background/).check();
    for (const label of ['Background', 'Territory fills', 'Borders', 'Labels', 'Text overlays']) await page.getByLabel(label, { exact: true }).uncheck();
    // Export into a folder of the user's choosing (typed here; "Choose…" opens the system folder picker).
    const custom = join(ROOT, '.tmp', 'workflows-chosen-export-folder');
    rmSync(custom, { recursive: true, force: true });
    await page.getByTestId('export-dir').fill(custom);
    await h.saved();
    const ex = await exportShot('export-full');
    assert.ok(ex.dir.startsWith(custom), `exported into the chosen folder (${ex.dir})`);
    assert.deepEqual(ex.manifest.resolution, [1000, 1000]);
    assert.equal(ex.manifest.fps, 23.976);
    const frames = ex.frames('all');
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
