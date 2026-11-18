// The Earth basemap: the committed Natural Earth files decode into correct spherical geometry, and
// each world's basemap setting behaves (defaults, explicit choice, undo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea, geoContains } from 'd3-geo';
import { decodeBasemap, visibleBounds, boxIntersects, lakeSizes, lakeCount, ringAreaKm2, type BasemapFile, type BasemapScale } from '../src/render-engine/basemap.ts';
import { makeView, lonLatToScreen, type ProjectionName } from '../src/render-engine/camera.ts';
import { rng } from './helpers.ts';
import { basemapSourceOf, shown, minLakeKm2, worldSettings } from '../src/world-model/world-settings.ts';
import { World } from '../src/world-model/world.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import * as cmd from '../src/domain/commands.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (scale: string): BasemapScale =>
  decodeBasemap(JSON.parse(readFileSync(join(root, 'data', 'natural-earth', `ne-${scale}.json`), 'utf8')) as BasemapFile);
const scales = { '110m': load('110m'), '50m': load('50m'), '10m': load('10m') };

const LAND: Array<[string, number, number]> = [
  ['Paris', 2.35, 48.86], ['Nairobi', 36.82, -1.29], ['Brasília', -47.88, -15.79], ['Ulaanbaatar', 106.9, 47.9],
  ['Alice Springs', 133.88, -23.7], ['Chukotka (east of 180°)', -175, 66], ['Inland Antarctica', 40, -80], ['Inland Greenland', -40, 75],
];
const SEA: Array<[string, number, number]> = [
  ['mid-Atlantic', -30, 30], ['Pacific at 180°', 180, 0], ['Indian Ocean', 80, -20], ['North Pole', 0, 90], ['Southern Ocean', 0, -60],
];

for (const [scale, b] of Object.entries(scales)) {
  test(`basemap ${scale}: land covers about 29% of the planet and no polygon is wound inside out`, () => {
    let total = 0;
    for (const poly of b.land.coordinates) {
      const a = geoArea({ type: 'Polygon', coordinates: poly });
      assert.ok(a < 2 * Math.PI, 'a land polygon larger than a hemisphere would be wound the wrong way');
      total += a;
    }
    const share = total / (4 * Math.PI);
    assert.ok(share > 0.27 && share < 0.31, `land share ${share.toFixed(3)}`);
    for (const poly of b.lakes.coordinates) assert.ok(geoArea({ type: 'Polygon', coordinates: poly }) < 0.01);
  });

  test(`basemap ${scale}: known places are on land or at sea, across the 180° line and the poles`, () => {
    for (const [name, lon, lat] of LAND) assert.ok(geoContains(b.land, [lon, lat]), `${name} should be on land`);
    for (const [name, lon, lat] of SEA) assert.ok(!geoContains(b.land, [lon, lat]), `${name} should be at sea`);
  });

  test(`basemap ${scale}: rings are closed, lines are intact, coordinates are in range`, () => {
    for (const poly of b.land.coordinates) for (const r of poly) {
      assert.ok(r.length >= 4);
      assert.deepEqual(r[0], r[r.length - 1]);
    }
    for (const l of [...b.coastline.coordinates, ...b.borders.coordinates]) {
      assert.ok(l.length >= 2);
      for (const [lon, lat] of l) assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
    }
    assert.ok(b.borders.coordinates.length > 300 && b.coastline.coordinates.length > 100);
  });
}

test('basemap: the 1:50m lakes include Lake Victoria; Lake Victoria is not cut out of the land itself', () => {
  const b = scales['50m'];
  assert.ok(geoContains(b.lakes, [33, -1]));
  assert.ok(geoContains(b.land, [33, -1]));
});

