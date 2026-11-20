// Water on the land (Stage 14.8, D159): the hierarchy of depressions, Fill-Spill-Merge conserving water exactly
// (a hollow filling, spilling into its neighbour, the two merging, the rest reaching the sea), lakes at the steady
// state of a climate (closed where evaporation takes all that flows in, open where it spills), every drop draining
// to the sea, a closed lake or a dry basin without ever running uphill, sea level from the ocean's volume (raising
// it floods monotonically), and on the real Earth a water budget that closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decodeTerrain } from '../src/terrain/grid.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { sampleGrid } from '../src/planet/mesh/transfer.ts';
import { depressions, fillVolume, steadyLakes, hydrology, budyko, oceanMask, straits, notchOutlets, WATER } from '../src/planet/water/hydrology.ts';
import { seaLevelForVolume, oceanVolume } from '../src/planet/water/sealevel.ts';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { seasonalClimate } from '../src/planet/climate/ebm.ts';
import { hydroclimate } from '../src/planet/climate/hydroclimate.ts';
import { insolationCells, sunlightOf } from '../src/planet/climate/insolation.ts';

const mesh = meshAt(4), n = mesh.n, R = 6371e3;
const area = Float64Array.from(mesh.area, (a) => a * R * R);
const deg = (r: number) => (r * 180) / Math.PI;
const angle = (c: number, lon: number, lat: number) => {
  const p = [Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180), Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)];
  return deg(Math.acos(Math.max(-1, Math.min(1, p[0] * mesh.xyz[3 * c] + p[1] * mesh.xyz[3 * c + 1] + p[2] * mesh.xyz[3 * c + 2]))));
};
const nearest = (lon: number, lat: number) => { let b = 0, bd = Infinity; for (let c = 0; c < n; c++) { const d = angle(c, lon, lat); if (d < bd) { bd = d; b = c; } } return b; };
/** A plateau 1,000 m high holding two hollows 700 m deep side by side; sea to the south; lowland elsewhere. */
function plateau(): Float64Array {
  const z = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const lat = deg(mesh.lat[c]), lon = deg(mesh.lon[c]);
    if (lat < -20) { z[c] = -3000; continue; }
    z[c] = lat > 10 && lat < 50 && Math.abs(lon) < 40 ? 1000 - 700 * Math.exp(-((angle(c, -15, 30) / 9) ** 2)) - 700 * Math.exp(-((angle(c, 15, 30) / 9) ** 2)) : 100 + (lat + 20);
  }
  return z;
}
const lakeVolume = (r: { surface: Float64Array }, z: ArrayLike<number>) => { let v = 0; for (let c = 0; c < n; c++) if (!Number.isNaN(r.surface[c])) v += (r.surface[c] - z[c]) * area[c]; return v; };

