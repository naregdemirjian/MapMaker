// Fields (Stage 9, D102): a source's life (rising, holding, halving), its footprint (a ragged circle
// or a plume carried downwind) and its reach; field layers and their sources kept in history, placed
// from a date in an event, changed and undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  strengthAt, sizeAt, sourceValue, sourceReach, lifespan, edgeAt, distanceBearing, fieldSourceOf, onsetOf, activeSources, fieldValueAt, rampColour,
  DEFAULT_SOURCES, FIELD_TYPES, FADED, fieldLayerStyleOf, type FieldSource,
} from '../src/domain/fields.ts';
import { gregorian, compare } from '../src/core-time/index.ts';

const src = (o: Partial<FieldSource> = {}): FieldSource => ({ ...DEFAULT_SOURCES.custom, noise: 0, ...o });

test('a source rises to its peak, holds, then halves every half-life, and is gone once faded', () => {
  const s = src({ rise: 2, hold: 3, decay: 10 });
  assert.equal(strengthAt(s, -0.1), 0, 'not before it starts');
  assert.equal(strengthAt(s, 0), 0);
  assert.equal(strengthAt(s, 1), 0.5, 'half way up');
  assert.equal(strengthAt(s, 2), 1);
  assert.equal(strengthAt(s, 5), 1, 'holding');
  assert.ok(Math.abs(strengthAt(s, 15) - 0.5) < 1e-9, 'half after one half-life');
  assert.ok(Math.abs(strengthAt(s, 25) - 0.25) < 1e-9);
  assert.equal(strengthAt(s, lifespan(s) + 1), 0, 'gone once faded');
  assert.ok(strengthAt(s, lifespan(s) - 1) >= FADED);
  assert.equal(strengthAt(src({ rise: 0, hold: 1, decay: 0 }), 1.5), 0, 'no decay: gone at once after holding');
  assert.equal(sizeAt(src({ grow: 4 }), 1), 0.5, 'a quarter of the way: half its size (it grows fast at first)');
  assert.equal(sizeAt(src({ grow: 0 }), 0), 1);
});

test('a circle: full at its middle, nothing past its edge; an uneven edge, the same for the same seed', () => {
  const s = src({ intensity: 10, radiusKm: 100, rise: 0, hold: 10, grow: 0 });
  assert.equal(sourceValue(s, 0, 0, 1), 10);
  assert.ok(sourceValue(s, 50, 0, 1) > 4 && sourceValue(s, 50, 0, 1) < 6);
  assert.equal(sourceValue(s, 101, 0, 1), 0);
  const ragged = src({ ...s, noise: 1, seed: 5 });
  const edges = Array.from({ length: 36 }, (_, i) => edgeAt(ragged, (i / 36) * 2 * Math.PI));
  assert.ok(Math.max(...edges) > 1.15 && Math.min(...edges) < 0.85, 'farther one way, nearer another');
  assert.deepEqual(edges, Array.from({ length: 36 }, (_, i) => edgeAt(src({ ...s, noise: 1, seed: 5 }), (i / 36) * 2 * Math.PI)));
  assert.notDeepEqual(edges, Array.from({ length: 36 }, (_, i) => edgeAt(src({ ...s, noise: 1, seed: 6 }), (i / 36) * 2 * Math.PI)), 'another seed, another edge');
  for (let i = 0; i < 36; i++) assert.equal(sourceValue(ragged, sourceReach(ragged, 1) + 0.01, (i / 36) * 2 * Math.PI, 1), 0, 'nothing beyond its reach');
});

