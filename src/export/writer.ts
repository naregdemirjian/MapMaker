// Export jobs on the data-service side: frames rendered by the map engine arrive as raw RGBA pixels,
// are encoded here and written as numbered image sequences with a manifest and a compositing guide.
import { existsSync, mkdirSync, writeFileSync, copyFileSync, openSync, writeSync, readSync, closeSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { encodePNG, tagSRGB } from './png.ts';

export interface PassInfo { name: string; label: string; blend: string; note?: string }

export interface ExportSettings {
  shotName: string;
  width: number;
  height: number;
  fps: number;
  frameStart: number;
  frameEnd: number;
  passes: PassInfo[];
  transparent: boolean;
  projectHead: number;
  appVersion: string;
  historicalRange?: [string, string];
  notes?: string;
  /** Credit lines for the datasets drawn in the frames. */
  credits?: string[];
  /** Folder to export into (absolute path); empty or absent: the project's own exports folder. */
  exportDir?: string | null;
  /** The files written (D109): 'png' (absent) or 'tiff' (either compression; the browser encodes them); or one video file (D121). */
  format?: 'png' | 'tiff' | 'mp4' | 'webm';
  /** A video's codec (as the browser names it), bit rate and quality (D121). */
  video?: { codec: string; bitrate: number; quality: string };
}

/** The folder a project's exports go into, unless a shot chooses another. */
export function exportRoot(projectDir: string, exportDir?: string | null): string {
  if (!exportDir || !exportDir.trim()) return join(projectDir, 'exports');
  if (!isAbsolute(exportDir.trim())) throw Object.assign(new Error('Choose a full folder path to export into (for example D:\\Film\\Maps).'), { status: 400 });
  return resolve(exportDir.trim());
}

export interface ExportJob {
  id: string;
  dir: string;
  settings: ExportSettings;
  checksums: Record<string, Record<number, string>>;
  startedAt: string;
  /** A video export's file (D121) and how many bytes it holds so far. */
  video?: { file: string; bytes: number };
}

const isVideo = (s: ExportSettings) => s.format === 'mp4' || s.format === 'webm';

const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'shot';

/**
 * An SVG frame (D115): written into the export folder (the project's, or the one the shot chooses)
 * as "<shot>_frame<number>.svg", never over a file already there. Returns its path.
 */
export function writeSvgFrame(projectDir: string, exportDir: string | null | undefined, shotName: string, frame: number, svg: Uint8Array): string {
  const head = Buffer.from(svg.subarray(0, 400)).toString('utf8');
  if (!/^(?:\uFEFF)?<\?xml[^>]*>\s*<svg[\s>]/.test(head)) throw Object.assign(new Error('Not an SVG file.'), { status: 400 });
  const root = exportRoot(projectDir, exportDir);
  const base = `${safe(shotName)}_frame${String(frame + 1).padStart(6, '0')}`;
  let file = join(root, `${base}.svg`);
  for (let n = 2; existsSync(file); n++) file = join(root, `${base}_${n}.svg`);
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(file, svg);
  } catch (e) {
    throw Object.assign(new Error(`Map Maker cannot write to ${root} (${(e as Error).message.split(':')[0]}). Choose another folder.`), { status: 400 });
  }
  return file;
}

export function startJob(projectDir: string, settings: ExportSettings): ExportJob {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Never reuse a folder: two exports of the same shot started in the same second get _2, _3, ...
  const root = exportRoot(projectDir, settings.exportDir);
  let id = `${safe(settings.shotName)}_${stamp}`;
  for (let n = 2; existsSync(join(root, id)); n++) id = `${safe(settings.shotName)}_${stamp}_${n}`;
  const dir = join(root, id);
  let video: ExportJob['video'];
  try {
    if (isVideo(settings)) {
      // One file: the video (D121), written as the browser encodes it.
      mkdirSync(dir, { recursive: true });
      video = { file: join(dir, `${safe(settings.shotName)}.${settings.format}`), bytes: 0 };
      writeFileSync(video.file, new Uint8Array(0));
    } else for (const p of settings.passes) mkdirSync(join(dir, safe(p.name)), { recursive: true });
  } catch (e) {
    throw Object.assign(new Error(`Map Maker cannot write to ${root} (${(e as Error).message.split(':')[0]}). Choose another folder.`), { status: 400 });
  }
  return { id, dir, settings, checksums: {}, startedAt: new Date().toISOString(), video };
}

