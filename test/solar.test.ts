// The solar system map (Stage 11, D113): the planets where they are on a date, their orbits, the scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, MOONS, bodyAt, moonAt, orbitAt, centuriesSinceJ2000, scalePoint, solarCatalogue, solarOrbits, orbitalYears } from '../src/space/solar.ts';
import { gregorian } from '../src/core-time/index.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { spaceSettingsOf } from '../src/world-model/world-settings.ts';
import { DEFAULT_SKY, presetLook } from '../src/space/sky-look.ts';

const T = (y: number, m = 1, d = 1) => centuriesSinceJ2000(gregorian.fromCivil({ year: y, month: m, day: d }));
const lon = (p: number[]) => (((Math.atan2(p[1], p[0]) * 180) / Math.PI) + 360) % 360;
const by = (name: string) => BODIES.find((b) => b.name === name)!;

test('the planets where they were: Mars at its closest in August 2003, every planet within its orbit\'s reach', () => {
  // The great opposition of 2003: Earth between the Sun and Mars, 0.3727 au apart on 27 August.
  const t = T(2003, 8, 28), e = bodyAt(by('Earth'), t), m = bodyAt(by('Mars'), t);
  assert.ok(Math.abs(lon(e) - lon(m)) < 1, `in line with the Sun (${lon(e).toFixed(2)}°, ${lon(m).toFixed(2)}°)`);
  const d = Math.hypot(e[0] - m[0], e[1] - m[1], e[2] - m[2]);
  assert.ok(Math.abs(d - 0.3727) < 0.005, `0.373 au apart (${d.toFixed(4)})`);
  // Early January: the Earth at its nearest to the Sun.
  assert.ok(Math.abs(Math.hypot(...bodyAt(by('Earth'), T(2000))) - 0.9833) < 0.002);
  for (const b of BODIES) for (const y of [1800, 1950, 2000, 2050, 2300]) {
    const r = Math.hypot(...bodyAt(b, T(y))), [a, e] = b.el;
    assert.ok(r >= a * (1 - e) * 0.995 && r <= a * (1 + e) * 1.005, `${b.name} in ${y}: ${r.toFixed(3)} au`);
  }
  // A year on, the Earth is back where it was; Jupiter has gone about a twelfth of the way round.
  const e0 = lon(bodyAt(by('Earth'), T(2010))), e1 = lon(bodyAt(by('Earth'), centuriesSinceJ2000({ day: gregorian.fromCivil({ year: 2010 }).day + 365.256, ms: 0 })));
  assert.ok(Math.abs(((e1 - e0 + 540) % 360) - 180) < 0.5, 'a year: once round');
  const j0 = lon(bodyAt(by('Jupiter'), T(2010))), j1 = lon(bodyAt(by('Jupiter'), T(2011)));
  assert.ok(Math.abs(((j1 - j0 + 360) % 360) - 30.3) < 6, `Jupiter about 30° a year (${(((j1 - j0) + 360) % 360).toFixed(1)}°)`);
  assert.ok(Math.abs(orbitalYears(by('Jupiter')) - 11.86) < 0.05 && Math.abs(orbitalYears(by('Earth')) - 1) < 0.001);
  // Pluto well above the plane of the others.
  assert.ok(Math.abs(bodyAt(by('Pluto'), T(2000))[2]) > 3);
});

