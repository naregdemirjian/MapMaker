// The local data service's HTTP interface. It listens on this computer only (127.0.0.1) and is the
// only thing that writes to project databases. In the later Electron build, the same handlers move
// behind Electron's internal messaging; nothing else changes.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { ProjectRegistry } from './projects.ts';
import { startJob, writeFrame, writeEncodedFrame, writeEncodedTiff, writeSvgFrame, writeVideoBytes, repeatFrame, finishJob, type ExportJob, type ExportSettings } from '../export/writer.ts';
import { saveAsset, serveAsset } from './assets.ts';
import { EXAMPLES } from '../examples/index.ts';
import type { RowDiff } from '../world-model/schema.ts';

export interface ServerOptions {
  projectsDir: string; staticDir: string; appVersion: string;
  /**
   * Close-up terrain (D101): where downloaded Terrain Tiles are kept (default: a hidden folder in the
   * projects folder), and where they come from ('none': only those kept are served, for the tests).
   */
  tileCacheDir?: string; tileSource?: string;
  /**
   * Satellite photographs close in (D138): where downloaded picture tiles are kept (default: a hidden folder in
   * the projects folder), and where they come from ('none': only those kept are served, for the tests).
   */
  photoCacheDir?: string; photoSource?: string;
  /** Show the system's folder picker (the desktop app provides Electron's); returns the chosen path or null. */
  chooseFolder?: (start?: string) => Promise<string | null>;
}

