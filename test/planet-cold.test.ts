// Cold and airless worlds (D260, D261): the sea frozen over for most of the year is sea ice (still sea, drawn as ice),
// in the polar seas of an Earth and from pole to pole on a planet too far from its star; the planet's figures as its
// pictures have them; a planet too small to hold its air; water under too little air to be liquid (ice where it
// lasts, gone into vapour where it does not, ice caps where the vapour froze out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, definitionOf, newDefinition, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { SHORELINE_KMS, WATER_TRIPLE_BAR, airState, derive, escapeNeededKmS, iceAtEquatorK, iceLastsBelowK, waterState, withAirAsItIs } from '../src/planet/model/physics.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME, BIOME_IDS, SEA_ICE_FROM } from '../src/planet/life/biomes.ts';
import { explain } from '../src/planet/explain.ts';
import { seenFromSpace } from '../src/ui/planet-colors.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;
const mesh = meshAt(4), n = mesh.n, A = mesh.area;
const change = (d: PlanetDefinition, f: (d: PlanetDefinition) => void) => { const c = structuredClone(d); f(c); return c; };
const id = (b: keyof typeof BIOME) => BIOME_IDS.indexOf(b);

async function planet(p: Pipeline, d: PlanetDefinition) {
  const sea = (await p.product('sea', d, P)).data, T = (await p.product('temperature', d, P)).data, C = (await p.product('climate', d, P)).data;
  const W = (await p.product('water', d, P)).data, B = (await p.product('biomes', d, P)).data;
  const biome = B.biome as Uint8Array, share = new Map<string, number>();
  for (let c = 0; c < n; c++) share.set(BIOME_IDS[biome[c]], (share.get(BIOME_IDS[biome[c]]) ?? 0) + A[c] / (4 * Math.PI));
  return { sea, T, C, W, B, biome, of: (b: keyof typeof BIOME) => share.get(b) ?? 0 };
}

test('sea ice: the polar seas of an Earth; from pole to pole on a planet too far from its star; still sea', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  // (The new kind is added after the old ones: a stored biome's number means what it meant.)
  assert.equal(id('seaIce'), 22);
  assert.equal(SEA_ICE_FROM, 0.5);
  // An Earth: a little of its sea frozen for most of the year, all of it towards the poles; the rest open.
  const earth = await planet(p, d);
  const frozen = earth.T.seaFrozen as number, heights = earth.sea.heights as Int16Array, ice = earth.C.ice as Float32Array;
  assert.ok(frozen > 0.01 && frozen < 0.2, `${frozen} of the sea`);
  assert.ok(Math.abs(earth.of('seaIce') - frozen * (earth.sea.share as number)) < 0.02);
  assert.ok(earth.of('sea') > 0.55);
  for (let c = 0; c < n; c++) {
    if (earth.biome[c] === id('seaIce')) { assert.ok(Math.abs(mesh.lat[c]) > (50 * Math.PI) / 180, `sea ice at ${(mesh.lat[c] * 180) / Math.PI}°`); assert.ok(ice[c] >= SEA_ICE_FROM); }
    // (The water stage counts a few low shores with the sea: sea by its kind of water, not by its height alone.)
    if (earth.biome[c] === id('sea')) assert.ok(ice[c] < SEA_ICE_FROM);
    if (heights[c] < -200) assert.ok(earth.biome[c] === id('sea') || earth.biome[c] === id('seaIce'));
  }
  // The surface's mean over the year, as the pictures have it.
  const monthly = earth.C.monthly as Float32Array;
  let mean = 0;
  for (let c = 0; c < n; c++) for (let m = 0; m < 12; m++) mean += (monthly[m * n + c] * A[c]) / (12 * 4 * Math.PI);
  assert.ok(Math.abs((earth.T.surfaceC as number) - mean) < 1e-3, `${earth.T.surfaceC} against ${mean}`);
  assert.ok(mean > 5 && mean < 25);

  // Farther out (1.25 AU): frozen over from pole to pole. The same land and the same sea (its share, its heights:
  // still sea for whatever is drawn on a map of it); no open water left, the land under ice.
  const far = change(d, (c) => { c.orbit.semiMajorAu = 1.25; });
  const snowball = await planet(p, far);
  assert.equal(p.keyOf('tectonics', far, P), p.keyOf('tectonics', d, P));
  assert.equal(snowball.sea.fate, 'liquid');
  assert.equal(snowball.sea.share, earth.sea.share);
  assert.deepEqual([...(snowball.sea.heights as Int16Array)], [...heights]);
  assert.ok((snowball.T.seaFrozen as number) > 0.995, `${snowball.T.seaFrozen}`);
  assert.equal(snowball.of('sea'), 0);
  assert.ok(Math.abs(snowball.of('seaIce') - (earth.sea.share as number)) < 0.02, `${snowball.of('seaIce')}`);
  // (Under ice where snow falls on it; the little of it where next to none does is bare, D261.)
  assert.ok(snowball.of('ice') > 0.8 * (1 - (earth.sea.share as number)) && snowball.of('ice') + snowball.of('barren') > 0.97 * (1 - (earth.sea.share as number)), `the land under ice (${snowball.of('ice')})`);
  assert.ok((snowball.T.surfaceC as number) < -40, `${snowball.T.surfaceC} °C`);
  // The model's own mean is far below the planet's balance as a whole worked out without the ice's spread.
  assert.ok((snowball.T.surfaceC as number) < derive({ ...far, water: { ...far.water, oceanFraction: snowball.sea.share as number } }).surfaceK - 273.15 + 5);
  // Its colours: the sea's ice in its own, and counted with what shows (not the sea's dark blue) in the land's cover.
  const colour = snowball.B.colour as Uint8Array;
  const mid = heights.findIndex((h, c) => h < -3000 && Math.abs(mesh.lat[c]) < 0.2);
  assert.deepEqual([colour[3 * mid], colour[3 * mid + 1], colour[3 * mid + 2]], [...BIOME.seaIce.colour]);
  const W = 180, H = 90;
  const cover = (await p.product('cover', far, { ...P, width: W, height: H, land: true })).data.pixels as Uint8Array;
  for (let i = 0; i < W * H; i += 13) assert.equal(cover[4 * i + 3], 255, 'ice or land everywhere');
  // A place on the frozen sea, explained.
  const none = new Uint8Array(n), zero = new Float32Array(n);
  const text = explain({
    mesh, def: far, x: derive(far), heights: snowball.sea.heights as Int16Array, kinds: none, age: zero, thickness: zero, tags: none, boundary: none, boundaryRate: zero,
    climate: snowball.C as never, water: snowball.W as never, biomes: snowball.B as never,
  }, mid);
  assert.match(text.title, /m under the sea$/);
  assert.match(text.sections.flatMap((sec) => sec.lines).join(' '), /The sea here lies frozen for 100 % of the year: sea ice\. It is still sea: nothing stands on it\./);
});

