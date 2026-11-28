// A preset for each kind of world (D268): each gives its kind under the second calculation, from its causes; the
// first calculation's presets are as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, WORLD_KINDS, definitionFromPreset, definitionOf, definitionProblems, newDefinition, type PresetId } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { AIRLESS_ROCK, BIOME, bareRockColour } from '../src/planet/life/biomes.ts';
import { familyShares, type FamilyId } from '../src/planet/why.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const mesh = meshAt(4), n = mesh.n, A = mesh.area;

test('the presets: every one offered once, in order; the new kinds for the second calculation only; the first\'s as they were', () => {
  const ids = Object.keys(PRESETS) as PresetId[];
  assert.deepEqual([...WORLD_KINDS].sort(), [...ids].sort(), 'each preset offered exactly once');
  assert.deepEqual(WORLD_KINDS.slice(0, 11), ['earthlike', 'ice-age', 'frozen', 'desert', 'ocean', 'tidally-locked', 'hothouse', 'scorched', 'lava', 'inactive', 'airless']);
  assert.deepEqual(ids.filter((id) => PRESETS[id].second), ['ice-age', 'scorched', 'lava', 'airless']);
  // What each is called where the kind of world says more than its name.
  assert.deepEqual(WORLD_KINDS.map((id) => PRESETS[id].kind ?? PRESETS[id].name), [
    'Earth-like', 'Ice age', 'Snowball', 'Hot desert', 'Ocean world', 'Locked to its star', 'Venus-like', 'Scorched world', 'Lava world', 'Mars-like', 'Airless world',
    'Ancient supercontinent', 'Young volcanic world', 'Highly tectonic', 'High-gravity super-Earth',
  ]);
  for (const id of ids) {
    assert.ok(PRESETS[id].about.length > 60, `${id} says what to expect`);
    const d = newDefinition(id, 3);
    assert.equal(d.engine, 2);
    assert.equal(d.preset, id);
    assert.deepEqual(definitionProblems(d), [], id);
    // (Stored and read again: the same definition.)
    assert.deepEqual(definitionOf(JSON.parse(JSON.stringify(d))), d, id);
  }
  // The first calculation's desert world keeps the share of sea it was given; the second's has a fiftieth of the
  // Earth's water.
  const first = definitionFromPreset('desert', 3);
  assert.equal(first.engine, undefined);
  assert.equal(first.water.oceanFraction, 0.1);
  assert.equal(first.water.depthKm, undefined);
  assert.equal(newDefinition('desert', 3).water.depthKm, 0.05);
  assert.equal(newDefinition('lava', 3).water.depthKm, 0);
  // The lava world: its star's tides have stopped its turning.
  assert.equal(derive(newDefinition('lava', 3)).tidallyLocked, true);
});