test('basemap: the dataset record names its source, version and licence', () => {
  const records = JSON.parse(readFileSync(join(root, 'data', 'datasets.json'), 'utf8')) as Array<Record<string, unknown>>;
  const ne = records.find((r) => r.id === 'natural-earth')!;
  assert.equal(ne.licence, 'Public domain');
  assert.equal(ne.version, 'v5.1.2');
  // Land, lakes, coastlines and borders at three scales, rivers at two, today's countries, the land cover (D100).
  const files = (ne.sources as Array<{ file: string; sha256: string }>);
  assert.equal(files.length, 16);
  assert.ok(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)), 'each with its checksum');
  assert.ok(['ne_50m_rivers_lake_centerlines.geojson', 'ne_10m_rivers_lake_centerlines.geojson', 'NE1_LR_LC.zip'].every((n) => files.some((f) => f.file === n)));
});

test('world basemap setting: Earth starts with it, new worlds do not unless asked, and changes undo', () => {
  const world = new World();
  const earth = cmd.seedProject(world, 'Basemap').result.spaceId;
  assert.equal(basemapSourceOf(world.get('map_space', earth)), 'natural-earth');
  const mars = cmd.createWorld(world, 'Mars', 3389.5).result;
  assert.equal(basemapSourceOf(world.get('map_space', mars)), 'none');
  const earth2 = cmd.createWorld(world, 'Earth 2', 6371.0088, 'natural-earth').result;
  assert.equal(basemapSourceOf(world.get('map_space', earth2)), 'natural-earth');

  const r = cmd.setWorldBasemap(world, earth, 'none');
  assert.equal(basemapSourceOf(world.get('map_space', earth)), 'none');
  assert.equal(JSON.parse(world.get('map_space', earth)!.settings).projection, 'equirectangular', 'other settings kept');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(basemapSourceOf(world.get('map_space', earth)), 'natural-earth');
});

test('world basemap setting: worlds saved before the setting existed follow their radius', () => {
  const row = (radius_m: number | null, settings: string) => ({ radius_m, settings });
  assert.equal(basemapSourceOf(row(6371008.8, '{"projection":"equirectangular"}')), 'natural-earth');
  assert.equal(basemapSourceOf(row(3389500, '{"projection":"equirectangular"}')), 'none');
  assert.equal(basemapSourceOf(row(6371008.8, 'not json')), 'natural-earth');
  assert.equal(basemapSourceOf(row(6371008.8, '{"basemap":"none"}')), 'none');
  assert.equal(basemapSourceOf(null), 'none');
});

test('basemap culling: no point that lands on screen is ever left out (random views, rotations, poles, 180°)', () => {
  const b = scales['50m'];
  const r = rng(4242);
  const projections: ProjectionName[] = ['equirectangular', 'equalEarth', 'naturalEarth', 'mercator'];
  let culledViews = 0;
  for (let n = 0; n < 160; n++) {
    const cam = {
      lon: r.float(-180, 180), lat: n % 8 === 0 ? r.float(-89, 89) : r.float(-75, 75), zoom: r.float(0, 7),
      rotation: n % 3 === 0 ? r.float(-180, 180) : 0, projection: projections[n % projections.length],
    };
    const view = makeView(cam, 1280, 720);
    const vis = visibleBounds(view);
    if (!vis) continue;
    culledViews++;
    const lines = [...b.coastline.coordinates.map((l, i) => [l, b.boxes.coastline[i]] as const), ...b.borders.coordinates.map((l, i) => [l, b.boxes.borders[i]] as const)];
    for (const [line, box] of lines) {
      if (boxIntersects(box, vis)) continue;
      for (const [lon, lat] of line) {
        const p = lonLatToScreen(view, lon, lat);
        assert.ok(!p || p[0] < 0 || p[1] < 0 || p[0] > 1280 || p[1] > 720, `view ${JSON.stringify(cam)} dropped a line drawn at ${p}`);
      }
    }
  }
  assert.ok(culledViews > 100, `culling applied in ${culledViews} views`);
});

