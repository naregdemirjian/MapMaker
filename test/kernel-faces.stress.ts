// Long randomised comparison of the two ways of rebuilding faces (not part of the quick suite).
// Usage: node --disable-warning=ExperimentalWarning test/kernel-faces.stress.ts [seeds] [steps] [firstSeed]
import { Arrangement } from '../src/geo-kernel/arrangement.ts';
import { compareRebuilds } from './kernel-faces.test.ts';

const seeds = Number(process.argv[2] ?? 40), steps = Number(process.argv[3] ?? 150), first = Number(process.argv[4] ?? 100);
let failures = 0, edits = 0, faces = 0;
const t0 = performance.now();
for (let seed = first; seed < first + seeds; seed++) for (const where of ['anywhere', 'cluster'] as const) {
  try { const r = compareRebuilds(seed, steps, where); edits += r.edits; faces += r.faces; } catch (e) { failures++; console.log(`FAILED seed ${seed} ${where}: ${(e as Error).message.split('\n')[0]}`); }
}
console.log(JSON.stringify({ seeds, steps, edits, facesAtEnd: faces, failures, stats: Arrangement.rebuildStats, seconds: +((performance.now() - t0) / 1000).toFixed(0) }));
process.exit(failures ? 1 : 0);
