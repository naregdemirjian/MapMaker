// Tipping points (D265): the values of a setting at which a planet becomes another kind of world, from the rules its
// pictures follow; and where its seas freeze over, from the climate itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDefinition, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { airState, waterState, withAirAsItIs } from '../src/planet/model/physics.ts';
import { RANGES, boundary, boundaryAsync, freezeGuess, settingInWords, tippingPoints, withSetting } from '../src/planet/tipping.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';

const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };

test('finding where something changes along a range: by halving, in equal ratios, awaited', async () => {
  assert.ok(Math.abs(boundary(0, 10, (v) => v < 3.3)! - 3.3) < 1e-3);
  assert.ok(Math.abs(boundary(0.01, 100, (v) => v > 2, { log: true })! / 2 - 1) < 1e-3);
  assert.equal(boundary(0, 10, (v) => v < 30), null, 'the same at both ends');
  let tried = 0;
  const found = await boundaryAsync(0.5, 4, async (v) => { tried++; return v > 1.03; }, { log: true, steps: 7 });
  assert.ok(Math.abs(found! - 1.03) < 0.02 && tried === 9, `${found} in ${tried} tries`);
  assert.equal(await boundaryAsync(0, 1, async () => true), null);
  // Stopped from outside: nothing found, no more tried.
  const ac = new AbortController();
  let after = 0;
  const stopped = await boundaryAsync(0, 8, async (v) => { if (++after === 3) ac.abort(); return v > 5; }, { signal: ac.signal });
  assert.equal(stopped, null);
  assert.equal(after, 3);
});

test('an Earth\'s tipping points: where it loses its air, where its seas boil away, where there is too little air for water', () => {
  const d = newDefinition('earthlike', 4), share = 0.71;
  const marks = (s: Parameters<typeof tippingPoints>[2], def = d, sea = share) => tippingPoints(def, sea, s);
  // Distance: no air inside about a quarter of an AU; the seas boil away inside about 0.93 AU.
  const distance = marks('distance');
  assert.deepEqual(distance.map((m) => [m.tone, m.side]), [['air', 'below'], ['hot', 'below']]);
  assert.ok(Math.abs(distance[0].at - 0.243) < 0.01 && Math.abs(distance[1].at - 0.926) < 0.02, `${distance.map((m) => m.at)}`);
  assert.deepEqual(distance.map((m) => m.label), ['no air inside 0.24 AU', 'seas boil away inside 0.93 AU']);
  // Each mark is where the rule itself changes: just inside it one thing, just outside the other.
  const fate = (au: number) => waterState(withAirAsItIs(withSetting(d, 'distance', au)), share).fate;
  assert.deepEqual([fate(distance[1].at * 0.99), fate(distance[1].at * 1.01)], ['boiled', 'liquid']);
  assert.deepEqual([airState(withSetting(d, 'distance', distance[0].at * 0.99)).held, airState(withSetting(d, 'distance', distance[0].at * 1.01)).held], [false, true]);
  // The star's mass: the seas boil away under a little more star; the air goes under a great deal more.
  const star = marks('starMass');
  assert.deepEqual(star.map((m) => [m.tone, m.side]), [['hot', 'above'], ['air', 'above']]);
  assert.ok(star[0].at > 1.01 && star[0].at < 1.08 && star[1].at > 1.5 && star[1].at < 2);
  assert.match(star[0].label, /^seas boil away above 1\.0\d Suns$/);
  // The air's pressure: no liquid water below water's triple point; too strong a greenhouse from some tens of bar.
  const pressure = marks('pressure');
  assert.deepEqual(pressure.map((m) => [m.tone, m.side, m.label.replace(/ \d+\.\d bar$/, ' N bar')]), [['thin', 'below', 'no liquid water below 0.006 bar'], ['hot', 'above', 'seas boil away above N bar']]);
  assert.equal(pressure[0].at, 0.006);
  assert.ok(pressure[1].at > 10 && pressure[1].at < 40);
  // Carbon dioxide: the seas boil away above about a hundredth of the air.
  const co2 = marks('co2');
  assert.deepEqual(co2.map((m) => [m.tone, m.side]), [['hot', 'above']]);
  assert.ok(co2[0].at > 0.008 && co2[0].at < 0.02, `${co2[0].at}`);
  assert.match(co2[0].label, /^seas boil away above 1\.\d %$/);
  // The planet's size: no air below about 3,650 km.
  const radius = marks('radius');
  assert.deepEqual(radius.map((m) => [m.tone, m.side]), [['air', 'below']]);
  assert.ok(Math.abs(radius[0].at - 3650) < 60);
  assert.match(radius[0].label, /^no air below 3,6\d0 km$/);
  // Every mark within its slider's range.
  for (const s of ['distance', 'starMass', 'pressure', 'co2', 'radius'] as const) for (const m of marks(s)) assert.ok(m.at >= RANGES[s][0] && m.at <= RANGES[s][1]);
  // The words of a value.
  assert.deepEqual([settingInWords('distance', 0.05), settingInWords('co2', 0.0004), settingInWords('co2', 0.3), settingInWords('pressure', 21.18), settingInWords('radius', 3646)], ['0.050 AU', '0.040 %', '30 %', '21.2 bar', '3,650 km']);
});

