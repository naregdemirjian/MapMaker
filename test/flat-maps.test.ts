// Flat maps (a city, a region): a plan true to scale, straight borders, the same kernel at no extra cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { NEG_INF } from '../src/core-time/index.ts';
import { makeView, screenToLonLat, lonLatToScreen, panCamera, flatCamera, flatRadiusKm, FLAT_EXTENT_DEG } from '../src/render-engine/camera.ts';
import { ringFromMapPoints } from '../src/render-engine/stroke.ts';

test('a flat map of a given width: its sphere, its plan view, and the whole width on screen at zoom 0', () => {
  const world = new World();
  cmd.seedProject(world, 'Flat');
  const id = cmd.createFlatMap(world, 'Old Town', 10).result;
  const sp = world.get('map_space', id)!;
  assert.equal(sp.kind, 'plane');
  assert.ok(Math.abs(sp.radius_m! / 1000 - flatRadiusKm(10)) < 1e-9);
  assert.equal(JSON.parse(sp.settings).basemap, 'none', 'no geography');
  // Zoom 0 shows the map's width across 96% of the frame.
  const v = makeView(flatCamera(), 1000, 600);
  const left = lonLatToScreen(v, -FLAT_EXTENT_DEG, 0)!, right = lonLatToScreen(v, FLAT_EXTENT_DEG, 0)!;
  assert.ok(Math.abs(right[0] - left[0] - 960) < 1, `${right[0] - left[0]} px across`);
  // Screen and map positions convert back and forth exactly.
  for (const [x, y] of [[100, 100], [500, 300], [900, 550]]) {
    const ll = screenToLonLat(v, x, y)!;
    const back = lonLatToScreen(v, ll[0], ll[1])!;
    assert.ok(Math.hypot(back[0] - x, back[1] - y) < 1e-6);
  }
  // A great-circle border is a straight line in the plan (gnomonic projection).
  const a = lonLatToScreen(v, -3, -2)!, b = lonLatToScreen(v, 4, 3)!;
  for (let k = 1; k < 10; k++) {
    const f = k / 10;
    const pa = [Math.cos(-2 * Math.PI / 180) * Math.cos(-3 * Math.PI / 180), Math.cos(-2 * Math.PI / 180) * Math.sin(-3 * Math.PI / 180), Math.sin(-2 * Math.PI / 180)];
    const pb = [Math.cos(3 * Math.PI / 180) * Math.cos(4 * Math.PI / 180), Math.cos(3 * Math.PI / 180) * Math.sin(4 * Math.PI / 180), Math.sin(3 * Math.PI / 180)];
    const m = pa.map((x, i) => x * (1 - f) + pb[i] * f);
    const p = lonLatToScreen(v, Math.atan2(m[1], m[0]) * 180 / Math.PI, Math.asin(m[2] / Math.hypot(...m)) * 180 / Math.PI)!;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    assert.ok(Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6, 'on the straight line');
  }
  // Panning stops at the edge of the plan.
  let cam = flatCamera();
  for (let i = 0; i < 50; i++) cam = panCamera(cam, makeView(cam, 1000, 600), -500, 0);
  assert.ok(cam.lon <= FLAT_EXTENT_DEG * 1.6 + 1e-9);
});

test('a flat map is true to scale: a 1 km square drawn on a 10 km map covers 1 km² (within 1%)', () => {
  const world = new World();
  cmd.seedProject(world, 'Flat');
  const id = cmd.createFlatMap(world, 'Old Town', 10).result;
  const layer = world.all('layer').find((l) => l.space_id === id)!.id;
  const engine = new Engine(world);
  const owner = cmd.createEntity(world, { type_id: 'polity', name: 'Guild Quarter' }).result;
  const R = flatRadiusKm(10);
  for (const [cx, cy] of [[0, 0], [3.5, 3.5]]) { // in the middle and near a corner
    const d = (km: number) => (km / R) * 180 / Math.PI;
    const sq: Array<[number, number]> = [[d(cx), d(cy)], [d(cx + 1), d(cy)], [d(cx + 1), d(cy + 1)], [d(cx), d(cy + 1)]];
    const r = cmd.paintTerritory(world, engine, { spaceId: id, layerId: layer, ring: ringFromMapPoints(sq, 0.01)!, value: owner, snap: 1e-9, mode: { kind: 'correct', t: NEG_INF } });
    const arr = world.arrangement(id);
    const km2 = r.result.faces.reduce((a, f) => a + arr.faceArea(f), 0) * R * R;
    assert.ok(Math.abs(km2 - 1) < 0.01, `at ${cx},${cy} km: ${km2.toFixed(4)} km²`);
  }
  assert.throws(() => cmd.createFlatMap(world, 'Too big', 0), /between/);
});

test('labels on a flat map are placed in the middle of a territory', async () => {
  const { planeShape, placeLabel, textWidthEm, blockHeightEm } = await import('../src/render-engine/label-place.ts');
  const d = 0.5, sq = [[-d, -d], [d, -d], [d, d], [-d, d]];
  const arcs: number[] = [];
  for (let i = 0; i < 4; i++) { const a = sq[i], b = sq[(i + 1) % 4]; arcs.push(a[0], a[1], b[0], b[1]); }
  const shape = planeShape(arcs, 'flat', 0);
  assert.equal(shape.edges.length / 4, 4, 'every side kept');
  const spot = placeLabel(shape, textWidthEm('Guild Quarter', false, 0) / blockHeightEm(1));
  assert.ok(spot && Math.abs(spot.lon) < 0.05 && Math.abs(spot.lat) < 0.05, `in the middle (${spot?.lon}, ${spot?.lat})`);
});
