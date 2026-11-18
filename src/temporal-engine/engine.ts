// The temporal engine: compiles events and their effects into per-property timelines and answers
// "what is the world like at time t". Events are the authoritative record; everything here is a
// disposable cache rebuilt from them whenever the world's revision changes.
import { type Instant, compare, NEG_INF, fromStore, lerp, diffMs, fraction, stepDate } from '../core-time/index.ts';
import type { World, HistoryStep } from '../world-model/world.ts';
import { BASE_EVENT_ID, type EffectRow, type EventRow } from '../world-model/schema.ts';
import { type Vec3, angle, e7ToVec, lonLatToVec } from '../geo-kernel/vec.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';

/**
 * How a change animates. border ("Advancing front"): from the border with the new owner's existing
 * land; advance ("Expansion"): a circle from an origin; fade; wipe: a straight sweep (old shots only).
 */
export type TransitionStyle = 'instant' | 'border' | 'advance' | 'fade' | 'wipe';
export interface TransitionSpec {
  style: TransitionStyle; origin?: [number, number]; easing?: 'linear' | 'smooth';
  /** An expansion's other starting points (D91): it spreads from all of them at once (pincers, encirclement). */
  origins?: Array<[number, number]>;
  /**
   * How long the change takes (D86): until this moment (stored day and milliseconds), or for this
   * long from its own time; without either, until its event ends.
   */
  until?: [number, number];
  for?: { n: number; unit: 'day' | 'month' | 'year' };
  /** Recorded to last until the next change recorded into its event: `until` is set when one is. */
  next?: boolean;
}
export interface Resolution { set: Array<[number[], string | null]> }
export interface AnnexIntent { op: 'annex'; from: string; to: string }

export interface CompiledTransition {
  style: TransitionStyle; origin: Vec3 | null; maxDist: number; easing: 'linear' | 'smooth' | 'in' | 'out';
  /** Every starting point of an expansion, the first being `origin` (D91); absent when there is one. */
  origins?: Vec3[];
  /** Wipe direction in degrees (shot-level wipes). */ angle?: number; /** Made by a shot's transition settings, not recorded. */ shot?: boolean;
}

/** The distance (radians) from the nearest of an expansion's starting points. */
export function fromNearest(spec: Pick<CompiledTransition, 'origin' | 'origins'>, p: Vec3): number {
  if (spec.origins && spec.origins.length > 1) { let m = Infinity; for (const o of spec.origins) m = Math.min(m, angle(o, p)); return m; }
  return spec.origin ? angle(spec.origin, p) : 0;
}

/** One assignment of a value to a parcel (or an ancestor parcel) of a partition layer. */
export interface Assignment {
  t: Instant;
  end: Instant;
  value: string | null;
  effectId: string;
  eventId: string;
  precedence: number;
  eventSeq: number;
  ordinal: number;
  entry: number;
  face: number;
  transition: CompiledTransition | null;
}

export interface FaceState {
  value: string | null;
  assignment: Assignment | null;
  /** Present while the face is changing hands: the previous value and the progress of the change. */
  transition?: { from: string | null; progress: number; spec: CompiledTransition; prior: Assignment | null };
}

/**
 * Where a character is placed from a date on (an effect of kind 'place'): a point, never territory.
 * `off`: the character leaves the map from this date. `arrive`: whether the character travels here
 * from its previous place (moving steadily between the two dates) or appears here at the date.
 */
export interface PlaceIntent { op: 'place'; entity: string; lon?: number; lat?: number; off?: boolean; arrive?: 'travel' | 'jump' }

/** A new name for a country, city or character from a date on (an effect of kind 'rename'). */
export interface RenameIntent { op: 'rename'; entity: string; name: string }

/**
 * The shape of an area, line or point on a feature layer from a date on (an effect of kind 'shape').
 * `parts`: for an area its rings (even-odd: a ring inside another is a hole), for a line its
 * polylines, for a point one part with one place; each part is longitude, latitude, longitude,
 * latitude... in degrees. `off`: the feature no longer exists from this date (until shaped again).
 * A feature exists from its first shape on: its lifespan is its shapes.
 */
export interface ShapeIntent { op: 'shape'; feature: string; parts?: number[][]; off?: boolean }

/** A relationship holds (`on`) or no longer holds from a date on (an effect of kind 'relate'). */
export interface RelateIntent { op: 'relate'; relation: string; on: boolean }

/** One compiled step of a relationship: it holds, or not, from a moment on. */
export interface RelateStep { t: Instant; on: boolean; effectId: string; eventId: string; precedence: number; eventSeq: number; ordinal: number }

/** A period in which a relationship holds: from, until (null: still holding), and the changes that began and ended it. */
export interface RelationPeriod { from: Instant; to: Instant | null; fromEffect: string; toEffect: string | null }

/** One compiled step of a feature's history: its shape from a moment on (null: it does not exist). */
/** How a new shape of an area, line or point appears over its event's length (Stage 6, D79). */
export type FeatureAnimStyle = 'draw' | 'grow' | 'fade';
export const isFeatureAnim = (v: unknown): v is FeatureAnimStyle => v === 'draw' || v === 'grow' || v === 'fade';
export interface ShapeStep { t: Instant; parts: number[][] | null; effectId: string; eventId: string; precedence: number; eventSeq: number; ordinal: number; anim: { style: FeatureAnimStyle; end: Instant } | null }

/** A feature as it is at a moment: its shape, and the change that gave it. */
export interface FeatureAt {
  feature: string; layer: string; parts: number[][]; effectId: string; since: Instant;
  /** While its shape is still appearing (D79): how far (0 to 1, eased), how, and the shape before (fading out). */
  progress?: number; style?: FeatureAnimStyle; before?: number[][] | null;
}

/** One compiled waypoint of a character's track. */
export interface Waypoint { t: Instant; lon: number; lat: number; off: boolean; arrive: 'travel' | 'jump'; effectId: string; eventId: string; precedence: number; eventSeq: number; ordinal: number }

/**
 * A character on the map at a moment. `ahead`: a point a little way on in the direction it is
 * travelling, or last travelled (absent if it never has): which way its icon faces (D85).
 */
export interface CharacterAt { entity: string; lon: number; lat: number; moving: boolean; ahead?: [number, number] }

export type ConflictKind = 'simultaneous' | 'overlap' | 'stale' | 'broken';
export interface Conflict { kind: ConflictKind; effectId: string; eventId: string; otherEventId?: string; message: string }

/** Order of assignments: time, then precedence, then event creation order, effect order, entry order. Later wins. */
export function orderCmp(a: Assignment, b: Assignment): number {
  return compare(a.t, b.t) || a.precedence - b.precedence || a.eventSeq - b.eventSeq || a.ordinal - b.ordinal || a.entry - b.entry;
}

export function eventStart(e: EventRow): Instant {
  return e.id === BASE_EVENT_ID ? NEG_INF : fromStore(e.start_day, e.start_ms);
}
export function eventEnd(e: EventRow): Instant | null {
  return e.end_day === null || e.end_ms === null ? null : fromStore(e.end_day, e.end_ms);
}
/** An expansion's starting points beyond its first, as unit vectors (D91); nothing when it has only one. */
function startingPoints(spec: TransitionSpec): { origins?: Vec3[] } {
  if (spec.style !== 'advance' || !spec.origin || !Array.isArray(spec.origins) || !spec.origins.length) return {};
  const more = spec.origins.filter((o) => Array.isArray(o) && Number.isFinite(o[0]) && Number.isFinite(o[1])).map((o) => lonLatToVec(o[0], o[1]));
  return more.length ? { origins: [lonLatToVec(spec.origin[0], spec.origin[1]), ...more] } : {};
}

