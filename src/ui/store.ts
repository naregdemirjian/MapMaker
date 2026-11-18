// Interface state and the bridge between the interface, the in-memory world and the data service.
// Commands run locally first (so the map updates immediately), then are saved in order; if saving
// fails, the local change is reversed and the project reloaded from disk.
import { useSyncExternalStore } from 'react';
import { Api, ApiError, type JournalState, type ProjectInfo, type BorderDraft } from './api.ts';
import { World } from '../world-model/world.ts';
import { Engine } from '../temporal-engine/engine.ts';
import { takeLockedSkipped, type CommandResult } from '../domain/commands.ts';
import { type Instant, gregorian, toJSONValue, fromJSONValue } from '../core-time/index.ts';
import { type Camera, defaultCamera, flatCamera, PROJECTIONS } from '../render-engine/camera.ts';
import { MapRenderer, VIEW_QUALITY } from '../render-engine/map-renderer.ts';
import { loadViewSettings, saveViewSettings, DETAIL_TOLERANCE, type ViewSettings } from './view-settings.ts';
import { loadRecordLength, type RecordLength } from './record-length.ts';
import { loadBasemap, loadBasemapDetail, type Basemap } from '../render-engine/basemap.ts';
import { loadEarthTerrain, EARTH_TERRAIN_KEY, type ElevationGrid } from '../terrain/grid.ts';
import { planetKey, type PlanetParams } from '../terrain/planet.ts';
import { planetTerrain } from '../terrain/planet-cache.ts';
import { loadEarthCover, coverSoon, type TerrainCover } from '../terrain/cover.ts';
import { climateOf } from '../terrain/biomes.ts';
import type { FieldSource } from '../domain/fields.ts';
import type { DisasterId } from '../domain/disasters.ts';
import type { SculptTool } from '../terrain/sculpt.ts';
import { terrainSourceOf, planetOf } from '../world-model/world-settings.ts';
import type { MapSpaceRow } from '../world-model/schema.ts';
import { DEFAULT_PERIOD, type PeriodSpec } from '../domain/history-view.ts';
import { setAssetBase } from '../render-engine/assets.ts';
import { lonLatToVec, type Vec3 } from '../geo-kernel/vec.ts';
import type { StrokeSettings } from '../render-engine/stroke.ts';

export type Mode = 'world' | 'present';
/** One line of a right-click menu: an action, a heading, or a divider. */
export type MenuItem = { label: string; run: () => void; danger?: boolean; testId?: string } | { heading: string } | 'divider';

export type Tool = 'select' | 'lasso' | 'polygon' | 'pen' | 'vertex' | 'place' | 'erase' | 'feature' | 'split' | 'regions' | 'sculpt' | 'field' | 'disaster' | 'systems' | 'lanes';
export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'point'; lon: number; lat: number }
  | { kind: 'shot'; id: string }
  | { kind: 'feature'; id: string }
  /** A star on a space map (D110), by its catalogue id. */
  | { kind: 'star'; id: number }
  | null;

