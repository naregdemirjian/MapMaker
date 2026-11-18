// Rivers (Stage 8, D99): Earth's from Natural Earth, ranked by size; a planet's worked out from its
// heights, flowing downhill to the sea or into another river, the same every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { riversOf } from '../src/terrain/rivers.ts';
import { decodeRivers, type BasemapFile } from '../src/render-engine/basemap.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';
import { generatePlanet, planetParamsOf } from '../src/terrain/planet.ts';
import { SHOW_ITEMS } from '../src/world-model/world-settings.ts';

const W = 360, H = 180;
/** A world of 1° cells: heights from a function of longitude and latitude (cell centres). */
const world = (f: (lon: number, lat: number) => number): ElevationGrid => {
  const data = new Int16Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) data[j * W + i] = Math.round(f(-179.5 + i, 89.5 - j));
  return { width: W, height: H, step: 1, data };
};
const at = (g: ElevationGrid, lon: number, lat: number) => g.data[Math.floor(90 - lat) * W + ((Math.floor(lon + 180) % W) + W) % W];
/** An island: a cone 3,000 m high and 20° across, with ridges so the water gathers in valleys. */
const island = world((lon, lat) => {
  const r = Math.hypot(lon, lat);
  return r > 20 ? -1000 : 3000 * (1 - r / 20) + 150 * Math.cos(6 * Math.atan2(lat, lon)) * (r / 20) + 1;
});

test('a planet\'s rivers run downhill from their sources to the sea or into another river', () => {
  const { lines, ranks } = riversOf(island, 0.05);
  assert.ok(lines.coordinates.length >= 4, `rivers found (${lines.coordinates.length})`);
  assert.equal(ranks.length, lines.coordinates.length);
  const sea = (p: number[]) => at(island, p[0], p[1]) <= 0;
  const onRiver = new Set<string>();
  for (const line of lines.coordinates) for (const p of line) onRiver.add(`${p[0]},${p[1]}`);
  for (const line of lines.coordinates) {
    for (let q = 1; q < line.length; q++) {
      const a = at(island, line[q - 1][0], line[q - 1][1]), b = at(island, line[q][0], line[q][1]);
      assert.ok(b <= a, `downhill (${a} m then ${b} m)`);
      assert.ok(Math.abs(line[q][0] - line[q - 1][0]) <= 1.01 && Math.abs(line[q][1] - line[q - 1][1]) <= 1.01, 'from cell to neighbouring cell');
    }
    const end = line[line.length - 1];
    // It ends in the sea, or where it meets a river traced before it (a point of another line).
    const joins = lines.coordinates.some((other) => other !== line && other.some((p) => p[0] === end[0] && p[1] === end[1]));
    assert.ok(sea(end) || joins, `ends at the sea or a river (${end})`);
  }
  for (const r of ranks) assert.ok(Number.isInteger(r) && r >= 0 && r <= 9);
  assert.equal(Math.min(...ranks), 0, 'the greatest river ranks 0');
});

test('hollows are filled: water caught in a basin still finds its way to the sea', () => {
  // A plateau sloping to the sea in the west, with a deep basin in the middle and a rim around it.
  const basin = world((lon, lat) => {
    if (Math.abs(lat) > 30 || lon < -40 || lon > 40) return -500;
    const r = Math.hypot(lon - 10, lat);
    return 400 + (lon + 40) * 20 - (r < 8 ? 1200 * (1 - r / 8) : 0);
  });
  const { lines } = riversOf(basin, 0.05);
  assert.ok(lines.coordinates.length > 0);
  for (const line of lines.coordinates) {
    const end = line[line.length - 1];
    const joins = lines.coordinates.some((other) => other !== line && other.some((p) => p[0] === end[0] && p[1] === end[1]));
    assert.ok(at(basin, end[0], end[1]) <= 0 || joins, `no river ends in the basin (${end})`);
  }
});

test('the same heights always give the same rivers; a world of sea or of land alone has none', () => {
  const planet = generatePlanet(planetParamsOf({ seed: 11, preset: 'earthlike' })!);
  const a = riversOf(planet), b = riversOf(planet);
  assert.deepEqual(a, b);
  assert.ok(a.lines.coordinates.length > 50, `a planet has many rivers (${a.lines.coordinates.length})`);
  // Longitudes run on across the 180th meridian (no line jumps from one edge of the map to the other).
  for (const line of a.lines.coordinates) for (let q = 1; q < line.length; q++) assert.ok(Math.abs(line[q][0] - line[q - 1][0]) < 1);
  assert.deepEqual(riversOf(world(() => -100)).lines.coordinates, []);
  assert.deepEqual(riversOf(world(() => 100)).lines.coordinates, []);
});

test('Earth\'s rivers: Natural Earth at 1:50m and 1:10m, ranked; the Rivers item in Show', () => {
  for (const [scale, least] of [['50m', 300], ['10m', 1500]] as const) {
    const file = JSON.parse(readFileSync(`data/natural-earth/rivers-${scale}.json`, 'utf8')) as BasemapFile;
    const rivers = decodeRivers(file);
    assert.ok(rivers.lines.coordinates.length > least, `${scale}: ${rivers.lines.coordinates.length} lines`);
    assert.equal(rivers.ranks.length, rivers.lines.coordinates.length);
    assert.ok(rivers.ranks.every((r) => r >= 0 && r <= 12));
    assert.ok(rivers.ranks.some((r) => r <= 1), 'the greatest rivers are there');
    // The Amazon at Manaus, the Nile in Egypt.
    const near = (lon: number, lat: number, d: number) => rivers.lines.coordinates.some((l) => l.some((p) => Math.abs(p[0] - lon) < d && Math.abs(p[1] - lat) < d));
    assert.ok(near(-60, -3.1, 0.4), 'the Amazon at Manaus');
    assert.ok(near(31, 30.5, 1), 'the Nile in Egypt');
    assert.ok(!near(-40, 30, 5), 'no river in the middle of the Atlantic');
  }
  assert.ok(SHOW_ITEMS.some((i) => i.key === 'rivers'));
});