/** When a change starting at t with this transition has finished: at its own end if it has one, else at its event's end. */
export function transitionEnd(spec: TransitionSpec | null, t: Instant, ev: EventRow): Instant | null {
  if (spec?.until && Number.isFinite(spec.until[0])) return fromStore(spec.until[0], spec.until[1] ?? 0);
  if (spec?.for && spec.for.n > 0 && Number.isFinite(t.day)) return stepDate(t, spec.for.unit, spec.for.n);
  return eventEnd(ev);
}
export function effectTime(ef: EffectRow, ev: EventRow): Instant {
  // The starting map's changes are from the beginning, except changes made without an event, which
  // carry their own date (see isUntracked).
  if (ev.id === BASE_EVENT_ID) return ef.at_day !== null && ef.at_ms !== null ? fromStore(ef.at_day, ef.at_ms) : NEG_INF;
  return ef.at_day !== null && ef.at_ms !== null ? fromStore(ef.at_day, ef.at_ms) : eventStart(ev);
}

/**
 * A change made without an event ("correct this period"): kept with the starting map, which no list
 * shows as an event, but dated. It applies from its date until something later changes the area.
 */
export function isUntracked(ef: Pick<EffectRow, 'event_id' | 'at_day'>): boolean {
  return ef.event_id === BASE_EVENT_ID && ef.at_day !== null;
}

/**
 * Where a change without an event and an event's change happen at the same moment, the change
 * without an event wins: it was drawn while looking at that moment, on top of what was there.
 */
export const UNTRACKED_PRECEDENCE = 1e9;

