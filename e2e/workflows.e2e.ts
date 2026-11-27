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
    // (A new project has no map yet: its first is chosen in Map Studio's gallery, D235. Drawn on in History.)
    await page.getByTestId('new-map-earth').check();
    await page.getByTestId('new-map-create').click();
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-canvas').waitFor();
    // These countries are drawn over the Atlantic: keep their territory over the sea
    // (coastline clipping is checked in the vertical-slice test).
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
    await page.getByTestId('clip-to-land').uncheck();
    // "Correct this period" applies from the date being viewed: the countries exist from 1400 on.
    await h.setDate('1400');
    await h.newCountry(A);
    await h.chooseTool('polygon');
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
    await h.chooseTool('lasso');
    const { cx, cy } = await h.centre();
    await h.drawLasso(blob(cx + 200, cy, 110, 90));
    await page.getByTestId('choice-correct').click();
    // (Space applies, as Enter does.)
    await page.getByTestId('confirm-edit').focus();
    await page.getByTestId('confirm-edit').evaluate((b) => (b as HTMLElement).blur());
    await page.keyboard.press('Space');
    await page.getByTestId('confirm-edit').waitFor({ state: 'detached' });
    P.b = await h.toLL([cx + 220, cy]);
    await h.waitOwner(P.b, '1500', B);
    // A custom layer for military control.
    // Named in the app's own dialog (the desktop app has no browser prompt).
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('new-layer-name').fill('Military control');
    await page.getByTestId('new-layer-name').press('Enter');
    await page.locator('.list-panel .row', { hasText: 'Military control' }).getByText('drawing here').waitFor();
    // Base: everyone controls their own land; then B occupies part of A in 1700.
    await h.chooseTool('lasso');
    await page.getByTestId('paint-owner').selectOption({ label: A });
    await h.drawLasso(blob(cx - 80, cy, 170, 130));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Occupation of the west');
    await page.getByTestId('event-start').fill('1700');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-create').click();
    await h.chooseTool('lasso');
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
    // (Where the place is on the page at the moment of looking.)
    const across = async (want: 'mixed' | 'occupier') => { const ap = await h.toPage(P.a); return page.waitForFunction(([x, y, ca, cb, w]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * (c.width / r.width)) - 30, Math.round((y - r.top) * (c.height / r.height)), 60, 1).data;
      const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const pa = rgb(ca), pb = rgb(cb);
      const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      let nearA = 0, nearB = 0;
      for (let i = 0; i < 60; i++) { const px = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]; if (dist(px, pa) < dist(px, pb)) nearA++; else nearB++; }
      return w === 'mixed' ? nearA >= 10 && nearB >= 10 : nearA <= 3;
    }, [ap[0], ap[1] + 24, colA, colB, want] as const, { timeout: 8000 }); };
    // (The occupation lies at sea: the layer is let cover the sea for this, and set back after.)
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
    await page.getByTestId('clip-to-land').uncheck();
    await h.saved();
    await across('occupier');
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
    await page.getByTestId('layer-fill').selectOption('hatch');
    await h.saved();
    await across('mixed');
    await h.screenshot('occupation-hatched');
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
    await page.getByTestId('layer-fill').selectOption('solid');
    await h.saved();
    await across('occupier');
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
    await page.getByTestId('clip-to-land').check();
    await h.saved();
    // Hide the political layer: only military control is drawn.
    await page.locator('.list-panel .row', { hasText: 'Political' }).locator('input[type=checkbox]').uncheck();
    await h.saved();
    const visible = await page.evaluate(() => (window as any).__mapmaker.store.world.all('layer').filter((l: any) => l.visible).map((l: any) => l.name));
    assert.deepEqual(visible, ['Military control']);
    await h.screenshot('political-hidden');
    await page.locator('.list-panel .row', { hasText: 'Political' }).locator('input[type=checkbox]').check();
    await page.locator('.list-panel .row', { hasText: 'Political' }).locator('span', { hasText: 'Political' }).click();
  });

  await h.step('Alternative versions of an event switch history back and forth', async () => {
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Border treaty');
    await page.getByTestId('event-start').fill('1800');
    await page.getByTestId('event-start').press('Enter');
    await page.getByTestId('event-create').click();
    await h.chooseTool('lasso');
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
    await page.locator('.list-panel .row', { hasText: 'Union' }).waitFor();
  });

  await h.step('A fade over the length of an event', async () => {
    await page.getByRole('button', { name: '+ Event' }).click();
    await page.getByTestId('event-name').fill('Slow decline');
    await page.getByTestId('event-start').fill('2000');
    await page.getByTestId('event-end').fill('2010');
    await page.getByTestId('event-end').press('Enter');
    await page.getByTestId('event-create').click();
    await h.chooseTool('lasso');
    await page.getByTestId('paint-owner').selectOption({ label: 'Nobody (clear territory)' });
    const bp = await h.toPage(P.b);
    await h.drawLasso(blob(bp[0], bp[1], 40, 35));
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    await page.getByTestId('change-row').first().click(); // (the change, in Properties: D210)
    await page.getByTestId('transition-style').selectOption('fade');
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
    await page.getByTestId('new-map-radius').fill('3000');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId)?.name === 'Aster');
    assert.equal(await h.ownerAt(P.a, '1500'), null, 'Aster starts blank at the same coordinates');
    await h.newCountry(C);
    await h.setDate('1400');
    await h.chooseTool('lasso');
    const ap = await h.toPage(P.a);
    await h.drawLasso(blob(ap[0], ap[1], 60, 50));
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await h.waitOwner(P.a, '1500', C);
    await h.screenshot('aster');
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    assert.equal(await h.ownerAt(P.a, '1500'), A, 'Earth is unchanged');
    await page.getByTestId('map-select').selectOption({ label: 'Aster' });
    assert.equal(await h.ownerAt(P.a, '1500'), C);
    assert.equal(await h.ownerAt(P.b, '1500'), null, 'Earth\'s countries never appear on Aster');
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
  });

  await h.step('Event groups: make groups on the timeline, put events in several, filter what the timeline lists', async () => {
    const listed = () => page.evaluate(() => Array.from(document.querySelectorAll('.list-panel .row')).map((r) => r.textContent ?? '').filter((t) => /\d{4}/.test(t)));
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
      await page.locator('.list-panel .row', { hasText: event }).first().click();
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
    await page.locator('.list-panel .row', { hasText: 'Political' }).locator('span').first().click();
    await h.newCountry('Zoomland');
    await h.chooseTool('lasso');
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
    await h.chooseTool('pen');
    // (Freehand, as before curves, D232: pieces dragged and clicked.)
    await page.getByTestId('pen-mode').selectOption('freehand');
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
    await h.chooseTool('pen');
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
    await h.chooseTool('lasso');
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
    await h.chooseTool('pen');
    await page.getByTestId('pen-mode').selectOption('freehand');
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
    await h.chooseTool('lasso');
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    // Seen whole, no cities at all, as maps online (D229); closed in, its dot, then its name.
    const named = async (zoom: number) => {
      await page.evaluate((z) => (window as any).__mapmaker.store.setCamera({ lon: -30, lat: 50, zoom: z, rotation: 0, projection: 'equirectangular' }), zoom);
      await page.waitForTimeout(150);
      return (await page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCities.find((c: any) => c.name === 'Port Aster'))) as { named: boolean } | undefined;
    };
    const far = await named(0), near = await named(3);
    assert.equal(far, undefined, 'whole world: no city');
    assert.ok(near && near.named, 'zoomed in: named');
    // Where cities first appear, closing in, a city not rated is a dot alone; rated a country's capital (D219), named.
    let first = 0;
    for (let z = 0.25; z <= 3; z += 0.25) if (await named(z)) { first = z; break; }
    assert.ok(first > 0, 'cities appear as the map is closed in on');
    assert.equal((await named(first))!.named, false, 'not rated: its dot alone at first');
    await page.getByTestId('city-importance-rank').selectOption('capital');
    await h.saved();
    assert.ok((await named(first))?.named, 'rated a capital: named there');
    assert.equal(await named(0), undefined, 'even a capital is left out seen whole');
    await page.getByTestId('city-importance-rank').selectOption('auto');
    await h.saved();
    // Always shown (D229): named seen whole; one undo.
    await page.getByTestId('city-always-shown').check();
    await h.saved();
    assert.ok((await named(0))?.named, 'always shown: named seen whole');
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await named(0), undefined, 'undone');
    assert.equal(await page.getByTestId('city-always-shown').isChecked(), false);
    await named(3);
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

  await h.step('Choosing several countries on the map (D189): Ctrl+click adds and takes away one, Shift+drag a box round two, Ctrl+Shift+drag over them', async () => {
    await page.getByTestId('tool-select').click();
    await h.setDate('1650');
    const chosen = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.chosen('entity').map((id: string) => s.world.get('entity', id).name).sort(); }) as Promise<string[]>;
    // (Both countries in view, nothing chosen.)
    await page.evaluate(([lon, lat]) => { const s = (window as any).__mapmaker.store; s.set({ selection: null }); s.setCamera({ lon, lat, zoom: 0.5, rotation: 0, projection: 'equirectangular' }); }, [(P.a[0] + P.b[0]) / 2, (P.a[1] + P.b[1]) / 2]);
    await page.waitForTimeout(500);
    const [a, b] = [await h.toPage(P.a), await h.toPage(P.b)];
    assert.deepEqual(await page.evaluate(([pa, pb]) => { const m = (window as any).__mapmaker, s = m.store, B = m.bench; const at = (p: number[]) => s.engine.valueAtPoint(s.spaceId, s.layerId, B.lonLatToVec(p[0], p[1]), s.time); const n = (id: string | null) => (id ? s.world.get('entity', id).name : null); return [n(at(pa)), n(at(pb))]; }, [P.a, P.b]), [A, B], 'the places clicked are theirs');
    // Ctrl+click: one, then the other added, then the first taken away.
    await page.mouse.click(a[0], a[1]);
    await page.keyboard.down('Control');
    await page.mouse.click(b[0], b[1]);
    assert.deepEqual(await chosen(), [A, B].sort(), 'Ctrl+click adds');
    await page.mouse.click(a[0], a[1]);
    await page.keyboard.up('Control');
    assert.deepEqual(await chosen(), [B], 'Ctrl+click again takes it away');
    await page.mouse.click(a[0], a[1]);
    assert.ok((await chosen()).length <= 1, 'a plain click: one place again');
    // Shift+drag: a box round both.
    const x0 = Math.min(a[0], b[0]) - 20, x1 = Math.max(a[0], b[0]) + 20, y0 = Math.min(a[1], b[1]) - 20, y1 = Math.max(a[1], b[1]) + 20;
    await page.keyboard.down('Shift');
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const boxed = await chosen();
    assert.ok(boxed.includes(A) && boxed.includes(B), `the box takes both: ${boxed.join(', ')}`);
    await page.mouse.click(a[0], a[1]);
    // Ctrl+Shift+drag: every country the pointer passes over.
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move(b[0], b[1], { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    const painted = await chosen();
    assert.ok(painted.includes(A) && painted.includes(B), `the stroke takes both: ${painted.join(', ')}`);
    await h.screenshot('map-multi-select');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
  });


  await h.step('Border shifts generated between a change\'s before and after (D195): a step every two months, real changes; more of the land each time from the gainer\'s border, some retaken; all of it at the end; another version, removed, undone', async () => {
    await page.getByTestId('studio-history').click();
    const before = await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').length);
    // Two countries side by side in the southern Indian Ocean, and a war in which the first takes all of the second (drawn as one change).
    const ids = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, C = m.bench.commands, V = m.bench.lonLatToVec;
      const ring = (x0: number, y0: number, x1: number, y1: number) => { const out: unknown[] = []; const side = (ax: number, ay: number, bx: number, by: number) => { for (let k = 0; k < 10; k++) out.push(V(ax + ((bx - ax) * k) / 10, ay + ((by - ay) * k) / 10)); }; side(x0, y0, x1, y0); side(x1, y0, x1, y1); side(x1, y1, x0, y1); side(x0, y1, x0, y0); return out; };
      const never = { day: -Infinity, ms: 0 };
      const a = s.execute((w: any) => C.createEntity(w, { type_id: 'polity', name: 'Shiftland', color: '#2f6fd6' }));
      const b = s.execute((w: any) => C.createEntity(w, { type_id: 'polity', name: 'Holdfast', color: '#d6a12f' }));
      s.execute((w: any, en: any) => C.paintTerritory(w, en, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(80, -50, 90, -40), value: a, snap: 1e-8, mode: { kind: 'correct', t: never } }));
      s.execute((w: any, en: any) => C.paintTerritory(w, en, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(90, -50, 100, -40), value: b, snap: 1e-8, mode: { kind: 'correct', t: never } }));
      const war = s.execute((w: any) => C.createEvent(w, { name: 'The Holdfast War', start: m.bench.gregorian.fromCivil({ year: 1500, month: 1, day: 1 }) }));
      s.execute((w: any, en: any) => C.paintTerritory(w, en, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(90, -50, 100, -40), value: a, snap: 1e-8, mode: { kind: 'new', eventId: war } }));
      s.set({ selection: { kind: 'event', id: war } });
      return { a, b, war };
    });
    await h.saved();
    const owner = (lon: number, lat: number, date: string) => h.hook<string | null>('ownerAt', lon, lat, date);
    assert.equal(await owner(95, -45, '1 February 1500'), 'Shiftland', 'as drawn: all at once');
    // The share of Holdfast's old land Shiftland holds on a date, looked at in 400 places.
    const share = (date: string) => page.evaluate((date) => { const m = (window as any).__mapmaker; let n = 0; for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) if (m.ownerAt(90 + (i + 0.5) / 2, -50 + (j + 0.5) / 2, date) === 'Shiftland') n++; return n / 400; }, date);
    // From the change chosen in the event's panel (D210: in Properties, its Border shifts group): a step every two months for a year.
    await page.getByTestId('event-panel').waitFor();
    await page.getByTestId('change-row').click();
    await page.getByTestId('group-head-change:shifts').click(); // (folded at first)
    await page.getByTestId('border-shifts-dialog-inline').waitFor();
    await page.getByTestId('shifts-every').fill('2');
    assert.match((await page.getByTestId('shifts-count').textContent()) ?? '', /^6 steps, then the last at 1 January 1501/);
    await page.getByTestId('shifts-pushback').fill('80');
    await page.getByTestId('shifts-generate').click();
    await page.getByTestId('shifts-made').waitFor();
    await h.saved();
    assert.match((await page.getByTestId('shifts-made').textContent()) ?? '', /6 generated shifts now, every 2 months until 1 January 1501/);
    const dates = ['15 January 1500', '15 March 1500', '15 May 1500', '15 July 1500', '15 September 1500', '15 November 1500'];
    const shares: number[] = [];
    for (const d of dates) shares.push(await share(d));
    for (let i = 1; i < shares.length; i++) assert.ok(shares[i] > shares[i - 1], `more of it at every step (${shares.map((v) => v.toFixed(2)).join(', ')})`);
    assert.ok(shares[0] > 0 && shares[0] < 0.4 && shares[5] > 0.6 && shares[5] < 1, `from a little to nearly all (${shares.map((v) => v.toFixed(2)).join(', ')})`);
    assert.equal(await share('31 December 1499'), 0, 'none before the war');
    assert.equal(await share('2 January 1501'), 1, 'all of it at the end');
    assert.equal(await owner(90.5, -45, '15 March 1500'), 'Shiftland', 'from its own border first');
    assert.equal(await owner(99.5, -45, '15 March 1500'), 'Holdfast');
    // Somewhere Holdfast takes land back between two steps.
    const back = await page.evaluate((dates) => { const m = (window as any).__mapmaker; let n = 0; for (let q = 1; q < dates.length; q++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) { const lon = 90 + (i + 0.5) / 2, lat = -50 + (j + 0.5) / 2; if (m.ownerAt(lon, lat, dates[q - 1]) === 'Shiftland' && m.ownerAt(lon, lat, dates[q]) === 'Holdfast') n++; } return n; }, dates);
    assert.ok(back > 0, `land retaken here and there (${back} of the places looked at)`);
    // On the map, half way: both countries' colours inside the land fought over.
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 92, lat: -45, zoom: 3.2, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('15 July 1500');
    await page.waitForTimeout(400);
    await h.screenshot('border-shifts-half-way');
    // The change's panel says so; the event's lists one change with its shifts, not seven.
    assert.match((await page.getByTestId('change-shifts').textContent()) ?? '', /Border shifts: [5-6] generated, every 2 months/);
    await page.getByTestId('change-back').click();
    assert.equal(await page.getByTestId('change-row').count(), 1);
    assert.match((await page.getByTestId('change-row').locator('..').textContent()) ?? '', /border shifts/);
    // Another version: other shifts in their place; removed: all at once again.
    await page.getByTestId('change-row').click();
    await page.getByTestId('shifts-another').click();
    await page.waitForFunction(() => /pattern 2\)/.test(document.querySelector('[data-testid=shifts-made]')?.textContent ?? ''));
    await h.saved();
    const other: number[] = [];
    for (const d of dates) other.push(await share(d));
    assert.notDeepEqual(other, shares, 'another version');
    assert.equal(await share('2 January 1501'), 1);
    await page.getByTestId('shifts-remove').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=shifts-made]'));
    await h.saved();
    assert.equal(await share('15 January 1500'), 1, 'removed: all at once again');
    // Undone, step by step, to before the two countries.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    for (let i = 0; i < 12 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').length)) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').length), before);
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 0, lat: 20, zoom: 0, rotation: 0, projection: 'equirectangular' }));
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
    // Fold the group by its arrow: its countries leave the list; unfold. (Its row itself chooses the group, D237.)
    await page.getByTestId('entity-group-fold-Main powers').click();
    assert.equal(await page.getByTestId(`entity-row-${A}`).count(), 0, 'folded away');
    await page.getByTestId('entity-group-fold-Main powers').click();
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
    await page.locator('.list-panel .row', { hasText: A }).first().click();
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

  await h.step('Branches (D150): a branch from the date viewed shares what came before, live, and has its own history after; switched from the title bar; its events listed in it alone; compared with the main timeline side by side; a shot of it; deleted and brought back', async () => {
    // A map of its own, so nothing else is touched: Ostland holds it from the start; Westria takes the west in 1950.
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByPlaceholder('e.g. Aster Prime').fill('Forks');
    await page.getByTestId('new-map-radius').fill('3000');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId)?.name === 'Forks');
    const ids = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench, cmd = B.commands;
      const Y = (y: number) => B.gregorian.fromCivil({ year: y });
      const sq = (w: number, so: number, e: number, n: number) => [[w, so], [e, so], [e, n], [w, n]].map(([lon, lat]) => B.lonLatToVec(lon, lat));
      const ost = s.execute((w: any) => cmd.createEntity(w, { type_id: 'polity', name: 'Ostland', color: '#3a7bd5' }));
      const west = s.execute((w: any) => cmd.createEntity(w, { type_id: 'polity', name: 'Westria', color: '#d55e3a' }));
      s.execute((w: any, e: any) => cmd.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: sq(0, 40, 10, 50), value: ost, snap: 1e-7, mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
      const ev = s.execute((w: any) => cmd.createEvent(w, { name: 'Westria takes the west', start: Y(1950) }));
      s.execute((w: any, e: any) => cmd.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: sq(0, 40, 5, 50), value: west, snap: 1e-7, mode: { kind: 'new', eventId: ev } }));
      s.setCamera({ lon: 5, lat: 45, zoom: 3.2, rotation: 0, projection: 'equirectangular' });
      return { ost, west, ev };
    });
    const W: LL = [2.5, 45], E: LL = [7.5, 42.5];
    await h.setDate('1 June 1940');
    assert.equal(await page.getByTestId('branch-select').count(), 0, 'no list of timelines while there is only the main one');
    // A branch from the date viewed.
    await page.getByTestId('open-branches').click();
    await page.getByTestId('branches-dialog').waitFor();
    assert.equal(await page.getByTestId('new-branch-date').inputValue(), '1 June 1940');
    await page.getByTestId('new-branch-name').fill('Ostland endures');
    await h.screenshot('branches-dialog');
    await page.getByTestId('new-branch-make').click();
    await page.getByTestId('branches-dialog').waitFor({ state: 'detached' });
    const br = await page.evaluate(() => (window as any).__mapmaker.store.branch as string);
    assert.notEqual(br, 'main');
    assert.equal(await page.getByTestId('branch-select').inputValue(), br);
    // After the split the branch has none of the main timeline's later history; before it, the same.
    assert.equal(await h.ownerAt(W, '1960'), 'Ostland');
    assert.equal(await h.ownerAt(W, '1930'), 'Ostland');
    await h.setDate('1960');
    await page.getByTestId('event-row-Westria takes the west').waitFor({ state: 'detached', timeout: 5000 });
    // Something of its own: Westria takes the south-east in 1955, in an event of the branch.
    const own = await page.evaluate(([west]) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench, cmd = B.commands;
      const sq = (w: number, so: number, e: number, n: number) => [[w, so], [e, so], [e, n], [w, n]].map(([lon, lat]) => B.lonLatToVec(lon, lat));
      const ev = s.execute((w: any) => cmd.createEvent(w, { name: 'Westria rises in the east', start: B.gregorian.fromCivil({ year: 1955 }) }));
      s.execute((w: any, e: any) => cmd.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: sq(5, 40, 10, 45), value: west, snap: 1e-7, mode: { kind: 'new', eventId: ev } }));
      return { ev, branch: s.world.get('event', ev).branch_id as string };
    }, [ids.west]);
    assert.equal(own.branch, br);
    assert.equal(await h.ownerAt(E, '1956'), 'Westria');
    await page.getByTestId('event-row-Westria rises in the east').waitFor();
    await h.screenshot('branch-viewed');
    // The main timeline: switched from the title bar; the branch's event is not in it.
    await page.getByTestId('branch-select').selectOption('main');
    assert.equal(await h.ownerAt(W, '1960'), 'Westria');
    assert.equal(await h.ownerAt(E, '1960'), 'Ostland');
    await page.getByTestId('event-row-Westria rises in the east').waitFor({ state: 'detached', timeout: 5000 });
    await page.getByTestId('event-row-Westria takes the west').waitFor();
    // Compared side by side, at the same date: the main timeline on the left, the branch on the right.
    const px = (p: number[]) => page.evaluate(([x, y]) => { const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement; const r = c.getBoundingClientRect(), k = c.width / r.width; return Array.from(c.getContext('2d')!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data).slice(0, 3); }, p);
    // (Westria is red, Ostland blue: told apart by which is stronger. Sampled away from their names.)
    const west = (p: number[]) => p[0] > p[2] + 50, ost = (p: number[]) => p[2] > p[0] + 50;
    const Ws: LL = [1, 48.5], Es: LL = [9, 41];
    await page.getByTestId('compare-toggle').click();
    await page.getByTestId('compare-branch').selectOption(br);
    assert.equal(await page.getByTestId('compare-same').count(), 1, 'the other side follows the date viewed');
    await page.getByTestId('compare-side').click();
    assert.equal(await page.getByTestId('compare-side').getAttribute('aria-label'), 'Side by side');
    await page.waitForTimeout(300);
    const box = (await page.getByTestId('map-canvas').boundingBox())!;
    const half = Math.max(25, Math.floor((box.width - 3) / 2)) + 3;
    const wl = await h.toPage(Ws), el = await h.toPage(Es);
    assert.ok(west(await px(wl)), `left: the main timeline (${await px(wl)})`);
    assert.ok(ost(await px([wl[0] + half, wl[1]])), `right: the branch (${await px([wl[0] + half, wl[1]])})`);
    assert.ok(ost(await px(el)) && west(await px([el[0] + half, el[1]])), `and the south-east the other way round (${await px(el)}, ${await px([el[0] + half, el[1]])})`);
    await h.screenshot('branches-side-by-side');
    // A drag on the other side moves both.
    const cam0 = await page.evaluate(() => (window as any).__mapmaker.store.camera.lon as number);
    await page.mouse.move(el[0] + half, el[1]);
    await page.mouse.down();
    await page.mouse.move(el[0] + half - 60, el[1], { steps: 5 });
    await page.mouse.up();
    assert.ok((await page.evaluate(() => (window as any).__mapmaker.store.camera.lon as number)) > cam0 + 0.5, 'the map moved');
    await page.evaluate((c) => (window as any).__mapmaker.store.setCamera({ lon: c, lat: 45, zoom: 3.2, rotation: 0, projection: 'equirectangular' }), cam0);
    await page.getByTestId('compare-side').click();
    await page.getByTestId('compare-toggle').click();
    // A shot of the branch: made while viewing it, its timeline chosen in the shot's settings.
    await page.getByTestId('branch-select').selectOption(br);
    await h.goto('shots');
    await page.getByTestId('new-shot').click();
    await page.getByTestId('shot-branch').waitFor();
    assert.equal(await page.getByTestId('shot-branch').inputValue(), br);
    await page.waitForTimeout(300);
    const pv = async () => px((await h.hook<number[]>('previewToPage', Ws[0], Ws[1]))!);
    assert.ok(ost(await pv()), `the shot shows the branch (${await pv()})`);
    await page.getByTestId('shot-branch').selectOption('main');
    await page.waitForTimeout(300);
    assert.ok(west(await pv()), `then the main timeline (${await pv()})`);
    // (The shot goes again: later steps make shots of their own.)
    await page.evaluate(() => { const m = (window as any).__mapmaker, s = m.store; const id = s.shotId; s.set({ shotId: null }); s.execute((w: any) => m.bench.commands.deleteSequence(w, id)); });
    await page.getByTestId('studio-history').click();
    // Deleted (with its event), the main timeline shown; undo brings it back.
    await page.getByTestId('open-branches').click();
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('branch-delete-Ostland endures').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.all('branch').length === 0);
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.branch), 'main');
    assert.equal(await page.evaluate((e) => !!(window as any).__mapmaker.store.world.get('event', e), own.ev), false);
    await page.locator('.modal .close').click();
    await page.getByTestId('undo').click();
    await h.saved();
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.all('branch').length === 1);
    await page.getByTestId('branch-select').selectOption(br);
    assert.equal(await h.ownerAt(E, '1956'), 'Westria');
    await page.getByTestId('branch-select').selectOption('main');
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
  });
  await h.step('Upkeep and sound (D151): borders left by a deleted event tidied away, history unchanged, undone; a shot timed to a sound file, its waveform under the frames, the track copied beside its export', async () => {
    // On the map of the branches step: a stroke in an event, then the event deleted; its borders stay behind.
    await page.getByTestId('map-select').selectOption({ label: 'Forks' });
    const count = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; const arr = s.world.arrangement(s.spaceId); return { faces: arr.leafFaces().length as number, segments: arr.segments.size as number, problems: arr.validate() as string[] }; });
    await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench, cmd = B.commands;
      const sq = (w: number, so: number, e: number, n: number) => [[w, so], [e, so], [e, n], [w, n]].map(([lon, lat]) => B.lonLatToVec(lon, lat));
      const ev = s.execute((w: any) => cmd.createEvent(w, { name: 'Soon gone', start: B.gregorian.fromCivil({ year: 1970 }) }));
      const west = s.world.all('entity').find((e: any) => e.name === 'Westria').id;
      s.execute((w: any, e: any) => cmd.paintTerritory(w, e, { spaceId: s.spaceId, layerId: s.layerId, ring: sq(3, 43, 7, 47), value: west, snap: 1e-7, mode: { kind: 'new', eventId: ev } }));
      s.execute((w: any) => cmd.deleteEvent(w, ev));
    });
    await h.saved();
    const before = await count();
    const owners = async () => { const out: Array<string | null> = []; for (const ll of [[1, 48.5], [9, 41], [5, 45], [2, 42], [4, 44], [6.5, 46.5]] as LL[]) for (const d of ['1930', '1960', '1980']) out.push(await h.ownerAt(ll, d)); return out; };
    const was = await owners();
    await page.getByTestId('health').click();
    await page.getByTestId('tidy-parcels').click();
    await page.getByTestId('toast-info').filter({ hasText: 'unused border section' }).waitFor();
    const after = await count();
    assert.ok(after.faces < before.faces && after.segments < before.segments, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    assert.deepEqual(after.problems, []);
    assert.deepEqual(await owners(), was, 'history unchanged');
    await page.locator('.modal .close').first().click();
    await h.saved();
    await page.getByTestId('undo').click();
    await h.saved();
    assert.deepEqual((await count()).segments, before.segments, 'undo brings the borders back');
    assert.deepEqual(await owners(), was);
    // A sound file to time a shot to: two seconds of a tone, louder in the second.
    const rate = 8000, n = 2 * rate, wav = Buffer.alloc(44 + 2 * n);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + 2 * n, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(2 * rate, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(2 * n, 40);
    for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * (i < rate ? 6000 : 26000)), 44 + 2 * i);
    await h.goto('shots');
    await page.getByTestId('new-shot').click();
    await page.getByTestId('shot-editor').waitFor();
    await page.locator('summary', { hasText: 'Sound' }).click();
    await page.getByTestId('shot-audio-file').setInputFiles({ name: 'Overture.wav', mimeType: 'audio/wav', buffer: wav });
    assert.equal(await page.getByTestId('shot-audio-name').innerText(), '♪ Overture.wav');
    await page.locator('[data-testid=shot-waveform] canvas').waitFor();
    await page.waitForFunction(() => { const c = document.querySelector('[data-testid=shot-waveform] canvas') as HTMLCanvasElement | null; if (!c || !c.width) return false; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++; return lit > 50; });
    await h.screenshot('shot-sound');
    await page.getByTestId('shot-audio-offset').fill('0.5');
    await page.getByTestId('shot-audio-offset').press('Enter');
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('sequence', s.shotId).settings).audio?.offset === 0.5; });
    // Exported: the track beside the frames, named in the manifest with the second heard at the first frame.
    const ex = await exportShot('export-preview');
    assert.deepEqual(ex.manifest.audioReference, { file: 'audio-reference.wav', name: 'Overture.wav', secondAtFirstFrame: 0.5 });
    assert.deepEqual(readFileSync(join(ex.dir, 'audio-reference.wav')), wav);
    // (The shot goes again: later steps make shots of their own.)
    await page.evaluate(() => { const m = (window as any).__mapmaker, s = m.store; const id = s.shotId; s.set({ shotId: null }); s.execute((w: any) => m.bench.commands.deleteSequence(w, id)); });
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
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
    // Anywhere but a text box (D172): left and right a day; Ctrl a week; Ctrl+Shift a month; Ctrl+Shift+Alt a year.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const viewed = () => page.evaluate(() => { const s = (window as any).__mapmaker.store; return s.time.day; });
    const dayOf = (y: number, m: number, d: number) => gregorian.fromCivil({ year: y, month: m, day: d }).day;
    await page.locator('body').press('ArrowRight');
    assert.equal(await viewed(), dayOf(1929, 6, 12));
    await page.locator('body').press('Control+ArrowRight');
    assert.equal(await viewed(), dayOf(1929, 6, 19));
    await page.locator('body').press('Control+Shift+ArrowLeft');
    assert.equal(await viewed(), dayOf(1929, 5, 19));
    await page.locator('body').press('Control+Shift+Alt+ArrowRight');
    assert.equal(await viewed(), dayOf(1930, 5, 19));
    await page.getByTestId('steady-date').waitFor();
    await h.setDate('1930');
  });

  await h.step('A map\'s own calendar (D149): started from a template, an era added; dates written, typed, stepped and chosen in it, in the shot preview too; the Gregorian again in one step', async () => {
    const keep = await page.evaluate(() => (window as any).__mapmaker.store.time);
    await h.setDate('1 January 1100');
    await page.getByTestId('studio-map').click(); // (the map's setting-up is Map Studio's, D235)
    await page.locator('[data-testid^="map-row-"].sel').click(); // (the map itself in Properties)
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
    await page.getByTestId('studio-map').click(); // (the map's setting-up is Map Studio's, D235)
    await page.locator('[data-testid^="map-row-"].sel').click(); // (the map itself in Properties)
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
    await page.getByTestId('studio-history').click();
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await page.evaluate((id) => !!(window as any).__mapmaker.store.world.get('sequence', id), shotId), false);
    // The Gregorian again (one step); the date as it was, written as ever.
    await page.getByTestId('studio-map').click(); // (the map's setting-up is Map Studio's, D235)
    await page.locator('[data-testid^="map-row-"].sel').click(); // (the map itself in Properties)
    await page.getByTestId('open-calendar').click();
    await page.getByTestId('calendar-use-gregorian').click();
    await page.getByTestId('studio-map').click(); // (the map's setting-up is Map Studio's, D235)
    await page.locator('[data-testid^="map-row-"].sel').click(); // (the map itself in Properties)
    assert.equal(await page.getByTestId('open-calendar').innerText(), 'Calendar: Gregorian…');
    await dateIs(gregorian.format(W.fromCivil({ year: 120, month: 8, day: 36 }), 'day'));
    await page.evaluate((t) => (window as any).__mapmaker.store.setTime(t), keep);
    await page.getByTestId('studio-history').click();
  });

  await h.step('Recording into an event: each change spreads until the next one recorded; the last then given two years of its own in the event\'s panel', async () => {
    await page.getByTestId('studio-history').click();
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
    // (The third chosen, in Properties: D210.)
    await page.getByTestId('change-row').nth(2).click();
    await page.getByTestId('change-panel').waitFor();
    assert.match((await page.getByTestId('change-when').textContent()) ?? '', /^Change 3 of 3/);
    await page.getByTestId('change-length').selectOption('for');
    await page.getByTestId('change-for-n').fill('2');
    await page.getByTestId('change-for-n').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=change-span]')?.textContent === '1 January 1966 to 1 January 1968');
    await h.screenshot('record-lengths');
    // The last made an expansion, then from two points at once (D91): the second chosen by a click on the map.
    await page.getByTestId('transition-style').selectOption('advance');
    await page.getByTestId('add-origin').click();
    await page.mouse.click(cx + 190, cy - 170);
    await page.waitForFunction(() => /2 points at once/.test(document.querySelector('[data-testid=change-origins]')?.textContent ?? ''));
    const pincer = await page.evaluate((id) => JSON.parse((window as any).__mapmaker.store.world.all('effect').filter((f: any) => f.event_id === id).sort((a: any, b: any) => a.ordinal - b.ordinal)[2].transition), evId);
    assert.equal(pincer.style, 'advance');
    assert.equal(pincer.origins?.length, 1, 'a second starting point');
    assert.deepEqual(pincer.for, { n: 2, unit: 'year' }, 'its length kept');
    await page.getByTestId('clear-origins').click();
    await page.waitForFunction(() => /one point/.test(document.querySelector('[data-testid=change-origins]')?.textContent ?? ''));
    // The second change's tick in the timeline's strip of changes, clicked: that change chosen, at its date (D210).
    await page.evaluate(() => (window as any).__mapmaker.store.set({ timeline: { start: 1950, end: 1980 } }));
    await page.waitForTimeout(150);
    const tl = (await page.getByTestId('timeline').boundingBox())!;
    await page.mouse.click(tl.x + tl.width * (1964 - 1950) / 30, tl.y + tl.height - 4);
    await page.waitForFunction(() => /^Change 2 of 3/.test(document.querySelector('[data-testid=change-when]')?.textContent ?? ''));
    assert.match((await page.getByTestId('change-when').textContent()) ?? '', /1 January 1964/);
    assert.ok(await page.evaluate(() => { const m = (window as any).__mapmaker, t = m.store.time, g = m.bench.gregorian.fromCivil({ year: 1964, month: 1, day: 1 }); return t.day === g.day && t.ms === g.ms; }), 'at its date');
    // Back as it was: changes happen at once when recorded; the event deleted.
    await page.getByTestId('record-when').selectOption('instant');
    await page.getByTestId('recording').getByRole('button', { name: 'Stop' }).click();
    await page.getByTestId('change-back').click();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete event' }).click();
    await h.saved();
    assert.equal(await page.evaluate((id) => (window as any).__mapmaker.store.world.get('event', id) ?? null, evId), null);
  });

  await h.step('Split and merge: a line drawn across a country, the part clicked becomes a new country; two countries merged into a new one in an event; undone', async () => {
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -150, lat: -30, zoom: 3, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1930');
    await h.newCountry('Splitland');
    await h.chooseTool('lasso');
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
    await h.chooseTool('lasso');
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
    await page.locator('.list-panel [data-testid=feature-row]', { hasText: 'Northern front' }).click();
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
    await page.locator('.list-panel .row', { hasText: A }).first().click();
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
    await page.locator('.list-panel .row', { hasText: 'Political' }).locator('span', { hasText: 'Political' }).click();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, tool: 'select' }));
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
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
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
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
    await page.locator('.list-panel .row', { hasText: 'Union' }).click();
    // Out of sync with the clock (D92): the union, an instant of 1900, takes 0.4 s on screen in presentations.
    await page.getByTestId('event-screen').selectOption('own');
    await page.getByTestId('event-screen-seconds').fill('0.4');
    await page.getByTestId('event-screen-seconds').press('Enter');
    await page.waitForFunction(() => /"seconds":0.4/.test((window as any).__mapmaker.store.world.all('event').find((e: any) => e.name === 'Union').presentation));
    await h.goto('shots');
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
    // Of a fixed size by default (D230): a size picked, or one's own; it stays where and as large as it is.
    await page.getByTestId('events-box-fit').selectOption('cover');
    await h.saved();
    assert.equal(await page.getByTestId('events-box-size').inputValue(), 'fixed');
    assert.equal(await page.getByTestId('events-box-size-preset').inputValue(), 'medium');
    await page.getByTestId('events-box-size-preset').selectOption('large');
    await h.saved();
    assert.deepEqual([(await settings()).eventsBox.width, (await settings()).eventsBox.height], [680, 340]);
    const still = async () => { await page.waitForTimeout(400); return (await rects()).find((r) => r.id === 'events-box')!; };
    const s0 = await still();
    assert.ok(Math.abs(s0.w / s0.h - 2) < 0.05, `680 by 340 (${s0.w} by ${s0.h})`);
    await page.getByTestId('frame-slider').fill('20');
    const s1 = await still();
    assert.ok(Math.abs(s0.x - s1.x) < 1 && Math.abs(s0.y - s1.y) < 1 && Math.abs(s0.w - s1.w) < 1 && Math.abs(s0.h - s1.h) < 1, `the box stays put (${JSON.stringify(s0)} then ${JSON.stringify(s1)})`);
    await page.getByTestId('events-box-height').fill('170');
    await page.getByTestId('events-box-height').press('Enter');
    await h.saved();
    assert.equal(await page.getByTestId('events-box-size-preset').inputValue(), 'own');
    const s2 = await still();
    assert.ok(Math.abs(s2.w / s2.h - 4) < 0.1, `its own size, 680 by 170 (${s2.w} by ${s2.h})`);
    // Kept still with room for the most events listed (D190), or growing with them.
    await page.getByTestId('events-box-size').selectOption('room');
    await h.saved();
    assert.deepEqual([(await settings()).eventsBox.keepSize, (await settings()).eventsBox.height], [true, 0]);
    await page.getByTestId('events-box-size').selectOption('grow');
    await h.saved();
    assert.equal((await settings()).eventsBox.keepSize, false);
    await page.getByTestId('events-box-size').selectOption('fixed');
    await h.saved();
    await page.getByTestId('frame-slider').fill('0');
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
    await page.getByTestId('studio-history').click();
    await page.locator('.list-panel .row', { hasText: A }).click();
    await page.getByTestId('fill-upload-video').setInputFiles(video);
    await page.getByTestId('fill-play').waitFor();
    await page.getByTestId('fill-play').selectOption('once');
    await page.locator('.country-fill label', { hasText: 'Speed' }).locator('input').fill('2');
    await h.saved();
    await h.goto('shots');
    await page.locator('.shots-panel .row', { hasText: 'Shot 1' }).click();
    await page.getByTestId('shot-editor').waitFor();
    const ex = await exportShot('export-preview');
    const at = async (f: number) => {
      const p = await page.evaluate(([lon, lat, fr]) => (window as any).__mapmaker.exportPixel(lon, lat, fr, 0.25), [P.a[0], P.a[1], f] as const);
      return pixel(readPNG(ex.frames('fills')[f]), p[0], p[1]);
    };
    const first = await at(0), last = await at(ex.frames('fills').length - 1);
    assert.ok(first[1] > first[2] + 60 && first[1] > first[0] + 60, `first frame shows the video's green (${first})`);
    assert.ok(last[2] > last[1] + 60 && last[2] > last[0] + 60, `last frame shows the video's blue: it played (${last})`);
    await page.getByTestId('studio-history').click();
    await page.locator('.list-panel .row', { hasText: A }).click();
    await page.getByTestId('fill-color').click();
    await h.saved();
    await h.goto('shots');
    await page.locator('.shots-panel .row', { hasText: 'Shot 1' }).click();
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
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-flat').check();
    await page.getByTestId('new-map-name').fill('Old Town');
    await page.getByTestId('new-map-width').fill('10');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
    await page.waitForFunction(() => (window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId)?.name === 'Old Town');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.camera.projection), 'flat', 'seen in plan');
    assert.equal(await page.getByTestId('basemap-toggle').count(), 0, 'no Earth geography for a flat map');
    assert.match((await page.locator('.list-panel .row', { hasText: 'Old Town' }).textContent()) ?? '', /flat, 10 km wide/);
    // A square with the precise shape tool: drawn, owned, straight.
    await h.newCountry('Guild Quarter');
    await h.chooseTool('polygon');
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
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    assert.notEqual(await page.evaluate(() => (window as any).__mapmaker.store.camera.projection), 'flat', 'Earth is round again');
  });

  await h.step('Settings: how fast and how sharp the working view is drawn, kept on this computer', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('tool-select').click();
    const state = () => page.evaluate(() => {
      const s = (window as any).__mapmaker.store, c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      return { v: s.viewSettings, carry: s.renderer.carry as boolean, tolerance: s.renderer.quality.tolerance as number, width: c.width, shown: Math.round(c.getBoundingClientRect().width), parts: Object.values(s.renderer.lastParts) as string[], labels: s.renderer.lastLabels.length as number, stored: localStorage.getItem('mapmaker.viewSettings') };
    });
    const before = await state();
    assert.ok(before.carry && before.v.resolution === 1 && before.width === before.shown, `balanced to begin with (${JSON.stringify(before.v)})`);
    await page.getByTestId('menu-edit').click(); await page.getByTestId('command-settings').click();
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
    await page.getByTestId('menu-edit').click(); await page.getByTestId('command-settings').click();
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
    await page.getByTestId('studio-history').click();
    const look = () => page.evaluate(() => {
      const s = (window as any).__mapmaker.store, space = s.world.get('map_space', s.spaceId);
      return { labels: s.renderer.lastLabels.length as number, lakes: s.renderer.basemapPainter.lakeFilter as { show: boolean; minKm2: number }, settings: JSON.parse(space.settings).show ?? {} };
    });
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastLabels.length > 0);
    await page.getByTestId('menu-view').click(); await page.getByTestId('command-show').click();
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
    await h.goto('shots');
    await page.waitForFunction((min) => { const f = (window as any).__mapmaker.store.renderer.basemapPainter.lakeFilter; return f.show && f.minKm2 === min; }, set.settings.minLakeKm2);
    await page.getByTestId('studio-history').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.basemapPainter.lakeFilter.show === false);
    // Back as it was: one undo per change.
    for (let i = 0; i < 4; i++) await page.getByTestId('undo').click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastLabels.length > 0);
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.basemapPainter.lastRivers > 100);
    const after = await look();
    assert.ok(after.lakes.show && after.lakes.minKm2 === 0 && after.settings.working?.names !== false && after.settings.working?.lakes !== false && after.settings.working?.rivers !== false && !after.settings.minLakeKm2, `names, lakes and rivers back (${JSON.stringify(after)})`);
  });

  await h.step('Locked countries: one locked from its menu keeps its land when drawn over and is given none; unlocked from its panel; all the others locked at once; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
      await page.getByTestId('menu-view').click(); await page.getByTestId('command-show').click();
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
    // (Places nothing of this test covers: the Taklamakan desert and New Guinea's rainforest.)
    const sahara: LL = [83, 39], congo: LL = [140, -6.5];
    for (const ll of [sahara, congo]) assert.equal(await h.ownerAt(ll, '1450'), null, `nobody holds ${ll}`);
    await show(async () => { await page.getByTestId('terrain-palette').selectOption('satellite'); });
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.cover, null, { timeout: 30000 });
    const mean = async (ll: LL) => { const px = await patch(ll, 2), c = [0, 0, 0]; for (let i = 0; i < px.length; i += 4) for (let q = 0; q < 3; q++) c[q] += px[i + q] / (px.length / 4); return c; };
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
    // (What the heights themselves show: nothing is made up below their own detail, D194.)
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
    // With the bundled heights alone the ground close in is still the heights' own (D194), smooth between their
    // cells: no grain from one pixel to the next, and the same picture when the view comes back to it.
    const smoothPixels = await patch([10, 50], 30);
    const steps1: number[] = [];
    for (let i = 0; i + 4 < smoothPixels.length; i += 4) steps1.push(Math.abs(smoothPixels[i] + smoothPixels[i + 1] + smoothPixels[i + 2] - smoothPixels[i + 4] - smoothPixels[i + 5] - smoothPixels[i + 6]));
    steps1.sort((x, y) => x - y);
    assert.ok(steps1[Math.floor(steps1.length * 0.9)] <= 3, `smooth ground: no grain from pixel to pixel (nine in ten steps within ${steps1[Math.floor(steps1.length * 0.9)]} of 765)`);
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 10.2, lat: 50.1, zoom: 6.5, rotation: 0, projection: 'equirectangular' }));
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 10, lat: 50, zoom: 6.5, rotation: 0, projection: 'equirectangular' }));
    await page.waitForTimeout(500);
    assert.ok(meanDiff(smoothPixels, await patch([10, 50], 30)) < 1.5, 'the same ground when the view comes back to it');
    await h.screenshot('terrain-smooth-ground');
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
    await h.goto('shots');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.colours);
    await page.getByTestId('studio-history').click();
    assert.deepEqual(await terrain(), { colours: false, relief: false, overTerritories: false, seaLevel: 0, cover: false, detail: '', photo: '' });
    // Undone, step by step, to no terrain.
    for (let i = 0; i < 7; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each change was one step');
    assert.equal(await page.evaluate(() => JSON.parse((window as any).__mapmaker.store.world.get('map_space', (window as any).__mapmaker.store.spaceId).settings).terrain ?? null), null);
  });

  await h.step('Sea level over time: 120 m lower, the North Sea is land, and territory ending at the coast covers it; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    await page.locator('.list-panel .row', { hasText: 'Military control' }).locator('span', { hasText: 'Military control' }).click();
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
    assert.ok(await page.getByTestId('clip-to-land').isChecked(), 'territory on this layer ends at the coast');
    const seaPlaces: LL[] = [[3, 55.5], [2, 56.6], [4.5, 56.6], [3.5, 54.4]], landPlaces: LL[] = [[-1, 52.7], [-2, 54.6], [8, 52.4], [6.6, 52.8]];
    for (const ll of [...seaPlaces, ...landPlaces]) for (const layer of ['Political', 'Military control']) assert.equal(await h.ownerOnLayer(ll, '1450', layer), null, `nobody holds ${ll} on ${layer}`);
    await h.setDate('1400');
    await h.newCountry('Dogger Folk');
    await h.chooseTool('polygon');
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
    await page.getByTestId('studio-map').click(); // (the map's setting-up is Map Studio's, D235)
    await page.locator('[data-testid^="map-row-"].sel').click(); // (the map itself in Properties)
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
    await page.getByTestId('studio-history').click();
  });

  await h.step('A generated planet: chosen with a picture of it, made from its seed, land and sea drawn, territory ending at its coast; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
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
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'layer', id: s.layerId } }); }); // (the layer drawn on, shown in Properties)
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

  await h.step('The quick generator\'s drawing tools (D169): on a generated planet, land drawn as an outline in its sea; a river from it to the sea; desert painted on it; its colours from the climate models; undone', async () => {
    await page.getByTestId('studio-history').click();
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const was = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return { spaceId: s.spaceId as string, layerId: s.layerId as string }; });
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-planet').check();
    await page.getByTestId('new-map-name').fill('Drawn world');
    await page.getByTestId('planet-preset-earthlike').click();
    await page.getByTestId('planet-seed').fill('7');
    await page.getByTestId('new-map-create').click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastTerrain.cover, null, { timeout: 60000 });
    // Open sea: deep water 8° all round a place in the middle latitudes.
    const sea = await page.evaluate(() => {
      const s = (window as any).__mapmaker.store, g = s.terrainOf(s.world.get('map_space', s.spaceId)).grid, W = g.width, H = g.height, r = Math.round((8 / 360) * W);
      for (let j = Math.round(H * 0.3); j < H * 0.7; j += 7) for (let i = r; i < W - r; i += 7) {
        let ok = true;
        for (let dj = -r; dj <= r && ok; dj += 3) for (let di = -r; di <= r && ok; di += 3) if (g.data[(j + dj) * W + i + di] * g.step > -500) ok = false;
        if (ok) return [-180 + ((i + 0.5) * 360) / W, 90 - ((j + 0.5) * 180) / H] as [number, number];
      }
      return null;
    });
    assert.ok(sea, 'open sea on the planet');
    const [lon0, lat0] = sea!;
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 2, rotation: 0, projection: 'equirectangular' }), sea!);
    const pixelAt = (ll: [number, number]) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return Array.from(c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
    }, ll);
    const heightAt = (ll: [number, number]) => page.evaluate(([lon, lat]) => {
      const m = (window as any).__mapmaker, s = m.store, space = s.world.get('map_space', s.spaceId), g = s.terrainOf(space);
      return m.bench.heightAt(m.bench.sculpted(g.grid, g.key, JSON.parse(space.settings).sculpt ?? [], space.radius_m / 1000).grid, lon, lat) as number;
    }, ll);
    const stroke = async (lls: Array<[number, number]>) => {
      const pts: Array<[number, number]> = [];
      for (const ll of lls) pts.push(await h.toPage(ll));
      await page.mouse.move(pts[0][0], pts[0][1]);
      await page.mouse.down();
      for (const q of pts.slice(1)) await page.mouse.move(q[0], q[1], { steps: 4 });
      await page.mouse.up();
    };
    const seaPx = await pixelAt(sea!);
    // An outline drawn round the place: the sea inside it becomes land, rising inland.
    // (The terrain tools are Map Studio's, D235.)
    await page.getByTestId('studio-map').click();
    await page.getByTestId('tool-sculpt').click();
    await page.getByTestId('sculpt-brush').selectOption('coast-land');
    await page.getByTestId('sculpt-size').fill('150');
    await page.getByTestId('sculpt-strength').fill('600');
    await stroke(Array.from({ length: 17 }, (_, k) => [lon0 + 5 * Math.cos((2 * Math.PI * k) / 16), lat0 + 4 * Math.sin((2 * Math.PI * k) / 16)] as [number, number]));
    assert.ok((await heightAt(sea!)) > 300, `land where the sea was (${await heightAt(sea!)} m)`);
    assert.ok((await heightAt([lon0 + 7.5, lat0])) < 0, 'the sea beyond the outline');
    let px = seaPx;
    for (let i = 0; i < 40 && Math.max(...px.map((v, k) => Math.abs(v - seaPx[k]))) <= 25; i++) { await page.waitForTimeout(100); px = await pixelAt(sea!); }
    assert.ok(Math.max(...px.map((v, k) => Math.abs(v - seaPx[k]))) > 25, `drawn as land (${px} against the sea's ${seaPx})`);
    // A river from the middle of the new land east to the sea: its water alone, the ground left as it is (D226).
    await page.getByTestId('sculpt-brush').selectOption('river');
    await page.getByTestId('river-follow').uncheck();
    for (const k of ['river-meander', 'river-tributaries']) { await page.getByTestId(k).fill('0'); await page.getByTestId(k).dispatchEvent('pointerup'); }
    const along = [0, 1.5, 3, 4.5].map((d) => [lon0 + d, lat0 + (d <= 3 ? d / 6 : 0.5 - (d - 3) / 7)] as [number, number]);
    const bedBefore = await Promise.all(along.map((q) => heightAt(q)));
    await stroke([[lon0, lat0], [lon0 + 3, lat0 + 0.5], [lon0 + 6.5, lat0]]);
    assert.deepEqual(await Promise.all(along.map((q) => heightAt(q))), bedBefore, 'the ground along the river as it was');
    assert.equal(await page.evaluate(() => { const s = (window as any).__mapmaker.store; return (JSON.parse(s.world.get('map_space', s.spaceId).settings).sculpt ?? []).filter((x: any) => x.tool === 'river').length; }), 1, 'the river made');
    // Desert painted over the land, as the satellite look shows it: sand.
    await page.getByTestId('sculpt-brush').selectOption('biome');
    await page.getByTestId('sculpt-biome').selectOption('desert');
    await page.getByTestId('sculpt-size').fill('200');
    const spot: [number, number] = [lon0 - 2, lat0 - 1];
    await stroke([[lon0 - 3.5, lat0 - 1], [lon0 - 0.5, lat0 - 1]]);
    let sand = await pixelAt(spot);
    for (let i = 0; i < 40 && !(sand[0] > sand[2] + 30); i++) { await page.waitForTimeout(100); sand = await pixelAt(spot); }
    assert.ok(sand[0] > sand[2] + 30, `desert painted (${sand})`);
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.set({ sculpt: { ...s.sculpt, river: { ...s.sculpt.river, follow: true, meander: 0.5, tributaries: 0.4 } } }); });
    await h.screenshot('planet-drawn');
    const strokes = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).sculpt.map((x: any) => `${x.tool}${x.biome ? `:${x.biome}` : ''}`); });
    assert.deepEqual(strokes, ['coast-land', 'river', 'biome:desert']);
    // The land's colours from the climate models (D169): the simulated planets' climate, water and biomes worked out on
    // this planet's own land and sea (the drawn island included), the painted desert still over them.
    const coverKey = () => page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, space = s.world.get('map_space', s.spaceId), g = s.terrainOf(space);
      return s.coverOf(space, m.bench.sculpted(g.grid, g.key, JSON.parse(space.settings).sculpt ?? [], space.radius_m / 1000))?.key ?? '';
    });
    assert.doesNotMatch(await coverKey(), /^quick-cover:/);
    await page.getByTestId('menu-view').click(); await page.getByTestId('command-show').click();
    await page.getByTestId('show-dialog').waitFor();
    await page.getByTestId('terrain-climate').check();
    await page.getByTestId('show-dialog').getByRole('button', { name: 'Close' }).last().click();
    for (let i = 0; i < 300 && !/^quick-cover:/.test(await coverKey()); i++) await page.waitForTimeout(200);
    assert.match(await coverKey(), /^quick-cover:/, 'coloured by the climate models');
    sand = await pixelAt(spot);
    for (let i = 0; i < 40 && !(sand[0] > sand[2] + 30); i++) { await page.waitForTimeout(100); sand = await pixelAt(spot); }
    assert.ok(sand[0] > sand[2] + 30, `the painted desert over them (${sand})`);
    await page.evaluate(([lon, lat]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom: 0.7, rotation: 0, projection: 'equirectangular' }), sea!);
    await page.waitForTimeout(500);
    await h.screenshot('planet-climate-colours');
    // Undone: the colours, the strokes one by one, then the planet.
    for (let i = 0; i < 5; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each stroke was one step');
    await page.getByTestId('tool-select').click();
    await page.evaluate((w) => (window as any).__mapmaker.store.set({ spaceId: w.spaceId, layerId: w.layerId, selection: null }), was);
    await page.getByTestId('studio-history').click();
  });

  await h.step('Brush tips and mountain ranges (D218): a hard round tip raises a plateau, not a dome; the tip kept with the stroke; a range has a crest and valleys down its sides; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 12, lat: 24, zoom: 3, rotation: 0, projection: 'equirectangular' }));
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const heightAt = (ll: [number, number], sculpted = true) => page.evaluate(([lon, lat, withStrokes]) => {
      const m = (window as any).__mapmaker, s = m.store, space = s.world.get('map_space', s.spaceId), g = s.terrainOf(space);
      return m.bench.heightAt(m.bench.sculpted(g.grid, g.key, withStrokes ? JSON.parse(space.settings).sculpt ?? [] : [], space.radius_m / 1000).grid, lon, lat) as number;
    }, [ll[0], ll[1], sculpted] as const);
    const stroke = async (lls: Array<[number, number]>) => {
      const pts: Array<[number, number]> = [];
      for (const ll of lls) pts.push(await h.toPage(ll));
      await page.mouse.move(pts[0][0], pts[0][1]);
      await page.mouse.down();
      for (const q of pts.slice(1)) await page.mouse.move(q[0], q[1], { steps: 8 });
      await page.mouse.up();
    };
    // (The terrain tools are Map Studio's, D235.)
    await page.getByTestId('studio-map').click();
    await page.getByTestId('tool-sculpt').click();
    await page.getByTestId('sculpt-brush').selectOption('raise');
    await page.getByTestId('sculpt-size').fill('150');
    await page.getByTestId('sculpt-strength').fill('1000');
    // The tip: a panel of tips to start from and every part of it; Hard round chosen.
    await page.getByTestId('sculpt-tip').click();
    await page.getByTestId('sculpt-tip-panel').waitFor();
    await page.getByTestId('sculpt-tip-preset-hard').click();
    assert.equal(await page.getByTestId('sculpt-tip-fade').inputValue(), '0.25');
    await h.screenshot('brush-tip');
    await page.getByTestId('sculpt-tip').click();
    assert.equal(await page.getByTestId('sculpt-tip-panel').count(), 0, 'closed again');
    await stroke([[9, 24], [12, 24], [15, 24]]);
    await h.saved();
    const kept = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).sculpt.at(-1); });
    assert.equal(kept.tool, 'raise');
    assert.equal(kept.tip?.hardness, 0.75, 'the tip kept with the stroke');
    // At six tenths of the way to its edge, a hard tip has its full strength (a soft one about four tenths).
    const rise = async (ll: [number, number]) => (await heightAt(ll)) - (await heightAt(ll, false));
    const middle = await rise([12, 24]), off = await rise([12, 24 + 0.6 * (150 / 111.2)]);
    assert.ok(middle > 900 && off > 0.85 * middle, `a plateau (${Math.round(middle)} m in the middle, ${Math.round(off)} m six tenths out)`);
    // A mountain range (soft tip): its crest near the stroke, valleys and ridges down its sides.
    await page.getByTestId('sculpt-brush').selectOption('mountains');
    await page.getByTestId('sculpt-tip').click();
    await page.getByTestId('sculpt-tip-preset-soft').click();
    await page.getByTestId('sculpt-tip').click();
    await page.getByTestId('sculpt-size').fill('250');
    await page.getByTestId('sculpt-strength').fill('3000');
    await stroke([[4, 30], [10, 31], [16, 30]]);
    await h.saved();
    // (Across it in five places: a stroke has a seed of its own, and one place may be a pass between peaks.)
    const sections = await Promise.all([7, 8.5, 10, 11.5, 13].map((lon) => Promise.all(Array.from({ length: 9 }, (_, k) => rise([lon, 31 - 2 + k * 0.5 + (lon - 10) * (lon < 10 ? 1 / 6 : -1 / 6)])))));
    const tops = sections.map((a) => Math.max(...a)), near = sections.filter((a) => { const i = a.indexOf(Math.max(...a)); return i >= 2 && i <= 6; }).length;
    assert.ok(Math.max(...tops) > 1500 && near >= 3, `the crest near the stroke (${sections.map((a) => a.map(Math.round).join(' ')).join(' | ')})`);
    const flank = await Promise.all(Array.from({ length: 25 }, (_, k) => rise([7 + k * 0.25, 31 - 1.1])));
    let turns = 0;
    for (let k = 1; k < flank.length - 1; k++) if ((flank[k] - flank[k - 1]) * (flank[k + 1] - flank[k]) < 0) turns++;
    assert.ok(turns >= 4 && Math.max(...flank) - Math.min(...flank) > 150, `ridges and valleys along its side (${flank.map(Math.round).join(', ')})`);
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 10, lat: 30.5, zoom: 3.4, rotation: 0, projection: 'equirectangular' }));
    await page.waitForTimeout(800);
    await h.screenshot('mountain-range');
    for (let i = 0; i < 2; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each stroke one step');
    await page.getByTestId('tool-select').click();
    await page.getByTestId('studio-history').click();
  });

  await h.step('Sculpting: land painted into the North Sea in the base world; a dated stroke floods England from a date only; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    // (The terrain tools are Map Studio's, D235.)
    await page.getByTestId('studio-map').click();
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
    await page.getByTestId('studio-history').click();
  });

  await h.step('Conditions: a radiation layer; a source placed with a click from the date viewed, there while it lasts and not before or after; a plume carried east; hidden while working but presented; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('menu-view').click(); await page.getByTestId('command-show').click();
    await page.getByTestId('show-dialog').waitFor();
    await page.getByTestId('show-working-fields').uncheck();
    await page.getByTestId('show-dialog').getByRole('button', { name: 'Close' }).last().click();
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.length === 0);
    await h.goto('shots');
    await page.waitForFunction(() => (window as any).__mapmaker.store.renderer.lastFields.length > 0);
    await page.getByTestId('studio-history').click();
    // Undone, step by step: the switch, the plume, the circle and the layer.
    assert.equal(await fields().then((f) => f.length), 0);
    for (let i = 0; i < 4; i++) await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await steps(), before, 'each change was one step');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('layer').some((l: any) => l.kind === 'field')), false);
    await page.getByTestId('tool-select').click();
  });

  await h.step('Conditions spreading over the terrain: a fire in the West Siberian Plain advances day by day; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    // The pointer: pixels between the box and the place are the text's colour somewhere along the line. (Looked for a
    // couple of pixels either side: the thin line leaves the box at its corner, rounded, not at the corner's point.)
    const from = [Math.min(box.x + box.w, Math.max(box.x, at[0])), Math.min(box.y + box.h, Math.max(box.y, at[1]))];
    const litNear = (p: [number, number]) => page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 2, Math.round((y - r.top) * k) - 2, 5, 5).data;
      for (let i = 0; i < d.length; i += 4) if (Math.max(Math.abs(d[i] - 244), Math.abs(d[i + 1] - 239), Math.abs(d[i + 2] - 230)) <= 60) return true;
      return false;
    }, p);
    let lit = 0;
    for (let i = 2; i <= 8; i++) {
      const f = i / 10;
      if (await litNear([from[0] + (at[0] - from[0]) * f, from[1] + (at[1] - from[1]) * f])) lit++;
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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

  await h.step('Looks of countries (D181, D185): effects added in a country\'s panel, a light sweep that changes the frame as time on screen passes, a change through history, a look kept and given to a second country, an export with motion blur; undone', async () => {
    await page.getByTestId('studio-history').click();
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    const lookOf = (name: string) => page.evaluate((n) => { const e = (window as any).__mapmaker.store.world.all('entity').find((x: any) => x.name === n); return JSON.parse(e.style || '{}').look ?? null; }, name);
    // A drop shadow and a light sweep from the country's panel.
    await page.getByTestId(`entity-row-${A}`).click();
    await page.locator('details.country-look > summary').click();
    await page.getByTestId('country-add-effect').selectOption('shadow');
    await h.saved();
    await page.getByTestId('country-add-effect').selectOption('shine');
    await h.saved();
    assert.deepEqual((await lookOf(A)).effects.map((e: any) => e.kind), ['shadow', 'shine']);
    // The shadow's strength changing through history: from its value to another between two dates.
    await page.getByTestId('country-effect').first().locator('details.effect-motion > summary').click();
    await page.getByTestId('country-0-add-motion').click();
    await h.saved();
    await page.getByTestId('country-0-motion-to').fill('10');
    await page.getByTestId('country-0-motion-to').press('Enter');
    await h.saved();
    const motion = (await lookOf(A)).effects[0].motions[0];
    assert.deepEqual([motion.field, motion.from, motion.to], ['opacity', 0.55, 0.1], 'from 55 % to 10 %');
    // Kept under a name, and given to another country from its panel.
    await page.getByTestId('country-preset-save').click();
    await page.getByTestId('ask-input').fill('Shining');
    await page.getByTestId('ask-ok').click();
    await h.saved();
    await page.getByTestId(`entity-row-${B}`).click();
    await page.locator('details.country-look > summary').click();
    await page.getByTestId('country-preset-use').selectOption({ label: 'Shining' });
    await h.saved();
    assert.deepEqual((await lookOf(B)).effects.map((e: any) => e.kind), ['shadow', 'shine'], 'the kept look given to the second country');
    // In a shot of one moment of history, the sweep crosses the countries as time on screen passes.
    const mid: LL = [(P.a[0] + P.b[0]) / 2, (P.a[1] + P.b[1]) / 2];
    const shotId = await page.evaluate((c) => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const settings = B.defaultShot(s.spaceId, { lon: c[0], lat: c[1], zoom: 3, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 1);
      settings.overlays = [];
      const id = s.execute((w: any) => B.commands.createSequence(w, 'Moving looks', settings));
      s.set({ shotId: id, shotFrame: 0, presentCamera: null, mode: 'present' });
      return id as string;
    }, mid);
    await page.getByTestId('shot-editor').waitFor();
    const picture = () => page.evaluate(() => { const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement; return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 16 < 3)); });
    await page.getByTestId('frame-slider').fill('0');
    await page.waitForTimeout(1500);
    const p0 = await picture();
    await page.getByTestId('frame-slider').fill('19');
    // (Drawn when the frame has changed: looked at until it shows, for up to ten seconds. Every colour is compared:
    // light on a red country changes its green and blue more than its red.)
    let changed = 0;
    for (let i = 0; i < 20 && changed <= 200; i++) {
      await page.waitForTimeout(500);
      const p19 = await picture();
      changed = p0.filter((v, k) => Math.abs(v - p19[k]) > 24).length;
    }
    assert.ok(changed > 200, `the sweep changes the picture as time on screen passes (${changed} samples)`);
    // An export with motion blur: four pictures a frame.
    await page.getByTestId('export-motion-blur').selectOption('4');
    await page.waitForFunction((id) => JSON.parse((window as any).__mapmaker.store.world.get('sequence', id).settings).motionBlur?.samples === 4, shotId);
    await page.getByTestId('export-shutter').waitFor();
    const { frames, manifest } = await exportShot('export-preview');
    assert.ok(frames('all').length >= 24 && frames('all').length === manifest.frames[1] - manifest.frames[0] + 1, `every frame of the preview, each blurred (${frames('all').length})`);
    // Undone, all of it: the looks, the kept look and the shot.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ mode: 'world', shotId: null }));
    for (let i = 0; i < 20 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.deepEqual([await lookOf(A), await lookOf(B)], [null, null]);
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.get('meta', 'look_presets')?.value ?? '[]'), '[]', 'no look kept');
  });

  await h.step('SVG frames: the frame shown saved as an SVG file; territories, borders, names and texts as shapes and text in their layers; drawn by the browser it is the exported frame; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
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
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-stars').check();
    await page.getByTestId('new-map-stars-note').waitFor();
    await page.getByTestId('new-map-name').fill('Nearby stars');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
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
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return s.world.get('map_space', s.spaceId)?.kind === 'sphere'; });
    for (let i = 0; i < 10 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false, 'the star map undone');
    assert.ok(frame.id);
  });

  await h.step('Space views (D215): the view in three dimensions stays level whatever the chart was turned to; the right button moves the view, the middle button carries it forward and back (D231); ⌂ back to the start, level; a star found by name and the view brought to it; undone', async () => {
    const st = <T,>(f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`) as Promise<T>;
    const hook = <T,>(name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as any).__mapmaker[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-stars').check();
    await page.getByTestId('new-map-name').fill('Level stars');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
    await page.waitForFunction(() => !!(window as any).__mapmaker.starToPage(71456));
    // A turn left from the chart is not carried into three dimensions: Alpha Centauri stays where it was.
    const before = await hook<[number, number]>('starToPage', 71456);
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, rotation: 40 }); });
    await page.waitForTimeout(150);
    const after = await hook<[number, number]>('starToPage', 71456);
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1, `level (${before} then ${after})`);
    // The right button moves the view sideways; it does not turn it.
    const cam0 = await st<{ lon: number; lat: number; zoom: number }>('s.camera');
    const canvas = (await page.getByTestId('map-canvas').boundingBox())!;
    const dragWith = async (button: 'middle' | 'right', dx: number, dy: number) => {
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await page.mouse.down({ button });
      await page.mouse.move(canvas.x + canvas.width / 2 + dx, canvas.y + canvas.height / 2 + dy, { steps: 6 });
      await page.mouse.up({ button });
      return st<{ lon: number; lat: number; zoom: number; target?: number[] }>('s.camera');
    };
    const cam1 = await dragWith('right', 120, 40);
    assert.deepEqual([cam1.lon, cam1.lat], [cam0.lon, cam0.lat], 'not turned');
    assert.ok(cam1.target && Math.hypot(cam1.target[0], cam1.target[1], cam1.target[2]) > 1, `moved (${cam1.target})`);
    // The middle button (D231) carries the camera forward, dragged up, through the stars: along the way it looks,
    // neither turned nor zoomed; Alpha Centauri, ahead, comes nearer; dragged down as far, back where it was.
    const fwd = [-Math.cos((cam0.lat * Math.PI) / 180) * Math.cos((cam0.lon * Math.PI) / 180), -Math.cos((cam0.lat * Math.PI) / 180) * Math.sin((cam0.lon * Math.PI) / 180), -Math.sin((cam0.lat * Math.PI) / 180)];
    const off = async () => { await page.waitForTimeout(150); const a = await hook<[number, number]>('starToPage', 71456), m = await hook<[number, number]>('spaceMiddle'); return Math.hypot(a[0] - m[0], a[1] - m[1]); };
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, target: undefined }); });
    const cam1b = await st<{ target?: number[] }>('s.camera');
    const from = cam1b.target ?? [0, 0, 0];
    const size0 = await off();
    const cam2 = await dragWith('middle', 0, -60);
    const moved = cam2.target!.map((v, i) => v - from[i]), len = Math.hypot(...moved);
    assert.deepEqual([cam2.lon, cam2.lat, cam2.zoom], [cam0.lon, cam0.lat, cam0.zoom], 'not turned, not zoomed');
    assert.ok(len > 1 && moved.reduce((a, v, i) => a + v * fwd[i], 0) / len > 0.999, `forward (${moved})`);
    const size1 = await off();
    assert.ok(size1 > size0 * 1.05, `nearer: farther from the middle of the picture as it comes nearer (${size0.toFixed(1)} then ${size1.toFixed(1)})`);
    const cam3 = await dragWith('middle', 0, 60);
    assert.ok(cam3.target!.every((v, i) => Math.abs(v - from[i]) < 1e-6), 'back');
    // ⌂: back to the start, level, the whole map in view.
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, lon: 33, lat: -12, zoom: 2.5 }); });
    await page.getByTestId('space-home').click();
    const home = await st<{ lon: number; lat: number; zoom: number; rotation: number; target?: number[] }>('s.camera');
    assert.deepEqual([home.lon, home.lat, home.zoom, home.rotation, home.target ?? null], [-60, 28, 0, 0, null]);
    // A star found by its name: chosen, in the middle of the view, close enough to see its neighbours.
    await page.getByTestId('space-find').fill('sirius');
    const first = page.getByTestId('space-find-result').first();
    assert.match((await first.textContent()) ?? '', /^Sirius/);
    await first.click();
    const sel = await st<{ kind: string; id: number }>('s.selection');
    assert.equal(sel.kind, 'star');
    await page.waitForTimeout(150);
    const at = await hook<[number, number]>('starToPage', sel.id), middle = await hook<[number, number]>('spaceMiddle');
    assert.ok(Math.hypot(at[0] - middle[0], at[1] - middle[1]) < 1, 'in the middle');
    assert.ok((await st<number>('s.camera.zoom')) >= 3, 'closer in');
    assert.equal(await page.getByTestId('star-name').textContent(), 'Sirius');
    await h.screenshot('star-found');
    // Back to Earth; the map undone.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    for (let i = 0; i < 6 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('The solar system: the planets where they are on the date viewed, moving as the date changes; true or compressed distances; a planet\'s panel; side by side, a planet held and its holder over it; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-solar').check();
    await page.getByTestId('new-map-solar-note').waitFor();
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; const m = s.world.get('map_space', s.spaceId); return m?.kind === 'space' && JSON.parse(m.settings).space.catalogue === 'solar'; });
    // A new solar system (D208): true to scale and as photographed.
    const made = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space; });
    assert.equal(made.scale, 'true');
    assert.equal(made.look.photo, true);
    assert.equal(made.row.sizes, 'poster');
    await h.setDate('1 January 2030');
    await page.waitForFunction(() => !!(window as any).__mapmaker.starToPage(3));
    const hook = <T,>(name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as any).__mapmaker[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
    const middle = await hook<[number, number]>('spaceMiddle');
    const sun = await hook<[number, number]>('starToPage', 0);
    assert.ok(Math.hypot(sun[0] - middle[0], sun[1] - middle[1]) < 1, 'the Sun in the middle');
    const names = await page.evaluate(() => (window as any).__mapmaker.spaceNames() as string[]);
    const named = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].filter((n) => names.includes(n));
    // (True to scale, D208, the inner planets crowd round the Sun from afar: their names make room for one another.)
    assert.ok(named.length >= 5 && names.includes('Jupiter') && names.includes('Neptune'), `the planets named (${names.join(', ')})`);
    assert.match((await page.getByTestId('space-note').textContent()) ?? '', /The Sun and the planets on 1 January 2030/);
    // Half a year on, the Earth is on the other side of the Sun; Neptune has hardly moved.
    const earth0 = await hook<[number, number]>('starToPage', 3), neptune0 = await hook<[number, number]>('starToPage', 8);
    await h.setDate('1 July 2030');
    await page.waitForTimeout(200);
    const earth1 = await hook<[number, number]>('starToPage', 3), neptune1 = await hook<[number, number]>('starToPage', 8);
    const side = (p: [number, number]) => [p[0] - middle[0], p[1] - middle[1]];
    const [a, b] = [side(earth0), side(earth1)];
    assert.ok(a[0] * b[0] + a[1] * b[1] < 0, `the Earth across the Sun after half a year (${earth0} to ${earth1})`);
    // (True to scale, half a year carries the Earth two au across and Neptune about half an au along its orbit.)
    assert.ok(Math.hypot(neptune1[0] - neptune0[0], neptune1[1] - neptune0[1]) < Math.hypot(earth1[0] - earth0[0], earth1[1] - earth0[1]) / 2.5, 'Neptune hardly moved');
    await h.screenshot('solar-system');
    // True to scale: the inner planets close in round the Sun; compressed, further out.
    const marsTrue = await hook<[number, number]>('starToPage', 4);
    // The Sun at its true size (D208): a small dot from afar, growing as it is closed in on.
    const sunFar = await hook<number>('starRadius', 0);
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, zoom: 12 }); });
    await page.waitForTimeout(1500);
    const sunNear = await hook<number>('starRadius', 0);
    assert.ok(sunNear > sunFar * 3, `the Sun grows as it is closed in on (${sunFar} to ${sunNear} pixels)`);
    await h.screenshot('solar-true-scale-close');
    await page.evaluate(() => { const s = (window as any).__mapmaker.store; s.setCamera({ ...s.camera, zoom: 0 }); });
    await page.waitForTimeout(300);
    await page.getByTestId('solar-scale').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.scale === 'compressed'; });
    await page.waitForTimeout(200);
    const marsCompressed = await hook<[number, number]>('starToPage', 4);
    assert.ok(Math.hypot(marsTrue[0] - middle[0], marsTrue[1] - middle[1]) < Math.hypot(marsCompressed[0] - middle[0], marsCompressed[1] - middle[1]) * 0.6, 'Mars nearer the Sun when true to scale');
    // Mars's panel: its distance from the Sun on the date viewed.
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
    await page.waitForTimeout(1500);
    assert.equal(await page.getByTestId('solar-scale').count(), 0, 'no choice of scale side by side');
    // As a poster at first (D208): the Sun's edge at the left, the planets in a row, the dwarf planets below.
    const poster = await Promise.all([0, 3, 4, 5, 8, 9, 101, 102].map((id) => hook<[number, number] | null>('starToPage', id)));
    assert.ok(poster.every((p) => p), 'all drawn, Ceres and Eris too');
    const [psun, pearth, pmars, pjup, pnep, pluto, ceres, eris] = poster as Array<[number, number]>;
    assert.ok(Math.abs(pearth[1] - pjup[1]) < 1 && Math.abs(pnep[1] - pjup[1]) < 1, 'the planets in a row');
    assert.ok(pluto[1] > pjup[1] + 15 && Math.abs(ceres[1] - pluto[1]) < 1 && Math.abs(eris[1] - pluto[1]) < 1, 'the dwarf planets in a row below');
    assert.ok(ceres[0] > pmars[0] && ceres[0] < pjup[0], 'Ceres between Mars and Jupiter');
    assert.ok(psun[0] < pearth[0] - (await hook<number>('starRadius', 0)) * 0.5, 'the Sun\'s disc off to the left');
    assert.ok((await hook<number>('starRadius', 0)) > (await hook<number>('starRadius', 5)) * 6, 'the Sun far larger than Jupiter');
    await h.screenshot('solar-poster');
    // As drawn to read well (D133): the Sun at the left, the planets in a row at even steps, the Moon below the Earth.
    await page.getByTestId('solar-row-open').click();
    await page.getByTestId('solar-row-sizes').selectOption('styled');
    await page.getByTestId('solar-row-moons').selectOption('all');
    await page.locator('[data-testid=solar-row-dialog] .modal-actions button').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.row?.sizes === 'styled'; });
    await page.waitForTimeout(300);
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
    // Side by side as chosen (D192): sizes and distances true to each other, only the Moon and Titan.
    await page.getByTestId('solar-row-open').click();
    await page.getByTestId('solar-row-sizes').selectOption('true');
    await page.getByTestId('solar-row-spacing').selectOption('true');
    await page.getByTestId('solar-row-moons').selectOption('chosen');
    await page.getByTestId('solar-row-moon-Moon').check();
    await page.getByTestId('solar-row-moon-Titan').check();
    await page.locator('[data-testid=solar-row-dialog] .modal-actions button').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; const r = JSON.parse(s.world.get('map_space', s.spaceId).settings).space.row; return r?.chosen?.length === 2; });
    await page.waitForTimeout(300);
    const spaced = await Promise.all([0, 6, 8].map((id) => hook<[number, number]>('starToPage', id)));
    const ratio = (spaced[2][0] - spaced[0][0]) / (spaced[1][0] - spaced[0][0]);
    assert.ok(Math.abs(ratio - 30.07 / 9.537) < 0.08, `Neptune three times as far as Saturn (${ratio.toFixed(2)})`);
    const shownNames = await page.evaluate(() => (window as any).__mapmaker.spaceNames() as string[]);
    assert.ok(shownNames.includes('Titan') && !shownNames.includes('Io'), `only the moons chosen: ${shownNames.filter((n) => ['Io', 'Titan', 'Moon'].includes(n)).join(', ')}`);
    // How large and how far apart (D216): every body twice as large; then Fit screen for the spacing (the row from the
    // Sun to Pluto across the screen, the sizes kept) and for the sizes (as large as they can be without touching).
    const body = async (id: number) => ({ x: (await hook<[number, number]>('starToPage', id))[0], r: (await hook<number>('starRadius', id)) ?? 0 });
    const jupiter0 = (await body(5)).r;
    await page.getByTestId('solar-row-open').click();
    await page.getByTestId('solar-row-size').fill(String(Math.round(Math.log10(2) * 100)));
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return Math.abs(JSON.parse(s.world.get('map_space', s.spaceId).settings).space.row.scale - 2) < 0.01; });
    await page.waitForTimeout(200);
    assert.ok(Math.abs((await body(5)).r / jupiter0 - 2) < 0.05, 'twice as large');
    await page.getByTestId('solar-row-gap-fit').click();
    await page.waitForTimeout(300);
    const box = (await page.getByTestId('map-canvas').boundingBox())!;
    const sunB = await body(0), plutoB = await body(9);
    assert.ok(sunB.x - sunB.r >= box.x - 1 && plutoB.x + plutoB.r <= box.x + box.width + 1, `the row on the screen (${sunB.x - sunB.r} to ${plutoB.x + plutoB.r} in ${box.x} to ${box.x + box.width})`);
    assert.ok((plutoB.x + plutoB.r) - (sunB.x - sunB.r) > box.width * 0.85, 'across the screen');
    assert.ok(Math.abs((await body(5)).r / jupiter0 - 2) < 0.05, 'the sizes kept');
    await page.getByTestId('solar-row-size-fit').click();
    await page.waitForTimeout(300);
    const inRow = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(body));
    for (let i = 1; i < inRow.length; i++) assert.ok(inRow[i - 1].x + inRow[i - 1].r <= inRow[i].x - inRow[i].r + 0.5, `bodies ${i - 1} and ${i} apart`);
    await h.screenshot('solar-row-fitted');
    await page.locator('[data-testid=solar-row-dialog] .modal-actions button').click();
    // The planets as photographed (D191): chosen in the look, credited.
    await page.getByTestId('space-look').click();
    await page.getByTestId('sky-photo').check();
    await page.getByTestId('sky-photo-credit').waitFor();
    assert.match((await page.getByTestId('sky-photo-credit').textContent()) ?? '', /Solar System Scope.*CC BY 4\.0/);
    await page.locator('[data-testid=sky-look-dialog] .close').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look.photo === true; });
    await page.waitForTimeout(1500);
    await h.screenshot('solar-photographic');
    // The looks by kind (D217): basic, charts, photographic; through a telescope, the Sun a blazing point of light.
    await page.getByTestId('space-look').click();
    for (const k of ['basic', 'chart', 'photo']) await page.getByTestId(`sky-kind-${k}`).waitFor();
    assert.equal(await page.getByTestId('sky-kind-photo').getByTestId('sky-preset-photo-telescope').count(), 1);
    assert.equal(await page.getByTestId('sky-kind-chart').getByTestId('sky-preset-chart-antique').count(), 1);
    const sunDisc = (await hook<number>('starRadius', 0)) ?? 0;
    await page.getByTestId('sky-preset-photo-telescope').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.look.sunAsStar === true; });
    assert.ok(await page.getByTestId('sky-sunAsStar').isChecked());
    await page.locator('[data-testid=sky-look-dialog] .close').click();
    await page.waitForTimeout(400);
    const sunStar = (await hook<number>('starRadius', 0)) ?? 0;
    assert.ok(sunStar > 0 && sunStar < sunDisc * 0.6, `the Sun a point of light (${sunStar.toFixed(1)} against ${sunDisc.toFixed(1)})`);
    await h.screenshot('solar-telescope');
    // Back to the orbits.
    await page.getByTestId('solar-layout').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.layout === 'orbits'; });
    await page.getByTestId('solar-scale').waitFor();
    // Undone; back to Earth.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    for (let i = 0; i < 24 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('An invented star map: stars of one\'s own from a seed, made again from the next seed; found by search; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-invented').check();
    await page.getByTestId('new-map-invented-note').waitFor();
    await page.getByTestId('new-map-invented-count').fill('150');
    await page.getByTestId('new-map-invented-seed').fill('5');
    await page.getByTestId('new-map-name').fill('The Reach');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
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
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    for (let i = 0; i < 6 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('The Milky Way: the whole galaxy, its arms and places; its picture as a draft, baked at full detail and kept, drawn without the graphics card (D193); the Orion Nebula found and its panel; star systems held in a box by a country; a frame of it; another galaxy of one\'s own; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-milkyway').check();
    assert.match((await page.getByTestId('new-map-galaxy-note').textContent()) ?? '', /33 places/);
    await page.getByTestId('new-map-galaxy-systems').fill('400');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
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
    // The galaxy as a picture (D193): a draft while working, painted in workers; the middle bright, old yellow
    // stars round it, an arm by the Sun bluer than they are.
    await page.waitForFunction(() => (window as any).__mapmaker.galaxyPicture()?.size === 1024, undefined, { timeout: 120000 });
    assert.equal(await page.getByTestId('galaxy-bake').getAttribute('data-state'), 'draft');
    const sunAt = (await page.evaluate(() => (window as any).__mapmaker.starToPage(0))) as [number, number];
    const colours = () => page.evaluate(([mx, my, sx, sy]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      // (The mean colour of a small square, clear of the place's own dot.)
      const at = (px: number, py: number) => { const d = c.getContext('2d')!.getImageData(Math.round((px - r.left) * k) - 4, Math.round((py - r.top) * k) - 4, 9, 9).data; const o = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { o[0] += d[i]; o[1] += d[i + 1]; o[2] += d[i + 2]; } return o.map((v) => v / 81); };
      // (Round the middle: a quarter of the way from the middle to the Sun; the arms: half as far again beyond the Sun.)
      return { middle: at(mx + 10, my + 10), bulge: at(mx + (sx - mx) * 0.2, my + (sy - my) * 0.2), sky: at(r.left + 14, r.top + 14) };
    }, [mid[0], mid[1], sunAt[0], sunAt[1]]);
    const draft = await colours();
    assert.ok(draft.middle[0] > 200 && draft.bulge[0] > draft.bulge[2] * 1.15 && draft.sky[0] + draft.sky[1] + draft.sky[2] < 60, `a bright middle, yellow round it, dark sky (${JSON.stringify(draft)})`);
    await h.screenshot('milky-way');
    // Baked: painted at full detail and kept; the same galaxy, only finer.
    await page.getByTestId('galaxy-baked').check();
    await page.waitForFunction(() => document.querySelector('[data-testid=galaxy-bake]')?.getAttribute('data-state') === 'done', undefined, { timeout: 600000 });
    assert.deepEqual(await page.evaluate(() => { const p = (window as any).__mapmaker.galaxyPicture(); return [p.size, p.baked]; }), [4096, true]);
    assert.match((await page.getByTestId('galaxy-bake').textContent()) ?? '', /Baked at full detail/);
    await page.waitForTimeout(150);
    const baked = await colours();
    for (const part of ['middle', 'bulge'] as const) for (let c = 0; c < 3; c++) assert.ok(Math.abs(baked[part][c] - draft[part][c]) < 45, `baked, the same galaxy at ${part} (${JSON.stringify(baked)} against ${JSON.stringify(draft)})`);
    await h.screenshot('milky-way-baked');
    // Kept on this computer for the next time.
    await page.waitForFunction(() => new Promise((resolve) => { const r = indexedDB.open('mapmaker-galaxies', 1); r.onsuccess = () => { try { const q = r.result.transaction('pictures').objectStore('pictures').count(); q.onsuccess = () => resolve(q.result >= 1); q.onerror = () => resolve(false); } catch { resolve(false); } }; r.onerror = () => resolve(false); }), undefined, { timeout: 120000 });
    // Without the graphics card the picture is drawn in pieces: the same to the eye.
    await page.evaluate(() => { const m = (window as any).__mapmaker; m.setGalaxyGL(false); m.store.setCamera({ ...m.store.camera, zoom: m.store.camera.zoom + 0.0001 }); });
    await page.waitForTimeout(250);
    const pieces = await colours();
    await page.evaluate(() => { const m = (window as any).__mapmaker; m.setGalaxyGL(true); m.store.setCamera({ ...m.store.camera, zoom: 0 }); });
    for (const part of ['middle', 'bulge'] as const) for (let c = 0; c < 3; c++) assert.ok(Math.abs(pieces[part][c] - baked[part][c]) < 30, `in pieces, the same picture at ${part} (${JSON.stringify(pieces)} against ${JSON.stringify(baked)})`);
    assert.ok(pieces.sky[0] + pieces.sky[1] + pieces.sky[2] < 60);
    // A draft again (the baked picture stays kept), and baked again at once.
    await page.getByTestId('galaxy-baked').uncheck();
    await page.waitForFunction(() => (window as any).__mapmaker.galaxyPicture()?.size === 1024);
    await page.getByTestId('galaxy-baked').check();
    await page.waitForFunction(() => (window as any).__mapmaker.galaxyPicture()?.baked === true);
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
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
    await page.waitForFunction(() => /A galaxy of your own · 600 star systems/.test(document.querySelector('[data-testid=space-note]')?.textContent ?? ''));
    await page.getByTestId('galaxy-again').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return JSON.parse(s.world.get('map_space', s.spaceId).settings).space.galaxy.seed === 4; });
    await h.screenshot('galaxy-own');
    // Undone; back to Earth.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    for (let i = 0; i < 14 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('How the stars look (D130, D131, D132): presets from their pictures, any part changed, a look by chance; the map as a flat chart, moved and turned; realms as territories, a front where two at war meet; stars twinkling in a shot, an SVG frame of it; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-stars').check();
    await page.getByTestId('new-map-name').fill('Looks');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
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
    await page.locator('.list-panel .row', { hasText: 'Solar Compact' }).first().click();
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
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    for (let i = 0; i < 30 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space'))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.kind === 'space')), false);
  });

  await h.step('The Earth through geological time (D134): made from the New map dialog; Pangaea 250 million years ago, its moment named; dates as how long ago; the seas of the last ice age lower, more land; a frame of it exported; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-paleo').check();
    assert.match((await page.getByTestId('new-map-paleo-note').textContent()) ?? '', /540 million years ago to today/);
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.getByTestId('studio-history').click(); // (made in Map Studio, D235; drawn on in History)
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
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    for (let i = 0; i < 8 && (await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => JSON.parse(m.settings).paleo))); i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => JSON.parse(m.settings).paleo)), false);
    await h.setDate('1900');
  });

  await h.step('Playing history: the date moves on at the speed chosen, pauses where it is, Space plays and pauses, going round at the end; the date shown stays still as it changes', async () => {
    await page.getByTestId('studio-history').click();
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
    await h.goto('shots');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.historyPlay.on), false);
    await page.getByTestId('studio-history').click();
    await page.evaluate((t) => (window as any).__mapmaker.store.setTime(t), was);
  });

  await h.step('Importing borders: two GeoJSON maps of their years; their dates from the names; the first the starting map, the second the changes at its date; countries going on by name; a shot of the whole history in one click; undone', async () => {
    await page.getByTestId('studio-history').click();
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
    await h.goto('shots');
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
    await page.getByTestId('studio-history').click();
    // Undone: one step for each map.
    for (let i = 0; i < 2; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('entity').some((e: any) => e.name === 'Kingdom of Wester')), false);
  });

  await h.step('Importing a dataset that dates each shape: its from and to properties found, the history at once (a country splitting, another only for a while), one undo step', async () => {
    await page.getByTestId('studio-history').click();
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

  await h.step('The planetary engine (D152): a stage run in workers from the interface returns a picture; the same bytes from one worker as from three; made once, then reused; a change it does not read reuses it, one it reads does not', async () => {
    const r = await page.evaluate(async () => {
      const P = (window as any).__mapmaker.bench.planet;
      const earth = P.definitionFromPreset('earthlike');
      const first = await P.preview(earth, { level: 5, width: 256, height: 128 });
      const again = await P.preview(earth, { level: 5, width: 256, height: 128 });
      const plates = { ...earth, tectonics: { ...earth.tectonics, plates: 20 } };
      const samePicture = await P.preview(plates, { level: 5, width: 256, height: 128 });
      const tilted = await P.preview({ ...earth, body: { ...earth.body, tiltDeg: 60 } }, { level: 5, width: 256, height: 128 });
      const one = await P.preview(earth, { level: 5, width: 256, height: 128, workers: 1 });
      const three = await P.preview(earth, { level: 5, width: 256, height: 128, workers: 3 });
      return { first, again, samePicture, tilted, one, three };
    });
    assert.equal(r.first.cached, false);
    assert.ok(Math.abs(r.first.equator - 416) < 5, `the equator's yearly sunlight (${r.first.equator})`);
    assert.ok(Math.abs(r.first.pole - 173) < 5, `the pole's (${r.first.pole})`);
    assert.ok(Math.abs(r.first.min - r.first.pole) < 2 && Math.abs(r.first.max - 416) < 3, 'least at the poles, most at the equator');
    assert.equal(r.again.cached, true, 'made once, then reused');
    assert.equal(r.samePicture.cached, true, 'the number of plates does not change the sunlight');
    assert.equal(r.tilted.cached, false, 'the tilt does');
    assert.ok(r.tilted.pole > r.first.pole + 50, 'more tilt, more sunlight at the poles over the year');
    assert.equal(r.one.workers, 1);
    assert.equal(r.three.workers, 3);
    assert.equal(r.one.hash, r.first.hash, 'one worker gives the same bytes');
    assert.equal(r.three.hash, r.first.hash, 'three workers give the same bytes');
  });

  await h.step('Plate tectonics (D153): a planet\'s history run in a worker from the interface; its heights now and 100 million years ago, its plates; the same from one worker as from two', async () => {
    const r = await page.evaluate(async () => {
      const P = (window as any).__mapmaker.bench.planet;
      const o = { level: 4, width: 192, height: 96, durationMyr: 100, frameEveryMyr: 50 };
      const now = await P.preview('earthlike', { ...o, layer: 'elevation' });
      const then = await P.preview('earthlike', { ...o, layer: 'elevation', frame: 0 });
      const plates = await P.preview('earthlike', { ...o, layer: 'plates' });
      const crust = await P.preview('earthlike', { ...o, layer: 'crust' });
      const one = await P.preview('earthlike', { ...o, layer: 'elevation', workers: 1 });
      return { now, then, plates, crust, one };
    });
    assert.ok(r.now.min < -3000 && r.now.max > 500, `deep sea and land (${r.now.min} to ${r.now.max} m)`);
    assert.notEqual(r.then.hash, r.now.hash, 'the planet 100 million years ago is not the planet now');
    assert.equal(r.plates.cached, false);
    // (Plates split and new ones form as the history goes on, D154.)
    assert.ok(r.plates.min >= 0 && r.plates.max < 250 && Number.isInteger(r.plates.max), `plates by number (${r.plates.min}..${r.plates.max})`);
    assert.ok(r.crust.min >= 1 && r.crust.max <= 3, `oceanic, continental and arc crust (${r.crust.min}..${r.crust.max})`);
    assert.equal(r.one.hash, r.now.hash, 'the same history in another worker');
  });

  await h.step('The Planet Studio (D156): a simulated planet from the New map dialog; a preset explained; a slider moved and what follows; its history simulated in workers, its relief and plates through time; used for a map whose land and sea follow the history on its timeline; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByRole('button', { name: '+ Map' }).click();
    await page.getByTestId('new-map-sim').check();
    assert.match((await page.getByTestId('new-map-sim-note').textContent()) ?? '', /Planet Studio opens/);
    await page.getByTestId('new-map-name').fill('Testa Prime');
    await page.getByTestId('new-map-create').click();
    await page.getByTestId('planet-studio').waitFor();
    const text = async (id: string) => (await page.getByTestId(id).textContent()) ?? '';
    // A preset, explained; what follows from it.
    await page.getByTestId('studio-preset-young-volcanic').click();
    assert.match(await text('studio-explain'), /billion years old/);
    assert.match(await text('studio-readout-year'), /^365\.\d days$/);
    assert.match(await text('studio-readout-interior'), /moving plates/);
    // Farther from the star: less sunlight, colder; the slider says why.
    const degrees = async () => Number((await text('studio-readout-temperature')).match(/^(-?[\d,]+) °C/)![1].replace(',', ''));
    const warm = await degrees();
    await page.getByTestId('studio-step-star').click();
    await page.getByTestId('studio-control-distance').fill('700');
    assert.match(await text('studio-explain'), /Farther from the star, less light/);
    assert.ok(await degrees() < warm - 10, `colder farther out (${await degrees()} °C from ${warm})`);
    assert.match(await text('studio-readout-year'), /days$/);
    assert.ok(await page.getByTestId('studio-orbit').isVisible(), 'the orbit over the habitable zone');
    await page.getByTestId('studio-control-distance').fill('630');
    // A value the physics works out, set by hand (D164): the year, with Kepler's beside it; then given back.
    const kepler = await text('studio-readout-year');
    await page.getByTestId('studio-override-year-on').check();
    await page.getByTestId('studio-override-year-value').fill('400');
    assert.match(await text('studio-readout-year'), /^400\.0 days \(set by hand; Kepler's law gives [\d,]+\.\d\)$/);
    assert.match(await text('studio-override-year-natural'), /^the physics gives [\d,]+\.\d days$/);
    assert.match(await text('studio-override-year'), /set by hand/);
    await page.getByTestId('studio-override-year-on').uncheck();
    assert.equal(await text('studio-readout-year'), kepler);
    // A shorter history, for the test: 200 million years.
    await page.getByTestId('studio-step-history').click();
    await page.getByTestId('studio-control-span').fill('408');
    assert.equal(await text('studio-value-span'), '200');
    // Simulated in workers: the relief of today, then the plates, then the plates 200 million years ago.
    await page.getByTestId('studio-simulate').click();
    const drawn = (prefix: string) => page.waitForFunction((p) => ((document.querySelector('[data-testid=studio-canvas]') as HTMLCanvasElement)?.dataset.drawn ?? '').startsWith(p), prefix, { timeout: 180_000 });
    await drawn('elevation:');
    assert.match(await text('studio-when'), /^Today/);
    assert.match(await text('studio-legend'), /Height above the sea/);
    await h.screenshot('planet-studio-relief');
    await page.getByTestId('studio-layer').selectOption('plates');
    await drawn('plates:');
    await page.getByTestId('studio-frame').fill('0');
    await drawn('plates:0:');
    // With the sea's level then, from the ocean's water (D159).
    assert.match(await text('studio-when'), /^200 million years ago · sea (as today|[\d,]+ m (higher|lower))/);
    const colours = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=studio-canvas]') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<string>();
      for (let k = 0; k < d.length; k += 4 * 97) seen.add(`${d[k]},${d[k + 1]},${d[k + 2]}`);
      return seen.size;
    });
    assert.ok(colours >= 6, `plates in their colours (${colours})`);
    // That moment's own climate and life (D167): its biomes and its land seen from space, worked out from the climate
    // it had over its own land and sea; a layer kept for today alone says so. Then back to today.
    await page.getByTestId('studio-layer').selectOption('biome');
    await drawn('biome:0:');
    assert.match(await text('studio-legend'), /^200 million years ago: Biomes: [a-z ,]+…$/);
    assert.match(await text('studio-past-note'), /that moment's own/);
    await page.getByTestId('studio-layer').selectOption('satellite');
    await drawn('satellite:0:');
    assert.match(await text('studio-legend'), /^The land 200 million years ago seen from space: its biomes/);
    await h.screenshot('planet-studio-past-biomes');
    await page.getByTestId('studio-layer').selectOption('koppen');
    await drawn('koppen:');
    assert.match(await text('studio-legend'), /^Today's \(this layer is worked out for the present alone\): Köppen-Geiger climates/);
    await page.getByTestId('studio-frame').fill('8');
    assert.match(await text('studio-when'), /^Today/);
    // Today's climate over today's land and sea (D157): the year's mean, and the first and seventh months.
    await page.getByTestId('studio-layer').selectOption('temperature');
    await drawn('temperature:-1:');
    assert.match(await text('studio-legend'), /^Temperature at the surface: -?\d+ °C to \d+ °C/);
    await page.getByTestId('studio-layer').selectOption('temperatureMonth');
    await page.getByTestId('studio-month').selectOption('6');
    await drawn('temperatureMonth:6:');
    // Rain over the year (D158).
    await page.getByTestId('studio-layer').selectOption('precipitation');
    await drawn('precipitation:');
    assert.match(await text('studio-legend'), /Rain and snow over the year: \d+ to [\d,]+ mm/);
    // Today's water: lakes, rivers, wetlands and ice (D159); and the sea's level shown with each moment.
    await page.getByTestId('studio-layer').selectOption('water');
    await drawn('water:');
    assert.match(await text('studio-legend'), /salt lakes/);
    // Today's biomes (D160): Köppen's climates, the biomes, the land seen from space; plants after a red dwarf's light.
    await page.getByTestId('studio-layer').selectOption('koppen');
    await drawn('koppen:');
    assert.match(await text('studio-legend'), /Köppen-Geiger climates: .*Af/);
    await page.getByTestId('studio-layer').selectOption('satellite');
    await drawn('satellite:-1:');
    assert.match(await text('studio-legend'), /^Today's land seen from space/);
    const green = await page.evaluate(() => (document.querySelector('[data-testid=studio-canvas]') as HTMLCanvasElement).dataset.drawn);
    await page.getByTestId('studio-step-life').click();
    await page.getByTestId('studio-control-vegetation').selectOption('red-dwarf');
    await page.waitForFunction((was) => { const d = (document.querySelector('[data-testid=studio-canvas]') as HTMLCanvasElement).dataset.drawn ?? ''; return d.startsWith('satellite:') && d !== was; }, green, { timeout: 60_000 });
    assert.match(await text('studio-legend'), /a red dwarf: dark red/);
    await page.getByTestId('studio-control-vegetation').selectOption('earth');
    await page.getByTestId('studio-step-explore').click();
    // Why is this here? (D161): a place clicked, explained.
    const box = (await page.getByTestId('studio-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.getByTestId('studio-card').waitFor({ timeout: 60_000 });
    assert.match(await text('studio-card'), /The ground[\s\S]*Plates[\s\S]*Climate/);
    await h.screenshot('planet-studio-why');
    // Edits with their geological explanation, gathered and then worked out together (D163): volcanic islands from a
    // hotspot placed at a point 100 million years ago and a crater 30 million years ago wait in a list with what
    // follows; nothing runs until the one re-run, which goes on from the history's checkpoint before the earlier of
    // them; the crust they made shown as edited; before and after side by side.
    await page.getByTestId('studio-step-edit').click();
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.6);
    await page.waitForFunction(() => /Place: /.test(document.querySelector('[data-testid=studio-edit-place]')?.textContent ?? ''));
    await page.getByTestId('studio-edit-kind').selectOption('hotspot');
    await page.getByTestId('studio-edit-when').fill('100');
    await page.getByTestId('studio-edit-add').click();
    const placed = await text('studio-edit-place');
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.waitForFunction((was) => (document.querySelector('[data-testid=studio-edit-place]')?.textContent ?? '') !== was, placed);
    await page.getByTestId('studio-edit-kind').selectOption('crater');
    await page.getByTestId('studio-edit-when').fill('30');
    await page.getByTestId('studio-edit-add').click();
    assert.equal(await page.getByTestId('studio-pending-edit').count(), 2);
    assert.match(await text('studio-pending'), /Volcanoes grow where the plate passes over the plume[\s\S]*A basin with a raised rim/);
    // The crater is made on the crust clicked on today's map, where its plate had it 30 million years ago (D164).
    if (await page.getByTestId('studio-edit-moved').count()) assert.match(await text('studio-edit-moved'), /^ Made where the crust clicked on the map of today was 30 million years ago: [\d.]+° [NS], [\d.]+° [EW], [\d,]+ km from there/);
    // Each with its consequences estimated in numbers from the history shown (D164).
    assert.equal(await page.getByTestId('studio-estimate').count(), 2);
    assert.match(await text('studio-pending'), /The plate there moves[\s\S]*Volcanic rockabout [\d,.]+( million)? km³[\s\S]*A basinabout [\d,]+ km across and [\d,]+ m deep at first/);
    assert.match(await text('studio-stale'), /2 edits are waiting/);
    assert.equal(await page.getByTestId('studio-progress').count(), 0, 'nothing is worked out before the re-run');
    assert.match(await text('studio-rerun'), /these 2 edits/);
    await page.getByTestId('studio-rerun').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=studio-progress]') && !document.querySelector('[data-testid=studio-stale]'), null, { timeout: 180_000 });
    const resumedAt = Number((await text('studio-resumed')).match(/went on from (\d+) million years ago/)?.[1]);
    assert.ok(resumedAt >= 100 && resumedAt < 150, `went on from the checkpoint before the hotspot (${resumedAt} Ma)`);
    assert.equal(await page.getByTestId('studio-pending').count(), 0);
    // What the edits made, measured against the history before them (D164).
    await page.getByTestId('studio-consequences').waitFor({ timeout: 180_000 });
    assert.equal(await page.getByTestId('studio-consequence').count(), 2);
    assert.match(await text('studio-consequences'), /Highest ground within [\d,]+ km( of [\d.]+° [NS], [\d.]+° [EW])?-?[\d,]+ m → -?[\d,]+ m/);
    assert.match(await text('studio-consequences'), /\(estimated\)/);
    assert.match(await text('studio-consequences-planet'), /Land today[\d.]+ → [\d.]+ % of the surface[\s\S]*Crust the edits made, today[\d,.]+( million)? km²/);
    await page.getByTestId('studio-step-explore').click();
    await page.getByTestId('studio-layer').selectOption('provenance');
    await drawn('provenance:');
    const edited = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=studio-canvas]') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let k = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] === 240 && d[i + 1] === 150 && d[i + 2] === 40) k++;
      return k;
    });
    assert.ok(edited > 0, `the crust the edit made, in orange (${edited} pixels)`);
    await page.getByTestId('studio-compare').check();
    await page.waitForFunction(() => ((document.querySelector('[data-testid=studio-canvas-before]') as HTMLCanvasElement)?.dataset.drawn ?? '').startsWith('provenance:'), null, { timeout: 60_000 });
    await h.screenshot('planet-studio-edit');
    await page.getByTestId('studio-compare').uncheck();
    // Used for a map: its land and sea follow the history on its timeline.
    await page.getByTestId('studio-use').click();
    await page.getByTestId('planet-studio').waitFor({ state: 'detached' });
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return !!s.terrainOf(s.world.get('map_space', s.spaceId)); }, null, { timeout: 180_000 });
    await page.waitForFunction(() => /Today · Testa Prime, simulated/.test(document.querySelector('[data-testid=sim-note]')?.textContent ?? ''));
    const r = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, space = s.world.get('map_space', s.spaceId);
      const now = s.terrainOf(space, m.bench.gregorian.parse('2000').instant), then = s.terrainOf(space, m.bench.gregorian.parse('150 Ma').instant);
      let differ = 0;
      for (let k = 0; k < now.grid.data.length; k += 13) if (now.grid.data[k] !== then.grid.data[k]) differ++;
      let land = 0;
      for (let k = 0; k < now.grid.data.length; k++) if (now.grid.data[k] > 0) land++;
      return { name: space.name, radius: space.radius_m, keys: [now.key, then.key], differ, land: land / now.grid.data.length, start: s.timeline.start };
    });
    assert.equal(r.name, 'Testa Prime');
    assert.equal(r.radius, 6371000);
    assert.notEqual(r.keys[0], r.keys[1], 'another moment, other land and sea');
    assert.ok(r.differ > 100, 'the planet 150 million years ago differs');
    assert.ok(Math.abs(r.land - 0.2) < 0.08, `the sea where the planet has it (${r.land.toFixed(2)} land)`);
    assert.ok(r.start < -1.9e8, 'the timeline reaches back over the history');
    // Its land seen from space through its history (D167): today's biomes; 150 million years ago, that moment's own
    // (made when an earlier moment is first shown); 140 million years ago, the pictures either side blended.
    const covers = () => {
      const m = (window as any).__mapmaker, s = m.store, space = s.world.get('map_space', s.spaceId);
      const at = (when: string) => s.coverOf(space, s.terrainOf(space, m.bench.gregorian.parse(when).instant))?.key ?? null;
      return [at('2000'), at('150 Ma'), at('140 Ma')] as Array<string | null>;
    };
    // (Until the pictures either side of 140 million years ago are both made, the nearer stands in.)
    await page.waitForFunction(`(${covers.toString()})().every((k) => k !== null) && /:0\\.\\d+$/.test((${covers.toString()})()[2])`, null, { timeout: 180_000 });
    const keys = await page.evaluate(`(${covers.toString()})()`) as string[];
    assert.equal(new Set(keys).size, 3, `three covers: ${keys.join(', ')}`);
    assert.match(keys[2], /:0\.\d+$/, 'blended between two pictures');
    await h.screenshot('planet-studio-map');
    // Opened again, its settings are the map's.
    await page.getByTestId('studio-map').click(); // (the map's setting-up is Map Studio's, D235)
    await page.locator('[data-testid^="map-row-"].sel').click(); // (the map itself in Properties)
    await page.getByTestId('open-planet-studio').click();
    await page.getByTestId('planet-studio').waitFor();
    await page.getByTestId('studio-step-air').click();
    assert.equal(await text('studio-value-ocean'), '0.80');
    await page.getByTestId('studio-close').click();
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('map_space').some((m: any) => m.name === 'Testa Prime')), false);
    await page.getByTestId('studio-history').click();
  });

  await h.step('The studios: each page its own panels; panels dock, float, close and open again, resize; Save and Reset workspace (D196, D234)', async () => {
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    // The layout as it reads: rows (a|b) and columns (a/b) of groups [x,y]; floating windows after +.
    const sig = () => page.evaluate(() => {
      const r = (n: any): string => (n.kind === 'stack' ? `[${n.panels.join(',')}]` : `(${n.children.map(r).join(n.dir === 'row' ? ' | ' : ' / ')})`);
      const l = (window as any).__mapmaker.store.dockNow();
      return r(l.root) + l.floats.map((f: any) => ` + {${f.panels.join(',')}}`).join('');
    });
    const LISTS = '[layers,countries,places,areas,events,maps,effects]';
    const FIRST = `(([tools] | ${LISTS} | [viewer] | ([properties] / [looks])) / [timebar])`;
    /** A tab carried by the pointer to a point (the drop mark shown on the way), let go there. */
    const carry = async (panel: string, to: { x: number; y: number }, ctrl = false) => {
      const t = await box(`[data-testid="dock-tab-${panel}"]`);
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.width / 2 + 12, t.y + t.height / 2 + 12, { steps: 3 });
      if (ctrl) await page.keyboard.down('Control');
      await page.mouse.move(to.x, to.y, { steps: 8 });
      const marked = await page.getByTestId('dock-drop-mark').count();
      await page.mouse.up();
      if (ctrl) await page.keyboard.up('Control');
      return marked;
    };
    // History, as it is at first: the tool strip, the lists as tabs of one group, the map, Properties; under them one line
    // of time, the time bar (D244).
    await page.getByTestId('studio-history').click();
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-original-layout').click();
    assert.equal(await store('s.pageNow()'), 'history');
    assert.equal(await sig(), FIRST);
    assert.equal(Math.round((await box('[data-testid="dock-stack-timebar"]')).height), 84);
    assert.equal(await page.locator('.timeline').count(), 0, 'no timeline: organising events is the Timeline studio\'s work');
    assert.equal(Math.round((await box('[data-testid="dock-stack-properties"]')).width), 310);
    // One list at a time, by its tab.
    assert.equal(await page.locator('.list-panel').count(), 1, 'only the list in front is drawn');
    await page.getByTestId('dock-tab-events').click();
    await page.locator('.list-panel[data-list="events"]').waitFor();
    assert.equal(await page.locator('.list-panel').count(), 1);
    await page.getByTestId('dock-tab-countries').click();
    await page.locator('.list-panel[data-list="countries"]').waitFor();
    await h.screenshot('studio-history');
    // Timeline: the timeline in the middle, all its height; a small map over the studio's own panels, Groups in front
    // (D241); no tools to draw with (the map only chooses).
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('reset-workspace').click();
    assert.equal(await store('s.pageNow()'), 'timeline');
    assert.equal(Math.round((await box('[data-testid="dock-stack-viewer"]')).height), 200);
    assert.ok((await box('[data-testid="dock-stack-timeline-event-table-event-outline"]')).height > 2 * (await box('[data-testid="dock-stack-viewer"]')).height, 'the timeline (with the table, D242) takes the room');
    assert.equal(await page.getByTestId('tool-strip').count(), 0);
    assert.equal(await page.getByTestId('options-bar').count(), 0);
    assert.equal(await store('s.tool'), 'select');
    await page.getByTestId('groups-panel').waitFor();
    // Map Studio: the maps in front; the map's own settings in Properties.
    await page.getByTestId('studio-map').click();
    await page.getByTestId('reset-workspace').click();
    await page.locator('[data-testid^="map-row-"].sel').click();
    await page.getByTestId('map-setup').waitFor();
    assert.equal(await page.locator('.list-panel [data-testid="open-calendar"]').count(), 0);
    if (await page.getByTestId('map-setup').getByTestId('open-calendar').count()) {
      await page.getByTestId('map-setup').getByTestId('open-calendar').click();
      await page.locator('.modal').waitFor();
      await page.evaluate(() => (window as any).__mapmaker.store.set({ dialog: null }));
    }
    await h.screenshot('studio-map');
    // Looks: the lists, the map and Properties, no tools; a tool taken in History comes back on returning there.
    await page.getByTestId('studio-history').click();
    await h.chooseTool('lasso');
    await page.getByTestId('studio-looks').click();
    assert.equal(await store('s.tool'), 'select');
    assert.equal(await page.getByTestId('tool-strip').count(), 0);
    await page.getByTestId('studio-history').click();
    assert.equal(await store('s.tool'), 'lasso');
    await page.getByTestId('tool-select').click();
    // Presentation: two pages, Shots and Export, each its own layout.
    await h.goto('export');
    assert.equal(await store('s.mode'), 'present');
    assert.equal(await store('s.pageNow()'), 'export');
    await page.locator('[data-testid="dock-stack-export"]').waitFor();
    await page.getByTestId('studio-history').click();
    await page.getByTestId('studio-present').click();
    assert.equal(await store('s.pageNow()'), 'export', 'Presentation opens on the page of it last used');
    await h.goto('shots');
    assert.equal(await store('s.pageNow()'), 'shots');
    await page.getByTestId('studio-history').click();
    assert.equal(await store('s.mode'), 'world');
    // Docking. A tab dropped on another group's tabs joins them, in front.
    const canvas0 = await box('[data-testid="map-canvas"]');
    const lists = await box(`[data-testid="dock-stack-layers-countries-places-areas-events-maps-effects"] .dock-tabs`);
    assert.equal(await carry('properties', { x: lists.x + lists.width - 30, y: lists.y + lists.height / 2 }), 1, 'the drop is marked on the way');
    assert.equal(await sig(), `(([tools] | [layers,countries,places,areas,events,maps,effects,properties] | [viewer] | [looks]) / [timebar])`);
    await page.locator('.properties-panel').waitFor();
    assert.equal(await page.getByTestId('dock-tab-properties').getAttribute('aria-selected'), 'true');
    // (Waited for, not read at once: the layout settles when the browser next lays it out.)
    await page.waitForFunction(() => document.querySelector('[data-testid="dock-stack-looks"]')!.getBoundingClientRect().height > 500, null, { timeout: 5000 }).catch(() => {});
    assert.ok((await box('[data-testid="dock-stack-looks"]')).height > 500, 'the Looks panel takes the whole column it shared');
    void canvas0;
    // Dropped at the bottom edge of the map: a group of its own under the map.
    const map = await box('.viewer-panel');
    await carry('properties', { x: map.x + map.width / 2, y: map.y + map.height - 15 });
    assert.equal(await sig(), `(([tools] | ${LISTS} | ([viewer] / [properties]) | [looks]) / [timebar])`);
    await h.screenshot('dock-under-map');
    // Held with Ctrl, it floats where it is let go; a floating window is moved by its title row and resized by its corner.
    await carry('properties', { x: map.x + 300, y: map.y + 120 }, true);
    assert.equal(await sig(), `(([tools] | ${LISTS} | [viewer] | [looks]) / [timebar]) + {properties}`);
    const f0 = await box('[data-testid="dock-float-properties"]');
    await page.mouse.move(f0.x + f0.width - 40, f0.y + 10);
    await page.mouse.down();
    await page.mouse.move(f0.x + f0.width - 140, f0.y + 70, { steps: 5 });
    await page.mouse.up();
    const f1 = await box('[data-testid="dock-float-properties"]');
    assert.deepEqual([Math.round(f1.x - f0.x), Math.round(f1.y - f0.y)], [-100, 60]);
    const corner = await box('[data-testid="dock-float-properties"] .dock-float-corner');
    await page.mouse.move(corner.x + 6, corner.y + 6);
    await page.mouse.down();
    await page.mouse.move(corner.x + 66, corner.y + 46, { steps: 5 });
    await page.mouse.up();
    const f2 = await box('[data-testid="dock-float-properties"]');
    assert.deepEqual([Math.round(f2.width - f1.width), Math.round(f2.height - f1.height)], [60, 40]);
    await page.getByTestId('dock-tab-countries').click();
    await page.getByTestId(`entity-row-${A}`).click();
    await page.getByTestId('dock-float-properties').getByTestId('entity-panel').waitFor();
    await h.screenshot('dock-floating');
    // Closed by its ×, and opened again from the Window menu: back on its side of the map, as at first.
    await page.getByTestId('dock-close-properties').click();
    assert.equal(await page.locator('.properties-panel').count(), 0);
    await page.getByTestId('menu-window').click();
    assert.doesNotMatch((await page.getByTestId('command-panel-properties').textContent())!, /✓/);
    assert.equal(await page.getByTestId('command-panel-shots').count(), 0, 'only the panels this page can hold');
    await page.getByTestId('command-panel-properties').click();
    await page.locator('.properties-panel').waitFor();
    assert.equal(await sig(), FIRST);
    // Chosen in the Window menu, a panel behind another tab comes to the front; in front, it closes.
    await page.getByTestId('menu-window').click();
    assert.match((await page.getByTestId('command-panel-places').textContent())!, /✓/);
    await page.getByTestId('command-panel-places').click();
    await page.locator('.list-panel[data-list="places"]').waitFor();
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-panel-places').click();
    assert.equal(await sig(), `(([tools] | [layers,countries,areas,events,maps,effects] | [viewer] | ([properties] / [looks])) / [timebar])`);
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-panel-places').click();
    assert.equal(await sig(), FIRST, 'back with the lists it was with');
    // The map cannot be closed: it has no ×.
    assert.equal(await page.getByTestId('dock-close-viewer').count(), 0);
    // The edge between two groups resizes them as it is dragged; the map gives or takes the room.
    const edge = await box('.dock-stack.viewer-stack');
    const props0 = await box('[data-testid="dock-stack-properties"]');
    await page.mouse.move(props0.x - 2, props0.y + 200);
    await page.mouse.down();
    await page.mouse.move(props0.x - 62, props0.y + 200, { steps: 4 });
    await page.mouse.up();
    assert.equal(Math.round((await box('[data-testid="dock-stack-properties"]')).width), 370, 'Properties 60 wider');
    assert.equal(Math.round((await box('.dock-stack.viewer-stack')).width), Math.round(edge.width) - 60);
    // Save workspace keeps the page's layout; Reset workspace returns to it; Original layout to the first one.
    await page.getByTestId('save-workspace').click();
    await page.getByTestId('dock-close-timebar').click();
    assert.equal(await page.locator('.timebar').count(), 0);
    await page.getByTestId('reset-workspace').click();
    await page.locator('.timebar').waitFor();
    assert.equal(Math.round((await box('[data-testid="dock-stack-properties"]')).width), 370, 'as saved');
    // Kept on this computer: the layout worked in and the one saved, page by page.
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('mapmaker.docks')!));
    assert.ok(kept.history.saved && kept.history.live && kept.timeline.live, 'both kept');
    assert.equal(kept.map.saved, null, 'Map Studio has none saved');
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-original-layout').click();
    assert.equal(Math.round((await box('[data-testid="dock-stack-properties"]')).width), 310, 'the first layout');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mapmaker.docks')!).history.saved), null);
    // The status bar says what the tool in hand does.
    await h.chooseTool('lasso');
    assert.match((await page.getByTestId('status-hint').textContent())!, /^Territory brush \(B\) · Draw around an area/);
    await page.getByTestId('tool-select').click();
    await h.screenshot('studio-history-first');
    // (Every list open at once again for the steps after this one.)
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('Map Studio (D235): New map opens its gallery of every kind of map; the map made there; the ground\'s tools and the map\'s setting-up are Map Studio\'s', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const tools = () => page.locator('[data-testid="tool-strip"] [data-testid^="tool-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')).filter((t) => !t!.startsWith('tool-stack')));
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const earth = await store('s.spaceId') as string;
    // History draws history: no terrain tool; Map Studio makes the ground: Select and the terrain, nothing else.
    assert.ok(!(await tools()).includes('tool-sculpt') && (await tools()).includes('tool-lasso'));
    await page.getByTestId('studio-map').click();
    assert.deepEqual(await tools(), ['tool-select', 'tool-sculpt']);
    await page.getByTestId('studio-history').click();
    // Map › New map…: Map Studio, its gallery in front, the kinds of map by family.
    await page.getByTestId('menu-map').click();
    await page.getByTestId('command-new-map').click();
    await page.getByTestId('map-gallery').waitFor();
    assert.equal(await store('s.pageNow()'), 'map');
    assert.equal(await page.getByTestId('dock-tab-gallery').getAttribute('aria-selected'), 'true');
    assert.deepEqual(await page.locator('.map-gallery-section h4').allTextContents(), ['Planets', 'Ready-made places', 'Flat', 'Space']);
    assert.ok(await page.locator('.map-card').count() >= 12, 'every kind of map');
    // A card chosen shows its own settings.
    await page.getByTestId('new-map-flat').check();
    await page.getByTestId('new-map-width').waitFor();
    await page.getByTestId('new-map-planet').check();
    await page.getByTestId('planet-seed').waitFor();
    assert.equal(await page.getByTestId('new-map-width').count(), 0);
    await page.getByTestId('new-map-solar').check();
    await page.getByTestId('new-map-solar-note').waitFor();
    await h.screenshot('map-gallery');
    // A blank world made: it is the map viewed, in front where the gallery was.
    await page.getByTestId('new-map-round').check();
    await page.getByTestId('new-map-name').fill('Gallery world');
    await page.getByTestId('new-map-radius').fill('1200');
    await page.getByTestId('new-map-create').click();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return s.world.get('map_space', s.spaceId)?.name === 'Gallery world'; });
    assert.equal(await page.getByTestId('dock-tab-viewer').getAttribute('aria-selected'), 'true');
    assert.equal(Math.round(await store(`s.world.get('map_space', s.spaceId).radius_m`) as number / 1000), 1200);
    await page.getByTestId('map-canvas').waitFor();
    // The map's setting-up in Properties here, a link to it elsewhere.
    await page.getByTestId('map-row-Gallery world').click();
    await page.getByTestId('map-setup').waitFor();
    await page.getByTestId('studio-history').click();
    assert.equal(await page.getByTestId('map-setup').count(), 0);
    await page.getByTestId('map-setup-in-studio').waitFor();
    // Undone: gone, the Earth viewed again.
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await store(`s.world.all('map_space').some((m) => m.name === 'Gallery world')`), false);
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    assert.equal(await store('s.spaceId'), earth);
  });

  await h.step('The Looks panel (D236): a country\'s colour, fill, look, borders and label there, not in Properties; Design and Ctrl+D bring it to the front; a person\'s marker, a layer\'s and an event\'s looks', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const heads = (sel: string) => page.locator(`${sel} .prop-head`).allTextContents().then((t) => t.map((x) => x.replace(/^[▾▸]/, '').trim()));
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('tool-select').click();
    // A country: what it is in Properties, how it is drawn in the Looks panel.
    await page.getByTestId(`entity-row-${A}`).click();
    await page.getByTestId('looks-entity').waitFor();
    assert.deepEqual(await heads('.looks-panel'), ['Colour and fill', 'Look and borders', 'Label']);
    assert.ok(!(await heads('.properties-panel')).some((t) => /fill|look|label/i.test(t)), 'no looks in Properties');
    assert.equal(await page.getByTestId('entity-panel').getByTestId('country-fill').count(), 0);
    await page.getByTestId('looks-entity').getByTestId('country-fill').waitFor();
    await h.screenshot('looks-panel-country');
    // Its colour changed there (one undo).
    const colour = () => store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(A)}).color`);
    const before = await colour();
    await page.getByTestId('entity-color').fill('#2266aa');
    await h.saved();
    assert.equal(await colour(), '#2266aa');
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await colour(), before);
    // As at first, the Looks panel lies under Properties. Behind it as a tab, Design brings it to the front, and so does Ctrl+D.
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-original-layout').click();
    await page.evaluate(() => { const m = (window as any).__mapmaker, s = m.store, l = s.dockNow(); s.setDock(m.dock.dockPanel(l, 'looks', m.dock.holderOf(l, 'properties').id, 'center')); });
    await page.getByTestId('dock-tab-properties').click();
    assert.equal(await page.locator('.looks-panel').count(), 0, 'behind Properties');
    await page.getByTestId('entity-panel').getByTestId('open-looks').click();
    await page.locator('.looks-panel').waitFor();
    await page.getByTestId('dock-tab-properties').click();
    await page.locator('.viewer-panel').hover();
    await page.keyboard.press('Control+d');
    await page.locator('.looks-panel').waitFor();
    // (Every list open at once again, Looks under Properties, for the rest.)
    await page.evaluate(() => (window as any).__mapmaker.allLists());
    // A person: the marker.
    const person = await store(`s.world.all('entity').find((e) => e.type_id === 'character')?.name ?? null`) as string | null;
    if (person) {
      await page.evaluate((n) => { const s = (window as any).__mapmaker.store; s.set({ selection: { kind: 'entity', id: s.world.all('entity').find((e: any) => e.name === n).id } }); }, person);
      await page.keyboard.press('Control+d');
      await page.getByTestId('looks-entity').waitFor();
      assert.deepEqual(await heads('.looks-panel'), ['Colour', 'Marker']);
    }
    // A layer: its fill, look and borders.
    await page.locator('[data-testid="layer-row"]', { hasText: 'Political' }).locator('span').first().click();
    await page.getByTestId('layer-panel').getByTestId('open-looks').click();
    await page.getByTestId('looks-layer').getByTestId('layer-fill').waitFor();
    assert.deepEqual(await heads('.looks-panel'), ['Fill and look', 'Borders and front lines']);
    // An event: its changes as they animate.
    const ev = (await page.locator('.list-panel [data-testid^="event-row-"]').first().getAttribute('data-testid'))!;
    await page.getByTestId(ev).click();
    await page.getByTestId('event-panel').getByTestId('open-looks').click();
    await page.getByTestId('looks-event').getByTestId('event-look').waitFor();
    // Nothing chosen: what the panel is for.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    assert.match((await page.getByTestId('looks-panel').textContent())!, /how it is drawn is set here/);
    // In a studio without the Looks panel (Map Studio), Design opens the Looks studio.
    await page.getByTestId(`entity-row-${A}`).click();
    await page.getByTestId('studio-map').click();
    await page.keyboard.press('Control+d');
    assert.equal(await store('s.pageNow()'), 'looks');
    await page.getByTestId('looks-entity').waitFor();
    await h.screenshot('looks-studio');
    await page.getByTestId('studio-history').click();
    // (Every list open at once again for the steps after this one.)
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('Groups\' looks (D237): a group chosen by its row; its colour, effects and label settings laid over its members\' as an adjustment layer, each member\'s own winning; one member changed alone; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('tool-select').click();
    await h.setDate('1650');
    await page.evaluate(([a, b]) => (window as any).__mapmaker.store.setCamera({ lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, zoom: 1.5, rotation: 0, projection: 'equirectangular' }), [P.a, P.b]);
    const before = await steps();
    const styleOf = (n: string) => page.evaluate((x) => JSON.parse((window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === x).style || '{}'), n);
    for (const n of [A, B]) { const st = await styleOf(n); assert.ok(!st.fill && !st.look, `${n}: no fill or look of its own to begin with`); }
    // Chosen by its row in the Countries list: what it holds in Properties, its looks in the Looks panel.
    await page.getByTestId('entity-group-Main powers').click();
    assert.equal(await store('s.selection.kind'), 'group');
    await page.getByTestId(`group-member-${A}`).waitFor();
    await page.getByTestId(`group-member-${B}`).waitFor();
    await page.getByTestId('looks-group').waitFor();
    // Its members drawn in its colour: of five small patches about a place of each, the clearest (its label, cities and
    // areas drawn over it aside) mostly of that colour.
    const share = (ll: LL, kind: 'magenta' | 'green') => page.evaluate(([lon, lat, kd]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width, R = Math.round(10 * k), D = 36;
      let best = 0;
      for (const [ox, oy] of [[0, 0], [0, D], [0, -D], [D, 0], [-D, 0]]) {
        const d = c.getContext('2d')!.getImageData(Math.round((p[0] + ox - r.left) * k) - R, Math.round((p[1] + oy - r.top) * k) - R, 2 * R + 1, 2 * R + 1).data;
        let n = 0, m = 0;
        for (let i = 0; i < d.length; i += 4) {
          n++;
          if (kd === 'magenta' ? d[i] > 150 && d[i + 1] < 100 && d[i + 2] > 120 : d[i + 1] > 120 && d[i] < 90 && d[i + 2] < 120) m++;
        }
        best = Math.max(best, Math.round((100 * m) / n));
      }
      return best;
    }, [ll[0], ll[1], kind] as const);
    const settle = async (ll: LL, kind: 'magenta' | 'green') => { let v = await share(ll, kind); for (let i = 0; i < 30 && v < 80; i++) { await page.waitForTimeout(100); v = await share(ll, kind); } return v; };
    await page.getByTestId('group-color').fill('#ff00cc');
    await h.saved();
    await page.getByTestId('group-color-members').check();
    await h.saved();
    let v = await settle(P.a, 'magenta');
    assert.ok(v >= 80, `${A} in the group's colour (${v}% of the clearest patch about it)`);
    v = await settle(P.b, 'magenta');
    assert.ok(v >= 80, `${B} too (${v}%)`);
    // One member changed alone: a colour chosen in its Looks wins; the other keeps the group's.
    await page.getByTestId(`group-member-${B}`).click();
    await page.getByTestId('looks-group-note').waitFor();
    await page.getByTestId('entity-color').fill('#00cc44');
    await h.saved();
    v = await settle(P.b, 'green');
    assert.ok(v >= 80, `${B} in its own colour (${v}%)`);
    v = await share(P.a, 'magenta');
    assert.ok(v >= 80, `${A} still in the group's (${v}%)`);
    // And given back the group's (its own kept for when it leaves the group).
    await page.getByTestId('entity-group-color').click();
    await h.saved();
    v = await settle(P.b, 'magenta');
    assert.ok(v >= 80, `${B} in the group's colour again (${v}%)`);
    assert.equal(await store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(B)}).color`), '#00cc44');
    // The group's effects at the same time as a member's own: a stroke for the group, a drop shadow for one of them alone.
    await page.getByTestId('looks-open-group').click();
    await page.getByTestId('looks-group').waitFor();
    await page.getByTestId('group-add-effect').selectOption('stroke');
    await h.saved();
    await page.getByTestId(`group-member-${A}`).click();
    await page.getByTestId('looks-entity').locator('details.country-look > summary').click();
    await page.getByTestId('country-add-effect').selectOption('shadow');
    await h.saved();
    const looks = () => page.evaluate(([a, b]) => { const s = (window as any).__mapmaker.store, id = (n: string) => s.world.all('entity').find((e: any) => e.name === n).id; return JSON.stringify([s.renderer.lastLooks[id(a)] ?? [], s.renderer.lastLooks[id(b)] ?? []]); }, [A, B]);
    for (let i = 0; i < 30 && (await looks()) !== JSON.stringify([['shadow', 'stroke'], ['stroke']]); i++) await page.waitForTimeout(100);
    assert.equal(await looks(), JSON.stringify([['shadow', 'stroke'], ['stroke']]), 'its own shadow and the group\'s stroke; the other, the group\'s stroke');
    // Label settings for every member: capitals; a member's own setting wins.
    const labels = () => page.evaluate(([a, b]) => { const s = (window as any).__mapmaker.store, id = (n: string) => s.world.all('entity').find((e: any) => e.name === n).id; return JSON.stringify([a, b].map((n) => s.renderer.lastLabels.find((l: any) => l.entityId === id(n))?.text ?? null)); }, [A, B]);
    await page.getByTestId('looks-open-group').click();
    await page.getByTestId('group-label').locator('details.own-look > summary').click();
    await page.getByTestId('group-label-uppercase').check();
    await h.saved();
    const caps = JSON.stringify([A.toUpperCase(), B.toUpperCase()]);
    for (let i = 0; i < 30 && (await labels()) !== caps; i++) await page.waitForTimeout(100);
    assert.equal(await labels(), caps, 'both labelled in capitals');
    await page.getByTestId(`group-member-${A}`).click();
    await page.getByTestId('country-label').locator('details.own-look > summary').click();
    await page.getByTestId('country-label-uppercase').uncheck();
    await h.saved();
    const mixed = JSON.stringify([A, B.toUpperCase()]);
    for (let i = 0; i < 30 && (await labels()) !== mixed; i++) await page.waitForTimeout(100);
    assert.equal(await labels(), mixed, 'its own setting wins; the other keeps the group\'s');
    await h.screenshot('group-looks');
    // Undone, step by step: as before.
    for (let i = 0; i < 20 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await store(`s.world.all('entity_group').find((g) => g.name === 'Main powers').style`), '{}');
    for (let i = 0; i < 30 && (await looks()) !== '[[],[]]'; i++) await page.waitForTimeout(100);
    assert.equal(await looks(), '[[],[]]');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
  });

  await h.step('The Effects panel (D238): every effect in folders, found by name; dragged onto a country on the map, into the Looks panel of a group, onto a layer\'s and an event\'s rows; double-clicked for what is chosen; refused where it does not belong; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('tool-select').click();
    await h.setDate('1650');
    await page.evaluate(([a, b]) => (window as any).__mapmaker.store.setCamera({ lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, zoom: 1.5, rotation: 0, projection: 'equirectangular' }), [P.a, P.b]);
    const before = await steps();
    // Opened from the Window menu (it is a tab of the lists at first); here laid under the Looks panel, as anyone may.
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-panel-effects').click();
    await page.getByTestId('effects-panel').waitFor();
    await page.evaluate(() => { const m = (window as any).__mapmaker, s = m.store, l = s.dockNow(); s.setDock(m.dock.dockPanel(l, 'effects', m.dock.holderOf(l, 'looks').id, 'bottom', 300)); });
    await page.getByTestId('effects-panel').waitFor();
    for (const f of ['countries', 'borders', 'labels', 'graphics', 'transitions', 'saved']) await page.getByTestId(`effects-folder-${f}`).waitFor();
    assert.match((await page.getByTestId('effects-folder-saved').textContent())!, /Looks you keep/);
    // Found by name: only the folders with such effects.
    await page.getByTestId('effects-filter').fill('glow');
    assert.deepEqual(await page.locator('.effects-folder').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))), ['effects-folder-countries', 'effects-folder-borders']);
    await page.getByTestId('effects-filter').press('Escape');
    assert.equal(await page.locator('.effects-folder').count(), 6);
    await h.screenshot('effects-panel');
    // Dragged: the effect's name follows the pointer, saying what it would be given to; let go there, given (one step).
    const drag = async (id: string, find: string, to: { x: number; y: number }) => {
      await page.getByTestId('effects-filter').fill(find);
      const it = await box(`[data-testid="effect-${id}"]`);
      await page.mouse.move(it.x + it.width / 2, it.y + it.height / 2);
      await page.mouse.down();
      await page.mouse.move(it.x + it.width / 2 + 12, it.y + it.height / 2 + 8, { steps: 3 });
      await page.mouse.move(to.x, to.y, { steps: 12 });
      const ghost = (await page.getByTestId('effect-ghost').textContent()) ?? '';
      const hover = await store('s.effectHover');
      await page.mouse.up();
      await page.getByTestId('effects-filter').fill('');
      return { ghost, hover };
    };
    const idOf = (n: string) => store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(n)}).id`) as Promise<string>;
    const lookKinds = (n: string) => page.evaluate((x) => (JSON.parse((window as any).__mapmaker.store.world.all('entity').find((e: any) => e.name === x).style || '{}').look?.effects ?? []).map((e: any) => e.kind), n);
    // Onto a country on the map: that country alone, lit while it is over it.
    const [ax, ay] = await h.toPage(P.a);
    const d1 = await drag('countries:shadow', 'drop shadow', { x: ax, y: ay });
    assert.equal(d1.ghost, `Drop shadow → ${A}`);
    assert.equal(d1.hover, await idOf(A), 'the country under it lit');
    await h.saved();
    assert.deepEqual(await lookKinds(A), ['shadow']);
    assert.deepEqual(await lookKinds(B), [], 'only the country it was let go on');
    assert.equal(await store('s.effectHover'), null);
    // Into the Looks panel: what is chosen there, here a group (all of its members, with their own).
    await page.getByTestId('entity-group-Main powers').click();
    await page.getByTestId('looks-group').waitFor();
    const lp = await box('[data-testid="looks-panel"]');
    const d2 = await drag('countries:stroke', 'stroke', { x: lp.x + lp.width / 2, y: lp.y + 40 });
    assert.equal(d2.ghost, 'Stroke → the group “Main powers”');
    await h.saved();
    assert.deepEqual(await store(`JSON.parse(s.world.all('entity_group').find((g) => g.name === 'Main powers').style).look.effects.map((e) => e.kind)`), ['stroke']);
    const looks = () => page.evaluate(([a, b]) => { const s = (window as any).__mapmaker.store, id = (n: string) => s.world.all('entity').find((e: any) => e.name === n).id; return JSON.stringify([s.renderer.lastLooks[id(a)] ?? [], s.renderer.lastLooks[id(b)] ?? []]); }, [A, B]);
    for (let i = 0; i < 30 && (await looks()) !== JSON.stringify([['shadow', 'stroke'], ['stroke']]); i++) await page.waitForTimeout(100);
    assert.equal(await looks(), JSON.stringify([['shadow', 'stroke'], ['stroke']]), 'drawn: the shadow given to one, the group\'s stroke on both');
    // Onto a layer's row: its borders between countries dashed.
    const layerRow = page.locator('[data-testid="layer-row"]', { hasText: 'Political' }).first();
    const layerId = ((await layerRow.getAttribute('data-drop')) ?? '').replace('layer:', '');
    await layerRow.scrollIntoViewIfNeeded();
    const lr = (await layerRow.boundingBox())!;
    const d3 = await drag('borders:dashed', 'dashed', { x: lr.x + lr.width / 2, y: lr.y + lr.height / 2 });
    assert.equal(d3.ghost, 'Dashed → the layer “Political”');
    await h.saved();
    assert.equal(await store(`JSON.parse(s.world.get('layer', ${JSON.stringify(layerId)}).style).borders.between.dash`), 'dashed');
    // Onto an event's row: its changes animate in that look.
    const evRow = page.locator('.list-panel [data-testid^="event-row-"]').first();
    const evName = ((await evRow.getAttribute('data-testid')) ?? '').replace('event-row-', '');
    await evRow.scrollIntoViewIfNeeded();
    const er = (await evRow.boundingBox())!;
    const d4 = await drag('transitions:blitz', 'blitz', { x: er.x + er.width / 2, y: er.y + er.height / 2 });
    assert.equal(d4.ghost, `Blitz → the event “${evName}”`);
    await h.saved();
    assert.equal(await store(`JSON.parse(s.world.all('event').find((e) => e.name === ${JSON.stringify(evName)}).presentation || '{}').look`), 'blitz');
    // Double-clicked: given to what is chosen (here a country's label, in italics).
    await page.getByTestId(`entity-row-${A}`).click();
    await page.getByTestId('effects-filter').fill('italic');
    await page.getByTestId('effect-labels:italic').dblclick();
    await h.saved();
    assert.equal(await store(`JSON.parse(s.world.all('entity').find((e) => e.name === ${JSON.stringify(A)}).style).label.italic`), true);
    // Where it does not belong, nothing is given, and it says what it is for.
    const head = await steps();
    await page.getByTestId('effects-filter').fill('news');
    await page.locator('[data-testid^="effect-graphics:"]').first().dblclick();
    await page.locator('.toast', { hasText: 'is for a shot' }).waitFor();
    assert.equal(await steps(), head, 'nothing given');
    // Let go where no country is: given to nothing, and it says so.
    const spot = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect();
      for (let fy = 0.15; fy < 0.85; fy += 0.05) for (let fx = 0.15; fx < 0.9; fx += 0.05) {
        const x = r.left + fx * r.width, y = r.top + fy * r.height, ll = m.pageToLonLat(x, y);
        if (ll && !s.engine.valueAtPoint(s.spaceId, s.layerId, m.bench.lonLatToVec(ll[0], ll[1]), s.time)) return [x, y] as [number, number];
      }
      return null;
    });
    assert.ok(spot, 'a place held by no one in view');
    const d6 = await drag('countries:bevel', 'bevel', { x: spot![0], y: spot![1] });
    assert.deepEqual([d6.ghost, d6.hover], ['Bevel', null]);
    await page.locator('.toast', { hasText: 'over a country' }).waitFor();
    assert.equal(await steps(), head, 'nothing given');
    await h.screenshot('effects-given');
    // Undone, step by step.
    for (let i = 0; i < 20 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.deepEqual(await lookKinds(A), []);
    // The Looks studio has it from the first (under the Looks panel, D248).
    await page.getByTestId('studio-looks').click();
    await page.getByTestId('reset-workspace').click();
    await page.getByTestId('effects-panel').waitFor();
    await page.getByTestId('studio-history').click();
    // (Every list open at once again for the steps after this one.)
    await page.evaluate(() => (window as any).__mapmaker.allLists());
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
  });

  await h.step('Looks in Presentation (D239): the Looks and Effects panels beside the shot; a country chosen in its preview; a change for this shot only, drawn in it and not on the map worked on; back to everywhere\'s; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('tool-select').click();
    await h.setDate('1650');
    await page.evaluate(([a, b]) => { const s = (window as any).__mapmaker.store; s.set({ selection: null }); s.setCamera({ lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, zoom: 1.5, rotation: 0, projection: 'equirectangular' }); }, [P.a, P.b]);
    const before = await steps();
    const colourOf = (n: string) => store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(n)}).color`) as Promise<string>;
    const own = await colourOf(A);
    // A shot of 1650 over the two countries: the Looks and Effects panels beside it.
    await h.goto('shots');
    await page.getByTestId('new-shot').click();
    await page.getByTestId('shot-editor').waitFor();
    await page.getByTestId('looks-panel').waitFor();
    await page.getByTestId('dock-tab-effects').waitFor();
    await page.waitForTimeout(400);
    // Clicked in the preview: the country there is chosen, its looks in the Looks panel; changes go everywhere at first.
    const qa = (await h.hook<[number, number]>('previewToPage', P.a[0], P.a[1]))!;
    await page.mouse.click(qa[0], qa[1]);
    assert.equal(await store('s.world.get("entity", s.selection.id).name'), A);
    await page.getByTestId('looks-entity').waitFor();
    assert.match((await page.getByTestId('looks-scope-everywhere').getAttribute('class'))!, /\bon\b/);
    // This shot only: its colour changed in the shot alone.
    await page.getByTestId('looks-scope-shot').click();
    await page.getByTestId('entity-color').fill('#00cc44');
    await h.saved();
    const shotId = await store('s.shotId') as string;
    const restyle = () => store(`JSON.parse(s.world.get('sequence', ${JSON.stringify(shotId)}).settings).restyle ?? {}`) as Promise<{ entity?: Record<string, { color?: string }> }>;
    const aId = await store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(A)}).id`) as string;
    assert.equal((await restyle()).entity?.[aId]?.color, '#00cc44', 'kept with the shot');
    assert.equal(await colourOf(A), own, 'the project\'s colour as it was');
    // Drawn so in the preview: the clearest of five small patches about the place mostly green.
    const greenAbout = (x: number, y: number) => page.evaluate(([px, py]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width, R = Math.round(8 * k), D = 30;
      let best = 0;
      for (const [ox, oy] of [[0, 0], [0, D], [0, -D], [D, 0], [-D, 0]]) {
        const d = c.getContext('2d')!.getImageData(Math.round((px + ox - r.left) * k) - R, Math.round((py + oy - r.top) * k) - R, 2 * R + 1, 2 * R + 1).data;
        let n = 0, m = 0;
        for (let i = 0; i < d.length; i += 4) { n++; if (d[i + 1] > 120 && d[i] < 90 && d[i + 2] < 120) m++; }
        best = Math.max(best, Math.round((100 * m) / n));
      }
      return best;
    }, [x, y] as const);
    let g = await greenAbout(qa[0], qa[1]);
    for (let i = 0; i < 30 && g < 80; i++) { await page.waitForTimeout(100); g = await greenAbout(qa[0], qa[1]); }
    assert.ok(g >= 80, `the shot shows it in the colour given it (${g}%)`);
    await page.getByTestId('looks-shot-own').waitFor();
    await h.screenshot('looks-this-shot');
    // The map worked on, in History, keeps the project's colour.
    await page.getByTestId('studio-history').click();
    await page.waitForTimeout(400);
    const qw = await h.toPage(P.a);
    assert.ok((await greenAbout(qw[0], qw[1])) < 20, 'not on the map worked on');
    // Back in the shot: back to everywhere's looks for it.
    await h.goto('shots');
    await page.getByTestId('looks-scope-shot').click();
    await page.getByTestId('looks-shot-clear').click();
    await h.saved();
    assert.equal((await restyle()).entity?.[aId], undefined, 'the shot\'s own looks for it gone');
    assert.equal(await page.getByTestId('looks-shot-own').count(), 0);
    // Everywhere again: a change goes to the project, and so to every shot.
    await page.getByTestId('looks-scope-everywhere').click();
    await page.getByTestId('entity-color').fill('#00cc44');
    await h.saved();
    assert.equal(await colourOf(A), '#00cc44');
    assert.deepEqual(await restyle(), {});
    // Undone, step by step.
    for (let i = 0; i < 20 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await colourOf(A), own);
    await page.getByTestId('studio-history').click();
    // (Every list open at once again for the steps after this one.)
    await page.evaluate(() => (window as any).__mapmaker.allLists());
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, looksScope: 'everywhere' }));
  });

  await h.step('Keys in a shot (D240): a setting of looks keyed at frames, a track of the shot; drawn between its keys; a key moved, held, removed; a number of an effect keyed; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('tool-select').click();
    await h.setDate('1650');
    await page.evaluate(([a, b]) => { const s = (window as any).__mapmaker.store; s.set({ selection: null }); s.setCamera({ lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, zoom: 1.5, rotation: 0, projection: 'equirectangular' }); }, [P.a, P.b]);
    const before = await steps();
    const colourOf = (n: string) => store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(n)}).color`) as Promise<string>;
    const own = await colourOf(A);
    const aId = await store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(A)}).id`) as string;
    await h.goto('shots');
    await page.getByTestId('new-shot').click();
    await page.getByTestId('shot-editor').waitFor();
    await page.getByTestId('looks-panel').waitFor();
    await page.waitForTimeout(400);
    const shotId = await store('s.shotId') as string;
    const last = (await store(`JSON.parse(s.world.get('sequence', s.shotId).settings).frames`) as number) - 1;
    const keys = () => store(`(JSON.parse(s.world.get('sequence', ${JSON.stringify(shotId)}).settings).keys ?? []).map((t) => ({ label: t.label, keys: t.keys }))`) as Promise<Array<{ label: string; keys: Array<{ frame: number; value: string | number; ease: string }> }>>;
    const qa = (await h.hook<[number, number]>('previewToPage', P.a[0], P.a[1]))!;
    await page.mouse.click(qa[0], qa[1]);
    await page.getByTestId('looks-entity').waitFor();
    assert.equal(await page.getByTestId('entity-color-key').count(), 0, 'no keys for changes that go everywhere');
    await page.getByTestId('looks-scope-shot').click();
    // Frame 1: the colour keyed (◇ pressed), then changed in its field: the key takes the new value.
    assert.equal(await store('s.shotFrame'), 0);
    await page.getByTestId('entity-color-key').click();
    await h.saved();
    await page.getByTestId('shot-keys').waitFor();
    assert.equal(await page.getByTestId('key-diamond').count(), 1);
    await page.getByTestId('entity-color').fill('#cc0000');
    await h.saved();
    assert.deepEqual((await keys())[0].keys, [{ frame: 0, value: '#cc0000', ease: 'linear' }]);
    assert.match((await page.getByTestId('entity-color-key').getAttribute('class'))!, /\bhere\b/);
    // The last frame, chosen along the track: changed there, a second key.
    const lane = page.getByTestId('key-lane').first();
    const lb = (await lane.boundingBox())!;
    await page.mouse.click(lb.x + lb.width - 1, lb.y + lb.height / 2);
    await page.waitForFunction((f) => (window as any).__mapmaker.store.shotFrame === f, last);
    await page.waitForTimeout(300);
    assert.doesNotMatch((await page.getByTestId('entity-color-key').getAttribute('class'))!, /\bhere\b/, 'keyed, no key at this frame');
    await page.getByTestId('entity-color').fill('#00cc44');
    await h.saved();
    assert.deepEqual((await keys())[0].keys.map((k) => [k.frame, k.value]), [[0, '#cc0000'], [last, '#00cc44']]);
    assert.equal(await colourOf(A), own, 'the project\'s colour as it was');
    assert.equal(await page.getByTestId('key-diamond').count(), 2);
    assert.match((await page.getByTestId('key-track').getAttribute('data-name'))!, new RegExp(`${A} · Colour`));
    // Drawn so: green at the last frame, red at the first, between the two halfway.
    const share = (x: number, y: number, want: 'red' | 'green') => page.evaluate(([px, py, w]) => {
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width, R = Math.round(8 * k), D = 30;
      let best = 0;
      for (const [ox, oy] of [[0, 0], [0, D], [0, -D], [D, 0], [-D, 0]]) {
        const d = c.getContext('2d')!.getImageData(Math.round(((px as number) + ox - r.left) * k) - R, Math.round(((py as number) + oy - r.top) * k) - R, 2 * R + 1, 2 * R + 1).data;
        let n = 0, m = 0;
        for (let i = 0; i < d.length; i += 4) { n++; if (w === 'green' ? d[i + 1] > 120 && d[i] < 90 && d[i + 2] < 120 : d[i] > 120 && d[i + 1] < 90 && d[i + 2] < 90) m++; }
        best = Math.max(best, Math.round((100 * m) / n));
      }
      return best;
    }, [x, y, want] as const);
    const shows = async (want: 'red' | 'green') => { let v = await share(qa[0], qa[1], want); for (let i = 0; i < 30 && v < 80; i++) { await page.waitForTimeout(100); v = await share(qa[0], qa[1], want); } return v; };
    assert.ok((await shows('green')) >= 80, 'green at the last frame');
    await h.screenshot('keys-in-shot');
    await page.mouse.click(lb.x + 1, lb.y + lb.height / 2);
    await page.waitForFunction(() => (window as any).__mapmaker.store.shotFrame === 0);
    assert.ok((await shows('red')) >= 80, 'red at the first');
    const mid = Math.round(last / 2);
    await page.evaluate((f) => (window as any).__mapmaker.store.set({ shotFrame: f }), mid);
    const halfway = await store(`s.lookWorld.get('entity', ${JSON.stringify(aId)}).color`) as string;
    const ch = (h0: string, i: number) => parseInt(h0.slice(i, i + 2), 16);
    assert.ok(Math.abs(ch(halfway, 1) - 0xcc * (1 - mid / last)) <= 2 && Math.abs(ch(halfway, 3) - 0xcc * (mid / last)) <= 2, `mixed between its keys (${halfway})`);
    // The last key dragged to the middle of the shot.
    const diamonds = page.getByTestId('key-diamond');
    const db = (await diamonds.nth(1).boundingBox())!;
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(lb.x + lb.width * 0.75, lb.y + lb.height / 2, { steps: 6 });
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2, { steps: 6 });
    await page.mouse.up();
    await h.saved();
    const moved = (await keys())[0].keys;
    assert.equal(moved.length, 2);
    assert.ok(Math.abs(moved[1].frame - last / 2) <= 2, `moved to the middle (${moved[1].frame})`);
    // The first key held until the next: halfway to it, still red.
    await diamonds.first().click({ button: 'right' });
    await page.getByTestId('key-ease-hold').click();
    await h.saved();
    assert.equal((await keys())[0].keys[0].ease, 'hold');
    await page.evaluate((f) => (window as any).__mapmaker.store.set({ shotFrame: f }), Math.round(moved[1].frame / 2));
    assert.equal(await store(`s.lookWorld.get('entity', ${JSON.stringify(aId)}).color`), '#cc0000');
    // A key chosen and Delete: gone.
    await diamonds.nth(1).click();
    await page.keyboard.press('Delete');
    await h.saved();
    assert.equal((await keys())[0].keys.length, 1);
    // A number of an effect keyed: a drop shadow given in this shot, its distance keyed, a second track.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ shotFrame: 0 }));
    const look = page.locator('[data-testid=looks-entity] details.country-look');
    if (!(await look.evaluate((d) => (d as HTMLDetailsElement).open))) await look.locator('summary').click();
    await page.getByTestId('country-add-effect').selectOption('shadow');
    await h.saved();
    await page.getByTestId('country-shadow-distance-key').click();
    await h.saved();
    assert.equal(await page.getByTestId('key-track').count(), 2);
    assert.match((await keys())[1].label, /Look · Drop shadow · Distance/);
    // Stopped animating: the colour's track gone with its key.
    await page.getByTestId('key-track-remove').first().click();
    await h.saved();
    assert.equal(await page.getByTestId('key-track').count(), 1);
    // Undone, step by step.
    for (let i = 0; i < 30 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await colourOf(A), own);
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.allLists());
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, looksScope: 'everywhere' }));
  });

  await h.step('The Timeline studio\'s own panels (D241): groups made, renamed, hidden and deleted; a type; a branch made and left; a statistic; elsewhere the dialogs; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    // In History, Event types… opens its dialog (no Types panel there).
    await page.evaluate(() => (window as any).__mapmaker.allLists());
    await page.getByTestId('open-event-types').click();
    await page.getByTestId('event-types-dialog').waitFor();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ dialog: null }));
    // The Timeline studio: its own panels under a small map.
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('reset-workspace').click();
    await page.getByTestId('groups-panel').waitFor();
    // A group made, renamed, hidden from the timeline and shown again, then deleted (its events stay).
    await page.getByTestId('gp-new-name').fill('Campaigns');
    await page.getByTestId('gp-new-create').click();
    await h.saved();
    await page.getByTestId('gp-row-Campaigns').waitFor();
    await page.getByTestId('gp-rename-Campaigns').click();
    await page.getByTestId('gp-rename').fill('Wars');
    await page.getByTestId('gp-rename').press('Enter');
    await h.saved();
    await page.getByTestId('gp-row-Wars').waitFor();
    const gid = await store(`s.world.all('event_group').find((g) => g.name === 'Wars').id`) as string;
    await page.getByTestId('gp-show-Wars').uncheck();
    assert.ok(!((await store('s.eventFilter')) as string[]).includes(gid), 'hidden from the timeline and the lists');
    await page.getByTestId('gp-show-Wars').check();
    assert.equal(await store('s.eventFilter'), null);
    await page.getByTestId('gp-delete-Wars').click();
    await h.saved();
    assert.equal(await page.getByTestId('gp-row-Wars').count(), 0);
    await h.screenshot('timeline-studio-groups');
    // A type, in the Types panel.
    await page.getByTestId('dock-tab-types').click();
    await page.getByTestId('types-panel').waitFor();
    await page.getByTestId('types-panel').getByTestId('new-type-name').fill('Siege');
    await page.getByTestId('types-panel').getByTestId('new-type-create').click();
    await h.saved();
    await page.getByTestId('type-row-Siege').waitFor();
    // Event types… here brings the panel to the front, no dialog.
    await page.getByTestId('dock-tab-groups').click();
    await page.evaluate(() => (window as any).__mapmaker.store.panelOrDialog('types', 'event-types'));
    await page.getByTestId('types-panel').waitFor();
    assert.equal(await page.getByTestId('event-types-dialog').count(), 0);
    // A branch made from the date viewed: viewed at once; the main timeline viewed again.
    await page.getByTestId('dock-tab-branches').click();
    await page.getByTestId('branches-panel').getByTestId('new-branch-name').fill('What if');
    await page.getByTestId('branches-panel').getByTestId('new-branch-make').click();
    await h.saved();
    const bid = await store(`s.world.all('branch').find((b) => b.name === 'What if').id`) as string;
    assert.equal(await store('s.branch'), bid);
    await page.getByTestId('branches-panel').locator('[data-testid^="branch-view-"]').first().click();
    assert.notEqual(await store('s.branch'), bid);
    // A statistic of the map, saved.
    await page.getByTestId('dock-tab-statistics').click();
    await page.getByTestId('statistics-panel').getByTestId('statistic-add').click();
    const n = await page.getByTestId('statistics-panel').locator('[data-testid^="statistic-name-"]').count();
    await page.getByTestId(`statistic-name-${n - 1}`).fill('Army');
    await page.getByTestId('statistics-panel').getByTestId('statistics-save').click();
    await h.saved();
    assert.ok(((await store(`JSON.parse(s.world.get('map_space', s.spaceId).settings || '{}').statistics ?? []`)) as Array<{ name: string }>).some((x) => x.name === 'Army'), 'kept with the map');
    // Undone, step by step.
    for (let i = 0; i < 20 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await store(`s.world.all('branch').filter((b) => b.name === 'What if').length`), 0);
    await page.getByTestId('dock-tab-groups').click();
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('The table of events (D242): a list read from a file, planned under its group; a name and a date changed in place; two events moved together; the table written as a file; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('reset-workspace').click();
    await page.getByTestId('dock-tab-event-table').click();
    await page.getByTestId('event-table').waitFor();
    const evOf = (name: string) => store(`(() => { const e = s.world.all('event').find((x) => x.name === ${JSON.stringify(name)}); return e ? { start: e.start_day, end: e.end_day, id: e.id } : null; })()`) as Promise<{ start: number; end: number | null; id: string } | null>;
    const day = (text: string) => page.evaluate((t) => (window as any).__mapmaker.bench.gregorian.parse(t).instant.day, text) as Promise<number>;
    // A list of two events read from a CSV file: planned (nothing drawn), the first under a group made for it.
    await page.getByTestId('et-import').setInputFiles({ name: 'story.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Starts,Ends,Type,Groups\nSiege of Sel,1350,1351,,Campaigns\nTreaty of Sel,1 June 1356,24 June 1356,,\n') });
    await h.saved();
    await page.getByTestId('et-row-Siege of Sel').waitFor();
    await page.getByTestId('et-chapter-Campaigns').waitFor();
    assert.match((await page.getByTestId('et-row-Treaty of Sel').textContent())!, /to draw/, 'planned: nothing drawn yet');
    assert.equal((await evOf('Treaty of Sel'))!.end, await day('24 June 1356'));
    // A name changed in place, then its start.
    await page.getByTestId('et-row-Treaty of Sel').locator('td.et-name').dblclick();
    await page.getByTestId('et-edit-name').fill('Peace of Sel');
    await page.getByTestId('et-edit-name').press('Enter');
    await h.saved();
    await page.getByTestId('et-row-Peace of Sel').locator('td.et-date').first().dblclick();
    await page.getByTestId('et-edit-start').fill('2 June 1356');
    await page.getByTestId('et-edit-start').press('Enter');
    await h.saved();
    assert.equal((await evOf('Peace of Sel'))!.start, await day('2 June 1356'));
    await h.screenshot('event-table');
    // The two chosen (a click, then Ctrl+click) and moved ten years later together, each keeping its length.
    await page.getByTestId('et-row-Siege of Sel').locator('td.et-groups').click();
    await page.getByTestId('et-row-Peace of Sel').locator('td.et-groups').click({ modifiers: ['Control'] });
    assert.equal(((await store('s.chosen("event")')) as string[]).length, 2);
    await page.getByTestId('et-shift').click();
    await page.getByTestId('et-shift-n').fill('10');
    await page.getByTestId('et-shift-apply').click();
    await h.saved();
    assert.equal((await evOf('Siege of Sel'))!.start, await day('1360'));
    assert.equal((await evOf('Siege of Sel'))!.end, await day('1361'));
    assert.equal((await evOf('Peace of Sel'))!.end, await day('24 June 1366'));
    // The table written as a CSV file: read back, it holds them.
    await page.evaluate(() => { const w = window as any; w.__urlOf = URL.createObjectURL; URL.createObjectURL = (b: Blob) => { w.__lastBlob = b; return w.__urlOf(b); }; });
    await page.getByTestId('et-export').click();
    const csv = await page.evaluate(async () => { const w = window as any; URL.createObjectURL = w.__urlOf; return (await w.__lastBlob.text()) as string; });
    assert.match(csv, /^Name,Starts,Ends,Type,Groups\n/);
    assert.match(csv, /\nPeace of Sel,2 June 1366,24 June 1366,/);
    assert.match(csv, /\nSiege of Sel,1360,1361,[^,]*,Campaigns\n/);
    // Undone, step by step.
    for (let i = 0; i < 20 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await evOf('Siege of Sel'), null);
    assert.equal(await page.getByTestId('et-row-Siege of Sel').count(), 0);
    await page.getByTestId('dock-tab-timeline').click();
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, multi: null }));
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('Planned events (D243): a new event by a double-click on empty time, planned and dashed; a shot made of it; Draw in History records into it; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('reset-workspace').click();
    await page.getByTestId('timeline').waitFor();
    // A double-click on empty time, under the tracks: a new event there, planned (nothing recorded into it here).
    const tb = (await page.getByTestId('timeline').boundingBox())!;
    await page.mouse.dblclick(tb.x + tb.width / 2, tb.y + tb.height - 30);
    await page.getByTestId('event-name').waitFor();
    const at = await store('s.time.day') as number;
    await page.getByTestId('event-name').fill('Siege of Sel');
    await page.getByTestId('event-create').click();
    await h.saved();
    const id = await store(`s.world.all('event').find((e) => e.name === 'Siege of Sel').id`) as string;
    assert.equal(await store(`s.world.get('event', ${JSON.stringify(id)}).start_day`), at, 'at the date double-clicked');
    assert.equal(await store('s.recordEventId'), null, 'no recording in the Timeline studio');
    await page.getByTestId('event-planned').waitFor();
    assert.equal(await page.getByTestId('record-event').count(), 0, 'no drawing here: Draw in History instead');
    await h.screenshot('planned-event');
    // Make a shot of it: Presentation, a shot named for it over its time.
    await page.getByTestId('make-shot').click();
    await h.saved();
    assert.equal(await store('s.pageNow()'), 'shots');
    const shot = await store(`(() => { const r = s.world.get('sequence', s.shotId); const st = JSON.parse(r.settings); return { name: r.name, from: st.time[0].at[0] }; })()`) as { name: string; from: number };
    assert.deepEqual(shot, { name: 'Siege of Sel', from: at });
    // Back in the Timeline studio, Draw in History: History in front, recording into it.
    await page.getByTestId('studio-timeline').click();
    await page.evaluate((e) => (window as any).__mapmaker.store.set({ selection: { kind: 'event', id: e } }), id);
    await page.getByTestId('draw-in-history').click();
    assert.equal(await store('s.pageNow()'), 'history');
    assert.equal(await store('s.recordEventId'), id);
    assert.notEqual(await store('s.tool'), 'select', 'a drawing tool in hand');
    await page.getByTestId('recording').waitFor();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ recordEventId: null, tool: 'select' }));
    // Undone, step by step.
    for (let i = 0; i < 10 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await store(`s.world.all('event').filter((e) => e.name === 'Siege of Sel').length`), 0);
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('History\'s time bar (D244): one line of time under the map; the event drawn into chosen there; the date moved along its strip, zoomed and fitted; history played without the timeline; Open Timeline; the timeline opened from the Window menu over it; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    // As at first: under the map and the panels beside it, the time bar, the width of the window; no timeline.
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-original-layout').click();
    await page.getByTestId('timebar').waitFor();
    assert.equal(await page.locator('.timeline').count(), 0);
    const bar = (await page.getByTestId('dock-stack-timebar').boundingBox())!, map = (await page.locator('.viewer-panel').boundingBox())!;
    assert.ok(bar.y >= map.y + map.height - 1 && bar.width > map.width + 300, 'under the map, as wide as the window');
    await h.screenshot('history-time-bar');
    // A new event from the bar: recorded into at once (History draws), the bar saying so.
    await page.getByTestId('timebar-new-event').click();
    await page.getByTestId('event-name').fill('Treaty of Sel');
    await page.getByTestId('event-create').click();
    await h.saved();
    const id = await store(`s.world.all('event').find((e) => e.name === 'Treaty of Sel').id`) as string;
    assert.equal(await store('s.recordEventId'), id);
    assert.equal(await page.getByTestId('timebar-record').inputValue(), id);
    await page.locator('.tb-record.on').waitFor();
    // The strip: the changes near the date (yellow ticks), the event recorded into; seen whole by a double-click.
    const strip = page.getByTestId('timebar-strip');
    assert.equal(await strip.getAttribute('data-event'), id);
    await strip.dblclick();
    const fitted = await store('JSON.stringify(s.timeline)') as string;
    assert.equal(await store('(s.fitTimeline(), JSON.stringify(s.timeline))'), fitted, 'the whole history');
    /** The colour of the strip's pixel (it is drawn at one pixel to a pixel here). */
    const pixel = (x: number, y: number) => page.evaluate(([px, py]) => {
      const el = document.querySelector('[data-testid="timebar-strip"]') as HTMLCanvasElement;
      return [...el.getContext('2d')!.getImageData(Math.round(px), Math.round(py), 1, 1).data.slice(0, 3)];
    }, [x, y]);
    const yellow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timebar-strip"]') as HTMLCanvasElement;
      const d = el.getContext('2d')!.getImageData(0, 12, el.width, 1).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && Math.abs(d[i + 1] - 209) < 12 && Math.abs(d[i + 2] - 102) < 12) n++;
      return n;
    });
    if (await store('s.engine.changeInstants().length')) assert.ok(yellow > 0, 'the changes as ticks');
    // Recording into none, from the bar; then into the event again: from its start, the date being outside it.
    await page.getByTestId('timebar-record').selectOption('');
    assert.equal(await store('s.recordEventId'), null);
    assert.equal(await page.getByTestId('recording').count(), 0);
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.waitForFunction(() => document.querySelector('[data-testid="timebar-strip"]')!.getAttribute('data-event') === '');
    const start = await store(`s.world.get('event', ${JSON.stringify(id)}).start_day`) as number;
    await page.evaluate((d) => { const s = (window as any).__mapmaker.store; s.setTime({ day: d - 4000, ms: 0 }); }, start);
    await page.getByTestId('timebar-record').selectOption(id);
    assert.equal(await store('s.recordEventId'), id);
    assert.equal(await store('s.time.day'), start, 'to its start');
    assert.notEqual(await store('s.tool'), 'select', 'a drawing tool in hand');
    await page.getByTestId('recording').waitFor();
    // The wheel zooms about the pointer; a click moves the date there (Alt: not drawn to a change nearby).
    const sb = (await strip.boundingBox())!;
    const span = async () => (await store('s.timeline.end - s.timeline.start')) as number;
    const s0 = await span();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction((v) => { const t = (window as any).__mapmaker.store.timeline; return t.end - t.start < v; }, s0);
    const s1 = await span();
    assert.ok(Math.abs(s1 / s0 - 0.8) < 1e-6, `zoomed in: ${s1 / s0}`);
    await page.keyboard.down('Alt');
    await page.mouse.click(sb.x + sb.width * 0.25, sb.y + sb.height / 2);
    const d1 = await store('s.time.day') as number;
    await page.mouse.click(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
    const d2 = await store('s.time.day') as number;
    await page.keyboard.up('Alt');
    const want = 0.5 * s1 * 365.2425;
    assert.ok(Math.abs(d2 - d1 - want) <= Math.max(2, want * 0.01), `half the strip apart: ${d2 - d1} days, not ${want}`);
    // The date drawn as a red line where it was clicked (the pointer gone, so as not to show the date under it).
    await page.mouse.move(sb.x + sb.width / 2, sb.y - 200);
    await page.waitForTimeout(100);
    const cols = await Promise.all([-2, -1, 0, 1].map((k) => pixel(sb.width * 0.75 + k, 2)));
    assert.ok(cols.some(([r, g, b]) => r > 240 && Math.abs(g - 93) < 16 && Math.abs(b - 108) < 16), `the date's line: ${JSON.stringify(cols)}`);
    // History plays from the bar, the timeline closed (the app plays it, not the timeline).
    const speed = await store('s.historyPlay.yearsPerSecond') as number;
    await page.getByTestId('history-speed').selectOption('1');
    const t0 = await store('s.time.day') as number;
    await page.getByTestId('history-play').click();
    await page.waitForFunction((d) => (window as any).__mapmaker.store.time.day > d + 30, t0, { timeout: 10_000 });
    await page.getByTestId('history-play').click();
    assert.equal(await store('s.historyPlay.on'), false);
    // Open Timeline: the Timeline studio.
    await page.getByTestId('open-timeline').click();
    assert.equal(await store('s.pageNow()'), 'timeline');
    await page.getByTestId('studio-history').click();
    // The full timeline opened from the Window menu: under the map, over the time bar.
    await page.getByTestId('menu-window').click();
    assert.doesNotMatch((await page.getByTestId('command-panel-timeline').textContent())!, /✓/);
    await page.getByTestId('command-panel-timeline').click();
    await page.locator('.timeline').waitFor();
    const tl = (await page.getByTestId('dock-stack-timeline').boundingBox())!, bar2 = (await page.getByTestId('dock-stack-timebar').boundingBox())!;
    assert.ok(tl.y + tl.height <= bar2.y + 1 && Math.round(tl.height) === 190, 'over the time bar');
    assert.equal(await page.locator('.dock-float').count(), 0, 'not floating');
    await h.screenshot('history-time-bar-and-timeline');
    await page.getByTestId('dock-close-timeline').click();
    // Undone, step by step.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ recordEventId: null, tool: 'select', selection: null }));
    for (let i = 0; i < 10 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await store(`s.world.all('event').filter((e) => e.name === 'Treaty of Sel').length`), 0);
    await page.evaluate((v) => { const s = (window as any).__mapmaker.store; s.set({ historyPlay: { ...s.historyPlay, yearsPerSecond: v } }); }, speed);
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('Several events at once on the timeline (D245): chosen by Ctrl+click and a Ctrl box; dragged together; stretched by their span on the ruler; Move everything after; a shot of them; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('reset-workspace').click();
    await page.getByTestId('timeline').waitFor();
    // Three raids a year long, three years apart, in a group of their own, after all the history there is (so that
    // moving everything after the first moves only them); the timeline showing 2495 to 2515.
    const ids = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, g = m.bench.gregorian, Y = (y: number) => g.fromCivil({ year: y, month: 1, day: 1 });
      return s.execute((wd: unknown) => m.bench.commands.importEvents(wd, [2500, 2503, 2507].map((y, i) => ({ name: `Raid ${'ABC'[i]}`, start: Y(y), end: Y(y + 1), groups: ['Raids'] }))));
    }) as string[];
    await h.saved();
    const [A, B, C] = ids;
    await page.evaluate(() => (window as any).__mapmaker.store.set({ timeline: { start: 2495, end: 2515 }, timelineSnap: true, timelineRipple: false }));
    const canvas = (await page.getByTestId('timeline').boundingBox())!;
    type Bar = { ids: string[]; x0: number; x1: number; lane: number };
    const laid = () => store('s.timelineLaid') as Promise<{ tracks: Array<{ id: string; y: number; bars: Bar[] }>; top: number; span: [number, number] | null }>;
    /** Where an event's bar is, on the page: its middle, its ends. */
    const barOf = async (id: string) => {
      const l = await laid();
      for (const t of l.tracks) for (const b of t.bars) if (b.ids.length === 1 && b.ids[0] === id) {
        const y = canvas.y + l.top + t.y + 3 + b.lane * 20 + 7;
        return { x: canvas.x + (b.x0 + b.x1) / 2, x0: canvas.x + b.x0, x1: canvas.x + b.x1, y };
      }
      throw new Error(`no bar for ${id}`);
    };
    const dates = (id: string) => store(`(() => { const e = s.world.get('event', ${JSON.stringify(id)}); return [e.start_day, e.end_day]; })()`) as Promise<[number, number]>;
    const chosen = async () => ((await store(`s.chosen('event')`)) as string[]).slice().sort();
    const daysPerPx = (20 * 365.2425) / canvas.width;
    const drag = async (from: { x: number; y: number }, dx: number) => {
      await page.keyboard.down('Alt');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + dx / 2, from.y, { steps: 4 });
      await page.mouse.move(from.x + dx, from.y, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await h.saved();
    };
    // A click chooses one; Ctrl+click adds another.
    const a0 = await dates(A), b0 = await dates(B), c0 = await dates(C);
    const pa = await barOf(A), pb = await barOf(B);
    await page.mouse.click(pa.x, pa.y);
    await page.keyboard.down('Control');
    await page.mouse.click(pb.x, pb.y);
    await page.keyboard.up('Control');
    assert.deepEqual(await chosen(), [A, B].sort());
    // One of them dragged: both moved by as much, to the day, in one undo step; the third stays.
    await drag(pa, 60);
    const a1 = await dates(A), b1 = await dates(B);
    const moved = a1[0] - a0[0];
    assert.ok(Math.abs(moved - 60 * daysPerPx) <= 3 * daysPerPx, `moved by sixty pixels of time: ${moved} days, ${60 * daysPerPx} expected`);
    assert.deepEqual([a1[1] - a0[1], b1[0] - b0[0], b1[1] - b0[1]], [moved, moved, moved], 'the other chosen with it, each keeping its length');
    assert.deepEqual(await dates(C), c0);
    assert.match(await store('s.journal.undoLabel') as string, /^Move 2 events/);
    await page.getByTestId('undo').click();
    await h.saved();
    assert.deepEqual([await dates(A), await dates(B)], [a0, b0], 'one undo step');
    // A box drawn with Ctrl over empty time takes in all three; their span shows on the ruler.
    const pc = await barOf(C);
    await page.keyboard.down('Control');
    await page.mouse.move(pa.x0 - 20, pa.y - 8);
    await page.mouse.down();
    await page.mouse.move(pc.x1 + 20, pa.y + 8, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    assert.deepEqual(await chosen(), [A, B, C].sort());
    await page.waitForFunction(() => !!(window as any).__mapmaker.store.timelineLaid?.span);
    const span = (await laid()).span!;
    assert.ok(span && Math.abs(canvas.x + span[0] - pa.x0) < 2 && Math.abs(canvas.x + span[1] - pc.x1) < 2, `the span from the first start to the last end: ${span}`);
    await h.screenshot('timeline-several-chosen');
    // Its end on the ruler dragged as far again: the three stretched about the first start, twice as long and as far apart.
    const width = span[1] - span[0];
    await drag({ x: canvas.x + span[1], y: canvas.y + 22 - 5 }, width);
    const a2 = await dates(A), b2 = await dates(B), c2 = await dates(C);
    const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 4 * daysPerPx + 2, `${what}: ${got} days, ${want} expected`);
    assert.equal(a2[0], a0[0], 'the first start stays');
    near(c2[1] - a0[0], 2 * (c0[1] - a0[0]), 'the last end twice as far');
    near(b2[0] - a0[0], 2 * (b0[0] - a0[0]), 'the second start twice as far');
    near(a2[1] - a2[0], 2 * (a0[1] - a0[0]), 'each twice as long');
    assert.match(await store('s.journal.undoLabel') as string, /^Stretch 3 events/);
    await page.getByTestId('undo').click();
    await h.saved();
    assert.deepEqual([await dates(A), await dates(B), await dates(C)], [a0, b0, c0], 'one undo step');
    // Move everything after: the first alone dragged, the two after it go with it.
    await page.mouse.click(pa.x, pa.y);
    assert.deepEqual(await chosen(), [A]);
    await page.getByTestId('timeline-ripple').click();
    assert.match((await page.getByTestId('timeline-ripple').textContent())!, /on/);
    await drag(pa, 40);
    const d = (await dates(A))[0] - a0[0];
    assert.ok(d > 0);
    assert.deepEqual([(await dates(B))[0] - b0[0], (await dates(C))[0] - c0[0], (await dates(C))[1] - c0[1]], [d, d, d], 'those after it by as much');
    assert.match(await store('s.journal.undoLabel') as string, /^Move "Raid A", and the 2 events after it$/);
    await page.getByTestId('undo').click();
    await h.saved();
    assert.deepEqual([await dates(A), await dates(B), await dates(C)], [a0, b0, c0], 'one undo step');
    await page.getByTestId('timeline-ripple').click();
    assert.equal(await store('s.timelineRipple'), false);
    // Right-click on one of several chosen: their menu, with a shot of them all.
    await page.evaluate((list) => (window as any).__mapmaker.store.set({ multi: { kind: 'event', ids: list }, selection: { kind: 'event', id: list[2] } }), ids);
    await page.mouse.click(pb.x, pb.y, { button: 'right' });
    await page.getByTestId('menu-shot-of-events').click();
    await h.saved();
    assert.equal(await store('s.pageNow()'), 'shots');
    const shot = await store(`(() => { const r = s.world.get('sequence', s.shotId); const st = JSON.parse(r.settings); return { name: r.name, from: st.time[0].at[0] }; })()`) as { name: string; from: number };
    assert.deepEqual(shot, { name: 'Raid A to Raid C', from: a0[0] });
    // Undone, step by step.
    await page.getByTestId('studio-timeline').click();
    for (let i = 0; i < 10 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await store(`s.world.all('event').filter((e) => e.name.startsWith('Raid ')).length`), 0);
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, multi: null }));
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('The map\'s calendar in the Timeline studio (D246): a tab among its own panels; a calendar of its own used there and the dates written in it; changes discarded; the Gregorian again; in Map Studio its dialog; undone', async () => {
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const dateIs = async (v: string) => {
      await page.waitForFunction((x) => (document.querySelector('[data-testid=current-date]') as HTMLInputElement).value === x, v, { timeout: 5000 }).catch(() => undefined);
      assert.equal(await page.getByTestId('current-date').inputValue(), v);
    };
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    const keep = await page.evaluate(() => (window as any).__mapmaker.store.time);
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('reset-workspace').click();
    await h.setDate('1 January 1100');
    // A tab among the studio's own panels.
    await page.getByTestId('dock-tab-calendar').click();
    const panel = page.getByTestId('calendar-panel');
    await panel.waitFor();
    assert.match(await panel.innerText(), /Calendar of “Earth”: Gregorian/);
    // A calendar of its own from a template, used there: the panel stays, the dates are written in it.
    await panel.getByTestId('calendar-template').selectOption('world');
    assert.match(await panel.getByTestId('calendar-preview').innerText(), /^The date viewed: 6 Turning 100 AF/);
    await panel.getByTestId('calendar-use').click();
    await h.saved();
    await dateIs('6 Turning 100 AF');
    assert.match(await panel.innerText(), /Calendar of “Earth”: Calendar of the Founding/);
    assert.equal(await panel.getByTestId('calendar-use').isDisabled(), true, 'nothing changed since');
    await h.screenshot('timeline-calendar-panel');
    // A change, discarded.
    await panel.getByTestId('calendar-name').fill('The long count');
    await panel.getByTestId('calendar-discard').click();
    assert.equal(await panel.getByTestId('calendar-name').inputValue(), 'Calendar of the Founding');
    // The Gregorian again, from the panel.
    await panel.getByTestId('calendar-use-gregorian').click();
    await h.saved();
    await dateIs('1 January 1100');
    assert.match(await panel.innerText(), /Calendar of “Earth”: Gregorian/);
    // In Map Studio, where the map is set up, its dialog as before.
    await page.getByTestId('studio-map').click();
    await page.locator('[data-testid^="map-row-"].sel').click();
    await page.getByTestId('open-calendar').click();
    await page.getByTestId('calendar-dialog').waitFor();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ dialog: null }));
    // Undone, step by step.
    for (let i = 0; i < 10 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    await page.evaluate((t) => (window as any).__mapmaker.store.setTime(t), keep);
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('The outline of events (D247): a tab beside the timeline and the table; each event under the longer one holding it; folded and opened; the arrow keys; renamed in place; filtered; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    // A war holding a campaign holding a battle, and a treaty after them, in a group of their own.
    await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, g = m.bench.gregorian, Y = (y: number, mo = 1, d = 1) => g.fromCivil({ year: y, month: mo, day: d });
      return s.execute((wd: unknown) => m.bench.commands.importEvents(wd, [
        { name: 'War of the Fords', start: Y(1337), end: Y(1356), groups: ['Fords chapter'] },
        { name: 'Siege of Sel', start: Y(1350), end: Y(1351), groups: ['Fords chapter'] },
        { name: 'The northern campaign', start: Y(1340), end: Y(1345), groups: ['Fords chapter'] },
        { name: 'Battle of the Fords', start: Y(1342, 8, 3), end: Y(1342, 8, 5), groups: ['Fords chapter'] },
        { name: 'Treaty of the Fords', start: Y(1357), end: null, groups: ['Fords chapter'] },
      ]));
    });
    await h.saved();
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('reset-workspace').click();
    await page.getByTestId('dock-tab-event-outline').click();
    const ol = page.getByTestId('outline');
    await ol.waitFor();
    const rows = () => ol.locator('.ol-row').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-depth')}:${e.querySelector('.ol-name')?.textContent ?? ''}`));
    // (Its own events only, by name: other chapters may hold events of like names.)
    const mine = new Set(['War of the Fords', 'The northern campaign', 'Battle of the Fords', 'Siege of Sel', 'Siege of Sel castle', 'Treaty of the Fords']);
    const wars = async () => (await rows()).filter((r) => mine.has(r.slice(r.indexOf(':') + 1)));
    assert.deepEqual(await wars(), ['0:War of the Fords', '1:The northern campaign', '2:Battle of the Fords', '1:Siege of Sel', '0:Treaty of the Fords']);
    await page.getByTestId('ol-chapter-Fords chapter').waitFor();
    await h.screenshot('timeline-outline');
    // Folded: what it holds is hidden, and counted.
    await page.getByTestId('ol-twisty-War of the Fords').click();
    assert.deepEqual(await wars(), ['0:War of the Fords', '0:Treaty of the Fords']);
    assert.equal(await page.getByTestId('ol-held-War of the Fords').innerText(), '3 within');
    // A row chosen: the event selected, the date at its start; the arrow keys go along and open.
    await page.getByTestId('ol-row-Treaty of the Fords').click();
    const id = (name: string) => store(`s.world.all('event').find((e) => e.name === ${JSON.stringify(name)}).id`);
    assert.deepEqual(await store('s.selection'), { kind: 'event', id: await id('Treaty of the Fords') });
    assert.equal(await store('s.time.day'), await store(`s.world.get('event', s.selection.id).start_day`));
    await page.keyboard.press('ArrowUp');
    assert.deepEqual(await store('s.selection'), { kind: 'event', id: await id('War of the Fords') });
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await wars(), ['0:War of the Fords', '1:The northern campaign', '2:Battle of the Fords', '1:Siege of Sel', '0:Treaty of the Fords'], 'opened');
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await store('s.selection'), { kind: 'event', id: await id('The northern campaign') }, 'into it');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await wars(), ['0:War of the Fords', '1:The northern campaign', '1:Siege of Sel', '0:Treaty of the Fords'], 'the campaign folded');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await store('s.selection'), { kind: 'event', id: await id('War of the Fords') }, 'up to what holds it');
    // Ctrl+click chooses another as well.
    await page.keyboard.down('Control');
    await page.getByTestId('ol-row-Treaty of the Fords').click();
    await page.keyboard.up('Control');
    assert.equal(((await store(`s.chosen('event')`)) as string[]).length, 2);
    // Renamed in place, one undo step.
    await page.getByTestId('ol-row-Siege of Sel').dblclick();
    await page.getByTestId('ol-rename').fill('Siege of Sel castle');
    await page.getByTestId('ol-rename').press('Enter');
    await h.saved();
    await page.getByTestId('ol-row-Siege of Sel castle').waitFor();
    // Filtered: the battle, with what holds it, opened.
    await page.getByTestId('ol-filter').fill('Battle');
    assert.deepEqual(await wars(), ['0:War of the Fords', '1:The northern campaign', '2:Battle of the Fords']);
    await page.getByTestId('ol-filter').press('Escape');
    // Fold all, open all.
    await page.getByTestId('ol-fold-all').click();
    assert.deepEqual(await wars(), ['0:War of the Fords', '0:Treaty of the Fords']);
    await page.getByTestId('ol-open-all').click();
    assert.equal((await wars()).length, 5);
    // Undone, step by step.
    for (let i = 0; i < 10 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await store(`s.world.all('event').filter((e) => /Fords|Siege of Sel/.test(e.name)).length`), 0);
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, multi: null }));
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('The Looks studio as drawn (D248): the thing designed and its parts, top to bottom; a part brings its settings forward in the Looks panel, opened and lit; something else to design', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('studio-looks').click();
    await page.getByTestId('reset-workspace').click();
    // As drawn: the parts at the left (before the lists), the stage, the Looks panel over the Effects panel; no timeline.
    const parts = page.getByTestId('parts-panel');
    await parts.waitFor();
    await page.getByTestId('effects-panel').waitFor();
    assert.equal(await page.locator('.timeline').count(), 0);
    const pb = (await parts.boundingBox())!, lb = (await page.getByTestId('looks-panel').boundingBox())!, eb = (await page.getByTestId('effects-panel').boundingBox())!;
    assert.ok(pb.x < lb.x && lb.y < eb.y && Math.abs(lb.x - eb.x) < 2, 'parts at the left; Looks over Effects at the right');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.getByTestId('parts-none').waitFor();
    // A country chosen: its parts, top to bottom.
    const idA = await store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(A)}).id`) as string;
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ selection: { kind: 'entity', id }, multi: null }), idA);
    assert.match(await page.getByTestId('parts-title').innerText(), /Country/);
    assert.deepEqual(await parts.locator('.parts-list').first().locator('.part-name').allInnerTexts(), ['Effects', 'Label', 'Border', 'Fill']);
    assert.match(await page.getByTestId('part-fill').innerText(), /its colour, #[0-9a-f]{6}/);
    // The label part: the Label group opened (folded before), scrolled to and lit.
    const head = page.locator('.looks-panel [data-testid="group-head-entity:label"]');
    if ((await head.getAttribute('aria-expanded')) === 'true') await head.click();
    assert.equal(await head.getAttribute('aria-expanded'), 'false');
    await page.getByTestId('part-label').click();
    assert.equal(await head.getAttribute('aria-expanded'), 'true');
    await page.waitForFunction(() => document.querySelector('.looks-panel [data-testid="group-entity:label"]')?.classList.contains('part-lit'));
    // The border part: the fold of its borders opened within the look.
    await page.getByTestId('part-border').click();
    await page.waitForFunction(() => (document.querySelector('.looks-panel .country-borders') as HTMLDetailsElement | null)?.open === true);
    await h.screenshot('looks-studio-parts');
    // Something else to design: the layer viewed, its parts.
    await page.getByTestId('parts-other-layer').click();
    assert.equal(await store('s.selection.kind'), 'layer');
    assert.match(await page.getByTestId('parts-title').innerText(), /Layer/);
    await page.getByTestId('part-fill').click();
    await page.locator('.looks-panel [data-testid="group-layer:fill"]').waitFor();
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('The Looks studio\'s stage (D249): the thing designed alone, the other countries muted; framed far, middle and near; on the map again', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await h.setDate('1650');
    await page.getByTestId('studio-looks').click();
    await page.getByTestId('reset-workspace').click();
    await page.getByTestId('stage-bar').waitFor();
    // Nothing chosen: nothing to show alone or to frame.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null, stageAlone: false }));
    assert.equal(await page.getByTestId('stage-alone').isDisabled(), true);
    const idA = await store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(A)}).id`) as string;
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ selection: { kind: 'entity', id }, multi: null }), idA);
    assert.match(await page.getByTestId('stage-bar').innerText(), new RegExp(A));
    // Framed: middle, all of it filling the view; far, smaller; near, closer still.
    await page.getByTestId('stage-middle').click();
    const zMiddle = await store('s.camera.zoom') as number;
    await page.getByTestId('stage-far').click();
    const zFar = await store('s.camera.zoom') as number;
    await page.getByTestId('stage-near').click();
    const zNear = await store('s.camera.zoom') as number;
    assert.ok(zFar < zMiddle && zMiddle < zNear, `far ${zFar}, middle ${zMiddle}, near ${zNear}`);
    await page.getByTestId('stage-middle').click();
    // Alone: the neighbour muted, the country itself as it is. (Both in view, as in D237; of a patch about each place,
    // its main colour, so that a name or a border drawn over a part of it does not count.)
    await page.evaluate(([a, b]) => (window as any).__mapmaker.store.setCamera({ lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, zoom: 1.5, rotation: 0, projection: 'equirectangular' }), [P.a, P.b]);
    const mainColour = (ll: LL) => page.evaluate(([lon, lat]) => {
      const p = (window as any).__mapmaker.lonLatToPage(lon, lat);
      const c = document.querySelector('[data-testid=map-canvas]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect(), k = c.width / r.width, R = Math.round(10 * k);
      const d = c.getContext('2d')!.getImageData(Math.round((p[0] - r.left) * k) - R, Math.round((p[1] - r.top) * k) - R, 2 * R + 1, 2 * R + 1).data;
      const n = new Map<string, number>();
      for (let i = 0; i < d.length; i += 4) { const key = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`; n.set(key, (n.get(key) ?? 0) + 1); }
      const [key] = [...n].sort((x, y) => y[1] - x[1])[0];
      return key.split(',').map((v) => Number(v) * 8 + 4);
    }, ll);
    const diff = (x: number[], y: number[]) => Math.max(...x.map((v, i) => Math.abs(v - y[i])));
    // (Drawn on the next frame: waited for until it holds, or a few seconds.)
    const until = async (ok: () => Promise<boolean>) => { for (let i = 0; i < 40 && !(await ok()); i++) await page.waitForTimeout(100); };
    await page.waitForTimeout(400);
    const a0 = await mainColour(P.a), b0 = await mainColour(P.b);
    assert.ok(diff(a0, b0) > 20, `the two countries apart to begin with (${a0} against ${b0})`);
    await page.getByTestId('stage-alone').click();
    assert.equal(await page.getByTestId('stage-alone').getAttribute('aria-pressed'), 'true');
    await until(async () => diff(await mainColour(P.b), b0) > 20);
    const a1 = await mainColour(P.a), b1 = await mainColour(P.b);
    assert.ok(diff(a0, a1) <= 8, `the country designed as it was (${a0} against ${a1})`);
    assert.ok(diff(b0, b1) > 20, `its neighbour muted (${b0} against ${b1})`);
    assert.equal(await store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(B)}).color === '#3a4652'`), false, 'nothing stored changed');
    await h.screenshot('looks-stage-alone');
    // On the map again: as before.
    await page.getByTestId('stage-on-map').click();
    await until(async () => diff(await mainColour(P.b), b0) <= 8);
    assert.ok(diff(await mainColour(P.b), b0) <= 8, 'the neighbour as it was');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('A design saved as an effect (D250): a country\'s stack of effects saved from the Looks studio, under Saved by you; given to another country; renamed and forgotten; undone', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const before = await steps();
    await page.getByTestId('studio-looks').click();
    await page.getByTestId('reset-workspace').click();
    const idOf = (name: string) => store(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(name)}).id`) as Promise<string>;
    const idA = await idOf(A), idB = await idOf(B);
    const looks = () => store(`[${JSON.stringify(idA)}, ${JSON.stringify(idB)}].map((id) => JSON.parse(s.world.get('entity', id).style || '{}').look ?? null)`);
    const looks0 = await looks();
    const choose = (id: string) => page.evaluate((x) => (window as any).__mapmaker.store.set({ selection: { kind: 'entity', id: x }, multi: null }), id);
    await choose(idA);
    // With no effects of its own, nothing to save.
    assert.equal(await page.getByTestId('parts-save-effect').isDisabled(), true);
    await page.getByTestId('effect-countries:shadow').dblclick();
    await h.saved();
    assert.equal(await page.getByTestId('parts-save-effect').isDisabled(), false);
    // Saved under a name: in the Effects panel, under Saved by you.
    await page.getByTestId('parts-save-effect').click();
    await page.getByTestId('ask-input').fill('Testa shadow');
    await page.getByTestId('ask-ok').click();
    await h.saved();
    const pid = await store(`JSON.parse(s.world.get('meta', 'look_presets').value).find((p) => p.name === 'Testa shadow').id`) as string;
    const saved = page.getByTestId(`effect-saved:${pid}`);
    await saved.waitFor();
    await h.screenshot('looks-saved-effect');
    // Given to another country: its own look takes the stack.
    await choose(idB);
    await saved.dblclick();
    await h.saved();
    assert.deepEqual(await store(`JSON.parse(s.world.get('entity', ${JSON.stringify(idB)}).style).look.effects.map((e) => e.kind)`), ['shadow']);
    // Renamed and forgotten, by its right-click menu.
    await saved.click({ button: 'right' });
    await page.getByTestId('saved-rename').click();
    await page.getByTestId('ask-input').fill('Raised shadow');
    await page.getByTestId('ask-ok').click();
    await h.saved();
    assert.match(await saved.innerText(), /Raised shadow/);
    await saved.click({ button: 'right' });
    await page.getByTestId('saved-forget').click();
    await h.saved();
    assert.equal(await saved.count(), 0);
    // Undone, step by step.
    for (let i = 0; i < 10 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.deepEqual(await looks(), looks0, 'both countries\' looks as they were');
    assert.equal(await store(`JSON.parse(s.world.get('meta', 'look_presets')?.value ?? '[]').some((p) => p.name === 'Testa shadow' || p.name === 'Raised shadow')`), false, 'nothing kept');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.getByTestId('studio-history').click();
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('The menu bar: every command in a menu with its shortcut; the keyboard runs the same commands (D197)', async () => {
    const store = (f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`);
    await page.getByTestId('studio-history').click();
    // Each menu opens under its name; with one open, the next opens as the pointer passes over it.
    const seen: string[] = [];
    await page.getByTestId('menu-file').click();
    for (const m of ['file', 'edit', 'view', 'map', 'history', 'window', 'help']) {
      await page.getByTestId(`menu-${m}`).hover();
      await page.waitForFunction((id) => (window as any).__mapmaker.store.menu?.bar === id, m);
      const ids = await page.locator('[data-testid="context-menu"] button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
      assert.ok(ids.length >= 2, `${m}: ${ids.join(', ')}`);
      seen.push(...ids);
    }
    assert.equal(new Set(seen).size, seen.length, 'no command is in two menus');
    for (const id of ['command-versions', 'command-undo', 'command-show', 'command-new-map', 'command-new-event', 'command-studio-timeline', 'command-panel-timeline', 'command-save-workspace', 'command-shortcuts']) assert.ok(seen.includes(id), id);
    await h.screenshot('menu-help');
    await page.keyboard.press('Escape');
    assert.equal(await store('s.menu'), null);
    // A menu shows the shortcut and whether the command can be used now.
    await page.getByTestId('menu-edit').click();
    assert.match((await page.getByTestId('command-undo').textContent())!, /Undo.*Ctrl\+Z/);
    assert.equal(await page.getByTestId('command-merge').isDisabled(), true, 'nothing chosen to merge');
    await page.getByTestId('menu-edit').click();
    assert.equal(await store('s.menu'), null, 'a second click closes it');
    // A ticked command: the timeline closed from the Window menu and opened again there.
    await page.getByTestId('menu-window').click();
    assert.match((await page.getByTestId('command-panel-timeline').textContent())!, /✓/);
    await page.getByTestId('command-panel-timeline').click();
    assert.equal(await page.locator('.timeline').count(), 0);
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-panel-timeline').click();
    await page.locator('.timeline').waitFor();
    // Guides (D206): today's country borders, and today's states and provinces, over the working map.
    await page.getByTestId('menu-view').click();
    assert.equal(await page.getByTestId('command-guide-states').isDisabled(), false);
    await page.getByTestId('command-guide-states').click();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.guideStates), true);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="map-canvas"]').length > 0);
    await page.waitForTimeout(1500);
    await h.screenshot('guides-states');
    await page.getByTestId('menu-view').click();
    assert.match((await page.getByTestId('command-guide-states').textContent())!, /✓/);
    await page.getByTestId('command-guide-states').click();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.guideStates), false);
    // The keyboard: studios, the next and the previous change, a new event.
    await page.locator('.viewer-panel').click({ position: { x: 5, y: 5 }, button: 'right' }).catch(() => undefined);
    await page.keyboard.press('Alt+3');
    assert.equal(await store('s.pageNow()'), 'timeline');
    await page.keyboard.press('Alt+2');
    assert.equal(await store('s.pageNow()'), 'history');
    const changes = await store('s.engine.changeInstants().length') as number;
    if (changes >= 2) {
      const t0 = await store('JSON.stringify(s.time)');
      await page.keyboard.press('.');
      const t1 = await store('JSON.stringify(s.time)');
      await page.keyboard.press(',');
      await page.keyboard.press(',');
      const t2 = await store('JSON.stringify(s.time)');
      assert.ok(t0 !== t1 || t1 !== t2, 'the date steps from change to change');
    }
    // History plays as slowly as real time, and a day a second is among the speeds (it is the first chosen in a new session).
    const speeds = await page.getByTestId('history-speed').locator('option').allTextContents();
    assert.equal(speeds[0], 'Real time (1 second/s)');
    assert.ok(speeds.includes('1 day/s'));
    await page.keyboard.press('Control+e');
    assert.equal(await store('s.dialog'), 'new-event');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ dialog: null }));
    // Help: the list of shortcuts, read from the commands.
    await page.getByTestId('menu-help').click();
    await page.getByTestId('command-shortcuts').click();
    const list = (await page.getByTestId('shortcuts-dialog').textContent())!;
    for (const k of ['Ctrl+Z', 'Alt+3', 'Space', 'Studio: Map Studio', 'New event']) assert.ok(list.includes(k), k);
    await h.screenshot('shortcuts');
    await page.getByTestId('shortcuts-dialog').getByRole('button', { name: 'Close' }).click();
  });

  await h.step('The tool strip down the left edge, a key for each tool, and the options bar that keeps its height (D198, D234)', async () => {
    const tool = () => page.evaluate(() => (window as any).__mapmaker.store.tool);
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('tool-select').click();
    // The strip is a narrow column at the far left (a panel too: its grip moves it); its tools are icons named for those who cannot see them.
    const strip = await box('[data-testid="tool-strip"]');
    assert.ok(strip.x === 0 && strip.width <= 48 && strip.height > 300, JSON.stringify(strip));
    assert.equal(await page.getByTestId('dock-tab-tools').textContent(), '⋮⋮');
    await h.chooseTool('lasso');
    await page.getByTestId('tool-select').click();
    assert.equal(await page.getByTestId('tool-lasso').getAttribute('aria-label'), 'Territory brush');
    assert.match((await page.getByTestId('tool-lasso').getAttribute('title'))!, /^Territory brush \(B\)/);
    assert.equal(await page.getByTestId('tool-lasso').locator('svg').count(), 1);
    // A key takes a tool in hand; the bar above names it and holds its options.
    const map0 = await box('.viewer-panel');
    await page.locator('.viewer-panel').hover();
    await page.keyboard.press('b');
    assert.equal(await tool(), 'lasso');
    assert.equal(await page.getByTestId('tool-name').textContent(), 'Territory brush');
    await page.getByTestId('options-bar').getByTestId('paint-owner').waitFor();
    await page.keyboard.press('p');
    assert.equal(await tool(), 'pen');
    // Stacked (D205): the territory brush, the border pen and the precise shape take one place, the one last used
    // showing; resting the pointer on it slides out the three.
    assert.equal(await page.getByTestId('tool-stack-territory').getByTestId('tool-pen').count(), 1, 'the pen shows now');
    assert.equal(await page.getByTestId('tool-lasso').count(), 0, 'the brush is under it');
    await page.getByTestId('tool-stack-territory').hover();
    await page.getByTestId('tool-flyout-territory').waitFor();
    assert.deepEqual((await page.getByTestId('tool-flyout-territory').locator('.tool-flyout-name').allTextContents()), ['Territory brush', 'Precise shape', 'Border pen']);
    await h.screenshot('tool-stack');
    await page.getByTestId('tool-polygon').click();
    assert.equal(await tool(), 'polygon');
    await page.getByTestId('tool-flyout-territory').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('tool-stack-territory').getByTestId('tool-polygon').count(), 1, 'the precise shape shows now');
    await page.locator('.viewer-panel').hover();
    await page.keyboard.press('e');
    assert.equal(await tool(), 'erase');
    // Whichever tool, the map keeps its size and place.
    assert.deepEqual(await box('.viewer-panel'), map0);
    await h.screenshot('tool-strip');
    // The ground's tools are Map Studio's (D235): in History, T takes nothing in hand.
    await page.keyboard.press('t');
    assert.equal(await tool(), 'erase', 'no terrain tool in History');
    // A tool with many options (Map Studio's river brush, in a narrow window): its second line lies over the top of the
    // map, and the lists' tabs move down below it, never covered; its words of explanation keep to one line, whole on
    // hovering.
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 1100, height: size.height });
    await page.getByTestId('studio-map').click();
    const mapT = await box('.viewer-panel');
    await page.keyboard.press('t');
    assert.equal(await tool(), 'sculpt');
    await page.getByTestId('sculpt-brush').selectOption('river');
    const bar = await box('[data-testid="options-bar"] .tool-options'), tabs = await box('[data-testid="dock-tab-maps"]');
    assert.ok(bar.height > 50, `the options take a second line (${bar.height})`);
    assert.ok(tabs.y >= bar.y + bar.height - 1.5, `the lists' tabs start below the options (${tabs.y} against ${bar.y + bar.height})`);
    const map1 = await box('.viewer-panel');
    assert.deepEqual([map1.y, map1.height], [mapT.y, mapT.height], 'the map where it was, as high');
    const words = page.locator('[data-testid="options-bar"] .toolbar.sub > .muted').first();
    assert.ok((await words.boundingBox())!.height < 24 && /Draw a river/.test((await words.getAttribute('title')) ?? ''), 'the explanation on one line, whole in its tooltip');
    await h.screenshot('tool-options-two-lines');
    await page.setViewportSize(size);
    // Back in History, its own tool in hand again (each studio keeps its own).
    await page.getByTestId('studio-history').click();
    assert.equal(await tool(), 'erase');
    // A star map has its own tools, and a key of a tool it has not does nothing.
    await page.keyboard.press('v');
    assert.equal(await tool(), 'select');
    // Typing in a field is typing, not choosing tools.
    await page.getByTestId('search').click();
    await page.keyboard.type('bp');
    assert.equal(await tool(), 'select');
    await page.getByTestId('search').fill('');
    await page.keyboard.press('Escape');
    // The list of shortcuts names the tools' keys.
    await page.getByTestId('menu-help').click();
    await page.getByTestId('command-shortcuts').click();
    assert.ok((await page.getByTestId('shortcuts-dialog').textContent())!.includes('Tool: Border pen'));
    await page.getByTestId('shortcuts-dialog').getByRole('button', { name: 'Close' }).click();
  });

  await h.step('The lists, each a panel of its own: tabs of one group at first, one at a time; each with its own filter by name (D199, D234)', async () => {
    const heads = () => page.locator('.list-panel .section-head > span:first-child').allTextContents();
    const rows = (kind: string) => page.locator(`.list-panel [data-testid^="${kind}-row-"]`);
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    // Every list open at once, each in a group of its own (as the steps before this one had them).
    assert.deepEqual(await heads(), ['Maps', 'Layers', 'Countries and factions', 'Characters', 'Cities and others', 'Areas, lines and points', 'Events']);
    // As at first: the lists tabs of one group, one at a time.
    await page.getByTestId('menu-window').click();
    await page.getByTestId('command-original-layout').click();
    await page.getByTestId('dock-tab-countries').click();
    assert.deepEqual(await heads(), ['Countries and factions']);
    await page.getByTestId(`entity-row-${A}`).waitFor();
    assert.equal(await page.getByTestId('layer-row').count(), 0);
    await page.getByTestId('dock-tab-places').click();
    assert.deepEqual(await heads(), ['Characters', 'Cities and others']);
    await page.getByTestId('dock-tab-layers').click();
    assert.deepEqual(await heads(), ['Layers']);
    assert.ok(await page.getByTestId('layer-row').count() >= 1);
    assert.equal(await page.locator('[data-testid^="list-filter-"]').count(), 0, 'no filter where there is no list of names');
    await h.screenshot('list-layers');
    // The filter: the names that hold every word typed, whatever the case; Esc clears it.
    await page.getByTestId('dock-tab-countries').click();
    const all = await rows('entity').count();
    await page.getByTestId('list-filter-countries').fill('testa KING');
    assert.deepEqual(await rows('entity').allTextContents().then((t) => t.map((x) => x.trim())), [A]);
    await h.screenshot('list-filter');
    await page.getByTestId('list-filter-countries').press('Escape');
    assert.equal(await rows('entity').count(), all);
    // Each list its own filter, kept while the list is behind another tab.
    await page.getByTestId('dock-tab-events').click();
    const events = await rows('event').count();
    assert.ok(events >= 2, `events listed (${events})`);
    const first = (await rows('event').first().getAttribute('data-testid'))!.replace('event-row-', '');
    await page.getByTestId('list-filter-events').fill(first);
    assert.ok(await rows('event').count() < events || events === 1);
    await page.getByTestId(`event-row-${first}`).waitFor();
    await page.getByTestId('dock-tab-countries').click();
    assert.equal(await page.getByTestId('list-filter-countries').inputValue(), '', 'the countries\' own filter');
    await page.getByTestId('dock-tab-events').click();
    assert.equal(await page.getByTestId('list-filter-events').inputValue(), first);
    await page.getByTestId('list-filter-events').fill('');
    // Two lists side by side: the events' tab dropped at the foot of the group, a group of its own under the others.
    const group = await page.locator('.list-panel').boundingBox();
    const tab = (await page.getByTestId('dock-tab-events').boundingBox())!;
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await page.mouse.down();
    await page.mouse.move(tab.x + 30, tab.y + 40, { steps: 3 });
    await page.mouse.move(group!.x + group!.width / 2, group!.y + group!.height - 12, { steps: 8 });
    await page.mouse.up();
    await page.getByTestId('dock-tab-countries').click();
    assert.deepEqual(await heads(), ['Countries and factions', 'Events']);
    await h.screenshot('lists-side-by-side');
    // (All lists again for the steps after this one.)
    await page.evaluate(() => (window as any).__mapmaker.allLists());
  });

  await h.step('Properties in groups that fold and stay folded; a layer in Properties (D200)', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('tool-select').click();
    // A country: its properties in named groups.
    await page.getByTestId(`entity-row-${A}`).click();
    const groups = () => page.locator('.properties-panel .prop-head').allTextContents().then((t) => t.map((x) => x.replace(/^[▾▸]/, '').trim()));
    assert.deepEqual(await groups(), ['Country', 'Notes and pictures', 'Territory', 'Relationships', 'Names over time']);
    await page.getByTestId('relations').waitFor();
    // Folded, a group stays folded for the next country too, and after loading the project again.
    await page.getByTestId('group-head-entity:relations').click();
    assert.equal(await page.getByTestId('relations').count(), 0);
    assert.equal(await page.getByTestId('group-head-entity:relations').getAttribute('aria-expanded'), 'false');
    await page.getByTestId(`entity-row-${B}`).click();
    await page.getByTestId('entity-panel').getByText(B).first().waitFor();
    assert.equal(await page.getByTestId('relations').count(), 0, 'still folded for another country');
    await page.getByTestId('country-fill').waitFor();
    await h.screenshot('properties-groups');
    await page.getByTestId('group-head-entity:relations').click();
    await page.getByTestId('relations').waitFor();
    // An event's too.
    const ev = (await page.locator('.list-panel [data-testid^="event-row-"]').first().getAttribute('data-testid'))!;
    await page.getByTestId(ev).click();
    assert.deepEqual((await groups()).slice(0, 2), ['Event', 'In presentations']);
    assert.ok((await groups()).includes('Changes'));
    // A layer: clicking its name shows it in Properties, with what used to lie in the list under it.
    await page.locator('[data-testid="layer-row"]', { hasText: 'Political' }).locator('span').first().click();
    await page.getByTestId('layer-panel').waitFor();
    assert.deepEqual(await groups(), ['Layer', 'Coast']);
    assert.equal(await page.locator('.list-panel [data-testid="layer-fill"]').count(), 0, 'no longer in the list');
    assert.equal(await page.getByTestId('looks-layer').getByTestId('layer-fill').inputValue(), 'solid', 'its looks in the Looks panel (D236)');
    assert.equal(await page.getByTestId('layer-name').inputValue(), 'Political');
    // Its name and whether it is shown are changed there (one undo each).
    await page.getByTestId('layer-visible').uncheck();
    await h.saved();
    assert.equal(await page.locator('[data-testid="layer-row"]', { hasText: 'Political' }).locator('input[type=checkbox]').isChecked(), false);
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await page.getByTestId('layer-visible').isChecked(), true);
    // Beside a value, a button puts it back to its default (D207): greyed while it is there already.
    const width = page.getByTestId('layer-border-width'), widthReset = page.getByTestId('layer-border-width-reset');
    const before = await width.inputValue();
    await width.fill('3.5');
    await width.press('Enter');
    await h.saved();
    assert.equal(await widthReset.isDisabled(), false);
    await widthReset.click();
    await h.saved();
    assert.equal(await width.inputValue(), '1.4', 'the political layer\'s own border width');
    assert.equal(await widthReset.isDisabled(), true);
    await width.fill(before);
    await width.press('Enter');
    await h.saved();
    // A step of the arrow keys takes effect at once, while the box is still being typed in (D228).
    await width.focus();
    await width.press('ArrowUp');
    await h.saved();
    assert.ok(Number(await width.inputValue()) > Number(before), 'a step up');
    assert.equal(await widthReset.isDisabled(), false, 'saved without leaving the box');
    assert.ok(await width.evaluate((e) => e === document.activeElement), 'still in the box');
    await widthReset.click();
    await h.saved();
    // Pressed and dragged up, the number rises a step for every 4 pixels; down, it falls; it takes effect as it moves.
    const wb = (await width.boundingBox())!;
    await page.mouse.move(wb.x + 12, wb.y + wb.height / 2);
    await page.mouse.down();
    await page.mouse.move(wb.x + 12, wb.y + wb.height / 2 - 20, { steps: 5 });
    assert.equal(await width.inputValue(), '2.5', 'five steps of 0.25 up from 1.4 (the first to 1.5, as the box\'s arrows)');
    await page.waitForFunction(() => !(document.querySelector('[data-testid="layer-border-width-reset"]') as HTMLButtonElement).disabled);
    await page.mouse.move(wb.x + 12, wb.y + wb.height / 2 + 8, { steps: 5 });
    await page.mouse.up();
    await h.saved();
    assert.equal(await width.inputValue(), '1', 'two steps down from 1.4');
    assert.equal(await page.evaluate(() => document.body.classList.contains('number-scrubbing')), false);
    // Pressed without moving: the cursor is in the box to type, its number chosen.
    await width.click();
    assert.ok(await width.evaluate((e) => e === document.activeElement));
    await page.keyboard.type(before);
    assert.equal(await width.inputValue(), before, 'what was typed took the place of the number');
    await width.press('Enter');
    await h.saved();
    await h.screenshot('properties-layer');
    // The whole row chooses it (not only its name); a second click lets it go again.
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.locator('[data-testid="layer-row"]', { hasText: 'Political' }).click({ position: { x: 200, y: 8 } });
    await page.locator('[data-testid="layer-row"].sel', { hasText: 'Political' }).waitFor();
    await page.locator('[data-testid="layer-row"]', { hasText: 'Political' }).click({ position: { x: 200, y: 8 } });
    await page.getByTestId('map-panel').waitFor();
    assert.equal(await page.locator('[data-testid="layer-row"].sel').count(), 0, 'no layer chosen');
    assert.equal(await page.locator('[data-testid="layer-row"].drawing', { hasText: 'Political' }).count(), 1, 'still the layer drawn on');
    // A layer of points has only its name and whether it is shown.
    await page.locator('[data-testid="layer-row"]', { hasText: 'Battles' }).locator('span').first().click();
    assert.deepEqual(await groups(), ['Layer']);
    // Nothing selected (the map's row clicked): the map itself (D202); its setting-up is Map Studio's, a link leads there (D235).
    await page.getByTestId('map-row-Earth').click();
    await page.getByTestId('map-panel').waitFor();
    assert.deepEqual(await groups(), ['This map', 'What is shown', 'Statistics', 'Speed of the working view', 'Getting started']);
    assert.equal(await page.getByTestId('map-setup').count(), 0);
    await page.getByTestId('map-setup-in-studio').click();
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.pageNow()), 'map');
    await page.getByTestId('map-row-Earth').click();
    await page.getByTestId('map-setup').waitFor();
    assert.deepEqual(await groups(), ['This map', 'What is shown', 'Sea level over time', 'Calendar', 'Statistics', 'Speed of the working view', 'Getting started']);
    await page.getByTestId('studio-history').click();
    // The map's settings in place (D209): folded at first; opened, the window's contents, without its frame.
    assert.equal(await page.getByTestId('settings-dialog-inline').count(), 0);
    await page.getByTestId('group-head-map:speed').click();
    await page.getByTestId('settings-dialog-inline').waitFor();
    assert.equal(await page.locator('.modal').count(), 0, 'not a window over the map');
    await h.screenshot('properties-map-speed');
    await page.getByTestId('group-head-map:speed').click();
    assert.equal(await page.getByTestId('settings-dialog-inline').count(), 0);
    assert.equal(await page.locator('.list-panel [data-testid="open-calendar"]').count(), 0);
    assert.equal(await page.getByTestId('map-panel').getByTestId('open-calendar').count(), 0, 'the calendar is set up in Map Studio');
    await h.screenshot('properties-map');
    await page.getByTestId('tool-select').click();
  });

  await h.step('The timeline: events in a track for each group, folded and opened; found, snapped, zoomed; an event dragged to another date (D201)', async () => {
    const st = <T,>(f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`) as Promise<T>;
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.getByTestId('timeline-fit').click();
    // The head: play, the date viewed and comparing, finding, snapping, the groups, zoom.
    for (const id of ['history-play', 'current-date', 'compare-toggle', 'timeline-find', 'timeline-snap', 'timeline-zoom-in', 'timeline-zoom-out', 'timeline-fit'])
      assert.equal(await page.getByTestId('timeline-head').getByTestId(id).count(), 1, id);
    // Two events put in a group of their own: a track for it, the rest on "Other events".
    const names = await st<string[]>(`s.world.all('event').filter((e) => s.engine.lists(e) && !e.id.startsWith('evt_base')).sort((a, b) => a.start_day - b.start_day).map((e) => e.name)`);
    assert.ok(names.length >= 4, `events to lay out (${names.length})`);
    await page.evaluate(() => (window as any).__mapmaker.store.set({ eventFilter: null }));
    const before = await page.getByTestId('timeline-tracks').locator('.tl-track-head').count();
    await page.getByTestId('group-filter-button').click();
    await page.getByTestId('new-group-name').fill('Track test');
    await page.getByTestId('new-group-create').click();
    await h.saved();
    await page.locator('.group-popover .close').click();
    for (const n of names.slice(0, 2)) {
      await page.getByTestId(`event-row-${n}`).click();
      await page.getByTestId('event-group-Track test').check();
      await h.saved();
    }
    await page.getByTestId('timeline-fit').click();
    const head = page.getByTestId('track-Track test');
    await head.waitFor();
    assert.match((await head.textContent())!, /Track test\s*2$/);
    assert.ok(await page.getByTestId('timeline-tracks').locator('.tl-track-head').count() >= before, 'a track more, or as many (the two were the only ones of theirs)');
    type Bar = { ids: string[]; x0: number; x1: number; lane: number; kids?: Bar[] };
    const laid = () => st<{ tracks: Array<{ id: string; y: number; height: number; folded: boolean; bars: Bar[]; marks: number[] }>; top: number }>('s.timelineLaid');
    // (Events on a track: those on its lanes and those drawn inside longer ones, D211.)
    const onTrack = (t: { bars: Bar[] }) => t.bars.reduce((n, b) => n + b.ids.length + (b.kids?.length ?? 0), 0);
    const gid = await st<string>(`s.world.all('event_group').find((g) => g.name === 'Track test').id`);
    let mine = (await laid()).tracks.find((t) => t.id === gid)!;
    assert.equal(onTrack(mine), 2, 'its two events lie on it');
    await h.screenshot('timeline-tracks');
    // Folded: a thin line of marks; opened again.
    await head.click();
    mine = (await laid()).tracks.find((t) => t.id === gid)!;
    assert.ok(mine.folded && mine.height <= 12 && mine.marks.length === 2, JSON.stringify(mine));
    assert.equal(await head.getAttribute('aria-expanded'), 'false');
    await head.click();
    mine = (await laid()).tracks.find((t) => t.id === gid)!;
    assert.equal(mine.folded, false);
    // Under the events: the strip of changes and branches, opened and folded.
    await page.getByTestId('track-other').click();
    assert.equal(await page.getByTestId('track-other').getAttribute('aria-expanded'), 'true');
    await h.screenshot('timeline-other-open');
    await page.getByTestId('track-other').click();
    // Zoom by the buttons, and back to the whole history.
    const span = () => st<number>('s.timeline.end - s.timeline.start');
    const whole = await span();
    await page.getByTestId('timeline-zoom-in').click();
    assert.ok(Math.abs((await span()) / whole - 1 / 1.6) < 0.01);
    await page.getByTestId('timeline-zoom-out').click();
    await page.getByTestId('timeline-zoom-out').click();
    assert.ok((await span()) > whole * 1.5);
    await page.getByTestId('timeline-fit').click();
    assert.ok(Math.abs((await span()) / whole - 1) < 0.01);
    // Finding and snapping are kept as they are set.
    await page.getByTestId('timeline-find').fill(names[0].slice(0, 5));
    assert.equal(await st<string>('s.timelineFind'), names[0].slice(0, 5));
    await page.getByTestId('timeline-find').press('Escape');
    assert.equal(await st<string>('s.timelineFind'), '');
    assert.equal(await page.getByTestId('timeline-snap').getAttribute('aria-pressed'), 'true');
    // A click on an event's bar chooses it; dragged (Alt: without snapping), it moves to another date; undone, it is back.
    const canvas = (await page.getByTestId('timeline').boundingBox())!;
    const l = await laid();
    mine = l.tracks.find((t) => t.id === gid)!;
    const bar = mine.bars.find((b) => b.ids.length === 1 && !b.kids) ?? mine.bars[0].kids![0];
    const id = bar.ids[0];
    const at: [number, number] = [canvas.x + bar.x0 + 3, canvas.y + l.top + mine.y + 3 + bar.lane * 20 + 7];
    await page.mouse.click(at[0], at[1]);
    assert.deepEqual(await st('s.selection'), { kind: 'event', id });
    const startOf = () => st<number>(`s.world.get('event', ${JSON.stringify(id)}).start_day`);
    const day0 = await startOf();
    const yearsPerPx = whole / canvas.width;
    await page.keyboard.down('Alt');
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.move(at[0] + 30, at[1], { steps: 5 });
    await page.mouse.move(at[0] + 60, at[1], { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await h.saved();
    const moved = ((await startOf()) - day0) / 365.2425;
    assert.ok(Math.abs(moved - 60 * yearsPerPx) <= Math.max(2 * yearsPerPx, 0.01), `moved by sixty pixels of time (${moved} years, ${60 * yearsPerPx} expected)`);
    await h.screenshot('timeline-event-dragged');
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await startOf(), day0);
    // Right-click (D209): on a bar, the event's own menu; on empty time, a new event there.
    let l2 = await laid();
    mine = l2.tracks.find((t) => t.id === gid)!;
    const b2 = mine.bars[0];
    await page.mouse.click(canvas.x + b2.x0 + 3, canvas.y + l2.top + mine.y + 3 + b2.lane * 20 + 7, { button: 'right' });
    await page.getByTestId('context-menu').waitFor();
    assert.ok((await page.getByTestId('context-menu').textContent())!.includes('Go to its date'));
    await page.keyboard.press('Escape');
    await page.mouse.click(canvas.x + canvas.width - 30, canvas.y + l2.top + mine.y + mine.height - 2, { button: 'right' });
    await page.getByTestId('timeline-new-event').click();
    assert.equal(await st<string>('s.dialog'), 'new-event');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ dialog: null }));
    // An event of another track dragged up or down onto the group's track joins the group.
    l2 = await laid();
    const other = l2.tracks.find((t) => t.id === '__ungrouped' && !t.folded && t.bars.some((b) => b.ids.length === 1))!;
    const ob = other.bars.find((b) => b.ids.length === 1)!;
    mine = l2.tracks.find((t) => t.id === gid)!;
    const from: [number, number] = [canvas.x + (ob.x0 + ob.x1) / 2, canvas.y + l2.top + other.y + 3 + ob.lane * 20 + 7];
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(from[0], canvas.y + l2.top + mine.y + mine.height / 2, { steps: 8 });
    await page.mouse.up();
    await h.saved();
    assert.ok((await st<string[]>(`s.world.all('event_group_member').filter((m) => m.group_id === ${JSON.stringify(gid)}).map((m) => m.event_id)`)).includes(ob.ids[0]), 'it joined the group');
    assert.equal(onTrack((await laid()).tracks.find((t) => t.id === gid)!), 3, 'now on its track');
    // A track's head: right-click to move it up or down among the tracks.
    const order = async () => (await laid()).tracks.map((t) => t.id).filter((id) => id !== '__ungrouped');
    if ((await order()).length > 1) {
      const o0 = await order();
      await page.getByTestId('track-Track test').click({ button: 'right' });
      const up = !(await page.getByTestId('track-move-up').isDisabled());
      await page.getByTestId(up ? 'track-move-up' : 'track-move-down').click();
      await h.saved();
      let o = await order();
      for (let i = 0; i < 20 && JSON.stringify(o) === JSON.stringify(o0); i++) { await page.waitForTimeout(100); o = await order(); }
      assert.notDeepEqual(o, o0, `moved ${up ? 'up' : 'down'}`);
      assert.equal(o.indexOf(gid), o0.indexOf(gid) + (up ? -1 : 1), 'one place along');
    }
    await h.screenshot('timeline-menus');
    // (The group made for this step is taken away again: one undo for each of what was done.)
    for (let i = 0; i < 12 && (await st<number>(`s.world.all('event_group').filter((g) => g.name === 'Track test').length`)) > 0; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await st<number>(`s.world.all('event_group').filter((g) => g.name === 'Track test').length`), 0);
    await page.getByTestId('studio-history').click();
  });

  await h.step('An event renames a country: from the event\'s start it is called so; one undo (D204)', async () => {
    const st = <T,>(f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`) as Promise<T>;
    await page.getByTestId('studio-timeline').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const ev = await st<{ id: string; name: string; day: number }>(`(() => { const e = s.world.all('event').filter((e) => s.engine.lists(e) && !e.id.startsWith('evt_base')).sort((a, b) => a.start_day - b.start_day)[0]; return { id: e.id, name: e.name, day: e.start_day }; })()`);
    await page.getByTestId(`event-row-${ev.name}`).click();
    const testa = await st<string>(`s.world.all('entity').find((e) => e.name === ${JSON.stringify(A)}).id`);
    await page.getByTestId('rename-event-who').selectOption({ label: A });
    assert.equal(await page.getByTestId('rename-event-name').inputValue(), A, 'starts from its name then');
    await page.getByTestId('rename-event-name').fill('Testan Empire');
    await page.getByTestId('rename-event-add').click();
    await h.saved();
    const at = (d: number) => st<string>(`s.engine.nameAt(${JSON.stringify(testa)}, { day: ${d}, ms: 0 })`);
    assert.equal(await at(ev.day + 1), 'Testan Empire', 'called so from the event on');
    assert.notEqual(await at(ev.day - 1), 'Testan Empire', 'not before it');
    assert.match((await page.getByTestId('event-panel').textContent())!, /Kingdom of Testa is called Testan Empire/, 'one of the event\'s changes');
    await h.screenshot('rename-in-event');
    await page.getByTestId('undo').click();
    await h.saved();
    assert.notEqual(await at(ev.day + 1), 'Testan Empire');
    await page.getByTestId('studio-history').click();
  });

  await h.step('Present: the shot\'s settings in tabs; the shots as clips one after another under the preview (D212)', async () => {
    const st = <T,>(f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`) as Promise<T>;
    await h.goto('shots');
    const before = await st<number>(`s.world.all('sequence').length`);
    await page.getByTestId('new-shot').click();
    await h.saved();
    await page.getByTestId('new-shot').click();
    await h.saved();
    await page.getByTestId('shot-editor').waitFor();
    const titles = async () => (await page.locator('.shot-panel > details.settings-group > summary').allTextContents()).map((t) => t.trim());
    const every = ['Shot', 'Output quality', 'Timing', 'Sound', 'Camera', 'Transitions', 'Current events box', 'Look', 'Text', 'Export'];
    assert.deepEqual(await titles(), every, 'All: every group');
    const tabs: Record<string, string[]> = { shot: ['Shot'], camera: ['Timing', 'Camera'], look: ['Transitions', 'Look'], graphics: ['Current events box', 'Text'], sound: ['Sound'], output: ['Output quality', 'Export'] };
    for (const [id, groups] of Object.entries(tabs)) {
      await page.getByTestId(`shot-tab-${id}`).click();
      assert.equal(await page.getByTestId(`shot-tab-${id}`).getAttribute('aria-selected'), 'true');
      assert.deepEqual(await titles(), groups, id);
    }
    await page.getByTestId('shot-tab-look').click();
    await h.screenshot('shot-tab-look');
    await page.getByTestId('shot-tab-all').click();
    assert.deepEqual(await titles(), every);
    // The Export page: no tabs, only what exporting needs.
    await h.goto('export');
    assert.equal(await page.getByTestId('shot-tabs').count(), 0);
    assert.deepEqual(await titles(), ['Shot', 'Output quality', 'Export']);
    await h.goto('shots');
    // The shots as clips: the one chosen is the last made; a click on another chooses it; on the one chosen, a click goes to that frame.
    const clips = page.getByTestId('shot-clip');
    assert.equal(await clips.count(), before + 2);
    const ids = await clips.evaluateAll((els) => els.map((e) => e.getAttribute('data-shot')));
    assert.equal(await st<string>('s.shotId'), ids[ids.length - 1]);
    await clips.nth(ids.length - 2).click();
    assert.equal(await st<string>('s.shotId'), ids[ids.length - 2]);
    assert.match((await clips.nth(ids.length - 2).getAttribute('class')) ?? '', /\bon\b/);
    const box = (await clips.nth(ids.length - 2).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    const frames = await st<number>(`JSON.parse(s.world.get('sequence', s.shotId).settings).frames`);
    const f = await st<number>('s.shotFrame');
    assert.ok(Math.abs(f - 0.75 * (frames - 1)) <= 1.5, `frame ${f} of ${frames}`);
    assert.equal(await page.getByTestId('frame-slider').inputValue(), String(f), 'the slider shows it too');
    await h.screenshot('shot-clips');
    // (The two shots taken away again.)
    for (let i = 0; i < 2; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await st<number>(`s.world.all('sequence').length`), before);
    await page.getByTestId('studio-history').click();
  });

  await h.step('Cities as maps online show them (D219): seen whole only the capitals and the largest, more as the map is closed in on; larger and bolder for bigger ones; their look changed, all shown again; undone', async () => {
    const st = <T,>(f: string) => page.evaluate(`(() => { const s = window.__mapmaker.store; return ${f}; })()`) as Promise<T>;
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    // Every one of today's cities of Turkey (any share of its people).
    await page.getByTestId('menu-map').click();
    await page.getByTestId('command-add-cities').click();
    await page.getByTestId('add-cities').waitFor();
    await page.getByTestId('cities-scope-chosen').check();
    await page.getByTestId('cities-country-search').fill('Turkey');
    await page.getByTestId('cities-country-Turkey').check();
    await page.getByTestId('add-cities-filter-share').fill('0');
    await page.getByTestId('add-cities-filter-share').dispatchEvent('pointerup');
    await page.waitForFunction(() => /^\s*(\d{2,})/.test(document.querySelector('[data-testid=cities-count]')?.textContent ?? ''));
    await page.getByTestId('add-cities-go').click();
    await page.getByTestId('add-cities').waitFor({ state: 'detached', timeout: 30000 });
    await h.saved();
    type City = { name: string; size?: number; weight?: number; named: boolean };
    const shown = async (lon: number, lat: number, zoom: number) => {
      await page.evaluate(([lon, lat, zoom]) => (window as any).__mapmaker.store.setCamera({ lon, lat, zoom, rotation: 0, projection: 'mercator' }), [lon, lat, zoom] as const);
      await page.waitForTimeout(700);
      return (await page.evaluate(() => (window as any).__mapmaker.store.renderer.lastCities.filter((c: any) => c.lon > 25 && c.lon < 45 && c.lat > 35 && c.lat < 43))) as City[];
    };
    // Seen whole, no cities at all (D229); a little closer, the capital and the largest; closer still, more.
    assert.equal((await shown(35, 39, 0.6)).length, 0, 'seen whole, no cities');
    const far = await shown(35, 39, 1.4), near = await shown(35, 39, 3.2);
    const farNames = far.map((c) => c.name);
    assert.ok(farNames.includes('Ankara') && farNames.includes('Istanbul'), `seen far out, the capital and the largest (${farNames.join(', ')})`);
    assert.ok(near.length >= far.length + 10, `more as the map is closed in on (${far.length} then ${near.length})`);
    const ankara = near.find((c) => c.name === 'Ankara')!, small = [...near].sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0];
    assert.ok((ankara.size ?? 0) > (small.size ?? 0) && (ankara.weight ?? 0) > (small.weight ?? 0), `larger and bolder for the capital (${ankara.size}/${ankara.weight} against ${small.name} ${small.size}/${small.weight})`);
    await h.screenshot('cities-close');
    await shown(35, 39, 1.4);
    await h.screenshot('cities-far');
    // Their look: every city whatever the scale, names a third larger; back as maps online.
    await page.getByTestId('menu-map').click();
    await page.getByTestId('command-label-style').click();
    await page.getByTestId('city-style').scrollIntoViewIfNeeded();
    await h.screenshot('city-style');
    await page.getByTestId('city-fade').uncheck();
    await h.saved();
    const all = await shown(35, 39, 0.6);
    assert.ok(all.length >= near.length, `all of them seen whole (${all.length})`);
    assert.equal(await st<boolean>(`JSON.parse(s.world.get('meta', 'city_style').value).fade`), false);
    await page.getByTestId('city-dot-style').selectOption('square');
    await h.saved();
    await page.getByTestId('city-style-reset').click();
    await h.saved();
    assert.equal(await st<boolean>(`JSON.parse(s.world.get('meta', 'city_style').value).fade`), true, 'as maps online again');
    await page.getByTestId('label-style-dialog').getByRole('button', { name: 'Done' }).click();
    // (Undone: the look, then the cities.)
    for (let i = 0; i < 12 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 0, lat: 20, zoom: 0, rotation: 0, projection: 'equirectangular' }));
  });

  await h.step('Rivers drawn as guidance (D220): with the pen and the brush, their water shown above the sea, tributaries from the heights; chosen, a point moved, settings changed, taken away; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 37, lat: 37.8, zoom: 3.4, rotation: 0, projection: 'equirectangular' }));
    await page.waitForTimeout(400);
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    type Stamp = { id: string; tool: string; path: Array<[number, number]>; river?: { drawn: string; tributaries: number; follow: boolean }; rev?: number };
    const rivers = async () => (await page.evaluate(() => { const s = (window as any).__mapmaker.store; return (JSON.parse(s.world.get('map_space', s.spaceId).settings).sculpt ?? []).filter((x: any) => x.tool === 'river'); })) as Stamp[];
    type Shape = { id: string; course: Array<[number, number]>; widths: number[]; branches: Array<{ line: Array<[number, number]> }> };
    const shapes = async () => (await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, space = s.world.get('map_space', s.spaceId), g = s.terrainOf(space);
      return m.bench.sculpted(g.grid, g.key, JSON.parse(space.settings).sculpt ?? [], space.radius_m / 1000).rivers;
    })) as Shape[];
    // The map as it is before any river, close in and from far away (D226: a river adds its water and changes nothing else).
    const cam0 = await page.evaluate(() => ({ ...(window as any).__mapmaker.store.camera }));
    const views = [cam0, { ...cam0, zoom: cam0.zoom - 1.5 }, { ...cam0, zoom: cam0.zoom - 3 }];
    const picture = async (slot: string) => {
      await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
      for (let v = 0; v < views.length; v++) {
        await page.evaluate((c) => (window as any).__mapmaker.store.setCamera(c), views[v]);
        await page.waitForTimeout(900);
        await page.evaluate(([name, k]) => { const c = document.querySelector('canvas.map-canvas') as HTMLCanvasElement; ((window as any).__riverShots ??= {})[`${name}${k}`] = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; }, [slot, v] as const);
      }
      await page.evaluate((c) => (window as any).__mapmaker.store.setCamera(c), cam0);
      await page.waitForTimeout(400);
    };
    await picture('before');
    // (The terrain tools are Map Studio's, D235; the pictures before and after are both taken in History, the map the same size.)
    await page.getByTestId('studio-map').click();
    await page.getByTestId('tool-sculpt').click();
    await page.getByTestId('sculpt-brush').selectOption('river');
    assert.equal(await page.getByTestId('sculpt-size').count() + await page.getByTestId('sculpt-strength').count(), 0, 'a river has no valley to size or cut');
    // With the pen: its points clicked from its source in the highlands to its mouth in the Mediterranean; Enter makes it.
    await page.getByTestId('river-draw-pen').click();
    const penPts: Array<[number, number]> = [[39.0, 39.3], [37.5, 38.3], [36.4, 37.4], [35.4, 36.9], [35.2, 36.3]];
    for (const ll of penPts) { const q = await h.toPage(ll); await page.mouse.click(q[0], q[1]); }
    assert.equal((await page.getByTestId('river-draft-count').textContent())?.trim(), '5 points');
    await page.keyboard.press('Enter');
    await h.saved();
    let all = await rivers();
    assert.equal(all.length, 1);
    assert.equal(all[0].path.length, 5, 'kept as its five points');
    assert.equal(all[0].river?.drawn, 'pen');
    await page.getByTestId('river-panel').waitFor();
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return !!s.terrainOf(s.world.get('map_space', s.spaceId)); }, null, { timeout: 30000 });
    // Worked out: from its source to the coast, with tributaries; its water drawn on the land, above the sea.
    let made = (await shapes()).find((r) => r.id === all[0].id)!;
    assert.ok(made.course.length > 20 && made.branches.length >= 1, `a course and tributaries (${made.course.length} points, ${made.branches.length} tributaries)`);
    const mouth = made.course[made.course.length - 1];
    assert.ok(mouth[1] > 36.2 && mouth[1] < 37.2, `its mouth at the coast (${mouth})`);
    const mid = made.course[Math.floor(made.course.length / 2)];
    const ground = await page.evaluate(([lon, lat]) => { const m = (window as any).__mapmaker, s = m.store, g = s.terrainOf(s.world.get('map_space', s.spaceId)); return m.bench.heightAt(g.grid, lon, lat); }, mid);
    assert.ok(ground > 200, `its middle well above the sea (${Math.round(ground)} m)`);
    await page.waitForTimeout(500);
    const q = await h.toPage(mid);
    const water = await page.evaluate(([x, y]) => {
      const c = document.querySelector('canvas.map-canvas') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
      const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 5, Math.round((y - r.top) * k) - 5, 11, 11).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 25 && d[i + 2] > d[i + 1]) n++;
      return n;
    }, q);
    assert.ok(water >= 3, `its water drawn there (${water} pixels)`);
    await h.screenshot('river-pen');
    // Nothing of the map changed but its water (D226): at each zoom, every pixel that differs from the map before is
    // bluer than it was (the river and its tributaries); no darker squares, no coast or relief changed.
    await h.chooseTool('select');
    await page.getByTestId('studio-history').click();
    await picture('after');
    const diffs = await page.evaluate((n) => {
      const shots = (window as any).__riverShots, out: Array<{ water: number; other: number }> = [];
      for (let v = 0; v < n; v++) {
        const a = shots[`before${v}`] as Uint8ClampedArray, b = shots[`after${v}`] as Uint8ClampedArray;
        let water = 0, other = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) <= 18) continue;
          if (b[i + 2] - b[i] > a[i + 2] - a[i] + 4) water++; else other++;
        }
        out.push({ water, other });
      }
      return out;
    }, views.length);
    for (const [v, d] of diffs.entries()) assert.ok(d.water > 15 && d.other <= 12, `view ${v}: its water drawn (${d.water} pixels) and nothing else changed (${d.other})`);
    await page.getByTestId('studio-map').click();
    await page.getByTestId('tool-sculpt').click();
    // With the brush: a stroke kept as the points where it turns.
    await page.getByTestId('river-draw-brush').click();
    const strokeLL: Array<[number, number]> = [[42.5, 39.6], [41.6, 39.0], [40.8, 38.9], [40.0, 38.2]];
    const pts: Array<[number, number]> = [];
    for (const ll of strokeLL) pts.push(await h.toPage(ll));
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 12 });
    await page.mouse.up();
    await h.saved();
    all = await rivers();
    assert.equal(all.length, 2);
    const brushed = all[1];
    assert.ok(brushed.path.length >= 2 && brushed.path.length <= 12, `kept as the points where it turns (${brushed.path.length})`);
    assert.equal(brushed.river?.drawn, 'brush');
    // Chosen (the one just drawn): a point dragged to a new place, and the river worked out again.
    const p1 = await h.toPage(brushed.path[1]);
    await page.mouse.move(p1[0], p1[1]);
    await page.mouse.down();
    await page.mouse.move(p1[0] + 30, p1[1] + 25, { steps: 6 });
    await page.mouse.up();
    await h.saved();
    const moved = (await rivers())[1];
    assert.notDeepEqual(moved.path[1], brushed.path[1], 'its point moved');
    assert.equal(moved.rev, 1, 'changed once');
    // Its settings in Properties: many tributaries, not along the valleys.
    const fewer = (await shapes()).find((r) => r.id === moved.id)!.branches.length;
    await page.getByTestId('river-sel-tributaries').fill('1');
    await page.getByTestId('river-sel-tributaries').dispatchEvent('pointerup');
    await h.saved();
    const more = (await shapes()).find((r) => r.id === moved.id)!.branches.length;
    assert.ok(more > fewer, `more tributaries (${fewer}, then ${more})`);
    await page.getByTestId('river-sel-follow').uncheck();
    await h.saved();
    assert.equal((await rivers())[1].river?.follow, false);
    // The first river chosen with Select, by its water; Delete takes it away; undone.
    await h.chooseTool('select');
    made = (await shapes()).find((r) => r.id === all[0].id)!;
    const on = await h.toPage(made.course[Math.floor(made.course.length * 0.3)]);
    await page.mouse.click(on[0], on[1]);
    assert.deepEqual(await page.evaluate(() => (window as any).__mapmaker.store.selection), { kind: 'river', id: all[0].id, spaceId: await page.evaluate(() => (window as any).__mapmaker.store.spaceId) });
    await page.keyboard.press('Delete');
    await h.saved();
    assert.equal((await rivers()).length, 1, 'taken away');
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal((await rivers()).length, 2, 'back');
    // Back as before.
    for (let i = 0; i < 12 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal((await rivers()).length, 0);
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 0, lat: 20, zoom: 0, rotation: 0, projection: 'equirectangular' }));
    await page.getByTestId('studio-history').click();
  });

  await h.step('Borders at the coast (D221): along the coastline by default, as drawn over the sea, or none; a country whose land carries on over the sea; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -8.6, lat: 39.5, zoom: 4.4, rotation: 0, projection: 'equirectangular' }));
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    // A layer of its own (ending at the coast, as a new layer does), and a country drawn round Portugal, out over the Atlantic.
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('new-layer-name').fill('Coasts');
    await page.getByTestId('new-layer-name').press('Enter');
    await page.locator('.list-panel .row', { hasText: 'Coasts' }).getByText('drawing here').waitFor();
    await h.newCountry('Lusitania');
    await h.chooseTool('lasso');
    await page.getByTestId('paint-owner').selectOption({ label: 'Lusitania' });
    const ring: LL[] = [[-11, 42.1], [-6.7, 42.1], [-6.7, 36.9], [-11, 36.9]];
    const pts: Array<[number, number]> = [];
    for (const ll of ring) { const q = await h.toPage(ll); pts.push(q); }
    const dense: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; for (let k = 0; k < 6; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / 6, a[1] + ((b[1] - a[1]) * k) / 6]); }
    await h.drawLasso(dense);
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await page.getByTestId('confirm-edit').waitFor({ state: 'detached' });
    await h.saved();
    const ids = await page.evaluate(() => { const s = (window as any).__mapmaker.store; return { layer: s.layerId as string, country: s.world.all('entity').find((e: any) => e.name === 'Lusitania').id as string }; });
    // The same in SVG frames: drawn by the browser, the file is the frame exported. Along the coast, the coastline as a line
    // kept to the country; as drawn, its edges against nobody whole; its land carrying on over the sea, its colour there too.
    const svgOf = async () => page.evaluate(async () => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const shot = B.defaultShot(s.spaceId, { lon: -8.6, lat: 39.5, zoom: 4.4, rotation: 0, projection: 'equirectangular' }, s.time, s.time, 24, 0.5);
      shot.width = 640; shot.height = 480;
      const { svg } = await B.svgFrame({ world: s.world, engine: s.engine, shot, shotName: 'Coasts', frame: 0 });
      const c = document.createElement('canvas'); c.width = 640; c.height = 480;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      B.renderFrame(ctx, new B.MapRenderer(), s.world, s.engine, shot, 0, B.PASS_DEFS.find((d: any) => d.name === 'all'), 640, 480, s.basemap, await B.terrainFor(s.world, s.spaceId, shot));
      const a = ctx.getImageData(0, 0, 640, 480).data;
      const img = new Image();
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
      ctx.clearRect(0, 0, 640, 480);
      ctx.drawImage(img, 0, 0);
      const b = ctx.getImageData(0, 0, 640, 480).data;
      let off = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) off++;
      return { svg: svg as string, off: off / (a.length / 4) };
    });
    const alongSvg = await svgOf();
    // (The layer's place among the frame's layers.)
    const n = Number(/<g id="borders-(\d+)" inkscape:groupmode="layer" inkscape:label="Borders: Coasts"/.exec(alongSvg.svg)?.[1]);
    assert.ok(alongSvg.svg.includes(`<g mask="url(#coast-where-${n})">\n<path id="coast-border-${n}"`), `the coast line in the SVG, kept to the country (layer ${n})`);
    assert.ok(alongSvg.off < 0.02, `the SVG drawn is the frame (${(alongSvg.off * 100).toFixed(2)}% of pixels apart)`);
    await page.evaluate(([layer, country]) => {
      const m = (window as any).__mapmaker, s = m.store;
      s.execute((w: any) => m.bench.commands.setLayerCoastBorder(w, layer, 'drawn'));
      s.execute((w: any) => m.bench.commands.setEntityOverSea(w, country, true));
    }, [ids.layer, ids.country] as const);
    await h.saved();
    const drawnSvg = await svgOf();
    assert.ok(!new RegExp(`coast-border-${n}[-"]`).test(drawnSvg.svg) && drawnSvg.svg.includes(`<path id="border-bw${n}-${ids.country}"`), 'as drawn: its edges whole, no coast line');
    assert.ok(new RegExp(`<g mask="url\\(#sea-only\\)">\\n<path id="territory-${ids.country}-sea"`).test(drawnSvg.svg), 'its colour over the sea');
    assert.ok(drawnSvg.off < 0.02, `the SVG drawn is the frame (${(drawnSvg.off * 100).toFixed(2)}% of pixels apart)`);
    for (let i = 0; i < 2; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    // Its edges against nobody in magenta, to be seen.
    await page.evaluate((layer) => { const m = (window as any).__mapmaker, s = m.store; s.execute((w: any) => m.bench.commands.setLayerBorders(w, layer, { between: null, pairs: [], coast: { color: '#ff00ff', opacity: 1, width: 3, dash: 'solid', dashScale: 1, double: 0, casing: 0, casingColor: '#ffffff', ticks: 0, tickLength: 6, sketch: 0, soft: 0, glow: 0, glowColor: '#ffe9a6', march: 0 } })); }, ids.layer);
    await h.saved();
    const rectOf = async (nw: LL, se: LL) => { const a = await h.toPage(nw), b = await h.toPage(se); return [a[0], a[1], b[0], b[1]] as const; };
    const count = async (rect: readonly [number, number, number, number]) => {
      await page.waitForTimeout(500);
      return page.evaluate(([x0, y0, x1, y1]) => {
        const c = document.querySelector('canvas.map-canvas') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
        const d = c.getContext('2d')!.getImageData(Math.round((x0 - r.left) * k), Math.round((y0 - r.top) * k), Math.max(1, Math.round((x1 - x0) * k)), Math.max(1, Math.round((y1 - y0) * k))).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 2] > 190 && d[i + 1] < 90) n++;
        return n;
      }, rect);
    };
    // Along Portugal's west coast, and out at sea west of it (within the outline drawn).
    const coastBox = await rectOf([-10.2, 41.2], [-8.6, 38.6]), seaBox = await rectOf([-11.6, 41.2], [-10.4, 38.6]);
    // Along the coast (as at first): the coastline drawn as its border, none out at sea.
    const alongCoast = await count(coastBox);
    assert.ok(alongCoast > 20, `its border along the coast (${alongCoast} pixels)`);
    assert.equal(await count(seaBox), 0, 'none out at sea');
    await h.screenshot('coast-borders');
    // With the terrain sculpted somewhere (D227: the terrain then has its say on coasts): still the coastline as its
    // border, and no line anywhere inland, however steep the ground (steep slopes were drawn as coast).
    const inland = await rectOf([-8.2, 40.4], [-7.5, 38.4]), all = await rectOf([-10.2, 42.0], [-7.0, 37.0]);
    assert.ok((await count(inland)) < 5, 'no border inland');
    const lineBefore = await count(all);
    await page.evaluate(() => { const m = (window as any).__mapmaker, s = m.store; s.execute((w: any) => m.bench.commands.addTerrainStamp(w, s.spaceId, { tool: 'raise', path: [[20, 50]], radiusKm: 100, strength: 300, seed: 1, from: null })); });
    await h.saved();
    // (Once the Earth's heights are in and the map drawn with them.)
    await page.waitForFunction(() => { const s = (window as any).__mapmaker.store; return !!s.terrainOf(s.world.get('map_space', s.spaceId)); }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const sculptedCoast = await count(coastBox), sculptedInland = await count(inland);
    assert.ok(sculptedCoast > 20, `its border along the coast still (${sculptedCoast} pixels)`);
    assert.ok(sculptedInland < 5, `no border inland with the terrain sculpted (${sculptedInland} pixels)`);
    // (Low ground beside the coast, the Tagus plain here, was drawn as coast all over once the terrain was sculpted.)
    const lineAfter = await count(all);
    assert.ok(Math.abs(lineAfter - lineBefore) <= 0.06 * lineBefore + 6, `the same line as before the terrain was sculpted (${lineAfter} pixels against ${lineBefore})`);
    assert.equal(await count(seaBox), 0, 'none out at sea');
    await h.screenshot('coast-borders-sculpted');
    await page.getByTestId('undo').click();
    await h.saved();
    // None at the coast.
    await page.evaluate((layer) => (window as any).__mapmaker.store.set({ selection: { kind: 'layer', id: layer } }), ids.layer);
    await page.getByTestId('coast-border').selectOption('none');
    await h.saved();
    assert.ok((await count(coastBox)) < 5, 'no border along the coast');
    // As drawn: its border out over the sea too, though its colours end at the coast.
    await page.getByTestId('coast-border').selectOption('drawn');
    await h.saved();
    assert.ok((await count(seaBox)) > 10, 'its border over the sea, where drawn');
    await page.getByTestId('coast-border').selectOption('coast');
    await h.saved();
    // A country whose land carries on over the sea (switched in the drawing tools): its colour out at sea, its border where drawn.
    const sea = async () => { const q = await h.toPage([-10.4, 39.5]), o = await h.toPage([-12.3, 39.5]); return page.evaluate(([a, b]) => {
      const c = document.querySelector('canvas.map-canvas') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width, g = c.getContext('2d')!;
      const px = (p: number[]) => Array.from(g.getImageData(Math.round((p[0] - r.left) * k), Math.round((p[1] - r.top) * k), 1, 1).data).slice(0, 3);
      const x = px(a), y = px(b);
      return Math.max(...x.map((v, i) => Math.abs(v - y[i])));
    }, [q, o]); };
    assert.ok((await sea()) < 12, 'the sea inside its outline is sea');
    await page.getByTestId('paint-wraps-coast').uncheck();
    await h.saved();
    await page.waitForTimeout(400);
    assert.ok((await sea()) > 25, 'its colour over the sea');
    assert.ok((await count(seaBox)) > 10, 'its border where drawn');
    await page.evaluate((id) => (window as any).__mapmaker.store.set({ selection: { kind: 'entity', id } }), ids.country);
    assert.equal(await page.getByTestId('country-over-sea').isChecked(), true, 'the same setting in its panel');
    await h.screenshot('over-sea');
    // Undone, back as before.
    for (let i = 0; i < 12 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    await h.chooseTool('select');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
  });

  await h.step('Advance and buffer zone (D222): a buffer zone either side of a border to nobody; an advance taking the neighbour\'s land within the distance of their border, by travel through the land, in an event spreading from the border; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 26, lat: 48.5, zoom: 4.2, rotation: 0, projection: 'equirectangular' }));
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    // A layer of its own, and two countries side by side on the plain north of the Black Sea, their border along 25° east
    // (from ten years before the date viewed: a change in an event at the very moment a correction is made gives way to it).
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('new-layer-name').fill('Marches');
    await page.getByTestId('new-layer-name').press('Enter');
    await page.locator('.list-panel .row', { hasText: 'Marches' }).getByText('drawing here').waitFor();
    await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store;
      const box = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
      s.execute((w: any, e: any) => m.bench.commands.addCountries(w, e, { spaceId: s.spaceId, layerId: s.layerId, countries: [{ name: 'Westmark', polygons: [box(20, 47, 25, 50)], color: '#3d7dd8' }, { name: 'Ostland', polygons: [box(25, 47, 31, 50)], color: '#d8823d' }], mode: { kind: 'change', t: { day: s.time.day - 3650, ms: 0 } } }));
    });
    await h.saved();
    // Who holds a place at the date viewed (or so many days later), on this layer.
    const owner = (lon: number, lat: number, later = 0) => page.evaluate(([x, y, days]) => {
      const m = (window as any).__mapmaker, s = m.store, arr = s.world.arrangement(s.spaceId);
      const t = { day: s.time.day + days, ms: s.time.ms };
      const id = m.bench.commands.ownerReader(arr, s.engine.partitionState(s.spaceId, s.layerId, t))(arr.locate(m.bench.lonLatToVec(x, y)));
      return id ? s.world.get('entity', id).name as string : null;
    }, [lon, lat, later] as const);
    assert.deepEqual([await owner(24, 48.5), await owner(26, 48.5)], ['Westmark', 'Ostland']);
    // The tool, its options: the land not minded (as the crow flies over it), so that the distances are the map's own.
    await page.getByTestId('tool-select').click();
    await page.locator('.viewer-panel').hover();
    await page.keyboard.press('m');
    assert.equal(await page.getByTestId('tool-name').textContent(), 'Advance & buffer zone', 'its key, M');
    if (await page.getByTestId('reach-mind').count()) await page.getByTestId('reach-mind').fill('0');
    const kmPerDeg = 6371.0088 * Math.PI / 180 * Math.cos((48.5 * Math.PI) / 180);
    // A buffer zone 100 km either side of the border, to nobody: a click beside the border.
    await page.getByTestId('reach-mode').selectOption('buffer');
    await page.getByTestId('reach-owner').selectOption('');
    await page.getByTestId('reach-km').fill('100');
    const near = await h.toPage([25.04, 48.5]);
    await page.mouse.click(near[0], near[1]);
    await page.getByTestId('reach-what').waitFor();
    assert.match((await page.getByTestId('reach-what').textContent()) ?? '', /A buffer zone 100 km either side of the border of (Westmark and Ostland|Ostland and Westmark), to nobody/);
    await h.screenshot('buffer-zone');
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await page.getByTestId('confirm-edit').waitFor({ state: 'detached' });
    await h.saved();
    const d100 = 100 / kmPerDeg;
    assert.deepEqual([await owner(25 - d100 / 2, 48.5), await owner(25 + d100 / 2, 48.5)], [null, null], 'nobody\'s land either side');
    assert.deepEqual([await owner(25 - 1.6 * d100, 48.5), await owner(25 + 1.6 * d100, 48.5)], ['Westmark', 'Ostland'], 'beyond it, theirs');
    await page.getByTestId('undo').click();
    await h.saved();
    assert.equal(await owner(25.3, 48.5), 'Ostland', 'the zone undone');
    // An advance: Westmark advances 200 km into Ostland, in an event spreading from the border.
    await page.getByTestId('reach-mode').selectOption('advance');
    await page.getByTestId('reach-owner').selectOption({ label: 'Westmark' });
    await page.getByTestId('reach-km').fill('200');
    const inside = await h.toPage([28.5, 48.5]);
    await page.mouse.click(inside[0], inside[1]);
    await page.getByTestId('reach-what').waitFor();
    assert.match((await page.getByTestId('reach-what').textContent()) ?? '', /Westmark advances 200 km into Ostland from the border they share/);
    await h.screenshot('advance');
    await page.getByTestId('choice-new').click();
    await page.getByTestId('event-target').selectOption('new-event');
    assert.equal(await page.getByTestId('new-event-name').inputValue(), 'Westmark advances into Ostland');
    await page.getByTestId('confirm-edit').click();
    await page.getByTestId('confirm-edit').waitFor({ state: 'detached' });
    await h.saved();
    // (Once the event is over: the change spreads from the border while it lasts.)
    const ev = await page.evaluate(() => { const s = (window as any).__mapmaker.store, e = s.selection?.kind === 'event' ? s.world.get('event', s.selection.id) : null; return e ? { name: e.name as string, days: e.end_day === null ? 0 : (e.end_day as number) - s.time.day + 1 } : null; });
    assert.equal(ev?.name, 'Westmark advances into Ostland', 'the event made, and chosen');
    const d200 = 200 / kmPerDeg, after = Math.max(1, ev!.days);
    assert.equal(await owner(25 + d200 / 2, 48.5, after), 'Westmark', 'half the distance in: taken');
    assert.equal(await owner(25 + d200 * 1.3, 48.5, after), 'Ostland', 'beyond the distance: still Ostland\'s');
    assert.equal(await owner(22, 48.5, after), 'Westmark');
    // Undone, back as before.
    for (let i = 0; i < 12 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    await h.chooseTool('select');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
  });

  await h.step('Zones of control (D223): a country\'s land divided among its cities by travel through it, the zones drawn while the dialog asks; a city left out; every place to one of the cities; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 25.5, lat: 48.5, zoom: 4.2, rotation: 0, projection: 'equirectangular' }));
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    // A layer of its own; a country on the plain north of the Black Sea and three cities on its land (from ten years before).
    await page.getByRole('button', { name: '+ Layer' }).click();
    await page.getByTestId('new-layer-name').fill('Domains');
    await page.getByTestId('new-layer-name').press('Enter');
    await page.locator('.list-panel .row', { hasText: 'Domains' }).getByText('drawing here').waitFor();
    await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, C = m.bench.commands, t = { day: s.time.day - 3650, ms: 0 };
      s.execute((w: any, e: any) => C.addCountries(w, e, { spaceId: s.spaceId, layerId: s.layerId, countries: [{ name: 'Midland', polygons: [[[[20, 47], [31, 47], [31, 50], [20, 50], [20, 47]]]], color: '#6aa84f' }], mode: { kind: 'change', t } }));
      for (const [name, lon, lat] of [['Westburg', 22, 49], ['Ostburg', 29, 49], ['Mittel', 25.5, 48]] as const) {
        const id = s.execute((w: any) => C.createEntity(w, { type_id: 'settlement', name }));
        s.execute((w: any) => C.placeCharacter(w, { spaceId: s.spaceId, entity: id, lon, lat, mode: { kind: 'change', t } }));
      }
    });
    await h.saved();
    const owner = (lon: number, lat: number) => page.evaluate(([x, y]) => {
      const m = (window as any).__mapmaker, s = m.store, arr = s.world.arrangement(s.spaceId);
      const id = m.bench.commands.ownerReader(arr, s.engine.partitionState(s.spaceId, s.layerId, s.time))(arr.locate(m.bench.lonLatToVec(x, y)));
      return id ? s.world.get('entity', id).name as string : null;
    }, [lon, lat] as const);
    // The tool's third use: a click on the country opens the dialog, its three cities chosen, the zones on the map.
    await page.getByTestId('tool-select').click();
    await page.locator('.viewer-panel').hover();
    await page.keyboard.press('m');
    await page.getByTestId('reach-mode').selectOption('zones');
    if (await page.getByTestId('reach-mind').count()) await page.getByTestId('reach-mind').fill('0');
    const at = await h.toPage([25.5, 49.6]);
    await page.mouse.click(at[0], at[1]);
    await page.getByTestId('zones').waitFor();
    const cities = page.getByTestId('zone-city');
    assert.deepEqual((await cities.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).dataset.name))).sort(), ['Mittel', 'Ostburg', 'Westburg']);
    assert.equal(await cities.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length), 3, 'all three chosen');
    assert.ok(await page.evaluate(() => (window as any).__mapmaker.store.zonesDraft?.zones?.length === 3), 'three zones worked out');
    await h.screenshot('zones-of-control');
    // Mittel left out: two zones, and none kept by the country.
    await page.locator('[data-testid="zone-city"][data-name="Mittel"]').uncheck();
    assert.ok(await page.evaluate(() => (window as any).__mapmaker.store.zonesDraft?.zones?.length === 2), 'two zones now');
    assert.equal(await page.getByTestId('zones-keep').inputValue(), '', 'nothing kept by the country: Mittel was its zone to keep');
    await page.getByTestId('when-change').click();
    await page.getByTestId('confirm-zones').click();
    await page.getByTestId('zones').waitFor({ state: 'detached' });
    await h.saved();
    assert.deepEqual([await owner(21, 48.5), await owner(30, 48.5)], ['Westburg', 'Ostburg'], 'each end to the city in it');
    // Every place of Midland's land to one of the two; none left to Midland, none to nobody.
    const held = new Set<string | null>();
    for (let x = 20.4; x < 31; x += 0.8) for (let y = 47.3; y < 50; y += 0.6) held.add(await owner(x, y));
    assert.deepEqual([...held].sort(), ['Ostburg', 'Westburg']);
    // Undone, back as before.
    for (let i = 0; i < 14 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    await h.chooseTool('select');
    await page.evaluate(() => (window as any).__mapmaker.store.set({ selection: null }));
  });

  await h.step('Curves (D232): the precise shape and the border pen draw as Photoshop\'s pen: corners clicked, a curve dragged, a point added on the line keeping its shape, points and handles moved, Alt for a corner, closed by a click on the first point; the pen\'s curves kept in its draft; undone', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: -40, lat: 20, zoom: 2, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1700');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    await h.newCountry('Curvia');
    type A = { p: [number, number]; i?: [number, number] | null; o?: [number, number] | null };
    const anchors = () => page.evaluate(() => (window as any).__mapmaker.shapeAnchors()) as Promise<A[]>;
    await h.chooseTool('polygon');
    const { cx, cy } = await h.centre();
    const P = [[cx - 120, cy - 80], [cx + 80, cy - 80], [cx + 120, cy + 60]] as const;
    for (const [x, y] of P) await page.mouse.click(x, y);
    // Pressed and dragged: a smooth point, its handles either side.
    await page.mouse.move(cx - 100, cy + 90); await page.mouse.down(); await page.mouse.move(cx - 40, cy + 90, { steps: 6 }); await page.mouse.up();
    let a = await anchors();
    assert.equal(a.length, 4);
    assert.ok(!a[0].o && !a[1].i && !a[2].o, 'clicked: corners');
    assert.ok(a[3].o && a[3].i, 'dragged: handles');
    assert.ok(Math.abs(a[3].o![0] + a[3].i![0] - 2 * a[3].p[0]) < 1e-6 && Math.abs(a[3].o![1] + a[3].i![1] - 2 * a[3].p[1]) < 1e-6, 'in line, either side');
    // A click on the line between the first two adds a point there; the line stays where it was.
    await page.mouse.click(cx - 20, cy - 80);
    a = await anchors();
    assert.equal(a.length, 5);
    const added = await h.toPage(a[1].p);
    assert.ok(Math.abs(added[0] - (cx - 20)) < 2 && Math.abs(added[1] - (cy - 80)) < 2, `on the line (${added})`);
    // Dragged, the point moves; a handle dragged turns the other with it; Alt-clicked, a corner again.
    await page.mouse.move(added[0], added[1]); await page.mouse.down(); await page.mouse.move(added[0], added[1] - 40, { steps: 5 }); await page.mouse.up();
    a = await anchors();
    assert.equal(a.length, 5, 'moved, not added');
    const movedTo = await h.toPage(a[1].p);
    assert.ok(Math.abs(movedTo[1] - (cy - 120)) < 2, 'moved up');
    const knob = await h.toPage(a[4].o!);
    await page.mouse.move(knob[0], knob[1]); await page.mouse.down(); await page.mouse.move(knob[0], knob[1] + 40, { steps: 5 }); await page.mouse.up();
    a = await anchors();
    const turned = await h.toPage(a[4].i!), at4 = await h.toPage(a[4].p);
    assert.ok(turned[1] < at4[1] - 10, 'the other handle turned with it');
    await h.screenshot('curves-shape');
    const corner = await h.toPage(a[4].p);
    await page.keyboard.down('Alt'); await page.mouse.click(corner[0], corner[1]); await page.keyboard.up('Alt');
    a = await anchors();
    assert.ok(!a[4].i && !a[4].o, 'a corner again');
    // A click on the first point closes it: the usual question, then the land.
    const first = await h.toPage(a[0].p);
    await page.mouse.click(first[0], first[1]);
    await page.getByTestId('choice-correct').click();
    await page.getByTestId('confirm-edit').click();
    await h.saved();
    assert.equal((await anchors()).length, 0, 'finished');
    assert.equal(await h.ownerAt(await h.toLL([cx, cy]), '1700'), 'Curvia');
    // The border pen in curves: the draft keeps its anchors and handles, and the line they make.
    await h.chooseTool('pen');
    // (Curves are the pen's way at first; an earlier step chose freehand.)
    await page.getByTestId('pen-mode').selectOption('curves');
    await page.getByTestId('paint-owner').selectOption({ label: 'Curvia' });
    const Q = [[cx + 160, cy - 60], [cx + 300, cy - 60], [cx + 300, cy + 80]] as const;
    for (const [x, y] of Q) await page.mouse.click(x, y);
    await page.mouse.move(cx + 170, cy + 80); await page.mouse.down(); await page.mouse.move(cx + 130, cy + 80, { steps: 6 }); await page.mouse.up();
    const draft = () => page.evaluate(() => { const d = (window as any).__mapmaker.store.draft; return { curve: d.curve as A[], points: d.points.length as number }; });
    let dr = await draft();
    assert.equal(dr.curve.length, 4);
    assert.ok(dr.points > 10, `the curve laid out as points (${dr.points})`);
    await page.keyboard.press('Backspace');
    assert.equal((await draft()).curve.length, 3, 'Backspace: the last point taken back');
    await page.keyboard.press('Control+y');
    dr = await draft();
    assert.equal(dr.curve.length, 4, 'put back');
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-correct').waitFor();
    await page.keyboard.press('Enter');
    await page.getByTestId('choice-correct').waitFor({ state: 'detached' });
    await h.saved();
    assert.equal(await h.ownerAt(await h.toLL([cx + 240, cy + 10]), '1700'), 'Curvia', 'the border drawn in curves painted the land');
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.drafts.length), 0);
    // Undone.
    await h.chooseTool('select');
    for (let i = 0; i < 8 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
  });

  await h.step('Many disasters with a brush (D233): seventy thousand nuclear strikes scattered along a stroke over Europe, of yields from 100 kt to 5 Mt, over six hours; none at first, all after; drawn in the working view and a 4K frame; kept small; undone in one step', async () => {
    await page.getByTestId('studio-history').click();
    await page.getByTestId('map-select').selectOption({ label: 'Earth' });
    await page.evaluate(() => (window as any).__mapmaker.store.setCamera({ lon: 15, lat: 50, zoom: 2.2, rotation: 0, projection: 'equirectangular' }));
    await h.setDate('1990');
    const steps = async () => (await page.evaluate(() => (window as any).__mapmaker.store.journal.head)) as number;
    const before = await steps();
    await page.getByTestId('tool-disaster').click();
    await page.getByTestId('disaster-kind').selectOption('nuclear');
    await page.getByTestId('disaster-place').selectOption('many');
    for (const [id, v] of [['disaster-count', '70000'], ['disaster-brush-km', '250'], ['disaster-least', '100'], ['disaster-most', '5000'], ['disaster-over', '6']] as const) await page.getByTestId(id).fill(v);
    await page.getByTestId('disaster-over-unit').selectOption('hours');
    assert.match((await page.getByTestId('disaster-hint').textContent()) ?? '', /70,000 nuclear strikes scattered within 250 km of the stroke, one by one over 6 hours/);
    // A stroke from Paris to Moscow.
    const a = await h.toPage([2.3, 48.9]), b = await h.toPage([37.6, 55.8]);
    const t0 = Date.now();
    await page.mouse.move(a[0], a[1]); await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / 20, a[1] + ((b[1] - a[1]) * i) / 20);
    await page.mouse.up();
    await h.saved();
    const placed = Date.now() - t0;
    const made = await page.evaluate(() => {
      const s = (window as any).__mapmaker.store;
      return { events: s.world.all('event').map((e: any) => e.name), features: s.world.all('feature').filter((f: any) => f.style.includes('"scatter"')).map((f: any) => f.style.length) };
    });
    assert.ok(made.events.includes('70,000 × nuclear strike (100 kt to 5 Mt)'), made.events.join(', '));
    assert.equal(made.features.length, 3, 'one source for each condition');
    assert.ok(made.features.every((n: number) => n < 4000), `kept small (${made.features.join(', ')} characters)`);
    // None just before; after six hours, all seventy thousand; drawn in the working view.
    const shown = async (iso: string) => {
      await h.setDate(iso);
      await page.waitForTimeout(300);
      const t1 = Date.now();
      const r = await page.evaluate(async () => {
        const s = (window as any).__mapmaker.store;
        s.notify();
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        return s.renderer.lastFields.map((f: any) => ({ sources: f.sources, drawn: f.drawn }));
      }) as Array<{ sources: number; drawn: number }>;
      return { ms: Date.now() - t1, total: r.reduce((n, f) => n + f.sources, 0), drawn: r.reduce((n, f) => n + f.drawn, 0) };
    };
    const later = await shown('2 January 1990');
    console.log(`  70,000 strikes: placed in ${placed} ms; the working view the day after in ${later.ms} ms (${later.total} sources in force, ${later.drawn} drawn)`);
    // (Drawn as some of them, each standing for several: at most so many of each scatter in the working view.)
    assert.ok(later.total > 3000 && later.total <= 3 * 6000, `drawn as some thousands standing for them all (${later.total})`);
    assert.ok(later.drawn > 1000, 'drawn');
    assert.ok(later.ms < 15000, `the working view in reasonable time (${later.ms} ms)`);
    await h.screenshot('disasters-70000');
    const r = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const start = { day: s.time.day, ms: 0 };
      const shot = B.defaultShot(s.spaceId, { lon: 20, lat: 52, zoom: 2.2, rotation: 0, projection: 'equirectangular' }, start, { day: start.day + 1, ms: 0 }, 24, 1);
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
      return { frameMs, coloured: coloured / (data.length / 64) };
    });
    console.log(`  a 4K frame of them in ${Math.round(r.frameMs)} ms (${(r.coloured * 100).toFixed(0)}% coloured)`);
    assert.ok(r.coloured > 0.02, 'coloured where they fell');
    assert.ok(r.frameMs < 60000, `a 4K frame in reasonable time (${Math.round(r.frameMs)} ms)`);
    // Half way through the six hours, about half of them.
    const mid = await page.evaluate(() => {
      const m = (window as any).__mapmaker, s = m.store, B = m.bench;
      const layer = s.world.all('layer').find((l: any) => l.kind === 'field' && JSON.parse(l.style).field.type === 'damage');
      const ev = s.world.all('event').find((e: any) => e.name.startsWith('70,000'));
      const at = (h: number) => B.activeSources(s.world, s.engine, layer.id, { day: ev.start_day, ms: (ev.start_ms ?? 0) + h * 3600000 }, B.compare).length;
      return [at(-1), at(3), at(7)];
    });
    assert.equal(mid[0], 0, 'none before');
    assert.ok(mid[1] > 28000 && mid[1] < 42000, `about half after three hours (${mid[1]})`);
    assert.equal(mid[2], 70000, 'all after six');
    // One undo takes them all back.
    await page.getByTestId('tool-select').click();
    for (let i = 0; i < 4 && (await steps()) > before; i++) { await page.getByTestId('undo').click(); await h.saved(); }
    assert.equal(await steps(), before);
    assert.equal(await page.evaluate(() => (window as any).__mapmaker.store.world.all('feature').filter((f: any) => f.style.includes('"scatter"')).length), 0);
  });

  await h.step('History Health lists the overlap, nothing else; no browser errors', async () => {
    await page.getByTestId('studio-history').click();
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
