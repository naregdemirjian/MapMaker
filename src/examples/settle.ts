// Settling a galaxy map's star systems as a race (D180): colony ships go out from systems settled at given years to
// the systems within reach of each, at their speed, and each new colony waits a while before sending ships of its
// own; a system belongs to the lineage whose ships arrive first, and is never settled twice. Ships go only from
// system to system, so realms grow along the arms, where the systems are close together, and meet in borders.
import type { StarCatalogue, Star } from '../space/catalogue.ts';

/** Where a lineage starts, how fast it spreads, and where it may go. */
export interface Seed {
  lineage: string;
  /** Systems settled at `year` (ids of the catalogue). */
  stars: number[]; year: number;
  /** The ships' speed (light-years a year) and the years a new colony takes before it sends ships of its own. */
  speed: number; pause: number;
  /** Systems the lineage may settle (absent: any). */
  only?: (s: Star) => boolean;
  /** No settlement after this year. */
  until?: number;
}

/** A system reached: when, by which lineage, and from which system (null: a seed). */
export interface Arrival { star: number; year: number; lineage: string; from: number | null }

/** Each system's neighbours within `hop` light-years (nearest first), among the catalogue's systems that `use` keeps. */
export function neighbours(cat: StarCatalogue, hop: number, use: (s: Star) => boolean): Map<number, Array<[number, number]>> {
  const list = cat.stars.filter(use);
  const out = new Map<number, Array<[number, number]>>();
  for (const a of list) out.set(a.id, []);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d <= hop) { out.get(a.id)!.push([b.id, d]); out.get(b.id)!.push([a.id, d]); }
    }
  }
  for (const v of out.values()) v.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  return out;
}

/** A binary heap of values by key (the smallest first; equal keys in the order pushed). */
export class Heap<T> {
  private a: Array<[number, number, T]> = [];
  private n = 0;
  get size(): number { return this.a.length; }
  push(key: number, value: T): void {
    const a = this.a;
    a.push([key, this.n++, value]);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!before(a[i], a[p])) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop(): [number, T] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && before(a[l], a[m])) m = l;
        if (r < a.length && before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return [top[0], top[2]];
  }
}
const before = (p: [number, number, unknown], q: [number, number, unknown]) => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);

/**
 * The race up to year `end`: every system reached, when, by which lineage and from where. `taken` systems are never
 * settled (held already, or not to be reached).
 */
export function race(cat: StarCatalogue, graph: Map<number, Array<[number, number]>>, seeds: Seed[], end: number, taken: ReadonlySet<number> = new Set()): Map<number, Arrival> {
  const out = new Map<number, Arrival>();
  const heap = new Heap<{ star: number; seed: Seed; from: number | null }>();
  for (const s of seeds) for (const star of s.stars) if (s.year <= end) heap.push(s.year, { star, seed: s, from: null });
  for (let next = heap.pop(); next; next = heap.pop()) {
    const [year, { star, seed, from }] = next;
    if (out.has(star) || taken.has(star)) continue;
    out.set(star, { star, year, lineage: seed.lineage, from });
    const ready = year + seed.pause, limit = Math.min(end, seed.until ?? Infinity);
    for (const [n, d] of graph.get(star) ?? []) {
      if (out.has(n) || taken.has(n)) continue;
      const st = cat.byId.get(n);
      if (!st || (seed.only && !seed.only(st))) continue;
      const at = ready + d / seed.speed;
      if (at <= limit) heap.push(at, { star: n, seed, from: star });
    }
  }
  return out;
}
