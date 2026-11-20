// "The Mongol Empire, 1206 to 1405" (D177): built from its script into a projects folder, its history whole (no
// conflicts), over a hundred events; the conquests, the four khanates, Ain Jalut, the Song, the Ming, Lithuania and
// Timur where and when the sources put them; Hungary occupied and given up; its shots and statistics.
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
import { J } from '../src/examples/mongols.ts';
import { statisticsOf } from '../src/world-model/world-settings.ts';
import { fillStatistics } from '../src/presentation/statistics.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the Mongol example builds into a whole history of over a hundred events, its shots and statistics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mapmaker-example-'));
  try {
    const reg = new ProjectRegistry(dir);
    const info = EXAMPLES.find((e) => e.id === 'mongols')!.build(reg, join(ROOT, 'data'));
    const world = World.fromSnapshot(reg.get(info.id).snapshot());
    const engine = new Engine(world);
    assert.deepEqual(engine.conflicts.map((c) => c.message), [], 'no conflicting or broken changes');
    assert.ok(world.all('event').length >= 100, `${world.all('event').length} events`);
    const space = world.all('map_space')[0], layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
    const name = (id: string | null) => (id ? world.get('entity', id)?.name ?? id : null);
    const at = (lon: number, lat: number, t: ReturnType<typeof J>) => name(engine.valueAtPoint(space.id, layer, lonLatToVec(lon, lat), t));
    const samarkand: [number, number] = [66.96, 39.65], kiev: [number, number] = [30.52, 50.45], baghdad: [number, number] = [44.37, 33.31];
    const damascus: [number, number] = [36.29, 33.51], hangzhou: [number, number] = [120.16, 30.27], budapest: [number, number] = [19.04, 47.5];
    // Samarkand: Khwarazm's, the Mongols', Chagatai's at the split (not spilled to another khanate), Timur's.
    assert.equal(at(...samarkand, J(1215)), 'Khwarazmian Empire');
    assert.equal(at(...samarkand, J(1222)), 'Mongol Empire');
    assert.equal(at(...samarkand, J(1262)), 'Chagatai Khanate');
    assert.equal(at(...samarkand, J(1372)), 'Timurid Empire');
    // Kiev, Hungary, Baghdad, Syria.
    assert.equal(at(...kiev, J(1240, 6)), 'Rus\' principalities');
    assert.equal(at(...kiev, J(1241, 6)), 'Mongol Empire');
    assert.equal(at(...kiev, J(1300)), 'Golden Horde');
    assert.equal(at(...kiev, J(1364)), 'Grand Duchy of Lithuania');
    assert.equal(at(...budapest, J(1241, 8)), 'Mongol Empire', 'Hungary occupied');
    assert.equal(at(...budapest, J(1242, 8)), 'Kingdom of Hungary', 'and given up');
    assert.equal(at(...baghdad, J(1257)), 'Abbasid Caliphate');
    assert.equal(at(...baghdad, J(1258, 3)), 'Mongol Empire');
    assert.equal(at(...baghdad, J(1300)), 'Ilkhanate');
    assert.equal(at(...baghdad, J(1340)), 'Jalayirids');
    assert.equal(at(...baghdad, J(1394)), 'Timurid Empire');
    assert.equal(at(...damascus, J(1260, 8)), 'Ilkhanate', 'Syria taken before Ain Jalut');
    assert.equal(at(...damascus, J(1260, 12)), 'Mamluk Sultanate', 'and lost after it');
    assert.equal(at(...damascus, J(1300, 2)), 'Ilkhanate', 'Ghazan\'s months in Damascus');
    assert.equal(at(...damascus, J(1300, 8)), 'Mamluk Sultanate');
    // China: the Song, the Yuan (the Great Khanate, named Yuan from 1271), the Ming.
    assert.equal(at(...hangzhou, J(1270)), 'Southern Song');
    assert.equal(at(...hangzhou, J(1277)), 'Great Khanate');
    assert.equal(engine.nameAt(world.all('entity').find((e) => e.name === 'Great Khanate')!.id, J(1300)), 'Yuan dynasty');
    assert.equal(at(...hangzhou, J(1369)), 'Ming dynasty');
    // Shots and statistics.
    assert.equal(world.all('sequence').length, 9);
    const stats = statisticsOf(space);
    assert.equal(fillStatistics('{Lands under Mongol rule}', stats, J(1259)), '24.0 million');
    reg.closeAll();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
