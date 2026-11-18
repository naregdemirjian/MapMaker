// TIFF image files for export sequences (Stage 10, D109): 8 bits a sample, RGB with straight
// (unassociated) alpha, little-endian, in strips; uncompressed (read by everything, largest) or
// compressed with Deflate ("ZIP", as Photoshop writes it). Pure byte layout: the compression is given
// by the caller (the browser's CompressionStream, or Node's zlib), so this runs in both.

export type TiffCompression = 'none' | 'zip';

/** About how many bytes of pixels go in each strip (a quarter of a megabyte). */
const STRIP_BYTES = 256 * 1024;

/** The rows each strip holds, for a picture `width` pixels wide. */
export function rowsPerStrip(width: number): number {
  return Math.max(1, Math.floor(STRIP_BYTES / (width * 4)));
}

/**
 * A TIFF of an RGBA picture. `compress` (zlib format, as TIFF's Deflate compression 8 wants) is
 * needed for 'zip'.
 */
export async function encodeTiff(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, compression: TiffCompression = 'none', compress?: (data: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  if (rgba.length !== width * height * 4) throw new Error(`Expected ${width * height * 4} bytes of pixels, got ${rgba.length}`);
  if (compression === 'zip' && !compress) throw new Error('Deflate is not available here.');
  const rows = rowsPerStrip(width), stripCount = Math.ceil(height / rows);
  const strips: Uint8Array[] = [];
  for (let i = 0; i < stripCount; i++) {
    const a = i * rows * width * 4, b = Math.min(height, (i + 1) * rows) * width * 4;
    const raw = new Uint8Array(rgba.buffer, rgba.byteOffset + a, b - a);
    strips.push(compression === 'zip' ? await compress!(raw) : raw);
  }
  const software = new TextEncoder().encode('Map Maker\0');
  // Header (8), the directory (2 + entries * 12 + 4), then the values too long to sit in it, then the strips.
  const entries = 15;
  let at = 8 + 2 + entries * 12 + 4;
  const place = (bytes: number) => { const o = at; at += bytes + (bytes & 1); return o; };
  const bitsAt = place(8), offsetsAt = stripCount > 1 ? place(4 * stripCount) : 0, countsAt = stripCount > 1 ? place(4 * stripCount) : 0;
  const xresAt = place(8), yresAt = place(8), softwareAt = place(software.length);
  const stripAt: number[] = strips.map((s) => place(s.length));
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; v.setUint16(2, 42, true); v.setUint32(4, 8, true);
  let e = 8;
  v.setUint16(e, entries, true); e += 2;
  const SHORT = 3, LONG = 4, RATIONAL = 5, ASCII = 2;
  const entry = (tag: number, type: number, count: number, value: number) => {
    v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true);
    if (type === SHORT && count === 1) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    e += 12;
  };
  entry(256, LONG, 1, width);
  entry(257, LONG, 1, height);
  entry(258, SHORT, 4, bitsAt);
  entry(259, SHORT, 1, compression === 'zip' ? 8 : 1);
  entry(262, SHORT, 1, 2); // RGB
  entry(273, LONG, stripCount, stripCount > 1 ? offsetsAt : stripAt[0]);
  entry(277, SHORT, 1, 4);
  entry(278, LONG, 1, rows);
  entry(279, LONG, stripCount, stripCount > 1 ? countsAt : strips[0].length);
  entry(282, RATIONAL, 1, xresAt);
  entry(283, RATIONAL, 1, yresAt);
  entry(284, SHORT, 1, 1); // chunky
  entry(296, SHORT, 1, 2); // inches
  entry(305, ASCII, software.length, softwareAt);
  entry(338, SHORT, 1, 2); // the fourth sample is straight alpha
  v.setUint32(e, 0, true); // no further directory
  for (let i = 0; i < 4; i++) v.setUint16(bitsAt + 2 * i, 8, true);
  if (stripCount > 1) for (let i = 0; i < stripCount; i++) { v.setUint32(offsetsAt + 4 * i, stripAt[i], true); v.setUint32(countsAt + 4 * i, strips[i].length, true); }
  for (const r of [xresAt, yresAt]) { v.setUint32(r, 72, true); v.setUint32(r + 4, 1, true); }
  out.set(software, softwareAt);
  strips.forEach((s, i) => out.set(s, stripAt[i]));
  return out;
}

/** Zlib (Deflate) compression with the browser's own CompressionStream. */
export async function deflateInBrowser(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A TIFF's size and pixels read back (for tests and checks): uncompressed or Deflate strips. */
export async function decodeTiff(file: Uint8Array, inflate?: (data: Uint8Array) => Promise<Uint8Array>): Promise<{ width: number; height: number; rgba: Uint8Array; compression: number }> {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file[0] !== 0x49 || file[1] !== 0x49 || v.getUint16(2, true) !== 42) throw new Error('Not a little-endian TIFF');
  const ifd = v.getUint32(4, true), n = v.getUint16(ifd, true);
  const tags = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < n; i++) { const e = ifd + 2 + 12 * i; tags.set(v.getUint16(e, true), { type: v.getUint16(e + 2, true), count: v.getUint32(e + 4, true), at: e + 8 }); }
  const one = (tag: number) => { const t = tags.get(tag)!; return t.type === 3 ? v.getUint16(t.at, true) : v.getUint32(t.at, true); };
  const many = (tag: number) => { const t = tags.get(tag)!; if (t.count === 1) return [one(tag)]; const o = v.getUint32(t.at, true); return Array.from({ length: t.count }, (_, i) => (t.type === 3 ? v.getUint16(o + 2 * i, true) : v.getUint32(o + 4 * i, true))); };
  const width = one(256), height = one(257), compression = one(259);
  const offsets = many(273), counts = many(279);
  const rgba = new Uint8Array(width * height * 4);
  let o = 0;
  for (let i = 0; i < offsets.length; i++) {
    let strip = file.subarray(offsets[i], offsets[i] + counts[i]);
    if (compression === 8) { if (!inflate) throw new Error('Inflate is not available here.'); strip = await inflate(strip); }
    rgba.set(strip, o);
    o += strip.length;
  }
  return { width, height, rgba, compression };
}
