// Video files (D121): the MP4 and WebM writers, read back by parsers of their own here; and, where FFmpeg is on
// the computer, real H.264 and VP9 streams written by them and played by FFmpeg frame for frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mp4Writer, frameTiming } from '../src/export/mp4-mux.ts';
import { WebmWriter } from '../src/export/webm-mux.ts';
import { h264Level, vp9Level, videoCodecs, videoBitrate, videoSize, colourOf, videoBytes, formatBitrate } from '../src/export/video-codecs.ts';

/** A file made from writes at positions. */
function fileOf(): { write: (at: number, b: Uint8Array) => void; bytes: () => Uint8Array } {
  let buf = new Uint8Array(1 << 16), size = 0;
  return {
    write: (at, b) => {
      if (at + b.length > buf.length) { const n = new Uint8Array(Math.max(buf.length * 2, at + b.length)); n.set(buf); buf = n; }
      buf.set(b, at); size = Math.max(size, at + b.length);
    },
    bytes: () => buf.slice(0, size),
  };
}

// ---- MP4 read back: boxes, and the tables of the one track. ----
interface Box { type: string; start: number; size: number; body: number }
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);
function boxes(d: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  for (let p = from; p < to;) {
    let size = d.getUint32(p), body = p + 8;
    const type = String.fromCharCode(d.getUint8(p + 4), d.getUint8(p + 5), d.getUint8(p + 6), d.getUint8(p + 7));
    if (size === 1) { size = d.getUint32(p + 8) * 2 ** 32 + d.getUint32(p + 12); body = p + 16; }
    assert.ok(size >= 8 && p + size <= to, `box ${type} fits`);
    out.push({ type, start: p, size, body });
    p += size;
  }
  return out;
}
function find(d: DataView, path: string[], from = 0, to = d.byteLength): Box {
  let list = boxes(d, from, to), b: Box | undefined;
  for (const [i, type] of path.entries()) {
    b = list.find((x) => x.type === type);
    assert.ok(b, `box ${path.slice(0, i + 1).join('/')}`);
    if (i < path.length - 1) {
      // (stsd and avc1 have fields before their boxes.)
      const skip = b.type === 'stsd' ? 8 : b.type === 'avc1' ? 78 : 0;
      assert.ok(CONTAINERS.has(b.type) || skip, `${b.type} holds boxes`);
      list = boxes(d, b.body + skip, b.start + b.size);
    }
  }
  return b!;
}
function readMp4(file: Uint8Array) {
  const d = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const top = boxes(d, 0, d.byteLength);
  const stbl = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
  const u32s = (b: Box, skip: number, n: number, step = 1) => Array.from({ length: n }, (_, i) => d.getUint32(b.body + skip + i * 4 * step));
  const stsz = find(d, [...stbl, 'stsz']), n = d.getUint32(stsz.body + 8);
  const stco = boxes(d, find(d, stbl).body, find(d, stbl).start + find(d, stbl).size).find((b) => b.type === 'stco' || b.type === 'co64')!;
  const offsets = stco.type === 'stco' ? u32s(stco, 8, n) : Array.from({ length: n }, (_, i) => d.getUint32(stco.body + 8 + i * 8) * 2 ** 32 + d.getUint32(stco.body + 12 + i * 8));
  const stss = find(d, [...stbl, 'stss']);
  const stts = find(d, [...stbl, 'stts']);
  const mdhd = find(d, ['moov', 'trak', 'mdia', 'mdhd']);
  const tkhd = find(d, ['moov', 'trak', 'tkhd']);
  const avcC = find(d, [...stbl, 'stsd', 'avc1', 'avcC']);
  const avc1 = boxes(d, find(d, [...stbl, 'stsd']).body + 8, find(d, [...stbl, 'stsd']).start + find(d, [...stbl, 'stsd']).size)[0];
  const colr = boxes(d, avc1.body + 78, avc1.start + avc1.size).find((b) => b.type === 'colr');
  return {
    top: top.map((b) => b.type), mdat: top.find((b) => b.type === 'mdat')!, co64: stco.type === 'co64',
    sizes: u32s(stsz, 12, n), offsets,
    keys: u32s(stss, 8, d.getUint32(stss.body + 4)),
    stts: Array.from({ length: d.getUint32(stts.body + 4) }, (_, i) => [d.getUint32(stts.body + 8 + i * 8), d.getUint32(stts.body + 12 + i * 8)]),
    timescale: d.getUint32(mdhd.body + 12), duration: d.getUint32(mdhd.body + 16),
    width: d.getUint32(tkhd.body + 76) / 65536, height: d.getUint32(tkhd.body + 80) / 65536,
    entry: [d.getUint16(avc1.body + 24), d.getUint16(avc1.body + 26)],
    avcC: file.slice(avcC.body, avcC.start + avcC.size),
    colr: colr ? [String.fromCharCode(...file.slice(colr.body, colr.body + 4)), d.getUint16(colr.body + 4), d.getUint16(colr.body + 6), d.getUint16(colr.body + 8), d.getUint8(colr.body + 10)] : null,
  };
}

