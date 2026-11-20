// "The Fall of Constantinople, 1453" (D176): built from its script into a projects folder, its history whole (no
// conflicts), in the Julian calendar; the city Byzantine until the morning of 29 May and taken quarter by quarter,
// the Cretans' towers last; Galata, the outposts and the states beyond taken when the sources say; every day's
// cannon fire, its shots and statistics.
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
import { J } from '../src/examples/constantinople.ts';
import { statisticsOf } from '../src/world-model/world-settings.ts';
import { fillStatistics } from '../src/presentation/statistics.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the Constantinople example builds into a whole history of over a hundred events, its shots and statistics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mapmaker-example-'));
  try {
    const reg = new ProjectRegistry(dir);
    const info = EXAMPLES.find((e) => e.id === 'constantinople-1453')!.build(reg, join(ROOT, 'data'));
    const world = World.fromSnapshot(reg.get(info.id).snapshot());
    const engine = new Engine(world);
    assert.deepEqual(engine.conflicts.map((c) => c.message), [], 'no conflicting or broken changes');
    assert.ok(world.all('event').length >= 100, `${world.all('event').length} events`);
    const space = world.all('map_space')[0], layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
    assert.match(space.settings, /"julian"/, 'the map is in the Julian calendar');
    const name = (id: string | null) => (id ? world.get('entity', id)?.name ?? id : null);
    const at = (lon: number, lat: number, t: ReturnType<typeof J>) => name(engine.valueAtPoint(space.id, layer, lonLatToVec(lon, lat), t));
    const hagiaSophia: [number, number] = [28.9802, 41.0086], holyApostles: [number, number] = [28.9495, 41.0195], galata: [number, number] = [28.9745, 41.0240];
    assert.equal(at(...hagiaSophia, J(1453, 5, 28)), 'Byzantine Empire');
    assert.equal(at(28.9150, 41.0200, J(1453, 5, 28)), 'Ottoman Empire', 'the camps outside the walls');
    assert.equal(at(...holyApostles, J(1453, 5, 29, 6)), 'Byzantine Empire', 'the middle still held at dawn');
    assert.equal(at(...holyApostles, J(1453, 5, 29, 9)), 'Ottoman Empire');
    assert.equal(at(...hagiaSophia, J(1453, 5, 29, 10)), 'Ottoman Empire');
    assert.equal(at(28.9590, 41.0262, J(1453, 5, 29, 12)), 'Byzantine Empire', 'the Cretans hold their towers until the afternoon');
    assert.equal(at(28.9590, 41.0262, J(1453, 5, 29, 14)), 'Ottoman Empire');
    assert.equal(at(...galata, J(1453, 5, 30)), 'Galata (Genoese)');
    assert.equal(at(...galata, J(1453, 6, 2)), 'Ottoman Empire');
    assert.equal(at(28.2464, 41.0739, J(1453, 6, 1)), 'Byzantine Empire', 'Selymbria holds out');
    assert.equal(at(28.2464, 41.0739, J(1453, 6, 6)), 'Ottoman Empire');
    assert.equal(at(22.37, 37.07, J(1460, 1, 1)), 'Despotate of the Morea');
    assert.equal(at(22.37, 37.07, J(1460, 7, 1)), 'Ottoman Empire');
    assert.equal(at(39.7178, 41.0027, J(1461, 8, 1)), 'Empire of Trebizond');
    assert.equal(at(39.7178, 41.0027, J(1461, 9, 1)), 'Ottoman Empire');
    // The chain across the Golden Horn, from 2 April until the ships break out.
    const chain = world.all('layer').find((l) => l.name === 'The chain')!.id;
    assert.equal(engine.featuresAt(chain, J(1453, 4, 1)).length, 0);
    assert.equal(engine.featuresAt(chain, J(1453, 5, 28)).length, 1);
    assert.equal(engine.featuresAt(chain, J(1453, 5, 29, 12)).length, 0);
    // Every day's cannon fire: shots in flight on a day of the siege, a few hours each.
    const fire = world.all('layer').find((l) => l.name === 'Cannon fire')!.id;
    assert.ok(world.all('feature').filter((f) => f.layer_id === fire).length > 400, 'hundreds of shots');
    const flying = engine.featuresAt(fire, J(1453, 5, 6, 12)).filter((f) => f.progress !== undefined);
    assert.ok(flying.length >= 1 && flying.length < 12, `${flying.length} shots in the air at noon on 6 May`);
    // Shots and statistics.
    assert.equal(world.all('sequence').length, 10);
    const stats = statisticsOf(space);
    assert.equal(fillStatistics('{Days of siege}', stats, J(1453, 5, 29)), '53');
    assert.equal(fillStatistics('{Ships in the Golden Horn}', stats, J(1453, 4, 23)), '72');
    reg.closeAll();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