test('orbits closed and through the planets; distances true or compressed; the catalogue drawn', () => {
  const t = T(2024);
  for (const b of BODIES) {
    const o = orbitAt(b, t, 360);
    assert.ok(Math.hypot(o[0][0] - o[360][0], o[0][1] - o[360][1], o[0][2] - o[360][2]) < 1e-9, `${b.name}'s orbit closed`);
    const p = bodyAt(b, t);
    const nearest = Math.min(...o.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])));
    assert.ok(nearest < b.el[0] * 0.02, `${b.name} on its orbit (${nearest.toFixed(4)} au)`);
  }
  assert.deepEqual(scalePoint([3, 4, 0], 'true'), [3, 4, 0]);
  const c = scalePoint([1, 0, 0], 'compressed');
  assert.ok(Math.abs(c[0] - Math.sqrt(50)) < 1e-9, 'compressed: the square root of the distance, 50 au where it is');
  assert.ok(Math.abs(scalePoint([50, 0, 0], 'compressed')[0] - 50) < 1e-9);
  assert.ok(scalePoint([30, 0, 0], 'compressed')[0] > scalePoint([20, 0, 0], 'compressed')[0], 'order kept');
  const when = gregorian.fromCivil({ year: 2024 });
  const cat = solarCatalogue(when, 'compressed');
  assert.deepEqual(cat.stars.slice(0, 10).map((s) => s.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(cat.byId.get(0)!.name, 'Sun');
  assert.ok(Math.abs(cat.byId.get(3)!.dist - 1) < 0.02, 'distances kept true for the panel');
  assert.ok(cat.stars.every((s) => s.color && s.size));
  assert.equal(solarOrbits(when, 'true').length, 9 + MOONS.length);
});

test('the large moons: round their planets, at their periods; the Moon and Jupiter\'s four where they are', () => {
  assert.equal(new Set(MOONS.map((m) => m.id)).size, MOONS.length);
  assert.ok(MOONS.every((m) => m.id > 9 && BODIES.some((b) => b.id === m.planet)));
  const t0 = gregorian.fromCivil({ year: 2024, month: 3, day: 1 });
  const T0 = centuriesSinceJ2000(t0);
  const cat = solarCatalogue(t0, 'compressed');
  for (const m of MOONS) {
    const s = cat.byId.get(m.id)!, p = cat.byId.get(m.planet)!;
    assert.equal(s.kind, 'moon');
    assert.equal(s.alt, `a moon of ${p.name}`);
    const d = Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z);
    assert.ok(d > 0.3 && d < 1.6, `${m.name} drawn round ${p.name} (${d.toFixed(2)} au as drawn)`);
    // Once round in its period.
    const later = moonAt(m, T0 + m.days / 36525, [p.x, p.y, p.z], 'compressed');
    assert.ok(Math.hypot(later[0] - s.x, later[1] - s.y) < 1e-6, `${m.name} back after ${m.days.toFixed(2)} days`);
  }
  // Inner moons drawn nearer their planet.
  const r = (id: number) => { const s = cat.byId.get(id)!, p = cat.byId.get(5)!; return Math.hypot(s.x - p.x, s.y - p.y); };
  assert.ok(r(51) < r(52) && r(52) < r(53) && r(53) < r(54), 'Io, Europa, Ganymede, Callisto outward');
  // The Moon at J2000: its mean longitude 218.3 degrees from the vernal equinox.
  const moon = moonAt(MOONS[0], 0, [0, 0, 0], 'true');
  assert.ok(Math.abs(((Math.atan2(moon[1], moon[0]) * 180) / Math.PI + 360) % 360 - 218.3165) < 1e-6);
  // Io goes round in 1.769 days.
  assert.ok(Math.abs(MOONS.find((m) => m.name === 'Io')!.days - 1.769) < 0.001);
});

test('a solar system map: made, its scale chosen and undone; planets held like stars', async () => {
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  const engine = new Engine(world);
  cmd.seedProject(world, 'Solar');
  const sp = cmd.createSpaceMap(world, 'The solar system', 'solar').result;
  // (Made true to scale, as photographed and as a poster side by side, D208.)
  assert.deepEqual(spaceSettingsOf(world.get('map_space', sp)), { catalogue: 'solar', radiusLy: 50, scale: 'true', layout: 'orbits', row: { sizes: 'poster', spacing: 'even', moons: 'none', chosen: [], scale: 1, gap: 1 }, look: presetLook('photographic') });
  const r = cmd.setSolarScale(world, sp, 'compressed');
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.scale, 'compressed');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.scale, 'true', 'undone');
  const stars = cmd.createSpaceMap(world, 'Stars').result;
  assert.throws(() => cmd.setSolarScale(world, stars, 'true'), /Only the solar system/);
  const mars = cmd.createEntity(world, { type_id: 'polity', name: 'Martian Congressional Republic' }).result;
  cmd.holdStars(world, { spaceId: sp, stars: [4, 5], entity: mars, mode: { kind: 'change', t: gregorian.fromCivil({ year: 2200 }) } });
  assert.equal(engine.systemsAt(sp, gregorian.fromCivil({ year: 2201 })).get(4), mars, 'Mars held');
});

