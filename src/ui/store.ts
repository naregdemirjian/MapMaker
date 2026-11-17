// Interface state and the bridge between the interface, the in-memory world and the data service.
// Commands run locally first (so the map updates immediately), then are saved in order; if saving
// fails, the local change is reversed and the project reloaded from disk.
import { useSyncExternalStore } from 'react';
import { Api, ApiError, type JournalState, type ProjectInfo, type BorderDraft } from './api.ts';
import { World } from '../world-model/world.ts';
import { Engine } from '../temporal-engine/engine.ts';
import type { CommandResult } from '../domain/commands.ts';
import { type Instant, gregorian, toJSONValue, fromJSONValue } from '../core-time/index.ts';
import { type Camera, defaultCamera, PROJECTIONS } from '../render-engine/camera.ts';
import { MapRenderer } from '../render-engine/map-renderer.ts';
import { loadBasemap, type Basemap } from '../render-engine/basemap.ts';
import { DEFAULT_PERIOD, type PeriodSpec } from '../domain/history-view.ts';
import { setAssetBase } from '../render-engine/assets.ts';
import type { Vec3 } from '../geo-kernel/vec.ts';
import type { StrokeSettings } from '../render-engine/stroke.ts';

export type Mode = 'world' | 'present';
/** One line of a right-click menu: an action, a heading, or a divider. */
export type MenuItem = { label: string; run: () => void; danger?: boolean; testId?: string } | { heading: string } | 'divider';

export type Tool = 'select' | 'lasso' | 'polygon' | 'pen' | 'vertex' | 'place';
export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'point'; lon: number; lat: number }
  | { kind: 'shot'; id: string }
  | null;

export type PendingEdit =
  | { kind: 'paint'; spaceId: string; layerId: string; rings: Vec3[][]; value: string | null; sample: [number, number] | null; origin: [number, number]; snap: number; draftId?: string }
  | { kind: 'vertex'; spaceId: string; vertexId: number; to: Vec3 };

export interface Toast { id: number; text: string; kind: 'info' | 'error' }

