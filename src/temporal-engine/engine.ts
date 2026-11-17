// The temporal engine: compiles events and their effects into per-property timelines and answers
// "what is the world like at time t". Events are the authoritative record; everything here is a
// disposable cache rebuilt from them whenever the world's revision changes.
import { type Instant, compare, NEG_INF, fromStore, lerp, diffMs } from '../core-time/index.ts';
import type { World } from '../world-model/world.ts';
import { BASE_EVENT_ID, type EffectRow, type EventRow } from '../world-model/schema.ts';
import { type Vec3, angle, e7ToVec, lonLatToVec } from '../geo-kernel/vec.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';

/**
 * How a change animates. border ("Advancing front"): from the border with the new owner's existing
 * land; advance ("Expansion"): a circle from an origin; fade; wipe: a straight sweep (old shots only).
 */
export type TransitionStyle = 'instant' | 'border' | 'advance' | 'fade' | 'wipe';
export interface TransitionSpec { style: TransitionStyle; origin?: [number, number]; easing?: 'linear' | 'smooth' }
export interface Resolution { set: Array<[number[], string | null]> }
export interface AnnexIntent { op: 'annex'; from: string; to: string }

export interface CompiledTransition { style: TransitionStyle; origin: Vec3 | null; maxDist: number; easing: 'linear' | 'smooth' | 'in' | 'out'; /** Wipe direction in degrees (shot-level wipes). */ angle?: number; /** Made by a shot's transition settings, not recorded. */ shot?: boolean }

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

/** One compiled waypoint of a character's track. */
export interface Waypoint { t: Instant; lon: number; lat: number; off: boolean; arrive: 'travel' | 'jump'; effectId: string; eventId: string; precedence: number; eventSeq: number; ordinal: number }

/** A character on the map at a moment. */
export interface CharacterAt { entity: string; lon: number; lat: number; moving: boolean }

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

const kidsCache = new WeakMap<Arrangement, { revision: number; map: Map<number, number[]> }>();

