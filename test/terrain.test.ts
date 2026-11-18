// Earth's elevation (Stage 8, D94): the grid's file format, sampling between cells, and the bundled
// grid at places whose height is known (land, sea floor and the ice sheets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { decodeTerrain, terrainHeader, terrainPlanes, heightAt, cellHeight, type ElevationGrid } from '../src/terrain/grid.ts';

const inflate = (z: Uint8Array) => new Uint8Array(inflateSync(z));
const fileOf = (grid: ElevationGrid) => new Uint8Array(Buffer.concat([terrainHeader(grid), deflateSync(terrainPlanes(grid))]));

test('a grid comes back from its file exactly, the extremes included', async () => {
  const w = 64, h = 32, data = new Int16Array(w * h);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < data.length; k++) data[k] = Math.round(2000 * Math.sin(k / 50) + (rnd() - 0.5) * 600);
  // Neighbours at opposite ends of the range: residuals that only fit modulo 2^16.
  data.set([32767, -32768], 0);
  data.set([-32768, 32767], w);
  data.set([32767, -32768, 32767], 5 * w + 9);
  const grid = { width: w, height: h, step: 2, data };
  const back = await decodeTerrain(fileOf(grid), inflate);
  assert.deepEqual([back.width, back.height, back.step], [w, h, 2]);
  assert.deepEqual(Array.from(back.data), Array.from(data));
  // Not a terrain file, or cut short.
  await assert.rejects(decodeTerrain(new TextEncoder().encode('PK\x03\x04 not terrain at all'), inflate), /Not a Map Maker terrain file/);
  const file = fileOf(grid);
  await assert.rejects(decodeTerrain(file.subarray(0, file.length - 40), inflate));
});

test('heights between cell centres are interpolated; longitudes wrap and latitudes stop at the poles', () => {
  // 4 × 2 cells of 90° × 90°: centres at longitudes -135, -45, 45, 135 and latitudes 45, -45.
  const grid = { width: 4, height: 2, step: 10, data: Int16Array.from([0, 10, 20, 30, 40, 50, 60, 70]) };
  assert.equal(heightAt(grid, -135, 45), 0);
  assert.equal(heightAt(grid, -45, -45), 500);
  assert.equal(heightAt(grid, -90, 45), 50); // halfway between two centres
  assert.equal(heightAt(grid, 0, 0), (100 + 200 + 500 + 600) / 4);
  assert.equal(heightAt(grid, 180, 45), 150); // between the last column and the first
  assert.equal(heightAt(grid, -180, 45), 150);
  assert.equal(heightAt(grid, -135, 90), 0); // beyond the northernmost centre: that row
  assert.equal(heightAt(grid, -135, -90), 400);
  assert.equal(cellHeight(grid, 100, -10), 700);
  assert.equal(cellHeight(grid, 100 + 360, -10), 700);
  assert.equal(cellHeight(grid, -180, 90), 0);
  assert.equal(cellHeight(grid, 179.99, -90), 700);
});

test("Earth's grid has mountains, deep sea and ice sheets where they are", async () => {
  const earth = await decodeTerrain(new Uint8Array(readFileSync(new URL('../data/terrain/earth-4096.bin', import.meta.url))), inflate);
  assert.deepEqual([earth.width, earth.height, earth.step], [4096, 2048, 1]);
  // Cells are means over about 10 km, so peaks come out lower and deeps shallower than at a point.
  const places: Array<[string, number, number, number, number]> = [
    ['Everest', 86.925, 27.988, 5000, 8849],
    ['the Tibetan plateau', 88, 33, 4000, 6500],
    ['Lake Titicaca', -69.4, -15.8, 3500, 4100],
    ['Denver', -104.99, 39.74, 1400, 1900],
    ['London', -0.1, 51.5, 0, 150],
    ['the Amazon', -60, -3, 0, 200],
    ['the Dead Sea', 35.5, 31.5, -1000, -300],
    ['the Challenger Deep', 142.2, 11.35, -11000, -8000],
    ['the middle of the North Atlantic', -40, 30, -6500, -2000],
    ['the Arctic Ocean at the pole', 0, 89.95, -4500, -1000],
    ['the summit of Greenland', -38.46, 72.58, 2800, 3400],
    ['the South Pole', 0, -89.95, 2600, 3000],
    ['Vostok', 106.8, -78.46, 3000, 3800],
    ['Dome A', 77.1, -80.37, 3700, 4200],
    ['the Ross Ice Shelf', -175, -81, 1, 300],
    ['Vatnajökull (an ice cap outside the ice sheets)', -16.8, 64.4, 1000, 2110],
  ];
  for (const [name, lon, lat, lo, hi] of places) {
    const h = cellHeight(earth, lon, lat);
    assert.ok(h >= lo && h <= hi, `${name}: ${h} m, expected ${lo} to ${hi}`);
  }
  // Greenland and Antarctica are land; the Southern Ocean and the Arctic are not.
  let ice = 0, cells = 0;
  for (let lat = -89.5; lat <= -79; lat += 0.5) for (let lon = -179.5; lon < 180; lon += 1) { cells++; if (cellHeight(earth, lon, lat) > 0) ice++; }
  assert.ok(ice / cells > 0.99, `Antarctica south of 79° S above sea level: ${((100 * ice) / cells).toFixed(1)}%`);
  assert.ok(cellHeight(earth, 0, -55) < -1000 && cellHeight(earth, 0, 80) < -1000);
});
