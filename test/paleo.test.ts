// The Earth through geological time (D134): the PALEOMAP maps packed and read, blended between moments,
// the seas of the last glacial cycle, deep-time dates, and the map made with one command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePaleo, decodePaleo, paleoBetween, paleoGridAt, paleoLabelAt, glacialSeaAt, ageOf, instantOfAge, GLACIAL_SEA, type PaleoSet } from '../src/terrain/paleo.ts';
import { cellHeight } from '../src/terrain/grid.ts';
import { gregorian, formatYear, DEEP_BEFORE_YEAR } from '../src/core-time/index.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { terrainSourceOf, isPaleoEarth, basemapSourceOf, terrainLook, seaLevelPoints } from '../src/world-model/world-settings.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inflate = (z: Uint8Array) => new Uint8Array(inflateSync(z));
let real: PaleoSet | null = null;
const earth = async () => (real ??= await decodePaleo(new Uint8Array(readFileSync(join(root, 'data', 'paleo', 'paleodem-1deg.bin'))), inflate));

test('maps of the Earth through time packed and read back exactly; refused when damaged', async () => {
  const grid = (f: (i: number) => number) => ({ width: 6, height: 3, step: 1, data: Int16Array.from({ length: 18 }, (_, i) => f(i)) });
  const set: PaleoSet = { ages: [0, 5, 12.5], labels: ['Now', 'Then', 'Long ago'], grids: [grid((i) => i * 100 - 900), grid((i) => -i * 37), grid((i) => (i % 3) * 3000 - 4000)] };
  const bytes = encodePaleo(set, (b) => new Uint8Array(deflateSync(b)));
  const back = await decodePaleo(bytes, inflate);
  assert.deepEqual(back.ages, set.ages);
  assert.deepEqual(back.labels, set.labels);
  back.grids.forEach((g, i) => assert.deepEqual(Array.from(g.data), Array.from(set.grids[i].data)));
  await assert.rejects(decodePaleo(bytes.subarray(0, 30), inflate));
  await assert.rejects(decodePaleo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]), inflate), /Not a Map Maker file/);
  assert.throws(() => encodePaleo({ ...set, ages: [0, 5, 5] }, (b) => b), /youngest first/);
  // Blended between moments: half way, half way between every height; beyond the span, the nearest.
  assert.deepEqual(paleoBetween(set, 2.5), { a: 0, b: 1, f: 0.5 });
  assert.deepEqual(paleoBetween(set, 8.75), { a: 1, b: 2, f: 0.5 });
  assert.deepEqual(paleoBetween(set, -3), { a: 0, b: 1, f: 0 });
  assert.deepEqual(paleoBetween(set, 99), { a: 2, b: 2, f: 0 });
  const half = paleoGridAt(set, 2.5);
  half.grid.data.forEach((v, i) => assert.equal(v, Math.round((set.grids[0].data[i] + set.grids[1].data[i]) / 2)));
  assert.equal(half.key, 'paleo:2.5000');
  assert.equal(paleoGridAt(set, 2.5).grid, half.grid, 'kept, not made again');
  assert.equal(paleoGridAt(set, 5).grid.data, set.grids[1].data, 'at a map\'s own moment, that map');
  assert.equal(paleoLabelAt(set, 3), 'Then');
});

test('the PALEOMAP maps: 109 moments from today back 540 million years; today\'s Earth at the first; Pangaea one land 250 million years ago', async () => {
  const p = await earth();
  assert.equal(p.ages.length, 109);
  assert.equal(p.ages[0], 0);
  assert.equal(p.ages[p.ages.length - 1], 540);
  assert.ok(p.ages.includes(385.2) && p.ages.includes(390.5), 'two Devonian maps a little off the 5 million year steps');
  assert.equal(p.labels[0], 'Holocene');
  assert.equal(paleoLabelAt(p, 250), 'Permo-Triassic Boundary');
  assert.equal(paleoLabelAt(p, 35), 'Late Eocene');
  assert.equal(paleoLabelAt(p, 0.005), 'Holocene');
  assert.equal(paleoLabelAt(p, 0.021), 'Pleistocene, the Last Glacial Maximum');
  assert.equal(paleoLabelAt(p, 1), 'Pleistocene');
  const g0 = p.grids[0];
  assert.equal(g0.width, 360);
  assert.equal(g0.height, 180);
  const land = (g: typeof g0) => g.data.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) / g.data.length;
  assert.ok(Math.abs(land(g0) - 0.3) < 0.03, `today about 30% land (${land(g0)})`);
  // Today: the Sahara, the Tibetan plateau high, the middle of the Pacific deep.
  assert.ok(cellHeight(g0, 10, 23) > 0, 'the Sahara');
  assert.ok(cellHeight(g0, 88, 32) > 3500, `Tibet ${cellHeight(g0, 88, 32)}`);
  assert.ok(cellHeight(g0, -150, 0) < -3500, 'the Pacific');
  // The largest single land (cells joined side by side, round the globe east and west) as a share of all land.
  const largest = (g: typeof g0) => {
    const W = g.width, H = g.height, seen = new Uint8Array(W * H);
    let best = 0, all = 0;
    for (let k = 0; k < W * H; k++) {
      if (g.data[k] <= 0 || seen[k]) continue;
      let n = 0;
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const c = stack.pop()!, x = c % W, y = (c - x) / W;
        n++;
        for (const d of [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W), y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) if (d >= 0 && !seen[d] && g.data[d] > 0) { seen[d] = 1; stack.push(d); }
      }
      all += n;
      best = Math.max(best, n);
    }
    return best / all;
  };
  const pangaea = paleoGridAt(p, 250).grid, today = largest(g0), then = largest(pangaea);
  assert.ok(then > 0.85, `250 million years ago, one land holds ${(then * 100).toFixed(0)}% of all land`);
  assert.ok(today < then - 0.2, `today the land is in several (${(today * 100).toFixed(0)}% in the largest)`);
});