/**
 * Bytes of a video export's file at a place in it (D121): the encoded frames as they come, one after the
 * other, and at the end the few bytes the file's header leaves to be written then.
 */
export function writeVideoBytes(job: ExportJob, at: number, bytes: Uint8Array): { bytes: number } {
  const v = job.video;
  if (!v) throw new Error('This export writes image sequences.');
  if (!Number.isInteger(at) || at < 0 || at > v.bytes) throw new Error(`Cannot write at ${at}: the video has ${v.bytes} bytes`);
  const fd = openSync(v.file, 'r+');
  try {
    for (let done = 0; done < bytes.length;) done += writeSync(fd, bytes, done, bytes.length - done, at + done);
  } finally {
    closeSync(fd);
  }
  v.bytes = Math.max(v.bytes, at + bytes.length);
  return { bytes: v.bytes };
}

/** The SHA-256 of a file, read a piece at a time (videos can be large). */
function fileChecksum(file: string): string {
  const h = createHash('sha256'), buf = new Uint8Array(1 << 20), fd = openSync(file, 'r');
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

export function frameFileName(job: ExportJob, pass: string, frame: number): string {
  return `${safe(job.settings.shotName)}_${safe(pass)}_${String(frame).padStart(6, '0')}.${job.settings.format === 'tiff' ? 'tif' : 'png'}`;
}

/** Encode and write one frame of one pass. Returns the checksum of the pixels (for determinism checks). */
export function writeFrame(job: ExportJob, pass: string, frame: number, width: number, height: number, rgba: Uint8Array): { file: string; sha256: string } {
  const st = job.settings;
  if (!st.passes.some((p) => p.name === pass)) throw new Error(`Unknown pass ${pass}`);
  if (width !== st.width || height !== st.height) throw new Error(`Frame is ${width}x${height} but the export is ${st.width}x${st.height}`);
  if (rgba.length !== width * height * 4) throw new Error(`Frame data has ${rgba.length} bytes, expected ${width * height * 4}`);
  if (!Number.isInteger(frame) || frame < st.frameStart || frame > st.frameEnd) throw new Error(`Frame ${frame} is outside ${st.frameStart}-${st.frameEnd}`);
  const sha256 = createHash('sha256').update(rgba).digest('hex');
  const png = encodePNG(width, height, rgba);
  const file = join(job.dir, safe(pass), frameFileName(job, pass, frame));
  writeFileSync(file, png);
  (job.checksums[pass] ??= {})[frame] = sha256;
  return { file, sha256 };
}

function checkFrame(job: ExportJob, pass: string, frame: number): void {
  const st = job.settings;
  if (!st.passes.some((p) => p.name === pass)) throw new Error(`Unknown pass ${pass}`);
  if (!Number.isInteger(frame) || frame < st.frameStart || frame > st.frameEnd) throw new Error(`Frame ${frame} is outside ${st.frameStart}-${st.frameEnd}`);
}

/**
 * Write one frame of one pass that arrives already encoded as a PNG (by the browser's own encoder,
 * which works while the next frame is being drawn). The file is tagged as sRGB; its checksum is
 * that of the file written (the same pixels always give the same file).
 */
export function writeEncodedFrame(job: ExportJob, pass: string, frame: number, png: Uint8Array): { file: string; sha256: string } {
  checkFrame(job, pass, frame);
  const st = job.settings;
  // The header says what size it is.
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.length < 33 || dv.getUint32(16) !== st.width || dv.getUint32(20) !== st.height) throw new Error(`Frame is not ${st.width}x${st.height}`);
  const bytes = tagSRGB(png);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = join(job.dir, safe(pass), frameFileName(job, pass, frame));
  writeFileSync(file, bytes);
  (job.checksums[pass] ??= {})[frame] = sha256;
  return { file, sha256 };
}

