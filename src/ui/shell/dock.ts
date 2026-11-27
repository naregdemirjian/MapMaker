// Panels that dock (S1 of the studios, D234), as Premiere's do. A page's layout is a tree: groups of panels shown as
// tabs ("stacks"), side by side or one above the other in "splits", plus panels floating over everything. A panel is
// dragged by its tab into another group (it joins its tabs), to an edge of one (the group is split there), or out
// (it floats); groups are resized by the edges between them. Only data and pure functions here: Dock.tsx draws it.
//
// Sizes run along the split a node is in: pixels, or 0 for "takes what is left" (shared equally when several do);
// every split keeps at least one such flexible child, so the layout always fills its room.

export type PanelId = string;
export type Dir = 'row' | 'col';
export interface DockStack { kind: 'stack'; id: string; panels: PanelId[]; active: PanelId; size: number }
export interface DockSplit { kind: 'split'; id: string; dir: Dir; children: DockNode[]; size: number }
export type DockNode = DockStack | DockSplit;
export interface DockFloat { id: string; panels: PanelId[]; active: PanelId; x: number; y: number; w: number; h: number }
export interface DockLayout { root: DockNode; floats: DockFloat[] }
/** Where a panel is dropped on a group: into its tabs, or beside it on one side. */
export type Zone = 'center' | 'left' | 'right' | 'top' | 'bottom';

/** The panel every layout must hold (the map, or the shot's preview): it can be moved but not closed. */
export const VIEWER = 'viewer';
/** The least a group may measure, pixels, across and down. */
export const MIN_W = 120, MIN_H = 60;

let seq = 0;
const newId = (p: string) => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A group of tabs, its first panel shown. */
export const stack = (panels: PanelId[], size = 0, active?: PanelId): DockStack => ({ kind: 'stack', id: newId('s'), panels, active: active ?? panels[0], size });
/** Groups side by side ('row') or one above the other ('col'). */
export const split = (dir: Dir, children: DockNode[], size = 0): DockSplit => ({ kind: 'split', id: newId('d'), dir, children, size });

function* stacks(n: DockNode): Generator<DockStack> {
  if (n.kind === 'stack') yield n;
  else for (const c of n.children) yield* stacks(c);
}

/** Every panel open in a layout: the groups' in order, then the floating ones'. */
export function panelsOf(l: DockLayout): PanelId[] {
  const out: PanelId[] = [];
  for (const s of stacks(l.root)) out.push(...s.panels);
  for (const f of l.floats) out.push(...f.panels);
  return out;
}

/** The panels shown at this moment: the tab in front in each group and each floating window. */
export function visiblePanels(l: DockLayout): PanelId[] {
  return [...[...stacks(l.root)].map((s) => s.active), ...l.floats.map((f) => f.active)];
}

/** Where a panel is: the group or the floating window holding it, if it is open. */
export function holderOf(l: DockLayout, panel: PanelId): DockStack | DockFloat | null {
  for (const s of stacks(l.root)) if (s.panels.includes(panel)) return s;
  return l.floats.find((f) => f.panels.includes(panel)) ?? null;
}

/** A group or a floating window, by its id. */
export function holderById(l: DockLayout, id: string): DockStack | DockFloat | null {
  for (const s of stacks(l.root)) if (s.id === id) return s;
  return l.floats.find((f) => f.id === id) ?? null;
}

const contains = (n: DockNode, panel: PanelId): boolean => (n.kind === 'stack' ? n.panels.includes(panel) : n.children.some((c) => contains(c, panel)));

/** A node with each node under it (itself included) passed through `fn`, children first. */
function mapNode(n: DockNode, fn: (n: DockNode) => DockNode): DockNode {
  return fn(n.kind === 'split' ? { ...n, children: n.children.map((c) => mapNode(c, fn)) } : n);
}

/**
 * A tree put in order: empty groups taken away, a split of one child replaced by that child (taking the split's
 * size), a split inside one of the same direction opened into it, and at least one flexible child in every split
 * (the one holding the viewer, else the last). Null when nothing is left.
 */