test('Fill-Spill-Merge: a hollow fills, spills into its neighbour, the two merge, the rest reaches the sea, conserving water', () => {
  const z = plateau(), ocean = oceanMask(mesh, z), dh = depressions(mesh, z, ocean);
  const A = nearest(-15, 30), B = nearest(15, 30);
  assert.ok(dh.label[A] > 0 && dh.label[B] > 0 && dh.label[A] !== dh.label[B], 'each hollow is a depression of its own');
  // They merge into one at the saddle between them, which spills towards the sea at the plateau's edge.
  const a0 = dh.label[A], b0 = dh.label[B];
  const ancestors = (d: number) => { const out: number[] = []; for (; d >= 0; d = dh.parent[d]) out.push(d); return out; };
  const common = ancestors(a0).find((d) => ancestors(b0).includes(d))!;
  assert.ok(common !== undefined && dh.kidA[common] >= 0, 'a merged depression holds both');
  // Each hollow as a whole: the child of the merged depression on its side.
  const a = ancestors(a0).find((d) => dh.parent[d] === common)!, b = ancestors(b0).find((d) => dh.parent[d] === common)!;
  assert.ok(Math.abs(dh.outlet[a] - dh.outlet[b]) < 1e-9 && dh.outlet[a] > 700 && dh.outlet[a] < dh.outlet[common] && dh.outlet[common] < 1001, `the saddle (${dh.outlet[a].toFixed(0)} m) below the plateau's edge (${dh.outlet[common].toFixed(0)} m)`);
  // What each holds up to its outlet.
  const capacity = (d: number) => {
    let v = 0;
    for (let k = dh.cellStart[dh.leafLo[d]]; k < dh.cellStart[dh.leafHi[d]]; k++) { const c = dh.cells[k]; if (dh.level[c] < dh.outlet[d]) v += (dh.outlet[d] - z[c]) * area[c]; }
    return v;
  };
  const capA = capacity(a), capB = capacity(b), capM = capacity(common);
  // Pour water into hollow A only, in growing amounts.
  const pour = (v: number) => { const w = new Float64Array(n); w[A] = v; return fillVolume(dh, z, area, w); };
  const small = pour(0.5 * capA);
  assert.ok(Math.abs(lakeVolume(small, z) - 0.5 * capA) < capA * 1e-9 && small.toSea === 0, 'half its capacity stays in hollow A, all of it');
  assert.ok(Number.isNaN(small.surface[B]) && small.surface[A] < dh.outlet[a], 'hollow B dry, A below the saddle');
  // More than A holds: A stands at the saddle, the rest spills into B.
  const middle = pour(capA + 0.5 * capB);
  assert.ok(Math.abs(lakeVolume(middle, z) - (capA + 0.5 * capB)) < capA * 1e-9, 'all of it held');
  assert.ok(Math.abs(middle.surface[A] - dh.outlet[a]) < 1e-6 && middle.surface[B] < dh.outlet[b], `A at the saddle (${middle.surface[A].toFixed(1)} m), B below it (${middle.surface[B].toFixed(1)} m)`);
  // More than both: one lake above the saddle; more than the plateau holds and the rest reaches the sea.
  const merged = pour(0.5 * (capA + capB + capM));
  assert.ok(merged.surface[A] === merged.surface[B] && merged.surface[A] > dh.outlet[a] && merged.toSea === 0, 'one lake over both, below the edge');
  const flood = pour(2 * capM);
  assert.ok(flood.toSea > 0 && lakeVolume(flood, z) >= capM * (1 - 1e-9) && Math.abs(lakeVolume(flood, z) + flood.toSea - 2 * capM) < capM * 1e-9, `the rest reaches the sea (${(flood.toSea / 1e9).toFixed(0)} km³), nothing lost`);
});

test('steady lakes: closed where evaporation takes all that flows in, open where they spill; the budget closes', () => {
  const z = plateau(), ocean = oceanMask(mesh, z), dh = depressions(mesh, z, ocean);
  const A = nearest(-15, 30);
  const supply = new Float64Array(n), take = new Float64Array(n);
  for (let c = 0; c < n; c++) if (!ocean[c]) { supply[c] = 0.05 * area[c]; take[c] = 1.2 * area[c]; }
  // A dry climate: a closed lake in each hollow, taking (evaporating) what flows into it.
  const dry = steadyLakes(dh, z, area, supply, take);
  assert.ok(!Number.isNaN(dry.surface[A]) && !dry.full[dry.lakeOf[A]], 'a closed lake');
  let t = 0, s = 0;
  for (let c = 0; c < n; c++) { if (dry.lakeOf[c] === dry.lakeOf[A]) t += take[c]; if (dh.label[c] === dh.label[A]) s += supply[c]; }
  assert.ok(Math.abs(t - s) <= Math.max(...Array.from(take)), `its evaporation (${(t / 1e9).toFixed(1)} km³) balances what flows in (${(s / 1e9).toFixed(1)} km³), within a cell`);
  let all = 0; for (let c = 0; c < n; c++) all += supply[c];
  assert.ok(Math.abs(dry.toSea + dry.held - all) < all * 1e-9, 'every drop reaches the sea or a lake that evaporates it');
  // A wet climate: the lakes fill, spill and all the water reaches the sea.
  const wet = steadyLakes(dh, z, area, supply, new Float64Array(n));
  assert.ok(wet.full[wet.lakeOf[A]] && Math.abs(wet.toSea - all) < all * 1e-9, 'open lakes; all reaches the sea');
  // Budyko: little runs off in a dry climate, most in a wet one.
  assert.ok(budyko(300, 1500) > 0.95 * 300 && budyko(2000, 500) < 0.27 * 2000 && budyko(1000, 1000) < 1000);
});