test('each kind of world gives its kind: an Earth, an ice age, a snowball, a hot desert, an ocean world, a locked world, Venus\'s and Mars\'s like, scorched, lava, airless', async () => {
  const p = new Pipeline(new LocalExecutor());
  const made: Partial<Record<PresetId, { fate: string; air: string; seaShare: number; meanC: number; frozen: number; dayC?: number; nightC?: number; rain: number; fam: Record<FamilyId, number>; colour: number[] }>> = {};
  for (const id of WORLD_KINDS.slice(0, 11)) {
    const d = newDefinition(id, 4);
    const sea = (await p.product('sea', d, P)).data, T = (await p.product('temperature', d, P)).data, C = (await p.product('climate', d, P)).data, B = (await p.product('biomes', d, P)).data;
    // (The planet's mean colour, over its whole surface.)
    const colour = [0, 0, 0], rgb = B.colour as Uint8Array;
    for (let c = 0; c < n; c++) for (let k = 0; k < 3; k++) colour[k] += (rgb[3 * c + k] * A[c]) / (4 * Math.PI);
    made[id] = {
      colour,
      fate: sea.fate as string, air: sea.air as string, seaShare: sea.share as number, meanC: T.surfaceC as number, frozen: T.seaFrozen as number,
      dayC: T.dayC as number | undefined, nightC: T.nightC as number | undefined, rain: C.meanPrecip as number, fam: familyShares(B.shares as Float32Array),
    };
  }
  const say = (id: PresetId) => JSON.stringify(made[id], (_k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v));
  const m = made as Record<PresetId, NonNullable<(typeof made)[PresetId]>>;
  // An Earth: open seas, mild, forest and grass.
  assert.ok(m.earthlike.fate === 'liquid' && m.earthlike.meanC > 10 && m.earthlike.meanC < 20 && m.earthlike.fam.forest + m.earthlike.fam.grass > 0.15 && m.earthlike.frozen < 0.12, say('earthlike'));
  // An ice age: colder by some degrees, more ice, its seas still mostly open.
  assert.ok(m['ice-age'].fate === 'liquid' && m['ice-age'].meanC < m.earthlike.meanC - 5 && m['ice-age'].meanC > 0 && m['ice-age'].fam.ice > m.earthlike.fam.ice + 0.05 && m['ice-age'].frozen < 0.4, say('ice-age'));
  // A snowball: its seas frozen from pole to pole.
  assert.ok(m.frozen.fate === 'liquid' && m.frozen.frozen > 0.99 && m.frozen.fam.ice > 0.9 && m.frozen.meanC < -40, say('frozen'));
  // A hot desert: small seas, warm, more desert and bare ground than anything else, little green.
  assert.ok(m.desert.fate === 'liquid' && m.desert.seaShare > 0.03 && m.desert.seaShare < 0.2 && m.desert.meanC > 15 && m.desert.meanC < 35, say('desert'));
  assert.ok(m.desert.fam.desert + m.desert.fam.rock > 0.5 && m.desert.fam.forest < 0.1 && m.desert.fam.ice < 0.02, say('desert'));
  // An ocean world: water over nearly everything.
  assert.ok(m.ocean.fam.sea + m.ocean.fam.ice > 0.9 && m.ocean.meanC > 10, say('ocean'));
  // Locked to its star: open sea under the star, ice on the far side.
  assert.ok(m['tidally-locked'].fate === 'liquid' && m['tidally-locked'].fam.sea > 0.2 && m['tidally-locked'].fam.ice > 0.15, say('tidally-locked'));
  // Venus's like: no water, scorched under its crushing air, at about 460 °C.
  assert.ok(m.hothouse.air === 'held' && m.hothouse.fam.scorched > 0.99 && m.hothouse.meanC > 430 && m.hothouse.meanC < 500, say('hothouse'));
  // Scorched: its seas boiled away, dry rock hotter than boiling water, its air still held.
  assert.ok(m.scorched.fate === 'boiled' && m.scorched.air === 'held' && m.scorched.fam.scorched > 0.9 && m.scorched.meanC > 100 && m.scorched.meanC < 200 && m.scorched.rain === 0, say('scorched'));
  // A lava world: no air, the face under the star molten, the other dark cold rock.
  assert.ok(m.lava.air === 'none' && m.lava.fam.molten > 0.3 && m.lava.fam.molten < 0.6 && m.lava.fam.rock > 0.3 && m.lava.fam.sea + m.lava.fam.ice === 0, say('lava'));
  // Mars's like: thin air held, dry, bare rock, about -65 °C.
  assert.ok(m.inactive.air === 'held' && m.inactive.fam.rock > 0.99 && m.inactive.meanC > -80 && m.inactive.meanC < -50, say('inactive'));
  // (Bare rock by the air over it: brown under air, dark grey under none.)
  assert.deepEqual(bareRockColour(1), [...BIOME.barren.colour]);
  assert.deepEqual(bareRockColour(0.0063), [...BIOME.barren.colour]);
  assert.deepEqual(bareRockColour(0), AIRLESS_ROCK);
  assert.ok(m.airless.colour[0] < m.inactive.colour[0] - 15 && Math.abs(m.airless.colour[0] - m.airless.colour[2]) < 6, `${m.airless.colour} against ${m.inactive.colour}`);
  // Airless: nothing held, bare rock, its ground following the sun.
  assert.ok(m.airless.air === 'none' && m.airless.fam.rock > 0.99 && (m.airless.dayC ?? 0) > 90 && (m.airless.nightC ?? 0) < -150, say('airless'));
  // No two of the eleven alike: each differs from every other by a quarter of its surface (the shares of its
  // families), by 8 °C, or in its colour seen from space (Mars's like, brown rock under thin air, from the airless
  // world's dark grey).
  const apart = (a: PresetId, b: PresetId) => (Object.keys(m[a].fam) as FamilyId[]).reduce((s, f) => s + Math.abs(m[a].fam[f] - m[b].fam[f]), 0) / 2;
  const kinds = WORLD_KINDS.slice(0, 11);
  for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) {
    const tint = m[kinds[i]].colour.reduce((s2, v, k) => s2 + Math.abs(v - m[kinds[j]].colour[k]), 0);
    assert.ok(apart(kinds[i], kinds[j]) > 0.125 || Math.abs(m[kinds[i]].meanC - m[kinds[j]].meanC) > 8 || tint > 40, `${kinds[i]} and ${kinds[j]}: ${apart(kinds[i], kinds[j])} of the surface, ${m[kinds[i]].meanC} and ${m[kinds[j]].meanC} °C, colours ${tint} apart`);
  }
});
