// A planet's foundation (D269): everything worked out for it at every point, in one file kept with the project;
// read back bit for bit, and given to a pipeline in place of making it again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { newDefinition, definitionFromPreset, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { Pipeline, ProductCache } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor, type Executor } from '../src/planet/worker/pool.ts';
import { FOUNDATION_FORMAT, FOUNDATION_STAGES, adoptFoundation, decodeFoundation, encodeFoundation, foundationKey, gatherFoundation, pointData } from '../src/planet/foundation.ts';
import { ENGINE_VERSION, STAGES } from '../src/planet/pipeline/stages.ts';
import { BIOME_IDS } from '../src/planet/life/biomes.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b)), inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };

/** An executor that counts what it is asked to run, by stage. */
function counting(): { executor: Executor; runs: Map<string, number> } {
  const inner = new LocalExecutor(), runs = new Map<string, number>();
  const executor: Executor = {
    size: 1,
    run: (task, args, opts) => { const stage = (args as { stage?: string }).stage ?? task; runs.set(stage, (runs.get(stage) ?? 0) + 1); return inner.run(task, args, opts); },
    dispose: () => inner.dispose(),
  };
  return { executor, runs };
}

test('what a foundation is made of: the stages and their versions as they are now (look at foundation.ts before changing one)', () => {
  // A kept foundation is given to the pipeline as today's products whatever version made it: that is what keeps a
  // planet as it was made. So a stage of these may change what it works out (a planet already kept is not touched),
  // but if it comes to need something of its own or another's product that older foundations do not hold, bring
  // FOUNDATION_FORMAT up (older files are then made anew) or read the old shape too. This list is here so that a
  // version is not changed without that thought.
  assert.deepEqual(FOUNDATION_STAGES.map((stage) => [stage, STAGES[stage].version]), [['tectonics', 7], ['insolation', 1], ['sea', 4], ['temperature', 1], ['climate', 3], ['water', 1], ['biomes', 1]]);
  assert.equal(ENGINE_VERSION, 1);
  assert.equal(FOUNDATION_FORMAT, 1);
});

test('what names a foundation: the planet\'s definition and what it is simulated with; not its name, not the engine\'s version', () => {
  const d = newDefinition('earthlike', 4), key = foundationKey(d, P);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(foundationKey(structuredClone(d), P), key);
  assert.equal(foundationKey({ ...d, name: 'Another name', preset: 'custom' }, P), key, 'a name is not a planet');
  assert.notEqual(foundationKey(change(d, (c) => { c.orbit.semiMajorAu = 1.01; }), P), key);
  assert.notEqual(foundationKey(change(d, (c) => { c.seed = 5; }), P), key);
  assert.notEqual(foundationKey(change(d, (c) => { c.life.vegetation = 'none'; }), P), key);
  assert.notEqual(foundationKey(d, { ...P, level: 5 }), key);
  assert.notEqual(foundationKey(d, { ...P, durationMyr: 300 }), key);
});

