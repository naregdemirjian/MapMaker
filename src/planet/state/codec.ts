// The planetary engine's file format, MMS1 (Stage 14, D152): named fields of numbers (per cell of a mesh, per
// pixel of a raster, or anything else), for checkpoints of a simulation's history and for its products.
//
//   0   "MMS1"
//   4   the header's length (uint32, little-endian)
//   8   the header: UTF-8 JSON { engine, kind, level?, meta?, fields: [{ name, type, length, unit?, quantum?,
//       delta?, stored }] }, `stored` being the field's compressed length
//   …   each field's compressed bytes, in the header's order
//
// A field is kept losslessly as its bytes, split into byte planes (every value's first byte, then every second
// byte…), which compress far better than interleaved bytes. Optionally, integers are kept as differences from the
// value before (`delta`, zigzag-coded so small negatives stay small), and real numbers are quantised (`quantum`:
// kept as whole multiples of it, then as differences; read back as Float32). The planes are compressed with
// zlib's deflate, given by the caller (node:zlib in Node, CompressionStream in the browser and in workers).

export type FieldType = 'f64' | 'f32' | 'i32' | 'u32' | 'i16' | 'u16' | 'u8' | 'i8';
export type FieldArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Uint8Array | Int8Array;

export interface FieldOut {
  name: string;
  data: FieldArray;
  unit?: string;
  /** For real numbers: keep as whole multiples of this (lossy to half of it). */
  quantum?: number;
  /** For integers (and quantised reals): keep differences between neighbours. */
  delta?: boolean;
}

export interface StateHeader {
  engine: string;
  kind: string;
  level?: number;
  meta?: Record<string, unknown>;
}

interface FieldHeader {
  name: string;
  type: FieldType;
  length: number;
  unit?: string;
  quantum?: number;
  delta?: boolean;
  stored: number;
}

export const STATE_MAGIC = 'MMS1';

const typeOf = (a: FieldArray): FieldType =>
  a instanceof Float64Array ? 'f64' : a instanceof Float32Array ? 'f32' : a instanceof Int32Array ? 'i32' : a instanceof Uint32Array ? 'u32'
    : a instanceof Int16Array ? 'i16' : a instanceof Uint16Array ? 'u16' : a instanceof Int8Array ? 'i8' : 'u8';

const make = (t: FieldType, n: number): FieldArray => {
  switch (t) {
    case 'f64': return new Float64Array(n);
    case 'f32': return new Float32Array(n);
    case 'i32': return new Int32Array(n);
    case 'u32': return new Uint32Array(n);
    case 'i16': return new Int16Array(n);
    case 'u16': return new Uint16Array(n);
    case 'i8': return new Int8Array(n);
    default: return new Uint8Array(n);
  }
};

/** Splits values' bytes into planes. */
function shuffle(bytes: Uint8Array, width: number): Uint8Array {
  if (width === 1) return bytes.slice();
  const n = bytes.length / width, out = new Uint8Array(bytes.length);
  for (let b = 0; b < width; b++) for (let i = 0; i < n; i++) out[b * n + i] = bytes[i * width + b];
  return out;
}
function unshuffle(planes: Uint8Array, width: number): Uint8Array {
  if (width === 1) return planes;
  const n = planes.length / width, out = new Uint8Array(planes.length);
  for (let b = 0; b < width; b++) for (let i = 0; i < n; i++) out[i * width + b] = planes[b * n + i];
  return out;
}
const bytesOf = (a: FieldArray) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** The values to store for a field: quantised and differenced as asked. */
function prepare(f: FieldOut): { stored: FieldArray; width: number } {
  const t = typeOf(f.data);
  if (f.quantum !== undefined) {
    if (t !== 'f32' && t !== 'f64') throw new Error(`Only real numbers are quantised (${f.name})`);
    const q = new Int32Array(f.data.length);
    for (let i = 0; i < q.length; i++) {
      const v = Math.round(f.data[i] / f.quantum);
      if (!Number.isFinite(v) || Math.abs(v) > 2 ** 31 - 1) throw new Error(`The field ${f.name} cannot be kept at a quantum of ${f.quantum}`);
      q[i] = v;
    }
    return { stored: differences(q, true), width: 4 };
  }
  if (f.delta) {
    if (t === 'f32' || t === 'f64') throw new Error(`Real numbers are differenced only when quantised (${f.name})`);
    return { stored: differences(f.data as Exclude<FieldArray, Float32Array | Float64Array>, true), width: f.data.BYTES_PER_ELEMENT };
  }
  return { stored: f.data, width: f.data.BYTES_PER_ELEMENT };
}

