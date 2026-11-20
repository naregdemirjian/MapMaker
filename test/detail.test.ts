// Close-up terrain (Stage 8, D101): which Terrain Tiles a view needs, their heights, and the grid of
// the region laid from them (the bundled grid kept under the ice sheets, where sculpted, and where a
// tile could not be had).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileXY, tileLonLat, terrariumHeights, detailNeed, buildDetail, underIce, detailHeightAt, TILE, type DetailNeed } from '../src/terrain/detail.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';

test('tile coordinates of places and back; heights from a tile\'s colours', () => {
  assert.deepEqual(tileXY(0, 0, 1), [1, 1]);
  const [x, y] = tileXY(-180, 85.0511, 0);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-4);
  for (const [lon, lat] of [[2.35, 48.85], [-70.5, -33.4], [179.9, 10], [-179.9, -60]]) {
    const [tx, ty] = tileXY(lon, lat, 9), back = tileLonLat(tx, ty, 9);
    assert.ok(Math.abs(back[0] - lon) < 1e-9 && Math.abs(back[1] - lat) < 1e-9, `${lon}, ${lat}`);
  }
  assert.deepEqual(Array.from(terrariumHeights(new Uint8Array([128, 0, 0, 255, 128, 10, 128, 255, 127, 255, 0, 255]))), [0, 10.5, -1]);
  assert.ok(underIce(-40, 72) && underIce(100, -75) && !underIce(10, 46) && !underIce(-80, 70), 'the ice sheets of Greenland and Antarctica');
});

test('the tiles a view needs: none while the bundled grid will do; about a screen pixel each; fewer when the region is wide', () => {
  const alps = { west: 5, south: 44, east: 15, north: 49 };
  assert.equal(detailNeed(alps, 10000), null, 'zoomed out: the bundled grid');
  const need = detailNeed(alps, 300)!;
  assert.equal(need.z, 7, 'zooms 9 and 8 would take too many tiles (140 and 56): zoom 7');
  assert.ok((need.x1 - need.x0 + 1) * (need.y1 - need.y0 + 1) <= 48);
  assert.equal(detailNeed({ west: 9, south: 46, east: 11, north: 47 }, 300)!.z, 9, 'a smaller region: zoom 9, its pixels finer than the screen\'s');
  const [w] = tileLonLat(need.x0, need.y0, need.z), [e] = tileLonLat(need.x1 + 1, need.y1 + 1, need.z);
  assert.ok(w <= 5 && e >= 15, 'the region is covered');
  const close = detailNeed({ west: 7.1, south: 45.95, east: 7.5, north: 46.15 }, 40)!;
  assert.equal(close.z, 12, 'close in: the finest zoom fetched');
  // Across the 180th meridian: the columns run past the last and round again.
  const fiji = detailNeed({ west: 176, south: -19, east: 182, north: -15 }, 1000)!;
  assert.ok(fiji.x1 >= 2 ** fiji.z && fiji.x0 < 2 ** fiji.z, `columns ${fiji.x0}..${fiji.x1} at zoom ${fiji.z}`);
  assert.equal(detailNeed({ west: -100, south: -40, east: 100, north: 60 }, 3000), null, 'a whole continent: not worth fetching');
});

const W = 720, H = 360;
/** A bundled grid of half-degree cells, all at one height. */
const flat = (m: number): ElevationGrid => ({ width: W, height: H, step: 1, data: new Int16Array(W * H).fill(m) });
/** Tiles whose heights follow f(lon, lat) at each pixel's centre. */
const tiles = (z: number, f: (lon: number, lat: number) => number, missing?: (x: number, y: number) => boolean) => (x: number, y: number) => {
  if (missing?.(x, y)) return null;
  const out = new Float32Array(TILE * TILE);
  for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) {
    const [lon, lat] = tileLonLat(x + (px + 0.5) / TILE, y + (py + 0.5) / TILE, z);
    out[py * TILE + px] = f(lon, lat);
  }
  return out;
};
const at = (g: ReturnType<typeof buildDetail>, lon: number, lat: number) => g.data[Math.floor((g.north - lat) / g.dLat) * g.width + Math.floor((lon - g.west) / g.dLon)];

