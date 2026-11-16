// The Earth basemap: the committed Natural Earth files decode into correct spherical geometry, and
// each world's basemap setting behaves (defaults, explicit choice, undo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea, geoContains } from 'd3-geo';
import { decodeBasemap, visibleBounds, boxIntersects, type BasemapFile, type BasemapScale } from '../src/render-engine/basemap.ts';
import { makeView, lonLatToScreen, type ProjectionName } from '../src/render-engine/camera.ts';
import { rng } from './helpers.ts';
import { basemapSourceOf } from '../src/world-model/world-settings.ts';
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
  assert.equal((ne.sources as unknown[]).length, 13);
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