/** Zigzag-coded differences (or their inverse), in the same width. */
function differences<T extends Exclude<FieldArray, Float32Array | Float64Array>>(a: T, forward: boolean): T {
  const out = new (a.constructor as new (n: number) => T)(a.length);
  const bits = a.BYTES_PER_ELEMENT * 8;
  if (forward) {
    let prev = 0;
    for (let i = 0; i < a.length; i++) {
      const d = (a[i] - prev) | 0; // modulo 2^32: wraps for narrower types below
      prev = a[i];
      const w = bits === 32 ? d : (d << (32 - bits)) >> (32 - bits);
      out[i] = bits === 32 ? ((w << 1) ^ (w >> 31)) >>> 0 : ((w << 1) ^ (w >> (bits - 1))) & ((1 << bits) - 1);
    }
  } else {
    let prev = 0;
    for (let i = 0; i < a.length; i++) {
      const z = bits === 32 ? a[i] >>> 0 : a[i] & ((1 << bits) - 1);
      const d = (z >>> 1) ^ -(z & 1);
      prev = (prev + d) | 0;
      out[i] = prev;
    }
  }
  return out;
}

export type Deflate = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const encoder = new TextEncoder(), decoder = new TextDecoder();

/** A file of fields. */
export async function encodeState(header: StateHeader, fields: FieldOut[], deflate: Deflate): Promise<Uint8Array> {
  const parts: Uint8Array[] = [], heads: FieldHeader[] = [];
  for (const f of fields) {
    const { stored, width } = prepare(f);
    const z = await deflate(shuffle(bytesOf(stored), width));
    parts.push(z);
    heads.push({ name: f.name, type: typeOf(f.data), length: f.data.length, ...(f.unit ? { unit: f.unit } : {}), ...(f.quantum !== undefined ? { quantum: f.quantum } : {}), ...(f.delta ? { delta: true } : {}), stored: z.length });
  }
  const json = encoder.encode(JSON.stringify({ ...header, fields: heads }));
  const total = 8 + json.length + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = STATE_MAGIC.charCodeAt(i);
  view.setUint32(4, json.length, true);
  out.set(json, 8);
  let at = 8 + json.length;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export interface DecodedState {
  header: StateHeader & { fields: Array<Omit<FieldHeader, 'stored'>> };
  fields: Map<string, FieldArray>;
}

/** Reads a file of fields (quantised reals come back as Float32). */
export async function decodeState(bytes: Uint8Array, inflate: Deflate): Promise<DecodedState> {
  if (bytes.length < 8 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== STATE_MAGIC) throw new Error('Not a Map Maker planet file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hl = view.getUint32(4, true);
  if (8 + hl > bytes.length) throw new Error('Damaged planet file');
  const header = JSON.parse(decoder.decode(bytes.subarray(8, 8 + hl))) as StateHeader & { fields: FieldHeader[] };
  const fields = new Map<string, FieldArray>();
  let at = 8 + hl;
  for (const f of header.fields) {
    if (at + f.stored > bytes.length) throw new Error('Damaged planet file');
    const planes = await inflate(bytes.subarray(at, at + f.stored));
    at += f.stored;
    if (f.quantum !== undefined) {
      const codes = new Uint32Array(unshuffle(planes, 4).buffer);
      if (codes.length !== f.length) throw new Error('Damaged planet file');
      const q = differences(new Int32Array(codes.buffer), false);
      const out = new Float32Array(f.length);
      for (let i = 0; i < f.length; i++) out[i] = q[i] * f.quantum;
      fields.set(f.name, out);
      continue;
    }
    const proto = make(f.type, 0);
    const raw = unshuffle(planes, proto.BYTES_PER_ELEMENT);
    if (raw.length !== f.length * proto.BYTES_PER_ELEMENT) throw new Error('Damaged planet file');
    const buf = new Uint8Array(raw.length);
    buf.set(raw);
    let data = new (proto.constructor as new (b: ArrayBuffer) => FieldArray)(buf.buffer);
    if (f.delta) data = differences(data as Exclude<FieldArray, Float32Array | Float64Array>, false);
    fields.set(f.name, data);
  }
  const { fields: heads, ...rest } = header;
  return { header: { ...rest, fields: heads.map(({ stored: _s, ...h }) => h) }, fields };
}

/** Compresses with the browser's (or a worker's) CompressionStream. */
export async function deflateInBrowser(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads back what `deflateInBrowser` (or zlib's deflate) wrote, with the browser's (or a worker's) DecompressionStream. */
export async function inflateInBrowser(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
