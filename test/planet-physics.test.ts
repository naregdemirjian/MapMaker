// The planetary engine's definitions and derived physics (Stage 14, D152): presets are valid and complete, stored
// definitions are read back with anything missing or wrong replaced, and the physics gives the Earth, Mars and
// Venus their known values from their settings alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, definitionProblems, definitionOf, PRESETS, type PresetId } from '../src/planet/model/definition.ts';
import {
  derive, rockyMassEarths, orbitalPeriodDays, solarDayHours, starProperties, mainSequenceLuminosity, habitableZoneAu,
  luminosityFactorAt, radiogenicFactorAt, tidalLockYears, spectralClassOf, blackbodyColor,
} from '../src/planet/model/physics.ts';
import { SUN_MASS, EARTH_MASS, SOLAR_CONSTANT } from '../src/planet/model/units.ts';

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);

test('every preset is a complete, valid definition whose explanation is written', () => {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const d = definitionFromPreset(id, 7);
    assert.deepEqual(definitionProblems(d), [], id);
    assert.equal(d.preset, id);
    assert.equal(d.seed, 7);
    assert.ok(PRESETS[id].about.length > 40, id);
    const x = derive(d);
    for (const [k, v] of Object.entries(x)) if (typeof v === 'number' && k !== 'solarDayHours') assert.ok(Number.isFinite(v), `${id}: ${k} = ${v}`);
  }
});

test('the presets are what they say: temperatures, regimes, locking, zones', () => {
  const x = (id: PresetId) => derive(definitionFromPreset(id));
  near(x('earthlike').surfaceK, 288, 2, 'Earth-like mean temperature');
  assert.equal(x('earthlike').regime, 'mobile-lid');
  assert.equal(x('earthlike').zone, 'inside');
  assert.ok(x('frozen').surfaceK < 250, 'frozen is frozen');
  assert.ok(x('desert').surfaceK > x('earthlike').surfaceK, 'the desert world is warmer');
  assert.equal(x('desert').runaway, false, 'with little water the desert world keeps its seas');
  assert.ok(x('young-volcanic').insolation < 0.8 * x('earthlike').insolation, 'a young star is fainter');
  near(x('young-volcanic').surfaceK, 288, 10, 'a thicker greenhouse makes up for the faint young star');
  assert.ok(x('young-volcanic').heatFlowEarth > 3, 'a young planet is hotter inside');
  assert.equal(x('tidally-locked').tidallyLocked, true);
  assert.equal(x('tidally-locked').zone, 'inside');
  assert.ok(x('super-earth').gravityEarth > 1.8, 'a super-Earth pulls harder');
  assert.equal(x('inactive').regime, 'stagnant-lid');
  assert.equal(x('hothouse').zone, 'too-close');
  assert.ok(x('ocean').albedo < x('earthlike').albedo, 'an ocean world is darker');
});

test('Earth, Mars and Venus from their settings', () => {
  const earth = derive(definitionFromPreset('earthlike'));
  near(earth.gravity, 9.8, 0.1, 'Earth gravity');
  near(earth.massEarths, 1, 0.02, 'Earth mass from its radius');
  near(earth.yearDays, 365.25, 0.2, 'Earth year');
  near(earth.solarDayHours, 24, 0.01, 'Earth solar day');
  near(earth.insolation, 1361.3, 0.5, 'Earth insolation');
  near(earth.albedo, 0.3, 0.015, 'Earth albedo');
  near(earth.equilibriumK, 255, 2, 'Earth equilibrium temperature');
  near(earth.hadleyEdgeDeg, 35, 5, 'Hadley cell edge (Held and Hou)');
  assert.equal(earth.cellsPerHemisphere, 3);
  near(earth.air.scaleHeightKm, 8.5, 0.3, 'scale height');
  near(earth.air.dryLapse, 9.8, 0.2, 'dry lapse rate');
  near(earth.densityKgM3, 5510, 120, 'Earth density');
  near(earth.escapeKmS, 11.2, 0.2, 'escape velocity');
  near(earth.heatFlowEarth, 1, 0.05, 'Earth heat flow');

  const mars = derive(definitionFromPreset('inactive'));
  near(mars.gravity, 3.71, 0.15, 'Mars gravity (its mass from its size and core)');
  near(mars.yearDays, 687, 2, 'Mars year');
  near(mars.solarDayHours, 24.66, 0.02, 'Mars solar day');
  near(mars.insolation, 589, 6, 'Mars insolation');
  near(mars.surfaceK, 210, 8, 'Mars mean temperature');

  const venus = derive(definitionFromPreset('hothouse'));
  near(venus.yearDays, 224.7, 0.5, 'Venus year');
  near(venus.solarDayHours / 24, 116.75, 0.5, 'Venus solar day (turning backwards)');
  near(venus.surfaceK, 737, 25, 'Venus surface temperature (calibrated greenhouse)');
  near(venus.albedo, 0.77, 0.01, 'Venus albedo');
});