test('a region\'s grid is laid from its tiles: heights where they are, the bundled ones under ice, where sculpted and where a tile is missing', () => {
  const ridge = (lon: number, lat: number) => 200 + 1500 * Math.exp(-(((lon - 10) / 0.05) ** 2)) + 100 * lat;
  const need = detailNeed({ west: 9.5, south: 45.6, east: 10.5, north: 46.4 }, 200)!;
  const base = { grid: flat(50), key: 'flat' };
  const g = buildDetail(need, tiles(need.z, ridge), base);
  assert.ok(g.width > 100 && g.height > 100 && g.west <= 9.5 && g.north >= 46.4);
  assert.ok(Math.abs(g.dLat - g.dLon * Math.cos((46 * Math.PI) / 180)) < 0.1 * g.dLat, 'cells square on the ground');
  for (const [lon, lat] of [[9.7, 46.1], [10.0, 46.0], [10.3, 45.8]]) {
    const want = ridge(lon, lat), got = at(g, lon, lat);
    assert.ok(Math.abs(got - want) < 0.06 * want + 30, `${lon}, ${lat}: ${got} m (the tiles say ${Math.round(want)})`);
  }
  assert.ok(at(g, 10.0, 46.0) > 1400, 'the narrow ridge (5 km across) is there, which the bundled grid could not hold');
  assert.equal(g.key, `detail:${need.key}:flat`);
  assert.equal(g.whole, true, 'every height from the tiles, to the region\'s edge (D176)');
  assert.equal(detailHeightAt(g, 10.0, 46.0), at(g, 10.0, 46.0));
  assert.equal(detailHeightAt(g, 12, 46), null, 'outside the region');
  // A missing tile: there, the bundled heights.
  const [mx, my] = tileXY(9.6, 46.3, need.z).map(Math.floor);
  const holed = buildDetail(need, tiles(need.z, ridge, (x, y) => x === mx && y === my), base);
  assert.equal(at(holed, 9.6, 46.3), 50);
  assert.equal(holed.whole, false, 'not fine enough everywhere to draw the coast close in');
  assert.ok(Math.abs(at(holed, 10.3, 45.8) - ridge(10.3, 45.8)) < 0.06 * ridge(10.3, 45.8) + 30, 'elsewhere the tiles');
  // Sculpted cells keep the sculpted heights.
  const touched = new Uint8Array(W * H);
  touched[Math.floor((90 - 46.05) * 2) * W + Math.floor((10.05 + 180) * 2)] = 1;
  const sculpted = buildDetail(need, tiles(need.z, ridge), { ...base, touched });
  assert.equal(at(sculpted, 10.05, 46.05), 50, 'sculpted: the sculpted heights');
  // Under the ice of Greenland: the bundled grid's ice surface.
  const ice = detailNeed({ west: -41, south: 71.8, east: -39, north: 72.2 }, 300)!;
  const icy = buildDetail(ice, tiles(ice.z, () => -200), { grid: flat(3000), key: 'ice' });
  assert.equal(at(icy, -40, 72), 3000);
});

test('a region across the 180th meridian runs on round the planet', () => {
  const need: DetailNeed = detailNeed({ west: 179, south: -17.5, east: 181, north: -16.5 }, 600)!;
  const g = buildDetail(need, tiles(need.z, (lon) => (Math.abs(lon) > 179.9 ? 900 : 100)), { grid: flat(0), key: 'fiji' });
  assert.ok(g.west < 180 && g.west + g.width * g.dLon > 180);
  assert.ok(at(g, 179.95, -17) === 900 || Math.abs(at(g, 179.95, -17) - 900) < 50, `the meridian's ridge (${at(g, 179.95, -17)})`);
  assert.ok(Math.abs(at(g, 180.5, -17) - 100) < 5, 'and beyond it');
});

test('close in on the Earth, the finer heights draw the coast (D176): when they are all from the tiles, fine enough, at today\'s sea level and unsculpted', async () => {
  const { closeCoastOf, CLOSE_COAST_ZOOM } = await import('../src/render-engine/map-renderer.ts');
  const need = detailNeed({ west: 28.9, south: 41.0, east: 29.0, north: 41.05 }, 10)!;
  assert.ok(need.z >= CLOSE_COAST_ZOOM, `a city's view takes tiles of zoom ${need.z}`);
  const whole = buildDetail(need, tiles(need.z, () => 40), { grid: flat(0), key: 'e' });
  const base = { grid: flat(0), key: 'e', look: null } as const;
  const basemap = {};
  assert.equal(closeCoastOf({ ...base, detail: whole }, basemap, 0), true);
  assert.equal(closeCoastOf({ ...base, detail: whole }, basemap, 12), false, 'another sea level: the terrain decides anyway');
  assert.equal(closeCoastOf({ ...base, detail: whole }, null, 0), false, 'no coastline (a planet): the terrain decides anyway');
  assert.equal(closeCoastOf({ ...base, detail: { ...whole, whole: false } }, basemap, 0), false, 'a tile missing: the coastline');
  assert.equal(closeCoastOf({ ...base, detail: { ...whole, z: CLOSE_COAST_ZOOM - 1 } }, basemap, 0), false, 'coarser heights: the coastline');
  assert.equal(closeCoastOf({ ...base, detail: whole, override: { data: new Uint8Array(1), key: 's' } }, basemap, 0), false, 'sculpted: as before');
  assert.equal(closeCoastOf({ ...base, detail: null }, basemap, 0), false);
});
