// Plate tectonics (Stage 14.2, D153): synthetic plates with known motions make what they should — a ridge with sea
// floor ageing and deepening away from it, a trench with an arc above the slab at the expected distance, an island
// arc where old ocean goes under young, nothing made or consumed along a transform — and a whole planet's history
// keeps every cell covered once, balances the crust made and consumed, keeps its continents, and is the same every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stateFrom, initialState, maxThickness, type TectonicParams } from '../src/planet/tectonics/state.ts';
import { step, heights } from '../src/planet/tectonics/step.ts';
import { runHistory, stepLength } from '../src/planet/tectonics/history.ts';
import { oceanDepth, airyHeight, crustHeight, seaLevelFor } from '../src/planet/tectonics/isostasy.ts';
import { CRUST, quatAxisAngle, quatMul, quatRotate, walkNearest } from '../src/planet/tectonics/plates.ts';
import { meshAt, nearestBrute } from '../src/planet/mesh/icosphere.ts';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { tectonicParams } from '../src/planet/pipeline/stages.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';

const R = 6371;
const params = (over: Partial<TectonicParams> = {}): TectonicParams => ({
  level: 5, seed: 3, radiusKm: R, gravity: 9.8, plates: 2, vigor: 1, continentalFraction: 0, oceanFraction: 0.99, regime: 'mobile-lid', ...over,
});
/** km/Myr at the equator of a rotation about z. */
const W = 50 / R;
const run = (st: ReturnType<typeof stateFrom>, myr: number) => {
  const reports = [];
  heights(st);
  while (st.time < myr - 1e-9) reports.push(step(st, Math.min(stepLength(st, 2), myr - st.time)));
  return reports;
};
const lonOf = (st: ReturnType<typeof stateFrom>, c: number) => (Math.atan2(st.mesh.xyz[3 * c + 1], st.mesh.xyz[3 * c]) * 180) / Math.PI;
const latOf = (st: ReturnType<typeof stateFrom>, c: number) => (Math.asin(st.mesh.xyz[3 * c + 2]) * 180) / Math.PI;
const crustAt = (st: ReturnType<typeof stateFrom>, c: number) => {
  const p = st.plates[st.owner[c]], r = st.ref[c];
  return { kind: p.kind[r], thickness: p.thickness[r], age: p.age[r] };
};

test('relations: age-depth (GDH1), Airy isostasy, sea level, the thickest crust gravity allows', () => {
  assert.ok(Math.abs(oceanDepth(0) - 2.6) < 1e-9);
  assert.ok(Math.abs(oceanDepth(100) - 5.49) < 0.05, 'old sea floor about 5.5 km deep');
  assert.ok(oceanDepth(10) < oceanDepth(50) && oceanDepth(50) < oceanDepth(150), 'deeper with age');
  assert.ok(Math.abs(airyHeight(35) - 0.5) < 1e-9, 'continents stand about half a kilometre up');
  assert.ok(airyHeight(70) > 5 && airyHeight(70) < 6.5, 'a crust twice as thick holds a plateau like Tibet');
  assert.ok(airyHeight(25) < 0 && crustHeight(CRUST.continental, 25, 0) === airyHeight(25), 'thinned continent under the sea');
  assert.ok(crustHeight(CRUST.oceanic, 7, 0) > crustHeight(CRUST.oceanic, 7, 100));
  assert.ok(crustHeight(CRUST.arc, 20, 10) > crustHeight(CRUST.oceanic, 7, 10), 'arcs stand above the sea floor');
  assert.ok(Math.abs(maxThickness(9.81) - 70) < 1e-9 && maxThickness(19.6) < 36, 'stronger gravity, thinner crust');
  const h = Float32Array.from([-5, -4, -3, -2, 0, 1, 2, 3, 4, 5]), A = new Float64Array(10).fill(1);
  const sl = seaLevelFor(h, A, 0.7);
  assert.equal(h.filter((v) => v < sl).length, 7);
  // Quaternions: a quarter turn about z takes x to y; turning there and back is nothing.
  const q = quatAxisAngle(0, 0, 1, Math.PI / 2), v = [0, 0, 0];
  quatRotate(q, 1, 0, 0, v);
  assert.ok(Math.abs(v[0]) < 1e-12 && Math.abs(v[1] - 1) < 1e-12);
  quatRotate(q, v[0], v[1], v[2], v, true);
  assert.ok(Math.abs(v[0] - 1) < 1e-12);
  const twice = quatMul(q, q);
  quatRotate(twice, 1, 0, 0, v);
  assert.ok(Math.abs(v[0] + 1) < 1e-12, 'two quarter turns make a half');
  // The walk finds the nearest cell from anywhere.
  const m = meshAt(4);
  for (const [x, y, z] of [[0.3, -0.5, 0.81], [-0.9, 0.1, -0.42], [0, 0, -1]]) {
    const l = Math.hypot(x, y, z);
    assert.equal(walkNearest(m, x / l, y / l, z / l, 0), nearestBrute(m, [x / l, y / l, z / l]));
  }
});

