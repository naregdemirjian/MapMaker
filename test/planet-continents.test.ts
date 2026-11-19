// Continents over time (Stage 14.3, D154): continents colliding thicken and weld without going down; a continent
// rifting thins, then opens an ocean; a plume under a moving plate leaves a chain ageing away from it; timeline
// events gather a supercontinent and break it up; flood basalts and impacts; a shield on a stagnant lid grows as
// tall as gravity allows; and any moment rebuilt from a checkpoint is the moment the history ran through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stateFrom, groupOf, maxThickness, type TectonicParams, type TectonicState } from '../src/planet/tectonics/state.ts';
import { step, heights } from '../src/planet/tectonics/step.ts';
import { runHistory, stepLength, reconstructAt } from '../src/planet/tectonics/history.ts';
import { riftPlate } from '../src/planet/tectonics/reorganise.ts';
import { crustUnder } from '../src/planet/tectonics/events.ts';
import { CRUST, TAG } from '../src/planet/tectonics/plates.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { tectonicParams } from '../src/planet/pipeline/stages.ts';

const R = 6371, W = 50 / R;
const params = (over: Partial<TectonicParams> = {}): TectonicParams => ({
  level: 5, seed: 3, radiusKm: R, gravity: 9.8, plates: 2, vigor: 1, continentalFraction: 0, oceanFraction: 0.7, regime: 'mobile-lid', ...over,
});
const run = (st: TectonicState, myr: number) => {
  heights(st);
  while (st.time < myr - 1e-9) step(st, Math.min(stepLength(st, 2), myr - st.time));
};
const crustAt = (st: TectonicState, c: number) => {
  const p = st.plates[st.owner[c]], r = st.ref[c];
  return { kind: p.kind[r], thickness: p.thickness[r], age: p.age[r], orogeny: p.orogeny[r], tags: p.tags[r] };
};
/** Continental crust's volume (sr·km) and area (sr) in the world. */
const continent = (st: TectonicState) => {
  let v = 0, a = 0;
  for (let c = 0; c < st.mesh.n; c++) { const k = crustAt(st, c); if (k.kind === CRUST.continental) { v += st.mesh.area[c] * k.thickness; a += st.mesh.area[c]; } }
  return { v, a };
};
const lonOf = (st: TectonicState, c: number) => (Math.atan2(st.mesh.xyz[3 * c + 1], st.mesh.xyz[3 * c]) * 180) / Math.PI;
const unit = (lon: number, lat: number): [number, number, number] => {
  const lo = (lon * Math.PI) / 180, la = (lat * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

test('continents colliding: neither goes down, the crust thickens (up to what gravity allows), its volume kept, the plates welded along a suture', () => {
  // Two continents meeting head-on at longitude −90° (the plates close there).
  const st = stateFrom(params(), (c, x, y) => ({
    plate: x >= 0 ? 0 : 1,
    ...(y < -0.35 ? { kind: CRUST.continental, thickness: 35, age: 1500 } : { kind: CRUST.oceanic, thickness: 7, age: 60 }),
  }), [[0, 0, -W], [0, 0, W]]);
  const before = continent(st);
  run(st, 40);
  const after = continent(st);
  let thickest = 0, sutured = 0;
  for (let c = 0; c < st.mesh.n; c++) {
    const k = crustAt(st, c);
    if (k.kind === CRUST.continental) thickest = Math.max(thickest, k.thickness);
    if (k.tags & TAG.suture) sutured++;
  }
  assert.ok(thickest > 50, `thickened (${thickest.toFixed(1)} km)`);
  assert.ok(thickest <= maxThickness(9.8) + 1e-6, 'no thicker than gravity allows');
  assert.ok(sutured > 3, `a suture (${sutured} cells)`);
  assert.ok(after.v > 0.85 * before.v, `continental crust kept (${(after.v / before.v).toFixed(3)} of its volume)`);
  assert.ok(after.a < before.a, 'its area shrinks as it shortens');
  assert.equal(groupOf(st, 0), groupOf(st, 1), 'welded into one');
  // Welded, they no longer close: the next steps consume nothing.
  const v = continent(st).v;
  run(st, 50);
  assert.ok(Math.abs(continent(st).v - v) < 0.02 * v, 'welded plates move as one');
  // Under twice the gravity, mountains stop at half the thickness.
  const heavy = stateFrom(params({ gravity: 19.6 }), (c, x, y) => ({ plate: x >= 0 ? 0 : 1, ...(y < -0.35 ? { kind: CRUST.continental, thickness: 30, age: 1500 } : { kind: CRUST.oceanic, thickness: 7, age: 60 }) }), [[0, 0, -W], [0, 0, W]]);
  run(heavy, 40);
  let heavyMax = 0;
  for (let c = 0; c < heavy.mesh.n; c++) { const k = crustAt(heavy, c); if (k.kind === CRUST.continental) heavyMax = Math.max(heavyMax, k.thickness); }
  assert.ok(heavyMax <= maxThickness(19.6) + 1e-6 && heavyMax < 36, `stronger gravity, thinner mountains (${heavyMax.toFixed(1)} km)`);
});

test('a continent rifting: stretched and thinned (volume kept), then broken by a new ocean with young floor between its halves', () => {
  // One continent across the middle of plate 0; plate 1 elsewhere.
  const st = stateFrom(params(), (c, x, y, z) => ({
    plate: x > -0.2 ? 0 : 1,
    ...(x > 0.5 && Math.abs(z) < 0.6 ? { kind: CRUST.continental, thickness: 36, age: 2000 } : { kind: CRUST.oceanic, thickness: 7, age: 80 }),
  }), [[0, 0, 0], [0, 0, 0]]);
  heights(st);
  const before = continent(st);
  const q = riftPlate(st, st.plates[0], [1, 0, 0], [0, 1, 0], 25);
  assert.ok(q, 'split');
  let rifted = 0, thinnest = 99, young = 0;
  let sawStretched = false;
  for (let t = 0; t < 60; t += 2) {
    step(st, 2);
    for (let c = 0; c < st.mesh.n; c++) {
      const k = crustAt(st, c);
      if (k.kind === CRUST.continental && (k.tags & TAG.rift) && k.thickness < 30) sawStretched = true;
    }
  }
  for (let c = 0; c < st.mesh.n; c++) {
    const k = crustAt(st, c);
    if (k.tags & TAG.rift) { rifted++; if (k.kind === CRUST.continental) thinnest = Math.min(thinnest, k.thickness); }
    // New ocean between the halves (near longitude 0, where the rift ran).
    if (k.kind === CRUST.oceanic && k.age < 60 && Math.abs(lonOf(st, c)) < 40 && Math.abs(st.mesh.xyz[3 * c + 2]) < 0.5) young++;
  }
  assert.ok(sawStretched, 'the continent stretched before it broke');
  assert.ok(rifted > 5 && thinnest < 25, `rifted margins, thinned (${rifted} cells, ${thinnest.toFixed(1)} km)`);
  assert.ok(young > 5, `a new ocean (${young} cells of young floor)`);
  const after = continent(st);
  assert.ok(Math.abs(after.v - before.v) < 0.1 * before.v, `the continent's volume kept (${(after.v / before.v).toFixed(3)})`);
  assert.ok(after.a > before.a, 'its area grows as it stretches');
});

test('a plume under a moving plate leaves a chain of volcanoes, older the farther from the plume', () => {
  const st = stateFrom(params({ oceanFraction: 0.99 }), () => ({ plate: 0, kind: CRUST.oceanic, thickness: 7, age: 50 }), [[0, 0, W]]);
  const [x, y, z] = unit(0, 20);
  st.hotspots.push({ x, y, z, strength: 1, start: -Infinity, end: Infinity, cell: 0 });
  run(st, 40);
  const pts: Array<[number, number]> = [];
  for (let c = 0; c < st.mesh.n; c++) {
    const k = crustAt(st, c);
    if (!(k.tags & TAG.hotspot) || k.thickness < 8) continue;
    // Distance east of the plume along its latitude (the plate turns east about the pole), km.
    const d = (lonOf(st, c) * Math.PI / 180) * R * Math.cos((20 * Math.PI) / 180);
    pts.push([d, k.orogeny]);
  }
  assert.ok(pts.length > 6, `a chain (${pts.length} cells)`);
  // The farther east, the longer ago it was built: about 50·cos 20° km a million years.
  const speed = 50 * Math.cos((20 * Math.PI) / 180);
  const fit = pts.reduce((s, [d, t]) => s + d * t, 0) / pts.reduce((s, [, t]) => s + t * t, 0);
  assert.ok(fit > 0.6 * speed && fit < 1.5 * speed, `the chain ages away from the plume at the plate's speed (${fit.toFixed(1)} km/Myr for ${speed.toFixed(1)})`);
  // The newest volcano stands highest; older ones sink with their crust.
  const top = crustUnder(st, unit(0, 20));
  assert.ok(top.tags & TAG.hotspot);
});

test('a stagnant lid over a plume grows one shield as tall as its gravity allows (Mars)', () => {
  const st = stateFrom(params({ gravity: 3.7, oceanFraction: 0, regime: 'stagnant-lid' }), () => ({ plate: 0, kind: CRUST.continental, thickness: 50, age: 4000 }), [[0, 0, 0]]);
  const [x, y, z] = unit(-130, 18);
  st.hotspots.push({ x, y, z, strength: 2, start: -Infinity, end: Infinity, cell: 0 });
  run(st, 2000);
  const shield = crustUnder(st, unit(-130, 18));
  assert.ok(shield.thickness > 0.9 * maxThickness(3.7), `the shield thickened towards its limit (${shield.thickness.toFixed(0)} km of ${maxThickness(3.7).toFixed(0)})`);
  let peak = -Infinity, ground = 0;
  for (let c = 0; c < st.mesh.n; c++) { peak = Math.max(peak, st.height[c]); ground += st.height[c]; }
  ground /= st.mesh.n;
  assert.ok(peak - ground > 12, `towering over the plains (${(peak - ground).toFixed(1)} km)`);
});

test('timeline events: flood basalts, impacts, volcanic periods, a new plume', () => {
  const base = () => stateFrom(params({ oceanFraction: 0.5 }), (c, x) => ({ plate: 0, ...(x > 0 ? { kind: CRUST.continental, thickness: 35, age: 2000 } : { kind: CRUST.oceanic, thickness: 7, age: 60 }) }), [[0, 0, 0]]);
  // A large igneous province over 2 Myr on the continent.
  const lip = base();
  lip.events = [{ kind: 'lip', start: 0, end: 2, strength: 1, at: [0, 0] }];
  heights(lip);
  const before = crustUnder(lip, unit(0, 0)).thickness;
  step(lip, 1); step(lip, 1); step(lip, 1);
  const centre = crustUnder(lip, unit(0, 0));
  assert.ok(centre.thickness > before + 6 && centre.tags & TAG.lip, `a basalt plateau (${(centre.thickness - before).toFixed(1)} km)`);
  assert.ok(!(crustUnder(lip, unit(0, 40)).tags & TAG.lip), 'only around its centre');
  // An impact: a basin lower than the plain around it, with a rim; wider under weaker gravity.
  const strike = (gravity: number) => {
    const st = stateFrom(params({ gravity, oceanFraction: 0.3 }), () => ({ plate: 0, kind: CRUST.continental, thickness: 40, age: 3000 }), [[0, 0, 0]]);
    st.events = [{ kind: 'impact', start: 0, end: 0, strength: 8, at: [30, 10] }];
    heights(st);
    step(st, 0.5);
    let cells = 0;
    for (let c = 0; c < st.mesh.n; c++) if (crustAt(st, c).tags & TAG.impact) cells++;
    return { st, cells };
  };
  const { st: hit, cells } = strike(9.8);
  const floor = hit.height[crustUnder(hit, unit(30, 10)).cell], plain = hit.height[crustUnder(hit, unit(-150, -10)).cell];
  assert.ok(floor < plain - 2, `a basin (${(plain - floor).toFixed(1)} km deep)`);
  assert.ok(strike(1.6).cells > cells, 'a larger basin under weaker gravity');
  // A volcanic period doubles what a plume makes.
  const plume = (volcanic: boolean) => {
    const st = stateFrom(params({ oceanFraction: 0.99 }), () => ({ plate: 0, kind: CRUST.oceanic, thickness: 7, age: 50 }), [[0, 0, 0]]);
    st.events = [{ kind: 'hotspot', start: 0, end: 100, strength: 1, at: [60, -30] }, ...(volcanic ? [{ kind: 'volcanic-period' as const, start: 0, end: 100, strength: 1 }] : [])];
    run(st, 10);
    return crustUnder(st, unit(60, -30)).thickness - 7;
  };
  const quiet = plume(false), loud = plume(true);
  assert.ok(quiet > 2, `a new plume builds a volcano (${quiet.toFixed(1)} km)`);
  assert.ok(Math.abs(loud / quiet - 2) < 0.1, `twice as much in a volcanic period (${(loud / quiet).toFixed(2)})`);
});

/** How spread out continental crust is: the area-weighted mean angle (degrees) from its centre. */
function spread(kinds: Uint8Array, n: number, f: number) {
  const m = meshAt(4), c0 = [0, 0, 0];
  let a = 0;
  for (let c = 0; c < n; c++) if (kinds[f * n + c] === CRUST.continental) { a += m.area[c]; for (let i = 0; i < 3; i++) c0[i] += m.area[c] * m.xyz[3 * c + i]; }
  const l = Math.hypot(c0[0], c0[1], c0[2]) || 1;
  let s = 0;
  for (let c = 0; c < n; c++) if (kinds[f * n + c] === CRUST.continental) s += m.area[c] * Math.acos(Math.min(1, (m.xyz[3 * c] * c0[0] + m.xyz[3 * c + 1] * c0[1] + m.xyz[3 * c + 2] * c0[2]) / l));
  return (s / a) * (180 / Math.PI);
}

test('a supercontinent gathers and breaks up when the timeline says so', () => {
  const def = definitionFromPreset('earthlike', 4);
  def.tectonics.continentalFraction = 0.3;
  def.history.events = [
    { id: 'gather', kind: 'supercontinent', startMa: 450, durationMyr: 200, strength: 1 },
    { id: 'part', kind: 'breakup', startMa: 200, durationMyr: 150, strength: 2 },
  ];
  const p = tectonicParams(def, 4, 500);
  const h = runHistory(p, { durationMyr: 500, frameEveryMyr: 50 });
  const n = meshAt(4).n;
  const s = Array.from(h.times, (_, f) => spread(h.kinds, n, f));
  // Frames at 500, 450, … 0 Ma: gathered by 250 Ma, scattered again while the break-up lasts (200 to 50 Ma; after
  // it, as on Earth since Pangaea, they may drift back together).
  const start = s[0], gathered = Math.min(s[5], s[6]), scattered = Math.max(...s.slice(7, 10));
  assert.ok(gathered < 0.75 * start, `gathered: ${s.map((v) => v.toFixed(0)).join(', ')}`);
  assert.ok(scattered > 1.25 * gathered, `scattered again: ${s.map((v) => v.toFixed(0)).join(', ')}`);
});

test('any moment rebuilt from the checkpoint before it is the moment the history ran through', () => {
  const p = tectonicParams(definitionFromPreset('high-tectonic', 9), 4, 200);
  const h = runHistory(p, { durationMyr: 200, frameEveryMyr: 25, checkpointEveryMyr: 50 });
  assert.deepEqual([...h.checkpoints!.keys()].sort((a, b) => a - b), [0, 50, 100, 150, 200]);
  const n = meshAt(4).n;
  // (Each picture's heights are against the sea of its moment as the water's volume places it, D159.)
  const frameAt = (st: TectonicState, sea = st.seaLevel) => {
    const H = new Int16Array(n);
    for (let c = 0; c < n; c++) H[c] = Math.max(-32_000, Math.min(32_000, Math.round((st.height[c] - st.seaLevel) * 1000) - Math.round((sea - st.seaLevel) * 1000)));
    return H;
  };
  const hash = (a: Int16Array) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  for (const t of [75, 125, 175]) {
    const f = t / 25;
    const st = reconstructAt(h.checkpoints!, t);
    assert.equal(st.time, t);
    assert.equal(hash(frameAt(st, h.frameSea[f])), hash(h.heights.subarray(f * n, (f + 1) * n)), `the moment ${t} Myr in`);
  }
  // Rebuilding leaves the checkpoints as they were.
  const again = reconstructAt(h.checkpoints!, 125);
  assert.equal(hash(frameAt(again, h.frameSea[5])), hash(h.heights.subarray(5 * n, 6 * n)));
  // Events (here a break-up at 60 Myr in) run through checkpoints the same way.
  const def = definitionFromPreset('supercontinent', 2);
  def.history.events = [{ id: 'part', kind: 'breakup', startMa: 140, durationMyr: 100, strength: 1 }];
  const pe = tectonicParams(def, 4, 200);
  const he = runHistory(pe, { durationMyr: 200, frameEveryMyr: 25, checkpointEveryMyr: 50 });
  const st = reconstructAt(he.checkpoints!, 125);
  assert.equal(hash(frameAt(st, he.frameSea[5])), hash(he.heights.subarray(5 * n, 6 * n)), 'through an event');
});
