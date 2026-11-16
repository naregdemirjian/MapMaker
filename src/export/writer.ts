// Export jobs on the data-service side: frames rendered by the map engine arrive as raw RGBA pixels,
// are encoded here and written as numbered image sequences with a manifest and a compositing guide.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encodePNG } from './png.ts';

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
  let id = `${safe(settings.shotName)}_${stamp}`;
  for (let n = 2; existsSync(join(projectDir, 'exports', id)); n++) id = `${safe(settings.shotName)}_${stamp}_${n}`;
  const dir = join(projectDir, 'exports', id);
  for (const p of settings.passes) mkdirSync(join(dir, safe(p.name)), { recursive: true });
  return { id, dir, settings, checksums: {}, startedAt: new Date().toISOString() };
}

export function frameFileName(job: ExportJob, pass: string, frame: number): string {
  return `${safe(job.settings.shotName)}_${safe(pass)}_${String(frame).padStart(6, '0')}.png`;
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
    alpha: 'straight (unpremultiplied), 8-bit PNG, sRGB',
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
    '     Alpha: leave as straight (the default for PNG).',
    '  3. Stack the passes on video tracks in this order, bottom track first:',
    ...s.passes.map((p, i) => `       V${i + 1}  ${p.label.padEnd(22)} blend mode: ${p.blend}${p.note ? `  (${p.note})` : ''}`),
    '',
    'The "beauty" pass, if present, is everything combined: use it to check your composite.',
    '',
    ...(s.credits?.length ? ['Map data (credit in your film where the licence asks for it):', ...s.credits.map((c) => `  ${c}`), ''] : []),
    `Rendered from project version ${s.projectHead} with Map Maker ${s.appVersion}.`,
  ];
  const guidePath = join(job.dir, 'COMPOSITING_GUIDE.txt');
  writeFileSync(guidePath, lines.join('\r\n'));
  return { manifest: manifestPath, guide: guidePath };
}