test('two oceanic plates parting make a ridge: sea floor ageing and deepening away from it, split between both sides', () => {
  // Plate 0 holds x ≥ 0, plate 1 x < 0; turning opposite ways about z, they part at longitude 90° (and close at −90°).
  const st = stateFrom(params(), (c, x) => ({ plate: x >= 0 ? 0 : 1, kind: CRUST.oceanic, thickness: 7, age: 120 }), [[0, 0, -W], [0, 0, W]]);
  const reports = run(st, 30);
  // About 100 km/Myr of opening along a ridge from pole to pole (half the planet's circumference).
  const made = reports.reduce((s, r) => s + r.created, 0) * R * R;
  const expected = 100 * 30 * Math.PI * R * (2 / Math.PI);
  assert.ok(made > 0.6 * expected && made < 1.4 * expected, `crust made ${made.toFixed(0)} km² for about ${expected.toFixed(0)}`);
  let young0 = 0, young1 = 0;
  const pairs: Array<[number, number]> = [];
  for (let c = 0; c < st.mesh.n; c++) {
    const lat = latOf(st, c), lon = lonOf(st, c);
    const k = crustAt(st, c);
    if (k.age < 30) { if (st.owner[c] === 0) young0++; else young1++; }
    if (Math.abs(lat) > 20 || Math.abs(lon - 90) > 35) continue;
    // Distance from the ridge (longitude 90°), km.
    const d = (Math.abs(lon - 90) * Math.PI / 180) * R * Math.cos((lat * Math.PI) / 180);
    if (k.age < 30) pairs.push([d, k.age]);
    // Depth follows the age (within the smoothing and the cell size).
    const want = crustHeight(k.kind, k.thickness, k.age);
    assert.ok(Math.abs(st.height[c] - want) < 0.7, `height ${st.height[c]} for age ${k.age} (${want})`);
  }
  assert.ok(young0 > 20 && young1 > 20 && Math.min(young0, young1) / Math.max(young0, young1) > 0.5, `both sides get new crust (${young0}, ${young1})`);
  // Age grows with distance at the half rate: about 50 km a million years.
  const fit = pairs.reduce((s, [d, a]) => s + d * a, 0) / pairs.reduce((s, [, a]) => s + a * a, 0);
  assert.ok(pairs.length > 10 && fit > 30 && fit < 80, `half spreading rate ${fit.toFixed(1)} km/Myr from ${pairs.length} cells`);
  // Every cell held by one plate; the ridge classified as divergent.
  assert.ok(st.owner.every((o) => o === 0 || o === 1));
  let div = 0;
  for (let c = 0; c < st.mesh.n; c++) if (st.boundary[c] === 1 && Math.abs(lonOf(st, c) - 90) < 15) div++;
  assert.ok(div > 10, 'the ridge is divergent');
});