export function parseJSON<T>(text: string, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

/** What a territory change gives to whom, read from its row once (rows are replaced, never changed, so the reading holds). Not to be modified. */
const resolutions = new WeakMap<EffectRow, Resolution>();
export function resolutionOf(ef: EffectRow): Resolution {
  let r = resolutions.get(ef);
  if (!r) resolutions.set(ef, (r = parseJSON<Resolution>(ef.resolution, { set: [] })));
  return r;
}


/** Children of every face (lineage tree), kept by the parcel map itself; callers must not modify it. */
export function childrenMap(arr: Arrangement): Map<number, number[]> {
  return arr.childrenMap();
}

export function leafDescendants(arr: Arrangement, faces: Iterable<number>, kids = childrenMap(arr)): Set<number> {
  const out = new Set<number>();
  const stack = [...faces];
  while (stack.length) {
    const f = stack.pop()!;
    const c = kids.get(f);
    if (c && c.length) stack.push(...c);
    else if (arr.faces.get(f)?.is_leaf) out.add(f);
  }
  return out;
}

/** Smallest set of faces (using ancestors where all children are included) covering exactly these leaves. */
export function canonicalFaces(arr: Arrangement, leaves: Iterable<number>, kids = childrenMap(arr)): number[] {
  const set = new Set(leaves);
  let changed = true;
  while (changed) {
    changed = false;
    const parents = new Set<number>();
    for (const f of set) { const p = arr.faces.get(f)?.parent_id; if (p !== null && p !== undefined) parents.add(p); }
    for (const p of parents) {
      const c = kids.get(p) ?? [];
      if (c.length && c.every((x) => set.has(x))) { for (const x of c) set.delete(x); set.add(p); changed = true; }
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function hashFaces(faces: number[]): string {
  let h = 0x811c9dc5;
  const s = faces.join(',');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + faces.length;
}

/** What a state of all parcels differs by from the state it was worked out from (see Engine.stateDelta). */
export interface StateDelta { from: Map<number, FaceState>; changed: number[]; removed: number[] }

/** The parts of an event that decide when and in what order its changes take place. */
function sameStanding(a: EventRow, b: EventRow): boolean {
  return a.start_day === b.start_day && a.start_ms === b.start_ms && a.end_day === b.end_day && a.end_ms === b.end_ms
    && a.precedence === b.precedence && a.created_seq === b.created_seq && a.variant_group === b.variant_group && a.variant_active === b.variant_active;
}

const timeKey = (t: Instant) => `${t.day}:${t.ms}`;

export class Engine {
  private compiledRevision = -1;
  private timelines = new Map<string, Map<number, Assignment[]>>();
  /** Names over time: entity -> dated names in order (the entity's own name holds before the first). */
  private names = new Map<string, Array<{ t: Instant; name: string; order: [number, number, number] }>>();
  /** Characters' tracks: map -> character -> waypoints in time order. */
  private tracks = new Map<string, Map<string, Waypoint[]>>();
  /** Every relationship's steps (in time order; one step per moment). */
  private relates = new Map<string, RelateStep[]>();
  /** Every feature's shapes over time, by layer then feature (in time order; one step per moment). */
  private shapes = new Map<string, Map<string, ShapeStep[]>>();
  private effectAssignments = new Map<string, Assignment[]>();
  /** For each territory change: the layer it writes to, and the instants it takes place and ends at. */
  private effectLayer = new Map<string, string>();
  private effectTimes = new Map<string, Instant[]>();
  /** Territory changes with an animation that spreads from a point (its reach depends on the land's outline). */
  private originEffects = new Set<string>();
  /** How many changes take place or end at each instant; the instants in order; those of names and placements. */
  private timeCount = new Map<string, { t: Instant; n: number }>();
  private changeTimes: Instant[] = [];
  private pointTimes: Instant[] = [];
  /** When the shapes appearing over their events' length are complete (also times of change, for stepping; D79). */
  private animEnds: Instant[] = [];
  /** Territory changes by the instants they take place and end at, in order (for finding what happens between two moments). */
  private timeIndex: Array<{ t: Instant; id: string }> = [];
  /** Problems found while compiling, by change; and the whole list with those found by comparing changes (null: to be worked out). */
  private broken = new Map<string, Conflict[]>();
  private conflictList: Conflict[] | null = null;
  /**
   * Problems found in the history, always current with the tables. Comparing every change with
   * every other takes a while on a long history, so it is done when the list is asked for.
   */
  get conflicts(): Conflict[] {
    this.ensure();
    if (!this.conflictList) {
      const w = this.world;
      const order = (id: string) => w.get('effect', id)?.ordinal ?? 0;
      const list: Conflict[] = [];
      for (const [, l] of [...this.broken.entries()].sort((x, y) => order(x[0]) - order(y[0]) || (x[0] < y[0] ? -1 : 1))) list.push(...l);
      this.conflictList = list;
      this.detectConflicts(w.all('effect').sort((x, y) => x.ordinal - y.ordinal || (x.id < y.id ? -1 : 1)), new Map(w.all('event').map((e) => [e.id, e])));
    }
    return this.conflictList;
  }

  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  get revision(): number { this.ensure(); return this.compiledRevision; }

  /** How compiled history was brought up to date (for tests and benchmarks): all at once, or by following changes. */
  stats = { compiled: 0, followed: 0, statesWhole: 0, statesDerived: 0 };
  /** For tests: never follow changes or derive states, always work everything out afresh. */
  static incremental = true;
  /**
   * For tests: whenever changes were followed or a state was worked out from the one before, work
   * the same out afresh as well and stop with an error if the two differ.
   */
  static verify = false;
  /** What verify found (the messages of the errors it raised), for tests to read. */
  static verifyFailures: string[] = [];
  private static fail(message: string): never { Engine.verifyFailures.push(message); throw new Error(message); }

  ensure(): void {
    if (this.compiledRevision === this.world.historyRevision) return;
    const steps = Engine.incremental && this.compiledRevision >= 0 ? this.world.historySince(this.compiledRevision) : null;
    if (steps && steps.length <= 5000 && this.follow(steps)) {
      this.stats.followed++;
      if (Engine.verify) this.checkAgainstFresh();
      return;
    }
    this.compile();
  }

  /** For tests (see verify): history as followed must be history as compiled afresh. */
  private checkAgainstFresh(): void {
    const fresh = new Engine(this.world);
    fresh.compile();
    const brief = (a: Assignment) => `${a.entry}@${a.face}:${a.t.day}.${a.t.ms}-${a.end.day}.${a.end.ms}=${a.value}/${a.precedence}/${a.eventSeq}/${a.ordinal}/${a.transition ? `${a.transition.style}~${a.transition.maxDist}` : ''}`;
    const show = (e: Engine) => [
      e.changeTimes.map(timeKey).join(' '),
      [...e.effectAssignments.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([id, l]) => `${id}[${l.map(brief).join(' ')}]`).join('\n'),
      [...e.timelines.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([layer, lm]) => `${layer}{${[...lm.entries()].sort((x, y) => x[0] - y[0]).map(([f, tl]) => `${f}:${tl.map((a) => `${a.effectId}#${a.entry}`).join(',')}`).join(' ')}}`).join('\n'),
      e.timeIndex.map((x) => `${timeKey(x.t)}`).join(' '),
      JSON.stringify([...e.names.entries()].sort()), JSON.stringify([...e.tracks.entries()].map(([sp, m]) => [sp, [...m.entries()].sort()])),
      JSON.stringify([...e.shapes.entries()].sort().map(([l, m]) => [l, [...m.entries()].sort()])),
      JSON.stringify([...e.relates.entries()].sort()),
      JSON.stringify(e.conflicts),
    ];
    const a = show(this), b = show(fresh);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
      let at = 0;
      while (at < a[i].length && a[i][at] === b[i][at]) at++;
      Engine.fail(`History followed change by change differs from history compiled afresh (part ${i}, from character ${at}):
  followed: ${a[i].slice(Math.max(0, at - 80), at + 200)}
  afresh:   ${b[i].slice(Math.max(0, at - 80), at + 200)}`);
    }
  }

  isActiveEvent(ev: EventRow): boolean {
    return !ev.variant_group || ev.variant_active === 1;
  }

  /** Compile all of history from the tables. */
  compile(): void {
    const w = this.world;
    this.stats.compiled++;
    this.timelines.clear();
    this.effectAssignments.clear();
    this.effectLayer.clear();
    this.effectTimes.clear();
    this.originEffects.clear();
    this.timeCount.clear();
    this.pointTimes = [];
    this.animEnds = [];
    this.timeIndex = [];
    this.broken.clear();
    this.conflictList = null;
    const events = new Map(w.all('event').map((e) => [e.id, e]));
    const effects = w.all('effect').sort((a, b) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : 1));
    for (const ef of effects) if (ef.kind === 'assign' || ef.kind === 'annex') this.addAssign(ef, events.get(ef.event_id), false);
    for (const lm of this.timelines.values()) for (const tl of lm.values()) tl.sort(orderCmp);
    this.timeIndex.sort((a, b) => compare(a.t, b.t));
    this.compilePoints(effects, events);
    this.changeTimes = [...this.timeCount.values()].map((x) => x.t).sort(compare);
    this.compiledRevision = w.historyRevision;
    // Nothing worked out before this can be carried over.
    this.stateLog = [];
    this.stateLogFrom = this.compiledRevision;
    // (Without bringing the parcel maps' outlines up to date: maps not being looked at are left alone.)
    this.kernelMarks = new Map([...w.arrangements.values()].map((arr) => [arr, arr.touchMark(false)]));
  }

  /** Count an instant at which something changes (or stop counting it), keeping the list of instants in order. */
  private countTime(t: Instant, by: 1 | -1, ordered: boolean): void {
    if (t.day === -Infinity) return;
    const k = timeKey(t);
    const e = this.timeCount.get(k);
    if (by > 0) {
      if (e) { e.n++; return; }
      this.timeCount.set(k, { t, n: 1 });
      if (ordered) this.changeTimes.splice(this.firstAfter(this.changeTimes, t), 0, t);
    } else if (e && --e.n <= 0) {
      this.timeCount.delete(k);
      if (ordered) { const i = this.firstAfter(this.changeTimes, t) - 1; if (i >= 0 && compare(this.changeTimes[i], t) === 0) this.changeTimes.splice(i, 1); }
    }
  }

  /** The index of the first instant after t in a list in order. */
  private firstAfter(ts: Instant[], t: Instant): number {
    let lo = 0, hi = ts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (compare(ts[mid], t) <= 0) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /**
   * Compile one territory change into the timelines. `ordered`: the timelines and lists of instants
   * are in order and must stay so (a change being followed); otherwise they are put in order afterwards.
   */
  private addAssign(ef: EffectRow, ev: EventRow | undefined, ordered: boolean): void {
    const w = this.world;
    const problems: Conflict[] = [];
    const done = () => { if (problems.length) this.broken.set(ef.id, problems); };
    if (!ev) { problems.push({ kind: 'broken', effectId: ef.id, eventId: ef.event_id, message: 'This change belongs to an event that no longer exists.' }); return done(); }
    if (!this.isActiveEvent(ev)) return;
    const layer = ef.layer_id ? w.get('layer', ef.layer_id) : undefined;
    const arr = ef.space_id ? w.arrangements.get(ef.space_id) : undefined;
    if (!layer || !arr) { problems.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: 'This change refers to a layer or map that no longer exists.' }); return done(); }
    const t = effectTime(ef, ev);
    const spec = parseJSON<TransitionSpec | null>(ef.transition, null);
    const end = transitionEnd(spec, t, ev);
    const hasTransition = spec && spec.style !== 'instant' && end && compare(end, t) > 0;
    const compiled: CompiledTransition | null = hasTransition
      ? { style: spec.style, origin: spec.origin ? lonLatToVec(spec.origin[0], spec.origin[1]) : null, maxDist: 0, easing: spec.easing ?? 'smooth', ...startingPoints(spec) }
      : null;
    const res = resolutionOf(ef);
    const list: Assignment[] = [];
    // (A layer's timelines exist while some parcel of it has a change: made with its first, dropped with its last.)
    let lm = this.timelines.get(layer.id);
    res.set.forEach(([faces, given], entry) => {
      let value = given;
      // Land given to a country that no longer exists is nobody's (and reported): it is never drawn
      // as a nameless grey owner.
      if (value && !w.get('entity', value)) { problems.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: 'This change gives territory to someone who no longer exists.' }); value = null; }
      for (const face of faces) {
        if (!arr.faces.has(face)) { problems.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: `Parcel ${face} no longer exists.` }); continue; }
        const a: Assignment = {
          t, end: compiled ? end! : t, value, effectId: ef.id, eventId: ev.id, precedence: isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence,
          eventSeq: ev.created_seq, ordinal: ef.ordinal, entry, face, transition: compiled,
        };
        if (!lm) this.timelines.set(layer.id, (lm = new Map()));
        let tl = lm.get(face);
        if (!tl) lm.set(face, (tl = []));
        if (ordered) {
          let lo = 0, hi = tl.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (orderCmp(tl[mid], a) <= 0) lo = mid + 1; else hi = mid; }
          tl.splice(lo, 0, a);
          this.stateLog.push({ rev: w.historyRevision, layer: layer.id, face });
        } else tl.push(a);
        list.push(a);
      }
    });
    this.effectAssignments.set(ef.id, list);
    this.effectLayer.set(ef.id, layer.id);
    if (compiled && compiled.origin) { compiled.maxDist = this.regionMaxDistance(arr, list.map((a) => a.face), compiled); this.originEffects.add(ef.id); }
    const times = compiled && end ? [t, end] : [t];
    this.effectTimes.set(ef.id, times);
    for (const x of times) {
      this.countTime(x, 1, ordered);
      if (ordered) this.timeIndex.splice(this.firstIndexAfter(x), 0, { t: x, id: ef.id });
      else this.timeIndex.push({ t: x, id: ef.id });
    }
    done();
  }

  /** The index of the first entry of the time index after t. */
  private firstIndexAfter(t: Instant): number {
    const ix = this.timeIndex;
    let lo = 0, hi = ix.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (compare(ix[mid].t, t) <= 0) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** Take one territory change out of the timelines (it was changed or deleted). */
  private removeAssign(id: string): void {
    this.broken.delete(id);
    const list = this.effectAssignments.get(id);
    if (!list) return;
    const layerId = this.effectLayer.get(id)!;
    const lm = this.timelines.get(layerId);
    for (const a of list) {
      const tl = lm?.get(a.face);
      if (tl) { const i = tl.indexOf(a); if (i >= 0) tl.splice(i, 1); if (!tl.length) lm!.delete(a.face); }
      this.stateLog.push({ rev: this.world.historyRevision, layer: layerId, face: a.face });
    }
    if (lm && !lm.size) this.timelines.delete(layerId);
    for (const x of this.effectTimes.get(id) ?? []) {
      this.countTime(x, -1, true);
      for (let i = this.firstIndexAfter(x) - 1; i >= 0 && compare(this.timeIndex[i].t, x) === 0; i--) if (this.timeIndex[i].id === id) { this.timeIndex.splice(i, 1); break; }
    }
    this.effectAssignments.delete(id);
    this.effectLayer.delete(id);
    this.effectTimes.delete(id);
    this.originEffects.delete(id);
  }

  /** Compile names over time and characters' and cities' places (all of them: there are few, and they depend on each other's order). */
  private compilePoints(effects: EffectRow[], events: Map<string, EventRow>): void {
    const w = this.world;
    for (const t of this.pointTimes) this.countTime(t, -1, false);
    this.pointTimes = [];
    for (const t of this.animEnds) this.countTime(t, -1, false);
    this.animEnds = [];
    this.tracks.clear();
    this.names.clear();
    this.shapes.clear();
    this.relates.clear();
    const count = (t: Instant) => { if (t.day !== -Infinity) { this.pointTimes.push(t); this.countTime(t, 1, false); } };
    for (const ef of effects) {
      if (ef.kind !== 'rename' && ef.kind !== 'place' && ef.kind !== 'shape' && ef.kind !== 'relate') continue;
      this.broken.delete(ef.id);
      const ev = events.get(ef.event_id);
      const problem = (message: string) => this.broken.set(ef.id, [{ kind: 'broken', effectId: ef.id, eventId: ev ? ev.id : ef.event_id, message }]);
      if (!ev) { problem('This change belongs to an event that no longer exists.'); continue; }
      if (!this.isActiveEvent(ev)) continue;
      if (ef.kind === 'relate') {
        const it = parseJSON<RelateIntent | null>(ef.intent, null);
        const r = it ? w.get('relation', it.relation) : undefined;
        if (!it || !r) { problem('This change is of a relationship that no longer exists.'); continue; }
        if (!w.get('entity', r.a) || !w.get('entity', r.b)) { problem('This relationship is with something that no longer exists.'); continue; }
        let steps = this.relates.get(r.id);
        if (!steps) this.relates.set(r.id, (steps = []));
        const t = effectTime(ef, ev);
        steps.push({ t, on: !!it.on, effectId: ef.id, eventId: ev.id, precedence: isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence, eventSeq: ev.created_seq, ordinal: ef.ordinal });
        count(t);
        continue;
      }
      if (ef.kind === 'shape') {
        const it = parseJSON<ShapeIntent | null>(ef.intent, null);
        const f = it ? w.get('feature', it.feature) : undefined;
        if (!it || !f) { problem('This change of shape is of an area, line or point that no longer exists.'); continue; }
        const layer = w.get('layer', f.layer_id);
        if (!layer) { problem('This change of shape is on a layer that no longer exists.'); continue; }
        const parts = it.off ? null : (it.parts ?? []).filter((p) => Array.isArray(p) && p.length >= 2 && p.every((v) => Number.isFinite(v)));
        if (parts && !parts.length) { problem('This change of shape has no points.'); continue; }
        let byLayer = this.shapes.get(layer.id);
        if (!byLayer) this.shapes.set(layer.id, (byLayer = new Map()));
        let steps = byLayer.get(f.id);
        if (!steps) byLayer.set(f.id, (steps = []));
        const t = effectTime(ef, ev);
        // Appearing over the rest of its event (from its own moment to the event's end), if asked to.
        let anim: ShapeStep['anim'] = null;
        const tr = parts ? parseJSON<{ style?: unknown } | null>(ef.transition, null) : null;
        if (tr && isFeatureAnim(tr.style) && !isUntracked(ef) && ev.end_day !== null) {
          const end = fromStore(ev.end_day, ev.end_ms ?? 0);
          if (compare(end, t) > 0) { anim = { style: tr.style, end }; this.animEnds.push(end); this.countTime(end, 1, false); }
        }
        steps.push({ t, parts, effectId: ef.id, eventId: ev.id, precedence: isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence, eventSeq: ev.created_seq, ordinal: ef.ordinal, anim });
        count(t);
        continue;
      }
      if (ef.kind === 'rename') {
        const it = parseJSON<RenameIntent | null>(ef.intent, null);
        if (!it || !w.get('entity', it.entity)) { problem('This change of name is of something that no longer exists.'); continue; }
        const l = this.names.get(it.entity) ?? [];
        l.push({ t: effectTime(ef, ev), name: it.name, order: [isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence, ev.created_seq, ef.ordinal] });
        this.names.set(it.entity, l);
        count(effectTime(ef, ev));
        continue;
      }
      const it = parseJSON<PlaceIntent | null>(ef.intent, null);
      if (!it || !ef.space_id || !w.get('map_space', ef.space_id)) { problem('This character placement refers to a map that no longer exists.'); continue; }
      if (!w.get('entity', it.entity)) { problem('This placement is of a character who no longer exists.'); continue; }
      const t = effectTime(ef, ev);
      let bySpace = this.tracks.get(ef.space_id);
      if (!bySpace) this.tracks.set(ef.space_id, (bySpace = new Map()));
      let track = bySpace.get(it.entity);
      if (!track) bySpace.set(it.entity, (track = []));
      track.push({
        t, lon: it.lon ?? 0, lat: it.lat ?? 0, off: !!it.off, arrive: it.arrive ?? 'travel', effectId: ef.id, eventId: ev.id,
        precedence: isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence, eventSeq: ev.created_seq, ordinal: ef.ordinal,
      });
      count(t);
    }
    for (const l of this.names.values()) l.sort((a, b) => compare(a.t, b.t) || a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]);
    for (const bySpace of this.tracks.values()) for (const tr of bySpace.values()) {
      tr.sort((a, b) => compare(a.t, b.t) || a.precedence - b.precedence || a.eventSeq - b.eventSeq || a.ordinal - b.ordinal);
      // Several placements at one moment: the last in order stands.
      for (let i = tr.length - 2; i >= 0; i--) if (compare(tr[i].t, tr[i + 1].t) === 0) tr.splice(i, 1);
    }
    for (const steps of this.relates.values()) {
      steps.sort((a, b) => compare(a.t, b.t) || a.precedence - b.precedence || a.eventSeq - b.eventSeq || a.ordinal - b.ordinal);
      for (let i = steps.length - 2; i >= 0; i--) if (compare(steps[i].t, steps[i + 1].t) === 0) steps.splice(i, 1);
    }
    for (const byLayer of this.shapes.values()) for (const steps of byLayer.values()) {
      steps.sort((a, b) => compare(a.t, b.t) || a.precedence - b.precedence || a.eventSeq - b.eventSeq || a.ordinal - b.ordinal);
      // Several shapes at one moment: the last in order stands.
      for (let i = steps.length - 2; i >= 0; i--) if (compare(steps[i].t, steps[i + 1].t) === 0) steps.splice(i, 1);
    }
  }

  /** The state of the parcel maps as of the last compile, to find what was touched since (see follow). */
  private kernelMarks = new Map<Arrangement, number>();
  /** Parcels whose timeline changed, by the revision that changed it (for carrying states over, see derive). */
  private stateLog: Array<{ rev: number; layer: string; face: number }> = [];
  private stateLogFrom = 0;

  /**
   * Bring compiled history up to date by following the changes made since the last compile, when
   * they are of kinds that touch little: territory changes and events added, changed or deleted,
   * names and placements, parcels split or made whole again. False when everything must be compiled
   * (a layer, map or country came or went, or the changes cannot all be told).
   */
  private follow(steps: HistoryStep[]): boolean {
    const w = this.world;
    const effects = new Set<string>();
    const events = new Map<string, EventRow | null>();
    const spaces = new Set<string>();
    let points = false;
    for (const s of steps) {
      if (s.table === 'vertex' || s.table === 'face') { spaces.add(((s.after ?? s.before) as { space_id: string }).space_id); continue; }
      if (s.table === 'effect') {
        effects.add(((s.after ?? s.before) as EffectRow).id);
        for (const r of [s.before, s.after] as Array<EffectRow | null>) if (r && (r.kind === 'rename' || r.kind === 'place' || r.kind === 'shape' || r.kind === 'relate')) points = true;
        continue;
      }
      // An area, line or point that came or went: its shapes are compiled again (with the names and places).
      if (s.table === 'feature' || s.table === 'relation') { points = true; continue; }
      if (s.table === 'event') {
        const id = ((s.after ?? s.before) as EventRow).id;
        if (!events.has(id)) events.set(id, s.before as EventRow | null);
        continue;
      }
      return false;
    }
    // An event that came, went, or moved in time or standing takes all its changes with it.
    const moved = new Set<string>();
    for (const [id, before] of events) {
      const now = w.get('event', id);
      if (!(before && now && sameStanding(before, now))) moved.add(id);
    }
    const all = moved.size || points ? w.all('effect') : null;
    if (moved.size) for (const ef of all!) if (moved.has(ef.event_id)) { effects.add(ef.id); if (ef.kind === 'rename' || ef.kind === 'place' || ef.kind === 'shape' || ef.kind === 'relate') points = true; }
    // Parcels: one that is gone may not be referred to; land whose outline changed may change how far an animation reaches.
    const again = new Set<string>();
    const gone: number[] = [];
    for (const spaceId of spaces) {
      const arr = w.arrangements.get(spaceId);
      if (!arr) return false;
      const mark = this.kernelMarks.get(arr);
      const touched = mark === undefined ? null : arr.touchedSince(mark);
      if (!touched) return false;
      for (const f of touched) {
        if (!arr.faces.has(f)) { gone.push(f); continue; }
        if (!this.originEffects.size) continue;
        for (let g: number | null | undefined = f; g !== null && g !== undefined; g = arr.faces.get(g)?.parent_id) {
          for (const lm of this.timelines.values()) for (const a of lm.get(g) ?? []) if (a.transition?.origin) again.add(a.effectId);
        }
      }
    }
    const eventOf = (ef: EffectRow) => w.get('event', ef.event_id);
    for (const id of effects) {
      this.removeAssign(id);
      const ef = w.get('effect', id);
      if (ef && (ef.kind === 'assign' || ef.kind === 'annex')) this.addAssign(ef, eventOf(ef), true);
    }
    // A parcel that is gone and still referred to: reported by compiling everything.
    for (const f of gone) for (const lm of this.timelines.values()) if (lm.has(f)) return false;
    if (points) this.compilePoints(all ?? w.all('effect'), new Map(w.all('event').map((e) => [e.id, e])));
    if (points) this.changeTimes = [...this.timeCount.values()].map((x) => x.t).sort(compare);
    for (const id of again) {
      const list = this.effectAssignments.get(id), ef = w.get('effect', id);
      const arr = ef?.space_id ? w.arrangements.get(ef.space_id) : undefined;
      const spec = list?.[0]?.transition;
      if (list && arr && spec?.origin) spec.maxDist = this.regionMaxDistance(arr, list.map((a) => a.face), spec);
    }
    for (const spaceId of spaces) { const arr = w.arrangements.get(spaceId)!; this.kernelMarks.set(arr, arr.touchMark()); }
    if (this.stateLog.length > 60_000) { this.stateLogFrom = this.stateLog[30_000].rev; this.stateLog.splice(0, 30_001); }
    this.conflictList = null;
    this.compiledRevision = w.historyRevision;
    return true;
  }

  /** How far an expansion must go: to the point of the change farthest from its nearest starting point. */
  private regionMaxDistance(arr: Arrangement, faces: number[], spec: Pick<CompiledTransition, 'origin' | 'origins'>): number {
    let m = 0;
    for (const leaf of leafDescendants(arr, faces)) {
      for (const cyc of arr.faceCycles(leaf)) for (const vid of cyc) {
        const r = arr.vertices.get(vid)!;
        m = Math.max(m, fromNearest(spec, e7ToVec(r.lon, r.lat)));
      }
    }
    return m || 1e-9;
  }

  /** Latest assignment affecting a leaf face at or before t (optionally strictly earlier in order than `before`). */
  latest(spaceId: string, layerId: string, face: number, t: Instant, before?: Assignment): Assignment | null {
    this.ensure();
    const lm = this.timelines.get(layerId);
    if (!lm) return null;
    const arr = this.world.arrangements.get(spaceId);
    let best: Assignment | null = null;
    let f: number | null | undefined = face;
    while (f !== null && f !== undefined) {
      const tl = lm.get(f);
      if (tl && tl.length) {
        let lo = 0, hi = tl.length - 1, idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const ok = compare(tl[mid].t, t) <= 0 && (!before || orderCmp(tl[mid], before) < 0);
          if (ok) { idx = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (idx >= 0 && (!best || orderCmp(tl[idx], best) > 0)) best = tl[idx];
      }
      f = arr?.faces.get(f)?.parent_id;
    }
    return best;
  }

  faceState(spaceId: string, layerId: string, face: number, t: Instant): FaceState {
    const a = this.latest(spaceId, layerId, face, t);
    if (!a) return { value: null, assignment: null };
    if (a.transition && compare(t, a.end) < 0) {
      const prior = this.latest(spaceId, layerId, face, t, a);
      const progress = Math.max(0, Math.min(1, diffMs(a.t, t) / Math.max(1, diffMs(a.t, a.end))));
      return { value: a.value, assignment: a, transition: { from: prior ? prior.value : null, progress, spec: a.transition, prior } };
    }
    return { value: a.value, assignment: a };
  }

  /** Distance (radians from the origin) the front of an advancing transition has reached at time t. */
  frontRadius(a: Assignment, t: Instant): number {
    if (!a.transition) return Infinity;
    const tau = Math.max(0, Math.min(1, diffMs(a.t, t) / Math.max(1, diffMs(a.t, a.end))));
    const d = a.transition.easing === 'smooth' ? tau * tau * (3 - 2 * tau) : tau;
    return d * a.transition.maxDist;
  }

  /** States at recent instants (while changes are animating, each instant has its own). */
  private stateCache = new Map<string, Map<number, FaceState>>();
  /** Per stretch of time between two changes: every parcel's state, and the parcels changing hands in it. */
  private stretchCache = new Map<string, { base: Map<number, FaceState>; changing: number[]; t: Instant }>();
  /** The state last given for each layer, with what was current when it was worked out: the next is worked out from it (see derive). */
  private lastState = new Map<string, { arr: Arrangement; base: Map<number, FaceState>; changing: number[]; t: Instant; rev: number; mark: number }>();
  private deltas = new WeakMap<Map<number, FaceState>, { from: WeakRef<Map<number, FaceState>>; changed: number[]; removed: number[] }>();

  /** The state of every parcel of a layer at time t. Recent answers are reused; callers must not modify the result. */
  /** The name something goes by at instant t, if it was renamed by then (null: its own name). */
  nameAt(entity: string, t: Instant): string | null {
    this.ensure();
    const l = this.names.get(entity);
    if (!l) return null;
    let lo = 0, hi = l.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (compare(l[m].t, t) <= 0) { k = m; lo = m + 1; } else hi = m - 1; }
    return k >= 0 ? l[k].name : null;
  }

  /** Every change of name of something, in time order. */
  namesOf(entity: string): Array<{ t: Instant; name: string }> {
    this.ensure();
    return (this.names.get(entity) ?? []).map(({ t, name }) => ({ t, name }));
  }

  /** A character's waypoints on a map, in time order. */
  characterTrack(spaceId: string, entity: string): Waypoint[] {
    this.ensure();
    return this.tracks.get(spaceId)?.get(entity) ?? [];
  }

  /** The areas, lines or points of a layer as they are at instant t (those that exist then), in the order they were made. */
  featuresAt(layerId: string, t: Instant): FeatureAt[] {
    this.ensure();
    const out: FeatureAt[] = [];
    const byLayer = this.shapes.get(layerId);
    if (!byLayer) return out;
    for (const [feature, steps] of byLayer) {
      let lo = 0, hi = steps.length - 1, k = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (compare(steps[m].t, t) <= 0) { k = m; lo = m + 1; } else hi = m - 1; }
      const st = k >= 0 ? steps[k] : null;
      if (!st?.parts) continue;
      const fa: FeatureAt = { feature, layer: layerId, parts: st.parts, effectId: st.effectId, since: st.t };
      if (st.anim && compare(t, st.anim.end) < 0) {
        const f = Math.max(0, Math.min(1, fraction(st.t, st.anim.end, t)));
        fa.progress = f * f * (3 - 2 * f);
        fa.style = st.anim.style;
        fa.before = k > 0 ? steps[k - 1].parts : null;
      }
      out.push(fa);
    }
    return out;
  }

  /** A feature's shapes over time (null parts: it does not exist from that moment), in time order. */
  featureHistory(featureId: string): ShapeStep[] {
    this.ensure();
    const f = this.world.get('feature', featureId);
    return (f && this.shapes.get(f.layer_id)?.get(featureId)) || [];
  }

  /** Whether a relationship holds at instant t. */
  relationHolds(relationId: string, t: Instant): boolean {
    this.ensure();
    const steps = this.relates.get(relationId);
    if (!steps) return false;
    let k = -1;
    for (let lo = 0, hi = steps.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (compare(steps[m].t, t) <= 0) { k = m; lo = m + 1; } else hi = m - 1; }
    return k >= 0 && steps[k].on;
  }

  /** The relationships that hold at instant t (ids). */
  relationsAt(t: Instant): string[] {
    this.ensure();
    const out: string[] = [];
    for (const id of this.relates.keys()) if (this.relationHolds(id, t)) out.push(id);
    return out;
  }

  /** The periods in which a relationship holds, in time order. */
  relationPeriods(relationId: string): RelationPeriod[] {
    this.ensure();
    const out: RelationPeriod[] = [];
    let open: RelationPeriod | null = null;
    for (const st of this.relates.get(relationId) ?? []) {
      if (st.on && !open) { open = { from: st.t, to: null, fromEffect: st.effectId, toEffect: null }; out.push(open); }
      else if (!st.on && open) { open.to = st.t; open.toEffect = st.effectId; open = null; }
    }
    return out;
  }

  /** A relationship's steps (beginning and ending), in time order. */
  relationSteps(relationId: string): RelateStep[] {
    this.ensure();
    return this.relates.get(relationId) ?? [];
  }

  /** The characters on a map with a track (placed at least once). */
  trackedCharacters(spaceId: string): string[] {
    this.ensure();
    return [...(this.tracks.get(spaceId)?.keys() ?? [])];
  }

  /**
   * Where each character is at instant t: at its last place, or on the way to the next one when it
   * travels there (moving steadily along the shortest path between the two dates). Characters not
   * yet placed, or who have left the map, are not listed.
   */
  charactersAt(spaceId: string, t: Instant): CharacterAt[] {
    this.ensure();
    const out: CharacterAt[] = [];
    for (const [entity, tr] of this.tracks.get(spaceId) ?? []) {
      const at = positionOnTrack(tr, t);
      if (at) out.push({ entity, ...at });
    }
    return out;
  }

  /**
   * Which stretch of time an instant falls in: the number of change instants at or before it.
   * Between two change instants nothing changes hands; only animations in progress move on.
   */
  stretchOf(t: Instant): number {
    this.ensure();
    return this.firstAfter(this.changeTimes, t);
  }

  /**
   * The state of every parcel of a layer at time t; callers must not modify the result. Worked out
   * once per stretch of time between changes: every instant of a stretch shares it, and while
   * changes are animating only the parcels changing hands are worked out again for each instant.
   * A new state is worked out from the one given last wherever that is possible (see derive).
   */
  partitionState(spaceId: string, layerId: string, t: Instant): Map<number, FaceState> {
    this.ensure();
    const arr = this.world.arrangement(spaceId);
    const sk = `${this.compiledRevision}|${arr.revision}|${spaceId}|${layerId}|${this.stretchOf(t)}`;
    let st = this.stretchCache.get(sk);
    if (!st) {
      const derived = Engine.incremental ? this.derive(spaceId, layerId, t, arr) : null;
      if (derived) {
        st = { ...derived, t };
        this.stats.statesDerived++;
        if (Engine.verify) {
          const show = (s: FaceState) => `${s.value}|${s.assignment ? `${s.assignment.effectId}#${s.assignment.entry}` : ''}|${s.transition ? `${s.transition.from}~${s.transition.progress}~${s.transition.prior ? s.transition.prior.effectId : ''}` : ''}`;
          const leaves = arr.leafFaces();
          if (leaves.length !== derived.base.size) Engine.fail(`A state worked out from the one before has ${derived.base.size} parcels; the map has ${leaves.length}.`);
          for (const f of leaves) {
            const got = derived.base.get(f), want = this.faceState(spaceId, layerId, f, t);
            if (!got || show(got) !== show(want)) Engine.fail(`A state worked out from the one before differs from one worked out afresh at parcel ${f}: ${got ? show(got) : 'missing'} against ${show(want)}.`);
          }
        }
      }
      else {
        const base = new Map<number, FaceState>();
        const changing: number[] = [];
        for (const f of arr.leafFaces()) {
          const s = this.faceState(spaceId, layerId, f, t);
          base.set(f, s);
          if (s.transition) changing.push(f);
        }
        st = { base, changing, t };
        this.stats.statesWhole++;
      }
      // (As many states as fit a budget of parcels: a few on a map of a hundred thousand, two dozen on a small one.)
      const room = Math.max(4, Math.min(24, Math.floor(600_000 / Math.max(1, st.base.size))));
      while (this.stretchCache.size >= room) this.stretchCache.delete(this.stretchCache.keys().next().value!);
      this.stretchCache.set(sk, st);
      // The states just worked out are those of this instant.
      if (st.changing.length) this.stateCache.set(`${sk}|${t.day}|${t.ms}`, st.base);
    }
    this.lastState.set(`${spaceId}|${layerId}`, { arr, base: st.base, changing: st.changing, t: st.t, rev: this.compiledRevision, mark: arr.touchMark() });
    if (!st.changing.length) return st.base;
    const key = `${sk}|${t.day}|${t.ms}`;
    const hit = this.stateCache.get(key);
    if (hit) return hit;
    const out = new Map(st.base);
    for (const f of st.changing) out.set(f, this.faceState(spaceId, layerId, f, t));
    this.deltas.set(out, { from: new WeakRef(st.base), changed: st.changing, removed: [] });
    const room = Math.max(3, Math.min(16, Math.floor(400_000 / Math.max(1, out.size))));
    while (this.stateCache.size >= room) this.stateCache.delete(this.stateCache.keys().next().value!);
    this.stateCache.set(key, out);
    return out;
  }

  /**
   * The state of every parcel at t, worked out from the state given last: only the parcels that can
   * differ are worked out again. Those are the parcels (1) whose timeline was changed by an edit since,
   * (2) that are new, or have been split or made whole again since, (3) under a change that takes
   * place or ends between the two moments, and (4) that were changing hands at the earlier moment.
   * Every other parcel has the same latest change at both moments and is in no animation at either.
   * Null when that cannot be told (history was compiled anew, or too much happened in between).
   */
  private derive(spaceId: string, layerId: string, t: Instant, arr: Arrangement): { base: Map<number, FaceState>; changing: number[] } | null {
    const src = this.lastState.get(`${spaceId}|${layerId}`);
    if (!src || src.arr !== arr || src.rev < this.stateLogFrom) return null;
    const touched = arr.touchedSince(src.mark);
    if (!touched) return null;
    const roots: number[] = [];
    for (let i = this.stateLog.length - 1; i >= 0 && this.stateLog[i].rev > src.rev; i--) if (this.stateLog[i].layer === layerId) roots.push(this.stateLog[i].face);
    // Changes taking place or ending after the earlier of the two moments, up to the later.
    const [lo, hi] = compare(src.t, t) <= 0 ? [src.t, t] : [t, src.t];
    const from = this.firstIndexAfter(lo), to = this.firstIndexAfter(hi);
    if (to - from > 4000) return null;
    for (let i = from; i < to; i++) {
      const id = this.timeIndex[i].id;
      if (this.effectLayer.get(id) === layerId) for (const a of this.effectAssignments.get(id)!) roots.push(a.face);
    }
    const again = new Set<number>(src.changing);
    for (const leaf of leafDescendants(arr, roots)) again.add(leaf);
    if (again.size + touched.length > src.base.size / 2 + 64) return null;
    const base = new Map(src.base);
    const removed: number[] = [];
    for (const f of touched) { if (arr.faces.get(f)?.is_leaf) again.add(f); else if (base.delete(f)) removed.push(f); }
    const changed: number[] = [], changing: number[] = [];
    for (const f of again) {
      if (!arr.faces.get(f)?.is_leaf) continue;
      const s = this.faceState(spaceId, layerId, f, t);
      base.set(f, s);
      changed.push(f);
      if (s.transition) changing.push(f);
    }
    changing.sort((x, y) => x - y);
    this.deltas.set(base, { from: new WeakRef(src.base), changed, removed });
    return { base, changing };
  }

  /**
   * How a state given by partitionState differs from the state it was worked out from, when it was
   * worked out so and that state is still around: the parcels worked out again (most of them the
   * same as before) and those no longer there. For keeping what is made from a state up to date.
   */
  stateDelta(states: Map<number, FaceState>): StateDelta | null {
    const d = this.deltas.get(states);
    const from = d?.from.deref();
    return d && from ? { from, changed: d.changed, removed: d.removed } : null;
  }

  /**
   * The parcels changing hands (in an animated change) at instant t: the same throughout a stretch
   * of time. Empty in most stretches.
   */
  partitionChanging(spaceId: string, layerId: string, t: Instant): number[] {
    this.partitionState(spaceId, layerId, t);
    const arr = this.world.arrangement(spaceId);
    return this.stretchCache.get(`${this.compiledRevision}|${arr.revision}|${spaceId}|${layerId}|${this.stretchOf(t)}`)?.changing ?? [];
  }

  /** Fraction (0..1) of a transition's duration after which point p changes hands. */
  arrivalFraction(spec: CompiledTransition, p: Vec3): number {
    if (spec.style === 'fade' || !spec.origin) return 0.5;
    return Math.max(0, Math.min(1, fromNearest(spec, p) / spec.maxDist));
  }

  /** The instant point p changes hands under assignment a. */
  arrivalTime(a: Assignment, p: Vec3): Instant {
    if (!a.transition) return a.t;
    let f = this.arrivalFraction(a.transition, p);
    if (a.transition.easing === 'smooth') f = invSmooth(f);
    return lerp(a.t, a.end, f);
  }

  /** Exact value at a point: accounts for in-progress transitions (later-starting changes take over). */
  valueAtPoint(spaceId: string, layerId: string, p: Vec3, t: Instant, inFace?: number): string | null {
    const arr = this.world.arrangement(spaceId);
    // (The parcel the point lies in, when the caller already knows it.)
    const face = inFace ?? arr.locate(p);
    let a = this.latest(spaceId, layerId, face, t);
    let guard = 0;
    while (a && a.transition && compare(t, a.end) < 0 && compare(this.arrivalTime(a, p), t) > 0 && guard++ < 1000) {
      a = this.latest(spaceId, layerId, face, t, a);
    }
    return a ? a.value : null;
  }

  /** Earliest change after t affecting any of these leaf faces (own or ancestors). */
  nextChange(spaceId: string, layerId: string, faces: Iterable<number>, t: Instant): Instant | null {
    this.ensure();
    const lm = this.timelines.get(layerId);
    const arr = this.world.arrangements.get(spaceId);
    if (!lm || !arr) return null;
    let best: Instant | null = null;
    const seen = new Set<number>();
    for (const leaf of faces) {
      let f: number | null | undefined = leaf;
      while (f !== null && f !== undefined && !seen.has(f)) {
        seen.add(f);
        for (const a of lm.get(f) ?? []) if (compare(a.t, t) > 0 && (!best || compare(a.t, best) < 0)) best = a.t;
        f = arr.faces.get(f)?.parent_id;
      }
    }
    return best;
  }

  /** When the last change up to `t` began (one made over a period begins at its start), or null: the
   * map just before it is the map as it was before that change (comparing dates). */
  lastChangeStart(t: Instant): Instant | null {
    this.ensure();
    let best: Instant | null = null;
    const consider = (x: Instant) => { if (x.day !== -Infinity && compare(x, t) <= 0 && (!best || compare(x, best) > 0)) best = x; };
    for (const times of this.effectTimes.values()) consider(times[0]);
    for (const x of this.pointTimes) consider(x);
    return best;
  }

  /** All instants at which something changes (for timeline markers and stepping). */
  changeInstants(): Instant[] {
    this.ensure();
    return this.changeTimes;
  }

  assignmentsOf(effectId: string): Assignment[] {
    this.ensure();
    return this.effectAssignments.get(effectId) ?? [];
  }

  /** Leaf faces holding `value` just before the given effect takes place (basis for intent-bearing effects). */
  basisFor(ef: EffectRow, value: string): number[] {
    const w = this.world;
    const ev = w.get('event', ef.event_id);
    if (!ev || !ef.space_id || !ef.layer_id) return [];
    const arr = w.arrangement(ef.space_id);
    const probe: Assignment = {
      t: effectTime(ef, ev), end: effectTime(ef, ev), value: null, effectId: ef.id, eventId: ev.id, precedence: isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence,
      eventSeq: ev.created_seq, ordinal: ef.ordinal, entry: -1, face: 0, transition: null,
    };
    const out: number[] = [];
    for (const f of arr.leafFaces()) {
      const a = this.latest(ef.space_id, ef.layer_id, f, probe.t, probe);
      if (a && a.value === value) out.push(f);
    }
    return canonicalFaces(arr, out);
  }

  private detectConflicts(effects: EffectRow[], events: Map<string, EventRow>): void {
    const w = this.world;
    // Simultaneous and overlapping changes on overlapping parcels.
    // (Changes are gone through in their own order, so that the list comes out the same however history was compiled.)
    const inOrder: Array<[string, Assignment[]]> = [];
    for (const ef of effects) { const list = this.effectAssignments.get(ef.id); if (list) inOrder.push([ef.id, list]); }
    const groups = new Map<string, Assignment[]>();
    for (const [, list] of inOrder) for (const a of list) {
      if (a.eventId === BASE_EVENT_ID) continue;
      const k = `${a.t.day}:${a.t.ms}:${a.precedence}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(a);
    }
    const layerOfEffect = new Map(effects.map((e) => [e.id, e]));
    const reported = new Set<string>();
    const leafCache = new Map<string, Set<number>>();
    const leavesOfEffect = (effectId: string): Set<number> => {
      let s = leafCache.get(effectId);
      if (!s) {
        const ef = layerOfEffect.get(effectId)!;
        const arr = w.arrangements.get(ef.space_id!)!;
        s = leafDescendants(arr, (this.effectAssignments.get(effectId) ?? []).map((a) => a.face));
        leafCache.set(effectId, s);
      }
      return s;
    };
    const overlapping = (e1: string, e2: string) => {
      const a = layerOfEffect.get(e1)!, b = layerOfEffect.get(e2)!;
      if (a.layer_id !== b.layer_id) return false;
      const s1 = leavesOfEffect(e1), s2 = leavesOfEffect(e2);
      for (const x of s1) if (s2.has(x)) return true;
      return false;
    };
    for (const g of groups.values()) {
      const byEffect = [...new Set(g.map((a) => a.effectId))];
      for (let i = 0; i < byEffect.length; i++) for (let j = i + 1; j < byEffect.length; j++) {
        const A = layerOfEffect.get(byEffect[i])!, B = layerOfEffect.get(byEffect[j])!;
        if (A.event_id === B.event_id) continue;
        const key = `sim:${A.id}:${B.id}`;
        if (reported.has(key) || !overlapping(A.id, B.id)) continue;
        reported.add(key);
        const nb = events.get(B.event_id)?.name ?? 'another event';
        this.conflictList!.push({ kind: 'simultaneous', effectId: A.id, eventId: A.event_id, otherEventId: B.event_id, message: `Changes the same area at the same moment as "${nb}". The one later in the precedence order wins.` });
      }
    }
    // Overlapping transitions: only pairs that share land are compared (found through a land index).
    const trans = inOrder.filter(([, l]) => l.length && l[0].transition).map(([id, l]) => ({ id, a: l[0] }));
    const transOnLeaf = new Map<string, number[]>();
    trans.forEach((x, i) => {
      const ef = layerOfEffect.get(x.id)!;
      for (const leaf of leavesOfEffect(x.id)) {
        const k = `${ef.layer_id}:${leaf}`;
        const l = transOnLeaf.get(k);
        if (l) l.push(i); else transOnLeaf.set(k, [i]);
      }
    });
    const pairs = new Set<number>();
    for (const l of transOnLeaf.values()) for (let p = 0; p < l.length; p++) for (let q = p + 1; q < l.length; q++) pairs.add(l[p] * trans.length + l[q]);
    for (const key of [...pairs].sort((a, b) => a - b)) {
      const i = Math.floor(key / trans.length), j = key % trans.length;
      const x = trans[i], y = trans[j];
      if (x.a.eventId === y.a.eventId) continue;
      if (compare(x.a.t, y.a.end) >= 0 || compare(y.a.t, x.a.end) >= 0) continue;
      if (!overlapping(x.id, y.id)) continue;
      const [first, second] = orderCmp(x.a, y.a) <= 0 ? [x, y] : [y, x];
      const n1 = events.get(first.a.eventId)?.name ?? 'an earlier event';
      this.conflictList!.push({ kind: 'overlap', effectId: second.id, eventId: second.a.eventId, otherEventId: first.a.eventId, message: `Overlaps "${n1}" in the same area. From its start, this later change takes over the shared area.` });
    }
    // Intentions worked out from an older version of history.
    for (const ef of effects) {
      if (ef.kind !== 'annex') continue;
      const ev = events.get(ef.event_id);
      if (!ev || !this.isActiveEvent(ev)) continue;
      const intent = parseJSON<AnnexIntent | null>(ef.intent, null);
      if (!intent) continue;
      const basis = this.basisFor(ef, intent.from);
      if (hashFaces(basis) !== ef.basis_hash) {
        const who = w.get('entity', intent.from)?.name ?? 'the original owner';
        this.conflictList!.push({ kind: 'stale', effectId: ef.id, eventId: ev.id, message: `This was worked out when ${who} held different territory. Keep it as stored, or re-apply the intention.` });
      }
    }
  }
}

/** Inverse of smoothstep, so arrival times follow an eased front. */
function invSmooth(y: number): number {
  return 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3);
}


/** Where a track puts its character at instant t (null: not on the map). */
export function positionOnTrack(tr: Waypoint[], t: Instant): { lon: number; lat: number; moving: boolean; ahead?: [number, number] } | null {
  // The last waypoint at or before t.
  let lo = 0, hi = tr.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (compare(tr[m].t, t) <= 0) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0 || tr[k].off) return null;
  const a = tr[k], b = tr[k + 1];
  // Which way it last travelled: along the leg it arrived by.
  const prev = tr[k - 1];
  const arrived = prev && !prev.off && a.arrive === 'travel' && prev.t.day !== -Infinity ? aheadOn(prev, a, 1) : undefined;
  const still = (w: Waypoint, ahead: [number, number] | undefined) => (ahead ? { lon: w.lon, lat: w.lat, moving: false, ahead } : { lon: w.lon, lat: w.lat, moving: false });
  if (!b || b.off || b.arrive !== 'travel' || a.t.day === -Infinity) return still(a, arrived);
  const total = diffMs(a.t, b.t), done = diffMs(a.t, t);
  const f = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
  if (f <= 0) return still(a, aheadOn(a, b, 0));
  if (f >= 1) return still(b, aheadOn(a, b, 1));
  const [lon, lat] = slerpLonLat(a.lon, a.lat, b.lon, b.lat, f);
  return { lon, lat, moving: f > 0 && f < 1, ahead: aheadOn(a, b, f) };
}

/** A point a little way (about 5 km) on from the point a fraction f along the way from a to b, past b if need be. */
function aheadOn(a: { lon: number; lat: number }, b: { lon: number; lat: number }, f: number): [number, number] | undefined {
  const ang = angle(lonLatToVec(a.lon, a.lat), lonLatToVec(b.lon, b.lat));
  if (!(ang > 1e-9)) return undefined;
  return slerpLonLat(a.lon, a.lat, b.lon, b.lat, f + Math.min(0.5, (0.05 * Math.PI / 180) / ang));
}

/** The point a fraction f of the way along the shortest path between two places. */
export function slerpLonLat(lon0: number, lat0: number, lon1: number, lat1: number, f: number): [number, number] {
  const p = lonLatToVec(lon0, lat0), q = lonLatToVec(lon1, lat1);
  const ang = angle(p, q);
  if (ang < 1e-12) return [lon0, lat0];
  const s = Math.sin(ang), w0 = Math.sin((1 - f) * ang) / s, w1 = Math.sin(f * ang) / s;
  const x = w0 * p[0] + w1 * q[0], y = w0 * p[1] + w1 * q[1], z = w0 * p[2] + w1 * q[2];
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, z / Math.hypot(x, y, z)))) * 180 / Math.PI];
}
