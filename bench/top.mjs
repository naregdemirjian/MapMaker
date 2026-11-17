// Summarise a .cpuprofile: self time and inclusive time by function. Usage: node bench/top.mjs <file.cpuprofile> [filter]
import { readFileSync } from 'node:fs';
const p = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas; let total = 0;
p.samples.forEach((id, i) => { const d = dt[i] / 1000; total += d; self.set(id, (self.get(id) ?? 0) + d); });
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map(), inclBy = new Map();
for (const [id, ms] of self) {
  const n = byId.get(id);
  selfBy.set(name(n), (selfBy.get(name(n)) ?? 0) + ms);
  const seen = new Set();
  for (let x = id; x !== undefined; x = parent.get(x)) { const k = name(byId.get(x)); if (seen.has(k)) continue; seen.add(k); inclBy.set(k, (inclBy.get(k) ?? 0) + ms); }
}
const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, ms]) => `${ms.toFixed(0).padStart(7)} ms  ${n}`).join('\n');
const filt = process.argv[3];
console.log(`total ${total.toFixed(0)} ms\n--- self\n${top(selfBy, 28)}\n--- inclusive\n${top(new Map([...inclBy].filter(([k]) => !filt || k.includes(filt))), 45)}`);
