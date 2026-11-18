// MP4 files of H.264 video (D121): the frames the browser's video encoder makes, written one after the other
// into the file as they come ('mdat'), and at the end the tables a player reads them by ('moov'): each frame's
// size and place, which frames can be started from, and the frame rate, exactly (23.976 fps as 24000/1001).
// One video track, no sound. Written through `write(position, bytes)`, so the file can go to disk while it is
// made: the only bytes written twice are the size of the frames' box, at the end.
import { ByteBuffer, u64Bytes } from './bytes.ts';

export type WriteAt = (position: number, bytes: Uint8Array) => void;

/** How the colours of the video are coded (ITU-T H.273 numbers, as MP4 and WebM both write them). */
export interface ColourInfo { primaries: number; transfer: number; matrix: number; fullRange: boolean }

/** The units a frame rate's frames are timed in: 23.976, 29.97 and 59.94 fps as 1001/24000, 1001/30000, 1001/60000 s. */
export function frameTiming(fps: number): { timescale: number; delta: number } {
  const r = Math.round(fps);
  if (Math.abs(fps - r) > 0.01 && Math.abs(fps - (r * 1000) / 1001) < 0.002) return { timescale: r * 1000, delta: 1001 };
  return { timescale: Math.max(1, Math.round(fps * 1000)), delta: 1000 };
}

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

export class Mp4Writer {
  private readonly write: WriteAt;
  private readonly width: number;
  private readonly height: number;
  private readonly timescale: number;
  private readonly delta: number;
  private readonly sizes: number[] = [];
  private readonly offsets: number[] = [];
  private readonly keys: number[] = [];
  private readonly mdatAt: number;
  private pos = 0;
  private lastTime = -Infinity;
  private avcC: Uint8Array | null = null;
  private colour: ColourInfo | null = null;
  private finished = false;

  constructor(o: { width: number; height: number; fps: number; write: WriteAt }) {
    this.write = o.write;
    this.width = o.width;
    this.height = o.height;
    ({ timescale: this.timescale, delta: this.delta } = frameTiming(o.fps));
    const head = new ByteBuffer(64);
    // The file's type: ISO base media, readable as MP4 with H.264.
    head.u32(32).ascii('ftyp').ascii('isom').u32(0x200).ascii('isom').ascii('iso2').ascii('avc1').ascii('mp41');
    this.mdatAt = head.length;
    // The frames' box, its size (64 bits: videos may pass 4 GB) written at the end.
    head.u32(1).ascii('mdat').u64(0);
    const bytes = head.done();
    this.write(0, bytes);
    this.pos = bytes.length;
  }

  /**
   * One frame as the encoder gave it (H.264 in "avc" form: each piece with its length before it), in the
   * order shown. The first carries the decoder's configuration (the avcC record) and the colours.
   */
  add(data: Uint8Array, key: boolean, timestampUs: number, config?: { description?: Uint8Array | null; colour?: ColourInfo | null }): void {
    if (this.finished) throw new Error('The video file is already finished.');
    if (!this.sizes.length && !key) throw new Error('A video has to start with a frame that can be shown on its own.');
    if (!(timestampUs > this.lastTime)) throw new Error('The video encoder gave its frames out of order.');
    this.lastTime = timestampUs;
    if (config?.description?.length && !this.avcC) this.avcC = config.description.slice();
    if (config?.colour && !this.colour) this.colour = config.colour;
    this.offsets.push(this.pos);
    this.sizes.push(data.length);
    if (key) this.keys.push(this.sizes.length);
    this.write(this.pos, data);
    this.pos += data.length;
  }

  /** How many frames are written. */
  get frames(): number { return this.sizes.length; }

  /** Ends the file: the size of the frames' box, then the tables. Returns the file's size in bytes. */
  finish(): number {
    if (this.finished) return this.pos;
    if (!this.sizes.length) throw new Error('No frames were encoded.');
    if (!this.avcC) throw new Error('The video encoder gave no decoder configuration.');
    this.finished = true;
    this.write(this.mdatAt + 8, u64Bytes(this.pos - this.mdatAt));
    const moov = this.moov();
    this.write(this.pos, moov);
    this.pos += moov.length;
    return this.pos;
  }

