// Satellite photographs of the Earth (D138): which tiles a view needs, where their picture lies, and when a
// picture still covers a view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { photoNeed, photoPlace, photoCovers, photoTileDegrees, photoPixelDegrees, PHOTO_TILE, PHOTO_MAX_LEVEL, PHOTO_MIN_LEVEL, PHOTO_BUNDLED_LEVEL, METRES_PER_DEGREE } from '../src/terrain/photo.ts';

test('the tiles in longitude and latitude: level L has 2^(L+1) columns and 2^L rows; a pixel of level 13 about 10 m', () => {
  assert.equal(photoTileDegrees(0), 180);
  assert.equal(photoTileDegrees(3), 22.5);
  assert.equal(photoPixelDegrees(PHOTO_BUNDLED_LEVEL) * 4096, 360, 'the bundled picture is level 3: 4096 pixels round the planet');
  const metres = photoPixelDegrees(PHOTO_MAX_LEVEL) * METRES_PER_DEGREE;
  assert.ok(metres > 9 && metres < 10, `${metres} m`);
});

test('which tiles a view needs: none while the bundled picture is fine enough; the level whose pixels are a screen pixel or finer; coarser when too many', () => {
  const europe = { west: -12, south: 34, east: 32, north: 62 };
  // The whole planet across 1,300 pixels: the bundled picture.
  assert.equal(photoNeed({ west: -180, south: -90, east: 180, north: 90 }, 360 / 1300), null);
  assert.equal(photoNeed(europe, photoPixelDegrees(PHOTO_BUNDLED_LEVEL)), null, 'at the bundled picture\'s own detail');
  // Europe across 1,300 pixels (about 3.8 km a pixel): level 5 (pixels of 2.4 km), 4 by 3 tiles.
  const eu = photoNeed(europe, 44 / 1300)!;
  assert.equal(eu.level, 5);
  assert.ok(photoPixelDegrees(eu.level) <= 44 / 1300 && photoPixelDegrees(eu.level - 1) > 44 / 1300, 'the coarsest level as fine as the screen');
  const d = photoTileDegrees(5);
  assert.deepEqual([eu.c0, eu.c1, eu.r0, eu.r1], [Math.floor(168 / d), Math.floor(212 / d - 1e-9), Math.floor(28 / d), Math.floor(56 / d - 1e-9)]);
  assert.equal(eu.key, `5/${eu.c0}-${eu.c1}/${eu.r0}-${eu.r1}`);
  // A city at 10 m a pixel, and at 2 m: level 13, the photographs' own detail, never finer.
  const paris = { west: 2.2, south: 48.78, east: 2.5, north: 48.94 };
  assert.equal(photoNeed(paris, 10 / METRES_PER_DEGREE)!.level, 13);
  assert.equal(photoNeed(paris, 2 / METRES_PER_DEGREE)!.level, PHOTO_MAX_LEVEL);
  const p = photoNeed(paris, 10 / METRES_PER_DEGREE)!;
  assert.ok((p.c1 - p.c0 + 1) * (p.r1 - p.r0 + 1) <= 160);
  // Too many tiles at the level wanted: a coarser one, never more than allowed.
  const wide = { west: 0, south: 40, east: 6, north: 44 };
  const few = photoNeed(wide, 10 / METRES_PER_DEGREE, 60)!;
  assert.ok(few.level < 13 && (few.c1 - few.c0 + 1) * (few.r1 - few.r0 + 1) <= 60, JSON.stringify(few));
  const more = photoNeed(wide, 10 / METRES_PER_DEGREE, 300)!;
  assert.ok(more.level > few.level && (more.c1 - more.c0 + 1) * (more.r1 - more.r0 + 1) <= 300);
  // Nothing for an empty region or no size.
  assert.equal(photoNeed({ west: 5, south: 5, east: 5, north: 6 }, 0.001), null);
  assert.equal(photoNeed(europe, 0), null);
  assert.ok(PHOTO_MIN_LEVEL === PHOTO_BUNDLED_LEVEL + 1);
});

test('across the 180th meridian and at the poles: columns run on round the planet, rows stop at the ends', () => {
  const fiji = photoNeed({ west: 170, south: -25, east: 190, north: -10 }, 0.01)!;
  const cols = 2 ** (fiji.level + 1);
  assert.ok(fiji.c1 >= cols && fiji.c0 < cols, `columns ${fiji.c0} to ${fiji.c1} of ${cols}`);
  const place = photoPlace(fiji);
  assert.ok(place.west <= 170 && place.west + place.widthDeg >= 190, 'its picture runs past 180 degrees east');
  assert.equal(place.width, (fiji.c1 - fiji.c0 + 1) * PHOTO_TILE);
  assert.equal(place.height, (fiji.r1 - fiji.r0 + 1) * PHOTO_TILE);
  const arctic = photoNeed({ west: 10, south: 80, east: 40, north: 95 }, 0.02)!;
  assert.equal(arctic.r0, 0);
  assert.equal(photoPlace(arctic).north, 90);
  const antarctic = photoNeed({ west: 10, south: -95, east: 40, north: -80 }, 0.02)!;
  assert.equal(antarctic.r1, 2 ** antarctic.level - 1);
});

test('a picture covers a view inside it, on whichever side of the planet the view is given', () => {
  const need = photoNeed({ west: 170, south: -25, east: 190, north: -10 }, 0.01)!;
  const p = photoPlace(need);
  assert.equal(photoCovers(p, { west: 172, south: -20, east: 188, north: -12 }), true);
  assert.equal(photoCovers(p, { west: -188, south: -20, east: -172, north: -12 }), true, 'the same view given west of 180');
  assert.equal(photoCovers(p, { west: 150, south: -20, east: 188, north: -12 }), false, 'reaching out of it to the west');
  assert.equal(photoCovers(p, { west: 172, south: -40, east: 188, north: -12 }), false, 'and to the south');
});

test('the picture of the whole Earth ships with the app, with its record: Sentinel-2 cloudless 2016 by EOX, CC BY 4.0, the credit its makers ask for', () => {
  const size = statSync('data/terrain/earth-photo-4096.webp').size;
  assert.ok(size > 300_000 && size < 3_000_000, `${size} bytes`);
  // (A WebP file: "RIFF", its length, "WEBP".)
  const head = readFileSync('data/terrain/earth-photo-4096.webp').subarray(0, 12).toString('latin1');
  assert.ok(head.startsWith('RIFF') && head.endsWith('WEBP'));
  const rec = (JSON.parse(readFileSync('data/datasets.json', 'utf8')) as Array<{ id: string; licence: string; credit: string; usedFor: string; sources: Array<{ sha256: string }> }>).find((d) => d.id === 's2cloudless')!;
  assert.ok(rec, 'its record among the data sources');
  assert.match(rec.licence, /Creative Commons Attribution 4\.0/);
  assert.match(rec.credit, /Sentinel-2 cloudless - https:\/\/s2maps\.eu by EOX IT Services GmbH \(Contains modified Copernicus Sentinel data 2016/);
  assert.match(rec.usedFor, /downloaded when needed/);
  assert.ok(/^[0-9a-f]{64}$/.test(rec.sources[0].sha256));
});
