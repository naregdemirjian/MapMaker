// The planetary engine's machinery (Stage 14, D152): content keys, the MMS1 file format, the stages and their
// keys, the product cache, the worker protocol and pool (real Node worker threads), cancellation, and the same
// bytes from one worker as from four.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sha256, canonicalJson, keyOf } from '../src/planet/state/hash.ts';
import { encodeState, decodeState } from '../src/planet/state/codec.ts';
import { fieldOut } from '../src/planet/state/fields.ts';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { Pipeline, ProductCache, PART_SIZE } from '../src/planet/pipeline/scheduler.ts';
import { WorkerPool, LocalExecutor, CancelledError, type WorkerLike } from '../src/planet/worker/pool.ts';
import { transferablesOf } from '../src/planet/worker/protocol.ts';
import { cellsAt } from '../src/planet/mesh/icosphere.ts';

const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));
const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));

test('SHA-256 and canonical keys', () => {
  const enc = new TextEncoder();
  assert.equal(sha256(enc.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const n of [55, 56, 63, 64, 65, 1000, 100_000]) {
    const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
    assert.equal(sha256(b), createHash('sha256').update(b).digest('hex'), `length ${n}`);
  }
  assert.equal(canonicalJson({ b: 1, a: [2, { d: undefined, c: 'x' }] }), '{"a":[2,{"c":"x"}],"b":1}');
  assert.equal(keyOf({ x: 1, y: 2 }), keyOf({ y: 2, x: 1 }), 'key order does not matter');
  assert.notEqual(keyOf({ x: 1 }), keyOf({ x: 1.0000001 }));
  assert.notEqual(keyOf({ a: new Float32Array([1, 2]) }), keyOf({ a: new Float32Array([1, 3]) }), 'arrays by content');
});

test('MMS1 files: every type kept exactly, quantised fields to half a quantum, damage noticed', async () => {
  const n = 5000;
  const f64 = new Float64Array(n).map((_, i) => Math.sin(i) * 1e6);
  const f32 = new Float32Array(n).map((_, i) => Math.cos(i * 0.01) * 300);
  const i32 = new Int32Array(n).map((_, i) => (i * 7919) % 100_000 - 50_000);
  const u16 = new Uint16Array(n).map((_, i) => (i * 13) & 0xffff);
  const i16 = new Int16Array(n).map((_, i) => ((i * 37) % 2000) - 1000);
  const u8 = new Uint8Array(n).map((_, i) => i % 7);
  const i8 = new Int8Array(n).map((_, i) => (i % 200) - 100);
  const u32 = new Uint32Array(n).map((_, i) => 4_000_000_000 - i * 3);
  const elevation = new Float32Array(n).map((_, i) => -5000 + 9000 * Math.abs(Math.sin(i * 0.003)));
  const bytes = await encodeState({ engine: 'test', kind: 'checkpoint', level: 3, meta: { t: -250 } }, [
    { name: 'f64', data: f64 }, { name: 'f32', data: f32, unit: 'K' }, { name: 'i32', data: i32, delta: true }, { name: 'u16', data: u16, delta: true },
    { name: 'i16', data: i16 }, { name: 'u8', data: u8, delta: true }, { name: 'i8', data: i8, delta: true }, { name: 'u32', data: u32, delta: true },
    { name: 'elevation', data: elevation, quantum: 1 }, fieldOut('insolation', f32),
  ], deflate);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'MMS1');
  const back = await decodeState(bytes, inflate);
  assert.equal(back.header.kind, 'checkpoint');
  assert.equal(back.header.level, 3);
  assert.deepEqual(back.header.meta, { t: -250 });
  assert.equal(back.header.fields.find((f) => f.name === 'f32')!.unit, 'K');
  for (const [name, a] of [['f64', f64], ['f32', f32], ['i32', i32], ['u16', u16], ['i16', i16], ['u8', u8], ['i8', i8], ['u32', u32]] as const) {
    const b = back.fields.get(name)!;
    assert.equal(b.constructor, a.constructor, name);
    assert.deepEqual(Array.from(b), Array.from(a), name);
  }
  const e = back.fields.get('elevation')!;
  for (let i = 0; i < n; i++) assert.ok(Math.abs(e[i] - elevation[i]) <= 0.5 + 1e-3);
  const ins = back.fields.get('insolation')!;
  for (let i = 0; i < n; i++) assert.ok(Math.abs(ins[i] - f32[i]) <= 0.005 + 1e-4);
  // Smooth quantised fields compress well: well under their raw size.
  const one = await encodeState({ engine: 'test', kind: 'x' }, [{ name: 'elevation', data: elevation, quantum: 1 }], deflate);
  assert.ok(one.length < elevation.byteLength / 3, `${one.length} bytes for ${elevation.byteLength}`);
  await assert.rejects(decodeState(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), inflate), /Not a Map Maker planet file/);
  await assert.rejects(decodeState(bytes.subarray(0, bytes.length - 10), inflate));
  await assert.rejects(encodeState({ engine: 'x', kind: 'x' }, [{ name: 'bad', data: new Float32Array([1e12]), quantum: 1e-3 }], deflate), /quantum/);
});

