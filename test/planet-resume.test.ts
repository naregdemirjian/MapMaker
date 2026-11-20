// Running a history again from where edits begin (Stage 15.1, D163): a history keeps packed checkpoints; with events
// added or removed later in its span, it goes on from the last checkpoint before the earliest change and arrives at
// exactly the history a run from the beginning would make (every picture's bytes); with other settings changed it
// starts again from the beginning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { tectonicParams } from '../src/planet/pipeline/stages.ts';
import { runHistory, type TectonicHistory } from '../src/planet/tectonics/history.ts';

const hash = (a: ArrayBufferView) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const same = (x: TectonicHistory, y: TectonicHistory, what: string) => {
  for (const k of ['heights', 'plates', 'kinds', 'age', 'thickness', 'tags', 'sediment', 'boundary', 'seaLevels', 'iceVolumes', 'meanTemps', 'frameSea'] as const) {
    assert.equal(hash(y[k]), hash(x[k]), `${what}: ${k}`);
  }
  assert.equal(y.plateCount, x.plateCount);
  // The plates' rotations with each picture too (D164).
  assert.equal(y.frameRotations.length, x.frameRotations.length);
  x.frameRotations.forEach((r, f) => assert.equal(hash(y.frameRotations[f]), hash(r), `${what}: rotations in picture ${f}`));
  // And the climate each picture's moment had, that its own climate and life are worked out from (D167).
  assert.equal(hash(y.frameCo2!), hash(x.frameCo2!), `${what}: carbon dioxide`);
  x.frameWarm!.forEach((k, f) => assert.equal(hash(y.frameWarm![f]), hash(k), `${what}: the climate of picture ${f}`));
  assert.deepEqual(y.resume.times, x.resume.times, `${what}: checkpoints at the same moments`);
};

test('with an edit late in the history, it goes on from the checkpoint before it and makes the same history', () => {
  const def = definitionFromPreset('earthlike', 5);
  def.history.events = [{ id: 'a', kind: 'rift', startMa: 170, durationMyr: 30, strength: 1, at: [20, 10] }];
  const opts = { durationMyr: 200, frameEveryMyr: 25 };
  const base = runHistory(tectonicParams(def, 4, 200), opts);
  assert.equal(base.resumedFrom, 0);
  assert.deepEqual(base.resume.times, [0, 50, 100, 150]);
  // Volcanic islands placed 80 Ma (120 Myr into the history) and a sea-level rise from 30 Ma.
  def.history.events.push({ id: 'b', kind: 'hotspot', startMa: 80, durationMyr: 80, strength: 1.5, at: [-30, -20] }, { id: 'c', kind: 'sea-level', startMa: 30, durationMyr: 20, strength: 2 });
  const p = tectonicParams(def, 4, 200);
  const full = runHistory(p, opts);
  const resumed = runHistory(p, { ...opts, base });
  assert.equal(resumed.resumedFrom, 100, 'from the checkpoint 100 Myr in');
  same(full, resumed, 'resumed');
  assert.ok(resumed.stats.ms < 0.75 * full.stats.ms + 200, `faster (${resumed.stats.ms.toFixed(0)} against ${full.stats.ms.toFixed(0)} ms)`);
  // Taking an edit away again: from before it.
  def.history.events = def.history.events.filter((e) => e.id !== 'b');
  const p2 = tectonicParams(def, 4, 200);
  const back = runHistory(p2, { ...opts, base: resumed });
  assert.equal(back.resumedFrom, 100);
  same(runHistory(p2, opts), back, 'with the edit removed');
  // Another setting changed: from the beginning.
  def.tectonics.plates += 1;
  const other = runHistory(tectonicParams(def, 4, 200), { ...opts, base: resumed });
  assert.equal(other.resumedFrom, 0);
});

test('an edit starting on a checkpoint, and a change of the air, resume exactly too', () => {
  const def = definitionFromPreset('earthlike', 9);
  const opts = { durationMyr: 200, frameEveryMyr: 25 };
  const base = runHistory(tectonicParams(def, 4, 200), opts);
  // A crater exactly at the checkpoint 100 Myr in (it begins in the step after it), and an ice age from 50 Ma,
  // which changes the past climates the erosion follows.
  def.history.events.push({ id: 'k', kind: 'impact', startMa: 100, durationMyr: 0, strength: 1, at: [60, 0] }, { id: 'i', kind: 'ice-age', startMa: 50, durationMyr: 30, strength: 1 });
  const p = tectonicParams(def, 4, 200);
  const resumed = runHistory(p, { ...opts, base });
  assert.equal(resumed.resumedFrom, 100);
  same(runHistory(p, opts), resumed, 'resumed on a checkpoint');
});
