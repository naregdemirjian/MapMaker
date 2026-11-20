// "Orrun, a thousand years" (D179): a world of one's own built from its script: a generated planet cut into
// provinces, its own calendar, over a hundred events whose history is whole (no conflicts) in both timelines; the
// realms where the story puts them, in the main history and in the branch where the Ashfields are lost; the neck of
// land sunk under the sea from the year 600; nine shots, one of them of the branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRegistry } from '../src/server/projects.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import { EXAMPLES } from '../src/examples/index.ts';
import { Y, AT, RECKONING } from '../src/examples/fantasy.ts';
import { calendarOf } from '../src/core-time/custom-calendar.ts';
import { statisticsOf, worldSettings, terrainSourceOf } from '../src/world-model/world-settings.ts';
import { fillStatistics } from '../src/presentation/statistics.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import type { Instant } from '../src/core-time/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Orrun builds into a world of its own: a planet, its calendar, a whole history in two timelines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mapmaker-example-'));
  try {
    const reg = new ProjectRegistry(dir);
    const info = EXAMPLES.find((e) => e.id === 'orrun')!.build(reg, join(ROOT, 'data'));
    const world = World.fromSnapshot(reg.get(info.id).snapshot());
    const spaces = world.all('map_space');
    assert.equal(spaces.length, 1, 'one map, the planet');
    const space = spaces[0];
    assert.equal(terrainSourceOf(space), 'planet');
    assert.equal(worldSettings(space).calendar?.id, 'orrun');
    // The Reckoning's eras: the year 745 is the 325th of the Age of Embers.
    assert.match(calendarOf(RECKONING).format(Y(745, 6, 15), 'day'), /325 AE/);
    const branches = world.all('branch');
    assert.deepEqual(branches.map((b) => b.name), ['The Ember Ascendant']);
    const main = new Engine(world), other = new Engine(world, branches[0].id);
    assert.deepEqual(main.conflicts.map((c) => c.message), [], 'no conflicts in the main history');
    assert.deepEqual(other.conflicts.map((c) => c.message), [], 'nor in the other');
    assert.ok(world.all('event').length >= 100, `${world.all('event').length} events`);
    const layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
    const owner = (e: Engine, [lon, lat]: [number, number], t: Instant) => {
      const id = e.valueAtPoint(space.id, layer, lonLatToVec(lon, lat), t);
      return id ? e.nameAt(id, t) ?? world.get('entity', id)?.name ?? id : null;
    };
    const wrong: string[] = [];
    const check = (e: Engine, place: string, at: [number, number], story: Array<[Instant, string | null]>) => {
      for (const [t, who] of story) { const got = owner(e, at, t); if (got !== who) wrong.push(`${place} on day ${t.day}: ${got}, not ${who}`); }
    };
    check(main, 'Calvaris', AT.calvaris, [[Y(1, 3, 1), 'Calvar'], [Y(500), 'Calvar'], [Y(790), 'Calvar and Lorrin']]);
    check(main, 'Lorrinhall', AT.lorrinhall, [[Y(100), 'Lorrin'], [Y(310), 'Calvar']]);
    check(main, 'Uzun Ordu', AT.ordu, [[Y(200), 'Uzun'], [Y(450), 'The Ember Dominion'], [Y(790), 'Uzun']]);
    check(main, 'Mount Kharn', AT.kharn, [[Y(400), 'The Kharn Holds'], [Y(500), 'The Ember Dominion'], [Y(790), null]]);
    check(main, 'Teshar', AT.teshar, [[Y(100), 'Teshar'], [Y(500), 'The Ember Dominion'], [Y(790), 'Teshar']]);
    check(main, 'Ammar', AT.ammar, [[Y(100), 'Ammaru']]);
    check(main, 'Ilmarin', AT.ilmarin, [[Y(100), 'Ilmar']]);
    check(main, 'Draven', AT.draven, [[Y(300), 'Draven'], [Y(400), 'Draven Federation'], [Y(900), 'Draven Empire']]);
    check(main, 'Kaimar', AT.kaimar, [[Y(800), null], [Y(900), 'Kaimara']]);
    // The other history: Calvaris and Saruun under the Ember; the steppe free again at the end.
    check(other, 'Calvaris', AT.calvaris, [[Y(744), 'Calvar'], [Y(760), 'The Ember Dominion'], [Y(1000), 'The Ember Dominion']]);
    check(other, 'Ammar', AT.ammar, [[Y(780), 'Ammaru'], [Y(810), 'The Ember Dominion']]);
    check(other, 'Uzun Ordu', AT.ordu, [[Y(900), 'The Ember Dominion'], [Y(990), 'Uzun']]);
    assert.deepEqual(wrong, [], 'each place held by the realm the story gives it');
    // The Sundering: the sea over the neck from the year 600, in the planet's own heights.
    const stamps = (worldSettings(space).sculpt ?? []) as Array<{ tool: string; from: { day: number } | null }>;
    assert.ok(stamps.some((s) => s.tool === 'sea' && s.from?.day === Y(600, 2, 1).day), 'the neck sinks in 600');
    // Shots: nine, one of them of the other history; statistics.
    const shots = world.all('sequence');
    assert.equal(shots.length, 9);
    assert.equal(shots.filter((q) => JSON.parse(q.settings).branch === branches[0].id).length, 1);
    assert.equal(fillStatistics('{Free realms}', statisticsOf(space), Y(400)), '14');
    reg.closeAll();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
