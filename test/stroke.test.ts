// Freehand strokes become clean outlines before they become map geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { processLasso, signedArea, simplify, dedupe, type Pt, type StrokeSettings } from '../src/render-engine/stroke.ts';

const settings: StrokeSettings = { smoothness: 1, irregularity: 0, precision: 1.2, seed: 1 };

/** Points along a closed outline the way a mouse delivers them: about every 3 pixels. */
function outline(cx: number, cy: number, rx: number, ry: number, returnToStart = true): Pt[] {
  const pts: Pt[] = [];
  const n = Math.ceil((2 * Math.PI * Math.max(rx, ry)) / 3);
  for (let i = 0; i < (returnToStart ? n + 1 : Math.floor(n * 0.93)); i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

test('an outline that ends where it started becomes one loop with the same area', () => {
  const loops = processLasso(outline(400, 300, 110, 80), settings);
  assert.equal(loops.length, 1);
  const area = Math.abs(signedArea(loops[0]));
  const expected = Math.PI * 110 * 80;
  assert.ok(Math.abs(area - expected) / expected < 0.03, `area ${area} vs ${expected}`);
});

test('an outline that stops short of its start is closed automatically', () => {
  const loops = processLasso(outline(400, 300, 110, 80, false), settings);
  assert.equal(loops.length, 1);
  assert.ok(Math.abs(signedArea(loops[0])) > 0.8 * Math.PI * 110 * 80);
});

test('loops have their inside on the left as seen on the map', () => {
  for (const pts of [outline(400, 300, 50, 40), outline(400, 300, 50, 40).reverse()]) {
    const [loop] = processLasso(pts, settings);
    assert.ok(signedArea(loop) < 0, 'screen y points down, so the inside on the left means negative area');
  }
});

test('a figure eight becomes two separate loops', () => {
  const pts: Pt[] = [];
  for (let i = 0; i <= 400; i++) {
    const t = (i / 400) * Math.PI * 2;
    pts.push([400 + 120 * Math.sin(t), 300 + 60 * Math.sin(t) * Math.cos(t)]);
  }
  const loops = processLasso(pts, settings);
  assert.equal(loops.length, 2);
  for (const l of loops) assert.ok(Math.abs(signedArea(l)) > 1000);
});

test('a tiny scribble gives no loop', () => {
  assert.deepEqual(processLasso([[10, 10], [11, 10], [11, 11], [10, 10]], settings), []);
});

test('irregularity is reproducible: the same seed always gives the same shape', () => {
  const pts = outline(400, 300, 100, 70);
  const a = processLasso(pts, { ...settings, irregularity: 8, seed: 7 });
  const b = processLasso(pts, { ...settings, irregularity: 8, seed: 7 });
  const c = processLasso(pts, { ...settings, irregularity: 8, seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('simplification keeps closed outlines and drops repeated points', () => {
  const pts = outline(0, 0, 50, 50);
  assert.ok(simplify(pts, 1).length > 8);
  assert.equal(dedupe([[0, 0], [0, 0], [0.1, 0], [5, 5], [5, 5]]).length, 2);
});

test('border pen: a closed draft paints the small area it surrounds, whichever way round it was drawn', async () => {
  const { ringFromMapPoints } = await import('../src/render-engine/stroke.ts');
  const { World } = await import('../src/world-model/world.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { NEG_INF } = await import('../src/core-time/index.ts');
  const { lonLatToVec } = await import('../src/geo-kernel/vec.ts');
  const square: Array<[number, number]> = [[10, 10], [20, 10], [20, 20], [10, 20]];
  for (const pts of [square, [...square].reverse()]) {
    const world = new World();
    const space = cmd.seedProject(world, 'Pen').result.spaceId;
    const layer = world.all('layer')[0].id;
    const engine = new Engine(world);
    const A = cmd.createEntity(world, { type_id: 'polity', name: 'A' }).result;
    const ring = ringFromMapPoints(pts)!;
    cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring, value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
    assert.equal(engine.valueAtPoint(space, layer, lonLatToVec(15, 15), NEG_INF), A);
    assert.equal(engine.valueAtPoint(space, layer, lonLatToVec(-100, -40), NEG_INF), null);
  }
  assert.equal(ringFromMapPoints([[0, 0], [1, 1]]), null, 'two points enclose nothing');
  assert.equal(ringFromMapPoints([[0, 0], [0, 0], [1, 1], [0, 0]]), null, 'repeated points are dropped');
});
