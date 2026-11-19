// Landscape evolution (Stage 14.4, D155): water always finds its way out, never uphill on the filled surface;
// rivers cut to the exact steady state of the stream-power law (slope ∝ area^-m); creep and sediment keep every
// cubic kilometre; depressions fill with sediment first; headwaters are steep and trunk rivers gentle (mountains and
// valleys together); and in a planet's history erosion wears mountains down, its sediment on the margins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { drainage, accumulate } from '../src/planet/surface/drainage.ts';
import { landscapeStep, zonalRain, EARTH_K } from '../src/planet/surface/erosion.ts';
import { runHistory } from '../src/planet/tectonics/history.ts';
import { tectonicParams } from '../src/planet/pipeline/stages.ts';
import { definitionFromPreset } from '../src/planet/model/definition.ts';
import { random } from '../src/terrain/planet.ts';

const R = 6371;

test('drainage: every cell finds an outlet, never uphill on the filled surface; a world without sea drains to its lowest point', () => {
  const m = meshAt(4), n = m.n, rnd = random(5);
  const z = new Float64Array(n);
  for (let c = 0; c < n; c++) z[c] = m.xyz[3 * c + 2] + 0.3 * rnd();
  const sea = new Uint8Array(n);
  for (let c = 0; c < n; c++) sea[c] = z[c] < -0.2 ? 1 : 0;
  const d = drainage(m, z, sea, R);
  const pos = new Int32Array(n);
  d.order.forEach((c, i) => { pos[c] = i; });
  assert.equal(new Set(d.order).size, n, 'every cell once');
  for (let c = 0; c < n; c++) {
    assert.ok(d.filled[c] >= z[c] - 1e-12, 'filled at or above the ground');
    const r = d.receiver[c];
    if (r === c) { assert.ok(sea[c], 'only the sea is an outlet'); continue; }
    assert.ok(pos[r] < pos[c], 'each cell after the one it drains to');
    assert.ok(d.filled[r] <= d.filled[c], 'never uphill on the filled surface');
    // Following the receivers reaches the sea.
    let k = c, steps = 0;
    while (d.receiver[k] !== k && steps++ < n) k = d.receiver[k];
    assert.ok(sea[k]);
  }
  // Depressions (pits) are filled to their sills.
  assert.ok(Array.from(d.filled).some((f, c) => f > z[c] + 1e-3), 'some pits filled');
  // Without a sea all water ends at the lowest cell.
  const dry = drainage(m, z, null, R);
  let low = 0;
  for (let c = 1; c < n; c++) if (z[c] < z[low]) low = c;
  for (let c = 0; c < n; c++) if (dry.receiver[c] === c) assert.equal(c, low);
  // Summing upstream: the outlets carry everything.
  const all = accumulate(dry, m.area);
  assert.ok(Math.abs(all[low] - 4 * Math.PI) < 1e-9);
});

test('rivers reach the exact steady state of the stream-power law: slope = (U/K) area^-½ in every cell', () => {
  const m = meshAt(5), n = m.n, rnd = random(7);
  const land = new Uint8Array(n);
  for (let c = 0; c < n; c++) land[c] = m.xyz[3 * c + 2] > Math.cos((50 * Math.PI) / 180) ? 1 : 0;
  let z = new Float64Array(n);
  for (let c = 0; c < n; c++) z[c] = land[c] ? 0.01 + 0.02 * rnd() : -1;
  const U = 0.3, dt = 10;
  let res: ReturnType<typeof landscapeStep> | null = null;
  for (let it = 0; it < 400; it++) {
    const zu = Float64Array.from(z, (v, c) => (land[c] ? v + U * dt : v));
    res = landscapeStep(m, zu, { dt, K: EARTH_K, m: 0.5, kappa: 0, beta: 1, radiusKm: R, seaLevel: 0 });
    let change = 0;
    const zn = Float64Array.from(zu, (v, c) => (land[c] ? v - res!.incision[c] : v));
    for (let c = 0; c < n; c++) change = Math.max(change, Math.abs(zn[c] - z[c]));
    z = zn;
    if (change < 1e-10) break;
  }
  const d = res!.drainage;
  const xs: number[] = [], ys: number[] = [];
  let worst = 0, headwater = 0, heads = 0, trunk = 0, trunks = 0;
  const cell = (4 * Math.PI * R * R) / n;
  for (let c = 0; c < n; c++) {
    if (!land[c]) continue;
    const r = d.receiver[c], base = land[r] ? z[r] : Math.max(z[r], 0);
    const S = (z[c] - base) / d.length[c], want = U / (EARTH_K * Math.sqrt(res!.discharge[c]));
    worst = Math.max(worst, Math.abs(S - want) / want);
    xs.push(Math.log(res!.discharge[c])); ys.push(Math.log(S));
    if (res!.discharge[c] < 1.5 * cell) { headwater += S; heads++; }
    if (res!.discharge[c] > 20 * cell) { trunk += S; trunks++; }
  }
  assert.ok(worst < 1e-6, `steady state in every cell (worst ${worst})`);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  assert.ok(Math.abs(num / den + 0.5) < 1e-6, `slope ∝ area^-½ (${num / den})`);
  // Mountains and valleys together: steep headwaters, gentle trunk rivers, cut into the uplifted land.
  assert.ok(heads > 20 && trunks > 5 && headwater / heads > 3 * (trunk / trunks), 'headwaters steeper than trunk rivers');
  assert.ok(Math.max(...z) > 3, 'mountains stand where the land rises');
});

