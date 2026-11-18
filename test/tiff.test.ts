// TIFF sequences (Stage 10, D109): files with straight alpha, uncompressed or ZIP, read back the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { encodeTiff, decodeTiff, rowsPerStrip } from '../src/export/tiff.ts';

const zip = async (d: Uint8Array) => new Uint8Array(deflateSync(d));
const unzip = async (d: Uint8Array) => new Uint8Array(inflateSync(d));

function picture(w: number, h: number): Uint8Array {
  const p = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 4 * (y * w + x);
    // Flat colour with a few edges, as maps are, and a transparent corner.
    p[o] = x < w / 2 ? 200 : 30; p[o + 1] = y < h / 3 ? 90 : 160; p[o + 2] = (x + y) % 7 === 0 ? 255 : 40; p[o + 3] = x < 10 && y < 10 ? 0 : 255;
  }
  return p;
}

test('a TIFF: little-endian, RGB with straight alpha, in strips; read back the same, uncompressed and ZIP', async () => {
  const w = 300, h = 500, px = picture(w, h);
  assert.equal(rowsPerStrip(w), 218);
  const plain = await encodeTiff(px, w, h, 'none');
  assert.deepEqual([...plain.subarray(0, 4)], [0x49, 0x49, 42, 0], 'II, 42');
  assert.ok(plain.length >= w * h * 4 && plain.length < w * h * 4 + 1024, 'uncompressed: the pixels and a small header');
  const back = await decodeTiff(plain);
  assert.equal(back.width, w);
  assert.equal(back.height, h);
  assert.equal(back.compression, 1);
  assert.deepEqual(back.rgba, px, 'the same pixels, alpha included');
  const packed = await encodeTiff(px, w, h, 'zip', zip);
  assert.ok(packed.length < plain.length / 5, `ZIP much smaller for a map (${packed.length} against ${plain.length})`);
  const back2 = await decodeTiff(packed, unzip);
  assert.equal(back2.compression, 8);
  assert.deepEqual(back2.rgba, px);
  // A small picture: one strip, its place written in the directory itself.
  const tiny = picture(4, 3);
  assert.deepEqual((await decodeTiff(await encodeTiff(tiny, 4, 3))).rgba, tiny);
  // The fourth sample is straight alpha (ExtraSamples = 2).
  const v = new DataView(plain.buffer, plain.byteOffset);
  const ifd = v.getUint32(4, true), n = v.getUint16(ifd, true);
  let extra = -1;
  for (let i = 0; i < n; i++) if (v.getUint16(ifd + 2 + 12 * i, true) === 338) extra = v.getUint16(ifd + 2 + 12 * i + 8, true);
  assert.equal(extra, 2);
  await assert.rejects(() => encodeTiff(px, w + 1, h), /Expected/);
  await assert.rejects(() => encodeTiff(px, w, h, 'zip'), /Deflate/);
});
