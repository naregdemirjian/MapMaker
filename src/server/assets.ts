// Files a project uses (uploaded pictures, flags, videos, graphics): kept in the project folder's
// `assets` directory, named by their content (the same file is stored once), served to the
// interface with byte ranges so videos can seek.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, statSync, createReadStream, renameSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

const NAME = /^[a-f0-9]{24}\.[a-z0-9]{2,5}$/;

export function assetDir(projectDir: string): string { return join(projectDir, 'assets'); }

/** Store a file; returns its asset name (content hash + extension). */
export function saveAsset(projectDir: string, originalName: string, bytes: Buffer): { file: string; bytes: number; type: string } {
  const ext = extname(originalName).toLowerCase();
  const type = ASSET_TYPES[ext];
  if (!type) throw Object.assign(new Error(`Map Maker can use pictures (PNG, JPEG, WebP, GIF, SVG) and videos (MP4, WebM, MOV), not ${ext || 'this file'}.`), { status: 400 });
  if (!bytes.length) throw Object.assign(new Error('The file is empty.'), { status: 400 });
  const file = createHash('sha256').update(bytes).digest('hex').slice(0, 24) + (ext === '.jpeg' ? '.jpg' : ext === '.m4v' ? '.mp4' : ext);
  const dir = assetDir(projectDir);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, file);
  if (!existsSync(target)) {
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
  }
  return { file, bytes: bytes.length, type };
}

/** Send an asset, honouring a byte-range request (needed for video seeking). */
export function serveAsset(projectDir: string, file: string, req: IncomingMessage, res: ServerResponse): void {
  if (!NAME.test(file)) throw Object.assign(new Error('Bad asset name'), { status: 400 });
  const path = join(assetDir(projectDir), file);
  if (!existsSync(path)) throw Object.assign(new Error('That file is no longer in the project.'), { status: 404 });
  const size = statSync(path).size;
  const type = ASSET_TYPES[extname(file)] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=31536000, immutable' };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  createReadStream(path).pipe(res);
}