test('stage keys follow exactly what each stage reads; the cache reuses and forgets', async () => {
  const p = new Pipeline(new LocalExecutor());
  const earth = definitionFromPreset('earthlike');
  const k = (d: typeof earth, stage = 'insolation', level = 4) => p.keyOf(stage, d, { level, width: 64, height: 32, layer: 'insolation' });
  const plates = structuredClone(earth); plates.tectonics.plates = 20;
  const tilt = structuredClone(earth); tilt.body.tiltDeg = 30;
  const renamed = { ...structuredClone(earth), name: 'Elsewhere' };
  assert.equal(k(plates), k(earth), 'plates do not change the sunlight');
  assert.equal(k(renamed), k(earth), 'nor does the name');
  assert.notEqual(k(tilt), k(earth), 'the tilt does');
  assert.notEqual(k(earth, 'insolation', 5), k(earth), 'nor the level');
  assert.notEqual(k(tilt, 'raster'), k(earth, 'raster'), 'a picture follows what it shows');
  assert.notEqual(k(plates, 'derived'), k(earth, 'derived'), 'the derived values read everything');
  const a = await p.product('raster', earth, { level: 4, width: 64, height: 32 });
  assert.equal(a.cached, false);
  const b = await p.product('raster', plates, { level: 4, width: 64, height: 32 });
  assert.equal(b.cached, true, 'reused for a change it does not read');
  assert.equal(b.key, a.key);
  const both = await Promise.all([p.product('insolation', tilt, { level: 4 }), p.product('insolation', tilt, { level: 4 })]);
  assert.equal(both[0].data, both[1].data, 'two requests at once share one making');
  const cache = new ProductCache(1000);
  cache.set('a', { x: new Float32Array(200) });
  cache.set('b', { x: new Float32Array(200) });
  assert.equal(cache.get('a'), undefined, 'the least recently used goes first');
  assert.ok(cache.get('b'));
  assert.equal(transferablesOf({ a: new Float32Array(2), b: [new Uint8Array(3)], c: 4 }).length, 2);
});

/** A planet worker in a Node worker thread, as the pool sees a browser Worker. */
function nodeWorker(): WorkerLike {
  const w = new Worker(new URL('./fixtures/planet-worker-node.ts', import.meta.url));
  const like: WorkerLike = { postMessage: (m) => w.postMessage(m), terminate: () => { void w.terminate(); }, onmessage: null, onerror: null };
  w.on('message', (data) => like.onmessage?.({ data }));
  w.on('error', (e) => like.onerror?.(e));
  return like;
}
const digest = (a: Float32Array) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