test('the solar system side by side (D133): the Sun, then the planets in a row at even steps, each one\'s moons below it, inner first; distances true for panels', async () => {
  const { solarRowCatalogue, solarRowLines, ROW_STEP } = await import('../src/space/solar.ts');
  const { spaceScene } = await import('../src/space/scene.ts');
  const t = gregorian.fromCivil({ year: 2187, month: 3, day: 1 });
  const row = solarRowCatalogue(t), real = solarCatalogue(t, 'compressed');
  const sun = row.byId.get(0)!;
  const planets = BODIES.map((b) => row.byId.get(b.id)!);
  planets.forEach((p, i) => {
    assert.equal(p.y, sun.y, `${p.name} in the row`);
    assert.ok(Math.abs(p.x - (sun.x + (i + 1) * ROW_STEP)) < 1e-9, `${p.name} at its step`);
    assert.ok(Math.abs(p.dist - real.byId.get(p.id)!.dist) < 1e-12, `${p.name}'s true distance from the Sun`);
  });
  assert.ok(Math.abs(sun.x + planets[planets.length - 1].x) < 1e-9, 'the row centred on the middle of the map');
  for (const b of BODIES) {
    const moons = MOONS.filter((m) => m.planet === b.id).sort((x, y) => x.days - y.days).map((m) => row.byId.get(m.id)!);
    let above = row.byId.get(b.id)!.y;
    for (const m of moons) {
      assert.equal(m.x, row.byId.get(b.id)!.x, `${m.name} under ${b.name}`);
      assert.ok(m.y < above, `${m.name} below the one before`);
      above = m.y;
      assert.equal(m.around, b.id);
    }
  }
  // The row and a column for each planet with moons; no rings; seen flat.
  const lines = solarRowLines(row);
  assert.equal(lines.length, 1 + new Set(MOONS.map((m) => m.planet)).size);
  const scene = spaceScene({ catalogue: 'solar', radiusLy: 50, layout: 'side-by-side' }, t);
  assert.equal(scene.row, true);
  assert.equal(scene.rings, undefined);
  assert.equal(scene.unit, 'au');
  assert.ok(scene.realmReach! > ROW_STEP / 2 && scene.realmReach! < ROW_STEP, 'neighbours held by one realm merge, by two meet between them');
  // Where they are, as before, when not side by side.
  assert.equal(spaceScene({ catalogue: 'solar', radiusLy: 50, layout: 'orbits' }, t).row, undefined);
});

