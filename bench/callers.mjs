// Who calls a function, by time: the call chains above it in a .cpuprofile.
// Usage: node bench/callers.mjs <file.cpuprofile> <function name> [depth]
import { readFileSync } from 'node:fs';
const [file, fn, depthArg] = process.argv.slice(2);
const depth = Number(depthArg ?? 6);
const p = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
p.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + p.timeDeltas[i] / 1000));
const chains = new Map();
for (const [id, ms] of self) {
  // Time under any node of that name counts once, for the chain above the outermost one.
  let hit = null;
  for (let x = id; x !== undefined; x = parent.get(x)) if (byId.get(x).callFrame.functionName === fn) hit = x;
  if (hit === null) continue;
  const names = [];
  for (let x = parent.get(hit), d = 0; x !== undefined && d < depth; x = parent.get(x), d++) names.push(byId.get(x).callFrame.functionName || '(anon)');
  const k = names.join(' < ');
  chains.set(k, (chains.get(k) ?? 0) + ms);
}
for (const [k, ms] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${ms.toFixed(0).padStart(7)} ms  ${fn} < ${k}`);
