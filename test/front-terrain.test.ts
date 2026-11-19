// Fronts slowed by the land (D142): the slowness of a place from the map's heights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainSlowness } from '../src/render-engine/front-terrain.ts';
import { buildFrontField } from '../src/render-engine/front-field.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';

/** A world of plains at 200 m with a range along 10 degrees east (2,500 m, about 150 km wide) and sea west of 0 degrees. */
function world(): ElevationGrid {
  const width = 1440, height = 720, data = new Int16Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const lon = -180 + ((i + 0.5) * 360) / width;
    data[j * width + i] = lon < 0 ? -3000 : Math.round(200 + 2300 * Math.exp(-(((lon - 10) / 0.7) ** 2)));
  }
  return { width, height, step: 1, data };
}

test('open flat land is as fast as ever; steep and high ground and water are slower, by as much as is asked', () => {
  const g = world();
  const full = terrainSlowness(g, 0, 1), half = terrainSlowness(g, 0, 0.5), none = terrainSlowness(g, 0, 0);
  assert.ok(Math.abs(full(30, 20) - 1) < 0.02, `the plain (${full(30, 20)})`);
  assert.ok(full(10.4, 20) > 3, `the range's flank (${full(10.4, 20)})`);
  assert.ok(full(10, 20) > 1.4, `its crest, high though level (${full(10, 20)})`);
  assert.ok(Math.abs(full(-20, 20) - 3.5) < 1e-9, 'the sea');
  assert.ok(half(10.4, 20) > 1.8 && half(10.4, 20) < full(10.4, 20), 'half as much, half the slowing');
  for (const [lon, lat] of [[30, 20], [10.4, 20], [-20, 20]] as const) assert.equal(none(lon, lat), 1);
  // The sea of the moment: 300 m higher, the plain (200 m) is under water.
  assert.ok(Math.abs(terrainSlowness(g, 300, 1)(30, 20) - 3.5) < 1e-9);
  // Towards the poles the reach stays about as long on the ground: no error at the pole itself.
  assert.ok(Number.isFinite(full(30, 89.99)) && Number.isFinite(full(30, -90)));
});

test('a front minding the land takes longer across the range than across the plain beside it', () => {
  const g = world();
  const box = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const src = { kind: 'lines' as const, lonlat: [4, 10, 4, 30] };
  const plain = buildFrontField([box(4, 10, 16, 30)], src, { roughness: 0, seed: 1 })!;
  const minding = buildFrontField([box(4, 10, 16, 30)], src, { roughness: 0, seed: 1, slowAt: terrainSlowness(g, 0, 1) })!;
  assert.ok(minding.travel > plain.travel * 1.2, `${minding.travel.toFixed(1)} against ${plain.travel.toFixed(1)} degrees' worth of time`);
  // Half of its time gone, it is still short of the crest; over open land it would be well past.
  const at = (f: typeof plain, lon: number) => { const i = Math.floor((lon - f.west) / f.dlon), j = Math.floor((f.north - 20) / f.dlat); return f.at[j * f.nx + i]; };
  assert.ok(at(plain, 12) < 0.72 && at(minding, 12) > at(plain, 12), `beyond the crest later (${at(minding, 12).toFixed(2)} against ${at(plain, 12).toFixed(2)})`);
  assert.ok(at(minding, 6) < at(plain, 6), 'and the plain before it sooner, as a share of the whole');
});