test('ocean going under a continent: a trench on the oceanic side, an arc on the continent near the slab, crust consumed', () => {
  // Plate 0 (x ≥ 0) carries a continent along its edge at longitude −90°; plate 1's ocean goes under it there.
  const st = stateFrom(params({ oceanFraction: 0.7 }), (c, x, y) => {
    if (x >= 0) return y < -0.2 ? { plate: 0, kind: CRUST.continental, thickness: 35, age: 1500 } : { plate: 0, kind: CRUST.oceanic, thickness: 7, age: 40 };
    return { plate: 1, kind: CRUST.oceanic, thickness: 7, age: 60 };
  }, [[0, 0, -W], [0, 0, W]]);
  const before = new Float32Array(st.mesh.n);
  for (let c = 0; c < st.mesh.n; c++) before[c] = crustAt(st, c).thickness;
  const reports = run(st, 30);
  const consumed = reports.reduce((s, r) => s + r.consumed, 0) * R * R;
  assert.ok(consumed > 1e6, `ocean consumed (${consumed.toFixed(0)} km²)`);
  // Trench cells: on plate 1, next to the continent, deeper than the sea floor of their age.
  let trench = 0, deeper = 0;
  for (let c = 0; c < st.mesh.n; c++) {
    if (!st.trench[c] || Math.abs(lonOf(st, c) + 90) > 30 || Math.abs(latOf(st, c)) > 40) continue;
    trench++;
    const k = crustAt(st, c);
    if (st.height[c] < crustHeight(k.kind, k.thickness, k.age) - 0.8) deeper++;
  }
  assert.ok(trench > 5 && deeper / trench > 0.8, `a trench (${deeper} of ${trench} deeper)`);
  // The arc: crust thickened on the continent, most within two cells (about 500 km) of the plate edge.
  let thick = 0, near = 0;
  for (let c = 0; c < st.mesh.n; c++) {
    if (st.owner[c] !== 0) continue;
    const k = crustAt(st, c);
    if (k.kind !== CRUST.continental || k.thickness < 36) continue;
    thick++;
    let edge = Infinity;
    for (let j = 0; j < st.mesh.n; j++) if (st.owner[j] === 1 && Math.abs(lonOf(st, j) + 90) < 40) {
      const d = Math.acos(Math.min(1, st.mesh.xyz[3 * c] * st.mesh.xyz[3 * j] + st.mesh.xyz[3 * c + 1] * st.mesh.xyz[3 * j + 1] + st.mesh.xyz[3 * c + 2] * st.mesh.xyz[3 * j + 2])) * R;
      edge = Math.min(edge, d);
    }
    if (edge < 750) near++;
  }
  // (The arc's axis lies about 110 km from the trench for a slab of this age; at this level the cells are 240 km
  // across, so the band spreads over about three cells.)
  assert.ok(thick > 5 && near / thick > 0.9, `an arc near the trench (${near} of ${thick})`);
  // The continent was not consumed: no continental crust lost.
  const cont0 = before.filter((t, c) => t === 35).length;
  let cont1 = 0;
  for (let c = 0; c < st.mesh.n; c++) if (crustAt(st, c).kind === CRUST.continental) cont1++;
  assert.ok(cont1 >= cont0 * 0.95, `continent kept (${cont1} of ${cont0})`);
});

test('old ocean going under young makes an island arc; plates sliding past each other make and consume nothing', () => {
  const st = stateFrom(params(), (c, x) => ({ plate: x >= 0 ? 0 : 1, kind: CRUST.oceanic, thickness: 7, age: x >= 0 ? 10 : 120 }), [[0, 0, -W], [0, 0, W]]);
  run(st, 60);
  let arc = 0, lowerArc = 0;
  for (let c = 0; c < st.mesh.n; c++) {
    if (Math.abs(lonOf(st, c) + 90) > 35 || Math.abs(latOf(st, c)) > 50) continue;
    const k = crustAt(st, c);
    if (k.kind === CRUST.arc || (k.kind === CRUST.oceanic && k.thickness > 9)) { if (st.owner[c] === 0) arc++; else lowerArc++; }
  }
  assert.ok(arc > 5 && lowerArc === 0, `an island arc on the younger plate (${arc}, ${lowerArc} on the older)`);
  // A transform: northern and southern hemispheres turning opposite ways about the pole slide past at the equator.
  const tf = stateFrom(params(), (c, x, y, z) => ({ plate: z >= 0 ? 0 : 1, kind: CRUST.oceanic, thickness: 7, age: 80 }), [[0, 0, W], [0, 0, -W]]);
  const reports = run(tf, 40);
  const made = reports.reduce((s, r) => s + r.created, 0), consumed = reports.reduce((s, r) => s + r.consumed, 0);
  assert.ok(made < 0.002 * 4 * Math.PI && consumed < 0.002 * 4 * Math.PI, `a transform makes and consumes next to nothing (${made}, ${consumed})`);
  let tfCells = 0, other = 0;
  for (let c = 0; c < tf.mesh.n; c++) {
    if (tf.boundary[c] === 3) tfCells++;
    else if (tf.boundary[c] === 1 || tf.boundary[c] === 2) other++;
    assert.equal(crustAt(tf, c).thickness, 7, 'no thickening');
  }
  assert.ok(tfCells > 3 * other, `classified as a transform (${tfCells} against ${other})`);
});