// ---- WebM read back: elements, the track, the clusters' frames and the cues. ----
interface El { id: number; start: number; data: number; end: number }
function vint(f: Uint8Array, p: number, keepMarker: boolean): { v: number; len: number; unknown: boolean } {
  const first = f[p];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  assert.ok(len <= 8, 'a valid length');
  let v = keepMarker ? first : first & (0xff >> len), all = (first & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) { v = v * 256 + f[p + i]; if (f[p + i] !== 0xff) all = false; }
  return { v, len, unknown: !keepMarker && all };
}
function elements(f: Uint8Array, from: number, to: number): El[] {
  const out: El[] = [];
  for (let p = from; p < to;) {
    const id = vint(f, p, true), size = vint(f, p + id.len, false);
    const data = p + id.len + size.len, end = size.unknown ? to : data + size.v;
    assert.ok(end <= to, `element ${id.v.toString(16)} fits`);
    out.push({ id: id.v, start: p, data, end });
    p = end;
  }
  return out;
}
const uintOf = (f: Uint8Array, e: El) => { let v = 0; for (let i = e.data; i < e.end; i++) v = v * 256 + f[i]; return v; };
const child = (f: Uint8Array, e: El, id: number) => elements(f, e.data, e.end).find((x) => x.id === id);
function readWebm(file: Uint8Array) {
  const top = elements(file, 0, file.length);
  assert.equal(top[0].id, 0x1a45dfa3, 'EBML header first');
  assert.equal(new TextDecoder().decode(file.slice(child(file, top[0], 0x4282)!.data, child(file, top[0], 0x4282)!.end)), 'webm');
  const seg = top[1];
  assert.equal(seg.id, 0x18538067);
  assert.equal(seg.end, file.length, 'the segment holds the rest of the file, its size written');
  const parts = elements(file, seg.data, seg.end);
  const info = parts.find((e) => e.id === 0x1549a966)!, tracks = parts.find((e) => e.id === 0x1654ae6b)!, cues = parts.find((e) => e.id === 0x1c53bb6b)!;
  const seeks = elements(file, parts[0].data, parts[0].end).map((s) => {
    const id = child(file, s, 0x53ab)!, pos = child(file, s, 0x53ac)!;
    return [uintOf(file, id), uintOf(file, pos)];
  });
  const entry = child(file, tracks, 0xae)!, video = child(file, entry, 0xe0)!, colour = child(file, video, 0x55b0);
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const frames: Array<{ ms: number; key: boolean; bytes: Uint8Array }> = [];
  const clusters = parts.filter((e) => e.id === 0x1f43b675);
  for (const c of clusters) {
    const t = uintOf(file, child(file, c, 0xe7)!);
    for (const b of elements(file, c.data, c.end).filter((e) => e.id === 0xa3)) {
      assert.equal(file[b.data], 0x81, 'track 1');
      frames.push({ ms: t + dv.getInt16(b.data + 1), key: !!(file[b.data + 3] & 0x80), bytes: file.slice(b.data + 4, b.end) });
    }
  }
  return {
    segData: seg.data, seeks, parts: parts.map((p) => p.id), clusters: clusters.map((c) => ({ at: c.start - seg.data, ms: uintOf(file, child(file, c, 0xe7)!) })),
    positions: { info: info.start - seg.data, tracks: tracks.start - seg.data, cues: cues.start - seg.data },
    timecodeScale: uintOf(file, child(file, info, 0x2ad7b1)!), duration: dv.getFloat64(child(file, info, 0x4489)!.data),
    codec: new TextDecoder().decode(file.slice(child(file, entry, 0x86)!.data, child(file, entry, 0x86)!.end)),
    defaultDuration: uintOf(file, child(file, entry, 0x23e383)!),
    width: uintOf(file, child(file, video, 0xb0)!), height: uintOf(file, child(file, video, 0xba)!),
    colour: colour ? [0x55b1, 0x55b9, 0x55ba, 0x55bb].map((id) => uintOf(file, child(file, colour, id)!)) : null,
    cues: elements(file, cues.data, cues.end).map((cp) => [uintOf(file, child(file, cp, 0xb3)!), uintOf(file, child(file, child(file, cp, 0xb7)!, 0xf1)!)]),
    frames,
  };
}