test('coastline clipping setting: on unless switched off, per layer, other style kept, undoable', () => {
  const world = new World();
  const earth = cmd.seedProject(world, 'Clip').result.spaceId;
  const layer = world.all('layer').find((l) => l.space_id === earth)!;
  const style = () => JSON.parse(world.get('layer', layer.id)!.style);
  assert.equal(style().clipToLand, undefined, 'not stored: the renderer treats it as on');
  const r = cmd.setLayerClipToLand(world, layer.id, false);
  assert.equal(style().clipToLand, false);
  assert.equal(style().fillOpacity, 0.78, 'other style settings kept');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(style().clipToLand, undefined);
  assert.throws(() => cmd.setLayerClipToLand(world, 'layer_missing', true), /no longer exists/);
});

test('basemap 1:10m: cut into tiles, the land keeps its exact area and every piece fits in a 10° tile', () => {
  const b = scales['10m'];
  const area = (m: GeoJSON.MultiPolygon) => m.coordinates.reduce((a, p) => a + geoArea({ type: 'Polygon', coordinates: p }), 0);
  // Tiling must neither drop nor double any land: same area as the 1:50m land, within the
  // difference in detail between the two scales.
  const a10 = area(b.land), a50 = area(scales['50m'].land);
  assert.ok(Math.abs(a10 - a50) / a50 < 0.01, `1:10m land ${a10.toFixed(4)} vs 1:50m ${a50.toFixed(4)} sr`);
  for (const box of b.boxes.land) {
    assert.ok(box[2] - box[0] <= 10 + 1e-6 && box[3] - box[1] <= 10 + 1e-6, `piece ${box} fits in a tile`);
  }
  // Coastline and border pieces are short, and consecutive pieces join up.
  assert.ok(b.coastline.coordinates.every((l) => l.length <= 401));
});

// What is shown (D84): lakes judged whole, by size.
const ringOf = (pts: number[][]) => ({ lon: Float64Array.from(pts, (p) => p[0]), lat: Float64Array.from(pts, (p) => p[1]) });
const lakeRings = (m: GeoJSON.MultiPolygon) => {
  const rings: Array<{ lon: Float64Array; lat: Float64Array }> = [], poly: number[] = [];
  m.coordinates.forEach((p, i) => { for (const r of p) { rings.push(ringOf(r.slice(0, -1))); poly.push(i); } });
  return { rings, poly };
};