test('a planet\'s 500-million-year history: every cell held once, crust made and consumed in balance, continents kept, Earth-like heights, the same every time', () => {
  const def = definitionFromPreset('earthlike', 5);
  const p = tectonicParams(def, 5);
  const t0 = performance.now();
  const h = runHistory(p, { durationMyr: 500, frameEveryMyr: 50 });
  const ms = performance.now() - t0;
  const n = meshAt(5).n, F = h.times.length;
  assert.equal(F, 11);
  assert.deepEqual(Array.from(h.times.slice(0, 3)), [500, 450, 400]);
  assert.equal(h.times[F - 1], 0);
  assert.ok(ms < 20_000, `fast enough for a preview (${ms.toFixed(0)} ms)`);
  // Every cell held by a plate at every moment, with crust.
  for (let k = 0; k < F * n; k++) assert.ok(h.plates[k] < h.plateCount && h.kinds[k] >= CRUST.oceanic && h.kinds[k] <= CRUST.arc);
  // Crust made at ridges balances crust consumed at trenches and in collisions, within a few per cent.
  const { created, consumed, collided } = h.stats;
  assert.ok(created > 4 * Math.PI, `the sea floor renewed (${created.toFixed(1)} sr made)`);
  assert.ok(Math.abs(created - consumed - collided) < 0.08 * created, `balance: made ${created.toFixed(2)}, consumed ${consumed.toFixed(2)}, collided ${collided.toFixed(2)}`);
  // Continents kept (some lost in collisions, some grown at arcs), and the sea where it was asked to be.
  assert.ok(h.stats.continentalShare > 0.25 && h.stats.continentalShare < 0.5, `continental share ${h.stats.continentalShare}`);
  assert.ok(Math.abs(h.stats.landShare - 0.29) < 0.01, `land share ${h.stats.landShare}`);
  // Earth-like heights now: deep oceans and continents standing up, mountains, trenches.
  const now = h.heights.subarray((F - 1) * n);
  const sorted = Array.from(now).sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.floor(f * (n - 1))];
  assert.ok(q(0.35) < -3500 && q(0.35) > -6000, `the deep sea floor (${q(0.35)} m)`);
  assert.ok(q(0.85) > 200 && q(0.85) < 3000, `the continents (${q(0.85)} m)`);
  assert.ok(sorted[n - 1] > 2500, `mountains (${sorted[n - 1]} m)`);
  assert.ok(sorted[0] < -6000, `trenches (${sorted[0]} m)`);
  // The sea floor is young near ridges: some crust younger than 10 Myr, most of the ocean younger than the history.
  let young = 0, ocean = 0;
  for (let c = 0; c < n; c++) if (h.kinds[(F - 1) * n + c] === CRUST.oceanic) { ocean++; if (h.age[c] < 10) young++; }
  assert.ok(young > 0.03 * ocean, `young sea floor at ridges (${young} of ${ocean})`);
  // The same history every time; another seed, another planet.
  const again = runHistory(p, { durationMyr: 500, frameEveryMyr: 100 });
  const hash = (a: Int16Array) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  assert.equal(hash(again.heights.subarray(5 * n)), hash(h.heights.subarray(10 * n)), 'the present is the same, whichever pictures are kept');
  const other = runHistory({ ...p, seed: 6 }, { durationMyr: 100, frameEveryMyr: 100 });
  assert.notEqual(hash(other.heights.subarray(n)), hash(runHistory(p, { durationMyr: 100, frameEveryMyr: 100 }).heights.subarray(n)));
});

test('regimes: a stagnant lid moves nothing; the history runs as a stage and draws its layers', async () => {
  const lid = initialState(params({ plates: 8, continentalFraction: 0.3, oceanFraction: 0.6, regime: 'stagnant-lid' }));
  heights(lid);
  const before = Float32Array.from(lid.height);
  for (let i = 0; i < 10; i++) {
    const r = step(lid, 5);
    assert.equal(r.created + r.consumed + r.collided, 0, 'nothing made or consumed');
  }
  // Only age changes anything: the sea floor sinks as it cools, nothing rises.
  for (let c = 0; c < lid.mesh.n; c++) assert.ok(lid.height[c] <= before[c] + 1e-3, 'heights only sink with age');
  const p = new Pipeline(new LocalExecutor());
  const def = definitionFromPreset('earthlike', 2);
  const opts = { level: 4, width: 128, height: 64, durationMyr: 100, frameEveryMyr: 25 };
  const elev = await p.product('raster', def, { ...opts, layer: 'elevation' });
  const plates = await p.product('raster', def, { ...opts, layer: 'plates' });
  const first = await p.product('raster', def, { ...opts, layer: 'elevation', frame: 0 });
  assert.ok((elev.data.min as number) < -3000 && (elev.data.max as number) > 0, 'sea and land');
  assert.ok(Number.isInteger(plates.data.max as number) && (plates.data.max as number) < def.tectonics.plates, 'plates drawn as whole numbers');
  assert.notDeepEqual(first.data.raster, elev.data.raster, '100 million years apart, different');
  const tect = await p.product('tectonics', def, opts);
  assert.equal(tect.cached, true, 'one history for all its layers');
});