test('the sea through the last glacial cycle: about 130 m lower 21,000 years ago, a little higher 125,000 years ago, today\'s from about 4,000 years ago and before 128,000', () => {
  assert.equal(glacialSeaAt(0), 0);
  assert.equal(glacialSeaAt(0.002), 0);
  assert.equal(glacialSeaAt(0.021), -130);
  assert.ok(glacialSeaAt(0.0145) < -75 && glacialSeaAt(0.0145) > -96, 'rising fastest 14,500 years ago');
  assert.equal(glacialSeaAt(0.125), 6);
  assert.equal(glacialSeaAt(0.2), 0);
  assert.equal(glacialSeaAt(250), 0);
  for (let i = 1; i < GLACIAL_SEA.length; i++) assert.ok(GLACIAL_SEA[i][0] > GLACIAL_SEA[i - 1][0], 'in order of age');
  assert.ok(GLACIAL_SEA.every(([, m]) => m >= -135 && m <= 10));
});

test('deep time: ages of instants and back; dates before 10,000 BCE written and read as how long ago', () => {
  const t = instantOfAge(250);
  assert.ok(Math.abs(ageOf(t) - 250) < 1e-9);
  assert.equal(ageOf(gregorian.fromCivil({ year: 2000 })), 0);
  assert.equal(ageOf(gregorian.fromCivil({ year: 2150 })), 0, 'the future: today\'s');
  assert.ok(Math.abs(ageOf(gregorian.fromCivil({ year: -19000 })) - 0.021) < 1e-6);
  assert.equal(formatYear(-249_998_000), '250 million years ago');
  assert.equal(formatYear(-2_578_000), '2.58 million years ago');
  assert.equal(formatYear(-19_000), '21,000 years ago');
  assert.equal(formatYear(DEEP_BEFORE_YEAR), '10000 BCE', 'from 10,000 BCE on, years as before');
  assert.equal(formatYear(-499), '500 BCE');
  for (const [text, year, shown] of [
    ['250 Ma', -249_998_000, '250 million years ago'], ['250 million years ago', -249_998_000, '250 million years ago'], ['2.58 mya', -2_578_000, '2.58 million years ago'],
    ['21 ka', -19_000, '21,000 years ago'], ['21,000 years ago', -19_000, '21,000 years ago'], ['540 Ma', -539_998_000, '540 million years ago'],
  ] as const) {
    const p = gregorian.parse(text)!;
    assert.equal(gregorian.toCivil(p.instant).year, year, text);
    assert.equal(gregorian.format(p.instant, 'day'), shown, `${text}: no day or month in deep time`);
    assert.equal(gregorian.parse(shown) && gregorian.toCivil(gregorian.parse(shown)!.instant).year, year, `${shown} read back`);
  }
  assert.equal(gregorian.format(gregorian.parse('c. 21 ka')!.instant, 'circa'), 'c. 21,000 years ago');
  assert.equal(gregorian.parse('12000 BCE') && gregorian.toCivil(gregorian.parse('12000 BCE')!.instant).year, -11999, 'BCE years still read');
});

