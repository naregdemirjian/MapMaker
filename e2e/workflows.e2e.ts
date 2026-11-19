// Second interface test: the workflows the first test does not cover, and a close inspection of
// exported files. Run after building: node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { encodePNG } from '../src/export/png.ts';
import { gregorian, calendarOf, daysFromCivil, CALENDAR_TEMPLATES } from '../src/core-time/index.ts';
import { join } from 'node:path';
import { Harness, ROOT, blob, readPNG, pixel, hexRGB, near, compositeOver, writeTerrainTiles, writePhotoTiles, type LL } from './harness.ts';

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
    // "Correct this period" applies from the date being viewed: the countries exist from 1400 on.
    await h.setDate('1400');
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
    assert.equal(await h.ownerAt(P.a, '1399'), null, 'nothing before the date drawn');
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
    // Named in the app's own dialog (the desktop app has no browser prompt).
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('new-layer-name').fill('Military control');
    await page.getByTestId('new-layer-name').press('Enter');
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
    // Hatched (D88): the occupier's stripes over the owner's colour, which shows between them (a strip below the name).
    const [colA, colB] = await page.evaluate(([a, b]) => { const w = (window as any).__mapmaker.store.world; const c = (n: string) => w.all('entity').find((e: any) => e.name === n).color; return [c(a), c(b)]; }, [A, B] as const);
    const across = (want: 'mixed' | 'occupier') => page.waitForFunction(([x, y, ca, cb, w]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * (c.width / r.width)) - 30, Math.round((y - r.top) * (c.height / r.height)), 60, 1).data;
      const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const pa = rgb(ca), pb = rgb(cb);
      const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      let nearA = 0, nearB = 0;
      for (let i = 0; i < 60; i++) { const px = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]; if (dist(px, pa) < dist(px, pb)) nearA++; else nearB++; }
      return w === 'mixed' ? nearA >= 10 && nearB >= 10 : nearA <= 3;
    }, [ap[0], ap[1] + 24, colA, colB, want] as const, { timeout: 8000 });
    // (The occupation lies at sea: the layer is let cover the sea for this, and set back after.)
    await page.getByTestId('clip-to-land').uncheck();
    await h.saved();
    await across('occupier');
    await page.getByTestId('layer-fill').selectOption('hatch');
    await h.saved();
    await across('mixed');
    await h.screenshot('occupation-hatched');
    await page.getByTestId('layer-fill').selectOption('solid');
    await h.saved();
    await across('occupier');
    await page.getByTestId('clip-to-land').check();
    await h.saved();
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
    await page.getByRole('button', { name: 'Create alternative version' }).click();
    await page.getByTestId('ask-input').fill('Border treaty (no cession)');
    await page.getByTestId('ask-ok').click();
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
    await h.setDate('1400');
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

  await h.step('Border pen: draw in pieces, zoom between them, close and reopen, carry on, finish', async () => {
    await h.setDate('1985');
    await page.getByTestId('tool-pen').click();
    await page.getByTestId('paint-owner').selectOption({ label: 'Zoomland' });
    const { cx, cy } = await h.centre();
    // A square planned in map positions.
    const a = await h.toLL([cx + 120, cy - 180]), b = await h.toLL([cx + 220, cy - 80]);
    const corners: LL[] = [a, [b[0], a[1]], b, [a[0], b[1]]];
    const draftPoints = () => page.evaluate(() => (window as any).__mapmaker.store.draft?.points.length ?? 0);
    // Piece 1: two sides in one drag.
    let q = await h.toPage(corners[0]);
    await page.mouse.move(q[0], q[1]); await page.mouse.down();
    for (const k of [1, 2]) { q = await h.toPage(corners[k]); await page.mouse.move(q[0], q[1], { steps: 8 }); }
    await page.mouse.up();
    const afterPiece1 = await draftPoints();
    assert.ok(afterPiece1 >= 3, `the first piece is kept after letting go (${afterPiece1} points)`);
    // Zoom out a little between pieces, then click the last corner (a piece of one point).
    await page.mouse.move(cx, cy); await page.mouse.wheel(0, 150); await page.waitForTimeout(100);
    q = await h.toPage(corners[3]); await page.mouse.click(q[0], q[1]);
    assert.equal(await draftPoints(), afterPiece1 + 1);
    await page.getByTestId('draft-undo').click();
    assert.equal(await draftPoints(), afterPiece1, 'the last piece is taken back');
    q = await h.toPage(corners[3]); await page.mouse.click(q[0], q[1]);
    // With the pen, Ctrl+Z and Ctrl+Y act on the draft only; the project is untouched.
    const revision = () => page.evaluate(() => (window as any).__mapmaker.store.world.revision) as Promise<number>;
    const rev0 = await revision();
    await page.keyboard.press('Control+z');
    assert.equal(await draftPoints(), afterPiece1, 'Ctrl+Z took back the last piece');
    assert.equal(await revision(), rev0, 'and did not undo anything in the project');
    await page.keyboard.press('Control+y');
    assert.equal(await draftPoints(), afterPiece1 + 1, 'Ctrl+Y put it back');
    assert.equal(await revision(), rev0);
    await page.getByTestId('draft-name').fill('Zoomland claim');
    await page.waitForTimeout(500); // drafts are saved in the project folder shortly after each change
    await h.screenshot('border-pen-draft');
    // Close and reopen: the draft is still there.
    await page.reload();
    await page.locator('.project-row').first().click();
    await page.getByTestId('map-canvas').waitFor();
    await page.waitForFunction(() => (window as any).__mapmaker.store.drafts.length === 1);
    await page.getByTestId('tool-pen').click();
    assert.equal(await page.getByTestId('draft-name').inputValue(), 'Zoomland claim');
    assert.equal(await draftPoints(), afterPiece1 + 1, 'every point survived closing the app');
    // Finish with Enter, apply with Enter.
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-correct').waitFor();
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-correct').waitFor({ state: 'detached' });
    await h.saved();
    const mid: LL = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert.equal(await h.ownerAt(mid, '1985'), 'Zoomland', 'the finished border painted the square');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.drafts.length), 0, 'the finished draft is gone');
    await page.getByTestId('tool-select').click();
  });

  await h.step('Smart brushes (D148): the geography-aware brush pulls a stroke beside the Rhine onto it, weights moved live, a pin, the line used; ridges for the pen in the Pyrenees; the strategic brush pulls a town onto your side, sides swapped; undone', async () => {
    const keep = await page.evaluate(() => (window as any).__mapmaker.store.camera);
    const adjust = () => page.evaluate(() => (window as any).__mapmaker.store.adjust);
    const weight = async (key: string, v: number) => { await page.getByTestId('smart-adjust').getByTestId(`smart-${key}`).fill(String(v)); };
    // The Upper Rhine, close enough for Natural Earth's detailed rivers.
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 7.9, lat: 48.7, zoom: 6.2, rotation: 0, projection: 'equirectangular' }));
    await page.waitForFunction(() => (window as any).__mapmaker.store.basemap?.scales.some((b: any) => b.scale === '10m' && b.rivers), null, { timeout: 60000 });
    await page.waitForTimeout(300);
    // The Rhine: the river nearest the bank at Strasbourg.
    const rhine = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const r = document.querySelector('[data-testid=map-canvas]')!.getBoundingClientRect();
      const sc = B.chooseScale(s.basemap, B.makeView(s.camera, r.width, r.height));
      let best: number[][] = [], bd = Infinity;
      for (const l of sc.rivers.lines.coordinates) for (const p of l) { const d = Math.hypot(p[0] - 7.8, p[1] - 48.58); if (d < bd) { bd = d; best = l; } }
      // (And every river near it: the brush follows whichever runs nearest the stroke.)
      const near = sc.rivers.lines.coordinates.filter((l: number[][]) => l.some((p) => p[0] > 7 && p[0] < 9 && p[1] > 48 && p[1] < 49.3));
      return { near: bd, line: best, all: near };
    });
    assert.ok(rhine.near < 0.02, `the Rhine found (${rhine.near.toFixed(3)}° from its bank)`);
    const along = rhine.line.filter((p) => p[1] > 48.3 && p[1] < 49.0);
    const onPage: Array<[number, number]> = [];
    for (const p of along) onPage.push(await h.toPage([p[0], p[1]]));
    onPage.sort((u, v) => u[1] - v[1]);
    // A brush stroke on the German bank (tributaries join it across, none runs alongside): down the river 9 px
    // east of it, then back north 170 px further east.
    const top = onPage[0], bottom = onPage[onPage.length - 1];
    const stroke: Array<[number, number]> = [...onPage.map(([x, y]) => [x + 9, y] as [number, number]), [bottom[0] + 170, bottom[1]], [top[0] + 170, top[1]]];
    const distTo = (lines: number[][][]) => (p: number[]) => {
      let b = Infinity;
      for (const line of lines) for (let i = 0; i + 1 < line.length; i++) {
        const u = line[i], v = line[i + 1], dx = v[0] - u[0], dy = v[1] - u[1], l2 = dx * dx + dy * dy;
        const k = l2 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2)) : 0;
        b = Math.min(b, Math.hypot(p[0] - u[0] - k * dx, p[1] - u[1] - k * dy));
      }
      return b;
    };
    const distToRhine = distTo([rhine.line]), distToRiver = distTo(rhine.all);
    // (The side drawn beside the river: what lies near it, away from the corners.)
    const eastSide = (line: number[][]) => line.filter((p) => p[1] > 48.45 && p[1] < 48.85 && distToRhine(p) < 0.12);
    await page.getByTestId('tool-lasso').click();
    await page.getByTestId('paint-owner').selectOption({ label: A });
    assert.equal(await page.getByTestId('smart-brush').locator('summary').innerText(), 'Smart brush ▾');
    await page.getByTestId('smart-brush').locator('summary').click();
    await page.getByTestId('smart-on').check();
    await page.getByTestId('smart-geography').check();
    // (Rivers only, for now.)
    for (const k of ['coasts', 'ridges', 'borders', 'lines']) await page.getByTestId('smart-brush').getByTestId(`smart-${k}`).fill('0');
    await page.getByTestId('smart-brush').getByTestId('smart-rivers').fill('80');
    await page.getByTestId('smart-brush').locator('summary').click();
    assert.equal(await page.getByTestId('smart-brush').locator('summary').innerText(), 'Geography-aware brush ▾');
    await h.drawLasso(stroke);
    // Shown adjusted, the stroke beside it, before anything is asked.
    await page.getByTestId('smart-adjust').waitFor();
    await page.waitForFunction(() => { const a = (window as any).__mapmaker.store.adjust; return a?.result && a.followed > 0; });
    assert.equal(await page.getByTestId('confirm-edit').count(), 0, 'nothing asked yet');
    let a = await adjust();
    const followed = eastSide(a.result[0]);
    assert.ok(followed.length >= 10, `${followed.length} points beside the river`);
    const worst = Math.max(...followed.map(distToRiver));
    assert.ok(worst < 1e-5, `the side drawn beside the river is a river's course (${worst.toExponential(1)}° off at worst)`);
    const drawnOff = eastSide(a.lines[0].stroke).map(distToRhine).sort((u: number, v: number) => u - v);
    assert.ok(drawnOff[Math.floor(drawnOff.length / 2)] > 0.02, 'the stroke itself, beside it, kept as the ghost');
    await h.screenshot('smart-brush-rhine');
    // The river's weight to nothing, live: the line as drawn; and back.
    await weight('rivers', 0);
    await page.waitForFunction(() => { const a = (window as any).__mapmaker.store.adjust; return a?.result && a.followed === 0; });
    a = await adjust();
    const loose = eastSide(a.result[0]).map(distToRhine).sort((u: number, v: number) => u - v);
    assert.ok(loose[Math.floor(loose.length / 2)] > 0.02, `no pull: beside the river as drawn (${loose[Math.floor(loose.length / 2)].toFixed(3)}°)`);
    await weight('rivers', 80);
    await page.waitForFunction(() => { const a = (window as any).__mapmaker.store.adjust; return a?.result && a.followed > 0; });
    // A pin 30 px east of the river, halfway down: the line passes through it; clicked again, gone.
    const mid = along.reduce((b, p) => (Math.abs(p[1] - 48.65) < Math.abs(b[1] - 48.65) ? p : b), along[0]);
    const midPage = await h.toPage([mid[0], mid[1]]);
    await page.mouse.click(midPage[0] + 30, midPage[1]);
    await page.waitForFunction(() => { const a = (window as any).__mapmaker.store.adjust; return a?.pins.length === 1 && a.result; });
    a = await adjust();
    const pin = a.pins[0];
    assert.ok(a.result[0].some((p: number[]) => Math.hypot(p[0] - pin[0], p[1] - pin[1]) < 1e-6), 'through the pin');
    await page.mouse.click(midPage[0] + 30, midPage[1]);
    await page.waitForFunction(() => { const a = (window as any).__mapmaker.store.adjust; return a?.pins.length === 0 && a.result; });
    // Used: then the usual question, and the land is held up to the river and not across it.
    await page.getByTestId('smart-use').click();
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await h.saved();
    assert.equal(await h.ownerAt([mid[0] + 0.025, mid[1]], '1985'), A, 'up to the river');
    assert.notEqual(await h.ownerAt([mid[0] - 0.03, mid[1]], '1985'), A, 'and not across it');
    await page.getByTestId('undo').click();
    await h.saved();
    // Ridges, for the border pen along the Pyrenees, a little north of the main ridge.
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ lon: 0.5, lat: 42.75, zoom: 5, rotation: 0, projection: 'equirectangular' }); s.terrainOf(s.world.get('map_space', s.spaceId)); });
    await page.waitForFunction(() => !!(window as any).__mapmaker.store.earthTerrain, null, { timeout: 60000 });
    await page.getByTestId('tool-pen').click();
    await page.getByTestId('smart-brush').locator('summary').click();
    await page.getByTestId('smart-brush').getByTestId('smart-rivers').fill('0');
    await page.getByTestId('smart-brush').getByTestId('smart-ridges').fill('100');
    await page.getByTestId('smart-brush').getByTestId('smart-radius').fill('26');
    await page.getByTestId('smart-brush').locator('summary').click();
    const drawLine = async (u: [number, number], v: [number, number]) => {
      await page.mouse.move(u[0], u[1]);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) await page.mouse.move(u[0] + ((v[0] - u[0]) * i) / 30, u[1] + ((v[1] - u[1]) * i) / 30);
      await page.mouse.up();
    };
    await drawLine(await h.toPage([-0.6, 42.86]), await h.toPage([1.6, 42.86]));
    await page.waitForFunction(() => { const a = (window as any).__mapmaker.store.adjust; return a?.result && !a.missing.length; });
    await page.getByTestId('smart-use').click();
    const pen = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const pts = s.draft.points as number[][];
      const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
      const drawn: number[] = [];
      for (let i = 0; i <= 20; i++) drawn.push(B.heightAt(s.earthTerrain, -0.6 + (2.2 * i) / 20, 42.86));
      return { lat: mean(pts.map((p) => p[1])), h: mean(pts.map((p) => B.heightAt(s.earthTerrain, p[0], p[1]))), drawnH: mean(drawn), ends: [pts[0], pts[pts.length - 1]] };
    });
    console.log(`    the pen's line on the ridges: from ${pen.drawnH.toFixed(0)} m on average as drawn to ${pen.h.toFixed(0)} m, its mean latitude ${pen.lat.toFixed(3)}° (drawn at 42.86°)`);
    assert.ok(pen.lat < 42.84 && pen.h > pen.drawnH + 80, 'onto the crest: further south, higher');
    assert.ok(Math.abs(pen.ends[0][1] - 42.86) < 0.03 && Math.abs(pen.ends[1][1] - 42.86) < 0.03, 'its ends where they were drawn');
    await h.screenshot('smart-brush-pyrenees');
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('draft-discard').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.drafts.length === 0);
    // The strategic brush: a town 8 px below a line drawn left to right; your side the left (above).
    const townAt = await h.toLL([(await h.centre()).cx, (await h.centre()).cy + 8]);
    await page.evaluate((ll) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const id = s.execute((w: any) => B.commands.createEntity(w, { type_id: 'settlement', name: 'Strategoburg' }));
      s.execute((w: any) => B.commands.placeCharacter(w, { spaceId: s.spaceId, entity: id, lon: ll[0], lat: ll[1], mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
    }, townAt);
    await h.saved();
    await page.getByTestId('smart-brush').locator('summary').click();
    await page.getByTestId('smart-strategic').check();
    for (const k of ['rivers', 'ridges', 'rough', 'points', 'passes', 'borders', 'lines']) { const f = page.getByTestId('smart-brush').getByTestId(`smart-${k}`); if (await f.count()) await f.fill('0'); }
    await page.getByTestId('smart-brush').getByTestId('smart-towns').fill('100');
    await page.getByTestId('smart-brush').getByTestId('smart-radius').fill('24');
    await page.getByTestId('smart-brush').locator('summary').click();
    assert.equal(await page.getByTestId('smart-brush').locator('summary').innerText(), 'Strategic brush ▾');
    const { cx, cy } = await h.centre();
    await drawLine([cx - 200, cy], [cx + 200, cy]);
    await page.waitForFunction(() => !!(window as any).__mapmaker.store.adjust?.result);
    // Where the line passes the town, on the page.
    const passAt = async () => {
      const r = await adjust();
      const pts: Array<[number, number]> = [];
      for (const q of r.result[0]) pts.push(await h.toPage([q[0], q[1]]));
      for (let i = 0; i + 1 < pts.length; i++) { const [u, v] = [pts[i], pts[i + 1]]; if ((u[0] - cx) * (v[0] - cx) <= 0 && u[0] !== v[0]) return u[1] + ((v[1] - u[1]) * (cx - u[0])) / (v[0] - u[0]); }
      return NaN;
    };
    const below = await passAt();
    assert.ok(below > cy + 10, `pulled onto your side: the line passes below the town (${(below - cy).toFixed(1)} px below the stroke)`);
    assert.match(await page.getByTestId('smart-side').innerText(), /left of the line as you drew it/);
    await h.screenshot('smart-brush-strategic');
    // Your side the right (below), where the town already is: the line as drawn.
    await page.getByTestId('smart-swap').click();
    await page.waitForFunction(() => { const a = (window as any).__mapmaker.store.adjust; return a?.side === -1 && a.result; });
    const asDrawn = await passAt();
    assert.ok(Math.abs(asDrawn - cy) < 4, `swapped: the town already on your side, the line as drawn (${(asDrawn - cy).toFixed(1)} px off)`);
    // Esc drops the drawing (the pen's piece taken back).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__mapmaker.store.adjust && !((window as any).__mapmaker.store.draft?.points.length));
    if (await page.evaluate(() => (window as any).__mapmaker.store.drafts.length)) { page.once('dialog', (d) => d.accept()); await page.getByTestId('draft-discard').click(); }
    // The town taken away again (two undo steps); the smart brush off (the choice is kept on this computer).
    await page.getByTestId('tool-select').click();
    for (let i = 0; i < 2; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').some((e: any) => e.name === 'Strategoburg')), false);
    await page.getByTestId('tool-lasso').click();
    await page.getByTestId('smart-brush').locator('summary').click();
    await page.getByTestId('smart-geography').check();
    await page.getByTestId('smart-on').uncheck();
    await page.getByTestId('smart-brush').locator('summary').click();
    assert.equal(await page.getByTestId('smart-brush').locator('summary').innerText(), 'Smart brush ▾');
    await page.getByTestId('tool-select').click();
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera(c), keep);
  });

  let colours: Record<string, string> = {};
  await h.step('A character: a point that travels between places over time, moved by dragging, leaves the map; never territory', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByTestId('tool-select').click();
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -30, lat: 45, zoom: 1.6, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1500');
    const C1: LL = [-45, 55], C2: LL = [-20, 62], C3: LL = [-28, 50];
    const ownersBefore = [await h.ownerAt(C1, '1550'), await h.ownerAt(C2, '1650')];
    const eventCount = () => page.evaluate(() => (window as any).__mapmaker.store.world.all('event').length) as Promise<number>;
    const eventsBefore = await eventCount();
    // A new character: made under Characters, ready to place.
    await page.getByRole('button', { name: '+ Character' }).click();
    await page.getByTestId('new-character-name').fill('Ilse the Wanderer');
    await page.getByTestId('new-character-create').click();
    await page.getByTestId('character-panel').waitFor();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.tool), 'place', 'ready to place');
    let q = await h.toPage(C1); await page.mouse.click(q[0], q[1]);
    await h.setDate('1600');
    q = await h.toPage(C2); await page.mouse.click(q[0], q[1]);
    await h.saved();
    const drawn = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCharacters) as Promise<Array<{ name: string; lon: number; lat: number; moving: boolean }>>;
    let c = (await drawn()).find((x) => x.name === 'Ilse the Wanderer')!;
    assert.ok(c && Math.abs(c.lon - C2[0]) < 0.6 && Math.abs(c.lat - C2[1]) < 0.6, `in 1600 at the second place (${c?.lon}, ${c?.lat})`);
    // Half-way through, travelling between the two places.
    await h.setDate('1550');
    c = (await drawn()).find((x) => x.name === 'Ilse the Wanderer')!;
    assert.ok(c.moving && c.lon > C1[0] + 3 && c.lon < C2[0] - 3, `travelling in 1550 (${c.lon}, ${c.lat})`);
    assert.match((await page.getByTestId('character-where').textContent()) ?? '', /travelling/);
    await h.screenshot('character-travelling');
    // Not before its first place; and never territory.
    await h.setDate('1499');
    assert.ok(!(await drawn()).some((x) => x.name === 'Ilse the Wanderer'), 'not on the map before 1500');
    assert.deepEqual([await h.ownerAt(C1, '1550'), await h.ownerAt(C2, '1650')], ownersBefore, 'the places it stands on belong to whoever held them');
    // Drag the marker with Select in 1600: that placement moves (no new one).
    await h.setDate('1600');
    await page.getByTestId('tool-select').click();
    // Leaving the Characters tool takes its hint line away and the map grows: wait for that before
    // measuring where things are (the map now redraws faster than the page settles).
    await page.waitForTimeout(150);
    const from = await h.toPage(C2), to = await h.toPage(C3);
    await page.mouse.move(from[0], from[1]); await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: 8 }); await page.mouse.up();
    await h.saved();
    assert.equal(await page.getByTestId('character-place').count(), 2, 'still two places');
    c = (await drawn()).find((x) => x.name === 'Ilse the Wanderer')!;
    assert.ok(Math.abs(c.lon - C3[0]) < 0.6 && Math.abs(c.lat - C3[1]) < 0.6, `dragged to the third place (${c.lon}, ${c.lat})`);
    // Appears instead of travelling: waits at the first place until 1600.
    await page.getByTestId('character-arrive').selectOption('jump');
    await h.setDate('1550');
    c = (await drawn()).find((x) => x.name === 'Ilse the Wanderer')!;
    assert.ok(!c.moving && Math.abs(c.lon - C1[0]) < 0.6, 'waits at the first place');
    await page.getByTestId('character-arrive').selectOption('travel');
    // Leaves the map in 1700 (and undo brings it back).
    await h.setDate('1700');
    await page.getByTestId('character-leaves').click();
    await h.setDate('1750');
    assert.ok(!(await drawn()).some((x) => x.name === 'Ilse the Wanderer'), 'gone after leaving');
    await page.getByTestId('undo').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastCharacters.some((x: any) => x.name === 'Ilse the Wanderer'));
    assert.equal(await eventCount(), eventsBefore, 'placing and moving a character makes no event');
    await h.screenshot('character-panel');
  });

  await h.step('A character\'s icon: a ship facing the way it sails and flipped on the way back, an airliner turned, on a disc, larger; back to the marker', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByTestId('tool-select').click();
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -30, lat: 45, zoom: 1.6, rotation: 0, projection: 'equirectangular' }));
    const id = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Ilse the Wanderer').id);
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ selection: { kind: 'entity', id } }), id);
    await page.getByTestId('character-icon').waitFor();
    const ilse = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCharacters.find((c: any) => c.name === 'Ilse the Wanderer')) as Promise<{ icon: string; angle: number; mirror: boolean; r: number }>;
    const shows = (want: string) => page.waitForFunction((w) => (window as any).__mapmaker.store.renderer.lastCharacters.find((c: any) => c.name === 'Ilse the Wanderer')?.icon === w, want);
    // On the way east in 1550, from 45°W to 28°W.
    await h.setDate('1550');
    assert.equal((await ilse()).icon, 'marker', 'a round marker to begin with');
    await page.getByTestId('icon-choose').click();
    await page.getByTestId('icon-grid').waitFor();
    await page.getByTestId('icon-option-sailing-ship').click();
    await shows('sailing-ship');
    assert.match(await page.getByTestId('character-icon-now').innerText(), /Sailing ship/);
    assert.equal((await ilse()).mirror, false, 'sailing east, it faces east');
    // Back west by 1650: flipped on the way.
    await page.getByTestId('place-character-button').click();
    await h.setDate('1650');
    const q = await h.toPage([-50, 47]); await page.mouse.click(q[0], q[1]);
    await h.saved();
    await page.getByTestId('tool-select').click();
    await h.setDate('1625');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastCharacters.find((c: any) => c.name === 'Ilse the Wanderer')?.mirror === true);
    await h.screenshot('character-icon');
    // An airliner turns to face the way it flies: its nose to the west.
    await page.getByTestId('icon-choose').click();
    await page.getByTestId('icon-option-airliner').click();
    await shows('airliner');
    const plane = await ilse();
    const nose = [Math.sin(plane.angle), -Math.cos(plane.angle)];
    assert.ok(nose[0] < -0.8, `its nose points west (${nose.map((v) => v.toFixed(2))})`);
    // On a disc of its colour, then three times the size (one change to undo for the slider).
    await page.getByTestId('icon-look').selectOption('badge');
    await page.waitForFunction(() => /"look":"badge"/.test((window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Ilse the Wanderer').style));
    const small = (await ilse()).r;
    await page.getByTestId('icon-size').focus();
    await page.keyboard.press('End');
    await page.waitForFunction((r) => (window as any).__mapmaker.store.renderer.lastCharacters.find((c: any) => c.name === 'Ilse the Wanderer')?.r > r * 2.5, small);
    assert.match((await page.getByTestId('character-icon').innerText()), /300%/);
    // Shown in the list of characters too.
    assert.equal(await page.getByTestId('entity-row-Ilse the Wanderer').locator('canvas').count(), 1, 'its icon in the list');
    // Back to the round marker; the place of 1650 removed again.
    await page.getByTestId('icon-choose').click();
    await page.getByTestId('icon-marker').click();
    await shows('marker');
    await page.getByTestId('character-place').nth(2).getByRole('button', { name: 'Remove' }).click();
    await h.saved();
    assert.equal(await page.getByTestId('character-place').count(), 2, 'its two places as before');
  });

  await h.step('A unit: a character belonging to a country takes its colour; an arrow of advance while it travels, none when it stands', async () => {
    const id = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Ilse the Wanderer').id);
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ tool: 'select', selection: { kind: 'entity', id } }), id);
    await page.getByTestId('character-unit').waitFor();
    const colB = await page.evaluate((n) => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === n).color, B);
    const ilse = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCharacters.find((c: any) => c.name === 'Ilse the Wanderer')) as Promise<{ color: string }>;
    await h.setDate('1550');
    await page.getByTestId('character-side').selectOption({ label: B });
    await page.waitForFunction((c) => (window as any).__mapmaker.store.renderer.lastCharacters.find((x: any) => x.name === 'Ilse the Wanderer')?.color === c, colB);
    await page.getByTestId('character-route').selectOption('arrow');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastAdvances === 1);
    await h.screenshot('unit-advancing');
    // Standing still after arriving in 1600: no arrow.
    await h.setDate('1650');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastAdvances === 0);
    assert.equal((await ilse()).color, colB);
    // Back as it was.
    await page.getByTestId('character-route').selectOption('');
    await page.getByTestId('character-side').selectOption('');
    await h.saved();
    await page.waitForFunction((c) => (window as any).__mapmaker.store.renderer.lastCharacters.find((x: any) => x.name === 'Ilse the Wanderer')?.color !== c, colB);
  });

  await h.step('A city: founded at a date, moved at once (never travelling), abandoned; drawn as its own layer', async () => {
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -30, lat: 45, zoom: 1.6, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1500');
    const K1: LL = [-38, 58], K2: LL = [-25, 56];
    await page.getByRole('button', { name: '+ City' }).click();
    await page.getByTestId('new-city-name').fill('Port Aster');
    await page.getByTestId('new-city-create').click();
    await page.getByTestId('character-panel').waitFor();
    let q = await h.toPage(K1); await page.mouse.click(q[0], q[1]);
    const cities = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCities) as Promise<Array<{ name: string; lon: number; lat: number; moving: boolean }>>;
    await h.setDate('1600');
    await page.getByTestId('tool-select').click();
    q = await h.toPage(K1); const q2 = await h.toPage(K2);
    await page.mouse.move(q[0], q[1]); await page.mouse.down(); await page.mouse.move(q2[0], q2[1], { steps: 8 }); await page.mouse.up();
    await h.saved();
    await h.setDate('1550');
    let c = (await cities()).find((x) => x.name === 'Port Aster')!;
    assert.ok(c && !c.moving && Math.abs(c.lon - K1[0]) < 0.6, `in 1550 still at its first place (${c?.lon})`);
    assert.ok(!(await page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCharacters)).some((x: any) => x.name === 'Port Aster'), 'drawn as a city, not a character');
    await h.setDate('1650');
    c = (await cities()).find((x) => x.name === 'Port Aster')!;
    assert.ok(Math.abs(c.lon - K2[0]) < 0.6, 'moved in 1600');
    await page.getByTestId('character-leaves').click();
    await h.setDate('1700');
    assert.ok(!(await cities()).some((x) => x.name === 'Port Aster'), 'abandoned');
    await h.setDate('1499');
    assert.ok(!(await cities()).some((x) => x.name === 'Port Aster'), 'not yet founded');
    await page.getByTestId('place-from-beginning').click();
    assert.ok((await cities()).some((x) => x.name === 'Port Aster'), 'there from the beginning');
    await h.screenshot('city');
    // Sizes follow the zoom: zoomed out to the whole world the name is left out (the dot stays);
    // zoomed in, it is back.
    const named = async (zoom: number) => {
      await page.evaluate((z) => (window as any).__mapmaker.store.setCamera({ lon: -30, lat: 50, zoom: z, rotation: 0, projection: 'equirectangular' }), zoom);
      await page.waitForTimeout(150);
      return (await page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCities.find((c: any) => c.name === 'Port Aster'))) as { named: boolean } | undefined;
    };
    const far = await named(0), near = await named(3);
    assert.ok(far && !far.named, 'whole world: a dot, no name');
    assert.ok(near && near.named, 'zoomed in: named');
    // Renamed from 1620 on (it is abandoned in 1650): the map shows each name in its time.
    await h.setDate('1620');
    await page.getByTestId('rename-from').click();
    await page.getByTestId('ask-input').fill('New Aster');
    await page.getByTestId('ask-input').press('Enter');
    await h.saved();
    const cityNames = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCities.map((c: any) => c.name)) as Promise<string[]>;
    assert.ok((await cityNames()).includes('New Aster'), 'called New Aster in 1620');
    await h.setDate('1600');
    assert.ok((await cityNames()).includes('Port Aster'), 'still Port Aster in 1600');
    assert.equal(await page.getByTestId('rename-row').count(), 1);
    await h.setDate('1620');
    assert.match((await page.getByTestId('name-now').textContent()) ?? '', /New Aster/);
  });

  await h.step('Working with many: Ctrl/Shift to choose, right-click menus, groups of countries, labels of a group, cities under their country, several events deleted at once', async () => {
    await page.getByTestId('tool-select').click();
    await h.setDate('1650');
    // Choose two countries with Ctrl + click; right-click: make a group of them.
    await page.getByTestId(`entity-row-${A}`).click();
    await page.getByTestId(`entity-row-${B}`).click({ modifiers: ['Control'] });
    assert.deepEqual((await page.evaluate(() => (window as any).__mapmaker.store.multi?.ids.length)), 2, 'two chosen');
    await page.getByTestId(`entity-row-${B}`).click({ button: 'right' });
    await page.getByTestId('context-menu').waitFor();
    await page.getByTestId('menu-new-group').click();
    await page.getByTestId('ask-input').fill('Main powers');
    await page.getByTestId('ask-input').press('Enter');
    await page.getByTestId('entity-group-Main powers').waitFor();
    // Fold the group: its countries leave the list; unfold.
    await page.getByTestId('entity-group-Main powers').click();
    assert.equal(await page.getByTestId(`entity-row-${A}`).count(), 0, 'folded away');
    await page.getByTestId('entity-group-Main powers').click();
    await page.getByTestId(`entity-row-${A}`).waitFor();
    // Hide the labels of the whole group from its menu, and show them again.
    const labelled = async () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastLabels.map((l: any) => l.text)) as Promise<string[]>;
    assert.ok((await labelled()).some((t) => t === A), 'A is labelled');
    await page.getByTestId('entity-group-Main powers').click({ button: 'right' });
    await page.getByTestId('menu-hide-labels').click();
    await h.saved();
    assert.ok(!(await labelled()).some((t) => t === A || t === B), 'the group\'s labels are hidden');
    await page.getByTestId('entity-group-Main powers').click({ button: 'right' });
    await page.getByTestId('menu-show-labels').click();
    assert.ok((await labelled()).some((t) => t === A), 'shown again');
    await h.screenshot('group-and-menu');
    // A city on A's land is listed under A.
    await page.getByRole('button', { name: '+ City' }).click();
    await page.getByTestId('new-city-name').fill('Testa Harbour');
    await page.getByTestId('new-city-create').click();
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 1.5, rotation: 0, projection: 'equirectangular' }), P.a);
    const q = await h.toPage(P.a); await page.mouse.click(q[0], q[1]);
    await h.saved();
    await page.getByTestId(`cities-of-${A}`).click();
    await page.getByTestId('entity-row-Testa Harbour').waitFor();
    assert.match((await page.getByTestId(`entity-row-${A}`).textContent()) ?? '', /1 city/);
    // A second city right beside it: names and labels move apart, or the less important is hidden;
    // nothing drawn overlaps.
    await page.getByRole('button', { name: '+ City' }).click();
    await page.getByTestId('new-city-name').fill('Testa Port');
    await page.getByTestId('new-city-create').click();
    await page.mouse.click(q[0] + 14, q[1] + 3);
    await h.saved();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastCities.length >= 2);
    type B = [number, number, number, number];
    const boxes = await page.evaluate(() => {
      const r = (window as any).__mapmaker.store.renderer;
      return [...r.lastLabels.filter((l: any) => l.drawn).map((l: any) => ({ name: l.text, box: l.box })), ...r.lastCities.filter((c: any) => c.named).map((c: any) => ({ name: c.name, box: c.box }))];
    }) as Array<{ name: string; box: B }>;
    const overlap = (a: B, b: B) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i].box, boxes[j].box), `"${boxes[i].name}" and "${boxes[j].name}" do not overlap`);
    assert.ok(boxes.some((b) => b.name === A), 'the country keeps its label');
    const dots = await page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCities.map((c: any) => c.name)) as string[];
    assert.ok(dots.includes('Testa Port') && dots.includes('Testa Harbour'), 'both cities are drawn');
    await h.screenshot('labels-apart');
    // Events: Shift + click chooses a run; Delete deletes them all (one question, one undo).
    await page.getByTestId('tool-select').click();
    const evRows = page.locator('[data-testid^=event-row-]');
    const before = await evRows.count();
    await evRows.nth(0).click();
    await evRows.nth(2).click({ modifiers: ['Shift'] });
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.chosen('event').length), 3);
    page.once('dialog', (d) => void d.accept());
    await page.keyboard.press('Delete');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid^=event-row-]').length === n - 3, before);
    await h.saved();
    await page.getByTestId('undo').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid^=event-row-]').length === n, before);
  });

  await h.step("Changes over time: a country shown lightly, the land it gained in a year, a decade, a century", async () => {
    await page.getByTestId('tool-select').click();
    await page.locator('.left .row', { hasText: A }).first().click();
    await page.getByTestId('entity-panel').waitFor();
    await page.getByTestId('history-mode').check();
    await page.getByTestId('history-unit').selectOption('year');
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 1, rotation: 0, projection: 'equirectangular' }), P.b);
    await h.setDate('1 June 1900');
    assert.equal(await page.getByTestId('history-period').textContent(), '1900');
    // In 1900 A annexed B: it gained land, lost none, and the Union is listed.
    const summary = (await page.getByTestId('history-summary').textContent()) ?? '';
    const km = (re: RegExp) => Number((re.exec(summary)?.[1] ?? '0').replace(/,/g, ''));
    assert.ok(km(/Gained ([\d,]+) km²/) > 100000 && km(/lost ([\d,]+) km²/) === 0, `gained, not lost: ${summary}`);
    assert.ok((await page.getByTestId('history-change').allTextContents()).some((t) => /Union/.test(t) && /from Duchy of Proba/.test(t)), 'the Union is listed, with whom from');
    // On the map, B's former land is marked as gained (green), A's own land only lightly.
    const px = async (ll: LL) => { const q = await h.toPage(ll); return page.evaluate(([x, y]) => { const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement; const r = c.getBoundingClientRect(), k = c.width / r.width; return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data).slice(0, 3); }, q); };
    const gained = await px(P.b);
    await page.getByTestId('history-mode').uncheck();
    const plain = await px(P.b);
    await page.getByTestId('history-mode').check();
    const greener = (gained[1] - gained[0]) - (plain[1] - plain[0]);
    assert.ok(greener > 40, `B's former land is marked green (${plain} -> ${gained})`);
    await h.screenshot('changes-over-time-1900');
    // The year before: nothing changed. A century: the same gain (and 1800's treaty, if it touched A).
    await page.getByTestId('history-prev').click();
    assert.equal(await page.getByTestId('history-period').textContent(), '1899');
    assert.equal(await page.getByTestId('history-change').count(), 0);
    await page.getByTestId('history-unit').selectOption('years');
    await page.getByTestId('history-years').fill('100');
    assert.equal(await page.getByTestId('history-period').textContent(), '1800–1899');
    await page.getByTestId('history-next').click();
    assert.equal(await page.getByTestId('history-period').textContent(), '1900–1999');
    assert.ok((await page.getByTestId('history-change').count()) >= 1);
    await page.getByTestId('history-mode').uncheck();
  });

  await h.step('Compare two dates: the date viewed left of a line, another right; the line dragged; the dates swapped', async () => {
    const px = async (ll: LL) => { const q = await h.toPage(ll); return page.evaluate(([x, y]) => { const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement; const r = c.getBoundingClientRect(), k = c.width / r.width; return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data).slice(0, 3); }, q); };
    const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 12;
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 1, rotation: 0, projection: 'equirectangular' }), P.b);
    // B's land in 1899 (B's own) and in 1901 (annexed by A in 1900): two colours.
    await h.setDate('1 June 1899');
    const before = await px(P.b);
    await h.setDate('1 June 1901');
    const after = await px(P.b);
    assert.ok(!near(before, after), `B's land changes colour in 1900 (${before} -> ${after})`);
    // Comparing: the other date is at first the day before the last change (the annexation).
    await page.getByTestId('compare-toggle').click();
    const other = await page.getByTestId('compare-date').inputValue();
    assert.match(other, /1899/, other);
    const box = (await page.getByTestId('map-canvas').boundingBox())!;
    const at = await h.toPage(P.b);
    const split = () => page.evaluate(() => (window as any).__mapmaker.store.compare.split as number);
    const lineX = async () => box.x + (await split()) * box.width;
    // Drag the line to the left of B's land: B's land shows the other date (1899).
    await page.mouse.move(await lineX(), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(at[0] - 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.ok((await lineX()) < at[0] - 100, 'the line moved');
    assert.ok(near(await px(P.b), before), `right of the line: 1899 (${await px(P.b)} vs ${before})`);
    await h.screenshot('compare-dates');
    // To the right of it: the date viewed (1901).
    await page.mouse.move(await lineX(), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(at[0] + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.ok(near(await px(P.b), after), `left of the line: 1901 (${await px(P.b)} vs ${after})`);
    // Swapped: the date viewed becomes 1899, the other 1901.
    await page.getByTestId('compare-swap').click();
    assert.match(await page.getByTestId('compare-date').inputValue(), /1901/);
    assert.match(await page.getByTestId('current-date').inputValue(), /1899/);
    assert.ok(near(await px(P.b), before), 'left of the line now 1899');
    // Off again: the whole map at the date viewed.
    await page.getByTestId('compare-toggle').click();
    assert.equal(await page.getByTestId('compare-date').count(), 0);
    assert.ok(near(await px(P.b), before));
    await h.setDate('1 June 1901');
  });

  await h.step('Event types: a type of its own with a colour, a usual length and way of spreading; used for a new event and a drawing; renamed; deleted and undone', async () => {
    const typeOf = (name: string) => page.evaluate((n) => { const w = (window as any).__mapmaker.store.world; const t = w.all('event_type').find((x: any) => x.name === n); return t ? { id: t.id as string, fields: JSON.parse(t.fields) } : null; }, name);
    // (A field shows what follows from a choice once the page has drawn it again.)
    const shows = (id: string, text: string) => page.waitForFunction(([i, t]) => ((document.querySelector(`[data-testid="${i}"]`) as HTMLInputElement | null)?.value ?? '').includes(t), [id, text] as const, { timeout: 5000 });
    const eventOf = (name: string) => page.evaluate((n) => { const w = (window as any).__mapmaker.store.world; return w.all('event').find((x: any) => x.name === n) ?? null; }, name);
    await page.getByTestId('open-event-types').click();
    await page.getByTestId('new-type-name').fill('Siege');
    await page.getByTestId('new-type-create').click();
    await page.getByTestId('type-row-Siege').waitFor();
    await page.getByTestId('type-color-Siege').fill('#aa3300');
    await page.getByTestId('type-spread-Siege').selectOption('fade');
    await page.getByTestId('type-length-Siege-n').fill('6');
    await page.getByTestId('type-length-Siege-unit').selectOption('month');
    await h.saved();
    const siege = (await typeOf('Siege'))!;
    assert.deepEqual(siege.fields, { color: '#aa3300', spread: 'fade', length: { n: 6, unit: 'month' } });
    await h.screenshot('event-types');
    await page.getByTestId('event-types-dialog').getByText('Close', { exact: true }).click();
    // A new event of the type lasts six months unless another end is typed in; it is coloured by its type.
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Siege of Proba');
    await page.getByTestId('event-start').fill('1 March 1950');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-type').selectOption({ label: 'Siege' });
    await shows('event-end', '1 September 1950');
    await page.getByRole('checkbox', { name: 'Record what I draw next into' }).uncheck();
    await page.getByTestId('event-create').click();
    const ev = await eventOf('Siege of Proba');
    assert.equal(ev.type_id, siege.id);
    assert.equal(await page.getByTestId('event-panel-type').inputValue(), siege.id);
    assert.equal(await page.getByTestId('event-row-Siege of Proba').locator('.swatch').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(170, 51, 0)');
    // Drawing into it: its territory fades in, as the type says, without choosing.
    const b = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Duchy of Proba').id);
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ tool: 'lasso', paintValue: id }), b);
    await h.setDate('1 April 1950');
    const at = await h.toPage(P.b);
    await h.drawLasso(blob(at[0], at[1], 40, 30));
    await page.getByTestId('choice-new').click();
    await page.getByTestId('event-target').selectOption(ev.id);
    await shows('spread-style', 'fade');
    // (A new event of the type would last six months from the date viewed.)
    await page.getByTestId('event-target').selectOption('new-event');
    await page.getByTestId('new-event-type').selectOption({ label: 'Siege' });
    await shows('new-event-end', '1 October 1950');
    await page.getByTestId('event-target').selectOption(ev.id);
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-new').waitFor({ state: 'detached' });
    await h.saved();
    const fx = await page.evaluate((id) => (window as any).__mapmaker.store.world.all('effect').filter((f: any) => f.event_id === id).map((f: any) => JSON.parse(f.transition || 'null')), ev.id);
    assert.equal(fx.length, 1);
    assert.equal(fx[0]?.style, 'fade');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ tool: 'select' }));
    // Renamed, then deleted: its event becomes a plain event; undo brings the type back.
    await page.getByTestId('open-event-types').click();
    await page.getByTestId('type-name-Siege').fill('Siege warfare');
    await page.getByTestId('type-name-Siege').press('Enter');
    await page.getByTestId('type-row-Siege warfare').waitFor();
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('type-delete-Siege warfare').click();
    await page.getByTestId('type-row-Siege warfare').waitFor({ state: 'detached' });
    assert.equal((await eventOf('Siege of Proba')).type_id, 'general');
    await h.saved();
    await page.getByTestId('event-types-dialog').getByText('Close', { exact: true }).click();
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal((await eventOf('Siege of Proba')).type_id, siege.id);
    assert.equal((await typeOf('Siege warfare'))?.id, siege.id);
  });

  await h.step('Dates: an event\'s end starts at its start; chosen on a calendar; the date viewed stepped with the arrow keys', async () => {
    const union = () => page.evaluate(() => (window as any).__mapmaker.store.world.all('event').find((e: any) => e.name === 'Union'));
    await page.getByTestId('event-row-Union').click();
    const end = page.getByTestId('event-panel-end');
    assert.equal(await end.getAttribute('placeholder'), '1 January 1900', 'an instantaneous event\'s end shows its start');
    await end.focus();
    await end.press('Tab');
    assert.equal((await union()).end_day, null, 'left untouched, the event stays instantaneous');
    // The arrow keys start from it: a day on.
    await end.press('ArrowUp');
    assert.equal(await end.inputValue(), '2 January 1900');
    await end.press('Escape');
    await end.fill('');
    await end.press('Tab');
    // On the calendar: two months on, the 15th.
    await page.getByTestId('event-panel-end-calendar').click();
    await page.getByTestId('event-panel-end-popover').waitFor();
    await page.getByTestId('cal-month-forward').click();
    await page.getByTestId('cal-month-forward').click();
    await h.screenshot('calendar');
    await page.getByTestId('cal-day-15').click();
    await h.saved();
    const ev = await union();
    assert.equal(await end.inputValue(), '15 March 1900');
    assert.equal(ev.end_day, gregorian.fromCivil({ year: 1900, month: 3, day: 15 }).day);
    // A year typed into the calendar, then the keyboard: a week on, Enter.
    await page.getByTestId('event-panel-end-calendar').click();
    await page.getByTestId('cal-year').fill('1901');
    await page.getByTestId('cal-year').press('Enter');
    await page.getByTestId('event-panel-end-popover').press('ArrowDown');
    await page.getByTestId('event-panel-end-popover').press('Enter');
    await h.saved();
    assert.equal(await end.inputValue(), '22 March 1901');
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal((await union()).end_day, null, 'undone');
    // The date viewed: up a day, Shift: a month, Alt: a year.
    await h.setDate('10 May 1930');
    const cur = page.getByTestId('current-date');
    await cur.press('ArrowUp');
    assert.equal(await cur.inputValue(), '11 May 1930');
    await cur.press('Shift+ArrowUp');
    assert.equal(await cur.inputValue(), '11 June 1930');
    await cur.press('Alt+ArrowDown');
    assert.equal(await cur.inputValue(), '11 June 1929');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.time.day), gregorian.fromCivil({ year: 1929, month: 6, day: 11 }).day, 'the date viewed moved with the keys');
    await h.setDate('1930');
  });

  await h.step('A map\'s own calendar (D149): started from a template, an era added; dates written, typed, stepped and chosen in it, in the shot preview too; the Gregorian again in one step', async () => {
    const keep = await page.evaluate(() => (window as any).__mapmaker.store.time);
    await h.setDate('1 January 1100');
    assert.equal(await page.getByTestId('open-calendar').innerText(), 'Calendar: Gregorian…');
    await page.getByTestId('open-calendar').click();
    await page.getByTestId('calendar-template').selectOption('world');
    assert.equal(await page.getByTestId('calendar-preview').innerText(), 'The date viewed: 6 Turning 100 AF (Gregorian: 1 January 1100; a Starday). Its year 1 began on 1 January 1000.');
    // An era of its own: the Third Age, from its year 101.
    await page.getByTestId('calendar-add-era').click();
    await page.getByTestId('calendar-era-name-1').fill('Third Age');
    await page.getByTestId('calendar-era-abbr-1').fill('TA');
    await page.getByTestId('calendar-era-start-1').fill('101');
    assert.equal(await page.getByTestId('calendar-problems').count(), 0);
    await page.getByTestId('calendar-use').click();
    await page.getByTestId('calendar-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('open-calendar').innerText(), 'Calendar: Calendar of the Founding…');
    // (The date field writes its date afresh just after the calendar or the date changes: waited for, not read at once.)
    const dateIs = async (v: string) => {
      await page.waitForFunction((x) => (document.querySelector('[data-testid=current-date]') as HTMLInputElement).value === x, v, { timeout: 5000 }).catch(() => undefined);
      assert.equal(await page.getByTestId('current-date').inputValue(), v);
    };
    await dateIs('6 Turning 100 AF');
    // The same calendar, worked out here: what is typed is that day.
    const W = calendarOf({ ...CALENDAR_TEMPLATES.find((t) => t.id === 'world')!.def, eras: [{ name: 'After the Founding', abbr: 'AF', start: 1 }, { name: 'Third Age', abbr: 'TA', start: 101 }] });
    await h.setDate('14 Frostmoon 20 TA');
    assert.deepEqual(await page.evaluate(() => (window as any).__mapmaker.store.time), W.fromCivil({ year: 120, month: 8, day: 14 }));
    await dateIs('14 Frostmoon 20 TA');
    assert.equal(W.fromCivil({ year: 1 }).day, daysFromCivil(1000, 1, 1));
    // Stepped a day with the arrow keys; chosen on its calendar (a week of six days, 36 to the month).
    await page.getByTestId('current-date').focus();
    await page.keyboard.press('ArrowUp');
    await dateIs('15 Frostmoon 20 TA');
    await page.getByTestId('current-date-calendar').click();
    assert.equal(await page.locator('.date-popover .date-weekday').count(), 6);
    assert.equal(await page.getByTestId('cal-month').inputValue(), '8');
    await page.getByTestId('cal-day-36').click();
    await page.waitForFunction(() => (document.querySelector('[data-testid=current-date]') as HTMLInputElement).value === '36 Frostmoon 20 TA');
    await h.screenshot('calendar-own');
    // In a shot's preview, the frame's date written in it too.
    const shotId = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, s.camera, s.time, s.time, 24, 1);
      const id = s.execute((w: any) => B.commands.createSequence(w, 'In its calendar', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    });
    await page.getByTestId('frame-info').waitFor();
    assert.match(await page.getByTestId('frame-info').innerText(), /36 Frostmoon 20 TA/);
    await page.getByTestId('mode-world').click();
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false);
    // The Gregorian again (one step); the date as it was, written as ever.
    await page.getByTestId('open-calendar').click();
    await page.getByTestId('calendar-use-gregorian').click();
    assert.equal(await page.getByTestId('open-calendar').innerText(), 'Calendar: Gregorian…');
    await dateIs(gregorian.format(W.fromCivil({ year: 120, month: 8, day: 36 }), 'day'));
    await page.evaluate((t) => (window as any).__mapmaker.store.setTime(t), keep);
  });

  await h.step('Recording into an event: each change spreads until the next one recorded; the last then given two years of its own in the event\'s panel', async () => {
    await page.getByTestId('mode-world').click();
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -30, lat: 45, zoom: 1.6, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1960');
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Western campaign');
    await page.getByTestId('event-start').fill('1960');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-end').fill('1970');
    await page.getByTestId('event-end').press('Enter');
    await page.getByRole('checkbox', { name: 'Record what I draw next into' }).check();
    await page.getByTestId('event-create').click();
    await page.getByTestId('recording').waitFor();
    const evId = await page.evaluate(() => (window as any).__mapmaker.store.world.all('event').find((e: any) => e.name === 'Western campaign').id);
    // Each change spreads, fading in, until the next one recorded.
    await page.getByTestId('record-when').selectOption('next');
    await page.getByTestId('record-style').selectOption('fade');
    const owner = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Aster Republic').id);
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ tool: 'lasso', paintValue: id }), owner);
    const { cx, cy } = await h.centre();
    for (const [date, dx] of [['1961', -160], ['1964', 0], ['1966', 160]] as const) {
      await h.setDate(date);
      await h.drawLasso(blob(cx + dx, cy - 170, 28, 22));
      await h.saved();
    }
    const specs = await page.evaluate((id) => (window as any).__mapmaker.store.world.all('effect').filter((f: any) => f.event_id === id).sort((a: any, b: any) => a.ordinal - b.ordinal).map((f: any) => JSON.parse(f.transition || 'null')), evId);
    const day = (y: number) => gregorian.fromCivil({ year: y, month: 1, day: 1 }).day;
    assert.equal(specs.length, 3, 'three changes recorded');
    assert.ok(specs.every((sp: any) => sp?.style === 'fade' && sp.next), 'each recorded to last until the next');
    assert.deepEqual(specs.map((sp: any) => sp.until?.[0] ?? null), [day(1964), day(1966), null], 'the first two end where the next begins; the last at the end of the event');
    // Half-way through the second, its land is half faded in.
    await h.setDate('1965');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTransitions.some((t: any) => t.style === 'fade' && Math.abs(t.progress - 0.5) < 0.05));
    // The event's panel lists how long each takes; the last is given two years of its own.
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ tool: 'select', selection: { kind: 'event', id } }), evId);
    await page.getByTestId('event-panel').waitFor();
    assert.deepEqual(await page.getByTestId('change-span').allInnerTexts(), [
      '1 January 1961 to 1 January 1964 (until the next change recorded)',
      '1 January 1964 to 1 January 1966 (until the next change recorded)',
      '1 January 1966 to 1 January 1970 (until the next change recorded)',
    ]);
    await page.getByTestId('change-length').nth(2).selectOption('for');
    await page.getByTestId('change-for-n').fill('2');
    await page.getByTestId('change-for-n').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=change-span]')[2]?.textContent === '1 January 1966 to 1 January 1968');
    await h.screenshot('record-lengths');
    // The last made an expansion, then from two points at once (D91): the second chosen by a click on the map.
    await page.getByTestId('transition-style').nth(2).selectOption('advance');
    await page.getByTestId('add-origin').click();
    await page.mouse.click(cx + 190, cy - 170);
    await page.waitForFunction(() => /2 points at once/.test(document.querySelector('[data-testid=change-origins]')?.textContent ?? ''));
    const pincer = await page.evaluate((id) => JSON.parse((window as any).__mapmaker.store.world.all('effect').filter((f: any) => f.event_id === id).sort((a: any, b: any) => a.ordinal - b.ordinal)[2].transition), evId);
    assert.equal(pincer.style, 'advance');
    assert.equal(pincer.origins?.length, 1, 'a second starting point');
    assert.deepEqual(pincer.for, { n: 2, unit: 'year' }, 'its length kept');
    await page.getByTestId('clear-origins').click();
    await page.waitForFunction(() => /one point/.test(document.querySelector('[data-testid=change-origins]')?.textContent ?? ''));
    // Back as it was: changes happen at once when recorded; the event deleted.
    await page.getByTestId('record-when').selectOption('instant');
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete event' }).click();
    await h.saved();
    assert.equal(await page.evaluate((id) => (window as any).__mapmaker.store.world.get('event', id) ?? null, evId), null);
  });

  await h.step('Split and merge: a line drawn across a country, the part clicked becomes a new country; two countries merged into a new one in an event; undone', async () => {
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -150, lat: -30, zoom: 3, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1930');
    await h.newCountry('Splitland');
    await page.getByTestId('tool-lasso').click();
    const { cx, cy } = await h.centre();
    await h.drawLasso(blob(cx, cy, 150, 100));
    await page.getByTestId('choice-correct').waitFor();
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-correct').waitFor({ state: 'detached' });
    await h.saved();
    const north = await h.toLL([cx, cy - 50]), south = await h.toLL([cx, cy + 50]);
    assert.equal(await h.ownerAt(north, '1960'), 'Splitland');
    // Split from 1950: a line right across, then a click on the northern part.
    await h.setDate('1950');
    await page.getByTestId('tool-split').click();
    await page.mouse.move(cx - 220, cy + 5);
    await page.mouse.down();
    await page.mouse.move(cx + 220, cy - 5, { steps: 12 });
    await page.mouse.up();
    await page.getByTestId('split-again').waitFor();
    await page.mouse.click(cx + 10, cy - 50);
    await page.getByTestId('split-prompt').waitFor();
    assert.equal(await page.getByTestId('split-new-name').inputValue(), 'North Splitland');
    await h.screenshot('split-prompt');
    await page.keyboard.press('Enter');
    await page.getByTestId('split-prompt').waitFor({ state: 'detached' });
    await h.saved();
    assert.equal(await h.ownerAt(north, '1951'), 'North Splitland');
    assert.equal(await h.ownerAt(south, '1951'), 'Splitland');
    assert.equal(await h.ownerAt(north, '1940'), 'Splitland', 'before 1950, one country');
    // The line went away with the split; the tool waits for a new one.
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.splitLine), null);
    // A point of the new border moved from 1960 on (not for all time): the sliver between changes hands then.
    await h.setDate('1960');
    await page.getByTestId('tool-vertex').click();
    const centreLL = await h.toLL([cx, cy]);
    const v = await page.evaluate(([lon, lat]) => {
      const s = (window as any).__mapmaker.store, arr = s.world.arrangement(s.spaceId);
      let best: any = null, bd = Infinity;
      for (const r of arr.vertices.values()) { const d = Math.hypot(r.lon / 1e7 - lon, r.lat / 1e7 - lat); if (d < bd) { bd = d; best = r; } }
      return [best.lon / 1e7, best.lat / 1e7] as [number, number];
    }, centreLL);
    const vp = await h.toPage(v);
    await page.mouse.move(vp[0], vp[1]);
    await page.mouse.down();
    await page.mouse.move(vp[0], vp[1] - 30, { steps: 8 });
    await page.mouse.up();
    await page.getByTestId('vertex-choice-dated').click();
    await page.getByTestId('confirm-vertex').click();
    await h.saved();
    const sliver = await h.toLL([vp[0], vp[1] - 12]);
    assert.equal(await h.ownerAt(sliver, '1961'), 'Splitland', 'from 1960 the border runs through the new place');
    assert.equal(await h.ownerAt(sliver, '1955'), 'North Splitland', 'before 1960 it runs as it did');
    await page.getByTestId('tool-select').click();
    // Merge the two again, into a new country, in a new event of 1970.
    await h.setDate('1970');
    await page.getByTestId('entity-row-Splitland').click();
    await page.getByTestId('entity-row-North Splitland').click({ modifiers: ['Control'] });
    await page.getByTestId('entity-row-North Splitland').click({ button: 'right' });
    await page.getByTestId('menu-merge').click();
    await page.getByTestId('merge-dialog').waitFor();
    await page.getByTestId('merge-into').selectOption('new');
    await page.getByTestId('merge-new-name').fill('Reunited Splitland');
    await page.getByTestId('when-event').click();
    await page.getByTestId('when-event-name').fill('Reunification');
    await page.getByTestId('confirm-merge').click();
    await page.getByTestId('merge-dialog').waitFor({ state: 'detached' });
    await h.saved();
    for (const ll of [north, south]) assert.equal(await h.ownerAt(ll, '1971'), 'Reunited Splitland');
    assert.equal(await h.ownerAt(north, '1960'), 'North Splitland');
    assert.ok(await page.evaluate(() => (window as any).__mapmaker.store.world.all('event').some((e: any) => e.name === 'Reunification')));
    await h.screenshot('merged');
    // One step: undone, the event and the new country are gone.
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await h.ownerAt(north, '1971'), 'North Splitland');
    assert.ok(!(await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').some((e: any) => e.name === 'Reunited Splitland'))));
    await page.getByTestId('redo').click();
    await h.saved();
    assert.equal(await h.ownerAt(south, '1971'), 'Reunited Splitland');
  });

  await h.step("Region picker: today's states chosen by clicking (and left out again) and by a box, given to a new country from a date", async () => {
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 11, lat: 51, zoom: 4, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('2000');
    // Choosing a country in the list makes it the territory brush's owner.
    await page.getByTestId('entity-row-Zoomland').click();
    await page.getByTestId('tool-lasso').click();
    const zoomland = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Zoomland').id);
    assert.equal(await page.getByTestId('paint-owner').inputValue(), zoomland, 'the brush gives land to the country selected');
    await page.getByTestId('tool-regions').click();
    await page.getByTestId('region-level').selectOption('regions');
    await page.getByText('Click regions to choose them').waitFor({ timeout: 20000 });
    const click = async (ll: LL) => { const q = await h.toPage(ll); await page.mouse.click(q[0], q[1]); };
    const picked = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.regionPicks.length as number; });
    await click([11.5, 48.8]); // Bayern
    await click([9.0, 48.6]); // Baden-Württemberg
    assert.equal(await picked(), 2);
    await click([11.5, 48.8]); // left out again
    assert.equal(await picked(), 1);
    // A box around Brandenburg and Berlin (their middles), not their neighbours'.
    const a = await h.toPage([12.0, 53.3]), b = await h.toPage([14.8, 51.45]);
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move(b[0], b[1], { steps: 8 });
    await page.mouse.up();
    assert.equal(await picked(), 3);
    assert.equal(await page.getByTestId('region-count').textContent(), '3 chosen');
    const hover = await h.toPage([10.0, 50.6]);
    await page.mouse.move(hover[0], hover[1]);
    await h.screenshot('region-picker');
    await page.keyboard.press('Enter');
    await page.getByTestId('give-regions').waitFor();
    await page.getByTestId('regions-to').selectOption('new');
    await page.getByTestId('regions-new-name').fill('Southwest and East');
    await page.getByTestId('confirm-regions').click();
    await page.getByTestId('give-regions').waitFor({ state: 'detached' });
    await h.saved();
    for (const ll of [[13.4, 52.52], [13.06, 52.4], [9.18, 48.78]] as LL[]) assert.equal(await h.ownerAt(ll, '2001'), 'Southwest and East', `${ll}`);
    assert.equal(await h.ownerAt([11.58, 48.14], '2001'), null, 'Munich was left out');
    assert.equal(await h.ownerAt([13.4, 52.52], '1999'), null, 'from 2000 on');
    assert.equal(await picked(), 0, 'the choice is cleared');
    await h.screenshot('regions-given');
    await page.getByTestId('tool-select').click();
  });

  await h.step('Areas, lines and points: layers of each kind, drawn by mouse, chosen by clicking, restyled, reshaped from a date, ended, undone', async () => {
    const feats = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.world.all('feature').map((f: any) => ({ id: f.id, name: f.name, layer: s.world.get('layer', f.layer_id).name, kind: s.world.get('layer', f.layer_id).kind, style: f.style })); }) as Promise<Array<{ id: string; name: string; layer: string; kind: string; style: string }>>;
    const shown = (name: string, date: string) => page.evaluate(([n, d]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const f = s.world.all('feature').find((x: any) => x.name === n);
      const t = B.gregorian.fromCivil({ year: Number(d) });
      return !!f && s.engine.featuresAt(f.layer_id, t).some((x: any) => x.feature === f.id);
    }, [name, date] as const);
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 1, rotation: 0, projection: 'equirectangular' }), P.b);
    await h.setDate('1850');
    await page.getByTestId('tool-select').click();
    // A layer of lines: "+ Layer", the kind, a name. The features tool is chosen with it.
    await page.locator('.section-head', { hasText: 'Layers' }).getByRole('button').click();
    await page.getByTestId('new-layer-dialog').waitFor();
    await page.getByTestId('layer-kind-line').click();
    await page.getByTestId('new-layer-name').fill('Front lines');
    await page.getByTestId('create-layer').click();
    await page.getByTestId('feature-options').waitFor();
    assert.ok(await page.getByTestId('tool-feature').evaluate((b) => b.classList.contains('on')), 'the features tool is chosen');
    // A front line drawn freehand from A's land towards B's, existing from 1850 (no event).
    const pb = await h.toPage(P.b);
    const line: Array<[number, number]> = [];
    for (let i = 0; i <= 12; i++) { const f = i / 12; line.push([pb[0] - 260 + 400 * f, pb[1] - 90 + 25 * Math.sin(f * Math.PI)]); }
    await page.mouse.move(line[0][0], line[0][1]);
    await page.mouse.down();
    for (const q of line.slice(1)) await page.mouse.move(q[0], q[1], { steps: 3 });
    await page.mouse.up();
    await page.getByTestId('feature-prompt').waitFor();
    await page.getByTestId('feature-name').fill('Northern front');
    assert.ok(await page.getByTestId('feature-choice-change').evaluate((d) => d.classList.contains('on')), '"exists from the date viewed" is chosen');
    await page.keyboard.press('Enter');
    await page.getByTestId('feature-panel').waitFor();
    let all = await feats();
    assert.deepEqual(all.map((f) => [f.name, f.layer, f.kind]), [['Northern front', 'Front lines', 'line']]);
    assert.ok(await shown('Northern front', '1850') && !(await shown('Northern front', '1849')), 'from 1850, not before');
    // Restyled: teeth on the right, red, wider. The look is kept with the feature.
    await page.getByTestId('feature-teeth').selectOption('right');
    await page.getByTestId('feature-arrow').selectOption('end');
    all = await feats();
    assert.match(all[0].style, /"teeth":"right"/);
    assert.match(all[0].style, /"arrow":"end"/);
    // Drawn on the map: the line's colour is there under the middle of the stroke.
    const mid = line[6];
    const near = await page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 6, Math.round((y - r.top) * k) - 6, 13, 13).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 120 && d[i + 2] < 120) red++;
      return red;
    }, mid);
    assert.ok(near > 3, `the red front line is drawn where it was drawn (${near} red pixels)`);
    // A layer of points; a battle put there with a click, in a new event.
    await page.locator('.section-head', { hasText: 'Layers' }).getByRole('button').click();
    await page.getByTestId('layer-kind-point').click();
    await page.getByTestId('new-layer-name').fill('Battles');
    await page.getByTestId('create-layer').click();
    await h.setDate('1870');
    await page.mouse.click(pb[0] - 40, pb[1] + 10);
    await page.getByTestId('feature-prompt').waitFor();
    await page.getByTestId('feature-name').fill('Battle of the Ford');
    await page.getByTestId('feature-choice-event').click();
    // (The event drawn into last is offered first: a new one is chosen.)
    await page.getByTestId('feature-event').selectOption('new-event');
    await page.getByTestId('feature-event-name').fill('Ford campaign');
    await page.getByTestId('confirm-feature').click();
    await page.getByTestId('feature-panel').waitFor();
    assert.ok(await shown('Battle of the Ford', '1870') && !(await shown('Battle of the Ford', '1869')));
    assert.ok(await page.evaluate(() => (window as any).__mapmaker.store.world.all('event').some((e: any) => e.name === 'Ford campaign')), 'the event was made');
    await page.getByTestId('feature-symbol').selectOption('battle');
    // A layer of areas, click by click, there from the beginning.
    await page.locator('.section-head', { hasText: 'Layers' }).getByRole('button').click();
    await page.getByTestId('layer-kind-area').click();
    await page.getByTestId('new-layer-name').fill('Claims');
    await page.getByTestId('create-layer').click();
    await page.getByTestId('feature-draw').selectOption('clicks');
    const ring: Array<[number, number]> = [[pb[0] - 70, pb[1] - 40], [pb[0] + 40, pb[1] - 50], [pb[0] + 50, pb[1] + 45], [pb[0] - 60, pb[1] + 50]];
    for (const [x, y] of ring) await page.mouse.click(x, y);
    await page.keyboard.press('Enter');
    await page.getByTestId('feature-prompt').waitFor();
    await page.getByTestId('feature-name').fill('Probian claim');
    await page.getByTestId('feature-owner').selectOption({ label: B });
    await page.getByTestId('feature-choice-always').click();
    await page.getByTestId('confirm-feature').click();
    await page.getByTestId('feature-panel').waitFor();
    assert.ok(await shown('Probian claim', '1000'), 'there from the beginning');
    await page.getByTestId('feature-hatch').selectOption('diagonal');
    // Contested with the other country (D93): stripes of both colours; then back (the exports below check colours here).
    const claimStyle = () => page.evaluate(() => (window as any).__mapmaker.store.world.all('feature').find((f: any) => f.name === 'Probian claim').style) as Promise<string>;
    await page.getByTestId('feature-contested').selectOption({ label: A });
    const idOfA = await page.evaluate((n) => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === n).id, A);
    await page.waitForFunction(([id]) => (window as any).__mapmaker.store.world.all('feature').find((f: any) => f.name === 'Probian claim').style.includes(`"contested":"${id}"`), [idOfA]);
    await page.waitForTimeout(200);
    await h.screenshot('contested-claim');
    await page.getByTestId('feature-contested').selectOption('');
    await page.waitForFunction(() => /"contested":""/.test((window as any).__mapmaker.store.world.all('feature').find((f: any) => f.name === 'Probian claim').style));
    assert.match(await claimStyle(), /"hatch":"diagonal"/, 'its pattern kept');
    // Three layers, three features, listed under "Areas, lines and points"; nobody's land changed.
    assert.equal(await page.getByTestId('feature-row').count(), 3);
    assert.equal(await h.ownerAt(P.b, '1900'), A, 'the land under them is untouched');
    // With Select, a click on the battle chooses it.
    await page.getByTestId('tool-select').click();
    await page.mouse.click(pb[0] - 40, pb[1] + 10);
    // (The claim's panel is open already: wait for the battle's to replace it.)
    await page.waitForFunction(() => (document.querySelector('[data-testid="feature-panel-name"]') as HTMLInputElement | null)?.value === 'Battle of the Ford', undefined, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.getByTestId('feature-panel-name').inputValue(), 'Battle of the Ford');
    await h.screenshot('areas-lines-points');
    // The front moves in 1880: a new shape from that date, through the panel.
    await page.locator('.left [data-testid=feature-row]', { hasText: 'Northern front' }).click();
    await h.setDate('1880');
    await page.getByTestId('feature-reshape').click();
    await page.getByTestId('reshaping').waitFor();
    await page.getByTestId('feature-draw').selectOption('freehand');
    await page.mouse.move(line[0][0], line[0][1] + 70);
    await page.mouse.down();
    for (const q of line.slice(1)) await page.mouse.move(q[0], q[1] + 70, { steps: 3 });
    await page.mouse.up();
    await page.getByTestId('feature-prompt').waitFor();
    assert.match((await page.getByTestId('feature-prompt').locator('h2').textContent()) ?? '', /new shape for “Northern front”/);
    await page.keyboard.press('Enter');
    await page.getByTestId('feature-panel').waitFor();
    assert.equal(await page.getByTestId('feature-step').count(), 2, 'two shapes over time');
    const lat = (date: string) => page.evaluate(([d]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const f = s.world.all('feature').find((x: any) => x.name === 'Northern front');
      return s.engine.featuresAt(f.layer_id, B.gregorian.fromCivil({ year: Number(d) })).find((x: any) => x.feature === f.id)?.parts[0][1] ?? null;
    }, [date] as const);
    const before = await lat('1860'), after = await lat('1890');
    assert.ok(before !== null && after !== null && after < before - 1, `moved south from 1880 (${before} -> ${after})`);
    // It ends in 1910; undone, it carries on.
    await h.setDate('1910');
    await page.getByTestId('feature-end').click();
    await h.saved();
    assert.ok(!(await shown('Northern front', '1911')) && (await shown('Northern front', '1909')));
    await page.keyboard.press('Control+z');
    await h.saved();
    assert.ok(await shown('Northern front', '1911'), 'undone: it carries on');
    await page.getByTestId('tool-select').click();
  });

  await h.step('Animated features: a line drawn in an event with a length draws itself over it, complete at its end', async () => {
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 1, rotation: 0, projection: 'equirectangular' }), P.b);
    await h.setDate('1880');
    await page.getByTestId('tool-feature').click();
    const fronts = await page.evaluate(() => (window as any).__mapmaker.store.world.all('layer').find((l: any) => l.name === 'Front lines').id);
    await page.getByTestId('feature-layer').selectOption(fronts);
    const pb = await h.toPage(P.b);
    const y = pb[1] + 150;
    await page.mouse.move(pb[0] - 220, y);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) await page.mouse.move(pb[0] - 220 + (440 * i) / 16, y + 18 * Math.sin((i / 16) * Math.PI), { steps: 2 });
    await page.mouse.up();
    await page.getByTestId('feature-prompt').waitFor();
    await page.getByTestId('feature-name').fill('Great advance');
    await page.getByTestId('feature-choice-event').click();
    await page.getByTestId('feature-event').selectOption('new-event');
    await page.getByTestId('feature-event-name').fill('Summer offensive');
    await page.getByTestId('feature-event-end').fill('1890');
    // (Enter would apply the whole question: Tab leaves the date box.)
    await page.getByTestId('feature-event-end').press('Tab');
    assert.equal(await page.getByTestId('feature-anim').inputValue(), 'draw', 'a line draws itself unless told otherwise');
    await page.getByTestId('confirm-feature').click();
    await page.getByTestId('feature-panel').waitFor();
    await page.getByTestId('tool-select').click();
    // (Not chosen: the outline of a chosen feature would cover it.)
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    // Where it starts and ends, on the page.
    const ends = await page.evaluate(() => { const s = (window as any).__mapmaker.store; const f = s.world.all('feature').find((x: any) => x.name === 'Great advance'); const p = s.engine.featureHistory(f.id)[0].parts[0]; return [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]] as Array<[number, number]>; });
    const first = await h.toPage(ends[0]), last = await h.toPage(ends[1]);
    const patch = (q: [number, number]) => page.evaluate(([x, yy]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 4, Math.round((yy - r.top) * k) - 4, 9, 9).data);
    }, q);
    const differ = (a: number[], b: number[]) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++; return n; };
    await h.setDate('1 June 1885');
    const midStart = await patch(first), midEnd = await patch(last);
    await h.screenshot('feature-drawing-itself');
    await h.setDate('1891');
    const doneStart = await patch(first), doneEnd = await patch(last);
    assert.ok(differ(midStart, doneStart) <= 4, `half way through, its start is drawn already (${differ(midStart, doneStart)} pixels differ)`);
    assert.ok(differ(midEnd, doneEnd) >= 6, `half way through, its end is not drawn yet (${differ(midEnd, doneEnd)} pixels differ)`);
    // Changed in its panel to appear at once: drawn whole half way through too.
    await page.getByTestId('feature-row').filter({ hasText: 'Great advance' }).click();
    await page.getByTestId('feature-step-anim').selectOption('');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await h.setDate('1 June 1885');
    assert.ok(differ(await patch(last), doneEnd) <= 4, 'at once: its end is there half way through');
  });

  await h.step('Relationships: a war added from a country\'s panel, with an end date, read from both sides, ended again later', async () => {
    await h.setDate('1850');
    await page.locator('.left .row', { hasText: A }).first().click();
    await page.getByTestId('entity-panel').waitFor();
    await page.getByTestId('relation-new').click();
    await page.getByTestId('relation-kind').selectOption({ label: 'at war with' });
    await page.getByTestId('relation-other').selectOption({ label: B });
    await page.getByTestId('relation-until').fill('1860');
    await page.getByTestId('relation-until').press('Enter');
    await page.getByTestId('relation-add').click();
    const row = page.getByTestId('relation-row');
    await row.waitFor();
    assert.match((await row.textContent()) ?? '', new RegExp(`At war with\\s*${B}`));
    assert.match((await page.getByTestId('relation-periods').textContent()) ?? '', /1 January 1850 – 1 January 1860/);
    // From the other side.
    await row.getByRole('button', { name: B }).click();
    await page.getByTestId('entity-panel').locator('h3', { hasText: B }).waitFor();
    assert.match((await page.getByTestId('relation-row').textContent()) ?? '', new RegExp(`At war with\\s*${A}`));
    // A second war from 1870 ("Again from"), then peace in 1871 ("Ends on").
    await h.setDate('1870');
    await page.getByTestId('relation-resume').click();
    await h.setDate('1871');
    await page.getByTestId('relation-end').click();
    await h.saved();
    assert.match((await page.getByTestId('relation-periods').textContent()) ?? '', /1850 – 1 January 1860; 1 January 1870 – 1 January 1871/);
    const holds = await page.evaluate(() => { const m = (window as any).__mapmaker, s = m.store, B = m.bench; const r = s.world.all('relation')[0]; return [1855, 1865, 1870.5, 1872].map((y) => s.engine.relationHolds(r.id, B.gregorian.fromCivil({ year: Math.floor(y), month: y % 1 ? 7 : 1 }))); });
    assert.deepEqual(holds, [true, false, true, false]);
    // Front lines (D89): on the political layer, the border between the two is a front line while they are at war.
    await page.locator('.left .row', { hasText: 'Political' }).locator('span', { hasText: 'Political' }).click();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, tool: 'select' }));
    await page.getByTestId('layer-fronts').selectOption('second');
    await h.saved();
    const [idA, idB] = await page.evaluate(([a, b]) => { const w = (window as any).__mapmaker.store.world; const id = (n: string) => w.all('entity').find((e: any) => e.name === n).id; return [id(a), id(b)]; }, [A, B] as const);
    // A point of their border in 1855, and whether the front's red is drawn around it.
    const borderPoint = (await page.evaluate(([a, b]) => {
      const m = (window as any).__mapmaker, s = m.store;
      const t = m.bench.gregorian.fromCivil({ year: 1855 });
      const arr = s.world.arrangement(s.spaceId);
      const states = s.engine.partitionState(s.spaceId, s.layerId, t);
      const own = (f: number) => states.get(f)?.value ?? null;
      for (const sg of arr.segments.values()) {
        const l = own(sg.left_face), r = own(sg.right_face);
        if ((l === a && r === b) || (l === b && r === a)) { const va = arr.vertices.get(sg.a), vb = arr.vertices.get(sg.b); return [(va.lon + vb.lon) / 2e7, (va.lat + vb.lat) / 2e7]; }
      }
      return null;
    }, [idA, idB] as const)) as LL | null;
    assert.ok(borderPoint, 'the two share a border in 1855');
    const camera = await page.evaluate(() => ({ ...(window as any).__mapmaker.store.camera }));
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c[0], lat: c[1], zoom: 2.5, rotation: 0, projection: 'equirectangular' }), borderPoint);
    const redNear = async () => {
      const q = await h.toPage(borderPoint!);
      return page.evaluate(([x, y]) => {
        const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
        const r = c.getBoundingClientRect(), sx = c.width / r.width, sy = c.height / r.height;
        const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * sx) - 8, Math.round((y - r.top) * sy) - 8, 17, 17).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.hypot(d[i] - 0xd6, d[i + 1] - 0x28, d[i + 2] - 0x28) < 50) n++;
        return n;
      }, q);
    };
    await h.setDate('1855');
    await page.waitForFunction((ids) => (window as any).__mapmaker.store.renderer.lastFronts.some((f: any) => f.from === ids[0] && f.toward === ids[1]), [idA, idB]);
    await page.waitForTimeout(200);
    assert.ok((await redNear()) >= 6, 'the front line is drawn on their border during the war');
    await h.screenshot('front-line-1855');
    await h.setDate('1865');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFronts.length === 0);
    await page.waitForTimeout(200);
    assert.ok((await redNear()) < 3, 'none in peace');
    await page.getByTestId('layer-fronts').selectOption('off');
    await h.saved();
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera(c), camera);
  });

  await h.step('Search, pictures with notes, and data export (GeoJSON of the map at a date, CSV of the record)', async () => {
    await page.getByTestId('tool-select').click();
    // (Going to a search result moves the view; the steps after this one expect it where it was.)
    const viewBefore = await page.evaluate(() => ({ ...(window as any).__mapmaker.store.camera }));
    // Search by a piece of a name: the country is chosen.
    await page.getByTestId('search').fill('proba');
    await page.getByTestId('search-results').waitFor();
    assert.match((await page.getByTestId('search-result').first().textContent()) ?? '', new RegExp(`${B}.*Country`));
    await page.getByTestId('search').press('Enter');
    await page.getByTestId('entity-panel').locator('h3', { hasText: B }).waitFor();
    // An event: chosen, and the date goes to its start.
    await page.getByTestId('search').fill('union');
    await page.getByTestId('search-result').filter({ hasText: 'Event' }).first().click();
    await page.getByTestId('event-panel').waitFor();
    assert.equal(await page.getByTestId('current-date').inputValue(), '1 January 1900');
    // An area, line or point: chosen.
    await page.getByTestId('search').fill('ford');
    await page.getByTestId('search-result').filter({ hasText: 'Point on Battles' }).click();
    await page.getByTestId('feature-panel').waitFor();
    // A picture kept with a country's notes.
    await page.getByTestId('search').fill(B);
    await page.getByTestId('search').press('Enter');
    await page.getByTestId('entity-panel').locator('h3', { hasText: B }).waitFor();
    const px = new Uint8Array(40 * 30 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
    await page.getByTestId('entity-panel').getByTestId('picture-upload').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(encodePNG(40, 30, px)) });
    await page.getByTestId('picture-thumb').first().waitFor();
    const pics = await page.evaluate((n) => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.all('entity').find((e: any) => e.name === n).style).pictures; }, B);
    assert.equal(pics.length, 1, 'kept with the country');
    // (The thumbnail loads from the data service: wait for it, a slower computer takes a moment.)
    await page.waitForFunction(() => { const img = document.querySelector('[data-testid="picture-thumb"]') as HTMLImageElement | null; return !!img && img.complete && img.naturalWidth > 0; }, undefined, { timeout: 8000 }).catch(() => {});
    assert.ok(await page.getByTestId('picture-thumb').first().evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 40), 'and shown');
    // Data export: the map in 1890 as GeoJSON, and the record as CSV.
    await page.getByTestId('open-data-export').click();
    await page.getByTestId('data-export-dialog').waitFor();
    await page.getByTestId('data-date').fill('1890');
    await page.getByTestId('data-date').press('Enter');
    await page.getByTestId('data-export-run').click();
    await page.getByTestId('data-export-result').waitFor();
    const dir = ((await page.getByTestId('data-export-result').locator('.path').textContent()) ?? '').trim();
    const files = readdirSync(dir).sort();
    assert.deepEqual(files, ['Earth_1890-01-01.geojson', 'areas_lines_points.csv', 'countries_and_others.csv', 'events.csv', 'relationships.csv']);
    const gj = JSON.parse(readFileSync(join(dir, 'Earth_1890-01-01.geojson'), 'utf8'));
    const names = gj.features.map((f: any) => `${f.properties.kind}:${f.properties.name}`);
    for (const n of [`territory:${A}`, `territory:${B}`, 'line:Northern front', 'point:Battle of the Ford', 'area:Probian claim']) assert.ok(names.includes(n), `${n} is in the GeoJSON (${names.join(', ')})`);
    assert.equal(gj.properties.date, '1890-01-01');
    assert.match(readFileSync(join(dir, 'events.csv'), 'utf8'), /,Union,/);
    assert.match(readFileSync(join(dir, 'relationships.csv'), 'utf8'), /is at war with.*1850-01-01,1860-01-01/);
    await page.getByTestId('data-export-dialog').getByText('Close', { exact: true }).click();
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera(c), viewBefore);
  });

  await h.step('A shot framed in the preview (still camera, reset) at 2.39:1 and 25 fps; inspect every exported pass', async () => {
    colours = await page.evaluate((names) => Object.fromEntries(names.map((n) => [n, (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === n).color])), [A, B]);
    await page.locator('.left .row', { hasText: 'Union' }).click();
    // Out of sync with the clock (D92): the union, an instant of 1900, takes 0.4 s on screen in presentations.
    await page.getByTestId('event-screen').selectOption('own');
    await page.getByTestId('event-screen-seconds').fill('0.4');
    await page.getByTestId('event-screen-seconds').press('Enter');
    await page.waitForFunction(() => /"seconds":0.4/.test((window as any).__mapmaker.store.world.all('event').find((e: any) => e.name === 'Union').presentation));
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
    // Camera: still for the whole shot. Zooming and dragging the preview frames it; a reset gives
    // the whole map; there are no start and end views any more.
    assert.equal(await page.getByTestId('set-start-view').count(), 0, 'no "use this view at the start"');
    const shotCameras = () => page.evaluate(() => JSON.parse((window as any).__mapmaker.store.world.all('sequence')[0].settings).camera.map((k: any) => k.camera));
    const { cx, cy } = await h.centre();
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.mouse.down(); await page.mouse.move(cx - 80, cy + 30, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(500);
    await h.saved();
    let cams = await shotCameras();
    assert.ok(cams[0].zoom > 0.5, `zooming the preview framed the shot closer (zoom ${cams[0].zoom})`);
    assert.ok(cams.every((c: any) => JSON.stringify(c) === JSON.stringify(cams[0])), 'one view for the whole shot');
    await page.getByTestId('reset-camera').click();
    await h.saved();
    cams = await shotCameras();
    assert.ok(cams.every((c: any) => c.zoom === 0 && c.lon === 0 && c.lat === 0 && c.rotation === 0), 'reset: the whole map, straight');
    // Frame it again for the export.
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.mouse.down(); await page.mouse.move(cx - 80, cy + 30, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(500);
    await h.saved();
    await page.getByTestId('frame-slider').fill('12');
    await h.screenshot('presentation-still-camera');
    // Characters' routes so far, when the shot asks for them.
    const trails = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastTrails) as Promise<number>;
    assert.equal(await trails(), 0, 'no trails unless asked');
    await page.getByTestId('shot-trails').check();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTrails >= 1);
    await page.getByTestId('shot-trails').uncheck();
    // The union shows at frame 12 (1900); with its own 0.4 s it is half done 5 frames later and over by frame 23,
    // though the shot's clock passes a year in a twenty-fifth of a second.
    const animating = (frame: number) => page.evaluate(async (f) => { const s = (window as any).__mapmaker.store; s.set({ shotFrame: f }); await new Promise((r) => setTimeout(r, 300)); return s.renderer.lastTransitions.map((x: any) => x.progress); }, frame) as Promise<number[]>;
    const own17 = await animating(17), own23 = await animating(23);
    // Back to following the clock (the exports below check the frames as they were): the same frames without it.
    await page.evaluate(() => { const m = (window as any).__mapmaker; const id = m.store.world.all('event').find((e: any) => e.name === 'Union').id; m.store.execute((w: any) => m.bench.commands.setEventScreenSeconds(w, id, null)); });
    const clock17 = await animating(17), clock23 = await animating(23);
    assert.equal(own17.length, clock17.length + 1, `one more change under way: the union (${own17.map((p) => p.toFixed(2))} against ${clock17.map((p) => p.toFixed(2))})`);
    assert.ok(own17.some((p) => p > 0.3 && p < 0.7 && !clock17.includes(p)), 'half way through its own time');
    assert.equal(own23.length, clock23.length, 'over by frame 23');
    await page.getByTestId('frame-slider').fill('12');

    // What to export: only "All" at first, explained; then every separate layer too.
    const separate = ['background', 'land', 'fills', 'borders', 'features', 'cities', 'labels', 'characters', 'overlays'];
    assert.ok(await page.getByTestId('pass-all').isChecked(), '"All" is chosen by default');
    for (const p of separate) assert.ok(!(await page.getByTestId(`pass-${p}`).isChecked()), `${p} is not chosen by default`);
    assert.match((await page.getByTestId('separate-passes-note').textContent()) ?? '', /exported separately/);
    const passOrder = await page.locator('[data-testid^=pass-]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    assert.equal(passOrder[0], 'pass-all', '"All" is at the top');
    // The estimated size appears, and grows when more is chosen.
    const sizeText = async () => { await page.getByTestId('export-size').waitFor({ timeout: 20000 }); return (await page.getByTestId('export-size').textContent()) ?? ''; };
    const toBytes = (t: string) => { const m = /([\d.]+) (KB|MB|GB)/.exec(t)!; return Number(m[1]) * { KB: 1, MB: 1024, GB: 1024 * 1024 }[m[2] as 'KB']; };
    const onlyAll = toBytes(await sizeText());
    for (const p of separate) await page.getByTestId(`pass-${p}`).check();
    await page.waitForFunction(() => /fills/.test(JSON.stringify(JSON.parse((window as any).__mapmaker.store.world.all('sequence')[0].settings).exportPasses)));
    await page.waitForTimeout(900);
    const everything = toBytes(await sizeText());
    assert.ok(everything > onlyAll * 1.3, `the estimate grows with the separate layers (${onlyAll} KB, then ${everything} KB)`);
    await h.screenshot('export-choices');

    const ex = await exportShot('export-preview');
    const m = ex.manifest;
    assert.deepEqual(m.resolution, [480, 201], '2.39:1 at a quarter size');
    assert.equal(m.fps, 25);
    assert.deepEqual(m.frames, [0, 24]);
    for (const pass of [...separate, 'all']) assert.equal(ex.frames(pass).length, 25, pass);
    // The estimate is of the right size. (A picture a quarter as wide and high takes about a sixth or
    // a seventh of the bytes, not a sixteenth: flat colour packs to next to nothing, outlines do not.)
    let written = 0;
    for (const pass of [...separate, 'all']) for (const f of ex.frames(pass)) written += statSync(f).size;
    const preview = everything * Math.pow(0.25, 1.35);
    const ratio = written / 1024 / preview;
    assert.ok(ratio > 0.4 && ratio < 2.5, `the estimated size is close (written ${(written / 1024).toFixed(0)} KB at ¼ size, estimated ${preview.toFixed(0)} KB)`);
    const shownPreview = /¼ size, about ([\d.]+) (KB|MB|GB)/.exec((await page.locator('p', { has: page.getByTestId('export-size') }).textContent()) ?? '');
    assert.ok(shownPreview, 'the size of a preview is given too');
    const shownKB = Number(shownPreview![1]) * { KB: 1, MB: 1024, GB: 1024 * 1024 }[shownPreview![2] as 'KB'];
    assert.ok(shownKB > written / 1024 / 2.5 && shownKB < (written / 1024) * 2.5, `the preview's estimated size is close too (written ${(written / 1024).toFixed(0)} KB, estimated ${shownKB.toFixed(0)} KB)`);
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

    // The camera is still: every background frame is identical.
    const bg = Object.values(m.checksums.background as Record<string, string>);
    assert.equal(new Set(bg).size, 1, 'the view never moves during the shot');

    // Correct history in the pixels: before 1900 B's land is B's colour, after it A's (annexation).
    const at0 = await page.evaluate(([lon, lat]) => (window as any).__mapmaker.exportPixel(lon, lat, 0, 0.25), P.b);
    const at24 = await page.evaluate(([lon, lat]) => (window as any).__mapmaker.exportPixel(lon, lat, 24, 0.25), P.b);
    const f0 = readPNG(ex.frames('fills')[0]), f24 = readPNG(ex.frames('fills')[24]);
    assert.ok(near(pixel(f0, at0[0], at0[1]).slice(0, 3), hexRGB(colours[B])), 'frame 1 (1880): B');
    assert.ok(near(pixel(f24, at24[0], at24[1]).slice(0, 3), hexRGB(colours[A])), 'frame 25 (1920): A after the union');

    // The separate passes stacked with Premiere's Normal blend reproduce the full picture.
    for (const f of [0, 12, 24]) {
      const layers = separate.map((p) => readPNG(ex.frames(p)[f]));
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

  await h.step('Current events box with a graphic of its own, in the exported overlays', async () => {
    // A solid magenta picture stands in for the user's graphic.
    const graphic = join(ROOT, '.tmp', 'events-box-graphic.png');
    const px = new Uint8Array(64 * 32 * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = 255; px[i + 1] = 0; px[i + 2] = 255; px[i + 3] = 255; }
    writeFileSync(graphic, encodePNG(64, 32, px));
    await page.locator('summary', { hasText: 'Current events box' }).click();
    await page.getByTestId('events-box-show').check();
    await page.getByTestId('events-box-title').fill('On screen now');
    await page.getByTestId('events-box-image').setInputFiles(graphic);
    await page.locator('label', { hasText: 'Background opacity' }).locator('input').fill('0');
    await page.locator('label', { hasText: 'Background opacity' }).locator('input').press('Enter');
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.all('sequence')[0].settings.includes('"image":"'));
    await h.saved();
    await page.getByTestId('frame-slider').fill('24');
    await h.screenshot('events-box');
    const ex = await exportShot('export-preview');
    const img = readPNG(ex.frames('overlays')[24]);
    // The new graphic is the box: wrapped around it, with the graphic's 2:1 shape. At a quarter of
    // 1920: 520 wide is 130 pixels, so 65 high; margin 48 is 12.
    assert.equal(await page.getByTestId('events-box-fit').inputValue(), 'wrap', 'a new graphic is wrapped by default');
    const magenta = (c: number[]) => c[0] > 200 && c[1] < 60 && c[2] > 200 && c[3] > 200;
    const c = pixel(img, img.width - 12 - 3, img.height - 12 - 3);
    assert.ok(magenta(c), `the box shows the user's graphic to its very corner (${c})`);
    const top = img.height - 12 - 65;
    assert.ok(magenta(pixel(img, img.width - 12 - 65, top + 3)), 'up to its top edge');
    assert.equal(pixel(img, img.width - 12 - 65, top - 4)[3], 0, 'and no further: the box has the graphic\'s shape');
    assert.equal(pixel(img, img.width - 12 - 130 - 4, img.height - 12 - 30)[3], 0, 'nor wider');
    assert.equal(pixel(img, Math.round(img.width / 2), Math.round(img.height / 2))[3], 0, 'the rest of the overlay layer stays transparent');
    assert.ok(readdirSync(join(h.projects, 'Workflows Test.mapmaker', 'assets')).some((f) => f.endsWith('.png')), 'the graphic is kept in the project');
    // Drag the events box and the date to new places on the preview; each drop is one undo step.
    type R = { id: string; x: number; y: number; w: number; h: number };
    const rects = () => page.evaluate(() => (window as any).__mapmaker.previewOverlays()) as Promise<R[]>;
    const settings = () => page.evaluate(() => JSON.parse((window as any).__mapmaker.store.world.all('sequence')[0].settings));
    const dragBy = async (r: R, dx: number, dy: number) => {
      await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
      await page.mouse.down();
      await page.mouse.move(r.x + r.w / 2 + dx, r.y + r.h / 2 + dy, { steps: 6 });
      await page.mouse.up();
      await h.saved();
    };
    let box = (await rects()).find((r) => r.id === 'events-box')!;
    assert.ok(box, 'the events box is drawn on the preview');
    const cam0 = JSON.stringify((await settings()).camera);
    await dragBy(box, -300, -120);
    const moved = (await rects()).find((r) => r.id === 'events-box')!;
    assert.ok(Math.abs(moved.x - (box.x - 300)) < 3 && Math.abs(moved.y - (box.y - 120)) < 3, `the box follows the pointer (${box.x},${box.y} -> ${moved.x},${moved.y})`);
    assert.equal((await settings()).eventsBox.corner, 'custom', 'it is now placed freely');
    assert.equal(JSON.stringify((await settings()).camera), cam0, 'dragging the box does not move the camera');
    const date = (await rects()).find((r) => r.id !== 'events-box')!;
    const before = (await settings()).overlays.find((o: any) => o.id === date.id);
    await dragBy(date, 150, 60);
    const after = (await settings()).overlays.find((o: any) => o.id === date.id);
    const fr = await page.evaluate(() => { const c = document.querySelector('[data-testid=map-canvas]')!.getBoundingClientRect(); return { w: c.width, h: c.height }; });
    assert.ok(after.x > before.x && after.y > before.y, `the date moved right and down (${before.x},${before.y} -> ${after.x},${after.y}; preview ${fr.w}x${fr.h})`);
    await h.screenshot('overlays-dragged');
    await page.getByTestId('undo').click();
    await page.waitForFunction((x) => JSON.parse((window as any).__mapmaker.store.world.all('sequence')[0].settings).overlays.find((o: any) => o.kind === 'date').x === x, before.x);
    // Hide the box again for the following steps.
    await page.getByTestId('events-box-show').uncheck();
    await h.saved();
  });

  await h.step('A country filled with a video: it plays through the shot in the exported frames', async () => {
    // A 2-second test video made in the browser: green for one second, then blue.
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 48;
      const g = c.getContext('2d')!;
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const t = performance.now() - t0;
          g.fillStyle = t < 1000 ? '#00ff00' : '#0000ff'; g.fillRect(0, 0, 64, 48);
          if (t < 2100) requestAnimationFrame(tick); else resolve();
        };
        tick();
      });
      rec.stop(); await done;
      const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
      let s = ''; for (const x of buf) s += String.fromCharCode(x);
      return btoa(s);
    });
    const video = join(ROOT, '.tmp', 'fill-test.webm');
    writeFileSync(video, Buffer.from(b64, 'base64'));
    await page.getByTestId('mode-world').click();
    await page.locator('.left .row', { hasText: A }).click();
    await page.getByTestId('fill-upload-video').setInputFiles(video);
    await page.getByTestId('fill-play').waitFor();
    await page.getByTestId('fill-play').selectOption('once');
    await page.locator('.country-fill label', { hasText: 'Speed' }).locator('input').fill('2');
    await h.saved();
    await page.getByTestId('mode-present').click();
    await page.locator('.left .row', { hasText: 'Shot 1' }).click();
    await page.getByTestId('shot-editor').waitFor();
    const ex = await exportShot('export-preview');
    const at = async (f: number) => {
      const p = await page.evaluate(([lon, lat, fr]) => (window as any).__mapmaker.exportPixel(lon, lat, fr, 0.25), [P.a[0], P.a[1], f] as const);
      return pixel(readPNG(ex.frames('fills')[f]), p[0], p[1]);
    };
    const first = await at(0), last = await at(ex.frames('fills').length - 1);
    assert.ok(first[1] > first[2] + 60 && first[1] > first[0] + 60, `first frame shows the video's green (${first})`);
    assert.ok(last[2] > last[1] + 60 && last[2] > last[0] + 60, `last frame shows the video's blue: it played (${last})`);
    await page.getByTestId('mode-world').click();
    await page.locator('.left .row', { hasText: A }).click();
    await page.getByTestId('fill-color').click();
    await h.saved();
    await page.getByTestId('mode-present').click();
    await page.locator('.left .row', { hasText: 'Shot 1' }).click();
    await page.getByTestId('shot-editor').waitFor();
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

  await h.step('Framing a shot in Natural Earth: the map follows the pointer while dragged, and is laid out around the camera again at rest', async () => {
    // Natural Earth and Equal Earth give everything another shape for every middle meridian. While
    // the preview is dragged it keeps the meridian it had, so the picture only shifts (and is
    // carried along); at rest it is laid out around the camera again, as the exported frames are.
    const hook = <T,>(name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as any).__mapmaker[n as string](...(a as unknown[])), [name, args]) as Promise<T>;
    const shotCamera = () => page.evaluate(() => JSON.parse((window as any).__mapmaker.store.world.all('sequence')[0].settings).camera[0].camera);
    const before = await shotCamera();
    assert.equal(before.projection, 'naturalEarth');
    assert.equal(await hook('heldMeridian'), null, 'nothing held at rest');
    // A place a little off the middle of the frame, and the pointer on it.
    const place: LL = [before.lon + 6, before.lat + 3];
    const start = await hook<[number, number]>('previewToPage', place[0], place[1]);
    let x = Math.round(start[0]), y = Math.round(start[1]);
    await page.mouse.move(x, y);
    await page.mouse.down();
    // While the meridian is held, a move of the pointer moves the place grabbed by exactly as
    // much. (When the pointer pauses for a moment, as it may on a busy computer, the map comes to
    // rest in between and is laid out afresh: such a move is not counted.)
    let last = { at: start, held: null as number | null, x, y };
    let exact = 0, carried = 0;
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      x -= 19; y += 7;
      await page.mouse.move(x, y);
      const st = await page.evaluate(async ([lon, lat]) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const m = (window as any).__mapmaker;
        return { at: m.previewToPage(lon, lat) as [number, number], held: m.heldMeridian() as number | null, parts: Object.values(m.store.renderer.lastParts) as string[] };
      }, place);
      const off = Math.hypot((st.at[0] - last.at[0]) - (x - last.x), (st.at[1] - last.at[1]) - (y - last.y));
      seen.push(`${i + 1}: held ${st.held}, ${off.toFixed(2)} px off, ${st.parts.join('/')}`);
      if (st.held !== null && (st.held === last.held || i === 0)) {
        assert.ok(off < 0.6, `while its meridian is held, the place grabbed moved ${off.toFixed(2)} px differently from the pointer (${seen.join('; ')})`);
        exact++;
        if (st.parts.length && st.parts.every((q) => q === 'moved')) carried++;
      }
      last = { at: st.at, held: st.held, x, y };
    }
    assert.ok(exact >= 6, `the preview kept its middle meridian in ${exact} of 12 moves (${seen.join('; ')})`);
    assert.ok(carried >= exact - 2, `the picture was carried along in ${carried} of those ${exact} moves (${seen.join('; ')})`);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await h.saved();
    assert.equal(await hook('heldMeridian'), null, 'laid out around the camera again at rest');
    const after = await shotCamera();
    assert.ok(Math.abs(after.lon - before.lon) > 1, `the shot's camera moved (${before.lon} to ${after.lon})`);
    assert.ok(!('meridian' in after), 'no held meridian is stored with the shot');
    const rest = await hook<[number, number]>('previewToPage', place[0], place[1]);
    assert.ok(Math.hypot(rest[0] - x, rest[1] - y) < 40, `at rest the place is still near the pointer (${Math.hypot(rest[0] - x, rest[1] - y).toFixed(1)} px)`);
    if (process.env.VERBOSE) console.log(`\n    ${seen.join('\n    ')}`);
    await h.screenshot('natural-earth-framed');
  });

  await h.step('A flat map: a 10 km city plan with straight borders and a scale in metres or kilometres', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-flat').check();
    await page.getByTestId('new-map-name').fill('Old Town');
    await page.getByTestId('new-map-width').fill('10');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId)?.name === 'Old Town');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.camera.projection), 'flat', 'seen in plan');
    assert.equal(await page.getByTestId('basemap-toggle').count(), 0, 'no Earth geography for a flat map');
    assert.match((await page.locator('.left .row', { hasText: 'Old Town' }).textContent()) ?? '', /flat, 10 km wide/);
    // A square with the precise shape tool: drawn, owned, straight.
    await h.newCountry('Guild Quarter');
    await page.getByTestId('tool-polygon').click();
    const { cx, cy } = await h.centre();
    for (const [x, y] of [[cx - 80, cy - 60], [cx + 80, cy - 60], [cx + 80, cy + 60]]) await page.mouse.click(x, y);
    await page.mouse.dblclick(cx - 80, cy + 60);
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    const mid = await h.toLL([cx, cy]);
    const now = await page.getByTestId('current-date').inputValue();
    await h.waitOwner(mid, now, 'Guild Quarter');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastLabels.some((l: any) => l.text === 'Guild Quarter' && l.drawn), null, { timeout: 5000 });
    const scale = (await page.locator('.scalebar span').textContent()) ?? '';
    assert.match(scale, /^\d[\d,.]* (m|km)$/, `a scale in metres or kilometres (${scale})`);
    const kmShown = /km/.test(scale) ? Number(scale.replace(/[^\d.]/g, '')) : Number(scale.replace(/[^\d.]/g, '')) / 1000;
    assert.ok(kmShown > 0 && kmShown <= 10, `a sensible distance on a 10 km plan (${scale})`);
    await h.screenshot('flat-map');
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    assert.notEqual(await page.evaluate(() => (window as any).__mapmaker.store.camera.projection), 'flat', 'Earth is round again');
  });

  await h.step('Settings: how fast and how sharp the working view is drawn, kept on this computer', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByTestId('tool-select').click();
    const state = () => page.evaluate(() => {
      const s = (window as any).__mapmaker.store, c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      return { v: s.viewSettings, carry: s.renderer.carry as boolean, tolerance: s.renderer.quality.tolerance as number, width: c.width, shown: Math.round(c.getBoundingClientRect().width), parts: Object.values(s.renderer.lastParts) as string[], labels: s.renderer.lastLabels.length as number, stored: localStorage.getItem('mapmaker.viewSettings') };
    });
    const before = await state();
    assert.ok(before.carry && before.v.resolution === 1 && before.width === before.shown, `balanced to begin with (${JSON.stringify(before.v)})`);
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-dialog').waitFor();
    assert.match(await page.getByTestId('preset-current').innerText(), /Balanced/);
    await page.getByTestId('preset-fastest').click();
    assert.match(await page.getByTestId('preset-current').innerText(), /Fastest/);
    await page.getByTestId('setting-speed').check();
    await h.screenshot('settings');
    await page.getByTestId('settings-close').click();
    await page.getByTestId('draw-speed').waitFor();
    await page.waitForFunction(() => /\d+ ms/.test(document.querySelector('[data-testid=draw-speed]')?.textContent ?? ''));
    // (And the frames a second the screen is getting, D143.)
    await page.waitForFunction(() => /^\d+ frames a second \(longest wait \d+ ms\)$/.test(document.querySelector('[data-testid=frame-rate]')?.textContent ?? ''));
    const rate = Number(/^(\d+)/.exec(await page.getByTestId('frame-rate').innerText())![1]);
    assert.ok(rate >= 1 && rate <= 500, `a rate a screen can have (${rate} frames a second)`);
    const fast = await state();
    assert.equal(fast.width, Math.round(before.shown * 0.75), 'three quarters of the pixels, shown at the same size');
    assert.equal(fast.shown, before.shown);
    assert.ok(fast.tolerance > before.tolerance, 'simpler outlines');
    assert.match(fast.stored ?? '', /"names":"hide"/, 'kept in this browser, not in the project');
    // While the map moves its picture is moved along and the names are hidden; at rest it is drawn afresh, names and all.
    const box = (await page.getByTestId('map-canvas').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.waitForTimeout(250);
    const still = await state();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 24, cy + 8);
    await page.mouse.move(cx + 48, cy + 16);
    const moving = await state();
    await page.mouse.up();
    assert.ok(moving.parts.length > 0 && moving.parts.every((p) => p === 'moved'), `the picture moves along with the map (${moving.parts.join(', ')})`);
    assert.equal(moving.labels, 0, 'names are hidden while the map moves');
    await page.waitForFunction((n) => (window as any).__mapmaker.store.renderer.lastLabels.length === n, still.labels, { timeout: 3000 });
    // One setting changed by hand; then back to how it was.
    await page.getByTestId('settings').click();
    await page.getByTestId('setting-names').selectOption('hold');
    assert.match(await page.getByTestId('preset-current').innerText(), /your own choices/);
    await page.getByTestId('preset-balanced').click();
    await page.getByTestId('setting-speed').uncheck();
    await page.getByTestId('settings-close').click();
    const after = await state();
    assert.deepEqual(after.v, before.v);
    assert.equal(after.width, before.width);
    assert.equal(await page.getByTestId('draw-speed').count(), 0);
  });

  await h.step('What is shown: names, lakes and rivers hidden while working but kept in the presentation; small lakes left out by size', async () => {
    await page.getByTestId('mode-world').click();
    const look = () => page.evaluate(() => {
      const s = (window as any).__mapmaker.store, space = s.world.get('map_space', s.spaceId);
      return { labels: s.renderer.lastLabels.length as number, lakes: s.renderer.basemapPainter.lakeFilter as { show: boolean; minKm2: number }, settings: JSON.parse(space.settings).show ?? {} };
    });
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastLabels.length > 0);
    await page.getByTestId('open-show').click();
    await page.getByTestId('show-dialog').waitFor();
    assert.ok(await page.getByTestId('show-working-names').isChecked() && await page.getByTestId('show-export-lakes').isChecked(), 'everything shown to begin with');
    // Rivers (Natural Earth's) drawn to begin with; hidden while working.
    assert.ok(await page.getByTestId('show-working-rivers').isChecked());
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.basemapPainter.lastRivers > 100);
    await page.getByTestId('show-working-rivers').uncheck();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.basemapPainter.lastRivers === 0);
    await page.getByTestId('show-working-names').uncheck();
    await page.getByTestId('show-working-lakes').uncheck();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastLabels.length === 0);
    assert.equal((await look()).lakes.show, false, 'no lakes while working');
    assert.ok(await page.getByTestId('show-export-names').isChecked() && await page.getByTestId('show-export-lakes').isChecked(), 'still in exports');
    // The smallest lake: about a thousand square kilometres, from part way along the slider.
    const slider = page.getByTestId('lake-min');
    const sb = (await slider.boundingBox())!;
    await slider.click({ position: { x: sb.width * 0.6, y: sb.height / 2 } });
    await page.waitForFunction(() => /km² and larger/.test(document.querySelector('[data-testid=lake-min-text]')?.textContent ?? ''));
    const set = await look();
    assert.ok(set.settings.minLakeKm2 >= 300 && set.settings.minLakeKm2 <= 3000, `about 1,000 km² (${set.settings.minLakeKm2})`);
    assert.match(await page.getByTestId('show-dialog').innerText(), /\d[\d,]* of [\d,]+ lakes shown/);
    await h.screenshot('what-is-shown');
    await page.getByTestId('show-dialog').getByRole('button', { name: 'Close' }).last().click();
    // The presentation preview shows what exports show: lakes, of the size chosen.
    await page.getByTestId('mode-present').click();
    await page.waitForFunction((min) => { const f = (window as any).__mapmaker.store.renderer.basemapPainter.lakeFilter; return f.show && f.minKm2 === min; }, set.settings.minLakeKm2);
    await page.getByTestId('mode-world').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.basemapPainter.lakeFilter.show === false);
    // Back as it was: one undo per change.
    for (let i = 0; i < 4; i++) await page.getByTestId('undo').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastLabels.length > 0);
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.basemapPainter.lastRivers > 100);
    const after = await look();
    assert.ok(after.lakes.show && after.lakes.minKm2 === 0 && after.settings.working?.names !== false && after.settings.working?.lakes !== false && after.settings.working?.rivers !== false && !after.settings.minLakeKm2, `names, lakes and rivers back (${JSON.stringify(after)})`);
  });

  await h.step('Locked countries: one locked from its menu keeps its land when drawn over and is given none; unlocked from its panel; all the others locked at once; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c[0], lat: c[1], zoom: 2, rotation: 0, projection: 'equirectangular' }), P.a);
    await h.setDate('1450');
    const held = (await h.ownerAt(P.a, '1450'))!;
    assert.ok(held, 'someone holds the place');
    const other = [A, B, C].find((n) => n !== held)!;
    const ids = await page.evaluate(([h1, o1]) => { const w = (window as any).__mapmaker.store.world; const id = (n: string) => w.all('entity').find((e: any) => e.name === n).id; return [id(h1), id(o1)]; }, [held, other] as const);
    const lockedCount = () => page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').filter((e: any) => /"locked":true/.test(e.style)).length) as Promise<number>;
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    // Locked from its row's menu: marked in the list.
    await page.getByTestId(`entity-row-${held}`).click({ button: 'right' });
    await page.getByTestId('menu-lock').click();
    await page.getByTestId(`locked-${held}`).waitFor();
    // Drawn over for another country from 1450 on: its land stays as it was, and the message says so.
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ tool: 'lasso', paintValue: id, selection: null }), ids[1]);
    const at = await h.toPage(P.a);
    await h.drawLasso(blob(at[0], at[1], 60, 45));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await page.getByText(`Locked, so left as it was: ${held}.`).waitFor();
    await h.saved();
    assert.equal(await h.ownerAt(P.a, '1450'), held, 'the locked country keeps its land');
    // It is given no land: shown as locked, and not to be chosen, in the brush's list.
    assert.equal(await page.getByTestId('paint-owner').locator('option', { hasText: `${held} (locked)` }).evaluate((o) => (o as HTMLOptionElement).disabled), true);
    // Unlocked from its panel.
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ tool: 'select', selection: { kind: 'entity', id } }), ids[0]);
    await page.getByTestId('entity-locked').uncheck();
    await page.getByTestId(`locked-${held}`).waitFor({ state: 'detached' });
    assert.equal(await lockedCount(), 0);
    // All the others locked at once from its menu (one step), and undone.
    await page.getByTestId(`entity-row-${held}`).click({ button: 'right' });
    await page.getByTestId('menu-lock-others').click();
    const total = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').filter((e: any) => e.type_id === 'polity' || e.type_id === 'faction').length) as number;
    await page.waitForFunction((n) => (window as any).__mapmaker.store.world.all('entity').filter((e: any) => /"locked":true/.test(e.style)).length === n, total - 1);
    await h.screenshot('locked-countries');
    await page.getByTestId('undo').click();
    await page.waitForFunction(() => !(window as any).__mapmaker.store.world.all('entity').some((e: any) => /"locked":true/.test(e.style)));
    // Back as it was: the unlock, the drawing and the lock undone.
    for (let i = 0; i < 3; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'every step of this one undone');
  });

  await h.step('Terrain: land coloured by height and the sea by depth, with relief; the satellite look, as photographed and by land cover; finer heights, photographs and made-up fine ground close in; relief over the countries; hidden while working but kept in the presentation; undone', async () => {
    await page.getByTestId('mode-world').click();
    // The whole world: the Himalaya, the plains of India, the Atlantic and the countries drawn over it.
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 20, lat: 20, zoom: 0.3, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1450');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const pixelAt = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, ll);
    /** The pixels of a square of the map around a place (its colours, for comparing two pictures). */
    const patch = (ll: LL, half: number) => page.evaluate(([lon, lat, n]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k) - n, Math.round((p[1] - r.top) * k) - n, 2 * n, 2 * n).data);
    }, [ll[0], ll[1], half] as const);
    const meanDiff = (a: number[], b: number[]) => { let d = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) d += Math.abs(a[i] - b[i]); return d / (a.length * 0.75); };
    /** How light a square of the map around a place is: red, green and blue added up, averaged. */
    const light = async (ll: LL) => { const px = await patch(ll, 6); let t = 0; for (let i = 0; i < px.length; i += 4) t += px[i] + px[i + 1] + px[i + 2]; return t / (px.length / 4); };
    // Places no country of this test covers: the Tibetan plateau and the West Siberian Plain; the
    // shallow North Sea and the deep Pacific off Japan.
    const tibet: LL = [88, 33], siberia: LL = [75, 61], shelf: LL = [3, 55], deep: LL = [150, 30];
    for (const ll of [tibet, siberia, shelf, deep]) assert.equal(await h.ownerAt(ll, '1450'), null, `nobody holds ${ll}`);
    const lit = async () => (await light(tibet)) - (await light(siberia));
    assert.ok(Math.abs(await lit()) < 20, `without terrain the land is one colour (${await lit()})`);
    const show = async (fn: () => Promise<void>) => {
      await page.getByTestId('open-show').click();
      await page.getByTestId('show-dialog').waitFor();
      await fn();
      await page.getByTestId('show-dialog').getByRole('button', { name: 'Close' }).last().click();
    };
    const terrain = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastTerrain) as Promise<{ colours: boolean; relief: boolean; overTerritories: boolean; seaLevel: number; cover: boolean; detail: string; photo: string }>;
    await show(async () => {
      assert.equal(await page.getByTestId('show-working-terrain').count(), 0, 'no terrain row before there is terrain');
      await page.getByTestId('terrain-on').check();
      await page.getByTestId('show-working-terrain').waitFor();
    });
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.colours, null, { timeout: 30000 });
    // The plateau, at 5,000 m, in the light colours of the heights; the plain in the green of the lowlands.
    let d = 0;
    for (let i = 0; i < 40 && (d = await lit()) < 80; i++) await page.waitForTimeout(100);
    assert.ok(d >= 80, `the Tibetan plateau lighter than the West Siberian Plain (${await pixelAt(tibet)} against ${await pixelAt(siberia)})`);
    assert.ok((await light(shelf)) > (await light(deep)) + 25, `the North Sea's shallows (${await pixelAt(shelf)}) lighter than the deep Pacific (${await pixelAt(deep)})`);
    await h.screenshot('terrain');
    // The satellite look (D100): the land's colours from its land cover, a desert sand and a rainforest green.
    // (Places nothing of this test covers: the Taklamakan desert and Borneo's rainforest.)
    const sahara: LL = [83, 39], congo: LL = [114, 1];
    for (const ll of [sahara, congo]) assert.equal(await h.ownerAt(ll, '1450'), null, `nobody holds ${ll}`);
    await show(async () => { await page.getByTestId('terrain-palette').selectOption('satellite'); });
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.cover, null, { timeout: 30000 });
    const mean = async (ll: LL) => { const px = await patch(ll, 5), c = [0, 0, 0]; for (let i = 0; i < px.length; i += 4) for (let q = 0; q < 3; q++) c[q] += px[i + q] / (px.length / 4); return c; };
    let sand = await mean(sahara), forest = await mean(congo);
    for (let i = 0; i < 40 && !(sand[0] > sand[2] + 40 && forest[1] > forest[0] && forest[1] > forest[2]); i++) { await page.waitForTimeout(100); sand = await mean(sahara); forest = await mean(congo); }
    assert.ok(sand[0] > sand[2] + 40 && sand[0] > 150, `the desert at ${sahara} is sand (${sand.map(Math.round)})`);
    assert.ok(forest[1] > forest[0] && forest[1] > forest[2] && forest[1] < 120, `the rainforest at ${congo} is green (${forest.map(Math.round)})`);
    // The Earth as photographed (D138): the picture of the whole planet that ships with the app, credited on the map.
    assert.equal((await terrain()).photo, 'world');
    assert.match(await page.getByTestId('photo-credit').innerText(), /Sentinel-2 cloudless by EOX/);
    await h.screenshot('terrain-satellite');
    // Without the photographs: the land's colours by its cover (D100), a desert sand and a rainforest green still.
    const photographed = [await mean(sahara), await mean(congo)];
    await show(() => page.getByTestId('terrain-photo').uncheck());
    await page.waitForFunction(() => !(window as any).__mapmaker.store.renderer.lastTerrain.photo);
    assert.equal(await page.getByTestId('photo-credit').count(), 0);
    await page.waitForTimeout(300);
    sand = await mean(sahara); forest = await mean(congo);
    assert.ok(sand[0] > sand[2] + 40 && sand[0] > 150, `by its cover the desert is sand (${sand.map(Math.round)})`);
    assert.ok(forest[1] > forest[0] && forest[1] > forest[2] && forest[1] < 120, `and the rainforest green (${forest.map(Math.round)})`);
    assert.ok(Math.max(...sand.map((v, q) => Math.abs(v - photographed[0][q]))) + Math.max(...forest.map((v, q) => Math.abs(v - photographed[1][q]))) > 6, `not the photograph's colours (${sand.map(Math.round)} and ${forest.map(Math.round)} against ${photographed.map((c) => c.map(Math.round))})`);
    await h.screenshot('terrain-satellite-cover');
    // Close in (D101): finer heights from Terrain Tiles kept on this computer (made here: ridges about
    // 8 km apart, which the bundled 10 km grid cannot hold), turned off again for the bundled heights.
    const tiles = [6, 7, 8].reduce((n, z) => n + writeTerrainTiles(h.projects, z, [5, 46, 15, 54], (lon) => 600 + 500 * Math.sin((2 * Math.PI * lon) / 0.11)), 0);
    assert.ok(tiles > 40);
    // (Without the ground made up below the heights' own detail, D141: what the heights themselves show.)
    await show(() => page.getByTestId('terrain-fine').uncheck());
    const rugged = async () => { const px = await patch([10, 50], 30), l: number[] = []; for (let i = 0; i < px.length; i += 4) l.push(px[i] + px[i + 1] + px[i + 2]); const m = l.reduce((a, b) => a + b, 0) / l.length; return Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length); };
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 10, lat: 50, zoom: 6.5, rotation: 0, projection: 'equirectangular' }));
    await page.waitForFunction(() => /^detail:/.test((window as any).__mapmaker.store.renderer.lastTerrain.detail), null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const fine = await rugged();
    await h.screenshot('terrain-close-up');
    await show(() => page.getByTestId('terrain-detail').uncheck());
    await page.waitForFunction(() => !(window as any).__mapmaker.store.renderer.lastTerrain.detail);
    await page.waitForTimeout(300);
    const coarse = await rugged();
    assert.ok(fine > 8 && fine > 2 * coarse, `the ridges show close in (spread of lightness ${fine.toFixed(1)}, and ${coarse.toFixed(1)} with the bundled heights)`);
    // The ground made up below the heights' own detail (D141): with the bundled heights alone, soft close in,
    // there is more to see once it is on (fine relief and a faint mottling); the same picture each time.
    await show(() => page.getByTestId('terrain-fine').check());
    await page.waitForTimeout(400);
    const madeUp = await rugged(), madeUpPixels = await patch([10, 50], 30);
    assert.ok(madeUp > coarse + 1, `fine ground close in (spread of lightness ${madeUp.toFixed(1)} against ${coarse.toFixed(1)} without)`);
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 10.2, lat: 50.1, zoom: 6.5, rotation: 0, projection: 'equirectangular' }));
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 10, lat: 50, zoom: 6.5, rotation: 0, projection: 'equirectangular' }));
    await page.waitForTimeout(500);
    assert.ok(meanDiff(madeUpPixels, await patch([10, 50], 30)) < 1.5, 'the same ground when the view comes back to it');
    await h.screenshot('terrain-fine-ground');
    // Photographs close in (D138): picture tiles kept on this computer (made here: stripes half a degree wide,
    // magenta and green, which no photograph has), laid over the picture of the whole planet where they are.
    const photoTiles = [7, 8, 9].reduce((n, level) => n + writePhotoTiles(h.projects, level, [6, 47, 14, 53], (lon) => (Math.floor(lon / 0.5) % 2 ? [255, 0, 255] : [0, 255, 0])), 0);
    assert.ok(photoTiles > 100);
    await show(() => page.getByTestId('terrain-photo').check());
    await page.waitForFunction(() => /^photo:/.test((window as any).__mapmaker.store.renderer.lastTerrain.photo), null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const stripeA = await mean([10.25, 50]), stripeB = await mean([10.75, 50]);
    assert.ok(stripeA[1] > 180 && stripeA[0] < 90 && stripeA[2] < 90, `a green stripe of the tiles at 10.25 °E (${stripeA.map(Math.round)})`);
    assert.ok(stripeB[0] > 180 && stripeB[2] > 180 && stripeB[1] < 90, `a magenta one at 10.75 °E (${stripeB.map(Math.round)})`);
    await h.screenshot('terrain-photo-close-up');
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 20, lat: 20, zoom: 0.3, rotation: 0, projection: 'equirectangular' }));
    // Relief over the countries: the shading of the sea floor shows through the country drawn over the Atlantic.
    const plain = await patch(P.a, 24);
    await show(() => page.getByTestId('terrain-over-territories').check());
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.overTerritories);
    await page.waitForTimeout(300);
    const shaded = await patch(P.a, 24);
    assert.ok(meanDiff(plain, shaded) > 0.5, `relief over the country (mean change ${meanDiff(plain, shaded).toFixed(2)})`);
    await h.screenshot('terrain-relief-over-countries');
    // Hidden while working: gone from the working view, kept in the presentation (and exports).
    await show(() => page.getByTestId('show-working-terrain').uncheck());
    await page.waitForFunction(() => !(window as any).__mapmaker.store.renderer.lastTerrain.colours);
    await page.getByTestId('mode-present').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.colours);
    await page.getByTestId('mode-world').click();
    assert.deepEqual(await terrain(), { colours: false, relief: false, overTerritories: false, seaLevel: 0, cover: false, detail: '', photo: '' });
    // Undone, step by step, to no terrain.
    for (let i = 0; i < 9; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each change was one step');
    assert.equal(await page.evaluate(() => JSON.parse((window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId).settings).terrain ?? null), null);
  });

  await h.step('Sea level over time: 120 m lower, the North Sea is land, and territory ending at the coast covers it; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 3, lat: 54, zoom: 3, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1450');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const pixelAt = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, ll);
    const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    // A country on the military control layer, whose territory ends at the coast, over the North Sea and the land around it.
    await page.locator('.left .row', { hasText: 'Military control' }).locator('span', { hasText: 'Military control' }).click();
    assert.ok(await page.getByTestId('clip-to-land').isChecked(), 'territory on this layer ends at the coast');
    const seaPlaces: LL[] = [[3, 55.5], [2, 56.6], [4.5, 56.6], [3.5, 54.4]], landPlaces: LL[] = [[-1, 52.7], [-2, 54.6], [8, 52.4], [6.6, 52.8]];
    for (const ll of [...seaPlaces, ...landPlaces]) for (const layer of ['Political', 'Military control']) assert.equal(await h.ownerOnLayer(ll, '1450', layer), null, `nobody holds ${ll} on ${layer}`);
    await h.setDate('1400');
    await h.newCountry('Dogger Folk');
    await page.getByTestId('tool-polygon').click();
    const corners: LL[] = [[-3, 51], [9, 51], [9, 58], [-3, 58]];
    for (const ll of corners) { const q = await h.toPage(ll); await page.mouse.click(q[0], q[1]); }
    const end = await h.toPage(corners[3]);
    await page.mouse.dblclick(end[0] + 1, end[1] + 1);
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await h.setDate('1450');
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.all('entity').some((e: any) => e.name === 'Dogger Folk'));
    assert.equal(await h.ownerOnLayer(seaPlaces[0], '1450', 'Military control'), 'Dogger Folk');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Places away from the country's name.
    const named = await page.evaluate(() => ((window as any).__mapmaker.store.renderer.lastLabels as Array<{ box?: number[] }>).map((l) => l.box ?? []));
    const canvasBox = (await page.getByTestId('map-canvas').boundingBox())!;
    const clear = async (ll: LL) => { const [x, y] = await h.toPage(ll); return !named.some((b) => x - canvasBox.x > b[0] - 10 && x - canvasBox.x < b[2] + 10 && y - canvasBox.y > b[1] - 10 && y - canvasBox.y < b[3] + 10); };
    const pick = async (list: LL[]) => { for (const ll of list) if (await clear(ll)) return ll; throw new Error(`every place is under a name: ${list}`); };
    const sea = await pick(seaPlaces), land = await pick(landPlaces);
    // Today's sea: the territory stops at the coast, so the North Sea shows the sea.
    assert.ok(diff(await pixelAt(sea), await pixelAt(land)) > 20, `the North Sea (${await pixelAt(sea)}) is not the land held (${await pixelAt(land)})`);
    // The sea 120 m lower from the date viewed: the North Sea is land, held by the country.
    await page.getByTestId('open-sea-level').click();
    await page.getByTestId('sea-add').click();
    await page.getByTestId('sea-metres-0').fill('-120');
    await page.getByTestId('sea-metres-0').press('Enter');
    await page.getByTestId('sea-level-now').getByText("120 m below today's").waitFor();
    await page.getByTestId('sea-level-dialog').getByRole('button', { name: 'Close' }).last().click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.seaLevel === -120, null, { timeout: 30000 });
    let d = 255;
    for (let i = 0; i < 40 && (d = diff(await pixelAt(sea), await pixelAt(land))) > 12; i++) await page.waitForTimeout(100);
    assert.ok(d <= 12, `the North Sea, now land, is held like the land (${await pixelAt(sea)} against ${await pixelAt(land)})`);
    await h.screenshot('sea-level-lower');
    // Undone: the sea level, the drawing and the country.
    for (let i = 0; i < 4; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each change was one step');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.seaLevel === 0);
  });

  await h.step('A generated planet: chosen with a picture of it, made from its seed, land and sea drawn, territory ending at its coast; undone', async () => {
    await page.getByTestId('mode-world').click();
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const was = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return { spaceId: s.spaceId as string, layerId: s.layerId as string }; });
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-planet').check();
    await page.getByTestId('new-map-name').fill('Seedworld');
    await page.getByTestId('planet-preset-ocean').click();
    await page.getByTestId('planet-preset-earthlike').click();
    await page.getByTestId('planet-seed').fill('7');
    // The picture follows the settings.
    await page.waitForFunction(() => document.querySelector('[data-testid=planet-preview]')?.getAttribute('data-planet') === 'earthlike:7');
    await h.screenshot('planet-dialog');
    await page.getByTestId('new-map-create').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.colours, null, { timeout: 60000 });
    // An Earth-like planet takes the satellite look: its biomes worked out a moment after its heights (D100).
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.cover, null, { timeout: 30000 });
    // A place of land and a place of sea on the planet, read from its heights; they are drawn differently.
    const places = await page.evaluate(() => {
      const s = (window as any).__mapmaker.store, g = s.terrainOf(s.world.get('map_space', s.spaceId)).grid;
      const ll = (k: number): [number, number] => [-180 + ((k % g.width) + 0.5) * (360 / g.width), 90 - (Math.floor(k / g.width) + 0.5) * (180 / g.height)];
      const ok = (k: number, land: boolean) => { const j = Math.floor(k / g.width); if (j < g.height * 0.25 || j > g.height * 0.75) return false; for (const d of [-2, -1, 0, 1, 2]) for (const e of [-2, -1, 0, 1, 2]) { const v = g.data[k + d * g.width + e]; if (land ? v < 300 : v > -1500) return false; } return true; };
      let land = -1, sea = -1;
      for (let k = 0; k < g.data.length && (land < 0 || sea < 0); k += 97) { if (land < 0 && ok(k, true)) land = k; if (sea < 0 && ok(k, false)) sea = k; }
      return { land: ll(land), sea: ll(sea) };
    });
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 0.5, rotation: 0, projection: 'equirectangular' }), places.land);
    const pixelAt = (ll: [number, number]) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, ll);
    let landPx: number[] = [], seaPx: number[] = [];
    for (let i = 0; i < 30; i++) {
      landPx = await pixelAt(places.land); seaPx = await pixelAt(places.sea);
      if (Math.max(...landPx.map((v, k) => Math.abs(v - seaPx[k]))) > 25) break;
      await page.waitForTimeout(100);
    }
    assert.ok(Math.max(...landPx.map((v, k) => Math.abs(v - seaPx[k]))) > 25, `land (${landPx}) and sea (${seaPx}) look different`);
    // Territory ends at the planet's own coast, as on Earth.
    assert.ok(await page.getByTestId('clip-to-land').isChecked(), 'territory ends at the coast');
    await h.screenshot('planet');
    // Undone: the planet is gone, and with it the map viewed: the first map is shown instead (not a blank page).
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before);
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.name === 'Seedworld')), false, 'the planet is gone');
    await page.getByTestId('map-canvas').waitFor();
    assert.ok(await page.evaluate(() => { const s = (window as any).__mapmaker.store; return !!s.world.get('map_space', s.spaceId); }), 'a map that exists is shown');
    await page.evaluate((w) => (window as any).__mapmaker.store.set({ spaceId: w.spaceId, layerId: w.layerId, selection: null }), was);
  });

  await h.step('Sculpting: land painted into the North Sea in the base world; a dated stroke floods England from a date only; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 2, lat: 54, zoom: 3, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1450');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const pixelAt = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, ll);
    const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const northSea: LL = [3, 55.5], england: LL = [-1, 52.7], germany: LL = [8, 52.4];
    for (const ll of [northSea, england, germany]) for (const layer of ['Political', 'Military control']) assert.equal(await h.ownerOnLayer(ll, '1450', layer), null, `nobody holds ${ll} on ${layer}`);
    const sea = await pixelAt(northSea), land = await pixelAt(germany);
    assert.ok(diff(sea, land) > 20, 'the North Sea is sea to begin with');
    const stroke = async (lls: LL[]) => {
      const pts: Array<[number, number]> = [];
      for (const ll of lls) pts.push(await h.toPage(ll));
      await page.mouse.move(pts[0][0], pts[0][1]);
      await page.mouse.down();
      for (const q of pts.slice(1)) await page.mouse.move(q[0], q[1], { steps: 6 });
      await page.mouse.up();
    };
    const waitColour = async (ll: LL, like: number[], what: string) => {
      let d = 255;
      for (let i = 0; i < 60 && (d = diff(await pixelAt(ll), like)) > 12; i++) await page.waitForTimeout(100);
      assert.ok(d <= 12, `${what} (${await pixelAt(ll)} against ${like})`);
    };
    // Land painted across the North Sea, in the base world: land at every date.
    await page.getByTestId('tool-sculpt').click();
    await page.getByTestId('sculpt-brush').selectOption('land');
    await page.getByTestId('sculpt-size').fill('120');
    await stroke([[1.5, 55.5], [3, 55.5], [4.5, 55.5]]);
    await waitColour(northSea, land, 'the North Sea is land now');
    // The sea painted over England from the date viewed on: sea then, land before.
    await page.getByTestId('sculpt-brush').selectOption('sea');
    await page.getByTestId('sculpt-when').selectOption('dated');
    await stroke([[-2, 52.7], [-1, 52.7], [0, 52.7]]);
    await waitColour(england, sea, 'England is under the sea from 1450');
    await h.screenshot('sculpted');
    await h.setDate('1400');
    await waitColour(england, land, 'and land before');
    assert.equal(await page.evaluate(() => JSON.parse((window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId).settings).sculpt.length), 2);
    // Undone, stroke by stroke.
    for (let i = 0; i < 2; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each stroke was one step');
    await h.setDate('1450');
    await waitColour(northSea, sea, 'the North Sea is sea again');
    await page.getByTestId('tool-select').click();
  });

  await h.step('Conditions: a radiation layer; a source placed with a click from the date viewed, there while it lasts and not before or after; a plume carried east; hidden while working but presented; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 70, lat: 56, zoom: 2, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1450');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const site: LL = [75, 61], plumeAt: LL = [60, 52], east: LL = [64.5, 52], west: LL = [55.5, 52];
    for (const ll of [site, plumeAt, east, west]) assert.equal(await h.ownerAt(ll, '1450'), null, `nobody holds ${ll}`);
    const pixelAt = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, ll);
    const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const fields = () => page.evaluate(() => (window as any).__mapmaker.store.renderer.lastFields) as Promise<Array<{ layer: string; sources: number; drawn: number }>>;
    const plain = await pixelAt(site), plainEast = await pixelAt(east);
    // A field layer of radiation, from + Layer; the Conditions tool is then ready to place sources on it.
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('layer-kind-field').click();
    await page.getByTestId('new-layer-field-type').selectOption('radiation');
    await page.getByTestId('new-layer-name').fill('Fallout');
    await page.getByTestId('create-layer').click();
    await page.getByTestId('field-options').waitFor();
    await page.getByTestId('field-shape').selectOption('circle');
    await page.getByTestId('field-radiusKm').fill('400');
    await page.getByTestId('field-intensity').fill('800');
    const at = await h.toPage(site);
    await page.mouse.click(at[0], at[1]);
    await h.saved();
    // Two days on: strong (red) where it was placed.
    await h.setDate('3 January 1450');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.some((f: any) => f.drawn === 1));
    let px = await pixelAt(site);
    for (let i = 0; i < 30 && !(px[0] > px[1] + 60); i++) { await page.waitForTimeout(100); px = await pixelAt(site); }
    assert.ok(px[0] > px[1] + 60 && diff(px, plain) > 60, `red where it struck (${px} against ${plain})`);
    await h.screenshot('conditions-radiation');
    // Not the day before; gone a year on.
    await h.setDate('1449');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.every((f: any) => f.drawn === 0));
    await h.setDate('1451');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.every((f: any) => f.drawn === 0));
    // A plume, carried east at 150 km a day: four days on it reaches 300 km east of where it began, not west.
    await h.setDate('1450');
    await page.getByTestId('field-shape').selectOption('plume');
    await page.getByTestId('field-radiusKm').fill('15');
    await page.getByTestId('field-windDeg').fill('90');
    await page.getByTestId('field-windKmPerDay').fill('150');
    const pa = await h.toPage(plumeAt);
    await page.mouse.click(pa[0], pa[1]);
    await h.saved();
    await h.setDate('5 January 1450');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.some((f: any) => f.drawn === 2));
    let ePx = await pixelAt(east);
    for (let i = 0; i < 30 && diff(ePx, plainEast) <= 25; i++) { await page.waitForTimeout(100); ePx = await pixelAt(east); }
    assert.ok(diff(ePx, plainEast) > 25, `the plume downwind (${ePx} against ${plainEast})`);
    assert.ok(diff(await pixelAt(west), plainEast) <= 12, `nothing upwind (${await pixelAt(west)})`);
    await h.screenshot('conditions-plume');
    // Hidden while working, still in the presentation (and exports).
    await page.getByTestId('open-show').click();
    await page.getByTestId('show-dialog').waitFor();
    await page.getByTestId('show-working-fields').uncheck();
    await page.getByTestId('show-dialog').getByRole('button', { name: 'Close' }).last().click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.length === 0);
    await page.getByTestId('mode-present').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.length > 0);
    await page.getByTestId('mode-world').click();
    // Undone, step by step: the switch, the plume, the circle and the layer.
    assert.equal(await fields().then((f) => f.length), 0);
    for (let i = 0; i < 4; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each change was one step');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('layer').some((l: any) => l.kind === 'field')), false);
    await page.getByTestId('tool-select').click();
  });

  await h.step('Conditions spreading over the terrain: a fire in the West Siberian Plain advances day by day; undone', async () => {
    await page.getByTestId('mode-world').click();
    const site: LL = [75, 61];
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c[0], lat: c[1], zoom: 3.5, rotation: 0, projection: 'equirectangular' }), site);
    await h.setDate('1450');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    assert.equal(await h.ownerAt(site, '1450'), null, 'nobody holds the place');
    const patch = () => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k) - 120, Math.round((p[1] - r.top) * k) - 120, 240, 240).data);
    }, site);
    const plain = await patch();
    const burnt = (px: number[]) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (Math.max(Math.abs(px[i] - plain[i]), Math.abs(px[i + 1] - plain[i + 1]), Math.abs(px[i + 2] - plain[i + 2])) > 30) n++; return n; };
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('layer-kind-field').click();
    await page.getByTestId('new-layer-field-type').selectOption('fire');
    await page.getByTestId('create-layer').click();
    await page.getByTestId('field-options').waitFor();
    assert.equal(await page.getByTestId('field-shape').inputValue(), 'spread', 'a fire spreads over the terrain to begin with');
    await page.getByTestId('field-radiusKm').fill('200');
    await page.getByTestId('field-grow').fill('8');
    await page.getByTestId('field-hold').fill('10');
    const at = await h.toPage(site);
    await page.mouse.click(at[0], at[1]);
    await h.saved();
    const on = async (date: string) => {
      await h.setDate(date);
      await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.some((f: any) => f.drawn > 0), null, { timeout: 30000 });
      await page.waitForTimeout(300);
      return burnt(await patch());
    };
    const early = await on('3 January 1450'), later = await on('7 January 1450');
    assert.ok(early > 50 && later > 1.5 * early, `the fire advances (${early} pixels burning on the 3rd, ${later} on the 7th)`);
    await h.screenshot('conditions-fire');
    for (let i = 0; i < 2; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'the fire and its layer, one step each');
    await page.getByTestId('tool-select').click();
  });

  await h.step('Disasters: a meteor impact placed with one click as an event from the date viewed, its crater in the terrain and its blast, fires and dust; one undo takes it all back', async () => {
    await page.getByTestId('mode-world').click();
    const site: LL = [75, 61];
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c[0], lat: c[1], zoom: 3, rotation: 0, projection: 'equirectangular' }), site);
    await h.setDate('1450');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const state = () => page.evaluate(() => {
      const s = (window as any).__mapmaker.store, space = s.world.get('map_space', s.spaceId);
      return { fields: s.world.all('layer').filter((l: any) => l.kind === 'field').map((l: any) => JSON.parse(l.style).field.type).sort(), craters: (JSON.parse(space.settings).sculpt ?? []).length, events: s.world.all('event').map((e: any) => e.name) };
    }) as Promise<{ fields: string[]; craters: number; events: string[] }>;
    const was = await state();
    const pixelAt = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, ll);
    const plain = await pixelAt(site);
    await page.getByTestId('tool-disaster').click();
    await page.getByTestId('disaster-kind').selectOption('meteor');
    await page.getByTestId('disaster-size').fill('2000');
    assert.match((await page.getByTestId('disaster-hint').textContent()) ?? '', /meteor impact \(2 km across\) as a new event from/);
    const at = await h.toPage(site);
    await page.mouse.click(at[0], at[1]);
    await h.saved();
    const now = await state();
    assert.ok(now.events.includes('Meteor impact (2 km across)'), 'an event named after it');
    assert.deepEqual(now.fields, ['damage', 'fire', 'smoke'], 'its blast, fires and dust, each on a layer of its kind');
    assert.equal(now.craters, was.craters + 1, 'its crater in the terrain');
    const journal = () => page.evaluate(() => (window as any).__mapmaker.store.journal) as Promise<{ undoLabel: string | null; redoLabel: string | null }>;
    assert.equal((await journal()).undoLabel, 'Meteor impact (2 km across)', 'one step, named after it');
    // The day after: ruined ground where it struck.
    await h.setDate('2 January 1450');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.some((f: any) => f.drawn > 0));
    let px = await pixelAt(site);
    for (let i = 0; i < 30 && Math.max(...px.map((v, k) => Math.abs(v - plain[k]))) <= 30; i++) { await page.waitForTimeout(100); px = await pixelAt(site); }
    assert.ok(Math.max(...px.map((v, k) => Math.abs(v - plain[k]))) > 30, `the blast shows (${px} against ${plain})`);
    await h.screenshot('disaster-meteor');
    // One undo takes it all back.
    await page.getByTestId('undo').click();
    await h.saved();
    assert.deepEqual(await state(), was);
    assert.equal((await journal()).redoLabel, 'Meteor impact (2 km across)', 'undone in one step');
    assert.ok((await steps()) >= before);
    await page.getByTestId('tool-select').click();
  });

  await h.step('A heatmap worked out from the battles; three thousand strikes drawn in a 4K export frame and in the working view; undone', async () => {
    await page.getByTestId('mode-world').click();
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    // The layer of battles (points) and a date when it has some.
    const found = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store;
      const layer = s.world.all('layer').find((l: any) => l.kind === 'point' && l.space_id === s.spaceId);
      if (!layer) return null;
      for (const y of [1450, 1500, 1600, 1700, 1800, 1850, 1900, 1950, 2000, 1400]) {
        const pts = s.engine.featuresAt(layer.id, m.bench.gregorian.fromCivil({ year: y }));
        if (pts.length) return { layer: layer.id as string, name: layer.name as string, year: y, n: pts.length as number, at: pts[0].parts[0] as LL };
      }
      return null;
    });
    assert.ok(found, 'a layer of points with points in it');
    await h.setDate(String(found.year));
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c[0], lat: c[1], zoom: 2, rotation: 0, projection: 'equirectangular' }), found.at);
    // A patch of the map around the battle, 41 pixels square. (Not one pixel: the claim drawn there
    // earlier is striped over everything under it, and where its stripes fall depends on the layout.)
    const patchAt = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k) - 20, Math.round((p[1] - r.top) * k) - 20, 41, 41).data);
    }, ll);
    /** The share of the patch's pixels changed by more than 20 in a colour. */
    const changed = (a: number[], b: number[]) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 20) n++;
      return n / (a.length / 4);
    };
    await page.waitForTimeout(300);
    const plain = await patchAt(found.at);
    const before = await steps();
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('layer-kind-field').click();
    await page.getByTestId('new-layer-field-type').selectOption('heat');
    await page.getByTestId('new-layer-name').fill('Where the battles were');
    await page.getByTestId('create-layer').click();
    await page.getByTestId('field-from').selectOption(found.layer);
    await page.getByTestId('field-kernel').fill('500');
    await page.waitForFunction((from) => (window as any).__mapmaker.store.world.all('layer').some((l: any) => l.kind === 'field' && JSON.parse(l.style).field.from === from && JSON.parse(l.style).field.kernelKm === 500), found.layer);
    await page.waitForFunction((n) => (window as any).__mapmaker.store.renderer.lastFields.some((f: any) => f.sources === n && f.drawn >= n), found.n);
    let share = changed(await patchAt(found.at), plain);
    for (let i = 0; i < 30 && share < 0.3; i++) { await page.waitForTimeout(100); share = changed(await patchAt(found.at), plain); }
    assert.ok(share >= 0.3, `warm where the battles were (${Math.round(share * 100)}% of the pixels around the battle changed)`);
    await h.screenshot('heatmap-from-points');
    // Stress: three thousand strikes in one step, then a 4K export frame of the conditions alone, and the working view.
    const r = await page.evaluate(async () => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const layer = s.execute((w: any) => B.commands.createFieldLayer(w, s.spaceId, 'Strikes', 'radiation'));
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const sources = Array.from({ length: 3000 }, (_, i) => ({ name: `Strike ${i}`, at: [-10 + 150 * rnd(), 20 + 45 * rnd()], source: { shape: 'circle', radiusKm: 10 + 40 * rnd(), noise: 0.4, seed: i + 1 } }));
      const t0 = performance.now();
      s.execute((w: any) => B.commands.addFieldSources(w, { layerId: layer, sources, mode: { kind: 'change', t: s.time } }));
      const added = performance.now() - t0;
      const start = { day: s.time.day + 1, ms: 0 };
      const shot = B.defaultShot(s.spaceId, { lon: 60, lat: 45, zoom: 1.6, rotation: 0, projection: 'equirectangular' }, start, { day: start.day + 1, ms: 0 }, 24, 1);
      const def = B.PASS_DEFS.find((d: any) => d.name === 'fields');
      const canvas = document.createElement('canvas');
      canvas.width = 3840; canvas.height = 2160;
      const ctx = canvas.getContext('2d')!;
      const renderer = new B.MapRenderer();
      renderer.quality = { ...B.EXPORT_QUALITY };
      const t1 = performance.now();
      B.renderFrame(ctx, renderer, s.world, s.engine, shot, 0, def, 3840, 2160, null, null);
      const frameMs = performance.now() - t1;
      const data = ctx.getImageData(0, 0, 3840, 2160).data;
      let coloured = 0;
      for (let i = 3; i < data.length; i += 4 * 16) if (data[i] > 20) coloured++;
      const drawn = renderer.lastFields.find((f: any) => f.layer === layer);
      // The working view, the day after.
      s.setTime(start);
      await new Promise((res) => setTimeout(res, 400));
      const t2 = performance.now();
      s.notify();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const viewMs = performance.now() - t2;
      return { added, frameMs, coloured: coloured / (data.length / 64), sources: drawn?.sources, rects: drawn?.drawn, view: s.renderer.lastFields.find((f: any) => f.layer === layer)?.sources, viewMs };
    });
    console.log(`  3000 strikes: added in ${Math.round(r.added)} ms; a 4K frame of them in ${Math.round(r.frameMs)} ms (${(r.coloured * 100).toFixed(0)}% coloured); the working view in ${Math.round(r.viewMs)} ms`);
    assert.equal(r.sources, 3000, 'every strike in force');
    assert.ok(r.rects > 1500 && r.coloured > 0.02, `drawn: those in the frame's view (${r.rects} rectangles, ${(r.coloured * 100).toFixed(1)}% of the frame)`);
    assert.equal(r.view, 3000, 'and in the working view');
    assert.ok(r.frameMs < 60000, `a 4K frame in reasonable time (${Math.round(r.frameMs)} ms)`);
    await h.screenshot('strikes-3000');
    // Undone: the strikes, their layer, the heatmap's settings and its layer.
    for (let i = 0; i < 5; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('layer').some((l: any) => l.kind === 'field')), false, 'no conditions left');
    assert.ok((await steps()) >= before);
    await page.getByTestId('tool-select').click();
  });

  await h.step('Routes: a line drawn as a campaign arrow, broad along its path, chevrons flowing along it as a shot plays and still while world-building; undone', async () => {
    await page.getByTestId('mode-world').click();
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const at: LL = [15, 46];
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c[0], lat: c[1], zoom: 2.5, rotation: 0, projection: 'equirectangular' }), at);
    /** The pixels of the map in a column across the line (61 tall) at a place along it. */
    const column = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k) - 30, 1, 61).data);
    }, ll);
    const changedIn = (a: number[], b: number[]) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 40) n++; return n; };
    await page.waitForTimeout(300);
    const plain = await column([13, 46]), plainTail = await column([4, 46]);
    // A layer of lines and a straight line west to east from the date viewed (as the Lines tool makes them), in cyan.
    const made = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const layer = s.execute((w: any) => B.commands.createLayer(w, s.spaceId, 'Campaigns', 'line'));
      const id = s.execute((w: any) => B.commands.createFeature(w, { layerId: layer, name: 'Drive to the east', parts: [[[3, 46], [27, 46]]], mode: { kind: 'change', t: s.time }, style: { color: '#00e5ff' } }));
      return { layer: layer as string, id: id as string };
    });
    let asLine = 0;
    for (let i = 0; i < 30 && (asLine = changedIn(await column([13, 46]), plain)) < 1; i++) await page.waitForTimeout(100);
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ selection: { kind: 'feature', id } }), made.id);
    await page.getByTestId('feature-panel').waitFor();
    // Drawn as a campaign arrow 40 wide, with chevrons flowing along it.
    await page.getByTestId('feature-look').selectOption('arrow');
    await page.getByTestId('feature-width').fill('40');
    await page.getByTestId('feature-flow').selectOption('chevrons');
    await page.getByTestId('feature-flow-speed').fill('120');
    await page.waitForFunction((id) => { const st = JSON.parse((window as any).__mapmaker.store.world.get('feature', id).style); return st.look === 'arrow' && st.width === 40 && st.flow === 'chevrons' && st.flowSpeed === 120; }, made.id);
    let asArrow = 0;
    for (let i = 0; i < 30 && (asArrow = changedIn(await column([13, 46]), plain)) < 10; i++) await page.waitForTimeout(100);
    assert.ok(asLine >= 1 && asLine <= 6, `a line is thin (${asLine} pixels across)`);
    assert.ok(asArrow >= 10 && asArrow >= 3 * asLine, `the arrow is broad along its path (${asArrow} pixels across, the line ${asLine})`);
    // Narrower near its tail than near its head; its head beyond its body.
    const nearTail = changedIn(await column([4, 46]), plainTail);
    assert.ok(nearTail < asArrow, `narrowing to its tail (${nearTail} against ${asArrow})`);
    await h.screenshot('route-campaign-arrow');
    // Still while world-building: the same picture a moment later.
    const still = await column([13, 46]);
    await page.waitForTimeout(400);
    assert.equal(changedIn(await column([13, 46]), still), 0, 'nothing moves while world-building');
    // In a shot (still camera, one date): the chevrons move along between frames, nothing else does.
    const shotId = await page.evaluate((c) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: c[0], lat: c[1], zoom: 2.5, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 2);
      settings.overlays = [];
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Routes', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    }, at);
    await page.waitForTimeout(500);
    /** A band of the preview along the arrow's body, and a patch well away from it. */
    const band = () => page.evaluate(() => {
      const m = (window as any).__mapmaker, c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      const a = m.previewToPage(8, 46), b = m.previewToPage(20, 46);
      const x0 = Math.round((a[0] - r.left) * k), x1 = Math.round((b[0] - r.left) * k), y = Math.round((a[1] - r.top) * k);
      const ctx = c.getContext('2d')!;
      return { along: Array.from(ctx.getImageData(x0, y - 3, x1 - x0, 7).data), away: Array.from(ctx.getImageData(x0, y - 120, x1 - x0, 20).data) };
    });
    const f0 = await band();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ shotFrame: 6, presentCamera: null }));
    let f6 = await band();
    for (let i = 0; i < 30 && changedIn(f6.along, f0.along) < 5; i++) { await page.waitForTimeout(100); f6 = await band(); }
    assert.ok(changedIn(f6.along, f0.along) >= 5, `the chevrons moved along the arrow between frames 1 and 7 (${changedIn(f6.along, f0.along)} pixels changed)`);
    assert.equal(changedIn(f6.away, f0.away), 0, 'nothing else moved');
    await h.screenshot('route-flowing');
    // Undone: the shot, the looks, the line and its layer (step by step, until the layer is gone).
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 15 && (await page.evaluate((l) => !!(window as any).__mapmaker.store.world.get('layer', l), made.layer)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((l) => !!(window as any).__mapmaker.store.world.get('layer', l), made.layer), false, 'the layer of lines is gone');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('sequence').some((q: any) => q.name === 'Routes')), false, 'and the shot');
    assert.ok(shotId && (await steps()) >= 0 && before >= 0);
  });

  await h.step('Text boxes and callouts: a text shown from half a second to one and a half; a callout pointing at a place clicked on the preview, its dot there; dragged; undone', async () => {
    await page.getByTestId('mode-world').click();
    // A short shot of one date (no title, no date).
    const shotId = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: 15, lat: 46, zoom: 2, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 2);
      settings.overlays = [];
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Texts', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    });
    await page.getByTestId('shot-editor').waitFor();
    const shotNow = () => page.evaluate((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings), shotId) as Promise<any>;
    // A text box: written, shown from 0.5 s to 1.5 s, coming in and going over a quarter of a second.
    await page.getByTestId('add-text-box').click();
    await page.getByTestId('text-box').waitFor();
    await page.getByTestId('text-box-text').fill('The drive begins');
    await page.getByTestId('text-box-text').blur();
    for (const [id, v] of [['text-box-from', '0.5'], ['text-box-to', '1.5'], ['text-box-seconds', '0.25']]) { await page.getByTestId(id).fill(v); await page.getByTestId(id).press('Enter'); }
    await page.waitForFunction((id) => { const o = JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).overlays.find((x: any) => x.box); return !!o && o.text === 'The drive begins' && o.box.timing.from === 0.5 && o.box.timing.to === 1.5 && o.box.seconds === 0.25; }, shotId);
    const textId = (await shotNow()).overlays.find((o: any) => o.box).id as string;
    const drawnAt = async (frame: number) => {
      await page.evaluate((f) => (window as any).__mapmaker.store.set({ shotFrame: f, presentCamera: null }), frame);
      await page.waitForTimeout(200);
      return (await page.evaluate(() => (window as any).__mapmaker.previewOverlays())) as Array<{ id: string; x: number; y: number; w: number; h: number }>;
    };
    assert.ok(!(await drawnAt(6)).some((r) => r.id === textId), 'not shown a quarter of a second in');
    assert.ok((await drawnAt(24)).some((r) => r.id === textId), 'shown at one second');
    assert.ok(!(await drawnAt(40)).some((r) => r.id === textId), 'gone at 1.7 seconds');
    // A callout: its place chosen with a click on the preview, its line and dot drawn there.
    await drawnAt(24);
    await page.getByTestId('add-callout').click();
    await page.getByTestId('callout-hint').waitFor();
    const place: LL = [20, 43];
    const at = (await page.evaluate(([lon, lat]) => (window as any).__mapmaker.previewToPage(lon, lat), place)) as [number, number];
    await page.mouse.click(at[0], at[1]);
    await page.waitForFunction(([id, lon, lat]) => {
      const o = JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).overlays.find((x: any) => x.box?.anchor);
      return !!o && Math.abs(o.box.anchor[0] - lon) < 0.6 && Math.abs(o.box.anchor[1] - lat) < 0.6;
    }, [shotId, place[0], place[1]] as const);
    assert.equal(await page.getByTestId('callout-hint').count(), 0, 'the click chose the place');
    const calloutId = (await shotNow()).overlays.find((o: any) => o.box?.anchor).id as string;
    const pixelAtPage = (p: [number, number]) => page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data).slice(0, 3);
    }, p);
    let dot = await pixelAtPage(at);
    for (let i = 0; i < 20 && Math.max(...dot.map((v, k) => Math.abs(v - [244, 239, 230][k]))) > 45; i++) { await page.waitForTimeout(100); dot = await pixelAtPage(at); }
    assert.ok(Math.max(...dot.map((v, k) => Math.abs(v - [244, 239, 230][k]))) <= 45, `the callout's dot at its place (${dot})`);
    const boxes = await drawnAt(24);
    const box = boxes.find((r) => r.id === calloutId)!;
    assert.ok(box, 'the callout\'s box is drawn');
    // The pointer: pixels between the box and the place are the text's colour somewhere along the line.
    const from = [Math.min(box.x + box.w, Math.max(box.x, at[0])), Math.min(box.y + box.h, Math.max(box.y, at[1]))];
    let lit = 0;
    for (let i = 2; i <= 8; i++) {
      const f = i / 10, px = await pixelAtPage([from[0] + (at[0] - from[0]) * f, from[1] + (at[1] - from[1]) * f]);
      if (Math.max(...px.map((v, k) => Math.abs(v - [244, 239, 230][k]))) <= 60) lit++;
    }
    assert.ok(lit >= 4, `a line from the box to the place (${lit} of 7 points on it)`);
    await h.screenshot('text-box-callout');
    // The callout's box dragged on the preview (one step).
    const x0 = (await shotNow()).overlays.find((o: any) => o.id === calloutId).x as number;
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w / 2 + 60, box.y + box.h / 2 + 10, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(([id, cid, x]) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).overlays.find((o: any) => o.id === cid).x > x + 0.02, [shotId, calloutId, x0] as const);
    // Undone: the drag, the callout, the text and the shot.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 15 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false, 'the shot is gone');
  });

  await h.step('Looks: a shot in the Atlas look (its sea in the preview and an exported frame), darker edges, then Parchment; the world-building view keeps its colours; undone', async () => {
    await page.getByTestId('mode-world').click();
    const sea: LL = [-40, 50];
    const shotId = await page.evaluate((c) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: c[0], lat: c[1], zoom: 2, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 1);
      settings.overlays = [];
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Looks', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    }, sea);
    await page.getByTestId('shot-editor').waitFor();
    const pixelAtPage = (p: [number, number]) => page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data).slice(0, 3);
    }, p);
    const pixelOf = async (ll: LL) => pixelAtPage((await page.evaluate(([lon, lat]) => (window as any).__mapmaker.previewToPage(lon, lat), ll)) as [number, number]);
    // A place of open sea in the shot (the countries drawn earlier cover some of the ocean).
    await page.waitForTimeout(300);
    let probe: LL | null = null;
    for (let dx = 0; dx <= 12 && !probe; dx += 4) for (let dy = -8; dy <= 8 && !probe; dy += 4) for (const sx of [1, -1]) {
      const c: LL = [sea[0] + sx * dx, sea[1] + dy];
      if (Math.max(...(await pixelOf(c)).map((v, k) => Math.abs(v - [20, 50, 74][k]))) <= 14) { probe = c; break; }
    }
    assert.ok(probe, 'a place of open sea in the shot');
    const centre = () => pixelOf(probe!);
    /** A pixel near the frame's top left corner (inside it). */
    const corner = async () => {
      // (The frame is letterboxed in the canvas.)
      const rect = (await page.evaluate(() => (window as any).__mapmaker.previewFrame())) as { x: number; y: number; w: number; h: number };
      return pixelAtPage([rect.x + 8, rect.y + 8]);
    };
    const dist = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));
    await page.waitForTimeout(300);
    const classicSea = await centre();
    assert.ok(dist(classicSea, [20, 50, 74]) <= 14, `the classic sea first (${classicSea})`);
    // Atlas: a light blue sea in the preview.
    await page.getByTestId('shot-look').selectOption('atlas');
    let atlas = await centre();
    for (let i = 0; i < 30 && dist(atlas, [168, 203, 224]) > 14; i++) { await page.waitForTimeout(100); atlas = await centre(); }
    assert.ok(dist(atlas, [168, 203, 224]) <= 14, `the Atlas sea (${atlas})`);
    // Darker edges: the corner darkens, the middle does not.
    const cornerBefore = await corner();
    await page.getByTestId('look-vignette').fill('1');
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).look?.vignette === 1, shotId);
    let cornerAfter = await corner();
    for (let i = 0; i < 30 && cornerAfter.reduce((a, b) => a + b, 0) > cornerBefore.reduce((a, b) => a + b, 0) - 60; i++) { await page.waitForTimeout(100); cornerAfter = await corner(); }
    assert.ok(cornerAfter.reduce((a, b) => a + b, 0) < cornerBefore.reduce((a, b) => a + b, 0) - 60, `the corner darker (${cornerAfter} against ${cornerBefore})`);
    assert.ok(dist(await centre(), atlas) <= 8, 'the middle as it was');
    // An exported frame in the same look: the sea at the same place, darker at its corner.
    const at = (await page.evaluate(([lon, lat]) => (window as any).__mapmaker.exportPixel(lon, lat, 0, 0.25), probe!)) as [number, number];
    const exported = await page.evaluate(([id, x, y]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const shot = JSON.parse(s.world.get('sequence', id).settings);
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 270;
      const ctx = canvas.getContext('2d')!;
      const renderer = new B.MapRenderer();
      renderer.quality = { ...B.EXPORT_QUALITY };
      B.renderFrame(ctx, renderer, s.world, s.engine, shot, 0, B.PASS_DEFS.find((d: any) => d.name === 'all'), 480, 270, null, null);
      const px = (a: number, b: number) => Array.from(ctx.getImageData(Math.round(a), Math.round(b), 1, 1).data).slice(0, 3);
      // (Drawn without the basemap, territories are not trimmed at the coast: the sea is looked for in the middle of the frame.)
      let sea = 0, n = 0;
      for (let gx = 120; gx <= 360; gx += 12) for (let gy = 70; gy <= 200; gy += 10) { n++; const p = px(gx, gy); if (Math.max(Math.abs(p[0] - 168), Math.abs(p[1] - 203), Math.abs(p[2] - 224)) <= 14) sea++; }
      return { sea: sea / n, corner: px(3, 3), probe: px(x, y) };
    }, [shotId, at[0], at[1]] as const);
    assert.ok(exported.sea > 0.1, `the exported frame's sea in the Atlas blue (${Math.round(exported.sea * 100)}% of the middle)`);
    assert.ok(exported.corner.reduce((a, b) => a + b, 0) < 168 + 203 + 224 - 100, `its corner darker (${exported.corner})`);
    await h.screenshot('look-atlas');
    // Parchment: a warm, pale sea (sepia over it), with paper.
    await page.getByTestId('shot-look').selectOption('parchment');
    let warm = await centre();
    for (let i = 0; i < 30 && !(warm[0] > warm[2] + 15 && dist(warm, atlas) > 25); i++) { await page.waitForTimeout(100); warm = await centre(); }
    assert.ok(warm[0] > warm[2] + 15 && dist(warm, atlas) > 25, `a warm parchment sea (${warm})`);
    await h.screenshot('look-parchment');
    // The world-building view keeps its own colours.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c[0], lat: c[1], zoom: 2, rotation: 0, projection: 'equirectangular' }), sea);
    await page.waitForTimeout(300);
    const worldSea = await page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, probe!);
    assert.ok(dist(worldSea, [20, 50, 74]) <= 14, `the working view's sea unchanged (${worldSea})`);
    // Undone: the looks and the shot.
    for (let i = 0; i < 10 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false, 'the shot is gone');
  });

  await h.step('Transition looks (D137): Blitz chosen in the shot editor sets every part of it and its preview plays; a slider makes the look the shot\'s own; the glow takes the owner\'s colour; Overland minds the land (D142); an event\'s own look from its panel; undone', async () => {
    await page.getByTestId('mode-world').click();
    const shotId = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: 0, lat: 20, zoom: 1, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 1);
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Transition looks', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    });
    await page.getByTestId('shot-editor').waitFor();
    const tr = () => page.evaluate((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).transitions ?? null, shotId);
    // The clean look to start with, ten to choose from.
    assert.equal(await page.getByTestId('transition-look').inputValue(), 'clean');
    assert.deepEqual(await page.getByTestId('transition-look').locator('option').allInnerTexts(), ['Clean', 'Minimal', 'Soft tide', 'Ink', 'Campaign', 'Blitz', 'Overland', 'In their colours', 'Dissolve', 'Fade', 'Custom (your own)']);
    // Blitz: every part of it set at once.
    await page.getByTestId('transition-look').selectOption('blitz');
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).transitions?.look === 'blitz', shotId);
    let t = await tr();
    assert.ok(t.roughness === 0.5 && t.wake === 0.7 && t.soft === 0.05 && t.easing === 'out' && t.front.show && t.front.glow === 26, `Blitz set (${JSON.stringify(t)})`);
    assert.match(await page.getByTestId('transition-look-note').innerText(), /hot white edge/);
    // Its preview plays: the sample at two moments differs.
    const preview = () => page.getByTestId('transition-preview').evaluate((c: HTMLCanvasElement) => c.toDataURL());
    await page.getByTestId('transition-preview').scrollIntoViewIfNeeded();
    const a = await preview();
    let b = a;
    for (let i = 0; i < 30 && b === a; i++) { await page.waitForTimeout(100); b = await preview(); }
    assert.notEqual(a, b, 'the preview plays');
    const coloured = await page.getByTestId('transition-preview').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let red = 0, blue = 0;
      // (The countries at the layer's opacity over the sea.)
      for (let i = 0; i < d.length; i += 16) { if (d[i] > 110 && d[i] > d[i + 2] + 50) red++; if (d[i + 2] > d[i] + 50) blue++; }
      return { red, blue };
    });
    assert.ok(coloured.red > 50, `the sample drawn (${JSON.stringify(coloured)})`);
    await h.screenshot('transition-look-blitz');
    // A slider: the look becomes the shot's own, the rest of Blitz kept.
    await page.getByTestId('transition-adjust').locator('summary').click();
    const soft = page.getByTestId('transition-soft');
    await soft.fill('40');
    await soft.evaluate((el: HTMLInputElement) => el.blur());
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).transitions?.soft === 0.4, shotId);
    t = await tr();
    assert.ok(t.look === 'custom' && t.wake === 0.7 && t.roughness === 0.5, `the shot's own look, the rest kept (${JSON.stringify(t)})`);
    assert.equal(await page.getByTestId('transition-look').inputValue(), 'custom');
    // The line and glow in the new owner's colour.
    await page.getByTestId('transition-front-colour').selectOption('auto');
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).transitions?.front.color === 'auto', shotId);
    // Overland: fronts that mind the land (D142); its preview shows the sample's mountains and plays on.
    await page.getByTestId('transition-look').selectOption('overland');
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).transitions?.look === 'overland', shotId);
    t = await tr();
    assert.ok(t.terrain === 0.8 && t.style === 'border', `Overland set (${JSON.stringify(t)})`);
    assert.match(await page.getByTestId('transition-look-note').innerText(), /minds the land/);
    const c0 = await preview();
    let c1 = c0;
    for (let i = 0; i < 30 && c1 === c0; i++) { await page.waitForTimeout(100); c1 = await preview(); }
    assert.notEqual(c0, c1, 'the preview plays in a look that minds the land');
    await h.screenshot('transition-look-overland');
    // How much, by its slider: the shot's own look again.
    const land = page.getByTestId('transition-terrain');
    await land.fill('30');
    await land.evaluate((el: HTMLInputElement) => el.blur());
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).transitions?.terrain === 0.3, shotId);
    assert.equal((await tr()).look, 'custom');
    // Choosing a look again sets every part of it.
    await page.getByTestId('transition-look').selectOption('clean');
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).transitions?.look === 'clean', shotId);
    t = await tr();
    assert.ok(t.soft === 0 && t.wake === 0 && t.roughness === 0 && t.terrain === 0 && t.front.color === '#ffe9a6', `clean again (${JSON.stringify(t)})`);
    // An event's own look, from its panel.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    const ev = await page.evaluate(() => {
      const s = (window as any).__mapmaker.store;
      const e = s.world.all('event').find((x: any) => x.id !== 'base' && x.type_id !== 'base');
      s.set({ selection: { kind: 'event', id: e.id } });
      return e.id as string;
    });
    await page.getByTestId('event-look').selectOption('ink');
    await page.waitForFunction((id) => (window as any).__mapmaker.store.world.get('event', id).presentation.includes('"look":"ink"'), ev);
    assert.deepEqual(await page.getByTestId('event-look').locator('option').first().innerText(), "As the shot's look");
    await page.getByTestId('event-look').selectOption('');
    await page.waitForFunction((id) => !(window as any).__mapmaker.store.world.get('event', id).presentation.includes('"look"'), ev);
    // Undone: the event's look, the shot's looks and the shot.
    for (let i = 0; i < 14 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false, 'the shot is gone');
    assert.ok(!(await page.evaluate((id) => (window as any).__mapmaker.store.world.get('event', id).presentation.includes('"look"'), ev)), 'the event as it was');
  });

  await h.step('Playing a shot: Play runs through its frames at its pace and stops at its end; Pause and the frame slider', async () => {
    await page.getByTestId('mode-world').click();
    const shotId = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: 10, lat: 48, zoom: 1, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 1.5);
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Playback', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    });
    await page.getByTestId('play').waitFor();
    const state = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; return { frame: s.shotFrame as number, playing: s.playing as boolean }; });
    const t0 = Date.now();
    await page.getByTestId('play').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.shotFrame >= 6);
    assert.equal((await state()).playing, true, 'playing');
    await page.waitForFunction(() => !(window as any).__mapmaker.store.playing, undefined, { timeout: 15000 });
    const end = await state(), took = (Date.now() - t0) / 1000;
    assert.equal(end.frame, 35, 'stopped on its last frame');
    assert.ok(took >= 1.2 && took < 8, `at about its pace (${took.toFixed(1)} s for 1.5 s)`);
    assert.match((await page.getByTestId('frame-info').textContent()) ?? '', /Frame 36 \/ 36/);
    // Played again from the start, paused part way.
    await page.getByTestId('play').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.shotFrame >= 4 && (window as any).__mapmaker.store.shotFrame < 30);
    await page.getByTestId('play').click();
    const paused = await state();
    assert.equal(paused.playing, false);
    await page.waitForTimeout(300);
    assert.equal((await state()).frame, paused.frame, 'paused where it was');
    // The slider goes to a frame.
    await page.getByTestId('frame-slider').fill('12');
    assert.equal((await state()).frame, 12);
    // Undone.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 4 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
  });

  await h.step('TIFF sequences: a shot exported as ZIP-compressed TIFF files with straight alpha, read back at the preview size; undone', async () => {
    await page.getByTestId('mode-world').click();
    const shotId = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: 10, lat: 48, zoom: 2, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 0.25);
      settings.transparent = true;
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Tiff', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    });
    await page.getByTestId('shot-editor').waitFor();
    await page.getByTestId('export-format').selectOption('tiff-zip');
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).format === 'tiff-zip', shotId);
    assert.match((await page.getByTestId('export-format-note').textContent()) ?? '', /ZIP/);
    await page.getByTestId('export-preview').click();
    await page.getByTestId('export-result').waitFor({ timeout: 300000 });
    const dir = ((await page.locator('[data-testid=export-result] .path').textContent()) ?? '').trim();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    assert.match(manifest.alpha, /TIFF/);
    const files = readdirSync(join(dir, 'all')).sort();
    assert.equal(files.length, 6, `six frames (${files.join(', ')})`);
    assert.ok(files.every((f) => f.endsWith('.tif')), 'TIFF files');
    const { decodeTiff } = await import('../src/export/tiff.ts');
    const { inflateSync } = await import('node:zlib');
    const t = await decodeTiff(new Uint8Array(readFileSync(join(dir, 'all', files[0]))), async (d) => new Uint8Array(inflateSync(d)));
    assert.equal(t.compression, 8, 'ZIP');
    assert.deepEqual([t.width, t.height], [480, 270], 'a quarter of 1920 x 1080');
    let clear = 0, solid = 0;
    for (let i = 3; i < t.rgba.length; i += 4) { if (t.rgba[i] === 0) clear++; else if (t.rgba[i] === 255) solid++; }
    assert.ok(clear > 0 && solid > 0, `transparent and painted pixels both kept (${clear} clear, ${solid} solid)`);
    assert.match(readFileSync(join(dir, 'COMPOSITING_GUIDE.txt'), 'utf8'), /Alpha: straight \(the TIFF files say so\)/);
    // Undone: the format and the shot.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 5 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false);
  });

  await h.step('SVG frames: the frame shown saved as an SVG file; territories, borders, names and texts as shapes and text in their layers; drawn by the browser it is the exported frame; undone', async () => {
    await page.getByTestId('mode-world').click();
    const shotId = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: 10, lat: 48, zoom: 2.2, rotation: 8, projection: 'equirectangular' }, s.time, s.time, 24, 0.5);
      settings.width = 960; settings.height = 540; settings.labels = true;
      settings.overlays.push(B.newTextBox(settings, 'A frame for print'));
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Vector frame', settings));
      s.set({ shotId: id, shotFrame: 3, presentCamera: null, mode: 'present' });
      return id as string;
    });
    await page.getByTestId('shot-editor').waitFor();
    assert.match((await page.getByTestId('export-svg').textContent()) ?? '', /Save frame 4 as SVG/);
    await page.getByTestId('export-svg').click();
    await page.getByTestId('svg-result').waitFor({ timeout: 120000 });
    const file = ((await page.locator('[data-testid=svg-result] .path').textContent()) ?? '').trim();
    assert.match(file, /Vector_frame_frame000004\.svg$/);
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* width="960" height="540" viewBox="0 0 960 540">/);
    // Layers as drawing programs show them, bottom first: pictures of the sea and land, then shapes and text.
    const order = ['background', 'territories-1', 'borders-1', 'labels', 'texts'].map((id) => svg.indexOf(`<g id="${id}" inkscape:groupmode="layer"`));
    assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `the layers in order (${order})`);
    const names = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.world.all('entity').map((e: any) => e.name); }) as string[];
    const territories = [...svg.matchAll(/<path id="territory-[^"]+" inkscape:label="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(territories.length >= 2 && territories.every((n) => names.includes(n.replace(/&amp;/g, '&'))), `countries as named shapes (${territories.slice(0, 6).join(', ')})`);
    // Their names as text (a halo and the name itself).
    const labels = svg.slice(svg.indexOf('<g id="labels"'), svg.indexOf('<g id="texts"'));
    const written = [...labels.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]);
    assert.ok(territories.some((n) => written.includes(n)), `names as text (${[...new Set(written)].slice(0, 6).join(', ')})`);
    assert.match(svg.slice(svg.indexOf('<g id="texts"')), />A frame for print<\/text>/);
    // The browser draws the file as the frame is exported.
    const cmp = await page.evaluate(async ([text, id]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const shot = JSON.parse(s.world.get('sequence', id).settings);
      const c = document.createElement('canvas'); c.width = 960; c.height = 540;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      B.renderFrame(ctx, new B.MapRenderer(), s.world, s.engine, shot, 3, B.PASS_DEFS.find((d: any) => d.name === 'all'), 960, 540, s.basemap, null);
      const a = ctx.getImageData(0, 0, 960, 540).data;
      const img = new Image();
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })); });
      ctx.clearRect(0, 0, 960, 540);
      ctx.drawImage(img, 0, 0);
      const b = ctx.getImageData(0, 0, 960, 540).data;
      let off = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) off++;
      return off / (a.length / 4);
    }, [svg, shotId] as const);
    assert.ok(cmp < 0.02, `the SVG drawn is the frame (${(cmp * 100).toFixed(2)}% of pixels apart)`);
    // Undone: the shot.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 5 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false);
  });

  await h.step('Videos: a shot exported as an MP4 (H.264) and a WebM (VP9) file; every frame there at the frame rate, the pictures of the PNG frames; a size beyond H.264 refused before it starts; undone', async () => {
    await page.getByTestId('mode-world').click();
    const shotId = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: 10, lat: 48, zoom: 2.2, rotation: 0, projection: 'equirectangular' }, B.gregorian.fromCivil({ year: 1450 }), B.gregorian.fromCivil({ year: 1950 }), 24, 1);
      settings.transparent = true;
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Timelapse', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    });
    await page.getByTestId('shot-editor').waitFor();
    // The PNG frames to compare with (opaque, as a video is).
    await page.evaluate((id) => { const m = (window as any).__mapmaker, s = m.store; const st = JSON.parse(s.world.get('sequence', id).settings); s.execute((w: any) => m.bench.commands.updateSequence(w, id, { settings: { ...st, transparent: false } })); }, shotId);
    const png = await exportShot('export-preview');
    const frames = png.frames('all');
    assert.equal(frames.length, 24);
    const ffprobe = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
    for (const fmt of ['mp4', 'webm'] as const) {
      await page.getByTestId('export-format').selectOption(fmt);
      await page.getByTestId('video-passes-note').waitFor();
      await page.getByTestId('export-video-quality').selectOption('best');
      await page.getByTestId('export-video-check').waitFor();
      const check = (await page.getByTestId('export-video-check').textContent()) ?? '';
      assert.match(check, fmt === 'mp4' ? /1920 x 1080, 12 Mbit\/s, encoded by this computer \(avc1\.64/ : /1920 x 1080, 12 Mbit\/s, encoded by this computer \(vp09\.00\.40\.08\)/);
      await page.getByTestId('export-preview').click();
      await page.waitForFunction((ext) => (document.querySelector('[data-testid=export-video-file]')?.textContent ?? '').trim().endsWith(ext), `.${fmt}`, { timeout: 300000 });
      const file = ((await page.getByTestId('export-video-file').textContent()) ?? '').trim();
      assert.match(file, fmt === 'mp4' ? /Timelapse_preview\.mp4$/ : /Timelapse_preview\.webm$/);
      const bytes = readFileSync(file);
      const dir = join(file, '..');
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.video.bytes, bytes.length);
      assert.equal(manifest.video.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.match(manifest.video.codec, fmt === 'mp4' ? /^avc1\./ : /^vp09\./);
      assert.deepEqual(manifest.resolution, [480, 270]);
      assert.equal(manifest.transparentBackground, false, 'a video has no transparency');
      assert.match(readFileSync(join(dir, 'README.txt'), 'utf8'), fmt === 'mp4' ? /480 x 270 at 24 fps, 24 frames \(1\.00 s\), H\.264 in MP4/ : /VP9 in WebM/);
      // The browser plays it: its size and length, and frames at the start, middle and end are the PNG frames.
      const pick = [0, 12, 23];
      const r = await page.evaluate(async ({ b64, refs, type, pick }) => {
        const toBlob = (t: string, kind: string) => new Blob([Uint8Array.from(atob(t), (c) => c.charCodeAt(0))], { type: kind });
        const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(toBlob(b64, type));
        await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error(`the video does not play: ${v.error?.message}`)); });
        const c = new OffscreenCanvas(v.videoWidth, v.videoHeight), x = c.getContext('2d', { willReadFrequently: true })!;
        const diffs: Array<{ mean: number; far: number }> = [];
        for (const [k, f] of pick.entries()) {
          const shown = new Promise((ok) => { (v as any).requestVideoFrameCallback(() => ok(0)); setTimeout(ok, 1500); });
          v.currentTime = (f + 0.5) / 24;
          await new Promise((ok) => { v.onseeked = ok; });
          await shown;
          x.drawImage(v, 0, 0);
          const a = x.getImageData(0, 0, c.width, c.height).data;
          const img = await createImageBitmap(toBlob(refs[k], 'image/png'), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          x.clearRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0);
          const b = x.getImageData(0, 0, c.width, c.height).data;
          let sum = 0, far = 0;
          for (let i = 0; i < a.length; i += 4) for (let q = 0; q < 3; q++) { const d = Math.abs(a[i + q] - b[i + q]); sum += d; if (d > 40) far++; }
          diffs.push({ mean: sum / (a.length * 0.75), far: far / (a.length * 0.75) });
        }
        return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, diffs };
      }, { b64: bytes.toString('base64'), refs: pick.map((i) => readFileSync(frames[i]).toString('base64')), type: fmt === 'mp4' ? 'video/mp4' : 'video/webm', pick });
      assert.deepEqual([r.width, r.height], [480, 270]);
      assert.ok(Math.abs(r.duration - 1) < 1 / 24, `one second long (${r.duration})`);
      for (const [k, d] of r.diffs.entries()) assert.ok(d.mean < 4 && d.far < 0.02, `frame ${pick[k]} is the PNG frame, as closely as a video keeps it (${d.mean.toFixed(2)} levels on average, ${(d.far * 100).toFixed(2)}% far apart)`);
      // (Read by FFmpeg as well, where it is installed: every frame, at the frame rate.)
      if (ffprobe) {
        const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames,r_frame_rate', '-of', 'json', file]).toString()).streams[0];
        assert.deepEqual([p.codec_name, Number(p.nb_read_frames), p.r_frame_rate], [fmt === 'mp4' ? 'h264' : 'vp9', 24, '24/1']);
      } else console.log('    (FFmpeg is not installed: the video was checked by the browser only)');
    }
    // Too large for H.264: refused before anything is written, with the way out.
    await page.getByTestId('export-format').selectOption('mp4');
    await page.evaluate((id) => { const m = (window as any).__mapmaker, s = m.store; const st = JSON.parse(s.world.get('sequence', id).settings); s.execute((w: any) => m.bench.commands.updateSequence(w, id, { settings: { ...st, width: 16384, height: 16384 } })); }, shotId);
    await page.waitForFunction(() => /H\.264 does not go up to 16384 x 16384/.test(document.querySelector('[data-testid=export-video-check]')?.textContent ?? ''));
    assert.equal(await page.getByTestId('export-full').isDisabled(), true);
    // Undone: the shot.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 12 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false);
  });

  await h.step('Each layer on its own: a shot exported as one pass per layer; each painted exactly where its layer holds land, clear elsewhere', async () => {
    await page.getByTestId('mode-world').click();
    const setup = await page.evaluate(([a, b, out]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      // (In their order, bottom first, as the passes are written.)
      const layers = s.world.all('layer').filter((l: any) => l.space_id === s.spaceId && l.kind === 'partition' && l.visible).sort((a: any, b: any) => a.sort_order - b.sort_order).map((l: any) => ({ id: l.id, name: l.name }));
      const t = B.gregorian.fromCivil({ year: 1760 });
      const owner = (id: string, p: number[]) => { const f = s.world.arrangement(s.spaceId).locate(B.lonLatToVec(p[0], p[1])); return s.engine.partitionState(s.spaceId, id, t).get(f)?.value ?? null; };
      // Framed on both countries: the closest zoom that still shows both well inside the frame.
      let cam = { lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, zoom: 0, rotation: 0, projection: 'equirectangular' };
      for (let z = 4; z >= 0; z -= 0.25) {
        const v = B.makeView({ ...cam, zoom: z }, 960, 540);
        if ([a, b].every((p) => { const q = v.projection(p); return q && q[0] > 80 && q[0] < 880 && q[1] > 60 && q[1] < 480; })) { cam = { ...cam, zoom: z }; break; }
      }
      const styleOf = (id: string) => { try { return JSON.parse(s.world.get('layer', id).style || '{}') ?? {}; } catch { return {}; } };
      const clips = layers.map((l: any) => styleOf(l.id).clipToLand ?? null);
      const settings = B.defaultShot(s.spaceId, cam, t, t, 24, 0.25);
      settings.width = 960; settings.height = 540; settings.labels = false; settings.cities = false; settings.graticule = false;
      settings.overlays = [];
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Layers apart', settings));
      // (The test's places are out at sea: layers that end at the coast cover the sea for this, undone below.)
      for (const l of layers) if (styleOf(l.id).clipToLand !== false) s.execute((w: any) => B.commands.setLayerClipToLand(w, l.id, false));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      const v = B.makeView(cam, 960, 540);
      return { shotId: id, clips, layers: layers.map((l: any) => ({ ...l, held: [a, b, out].map((p) => !!owner(l.id, p)) })), px: [a, b, out].map((p) => v.projection(p)) };
    }, [P.a, P.b, P.out] as const) as { shotId: string; clips: Array<boolean | null>; layers: Array<{ id: string; name: string; held: boolean[] }>; px: Array<[number, number]> };
    assert.ok(setup.layers.length >= 2, `two territory layers or more (${setup.layers.map((l) => l.name).join(', ')})`);
    await page.getByTestId('shot-editor').waitFor();
    await page.getByTestId('pass-all').uncheck();
    for (const l of setup.layers) await page.getByTestId(`pass-layer-${l.name}`).check();
    const r = await exportShot('export-full');
    assert.deepEqual(r.manifest.passes.map((p: any) => p.label), setup.layers.map((l) => `Layer: ${l.name}`), 'one pass per layer, bottom first');
    // (The most opaque pixel around each place: a layer drawn with stripes leaves gaps between them.)
    const inFrame = setup.px.map(([x, y]) => x >= 6 && y >= 6 && x < 954 && y < 534);
    assert.ok(inFrame[0] && inFrame[1], `both countries in the frame (${JSON.stringify(setup.px)})`);
    for (const l of setup.layers) {
      const img = readPNG(r.frames(`layer-${l.id}`)[0]);
      const alpha = setup.px.map(([x, y], k) => { if (!inFrame[k]) return null; let m = 0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) m = Math.max(m, pixel(img, x + dx, y + dy)[3]); return m; });
      assert.deepEqual(alpha.map((a, k) => (a === null ? null : a > 0)), l.held.map((h, k) => (inFrame[k] ? h : null)), `${l.name}: painted where it holds land (${alpha.join(', ')})`);
    }
    // Undone: the choice of passes, the layers covering the sea and the shot.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 12 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), setup.shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), setup.shotId), false);
    const clips = await page.evaluate((ids) => ids.map((id) => JSON.parse((window as any).__mapmaker.store.world.get('layer', id).style || '{}')?.clipToLand ?? null), setup.layers.map((l) => l.id));
    assert.deepEqual(clips, setup.clips, 'each layer ends at the coast as before');
  });

  await h.step('A shot on the globe (D127): the projection chosen, the preview dragged to turn the planet, set turning on its own, exported as frames and as an SVG frame; undone', async () => {
    await page.getByTestId('mode-world').click();
    const shotId = await page.evaluate(([a]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: a[0], lat: a[1], zoom: 0.3, rotation: 0, projection: 'equirectangular' }, B.gregorian.fromCivil({ year: 1760 }), B.gregorian.fromCivil({ year: 1760 }), 24, 0.25);
      settings.transparent = false;
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Round', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    }, [P.a] as const);
    await page.getByTestId('shot-editor').waitFor();
    await page.getByLabel('Projection').selectOption('globe');
    const cam = () => page.evaluate((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).camera[0].camera, shotId) as Promise<{ lon: number; lat: number; projection: string }>;
    assert.equal((await cam()).projection, 'globe');
    await page.waitForFunction(() => !!(window as any).__mapmaker.store.renderer.lastGlobe);
    await h.screenshot('globe-shot');
    // Dragged to the left, the planet turns: the middle moves east.
    const before = await cam();
    const box = (await page.getByTestId('map-canvas').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx - i * 20, cy);
    await page.mouse.up();
    await page.waitForFunction(([id, lon]) => {
      const s = (window as any).__mapmaker.store, c = s.presentCamera ?? JSON.parse(s.world.get('sequence', id).settings).camera[0].camera;
      return ((c.lon - lon + 540) % 360) - 180 > 5;
    }, [shotId, before.lon] as const);
    // Turning on its own, 30 degrees a second as the Earth turns: a second in, the middle 30 degrees further west.
    await page.getByTestId('globe-spin').fill('30');
    await page.getByTestId('globe-spin').press('Enter');
    const turned = await page.evaluate((id) => {
      const m = (window as any).__mapmaker, s = m.store, st = JSON.parse(s.world.get('sequence', id).settings);
      return { spin: st.spin, fps: st.fps, lon0: m.bench.cameraAt(st, 0).lon, lon1: m.bench.cameraAt(st, st.fps).lon };
    }, shotId);
    assert.equal(turned.spin, 30);
    assert.ok(Math.abs(((turned.lon0 - turned.lon1 - 30 + 540) % 360) - 180) < 1e-6, `a second in, 30 degrees further west (${turned.lon0} then ${turned.lon1})`);
    // Frames: the globe in the middle, space round it.
    const r = await exportShot('export-preview');
    const img = readPNG(r.frames('all')[0]);
    const mid = pixel(img, Math.floor(img.width / 2), Math.floor(img.height / 2)), corner = pixel(img, 2, 2);
    assert.equal(mid[3], 255, 'the globe in the middle');
    assert.ok(corner[3] === 255 && corner[0] + corner[1] + corner[2] < 80, `space round it (${corner})`);
    // An SVG frame: the globe as pictures, the date as text.
    await page.getByTestId('export-svg').click();
    await page.getByTestId('svg-result').waitFor({ timeout: 120000 });
    const svg = readFileSync(((await page.locator('[data-testid=svg-result] .path').textContent()) ?? '').trim(), 'utf8');
    assert.match(svg, /<g id="globe" inkscape:groupmode="layer"/);
    assert.ok(/<text/.test(svg) && svg.includes('1760'), 'the date as text');
    // Undone: the shot.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null, presentCamera: null }));
    for (let i = 0; i < 12 && (await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId)); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false);
  });

  await h.step('A star map: the stars within 50 light-years in three dimensions; a star chosen and its panel; turned, zoomed and centred; star systems held by a country from a date; a lane between two stars; a shot of it exported; back to Earth', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-stars').check();
    await page.getByTestId('new-map-stars-note').waitFor();
    await page.getByTestId('new-map-name').fill('Nearby stars');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return s.world.get('map_space', s.spaceId)?.kind === 'space'; });
    // The stars drawn: the Sun in the middle, Alpha Centauri somewhere around it.
    await page.waitForFunction(() => !!(window as any).__mapmaker.starToPage(71456));
    const hook = <T,>(name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as any).__mapmaker[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
    const sun = await hook<[number, number]>('starToPage', 0), middle = await hook<[number, number]>('spaceMiddle');
    assert.ok(Math.hypot(sun[0] - middle[0], sun[1] - middle[1]) < 1, `the Sun in the middle (${sun} against ${middle})`);
    assert.match((await page.getByTestId('space-note').textContent()) ?? '', /\d{3} stars within 50 light-years/);
    const names = await page.evaluate(() => (window as any).__mapmaker.spaceNames() as string[]);
    assert.ok(names.includes('Sirius') && names.includes('Sol'), `named stars written (${names.slice(0, 8).join(', ')}…)`);
    // Planets of other stars (D118): counted on the map, found by name, listed in their star's panel.
    await page.waitForFunction(() => /\d+ with known planets/.test(document.querySelector('[data-testid=space-note]')?.textContent ?? ''));
    await page.getByTestId('search').fill('proxima b');
    await page.getByTestId('search-result').filter({ hasText: 'Proxima Centauri b' }).first().click();
    await page.getByTestId('star-panel').waitFor();
    assert.equal(await page.getByTestId('star-name').textContent(), 'Proxima Centauri');
    assert.match((await page.getByTestId('star-planets').textContent()) ?? '', /Proxima Centauri b · round its star in 11\.2 days/);
    await page.getByTestId('space-home').click();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    // A click on a star: its panel.
    const acen = await hook<[number, number]>('starToPage', 71456);
    await page.mouse.click(acen[0], acen[1]);
    await page.getByTestId('star-panel').waitFor();
    assert.match((await page.getByTestId('star-name').textContent()) ?? '', /Rigil Kentaurus|Toliman/);
    assert.match((await page.getByTestId('star-distance').textContent()) ?? '', /^4\.3\d light-years$/);
    await h.screenshot('star-map');
    // Dragged: the view turns around the Sun (it stays in the middle; Alpha Centauri moves).
    await page.mouse.move(middle[0] + 150, middle[1] + 120);
    await page.mouse.down();
    await page.mouse.move(middle[0] + 250, middle[1] + 160, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const turned = await hook<[number, number]>('starToPage', 71456), sun2 = await hook<[number, number]>('starToPage', 0);
    assert.ok(Math.hypot(sun2[0] - middle[0], sun2[1] - middle[1]) < 1, 'the Sun still in the middle');
    assert.ok(Math.hypot(turned[0] - acen[0], turned[1] - acen[1]) > 3, `Alpha Centauri moved as the view turned (${acen} to ${turned})`);
    // Zoomed in: farther from the middle.
    const proxima0 = await hook<[number, number]>('starToPage', 70666);
    await page.mouse.move(middle[0], middle[1]);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(200);
    const proxima1 = await hook<[number, number]>('starToPage', 70666);
    assert.ok(Math.hypot(proxima1[0] - middle[0], proxima1[1] - middle[1]) > 1.5 * Math.hypot(proxima0[0] - middle[0], proxima0[1] - middle[1]), 'zooming in spreads the stars out');
    // The view turned around the star chosen.
    await page.getByTestId('star-centre').click();
    await page.waitForTimeout(200);
    const centred = await hook<[number, number]>('starToPage', (await page.evaluate(() => (window as any).__mapmaker.store.selection.id)) as number);
    assert.ok(Math.hypot(centred[0] - middle[0], centred[1] - middle[1]) < 1, 'the chosen star in the middle');
    await page.getByTestId('space-home').click();
    // Star systems held over time (D111): Alpha Centauri given to a new country from 2150, with the tool.
    await h.newCountry('Terran Union');
    const terra = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Terran Union').id as string);
    await h.setDate('2150');
    await page.getByTestId('tool-systems').click();
    await page.getByTestId('systems-owner').selectOption(terra);
    assert.match((await page.getByTestId('systems-hint').textContent()) ?? '', /held by Terran Union from/);
    await page.waitForTimeout(200);
    const acenNow = await hook<[number, number]>('starToPage', 71456);
    const ringBefore = await page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 14, Math.round((y - r.top) * k) - 14, 29, 29).data);
    }, acenNow);
    await page.mouse.click(acenNow[0], acenNow[1]);
    await page.waitForFunction(([id]) => { const s = (window as any).__mapmaker.store; return s.engine.systemsAt(s.spaceId, s.time).get(71456) === id; }, [terra] as const);
    await page.getByTestId('star-holder').waitFor();
    assert.match((await page.getByTestId('star-holder').textContent()) ?? '', /Terran Union/);
    // Its realm glows around it in the country's colour.
    const ringAfter = await page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 14, Math.round((y - r.top) * k) - 14, 29, 29).data);
    }, acenNow);
    let tinted = 0;
    for (let i = 0; i < ringAfter.length; i += 4) if (Math.max(Math.abs(ringAfter[i] - ringBefore[i]), Math.abs(ringAfter[i + 1] - ringBefore[i + 1]), Math.abs(ringAfter[i + 2] - ringBefore[i + 2])) > 12) tinted++;
    assert.ok(tinted > 40, `the realm drawn around Alpha Centauri (${tinted} pixels changed)`);
    // Not before 2150.
    await h.setDate('2149');
    await page.waitForTimeout(150);
    assert.match((await page.getByTestId('star-holder').textContent()) ?? '', /Nobody/);
    await h.setDate('2150');
    // A box with Ctrl around the Sun: every star in it given at once (one undo step).
    const held0 = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.engine.systemsAt(s.spaceId, s.time).size as number; });
    const sunAt = await hook<[number, number]>('starToPage', 0);
    await page.keyboard.down('Control');
    await page.mouse.move(sunAt[0] - 40, sunAt[1] - 40);
    await page.mouse.down();
    await page.mouse.move(sunAt[0] + 40, sunAt[1] + 40, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForFunction((n) => { const s = (window as any).__mapmaker.store; return s.engine.systemsAt(s.spaceId, s.time).size > n + 2; }, held0);
    // Only the stars in the box (the Sun is a system of its own, not of every single star).
    const held1 = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.engine.systemsAt(s.spaceId, s.time).size as number; });
    assert.ok(held1 < held0 + 120, `the stars in the box, not all of them (${held1 - held0} given)`);
    await h.screenshot('star-map-realm');
    // A lane from the Sun to Alpha Centauri with the Lanes tool (D112): a star, then another.
    await page.getByTestId('tool-lanes').click();
    await page.getByTestId('lanes-owner').selectOption(terra);
    assert.match((await page.getByTestId('lanes-hint').textContent()) ?? '', /Click a star, then another/);
    const sunP = await hook<[number, number]>('starToPage', 0), acenP = await hook<[number, number]>('starToPage', 71456);
    await page.mouse.click(sunP[0], sunP[1]);
    await page.mouse.click(acenP[0], acenP[1]);
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return s.engine.lanesAt(s.spaceId, s.time).some((l: any) => l.a === 0 && l.b === 71456 && l.progress === 1); });
    await page.getByTestId('star-lane').first().waitFor();
    assert.match((await page.getByTestId('star-lane').first().textContent()) ?? '', /to Sol.*Terran Union/);
    await page.getByTestId('tool-select').click();
    // A shot of the star map, exported: a frame of stars (the Sun bright in its middle).
    const frame = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, s.camera, s.time, s.time, 24, 2);
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Stars', settings));
      const shot = JSON.parse(s.world.get('sequence', id).settings);
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      B.renderFrame(ctx, new B.MapRenderer(), s.world, s.engine, shot, 0, B.PASS_DEFS.find((d: any) => d.name === 'all'), 640, 360, null, null);
      const d = ctx.getImageData(0, 0, 640, 360).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 450) bright++;
      const mid = Array.from(ctx.getImageData(320, 180, 1, 1).data).slice(0, 3);
      // The separate layers: the realms in the territory fills, the lane in the areas and lines. The
      // stars were given at the shot's first moment: their realm grows in over its first second or so.
      const painted = (pass: string, f: number) => {
        B.renderFrame(ctx, new B.MapRenderer(), s.world, s.engine, shot, f, B.PASS_DEFS.find((d: any) => d.name === pass), 640, 360, null, null);
        const px = ctx.getImageData(0, 0, 640, 360).data;
        let n = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 30) n++;
        return n;
      };
      const last = shot.frames - 1;
      return { id: id as string, bright, mid, growing: painted('fills', 6), realms: painted('fills', last), lanes: painted('features', last), labels: painted('labels', last) };
    });
    assert.ok(frame.bright > 200, `stars in the exported frame (${frame.bright} bright pixels)`);
    assert.ok(frame.realms > 200 && frame.lanes > 5 && frame.labels > 200, `realms, lanes and names in their own layers (${frame.realms}, ${frame.lanes}, ${frame.labels} pixels)`);
    assert.ok(frame.growing < frame.realms * 0.8, `the realm grows in (${frame.growing} pixels at a quarter of a second, ${frame.realms} at the end)`);
    assert.ok(frame.mid.reduce((a, b) => a + b, 0) > 600, `the Sun in its middle (${frame.mid})`);
    // Back to Earth; the shot and the star map undone.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return s.world.get('map_space', s.spaceId)?.kind === 'sphere'; });
    for (let i = 0; i < 10 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false, 'the star map undone');
    assert.ok(frame.id);
  });

  await h.step('The solar system: the planets where they are on the date viewed, moving as the date changes; true or compressed distances; a planet\'s panel; side by side, a planet held and its holder over it; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-solar').check();
    await page.getByTestId('new-map-solar-note').waitFor();
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; const m = s.world.get('map_space', s.spaceId); return m?.kind === 'space' && JSON.parse(m.settings).space.catalogue === 'solar'; });
    await h.setDate('1 January 2030');
    await page.waitForFunction(() => !!(window as any).__mapmaker.starToPage(3));
    const hook = <T,>(name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as any).__mapmaker[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
    const middle = await hook<[number, number]>('spaceMiddle');
    const sun = await hook<[number, number]>('starToPage', 0);
    assert.ok(Math.hypot(sun[0] - middle[0], sun[1] - middle[1]) < 1, 'the Sun in the middle');
    const names = await page.evaluate(() => (window as any).__mapmaker.spaceNames() as string[]);
    const named = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].filter((n) => names.includes(n));
    assert.ok(named.length >= 7 && names.includes('Jupiter') && names.includes('Neptune'), `the planets named (${names.join(', ')})`);
    assert.match((await page.getByTestId('space-note').textContent()) ?? '', /The Sun and the planets on 1 January 2030/);
    // Half a year on, the Earth is on the other side of the Sun; Neptune has hardly moved.
    const earth0 = await hook<[number, number]>('starToPage', 3), neptune0 = await hook<[number, number]>('starToPage', 8);
    await h.setDate('1 July 2030');
    await page.waitForTimeout(200);
    const earth1 = await hook<[number, number]>('starToPage', 3), neptune1 = await hook<[number, number]>('starToPage', 8);
    const side = (p: [number, number]) => [p[0] - middle[0], p[1] - middle[1]];
    const [a, b] = [side(earth0), side(earth1)];
    assert.ok(a[0] * b[0] + a[1] * b[1] < 0, `the Earth across the Sun after half a year (${earth0} to ${earth1})`);
    assert.ok(Math.hypot(neptune1[0] - neptune0[0], neptune1[1] - neptune0[1]) < Math.hypot(earth1[0] - earth0[0], earth1[1] - earth0[1]) / 5, 'Neptune hardly moved');
    await h.screenshot('solar-system');
    // True to scale: the inner planets close in round the Sun.
    const marsCompressed = await hook<[number, number]>('starToPage', 4);
    await page.getByTestId('solar-scale').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.scale === 'true'; });
    await page.waitForTimeout(200);
    const marsTrue = await hook<[number, number]>('starToPage', 4);
    assert.ok(Math.hypot(marsTrue[0] - middle[0], marsTrue[1] - middle[1]) < Math.hypot(marsCompressed[0] - middle[0], marsCompressed[1] - middle[1]) * 0.6, 'Mars nearer the Sun when true to scale');
    // Mars's panel: its distance from the Sun on the date viewed.
    await page.getByTestId('solar-scale').click();
    await page.waitForTimeout(200);
    const mars = await hook<[number, number]>('starToPage', 4);
    await page.mouse.click(mars[0], mars[1]);
    await page.getByTestId('star-panel').waitFor();
    assert.equal(await page.getByTestId('star-name').textContent(), 'Mars');
    assert.match((await page.getByTestId('star-distance').textContent()) ?? '', /^1\.\d\d au \([\d,]+ million km\) on 1 July 2030$/);
    // The large moons (D117): not shown from afar; found by search, and round Jupiter close in.
    assert.ok(!(await page.evaluate(() => (window as any).__mapmaker.spaceNames() as string[])).includes('Io'), 'no moons from afar');
    await page.getByTestId('search').fill('ganymede');
    await page.getByTestId('search-result').filter({ hasText: 'Ganymede' }).first().click();
    await page.getByTestId('star-panel').waitFor();
    assert.equal(await page.getByTestId('star-kind').textContent(), 'Moon of Jupiter');
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, zoom: 4.2 }); });
    await page.waitForFunction(() => ['Io', 'Europa', 'Callisto'].every((n) => ((window as any).__mapmaker.spaceNames() as string[]).includes(n)));
    await h.screenshot('jupiter-moons');
    // Side by side (D133): the Sun at the left, the planets in a row at even steps, the Moon below the Earth.
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: null }); s.setCamera({ ...s.camera, zoom: 0, rotation: 0, target: undefined }); });
    await page.getByTestId('solar-layout').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.layout === 'side-by-side'; });
    await page.waitForTimeout(200);
    assert.equal(await page.getByTestId('solar-scale').count(), 0, 'no choice of scale side by side');
    const row = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 31].map((id) => hook<[number, number]>('starToPage', id)));
    const step = row[2][0] - row[1][0];
    for (let i = 1; i <= 9; i++) {
      assert.ok(Math.abs(row[i][1] - row[0][1]) < 1, `body ${i} in the row`);
      assert.ok(Math.abs(row[i][0] - row[i - 1][0] - step) < 1, `body ${i} a step on (${row[i][0] - row[i - 1][0]} against ${step})`);
    }
    assert.ok(step > 40, `room between them (${step} pixels)`);
    assert.ok(Math.abs(row[10][0] - row[3][0]) < 1 && row[10][1] > row[3][1] + 15, 'the Moon below the Earth');
    assert.ok((await page.evaluate(() => (window as any).__mapmaker.spaceNames() as string[])).includes('Io'), 'moons named side by side');
    // Mars held from the date viewed: its holder's name over it, and since when.
    await h.newCountry('Martian Republic');
    const mars2 = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === 'Martian Republic').id as string);
    await page.getByTestId('tool-systems').click();
    await page.getByTestId('systems-owner').selectOption(mars2);
    await page.mouse.click(row[4][0], row[4][1]);
    await page.waitForFunction(([id]) => { const s = (window as any).__mapmaker.store; return s.engine.systemsAt(s.spaceId, s.time).get(4) === id; }, [mars2] as const);
    await page.getByTestId('tool-select').click();
    await page.waitForFunction(() => { const n = (window as any).__mapmaker.spaceNames() as string[]; return n.includes('MARTIAN REPUBLIC') && n.includes('since 2030'); });
    await h.screenshot('solar-side-by-side');
    // Back to the orbits.
    await page.getByTestId('solar-layout').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.layout === 'orbits'; });
    await page.getByTestId('solar-scale').waitFor();
    // Undone; back to Earth.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    for (let i = 0; i < 14 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('An invented star map: stars of one\'s own from a seed, made again from the next seed; found by search; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-invented').check();
    await page.getByTestId('new-map-invented-note').waitFor();
    await page.getByTestId('new-map-invented-count').fill('150');
    await page.getByTestId('new-map-invented-seed').fill('5');
    await page.getByTestId('new-map-name').fill('The Reach');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.waitForFunction(() => /150 invented stars within 50 light-years · seed 5/.test(document.querySelector('[data-testid=space-note]')?.textContent ?? ''));
    await page.waitForFunction(() => !!(window as any).__mapmaker.starToPage(1));
    const first = (await page.evaluate(() => (window as any).__mapmaker.starToPage(1))) as [number, number];
    // Found by its name in the search box, chosen, the view turned round it.
    const name = (await page.evaluate(() => (window as any).__mapmaker.spaceNames().find((n: string) => n !== 'Sol' && !/^KX-/.test(n)))) as string;
    await page.getByTestId('search').fill(name);
    await page.getByTestId('search-result').filter({ hasText: name }).first().click();
    await page.getByTestId('star-panel').waitFor();
    assert.equal(await page.getByTestId('star-name').textContent(), name);
    await h.screenshot('invented-stars');
    // Other stars from the next seed.
    await page.getByTestId('invented-again').click();
    await page.waitForFunction(() => /seed 6/.test(document.querySelector('[data-testid=space-note]')?.textContent ?? ''));
    await page.getByTestId('space-home').click();
    await page.waitForTimeout(200);
    const other = (await page.evaluate(() => (window as any).__mapmaker.starToPage(1))) as [number, number];
    assert.ok(Math.hypot(other[0] - first[0], other[1] - first[1]) > 2, 'other stars');
    // Undone; back to Earth.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    for (let i = 0; i < 6 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('The Milky Way: the whole galaxy, its arms and places; the Orion Nebula found and its panel; star systems held in a box by a country; a frame of it; another galaxy of one\'s own; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-milkyway').check();
    assert.match((await page.getByTestId('new-map-galaxy-note').textContent()) ?? '', /33 places/);
    await page.getByTestId('new-map-galaxy-systems').fill('400');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.waitForFunction(() => /The Milky Way · 400 star systems and 33 places · rings every 10,000 ly/.test(document.querySelector('[data-testid=space-note]')?.textContent ?? ''));
    // The galaxy's glow: its middle bright, the dark sky beyond its edge.
    await page.waitForFunction(() => !!(window as any).__mapmaker.starToPage(1));
    const mid = (await page.evaluate(() => (window as any).__mapmaker.starToPage(1))) as [number, number];
    const glow = await page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      const at = (px: number, py: number) => { const d = c.getContext('2d')!.getImageData(Math.round((px - r.left) * k), Math.round((py - r.top) * k), 1, 1).data; return d[0] + d[1] + d[2]; };
      return { middle: at(x + 6, y + 6), sky: at(r.left + 12, r.top + 12) };
    }, mid);
    assert.ok(glow.middle > 300 && glow.sky < 60, `bright in the middle, dark sky (${glow.middle}, ${glow.sky})`);
    await h.screenshot('milky-way');
    // A place found by search: its kind and distances.
    await page.getByTestId('search').fill('orion nebula');
    await page.getByTestId('search-result').filter({ hasText: 'Orion Nebula' }).first().click();
    await page.getByTestId('star-panel').waitFor();
    assert.equal(await page.getByTestId('star-kind').textContent(), 'Nebula');
    assert.match((await page.getByTestId('star-distance').textContent()) ?? '', /1,344 light-years/);
    // Star systems given to a country with the Star systems tool and a box.
    await page.getByTestId('space-home').click();
    const empire = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.execute((w: any) => (window as any).__mapmaker.bench.commands.createEntity(w, { type_id: 'polity', name: 'Galactic Empire', color: '#c0392b' })); });
    await page.getByTestId('tool-systems').click();
    await page.getByTestId('systems-owner').selectOption(empire);
    const sun = (await page.evaluate(() => (window as any).__mapmaker.starToPage(0))) as [number, number];
    await page.keyboard.down('Control');
    await page.mouse.move(sun[0] - 70, sun[1] - 70);
    await page.mouse.down();
    await page.mouse.move(sun[0] + 70, sun[1] + 70, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return s.engine.systemsAt(s.spaceId, s.time).size >= 3; });
    const held = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.engine.systemsAt(s.spaceId, s.time).size as number; });
    assert.ok(held < 433 / 2, `the systems in the box, not all of them (${held} of 433)`);
    await page.getByTestId('tool-select').click();
    await h.screenshot('milky-way-realm');
    // A frame of it: the glow and the realm in their layers.
    const frame = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, s.camera, s.time, s.time, 24, 2);
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Galaxy', settings));
      const shot = JSON.parse(s.world.get('sequence', id).settings);
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      const painted = (pass: string) => {
        B.renderFrame(ctx, new B.MapRenderer(), s.world, s.engine, shot, shot.frames - 1, B.PASS_DEFS.find((d: any) => d.name === pass), 640, 360, null, null);
        const px = ctx.getImageData(0, 0, 640, 360).data;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 30 && px[i] + px[i + 1] + px[i + 2] > 120) n++;
        return n;
      };
      return { all: painted('all'), realms: painted('fills') };
    });
    assert.ok(frame.all > 3000 && frame.realms > 50, `the galaxy and its realm in the frame (${frame.all}, ${frame.realms})`);
    // A galaxy of one's own: two arms.
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-galaxy').check();
    await page.getByTestId('new-map-galaxy-arms').fill('2');
    await page.getByTestId('new-map-galaxy-seed').fill('3');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.waitForFunction(() => /A galaxy of your own · 600 star systems/.test(document.querySelector('[data-testid=space-note]')?.textContent ?? ''));
    await page.getByTestId('galaxy-again').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.galaxy.seed === 4; });
    await h.screenshot('galaxy-own');
    // Undone; back to Earth.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    for (let i = 0; i < 10 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('How the stars look (D130, D131, D132): presets from their pictures, any part changed, a look by chance; the map as a flat chart, moved and turned; realms as territories, a front where two at war meet; stars twinkling in a shot, an SVG frame of it; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-stars').check();
    await page.getByTestId('new-map-name').fill('Looks');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.waitForFunction(() => !!(window as any).__mapmaker.starToPage(71456));
    const hook = <T,>(name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as any).__mapmaker[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
    const look = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look ?? null; });
    // Two realms side by side from 2300: the Sun's and Alpha Centauri's (blue and green).
    await h.setDate('2300');
    await h.newCountry('Solar Compact');
    await h.newCountry('Centauri Free State');
    await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, C = m.bench.commands, mode = { kind: 'change', t: s.time };
      const id = (n: string) => s.world.all('entity').find((e: any) => e.name === n).id;
      s.execute((w: any) => C.updateEntity(w, id('Solar Compact'), { color: '#3a7bd5' }));
      s.execute((w: any) => C.updateEntity(w, id('Centauri Free State'), { color: '#2bb673' }));
      s.execute((w: any) => C.holdStars(w, { spaceId: s.spaceId, stars: [0], entity: id('Solar Compact'), mode, label: 'the Sun' }));
      s.execute((w: any) => C.holdStars(w, { spaceId: s.spaceId, stars: [71456, 71453, 70666], entity: id('Centauri Free State'), mode, label: 'Alpha Centauri' }));
      s.set({ selection: null });
    });
    // As a flat chart (D131), with the button on the map: the Sun in the middle, Alpha Centauri (3.1 light-years
    // toward the galactic centre, 3.0 the other way along the plane) to the right and as far down.
    await page.getByTestId('space-chart').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look?.chart === true; });
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, zoom: 1, rotation: 0, target: undefined }); });
    await page.waitForTimeout(200);
    const middle = await hook<[number, number]>('spaceMiddle'), sun = await hook<[number, number]>('starToPage', 0), acen = await hook<[number, number]>('starToPage', 71456);
    assert.ok(Math.hypot(sun[0] - middle[0], sun[1] - middle[1]) < 1, 'the Sun in the middle');
    const dx = acen[0] - sun[0], dy = acen[1] - sun[1];
    assert.ok(dx > 20 && dy > 20 && Math.abs(dx / dy - 3.093 / 3.015) < 0.03, `Alpha Centauri right and down, as far each way (${dx}, ${dy})`);
    // The realms meet between the two (nearer the Sun: three stars reach out from Alpha Centauri): their border
    // there, in the two colours mixed. Looked for along the line between them, and a little to each side.
    const along = () => page.evaluate(([a, b]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, out: number[] = [];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      for (let t = 0.15; t <= 0.85; t += 0.25 / len) for (let o = -4; o <= 4; o++) {
        const x = Math.round((a[0] + (b[0] - a[0]) * t + nx * o - r.left) * k), y = Math.round((a[1] + (b[1] - a[1]) * t + ny * o - r.top) * k), i = (y * c.width + x) * 4;
        out.push(img[i], img[i + 1], img[i + 2], 255);
      }
      return out;
    }, [sun, acen] as const);
    const fronts = (px: number[]) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 190 && px[i] - px[i + 1] > 80 && px[i + 2] < 120) n++; return n; };
    const peace = await along();
    assert.equal(fronts(peace), 0, 'no front in peace');
    let mixed = 0;
    for (let i = 0; i < peace.length; i += 4) if (peace[i + 1] > peace[i] + 40 && peace[i + 2] > peace[i] + 40 && peace[i + 1] > 100) mixed++;
    assert.ok(mixed > 8, `their border between them (${mixed} pixels)`);
    // At war (from the realm's panel): the border between them a front.
    await page.locator('.left .row', { hasText: 'Solar Compact' }).first().click();
    await page.getByTestId('entity-panel').waitFor();
    await page.getByTestId('relation-new').click();
    await page.getByTestId('relation-kind').selectOption({ label: 'at war with' });
    await page.getByTestId('relation-other').selectOption({ label: 'Centauri Free State' });
    await page.getByTestId('relation-add').click();
    await page.getByTestId('relation-row').waitFor();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.waitForTimeout(250);
    const war = fronts(await along());
    assert.ok(war > 8, `a front where they meet (${war} pixels)`);
    // The realms' names written over them.
    const names = await page.evaluate(() => (window as any).__mapmaker.spaceNames() as string[]);
    assert.ok(names.includes('Sol'), 'star names still written');
    await h.screenshot('stars-chart-front');
    // Moved with a drag (on a chart a drag moves it); turned with a right-drag round its middle.
    await page.mouse.move(middle[0] + 120, middle[1] + 90);
    await page.mouse.down();
    await page.mouse.move(middle[0] + 160, middle[1] + 70, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const sun2 = await hook<[number, number]>('starToPage', 0);
    assert.ok(Math.abs(sun2[0] - sun[0] - 40) < 1.5 && Math.abs(sun2[1] - sun[1] + 20) < 1.5, `moved with the pointer (${sun} to ${sun2})`);
    await page.mouse.move(middle[0] + 200, middle[1]);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(middle[0], middle[1] + 200, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(150);
    const rot = await page.evaluate(() => (window as any).__mapmaker.store.camera.rotation as number);
    assert.ok(Math.abs(rot - 90) < 2, `turned a quarter of the way round (${rot})`);
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, rotation: 0, target: undefined }); });
    // How the stars look: the presets, each shown as a small picture of stars.
    await page.getByTestId('space-look').click();
    await page.getByTestId('sky-look-dialog').waitFor();
    assert.ok((await page.locator('[data-testid^=sky-preset-]').count()) >= 15);
    const patch = (at: [number, number], r: number) => page.evaluate(([x, y, r]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, b = c.getBoundingClientRect(), k = c.width / b.width;
      const w = Math.round(2 * r * k);
      return Array.from(c.getContext('2d')!.getImageData(Math.round((x - b.left - r) * k), Math.round((y - b.top - r) * k), w, w).data);
    }, [at[0], at[1], r] as const);
    const before = await patch(sun, 30);
    await page.getByTestId('sky-preset-neon').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look?.preset === 'neon'; });
    let l = await look();
    assert.equal(l.colours, 'vivid');
    assert.equal(l.chart, true, 'a look\'s preset keeps the map a chart');
    assert.match((await page.getByTestId('undo').getAttribute('title')) ?? '', /Stars: Neon/);
    await page.waitForTimeout(150);
    const after = await patch(sun, 30);
    let changed = 0;
    for (let i = 0; i < after.length; i += 4) if (Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1]) + Math.abs(after[i + 2] - before[i + 2]) > 40) changed++;
    assert.ok(changed > 200, `drawn in the new look (${changed} pixels)`);
    // Any part of it: the stars' shape and spikes; then a look by chance, undone in one step.
    await page.getByTestId('sky-shape').selectOption('diamond');
    await page.getByTestId('sky-spikes').selectOption('4');
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; const l = JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look; return l.shape === 'diamond' && l.spikes === 4; });
    await page.getByTestId('sky-surprise').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look.preset === 'surprise'; });
    await page.getByTestId('undo').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; const l = JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look; return l.preset === 'neon' && l.shape === 'diamond'; });
    // Stars twinkling, as far as they can (the slider to its end).
    await page.getByTestId('sky-twinkle').focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look.twinkle === 1; });
    await page.getByTestId('sky-3d').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look.chart === false; });
    await h.screenshot('stars-look-dialog');
    await page.getByTestId('sky-close').click();
    // A shot of a still moment: its frames differ only by the stars' twinkling; an SVG frame of it, the realms' borders as lines.
    const shotOut = await page.evaluate(async () => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, s.camera, s.time, s.time, 24, 2);
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Twinkling', settings));
      const shot = JSON.parse(s.world.get('sequence', id).settings);
      const frame = (f: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        B.renderFrame(ctx, new B.MapRenderer(), s.world, s.engine, shot, f, B.PASS_DEFS.find((d: any) => d.name === 'all'), 640, 360, null, null);
        return ctx.getImageData(0, 0, 640, 360).data;
      };
      const a = frame(0), b = frame(9), c = frame(0);
      let differ = 0, same = true;
      for (let i = 0; i < a.length; i += 4) { if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) differ++; if (a[i] !== c[i]) same = false; }
      const svg = await B.svgFrame({ world: s.world, engine: s.engine, shot, shotName: 'Twinkling', frame: 0, scale: 0.5 });
      return { differ, same, paths: (svg.svg.match(/<path/g) ?? []).length, skipped: svg.skipped };
    });
    assert.ok(shotOut.differ > 30, `stars twinkle from frame to frame (${shotOut.differ} pixels)`);
    assert.ok(shotOut.same, 'the same frame drawn twice is the same picture');
    assert.ok(shotOut.paths > 0, `an SVG frame with its lines (${shotOut.paths} paths, skipped: ${shotOut.skipped.join(', ')})`);
    // Undone; back to Earth.
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    for (let i = 0; i < 30 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('The Earth through geological time (D134): made from the New map dialog; Pangaea 250 million years ago, its moment named; dates as how long ago; the seas of the last ice age lower, more land; a frame of it exported; undone', async () => {
    await page.getByTestId('mode-world').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-paleo').check();
    assert.match((await page.getByTestId('new-map-paleo-note').textContent()) ?? '', /540 million years ago to today/);
    await page.getByRole('button', { name: 'Create map' }).click();
    // At Pangaea, its moment named; the timeline over all of deep time.
    await page.waitForFunction(() => /250 million years ago · Permo-Triassic Boundary/.test(document.querySelector('[data-testid=paleo-note]')?.textContent ?? ''));
    assert.equal(await page.getByTestId('current-date').inputValue(), '250 million years ago');
    assert.ok(await page.evaluate(() => (window as any).__mapmaker.store.timeline.start < -5e8), 'the timeline reaches 540 million years back');
    // Land and sea as they were: the cells PALEOMAP has highest and deepest then, drawn as land and as sea.
    const colours = (when: string) => page.evaluate((when) => {
      const m = (window as any).__mapmaker, s = m.store;
      const t = m.bench.gregorian.parse(when).instant, g = s.terrainOf(s.world.get('map_space', s.spaceId), t).grid;
      let hi = 0, lo = 0;
      for (let k = 0; k < g.data.length; k++) { if (g.data[k] > g.data[hi]) hi = k; if (g.data[k] < g.data[lo]) lo = k; }
      const ll = (k: number) => [-180 + ((k % g.width) + 0.5) * (360 / g.width), 90 - (Math.floor(k / g.width) + 0.5) * (180 / g.height)];
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width, ctx = c.getContext('2d')!;
      const px = (lonlat: number[]) => { const p = m.lonLatToPage(lonlat[0], lonlat[1]); return p ? Array.from(ctx.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data) : null; };
      return { land: px(ll(hi)), sea: px(ll(lo)) };
    }, when);
    const pangaea = await colours('250 Ma');
    assert.ok(pangaea.sea && pangaea.sea[2] > pangaea.sea[0] + 20, `the deepest sea drawn blue (${pangaea.sea})`);
    assert.ok(pangaea.land && pangaea.land[0] + pangaea.land[1] > pangaea.sea![0] + pangaea.sea![1] + 60, `the highest land drawn as land (${pangaea.land})`);
    await h.screenshot('paleo-pangaea');
    // Dates read and written as how long ago; the seas of the last ice age: lower, so more of the map is land.
    const seaShare = () => page.evaluate(() => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let sea = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i + 2] > d[i] + 25 && d[i + 2] >= d[i + 1]) sea++;
      return sea / (d.length / 16);
    });
    await h.setDate('2000');
    await page.waitForFunction(() => /Holocene/.test(document.querySelector('[data-testid=paleo-note]')?.textContent ?? ''));
    await page.waitForTimeout(300);
    const today = await seaShare();
    await h.setDate('21 ka');
    await page.waitForFunction(() => /21,000 years ago · Pleistocene, the Last Glacial Maximum · the sea 130 m lower than today/.test(document.querySelector('[data-testid=paleo-note]')?.textContent ?? ''));
    assert.equal(await page.getByTestId('current-date').inputValue(), '21,000 years ago');
    await page.waitForTimeout(300);
    const iceAge = await seaShare();
    assert.ok(iceAge < today - 0.004, `less sea 21,000 years ago (${(iceAge * 100).toFixed(1)}% of the picture against ${(today * 100).toFixed(1)}%)`);
    await h.screenshot('paleo-ice-age');
    // Frames of shots, as exported: each drawn at its own moment (today's Earth, the Cretaceous, Pangaea differ).
    const frames = await page.evaluate(async () => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const ground = await B.terrainFor(s.world, s.spaceId);
      const draw = (when: string) => {
        const t = B.gregorian.parse(when).instant;
        const shot = B.defaultShot(s.spaceId, { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equirectangular' }, t, t, 24, 1);
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 320;
        const ctx = canvas.getContext('2d')!;
        B.renderFrame(ctx, new B.MapRenderer(), s.world, s.engine, shot, 0, B.PASS_DEFS.find((d: any) => d.name === 'all'), 640, 320, null, ground);
        return Array.from(ctx.getImageData(0, 0, 640, 320).data);
      };
      const sea = (d: number[]) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 25 && d[i + 2] >= d[i + 1]) n++; return n / (d.length / 4); };
      const differ = (a: number[], b: number[]) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++; return n / (a.length / 4); };
      const now = draw('2000'), cretaceous = draw('100 Ma'), pangaea = draw('250 Ma');
      return { sea: [sea(now), sea(cretaceous), sea(pangaea)], d1: differ(now, cretaceous), d2: differ(cretaceous, pangaea) };
    });
    assert.ok(frames.sea.every((x) => x > 0.45 && x < 0.85), `mostly sea at every moment (${frames.sea.map((x) => x.toFixed(2))})`);
    assert.ok(frames.d1 > 0.05 && frames.d2 > 0.05, `each moment its own Earth (${frames.d1.toFixed(3)}, ${frames.d2.toFixed(3)} of the picture differs)`);
    // Undone; back to Earth.
    await page.locator('header select').first().selectOption({ label: 'Earth' });
    for (let i = 0; i < 8 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => JSON.parse(m.settings).paleo))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => JSON.parse(m.settings).paleo)), false);
    await h.setDate('1900');
  });

  await h.step('Playing history: the date moves on at the speed chosen, pauses where it is, Space plays and pauses, going round at the end; the date shown stays still as it changes', async () => {
    await page.getByTestId('mode-world').click();
    const year = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.time.day / 365.2425 + 1970; }) as Promise<number>;
    const was = await page.evaluate(() => (window as any).__mapmaker.store.time);
    await h.setDate('1 January 1800');
    await page.getByTestId('history-speed').selectOption('100');
    await page.getByTestId('history-play').click();
    await page.waitForTimeout(600);
    const a = await year();
    await page.waitForTimeout(400);
    const b = await year();
    assert.ok(a > 1820 && b > a + 15, `history plays on at 100 years a second (${a.toFixed(1)}, then ${b.toFixed(1)})`);
    await page.getByTestId('history-play').click();
    const c = await year();
    await page.waitForTimeout(300);
    assert.equal(await year(), c, 'paused where it was');
    // Space plays and pauses (not while typing).
    await page.locator('body').press('Space');
    await page.waitForTimeout(300);
    assert.ok((await year()) > c + 10, 'Space plays');
    await page.locator('body').press('Space');
    const d = await year();
    await page.waitForTimeout(250);
    assert.equal(await year(), d, 'and pauses');
    // Going round: from near the end of the timeline back to its beginning.
    const span = await page.evaluate(() => (window as any).__mapmaker.store.timeline) as { start: number; end: number };
    await page.evaluate((y) => { const s = (window as any).__mapmaker.store; s.setTime({ day: Math.round((y - 1970) * 365.2425), ms: 0 }); }, span.end - 5);
    await page.getByTestId('history-loop').click();
    await page.getByTestId('history-play').click();
    await page.waitForFunction((st) => { const s = (window as any).__mapmaker.store; const y = s.time.day / 365.2425 + 1970; return y < st + 60; }, span.start, { timeout: 5000 });
    await page.getByTestId('history-play').click();
    await page.getByTestId('history-loop').click();
    // The date shown stays still as it changes: the day's and the year's digits keep their places
    // (a short month and a long one, a one-digit day and a two-digit one), and while playing no time of day.
    const placed = async (date: string) => {
      await page.evaluate((d) => { const s = (window as any).__mapmaker.store, B = (window as any).__mapmaker.bench; s.setTime(B.gregorian.parse(d).instant); }, date);
      await page.getByTestId('steady-date').waitFor();
      return page.evaluate(() => {
        const r = (sel: string) => document.querySelector(`[data-testid=steady-date] ${sel} .sd-text`)!.getBoundingClientRect();
        return { dayRight: r('.sd-day').right, yearRight: r('.sd-year').right, year: document.querySelector('[data-testid=steady-date] .sd-year .sd-text')!.textContent };
      });
    };
    const p1 = await placed('1 May 1833'), p2 = await placed('28 September 1866');
    assert.ok(Math.abs(p1.dayRight - p2.dayRight) < 0.5 && Math.abs(p1.yearRight - p2.yearRight) < 0.5, `the day and the year stay where they are (${JSON.stringify([p1, p2])})`);
    await page.evaluate(() => (window as any).__mapmaker.store.setTime({ day: -40000, ms: 3_600_000 * 5 }));
    await page.getByTestId('history-play').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-testid=steady-date] .sd-time').count(), 0, 'no time of day while playing');
    await page.getByTestId('history-play').click();
    // Leaving world-building stops it.
    await page.getByTestId('history-play').click();
    await page.getByTestId('mode-present').click();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.historyPlay.on), false);
    await page.getByTestId('mode-world').click();
    await page.evaluate((t) => (window as any).__mapmaker.store.setTime(t), was);
  });

  await h.step('Importing borders: two GeoJSON maps of their years; their dates from the names; the first the starting map, the second the changes at its date; countries going on by name; a shot of the whole history in one click; undone', async () => {
    await page.getByTestId('mode-world').click();
    const box = (w: number, so: number, e: number, n: number) => [[w, so], [e, so], [e, n], [w, n], [w, so]];
    const map = (features: Array<[string, number[][]]>) => JSON.stringify({ type: 'FeatureCollection', features: features.map(([name, ring]) => ({ type: 'Feature', properties: { NAME: name, POP: 1 }, geometry: { type: 'Polygon', coordinates: [ring] } })) });
    await page.getByTestId('open-import-borders').click();
    await page.getByTestId('import-borders').waitFor();
    await page.getByTestId('import-borders-files').setInputFiles([
      { name: 'isles_1750.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(map([['Kingdom of Wester', box(-150, -50, -140, -40)], ['Easter Isles', box(-140, -50, -130, -40)]])) },
      { name: 'isles_1720.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(map([['Kingdom of Wester', box(-150, -50, -145, -40)], ['Easter Isles', box(-145, -50, -130, -40)]])) },
    ]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=import-borders-file]').length === 2);
    // Sorted by their years (from the names), the first the starting map; names from NAME.
    const rows = await page.getByTestId('import-borders-file').allTextContents();
    assert.match(rows[0], /isles_1720\.geojson.*the starting map/);
    assert.match(rows[1], /isles_1750\.geojson/);
    assert.equal(await page.getByTestId('import-borders-name').inputValue(), 'NAME');
    assert.match((await page.getByTestId('import-borders-summary').textContent()) ?? '', /isles_1720\.geojson: 2 countries/);
    await page.getByTestId('import-borders-go').click();
    await page.getByTestId('import-borders').waitFor({ state: 'detached', timeout: 60000 });
    const owners = (lon: number, lat: number, years: number[]) => page.evaluate(([lon, lat, years]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const f = s.world.arrangement(s.spaceId).locate(B.lonLatToVec(lon, lat));
      return (years as number[]).map((y) => { const v = s.engine.partitionState(s.spaceId, s.layerId, B.gregorian.fromCivil({ year: y })).get(f)?.value; return v ? s.world.get('entity', v).name : null; });
    }, [lon, lat, years] as const) as Promise<Array<string | null>>;
    assert.deepEqual(await owners(-142, -45, [1600, 1760]), ['Easter Isles', 'Kingdom of Wester'], 'Wester takes the middle from 1750');
    assert.deepEqual(await owners(-148, -45, [1600, 1760]), ['Kingdom of Wester', 'Kingdom of Wester']);
    assert.deepEqual(await owners(-135, -45, [1600, 1760]), ['Easter Isles', 'Easter Isles']);
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').filter((e: any) => e.name === 'Kingdom of Wester').length), 1, 'one country going on');
    await h.screenshot('import-borders');
    // A shot of the whole history in one click: from the first change to the last (a little either side), at an
    // even pace, the year counting up, every change animated; then taken away again.
    await page.getByTestId('mode-present').click();
    await page.getByTestId('new-shot-history').click();
    await page.getByTestId('shot-editor').waitFor();
    const whole = await page.evaluate(() => {
      const s = (window as any).__mapmaker.store;
      const row = s.world.get('sequence', s.shotId), st = JSON.parse(row.settings);
      const times = s.engine.changeInstants().filter((t: any) => Number.isFinite(t.day));
      return { name: row.name, from: st.time[0].at[0], to: st.time[st.time.length - 1].at[0], ease: [...new Set(st.time.map((k: any) => k.ease))], mode: st.transitions.mode, frames: st.frames, fps: st.fps, precision: st.overlays.find((o: any) => o.kind === 'date').datePrecision, first: times[0].day, last: times[times.length - 1].day };
    });
    assert.equal(whole.name, 'Whole history');
    assert.ok(whole.from < whole.first && whole.first - whole.from <= Math.max(30, (whole.last - whole.first) * 0.02) + 1, 'from just before the first change');
    assert.ok(whole.to > whole.last && whole.to - whole.last <= Math.max(30, (whole.last - whole.first) * 0.02) + 1, 'to just after the last');
    assert.deepEqual([whole.ease, whole.mode, whole.precision, whole.fps], [['linear'], 'all', 'year', 24]);
    const years = (whole.to - whole.from) / 365.2425;
    assert.equal(whole.frames, Math.max(2, Math.round(24 * Math.max(10, Math.min(120, years / 8)))), `a second for every eight years (${years.toFixed(0)} years in ${whole.frames} frames)`);
    await page.getByTestId('undo').click();
    await h.saved();
    await page.getByTestId('mode-world').click();
    // Undone: one step for each map.
    for (let i = 0; i < 2; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').some((e: any) => e.name === 'Kingdom of Wester')), false);
  });

  await h.step('Importing a dataset that dates each shape: its from and to properties found, the history at once (a country splitting, another only for a while), one undo step', async () => {
    await page.getByTestId('mode-world').click();
    const box = (w: number, so: number, e: number, n: number) => [[w, so], [e, so], [e, n], [w, n], [w, so]];
    const shapes: Array<[string, string, string, number[][]]> = [
      ['Old Wester', '1886-01-01', '1918-11-11', box(-150, -60, -130, -52)],
      ['Old Wester', '1918-11-12', '', box(-150, -60, -140, -52)],
      ['New Easter', '1918-11-12', '', box(-140, -60, -130, -52)],
      ['Brief Norther', '1950', '1990', box(-150, -50, -130, -46)],
    ];
    const text = JSON.stringify({ type: 'FeatureCollection', features: shapes.map(([name, from, to, ring]) => ({ type: 'Feature', properties: { CNTRY_NAME: name, GWSDATE: from, GWEDATE: to }, geometry: { type: 'Polygon', coordinates: [ring] } })) });
    await page.getByTestId('open-import-borders').click();
    await page.getByTestId('import-borders').waitFor();
    await page.getByTestId('import-borders-files').setInputFiles([{ name: 'cshapes-like.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(text) }]);
    await page.getByTestId('import-borders-dated').waitFor();
    assert.equal(await page.getByTestId('import-borders-dated').isChecked(), true, 'its dates found and used');
    assert.equal(await page.getByTestId('import-borders-from').inputValue(), 'GWSDATE');
    assert.equal(await page.getByTestId('import-borders-to').inputValue(), 'GWEDATE');
    assert.match((await page.getByTestId('import-borders-summary').textContent()) ?? '', /4 dated shapes of 3 countries, from 1 January 1886/);
    await page.getByTestId('import-borders-go').click();
    await page.getByTestId('import-borders').waitFor({ state: 'detached', timeout: 60000 });
    const owners = (lon: number, lat: number, years: number[]) => page.evaluate(([lon, lat, years]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const f = s.world.arrangement(s.spaceId).locate(B.lonLatToVec(lon, lat));
      return (years as number[]).map((y) => { const v = s.engine.partitionState(s.spaceId, s.layerId, B.gregorian.fromCivil({ year: y })).get(f)?.value; return v ? s.world.get('entity', v).name : null; });
    }, [lon, lat, years] as const) as Promise<Array<string | null>>;
    assert.deepEqual(await owners(-135, -56, [1800, 1910, 1930]), ['Old Wester', 'Old Wester', 'New Easter'], 'split in 1918; the earliest shapes the starting map');
    assert.deepEqual(await owners(-145, -56, [1800, 2020]), ['Old Wester', 'Old Wester']);
    assert.deepEqual(await owners(-140, -48, [1940, 1960, 1991]), [null, 'Brief Norther', null], 'there from 1950 to the end of 1990');
    // One undo step for the whole dataset.
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').some((e: any) => e.name === 'Old Wester' || e.name === 'New Easter')), false);
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
