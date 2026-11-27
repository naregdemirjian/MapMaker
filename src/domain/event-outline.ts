// The outline of events (S6, D247): the events of a chapter as a tree, each under the shortest longer event that holds
// it (a battle in a campaign in a war), in order of their start. Pure: the Timeline studio's Outline panel draws it,
// chapter by chapter (the groups of events, as in the table; those in none last).

/** An event as the outline sees it: when it starts and ends, as numbers that compare (days; null: a moment). */
export interface OutlineEvent { id: string; name: string; start: number; end: number | null }
/** An event in the outline, with those it holds. */
export interface OutlineNode { id: string; depth: number; kids: OutlineNode[] }

/**
 * The events as a tree: each under the shortest event that holds it and is longer (events of the same length never
 * hold each other: they stand side by side), each level in order of start (then of name).
 */
export function outline(events: OutlineEvent[]): OutlineNode[] {
  const lo = (e: OutlineEvent) => e.start, hi = (e: OutlineEvent) => e.end ?? e.start, len = (e: OutlineEvent) => hi(e) - lo(e);
  // Longest first, so that whatever could hold an event is placed before it.
  const order = [...events].sort((a, b) => len(b) - len(a) || a.start - b.start || a.name.localeCompare(b.name));
  const nodes = new Map<string, OutlineNode>(), roots: OutlineNode[] = [];
  const placed: OutlineEvent[] = [];
  for (const e of order) {
    let holder: OutlineEvent | null = null;
    for (const c of placed) {
      if (len(c) > len(e) && lo(c) <= lo(e) && hi(e) <= hi(c) && (!holder || len(c) < len(holder))) holder = c;
    }
    const node: OutlineNode = { id: e.id, depth: 0, kids: [] };
    nodes.set(e.id, node);
    placed.push(e);
    if (holder) nodes.get(holder.id)!.kids.push(node);
    else roots.push(node);
  }
  const of = new Map(events.map((e) => [e.id, e]));
  const settle = (list: OutlineNode[], depth: number) => {
    list.sort((x, y) => { const a = of.get(x.id)!, b = of.get(y.id)!; return a.start - b.start || a.name.localeCompare(b.name); });
    for (const n of list) { n.depth = depth; settle(n.kids, depth + 1); }
  };
  settle(roots, 0);
  return roots;
}

/** How many events a node holds, at every depth. */
export function heldCount(n: OutlineNode): number {
  return n.kids.reduce((k, c) => k + 1 + heldCount(c), 0);
}

/**
 * The rows shown: the tree read top to bottom, without what folded events hold; with a filter, only the events it
 * keeps and those that hold them (to show where they lie).
 */
export function visibleRows(roots: OutlineNode[], folded: (id: string) => boolean, keep?: (id: string) => boolean): OutlineNode[] {
  const out: OutlineNode[] = [];
  const wanted = (n: OutlineNode): boolean => !keep || keep(n.id) || n.kids.some(wanted);
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (!wanted(n)) continue;
      out.push(n);
      // (Filtered, what holds a match is opened to show it.)
      if (keep ? n.kids.some(wanted) : !folded(n.id)) walk(n.kids);
    }
  };
  walk(roots);
  return out;
}

/** The event holding another, in the tree (null: at the top). */
export function parentOf(roots: OutlineNode[], id: string): OutlineNode | null {
  const find = (list: OutlineNode[], up: OutlineNode | null): OutlineNode | null | undefined => {
    for (const n of list) {
      if (n.id === id) return up;
      const r = find(n.kids, n);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return find(roots, null) ?? null;
}
