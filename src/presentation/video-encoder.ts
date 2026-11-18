// Videos of shots (D121): frames drawn by the export, encoded by the browser's own video encoder (WebCodecs:
// the graphics card's where it has one) and written by the MP4 or WebM writer into a file the data service
// fills as it goes. Nothing is installed: Chromium, and so the app, has H.264 and VP9 encoders.
import { Mp4Writer, type WriteAt } from '../export/mp4-mux.ts';
import { WebmWriter } from '../export/webm-mux.ts';
import { videoCodecs, videoBitrate, videoSize, colourOf, type VideoFormat, type VideoQuality } from '../export/video-codecs.ts';

export interface VideoPlan {
  format: VideoFormat;
  quality: VideoQuality;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  config: VideoEncoderConfig;
}

const plans = new Map<string, Promise<VideoPlan | { error: string }>>();

/**
 * How the browser can encode this video: the first codec it can, at the level the size and frame rate need;
 * or why it cannot (no encoder, a size beyond H.264). Answers are kept: asking takes a moment.
 */
export function planVideo(format: VideoFormat, width: number, height: number, fps: number, quality: VideoQuality = 'good'): Promise<VideoPlan | { error: string }> {
  const key = JSON.stringify([format, width, height, fps, quality]);
  let p = plans.get(key);
  if (!p) { p = findPlan(format, width, height, fps, quality); plans.set(key, p); }
  return p;
}

async function findPlan(format: VideoFormat, width: number, height: number, fps: number, quality: VideoQuality): Promise<VideoPlan | { error: string }> {
  const name = format === 'mp4' ? 'MP4 (H.264)' : 'WebM (VP9)';
  if (typeof VideoEncoder === 'undefined') return { error: `This browser cannot encode videos. Use the Map Maker app (or Chrome or Edge), or export image sequences.` };
  const [w, h] = videoSize(width, height);
  const bitrate = videoBitrate(w, h, fps, quality);
  const codecs = videoCodecs(format, w, h, fps, bitrate);
  if (!codecs.length) return { error: `H.264 does not go up to ${w} x ${h} at ${fps} fps. Choose WebM (VP9) or a smaller size.` };
  for (const codec of codecs) {
    const config: VideoEncoderConfig = {
      codec, width: w, height: h, bitrate, framerate: fps, bitrateMode: 'variable', latencyMode: 'quality', hardwareAcceleration: 'no-preference',
      ...(format === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return { format, quality, width: w, height: h, fps, bitrate, config };
    } catch { /* (an invalid configuration: the next codec) */ }
  }
  return { error: `This computer cannot encode ${name} video at ${w} x ${h}, ${fps} fps. Try ${format === 'mp4' ? 'WebM (VP9)' : 'MP4 (H.264)'}, a smaller size, or image sequences.` };
}

/** A copy of the bytes of a buffer or a view of one. */
const bytesOf = (b: AllowSharedBufferSource): Uint8Array => (ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b)).slice();

/** The encoder and the file's writer: frames in, the file's bytes out through `write`. */
export class VideoFileEncoder {
  private readonly plan: VideoPlan;
  private readonly encoder: VideoEncoder;
  private readonly writer: Mp4Writer | WebmWriter;
  private readonly gop: number;
  private failure: unknown = null;
  private count = 0;

  constructor(plan: VideoPlan, write: WriteAt) {
    this.plan = plan;
    const o = { width: plan.width, height: plan.height, fps: plan.fps, write };
    this.writer = plan.format === 'mp4' ? new Mp4Writer(o) : new WebmWriter(o);
    // A frame to start from every two seconds: players and editors seek to them.
    this.gop = Math.max(1, Math.round(plan.fps * 2));
    this.encoder = new VideoEncoder({ output: (chunk, meta) => this.output(chunk, meta), error: (e) => { this.failure ??= e; } });
    this.encoder.configure(plan.config);
  }

  private output(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    try {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const dc = meta?.decoderConfig;
      this.writer.add(data, chunk.type === 'key', chunk.timestamp, { description: dc?.description ? bytesOf(dc.description) : null, colour: colourOf(dc?.colorSpace) });
    } catch (e) { this.failure ??= e; }
  }

  /** Encodes the picture on the canvas as the next frame; waits while the encoder has several in hand. */
  async add(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<void> {
    this.check();
    const i = this.count++, fps = this.plan.fps;
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), alpha: 'discard' });
    try {
      this.encoder.encode(frame, { keyFrame: i % this.gop === 0 });
    } finally {
      frame.close();
    }
    while (this.encoder.encodeQueueSize > 3 && !this.failure) {
      await new Promise<void>((r) => { const t = setTimeout(r, 25); this.encoder.addEventListener('dequeue', () => { clearTimeout(t); r(); }, { once: true }); });
    }
    this.check();
  }

  /** Encodes what is left and ends the file. Returns its size in bytes. */
  async finish(): Promise<number> {
    this.check();
    await this.encoder.flush();
    this.check();
    this.encoder.close();
    if (this.writer.frames !== this.count) throw new Error(`The video encoder gave ${this.writer.frames} of ${this.count} frames.`);
    return this.writer.finish();
  }

  /** Stops (a cancelled or failed export). */
  close(): void { try { if (this.encoder.state !== 'closed') this.encoder.close(); } catch { /* (already closed) */ } }

  private check(): void {
    if (!this.failure) return;
    const e = this.failure as Error;
    throw new Error(`The video encoder stopped: ${e?.message ?? String(e)}. Try the other video format, a smaller size, or image sequences.`);
  }
}

/**
 * The file's bytes on their way to the data service: writes that follow on are sent together (a few
 * megabytes at a time), in order; `room` waits while too much is still on its way.
 */
export class UploadSink {
  private readonly send: (at: number, bytes: Blob) => Promise<unknown>;
  private parts: Uint8Array[] = [];
  private start = 0;
  private size = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private failure: unknown = null;
  /** Bytes sent so far. */
  sent = 0;

  constructor(send: (at: number, bytes: Blob) => Promise<unknown>) { this.send = send; }

  readonly write = (at: number, bytes: Uint8Array): void => {
    if (this.size && at !== this.start + this.size) this.flush();
    if (!this.size) this.start = at;
    this.parts.push(bytes);
    this.size += bytes.length;
    if (this.size >= 4 << 20) this.flush();
  };

  private flush(): void {
    if (!this.size) return;
    const blob = new Blob(this.parts as BlobPart[]), at = this.start, n = this.size;
    this.parts = []; this.size = 0;
    this.waiting += n;
    this.chain = this.chain.then(() => (this.failure ? null : this.send(at, blob))).then(() => { this.waiting -= n; this.sent += n; }, (e) => { this.failure ??= e; this.waiting -= n; });
  }

  /** Waits while more than `limit` bytes are on their way. */
  async room(limit = 64 << 20): Promise<void> {
    if (this.size >= limit) this.flush();
    while (this.waiting > limit && !this.failure) await this.chain;
    if (this.failure) throw this.failure;
  }

  /** Sends what is left and waits for all of it. */
  async done(): Promise<void> {
    this.flush();
    await this.chain;
    if (this.failure) throw this.failure;
  }
}
