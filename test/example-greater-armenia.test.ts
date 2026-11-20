// The "Greater Armenia" example (D171): built from its script into a projects folder, its history whole (no
// conflicts), its conquests, the exchange and the aftermath where the outline puts them, its shots and statistics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRegistry } from '../src/server/projects.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import { gregorian } from '../src/core-time/index.ts';
import { EXAMPLES } from '../src/examples/index.ts';
import { statisticsOf } from '../src/world-model/world-settings.ts';
import { fillStatistics } from '../src/presentation/statistics.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (y: number, m = 1, d = 1, h = 0, min = 0) => gregorian.fromCivil({ year: y, month: m, day: d, hour: h, minute: min });

test('the Greater Armenia example builds into a whole history, its shots and statistics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mapmaker-example-'));
  try {
    const reg = new ProjectRegistry(dir);
    const info = EXAMPLES.find((e) => e.id === 'greater-armenia')!.build(reg, join(ROOT, 'data'));
    const db = reg.get(info.id);
    const world = World.fromSnapshot(db.snapshot());
    const engine = new Engine(world);
    assert.deepEqual(engine.conflicts.map((c) => c.message), [], 'no conflicting or broken changes');
    const space = world.all('map_space')[0], layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
    const arr = world.arrangement(space.id);
    const id = (n: string) => world.all('entity').find((e) => e.name === n)!.id;
    const areaOf = (who: string, t: ReturnType<typeof D>) => { let a = 0; for (const [f, st] of engine.partitionState(space.id, layer, t)) if (st.value === who) a += arr.faceArea(f) * 6371 ** 2; return a; };
    const AM = id('Armenia');
    assert.ok(areaOf(AM, D(2060)) < 40_000, 'Armenia alone before the war');
    assert.equal(areaOf(id('Turkey'), D(2066, 5, 7)), 0, 'Turkey gone by 7 May 2066, not a sliver left');
    assert.equal(areaOf(id('Azerbaijan'), D(2066, 4, 29)), 0, 'Azerbaijan gone after Baku');
    assert.ok(areaOf(id('Turkey'), D(2066, 4, 26)) > 400_000, 'Turkey still fighting on day three');
    assert.ok(areaOf(AM, D(2175, 1, 1)) > 25e6, 'the empire of 2175');
    assert.equal(areaOf(id('China'), D(2175, 9, 16)), 0, 'the world\'s governments gone after the exchange');
    assert.ok(areaOf(AM, D(2178, 12)) < 1.5e6 && areaOf(AM, D(2178, 12)) > 0.3e6, 'fragments of AM in the aftermath');
    assert.ok(areaOf(id('Northeastern Faction'), D(2178, 12)) > 0.8e6, 'the faction with Turkmenistan');
    // Shots, statistics, missiles.
    assert.equal(world.all('sequence').length, 9);
    const stats = statisticsOf(space);
    assert.equal(fillStatistics('{GDP}', stats, D(2046)), '$72.0 billion');
    assert.equal(fillStatistics('{GDP}', stats, D(2156)), '$1.20 quadrillion');
    assert.equal(fillStatistics('{World population}', stats, D(2175, 9, 16)), '20.0 million');
    const missiles = world.all('layer').find((l) => l.kind === 'line' && l.style.includes('missile'))!;
    assert.ok(world.all('feature').filter((f) => f.layer_id === missiles.id).length > 600, 'the salvos\' missiles');
    reg.closeAll();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
