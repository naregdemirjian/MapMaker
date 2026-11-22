// The timeline's tracks (D201). Events come first: each group of events has a track of its own, its events
// packed in lanes; a track can be folded to a thin line showing only where its events lie. Where a track's
// events would not fit a few lanes (zoomed far out over hundreds of them) they are first drawn without their
// names, and then run together into blocks that say how many they hold. All measures are pixels.

export interface TLEvent { id: string; x0: number; x1: number; labelW: number; track: string }
export interface TLBar {
  /** The event, or the events run together (a block). */
  ids: string[];
  x0: number; x1: number; lane: number;
  /** Whether its name is drawn beside it (there is room). */
  label: boolean;
  /** How far a click counts as on it (the bar and its name). */
  hit1: number;
}
export interface TLTrack { id: string; y: number; height: number; folded: boolean; bars: TLBar[]; marks: number[]; count: number }

export const LANE = 20, BAR = 14, FOLDED = 12, TRACK_PAD = 5, MAX_LANES = 6, MIN_BAR = 8;

function pack(items: Array<{ ids: string[]; x0: number; x1: number; extent: number; label: boolean }>): { bars: TLBar[]; lanes: number } {
  const ends: number[] = [], bars: TLBar[] = [];
  for (const it of items) {
    let lane = ends.findIndex((e) => e < it.x0 - 4);
    if (lane === -1) { lane = ends.length; ends.push(0); }
    ends[lane] = it.extent;
    bars.push({ ids: it.ids, x0: it.x0, x1: it.x1, lane, label: it.label, hit1: it.extent });
  }
  return { bars, lanes: ends.length };
}

/** One track's events in lanes: with their names, else without, else run together. */
export function layoutTrack(events: TLEvent[], maxLanes = MAX_LANES): { bars: TLBar[]; lanes: number } {
  const evs = [...events].sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1).map((e) => ({ ...e, x1: Math.max(e.x1, e.x0 + MIN_BAR) }));
  const named = pack(evs.map((e) => ({ ids: [e.id], x0: e.x0, x1: e.x1, extent: Math.max(e.x1, e.x0 + e.labelW + 12), label: true })));
  if (named.lanes <= maxLanes) return named;
  const bare = pack(evs.map((e) => ({ ids: [e.id], x0: e.x0, x1: e.x1, extent: e.x1, label: false })));
  if (bare.lanes <= maxLanes) {
    // A name is drawn where the next bar of its lane leaves it room.
    const byLane = new Map<number, TLBar[]>();
    for (const b of bare.bars) { const l = byLane.get(b.lane); if (l) l.push(b); else byLane.set(b.lane, [b]); }
    const width = new Map(evs.map((e) => [e.id, e.labelW]));
    for (const lane of byLane.values()) lane.forEach((b, i) => {
      const room = (lane[i + 1]?.x0 ?? Infinity) - 4, want = b.x1 + (width.get(b.ids[0]) ?? 0) + 8;
      if (want <= room) { b.label = true; b.hit1 = want; }
    });
    return bare;
  }
  // Run together: events that touch or nearly touch become one block.
  const blocks: Array<{ ids: string[]; x0: number; x1: number }> = [];
  for (const e of evs) {
    const last = blocks[blocks.length - 1];
    if (last && e.x0 <= last.x1 + 6) { last.ids.push(e.id); last.x1 = Math.max(last.x1, e.x1); } else blocks.push({ ids: [e.id], x0: e.x0, x1: e.x1 });
  }
  return { bars: blocks.map((b) => ({ ids: b.ids, x0: b.x0, x1: b.x1, lane: 0, label: false, hit1: b.x1 })), lanes: 1 };
}

/** The tracks one under another from `top`: where each lies and what it holds. Returns them and the height of them all. */
export function layoutTracks(events: TLEvent[], tracks: Array<{ id: string; folded: boolean }>, top = 0): { tracks: TLTrack[]; height: number } {
  const by = new Map<string, TLEvent[]>();
  for (const e of events) { const l = by.get(e.track); if (l) l.push(e); else by.set(e.track, [e]); }
  const out: TLTrack[] = [];
  let y = top;
  for (const t of tracks) {
    const evs = by.get(t.id) ?? [];
    if (t.folded) {
      out.push({ id: t.id, y, height: FOLDED, folded: true, bars: [], marks: evs.map((e) => e.x0).sort((a, b) => a - b), count: evs.length });
      y += FOLDED;
      continue;
    }
    const { bars, lanes } = layoutTrack(evs);
    const height = Math.max(1, lanes) * LANE + TRACK_PAD;
    out.push({ id: t.id, y, height, folded: false, bars, marks: [], count: evs.length });
    y += height;
  }
  return { tracks: out, height: y - top };
}

/** The bar at a place, if any. */
export function barAt(tracks: TLTrack[], x: number, y: number): { track: TLTrack; bar: TLBar } | null {
  for (const t of tracks) {
    if (t.folded || y < t.y || y >= t.y + t.height) continue;
    for (const b of t.bars) {
      const by = t.y + 3 + b.lane * LANE;
      if (y >= by && y <= by + BAR && x >= b.x0 && x <= b.hit1) return { track: t, bar: b };
    }
  }
  return null;
}

/** A value drawn to the nearest of some values (in order) when within `tolerance` of it; else as it is. */
export function snap(value: number, sorted: number[], tolerance: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
  let best = value, d = tolerance;
  for (const c of [sorted[lo - 1], sorted[lo]]) if (c !== undefined && Math.abs(c - value) <= d) { best = c; d = Math.abs(c - value); }
  return best;
}
