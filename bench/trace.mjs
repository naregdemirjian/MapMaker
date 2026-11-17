// Summarise a browser trace (bench/profile.ts with an output name ending in .trace.json): for each
// thread, the time spent in each kind of event itself (not in the events inside it).
// Usage: node bench/trace.mjs <file.trace.json> [frames]   (with a number of frames: also per frame)
import { readFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const frames = Number(process.argv[3] ?? 0);
const events = (raw.traceEvents ?? raw).filter((e) => e.ph === 'X' && e.dur > 0);
const names = new Map();
for (const e of raw.traceEvents ?? raw) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
const byThread = new Map();
for (const e of events) { const k = `${e.pid}:${e.tid}`; if (!byThread.has(k)) byThread.set(k, []); byThread.get(k).push(e); }
const rows = [];
for (const [k, list] of byThread) {
  list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map();
  const stack = [];
  let total = 0;
  for (const e of list) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
    if (stack.length) { const p = stack[stack.length - 1]; self.set(p.name, (self.get(p.name) ?? 0) - e.dur); }
    else total += e.dur;
    self.set(e.name, (self.get(e.name) ?? 0) + e.dur);
    stack.push(e);
  }
  rows.push({ name: names.get(k) ?? k, total, self });
}
rows.sort((a, b) => b.total - a.total);
const ms = (us) => (us / 1000).toFixed(1).padStart(8);
for (const r of rows.slice(0, 6)) {
  if (r.total < 5000) continue;
  console.log(`\n${r.name}: ${ms(r.total)} ms busy${frames ? ` (${(r.total / 1000 / frames).toFixed(1)} ms a frame)` : ''}`);
  for (const [n, us] of [...r.self].sort((a, b) => b[1] - a[1]).slice(0, 14)) if (us > 1000) console.log(`${ms(us)} ms  ${n}`);
}