test('seen from space: ice over the sea lies flat; the land is lit against the sea\'s level, not its floor', () => {
  const W = 6, H = 3, k = (i: number, j: number) => j * W + i;
  const cover = new Uint8Array(4 * W * H), heights = new Float32Array(W * H);
  // Ice (shown, alpha full) over a sea floor that falls steeply to the east.
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { cover.set([224, 233, 240, 255], 4 * k(i, j)); heights[k(i, j)] = -500 - 1500 * i; }
  const px = seenFromSpace(cover, heights, W, H);
  for (let i = 0; i < W; i++) assert.deepEqual([...px.subarray(4 * k(i, 1), 4 * k(i, 1) + 3)], [224, 233, 240], 'in its own colour whatever lies under it');
  // Level land beside a deep sea: neither lit nor shaded by the drop to the sea floor.
  const c2 = new Uint8Array(4 * W * H), h2 = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { c2.set([100, 140, 80, i < 3 ? 255 : 0], 4 * k(i, j)); h2[k(i, j)] = i < 3 ? 0 : -6000; }
  const p2 = seenFromSpace(c2, h2, W, H);
  assert.deepEqual([...p2.subarray(4 * k(2, 1), 4 * k(2, 1) + 3)], [100, 140, 80]);
});

test('the first calculation as it was: no sea ice among its kinds of ground', async () => {
  const p = new Pipeline(new LocalExecutor()), d = definitionFromPreset('earthlike', 4);
  d.orbit.semiMajorAu = 1.25;
  const params = { level: 4, durationMyr: 200, frameEveryMyr: 25 };
  const biome = (await p.product('biomes', d, params)).data.biome as Uint8Array;
  assert.ok(biome.every((b) => b <= id('barren')));
  assert.ok(biome.some((b) => b === id('sea')));
  const T = (await p.product('temperature', d, params)).data;
  assert.equal(T.surfaceC, undefined);
  assert.equal(T.seaFrozen, undefined);
});

