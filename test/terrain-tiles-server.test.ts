// Close-up terrain (Stage 8, D101): the local data service fetches Terrain Tiles once, keeps them on
// this computer, serves the kept ones with no network, and refuses tiles that do not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../src/server/http.ts';

const listen = (s: Server) => new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)));
const close = (s: Server) => new Promise<void>((resolve) => s.close(() => resolve()));

test('terrain tiles: downloaded once and kept, then served without the network; bad requests refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mapmaker-tiles-'));
  try {
    // A stand-in for the tiles' home on the internet, counting what it is asked for.
    const asked: string[] = [];
    const upstream = createServer((req, res) => {
      asked.push(req.url ?? '');
      if (req.url === '/8/133/90.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from('not really a png')); } else { res.writeHead(404); res.end(); }
    });
    const upPort = await listen(upstream);
    const cache = join(dir, 'tiles');
    const { server, registry } = createAppServer({ projectsDir: join(dir, 'projects'), staticDir: dir, appVersion: 'test', tileCacheDir: cache, tileSource: `http://127.0.0.1:${upPort}` });
    const port = await listen(server);
    const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
    try {
      const first = await get('/api/terrain-tile/8/133/90');
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await first.arrayBuffer()).toString(), 'not really a png');
      assert.ok(existsSync(join(cache, '8', '133', '90.png')), 'kept on this computer');
      assert.equal(readFileSync(join(cache, '8', '133', '90.png')).toString(), 'not really a png');
      // Asked again with the internet gone: the kept tile.
      await close(upstream);
      const again = await get('/api/terrain-tile/8/133/90');
      assert.equal(again.status, 200);
      assert.equal(asked.length, 1, 'fetched once');
      // A tile that cannot be had (missing upstream, or no network): 404, and the app keeps its own heights.
      assert.equal((await get('/api/terrain-tile/8/1/1')).status, 404);
      for (const bad of ['/api/terrain-tile/8/256/0', '/api/terrain-tile/16/0/0', '/api/terrain-tile/8/x/1', '/api/terrain-tile/8/1/..%2F..']) assert.equal((await get(bad)).status, 400, bad);
    } finally {
      registry.closeAll();
      await close(server);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
