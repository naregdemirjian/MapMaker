// Drawings by hand (S8, D251): drawings kept and checked, rectangles and ellipses from a box on the screen, the path as
// drawn, what lies under the pointer; the commands that add, change and take them away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { drawingsOf, boxShape, screenPath, hitsShape, drawingAt, nextDrawingName, drawingShows, withoutRepeats, shapeOf, textBox, toPattern, toLand, drawingOf, type Drawing, type LL, type Pt, type PathShape } from '../src/domain/drawings.ts';

// (A plain projection for the tests: a degree is ten pixels, north up.)
const project = (ll: LL): Pt => [ll[0] * 10, 0 - ll[1] * 10];
const unproject = (p: Pt): LL => [p[0] / 10, 0 - p[1] / 10];

test('drawings kept and checked: what is not one dropped, numbers held to their ranges, one of each id', () => {
  const list = drawingsOf([
    { id: 'a', name: '  Hatching  ', stroke: { color: '#112233', width: 9999 }, fill: 'red', opacity: 2, blend: 'multiply', shapes: [{ kind: 'path', closed: true, anchors: [{ p: [1, 2] }, { p: [3, 4], i: [2, 4], o: 'x' }, { p: [999, 0] }] }, { kind: 'path', anchors: [{ p: [0, 0] }] }] },
    { id: 'a', name: 'Again' },
    { name: 'No id' },
    'nonsense',
    { id: 'b', blend: 'sideways', on: false },
  ]);
  assert.deepEqual(list.map((d) => d.id), ['a', 'b']);
  const [a, b] = list;
  assert.equal(a.name, 'Hatching');
  assert.deepEqual(a.stroke, { color: '#112233', width: 200 });
  assert.equal(a.fill, null, 'not a colour');
  assert.equal(a.opacity, 1);
  assert.equal(a.blend, 'multiply');
  assert.equal(a.shapes.length, 1, 'a shape of one point dropped');
  assert.deepEqual((a.shapes[0] as PathShape).anchors, [{ p: [1, 2] }, { p: [3, 4], i: [2, 4] }], 'a point off the world dropped, a handle that is not one too');
  assert.equal(b.blend, 'normal');
  assert.equal(b.on, false);
  assert.equal(b.name, 'Drawing');
  assert.deepEqual(drawingsOf(undefined), []);
});

test('a rectangle and an ellipse from a box on the screen; a square and a circle; too small or off the map, none', () => {
  const r = boxShape('rectangle', [100, 50], [20, 10], unproject)!;
  assert.equal(r.closed, true);
  assert.deepEqual(r.anchors.map((a) => project(a.p)), [[20, 10], [100, 10], [100, 50], [20, 50]]);
  assert.ok(r.anchors.every((a) => !a.i && !a.o), 'corners');
  const e = boxShape('ellipse', [0, 0], [80, 40], unproject)!;
  assert.deepEqual(e.anchors.map((a) => project(a.p)), [[40, 0], [80, 20], [40, 40], [0, 20]]);
  // Each handle along the curve, the usual 0.552 of the half-width or half-height away.
  const top = e.anchors[0];
  assert.ok(Math.abs(project(top.o!)[0] - (40 + 40 * 0.5523)) < 0.01 && Math.abs(project(top.o!)[1]) < 1e-9);
  const sq = boxShape('rectangle', [0, 0], [30, 10], unproject, true)!;
  assert.deepEqual(project(sq.anchors[2].p), [30, 30], 'as high as it is wide');
  assert.equal(boxShape('ellipse', [0, 0], [1, 40], unproject), null);
  assert.equal(boxShape('rectangle', [0, 0], [40, 40], () => null), null);
});

test('a path as drawn on the screen: lines between corners, curves through handles, closed back to the first', () => {
  const s = { kind: 'path' as const, closed: true, anchors: [{ p: [0, 0] as LL }, { p: [10, 0] as LL, o: [10, -5] as LL }, { p: [10, -10] as LL }] };
  const segs = screenPath(s, project)!;
  assert.equal(segs.length, 4, 'a move, two pieces and the closing one');
  assert.deepEqual(segs[1], { to: [100, 0] });
  assert.deepEqual(segs[2], { to: [100, 100], c0: [100, 50], c1: [100, 100] });
  assert.deepEqual(segs[3], { to: [0, 0] });
  assert.equal(screenPath({ ...s, closed: false }, project)!.length, 3);
  assert.equal(screenPath(s, (ll) => (ll[0] > 5 ? null : project(ll))), null, 'part of it off the map');
});

