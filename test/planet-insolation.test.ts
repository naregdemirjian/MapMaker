// Sunlight on a simulated planet (Stage 14, D152): Earth's against Berger's (1978) values, the seasons and polar
// days, eccentric orbits, tilted and tidally locked planets, and the global mean against the physics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { mean } from '../src/planet/mesh/operators.ts';
import { orbitAt, dailyInsolation, meanInsolation, insolationField, insolationCells, sunlightOf } from '../src/planet/climate/insolation.ts';

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);
const earth = () => { const d = definitionFromPreset('earthlike'); return sunlightOf(d, derive(d)); };

test('Earth: the yearly means at the equator and poles, the solstices, the polar night', () => {
  const s = earth();
  const [eq, np, sp, mid] = meanInsolation(s, [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4], 0, 1, 1460);
  near(eq, 417, 3, 'equator, yearly mean');
  near(np, 173, 3, 'north pole, yearly mean');
  near(sp, np, 0.5, 'the poles get the same over a year');
  near(mid, 307, 4, '45°, yearly mean');
  // The north pole at the June solstice (about 525 W/m² with the Earth near aphelion), dark in December.
  near(dailyInsolation(s.S, Math.PI / 2, Math.PI / 2, orbitAt(0.47, s.eccentricity, s.perihelionDeg).r, s.tilt), 524, 6, 'north pole at the June solstice');
  assert.equal(dailyInsolation(s.S, Math.PI / 2, (3 * Math.PI) / 2, 1, s.tilt), 0, 'polar night');
  assert.equal(dailyInsolation(s.S, (80 * Math.PI) / 180, (3 * Math.PI) / 2, 1, s.tilt), 0, 'polar night at 80°');
  // At the equinox the equator gets S/π.
  near(dailyInsolation(1361, 0, 0, 1, s.tilt), 1361 / Math.PI, 1e-9, 'equinox at the equator');
  // The year starts in northern winter: January is dark in the north, July bright.
  const lat60 = [Math.PI / 3];
  assert.ok(meanInsolation(s, lat60, 0, 1 / 12)[0] < meanInsolation(s, lat60, 6 / 12, 7 / 12)[0] / 4);
});

test('the orbit: Kepler\'s equation, perihelion and the solar longitude', () => {
  // The Earth is nearest the Sun in early January.
  let best = 0, bestR = 2;
  for (let k = 0; k < 365; k++) { const o = orbitAt(k / 365, 0.0167, 283); if (o.r < bestR) { bestR = o.r; best = k; } }
  assert.ok(best >= 1 && best <= 6, `perihelion on day ${best}`);
  near(bestR, 1 - 0.0167, 1e-4, 'perihelion distance');
  // The northern spring equinox about 79 days into the year.
  let eq = 0;
  for (let k = 0; k < 3650; k++) { const o = orbitAt(k / 3650, 0.0167, 283); if (o.lambda < 0.01 || o.lambda > 2 * Math.PI - 0.01) { eq = k / 10; break; } }
  near(eq, 79, 2.5, 'March equinox day');
  // A very eccentric orbit: light swings with 1/r².
  // (The mean anomaly is 2πt + 280° − ϖ: with ϖ = 0, perihelion at t = −280/360 and aphelion half a year on.)
  const far = orbitAt((180 - 280) / 360, 0.5, 0), close = orbitAt(-280 / 360, 0.5, 0);
  near(far.r, 1.5, 0.01, 'aphelion');
  near(close.r, 0.5, 0.01, 'perihelion');
});

test('fields on the mesh: global means from the physics, tilt and locking', () => {
  const m = meshAt(5);
  for (const id of ['earthlike', 'inactive', 'hothouse', 'tidally-locked', 'frozen'] as const) {
    const d = definitionFromPreset(id), x = derive(d);
    const f = insolationField(m, sunlightOf(d, x));
    near(mean(m, f.annual), x.insolation / 4, x.insolation * 0.002, `${id}: global mean is a quarter of the light`);
    // The monthly means average to the yearly one.
    for (let c = 0; c < m.n; c += 501) {
      let s = 0;
      for (let k = 0; k < 12; k++) s += f.monthly[k * m.n + c];
      near(s / 12, f.annual[c], 1e-3, 'months');
    }
  }
  // A tidally locked planet: everything on the day side, nothing at night.
  const d = definitionFromPreset('tidally-locked'), x = derive(d);
  const f = insolationField(m, sunlightOf(d, x));
  let night = 0, sub = 0;
  for (let c = 0; c < m.n; c++) {
    if (m.xyz[3 * c] < -0.01) night = Math.max(night, f.annual[c]);
    sub = Math.max(sub, f.annual[c]);
  }
  assert.equal(night, 0, 'the night side is dark');
  near(sub, x.insolation, x.insolation * 0.01, 'the star overhead');
  // More tilt: the poles get more over the year, the equator less.
  const flat = earth(), steep = { ...earth(), tilt: (60 * Math.PI) / 180 };
  const a = meanInsolation(flat, [0, Math.PI / 2]), b = meanInsolation(steep, [0, Math.PI / 2]);
  assert.ok(b[1] > a[1] && b[0] < a[0]);
  // At 90° of tilt the poles get more than the equator over a year.
  const side = meanInsolation({ ...earth(), tilt: Math.PI / 2 }, [0, Math.PI / 2]);
  assert.ok(side[1] > side[0]);
  // Ranges of cells are the same as the whole.
  const s = sunlightOf(definitionFromPreset('earthlike'), derive(definitionFromPreset('earthlike')));
  const all = insolationField(m, s), part = insolationCells(m, s, 1000, 1500);
  for (let i = 0; i < 500; i++) assert.equal(part.annual[i], all.annual[1000 + i]);
  for (let k = 0; k < 12; k++) assert.equal(part.monthly[k * 500 + 7], all.monthly[k * m.n + 1007]);
});
