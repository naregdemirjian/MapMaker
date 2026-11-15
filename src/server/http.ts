// The local data service's HTTP interface. It listens on this computer only (127.0.0.1) and is the
// only thing that writes to project databases. In the later Electron build, the same handlers move
// behind Electron's internal messaging; nothing else changes.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { ProjectRegistry } from './projects.ts';
import { startJob, writeFrame, finishJob, type ExportJob, type ExportSettings } from '../export/writer.ts';
import type { RowDiff } from '../world-model/schema.ts';

export interface ServerOptions { projectsDir: string; staticDir: string; appVersion: string }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.map': 'application/json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
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
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

export function openInFileBrowser(path: string): void {
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [path], { detached: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ }
}

export function createAppServer(opts: ServerOptions): { server: Server; registry: ProjectRegistry } {
  const registry = new ProjectRegistry(opts.projectsDir);
  const jobs = new Map<string, ExportJob>();

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
    const db = registry.get(id);
    const action = parts[3];

    if (!action && method === 'GET') return send(res, 200, { id, snapshot: db.snapshot(), journal: db.journalState(), dir: db.dir });
    if (action === 'commit' && method === 'POST') {
      const body = await json<{ label: string; diffs: RowDiff[]; baseHead: number }>(req);
      return send(res, 200, { journal: db.commit(body.label, body.diffs, body.baseHead) });
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
      const folder = which === 'exports' ? join(db.dir, 'exports') : db.dir;
      mkdirSync(folder, { recursive: true });
      openInFileBrowser(folder);
      return send(res, 200, { ok: true });
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
        const w = Number(url.searchParams.get('w')), h = Number(url.searchParams.get('h'));
        const body = await readBody(req);
        const out = writeFrame(job, pass, frame, w, h, new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
        return send(res, 200, out);
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
      if (!res.headersSent) send(res, status, { error: e.message });
      else res.end();
    });
  });
  return { server, registry };
}
