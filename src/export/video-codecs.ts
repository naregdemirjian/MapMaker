// What a video of a shot is encoded with (D121): the codec and its level for the size and frame rate, the bit
// rate for the quality chosen, and the colours as the files write them. No browser needed (tested in Node).
import type { ColourInfo } from './mp4-mux.ts';

export type VideoFormat = 'mp4' | 'webm';
export type VideoQuality = 'best' | 'good' | 'small';

export const VIDEO_QUALITIES: Array<{ id: VideoQuality; name: string; bitsPerPixel: number }> = [
  { id: 'best', name: 'Best (large files, for editing)', bitsPerPixel: 0.25 },
  { id: 'good', name: 'Good (for sharing)', bitsPerPixel: 0.1 },
  { id: 'small', name: 'Small (for messages)', bitsPerPixel: 0.04 },
];

/** Bits a second for a video of this size, frame rate and quality (maps are flat colour and fine lines: a quarter of a bit a pixel keeps names sharp). */
export function videoBitrate(width: number, height: number, fps: number, quality: VideoQuality = 'good'): number {
  const q = VIDEO_QUALITIES.find((x) => x.id === quality) ?? VIDEO_QUALITIES[1];
  return Math.max(250_000, Math.round(width * height * fps * q.bitsPerPixel));
}

/** The size a video is made at: even widths and heights (as H.264 and VP9 code colour, in pairs of pixels). */
export function videoSize(width: number, height: number): [number, number] {
  return [Math.max(2, width - (width % 2)), Math.max(2, height - (height % 2))];
}

// H.264 levels (ITU-T H.264 table A-1): level_idc, macroblocks a second, macroblocks a frame, bit rate (kbit/s, High profile: x1.25).
const H264_LEVELS: Array<[number, number, number, number]> = [
  [30, 40500, 1620, 10000], [31, 108000, 3600, 14000], [32, 216000, 5120, 20000], [40, 245760, 8192, 20000],
  [41, 245760, 8192, 50000], [42, 522240, 8704, 50000], [50, 589824, 22080, 135000], [51, 983040, 36864, 240000],
  [52, 2073600, 36864, 240000], [60, 4177920, 139264, 240000], [61, 8355840, 139264, 480000], [62, 16711680, 139264, 800000],
];

/** The lowest H.264 level a video of this size, rate and bit rate fits (level_idc: 40 is 4.0), or null when none does. */
export function h264Level(width: number, height: number, fps: number, bitrate: number): number | null {
  const mbw = Math.ceil(width / 16), mbh = Math.ceil(height / 16), fs = mbw * mbh;
  for (const [level, mbps, maxFs, br] of H264_LEVELS) {
    const side = Math.sqrt(maxFs * 8);
    if (fs <= maxFs && mbw <= side && mbh <= side && fs * fps <= mbps && bitrate <= br * 1250) return level;
  }
  return null;
}

// VP9 levels (the WebM project's table): level, luma samples a second, luma samples a picture, bit rate (kbit/s).
const VP9_LEVELS: Array<[number, number, number, number]> = [
  [10, 829440, 36864, 200], [11, 2764800, 73728, 800], [20, 4608000, 122880, 1800], [21, 9216000, 245760, 3600],
  [30, 20736000, 552960, 7200], [31, 36864000, 983040, 12000], [40, 83558400, 2228224, 18000], [41, 160432128, 2228224, 30000],
  [50, 311951360, 8912896, 60000], [51, 588251136, 8912896, 120000], [52, 1176502272, 8912896, 180000], [60, 1176502272, 35651584, 180000],
  [61, 2353004544, 35651584, 240000], [62, 4706009088, 35651584, 480000],
];

/** The lowest VP9 level a video fits (10 is 1.0, 62 is 6.2); the highest when it fits none. */
export function vp9Level(width: number, height: number, fps: number, bitrate: number): number {
  const ps = width * height;
  for (const [level, sps, maxPs, br] of VP9_LEVELS) if (ps <= maxPs && ps * fps <= sps && bitrate <= br * 1000) return level;
  return 62;
}

/**
 * The codecs to ask the browser's encoder for, best first: H.264 High, Main and Constrained Baseline at the
 * level the video needs (MP4); VP9 profile 0, 8 bits (WebM). Empty when the video is too large for H.264.
 */
export function videoCodecs(format: VideoFormat, width: number, height: number, fps: number, bitrate: number): string[] {
  if (format === 'webm') return [`vp09.00.${vp9Level(width, height, fps, bitrate)}.08`];
  const level = h264Level(width, height, fps, bitrate);
  if (level === null) return [];
  const hex = level.toString(16).padStart(2, '0');
  return [`avc1.6400${hex}`, `avc1.4d00${hex}`, `avc1.42e0${hex}`];
}

/** Bytes of a video: its bit rate over its length, and a little for the tables. */
export function videoBytes(width: number, height: number, fps: number, frames: number, quality: VideoQuality = 'good'): number {
  const [w, h] = videoSize(width, height);
  return Math.round((videoBitrate(w, h, fps, quality) * frames) / fps / 8 + frames * 16 + 4096);
}

// The browser's names for colour coding (WebCodecs VideoColorSpace) as ITU-T H.273 numbers.
const PRIMARIES: Record<string, number> = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER: Record<string, number> = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 };
const MATRIX: Record<string, number> = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };

/** The colours the encoder says it coded, as the files write them; null when it does not say all of it. */
export function colourOf(cs: { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null } | null | undefined): ColourInfo | null {
  if (!cs?.primaries || !cs.transfer || !cs.matrix) return null;
  const primaries = PRIMARIES[cs.primaries], transfer = TRANSFER[cs.transfer], matrix = MATRIX[cs.matrix];
  if (primaries === undefined || transfer === undefined || matrix === undefined) return null;
  return { primaries, transfer, matrix, fullRange: !!cs.fullRange };
}

/** A bit rate for people: "12 Mbit/s", "800 kbit/s". */
export function formatBitrate(bps: number): string {
  return bps >= 1e6 ? `${bps >= 1e7 ? Math.round(bps / 1e6) : (bps / 1e6).toFixed(1)} Mbit/s` : `${Math.round(bps / 1000)} kbit/s`;
}
