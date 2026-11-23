// How borders look (D183): styles checked and kept in range, pairs of two different countries kept once, dash
// patterns that grow with the line, plain styles that change nothing, marching borders found. How borders meet the
// coast and countries whose land carries on over the sea (D221).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { borderStyleOf, layerBordersOf, dashPattern, plainBorder, bordersMove, pairKey, coastBorderOf, overSeaOf, COAST_BORDERS, DEFAULT_BORDER } from '../src/render-engine/border-look.ts';

test('a border style as stored is checked and kept in range', () => {
  const s = borderStyleOf({ color: '#FF0000', width: 99, dash: 'zigzag', sketch: 2.6, march: 9999, opacity: -2 })!;
  assert.deepEqual([s.color, s.width, s.dash, s.sketch, s.march, s.opacity], ['#ff0000', 40, 'solid', 3, 400, 0]);
  assert.deepEqual(borderStyleOf({}), DEFAULT_BORDER, 'nothing set: the plain line');
  assert.equal(borderStyleOf(null), null);
  assert.ok(plainBorder(borderStyleOf({})) && !plainBorder(borderStyleOf({ dash: 'dotted' })));
});

test('a layer\'s borders: a pair of two different countries kept once, either way round', () => {
  const l = layerBordersOf({ between: { dash: 'dashed' }, pairs: [{ a: 'x', b: 'y', style: { color: '#ffffff' } }, { a: 'y', b: 'x', style: {} }, { a: 'z', b: 'z', style: {} }, { a: 'x', style: {} }] })!;
  assert.equal(l.between!.dash, 'dashed');
  assert.equal(l.coast, null);
  assert.deepEqual(l.pairs.map((p) => [p.a, p.b, p.style.color]), [['x', 'y', '#ffffff']]);
  assert.equal(pairKey('b', 'a'), pairKey('a', 'b'));
  assert.equal(layerBordersOf({}), null, 'nothing set: none');
  assert.ok(!bordersMove(l) && bordersMove(layerBordersOf({ coast: { dash: 'dashed', march: 20 } })) && !bordersMove(layerBordersOf({ coast: { march: 20 } })), 'only dashes march');
});

test('dash patterns grow with the line and its scale; solid has none', () => {
  assert.deepEqual(dashPattern('solid', 2, 1), []);
  assert.deepEqual(dashPattern('dashed', 2, 1), [12, 8]);
  assert.deepEqual(dashPattern('dashed', 2, 2), [24, 16]);
  assert.equal(dashPattern('dash-dot-dot', 1, 1).length, 6);
  assert.ok(dashPattern('dotted', 1, 1)[0] < 0.01, 'dots: round ends of dashes of no length');
});

test('a layer\'s borders are kept and undone in one step; a special border needs two countries that exist', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Borders');
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Arcadia' }).result, b = cmd.createEntity(world, { type_id: 'polity', name: 'Boeotia' }).result;
  const layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
  const r = cmd.setLayerBorders(world, layer, { between: { ...DEFAULT_BORDER, dash: 'dotted' }, coast: null, pairs: [{ a, b, style: { ...DEFAULT_BORDER, double: 3 } }] });
  const kept = layerBordersOf(JSON.parse(world.get('layer', layer)!.style).borders)!;
  assert.equal(kept.between!.dash, 'dotted');
  assert.equal(kept.pairs[0].style.double, 3);
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(JSON.parse(world.get('layer', layer)!.style).borders, undefined, 'undone');
  assert.throws(() => cmd.setLayerBorders(world, layer, { between: null, coast: null, pairs: [{ a, b: 'nobody', style: DEFAULT_BORDER }] }), /two countries that exist/);
});

test('how borders meet the coast: along it unless set otherwise; a country over the sea only when set (D221)', () => {
  assert.deepEqual(COAST_BORDERS.map((m) => m.id), ['coast', 'drawn', 'none']);
  assert.equal(coastBorderOf({}), 'coast', 'as at first: along the coast');
  assert.equal(coastBorderOf(null), 'coast');
  assert.equal(coastBorderOf({ coastBorder: 'drawn' }), 'drawn');
  assert.equal(coastBorderOf({ coastBorder: 'none' }), 'none');
  assert.equal(coastBorderOf({ coastBorder: 'sideways' }), 'coast', 'nothing known: along the coast');
  assert.equal(overSeaOf('{"overSea":true}'), true);
  assert.equal(overSeaOf('{"overSea":false}'), false);
  assert.equal(overSeaOf('{"overSea":"yes"}'), false);
  assert.equal(overSeaOf('{}'), false);
  assert.equal(overSeaOf(null), false);
  assert.equal(overSeaOf('{"overSea":tru'), false, 'not readable: no');
});

test('how a layer\'s borders meet the coast and a country over the sea are each kept and undone in one step (D221)', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Coasts');
  const layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
  const styleOf = () => JSON.parse(world.get('layer', layer)!.style);
  const was = styleOf();
  const r = cmd.setLayerCoastBorder(world, layer, 'drawn');
  assert.equal(r.diffs.length, 1);
  assert.equal(coastBorderOf(styleOf()), 'drawn');
  assert.deepEqual({ ...styleOf(), coastBorder: undefined }, { ...was, coastBorder: undefined }, 'nothing else of the layer changed');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(coastBorderOf(styleOf()), 'coast', 'undone');
  assert.throws(() => cmd.setLayerCoastBorder(world, layer, 'sideways' as never), /not a way for borders to meet the coast/);
  assert.throws(() => cmd.setLayerCoastBorder(world, 'gone', 'none'), /no longer exists/);
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Atlantis', color: '#3366cc' }).result;
  const on = cmd.setEntityOverSea(world, a, true);
  assert.equal(on.diffs.length, 1);
  assert.equal(overSeaOf(world.get('entity', a)!.style), true);
  assert.equal(world.get('entity', a)!.color, '#3366cc', 'its colour kept');
  const off = cmd.setEntityOverSea(world, a, false);
  assert.equal(overSeaOf(world.get('entity', a)!.style), false);
  assert.equal(cmd.entityStyle(world.get('entity', a)).overSea, undefined, 'nothing left behind');
  world.applyDiffs(invertDiffs(off.diffs));
  assert.equal(overSeaOf(world.get('entity', a)!.style), true, 'undone: over the sea again');
  world.applyDiffs(invertDiffs(on.diffs));
  assert.equal(overSeaOf(world.get('entity', a)!.style), false, 'undone: at the coast');
  assert.throws(() => cmd.setEntityOverSea(world, 'gone', true), /no longer exists/);
});
