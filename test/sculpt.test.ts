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

test('an outline drawn becomes land or sea (D169): the coast ragged at the brush\'s size, land rising inland, sea deepening; across the 180th meridian too', () => {
  const sea = flat(-2000);
  const square: Array<[number, number]> = [[0, 0], [20, 0], [20, 15], [0, 15]];
  const land = applyStamps(sea, [stamp('coast-land', square, { radiusKm: 200, strength: 400 })], R).grid;
  assert.ok(at(land, 10.5, 7.5) >= 0.7 * 400, `the middle stands high (${at(land, 10.5, 7.5)} m)`);
  assert.ok(at(land, 1.5, 7.5) > 0 && at(land, 1.5, 7.5) < at(land, 10.5, 7.5), `lower near the coast (${at(land, 1.5, 7.5)} m)`);
  // Its shore: a shelf rising from the sea floor to the new coast over four brush widths; the sea beyond untouched.
  assert.ok(at(land, 22.5, 7.5) > -1000 && at(land, 22.5, 7.5) < 0, `a shelf by the coast (${at(land, 22.5, 7.5)} m)`);
  assert.equal(at(land, 30.5, 7.5), -2000, 'the sea beyond it untouched');
  assert.equal(at(land, 10.5, -9.5), -2000);
  // A ragged coast: along the southern edge, some of the band within the brush is land and some sea.
  let landed = 0, cells = 0;
  for (let lon = 2.5; lon < 18; lon++) for (const lat of [-0.5, 0.5]) { cells++; if (at(land, lon, lat) > 0) landed++; }
  assert.ok(landed > 0.15 * cells && landed < 0.85 * cells, `a ragged coast (${landed} of ${cells} cells on the line land)`);
  // Higher ground inside is kept.
  const hills = applyStamps(flat(-2000, (lon, lat) => (lon > 9 && lon < 11 && lat > 6 && lat < 8 ? 2500 : -2000)), [stamp('coast-land', square, { radiusKm: 200, strength: 400 })], R).grid;
  assert.equal(at(hills, 10.5, 7.5), 2500);
  // The sea drawn over land: deeper away from the coast.
  const flooded = applyStamps(flat(300), [stamp('coast-sea', square, { radiusKm: 200, strength: 3000 })], R).grid;
  assert.ok(at(flooded, 10.5, 7.5) <= -0.8 * 3000, `deep in the middle (${at(flooded, 10.5, 7.5)} m)`);
  assert.ok(at(flooded, 1.5, 7.5) < 0 && at(flooded, 1.5, 7.5) > at(flooded, 10.5, 7.5), 'shallower near the coast');
  assert.ok(at(flooded, 22.5, 7.5) > 10 && at(flooded, 22.5, 7.5) < 300, `low shores beside the new sea (${at(flooded, 22.5, 7.5)} m)`);
  assert.equal(at(flooded, 30.5, 7.5), 300);
  // Round the 180th meridian.
  const across = applyStamps(sea, [stamp('coast-land', [[170, -10], [-170, -10], [-170, 10], [170, 10]], { radiusKm: 100, strength: 400 })], R).grid;
  assert.ok(at(across, 179.5, 0.5) > 0 && at(across, -179.5, 0.5) > 0, 'land on both sides');
  assert.equal(at(across, 0.5, 0.5), -2000, 'not the other side of the world');
});

