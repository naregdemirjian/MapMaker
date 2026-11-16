// Client for the local data service.
import type { RowDiff } from '../world-model/schema.ts';
import type { Snapshot } from '../world-model/world.ts';

export interface JournalState { head: number; canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
export interface ProjectInfo { id: string; name: string; dir: string; modified: string }
export interface VersionInfo { id: number; label: string; kind: string; created_at: string; journal_seq: number }
export interface BackupInfo { file: string; created_at: string; bytes: number }

/** An unfinished border drawn with the border pen (map positions), kept between sessions. */
export interface BorderDraft {
  id: string; name: string; spaceId: string; owner: string | null;
  points: Array<[number, number]>;
  /** Index of the first point of each piece drawn (so the last piece can be taken back). */
  pieces: number[];
  updated: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}

async function call<T>(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {},
    body: raw ? (raw as unknown as BodyInit) : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.code);
  return data as T;
}

const p = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const Api = {
  app: () => call<{ version: string; projectsDir: string; platform: string }>('GET', '/api/app'),
  projects: () => call<ProjectInfo[]>('GET', '/api/projects'),
  createProject: (name: string, world?: { name: string; radiusKm: number }) => call<ProjectInfo>('POST', '/api/projects', { name, world }),
  open: (id: string) => call<{ id: string; snapshot: Snapshot; journal: JournalState; dir: string }>('GET', p(id)),
  recover: (id: string) => call<{ restoredFrom: string; damagedFolder: string }>('POST', `${p(id)}/recover`),
  commit: (id: string, label: string, diffs: RowDiff[], baseHead: number) => call<{ journal: JournalState }>('POST', `${p(id)}/commit`, { label, diffs, baseHead }),
  undo: (id: string) => call<{ diffs: RowDiff[]; label?: string; journal: JournalState }>('POST', `${p(id)}/undo`),
  redo: (id: string) => call<{ diffs: RowDiff[]; label?: string; journal: JournalState }>('POST', `${p(id)}/redo`),
  history: (id: string) => call<Array<{ seq: number; label: string; created_at: string; state: string }>>('GET', `${p(id)}/history`),
  versions: (id: string) => call<VersionInfo[]>('GET', `${p(id)}/versions`),
  createVersion: (id: string, label: string) => call<VersionInfo>('POST', `${p(id)}/versions`, { label }),
  restoreVersion: (id: string, vid: number) => call<{ diffs: RowDiff[]; journal: JournalState }>('POST', `${p(id)}/versions/${vid}/restore`),
  backups: (id: string) => call<BackupInfo[]>('GET', `${p(id)}/backups`),
  backupNow: (id: string) => call<BackupInfo>('POST', `${p(id)}/backups`),
  restoreBackup: (id: string, name: string) => call<{ diffs: RowDiff[]; journal: JournalState }>('POST', `${p(id)}/backups/restore?name=${encodeURIComponent(name)}`),
  showFolder: (id: string, which: 'project' | 'exports', dir?: string) => call<{ ok: boolean }>('POST', `${p(id)}/show-folder?which=${which}${dir ? `&dir=${encodeURIComponent(dir)}` : ''}`),
  /** Add a file (picture or video) to the project; returns its asset name. */
  uploadAsset: async (id: string, file: File): Promise<{ file: string; url: string; type: string }> => {
    const res = await fetch(`${p(id)}/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error ?? `Upload failed (${res.status})`, body.code);
    return body;
  },
  drafts: (id: string) => call<BorderDraft[]>('GET', `${p(id)}/drafts`),
  saveDrafts: (id: string, drafts: BorderDraft[]) => call<{ ok: boolean }>('PUT', `${p(id)}/drafts`, drafts),
  chooseFolder: (start?: string) => call<{ path: string | null }>('POST', '/api/choose-folder', { start }),
  startExport: (id: string, settings: unknown) => call<{ jobId: string; dir: string }>('POST', `${p(id)}/exports`, settings),
  sendFrame: (id: string, job: string, pass: string, frame: number, w: number, h: number, rgba: Uint8Array) =>
    call<{ file: string; sha256: string }>('POST', `${p(id)}/exports/${encodeURIComponent(job)}/frames?pass=${encodeURIComponent(pass)}&frame=${frame}&w=${w}&h=${h}`, undefined, rgba),
  finishExport: (id: string, job: string) => call<{ dir: string; manifest: string; guide: string; checksums: Record<string, Record<number, string>> }>('POST', `${p(id)}/exports/${encodeURIComponent(job)}/finish`),
};