test('a foundation: gathered, written and read back bit for bit; within a few megabytes; the data at a point', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const f = await gatherFoundation(p, d, P);
  assert.equal(f.of, foundationKey(d, P));
  assert.equal(f.level, 4);
  assert.deepEqual(Object.keys(f.products), [...FOUNDATION_STAGES]);
  const bytes = await encodeFoundation(f, deflate);
  assert.ok(bytes.length > 100_000 && bytes.length < 6 * 2 ** 20, `${(bytes.length / 2 ** 20).toFixed(2)} MB`);
  const back = await decodeFoundation(bytes, inflate);
  assert.equal(back.of, f.of);
  // Every product as it was made: its arrays of the same kind and the same bytes, its numbers and words the same.
  let arrays = 0;
  const same = (a: unknown, b: unknown, path: string): void => {
    if (ArrayBuffer.isView(a)) {
      arrays++;
      assert.equal((b as object).constructor, (a as object).constructor, path);
      const x = a as Uint8Array, y = b as Uint8Array;
      assert.equal(y.byteLength, x.byteLength, path);
      assert.ok(Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength)), `${path}: the same bytes`);
    } else if (Array.isArray(a)) { assert.equal((b as unknown[]).length, a.length, path); a.forEach((v, i) => same(v, (b as unknown[])[i], `${path}/${i}`)); }
    else if (a && typeof a === 'object') {
      const keys = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
      assert.deepEqual(Object.keys(b as object).sort(), keys.sort(), path);
      for (const k of keys) same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`);
    } else assert.ok(Object.is(a, b), `${path}: ${String(a)} against ${String(b)}`);
  };
  same(f.products, back.products, '');
  assert.ok(arrays > 60, `${arrays} arrays kept`);
  // What is not one, or is damaged, is refused.
  await assert.rejects(decodeFoundation(bytes.subarray(0, bytes.length - 50), inflate));
  await assert.rejects(decodeFoundation(new Uint8Array(40), inflate), /Not a Map Maker planet file/);
  // The first calculation has none (its maps are kept as they are made, by its own stages).
  await assert.rejects(gatherFoundation(p, definitionFromPreset('earthlike', 4), { level: 4, durationMyr: 200, frameEveryMyr: 25 }), /second calculation/);
  // The data kept at a point: a place on land near the equator, and one at sea.
  const mesh = meshAt(4), heights = back.products.sea.heights as Int16Array;
  const land = heights.findIndex((h, c) => h > 100 && Math.abs(mesh.lat[c]) < 0.3), sea = heights.findIndex((h) => h < -1000);
  const here = pointData(back, land), there = pointData(back, sea);
  assert.ok(here.heightM > 100 && here.tempC.length === 12 && here.rainMm.length === 12 && here.tempC.every((t) => t > -10 && t < 45) && here.rainMm.every((r) => r >= 0), JSON.stringify(here));
  assert.ok(here.crustAgeMyr >= 0 && here.frozenShare < 0.2 && BIOME_IDS[here.biome] !== 'sea' && here.koppen > 0 && here.colour.every((v) => v >= 0 && v <= 255));
  assert.equal(here.dayHighC, null, 'under the Earth\'s air the ground has no day of its own');
  assert.ok(Number.isFinite(here.windJan[0]) && Number.isFinite(here.windJul[1]));
  assert.equal(BIOME_IDS[there.biome] === 'sea' || BIOME_IDS[there.biome] === 'seaIce', true);
  assert.equal(there.koppen, 0);
  assert.throws(() => pointData(back, heights.length), /No such place/);
});

test('a foundation given to a pipeline: its products asked for are those read, nothing made again; pictures from them made without the history; kept whatever the cache drops', async () => {
  const d = newDefinition('earthlike', 4);
  const made = await gatherFoundation(new Pipeline(new LocalExecutor()), d, P);
  const read = await decodeFoundation(await encodeFoundation(made, deflate), inflate);
  // Another session: a pipeline with nothing made, a cache with next to no room.
  const { executor, runs } = counting(), p = new Pipeline(executor, new ProductCache(1024));
  adoptFoundation(p, d, P, read);
  assert.equal(p.hasAdopted(read.of), true);
  for (const stage of FOUNDATION_STAGES) {
    const r = await p.product(stage, d, P);
    assert.equal(r.cached, true, stage);
    assert.equal(r.data, read.products[stage], `${stage}: the very product read`);
  }
  assert.equal(runs.size, 0, 'nothing run');
  // A map's pictures: today's land seen from space and its heights, from what was read (the history is not run).
  const cover = await p.product('cover', d, { ...P, width: 256, height: 128 }), relief = await p.product('raster', d, { ...P, width: 256, height: 128, layer: 'elevation' });
  assert.equal((cover.data.pixels as Uint8Array).length, 4 * 256 * 128);
  assert.equal((relief.data.raster as Float32Array).length, 256 * 128);
  assert.deepEqual([...runs.keys()].sort(), ['cover', 'raster']);
  // (The same pictures as a pipeline that made everything itself.)
  const fresh = new Pipeline(new LocalExecutor());
  const cover2 = await fresh.product('cover', d, { ...P, width: 256, height: 128 });
  assert.deepEqual(cover.data.pixels, cover2.data.pixels);
  // Under another name the planet is the same one: its foundation serves.
  const renamed = { ...d, name: 'Renamed' };
  adoptFoundation(p, renamed, P, read);
  assert.equal((await p.product('biomes', renamed, P)).cached, true);
  // Another planet's is refused; and a changed planet is made anew (its products are not those given).
  const other = change(d, (c) => { c.orbit.semiMajorAu = 1.2; });
  assert.throws(() => adoptFoundation(p, other, P, read), /another planet/);
  runs.clear();
  await p.product('temperature', other, P);
  assert.ok((runs.get('temperature') ?? 0) >= 1 && !runs.has('tectonics'), `the climate made anew on the land read (${[...runs.keys()]})`);
  // Only the last few sets given are kept.
  for (let i = 0; i < 4; i++) p.adopt(`set-${i}`, []);
  assert.equal(p.hasAdopted(read.of), false);
  assert.equal(p.hasAdopted('set-3'), true);
});

test('foundations kept with a project: by the key of the planet\'s definition; only planet files; the last dozen used', async () => {
  const { mkdtempSync, rmSync, existsSync, utimesSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { FOUNDATIONS_KEPT, foundationDir, readFoundation, saveFoundation } = await import('../src/server/foundations.ts');
  const root = mkdtempSync(join(tmpdir(), 'mm-foundation-'));
  try {
    const dir = join(root, 'P.mapmaker'), key = (i: number) => i.toString(16).padStart(32, '0');
    const file = Buffer.concat([Buffer.from('MMS1'), Buffer.alloc(60, 7)]);
    assert.equal(readFoundation(dir, key(1)), null, 'none kept yet');
    assert.deepEqual(saveFoundation(dir, key(1), file), { bytes: 64, kept: 1 });
    assert.ok(existsSync(join(foundationDir(dir), `${key(1)}.mmf`)));
    assert.deepEqual(readFoundation(dir, key(1)), file);
    // Written over with the planet made again; nothing else accepted under a key, no other names.
    const again = Buffer.concat([Buffer.from('MMS1'), Buffer.alloc(20, 9)]);
    saveFoundation(dir, key(1), again);
    assert.deepEqual(readFoundation(dir, key(1)), again);
    assert.throws(() => saveFoundation(dir, key(2), Buffer.from('not a planet file')), /not a planet's foundation/);
    assert.throws(() => saveFoundation(dir, '../../elsewhere', file), /Bad foundation key/);
    assert.throws(() => readFoundation(dir, 'KEY'), /Bad foundation key/);
    // More than a dozen: the ones longest unused are let go; one read lately stays.
    for (let i = 2; i <= FOUNDATIONS_KEPT + 3; i++) {
      saveFoundation(dir, key(i), file);
      const at = new Date(Date.now() - (100 - i) * 60_000);
      utimesSync(join(foundationDir(dir), `${key(i)}.mmf`), at, at);
    }
    const old = new Date(Date.now() - 200 * 60_000);
    utimesSync(join(foundationDir(dir), `${key(1)}.mmf`), old, old);
    assert.deepEqual(readFoundation(dir, key(1)), again, 'read: used now');
    saveFoundation(dir, key(99), file);
    const kept = readdirSync(foundationDir(dir)).sort();
    assert.equal(kept.length, FOUNDATIONS_KEPT);
    assert.ok(kept.includes(`${key(1)}.mmf`) && kept.includes(`${key(99)}.mmf`) && !kept.includes(`${key(2)}.mmf`), kept.join(' '));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