test('rivers: every drop drains to the sea, a closed lake or a dry basin, never uphill; discharge grows downstream', () => {
  const z = plateau();
  // Some rough ground, so there are many small hollows.
  for (let c = 0; c < n; c++) if (z[c] > 0) z[c] += 60 * Math.sin(mesh.xyz[3 * c] * 40) * Math.cos(mesh.xyz[3 * c + 1] * 37) + 30 * Math.sin(mesh.xyz[3 * c + 2] * 53);
  const temp = new Float64Array(12 * n), precip = new Float64Array(12 * n), sun = new Float64Array(12 * n);
  for (let c = 0; c < n; c++) for (let m = 0; m < 12; m++) { temp[m * n + c] = 15; precip[m * n + c] = deg(mesh.lon[c]) < 0 ? 100 : 10; sun[m * n + c] = 350; }
  const w = hydrology({ mesh, radiusKm: 6371, height: z, temp, precip, sun, yearDays: 365.25 });
  for (let c = 0; c < n; c++) {
    let k = c, steps = 0;
    while (w.receiver[k] !== k) {
      assert.ok(w.filled[w.receiver[k]] <= w.filled[k] + 1e-9, 'never uphill on the water\'s surface');
      k = w.receiver[k];
      assert.ok(++steps < n, 'no loops');
    }
    assert.ok([WATER.sea, WATER.saltLake, WATER.saltFlat, WATER.wetland].includes(w.kind[k] as 1 | 3 | 4 | 7) || w.ocean[k], `ends at the sea, a closed lake or a basin (kind ${w.kind[k]})`);
    // (Across a lake's surface, which evaporates, discharge may fall.)
    if (w.receiver[c] !== c && !w.ocean[c] && !(w.lakeDepth[c] > 0) && !(w.lakeDepth[w.receiver[c]] > 0)) assert.ok(w.discharge[w.receiver[c]] + 1e-6 >= w.discharge[c], 'discharge grows downstream');
  }
  assert.ok(Math.abs(w.budget.runoff - w.budget.lakeEvaporation - w.budget.toSea) < 1e-6 * w.budget.runoff, 'runoff = lakes\' evaporation + what reaches the sea');
  assert.ok(Math.abs(w.budget.settledToSea - w.budget.toSea) < 0.05 * w.budget.runoff, `the rivers deliver about what the lakes' balance passes on (${w.budget.toSea.toFixed(0)} against ${w.budget.settledToSea.toFixed(0)} km³)`);
  // River orders never fall downstream.
  for (let c = 0; c < n; c++) if (w.order[c] && w.order[w.receiver[c]]) assert.ok(w.order[w.receiver[c]] >= w.order[c]);
});

test('sea level from the ocean\'s volume: exact, and raising it floods monotonically', () => {
  const z = plateau();
  const level = seaLevelForVolume(z, area, oceanVolume(z, area, 0));
  assert.ok(Math.abs(level) < 1e-6, `the same volume, the same level (${level})`);
  let before = new Uint8Array(n), lastLevel = -Infinity;
  for (const v of [1e16, 5e17, 1e18, 2e18]) {
    const L = seaLevelForVolume(z, area, v);
    assert.ok(Math.abs(oceanVolume(z, area, L) - v) < v * 1e-9, 'holds exactly that volume');
    assert.ok(L > lastLevel, 'more water, a higher sea');
    const now = Uint8Array.from(z, (h) => (h < L ? 1 : 0));
    for (let c = 0; c < n; c++) if (before[c]) assert.equal(now[c], 1, 'what was flooded stays flooded');
    before = now; lastLevel = L;
  }
});