/** Children of every face (lineage tree). Cached per map revision; callers must not modify it. */
export function childrenMap(arr: Arrangement): Map<number, number[]> {
  const cached = kidsCache.get(arr);
  if (cached && cached.revision === arr.revision) return cached.map;
  const m = new Map<number, number[]>();
  for (const f of arr.faces.values()) {
    if (f.parent_id === null) continue;
    let l = m.get(f.parent_id);
    if (!l) m.set(f.parent_id, (l = []));
    l.push(f.id);
  }
  kidsCache.set(arr, { revision: arr.revision, map: m });
  return m;
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

export class Engine {
  private compiledRevision = -1;
  private timelines = new Map<string, Map<number, Assignment[]>>();
  /** Characters' tracks: map -> character -> waypoints in time order. */
  private tracks = new Map<string, Map<string, Waypoint[]>>();
  private effectAssignments = new Map<string, Assignment[]>();
  private changeTimes: Instant[] = [];
  private conflictList: Conflict[] = [];
  /** Problems found in the history, always current with the tables. */
  get conflicts(): Conflict[] { this.ensure(); return this.conflictList; }

  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  get revision(): number { this.ensure(); return this.compiledRevision; }

  ensure(): void {
    if (this.compiledRevision !== this.world.revision) this.compile();
  }

  isActiveEvent(ev: EventRow): boolean {
    return !ev.variant_group || ev.variant_active === 1;
  }

  compile(): void {
    const w = this.world;
    this.timelines.clear();
    this.tracks.clear();
    this.effectAssignments.clear();
    this.conflictList = [];
    const events = new Map(w.all('event').map((e) => [e.id, e]));
    const times = new Map<string, Instant>();
    const effects = w.all('effect').sort((a, b) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : 1));
    for (const ef of effects) {
      const ev = events.get(ef.event_id);
      if (!ev) { this.conflictList.push({ kind: 'broken', effectId: ef.id, eventId: ef.event_id, message: 'This change belongs to an event that no longer exists.' }); continue; }
      if (!this.isActiveEvent(ev)) continue;
      if (ef.kind === 'place') {
        const it = parseJSON<PlaceIntent | null>(ef.intent, null);
        if (!it || !ef.space_id || !w.get('map_space', ef.space_id)) { this.conflictList.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: 'This character placement refers to a map that no longer exists.' }); continue; }
        if (!w.get('entity', it.entity)) { this.conflictList.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: 'This placement is of a character who no longer exists.' }); continue; }
        const t = effectTime(ef, ev);
        let bySpace = this.tracks.get(ef.space_id);
        if (!bySpace) this.tracks.set(ef.space_id, (bySpace = new Map()));
        let track = bySpace.get(it.entity);
        if (!track) bySpace.set(it.entity, (track = []));
        track.push({
          t, lon: it.lon ?? 0, lat: it.lat ?? 0, off: !!it.off, arrive: it.arrive ?? 'travel', effectId: ef.id, eventId: ev.id,
          precedence: isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence, eventSeq: ev.created_seq, ordinal: ef.ordinal,
        });
        if (t.day !== -Infinity) times.set(`${t.day}:${t.ms}`, t);
        continue;
      }
      if (ef.kind !== 'assign' && ef.kind !== 'annex') continue;
      const layer = ef.layer_id ? w.get('layer', ef.layer_id) : undefined;
      const arr = ef.space_id ? w.arrangements.get(ef.space_id) : undefined;
      if (!layer || !arr) { this.conflictList.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: 'This change refers to a layer or map that no longer exists.' }); continue; }
      const t = effectTime(ef, ev);
      const spec = parseJSON<TransitionSpec | null>(ef.transition, null);
      const end = eventEnd(ev);
      const hasTransition = spec && spec.style !== 'instant' && end && compare(end, t) > 0;
      const compiled: CompiledTransition | null = hasTransition
        ? { style: spec.style, origin: spec.origin ? lonLatToVec(spec.origin[0], spec.origin[1]) : null, maxDist: 0, easing: spec.easing ?? 'smooth' }
        : null;
      const res = parseJSON<Resolution>(ef.resolution, { set: [] });
      const list: Assignment[] = [];
      res.set.forEach(([faces, given], entry) => {
        let value = given;
        // Land given to a country that no longer exists is nobody's (and reported): it is never drawn
        // as a nameless grey owner.
        if (value && !w.get('entity', value)) { this.conflictList.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: 'This change gives territory to someone who no longer exists.' }); value = null; }
        for (const face of faces) {
          if (!arr.faces.has(face)) { this.conflictList.push({ kind: 'broken', effectId: ef.id, eventId: ev.id, message: `Parcel ${face} no longer exists.` }); continue; }
          const a: Assignment = {
            t, end: compiled ? end! : t, value, effectId: ef.id, eventId: ev.id, precedence: isUntracked(ef) ? UNTRACKED_PRECEDENCE : ev.precedence,
            eventSeq: ev.created_seq, ordinal: ef.ordinal, entry, face, transition: compiled,
          };
          let lm = this.timelines.get(layer.id);
          if (!lm) this.timelines.set(layer.id, (lm = new Map()));
          let tl = lm.get(face);
          if (!tl) lm.set(face, (tl = []));
          tl.push(a);
          list.push(a);
        }
      });
      this.effectAssignments.set(ef.id, list);
      if (compiled && compiled.origin) compiled.maxDist = this.regionMaxDistance(arr, list.map((a) => a.face), compiled.origin);
      if (t.day !== -Infinity) times.set(`${t.day}:${t.ms}`, t);
      if (compiled && end) times.set(`${end.day}:${end.ms}`, end);
    }
    for (const lm of this.timelines.values()) for (const tl of lm.values()) tl.sort(orderCmp);
    for (const bySpace of this.tracks.values()) for (const tr of bySpace.values()) {
      tr.sort((a, b) => compare(a.t, b.t) || a.precedence - b.precedence || a.eventSeq - b.eventSeq || a.ordinal - b.ordinal);
      // Several placements at one moment: the last in order stands.
      for (let i = tr.length - 2; i >= 0; i--) if (compare(tr[i].t, tr[i + 1].t) === 0) tr.splice(i, 1);
    }
    this.changeTimes = [...times.values()].sort(compare);
    this.compiledRevision = w.revision;
    this.detectConflicts(effects, events);
  }

  private regionMaxDistance(arr: Arrangement, faces: number[], origin: Vec3): number {
    let m = 0;
    for (const leaf of leafDescendants(arr, faces)) {
      for (const cyc of arr.faceCycles(leaf)) for (const vid of cyc) {
        const r = arr.vertices.get(vid)!;
        m = Math.max(m, angle(origin, e7ToVec(r.lon, r.lat)));
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

  /** State of every leaf parcel of a partition layer at time t. */
  private stateCache = new Map<string, Map<number, FaceState>>();

  /** The state of every parcel of a layer at time t. Recent answers are reused; callers must not modify the result. */
  /** A character's waypoints on a map, in time order. */
  characterTrack(spaceId: string, entity: string): Waypoint[] {
    this.ensure();
    return this.tracks.get(spaceId)?.get(entity) ?? [];
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

  partitionState(spaceId: string, layerId: string, t: Instant): Map<number, FaceState> {
    this.ensure();
    const arr = this.world.arrangement(spaceId);
    const key = `${this.compiledRevision}|${arr.revision}|${spaceId}|${layerId}|${t.day}|${t.ms}`;
    const hit = this.stateCache.get(key);
    if (hit) return hit;
    const out = new Map<number, FaceState>();
    for (const f of arr.leafFaces()) out.set(f, this.faceState(spaceId, layerId, f, t));
    if (this.stateCache.size >= 16) this.stateCache.delete(this.stateCache.keys().next().value!);
    this.stateCache.set(key, out);
    return out;
  }

  /** Fraction (0..1) of a transition's duration after which point p changes hands. */
  arrivalFraction(spec: CompiledTransition, p: Vec3): number {
    if (spec.style === 'fade' || !spec.origin) return 0.5;
    return Math.max(0, Math.min(1, angle(spec.origin, p) / spec.maxDist));
  }

  /** The instant point p changes hands under assignment a. */
  arrivalTime(a: Assignment, p: Vec3): Instant {
    if (!a.transition) return a.t;
    let f = this.arrivalFraction(a.transition, p);
    if (a.transition.easing === 'smooth') f = invSmooth(f);
    return lerp(a.t, a.end, f);
  }

  /** Exact value at a point: accounts for in-progress transitions (later-starting changes take over). */
  valueAtPoint(spaceId: string, layerId: string, p: Vec3, t: Instant): string | null {
    const arr = this.world.arrangement(spaceId);
    const face = arr.locate(p);
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
    const groups = new Map<string, Assignment[]>();
    for (const list of this.effectAssignments.values()) for (const a of list) {
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
        this.conflictList.push({ kind: 'simultaneous', effectId: A.id, eventId: A.event_id, otherEventId: B.event_id, message: `Changes the same area at the same moment as "${nb}". The one later in the precedence order wins.` });
      }
    }
    // Overlapping transitions: only pairs that share land are compared (found through a land index).
    const trans = [...this.effectAssignments.entries()].filter(([, l]) => l.length && l[0].transition).map(([id, l]) => ({ id, a: l[0] }));
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
      this.conflictList.push({ kind: 'overlap', effectId: second.id, eventId: second.a.eventId, otherEventId: first.a.eventId, message: `Overlaps "${n1}" in the same area. From its start, this later change takes over the shared area.` });
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
        this.conflictList.push({ kind: 'stale', effectId: ef.id, eventId: ev.id, message: `This was worked out when ${who} held different territory. Keep it as stored, or re-apply the intention.` });
      }
    }
  }
}

/** Inverse of smoothstep, so arrival times follow an eased front. */
function invSmooth(y: number): number {
  return 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3);
}


/** Where a track puts its character at instant t (null: not on the map). */
export function positionOnTrack(tr: Waypoint[], t: Instant): { lon: number; lat: number; moving: boolean } | null {
  // The last waypoint at or before t.
  let lo = 0, hi = tr.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (compare(tr[m].t, t) <= 0) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0 || tr[k].off) return null;
  const a = tr[k], b = tr[k + 1];
  if (!b || b.off || b.arrive !== 'travel' || a.t.day === -Infinity) return { lon: a.lon, lat: a.lat, moving: false };
  const total = diffMs(a.t, b.t), done = diffMs(a.t, t);
  const f = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
  if (f <= 0) return { lon: a.lon, lat: a.lat, moving: false };
  if (f >= 1) return { lon: b.lon, lat: b.lat, moving: false };
  const [lon, lat] = slerpLonLat(a.lon, a.lat, b.lon, b.lat, f);
  return { lon, lat, moving: f > 0 && f < 1 };
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
