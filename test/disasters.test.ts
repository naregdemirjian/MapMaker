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

test('many disasters at once (D233): a brush scatters them along its stroke, of sizes between a least and a most, over a span of time; kept as a recipe, laid out the same every time; undone in one step', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const { scatterItems, scatterOf, sizeFactors, SIZE_STEPS } = await import('../src/domain/scatter.ts');
  const { distanceBearing } = await import('../src/domain/fields.ts');
  const world = new World(), engine = new Engine(world);
  const { spaceId } = cmd.seedProject(world, 'Scatter').result;
  const t = gregorian.fromCivil({ year: 1983, month: 9, day: 26 });
  const path: Array<[number, number]> = [[-100, 40], [-80, 40]];
  const r = cmd.addDisasterScatter(world, { spaceId, disaster: 'nuclear', least: 100, most: 5000, windDeg: 90, path, widthKm: 150, count: 20000, spreadDays: 2, t, seed: 7 });
  const ev = world.get('event', r.result)!;
  assert.equal(ev.name, '20,000 × nuclear strike (100 kt to 5 Mt)');
  const feats = world.all('feature');
  assert.equal(feats.length, 3, 'one source for each condition, not twenty thousand');
  assert.ok(feats.every((f) => f.style.length < 2000), 'kept small: the recipe, not every strike');
  // Laid out the same every time, along the stroke and within the brush's reach of it.
  const sc = scatterOf(JSON.parse(feats[0].style).source.scatter)!;
  const items = scatterItems(sc), again = scatterItems(scatterOf(JSON.parse(feats[0].style).source.scatter)!);
  assert.equal(items.length, 20000);
  assert.deepEqual(items.slice(0, 50), again.slice(0, 50), 'the same layout from the same recipe');
  const offStroke = (it: { lon: number; lat: number }) => Math.min(...Array.from({ length: 41 }, (_, k) => distanceBearing([-100 + k * 0.5, 40], [it.lon, it.lat])[0]));
  assert.ok(items.slice(0, 400).every((it) => offStroke(it) <= 151), 'within 150 km of the stroke');
  assert.ok(items.some((it) => it.lon < -97) && items.some((it) => it.lon > -83), 'all along it');
  // Over the span: none before, about half after a day, all after two.
  const layers = world.all('layer').filter((l) => l.kind === 'field');
  const blast = layers.find((l) => fieldLayerStyleOf(l.style).type === 'damage')!;
  const at = (days: number) => activeSources(world, engine, blast.id, { day: t.day + Math.floor(days), ms: Math.round((days % 1) * 86_400_000) }, compare);
  assert.equal(at(-0.5).length, 0);
  const half = at(1).length;
  assert.ok(half > 8000 && half < 12000, `about half after a day (${half})`);
  assert.equal(at(2.01).length, 20000, 'all after two days');
  // Sizes between the least and the most: a 100 kt blast reaches about a third as far as a 5 Mt one, as single strikes do.
  const one = (y: number) => planDisaster('nuclear', y).sources.find((s) => s.type === 'damage')!.source.radiusKm!;
  const radii = at(3).map((a) => a.source.radiusKm);
  assert.ok(Math.abs(Math.min(...radii) - one(100)) / one(100) < 0.02 && Math.abs(Math.max(...radii) - one(5000)) / one(5000) < 0.02, `from ${Math.min(...radii).toFixed(2)} to ${Math.max(...radii).toFixed(2)} km`);
  assert.ok(sizeFactors(sc, 0).reach < 1 && sizeFactors(sc, SIZE_STEPS - 1).reach > 1);
  // Refused: too many, nowhere; undone in one step.
  assert.throws(() => cmd.addDisasterScatter(world, { spaceId, disaster: 'nuclear', least: 1, most: 1, path, widthKm: 1, count: 1e6, spreadDays: 0, t }), /100,000/);
  assert.throws(() => cmd.addDisasterScatter(world, { spaceId, disaster: 'nuclear', least: 1, most: 1, path: [], widthKm: 1, count: 1, spreadDays: 0, t }), /not on the map/);
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(world.all('feature').length, 0);
  assert.equal(world.get('event', r.result), undefined);
});

test('drawn as some of them when there are too many (D233): each standing for several, the total the same on the whole', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { fieldValueAt } = await import('../src/domain/fields.ts');
  const world = new World(), engine = new Engine(world);
  const { spaceId } = cmd.seedProject(world, 'Scatter').result;
  const t = gregorian.fromCivil({ year: 1983 });
  cmd.addDisasterScatter(world, { spaceId, disaster: 'earthquake', least: 6, most: 6, path: [[10, 45]], widthKm: 400, count: 30000, spreadDays: 0, t, seed: 3 });
  const layer = world.all('layer').find((l) => l.kind === 'field')!;
  const when = { day: t.day + 1, ms: 0 };
  const all = activeSources(world, engine, layer.id, when, compare), some = activeSources(world, engine, layer.id, when, compare, 3000);
  assert.equal(all.length, 30000);
  assert.equal(some.length, 3000);
  assert.ok(some.every((a) => a.weight === 10), 'each standing for ten');
  // The value over the area, on the whole, about the same (within a tenth).
  let a = 0, b = 0;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) { const lon = 6 + i * 0.2, lat = 42 + j * 0.15; a += fieldValueAt(all, lon, lat); b += fieldValueAt(some, lon, lat); }
  assert.ok(Math.abs(a - b) / a < 0.1, `the same on the whole (${a.toFixed(0)} and ${b.toFixed(0)})`);
});
