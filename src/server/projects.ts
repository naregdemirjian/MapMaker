// The folder of projects. Each project is a folder "<Name>.mapmaker" holding project.db,
// versions/, backups/ and exports/. Copying the folder moves the whole project.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectDb } from './db.ts';
import { World } from '../world-model/world.ts';
import { seedProject } from '../domain/commands.ts';

export interface ProjectInfo { id: string; name: string; dir: string; modified: string }

const EXT = '.mapmaker';

export function safeFolderName(name: string): string {
  // Characters Windows does not allow in file names, plus control characters.
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return s.slice(0, 80) || 'Project';
}

export class ProjectRegistry {
  readonly root: string;
  private open = new Map<string, ProjectDb>();

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  list(): ProjectInfo[] {
    return readdirSync(this.root)
      .filter((f) => f.endsWith(EXT) && existsSync(join(this.root, f, 'project.db')))
      .map((f) => {
        const dir = join(this.root, f);
        const id = f.slice(0, -EXT.length);
        return { id, name: id, dir, modified: statSync(join(dir, 'project.db')).mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  dirOf(id: string): string {
    return join(this.root, safeFolderName(id) + EXT);
  }

  create(name: string, firstWorld?: { name: string; radiusKm: number }): ProjectInfo {
    let id = safeFolderName(name);
    for (let i = 2; existsSync(this.dirOf(id)); i++) id = `${safeFolderName(name)} (${i})`;
    const dir = this.dirOf(id);
    const db = ProjectDb.open(dir);
    const world = new World();
    const seeded = seedProject(world, name.trim() || id, firstWorld);
    db.commit(seeded.label, seeded.diffs, null, true); // the first save also takes the first backup
    this.open.set(id, db);
    return { id, name: id, dir, modified: new Date().toISOString() };
  }

  get(id: string): ProjectDb {
    let db = this.open.get(id);
    if (!db) {
      const dir = this.dirOf(id);
      if (!existsSync(join(dir, 'project.db'))) throw Object.assign(new Error('That project does not exist.'), { status: 404 });
      db = ProjectDb.open(dir);
      // A backup on opening, unless one was taken in the last few minutes.
      if (Date.now() - db.lastBackupAt > 5 * 60_000) {
        try { db.backupNow(); } catch { /* opening must not fail because a backup could not be written */ }
      }
      this.open.set(id, db);
    }
    return db;
  }

  closeAll(): void {
    for (const db of this.open.values()) db.close();
    this.open.clear();
  }
}
