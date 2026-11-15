// Minimal, dependency-free PNG encoder (8-bit RGBA, straight alpha). Pure JavaScript + Node's zlib,
// so exports work identically on Windows, macOS and Linux with no native image library.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array, start = 0, end = buf.length, crc = 0xffffffff): number {
  let c = crc;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(out, 4, 8 + data.length) ^ 0xffffffff) >>> 0);
  return out;
}

/** Encode straight-alpha RGBA pixels (row-major, top row first) as a PNG file. */
export function encodePNG(width: number, height: number, rgba: Uint8Array, opts: { level?: number } = {}): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`Expected ${width * height * 4} bytes of RGBA, got ${rgba.length}`);
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1; // "Sub" filter: excellent for the flat colour areas of maps
    const row = y * stride;
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = (rgba[row + x] - (x >= 4 ? rgba[row + x - 4] : 0)) & 0xff;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const srgb = new Uint8Array([0]); // perceptual rendering intent: tag the image as sRGB
  const idat = deflateSync(raw, { level: opts.level ?? 6 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('sRGB', srgb), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
