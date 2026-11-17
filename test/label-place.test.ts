// Label placement: every large country's label stands inside it, near the middle of its main piece,
// across the 180° line and around a pole; long names may take several lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea, geoContains } from 'd3-geo';
import { decodeCountries, type CountriesFile, type CountryShape } from '../src/domain/countries.ts';
import { planeShape, placeLabel, lineChoices, textWidthEm, blockHeightEm } from '../src/render-engine/label-place.ts';
import type { ProjectionName } from '../src/render-engine/camera.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = decodeCountries(JSON.parse(readFileSync(join(root, 'data', 'natural-earth', 'countries-50m.json'), 'utf8')) as CountriesFile);

const polygon = (rings: Array<Array<[number, number]>>): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: rings.map((r) => [...r, r[0]]) });
const areaOf = (rings: Array<Array<[number, number]>>) => { const a = geoArea(polygon(rings)); return a > 2 * Math.PI ? 4 * Math.PI - a : a; };
/** The polygon of a country with the largest area (its main piece). */
const mainPiece = (c: CountryShape) => [...c.polygons].sort((a, b) => areaOf(b) - areaOf(a))[0];

function arcsOf(rings: Array<Array<[number, number]>>): number[] {
  const arcs: number[] = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; arcs.push(a[0], a[1], b[0], b[1]); }
  return arcs;
}
function centreLon(ring: Array<[number, number]>): number {
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180); y += Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180); }
  return Math.atan2(y, x) * 180 / Math.PI;
}
function place(rings: Array<Array<[number, number]>>, text: string, projection: ProjectionName = 'equirectangular') {
  const shape = planeShape(arcsOf(rings), projection, centreLon(rings[0]));
  const lines = [text];
  return placeLabel(shape, textWidthEm(text, false, 0) / blockHeightEm(lines.length));
}

test('labels: every large country (main piece over about 160,000 km²) gets a place inside it, in four projections', () => {
  const big = all.filter((c) => areaOf(mainPiece(c)) > 0.004);
  assert.ok(big.length > 80, `${big.length} large countries`);
  for (const projection of ['equirectangular', 'mercator', 'equalEarth', 'naturalEarth'] as ProjectionName[]) {
    for (const c of big) {
      if (projection === 'mercator' && c.name === 'Antarctica') continue; // Mercator cannot show the pole
      const rings = mainPiece(c);
      const spot = place(rings, c.name, projection);
      assert.ok(spot, `${c.name} (${projection}) has a label place`);
      // geoContains wants outer rings wound clockwise; Natural Earth's are, holes the other way.
      assert.ok(geoContains(polygon(rings), [spot.lon, spot.lat]), `${c.name} (${projection}): label at ${spot.lon.toFixed(2)}, ${spot.lat.toFixed(2)} is inside the country`);
      assert.ok(spot.room > 0);
    }
  }
});

test('labels: the large countries are labelled near the middle of their main piece', () => {
  // Boxes drawn around the middle of each country by hand (lon from-to, lat from-to).
  const expected: Record<string, [number, number, number, number]> = {
    Russia: [60, 115, 55, 68], Canada: [-122, -85, 52, 66], 'United States of America': [-108, -88, 34, 43],
    China: [88, 112, 28, 40], Brazil: [-58, -44, -16, -4], Australia: [125, 142, -30, -20], India: [74, 84, 17, 26],
    Argentina: [-70, -60, -42, -28], Kazakhstan: [58, 78, 44, 52], Algeria: [-3, 8, 23, 32], 'Democratic Republic of the Congo': [18, 28, -8, 2],
    'Saudi Arabia': [40, 50, 19, 27], Mexico: [-108, -96, 20, 29], Mongolia: [96, 112, 44, 49], Libya: [12, 22, 23, 30],
    Sudan: [26, 34, 11, 18], Iran: [50, 60, 29, 36], Peru: [-77, -71, -14, -6], Chad: [16, 21, 11, 19], Egypt: [27, 33, 23, 29],
    France: [0, 4.5, 45.5, 49], Spain: [-6, -1, 38.5, 42], Ukraine: [27, 37, 47, 51], Turkey: [30, 39, 37.5, 40.5],
  };
  for (const [name, [w, e, s, n]] of Object.entries(expected)) {
    const c = all.find((x) => x.name === name);
    assert.ok(c, name);
    const spot = place(mainPiece(c), name)!;
    assert.ok(spot.lon >= w && spot.lon <= e && spot.lat >= s && spot.lat <= n, `${name}: label at ${spot.lon.toFixed(1)}, ${spot.lat.toFixed(1)}, expected ${w}..${e}, ${s}..${n}`);
  }
});

test('labels: a territory across the 180° line and one around the South Pole', () => {
  // A square from 170°E to 170°W.
  const square: Array<[number, number]> = [];
  for (let lon = 170; lon <= 190; lon += 2) square.push([lon > 180 ? lon - 360 : lon, -10]);
  for (let lon = 190; lon >= 170; lon -= 2) square.push([lon > 180 ? lon - 360 : lon, 10]);
  const spot = place([square.reverse()], 'Across')!;
  assert.ok(spot, 'placed');
  const d = Math.abs(((spot.lon + 540) % 360) - 180);
  assert.ok(d > 175 && Math.abs(spot.lat) < 6, `near 180°, the equator: ${spot.lon}, ${spot.lat}`);
  // Antarctica (whole), in equirectangular: the outline is open at the sides of the map.
  const ant = mainPiece(all.find((c) => c.name === 'Antarctica')!);
  const a = place(ant, 'Antarctica')!;
  assert.ok(a && a.lat < -70, `Antarctica's label is on Antarctica (${a?.lon}, ${a?.lat})`);
});

test('labels: long names can take two or three lines, short ones never', () => {
  assert.deepEqual(lineChoices('France'), [['France']]);
  assert.deepEqual(lineChoices('United Kingdom'), [['United Kingdom'], ['United', 'Kingdom']]);
  const drc = lineChoices('Democratic Republic of the Congo');
  assert.deepEqual(drc.map((l) => l.length), [1, 2, 3]);
  assert.deepEqual(drc[1], ['Democratic Republic', 'of the Congo']);
  // Every choice keeps every word, in order.
  for (const c of drc) assert.equal(c.join(' '), 'Democratic Republic of the Congo');
});

test('labels: placing every country is quick (all 242 main pieces)', () => {
  const t0 = performance.now();
  for (const c of all) place(mainPiece(c), c.name);
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `${ms.toFixed(0)} ms`);
});

test('labels: zoomed in on part of a large country, the label goes in the part on screen', () => {
  const russia = mainPiece(all.find((c) => c.name === 'Russia')!);
  const shape = planeShape(arcsOf(russia), 'mercator', centreLon(russia[0]));
  // Only European Russia (west of 50°E, 45-65°N) is "on screen".
  const a = shape.projection([30, 45])!, b = shape.projection([50, 65])!;
  const within: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const spot = placeLabel(shape, textWidthEm('Russia', false, 0) / blockHeightEm(1), (lon, lat) => lon >= 30 && lon <= 50 && lat >= 45 && lat <= 65, within);
  assert.ok(spot, 'placed');
  assert.ok(spot.lon >= 30 && spot.lon <= 50 && spot.lat >= 45 && spot.lat <= 65, `in the part on screen: ${spot.lon}, ${spot.lat}`);
  assert.ok(geoContains(polygon(russia), [spot.lon, spot.lat]), 'and inside Russia');
});