test('a river drawn from its source to its mouth (D169): its bed falls all the way, and the water runs down it', async () => {
  // Rolling land at 400 to 600 m, sea east of 12°E.
  const ground = flat(0, (lon, lat) => (lon > 12 ? -1500 : 500 + Math.round(100 * Math.sin(lon * 1.7) * Math.cos(lat * 2.3))));
  const path: Array<[number, number]> = [[0.5, 10.5], [5.5, 12.5], [10.5, 10.5], [13.5, 10.5]];
  const g = applyStamps(ground, [stamp('river', path, { radiusKm: 300, strength: 120 })], R).grid;
  // Downhill all the way from the source: the valley's floor (the lowest of the cells about each place along the
  // stroke, on this grid of 1° cells) falls step by step, about 70 m a step, give or take the cells' own places.
  const floor = (lon: number, lat: number) => Math.min(...[-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => at(g, lon + a, lat + b))));
  const along: number[] = [];
  for (let q = 0; q + 1 < path.length; q++) for (let k = 0; k < 10; k++) { const t = k / 10; along.push(floor(path[q][0] + (path[q + 1][0] - path[q][0]) * t, path[q][1] + (path[q + 1][1] - path[q][1]) * t)); }
  for (let i = 1; i < along.length; i++) assert.ok(along[i] <= along[i - 1] + 30, `downhill at step ${i} (${along[i - 1]} → ${along[i]} m)`);
  assert.ok(along[along.length - 1] < 0 && along.slice(0, 15).every((v) => v > 0), 'down to the sea, above it inland');
  assert.ok(at(g, 0.5, 10.5) < at(ground, 0.5, 10.5), 'cut below the ground at the source');
  // Water from the source finds the sea by the steepest way down, close by the river drawn.
  let lon = 0.5, lat = 10.5, steps = 0, off = 0;
  while (at(g, lon, lat) >= 0 && steps++ < 100) {
    let best: [number, number] = [lon, lat], low = at(g, lon, lat);
    for (const [dl, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const v = at(g, lon + dl, lat + dp); if (v < low) { low = v; best = [lon + dl, lat + dp]; } }
    if (best[0] === lon && best[1] === lat) break;
    [lon, lat] = best;
    off = Math.max(off, Math.min(...[10.5, 11.5, 12.5].map((l) => Math.abs(lat - l))));
  }
  assert.ok(at(g, lon, lat) < 0, `the water reaches the sea (stopped at ${lon}, ${lat})`);
  assert.ok(off <= 1, 'along the river drawn');
  // Shown as a river whatever water reaches it, from its source to its mouth (not on into the sea).
  const { riversNow } = await import('../src/terrain/river-cache.ts');
  const river = stamp('river', path, { radiusKm: 300, strength: 120 });
  const lines = riversNow(g, 'drawn-river-test', [river]).lines.coordinates;
  const drawn = lines[lines.length - 1];
  assert.deepEqual(drawn[0], [0.5, 10.5], 'from its source');
  const end = drawn[drawn.length - 1];
  assert.ok(end[0] > 11.4 && end[0] < 12.6, `to its mouth at the coast, an estuary its last few kilometres (${end})`);
});

test('painted biomes (D169): kept and checked with the strokes, changing no heights, laid over the land\'s colours', async () => {
  const { paintedCover } = await import('../src/terrain/cover.ts');
  const { BIOMES } = await import('../src/terrain/biomes.ts');
  const base = flat(300);
  const desert = stamp('biome', [[0.5, 0.5], [10.5, 0.5]], { radiusKm: 300, strength: 0, biome: 'desert' });
  assert.equal(applyStamps(base, [desert], R).grid.data, base.data, 'no heights changed');
  assert.deepEqual(cleanStamps([desert]).map((s) => s.biome), ['desert']);
  assert.equal(cleanStamps([{ ...desert, biome: 'jungle' }]).length, 0, 'an unknown biome is left out');
  const green = new Uint8Array(4 * W * H);
  for (let k = 0; k < W * H; k++) { green[4 * k] = 40; green[4 * k + 1] = 90; green[4 * k + 2] = 40; green[4 * k + 3] = 255; }
  const cover = { width: W, height: H, pixels: green, key: 'green' };
  const painted = paintedCover(cover, [desert], R);
  const px = (lon: number, lat: number) => { const k = Math.floor(90 - lat) * W + Math.floor(lon + 180); return Array.from((painted.pixels as Uint8Array).subarray(4 * k, 4 * k + 3)); };
  assert.deepEqual(px(5.5, 0.5), [...BIOMES.desert], 'the desert on the stroke');
  assert.deepEqual(px(5.5, 20.5), [40, 90, 40], 'the forest beyond it');
  assert.notEqual(painted.key, cover.key);
  assert.equal(paintedCover(cover, [], R), cover, 'nothing painted: the cover itself');
});

