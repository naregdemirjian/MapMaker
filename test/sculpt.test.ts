// Sculpting the terrain (Stage 8, D98): what each brush does to the heights, along a stroke and only
// within its reach; strokes kept in the base world or from a date; the same strokes give the same
// heights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStamps, cleanStamps, stampsAt, stampsKey, type TerrainStamp, type SculptTool } from '../src/terrain/sculpt.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';
import { gregorian } from '../src/core-time/index.ts';

const W = 360, H = 180, R = 6371;
/** A world of 1° cells, all at one height (or as given). */
const flat = (m: number, f?: (lon: number, lat: number) => number): ElevationGrid => {
  const data = new Int16Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) data[j * W + i] = f ? f(-179.5 + i, 89.5 - j) : m;
  return { width: W, height: H, step: 1, data };
};
const at = (g: ElevationGrid, lon: number, lat: number) => g.data[Math.floor(90 - lat) * W + ((Math.floor(lon + 180) % W) + W) % W];
let n = 0;
const stamp = (tool: SculptTool, path: Array<[number, number]>, more: Partial<TerrainStamp> = {}): TerrainStamp => ({ id: `s${++n}`, tool, path, radiusKm: 500, strength: 1000, seed: 3, from: null, ...more });

test('raise and lower along a stroke: strongest on it, between its points too, nothing beyond the brush', () => {
  const base = flat(100);
  const { grid, touched } = applyStamps(base, [stamp('raise', [[0.5, 0.5], [20.5, 0.5]])], R);
  assert.ok(at(grid, 0.5, 0.5) > 1000, `on the stroke (${at(grid, 0.5, 0.5)})`);
  assert.ok(at(grid, 10.5, 0.5) > 1000, `between its points (${at(grid, 10.5, 0.5)})`);
  assert.ok(at(grid, 10.5, 3.5) > 100 && at(grid, 10.5, 3.5) < at(grid, 10.5, 0.5), 'less towards the edge');
  assert.equal(at(grid, 10.5, 6.5), 100, 'beyond 500 km: untouched');
  assert.equal(at(grid, 30.5, 0.5), 100, 'beyond the end');
  assert.ok(touched && touched[Math.floor(90 - 0.5) * W + 180] === 1 && touched[Math.floor(90 - 6.5) * W + 190] === 0);
  assert.equal(at(base, 0.5, 0.5), 100, 'the base heights are left as they were');
  const lowered = applyStamps(base, [stamp('lower', [[0.5, 0.5]])], R).grid;
  assert.ok(at(lowered, 0.5, 0.5) < -800);
});

test('mountains rise, valleys sink, roughness goes both ways; a crater is a bowl with a rim', () => {
  const base = flat(500);
  const range = applyStamps(base, [stamp('mountains', [[-10.5, 20.5], [10.5, 20.5]], { strength: 3000 })], R).grid;
  const peak = Math.max(...Array.from({ length: 21 }, (_, k) => at(range, -10.5 + k, 20.5)));
  assert.ok(peak > 1500 && peak <= 3500, `a range of peaks (${peak} m)`);
  const valley = applyStamps(base, [stamp('valley', [[0.5, 0.5], [5.5, 0.5]])], R).grid;
  assert.ok(at(valley, 2.5, 0.5) < -300);
  const rough = applyStamps(base, [stamp('roughen', [[0.5, 0.5]], { radiusKm: 1500, strength: 800 })], R).grid;
  let up = 0, down = 0;
  for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) { const v = at(rough, 0.5 + i, 0.5 + j); if (v > 520) up++; if (v < 480) down++; }
  assert.ok(up > 5 && down > 5, `hills (${up}) and hollows (${down})`);
  const crater = applyStamps(base, [stamp('crater', [[0.5, 0.5]], { radiusKm: 600, strength: 1500 })], R).grid;
  assert.ok(at(crater, 0.5, 0.5) < 500 - 1000, `the bowl (${at(crater, 0.5, 0.5)})`);
  assert.ok(at(crater, 0.5, 5.5) > 500, `the rim (${at(crater, 0.5, 5.5)})`);
});

test('islands and painted land rise out of the sea; painted sea floods land', () => {
  const sea = flat(-2000);
  const island = applyStamps(sea, [stamp('island', [[100.5, -10.5]], { radiusKm: 400, strength: 800 })], R).grid;
  assert.ok(at(island, 100.5, -10.5) > 0, 'land in the middle');
  assert.equal(at(island, 100.5, -16.5), -2000, 'sea beyond it');
  const land = applyStamps(sea, [stamp('land', [[0.5, 40.5], [8.5, 40.5]], { radiusKm: 300, strength: 40 })], R).grid;
  assert.ok(at(land, 4.5, 40.5) >= 25, `land under the stroke (${at(land, 4.5, 40.5)})`);
  const flooded = applyStamps(flat(300), [stamp('sea', [[0.5, 40.5], [8.5, 40.5]], { radiusKm: 300, strength: 60 })], R).grid;
  assert.ok(at(flooded, 4.5, 40.5) <= -50, `sea under the stroke (${at(flooded, 4.5, 40.5)})`);
  assert.equal(at(flooded, 4.5, 45.5), 300);
});