test('a map of the Earth through geological time: made in one step (undone), its terrain the PALEOMAP heights, no present-day geography', async () => {
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Deep time');
  const r = cmd.createPaleoEarth(world, 'The Earth through time');
  const sp = world.get('map_space', r.result)!;
  assert.equal(sp.kind, 'sphere');
  assert.ok(Math.abs(sp.radius_m! - 6371008.8) < 1);
  assert.equal(terrainSourceOf(sp), 'paleo');
  assert.ok(isPaleoEarth(sp));
  assert.equal(basemapSourceOf(sp), 'none', 'not today\'s coasts');
  assert.ok(terrainLook(sp)?.relief, 'drawn with relief');
  assert.deepEqual(seaLevelPoints(sp), [], 'the glacial seas are the map\'s own, not points of the user\'s');
  assert.ok(!isPaleoEarth(world.all('map_space').find((m) => m.id !== sp.id)), 'other maps are not');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(world.get('map_space', r.result), undefined);
});

test('between two maps the crust slides along its motion (D135): a block moving 3 degrees east is 1.5 degrees on half way, whole all the way', async () => {
  const W = 360, H = 180, n = W * H;
  const block = (x0: number) => ({ width: W, height: H, step: 1, data: Int16Array.from({ length: n }, (_, k) => { const i = k % W, j = (k - i) / W; return i >= x0 && i < x0 + 20 && j >= 80 && j < 100 ? 1000 : -3000; }) });
  // Map A (younger) has the block at 100 to 119 degrees east of -180; map B (older) 3 degrees further east: its crust moves +3 degrees.
  const moves = new Int8Array(2 * n);
  for (let k = 0; k < n; k++) { const j = Math.floor(k / W), lat = 90 - (j + 0.5); moves[k] = Math.round(30 * Math.cos((lat * Math.PI) / 180)); }
  const set: PaleoSet = { ages: [0, 5], labels: ['A', 'B'], grids: [block(100), block(103)], motion: [moves] };
  const back = await decodePaleo(encodePaleo(set, (b) => new Uint8Array(deflateSync(b))), inflate);
  assert.equal(back.motion?.length, 1);
  assert.deepEqual(Array.from(back.motion![0]), Array.from(moves));
  // (Where the block's mass is: each cell's height above the sea floor, weighted by its place.)
  const middle = (g: { data: Int16Array }) => { let sx = 0, c = 0; for (let k = 0; k < n; k++) { const w = g.data[k] + 3000; sx += w * (k % W); c += w; } return { x: sx / c, cells: c / 4000 }; };
  const a = middle(back.grids[0]), b = middle(back.grids[1]), half = middle(paleoGridAt(back, 2.5).grid), quarter = middle(paleoGridAt(back, 1.25).grid);
  assert.ok(Math.abs(half.x - (a.x + 1.5)) < 0.15, `half way: 1.5 degrees on (${a.x} to ${half.x})`);
  assert.ok(Math.abs(quarter.x - (a.x + 0.75)) < 0.15, `a quarter of the way: 0.75 degrees on (${quarter.x})`);
  assert.ok(Math.abs(half.cells - a.cells) < a.cells * 0.01, `whole as it goes (${half.cells} cells against ${a.cells})`);
  assert.ok(Math.abs(b.x - a.x - 3) < 1e-9);
  // Blended in place instead (no motion): half of each end, fading: the land half way is less than the block.
  const faded = paleoGridAt({ ...back, motion: undefined }, 2.5).grid.data.reduce((c, h) => c + (h > 0 ? 1 : 0), 0);
  const slid = paleoGridAt(back, 2.5).grid.data.reduce((c, h) => c + (h > 0 ? 1 : 0), 0);
  assert.ok(slid >= 380 && faded < slid, `sliding keeps the block (${slid} land cells), blending in place melts it (${faded})`);
});

test('the real maps\' motion: India moves steadily north between 50 and 45 million years ago, without fading', async () => {
  const p = await earth();
  assert.equal(p.motion?.length, 108, 'a motion for every pair of maps');
  // India's land between 40 and 110 degrees east, south of 35 north: its middle, read at five moments.
  const india = (age: number) => {
    const g = paleoGridAt(p, age).grid;
    let sy = 0, c = 0;
    for (let j = 0; j < g.height; j++) for (let i = 0; i < g.width; i++) {
      const lon = -180 + i + 0.5, lat = 90 - j - 0.5;
      if (lon > 40 && lon < 110 && lat < 35 && lat > -40 && g.data[j * g.width + i] > 0) { sy += lat; c++; }
    }
    return { lat: sy / c, cells: c };
  };
  const steps = [50, 48.75, 47.5, 46.25, 45].map(india);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].lat >= steps[i - 1].lat - 0.05, `moving north (${steps.map((s) => s.lat.toFixed(2)).join(', ')})`);
  const ends = (steps[0].cells + steps[4].cells) / 2;
  assert.ok(Math.abs(steps[2].cells - ends) < ends * 0.08, `whole half way (${steps.map((s) => s.cells).join(', ')})`);
});
