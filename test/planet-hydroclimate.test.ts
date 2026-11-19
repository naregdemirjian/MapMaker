// Winds, rain and the sea's currents (Stage 14.7, D158): on the real Earth's land, sea and heights, the deserts
// are dry and the rainforests wet, the monsoon comes in summer, mountains cast rain shadows, the subtropics are
// drier than the equator, cold currents run along the western coasts of continents and warm ones along the
// eastern; and on simple planets a ridge across the westerlies is wet on its windward side and dry in its lee,
// trade winds blow towards the equator, a tidally locked planet rains under its star.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decodeTerrain } from '../src/terrain/grid.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { sampleGrid } from '../src/planet/mesh/transfer.ts';
import { definitionFromPreset, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { seasonalClimate } from '../src/planet/climate/ebm.ts';
import { hydroclimate, beltWind } from '../src/planet/climate/hydroclimate.ts';

const mesh = meshAt(5);
const earthHeights = sampleGrid(mesh, (await decodeTerrain(new Uint8Array(readFileSync(new URL('../data/terrain/earth-4096.bin', import.meta.url))), (b) => new Uint8Array(inflateSync(b)))).data, 4096, 2048, 1);
const nearest = (lon: number, lat: number) => {
  const p = [Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180), Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)];
  let best = 0, bd = -2;
  for (let c = 0; c < mesh.n; c++) { const d = p[0] * mesh.xyz[3 * c] + p[1] * mesh.xyz[3 * c + 1] + p[2] * mesh.xyz[3 * c + 2]; if (d > bd) { bd = d; best = c; } }
  return best;
};
const run = (def: PlanetDefinition, heights: ArrayLike<number>) => {
  const x = derive(def), cl = seasonalClimate(mesh, def, x, heights);
  return hydroclimate(mesh, def, x, heights, cl.monthly, 4, cl.dryWarm);
};

test('the Earth: deserts dry, rainforests wet, the monsoon in summer, rain shadows, dry subtropics, cold and warm currents', () => {
  const t0 = performance.now();
  const r = run(definitionFromPreset('earthlike'), earthHeights);
  const ms = performance.now() - t0;
  const P = (lon: number, lat: number) => r.precipAnnual[nearest(lon, lat)];
  assert.ok(r.meanPrecip > 700 && r.meanPrecip < 1500, `the planet's mean ${r.meanPrecip.toFixed(0)} mm a year`);
  for (const [name, lon, lat] of [['the Sahara', 10, 23], ['the Atacama', -70, -23], ['inland Australia', 133, -24], ['the Taklamakan', 83, 39]] as const) {
    assert.ok(P(lon, lat) < 400, `${name} is dry (${P(lon, lat).toFixed(0)} mm)`);
  }
  for (const [name, lon, lat] of [['the Amazon', -62, -3], ['Borneo', 114, 1], ['the Bay of Bengal', 90, 15]] as const) {
    assert.ok(P(lon, lat) > 1200, `${name} is wet (${P(lon, lat).toFixed(0)} mm)`);
  }
  // The monsoon: India's rain comes in summer.
  const india = nearest(78, 22);
  assert.ok(r.precipMonthly[6 * mesh.n + india] > 10 * Math.max(1, r.precipMonthly[0 * mesh.n + india]), 'India wet in July, dry in January');
  // Rain shadows: the windward side of the Andes and the Cascades wetter than their lee. (The coarse level's cells,
  // about 480 km across, blur a range as narrow as the southern Andes: the measured contrast is several times.)
  assert.ok(P(-73.5, -45) > 1.25 * P(-69, -45), `Chile ${P(-73.5, -45).toFixed(0)} against Patagonia ${P(-69, -45).toFixed(0)} mm`);
  assert.ok(P(-122, 47.5) > 3 * P(-117, 39), `Seattle ${P(-122, 47.5).toFixed(0)} against Nevada ${P(-117, 39).toFixed(0)} mm`);
  // The subtropical highs' moist western flanks and storms' eddies (D159): the eastern sides and interiors of the
  // continents in mid-latitudes are not deserts (the measured rain is two to four times this; see D159).
  for (const [name, lon, lat] of [['Shanghai', 121.5, 31.2], ['Beijing', 116.4, 39.9], ['Buenos Aires', -58.4, -34.6], ['Chicago', -88, 42], ['Moscow', 37.6, 55.7]] as const) {
    assert.ok(P(lon, lat) > 250, `${name} is no desert (${P(lon, lat).toFixed(0)} mm)`);
  }
  assert.ok(P(46.7, 24.7) < 600 && P(-112, 33.4) < 300, `Arabia (${P(46.7, 24.7).toFixed(0)} mm) and Arizona (${P(-112, 33.4).toFixed(0)} mm) stay dry`);
  // The convergence zone wetter than the subtropical highs.
  const band = (a: number, b: number) => {
    let s = 0, w = 0;
    for (let c = 0; c < mesh.n; c++) { const lat = (mesh.lat[c] * 180) / Math.PI; if (lat >= a && lat < b) { s += r.precipAnnual[c] * mesh.area[c]; w += mesh.area[c]; } }
    return s / w;
  };
  assert.ok(band(-5, 5) > 3 * band(20, 30), 'the equator far wetter than the subtropics');
  // The sea's currents: cooler off Peru and Namibia, warmer off Brazil and Japan.
  assert.ok(r.currents[nearest(-78, -18)] < -0.5 && r.currents[nearest(12, -20)] < -0.3, 'cold currents along the western coasts of continents');
  assert.ok(r.currents[nearest(-38, -20)] > 0.5 && r.currents[nearest(-75, 30)] > 0.5 && r.currents[nearest(142, 30)] > 0.3, 'warm currents along the eastern coasts (Brazil, Florida, Japan)');
  assert.ok(r.currents[nearest(3, 62)] > 0.5, 'the warm drift off Norway');
  assert.ok(ms < 20_000, `${ms.toFixed(0)} ms`);
});