test('brush tips (D218): a hard tip a plateau, an oval tip wider across one way than the other, a ragged edge in and out; kept only when not round', async () => {
  const { tipOf, isRoundTip, ROUND_TIP, TIP_PRESETS, cleanStamps: clean } = await import('../src/terrain/sculpt.ts');
  const base = flat(0);
  const line: Array<[number, number]> = [[-6.5, 10.5], [6.5, 10.5]];
  const soft = applyStamps(base, [stamp('raise', line, { radiusKm: 400, strength: 1000 })], R).grid;
  const hard = applyStamps(base, [stamp('raise', line, { radiusKm: 400, strength: 1000, tip: { ...ROUND_TIP, hardness: 0.75 } })], R).grid;
  // Six tenths of the way out (400 km is about 3.6 degrees): the hard tip at full strength, the soft one well under.
  assert.ok(at(hard, 0.5, 10.5 + 2.2) > 950 && at(soft, 0.5, 10.5 + 2.2) < 600, `plateau ${at(hard, 0.5, 12.7)}, dome ${at(soft, 0.5, 12.7)}`);
  // An oval tip held east-west (not turning): a stroke going east is thin, one going north is wide.
  const oval = { ...ROUND_TIP, roundness: 0.3, angle: 0 };
  const east = applyStamps(base, [stamp('raise', [[-6.5, 0.5], [6.5, 0.5]], { radiusKm: 400, strength: 1000, tip: oval })], R).grid;
  const north = applyStamps(base, [stamp('raise', [[0.5, -6.5], [0.5, 6.5]], { radiusKm: 400, strength: 1000, tip: oval })], R).grid;
  assert.ok(at(east, 0.5, 0.5 + 2.2) < 50, `thin going east (${at(east, 0.5, 2.7)})`);
  assert.ok(at(north, 0.5 + 2.2, 0.5) > 300, `wide going north (${at(north, 2.7, 0.5)})`);
  // Turning with the stroke and held across it: as wide whichever way it goes.
  const across = { ...ROUND_TIP, roundness: 0.3, angle: 90, follow: true };
  const e2 = applyStamps(base, [stamp('raise', [[-6.5, 0.5], [6.5, 0.5]], { radiusKm: 400, strength: 1000, tip: across })], R).grid;
  const n2 = applyStamps(base, [stamp('raise', [[0.5, -6.5], [0.5, 6.5]], { radiusKm: 400, strength: 1000, tip: across })], R).grid;
  assert.ok(Math.abs(at(e2, 0.5, 0.5 + 2.2) - at(n2, 0.5 + 2.2, 0.5)) < 60, 'the same width both ways');
  // A ragged edge: at the brush's edge some places raised, some not.
  const ragged = applyStamps(base, [stamp('raise', line, { radiusKm: 400, strength: 1000, tip: { ...ROUND_TIP, ragged: 1 } })], R).grid;
  let raised = 0, not = 0;
  for (let k = -6; k <= 6; k++) { const v = at(ragged, 0.5 + k, 10.5 + 3.4); if (v > 20) raised++; else not++; }
  assert.ok(raised > 0 && not > 0, `in and out along the edge (${raised} raised, ${not} not)`);
  // Kept with the stroke only when not the plain round one; out of range made whole.
  assert.ok(isRoundTip(undefined) && isRoundTip(ROUND_TIP) && !isRoundTip(TIP_PRESETS[1].tip));
  assert.deepEqual(tipOf({ hardness: 2, roundness: 0, angle: 999, ragged: -1 }), { hardness: 0.95, roundness: 0.1, angle: 180, follow: false, ragged: 0, texture: 0 });
  const kept = clean([{ id: 'a', tool: 'raise', path: [[0, 0]], radiusKm: 10, strength: 10, seed: 1, from: null, tip: ROUND_TIP }, { id: 'b', tool: 'raise', path: [[0, 0]], radiusKm: 10, strength: 10, seed: 1, from: null, tip: { hardness: 0.5 } }]);
  assert.equal(kept[0].tip, undefined);
  assert.equal(kept[1].tip?.hardness, 0.5);
});