test('other planets\' tipping points: no water, no marks for water; no air, none for air; kept by hand, none', () => {
  const d = newDefinition('earthlike', 4);
  // No water: only the air's marks.
  const dry = change(d, (c) => { c.water.depthKm = 0; });
  assert.deepEqual(tippingPoints(dry, 0, 'distance').map((m) => m.tone), ['air']);
  assert.deepEqual(tippingPoints(dry, 0, 'co2'), []);
  assert.deepEqual(tippingPoints(dry, 0, 'pressure'), []);
  // No air given: nothing to lose; its water has no marks along the distance (it is not liquid anywhere).
  const bare = change(d, (c) => { c.atmosphere.pressureBar = 0; });
  assert.deepEqual(tippingPoints(bare, 0.71, 'distance'), []);
  assert.deepEqual(tippingPoints(bare, 0.71, 'radius'), []);
  // Kept by hand: no mark for what is kept.
  assert.deepEqual(tippingPoints(change(d, (c) => { c.water.keep = true; }), 0.71, 'distance').map((m) => m.tone), ['air']);
  assert.deepEqual(tippingPoints(change(d, (c) => { c.atmosphere.keep = true; }), 0.71, 'radius'), []);
  // Like Mars (no water): it would lose its air a little closer to the Sun, or a little smaller.
  const mars = newDefinition('inactive', 4);
  const inward = tippingPoints(mars, 0, 'distance');
  assert.deepEqual(inward.map((m) => m.tone), ['air']);
  assert.ok(inward[0].at > 1.1 && inward[0].at < 1.4, `${inward[0].at} AU`);
  assert.ok(tippingPoints(mars, 0, 'radius')[0].at < 3390);
  // A planet with small seas boils closer in than one with oceans.
  assert.ok(tippingPoints(d, 0.08, 'distance').find((m) => m.tone === 'hot')!.at < tippingPoints(d, 0.71, 'distance').find((m) => m.tone === 'hot')!.at);
});

test('where the seas freeze over: guessed from the planet\'s balance, found from its climate', async () => {
  const d = newDefinition('earthlike', 4), P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
  const p = new Pipeline(new LocalExecutor());
  const share = (await p.product('sea', d, P)).data.liquidShare as number;
  // The guess: a little beyond the Earth's distance.
  const guess = freezeGuess(d, share, 'distance')!;
  assert.ok(guess > 1.01 && guess < 1.12, `${guess} AU`);
  // The climate's own answer, within the guess's neighbourhood: frozen beyond it, open inside.
  const frozen = async (au: number) => ((await p.product('temperature', withSetting(d, 'distance', au), P)).data.seaFrozen as number) >= 0.995;
  const at = (await boundaryAsync(guess / 1.12, guess * 1.12, frozen, { log: true, steps: 5 }))!;
  assert.ok(at > 1.0 && at < 1.08, `frozen over beyond ${at} AU`);
  assert.equal(await frozen(at * 1.02), true);
  assert.equal(await frozen(at * 0.98), false);
});