test('workers: the same bytes from one worker, four, or none; progress; errors; cancelling', async () => {
  const def = definitionFromPreset('frozen');
  const level = 6, params = { level, width: 200, height: 100, layer: 'insolation' as const };
  assert.ok(cellsAt(level) > 4 * PART_SIZE, 'the stage runs in several parts');
  const results: string[] = [];
  for (const size of [1, 4]) {
    const pool = new WorkerPool(nodeWorker, size);
    try {
      const p = new Pipeline(pool);
      const parts: number[] = [];
      const ins = await p.product('insolation', def, { level }, { onProgress: (d) => parts.push(d) });
      assert.deepEqual(parts, Array.from({ length: Math.ceil(cellsAt(level) / PART_SIZE) }, (_, i) => i + 1), 'progress part by part');
      const r = await p.product('raster', def, params);
      results.push(digest(ins.data.annual as Float32Array) + digest(ins.data.monthly as Float32Array) + digest(r.data.raster as Float32Array));
      assert.equal(await pool.run('ping', null), 'pong');
      await assert.rejects(pool.run('nothing', null), /No task called nothing/);
    } finally {
      pool.dispose();
    }
  }
  const local = new Pipeline(new LocalExecutor());
  const li = await local.product('insolation', def, { level });
  const lr = await local.product('raster', def, params);
  results.push(digest(li.data.annual as Float32Array) + digest(li.data.monthly as Float32Array) + digest(lr.data.raster as Float32Array));
  assert.equal(results[1], results[0], 'four workers, the same bytes as one');
  assert.equal(results[2], results[0], 'and as this thread');
  // Cancelling a running task stops its worker; the pool carries on with a fresh one.
  const pool = new WorkerPool(nodeWorker, 1);
  try {
    const ac = new AbortController();
    const running = new Pipeline(pool).product('insolation', def, { level: 7 }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await assert.rejects(running, (e: unknown) => e instanceof CancelledError);
    assert.equal(await pool.run('ping', null), 'pong');
    const pre = new AbortController();
    pre.abort();
    await assert.rejects(pool.run('ping', null, { signal: pre.signal }), (e: unknown) => e instanceof CancelledError);
  } finally {
    pool.dispose();
  }
  await assert.rejects(pool.run('ping', null), /closed/);
});

test('the climate\'s months shared among workers (D168): the same bytes however they are shared, and as one run', async () => {
  const def = definitionFromPreset('earthlike', 2);
  const params = { level: 4, durationMyr: 100, frameEveryMyr: 25 };
  const fields = ['monthly', 'annual', 'precipMonthly', 'precipAnnual', 'currents', 'windJan', 'windJul'] as const;
  const bytes = (d: Record<string, unknown>) => fields.map((f) => digest(d[f] as Float32Array)).join('') + `${d.meanPrecip}:${d.meanK}`;
  const seen: string[] = [];
  let history: Record<string, unknown> | null = null, temperature: Record<string, unknown> | null = null;
  // One worker (all twelve months in one part), three (four months each), seven (two each).
  for (const size of [1, 3, 7]) {
    const p = new Pipeline(new LocalExecutor(size));
    const parts: number[] = [];
    const c = await p.product('climate', def, params, { onProgress: (d) => parts.push(d) });
    assert.equal(parts.length, Math.ceil(12 / Math.ceil(12 / size)), `${size} workers: the months in ${parts.length} parts`);
    seen.push(bytes(c.data));
    history ??= p.cache.get(p.keyOf('tectonics', def, params)) as Record<string, unknown>;
    temperature ??= p.cache.get(p.keyOf('temperature', def, params)) as Record<string, unknown>;
  }
  assert.equal(seen[1], seen[0], 'three workers: the same bytes as one');
  assert.equal(seen[2], seen[0], 'seven workers: the same bytes');
  // Run whole (no parts): the same product.
  const { STAGES } = await import('../src/planet/pipeline/stages.ts');
  const whole = await STAGES.climate.run(STAGES.climate.inputs(def, params), { temperature: temperature as never }, { progress() {} });
  assert.equal(bytes(whole as Record<string, unknown>), seen[0], 'and as one run');
  assert.ok(history, 'the history made once for each pipeline');
});

test('a generated planet\'s own heights given to the climate, water and life stages (D169): no history made, keyed by the heights', async () => {
  const { meshAt } = await import('../src/planet/mesh/icosphere.ts');
  const { sampleGrid } = await import('../src/planet/mesh/transfer.ts');
  const { generatePlanet } = await import('../src/terrain/planet.ts');
  const { quickPlanetDefinition } = await import('../src/ui/planet-engine.ts');
  const { BIOME_IDS } = await import('../src/planet/life/biomes.ts');
  const params = { seed: 3, preset: 'earthlike' as const, sea: 0.65, continents: 4, mountains: 1, roughness: 0.5, ice: 0.3 };
  const grid = generatePlanet(params, 512, 256), mesh = meshAt(4);
  const h = sampleGrid(mesh, grid.data, grid.width, grid.height, grid.step), heights = Int16Array.from(h, (v) => Math.round(v));
  let sea = 0;
  for (let c = 0; c < mesh.n; c++) if (heights[c] < 0) sea += mesh.area[c];
  const def = quickPlanetDefinition(params, 6371, sea / (4 * Math.PI))!;
  assert.ok(Math.abs(def.water.oceanFraction - 0.65) < 0.08, `its sea's share (${def.water.oceanFraction.toFixed(2)})`);
  const p = new Pipeline(new LocalExecutor());
  const b = await p.product('biomes', def, { level: 4, heights });
  assert.equal(p.cache.get(p.keyOf('tectonics', def, { level: 4 })), undefined, 'no history was made');
  const biome = b.data.biome as Uint8Array;
  // Its land and sea as its heights have them (but for straits the water cuts to basins below the sea, D166).
  let landCells = 0, landSea = 0, deep = 0, deepSea = 0;
  for (let c = 0; c < mesh.n; c++) {
    if (heights[c] >= 0) { landCells++; if (BIOME_IDS[biome[c]] === 'sea') landSea++; }
    if (heights[c] < -200) { deep++; if (BIOME_IDS[biome[c]] === 'sea') deepSea++; }
  }
  assert.ok(landSea < 0.01 * landCells, `land (${landSea} of ${landCells} land cells sea)`);
  assert.ok(deepSea > 0.95 * deep, `the sea (${deepSea} of ${deep} deep cells)`);
  const land = new Set<string>();
  for (let c = 0; c < mesh.n; c++) if (heights[c] >= 0) land.add(BIOME_IDS[biome[c]]);
  assert.ok(land.size >= 5, `a range of biomes on its land (${[...land].join(', ')})`);
  // Other heights, other products.
  const other = heights.slice(); other[0] = other[0] + 100;
  assert.notEqual(p.keyOf('biomes', def, { level: 4, heights: other }), b.key);
  // A world without life keeps its own colours; a warmer one has more carbon dioxide.
  assert.equal(quickPlanetDefinition({ ...params, preset: 'moon' }, 1737, 0), null);
  assert.ok(quickPlanetDefinition({ ...params, preset: 'desert' }, 6371, 0.3)!.atmosphere.co2 > def.atmosphere.co2);
});
