// The benchmark tools change the projects they run on (strokes are saved, as in the real app), so
// each run works on a throwaway copy: the projects made by bench/make-fixtures.ts stay as made, and
// one run's numbers can be compared with the next.
import { cpSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** A copy of the projects asked for (all of them when none is named) in a folder of its own; `done()` removes it. */
export function workCopy(folder: string, names: string[] = []): { folder: string; done: () => void } {
  const work = mkdtempSync(join(tmpdir(), 'mapmaker-bench-'));
  for (const entry of readdirSync(folder)) {
    if (names.length && !names.some((n) => entry === `${n}.mapmaker` || entry === n)) continue;
    cpSync(join(folder, entry), join(work, entry), { recursive: true });
  }
  return { folder: work, done: () => rmSync(work, { recursive: true, force: true }) };
}
