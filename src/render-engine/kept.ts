// Things kept for reuse, up to a total weight rather than a number of entries: an outline of a few
// points and one of a hundred thousand are not the same burden. What was used longest ago is
// forgotten first. (On a project with large countries, caches limited by count alone grew to
// gigabytes.)

export class Kept<K, V> {
  private readonly map = new Map<K, { v: V; w: number }>();
  private total = 0;
  private readonly limit: number;
  private readonly weigh: (v: V) => number;

  /** `limit`: the total weight kept; `weigh`: the weight of one value (its number of points, say). */
  constructor(limit: number, weigh: (v: V) => number) {
    this.limit = limit;
    this.weigh = weigh;
  }

  /** The value kept under a key (which then counts as just used), or undefined. */
  get(k: K): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }

  has(k: K): boolean { return this.map.has(k); }

  set(k: K, v: V): void {
    const old = this.map.get(k);
    if (old) { this.total -= old.w; this.map.delete(k); }
    const w = this.weigh(v);
    this.map.set(k, { v, w });
    this.total += w;
    // The newest always stays, however heavy.
    for (const [k0, e0] of this.map) {
      if (this.total <= this.limit || this.map.size <= 1) break;
      this.map.delete(k0);
      this.total -= e0.w;
    }
  }

  delete(k: K): void {
    const e = this.map.get(k);
    if (e) { this.total -= e.w; this.map.delete(k); }
  }

  clear(): void { this.map.clear(); this.total = 0; }
  get size(): number { return this.map.size; }
  get weight(): number { return this.total; }
}