export type PendingEdit =
  | { kind: 'paint'; spaceId: string; layerId: string; rings: Vec3[][]; value: string | null; sample: [number, number] | null; origin: [number, number]; snap: number; draftId?: string }
  /** A border point dragged: moved for all time (refused with `blocked` when that would cross a border), or from the date viewed (D77). */
  | { kind: 'vertex'; spaceId: string; vertexId: number; to: Vec3; layerId?: string | null; blocked?: string | null }
  /** An area, line or point drawn with the features tool: a new feature, or a new shape for one (`reshape`). Parts in longitude, latitude. */
  | { kind: 'feature'; layerId: string; parts: Array<Array<[number, number]>>; reshape: string | null }
  /** A line drawn across a country with the Split tool and the part clicked (longitude, latitude; D76). */
  | { kind: 'split'; spaceId: string; layerId: string; line: Array<[number, number]>; pick: [number, number]; snap: number };

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
  /** The layer of areas, lines or points the features tool draws on; how areas and lines are drawn; the feature being given a new shape (null: a new one). */
  featureLayerId = '';
  /** The Conditions tool (D102): the field layer it places sources on, and the settings of the next source (the layer's usual ones, changed). */
  fieldLayerId = '';
  fieldSource: Partial<FieldSource> = {};
  /** The Disasters tool (D104): which template, its size, and where the wind carries its plumes (degrees from north). */
  disaster: { id: DisasterId; size: number; windDeg: number } = { id: 'nuclear', size: 1000, windDeg: 90 };
  /** The kind the New layer dialog starts with (null: territory). */
  newLayerKind: 'partition' | 'area' | 'line' | 'point' | 'field' | null = null;
  featureDraw: 'freehand' | 'clicks' = 'freehand';
  reshapeId: string | null = null;
  /**
   * "Changes over time": the selected country is shown lightly, and the land it gained and lost in
   * the period around the date being viewed strongly. See domain/history-view.ts.
   */
  historyView: { on: boolean; period: PeriodSpec } = { on: false, period: DEFAULT_PERIOD };
  recordEventId: string | null = null;
  /** A change whose expansion is given another starting point by the next click on the map (D91). */
  pickOrigin: string | null = null;
  /** A callout (D107) whose place is chosen by the next click on the shot's preview: its overlay id. */
  pickCallout: string | null = null;
  /** What each change recorded into an event does: at once, or spreading for how long, and how (D86; kept on this computer). */
  recordLength: RecordLength = loadRecordLength();
  cameras = new Map<string, Camera>();
  stroke: StrokeSettings = { smoothness: 1, irregularity: 0, precision: 1.2, seed: 1 };
  /** The sculpting brush (D98): which, how large (km), how strong (m), and whether a stroke changes the base world or holds from the date viewed. */
  sculpt: { tool: SculptTool; radiusKm: number; strength: number; dated: boolean } = { tool: 'raise', radiusKm: 300, strength: 500, dated: false };
  pending: PendingEdit | null = null;
  /** The Split tool's line, drawn and waiting for the part that changes hands to be clicked (D76). */
  splitLine: Array<[number, number]> | null = null;
  /** The countries chosen for "Merge into one" (D76). */
  mergeIds: string[] = [];
  /** The region picker (D78): which regions are offered, and those chosen (indices into them). */
  regionLevel: 'regions' | 'countries' = 'regions';
  regionPicks: number[] = [];
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
  /**
   * Playing history in the world-building view: on or off, how fast (years of history a second) and whether it
   * goes round again from the start of the timeline at its end.
   */
  historyPlay = { on: false, yearsPerSecond: 10, loop: false };
  dialog: string | null = null;
  /** The event the last drawing went into, offered first for the next one (several border changes, one event). */
  lastPaintEvent: string | null = null;
  /** Event groups the timeline shows (null: every event). Remembered per project. */
  eventFilter: string[] | null = null;
  /** Set when a change could not be saved; editing stops until the project is reloaded from disk. */
  offline: string | null = null;
  readonly renderer = new MapRenderer();
  /**
   * Comparing two dates: the map at the date viewed on the left of a line across the map, at
   * `time` on the right; `split` is where the line is (a fraction of the map's width). Drawn by a
   * renderer of its own, so neither side's kept pictures are thrown away by the other.
   */
  compare: { on: boolean; time: Instant; split: number } = { on: false, time: gregorian.fromCivil({ year: 1900 }), split: 0.5 };
  readonly compareRenderer = new MapRenderer();
  /** How the working view is drawn on this computer (never part of a project or an export). */
  viewSettings: ViewSettings = loadViewSettings();
  setViewSettings(v: ViewSettings) {
    this.viewSettings = v;
    saveViewSettings(v);
    this.applyViewSettings();
    this.notify();
  }
  private applyViewSettings() {
    for (const r of [this.renderer, this.compareRenderer]) {
      r.carry = this.viewSettings.whileMoving === 'carry';
      r.quality = { ...VIEW_QUALITY, tolerance: DETAIL_TOLERANCE[this.viewSettings.detail] };
    }
    return true;
  }
  private readonly viewSettingsApplied = this.applyViewSettings();
  /** Earth's geography (Natural Earth), loaded once in the background. */
  basemap: Basemap | null = null;
  /** Earth's elevation (D94), loaded the first time a map shows terrain. */
  earthTerrain: ElevationGrid | null = null;
  private terrainLoading = false;
  /** Earth's land cover (D100), loaded the first time a map shows the satellite look. */
  earthCover: TerrainCover | null = null;
  private coverLoading = false;
  /** Show present-day country borders over the land while drawing (never exported). */
  referenceBorders = false;
  private queue: Promise<unknown> = Promise.resolve();
  private halted = false;
  private toastSeq = 0;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  /** Everything follows a change: the map at once and every panel. */
  notify() {
    clearTimeout(this.catchUp);
    this.catchUp = undefined;
    this.version++;
    this.liveVersion++;
    for (const l of this.listeners) l();
    for (const l of this.liveListeners) l();
    this.saveViewSoon();
  }

  /**
   * Goes up with every change at once; `version` (which the panels follow) goes up with it, except
   * when only the view moved (see notifyLive): then it follows when the movement pauses.
   */
  liveVersion = 0;
  private liveListeners = new Set<() => void>();
  private catchUp: ReturnType<typeof setTimeout> | undefined;
  subscribeLive = (cb: () => void) => { this.liveListeners.add(cb); return () => { this.liveListeners.delete(cb); }; };

  /**
   * The view moved (the map dragged or zoomed, the date scrubbed along the timeline, a shot playing):
   * the map and the few readouts that follow the view are redrawn at once; the panels (lists of
   * hundreds of countries and events, the inspector) catch up when the movement pauses, instead of
   * being worked out again for every step of it.
   */
  notifyLive() {
    this.liveVersion++;
    for (const l of this.liveListeners) l();
    clearTimeout(this.catchUp);
    this.catchUp = setTimeout(() => { this.catchUp = undefined; this.notify(); }, 140);
  }

  /** Change view state (camera in a shot, shot frame, an overlay being dragged) as the view moves: see notifyLive. */
  setLive(patch: Partial<AppStore>) {
    Object.assign(this, patch);
    this.notifyLive();
  }

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
        const ok = c && [c.lon, c.lat, c.zoom, c.rotation].every((n) => typeof n === 'number' && Number.isFinite(n)) && (c.projection === 'flat' || PROJECTIONS.some((p) => p.id === c.projection));
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
    // The territory brush gives land to the country selected: a country or faction chosen in a list or
    // a panel, or the one holding the place clicked on the map (never "nobody" from a click on the sea).
    if (patch.selection && !('paintValue' in patch)) {
      const sel = patch.selection;
      let owner: string | null = null;
      if (sel.kind === 'entity') { const e = this.world?.get('entity', sel.id); if (e && (e.type_id === 'polity' || e.type_id === 'faction')) owner = e.id; }
      else if (sel.kind === 'point' && this.engine && this.layerId) owner = this.engine.valueAtPoint(this.spaceId, this.layerId, lonLatToVec(sel.lon, sel.lat), this.time);
      if (owner) patch = { ...patch, paintValue: owner };
    }
    Object.assign(this, patch);
    this.notify();
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, text, kind }];
    this.notify();
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); this.notify(); }, kind === 'error' ? 7000 : 3500);
  }

  /** Generated planets' heights by their settings (D97), made on first use. */
  private planets = new Map<string, ElevationGrid | 'making'>();
  /** A planet being made: how far along (0 to 1), for the interface. */
  planetProgress: number | null = null;

  /**
   * The terrain a map has, if it is ready: Earth's (D94) or a generated planet's (D97). What is not
   * ready yet is loaded or made, and everything is drawn again when it is.
   */
  terrainOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined): { grid: ElevationGrid; key: string } | null {
    const source = terrainSourceOf(space);
    if (source === 'earth') {
      if (!this.earthTerrain) this.needEarthTerrain();
      return this.earthTerrain ? { grid: this.earthTerrain, key: EARTH_TERRAIN_KEY } : null;
    }
    const params = source === 'planet' ? planetOf(space) : null;
    if (!params) return null;
    const key = planetKey(params), have = this.planets.get(key);
    if (have && have !== 'making') return { grid: have, key };
    if (!have) this.makePlanet(params, key);
    return null;
  }

  private makePlanet(params: PlanetParams, key: string): void {
    this.planets.set(key, 'making');
    this.planetProgress = 0;
    planetTerrain(params, (done) => { this.planetProgress = done; this.notify(); }).then(
      (g) => { this.planets.set(key, g); this.planetProgress = null; this.notify(); },
      (e: Error) => { this.planets.delete(key); this.planetProgress = null; this.toast(e.message, 'error'); },
    );
  }

  /**
   * The land cover of a map with the satellite look (D100), if it is ready: Earth's (loaded on first
   * use), or a planet's worked out from its heights `ground` (sculpted or not), a moment after them.
   */
  coverOf(space: Pick<MapSpaceRow, 'settings' | 'radius_m' | 'kind'> | null | undefined, ground: { grid: ElevationGrid; key: string }): TerrainCover | null {
    const source = terrainSourceOf(space);
    if (source === 'earth') {
      if (!this.earthCover && !this.coverLoading) {
        this.coverLoading = true;
        loadEarthCover().then((c) => { this.coverLoading = false; this.set({ earthCover: c }); }, (e: Error) => { this.coverLoading = false; this.toast(e.message, 'error'); });
      }
      return this.earthCover;
    }
    const params = source === 'planet' ? planetOf(space) : null;
    return params ? coverSoon(ground.grid, ground.key, (space?.radius_m ?? 6371008.8) / 1000, climateOf(params), () => this.notify()) : null;
  }

  /** Loads Earth's terrain unless it is there or on its way (everything is drawn again when it arrives). */
  needEarthTerrain(): void {
    if (this.earthTerrain || this.terrainLoading) return;
    this.terrainLoading = true;
    loadEarthTerrain().then((g) => { this.terrainLoading = false; this.set({ earthTerrain: g }); }, (e: Error) => { this.terrainLoading = false; this.toast(e.message, 'error'); });
  }

  get camera(): Camera {
    let c = this.cameras.get(this.spaceId);
    // A flat map is always seen in plan; a round map never is.
    const flat = this.world?.get('map_space', this.spaceId)?.kind === 'plane';
    if (c && (c.projection === 'flat') !== flat) c = undefined;
    if (!c) { c = flat ? flatCamera() : defaultCamera(); this.cameras.set(this.spaceId, c); }
    return c;
  }
  setCamera(c: Camera) { this.cameras.set(this.spaceId, c); this.notifyLive(); }

  async loadApp() {
    loadBasemap().then((b) => {
      this.set({ basemap: b });
      // The detailed coastlines follow in the background (unless the working view does without them),
      // so that the first close look at a coast does not have to wait for them.
      if (this.viewSettings.coast === 'full') setTimeout(() => { loadBasemapDetail(b).then(() => this.notify(), () => undefined); }, 1500);
    }, (e: Error) => this.toast(e.message, 'error'));
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
      // (The rows just read are the world's to keep: nothing else holds them.)
      this.world = World.fromSnapshot(data.snapshot, true);
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
    if (newPiece) this.penRedo = []; // a new piece ends what can be put back
    this.changeDraft(id, (d) => ({ ...d, points: [...d.points, ll], pieces: newPiece ? [...d.pieces, d.points.length] : d.pieces }));
  }

  /** Take back the last piece drawn (it can be put back with penRedoPiece until a new piece is drawn). */
  penUndoPiece() {
    const d = this.draft;
    if (!d || !d.pieces.length) return;
    const from = d.pieces[d.pieces.length - 1];
    this.penRedo = [...(this.penRedo.length && this.penRedoDraft === d.id ? this.penRedo : []), d.points.slice(from)];
    this.penRedoDraft = d.id;
    this.changeDraft(d.id, (x) => ({ ...x, points: x.points.slice(0, from), pieces: x.pieces.slice(0, -1) }));
  }

  /** Put back the piece last taken back. */
  penRedoPiece() {
    const d = this.draft;
    if (!d || this.penRedoDraft !== d.id || !this.penRedo.length) return;
    const piece = this.penRedo[this.penRedo.length - 1];
    this.penRedo = this.penRedo.slice(0, -1);
    this.changeDraft(d.id, (x) => ({ ...x, points: [...x.points, ...piece], pieces: [...x.pieces, x.points.length] }));
  }

  /** Pieces taken back from the current draft, to put back (last first). */
  private penRedo: Array<Array<[number, number]>> = [];
  private penRedoDraft: string | null = null;

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
    // An undo or redo on its way changes the map when it arrives: a change made meanwhile would be built on what is about to go.
    if (this.stepping) { this.toast('One moment: the undo is still being applied.'); return undefined; }
    let r: CommandResult<T>;
    takeLockedSkipped();
    try {
      r = fn(this.world, this.engine);
    } catch (e) {
      takeLockedSkipped();
      this.toast((e as Error).message, 'error');
      this.notify();
      return undefined;
    }
    // Land of locked countries that the edit left as it was (D87).
    const kept = takeLockedSkipped();
    if (kept.length) this.toast(`Locked, so left as ${kept.length === 1 ? 'it was' : 'they were'}: ${kept.length > 4 ? `${kept.slice(0, 4).join(', ')} and ${kept.length - 4} more` : kept.join(', ')}.`);
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

  /**
   * How many problems History Health has found, as last counted. Counting compares every change
   * with every other, which takes a while on a long history: so the count follows edits a moment
   * later instead of holding each one up (the dialog itself always shows the current list).
   */
  private problems: { engine: Engine | null; revision: number; count: number; timer: ReturnType<typeof setTimeout> | undefined } = { engine: null, revision: -1, count: 0, timer: undefined };
  problemCount(): number {
    const engine = this.engine, p = this.problems;
    if (!engine) return 0;
    const revision = engine.revision;
    if (p.engine !== engine) { clearTimeout(p.timer); this.problems = { engine, revision, count: engine.conflicts.length, timer: undefined }; return this.problems.count; }
    if (p.revision !== revision) {
      clearTimeout(p.timer);
      p.timer = setTimeout(() => {
        if (this.engine !== engine) return;
        const count = engine.conflicts.length, changed = count !== p.count;
        p.revision = engine.revision; p.count = count;
        if (changed) this.notify();
      }, 300);
    }
    return p.count;
  }

  /** Undo and redo steps asked for and not yet applied. */
  private stepping = 0;

  private historyStep(which: 'undo' | 'redo') {
    if (!this.projectId || this.halted) return;
    const id = this.projectId;
    this.stepping++;
    this.queue = this.queue.then(async () => {
      if (this.halted) { this.stepping--; return; }
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
      this.stepping--;
      this.validateSelection();
      this.notify();
    });
  }

  validateSelection() {
    // The map viewed may have gone (its creation undone): the first map left is shown instead.
    if (this.world && this.spaceId && !this.world.get('map_space', this.spaceId)) {
      const first = this.world.all('map_space').sort((a, b) => a.sort_order - b.sort_order)[0];
      this.spaceId = first?.id ?? '';
      this.layerId = first ? this.world.all('layer').find((l) => l.space_id === first.id && l.kind === 'partition')?.id ?? '' : '';
      this.selection = null;
    }
    if (this.world && this.layerId && !this.world.get('layer', this.layerId)) {
      this.layerId = this.world.all('layer').find((l) => l.space_id === this.spaceId && l.kind === 'partition')?.id ?? '';
    }
    const s = this.selection;
    if (!s || !this.world) return;
    if (s.kind === 'entity' && !this.world.get('entity', s.id)) this.selection = null;
    if (s.kind === 'event' && !this.world.get('event', s.id)) this.selection = null;
    if (s.kind === 'shot' && !this.world.get('sequence', s.id)) this.selection = null;
    if (this.recordEventId && !this.world.get('event', this.recordEventId)) this.recordEventId = null;
    if (this.shotId && !this.world.get('sequence', this.shotId)) this.shotId = null;
  }

  /** Go to a date; `live`: while scrubbing (the panels catch up when the scrubbing pauses). */
  /** When the moment shown was last changed by dragging (performance.now()): while that goes on, the map places names less finely (see MapView). */
  timeDraggedAt = -Infinity;
  setTime(t: Instant, live = false) { this.time = t; if (live) { this.timeDraggedAt = performance.now(); this.notifyLive(); } else this.notify(); }

  fitTimeline() {
    if (!this.world) return;
    const ys = this.world.all('event').filter((e) => e.id !== 'evt_base').flatMap((e) => {
      const a = (e.start_day / 365.2425) + 1970;
      const b = e.end_day !== null ? (e.end_day / 365.2425) + 1970 : a;
      return [a, b];
    });
    if (ys.length === 0) { this.timeline = { start: 900, end: 2100 }; return; }
    let lo = Infinity, hi = -Infinity;
    for (const y of ys) { if (y < lo) lo = y; if (y > hi) hi = y; }
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

/** As useStore, for the few components that follow the view as it moves (the map, the timeline's cursor, the date and frame readouts). */
export function useLive(): AppStore {
  useSyncExternalStore(store.subscribeLive, () => store.liveVersion);
  return store;
}