test('what lies under the pointer: inside a filled shape, on the line of one not filled, the uppermost drawing', () => {
  const box = boxShape('rectangle', [0, 0], [100, 100], unproject)!;
  assert.equal(hitsShape(box, project, [50, 50], true, 1), true, 'inside, filled');
  assert.equal(hitsShape(box, project, [50, 50], false, 1), false, 'inside, not filled');
  assert.equal(hitsShape(box, project, [50, 3], false, 1), true, 'on its line');
  assert.equal(hitsShape(box, project, [150, 50], true, 1), false, 'outside');
  const d = (id: string, fill: string | null, on = true): Drawing => ({ id, name: id, on, stroke: { color: '#000000', width: 2 }, fill, opacity: 1, blend: 'normal', mode: 'land', tile: null, shapes: [box] });
  assert.equal(drawingAt([d('lower', '#ff0000'), d('upper', '#00ff00')], project, [50, 50], 1)?.id, 'upper');
  assert.equal(drawingAt([d('lower', '#ff0000'), d('upper', '#00ff00', false)], project, [50, 50], 1)?.id, 'lower', 'a hidden one passed over');
  assert.equal(drawingAt([d('lower', null)], project, [50, 50], 1), null);
  assert.equal(drawingShows(d('x', null)), true);
  assert.equal(drawingShows({ ...d('x', null), stroke: null }), false, 'nothing to draw it with');
  assert.equal(nextDrawingName([d('Drawing 1', null), d('drawing 2', null)].map((x) => ({ ...x, name: x.id }))), 'Drawing 3');
});

function project0() {
  const world = new World();
  cmd.seedProject(world, 'Drawings');
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Aldmere' }).result;
  const c = cmd.createEntity(world, { type_id: 'settlement', name: 'Port' }).result;
  return { world, a, c };
}

test('a shape drawn into a new drawing, then into it again; its looks and name changed; moved; taken away', () => {
  const { world, a, c } = project0();
  const shape = boxShape('ellipse', [0, 0], [80, 40], unproject)!;
  const id = cmd.addDrawingShape(world, a, null, shape, { stroke: { color: '#aa0000', width: 3 } }).result;
  let list = cmd.drawingsOfEntity(world.get('entity', a));
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Drawing 1');
  assert.deepEqual(list[0].stroke, { color: '#aa0000', width: 3 });
  assert.equal(cmd.addDrawingShape(world, a, id, boxShape('rectangle', [0, 0], [10, 10], unproject)!).result, id);
  assert.equal(cmd.drawingsOfEntity(world.get('entity', a))[0].shapes.length, 2);
  cmd.updateDrawing(world, a, id, { name: 'Mountain hatching', fill: '#ffcc00', opacity: 0.8, blend: 'multiply' });
  const second = cmd.addDrawing(world, a).result;
  list = cmd.drawingsOfEntity(world.get('entity', a));
  assert.deepEqual(list.map((d) => d.name), ['Mountain hatching', 'Drawing 1']);
  assert.equal(list[0].fill, '#ffcc00');
  assert.equal(list[0].blend, 'multiply');
  cmd.moveDrawing(world, a, second, -1);
  assert.deepEqual(cmd.drawingsOfEntity(world.get('entity', a)).map((d) => d.id), [second, id], 'drawn first now: under the other');
  cmd.removeDrawing(world, a, second);
  cmd.removeDrawing(world, a, id);
  assert.equal(cmd.entityStyle(world.get('entity', a)).drawings, undefined, 'none left: none kept');
  assert.throws(() => cmd.addDrawingShape(world, c, null, shape), /Only a country/);
  assert.throws(() => cmd.addDrawingShape(world, a, 'gone', shape), /no longer exists/);
  assert.throws(() => cmd.updateDrawing(world, a, 'gone', { name: 'X' }), /no longer exists/);
});

test('the pen\'s path (D252): a point falling on the one before dropped (a double-click), a curve\'s kept', () => {
  const a = (x: number, y: number, o?: LL) => ({ p: unproject([x, y]), ...(o ? { o } : {}) });
  const path = [a(0, 0), a(100, 0), a(100.5, 0.5), a(200, 0), a(200, 1, unproject([250, 0]))];
  assert.deepEqual(withoutRepeats(path, project).map((x) => project(x.p)), [[0, 0], [100, 0], [200, 0], [200, 1]]);
});