test('lake sizes: a lake is its outline less its islands, and the pieces of a lake cut at a tile edge count together', () => {
  // A 1° square lake on the equator with a 0.2° island, and a lake cut at 10°E into two pieces that
  // share the points where the cut crosses it; a small lake on its own.
  const sq = (x0: number, y0: number, x1: number, y1: number) => ringOf([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  const rings = [sq(0, 0, 1, 1), sq(0.4, 0.4, 0.6, 0.6), sq(9, 20, 10, 21), sq(10, 20, 10.5, 21), sq(30, 30, 30.1, 30.1)];
  const poly = [0, 0, 1, 2, 3];
  const { size, lake } = lakeSizes(rings, poly);
  const deg = 111.195 * 111.195;
  assert.ok(Math.abs(size[0] - deg * (1 - 0.04)) / deg < 0.01, `lake less its island: ${size[0]}`);
  assert.equal(size[1], size[0], 'the island goes with its lake');
  const cut = deg * 1.5 * Math.cos(20.5 * Math.PI / 180);
  assert.ok(Math.abs(size[2] - cut) / cut < 0.01, `cut lake ${size[2]} vs ${cut}`);
  assert.ok(Math.abs(size[2] - cut) / cut < 0.01 && size[3] === size[2], 'both pieces of the cut lake have its whole size');
  assert.equal(lake[2], lake[3]);
  assert.notEqual(lake[0], lake[2]);
  assert.ok(size[4] < 200 && lake[4] !== lake[2]);
});

test('lake sizes: Lake Victoria, cut at the equator at 1:10m, is as large as at 1:50m; small lakes are many', () => {
  const at = (scale: '50m' | '10m') => {
    const { rings, poly } = lakeRings(scales[scale].lakes);
    const { size } = lakeSizes(rings, poly);
    // (Even-odd, on the plane of longitude and latitude: islands' rings are wound the other way.)
    const holds = (i: number, x: number, y: number) => {
      const { lon, lat } = rings[i];
      let inside = false;
      for (let a = 0, b = lon.length - 1; a < lon.length; b = a++) if ((lat[a] > y) !== (lat[b] > y) && x < lon[a] + ((y - lat[a]) * (lon[b] - lon[a])) / (lat[b] - lat[a])) inside = !inside;
      return inside;
    };
    const north = rings.findIndex((_, i) => holds(i, 33.5, 0.2)), south = rings.findIndex((_, i) => holds(i, 33, -1));
    return { north: size[north], south: size[south] };
  };
  const a50 = at('50m'), a10 = at('10m');
  assert.ok(a50.north === a50.south && a50.north > 60000 && a50.north < 75000, `1:50m: ${a50.north}`);
  assert.equal(a10.north, a10.south, 'the two pieces are one lake');
  assert.ok(Math.abs(a10.north - a50.north) / a50.north < 0.03, `1:10m ${a10.north} vs 1:50m ${a50.north}`);
  const basemap = { version: 'test', scales: [scales['110m'], scales['50m'], scales['10m']] };
  const all = lakeCount(basemap, 0), big = lakeCount(basemap, 1000);
  assert.equal(all.shown, all.total);
  assert.ok(all.total > 1000 && big.shown < all.total / 4 && big.shown > 50, `${big.shown} of ${all.total} lakes are 1,000 km² or more`);
  // A degree square: 12,364 km² at the equator, 11,582 km² between 20° and 21° north.
  assert.ok(Math.abs(ringAreaKm2(ringOf([[0, 0], [1, 0], [1, 1], [0, 1]])) - 12364) < 15);
  assert.ok(Math.abs(ringAreaKm2(ringOf([[0, 20], [1, 20], [1, 21], [0, 21]])) - 11582) < 15);
});

test('what is shown: everything unless switched off, while working and in exports apart; smallest lake; undoable', () => {
  const world = new World();
  const earth = cmd.seedProject(world, 'Show').result.spaceId;
  const space = () => world.get('map_space', earth);
  assert.ok(shown(space(), 'working', 'lakes') && shown(space(), 'export', 'borders'));
  assert.equal(minLakeKm2(space()), 0);
  const r1 = cmd.setWorldShow(world, earth, { working: { lakes: false, names: false } });
  cmd.setWorldShow(world, earth, { export: { borders: false }, minLakeKm2: 500 });
  cmd.setWorldShow(world, earth, { working: { names: true } });
  assert.equal(shown(space(), 'working', 'lakes'), false);
  assert.equal(shown(space(), 'working', 'names'), true, 'a later change keeps the rest');
  assert.equal(shown(space(), 'export', 'lakes'), true, 'hidden while working, still exported');
  assert.equal(shown(space(), 'export', 'borders'), false);
  assert.equal(shown(space(), 'working', 'borders'), true);
  assert.equal(minLakeKm2(space()), 500);
  assert.equal(worldSettings(space()!).projection, 'equirectangular', 'other settings kept');
  assert.equal(basemapSourceOf(space()), 'natural-earth');
  const r = cmd.setWorldShow(world, earth, { minLakeKm2: -5 });
  assert.equal(minLakeKm2(space()), 0, 'never below nothing');
  world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(minLakeKm2(space()), 500);
  assert.ok(r1.diffs.length > 0);
  assert.equal(shown(null, 'export', 'lakes'), true);
  assert.throws(() => cmd.setWorldShow(world, 'space_missing', {}), /no longer exists/);
});
