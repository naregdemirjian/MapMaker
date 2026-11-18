// How terrain is drawn (Stage 8, D95): the stored look, the palettes, the shader's arithmetic (the
// inverse projections checked against d3-geo, the slope shading) and the command that turns it on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoEquirectangularRaw, geoMercatorRaw, geoEqualEarthRaw, geoNaturalEarth1Raw } from 'd3-geo';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { terrainLook, terrainSourceOf, worldSettings } from '../src/world-model/world-settings.ts';
import { terrainLookOf, rampAt, rampUniform, invertPlane, slopeShade, PALETTES, DEFAULT_TERRAIN_LOOK, LIGHT } from '../src/terrain/look.ts';
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
  assert.throws(() => cmd.setWorldTerrain(world, plain, {}), /Only maps of the Earth/);
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
