// Looks of countries (D181): effects checked and kept in range, a country's own look over its layer's, shadows cast
// away from the light, and the commands that keep them (one undo step each).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryLookOf, layerLookOf, lookFor, looksPlain, shadowOffset, compositeOf, EFFECT_DEFAULTS, type ShadowEffect } from '../src/render-engine/country-look.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';

test('a look as stored is checked: unknown effects dropped, values kept in range, colours as hex', () => {
  const l = countryLookOf({ elevation: 3.6, opacity: 4, effects: [{ kind: 'shadow', opacity: -1, distance: 900, color: 'red' }, { kind: 'sparkle' }, { kind: 'stroke', position: 'outside', width: 3, on: false }] })!;
  assert.equal(l.elevation, 4);
  assert.equal(l.opacity, 1);
  assert.equal(l.effects.length, 2, 'the unknown effect dropped');
  const sh = l.effects[0] as ShadowEffect;
  assert.deepEqual([sh.opacity, sh.distance, sh.color, sh.blur], [0, 200, EFFECT_DEFAULTS.shadow.color, EFFECT_DEFAULTS.shadow.blur]);
  assert.deepEqual(l.effects[1], { kind: 'stroke', on: false, color: '#ffffff', opacity: 1, width: 3, position: 'outside' });
  assert.equal(countryLookOf('nonsense'), null);
  assert.equal(layerLookOf({ blend: 'multiply' })!.blend, 'multiply');
  assert.equal(layerLookOf({ blend: 'glitter' })!.blend, 'normal');
  assert.equal(compositeOf('normal'), 'source-over');
  assert.equal(compositeOf('soft-light'), 'soft-light');
});

test('a country\'s own look over its layer\'s; plain looks change nothing', () => {
  const layer = layerLookOf({ elevation: 1, effects: [{ kind: 'shadow' }], blend: 'multiply' })!;
  const own = countryLookOf({ elevation: 5, effects: [] })!;
  assert.equal(lookFor(own, layer), own);
  assert.deepEqual(lookFor(null, layer), { elevation: 1, opacity: 1, effects: layer.effects });
  assert.equal(lookFor(null, null), null);
  assert.ok(looksPlain(null) && looksPlain(own) && !looksPlain(lookFor(null, layer)));
  assert.ok(looksPlain(countryLookOf({ effects: [{ kind: 'stroke', on: false }] })), 'effects turned off');
  assert.ok(!looksPlain(countryLookOf({ opacity: 0.5 })), 'a fainter fill');
});

test('a shadow falls away from the light', () => {
  const at = (angle: number) => shadowOffset({ ...EFFECT_DEFAULTS.shadow, angle, distance: 10 }, 2).map((v) => Math.round(v * 100) / 100);
  assert.deepEqual(at(90), [-0, 20], 'light from above: straight down');
  assert.deepEqual(at(0), [-20, 0], 'light from the right: to the left');
  assert.deepEqual(at(120), [10, 17.32], 'from the upper left: down and to the right');
});

test('a country\'s look and a layer\'s look are kept, and undone in one step each', () => {
  const world = new World();
  cmd.seedProject(world, 'Looks');
  const country = cmd.createEntity(world, { type_id: 'polity', name: 'Arcadia', color: '#3366cc' }).result;
  const layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
  const own = cmd.setCountryLook(world, country, { elevation: 2, opacity: 0.8, effects: [{ ...EFFECT_DEFAULTS.shadow }, { ...EFFECT_DEFAULTS.stroke, width: 4 }] });
  assert.equal(cmd.entityStyle(world.get('entity', country)).look?.effects.length, 2);
  const lay = cmd.setLayerEffects(world, layer, { elevation: 0, opacity: 1, effects: [{ ...EFFECT_DEFAULTS.stroke }], blend: 'overlay' });
  assert.equal((JSON.parse(world.get('layer', layer)!.style) as { look: { blend: string } }).look.blend, 'overlay');
  world.applyDiffs(invertDiffs(lay.diffs));
  assert.equal(JSON.parse(world.get('layer', layer)!.style).look, undefined, 'the layer\'s look undone');
  cmd.setCountryLook(world, country, null);
  assert.equal(cmd.entityStyle(world.get('entity', country)).look, undefined, 'like its layer again');
  world.applyDiffs(invertDiffs(own.diffs));
  assert.throws(() => cmd.setCountryLook(world, 'nobody', null), /no longer exists/);
});

test('every kind of effect (D182): its defaults kept as they are, its choices and ranges enforced', async () => {
  const { EFFECTS, EFFECT_KINDS, effectOf, castOf } = await import('../src/render-engine/country-look.ts');
  for (const k of EFFECT_KINDS) assert.deepEqual(effectOf(EFFECTS[k].defaults), EFFECTS[k].defaults, `${k}: its defaults as they are`);
  assert.equal((effectOf({ kind: 'pattern', pattern: 'tartan' }) as { pattern: string }).pattern, 'stripes', 'an unknown pattern: the default');
  assert.equal((effectOf({ kind: 'texture', blend: 'glitter', scale: 99 }) as { blend: string; scale: number }).blend, 'multiply');
  assert.equal((effectOf({ kind: 'texture', scale: 99 }) as { scale: number }).scale, 8);
  assert.equal((effectOf({ kind: 'bevel', style: 'sunken', highlightOpacity: 3 }) as { style: string; highlightOpacity: number }).highlightOpacity, 1);
  // What is cast on the land below: shadows and outer glows (a glow as a shadow without a move); nothing else.
  assert.deepEqual(castOf(EFFECTS['outer-glow'].defaults), { kind: 'shadow', on: true, color: '#ffe9a6', opacity: 0.7, angle: 0, distance: 0, blur: 18, spread: 2 });
  assert.equal(castOf(EFFECTS.bevel.defaults), null);
  assert.equal(castOf({ ...EFFECTS.shadow.defaults, on: false }), null);
});

test('textures are greys about the middle, the same every time', async () => {
  const { textureValues } = await import('../src/render-engine/textures.ts');
  for (const k of ['paper', 'parchment', 'canvas', 'grain', 'metal', 'stone'] as const) {
    const v = textureValues(k, 64), w = textureValues(k, 64);
    assert.deepEqual(v, w, `${k}: the same every time`);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    assert.ok(mean > 0.35 && mean < 0.65, `${k}: about the middle (${mean.toFixed(2)})`);
    assert.ok(v.every((x) => x >= 0 && x <= 1));
  }
});