test('simple planets: a ridge across the westerlies, the trade winds, a tidally locked planet', () => {
  // Winds by belt: easterly trades blowing towards the equator, westerlies beyond; reversed on a backwards-turning planet.
  const [tu, tv] = beltWind(15, 0, 35, 3, false);
  assert.ok(tu < 0 && tv < 0, 'north-east trades');
  const [wu] = beltWind(50, 0, 35, 3, false);
  assert.ok(wu > 0, 'westerlies');
  assert.ok(beltWind(50, 0, 35, 3, true)[0] < 0, 'reversed when turning backwards');
  // An ocean planet with one north-south ridge at longitude 0 between 30° and 60° of latitude.
  const ridge = new Float64Array(mesh.n);
  for (let c = 0; c < mesh.n; c++) {
    const lat = (mesh.lat[c] * 180) / Math.PI, lon = (mesh.lon[c] * 180) / Math.PI;
    ridge[c] = lat > 25 && lat < 65 && Math.abs(lon) < 30 ? Math.max(100, 4000 * Math.exp(-((lon / 6) ** 2))) : -3000;
  }
  const def = definitionFromPreset('earthlike');
  const r = run(def, ridge);
  const windward = r.precipAnnual[nearest(-10, 45)], lee = r.precipAnnual[nearest(10, 45)];
  assert.ok(windward > 1.5 * lee, `the westerlies' side wetter (${windward.toFixed(0)} mm) than the lee (${lee.toFixed(0)} mm)`);
  // A tidally locked ocean planet: the rain falls near the point under its star.
  const ocean = new Float64Array(mesh.n).fill(-3000);
  const locked = run(definitionFromPreset('tidally-locked'), ocean);
  assert.ok(locked.precipAnnual[nearest(0, 0)] > 4 * locked.precipAnnual[nearest(180, 0)], 'wet under the star, dry on the night side');
  // A world without water has no rain.
  const dry = run(definitionFromPreset('inactive'), new Float64Array(mesh.n).fill(500));
  assert.equal(Math.max(...dry.precipAnnual), 0);
});
