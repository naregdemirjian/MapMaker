// WebM files of VP9 video (D121): Matroska's elements (an ID, a size, the contents) written as the encoder's
// frames come: the header, then the frames in clusters, each starting at a frame that can be shown on its own
// (every two seconds), then the cues a player seeks by. Written through `write(position, bytes)`, so the file
// goes to disk while it is made; at the end the sizes and the duration are written into the header.
import { ByteBuffer } from './bytes.ts';
import type { ColourInfo, WriteAt } from './mp4-mux.ts';

const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, MuxingApp: 0x4d80, WritingApp: 0x5741, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagLacing: 0x9c,
  Language: 0x22b59c, CodecID: 0x86, DefaultDuration: 0x23e383, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Colour: 0x55b0, MatrixCoefficients: 0x55b1, Range: 0x55b9, TransferCharacteristics: 0x55ba, Primaries: 0x55bb,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
} as const;

/** An element ID's bytes (IDs carry their own length). */
function writeId(b: ByteBuffer, id: number): void {
  if (id > 0xffffff) b.u32(id);
  else if (id > 0xffff) b.u8(id >>> 16).u16(id & 0xffff);
  else if (id > 0xff) b.u16(id);
  else b.u8(id);
}

/** A size as Matroska writes it: as few bytes as hold it, or `width` bytes. */
function writeSize(b: ByteBuffer, n: number, width?: number): void {
  let len = 1;
  while (n >= 2 ** (7 * len) - 1) len++;
  if (width) { if (width < len) throw new Error('Size too large'); len = width; }
  // The first byte carries the length (a 1 at its place) and the size's top bits.
  const top = Math.floor(n / 2 ** (8 * (len - 1)));
  b.u8((1 << (8 - len)) | top);
  for (let i = len - 2; i >= 0; i--) b.u8(Math.floor(n / 2 ** (8 * i)) & 255);
}

/** Elements nested as they are written: each master element's size known when it is closed. */
class Elements {
  private stack: ByteBuffer[] = [new ByteBuffer(1024)];
  private get top(): ByteBuffer { return this.stack[this.stack.length - 1]; }
  open(): void { this.stack.push(new ByteBuffer(256)); }
  close(id: number): void { const body = this.stack.pop()!.done(); writeId(this.top, id); writeSize(this.top, body.length); this.top.bytes(body); }
  uint(id: number, v: number, width?: number): void {
    let len = 1;
    while (len < 8 && v >= 2 ** (8 * len)) len++;
    if (width) len = width;
    writeId(this.top, id); writeSize(this.top, len);
    for (let i = len - 1; i >= 0; i--) this.top.u8(Math.floor(v / 2 ** (8 * i)) & 255);
  }
  float(id: number, v: number): void { writeId(this.top, id); writeSize(this.top, 8); this.top.f64(v); }
  text(id: number, s: string): void { const t = new TextEncoder().encode(s); writeId(this.top, id); writeSize(this.top, t.length); this.top.bytes(t); }
  binary(id: number, bytes: Uint8Array): void { writeId(this.top, id); writeSize(this.top, bytes.length); this.top.bytes(bytes); }
  done(): Uint8Array { return this.top.done(); }
}

const idBytes = (id: number) => { const b = new ByteBuffer(4); writeId(b, id); return b.done(); };

interface Frame { data: Uint8Array; key: boolean; ms: number }

export class WebmWriter {
  private readonly write: WriteAt;
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;
  private readonly codecId: string;
  private pos = 0;
  private started = false;
  private finished = false;
  private segmentData = 0;
  private sizeAt = 0;
  private durationAt = 0;
  private cuesSeekAt = 0;
  private cluster: Frame[] = [];
  private readonly cues: Array<{ ms: number; at: number }> = [];
  private lastTime = -Infinity;
  private count = 0;

  constructor(o: { width: number; height: number; fps: number; write: WriteAt; codecId?: string }) {
    this.write = o.write;
    this.width = o.width;
    this.height = o.height;
    this.fps = o.fps;
    this.codecId = o.codecId ?? 'V_VP9';
  }

  /** How many frames are written. */
  get frames(): number { return this.count; }

  /** One frame as the encoder gave it, in the order shown; the first carries the colours. */
  add(data: Uint8Array, key: boolean, timestampUs: number, config?: { colour?: ColourInfo | null }): void {
    if (this.finished) throw new Error('The video file is already finished.');
    if (!this.started && !key) throw new Error('A video has to start with a frame that can be shown on its own.');
    if (!(timestampUs > this.lastTime)) throw new Error('The video encoder gave its frames out of order.');
    this.lastTime = timestampUs;
    if (!this.started) this.header(config?.colour ?? null);
    const ms = Math.round(timestampUs / 1000);
    // A new cluster at each frame shown on its own, and before a frame's time from its cluster's start
    // passes what its 16 bits hold.
    if (this.cluster.length && (key || ms - this.cluster[0].ms > 30000)) this.flushCluster();
    this.cluster.push({ data, key, ms });
    this.count++;
  }

