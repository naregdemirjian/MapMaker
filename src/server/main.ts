// Entry point of the local data service. Starts the HTTP service on this computer and (with --open)
// opens the interface in the default browser.
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createAppServer } from './http.ts';

declare const __APP_VERSION__: string;
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const port = Number(arg('--port') ?? process.env.MAPMAKER_PORT ?? 4317);
const projectsDir = arg('--projects') ?? process.env.MAPMAKER_PROJECTS ?? join(homedir(), 'Documents', 'Map Maker Projects');
const staticDir = arg('--static') ?? join(dirname(fileURLToPath(import.meta.url)), 'ui');

const { server, registry } = createAppServer({ projectsDir, staticDir, appVersion: version });

function openBrowser(url: string) {
  const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, cmdArgs as string[], { detached: true, stdio: 'ignore' }).unref(); } catch { /* the URL is printed anyway */ }
}

function listen(p: number, attempts = 10) {
  server.once('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE' && attempts > 0) listen(p + 1, attempts - 1);
    else { console.error(`Map Maker could not start: ${e.message}`); process.exit(1); }
  });
  server.listen(p, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${p}/`;
    console.log(`Map Maker ${version} is running at ${url}`);
    console.log(`Projects folder: ${projectsDir}`);
    console.log('Keep this window open while you work. Close it to quit Map Maker.');
    if (args.includes('--open')) openBrowser(url);
  });
}

const shutdown = () => {
  registry.closeAll();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown); // Windows: the console window was closed

listen(port);