class AppStore {
  version = 0;
  private listeners = new Set<() => void>();
  appVersion = '';
  projectsDir = '';
  projects: ProjectInfo[] = [];
  projectId: string | null = null;
  projectDir = '';
  world: World | null = null;
  engine: Engine | null = null;
  journal: JournalState = { head: 0, canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };
  mode: Mode = 'world';
  spaceId = '';
  layerId = '';
  time: Instant = gregorian.fromCivil({ year: 2000 });
  tool: Tool = 'select';
  selection: Selection = null;
  paintValue: string | null = null;
  /**
   * Several things chosen at once in the lists (Ctrl or Shift + click): countries, cities and
   * characters, or events. Right-click and the Delete key act on all of them.
   */
  multi: { kind: 'entity' | 'event'; ids: string[] } | null = null;
  /** The right-click menu that is open. */
  menu: { x: number; y: number; title?: string; items: MenuItem[] } | null = null;
  /** Folded groups and countries in the lists (remembered per project). */
  collapsed: string[] = [];
  /** The ids chosen now: the several chosen, else the one selected (of that kind). */
  chosen(kind: 'entity' | 'event'): string[] {
    if (this.multi?.kind === kind && this.multi.ids.length) return this.multi.ids;
    return this.selection?.kind === kind ? [this.selection.id] : [];
  }
  /** A click on a row of a list: plain (select it), Ctrl (add or remove it), Shift (a run from the last one). */
  pick(kind: 'entity' | 'event', id: string, e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, order: string[]): void {
    if (e.shiftKey && this.pickAnchor && order.includes(this.pickAnchor)) {
      const a = order.indexOf(this.pickAnchor), b = order.indexOf(id);
      const run = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      this.set({ multi: { kind, ids: run }, selection: { kind, id } as Selection });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const cur = this.chosen(kind);
      const ids = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      this.pickAnchor = id;
      this.set({ multi: { kind, ids }, selection: ids.length ? ({ kind, id: ids[ids.length - 1] } as Selection) : null });
      return;
    }
    this.pickAnchor = id;
    this.set({ multi: null, selection: { kind, id } as Selection });
  }
  private pickAnchor: string | null = null;
  toggleCollapsed(key: string) { this.set({ collapsed: this.collapsed.includes(key) ? this.collapsed.filter((k) => k !== key) : [...this.collapsed, key] }); }
  /** A question for a line of text, shown in the app's own dialog (the desktop app has no prompt()). */
  ask: { title: string; label: string; value: string; ok: string; resolve: (v: string | null) => void } | null = null;
  /** Ask for a line of text; resolves to null when cancelled. */
  askText(title: string, label: string, value = '', ok = 'OK'): Promise<string | null> {
    return new Promise((resolve) => this.set({ ask: { title, label, value, ok, resolve } }));
  }
  /** The character the Characters tool places. */
  placeValue: string | null = null;
  /**
   * "Changes over time": the selected country is shown lightly, and the land it gained and lost in
   * the period around the date being viewed strongly. See domain/history-view.ts.
   */
  historyView: { on: boolean; period: PeriodSpec } = { on: false, period: DEFAULT_PERIOD };
  recordEventId: string | null = null;
  cameras = new Map<string, Camera>();
  stroke: StrokeSettings = { smoothness: 1, irregularity: 0, precision: 1.2, seed: 1 };
  pending: PendingEdit | null = null;
  toasts: Toast[] = [];
  busy: string | null = null;
  timeline = { start: 900, end: 2100 };
  shotId: string | null = null;
  shotFrame = 0;
  /** Unsaved camera adjustment in presentation mode (cleared when the frame changes). */
  presentCamera: Camera | null = null;
  /** A text or the current-events box being dragged on the shot preview (fractions of the frame). */
  presentOverlay: { id: string; dx: number; dy: number; from?: { x: number; y: number } } | null = null;
  playing = false;
  dialog: string | null = null;
  /** The event the last drawing went into, offered first for the next one (several border changes, one event). */
  lastPaintEvent: string | null = null;
  /** Event groups the timeline shows (null: every event). Remembered per project. */
  eventFilter: string[] | null = null;
  /** Set when a change could not be saved; editing stops until the project is reloaded from disk. */
  offline: string | null = null;
  readonly renderer = new MapRenderer();
  /** Earth's geography (Natural Earth), loaded once in the background. */
  basemap: Basemap | null = null;
  /** Show present-day country borders over the land while drawing (never exported). */
  referenceBorders = false;
  private queue: Promise<unknown> = Promise.resolve();
  private halted = false;
  private toastSeq = 0;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  notify() { this.version++; for (const l of this.listeners) l(); this.saveViewSoon(); }