const fakeFrame = (i: number, n = 50 + ((i * 37) % 200)) => Uint8Array.from({ length: n }, (_, k) => (i * 31 + k) & 255);

test('frame rates timed exactly; codecs and levels for the size, rate and bit rate; colours as numbers', () => {
  assert.deepEqual(frameTiming(23.976), { timescale: 24000, delta: 1001 });
  assert.deepEqual(frameTiming(29.97), { timescale: 30000, delta: 1001 });
  assert.deepEqual(frameTiming(59.94), { timescale: 60000, delta: 1001 });
  assert.deepEqual(frameTiming(24), { timescale: 24000, delta: 1000 });
  assert.deepEqual(frameTiming(25), { timescale: 25000, delta: 1000 });
  assert.deepEqual(frameTiming(12.5), { timescale: 12500, delta: 1000 });
  const br = (w: number, h: number, f: number, q: 'best' | 'good' | 'small' = 'best') => videoBitrate(w, h, f, q);
  assert.equal(br(1920, 1080, 30), 15_552_000, 'a quarter of a bit a pixel');
  assert.ok(br(1920, 1080, 30, 'small') < br(1920, 1080, 30, 'good'));
  assert.equal(h264Level(1920, 1080, 30, br(1920, 1080, 30)), 40);
  assert.equal(h264Level(1920, 1080, 60, br(1920, 1080, 60)), 42);
  assert.equal(h264Level(3840, 2160, 30, br(3840, 2160, 30)), 51);
  assert.equal(h264Level(3840, 2160, 60, br(3840, 2160, 60, 'good')), 52);
  assert.equal(h264Level(7680, 4320, 24, br(7680, 4320, 24, 'good')), 60);
  assert.equal(h264Level(16384, 16384, 30, 1e6), null, 'beyond H.264');
  assert.deepEqual(videoCodecs('mp4', 1920, 1080, 30, br(1920, 1080, 30)), ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']);
  assert.deepEqual(videoCodecs('mp4', 16384, 16384, 30, 1e6), []);
  assert.equal(vp9Level(1920, 1080, 30, br(1920, 1080, 30)), 40);
  assert.equal(vp9Level(3840, 2160, 30, br(3840, 2160, 30)), 51, 'level 5 holds 60 Mbit/s, not 62');
  assert.deepEqual(videoCodecs('webm', 1280, 720, 24, 2e6), ['vp09.00.31.08']);
  assert.deepEqual(videoSize(1921, 1081), [1920, 1080], 'even sizes');
  assert.ok(Math.abs(videoBytes(1920, 1080, 30, 300, 'best') - (15_552_000 * 10) / 8) < 20000, 'its bit rate over its length');
  assert.deepEqual(colourOf({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }), { primaries: 1, transfer: 1, matrix: 1, fullRange: false });
  assert.deepEqual(colourOf({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'smpte170m', fullRange: true }), { primaries: 1, transfer: 13, matrix: 6, fullRange: true });
  assert.equal(colourOf({ primaries: 'bt709', transfer: null, matrix: 'bt709' }), null);
  assert.equal(formatBitrate(15_552_000), '16 Mbit/s');
  assert.equal(formatBitrate(2_500_000), '2.5 Mbit/s');
});

test('MP4: frames in the order given, the tables a player reads them by, the frame rate exact, the decoder configuration and colours', () => {
  const f = fileOf();
  const avcC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);
  const w = new Mp4Writer({ width: 1280, height: 720, fps: 23.976, write: f.write });
  const n = 60, gop = 24;
  for (let i = 0; i < n; i++) w.add(fakeFrame(i), i % gop === 0, Math.round((i * 1e6) / 23.976), i === 0 ? { description: avcC, colour: { primaries: 1, transfer: 1, matrix: 1, fullRange: false } } : undefined);
  assert.equal(w.frames, n);
  const size = w.finish();
  const file = f.bytes();
  assert.equal(size, file.length);
  const m = readMp4(file);
  assert.deepEqual(m.top, ['ftyp', 'mdat', 'moov'], 'the tables after the frames');
  assert.equal(m.mdat.size, 16 + Array.from({ length: n }, (_, i) => fakeFrame(i).length).reduce((a, b) => a + b, 0), 'the frames\' box sized at the end');
  assert.deepEqual(m.sizes, Array.from({ length: n }, (_, i) => fakeFrame(i).length));
  for (let i = 0; i < n; i++) assert.deepEqual(file.slice(m.offsets[i], m.offsets[i] + m.sizes[i]), fakeFrame(i), `frame ${i} where the table says`);
  assert.deepEqual(m.keys, [1, 25, 49], 'frames to start from (counted from 1)');
  assert.deepEqual(m.stts, [[n, 1001]]);
  assert.equal(m.timescale, 24000);
  assert.equal(m.duration, n * 1001);
  assert.deepEqual([m.width, m.height], [1280, 720]);
  assert.deepEqual(m.entry, [1280, 720]);
  assert.deepEqual(m.avcC, avcC);
  assert.deepEqual(m.colr, ['nclx', 1, 1, 1, 0]);
  assert.equal(m.co64, false);
  // Refused: frames out of order, a start that cannot be shown on its own, no configuration, adding when done.
  const g = new Mp4Writer({ width: 64, height: 64, fps: 30, write: () => {} });
  assert.throws(() => g.add(fakeFrame(0), false, 0), /start with a frame/);
  g.add(fakeFrame(0), true, 0);
  assert.throws(() => g.add(fakeFrame(1), false, 0), /out of order/);
  assert.throws(() => g.finish(), /no decoder configuration/);
  assert.throws(() => new Mp4Writer({ width: 64, height: 64, fps: 30, write: () => {} }).finish(), /No frames/);
  assert.throws(() => w.add(fakeFrame(1), true, 1e9), /already finished/);
});