test('the solar system laid out side by side and back (one step each, undone); refused for other maps; since when each body has been held', async () => {
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const { holdingsAt } = await import('../src/space/realms.ts');
  const Y = (y: number) => gregorian.fromCivil({ year: y });
  const world = new World();
  const engine = new Engine(world);
  cmd.seedProject(world, 'Row');
  const sp = cmd.createSpaceMap(world, 'Solar system', 'solar').result;
  const r = cmd.setSolarLayout(world, sp, 'side-by-side');
  assert.equal(r.label, 'The solar system side by side');
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.layout, 'side-by-side');
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.scale, 'true', 'its scale kept for when it goes back');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.layout, 'orbits');
  const nearby = cmd.createSpaceMap(world, 'Nearby').result;
  assert.throws(() => cmd.setSolarLayout(world, nearby, 'side-by-side'), /Only the solar system/);
  // Mars held by a republic from 2187, then by a league from 2250: since 2187, then since 2250; Earth since 2000.
  const rep = cmd.createEntity(world, { type_id: 'polity', name: 'Martian Republic' }).result, lea = cmd.createEntity(world, { type_id: 'polity', name: 'League' }).result;
  cmd.holdStars(world, { spaceId: sp, stars: [4], entity: rep, mode: { kind: 'change', t: Y(2187) } });
  cmd.holdStars(world, { spaceId: sp, stars: [4], entity: lea, mode: { kind: 'change', t: Y(2250) } });
  cmd.holdStars(world, { spaceId: sp, stars: [3], entity: rep, mode: { kind: 'correct', t: Y(2000) } });
  const at = (y: number) => holdingsAt(world, engine, sp, Y(y));
  assert.equal(at(2200).get(4)?.name, 'Martian Republic');
  assert.equal(gregorian.format(at(2200).get(4)!.since!, 'year'), '2187');
  assert.equal(gregorian.format(at(2260).get(4)!.since!, 'year'), '2250');
  assert.equal(gregorian.format(at(2200).get(3)!.since!, 'year'), '2000');
  // Given again to the same holder: still since it first had it.
  cmd.holdStars(world, { spaceId: sp, stars: [4], entity: lea, mode: { kind: 'change', t: Y(2300) } });
  assert.equal(gregorian.format(at(2310).get(4)!.since!, 'year'), '2250');
});

test('the solar system side by side as chosen (D192): sizes, spacing and moons; every body keeps its id', async () => {
  const { solarRowCatalogue: row, solarRowOf, DEFAULT_SOLAR_ROW } = await import('../src/space/solar.ts');
  const t = gregorian.fromCivil({ year: 2000 });
  const base = row(t), size = (c: ReturnType<typeof row>, id: number) => c.byId.get(id)!.size!, x = (c: ReturnType<typeof row>, id: number) => c.byId.get(id)!.x;
  assert.deepEqual(row(t, DEFAULT_SOLAR_ROW).stars.map((s) => [s.id, s.x, s.size]), base.stars.map((s) => [s.id, s.x, s.size]), 'as chosen by default: as before');
  // True sizes: Jupiter about eleven Earths across.
  const trueSize = row(t, { ...DEFAULT_SOLAR_ROW, sizes: 'true' });
  assert.ok(Math.abs(size(trueSize, 5) / size(trueSize, 3) - 69911 / 6371) < 0.01);
  const equal = row(t, { ...DEFAULT_SOLAR_ROW, sizes: 'equal' });
  assert.equal(size(equal, 1), size(equal, 5), 'all alike');
  // True spacing: Neptune three times as far from the Sun as Saturn; even: one step each.
  const spaced = row(t, { ...DEFAULT_SOLAR_ROW, spacing: 'true' });
  assert.ok(Math.abs((x(spaced, 8) - x(spaced, 0)) / (x(spaced, 6) - x(spaced, 0)) - 30.07 / 9.537) < 0.01);
  assert.ok(Math.abs((x(base, 2) - x(base, 1)) - (x(base, 8) - x(base, 7))) < 1e-9, 'even steps');
  // Moons: none, or the ones chosen, inner first beneath their planet.
  assert.equal(row(t, { ...DEFAULT_SOLAR_ROW, moons: 'none' }).stars.filter((s) => s.kind === 'moon').length, 0);
  const some = row(t, { ...DEFAULT_SOLAR_ROW, moons: 'chosen', chosen: [31, 53, 61] });
  assert.deepEqual(some.stars.filter((s) => s.kind === 'moon').map((s) => s.name).sort(), ['Ganymede', 'Moon', 'Titan']);
  assert.equal(some.byId.get(53)!.y, some.byId.get(31)!.y, 'Ganymede alone under Jupiter: in the first place');
  assert.deepEqual(solarRowOf({ sizes: 'huge', spacing: 'true', moons: 'chosen', chosen: [31, 999, 31] }), { sizes: 'styled', spacing: 'true', moons: 'chosen', chosen: [31], scale: 1, gap: 1 });
});