  /** Remember where the user was looking (per project, in this browser), so reopening returns there. */
  private saveViewSoon() {
    const id = this.projectId;
    if (!id) return;
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => {
      if (this.projectId !== id) return;
      try {
        localStorage.setItem(`mapmaker.view.${id}`, JSON.stringify({ spaceId: this.spaceId, time: toJSONValue(this.time), cameras: [...this.cameras.entries()], eventFilter: this.eventFilter, collapsed: this.collapsed }));
      } catch { /* storage may be unavailable */ }
    }, 500);
  }

  private restoreView(id: string) {
    const w = this.world!;
    this.cameras = new Map();
    this.time = gregorian.fromCivil({ year: 2000 });
    this.eventFilter = null;
    this.collapsed = [];
    this.multi = null;
    try {
      const v = JSON.parse(localStorage.getItem(`mapmaker.view.${id}`) ?? 'null') as { spaceId?: string; time?: unknown; cameras?: [string, Camera][]; eventFilter?: unknown; collapsed?: unknown } | null;
      if (!v) return;
      if (v.spaceId && w.get('map_space', v.spaceId)) this.spaceId = v.spaceId;
      for (const [k, c] of v.cameras ?? []) {
        const ok = c && [c.lon, c.lat, c.zoom, c.rotation].every((n) => typeof n === 'number' && Number.isFinite(n)) && PROJECTIONS.some((p) => p.id === c.projection);
        if (ok && w.get('map_space', k)) this.cameras.set(k, c);
      }
      if (Array.isArray(v.eventFilter)) this.eventFilter = v.eventFilter.filter((g): g is string => typeof g === 'string' && (g === '__ungrouped' || !!w.get('event_group', g)));
      if (v.time) this.time = fromJSONValue(v.time as Parameters<typeof fromJSONValue>[0]);
      if (Array.isArray(v.collapsed)) this.collapsed = v.collapsed.filter((k): k is string => typeof k === 'string');
    } catch { /* a damaged view record is ignored */ }
  }
  set(patch: Partial<AppStore>) {
    // Selecting one thing (on the map, from a panel) ends a choice of several, unless it is part of it.
    if ('selection' in patch && !('multi' in patch)) patch = { ...patch, multi: null };
    Object.assign(this, patch);
    this.notify();
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, text, kind }];
    this.notify();
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); this.notify(); }, kind === 'error' ? 7000 : 3500);
  }

  get camera(): Camera {
    let c = this.cameras.get(this.spaceId);
    if (!c) { c = defaultCamera(); this.cameras.set(this.spaceId, c); }
    return c;
  }
  setCamera(c: Camera) { this.cameras.set(this.spaceId, c); this.notify(); }

  async loadApp() {
    loadBasemap().then((b) => this.set({ basemap: b }), (e: Error) => this.toast(e.message, 'error'));
    const info = await Api.app();
    this.appVersion = info.version;
    this.projectsDir = info.projectsDir;
    this.projects = await Api.projects();
    this.notify();
  }

  async createProject(name: string, worldName: string, radiusKm: number) {
    const info = await Api.createProject(name, { name: worldName, radiusKm });
    await this.openProject(info.id);
  }

  /** Open a project; if its file is damaged, offer to recover it from its newest healthy backup. */
  async openOrRecover(id: string) {
    try {
      await this.openProject(id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'damaged') {
        const ok = confirm(`${e.message}\n\nRestore it from its most recent healthy automatic backup? Changes made after that backup will be lost. The damaged file is kept in the project's "damaged" folder.`);
        if (!ok) return;
        try {
          const r = await Api.recover(id);
          await this.openProject(id);
          this.toast(`Recovered from the backup of ${new Date(r.restoredFrom).toLocaleString()}.`);
        } catch (e2) {
          this.toast(`Could not recover the project: ${(e2 as Error).message}`, 'error');
        }
      } else this.toast(`Could not open the project: ${(e as Error).message}`, 'error');
    }
  }

  async openProject(id: string) {
    this.busy = 'Opening project…';
    this.notify();
    try {
      const data = await Api.open(id);
      this.world = World.fromSnapshot(data.snapshot);
      this.engine = new Engine(this.world);
      this.projectId = id;
      setAssetBase(`/api/projects/${encodeURIComponent(id)}/assets/`, () => this.notify());
      this.projectDir = data.dir;
      this.journal = data.journal;
      const spaces = this.world.all('map_space').sort((a, b) => a.sort_order - b.sort_order);
      this.spaceId = spaces[0]?.id ?? '';
      this.restoreView(id);
      this.drafts = [];
      this.draftId = null;
      Api.drafts(id).then((d) => { if (this.projectId === id) this.set({ drafts: d, draftId: d.find((x) => x.spaceId === this.spaceId)?.id ?? null }); }, () => undefined);
      this.layerId = this.world.all('layer').find((l) => l.space_id === this.spaceId && l.kind === 'partition')?.id ?? '';
      this.selection = null;
      this.recordEventId = null;
      this.pending = null;
      this.shotId = null;
      this.halted = false;
      this.offline = null;
      this.fitTimeline();
      try { localStorage.setItem('mapmaker.lastProject', id); } catch { /* storage may be unavailable */ }
    } finally {
      this.busy = null;
      this.notify();
    }
  }

  // ---------------------------------------------------------------- border pen drafts

  /** Unfinished border-pen lines of the open project (kept in its folder, outside the history). */
  drafts: BorderDraft[] = [];
  draftId: string | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;

  get draft(): BorderDraft | null { return this.drafts.find((d) => d.id === this.draftId) ?? null; }
  /** Finish the current draft (set by the map view, which knows the zoom for snapping). */
  finishDraft: () => void = () => {};

  private saveDraftsSoon() {
    const id = this.projectId;
    if (!id) return;
    clearTimeout(this.draftTimer);
    const drafts = this.drafts;
    this.draftTimer = setTimeout(() => { Api.saveDrafts(id, drafts).catch((e: Error) => this.toast(`The border draft could not be saved: ${e.message}`, 'error')); }, 300);
  }

  private changeDraft(id: string, change: (d: BorderDraft) => BorderDraft | null) {
    this.drafts = this.drafts.flatMap((d) => { if (d.id !== id) return [d]; const n = change(d); return n ? [{ ...n, updated: new Date().toISOString() }] : []; });
    if (this.draftId && !this.drafts.some((d) => d.id === this.draftId)) this.draftId = null;
    this.saveDraftsSoon();
    this.notify();
  }

  /** Start a new draft on the map being viewed (it becomes the current one). */
  newDraft(): string {
    const n = this.drafts.filter((d) => d.spaceId === this.spaceId).length + 1;
    const d: BorderDraft = { id: `draft_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`, name: `Border draft ${n}`, spaceId: this.spaceId, owner: this.paintValue, points: [], pieces: [], updated: new Date().toISOString() };
    this.drafts = [...this.drafts, d];
    this.draftId = d.id;
    this.saveDraftsSoon();
    this.notify();
    return d.id;
  }

  /** Add a point to the current draft; `newPiece` starts a new piece (pressing again after letting go). */
  penAdd(ll: [number, number], newPiece: boolean) {
    const id = this.draft && this.draft.spaceId === this.spaceId ? this.draftId! : this.newDraft();
    this.changeDraft(id, (d) => ({ ...d, points: [...d.points, ll], pieces: newPiece ? [...d.pieces, d.points.length] : d.pieces }));
  }

  /** Take back the last piece drawn. */
  penUndoPiece() {
    const d = this.draft;
    if (!d || !d.pieces.length) return;
    const from = d.pieces[d.pieces.length - 1];
    this.changeDraft(d.id, (x) => ({ ...x, points: x.points.slice(0, from), pieces: x.pieces.slice(0, -1) }));
  }

  discardDraft(id: string) { this.changeDraft(id, () => null); }
  renameDraft(id: string, name: string) { this.changeDraft(id, (d) => ({ ...d, name })); }
  setDraftOwner(id: string, owner: string | null) { this.changeDraft(id, (d) => ({ ...d, owner })); }

  /** Make another draft the current one (and show its map and owner). */
  resumeDraft(id: string) {
    const d = this.drafts.find((x) => x.id === id);
    if (!d) return;
    const layerId = d.spaceId === this.spaceId ? this.layerId : this.world?.all('layer').find((l) => l.space_id === d.spaceId && l.kind === 'partition')?.id ?? '';
    this.set({ draftId: id, spaceId: d.spaceId, layerId, paintValue: d.owner, tool: 'pen' });
  }

  closeProject() {
    this.projectId = null;
    this.world = null;
    this.engine = null;
    this.selection = null;
    this.mode = 'world';
    void this.loadApp();
    this.notify();
  }

  async reload() {
    if (this.projectId) {
      const keepSpace = this.spaceId, keepLayer = this.layerId;
      await this.openProject(this.projectId);
      if (this.world?.get('map_space', keepSpace)) { this.spaceId = keepSpace; this.layerId = keepLayer; }
      this.notify();
    }
  }

  /** Run a command locally, then save it. Returns the command's result, or undefined if it failed. */
  execute<T>(fn: (w: World, e: Engine) => CommandResult<T>): T | undefined {
    if (!this.world || !this.engine || !this.projectId) return undefined;
    if (this.halted) { this.toast('Changes cannot be saved right now, so editing is paused.', 'error'); return undefined; }
    let r: CommandResult<T>;
    try {
      r = fn(this.world, this.engine);
    } catch (e) {
      this.toast((e as Error).message, 'error');
      this.notify();
      return undefined;
    }
    this.notify();
    if (r.diffs.length) {
      const projectId = this.projectId;
      const world = this.world;
      this.queue = this.queue.then(async () => {
        // Once a save has failed, later changes were built on top of it: none of them are sent, and
        // the project is reloaded from disk (the only trustworthy copy) as soon as that is possible.
        if (this.halted || this.world !== world) return;
        try {
          const res = await Api.commit(projectId, r.label, r.diffs, this.journal.head);
          this.journal = res.journal;
        } catch (e) {
          this.halted = true;
          if (e instanceof ApiError && e.status === 409) {
            this.toast(`"${r.label}" was not saved because the project changed on disk. The project has been reloaded.`, 'error');
            await this.reloadFromDisk();
          } else {
            this.offline = `Your last change ("${r.label}") could not be saved: ${(e as Error).message}`;
          }
        }
        this.notify();
      });
    }
    return r.result;
  }

  /** Wait until every pending save has reached the disk. */
  flush(): Promise<unknown> { return this.queue; }

  /** Replace the in-memory project with what is on disk, discarding anything that was not saved. */
  async reloadFromDisk(): Promise<boolean> {
    try {
      await Api.app();
      await this.reload();
      this.halted = false;
      this.offline = null;
      return true;
    } catch (e) {
      this.offline = `Map Maker's background service cannot be reached: ${(e as Error).message}`;
      return false;
    } finally {
      this.notify();
    }
  }

  undo() { this.historyStep('undo'); }
  redo() { this.historyStep('redo'); }

  private historyStep(which: 'undo' | 'redo') {
    if (!this.projectId || this.halted) return;
    const id = this.projectId;
    this.queue = this.queue.then(async () => {
      if (this.halted) return;
      try {
        const res = which === 'undo' ? await Api.undo(id) : await Api.redo(id);
        if (res.diffs.length && this.world) this.world.applyDiffs(res.diffs);
        this.journal = res.journal;
        if (res.label) this.toast(`${which === 'undo' ? 'Undid' : 'Redid'}: ${res.label}`);
      } catch (e) {
        this.halted = true;
        this.offline = `${which === 'undo' ? 'Undo' : 'Redo'} failed: ${(e as Error).message}`;
        if (e instanceof ApiError) await this.reloadFromDisk();
      }
      this.validateSelection();
      this.notify();
    });
  }

  validateSelection() {
    const s = this.selection;
    if (!s || !this.world) return;
    if (s.kind === 'entity' && !this.world.get('entity', s.id)) this.selection = null;
    if (s.kind === 'event' && !this.world.get('event', s.id)) this.selection = null;
    if (s.kind === 'shot' && !this.world.get('sequence', s.id)) this.selection = null;
    if (this.recordEventId && !this.world.get('event', this.recordEventId)) this.recordEventId = null;
    if (this.shotId && !this.world.get('sequence', this.shotId)) this.shotId = null;
  }

  setTime(t: Instant) { this.time = t; this.notify(); }

  fitTimeline() {
    if (!this.world) return;
    const ys = this.world.all('event').filter((e) => e.id !== 'evt_base').flatMap((e) => {
      const a = (e.start_day / 365.2425) + 1970;
      const b = e.end_day !== null ? (e.end_day / 365.2425) + 1970 : a;
      return [a, b];
    });
    if (ys.length === 0) { this.timeline = { start: 900, end: 2100 }; return; }
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const pad = Math.max(5, (hi - lo) * 0.15);
    this.timeline = { start: lo - pad, end: hi + pad };
  }
}

export const store = new AppStore();
export type Store = AppStore;

export function useStore(): AppStore {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store;
}