test('a plume is carried downwind as far as the wind has taken it, widening and thinning', () => {
  const s = src({ shape: 'plume', intensity: 100, radiusKm: 10, rise: 0, hold: 10, decay: 0, windDeg: 90, windKmPerDay: 100 });
  const east = Math.PI / 2, west = -Math.PI / 2;
  assert.ok(sourceValue(s, 150, east, 2) > 10, 'downwind, within the 200 km the wind has carried it');
  assert.ok(sourceValue(s, 150, west, 2) < 1e-6, 'nothing upwind');
  assert.ok(sourceValue(s, 150, east, 1) < 1, 'not yet that far after one day');
  assert.ok(sourceValue(s, 30, east, 2) > sourceValue(s, 180, east, 2), 'thinner farther on');
  // Across the wind it is wider farther downwind.
  const across = (along: number, off: number) => { const d = Math.hypot(along, off), b = east - Math.atan2(off, along); return sourceValue(s, d, b, 2); };
  assert.ok(across(150, 40) / across(150, 0) > across(20, 40) / across(20, 0), 'wider downwind');
  // Its reach bounds it at every bearing.
  for (let i = 0; i < 24; i++) assert.ok(sourceValue(s, sourceReach(s, 2), (i / 24) * 2 * Math.PI, 2) < 0.02 * s.intensity);
});

test('distances and bearings on the sphere; stored settings checked; ramps; a layer\'s style', () => {
  const [d, b] = distanceBearing([0, 0], [1, 0]);
  assert.ok(Math.abs(d - 111.195) < 0.01 && Math.abs(b - Math.PI / 2) < 1e-9, 'a degree east along the equator');
  const [, north] = distanceBearing([10, 10], [10, 20]);
  assert.ok(Math.abs(north) < 1e-9);
  const s = fieldSourceOf({ shape: 'square', intensity: -5, radiusKm: 1e9, rise: 'soon', windDeg: 450, seed: 2.6 }, 'fire');
  assert.equal(s.shape, DEFAULT_SOURCES.fire.shape);
  assert.equal(s.intensity, 0);
  assert.equal(s.radiusKm, 20000);
  assert.equal(s.rise, DEFAULT_SOURCES.fire.rise);
  assert.equal(s.windDeg, 90);
  assert.equal(s.seed, 3);
  assert.deepEqual(fieldSourceOf(null, 'radiation'), DEFAULT_SOURCES.radiation);
  assert.equal(rampColour('flood', 0)[3], 0, 'nothing: see-through');
  assert.ok(rampColour('flood', FIELD_TYPES.flood.full)[2] > rampColour('flood', FIELD_TYPES.flood.full)[0], 'deep water blue');
  assert.deepEqual(rampColour('fire', 100), rampColour('fire', FIELD_TYPES.fire.full), 'held at its end');
  const plain = { from: null, kernelKm: 200, full: null };
  assert.deepEqual(fieldLayerStyleOf('{"field":{"type":"smoke","opacity":3}}'), { type: 'smoke', opacity: 1, ...plain });
  assert.deepEqual(fieldLayerStyleOf('not json'), { type: 'custom', opacity: 1, ...plain });
  const t = (y: number) => gregorian.fromCivil({ year: y });
  assert.deepEqual(onsetOf([{ t: t(1500), parts: [[0, 0]] }, { t: t(1510), parts: [[1, 1]] }, { t: t(1520), parts: null }], t(1515), compare), t(1500), 'moved, not started again');
  assert.equal(onsetOf([{ t: t(1500), parts: [[0, 0]] }, { t: t(1520), parts: null }], t(1525), compare), null, 'ended');
});