export function normalize(n: DockNode): DockNode | null {
  if (n.kind === 'stack') {
    if (!n.panels.length) return null;
    return n.panels.includes(n.active) ? n : { ...n, active: n.panels[0] };
  }
  const kids: DockNode[] = [];
  for (const c of n.children) {
    const k = normalize(c);
    if (!k) continue;
    if (k.kind === 'split' && k.dir === n.dir) kids.push(...k.children);
    else kids.push(k);
  }
  if (!kids.length) return null;
  if (kids.length === 1) return { ...kids[0], size: n.size };
  if (!kids.some((k) => k.size <= 0)) {
    const main = kids.findIndex((k) => contains(k, VIEWER));
    const i = main >= 0 ? main : kids.length - 1;
    kids[i] = { ...kids[i], size: 0 };
  }
  return { ...n, children: kids };
}

function withRoot(l: DockLayout, root: DockNode | null, floats = l.floats): DockLayout {
  if (root) return { root, floats };
  // (Nothing left docked, the viewer floating: the first floating window docks, filling the area.)
  const [first, ...rest] = floats;
  return first ? { root: stack(first.panels, 0, first.active), floats: rest } : { root: stack([VIEWER]), floats };
}

/** A layout without a panel (where it was, the next tab comes to the front; an emptied group or window goes). */
export function removePanel(l: DockLayout, panel: PanelId): DockLayout {
  const drop = (panels: PanelId[], active: PanelId) => {
    const i = panels.indexOf(panel);
    const rest = panels.filter((p) => p !== panel);
    return { panels: rest, active: active === panel ? rest[Math.min(i, rest.length - 1)] ?? '' : active };
  };
  const root = mapNode(l.root, (n) => (n.kind === 'stack' && n.panels.includes(panel) ? { ...n, ...drop(n.panels, n.active) } : n));
  const floats = l.floats.map((f) => (f.panels.includes(panel) ? { ...f, ...drop(f.panels, f.active) } : f)).filter((f) => f.panels.length);
  return withRoot(l, normalize(root), floats);
}

/** A group's (or a floating window's) tab brought to the front. */
export function activate(l: DockLayout, holderId: string, panel: PanelId): DockLayout {
  return {
    root: mapNode(l.root, (n) => (n.kind === 'stack' && n.id === holderId && n.panels.includes(panel) ? { ...n, active: panel } : n)),
    floats: l.floats.map((f) => (f.id === holderId && f.panels.includes(panel) ? { ...f, active: panel } : f)),
  };
}

/**
 * A panel dropped on a group (or a floating window) `targetId`: into its tabs ('center'), or beside it on a side, in
 * a group of its own `newSize` pixels across (or down). Dropped on its own group's side while alone in it: nothing
 * changes. A floating window takes panels into its tabs only.
 */
export function dockPanel(l: DockLayout, panel: PanelId, targetId: string, zone: Zone, newSize = 280): DockLayout {
  const target = holderById(l, targetId);
  if (!target) return l;
  const floating = !('kind' in target);
  if (floating) zone = 'center';
  if (target.panels.includes(panel) && (zone === 'center' || target.panels.length === 1)) return activate(l, targetId, panel);
  const removed = removePanel(l, panel);
  if (zone === 'center') {
    const add = <T extends { id: string; panels: PanelId[]; active: PanelId }>(h: T): T => (h.id === targetId ? { ...h, panels: [...h.panels, panel], active: panel } : h);
    return { root: mapNode(removed.root, (n) => (n.kind === 'stack' ? add(n) : n)), floats: removed.floats.map(add) };
  }
  const dir: Dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const before = zone === 'left' || zone === 'top';
  const fresh = stack([panel], Math.max(1, Math.round(newSize)));
  const place = (n: DockNode): DockNode => {
    if (n.kind === 'stack') return n.id === targetId ? split(dir, before ? [fresh, { ...n, size: 0 }] : [{ ...n, size: 0 }, fresh], n.size) : n;
    const i = n.children.findIndex((c) => c.kind === 'stack' && c.id === targetId);
    if (i >= 0 && n.dir === dir) {
      const kids = [...n.children];
      kids.splice(before ? i : i + 1, 0, fresh);
      return { ...n, children: kids };
    }
    return { ...n, children: n.children.map(place) };
  };
  return withRoot(removed, normalize(place(removed.root)));
}

