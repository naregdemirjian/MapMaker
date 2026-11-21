// How terrain is drawn (Stage 8, D95): the stored look, the palettes, the shader's arithmetic (the
// inverse projections checked against d3-geo, the slope shading) and the command that turns it on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoEquirectangularRaw, geoMercatorRaw, geoEqualEarthRaw, geoNaturalEarth1Raw } from 'd3-geo';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { terrainLook, terrainSourceOf, worldSettings } from '../src/world-model/world-settings.ts';
import { terrainLookOf, rampAt, rampUniform, invertPlane, slopeShade, reliefExaggeration, reliefFade, PALETTES, DEFAULT_TERRAIN_LOOK, LIGHT } from '../src/terrain/look.ts';
import { smoothHeightAt, heightAt, type ElevationGrid } from '../src/terrain/grid.ts';
import { PASS_DEFS } from '../src/presentation/export-driver.ts';
import { ALL_PASSES } from '../src/render-engine/map-renderer.ts';

test('a stored look is completed and checked', () => {
  assert.equal(terrainLookOf(undefined), null);
  assert.equal(terrainLookOf('relief'), null);
  assert.deepEqual(terrainLookOf({}), DEFAULT_TERRAIN_LOOK);
  const l = terrainLookOf({ colours: false, strength: 99, palette: 'neon', relief: 'yes', overTerritories: true })!;
  assert.equal(l.colours, false);
  assert.equal(l.strength, 4, 'strength at most four times the usual');
  assert.equal(l.palette, 'natural', 'unknown palettes fall back');
  assert.equal(l.relief, true, 'a non-boolean keeps the default');
  assert.equal(l.overTerritories, true);
  assert.equal(terrainLookOf({ strength: 0 })!.strength, 0.25);
  assert.equal(terrainLookOf({ strength: Number.NaN })!.strength, 1);
});

test('palettes: colours between stops are mixed, ends held; the natural sea is the map ocean at 3,000 m', () => {
  const sea = PALETTES.natural.sea;
  assert.deepEqual(rampAt(sea, -3000), [0x14, 0x32, 0x4a]);
  assert.deepEqual(rampAt(sea, -20000), rampAt(sea, -11000));
  assert.deepEqual(rampAt(sea, 50), rampAt(sea, 0));
  const land = PALETTES.atlas.land, mid = rampAt(land, 100), a = rampAt(land, 0), b = rampAt(land, 200);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(mid[i] - (a[i] + b[i]) / 2) < 1e-9);
  // Every ramp rises and fits the shader's eight stops.
  for (const p of Object.values(PALETTES)) for (const r of [p.sea, p.land]) {
    assert.ok(r.length <= 8);
    for (let i = 1; i < r.length; i++) assert.ok(r[i][0] > r[i - 1][0]);
  }
  const u = rampUniform(PALETTES.natural.land);
  assert.equal(u.length, 32);
  assert.deepEqual(Array.from(u.slice(0, 4)).map((v) => Math.round(v * 1000) / 1000), [0, 0x3c / 255, 0x4d / 255, 0x3a / 255].map((v) => Math.round(v * 1000) / 1000));
});

test("the shader's inverse projections give back what d3-geo projected", () => {
  const raws = { equirectangular: geoEquirectangularRaw, mercator: geoMercatorRaw, equalEarth: geoEqualEarthRaw, naturalEarth: geoNaturalEarth1Raw } as const;
  for (const [kind, raw] of Object.entries(raws) as Array<[keyof typeof raws, (l: number, p: number) => [number, number]]>) {
    for (let lon = -179; lon <= 179; lon += 17) for (let lat = kind === 'mercator' ? -85 : -89; lat <= 89; lat += 11) {
      const lam = (lon * Math.PI) / 180, phi = (lat * Math.PI) / 180;
      const [x, y] = raw(lam, phi);
      const back = invertPlane(kind, x, y);
      assert.ok(back, `${kind} ${lon},${lat}`);
      assert.ok(Math.abs(back[0] - lam) < 1e-7 && Math.abs(back[1] - phi) < 1e-7, `${kind} ${lon},${lat}: ${back}`);
    }
  }
  // Beyond the outline of the round projections, and beyond the poles: no place.
  const [edge] = geoEqualEarthRaw(Math.PI, 0);
  assert.equal(invertPlane('equalEarth', edge * 1.05, 0), null);
  assert.equal(invertPlane('naturalEarth', geoNaturalEarth1Raw(Math.PI, 0)[0] * 1.05, 0), null);
  assert.equal(invertPlane('equirectangular', 0, 1.6), null);
  assert.ok(invertPlane('equirectangular', 4, 0), 'a repeating map goes on east and west');
  assert.equal(invertPlane('flat', 0, 0), null);
});

