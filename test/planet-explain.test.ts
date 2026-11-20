// "Why is this here?" and edits with explanations (Stage 14.10, D161): a hotspot placed on the timeline marks the
// crust it builds as edited and the place's explanation says so; explanations name the crust, the boundary, the
// climate's circulation and the biome; the history keeps the climate it was simulated with, so changing the air
// afterwards leaves its key (and so its pictures) as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, climateSnapshot, historyClimateDiffers, definitionOf } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { STAGES, tectonicParams } from '../src/planet/pipeline/stages.ts';
import { keyOf } from '../src/planet/state/hash.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { explain, cellAt } from '../src/planet/explain.ts';
import { TAG } from '../src/planet/tectonics/plates.ts';

const run = async (def: ReturnType<typeof definitionFromPreset>, level = 4, span = 150) => {
  const p = { level, durationMyr: span, frameEveryMyr: 25 }, ctx = { progress() {} };
  const go = async (id: string, deps: Record<string, unknown>) => STAGES[id].run(STAGES[id].inputs(def, p), deps as never, ctx) as Promise<Record<string, unknown>>;
  const tectonics = await go('tectonics', {}), insolation = await go('insolation', {});
  const climate = await go('climate', { temperature: await go('temperature', { tectonics }) }), water = await go('water', { tectonics, climate, insolation });
  const biomes = await go('biomes', { tectonics, climate, water, insolation });
  return { tectonics, climate, water, biomes };
};
const explainer = (def: ReturnType<typeof definitionFromPreset>, r: Awaited<ReturnType<typeof run>>, level = 4) => {
  const mesh = meshAt(level), n = mesh.n, H = r.tectonics.heights as Int16Array, K = r.tectonics.kinds as Uint8Array, last = H.length / n - 1;
  return (c: number) => explain({
    mesh, def, x: derive(def), heights: H.subarray(last * n), kinds: K.subarray(last * n), age: r.tectonics.age as Float32Array, thickness: r.tectonics.thickness as Float32Array,
    tags: r.tectonics.tags as Uint8Array, boundary: r.tectonics.boundary as Uint8Array, boundaryRate: r.tectonics.boundaryRate as Float32Array,
    climate: r.climate as never, water: r.water as never, biomes: r.biomes as never,
  }, c);
};

test('a hotspot placed on the timeline: its crust is marked as edited, and the place\'s explanation says so', async () => {
  const def = definitionFromPreset('earthlike', 4);
  def.history.events.push({ id: 'edit-1', kind: 'hotspot', startMa: 100, durationMyr: 100, strength: 1.5, at: [20, -10], note: 'Volcanic islands' });
  const r = await run(def);
  const mesh = meshAt(4), tags = r.tectonics.tags as Uint8Array;
  let edited = 0;
  for (let c = 0; c < mesh.n; c++) if (tags[c] & TAG.edited) edited++;
  assert.ok(edited > 0 && edited < mesh.n / 20, `${edited} cells of crust made by the edit`);
  // The plume stays where it was placed (in the mantle's frame): the crust over it now is the youngest of its track.
  const at = cellAt(mesh, 20, -10), why = explainer(def, r)(at);
  const all = why.sections.flatMap((s) => s.lines).join(' ');
  assert.ok(tags[at] & TAG.edited, 'the crust over the plume is the edit\'s');
  assert.match(all, /an event placed on the timeline/);
  assert.match(all, /hotspot/);
  assert.match(why.title, /m (above|under) the sea/);
  for (const h of ['The ground', 'Plates', 'Climate']) assert.ok(why.sections.some((s) => s.heading === h), h);
});

test('explanations name the circulation that gives a climate, and the biome\'s rule', async () => {
  const def = definitionFromPreset('earthlike', 7);
  const r = await run(def);
  const mesh = meshAt(4), n = mesh.n, H = r.tectonics.heights as Int16Array, last = H.length / n - 1, why = explainer(def, r);
  const x = derive(def), seen = new Set<string>();
  for (let c = 0; c < n; c++) {
    if (H[last * n + c] < 0) continue;
    const text = why(c).sections.flatMap((s) => s.lines).join(' ');
    for (const k of ['convergence zone', 'subtropical high', 'storm belt', 'Köppen-Geiger']) if (text.includes(k)) seen.add(k);
  }
  assert.ok(seen.has('convergence zone') && seen.has('Köppen-Geiger'), [...seen].join(', '));
  assert.ok(seen.has('subtropical high') || seen.has('storm belt'), `beyond the tropics too (Hadley edge ${x.hadleyEdgeDeg.toFixed(0)}°): ${[...seen].join(', ')}`);
});

test('the history keeps the climate it was simulated with: changing the air leaves it, and says so', () => {
  const def = definitionFromPreset('earthlike', 2);
  const kept = { ...def, history: { ...def.history, climate: climateSnapshot(def) } };
  const p = { level: 4, durationMyr: 100, frameEveryMyr: 25 };
  const key = (d: typeof def) => keyOf({ stage: 'tectonics', inputs: STAGES.tectonics.inputs(d, p) });
  assert.equal(key(kept), key(def), 'keeping the settings it already follows changes nothing');
  const warmer = structuredClone(kept);
  warmer.atmosphere.co2 *= 3;
  assert.equal(key(warmer), key(kept), 'more carbon dioxide afterwards: the same history');
  assert.ok(historyClimateDiffers(warmer) && !historyClimateDiffers(kept));
  // Today's climate follows the air as it is now.
  assert.notEqual(keyOf(STAGES.climate.inputs(warmer, p)), keyOf(STAGES.climate.inputs(kept, p)));
  // The snapshot survives being stored and read back.
  const back = definitionOf(JSON.parse(JSON.stringify(warmer)))!;
  assert.deepEqual(back.history.climate, kept.history.climate);
  assert.equal(tectonicParams(back, 4, 100).climate !== undefined, true);
});