  /** Ends the file: the last cluster, the cues, then the sizes and duration in the header. Returns its size in bytes. */
  finish(): number {
    if (this.finished) return this.pos;
    if (!this.started) throw new Error('No frames were encoded.');
    this.finished = true;
    this.flushCluster();
    const cuesAt = this.pos;
    const e = new Elements();
    e.open();
    for (const c of this.cues) {
      e.open();
      e.uint(ID.CueTime, c.ms);
      e.open(); e.uint(ID.CueTrack, 1); e.uint(ID.CueClusterPosition, c.at - this.segmentData); e.close(ID.CueTrackPositions);
      e.close(ID.CuePoint);
    }
    e.close(ID.Cues);
    this.put(e.done());
    // The header's places left for what is known only now.
    const size = new ByteBuffer(8); writeSize(size, this.pos - this.segmentData, 8); this.write(this.sizeAt, size.done());
    const dur = new ByteBuffer(8); dur.f64(this.lastTime / 1000 + 1000 / this.fps); this.write(this.durationAt, dur.done());
    const cues = new ByteBuffer(8); cues.u64(cuesAt - this.segmentData); this.write(this.cuesSeekAt, cues.done());
    return this.pos;
  }

  private put(bytes: Uint8Array): void { this.write(this.pos, bytes); this.pos += bytes.length; }

  private header(colour: ColourInfo | null): void {
    this.started = true;
    const ebml = new Elements();
    ebml.open();
    ebml.uint(ID.EBMLVersion, 1); ebml.uint(ID.EBMLReadVersion, 1); ebml.uint(ID.EBMLMaxIDLength, 4); ebml.uint(ID.EBMLMaxSizeLength, 8);
    ebml.text(ID.DocType, 'webm'); ebml.uint(ID.DocTypeVersion, 4); ebml.uint(ID.DocTypeReadVersion, 2);
    ebml.close(ID.EBML);
    const head = ebml.done();

    const info = new Elements();
    info.open();
    info.uint(ID.TimecodeScale, 1_000_000); // milliseconds
    info.text(ID.MuxingApp, 'Map Maker'); info.text(ID.WritingApp, 'Map Maker');
    info.float(ID.Duration, 0); // last: its 8 bytes end the element, written at the end
    info.close(ID.Info);
    const infoBytes = info.done();

    const tracks = new Elements();
    tracks.open();
    tracks.open();
    tracks.uint(ID.TrackNumber, 1); tracks.uint(ID.TrackUID, 1); tracks.uint(ID.TrackType, 1); tracks.uint(ID.FlagLacing, 0);
    tracks.text(ID.Language, 'und'); tracks.text(ID.CodecID, this.codecId);
    tracks.uint(ID.DefaultDuration, Math.round(1e9 / this.fps));
    tracks.open();
    tracks.uint(ID.PixelWidth, this.width); tracks.uint(ID.PixelHeight, this.height);
    if (colour) {
      tracks.open();
      tracks.uint(ID.MatrixCoefficients, colour.matrix); tracks.uint(ID.Range, colour.fullRange ? 2 : 1);
      tracks.uint(ID.TransferCharacteristics, colour.transfer); tracks.uint(ID.Primaries, colour.primaries);
      tracks.close(ID.Colour);
    }
    tracks.close(ID.Video);
    tracks.close(ID.TrackEntry);
    tracks.close(ID.Tracks);
    const tracksBytes = tracks.done();

    // Where the header's parts are, from the segment's start (the seek head first, so its length is part of
    // them: every position is written in 8 bytes, so the length does not depend on them); the cues' place,
    // last, written at the end.
    const seekHead = (len: number, cues: number) => {
      const s = new Elements();
      s.open();
      const seek = (id: number, at: number) => { s.open(); s.binary(ID.SeekID, idBytes(id)); s.uint(ID.SeekPosition, at, 8); s.close(ID.Seek); };
      seek(ID.Info, len); seek(ID.Tracks, len + infoBytes.length); seek(ID.Cues, cues);
      s.close(ID.SeekHead);
      return s.done();
    };
    const seekBytes = seekHead(seekHead(0, 0).length, 0);

    const segment = new ByteBuffer(16);
    writeId(segment, ID.Segment);
    this.sizeAt = head.length + segment.length;
    segment.u8(0x01).u32(0xffffffff).u16(0xffff).u8(0xff); // its size: unknown until the end
    this.segmentData = head.length + segment.length;
    this.cuesSeekAt = this.segmentData + seekBytes.length - 8;
    this.durationAt = this.segmentData + seekBytes.length + infoBytes.length - 8;
    this.put(head);
    this.put(segment.done());
    this.put(seekBytes);
    this.put(infoBytes);
    this.put(tracksBytes);
  }

  private flushCluster(): void {
    if (!this.cluster.length) return;
    const start = this.cluster[0].ms;
    const at = this.pos;
    if (this.cluster[0].key) this.cues.push({ ms: start, at });
    const body = new ByteBuffer(this.cluster.reduce((n, f) => n + f.data.length + 16, 16));
    const time = new Elements(); time.uint(ID.Timecode, start); body.bytes(time.done());
    for (const f of this.cluster) {
      writeId(body, ID.SimpleBlock);
      writeSize(body, f.data.length + 4);
      body.u8(0x81).i16(f.ms - start).u8(f.key ? 0x80 : 0).bytes(f.data);
    }
    const cluster = new ByteBuffer(12);
    writeId(cluster, ID.Cluster);
    writeSize(cluster, body.length);
    this.put(cluster.done());
    this.put(body.done());
    this.cluster = [];
  }
}
