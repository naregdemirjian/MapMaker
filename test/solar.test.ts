// The solar system map (Stage 11, D113): the planets where they are on a date, their orbits, the scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, MOONS, bodyAt, moonAt, orbitAt, centuriesSinceJ2000, scalePoint, solarCatalogue, solarOrbits, orbitalYears } from '../src/space/solar.ts';
import { gregorian } from '../src/core-time/index.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { spaceSettingsOf } from '../src/world-model/world-settings.ts';
import { DEFAULT_SKY } from '../src/space/sky-look.ts';

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
  assert.deepEqual(spaceSettingsOf(world.get('map_space', sp)), { catalogue: 'solar', radiusLy: 50, scale: 'compressed', look: DEFAULT_SKY });
  const r = cmd.setSolarScale(world, sp, 'true');
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.scale, 'true');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(spaceSettingsOf(world.get('map_space', sp))!.scale, 'compressed', 'undone');
  const stars = cmd.createSpaceMap(world, 'Stars').result;
  assert.throws(() => cmd.setSolarScale(world, stars, 'true'), /Only the solar system/);
  const mars = cmd.createEntity(world, { type_id: 'polity', name: 'Martian Congressional Republic' }).result;
  cmd.holdStars(world, { spaceId: sp, stars: [4, 5], entity: mars, mode: { kind: 'change', t: gregorian.fromCivil({ year: 2200 }) } });
  assert.equal(engine.systemsAt(sp, gregorian.fromCivil({ year: 2201 })).get(4), mars, 'Mars held');
});