test('the relations behind them', () => {
  // Kepler: Earth around the Sun.
  near(orbitalPeriodDays(1, SUN_MASS + EARTH_MASS), 365.25, 0.1, 'Kepler');
  // The Moon from its size and small core, Mars from its own.
  near(rockyMassEarths(1737, 0.02), 0.0123, 0.001, 'the Moon');
  near(rockyMassEarths(3390, 0.25), 0.107, 0.006, 'Mars');
  // Bigger planets are denser (squeezed by their own weight).
  assert.ok(rockyMassEarths(12_742, 0.325) > 8 * rockyMassEarths(6371, 0.325) * 1.2);
  // A day of 24 h against the stars is longer from noon to noon on a prograde planet, shorter on a retrograde one.
  assert.ok(solarDayHours(24, 365, 20) > 24 && solarDayHours(24, 365, 160) < 24);
  // The Sun: its luminosity, class, colour; dimmer stars cooler and redder.
  near(mainSequenceLuminosity(1), 1, 1e-9, 'Sun luminosity');
  const sun = starProperties({ massSun: 1 });
  near(sun.teffK, 5772, 1, 'Sun temperature');
  assert.equal(sun.spectralClass[0], 'G');
  near(sun.lifetimeGyr, 10, 0.01, 'Sun lifetime');
  const red = starProperties({ massSun: 0.3 });
  assert.equal(red.spectralClass[0], 'M');
  assert.ok(red.color[2] < red.color[0], 'a red dwarf is red');
  assert.ok(blackbodyColor(10_000)[2] >= blackbodyColor(10_000)[0], 'hot stars are blue-white');
  assert.equal(spectralClassOf(30_000)[0], 'O');
  // A brightness set by hand is kept.
  near(starProperties({ massSun: 1, luminositySun: 2 }).luminositySun, 2, 1e-12, 'override');
  // The faint young Sun: about 70 per cent at the start, brightening to now.
  near(luminosityFactorAt(4.54, 4.54, 10), 0.714, 0.01, 'the Sun at its start');
  assert.ok(luminosityFactorAt(2, 4.54, 10) > luminosityFactorAt(3, 4.54, 10));
  // The habitable zone around the Sun (Kopparapu et al. 2013): about 0.99 to 1.7 AU.
  const hz = habitableZoneAu(1, 5780);
  near(hz.inner, 0.99, 0.02, 'inner edge');
  near(hz.outer, 1.69, 0.03, 'outer edge');
  assert.ok(habitableZoneAu(1, 5780, 0.05).inner < hz.inner, 'a dry planet can be closer in');
  // Radiogenic heat was about four times today's when the Earth formed.
  near(radiogenicFactorAt(4.54), 4.3, 0.6, 'early heat');
  // Tides lock a planet close to a small star quickly, the Earth never.
  assert.ok(tidalLockYears(0.05, 0.3 * SUN_MASS, EARTH_MASS, 6.371e6) < 1e9);
  assert.ok(tidalLockYears(1, SUN_MASS, EARTH_MASS, 6.371e6) > 1e10);
  assert.ok(Math.abs(SOLAR_CONSTANT - 1361) < 1);
});