test('the solar system side by side (D216): larger and further apart by the multiples set; Fit screen for the spacing and for the sizes', async () => {
  const { solarRowCatalogue: row, solarRowOf, fitRowGap, fitRowScale, DEFAULT_SOLAR_ROW, ROW_STEP, BODIES } = await import('../src/space/solar.ts');
  const t = gregorian.fromCivil({ year: 2000 });
  const base = row(t), big = row(t, { scale: 2.5 }), wide = row(t, { gap: 2 });
  for (const st of base.stars) {
    assert.ok(Math.abs(big.byId.get(st.id)!.size! - st.size! * 2.5) < 1e-9, `${st.name} larger`);
    assert.equal(big.byId.get(st.id)!.x, st.x, 'standing where it stood');
  }
  // Twice as far apart, from the Sun.
  const sun = base.byId.get(0)!.x;
  assert.ok(Math.abs((wide.byId.get(8)!.x - sun) - 2 * (base.byId.get(8)!.x - sun)) < 1e-9);
  assert.equal(wide.byId.get(31)!.x, wide.byId.get(3)!.x, 'the Moon under the Earth');
  assert.deepEqual([solarRowOf({ scale: 99, gap: -1 }).scale, solarRowOf({ scale: 99, gap: -1 }).gap], [10, 0.25], 'kept within their range');
  // Fit screen for the spacing: in a 1600 by 900 view seen whole, the row from the Sun's edge to the last planet's fills 92% of its width.
  const W = 1600, H = 900, unit = (Math.min(W, H) * 0.46) / 33, px = (size: number) => size * (W / 1920);
  for (const r of [DEFAULT_SOLAR_ROW, { ...DEFAULT_SOLAR_ROW, sizes: 'true' as const, spacing: 'true' as const }, { ...DEFAULT_SOLAR_ROW, sizes: 'poster' as const }]) {
    const fit = fitRowGap(t, r, W, H), c = row(t, { ...r, gap: fit.gap });
    const inRow = c.stars.filter((st) => !st.around && !st.dwarf).sort((a, b) => a.x - b.x), first = inRow[0], last = inRow[inRow.length - 1];
    const left = (first.x - fit.target[0]) * unit + W / 2 - (first.limb ? 14 : px(first.size!));
    const right = (last.x - fit.target[0]) * unit + W / 2 + px(last.size!) + 10;
    assert.ok(Math.abs(left - W * 0.04) < 1 && Math.abs(right - W * 0.96) < 1, `${r.sizes}: ${left.toFixed(1)} to ${right.toFixed(1)}`);
  }
  // Fit screen for the sizes: as large as can be, no two bodies of the row touching, the spacing as it was.
  const r = { ...DEFAULT_SOLAR_ROW, sizes: 'true' as const, spacing: 'true' as const };
  const k = fitRowScale(t, r, W, H), c = row(t, { ...r, scale: k });
  const inRow = c.stars.filter((st) => !st.around && !st.dwarf).sort((a, b) => a.x - b.x);
  let tightest = Infinity;
  for (let i = 1; i < inRow.length; i++) {
    const room = (inRow[i].x - inRow[i - 1].x) * unit, need = px(inRow[i].size!) + px(inRow[i - 1].size!);
    assert.ok(need < room, `${inRow[i - 1].name} and ${inRow[i].name} apart`);
    tightest = Math.min(tightest, room / need);
  }
  assert.ok(k > 1 || tightest < 1.3, `as large as it can be (×${k.toFixed(2)}, tightest ${tightest.toFixed(2)})`);
  assert.equal(c.byId.get(8)!.x, row(t, r).byId.get(8)!.x, 'the spacing kept');
  assert.ok(ROW_STEP > 0 && BODIES.length === 9);
});