// ---------------------------------------------------------------- thin air and no air (D261)

test('whether a planet holds its air: the line across the Solar System; kept by hand', () => {
  // The line itself: the least escape speed for the light a world gets.
  assert.ok(Math.abs(escapeNeededKmS(1) - SHORELINE_KMS) < 1e-12);
  assert.ok(Math.abs(escapeNeededKmS(16) - 2 * SHORELINE_KMS) < 1e-9);
  // The Solar System's worlds on their sides of it (light in the Earth's, escape speed in km/s): with air...
  for (const [name, light, escape] of [['Venus', 1.91, 10.36], ['the Earth', 1, 11.19], ['Mars', 0.431, 5.03], ['Titan', 0.011, 2.64], ['Pluto', 0.00064, 1.21]] as Array<[string, number, number]>) {
    assert.ok(escape >= escapeNeededKmS(light), `${name} holds air (${escape} against ${escapeNeededKmS(light).toFixed(2)} km/s)`);
  }
  // ...and without.
  for (const [name, light, escape] of [['Mercury', 6.67, 4.25], ['the Moon', 1, 2.38], ['Ceres', 0.13, 0.51]] as Array<[string, number, number]>) {
    assert.ok(escape < escapeNeededKmS(light), `${name} holds none (${escape} against ${escapeNeededKmS(light).toFixed(2)} km/s)`);
  }
  // A planet as given: the Earth holds its air; the size of the Moon does not; nothing to lose where none was given.
  const d = newDefinition('earthlike', 4);
  const earth = airState(d);
  assert.deepEqual([earth.held, earth.kept, earth.none], [true, false, false]);
  assert.ok(Math.abs(earth.escapeKmS - 11.2) < 0.2 && Math.abs(earth.neededKmS - SHORELINE_KMS) < 0.05);
  const small = change(d, (c) => { c.body.radiusKm = 1737; });
  assert.deepEqual([airState(small).held, airState(small).kept], [false, false]);
  assert.equal(withAirAsItIs(small).atmosphere.pressureBar, 0);
  assert.equal(withAirAsItIs(d), d, 'held: as given');
  assert.deepEqual([airState(change(small, (c) => { c.atmosphere.pressureBar = 0; })).held, airState(change(small, (c) => { c.atmosphere.pressureBar = 0; })).none], [true, true]);
  // Kept by hand: the air as given, and said to be kept.
  const kept = change(small, (c) => { c.atmosphere.keep = true; });
  assert.deepEqual([airState(kept).held, airState(kept).kept], [false, true]);
  assert.equal(withAirAsItIs(kept).atmosphere.pressureBar, d.atmosphere.pressureBar);
  // The Earth moved close to its star: its air goes too (inside about a quarter of the Earth's distance).
  assert.equal(airState(change(d, (c) => { c.orbit.semiMajorAu = 0.3; })).held, true);
  assert.equal(airState(change(d, (c) => { c.orbit.semiMajorAu = 0.2; })).held, false);
  // Like Mars: its thin air held.
  assert.equal(airState(newDefinition('inactive', 4)).held, true);
  // The switch is stored with a planet of the second calculation only.
  assert.equal(definitionOf(JSON.parse(JSON.stringify(kept)))!.atmosphere.keep, true);
  const first = definitionFromPreset('earthlike', 4) as unknown as { atmosphere: Record<string, unknown> };
  first.atmosphere.keep = true;
  assert.equal(definitionOf(JSON.parse(JSON.stringify(first)))!.atmosphere.keep, undefined);
});