test('MP4 past 4 GB: 64-bit places for the frames and the size of their box', () => {
  // 70 frames of 64 MB (the same bytes each time; only where they go is kept).
  const big = new Uint8Array(64 << 20);
  let moov: Uint8Array | null = null, mdatSize: Uint8Array | null = null, end = 0;
  const w = new Mp4Writer({ width: 3840, height: 2160, fps: 30, write: (at, b) => { if (b === big) { end = Math.max(end, at + b.length); return; } if (b.length === 8 && at === 32 + 8) mdatSize = b; else if (at >= end && end) moov = b; } });
  for (let i = 0; i < 70; i++) w.add(big, i % 30 === 0, i * 33333, i === 0 ? { description: Uint8Array.from([1, 0x64, 0, 0x33, 0xff, 0xe0, 0]) } : undefined);
  const size = w.finish();
  assert.ok(size > 2 ** 32);
  const sz = new DataView(mdatSize!.buffer, mdatSize!.byteOffset);
  assert.equal(sz.getUint32(0) * 2 ** 32 + sz.getUint32(4), 16 + 70 * big.length);
  // The tables read on their own: co64 places, the last beyond 4 GB.
  const d = new DataView(moov!.buffer, moov!.byteOffset, moov!.byteLength);
  const stbl = find(d, ['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const co64 = boxes(d, stbl.body, stbl.start + stbl.size).find((b) => b.type === 'co64');
  assert.ok(co64, 'co64, not stco');
  const last = d.getUint32(co64.body + 8 + 69 * 8) * 2 ** 32 + d.getUint32(co64.body + 12 + 69 * 8);
  assert.equal(last, 48 + 69 * big.length);
});

test('WebM: the header, frames in clusters from each frame shown on its own, cues to them, the sizes and duration written at the end', () => {
  const f = fileOf();
  const w = new WebmWriter({ width: 1920, height: 1080, fps: 25, write: f.write });
  const n = 130, gop = 50;
  for (let i = 0; i < n; i++) w.add(fakeFrame(i), i % gop === 0, i * 40000, i === 0 ? { colour: { primaries: 1, transfer: 13, matrix: 6, fullRange: false } } : undefined);
  assert.equal(w.frames, n);
  const size = w.finish();
  const file = f.bytes();
  assert.equal(size, file.length);
  const m = readWebm(file);
  assert.deepEqual(m.parts, [0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1f43b675, 0x1f43b675, 0x1c53bb6b], 'seek head, info, tracks, three clusters, cues');
  assert.deepEqual(m.seeks, [[0x1549a966, m.positions.info], [0x1654ae6b, m.positions.tracks], [0x1c53bb6b, m.positions.cues]], 'the seek head finds the info, tracks and cues');
  assert.equal(m.timecodeScale, 1_000_000);
  assert.equal(m.duration, n * 40, 'milliseconds, written at the end');
  assert.equal(m.codec, 'V_VP9');
  assert.equal(m.defaultDuration, 40_000_000);
  assert.deepEqual([m.width, m.height], [1920, 1080]);
  assert.deepEqual(m.colour, [6, 1, 13, 1], 'matrix, range (broadcast), transfer, primaries');
  assert.deepEqual(m.clusters.map((c) => c.ms), [0, 2000, 4000]);
  assert.deepEqual(m.cues, m.clusters.map((c) => [c.ms, c.at]), 'a cue for each cluster, where it is');
  assert.equal(m.frames.length, n);
  for (const [i, fr] of m.frames.entries()) {
    assert.equal(fr.ms, i * 40);
    assert.equal(fr.key, i % gop === 0);
    assert.deepEqual(fr.bytes, fakeFrame(i));
  }
  // Long stretches without a frame to start from still fit a cluster's 16-bit times.
  const g = fileOf(), long = new WebmWriter({ width: 64, height: 64, fps: 1, write: g.write });
  for (let i = 0; i < 70; i++) long.add(fakeFrame(i), i === 0, i * 1e6);
  long.finish();
  const lm = readWebm(g.bytes());
  assert.ok(lm.clusters.length >= 3);
  assert.deepEqual(lm.frames.map((x) => x.ms), Array.from({ length: 70 }, (_, i) => i * 1000));
  assert.equal(lm.cues.length, 1, 'cues only at frames to start from');
  assert.throws(() => new WebmWriter({ width: 64, height: 64, fps: 30, write: () => {} }).add(fakeFrame(0), false, 0), /start with a frame/);
  assert.throws(() => new WebmWriter({ width: 64, height: 64, fps: 30, write: () => {} }).finish(), /No frames/);
});

// ---- Real streams through FFmpeg, where it is installed (not needed by the app). ----
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

/** H.264 in Annex B (start codes) as frames in "avc" form and the avcC record. */
function annexBToAvc(stream: Uint8Array): { frames: Array<{ data: Uint8Array; key: boolean }>; avcC: Uint8Array } {
  const nals: Uint8Array[] = [];
  let i = 0, start = -1;
  while (i + 3 <= stream.length) {
    const sc = stream[i] === 0 && stream[i + 1] === 0 && (stream[i + 2] === 1 || (stream[i + 2] === 0 && stream[i + 3] === 1));
    if (sc) { if (start >= 0) nals.push(stream.slice(start, i)); i += stream[i + 2] === 1 ? 3 : 4; start = i; } else i++;
  }
  if (start >= 0) nals.push(stream.slice(start));
  let sps: Uint8Array | null = null, pps: Uint8Array | null = null;
  const frames: Array<{ data: Uint8Array; key: boolean }> = [];
  let cur: Uint8Array[] = [], key = false;
  const flush = () => { if (!cur.length) return; const len = cur.reduce((a, n) => a + 4 + n.length, 0), out = new Uint8Array(len), dv = new DataView(out.buffer); let p = 0; for (const n of cur) { dv.setUint32(p, n.length); out.set(n, p + 4); p += 4 + n.length; } frames.push({ data: out, key }); cur = []; key = false; };
  for (const nal of nals) {
    // (Trailing zero bytes belong to no unit.)
    let end = nal.length; while (end > 0 && nal[end - 1] === 0) end--;
    const u = nal.slice(0, end), type = u[0] & 31;
    if (type === 9) { flush(); continue; }
    if (type === 7) { sps = u; continue; }
    if (type === 8) { pps = u; continue; }
    if (type === 5) key = true;
    if (type === 1 || type === 5 || type === 6) cur.push(u);
  }
  flush();
  assert.ok(sps && pps);
  const avcC = Uint8Array.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps]);
  return { frames, avcC };
}