test('flatten brings the ground to the height where the stroke starts; smooth and erode wear bumps down', () => {
  const slope = flat(0, (lon) => Math.round(lon * 50));
  const flattened = applyStamps(slope, [stamp('flatten', [[0.5, 0.5], [6.5, 0.5]], { radiusKm: 400 })], R).grid;
  assert.ok(Math.abs(at(flattened, 4.5, 0.5) - at(slope, 0.5, 0.5)) < Math.abs(at(slope, 4.5, 0.5) - at(slope, 0.5, 0.5)) / 3, 'near the start height');
  const bumpy = flat(0, (lon, lat) => ((Math.round(lon) + Math.round(lat)) % 2 ? 400 : -400));
  const spread = (g: ElevationGrid) => { let s = 0; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) s += Math.abs(at(g, 0.5 + i, 0.5 + j)); return s; };
  const smoothed = applyStamps(bumpy, [stamp('smooth', [[0.5, 0.5]], { radiusKm: 1200 })], R).grid;
  assert.ok(spread(smoothed) < spread(bumpy) / 2, `smoother (${spread(smoothed)} against ${spread(bumpy)})`);
  const spike = flat(0, (lon, lat) => (Math.abs(lon - 0.5) < 0.6 && Math.abs(lat - 0.5) < 0.6 ? 8000 : 0));
  const eroded = applyStamps(spike, [stamp('erode', [[0.5, 0.5]], { radiusKm: 800 })], R).grid;
  assert.ok(at(eroded, 0.5, 0.5) < 8000 && at(eroded, 1.5, 0.5) > 0, `worn down (${at(eroded, 0.5, 0.5)}), its ground beside it (${at(eroded, 1.5, 0.5)})`);
});

test('a stroke across the 180th meridian reaches both sides; the same strokes always give the same heights', () => {
  const base = flat(0);
  const across = applyStamps(base, [stamp('raise', [[175.5, 0.5], [-175.5, 0.5]])], R).grid;
  assert.ok(at(across, 179.5, 0.5) > 800 && at(across, -179.5, 0.5) > 800, 'both sides of the meridian');
  assert.equal(at(across, 0.5, 0.5), 0, 'not the long way round');
  const strokes = [stamp('mountains', [[10.5, 10.5], [30.5, 25.5]]), stamp('roughen', [[20.5, 20.5]]), stamp('erode', [[20.5, 18.5]])];
  const a = applyStamps(base, strokes, R).grid, b = applyStamps(base, strokes, R).grid;
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('strokes in the base world hold always, dated ones from their date; stored strokes are checked', () => {
  const t1500 = gregorian.fromCivil({ year: 1500 });
  const strokes = [stamp('raise', [[0.5, 0.5]]), stamp('lower', [[10.5, 0.5]], { from: { day: t1500.day, ms: 0 } })];
  assert.deepEqual(stampsAt(strokes, gregorian.fromCivil({ year: 1400 })).map((s) => s.tool), ['raise']);
  assert.deepEqual(stampsAt(strokes, t1500).map((s) => s.tool), ['raise', 'lower']);
  assert.notEqual(stampsKey('earth', stampsAt(strokes, t1500)), stampsKey('earth', stampsAt(strokes, gregorian.fromCivil({ year: 1400 }))));
  assert.equal(stampsKey('earth', []), 'earth');
  const clean = cleanStamps([strokes[0], { id: 'x', tool: 'explode', path: [[0, 0]], radiusKm: 10, strength: 1 }, { id: 'y', tool: 'raise', path: [], radiusKm: 10, strength: 1 }, { id: 'z', tool: 'raise', path: [[0, 95]], radiusKm: 10, strength: 1 }, null]);
  assert.deepEqual(clean.map((s) => s.id), [strokes[0].id]);
  assert.deepEqual(cleanStamps('nothing'), []);
  assert.equal(applyStamps(flat(0), [], R).touched, null, 'no strokes: the heights themselves');
});

test('a stroke is kept with the map in one step, checked, and all of them taken away in one step', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const { sculptOf } = await import('../src/world-model/world-settings.ts');
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'Sculpt').result;
  const space = () => world.get('map_space', spaceId)!;
  const long = Array.from({ length: 1500 }, (_, i) => [i * 0.01, 10.123456789] as [number, number]);
  const r = cmd.addTerrainStamp(world, spaceId, { tool: 'mountains', path: long, radiusKm: 200, strength: 2500, seed: 9, from: null });
  const kept = sculptOf(space());
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, r.result);
  assert.ok(kept[0].path.length <= 600, 'a long path is thinned');
  assert.equal(kept[0].path[0][1], 10.12346, 'rounded to about a metre');
  cmd.addTerrainStamp(world, spaceId, { tool: 'sea', path: [[1, 2]], radiusKm: 50, strength: 60, seed: 2, from: { day: 100, ms: 0 } });
  assert.equal(sculptOf(space()).length, 2);
  assert.throws(() => cmd.addTerrainStamp(world, spaceId, { tool: 'melt' as never, path: [[0, 0]], radiusKm: 10, strength: 1, seed: 1, from: null }), /Unknown sculpting brush/);
  assert.throws(() => cmd.addTerrainStamp(world, spaceId, { tool: 'raise', path: [], radiusKm: 10, strength: 1, seed: 1, from: null }), /at least one place/);
  assert.throws(() => cmd.addTerrainStamp(world, spaceId, { tool: 'raise', path: [[0, 0]], radiusKm: 0, strength: 1, seed: 1, from: null }), /size and a strength/);
  const cleared = cmd.clearTerrainStamps(world, spaceId);
  assert.equal(sculptOf(space()).length, 0);
  world.applyDiffs(invertDiffs(cleared.diffs));
  assert.equal(sculptOf(space()).length, 2, 'undone in one step');
  const flatMap = cmd.createFlatMap(world, 'Town', 5).result;
  assert.throws(() => cmd.addTerrainStamp(world, flatMap, { tool: 'raise', path: [[0, 0]], radiusKm: 1, strength: 1, seed: 1, from: null }), /terrain to sculpt/);
});
