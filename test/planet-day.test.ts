// The day and night of a world with little or no air (D262): the ground's own balance through the day (checked
// against the Moon, Mercury and Mars), what it does to the year's temperatures, and where it shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, newDefinition, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { INERTIA_AIRLESS, INERTIA_THIN_AIR, cycleAt, dayCycle, dayCycles, dayShare, groundInertia } from '../src/planet/climate/diurnal.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME, BIOME_IDS } from '../src/planet/life/biomes.ts';
import { explain } from '../src/planet/explain.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const mesh = meshAt(4), n = mesh.n, A = mesh.area;
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };
const C = (k: number) => k - 273.15;

test('the day\'s cycle of ground with no air or little: the Moon, Mercury and Mars; the day\'s length and the ground', () => {
  // The Moon's equator (its albedo 0.12, its day 708.7 hours, its dust): about 120 °C by day and −175 °C by night,
  // 215 K on average, far below the 286 K of ground lit evenly.
  const moon = dayCycle(1361 * (1 - 0.12), 0, 0, 708.7 * 3600, 50);
  assert.ok(C(moon.max) > 95 && C(moon.max) < 125, `the Moon's day ${C(moon.max)} °C`);
  assert.ok(C(moon.min) > -190 && C(moon.min) < -165, `the Moon's night ${C(moon.min)} °C`);
  assert.ok(moon.mean > 205 && moon.mean < 228 && Math.abs(moon.even - 286) < 3, `mean ${moon.mean} K, even ${moon.even} K`);
  // Mercury's (albedo 0.09, a day of 4,222 hours): about 345 °C at its mean distance (9,083 W/m²: all the sunlight
  // there can make) and the 430 °C it is known for at its closest to the Sun (14,460 W/m²); −175 °C by night.
  const mercury = dayCycle(9083 * (1 - 0.09), 0, 0, 4222 * 3600, 80), closest = dayCycle(14_460 * (1 - 0.09), 0, 0, 4222 * 3600, 80);
  assert.ok(C(mercury.max) > 330 && C(mercury.max) < 350 && C(mercury.min) > -195 && C(mercury.min) < -160, `Mercury ${C(mercury.max)} and ${C(mercury.min)} °C`);
  assert.ok(C(closest.max) > 410 && C(closest.max) < 425, `Mercury at its closest ${C(closest.max)} °C`);
  // Never hotter than the sunlight overhead can make the ground, however cold the dawn it starts from and however
  // strong the light (a planet close to its star).
  for (const light of [1000, 1e5, 1.5e6]) assert.ok(dayCycle(light, 0, 0, 86_400, 60).max <= (light / 5.670374419e-8) ** 0.25 + 0.5, `${light} W/m²`);
  // Ground hot enough to fuse holds its heat as rock does: its nights stay hot.
  const furnace = dayCycle(1.1e6, 0, 0, 86_400, 60);
  assert.ok(furnace.min > 500 && furnace.max > 2000, `${furnace.min} K by night, ${furnace.max} K by day`);
  // Mars's (586 W/m², its firmer ground under thin air that holds a little heat): about 0 °C and −100 °C.
  const mars = dayCycle(586 * (1 - 0.25), 0, 0, 24.66 * 3600, 250, 1.06);
  assert.ok(C(mars.max) > -15 && C(mars.max) < 25 && C(mars.min) > -115 && C(mars.min) < -80, `Mars ${C(mars.max)} and ${C(mars.min)} °C`);
  // The mean over the day is never above that of ground lit evenly; a longer day, hotter days and colder nights and
  // a lower mean; ground that holds more heat, less of each.
  const day = (hours: number, inertia = 60) => dayCycle(1361 * 0.75, 0, 0, hours * 3600, inertia);
  const short = day(6), earthly = day(24), long = day(700), endless = day(10_000);
  for (const d of [short, earthly, long, endless]) assert.ok(d.mean <= d.even + 1e-6 && d.max > d.even && d.min < d.even);
  assert.ok(short.min > earthly.min && earthly.min > long.min && long.min > endless.min, 'colder nights, the longer they are');
  assert.ok(short.mean > earthly.mean && earthly.mean > long.mean && long.mean > endless.mean, 'a lower mean, the longer the day');
  assert.ok(short.max < long.max);
  const rock = day(24, 2000);
  assert.ok(rock.max - rock.min < 0.4 * (earthly.max - earthly.min) && rock.mean > earthly.mean, 'solid rock evens the day out');
  // Towards the pole, less of everything; where the sun does not rise all day, nothing to say.
  assert.ok(dayCycle(1000, 1.2, 0, 86_400, 60).max < dayCycle(1000, 0, 0, 86_400, 60).max);
  assert.deepEqual(dayCycle(1000, 1.4, -0.4, 86_400, 60), { mean: 0, max: 0, min: 0, even: 0 });
  assert.deepEqual(dayCycle(1000, Math.PI / 2, 0, 86_400, 60), { mean: 0, max: 0, min: 0, even: 0 });
  // The ground by its air: dust with none, firmer under thin air; all of the day's cycle under a hundredth of a bar,
  // none from a tenth.
  assert.equal(groundInertia(0), INERTIA_AIRLESS);
  assert.equal(groundInertia(0.006), INERTIA_THIN_AIR);
  assert.equal(groundInertia(1), INERTIA_THIN_AIR);
  assert.deepEqual([dayShare(0), dayShare(0.01), dayShare(0.1), dayShare(1)], [1, 1, 0, 0]);
  assert.ok(Math.abs(dayShare(0.055) - 0.5) < 1e-9);
});

