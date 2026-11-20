// Ice and the sea's level through time (Stage 14.8, D159): degree-day melt and snowfall; the shallow-ice flow of a
// steady dome against Vialov's analytical profile; ice conserved while it only grows; on the real Earth, snow
// outlasting the summer on Greenland and East Antarctica but not on Siberia, Canada or Scandinavia's lowlands; and in
// a history the sea's level from the ocean's conserved water, falling while an ice age holds water on land.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decodeTerrain } from '../src/terrain/grid.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { sampleGrid } from '../src/planet/mesh/transfer.ts';
import { iceSheets, massBalance, positiveDegreeDays, ICE } from '../src/planet/water/ice.ts';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { seasonalClimate } from '../src/planet/climate/ebm.ts';
import { hydroclimate } from '../src/planet/climate/hydroclimate.ts';
import { tectonicParams } from '../src/planet/pipeline/stages.ts';
import { runHistory } from '../src/planet/tectonics/history.ts';

test('degree days and the year\'s balance of snow and ice', () => {
  // A month always at 10 °C: about 300 degree days (a little more: colder days do not count against warmer ones);
  // always at −20 °C: almost none; at 0 °C the spread gives σ/√(2π) a day.
  assert.ok(positiveDegreeDays(10, 30) > 300 && positiveDegreeDays(10, 30) < 302 && positiveDegreeDays(-20, 30) < 0.01 && Math.abs(positiveDegreeDays(0, 30) - (30 * ICE.sigma) / Math.sqrt(2 * Math.PI)) < 0.01);
  const cold = massBalance(new Array(12).fill(-25), new Array(12).fill(25), 30.4), warm = massBalance(new Array(12).fill(15), new Array(12).fill(25), 30.4);
  assert.ok(Math.abs(cold.balance - 0.3) < 1e-3 && cold.runoff === 0, 'a cold year keeps all its snow');
  assert.ok(warm.snow < 0.01 && warm.balance < -10, 'a warm one keeps none and would melt ice fast');
});

test('a steady ice dome follows Vialov\'s profile; ice is conserved while it only grows', () => {
  const mesh = meshAt(4), n = mesh.n, cap = 30;
  const bed = new Float64Array(n).fill(100), temp = new Float64Array(12 * n), precip = new Float64Array(12 * n).fill(25);
  for (let c = 0; c < n; c++) for (let m = 0; m < 12; m++) temp[m * n + c] = 90 - (mesh.lat[c] * 180) / Math.PI < cap ? -25 : 15;
  const r = iceSheets({ mesh, radiusKm: 6371, gravity: 9.81, bed, temp, precip, yearDays: 365.25, lapse: 0, years: 100_000, dt: 500 });
  // Vialov (1958), axisymmetric: H(r)^(8/3) = 2 (a/2Γ)^(1/3) (L^(4/3) − r^(4/3)), Γ = 2A(ρg)³/5.
  const a = (0.3 * ICE.rhoWater) / ICE.rho, G = (2 * ICE.A * (ICE.rho * 9.81) ** 3) / 5, L = ((cap * Math.PI) / 180) * 6371e3;
  const vialov = (x: number) => (x < L ? (2 * (a / (2 * G)) ** (1 / 3) * (L ** (4 / 3) - x ** (4 / 3))) ** (3 / 8) : 0);
  const ring = (colat: number) => { let s = 0, k = 0; for (let c = 0; c < n; c++) if (Math.abs(90 - (mesh.lat[c] * 180) / Math.PI - colat) < 2) { s += r.thickness[c]; k++; } return s / k; };
  for (const colat of [0, 10, 20]) {
    const v = vialov(((colat * Math.PI) / 180) * 6371e3), m = ring(colat);
    assert.ok(Math.abs(m - v) < 0.25 * v, `${colat}° from the pole: ${m.toFixed(0)} m against ${v.toFixed(0)} m`);
  }
  assert.ok(ring(0) > ring(10) && ring(10) > ring(20) && ring(40) < 10, 'a dome, thinning to its margin');
  // Snow everywhere, nothing melting: the ice is exactly the snow gained.
  const all = iceSheets({ mesh, radiusKm: 6371, gravity: 9.81, bed, temp: new Float64Array(12 * n).fill(-30), precip, yearDays: 365.25, lapse: 0, years: 3000, dt: 500 });
  assert.ok(Math.abs(all.volume - all.gained) < 1e-6 * all.gained && all.calved === 0, `held ${all.volume.toExponential(4)} m³ of ${all.gained.toExponential(4)}`);
});

