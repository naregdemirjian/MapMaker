// Maps of simulated planets (Stage 14.5, D156): a map made from a planet's definition has the planet's radius,
// geological time and the definition kept as it was given; its definition changed (radius too) and undone in one
// step; definitions that cannot be simulated are refused with their reason; other maps have none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { terrainSourceOf, simOf, isGeologicalMap, isPaleoEarth, terrainLook } from '../src/world-model/world-settings.ts';
import { definitionFromPreset, definitionOf, definitionProblems } from '../src/planet/model/definition.ts';

test('a simulated planet\'s map: its radius, its definition, geological time; changed and undone; refusals', () => {
  const world = new World();
  cmd.seedProject(world, 'Planets');
  const def = definitionFromPreset('super-earth', 42);
  const id = cmd.createSimPlanet(world, 'Gravis', def).result;
  const space = () => world.get('map_space', id)!;
  assert.equal(terrainSourceOf(space()), 'sim');
  assert.ok(isGeologicalMap(space()) && !isPaleoEarth(space()));
  assert.equal(space().radius_m, 9_500_000, "the planet's radius");
  const kept = simOf(space())!;
  assert.equal(kept.name, 'Gravis');
  assert.equal(kept.seed, 42);
  assert.equal(kept.preset, 'super-earth');
  assert.deepEqual({ ...kept, name: def.name }, def, 'kept as given');
  assert.equal(terrainLook(space())!.relief, true, 'drawn with relief');
  // Changed: a smaller planet, the radius follows; undone in one step.
  const smaller = { ...kept, body: { ...kept.body, radiusKm: 7000 } };
  const r = cmd.setSimDefinition(world, id, smaller);
  assert.equal(space().radius_m, 7_000_000);
  assert.equal(simOf(space())!.body.radiusKm, 7000);
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(space().radius_m, 9_500_000);
  assert.equal(simOf(space())!.body.radiusKm, 9500);
  // Refused, with the reason.
  assert.throws(() => cmd.createSimPlanet(world, 'Bad', { ...def, orbit: { ...def.orbit, eccentricity: 0.95 } }), /eccentricity/);
  assert.throws(() => cmd.setSimDefinition(world, id, { ...kept, simulation: { ...kept.simulation, spanMyr: 10 } }), /span simulated/);
  const plain = cmd.createWorld(world, 'Blank', 3000).result;
  assert.equal(simOf(world.get('map_space', plain)), null);
  assert.throws(() => cmd.setSimDefinition(world, plain, kept), /Only a simulated planet/);
  // A definition's simulated span is read back and checked.
  const stored = definitionOf({ preset: 'earthlike', simulation: { quality: 'standard', spanMyr: 800 } })!;
  assert.equal(stored.simulation.spanMyr, 800);
  assert.equal(stored.simulation.quality, 'standard');
  assert.deepEqual(definitionProblems(stored), []);
  assert.equal(definitionFromPreset('earthlike').simulation.quality, 'preview', 'previews by default (fast)');
});