test('relief: level ground is unshaded, slopes facing the light are lit, the others in shadow', () => {
  assert.equal(slopeShade(0, 0, 6), 0);
  assert.ok(LIGHT[0] < 0 && LIGHT[1] > 0 && LIGHT[2] > 0, 'light from the north-west, above');
  // Rising towards the south-east: the slope faces north-west.
  assert.ok(slopeShade(0.05, -0.05, 6) > 0.1);
  assert.ok(slopeShade(-0.05, 0.05, 6) < -0.1);
  // Facing across the light (north-east): about as level.
  assert.ok(Math.abs(slopeShade(-0.05, -0.05, 6)) < Math.abs(slopeShade(0.05, -0.05, 6)) / 2);
  // Exaggerated slopes are shaded more.
  assert.ok(slopeShade(0.02, -0.02, 12) > slopeShade(0.02, -0.02, 3));
});

test('terrain is turned on for a map of the Earth, changed, turned off and undone; refused elsewhere', () => {
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'Relief').result;
  const space = () => world.get('map_space', spaceId)!;
  assert.equal(terrainSourceOf(space()), 'earth');
  assert.equal(terrainLook(space()), null, 'no terrain to begin with');
  const on = cmd.setWorldTerrain(world, spaceId, {});
  assert.deepEqual(terrainLook(space()), DEFAULT_TERRAIN_LOOK);
  cmd.setWorldTerrain(world, spaceId, { overTerritories: true, palette: 'atlas' });
  assert.deepEqual(terrainLook(space()), { ...DEFAULT_TERRAIN_LOOK, overTerritories: true, palette: 'atlas' });
  const off = cmd.setWorldTerrain(world, spaceId, null);
  assert.equal(terrainLook(space()), null);
  assert.equal(worldSettings(space()).terrain, undefined, 'nothing left behind');
  world.applyDiffs(invertDiffs(off.diffs));
  assert.equal(terrainLook(space())!.palette, 'atlas', 'turning it off is undone in one step');
  assert.ok(on.diffs.length > 0);
  // Other settings are kept.
  cmd.setWorldShow(world, spaceId, { working: { names: false } });
  cmd.setWorldTerrain(world, spaceId, { strength: 2 });
  assert.equal(worldSettings(space()).show?.working?.names, false);
  // A world without Earth's geography, or a flat map, has none (yet).
  const plain = cmd.createWorld(world, 'Elsewhere', 3000).result;
  assert.throws(() => cmd.setWorldTerrain(world, plain, {}), /Only maps of the Earth and generated planets/);
  const city = cmd.createFlatMap(world, 'City', 10).result;
  assert.equal(terrainSourceOf(world.get('map_space', city)), null);
  assert.throws(() => cmd.setWorldTerrain(world, 'space_missing', {}), /no longer exists/);
});

test('exports: terrain colours belong to the background pass, drawn between the ocean and the grid', () => {
  const all = PASS_DEFS.find((d) => d.name === 'all')!, bg = PASS_DEFS.find((d) => d.name === 'background')!;
  assert.deepEqual(bg.passes, ['background', 'terrain', 'graticule']);
  assert.deepEqual(all.passes, ALL_PASSES);
  assert.ok(ALL_PASSES.indexOf('terrain') > ALL_PASSES.indexOf('background') && ALL_PASSES.indexOf('terrain') < ALL_PASSES.indexOf('land'));
});