/**
 * Write one frame of one pass that arrives encoded as a TIFF by the browser (D109). Its directory must
 * say the shot's size; the checksum is that of the file written.
 */
export function writeEncodedTiff(job: ExportJob, pass: string, frame: number, tiff: Uint8Array): { file: string; sha256: string } {
  checkFrame(job, pass, frame);
  const st = job.settings;
  if (st.format !== 'tiff') throw new Error('This export writes PNG files.');
  const v = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (tiff.length < 16 || tiff[0] !== 0x49 || tiff[1] !== 0x49 || v.getUint16(2, true) !== 42) throw new Error('Not a TIFF file');
  const ifd = v.getUint32(4, true), n = ifd + 2 <= tiff.length ? v.getUint16(ifd, true) : 0;
  let w = -1, h = -1;
  for (let i = 0; i < n && ifd + 2 + 12 * (i + 1) <= tiff.length; i++) {
    const e = ifd + 2 + 12 * i, tag = v.getUint16(e, true);
    if (tag === 256) w = v.getUint32(e + 8, true);
    if (tag === 257) h = v.getUint32(e + 8, true);
  }
  if (w !== st.width || h !== st.height) throw new Error(`Frame is not ${st.width}x${st.height}`);
  const sha256 = createHash('sha256').update(tiff).digest('hex');
  const file = join(job.dir, safe(pass), frameFileName(job, pass, frame));
  writeFileSync(file, tiff);
  (job.checksums[pass] ??= {})[frame] = sha256;
  return { file, sha256 };
}

/** Write a frame that is pixel for pixel the same as an earlier frame of the same pass: the file is copied. */
export function repeatFrame(job: ExportJob, pass: string, frame: number, sameAs: number): { file: string; sha256: string } {
  checkFrame(job, pass, frame);
  const sha256 = job.checksums[pass]?.[sameAs];
  if (!sha256) throw new Error(`Frame ${sameAs} of ${pass} has not been written`);
  const file = join(job.dir, safe(pass), frameFileName(job, pass, frame));
  copyFileSync(join(job.dir, safe(pass), frameFileName(job, pass, sameAs)), file);
  job.checksums[pass][frame] = sha256;
  return { file, sha256 };
}

