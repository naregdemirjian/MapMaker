// The map's one light and countries as raised slabs (D186): effects taking the map's light turn with it, others keep
// their own angle; a slab as tall as a statistic's share of the highest of its kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectOf, litBy, slabHeight, changesInHistory, takesMapLight, EFFECT_DEFAULTS, type Effect, type ExtrudeEffect, type ShadowEffect, type BevelEffect } from '../src/render-engine/country-look.ts';
import { mapLightOf } from '../src/world-model/world-settings.ts';
import { gregorian } from '../src/core-time/index.ts';

test('effects set to the map\'s light take its angle; those with their own keep it', () => {
  const mapLit = { ...(EFFECT_DEFAULTS.shadow as ShadowEffect), angle: 30, light: 'map' as const };
  const own = { ...(EFFECT_DEFAULTS.bevel as BevelEffect), angle: 45 };
  const l = { elevation: 0, opacity: 1, effects: [mapLit, own] as Effect[] };
  const lit = litBy(l, 200)!;
  assert.deepEqual(lit.effects.map((e) => (e as ShadowEffect).angle), [200, 45]);
  const plain = { elevation: 0, opacity: 1, effects: [own] as Effect[] };
  assert.equal(litBy(plain, 200), plain, 'nothing taking the map\'s light: the look itself');
  assert.equal((effectOf({ kind: 'shadow' }) as ShadowEffect).light, 'own', 'stored looks from before keep their own angle');
  assert.equal((effectOf({ kind: 'bevel', light: 'map' }) as BevelEffect).light, 'map');
  assert.ok(takesMapLight('shadow') && takesMapLight('inner-shadow') && takesMapLight('bevel') && !takesMapLight('stroke'));
  assert.equal(mapLightOf(null), 120, 'from the upper left unless set');
  assert.equal(mapLightOf({ settings: JSON.stringify({ light: -90 }) }), 270);
});

test('a slab as tall as a statistic: its share of the highest value of its kind, at the moment shown', () => {
  const at = (y: number) => gregorian.fromCivil({ year: y });
  const k = (y: number, value: number) => { const t = at(y); return { at: [t.day, t.ms] as [number, number], value }; };
  const stats = [
    { name: 'Population of Arcadia', format: 'count' as const, ease: 'linear' as const, keys: [k(1900, 10), k(2000, 40)] },
    { name: 'Population of Boeotia', format: 'count' as const, ease: 'linear' as const, keys: [k(1900, 80), k(2000, 20)] },
    { name: 'Wheat', format: 'number' as const, ease: 'linear' as const, keys: [k(1900, 1000)] },
  ];
  const slab = effectOf({ kind: 'extrude', height: 40, stat: 'Population of {country}' }) as ExtrudeEffect;
  assert.equal(slab.stat, 'Population of {country}', 'the statistic\'s name kept');
  assert.equal(slabHeight(slab, 'Arcadia', stats, at(1900)), 5, '10 of the highest 80');
  assert.equal(slabHeight(slab, 'Arcadia', stats, at(2000)), 20);
  assert.equal(slabHeight(slab, 'Boeotia', stats, at(1900)), 40, 'the highest: full height');
  assert.equal(slabHeight(slab, 'Corinth', stats, at(1900)), 0, 'no statistic of its own: flat');
  assert.equal(slabHeight({ ...slab, stat: undefined }, 'Corinth', stats, at(1900)), 40, 'without a statistic: its own height');
  assert.equal(slabHeight({ ...slab, stat: 'Wheat' }, 'Anyone', stats, at(1900)), 40, 'one statistic for all');
  assert.ok(changesInHistory({ elevation: 0, opacity: 1, effects: [slab] }), 'drawn again as history goes');
  assert.ok(!changesInHistory({ elevation: 0, opacity: 1, effects: [{ ...slab, stat: undefined }] }));
});

test('the map\'s light is kept with the map, turned into 0 to 360, and undone in one step', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Light');
  const space = world.all('map_space')[0].id;
  const r = cmd.setMapLight(world, space, -45);
  assert.equal(mapLightOf(world.get('map_space', space)), 315);
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(mapLightOf(world.get('map_space', space)), 120, 'undone');
  assert.throws(() => cmd.setMapLight(world, 'nowhere', 10), /no longer exists/);
});