test('the table by latitude and month: within what a day can do; nothing where the sun does not rise', () => {
  const sun = { S: 1361, companion: 0, tilt: 0.41, eccentricity: 0.0167, perihelionDeg: 283, locked: false };
  const t = dayCycles(sun, 0.25, 708.7 * 3600, 60);
  assert.equal(t.lats.length, 19);
  assert.equal(t.mean.length, 12 * 19);
  for (let i = 0; i < t.mean.length; i++) {
    assert.ok(t.mean[i] >= 0.3 && t.mean[i] <= 1 && t.max[i] >= 1 && t.max[i] <= 2.5 && t.min[i] >= 0.05 && t.min[i] <= 1, `entry ${i}: ${t.mean[i]}, ${t.max[i]}, ${t.min[i]}`);
  }
  // The equator through the year: about three quarters; the north pole in its winter night (the first month): 1.
  assert.ok(Math.abs(cycleAt(t.mean, t.lats, 0, 0) - 0.77) < 0.04);
  assert.equal(cycleAt(t.mean, t.lats, 0, Math.PI / 2), 1);
  assert.equal(cycleAt(t.max, t.lats, 0, Math.PI / 2), 1);
  // Between the table's rows.
  const a = cycleAt(t.mean, t.lats, 3, 0), b = cycleAt(t.mean, t.lats, 3, (10 * Math.PI) / 180), mid = cycleAt(t.mean, t.lats, 3, (5 * Math.PI) / 180);
  assert.ok(Math.abs(mid - (a + b) / 2) < 1e-6);
});