test('the real Earth: snow outlasts the summer on Greenland and East Antarctica, not in Siberia, Canada or Scandinavia', async () => {
  const mesh = meshAt(5), n = mesh.n;
  const t = await decodeTerrain(new Uint8Array(readFileSync(new URL('../data/terrain/earth-4096.bin', import.meta.url))), (b) => new Uint8Array(inflateSync(b)));
  const h = sampleGrid(mesh, t.data, 4096, 2048, 1);
  const def = definitionFromPreset('earthlike'), x = derive(def);
  const cl = seasonalClimate(mesh, def, x, h);
  const hy = hydroclimate(mesh, def, x, h, cl.monthly, 4, cl.dryWarm);
  const nearest = (lon: number, lat: number) => { const p = [Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180), Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)]; let b = 0, bd = -2; for (let c = 0; c < n; c++) { const d = p[0] * mesh.xyz[3 * c] + p[1] * mesh.xyz[3 * c + 1] + p[2] * mesh.xyz[3 * c + 2]; if (d > bd) { bd = d; b = c; } } return b; };
  const mb = (lon: number, lat: number) => { const c = nearest(lon, lat); return massBalance(Array.from({ length: 12 }, (_, m) => hy.tempMonthly[m * n + c]), Array.from({ length: 12 }, (_, m) => hy.precipMonthly[m * n + c]), x.yearDays / 12).balance; };
  for (const [name, lon, lat] of [['Greenland', -40, 72], ['southern Greenland', -45, 63], ['East Antarctica', 90, -80]] as const) assert.ok(mb(lon, lat) > 0, `${name} gains (${(mb(lon, lat) * 1000).toFixed(0)} mm)`);
  for (const [name, lon, lat] of [['Siberia', 100, 65], ['Canada', -100, 60], ['Scandinavia', 15, 65]] as const) assert.ok(mb(lon, lat) < 0, `${name} loses (${(mb(lon, lat) * 1000).toFixed(0)} mm)`);
});

test('a history: the sea\'s level from the ocean\'s water, falling while an ice age holds water on land', () => {
  const def = definitionFromPreset('earthlike', 3);
  const plain = runHistory(tectonicParams(def, 4, 300), { durationMyr: 300, frameEveryMyr: 25 });
  const F = plain.times.length;
  assert.ok(Math.abs(plain.seaLevels[F - 1]) < 1e-6, 'the present at its own level');
  for (let f = 0; f < F; f++) assert.ok(Math.abs(plain.seaLevels[f]) < 700, `${plain.times[f]} Ma: ${plain.seaLevels[f].toFixed(0)} m`);
  // An ice age from 150 to 100 Ma: colder (less carbon dioxide), more ice on land, a lower sea than without it.
  def.history.events = [{ id: 'cold', kind: 'ice-age', startMa: 150, durationMyr: 50, strength: 3 }];
  const cold = runHistory(tectonicParams(def, 4, 300), { durationMyr: 300, frameEveryMyr: 25 });
  const at = (t: number) => Array.from(cold.times).findIndex((x) => Math.abs(x - t) < 1e-6);
  const f = at(125);
  assert.ok(cold.meanTemps[f] < plain.meanTemps[f] - 3, `colder during it (${(cold.meanTemps[f] - 273.15).toFixed(1)} against ${(plain.meanTemps[f] - 273.15).toFixed(1)} °C)`);
  // (About 0.6 million km³ more on this planet's land: since D165 land has its own summers, warmer than the sea
  // beside it, so less snow outlasts them at the coasts than when one temperature served land and sea; 1.5 before.)
  assert.ok(cold.iceVolumes[f] > plain.iceVolumes[f] + 4e5, `more ice (${(cold.iceVolumes[f] / 1e6).toFixed(1)} against ${(plain.iceVolumes[f] / 1e6).toFixed(1)} million km³)`);
});