/** The system folder picker for the browser version: Windows' own dialog, or zenity on Linux. */
function systemFolderPicker(start?: string): Promise<string | null> | null {
  const run = (cmd: string, args: string[]) => new Promise<string | null>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    p.on('error', reject);
    p.on('exit', () => resolve(out.trim() || null));
  });
  if (process.platform === 'win32') {
    const init = start ? `$f.SelectedPath = '${start.replace(/'/g, "''")}';` : '';
    const script = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Where should Map Maker export?'; $f.ShowNewFolderButton = $true; ${init} $w = New-Object System.Windows.Forms.Form; $w.TopMost = $true; if ($f.ShowDialog($w) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $f.SelectedPath }`;
    return run('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  }
  if (process.platform === 'linux' && existsSync('/usr/bin/zenity')) return run('zenity', ['--file-selection', '--directory', '--title=Where should Map Maker export?', ...(start ? [`--filename=${start}/`] : [])]);
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.map': 'application/json', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function readBody(req: IncomingMessage, limit = 1024 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function json<T>(req: IncomingMessage): Promise<T> {
  const b = await readBody(req);
  try { return (b.length ? JSON.parse(b.toString('utf8')) : {}) as T; } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  sendText(res, status, JSON.stringify(body));
}

/** Send JSON that is already text. */
function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

export function openInFileBrowser(path: string): void {
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [path], { detached: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ }
}

/** The Terrain Tiles on AWS Open Data, "terrarium" encoding (the source of Earth's bundled heights, D94). */
export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/**
 * Sentinel-2 cloudless 2016 by EOX (CC BY 4.0), as tiles in longitude and latitude ("WGS84": level L has
 * 2^(L+1) columns and 2^L rows of 256-pixel tiles from the north-west corner), the source of Earth's bundled
 * photograph (D138).
 */
export const PHOTO_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless/default/WGS84';
/** The finest level of picture tiles worth having (about 10 m a pixel, the photographs' own detail). */
const PHOTO_MAX_LEVEL = 13;

export function createAppServer(opts: ServerOptions): { server: Server; registry: ProjectRegistry } {
  const registry = new ProjectRegistry(opts.projectsDir);
  const jobs = new Map<string, ExportJob>();
  const tileDir = opts.tileCacheDir ?? join(opts.projectsDir, '.terrain-tiles');
  const tileSource = opts.tileSource ?? TERRAIN_TILES;

  /** A Terrain Tile (PNG): the one kept on this computer, else downloaded and kept; null when it cannot be had. */
  const terrainTile = async (z: number, x: number, y: number): Promise<Buffer | null> => {
    const file = join(tileDir, String(z), String(x), `${y}.png`);
    if (existsSync(file)) return readFileSync(file);
    if (tileSource === 'none') return null;
    try {
      const r = await fetch(`${tileSource}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return null;
      const bytes = Buffer.from(await r.arrayBuffer());
      mkdirSync(dirname(file), { recursive: true });
      const part = `${file}.${process.pid}.part`;
      writeFileSync(part, bytes);
      renameSync(part, file);
      return bytes;
    } catch { return null; }
  };

  const photoDir = opts.photoCacheDir ?? join(opts.projectsDir, '.photo-tiles');
  const photoSource = opts.photoSource ?? PHOTO_TILES;
  /** A picture tile (JPEG): the one kept on this computer, else downloaded and kept; null when it cannot be had. */
  const photoTile = async (level: number, row: number, col: number): Promise<Buffer | null> => {
    const file = join(photoDir, String(level), String(row), `${col}.jpg`);
    if (existsSync(file)) return readFileSync(file);
    if (photoSource === 'none') return null;
    try {
      const r = await fetch(`${photoSource}/${level}/${row}/${col}.jpg`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok || !(r.headers.get('content-type') ?? 'image/jpeg').startsWith('image/')) return null;
      const bytes = Buffer.from(await r.arrayBuffer());
      mkdirSync(dirname(file), { recursive: true });
      const part = `${file}.${process.pid}.part`;
      writeFileSync(part, bytes);
      renameSync(part, file);
      return bytes;
    } catch { return null; }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // Only this computer may talk to the service (guards against DNS-rebinding web pages).
    const host = (req.headers.host ?? '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') throw new HttpError(403, 'Forbidden');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method ?? 'GET';

    if (parts[0] !== 'api') {
      const rel = parts.length === 0 ? 'index.html' : parts.join('/');
      if (rel.includes('..')) throw new HttpError(400, 'Bad path');
      const file = join(opts.staticDir, rel);
      if (!existsSync(file)) throw new HttpError(404, 'Not found');
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(readFileSync(file));
      return;
    }

    if (parts[1] === 'app' && method === 'GET') return send(res, 200, { version: opts.appVersion, projectsDir: registry.root, platform: process.platform });
    if (parts[1] === 'terrain-tile' && method === 'GET') {
      const [z, x, y] = parts.slice(2, 5).map((p) => (/^\d+$/.test(p ?? '') ? Number(p) : NaN));
      if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z > 15 || x >= 2 ** z || y >= 2 ** z) throw new HttpError(400, 'No such terrain tile.');
      const png = await terrainTile(z, x, y);
      if (!png) throw new HttpError(404, 'The terrain tile could not be had (offline?).');
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=604800' });
      res.end(png);
      return;
    }
    if (parts[1] === 'photo-tile' && method === 'GET') {
      const [level, row, col] = parts.slice(2, 5).map((p) => (/^\d+$/.test(p ?? '') ? Number(p) : NaN));
      if (!Number.isInteger(level) || !Number.isInteger(row) || !Number.isInteger(col) || level > PHOTO_MAX_LEVEL || row >= 2 ** level || col >= 2 ** (level + 1)) throw new HttpError(400, 'No such picture tile.');
      const jpg = await photoTile(level, row, col);
      if (!jpg) throw new HttpError(404, 'The picture tile could not be had (offline?).');
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=604800' });
      res.end(jpg);
      return;
    }
    if (parts[1] === 'choose-folder' && method === 'POST') {
      const body = await json<{ start?: string }>(req);
      const pick = opts.chooseFolder ? opts.chooseFolder(body.start) : systemFolderPicker(body.start);
      if (!pick) throw new HttpError(501, 'This computer has no folder picker Map Maker can open. Type the folder path instead.');
      return send(res, 200, { path: await pick });
    }
    // Example projects (D171): listed, and built into the projects folder when chosen (a new project each time).
    if (parts[1] === 'examples') {
      if (parts.length === 2 && method === 'GET') return send(res, 200, EXAMPLES.map(({ id, name, about }) => ({ id, name, about })));
      const ex = EXAMPLES.find((e) => e.id === parts[2]);
      if (!ex || method !== 'POST') throw new HttpError(404, 'There is no such example.');
      return send(res, 201, ex.build(registry, join(opts.staticDir, 'data')));
    }
    if (parts[1] !== 'projects') throw new HttpError(404, 'Unknown API');

    if (parts.length === 2) {
      if (method === 'GET') return send(res, 200, registry.list());
      if (method === 'POST') {
        const body = await json<{ name: string; world?: { name: string; radiusKm: number } }>(req);
        if (!body.name || !body.name.trim()) throw new HttpError(400, 'Give the project a name.');
        return send(res, 201, registry.create(body.name, body.world));
      }
    }

    const id = parts[2];
    const action = parts[3];
    if (action === 'recover' && method === 'POST') return send(res, 200, registry.recover(id));
    const db = registry.get(id);

    // (The snapshot is written as text by the database: see ProjectDb.snapshotJson.)
    if (!action && method === 'GET') return sendText(res, 200, `{"id":${JSON.stringify(id)},"snapshot":${db.snapshotJson()},"journal":${JSON.stringify(db.journalState())},"dir":${JSON.stringify(db.dir)}}`);
    if (action === 'commit' && method === 'POST') {
      const body = await json<{ label: string; diffs: RowDiff[]; baseHead: number }>(req);
      return send(res, 200, { journal: db.commit(body.label, body.diffs, body.baseHead) });
    }
    // Border drafts (unfinished border-pen lines): working notes kept in the project folder, outside
    // the history, so they survive closing the app and never clutter undo.
    if (action === 'drafts') {
      const file = join(db.dir, 'drafts.json');
      if (method === 'GET') return send(res, 200, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
      if (method === 'PUT') {
        const drafts = await json<unknown>(req);
        if (!Array.isArray(drafts)) throw new HttpError(400, 'Drafts must be a list.');
        writeFileSync(`${file}.tmp`, JSON.stringify(drafts));
        renameSync(`${file}.tmp`, file);
        return send(res, 200, { ok: true });
      }
    }
    if (action === 'assets') {
      if (parts.length === 4 && method === 'POST') {
        const name = url.searchParams.get('name') ?? '';
        const saved = saveAsset(db.dir, name, await readBody(req, 4 * 1024 * 1024 * 1024));
        return send(res, 201, { ...saved, url: `/api/projects/${encodeURIComponent(id)}/assets/${saved.file}` });
      }
      if (parts.length === 5 && method === 'GET') return serveAsset(db.dir, parts[4], req, res);
    }
    if (action === 'undo' && method === 'POST') return send(res, 200, db.undo() ?? { diffs: [], journal: db.journalState() });
    if (action === 'redo' && method === 'POST') return send(res, 200, db.redo() ?? { diffs: [], journal: db.journalState() });
    if (action === 'history' && method === 'GET') return send(res, 200, db.history());
    if (action === 'versions') {
      if (parts.length === 4 && method === 'GET') return send(res, 200, db.versions());
      if (parts.length === 4 && method === 'POST') {
        const body = await json<{ label: string }>(req);
        return send(res, 201, db.createVersion(body.label?.trim() || 'Saved version'));
      }
      if (parts[5] === 'restore' && method === 'POST') return send(res, 200, db.restoreVersion(Number(parts[4])));
    }
    if (action === 'backups') {
      if (parts[4] === 'restore' && method === 'POST') return send(res, 200, db.restoreBackup(url.searchParams.get('name') ?? ''));
      if (method === 'GET') return send(res, 200, db.backups());
      if (method === 'POST') return send(res, 201, db.backupNow());
    }
    if (action === 'show-folder' && method === 'POST') {
      const which = url.searchParams.get('which');
      const custom = url.searchParams.get('dir');
      const folder = custom && existsSync(custom) ? custom : which === 'exports' ? join(db.dir, 'exports') : db.dir;
      mkdirSync(folder, { recursive: true });
      openInFileBrowser(folder);
      return send(res, 200, { ok: true });
    }
    // Data export (GeoJSON, CSV): text files written into a new folder of the project's exports.
    if (action === 'data-export' && method === 'POST') {
      const body = await json<{ name?: string; files?: Array<{ name: string; text: string }> }>(req);
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) throw new HttpError(400, 'Nothing to export.');
      for (const f of files) if (typeof f.name !== 'string' || !/^[\w\- .]+\.(geojson|csv|json|txt)$/i.test(f.name) || f.name.startsWith('.') || typeof f.text !== 'string') throw new HttpError(400, `Not a file name Map Maker writes: ${String(f.name).slice(0, 60)}`);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const base = `${(body.name ?? 'data').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'data'}_${stamp}`;
      const root = join(db.dir, 'exports');
      let dir = join(root, base);
      for (let n = 2; existsSync(dir); n++) dir = join(root, `${base}_${n}`);
      mkdirSync(dir, { recursive: true });
      for (const f of files) writeFileSync(join(dir, f.name), f.text, 'utf8');
      return send(res, 201, { dir, files: files.map((f) => f.name) });
    }
    // An SVG frame of a shot (D115): written into the export folder.
    if (action === 'svg-frame' && method === 'POST') {
      const body = await readBody(req);
      const file = writeSvgFrame(db.dir, url.searchParams.get('dir'), url.searchParams.get('shot') ?? 'shot', Math.max(0, Number(url.searchParams.get('frame')) || 0), new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
      return send(res, 201, { file });
    }
    if (action === 'exports') {
      if (parts.length === 4 && method === 'POST') {
        const settings = await json<ExportSettings>(req);
        const job = startJob(db.dir, { ...settings, appVersion: opts.appVersion, projectHead: db.journalState().head });
        jobs.set(`${id}/${job.id}`, job);
        return send(res, 201, { jobId: job.id, dir: job.dir });
      }
      const job = jobs.get(`${id}/${parts[4]}`);
      if (!job) throw new HttpError(404, 'Unknown export job');
      if (parts[5] === 'frames' && method === 'POST') {
        const pass = url.searchParams.get('pass') ?? '';
        const frame = Number(url.searchParams.get('frame'));
        // The same picture as an earlier frame: its file is copied.
        const same = url.searchParams.get('same');
        if (same !== null) { await readBody(req); return send(res, 200, repeatFrame(job, pass, frame, Number(same))); }
        // Already encoded (by the browser), or raw pixels to encode here.
        if (url.searchParams.get('format') === 'tiff') {
          const tiff = await readBody(req);
          return send(res, 200, writeEncodedTiff(job, pass, frame, new Uint8Array(tiff.buffer, tiff.byteOffset, tiff.byteLength)));
        }
        if (url.searchParams.get('format') === 'png') {
          const png = await readBody(req);
          return send(res, 200, writeEncodedFrame(job, pass, frame, new Uint8Array(png.buffer, png.byteOffset, png.byteLength)));
        }
        const w = Number(url.searchParams.get('w')), h = Number(url.searchParams.get('h'));
        const body = await readBody(req);
        const out = writeFrame(job, pass, frame, w, h, new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
        return send(res, 200, out);
      }
      // A video export's bytes at their place in the file (D121).
      if (parts[5] === 'video' && method === 'POST') {
        const body = await readBody(req);
        return send(res, 200, writeVideoBytes(job, Number(url.searchParams.get('at')), new Uint8Array(body.buffer, body.byteOffset, body.byteLength)));
      }
      if (parts[5] === 'finish' && method === 'POST') {
        const out = finishJob(job);
        jobs.delete(`${id}/${job.id}`);
        return send(res, 200, { dir: job.dir, ...out, checksums: job.checksums });
      }
    }
    throw new HttpError(404, 'Unknown API');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error & { status?: number }) => {
      const status = e.status ?? 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: e.message, code: (e as { code?: string }).code });
      else res.end();
    });
  });
  return { server, registry };
}
