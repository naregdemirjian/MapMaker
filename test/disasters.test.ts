// Disasters (Stage 9, D104): templates of conditions sized by yield, magnitude, explosivity, depth or
// size; one click places a whole disaster as an event, its layers made where missing, an impact's
// crater kept in the terrain, all undone in one step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDisaster, DISASTERS } from '../src/domain/disasters.ts';
import { activeSources, fieldLayerStyleOf } from '../src/domain/fields.ts';
import { gregorian, compare } from '../src/core-time/index.ts';

test('each template is sized by its own measure, within its range', () => {
  const blast = (y: number) => planDisaster('nuclear', y).sources.find((s) => s.type === 'damage')!.source.radiusKm!;
  assert.ok(Math.abs(blast(1000) - 9) < 0.01, `a megaton flattens about 9 km around (${blast(1000).toFixed(1)})`);
  assert.ok(blast(20) < blast(1000) && blast(1000) < blast(50000));
  assert.deepEqual(planDisaster('nuclear', 1000).sources.map((s) => s.type), ['damage', 'fire', 'radiation']);
  assert.equal(planDisaster('nuclear', 1000, 45).sources.find((s) => s.type === 'radiation')!.source.windDeg, 45, 'fallout carried by the wind given');
  assert.ok(Math.abs(planDisaster('earthquake', 7).sources[0].source.radiusKm! - 50.1) < 0.1, 'magnitude 7: about 50 km');
  assert.ok(planDisaster('earthquake', 9).sources[0].source.radiusKm! > 400);
  const meteor = planDisaster('meteor', 500);
  assert.deepEqual(meteor.crater, { radiusKm: 5, depthM: 2000 }, 'a crater twenty times as wide as the meteor');
  assert.equal(planDisaster('volcano', 4).sources.find((s) => s.type === 'fire')!.source.spread, 'lava');
  assert.equal(planDisaster('flood', 5).sources[0].source.intensity, 5, 'the water rises by the depth given');
  assert.equal(planDisaster('earthquake', 20).name, 'Earthquake (magnitude 9.5)', 'held within its range');
  for (const d of DISASTERS) assert.ok(planDisaster(d.id, d.size.value).sources.length > 0, d.id);
});

test('a disaster placed with one command: an event from its moment, its layers, its conditions, an impact\'s crater; undone in one step', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const { sculptOf } = await import('../src/world-model/world-settings.ts');
  const world = new World(), engine = new Engine(world);
  const { spaceId } = cmd.seedProject(world, 'Disasters').result;
  const t = gregorian.fromCivil({ year: 1962, month: 10 }), later = { day: t.day + 1, ms: 0 }, before = { day: t.day - 1, ms: 0 };
  const layersBefore = world.all('layer').length;
  const strike = cmd.addDisaster(world, { spaceId, disaster: 'nuclear', size: 1000, windDeg: 90, at: [-80.2, 25.8], t });
  const ev = world.get('event', strike.result)!;
  assert.equal(ev.name, 'Nuclear strike (1 Mt)');
  assert.equal(compare({ day: ev.start_day, ms: ev.start_ms }, t), 0, 'the event starts at the moment viewed');
  const fieldLayers = () => world.all('layer').filter((l) => l.kind === 'field');
  assert.deepEqual(fieldLayers().map((l) => fieldLayerStyleOf(l.style).type).sort(), ['damage', 'fire', 'radiation'], 'a layer for each kind of condition');
  const inForce = (when: { day: number; ms: number }) => fieldLayers().reduce((n, l) => n + activeSources(world, engine, l.id, when, compare).length, 0);
  assert.equal(inForce(before), 0, 'nothing before');
  assert.equal(inForce(later), 3, 'blast, fire and fallout the day after');
  // A second disaster of the same kinds goes onto the same layers.
  cmd.addDisaster(world, { spaceId, disaster: 'nuclear', size: 20, at: [-77, 39], t });
  assert.equal(fieldLayers().length, 3);
  assert.equal(inForce(later), 6);
  // An impact: its crater in the terrain, from its moment on.
  const impact = cmd.addDisaster(world, { spaceId, disaster: 'meteor', size: 500, at: [10, 50], t });
  const stamps = sculptOf(world.get('map_space', spaceId));
  assert.equal(stamps.length, 1);
  assert.equal(stamps[0].tool, 'crater');
  assert.deepEqual(stamps[0].from, { day: t.day, ms: t.ms }, 'the crater from the impact on');
  assert.ok(fieldLayers().some((l) => fieldLayerStyleOf(l.style).type === 'smoke'), 'its dust on a new layer of smoke and ash');
  // One undo takes the whole impact back: crater, conditions, event and the layer it made.
  world.applyDiffs(invertDiffs(impact.diffs));
  assert.equal(sculptOf(world.get('map_space', spaceId)).length, 0);
  assert.ok(!fieldLayers().some((l) => fieldLayerStyleOf(l.style).type === 'smoke'));
  assert.equal(world.get('event', impact.result), undefined);
  // In the event being recorded: no new event.
  const events = world.all('event').length;
  cmd.addDisaster(world, { spaceId, disaster: 'earthquake', size: 7, at: [139.7, 35.7], t: later, eventId: strike.result });
  assert.equal(world.all('event').length, events);
  // Errors.
  assert.throws(() => cmd.addDisaster(world, { spaceId, disaster: 'tsunami' as never, size: 1, at: [0, 0], t }), /Unknown kind/);
  assert.throws(() => cmd.addDisaster(world, { spaceId, disaster: 'flood', size: 5, at: [0, 99], t }), /not on the map/);
  const town = cmd.createFlatMap(world, 'Town', 5).result;
  assert.throws(() => cmd.addDisaster(world, { spaceId: town, disaster: 'flood', size: 5, at: [0, 0], t }), /round maps/);
  // A blank world has no terrain: an impact leaves its conditions, not a crater.
  const blank = cmd.createWorld(world, 'Blank', 3000).result;
  cmd.addDisaster(world, { spaceId: blank, disaster: 'meteor', size: 500, at: [0, 0], t });
  assert.equal(sculptOf(world.get('map_space', blank)).length, 0);
  assert.ok(world.all('layer').some((l) => l.space_id === blank && l.kind === 'field'));
  assert.ok(world.all('layer').length > layersBefore);
});
