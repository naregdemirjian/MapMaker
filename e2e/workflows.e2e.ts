// Second interface test: the workflows the first test does not cover, and a close inspection of
// exported files. Run after building: node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { encodePNG } from '../src/export/png.ts';
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
    // Three layers, three features, listed under "Areas, lines and points"; nobody's land changed.
    assert.equal(await page.getByTestId('feature-row').count(), 3);
    assert.equal(await h.ownerAt(P.b, '1900'), A, 'the land under them is untouched');
    // With Select, a click on the battle chooses it.
    await page.getByTestId('tool-select').click();
    await page.mouse.click(pb[0] - 40, pb[1] + 10);
    await page.getByTestId('feature-panel').waitFor();
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
  });

  await h.step('A shot framed in the preview (still camera, reset) at 2.39:1 and 25 fps; inspect every exported pass', async () => {
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