/** VP9 frames out of an IVF file. */
function ivfFrames(f: Uint8Array): Array<{ data: Uint8Array; key: boolean }> {
  const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const out: Array<{ data: Uint8Array; key: boolean }> = [];
  for (let p = dv.getUint16(6, true); p + 12 <= f.length;) {
    const n = dv.getUint32(p, true), data = f.slice(p + 12, p + 12 + n);
    // A VP9 key frame: frame marker 2, profile 0, show_existing 0, frame_type 0.
    out.push({ data, key: (data[0] & 0xf0) === 0x80 && !(data[0] & 0x04) });
    p += 12 + n;
  }
  return out;
}

const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file]).toString());
const md5s = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop()!.trim());

test('real H.264 and VP9 written by the writers: FFmpeg reads every frame, at the frame rate, the same pictures as the streams', { skip: !ffmpeg && 'FFmpeg is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-video-'));
  try {
    // 48 frames of a moving test picture at 23.976 fps, a frame to start from every 24.
    const src = ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24000/1001:duration=2.0021'];
    execFileSync('ffmpeg', [...src, '-frames:v', '48', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bf', '0', '-g', '24', '-bsf:v', 'h264_metadata=aud=insert', '-f', 'h264', join(dir, 'a.h264')]);
    const h = annexBToAvc(new Uint8Array(readFileSync(join(dir, 'a.h264'))));
    assert.equal(h.frames.length, 48);
    const f1 = fileOf(), mp4 = new Mp4Writer({ width: 320, height: 240, fps: 23.976, write: f1.write });
    h.frames.forEach((fr, i) => mp4.add(fr.data, fr.key, Math.round((i * 1e6 * 1001) / 24000), i === 0 ? { description: h.avcC } : undefined));
    mp4.finish();
    writeFileSync(join(dir, 'a.mp4'), f1.bytes());
    const p1 = probe(join(dir, 'a.mp4'));
    assert.equal(p1.streams[0].codec_name, 'h264');
    assert.equal(Number(p1.streams[0].nb_read_frames), 48);
    assert.equal(p1.streams[0].r_frame_rate, '24000/1001');
    assert.ok(Math.abs(Number(p1.format.duration) - (48 * 1001) / 24000) < 0.002);
    assert.deepEqual(md5s(join(dir, 'a.mp4')), md5s(join(dir, 'a.h264')), 'the same pictures, in order');

    execFileSync('ffmpeg', [...src, '-frames:v', '48', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-g', '24', '-auto-alt-ref', '0', '-lag-in-frames', '0', '-deadline', 'realtime', '-cpu-used', '8', '-f', 'ivf', join(dir, 'b.ivf')]);
    const v = ivfFrames(new Uint8Array(readFileSync(join(dir, 'b.ivf'))));
    assert.equal(v.length, 48);
    const f2 = fileOf(), webm = new WebmWriter({ width: 320, height: 240, fps: 23.976, write: f2.write });
    v.forEach((fr, i) => webm.add(fr.data, fr.key, Math.round((i * 1e6 * 1001) / 24000)));
    webm.finish();
    writeFileSync(join(dir, 'b.webm'), f2.bytes());
    const p2 = probe(join(dir, 'b.webm'));
    assert.equal(p2.streams[0].codec_name, 'vp9');
    assert.equal(Number(p2.streams[0].nb_read_frames), 48);
    assert.ok(Math.abs(Number(p2.format.duration) - (48 * 1001) / 24000) < 0.002, `duration ${p2.format.duration}`);
    assert.deepEqual(md5s(join(dir, 'b.webm')), md5s(join(dir, 'b.ivf')), 'the same pictures, in order');
    // Seeking by the cues: the frame two seconds in, as FFmpeg finds it.
    const at = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1.0', '-i', join(dir, 'b.webm'), '-frames:v', '1', '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && !l.startsWith('#'));
    assert.equal(at.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