/** A panel taken out of its place to float, at `rect` (pixels within the area the panels fill). */
export function floatPanel(l: DockLayout, panel: PanelId, rect: { x: number; y: number; w: number; h: number }): DockLayout {
  const removed = removePanel(l, panel);
  return { ...removed, floats: [...removed.floats, { id: newId('f'), panels: [panel], active: panel, ...rect }] };
}

/** A floating window moved or resized. */
export function placeFloat(l: DockLayout, floatId: string, rect: Partial<{ x: number; y: number; w: number; h: number }>): DockLayout {
  return { ...l, floats: l.floats.map((f) => (f.id === floatId ? { ...f, ...rect } : f)) };
}

/**
 * The edge between children `index` and `index + 1` of split `splitId` dragged by `by` pixels (right or down
 * positive), the two measuring `measured` on screen now. A fixed child changes size, a flexible one gives or takes
 * what is left; two flexible ones: the first becomes fixed. Neither is made smaller than its least (`least`; else the
 * least a group may be), nor than it is already when smaller.
 */
export function resizeAt(l: DockLayout, splitId: string, index: number, by: number, measured: [number, number], least?: [number, number]): DockLayout {
  const root = mapNode(l.root, (n) => {
    if (n.kind !== 'split' || n.id !== splitId || index < 0 || index + 1 >= n.children.length) return n;
    const a = n.children[index], b = n.children[index + 1];
    const min = n.dir === 'row' ? MIN_W : MIN_H, [la, lb] = least ?? [min, min];
    const d = Math.max(Math.min(la, measured[0]) - measured[0], Math.min(measured[1] - Math.min(lb, measured[1]), by));
    const kids = [...n.children];
    if (a.size > 0 || b.size <= 0) kids[index] = { ...a, size: Math.round(measured[0] + d) };
    if (b.size > 0) kids[index + 1] = { ...b, size: Math.round(measured[1] - d) };
    return { ...n, children: kids };
  });
  return withRoot(l, normalize(root));
}

/** Where a panel lay in a layout relative to the viewer: the way the split parting them runs, which side, how large. */
function sideOfViewer(l: DockLayout, panel: PanelId): { dir: Dir; before: boolean; size: number } | null {
  let n: DockNode = l.root;
  while (n.kind === 'split') {
    const ip = n.children.findIndex((c) => contains(c, panel)), iv = n.children.findIndex((c) => contains(c, VIEWER));
    if (ip < 0 || iv < 0) return null;
    if (ip !== iv) return { dir: n.dir, before: ip < iv, size: n.children[ip].size };
    n = n.children[ip];
  }
  return null;
}

/**
 * A panel in a group of its own beside the part of the layout holding the viewer, on one side: next to the highest
 * node holding the viewer in a split running that way (or, with none, beside everything).
 */
function besideViewer(l: DockLayout, panel: PanelId, dir: Dir, before: boolean, size: number): DockLayout {
  const fresh = stack([panel], size > 0 ? size : 280);
  let done = false;
  const visit = (n: DockNode): DockNode => {
    if (n.kind === 'stack' || done) return n;
    const i = n.dir === dir ? n.children.findIndex((c) => contains(c, VIEWER)) : -1;
    if (i < 0) return { ...n, children: n.children.map(visit) };
    done = true;
    const kids = [...n.children];
    kids.splice(before ? i : i + 1, 0, fresh);
    return { ...n, children: kids };
  };
  const root = visit(l.root);
  return withRoot(l, normalize(done ? root : split(dir, before ? [fresh, { ...l.root, size: 0 }] : [{ ...l.root, size: 0 }, fresh])));
}

/**
 * A panel opened again: in front where it is, if it is open; else in the group it shares in `original` (the page's
 * first layout) with a panel open now, in its place among them; else in a group of its own on the side of the viewer
 * it was on there; else (not in that layout at all) floating.
 */