test('planets with little or no air: their days and nights, their lower mean, ground scorched by its days; not under air, nor locked to the star', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const figures = async (def: PlanetDefinition) => {
    const T = (await p.product('temperature', def, P)).data, Cl = (await p.product('climate', def, P)).data, B = (await p.product('biomes', def, P)).data;
    const share = new Map<string, number>(), biome = B.biome as Uint8Array;
    for (let c = 0; c < n; c++) share.set(BIOME_IDS[biome[c]], (share.get(BIOME_IDS[biome[c]]) ?? 0) + A[c] / (4 * Math.PI));
    return { T, Cl, B, of: (b: keyof typeof BIOME) => share.get(b) ?? 0 };
  };
  // Like the Moon (its size, no water, its long day): about 90 °C by day and −175 °C by night at the equator, some
  // −70 °C on average (the Moon: about −75), bare rock.
  const moonDef = change(d, (c) => { c.body.radiusKm = 1737; c.water.depthKm = 0; c.body.dayHours = 655.7; c.body.tiltDeg = 1.5; });
  const moon = await figures(moonDef);
  assert.ok((moon.T.dayC as number) > 75 && (moon.T.dayC as number) < 115 && (moon.T.nightC as number) > -195 && (moon.T.nightC as number) < -160, `the Moon's like: ${moon.T.dayC} and ${moon.T.nightC} °C`);
  assert.ok((moon.T.surfaceC as number) > -90 && (moon.T.surfaceC as number) < -55, `${moon.T.surfaceC} °C on average`);
  assert.ok(moon.of('barren') > 0.999);
  const high = moon.T.dayHigh as Float32Array, low = moon.T.nightLow as Float32Array, monthly = moon.Cl.monthly as Float32Array;
  assert.equal(high.length, n);
  for (let c = 0; c < n; c += 53) {
    let mean = 0;
    for (let m = 0; m < 12; m++) mean += monthly[m * n + c] / 12;
    assert.ok(high[c] >= mean - 1e-3 && low[c] <= mean + 1e-3, `cell ${c}: ${low[c]} to ${high[c]} about ${mean}`);
  }
  assert.deepEqual([...(moon.Cl.dayHigh as Float32Array).subarray(0, 8)], [...high.subarray(0, 8)], 'with the climate, for a place\'s card');
  // The same body with the Earth's short day: milder nights, a higher mean.
  const spun = await figures(change(moonDef, (c) => { c.body.dayHours = 24; }));
  assert.ok((spun.T.nightC as number) > (moon.T.nightC as number) + 25 && (spun.T.surfaceC as number) > (moon.T.surfaceC as number) + 10, `${spun.T.nightC} °C nights, ${spun.T.surfaceC} °C on average`);
  // Like Mercury: scorched by its days (about 315 °C on the model's bare rock, brighter than Mercury's own), though
  // its year's mean is mild.
  const mercury = await figures(change(d, (c) => { c.body.radiusKm = 2440; c.water.depthKm = 0; c.atmosphere.pressureBar = 0; c.orbit.semiMajorAu = 0.387; c.body.dayHours = 1407.6; c.body.tiltDeg = 0; }));
  assert.ok((mercury.T.dayC as number) > 290 && (mercury.T.dayC as number) < 330 && (mercury.T.nightC as number) < -150 && (mercury.T.surfaceC as number) < 100, `${mercury.T.dayC}, ${mercury.T.nightC}, ${mercury.T.surfaceC} °C`);
  assert.ok(mercury.of('scorched') > 0.9, `${mercury.of('scorched')} scorched`);
  // Like Mars: about 0 °C by day and −100 °C by night.
  const mars = await figures(newDefinition('inactive', 4));
  assert.ok((mars.T.dayC as number) > -20 && (mars.T.dayC as number) < 25 && (mars.T.nightC as number) > -120 && (mars.T.nightC as number) < -80, `like Mars: ${mars.T.dayC} and ${mars.T.nightC} °C`);
  // A place on the Moon's like, explained.
  const sea = (await p.product('sea', moonDef, P)).data, W = (await p.product('water', moonDef, P)).data;
  const none = new Uint8Array(n), zero = new Float32Array(n);
  const equator = mesh.lat.findIndex((l) => Math.abs(l) < 0.03);
  const text = explain({
    mesh, def: moonDef, x: derive(moonDef), heights: sea.heights as Int16Array, dry: true, kinds: none, age: zero, thickness: zero, tags: none, boundary: none, boundaryRate: zero,
    climate: moon.Cl as never, water: W as never, biomes: moon.B as never,
  }, equator);
  assert.match(text.sections.flatMap((sec) => sec.lines).join(' '), /With so little air over it the ground follows the sun: its days reach about \d+ °C and its nights fall to about -\d+ °C/);
  // Under the Earth's air: no day and night of the ground's own. Half way (0.055 bar): half of it.
  const earth = await figures(d);
  assert.equal(earth.T.dayHigh, undefined);
  assert.equal(earth.Cl.dayHigh, undefined);
  const dry = change(d, (c) => { c.water.depthKm = 0; });
  const half = await figures(change(dry, (c) => { c.atmosphere.pressureBar = 0.055; })), bare = await figures(change(dry, (c) => { c.atmosphere.pressureBar = 0; }));
  const swing = (f: { T: Record<string, unknown> }) => (f.T.dayC as number) - (f.T.nightC as number);
  assert.ok(swing(half) > 0.25 * swing(bare) && swing(half) < 0.75 * swing(bare), `${swing(half)} against ${swing(bare)}`);
  // Locked to its star: no day to speak of (one side always lit: the year's model has it).
  const locked = await figures(change(dry, (c) => { c.atmosphere.pressureBar = 0; c.body.tidallyLocked = true; }));
  assert.equal(locked.T.dayHigh, undefined);
});

test('the first calculation as it was: no day and night of the ground\'s own', async () => {
  const p = new Pipeline(new LocalExecutor()), d = definitionFromPreset('inactive', 4);
  const T = (await p.product('temperature', d, { level: 4, durationMyr: 200, frameEveryMyr: 25 })).data;
  assert.equal(T.dayHigh, undefined);
});
