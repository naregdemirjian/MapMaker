// The seasonal climate (Stage 14.6, D157): on the real Earth's land and sea, the energy balance gives the Earth's
// mean temperature, warm tropics, cold poles, continental seasons wider than the sea's and the energy in balance;
// and every setting moves it the right way: more carbon dioxide warmer, farther colder, more tilt wider seasons
// at high latitudes, slower turning gentler contrasts, a fainter young star colder, a tidally locked planet's night
// side cold, Venus nearly even and hot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decodeTerrain } from '../src/terrain/grid.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { sampleGrid } from '../src/planet/mesh/transfer.ts';
import { definitionFromPreset, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { seasonalClimate, cloudsByLatitude } from '../src/planet/climate/ebm.ts';

const mesh = meshAt(5);
const earthHeights = sampleGrid(mesh, (await decodeTerrain(new Uint8Array(readFileSync(new URL('../data/terrain/earth-4096.bin', import.meta.url))), (b) => new Uint8Array(inflateSync(b)))).data, 4096, 2048, 1);
const nearest = (lon: number, lat: number) => {
  const p = [Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180), Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)];
  let best = 0, bd = -2;
  for (let c = 0; c < mesh.n; c++) { const d = p[0] * mesh.xyz[3 * c] + p[1] * mesh.xyz[3 * c + 1] + p[2] * mesh.xyz[3 * c + 2]; if (d > bd) { bd = d; best = c; } }
  return best;
};
const climate = (def: PlanetDefinition, heights: ArrayLike<number> = earthHeights, sunFactor = 1) => seasonalClimate(mesh, def, derive(def), heights, { sunFactor });
const range = (r: ReturnType<typeof climate>, c: number) => {
  let lo = Infinity, hi = -Infinity;
  for (let m = 0; m < 12; m++) { const t = r.monthly[m * mesh.n + c]; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  return hi - lo;
};
const zonal = (r: ReturnType<typeof climate>, from: number, to: number) => {
  let s = 0, a = 0;
  for (let c = 0; c < mesh.n; c++) { const lat = (mesh.lat[c] * 180) / Math.PI; if (lat >= from && lat < to) { s += r.annual[c] * mesh.area[c]; a += mesh.area[c]; } }
  return s / a;
};

test('the Earth: its mean temperature, warm tropics, cold poles, wide continental seasons, the energy in balance', () => {
  const t0 = performance.now();
  const r = climate(definitionFromPreset('earthlike'));
  const ms = performance.now() - t0;
  assert.ok(Math.abs(r.meanK - 288) < 2, `mean ${r.meanK.toFixed(2)} K`);
  assert.ok(Math.abs(r.absorbed - r.emitted) < 1.5, `in balance (${r.absorbed.toFixed(1)} absorbed, ${r.emitted.toFixed(1)} given off)`);
  assert.ok(r.tropicsC > 25 && r.tropicsC < 31, `tropics ${r.tropicsC.toFixed(1)} °C`);
  assert.ok(zonal(r, 70, 90) < -8 && zonal(r, 70, 90) > -30, `the Arctic ${zonal(r, 70, 90).toFixed(1)} °C`);
  assert.ok(zonal(r, -90, -70) < zonal(r, 70, 90) - 5, 'Antarctica (high and icy) colder than the Arctic');
  // The year's swing: wide in Siberia, narrow at the equator and over the open ocean.
  const yakutsk = nearest(129.7, 62), singapore = nearest(103.8, 1.3), pacific = nearest(-150, 30);
  assert.ok(range(r, yakutsk) > 25, `Siberia's seasons ${range(r, yakutsk).toFixed(1)} K`);
  assert.ok(range(r, singapore) < 3 && range(r, pacific) < range(r, yakutsk) / 2, 'the tropics and the sea barely change');
  // January cold in the north, July cold in the south.
  assert.ok(r.monthly[0 * mesh.n + yakutsk] < r.monthly[6 * mesh.n + yakutsk] - 20);
  const southern = nearest(140, -70);
  assert.ok(r.monthly[6 * mesh.n + southern] < r.monthly[0 * mesh.n + southern]);
  // Mountains are colder: the Tibetan plateau colder than the plains at its latitude.
  assert.ok(r.annual[nearest(88, 32)] < r.annual[nearest(80, 28)] - 10, 'colder on the high plateau');
  // Ice where it is cold.
  assert.ok(r.ice[nearest(0, -85)] > 0.75 && r.ice[singapore] === 0, `ice at the South Pole (${r.ice[nearest(0, -85)].toFixed(2)} of the year), none at the equator`);
  assert.ok(ms < 15_000, `${ms.toFixed(0)} ms`);
});

test('each setting moves the climate the right way', () => {
  const base = definitionFromPreset('earthlike');
  const earth = climate(base);
  const vary = (f: (d: PlanetDefinition) => void, sun = 1) => { const d = structuredClone(base); f(d); return climate(d, earthHeights, sun); };
  const co2 = vary((d) => { d.atmosphere.co2 *= 4; });
  assert.ok(co2.meanK > earth.meanK + 1.5 && co2.meanK < earth.meanK + 12, `four times the CO2: +${(co2.meanK - earth.meanK).toFixed(1)} K`);
  const far = vary((d) => { d.orbit.semiMajorAu = 1.08; });
  assert.ok(far.meanK < earth.meanK - 5, `8% farther: ${(far.meanK - earth.meanK).toFixed(1)} K`);
  const tilted = vary((d) => { d.body.tiltDeg = 50; });
  const north = nearest(100, 65);
  assert.ok(range(tilted, north) > range(earth, north) + 5, 'more tilt, wider seasons at high latitudes');
  const slow = vary((d) => { d.body.dayHours = 24 * 8; });
  assert.ok(slow.tropicsC - slow.polesC < earth.tropicsC - earth.polesC - 5, `slower turning, gentler contrasts (${(slow.tropicsC - slow.polesC).toFixed(1)} against ${(earth.tropicsC - earth.polesC).toFixed(1)} K)`);
  const young = vary(() => {}, 0.76);
  assert.ok(young.meanK < earth.meanK - 15, `the faint young Sun with today's air: ${young.meanK.toFixed(1)} K`);
  // Clouds by latitude: more at the equator and in the storm belts, fewer over the subtropical highs; the mean kept.
  assert.ok(cloudsByLatitude(0, 35, 0.5) > cloudsByLatitude(30, 35, 0.5) && cloudsByLatitude(55, 35, 0.5) > cloudsByLatitude(30, 35, 0.5));
});

test('other worlds: a tidally locked planet\'s cold night, Venus even and hot, a frozen world', () => {
  const ocean = new Float64Array(mesh.n).fill(-3000);
  const locked = definitionFromPreset('tidally-locked');
  const r = climate(locked, ocean);
  const day = nearest(0, 0), night = nearest(180, 0);
  assert.ok(r.annual[day] > r.annual[night] + 20, `day side ${r.annual[day].toFixed(1)} °C, night side ${r.annual[night].toFixed(1)} °C`);
  assert.ok(range(r, day) < 2, 'no seasons on a locked circular orbit');
  const venus = climate(definitionFromPreset('hothouse'), new Float64Array(mesh.n).fill(100));
  assert.ok(venus.meanK > 650, `Venus ${venus.meanK.toFixed(0)} K`);
  assert.ok(venus.tropicsC - venus.polesC < 15, `nearly even (${(venus.tropicsC - venus.polesC).toFixed(1)} K)`);
  const frozen = climate(definitionFromPreset('frozen'));
  let ice = 0;
  for (let c = 0; c < mesh.n; c++) ice += frozen.ice[c] * mesh.area[c];
  assert.ok(ice / (4 * Math.PI) > 0.5, `mostly icy (${(ice / (4 * Math.PI)).toFixed(2)})`);
});