  private moov(): Uint8Array {
    const n = this.sizes.length;
    const mediaDuration = n * this.delta;
    const movieDuration = Math.round((mediaDuration * 1000) / this.timescale);
    const long = mediaDuration >= 2 ** 32 || movieDuration >= 2 ** 32;
    const b = new ByteBuffer(4096 + n * 16);
    const stack: number[] = [];
    const open = (type: string, version?: number, flags = 0) => {
      stack.push(b.length);
      b.u32(0).ascii(type);
      if (version !== undefined) b.u8(version).u8((flags >> 16) & 255).u16(flags & 0xffff);
    };
    const close = () => { const at = stack.pop()!; b.setU32(at, b.length - at); };
    const time = (x: number) => (long ? b.u64(x) : b.u32(x));

    open('moov');
    open('mvhd', long ? 1 : 0);
    time(0); time(0); b.u32(1000); time(movieDuration);
    b.u32(0x00010000).u16(0x0100).u16(0).u32(0).u32(0);
    for (const m of MATRIX) b.u32(m);
    b.zeros(24).u32(2);
    close();
    open('trak');
    open('tkhd', long ? 1 : 0, 3);
    time(0); time(0); b.u32(1).u32(0); time(movieDuration);
    b.u32(0).u32(0).u16(0).u16(0).u16(0).u16(0);
    for (const m of MATRIX) b.u32(m);
    b.u32(this.width * 65536).u32(this.height * 65536);
    close();
    open('mdia');
    open('mdhd', long ? 1 : 0);
    time(0); time(0); b.u32(this.timescale); time(mediaDuration);
    b.u16(0x55c4).u16(0); // language 'und'
    close();
    open('hdlr', 0);
    b.u32(0).ascii('vide').u32(0).u32(0).u32(0).ascii('Map Maker video').u8(0);
    close();
    open('minf');
    open('vmhd', 0, 1); b.u16(0).u16(0).u16(0).u16(0); close();
    open('dinf'); open('dref', 0); b.u32(1); open('url ', 0, 1); close(); close(); close();
    open('stbl');
    open('stsd', 0); b.u32(1);
    open('avc1');
    b.zeros(6).u16(1).u16(0).u16(0).zeros(12).u16(this.width).u16(this.height).u32(0x00480000).u32(0x00480000).u32(0).u16(1);
    const name = 'Map Maker H.264';
    b.u8(name.length).ascii(name).zeros(31 - name.length);
    b.u16(0x0018).i16(-1);
    open('avcC'); b.bytes(this.avcC!); close();
    if (this.colour) {
      open('colr'); b.ascii('nclx').u16(this.colour.primaries).u16(this.colour.transfer).u16(this.colour.matrix).u8(this.colour.fullRange ? 0x80 : 0); close();
    }
    close(); // avc1
    close(); // stsd
    // Every frame lasts as long: one entry.
    open('stts', 0); b.u32(1).u32(n).u32(this.delta); close();
    // The frames a player can start from.
    open('stss', 0); b.u32(this.keys.length); for (const k of this.keys) b.u32(k); close();
    // Each frame its own chunk: one rule for all.
    open('stsc', 0); b.u32(1).u32(1).u32(1).u32(1); close();
    open('stsz', 0); b.u32(0).u32(n); for (const s of this.sizes) b.u32(s); close();
    const big = this.offsets[n - 1] >= 2 ** 32;
    open(big ? 'co64' : 'stco', 0); b.u32(n); for (const o of this.offsets) (big ? b.u64(o) : b.u32(o)); close();
    close(); // stbl
    close(); // minf
    close(); // mdia
    close(); // trak
    close(); // moov
    return b.done();
  }
}