test('nothing is lost: rock removed equals sediment laid down; creep only moves rock; pits fill first; rain cuts faster', () => {
  const m = meshAt(4), n = m.n, rnd = random(3);
  const z = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const lat = m.lat[c];
    z[c] = lat > 0 ? 3 * Math.sin(lat) + 0.4 * rnd() : -2;
  }
  // A closed pit on the land.
  let pit = -1;
  for (let c = 0; c < n && pit < 0; c++) if (m.lat[c] > 0.5 && m.lat[c] < 0.6) pit = c;
  z[pit] = 0.2;
  const p = { dt: 5, K: EARTH_K, m: 0.5, kappa: 200, beta: 0.15, radiusKm: R, seaLevel: 0 };
  const res = landscapeStep(m, z, p);
  assert.ok(res.eroded > 0);
  assert.ok(Math.abs(res.eroded - res.deposited) < 1e-9 * res.eroded, `conserved (${res.eroded} against ${res.deposited})`);
  let creep = 0;
  for (let c = 0; c < n; c++) creep += res.creep[c] * m.area[c];
  assert.ok(Math.abs(creep) < 1e-12, 'creep conserves rock');
  assert.ok(res.deposit[pit] > 0, 'the pit takes sediment');
  let sea = 0;
  for (let c = 0; c < n; c++) if (z[c] < 0) sea += res.deposit[c] * m.area[c];
  assert.ok(sea > 0, 'and the sea takes the rest');
  // Twice the rain on the land: more rock removed.
  const wet = landscapeStep(m, z, { ...p, rain: new Float64Array(n).fill(2) });
  assert.ok(wet.eroded > 1.2 * res.eroded, 'wetter, faster');
  // A threshold slope: gentle lowland rivers cut nothing.
  const flat = Float64Array.from(z, (v, c) => (v > 0 ? 0.3 + 0.0001 * m.lat[c] : v));
  assert.equal(landscapeStep(m, flat, { ...p, kappa: 0, threshold: 0.001 }).eroded, 0);
  // Rain belts: wet near the equator, dry at the Hadley cells' edges, wetter beyond.
  assert.ok(zonalRain(0, 30) > zonalRain(25, 30) && zonalRain(50, 30) > zonalRain(25, 30) && zonalRain(85, 30) < zonalRain(50, 30));
});

test('a planet\'s history with erosion: mountains worn lower, sediment on the margins and in basins, nothing lost', () => {
  const def = definitionFromPreset('earthlike', 3);
  const run = (erosion: boolean) => runHistory({ ...tectonicParams(def, 4, 300), erosion }, { durationMyr: 300, frameEveryMyr: 100 });
  const bare = run(false), worn = run(true);
  const n = meshAt(4).n, F = worn.times.length;
  const top = (h: Int16Array) => { const s = Array.from(h.subarray((F - 1) * n)).sort((a, b) => a - b); return s[Math.floor(0.98 * (n - 1))]; };
  assert.ok(top(worn.heights) < top(bare.heights), `high ground lower (${top(worn.heights)} m against ${top(bare.heights)})`);
  assert.ok(worn.stats.eroded > 0 && Math.abs(worn.stats.eroded - worn.stats.deposited) < 1e-6 * worn.stats.eroded, 'all of it laid down');
  // Earth-like rates: roughly one to five cubic kilometres a year over the history.
  const perYear = worn.stats.eroded / 300e6;
  assert.ok(perYear > 0.3 && perYear < 8, `${perYear.toFixed(2)} km³ a year`);
  let margin = 0, open = 0, marginCells = 0, openCells = 0;
  const m = meshAt(4);
  for (let c = 0; c < n; c++) {
    if (worn.heights[(F - 1) * n + c] >= 0) continue;
    let coast = false;
    for (let k = m.nbrStart[c]; k < m.nbrStart[c + 1]; k++) if (worn.heights[(F - 1) * n + m.nbr[k]] >= 0) coast = true;
    if (coast) { margin += worn.sediment[c]; marginCells++; } else { open += worn.sediment[c]; openCells++; }
  }
  assert.ok(margin / marginCells > 2 * (open / Math.max(1, openCells)), 'sediment thickest beside the land');
  // Rivers: the largest drainage reaches across a good part of a continent.
  const biggest = Math.max(...worn.discharge);
  assert.ok(biggest > 1e6, `a great river (${biggest.toExponential(1)} km²)`);
});