test('the real Earth: a budget that closes, the Amazon the greatest river, deserts shedding almost nothing', () => {
  const m5 = meshAt(5), n5 = m5.n;
  const terrain = readFileSync(new URL('../data/terrain/earth-4096.bin', import.meta.url));
  return decodeTerrain(new Uint8Array(terrain), (b) => new Uint8Array(inflateSync(b))).then((t) => {
    const h = sampleGrid(m5, t.data, 4096, 2048, 1);
    const def = definitionFromPreset('earthlike'), x = derive(def);
    const cl = seasonalClimate(m5, def, x, h);
    const hy = hydroclimate(m5, def, x, h, cl.monthly, 4, cl.dryWarm);
    const sun = insolationCells(m5, sunlightOf(def, x), 0, n5);
    const w = hydrology({ mesh: m5, radiusKm: 6371, height: h, temp: hy.tempMonthly, precip: hy.precipMonthly, sun: sun.monthly, yearDays: x.yearDays });
    const b = w.budget;
    assert.ok(Math.abs(b.precip - b.landEvaporation - b.runoff) < 1e-6 * b.precip && Math.abs(b.runoff - b.lakeEvaporation - b.toSea) < 1e-6 * b.runoff, 'the budget closes');
    assert.ok(b.runoff > 15_000 && b.runoff < 50_000, `runoff ${b.runoff.toFixed(0)} km³ a year (measured about 40,000)`);
    let best = -1, q = 0;
    for (let c = 0; c < n5; c++) if (!w.ocean[c] && w.ocean[w.receiver[c]] && w.discharge[c] > q) { q = w.discharge[c]; best = c; }
    assert.ok(Math.abs(deg(m5.lon[best]) + 52) < 8 && Math.abs(deg(m5.lat[best])) < 5, `the greatest river mouth at ${deg(m5.lon[best]).toFixed(0)}, ${deg(m5.lat[best]).toFixed(0)} (the Amazon's)`);
    const near5 = (lon: number, lat: number) => { const p = [Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180), Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)]; let bb = 0, bd = -2; for (let c = 0; c < n5; c++) { const d = p[0] * m5.xyz[3 * c] + p[1] * m5.xyz[3 * c + 1] + p[2] * m5.xyz[3 * c + 2]; if (d > bd) { bd = d; bb = c; } } return bb; };
    assert.ok(w.balance.runoff[near5(10, 23)] < 30 && w.balance.runoff[near5(-62, -3)] > 300, `the Sahara sheds ${w.balance.runoff[near5(10, 23)].toFixed(0)} mm, the Amazon ${w.balance.runoff[near5(-62, -3)].toFixed(0)} mm`);
  });
});

test('straits and outlets narrower than a cell (D166): a deep basin behind a low sill is sea, a shallow one stays land; a hollow\'s outlet is cut', () => {
  // An ocean to the west; land to the east with two small basins (too small to count as seas themselves) reached over
  // a low sill (100 m): one as deep as an ocean's floor, one 300 m below the sea (as the Caspian's).
  const z = new Float64Array(n);
  const at = (c: number, lon: number, lat: number) => Math.hypot(deg(mesh.lon[c]) - lon, deg(mesh.lat[c]) - lat);
  for (let c = 0; c < n; c++) {
    const lon = deg(mesh.lon[c]);
    z[c] = lon < 0 ? -4000 : 800;
    if (lon >= 0 && lon < 32 && Math.abs(deg(mesh.lat[c]) - 20) < 6) z[c] = 100; // the sill's corridor to the first basin
    if (at(c, 36, 20) < 6) z[c] = -2500;
    if (lon >= 0 && lon < 32 && Math.abs(deg(mesh.lat[c]) + 30) < 6) z[c] = 100;
    if (at(c, 36, -30) < 6) z[c] = -300;
  }
  const plain = oceanMask(mesh, z), sea = straits(mesh, z, plain);
  const deep = cellAtDeg(36, 20), shallow = cellAtDeg(36, -30);
  assert.ok(!plain[deep] && sea[deep], 'the deep basin joins the sea through its strait');
  assert.ok(!sea[shallow], 'the shallow basin stays land (a lake or a dry hollow)');
  // The plateau's hollows, 700 m deep behind its rim: their outlet is cut by most of that depth.
  const h = plateau();
  const hollow: number[] = [];
  for (let c = 0; c < n; c++) if (at(c, 15, 30) < 4) hollow.push(c);
  assert.ok(hollow.length > 0);
  const cut = notchOutlets(mesh, h), before = depressions(mesh, h, oceanMask(mesh, h)), after = depressions(mesh, cut, oceanMask(mesh, h));
  // The hollow's depth: its outermost depression's outlet over its lowest cell.
  const pit = hollow.reduce((a, c) => (h[c] < h[a] ? c : a), hollow[0]);
  const depth = (dh: ReturnType<typeof depressions>, zz: ArrayLike<number>) => {
    let d = dh.label[pit];
    if (d <= 0) return 0;
    while (dh.parent[d] >= 0) d = dh.parent[d];
    return dh.outlet[d] - zz[pit];
  };
  const deep0 = depth(before, h), deep1 = depth(after, cut);
  assert.ok(deep0 > 250 && deep1 < 0.3 * deep0, `the hollow ${deep0.toFixed(0)} m deep, ${deep1.toFixed(0)} m once its outlet is cut`);
});

function cellAtDeg(lon: number, lat: number): number {
  let best = 0, bd = Infinity;
  for (let c = 0; c < n; c++) { const d = Math.hypot(deg(mesh.lon[c]) - lon, deg(mesh.lat[c]) - lat); if (d < bd) { bd = d; best = c; } }
  return best;
}