export function finishJob(job: ExportJob): { manifest: string; guide: string; video?: string } {
  const s = job.settings;
  if (job.video) return finishVideo(job);
  const manifest = {
    format: 'map-maker-export/1',
    shot: s.shotName,
    startedAt: job.startedAt,
    finishedAt: new Date().toISOString(),
    appVersion: s.appVersion,
    projectVersion: s.projectHead,
    resolution: [s.width, s.height],
    fps: s.fps,
    frames: [s.frameStart, s.frameEnd],
    historicalRange: s.historicalRange ?? null,
    transparentBackground: s.transparent,
    alpha: s.format === 'tiff' ? 'straight (unassociated), 8-bit TIFF, sRGB' : 'straight (unpremultiplied), 8-bit PNG, sRGB',
    passes: s.passes,
    dataCredits: s.credits ?? [],
    checksums: job.checksums,
  };
  const manifestPath = join(job.dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const lines = [
    `COMPOSITING GUIDE — ${s.shotName}`,
    '',
    `${s.width} x ${s.height} at ${s.fps} fps, frames ${s.frameStart}-${s.frameEnd}.`,
    s.transparent ? 'Every pass has a transparent background (straight alpha).' : 'The background is part of the first pass.',
    '',
    'In Premiere Pro:',
    '  1. File > Import, open a pass folder, select the first frame and tick "Image Sequence".',
    `  2. Right-click the clip > Modify > Interpret Footage: set the frame rate to ${s.fps} fps.`,
    s.format === 'tiff' ? '     Alpha: straight (the TIFF files say so).' : '     Alpha: leave as straight (the default for PNG).',
    '  3. Stack the passes on video tracks in this order, bottom track first:',
    ...s.passes.map((p, i) => `       V${i + 1}  ${p.label.padEnd(22)} blend mode: ${p.blend}${p.note ? `  (${p.note})` : ''}`),
    '',
    'The "All" pass, if present, is everything combined: use it to check your composite.',
    '',
    ...(s.credits?.length ? ['Map data (credit in your film where the licence asks for it):', ...s.credits.map((c) => `  ${c}`), ''] : []),
    `Rendered from project version ${s.projectHead} with Map Maker ${s.appVersion}.`,
  ];
  const guidePath = join(job.dir, 'COMPOSITING_GUIDE.txt');
  writeFileSync(guidePath, lines.join('\r\n'));
  return { manifest: manifestPath, guide: guidePath };
}

/** A video export's manifest and guide (D121): the file, its codec and checksum, the credits. */
function finishVideo(job: ExportJob): { manifest: string; guide: string; video: string } {
  const s = job.settings, v = job.video!;
  if (!v.bytes) throw new Error('No video was written.');
  const bytes = statSync(v.file).size;
  const frames = s.frameEnd - s.frameStart + 1, seconds = frames / s.fps;
  const container = s.format === 'mp4' ? 'MP4' : 'WebM', codec = s.format === 'mp4' ? 'H.264' : 'VP9';
  const manifest = {
    format: 'map-maker-export/1',
    shot: s.shotName,
    startedAt: job.startedAt,
    finishedAt: new Date().toISOString(),
    appVersion: s.appVersion,
    projectVersion: s.projectHead,
    resolution: [s.width, s.height],
    fps: s.fps,
    frames: [s.frameStart, s.frameEnd],
    historicalRange: s.historicalRange ?? null,
    transparentBackground: false,
    alpha: 'none (a video: the whole picture, opaque)',
    passes: s.passes,
    video: { file: basename(v.file), container, codec: s.video?.codec ?? codec, bitrate: s.video?.bitrate ?? null, quality: s.video?.quality ?? null, bytes, seconds, sha256: fileChecksum(v.file) },
    dataCredits: s.credits ?? [],
    checksums: {},
  };
  const manifestPath = join(job.dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const mbit = s.video?.bitrate ? `, about ${(s.video.bitrate / 1e6).toFixed(s.video.bitrate >= 1e7 ? 0 : 1)} Mbit/s` : '';
  const lines = [
    `VIDEO — ${s.shotName}`,
    '',
    `${basename(v.file)}: ${s.width} x ${s.height} at ${s.fps} fps, ${frames} frames (${seconds.toFixed(2)} s), ${codec} in ${container}${mbit}.`,
    'The whole picture ("All"), without transparency and without sound. For layers to stack and adjust, export',
    'image sequences (PNG or TIFF) instead.',
    '',
    'In Premiere Pro: File > Import and choose the file; it keeps its frame rate.',
    s.format === 'webm' ? 'WebM plays in browsers, VLC and most players; editors that do not read it take the MP4 version.' : 'MP4 with H.264 plays on every computer, phone and website.',
    '',
    ...(s.credits?.length ? ['Map data (credit in your film where the licence asks for it):', ...s.credits.map((c) => `  ${c}`), ''] : []),
    `Rendered from project version ${s.projectHead} with Map Maker ${s.appVersion}.`,
  ];
  const guidePath = join(job.dir, 'README.txt');
  writeFileSync(guidePath, lines.join('\r\n'));
  return { manifest: manifestPath, guide: guidePath, video: v.file };
}
