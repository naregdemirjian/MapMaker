// Where inside a function the time goes: the lines of the built app with the most samples.
// Usage: node bench/lines.mjs <file.cpuprofile> <function name> [how many]   (run from the project folder, after the build that was profiled)
import { readFileSync } from 'node:fs';
const [file, fn, top] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, 'utf8'));
const src = readFileSync('dist/ui/app.js', 'utf8').split('\n');
const per = p.timeDeltas.reduce((a, b) => a + b, 0) / p.samples.length / 1000;
const ticks = new Map();
for (const n of p.nodes) {
  if (n.callFrame.functionName !== fn) continue;
  for (const t of n.positionTicks ?? []) ticks.set(t.line, (ticks.get(t.line) ?? 0) + t.ticks);
}
for (const [line, n] of [...ticks.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(top ?? 12))) console.log(`${(n * per).toFixed(0).padStart(6)} ms  ${line}: ${(src[line - 1] ?? '').trim().slice(0, 150)}`);