test('water under too little air: ice where it lasts, gone into vapour where it does not; kept by hand', () => {
  // Ice lasts below 120 K in a vacuum, up to 180 K under a little air.
  assert.equal(iceLastsBelowK(0), 120);
  assert.equal(iceLastsBelowK(WATER_TRIPLE_BAR), 180);
  assert.equal(iceLastsBelowK(1), 180);
  assert.equal(iceLastsBelowK(WATER_TRIPLE_BAR / 2), 150);
  // The equator's ice at the giant planets' moons lasts (Jupiter: 50 W/m²); in the asteroid belt (Ceres, 177 W/m²)
  // and at the Earth's distance it does not.
  assert.ok(iceAtEquatorK(50) < 120 && iceAtEquatorK(177) > 120 && iceAtEquatorK(1361) > 200, `${iceAtEquatorK(50)}, ${iceAtEquatorK(177)}, ${iceAtEquatorK(1361)}`);
  const d = newDefinition('earthlike', 4);
  // No air at the Earth's distance: gone into vapour. Far out: frozen where it stands. A thousandth of a bar: gone.
  const bare = waterState(change(d, (c) => { c.atmosphere.pressureBar = 0; }), 0.71);
  assert.deepEqual([bare.fate, bare.cause, bare.kept], ['sublimed', 'thin-air', false]);
  assert.ok(bare.iceK > bare.iceLastsK && bare.iceLastsK === 120);
  const far = waterState(change(d, (c) => { c.atmosphere.pressureBar = 0; c.orbit.semiMajorAu = 5.2; }), 0.71);
  assert.deepEqual([far.fate, far.cause], ['frozen', 'thin-air']);
  assert.ok(far.iceK < far.iceLastsK);
  assert.equal(waterState(change(d, (c) => { c.atmosphere.pressureBar = 0.001; }), 0.71).fate, 'sublimed');
  // Just enough air for liquid water: seas (frozen or not is the climate's to say).
  assert.equal(waterState(change(d, (c) => { c.atmosphere.pressureBar = 0.0063; }), 0.71).fate, 'liquid');
  // Kept by hand: seas, said to be kept, and why there would be none.
  const kept = waterState(change(d, (c) => { c.atmosphere.pressureBar = 0; c.water.keep = true; }), 0.71);
  assert.deepEqual([kept.fate, kept.kept, kept.cause], ['liquid', true, 'thin-air']);
  // No water given: none, whatever the air.
  assert.equal(waterState(change(d, (c) => { c.atmosphere.pressureBar = 0; c.water.depthKm = 0; }), 0).fate, 'none');
});

