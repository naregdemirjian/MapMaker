// Builds the two runnable parts of Map Maker:
//   dist/ui/      the browser interface (React + map engine), one bundled script
//   dist/server.mjs  the local data service (Node built-ins only, no native modules)
// Both are self-contained, so the dist folder runs on any machine with Node.js >= 22.18.
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
mkdirSync(join(out, 'ui'), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const define = { __APP_VERSION__: JSON.stringify(pkg.version) };

await build({
  entryPoints: [join(root, 'src/ui/main.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  outfile: join(out, 'ui/app.js'),
  sourcemap: true,
  jsx: 'automatic',
  define: { ...define, 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(out, 'server.mjs'),
  sourcemap: true,
  define,
  logLevel: 'warning',
});

copyFileSync(join(root, 'src/ui/index.html'), join(out, 'ui/index.html'));
copyFileSync(join(root, 'src/ui/styles.css'), join(out, 'ui/styles.css'));
writeFileSync(join(out, 'BUILD.txt'), `Map Maker ${pkg.version}\nBuilt ${new Date().toISOString()}\n`);
console.log('Built dist/ui/app.js and dist/server.mjs');