test('a field layer and its sources: placed from a date in an event, in force while they last, changed and undone', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World(), engine = new Engine(world);
  const { spaceId } = cmd.seedProject(world, 'Fields').result;
  const layer = cmd.createFieldLayer(world, spaceId, 'Fallout', 'radiation').result;
  assert.equal(world.get('layer', layer)!.kind, 'field');
  assert.equal(fieldLayerStyleOf(world.get('layer', layer)!.style).type, 'radiation');
  const day = (y: number, d = 0) => { const i = gregorian.fromCivil({ year: y }); return { day: i.day + d, ms: 0 }; };
  const ev = cmd.createEvent(world, { name: 'Strike', start: day(1960), end: null }).result;
  const strike = cmd.addFieldSource(world, { layerId: layer, name: 'Ground zero', at: [30, 50], mode: { kind: 'new', eventId: ev, at: day(1960) }, source: { radiusKm: 40, decay: 5, hold: 0, rise: 0 } });
  const at = (t: { day: number; ms: number }) => activeSources(world, engine, layer, t, compare);
  assert.equal(at(day(1959, 364)).length, 0, 'not before the strike');
  const now = at(day(1960, 1));
  assert.equal(now.length, 1);
  assert.equal(now[0].name, 'Ground zero');
  assert.ok(Math.abs(now[0].age - 1) < 1e-9 && now[0].strength < 1 && now[0].strength > 0.8, 'a day on, decaying');
  assert.ok(fieldValueAt(now, 30, 50) > 400, 'strong where it struck');
  assert.equal(fieldValueAt(now, 40, 50), 0, 'nothing 700 km away');
  assert.equal(at(day(1961)).length, 0, 'faded a year on');
  // Changed: a longer half-life keeps it a year on. One undo step takes the change away.
  const changed = cmd.updateFieldSource(world, strike.result, { decay: 400 });
  assert.equal(at(day(1961)).length, 1);
  world.applyDiffs(invertDiffs(changed.diffs));
  assert.equal(at(day(1961)).length, 0);
  // Errors.
  assert.throws(() => cmd.addFieldSource(world, { layerId: world.all('layer').find((l) => l.kind === 'partition')!.id, name: 'x', at: [0, 0], mode: { kind: 'correct', t: day(1900) } }), /field layer/);
  assert.throws(() => cmd.addFieldSource(world, { layerId: layer, name: 'x', at: [0, 95], mode: { kind: 'correct', t: day(1900) } }), /not on the map/);
  assert.throws(() => cmd.createFieldLayer(world, spaceId, 'x', 'lava' as never), /Unknown kind/);
  cmd.setFieldLayerStyle(world, layer, { opacity: 0.5 });
  assert.deepEqual(fieldLayerStyleOf(world.get('layer', layer)!.style), { type: 'radiation', opacity: 0.5, from: null, kernelKm: 200, full: null });
  // Deleted with its history, like any area, line or point.
  cmd.deleteFeatures(world, [strike.result]);
  assert.equal(at(day(1960, 1)).length, 0);
});

test('a heatmap worked out from a layer of points; many sources added in one step', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World(), engine = new Engine(world);
  const { spaceId } = cmd.seedProject(world, 'Heat').result;
  const heat = cmd.createFieldLayer(world, spaceId, 'Battles heat', 'heat').result;
  const battles = cmd.createLayer(world, spaceId, 'Battles', 'point').result;
  const areas = cmd.createLayer(world, spaceId, 'Claims', 'area').result;
  cmd.setFieldLayerStyle(world, heat, { from: battles, kernelKm: 300, full: 4 });
  assert.deepEqual(fieldLayerStyleOf(world.get('layer', heat)!.style), { type: 'heat', opacity: 1, from: battles, kernelKm: 300, full: 4 });
  assert.throws(() => cmd.setFieldLayerStyle(world, heat, { from: areas }), /layer of points/);
  cmd.setFieldLayerStyle(world, heat, { from: null });
  assert.equal(fieldLayerStyleOf(world.get('layer', heat)!.style).from, null, 'back to sources placed by hand');
  // A hundred strikes in one step, in force from the date given; one undo takes them all.
  const t = gregorian.fromCivil({ year: 1944 });
  const strikes = Array.from({ length: 100 }, (_, i) => ({ name: `Strike ${i}`, at: [i * 0.5, 50] as [number, number], source: { radiusKm: 20 } }));
  const added = cmd.addFieldSources(world, { layerId: heat, sources: strikes, mode: { kind: 'change', t } });
  assert.equal(added.result.length, 100);
  assert.equal(activeSources(world, engine, heat, { day: t.day + 1, ms: 0 }, compare).length, 100);
  world.applyDiffs(invertDiffs(added.diffs));
  assert.equal(activeSources(world, engine, heat, { day: t.day + 1, ms: 0 }, compare).length, 0);
  assert.throws(() => cmd.addFieldSources(world, { layerId: heat, sources: [{ name: 'x', at: [0, 100] }], mode: { kind: 'change', t } }), /not on the map/);
});