export function openPanel(l: DockLayout, panel: PanelId, original: DockLayout): DockLayout {
  const here = holderOf(l, panel);
  if (here) return activate(l, here.id, panel);
  const home = holderOf(original, panel);
  for (const other of home?.panels ?? []) {
    const h = holderOf(l, other);
    if (!h) continue;
    // (Among them in its place as at first: before the first of those after it there that is with them now.)
    const after = home!.panels.slice(home!.panels.indexOf(panel) + 1).find((q) => h.panels.includes(q));
    const panels = [...h.panels];
    panels.splice(after ? panels.indexOf(after) : panels.length, 0, panel);
    const put = <T extends { id: string; panels: PanelId[]; active: PanelId }>(x: T): T => (x.id === h.id ? { ...x, panels, active: panel } : x);
    return { root: mapNode(l.root, (n) => (n.kind === 'stack' ? put(n) : n)), floats: l.floats.map(put) };
  }
  const side = sideOfViewer(original, panel);
  if (side && holderOf(l, VIEWER)) return besideViewer(l, panel, side.dir, side.before, side.size);
  const n = l.floats.length;
  return { ...l, floats: [...l.floats, { id: newId('f'), panels: [panel], active: panel, x: 120 + 24 * n, y: 60 + 24 * n, w: 320, h: 420 }] };
}

/**
 * Whatever was kept, made valid: unknown panels and second copies taken away, sizes made sensible, the tree put in
 * order. Without a required panel (the viewer), or not a layout at all: `fallback`.
 */
export function cleanLayout(raw: unknown, known: (p: PanelId) => boolean, fallback: DockLayout, required: PanelId[] = [VIEWER]): DockLayout {
  const seen = new Set<PanelId>();
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const panelsFrom = (v: unknown): PanelId[] => (Array.isArray(v) ? v : []).filter((p): p is string => typeof p === 'string' && known(p) && !seen.has(p) && !!seen.add(p));
  const id = (v: unknown, p: string) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : newId(p));
  const node = (v: unknown, depth: number): DockNode | null => {
    if (!v || typeof v !== 'object' || depth > 12) return null;
    const r = v as Record<string, unknown>;
    const size = Math.max(0, Math.min(4000, Math.round(num(r.size, 0))));
    if (r.kind === 'stack') {
      const panels = panelsFrom(r.panels);
      return panels.length ? { kind: 'stack', id: id(r.id, 's'), panels, active: panels.includes(r.active as string) ? (r.active as string) : panels[0], size } : null;
    }
    if (r.kind === 'split' && (r.dir === 'row' || r.dir === 'col') && Array.isArray(r.children)) {
      return { kind: 'split', id: id(r.id, 'd'), dir: r.dir, children: r.children.map((c) => node(c, depth + 1)).filter((c): c is DockNode => !!c), size };
    }
    return null;
  };
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  const root = node(r.root, 0);
  const floats: DockFloat[] = [];
  for (const f of Array.isArray(r.floats) ? r.floats : []) {
    if (!f || typeof f !== 'object') continue;
    const v = f as Record<string, unknown>;
    const panels = panelsFrom(v.panels);
    if (!panels.length) continue;
    floats.push({ id: id(v.id, 'f'), panels, active: panels.includes(v.active as string) ? (v.active as string) : panels[0],
      x: Math.round(num(v.x, 80)), y: Math.round(num(v.y, 60)), w: Math.max(MIN_W, Math.round(num(v.w, 320))), h: Math.max(MIN_H, Math.round(num(v.h, 400))) });
  }
  const tidy = root ? normalize(root) : null;
  if (!tidy || required.some((p) => !seen.has(p))) return fallback;
  return { root: tidy, floats };
}

/** The groups whose top edge is the top of the area (under the tool options, which may hang over them). */
export function topStacks(n: DockNode, top = true, out = new Set<string>()): Set<string> {
  if (n.kind === 'stack') { if (top) out.add(n.id); return out; }
  n.children.forEach((c, i) => topStacks(c, top && (n.dir === 'row' || i === 0), out));
  return out;
}

/** Two layouts the same in shape and panels (ids and exact sizes aside, as Save and Reset compare them). */
export function sameShape(a: DockLayout, b: DockLayout): boolean {
  const sig = (n: DockNode): string => (n.kind === 'stack' ? `[${n.panels.join(',')}]` : `${n.dir}(${n.children.map(sig).join(' ')})`);
  return sig(a.root) === sig(b.root) && a.floats.map((f) => f.panels.join(',')).join('|') === b.floats.map((f) => f.panels.join(',')).join('|');
}