test('a drawing\'s shape reshaped and taken away (D252), the drawing kept', () => {
  const { world, a } = project0();
  const id = cmd.addDrawingShape(world, a, null, boxShape('rectangle', [0, 0], [40, 40], unproject)!).result;
  cmd.addDrawingShape(world, a, id, boxShape('ellipse', [0, 0], [40, 40], unproject)!);
  const moved = { kind: 'path' as const, closed: false, anchors: [{ p: [1, 1] as LL }, { p: [2, 2] as LL }] };
  cmd.updateDrawingShape(world, a, id, 0, moved);
  let d = cmd.drawingsOfEntity(world.get('entity', a))[0];
  assert.deepEqual(d.shapes[0], moved);
  assert.equal((d.shapes[1] as PathShape).anchors.length, 4, 'the other as it was');
  cmd.removeDrawingShape(world, a, id, 0);
  d = cmd.drawingsOfEntity(world.get('entity', a))[0];
  assert.equal(d.shapes.length, 1);
  assert.throws(() => cmd.updateDrawingShape(world, a, id, 5, moved), /no longer in the drawing/);
  assert.throws(() => cmd.updateDrawingShape(world, a, id, 0, { kind: 'path', closed: false, anchors: [{ p: [0, 0] }] }), /too few points/);
});

test('texts (D253): kept and checked, a box to point at, turned with the text; a drawing of a text shown with a line alone', () => {
  assert.equal(shapeOf({ kind: 'text', at: [10, 20], text: '   ' }), null, 'no words');
  assert.equal(shapeOf({ kind: 'text', at: [10, 99], text: 'X' }), null, 'off the world');
  const t = shapeOf({ kind: 'text', at: [10, 20], text: '  Aldmere  ', size: 9999, font: '', weight: 650, italic: 'yes', angle: 30 })!;
  assert.deepEqual(t, { kind: 'text', at: [10, 20], text: 'Aldmere', size: 400, font: 'Georgia', weight: 700, italic: false, angle: 30 });
  const flat = { ...(t as Extract<typeof t, { kind: 'text' }>), size: 20, angle: 0 };
  const b = textBox(flat, project, 1)!;
  assert.deepEqual(b.at, [100, -200]);
  assert.ok(b.hw > 30 && b.hh === 10);
  assert.equal(hitsShape(flat, project, [100 + b.hw - 2, -200], false, 0, 0), true, 'at its end');
  assert.equal(hitsShape(flat, project, [100, -200 + 30], false, 0, 0), false, 'below it');
  assert.equal(hitsShape({ ...flat, angle: 90 }, project, [100, -200 + b.hw - 2], false, 0, 0), true, 'turned upright: along it');
  const d: Drawing = { id: 'x', name: 'Words', on: true, stroke: { color: '#000000', width: 1 }, fill: null, opacity: 1, blend: 'normal', mode: 'land', tile: null, shapes: [flat] };
  assert.equal(drawingShows(d), true);
  assert.equal(drawingAt([d], project, [100, -200], 1)?.id, 'x');
});

test('a pattern that follows the country (D254): made from the drawing as seen, laid back on the land as it was; kept and checked', () => {
  const sq = boxShape('rectangle', [100, 100], [140, 120], unproject)!;
  const d: Drawing = { id: 'p', name: 'Crowns', on: true, stroke: { color: '#000000', width: 2 }, fill: '#ffcc00', opacity: 1, blend: 'normal', mode: 'land', tile: null, shapes: [sq, { kind: 'text', at: unproject([120, 140]), text: 'A', size: 10, font: 'Georgia', weight: 600, italic: false, angle: 0 }] };
  // At a unit of 2 (a frame twice as wide as 1920): sizes in the tile are halved.
  const p = toPattern(d, project, 2, 10)!;
  assert.equal(p.mode, 'pattern');
  const [w, h] = p.tile!;
  const corners = (p.shapes[0] as PathShape).anchors.map((a) => a.p);
  assert.deepEqual(corners[0], [7, 7], 'the room round it, and the line\'s width');
  assert.deepEqual(corners[2], [27, 17]);
  assert.ok(w > 27 && h > 17);
  // Laid back on the land with its middle where it was: as it was.
  const mid: Pt = [100 + ((w / 2 - 7) * 2), 100 + ((h / 2 - 7) * 2)];
  const back = toLand(p, unproject, 2, mid)!;
  assert.equal(back.mode, 'land');
  (back.shapes[0] as PathShape).anchors.forEach((a, k) => { const q = project(a.p), r = project(sq.anchors[k].p); assert.ok(Math.hypot(q[0] - r[0], q[1] - r[1]) < 1e-6); });
  // Kept: a pattern with its tile; without one, on the land; points of a tile may lie past the world's degrees.
  assert.deepEqual(drawingOf(JSON.parse(JSON.stringify(p)))!.tile, p.tile);
  assert.equal(drawingOf({ ...p, tile: null })!.mode, 'land');
  assert.equal(toPattern({ ...d, shapes: [] }, project, 1), null, 'nothing to make one of');
  assert.equal(drawingAt([p], project, [50, 50], 1), null, 'a pattern is not chosen by a click');
});
