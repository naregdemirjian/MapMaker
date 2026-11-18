// Export jobs on the data-service side: frames rendered by the map engine arrive as raw RGBA pixels,
// are encoded here and written as numbered image sequences with a manifest and a compositing guide.
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
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
  /** The files written (D109): 'png' (absent) or 'tiff' (either compression; the browser encodes them). */
  format?: 'png' | 'tiff';
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
}

const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'shot';

export function startJob(projectDir: string, settings: ExportSettings): ExportJob {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Never reuse a folder: two exports of the same shot started in the same second get _2, _3, ...
  const root = exportRoot(projectDir, settings.exportDir);
  let id = `${safe(settings.shotName)}_${stamp}`;
  for (let n = 2; existsSync(join(root, id)); n++) id = `${safe(settings.shotName)}_${stamp}_${n}`;
  const dir = join(root, id);
  try {
    for (const p of settings.passes) mkdirSync(join(dir, safe(p.name)), { recursive: true });
  } catch (e) {
    throw Object.assign(new Error(`Map Maker cannot write to ${root} (${(e as Error).message.split(':')[0]}). Choose another folder.`), { status: 400 });
  }
  return { id, dir, settings, checksums: {}, startedAt: new Date().toISOString() };
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

export function finishJob(job: ExportJob): { manifest: string; guide: string } {
  const s = job.settings;
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
