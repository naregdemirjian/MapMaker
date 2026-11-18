// A growing buffer of big-endian numbers and bytes, for writing file formats (the video files, D121).

export class ByteBuffer {
  private a: Uint8Array;
  private v: DataView;
  /** Bytes written so far. */
  length = 0;

  constructor(capacity = 256) {
    this.a = new Uint8Array(capacity);
    this.v = new DataView(this.a.buffer);
  }

  private room(k: number): void {
    if (this.length + k <= this.a.length) return;
    const b = new Uint8Array(Math.max(this.a.length * 2, this.length + k));
    b.set(this.a.subarray(0, this.length));
    this.a = b;
    this.v = new DataView(b.buffer);
  }

  u8(x: number): this { this.room(1); this.v.setUint8(this.length, x); this.length += 1; return this; }
  u16(x: number): this { this.room(2); this.v.setUint16(this.length, x); this.length += 2; return this; }
  i16(x: number): this { this.room(2); this.v.setInt16(this.length, x); this.length += 2; return this; }
  u32(x: number): this { this.room(4); this.v.setUint32(this.length, x >>> 0); this.length += 4; return this; }
  /** A whole number below 2^53 in eight bytes. */
  u64(x: number): this { return this.u32(Math.floor(x / 2 ** 32)).u32(x % 2 ** 32); }
  f64(x: number): this { this.room(8); this.v.setFloat64(this.length, x); this.length += 8; return this; }
  /** Text of single-byte characters (box types, brands), as it is. */
  ascii(s: string): this { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 255); return this; }
  bytes(b: Uint8Array): this { this.room(b.length); this.a.set(b, this.length); this.length += b.length; return this; }
  zeros(n: number): this { this.room(n); this.a.fill(0, this.length, this.length + n); this.length += n; return this; }

  /** Overwrites four bytes at `at` (a size worked out afterwards). */
  setU32(at: number, x: number): void { this.v.setUint32(at, x >>> 0); }

  /** The bytes written (a copy). */
  done(): Uint8Array { return this.a.slice(0, this.length); }
}

/** A whole number below 2^53 as eight big-endian bytes. */
export function u64Bytes(x: number): Uint8Array { return new ByteBuffer(8).u64(x).done(); }
