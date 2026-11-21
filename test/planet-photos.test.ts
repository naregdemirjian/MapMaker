// Planets as photographed (D191): a picture wrapped on a sphere seen straight on, the rings from their strip, the
// sizes pictures are made at; every picture shipped, and credited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sphereImage, ringImage, photoSize, PHOTO_TEXTURES, RING_TEXTURE } from '../src/space/planet-photos.ts';
import { skyLookOf, presetLook } from '../src/space/sky-look.ts';

/** A picture 8 x 4: the left half (west of longitude 0) red, the right half blue; the top row (the north) white. */
function halves(): { data: Uint8ClampedArray; width: number; height: number } {
  const w = 8, h = 4, data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = (j * w + i) * 4;
    if (j === 0) data.set([255, 255, 255, 255], o); else if (i < w / 2) data.set([255, 0, 0, 255], o); else data.set([0, 0, 255, 255], o);
  }
  return { data, width: w, height: h };
}

test('a picture wrapped on a sphere: its middle at longitude 0, west on the left, north at the top, clear outside', () => {
  const d = 40, img = sphereImage(halves(), d);
  const at = (i: number, j: number) => Array.from(img.slice((j * d + i) * 4, (j * d + i) * 4 + 4));
  assert.deepEqual(at(10, 22), [255, 0, 0, 255], 'west of the middle: red');
  assert.deepEqual(at(30, 22), [0, 0, 255, 255], 'east of the middle: blue');
  assert.deepEqual(at(20, 1), [255, 255, 255, 255], 'the north pole: white');
  assert.equal(at(0, 0)[3], 0, 'outside the disc: clear');
  // Turned half way round: the colours change sides.
  assert.deepEqual(Array.from(sphereImage(halves(), d, 180).slice((22 * d + 10) * 4, (22 * d + 10) * 4 + 3)), [0, 0, 255]);
});

test('rings from their strip: only between the inner and outer edges; picture sizes a fifth apart', () => {
  const strip = { data: new Uint8ClampedArray(4 * 1 * 4).fill(200), width: 4, height: 1 };
  const d = 50, img = ringImage(strip, d, 0.5, 1);
  const alpha = (i: number, j: number) => img[(j * d + i) * 4 + 3];
  assert.equal(alpha(25, 25), 0, 'the middle (the planet) clear');
  assert.equal(alpha(25 + 18, 25), 200, 'within the rings');
  assert.equal(alpha(0, 0), 0, 'beyond them');
  assert.equal(photoSize(10), photoSize(10.5), 'near sizes share a picture');
  assert.ok(photoSize(100) >= 100 && photoSize(100) < 121);
});

test('every picture shipped with its licence; the photographic look kept and found among the presets', () => {
  for (const f of [...Object.values(PHOTO_TEXTURES), RING_TEXTURE]) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f);
  assert.match(readFileSync(new URL('../data/solar-textures/LICENSE.txt', import.meta.url), 'utf8'), /CC BY 4\.0/);
  const datasets = JSON.parse(readFileSync(new URL('../data/datasets.json', import.meta.url), 'utf8')) as Array<{ id: string; licence: string }>;
  assert.equal(datasets.find((d) => d.id === 'solar-system-scope')?.licence, 'CC BY 4.0');
  assert.equal(presetLook('photographic').photo, true);
  assert.equal(skyLookOf({}).photo, false, 'looks made before: as they were');
});