test('the physics responds as it should to each setting', () => {
  const base = definitionFromPreset('earthlike');
  const with_ = (f: (d: typeof base) => void) => { const d = structuredClone(base); f(d); return derive(d); };
  const T = derive(base).surfaceK;
  assert.ok(with_((d) => { d.atmosphere.co2 *= 4; }).surfaceK > T, 'more carbon dioxide, warmer');
  assert.ok(with_((d) => { d.orbit.semiMajorAu = 1.1; }).surfaceK < T, 'farther, colder');
  assert.ok(with_((d) => { d.atmosphere.clouds = 0.8; }).surfaceK < T, 'more clouds, colder (more light reflected)');
  assert.ok(with_((d) => { d.body.dayHours = 240; }).hadleyEdgeDeg > derive(base).hadleyEdgeDeg, 'slower turning, wider Hadley cells');
  assert.ok(with_((d) => { d.body.radiusKm = 8000; }).gravity > derive(base).gravity, 'bigger, stronger gravity');
  assert.ok(with_((d) => { d.interior.heatProduction = 0.1; }).regime === 'stagnant-lid', 'too little heat, no plates');
  assert.ok(with_((d) => { d.water.oceanFraction = 0; }).regime === 'stagnant-lid', 'no water, no plates (auto)');
  assert.ok(with_((d) => { d.orbit.semiMajorAu = 0.8; }).runaway, 'too close: the oceans boil away');
  const locked = with_((d) => { d.body.tidallyLocked = 'auto'; d.star.stars = [{ massSun: 0.2 }]; d.orbit.semiMajorAu = 0.05; });
  assert.ok(locked.tidallyLocked && locked.notes.some((n) => n.includes('one side always faces it')), 'locked by the tides, and said so');
  const hand = with_((d) => { d.orbit.yearDays = 400; });
  assert.equal(hand.yearDays, 400);
  assert.ok(Math.abs(hand.keplerYearDays - 365.25) < 0.5 && hand.notes.some((n) => n.includes('set by hand')), 'an override says what Kepler would give');
  const old = with_((d) => { d.star.stars = [{ massSun: 2 }]; d.history.ageGyr = 4; d.orbit.semiMajorAu = 4; });
  assert.ok(old.notes.some((n) => n.includes('swelling into a giant')), 'a planet older than its star\'s life is warned about');
});

test('stored definitions are read back, with anything missing or wrong from the preset', () => {
  assert.equal(definitionOf(null), null);
  assert.equal(definitionOf('x'), null);
  const d = definitionOf({ preset: 'desert', name: 'Arrakis', seed: 42, orbit: { semiMajorAu: 0.95, eccentricity: 'oops' }, atmosphere: { co2: 0.01 }, body: { tidallyLocked: 'auto' }, history: { ageGyr: 3, events: [{ kind: 'rift', startMa: 100, durationMyr: 20 }] } })!;
  assert.equal(d.name, 'Arrakis');
  assert.equal(d.seed, 42);
  assert.equal(d.preset, 'desert');
  assert.equal(d.orbit.semiMajorAu, 0.95);
  assert.equal(d.orbit.eccentricity, definitionFromPreset('desert').orbit.eccentricity, 'unreadable: the preset\'s');
  assert.equal(d.atmosphere.co2, 0.01);
  assert.equal(d.water.oceanFraction, definitionFromPreset('desert').water.oceanFraction);
  assert.equal(d.body.tidallyLocked, 'auto');
  assert.equal(d.history.ageGyr, 3);
  assert.equal(d.history.events[0].kind, 'rift');
  assert.equal(d.history.events[0].strength, 1);
  assert.deepEqual(definitionProblems(d), []);
  const bad = definitionFromPreset('earthlike');
  bad.orbit.eccentricity = 0.95;
  bad.atmosphere.co2 = 0.9; bad.atmosphere.o2 = 0.2;
  bad.tectonics.plates = 3.5;
  bad.history.events.push({ id: 'x', kind: 'impact', startMa: 9000, durationMyr: 1, strength: 1 });
  const problems = definitionProblems(bad);
  assert.equal(problems.length, 4, problems.join(' | '));
});