test('planets with thin air or none: a planet too small for its air; seas gone into vapour with ice caps; seas frozen where they stand; like Mars', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  const earth = await planet(p, d);
  assert.deepEqual([earth.sea.air, earth.sea.pressureBar], ['held', d.atmosphere.pressureBar]);
  // The same history whatever the air (a setting the land is not made from).
  const airless = change(d, (c) => { c.atmosphere.pressureBar = 0; });
  assert.equal(p.keyOf('tectonics', airless, P), p.keyOf('tectonics', d, P));
  // No air at the Earth's distance: the seas gone into vapour, the planet dry rock, no rain; nowhere cold enough
  // through the year to hold ice.
  const bare = await planet(p, airless);
  assert.deepEqual([bare.sea.air, bare.sea.fate, bare.sea.dry, bare.sea.share], ['none', 'sublimed', true, 0]);
  assert.equal(bare.sea.liquidShare, earth.sea.share);
  assert.equal(bare.T.capShare, 0);
  assert.ok(bare.of('barren') > 0.999, `${bare.of('barren')}`);
  const rain = bare.C.precipMonthly as Float32Array;
  assert.ok(rain.every((v) => v === 0), 'no rain');
  // Farther out with no air (3.6 AU): still too warm at the equator for ice to last, but not at the poles: ice caps
  // where the year is colder than ice needs, on the land's high ground and its old sea floors alike.
  const capped = await planet(p, change(airless, (c) => { c.orbit.semiMajorAu = 3.6; }));
  assert.equal(capped.sea.fate, 'sublimed');
  const caps = capped.T.caps as Uint8Array, share = capped.T.capShare as number, monthly = capped.C.monthly as Float32Array;
  assert.ok(share > 0.02 && share < 0.6, `ice caps over ${share} of the surface`);
  assert.ok(Math.abs(capped.of('ice') - share) < 1e-9 && Math.abs(capped.of('barren') - (1 - share)) < 1e-9);
  let lowLat = 0;
  for (let c = 0; c < n; c++) {
    let t = 0;
    for (let m = 0; m < 12; m++) t += monthly[m * n + c] / 12;
    assert.equal(caps[c] === 1, t < 120 - 273.15, `a cap where the year is colder than ice needs (${t} °C)`);
    assert.equal(capped.biome[c] === id('ice'), caps[c] === 1);
    if (caps[c] && Math.abs(mesh.lat[c]) < 0.6) lowLat++;
  }
  assert.equal(lowLat, 0, 'none near the equator');
  // Far out with no air (5.2 AU): the seas frozen where they stand (still at their level, still sea), the land bare
  // rock with no snow on it.
  const icy = await planet(p, change(airless, (c) => { c.orbit.semiMajorAu = 5.2; }));
  assert.deepEqual([icy.sea.fate, icy.sea.dry, icy.sea.share], ['frozen', false, earth.sea.share]);
  assert.deepEqual([...(icy.sea.heights as Int16Array)], [...(earth.sea.heights as Int16Array)]);
  assert.equal(icy.T.seaFrozen, 1);
  assert.equal(icy.of('sea'), 0);
  assert.ok(Math.abs(icy.of('seaIce') - (earth.sea.share as number)) < 0.02 && Math.abs(icy.of('barren') - (1 - (earth.sea.share as number))) < 0.02, `${icy.of('seaIce')} sea ice, ${icy.of('barren')} bare rock`);
  assert.ok((icy.T.surfaceC as number) < -150 && (icy.T.surfaceC as number) > -200, `${icy.T.surfaceC} °C`);
  const t = icy.C.monthly as Float32Array;
  assert.ok(t.every((v) => Number.isFinite(v) && v > -260), 'every temperature a temperature');
  // A planet too small for its air (the Moon's size, the Earth's air and water): the air lost, then the water.
  const moon = await planet(p, change(d, (c) => { c.body.radiusKm = 1737; }));
  assert.deepEqual([moon.sea.air, moon.sea.pressureBar, moon.sea.fate], ['lost', 0, 'sublimed']);
  assert.ok((moon.sea.escapeKmS as number) < (moon.sea.neededKmS as number));
  assert.ok(moon.of('barren') > 0.999);
  // Its air kept by hand: seas again.
  const keptAir = await planet(p, change(d, (c) => { c.body.radiusKm = 1737; c.atmosphere.keep = true; }));
  assert.deepEqual([keptAir.sea.air, keptAir.sea.pressureBar, keptAir.sea.fate], ['kept', d.atmosphere.pressureBar, 'liquid']);
  // Like Mars (its air held, no water given): bare rock, near Mars's −63 °C. With a little water and less than
  // water's triple point of air: ice caps at its poles and nowhere else.
  const mars = await planet(p, newDefinition('inactive', 4));
  assert.deepEqual([mars.sea.air, mars.sea.fate], ['held', 'none']);
  assert.ok((mars.T.surfaceC as number) > -80 && (mars.T.surfaceC as number) < -45, `${mars.T.surfaceC} °C`);
  const wet = await planet(p, change(newDefinition('inactive', 4), (c) => { c.water.depthKm = 0.05; c.atmosphere.pressureBar = 0.005; }));
  assert.equal(wet.sea.fate, 'sublimed');
  assert.ok((wet.T.capShare as number) > 0.002 && (wet.T.capShare as number) < 0.2, `caps over ${wet.T.capShare}`);
  const wetCaps = wet.T.caps as Uint8Array;
  for (let c = 0; c < n; c++) if (wetCaps[c]) assert.ok(Math.abs(mesh.lat[c]) > 1, `a cap at ${(mesh.lat[c] * 180) / Math.PI}°`);
});

test('a frozen planet with air: its seas\' currents carry no heat under the ice; its land under ice only where snow falls', async () => {
  const p = new Pipeline(new LocalExecutor()), d = newDefinition('earthlike', 4);
  // Far out with the Earth's air (10 AU): every temperature a temperature (the currents' heat, carried as on the
  // Earth whatever the ice, was more than the planet takes in), the seas under ice, the land bare (nothing falls).
  const far = await planet(p, change(d, (c) => { c.orbit.semiMajorAu = 10; }));
  const t = far.C.monthly as Float32Array;
  assert.ok(t.every((v) => Number.isFinite(v) && v > -260 && v < -150), 'cold, and no colder than can be');
  assert.equal(far.sea.fate, 'liquid');
  assert.equal(far.T.seaFrozen, 1);
  assert.ok(far.of('barren') > 0.2 && far.of('ice') < 0.02, `${far.of('barren')} bare, ${far.of('ice')} under ice`);
  // Nearer (1.25 AU): some snow still falls; most of the land is under ice.
  const near = await planet(p, change(d, (c) => { c.orbit.semiMajorAu = 1.25; }));
  assert.ok(near.of('ice') > 0.15 && near.of('barren') < 0.08, `${near.of('ice')} under ice, ${near.of('barren')} bare`);
  // An Earth is as it was: its currents carry what they did.
  const earth = await planet(p, d);
  assert.ok((earth.T.surfaceC as number) > 12 && (earth.T.surfaceC as number) < 18, `${earth.T.surfaceC} °C`);
});
