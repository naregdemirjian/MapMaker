// Planets' foundations (D269): what was worked out for a simulated planet at every point, one file for each planet as
// it was defined, kept in the project folder's `foundations` directory under the key of that definition. Derived
// from the planet's definition (so not part of the history), but kept: a planet read from its file is the planet as
// it was made, whatever the engine has become since, and opens without being simulated again.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = /^[a-f0-9]{32}$/;
const MAGIC = 'MMS1';
/** The most a foundation's file may be (bytes): several times the largest the interface makes. */
export const FOUNDATION_LIMIT = 256 * 2 ** 20;
/** How many foundations a project keeps: those last read or written (a planet's earlier definitions among them, for undo). */
export const FOUNDATIONS_KEPT = 12;

export function foundationDir(projectDir: string): string { return join(projectDir, 'foundations'); }
const fileOf = (projectDir: string, key: string): string => {
  if (!KEY.test(key)) throw Object.assign(new Error('Bad foundation key'), { status: 400 });
  return join(foundationDir(projectDir), `${key}.mmf`);
};

/** A planet's foundation as kept, or null; reading it marks it as used now. */
export function readFoundation(projectDir: string, key: string): Buffer | null {
  const path = fileOf(projectDir, key);
  if (!existsSync(path)) return null;
  const now = new Date();
  try { utimesSync(path, now, now); } catch { /* (Read-only folder: its age stays as it is.) */ }
  return readFileSync(path);
}

/** Keeps a planet's foundation; the project's oldest ones beyond `FOUNDATIONS_KEPT` are let go. */
export function saveFoundation(projectDir: string, key: string, bytes: Buffer): { bytes: number; kept: number } {
  const path = fileOf(projectDir, key);
  if (bytes.length < 8 || bytes.subarray(0, 4).toString('latin1') !== MAGIC) throw Object.assign(new Error('That is not a planet\'s foundation.'), { status: 400 });
  const dir = foundationDir(projectDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${path}.tmp`, bytes);
  renameSync(`${path}.tmp`, path);
  const files = readdirSync(dir).filter((f) => /^[a-f0-9]{32}\.mmf$/.test(f)).map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const old of files.slice(FOUNDATIONS_KEPT)) unlinkSync(join(dir, old.f));
  return { bytes: bytes.length, kept: Math.min(files.length, FOUNDATIONS_KEPT) };
}