test('relief from the heights alone (D194): the smooth ground between cells, its exact slope, no rim at a cliff', () => {
  const w = 72, h = 36, cell = 360 / w;
  const grid = (f: (lon: number, lat: number) => number): ElevationGrid => {
    const data = new Int16Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = Math.round(f(-180 + (i + 0.5) * cell, 90 - (j + 0.5) * cell));
    return { width: w, height: h, step: 1, data };
  };
  // At a cell's centre: the cell's own height. A plain: flat, no slope anywhere.
  const hills = grid((lon, lat) => 1500 + 900 * Math.sin((lon * Math.PI) / 40) * Math.cos((lat * Math.PI) / 30));
  for (const [i, j] of [[10, 12], [40, 20], [71, 5]]) assert.equal(smoothHeightAt(hills, -180 + (i + 0.5) * cell, 90 - (j + 0.5) * cell).height, hills.data[j * w + i]);
  const plain = grid(() => 300);
  for (const [lon, lat] of [[3.3, 41.7], [-120.1, -33.2], [179.9, 10]]) { const s = smoothHeightAt(plain, lon, lat); assert.ok(s.height === 300 && Math.abs(s.east) < 1e-9 && Math.abs(s.south) < 1e-9, JSON.stringify(s)); }
  // A slope the same everywhere is given back exactly: its height at any place, and its rise per cell.
  const ramp = grid((lon, lat) => 2000 + 40 * lat);
  for (const [lon, lat] of [[1.2, 12.3], [77.7, -41.9], [-30.1, 3.14]]) {
    const s = smoothHeightAt(ramp, lon, lat);
    assert.ok(Math.abs(s.height - (2000 + 40 * lat)) < 1e-6 && Math.abs(s.south + 40 * cell) < 1e-9 && Math.abs(s.east) < 1e-9, `${JSON.stringify(s)} at ${lon}, ${lat}`);
  }
  // The slope has no break from one cell to the next (the straight-line reading has: a crease along every cell).
  const edge = -180 + 20 * cell + cell / 2;
  const before = smoothHeightAt(hills, edge - 1e-7, 22.2), after = smoothHeightAt(hills, edge + 1e-7, 22.2);
  assert.ok(Math.abs(before.east - after.east) < 1e-3 && Math.abs(before.south - after.south) < 1e-3, `no crease (${before.east} and ${after.east})`);
  const crease = (heightAt(hills, edge, 22.2) - heightAt(hills, edge - 0.5, 22.2)) - (heightAt(hills, edge + 0.5, 22.2) - heightAt(hills, edge, 22.2));
  assert.ok(Math.abs(crease) > 1, `the straight-line reading turns a corner there (${crease.toFixed(1)} m)`);
  // Between cells it follows the land itself more closely than straight lines do.
  let smoothErr = 0, straightErr = 0;
  for (let k = 0; k < 400; k++) {
    const lon = -170 + ((k * 37.7) % 340), lat = -60 + ((k * 13.3) % 120), real = 1500 + 900 * Math.sin((lon * Math.PI) / 40) * Math.cos((lat * Math.PI) / 30);
    smoothErr += Math.abs(smoothHeightAt(hills, lon, lat).height - real); straightErr += Math.abs(heightAt(hills, lon, lat) - real);
  }
  assert.ok(smoothErr < straightErr * 0.35, `closer to the land than straight lines (${(smoothErr / 400).toFixed(1)} m against ${(straightErr / 400).toFixed(1)} m)`);
  // A cliff: nothing rises above the plateau or dips below the sea beside it.
  const cliff = grid((lon) => (lon > 0 ? 800 : -200));
  for (let lon = -12; lon <= 12; lon += 0.37) { const v = smoothHeightAt(cliff, lon, 7.7).height; assert.ok(v >= -200 && v <= 800, `${v} at ${lon}`); }
  // Round the planet: the 180th meridian is no edge.
  const round = smoothHeightAt(hills, 179.999, 12), round2 = smoothHeightAt(hills, -179.999, 12);
  assert.ok(Math.abs(round.height - round2.height) < 0.5 && Math.abs(round.east - round2.east) < 0.5);
});

test('relief as it is drawn (D194): the ground\'s own slopes close in, more from afar, none closer than the heights speak', () => {
  // Measured across half a kilometre or less: the ground's own slope, as it is.
  assert.equal(reliefExaggeration(1, 76), 1);
  assert.equal(reliefExaggeration(1, 500), 1);
  assert.equal(reliefExaggeration(2, 300), 2);
  // Across the bundled heights' two cells (about 20 km): six times; across 80 km, twelve.
  assert.ok(Math.abs(reliefExaggeration(1, 20000) - 6) < 1e-9 && Math.abs(reliefExaggeration(1, 80000) - 12) < 1e-9);
  assert.ok(reliefExaggeration(1, 5000) > reliefExaggeration(1, 2000));
  // All of it while a cell is up to 32 pixels wide, fading to none at 160.
  assert.equal(reliefFade(1), 1); assert.equal(reliefFade(32), 1); assert.equal(reliefFade(160), 0); assert.equal(reliefFade(4000), 0);
  assert.ok(reliefFade(64) > reliefFade(96) && reliefFade(96) > reliefFade(128) && Math.abs(reliefFade(96) - 0.5) < 1e-9);
  // A 30° mountainside close in is shaded by its true slope: darker facing away from the light, lighter facing it.
  const away = slopeShade(-0.577, 0.577, reliefExaggeration(1, 100)), toward = slopeShade(0.577, -0.577, reliefExaggeration(1, 100));
  assert.ok(away < -0.3 && toward > 0.15, `${away}, ${toward}`);
  // A plain's slope of a metre in a kilometre: nothing to see.
  assert.ok(Math.abs(slopeShade(0.001, 0, reliefExaggeration(1, 100))) < 0.002);
  // The option to make ground up is gone: a look kept with it reads as any other.
  assert.equal('fine' in terrainLookOf({ ...DEFAULT_TERRAIN_LOOK, fine: true } as never)!, false);
});
