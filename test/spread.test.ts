// Conditions that spread over the terrain (Stage 9, D103): a fire across the land (stopped by water,
// faster downwind), lava downhill, a flood filling low ground up to the ridges around it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spreadRaster, rasterAt, spreadValue, NEVER } from '../src/domain/spread.ts';
import { strengthAt, DEFAULT_SOURCES, type FieldSource } from '../src/domain/fields.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';

const W = 720, H = 360, R = 6371;
/** A world of half-degree cells, heights from a function of the cell's middle. */
const world = (f: (lon: number, lat: number) => number): ElevationGrid => {
  const data = new Int16Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) data[j * W + i] = Math.round(f(-179.75 + i * 0.5, 89.75 - j * 0.5));
  return { width: W, height: H, step: 1, data };
};
const src = (o: Partial<FieldSource>): FieldSource => ({ ...DEFAULT_SOURCES.fire, shape: 'circle', noise: 0, ...o });
const arrival = (g: ReturnType<typeof spreadRaster>, lon: number, lat: number) => rasterAt(g, lon, lat)[0];

test('a fire spreads across the land at its pace, around water, faster downwind, and is held after its days', () => {
  // Flat land at 200 m, with a lake 1° wide east of the source.
  const land = world((lon, lat) => (lon > 3 && lon < 4 && Math.abs(lat) < 1 ? -10 : 200));
  const s = src({ radiusKm: 800, grow: 10, windKmPerDay: 0, seed: 4 });
  const g = spreadRaster('fire', s, [0, 0], land, 'land', R);
  assert.ok(arrival(g, 0, 0) < 0.5, 'it starts at its source');
  const near = arrival(g, 2, 0), far = arrival(g, 5, 0), farther = arrival(g, 0, -6);
  assert.ok(near > 0 && near < farther, `farther away, later (${near.toFixed(1)} and ${farther.toFixed(1)} days)`);
  assert.ok(farther > 3 && farther < 10, `about the pace asked for: 670 km in about 8 days, unevenly (${farther.toFixed(1)})`);
  assert.equal(arrival(g, 3.5, 0), NEVER, 'never over the lake');
  assert.ok(far < NEVER && far > arrival(g, -5, 0), 'beyond the lake only the long way round, later than the same distance west');
  assert.ok(arrival(g, 0, -14) >= NEVER / 2, 'held after its days: not twice its size away');
  // With a wind towards the east, east sooner than west.
  const windy = spreadRaster('fire', src({ radiusKm: 800, grow: 8, windDeg: 90, windKmPerDay: 300, seed: 4 }), [0, 0], world(() => 200), 'flat', R);
  assert.ok(arrival(windy, 4, 0) < arrival(windy, -4, 0) / 1.5, `downwind sooner (${arrival(windy, 4, 0).toFixed(1)} against ${arrival(windy, -4, 0).toFixed(1)} days)`);
  // Burning from when it arrives, with the source's life counted from then.
  const t = arrival(g, 2, 0);
  assert.equal(spreadValue(g, s, 2, 0, t - 0.1, strengthAt), 0, 'not yet');
  assert.ok(spreadValue(g, s, 2, 0, t + s.rise + 0.1, strengthAt) > 0.8 * s.intensity, 'burning');
  assert.equal(spreadValue(g, s, 3.5, 0, 50, strengthAt), 0, 'the lake never burns');
});

test('lava flows downhill from its source and does not climb', () => {
  // A cone 3,000 m high around (0, 0), with a valley running east.
  const cone = world((lon, lat) => Math.max(50, 3000 - 600 * Math.hypot(lon, lat)) - (lon > 0 && Math.abs(lat) < 0.75 ? 300 : 0));
  const g = spreadRaster('lava', src({ radiusKm: 600, grow: 5, seed: 2 }), [0.6, 0], cone, 'cone', R);
  assert.ok(arrival(g, 2, 0) < NEVER, 'down the valley');
  assert.equal(arrival(g, -0.5, 0), NEVER, 'not up to the summit');
  assert.ok(arrival(g, 1, 0) < arrival(g, 2.5, 0), 'farther down, later');
});

test('a flood fills the low ground up to the ridges around it, as deep as the water stands; the sea is not drawn', () => {
  // A valley at 100 m, a ridge of 200 m east of it, another valley at 100 m beyond; the sea to the west.
  const vale = world((lon) => (lon < -3 ? -50 : lon > 1 && lon < 1.6 ? 200 : 100));
  const s = src({ radiusKm: 700, rise: 1, hold: 5, decay: 3, intensity: 50 });
  const g = spreadRaster('flood', s, [0, 0], vale, 'vale', R);
  const v = (lon: number, intensity: number) => spreadValue(g, { ...s, intensity }, lon, 0, 2, strengthAt);
  assert.ok(Math.abs(v(-1, 50) - 50) < 2, `the valley under 50 m of water (${v(-1, 50).toFixed(1)})`);
  assert.equal(v(3, 50), 0, 'the ridge holds the water back from the next valley');
  assert.ok(v(3, 150) > 140, 'water 150 m high spills over it');
  assert.equal(v(-5, 50), 0, 'the sea is not drawn as flooded');
  assert.equal(spreadValue(g, s, -1, 0, 0, strengthAt), 0, 'nothing before it rises');
  assert.ok(spreadValue(g, s, -1, 0, 7, strengthAt) < 40, 'receding as it fades');
});
