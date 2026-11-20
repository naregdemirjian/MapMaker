// How close today's countries are (D174): every country named in the data is one of today's; alliances, blocs,
// religions and languages scored as described; a map's colouring by closeness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MILITARY, ECONOMIC, RELIGION, LANGUAGE, LANGUAGE_FAMILY } from '../src/domain/affinity-data.ts';
import { affinity, closenessColours, closenessColour, FOCUS_COLOUR, UNKNOWN_COLOUR, colourByOf } from '../src/domain/affinity.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { colourByOfSpace } from '../src/world-model/world-settings.ts';

const names = new Set((JSON.parse(readFileSync(new URL('../data/natural-earth/countries-50m.json', import.meta.url), 'utf8')) as { countries: Array<{ name: string }> }).countries.map((c) => c.name));

test('every country in the data is one of today\'s, every language has a family', () => {
  const unknown = [...MILITARY, ...ECONOMIC].flatMap((g) => g.members).concat(Object.keys(RELIGION), Object.keys(LANGUAGE)).filter((n) => !names.has(n));
  assert.deepEqual([...new Set(unknown)], []);
  assert.deepEqual(Object.values(LANGUAGE).filter((l) => !LANGUAGE_FAMILY[l]), []);
  const nations = [...names].filter((n) => !(n in RELIGION));
  assert.ok(nations.length < 50, `most countries have a religion: missing ${nations.length}`);
});

test('closeness by alliances, blocs, religion and language', () => {
  const near = (a: string, b: string, k: Parameters<typeof affinity>[2]) => affinity(a, b, k)!;
  assert.ok(near('France', 'Germany', 'military') > 0.95, 'NATO and the EU');
  assert.equal(near('Armenia', 'Azerbaijan', 'military'), 0);
  assert.equal(near('Turkey', 'Azerbaijan', 'military'), 1, 'the Shusha Declaration');
  assert.ok(near('Armenia', 'Russia', 'economic') >= 0.99, 'the Eurasian Economic Union');
  assert.ok(near('Armenia', 'Russia', 'military') < 0.6, 'the CSTO frozen; the base at Gyumri');
  assert.equal(near('Iran', 'Iraq', 'religious'), 1, 'both Shia');
  assert.equal(near('Armenia', 'Georgia', 'religious'), 0.8, 'Oriental and Eastern Orthodox');
  assert.ok(near('Armenia', 'Turkey', 'religious') < 0.3);
  assert.equal(near('Spain', 'Mexico', 'language'), 1);
  assert.equal(near('Spain', 'Italy', 'language'), 0.65, 'both Romance');
  assert.equal(near('Turkey', 'Kazakhstan', 'language'), 0.35, 'both Turkic');
  const all = near('France', 'Germany', 'overall');
  assert.ok(all > 0.5 && all < 1);
  assert.equal(affinity('Atlantis', 'France', 'overall'), null);
});

test('a map coloured by closeness: the focus, today\'s countries by closeness, others grey; stored and taken away', () => {
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'T').result;
  const ids = ['Armenia', 'Russia', 'Turkey', 'Atlantis'].map((n) => cmd.createEntity(world, { type_id: 'polity', name: n }).result);
  const by = { kind: 'economic' as const, focus: ids[0], legend: true };
  cmd.setColourBy(world, spaceId, by);
  assert.deepEqual(colourByOfSpace(world.get('map_space', spaceId)), by);
  const colours = closenessColours(by, world.all('entity').map((e) => ({ id: e.id, type_id: e.type_id, name: e.name })));
  assert.equal(colours.get(ids[0]), FOCUS_COLOUR);
  assert.equal(colours.get(ids[1]), closenessColour(1));
  assert.notEqual(colours.get(ids[2]), closenessColour(1));
  assert.equal(colours.get(ids[3]), UNKNOWN_COLOUR);
  cmd.setColourBy(world, spaceId, null);
  assert.equal(colourByOfSpace(world.get('map_space', spaceId)), null);
  assert.equal(colourByOf({ kind: 'nonsense', focus: 'x' }), null);
});
