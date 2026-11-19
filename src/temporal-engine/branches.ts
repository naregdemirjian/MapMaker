// Branches: alternative timelines (Stage 13, D150). A branch splits from the main timeline (or from another
// branch) at a moment. Its history is its parent's up to and including that moment, live: an event of the
// parent changed or added before then is changed or added in the branch too. After it, the branch has its own
// events. Nothing is copied: like the alternative versions of an event, a branch only chooses which changes
// the compiler includes.
//
// What a branch includes, for each timeline it descends from: that timeline's changes up to the moment the
// path down to the branch first leaves it (the earliest split on the way, since a branch can split from its
// parent before the parent split from its own). Its own changes are all included, whatever their date.
import { type Instant, compare, fromStore, NEG_INF } from '../core-time/index.ts';
import { MAIN_BRANCH, isBaseEvent, type BranchRow, type EventRow } from '../world-model/schema.ts';
import type { World } from '../world-model/world.ts';

/** The moment a branch splits off (the main timeline never does). */
export function branchStart(b: BranchRow): Instant {
  return fromStore(b.from_day, b.from_ms);
}

/** The branch and the timelines it descends from, nearest first, ending with the main timeline. An unknown branch is the main timeline. */
export function branchLine(world: World, branch: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let id = branch;
  // (A loop of parents cannot be made by the commands; a broken file is read as if the loop went back to the main timeline.)
  while (id !== MAIN_BRANCH && !seen.has(id)) {
    const row = world.get('branch', id);
    if (!row) break;
    out.push(id);
    seen.add(id);
    id = row.parent_id;
  }
  out.push(MAIN_BRANCH);
  return out;
}

/**
 * What a branch includes: each timeline it descends from (and itself), with the last moment of that timeline's
 * own that is part of the branch's history (null: all of it).
 */
export function branchCuts(world: World, branch: string): Map<string, Instant | null> {
  const line = branchLine(world, branch);
  const cuts = new Map<string, Instant | null>();
  let cut: Instant | null = null;
  for (let i = 0; i < line.length; i++) {
    cuts.set(line[i], cut);
    const row = world.get('branch', line[i]);
    if (row) { const at = branchStart(row); if (!cut || compare(at, cut) < 0) cut = at; }
  }
  return cuts;
}

/** Whether a change at `t` of an event of the timeline `owner` is part of the history with these cuts. */
export function seenAt(cuts: Map<string, Instant | null>, owner: string, t: Instant): boolean {
  if (!cuts.has(owner)) return false;
  const cut = cuts.get(owner)!;
  return cut === null || compare(t, cut) <= 0;
}

/** The moment an event is listed at: its start (the starting map and branches' own changes without an event: the beginning). */
function listedAt(ev: EventRow): Instant {
  return isBaseEvent(ev.id) ? NEG_INF : fromStore(ev.start_day, ev.start_ms);
}

/** Whether an event is in the history with these cuts: one of its timeline's own, or begun by the time the branch left that timeline. */
export function eventSeen(cuts: Map<string, Instant | null>, ev: EventRow): boolean {
  return seenAt(cuts, ev.branch_id || MAIN_BRANCH, listedAt(ev));
}

/**
 * Which timeline something drawn or recorded at `t` while viewing `branch` belongs to: the branch itself from the
 * moment it split off; before that, the history it shares with its parent (and so on up), so that fixing early
 * history fixes every branch that shares it.
 */
export function branchAt(world: World, branch: string, t: Instant): string {
  let id = branch;
  const seen = new Set<string>();
  while (id !== MAIN_BRANCH && !seen.has(id)) {
    const row = world.get('branch', id);
    if (!row) return MAIN_BRANCH;
    if (compare(t, branchStart(row)) >= 0) return id;
    seen.add(id);
    id = row.parent_id;
  }
  return MAIN_BRANCH;
}

/** A branch's name ("Main timeline" for the main one). */
export function branchName(world: World, branch: string): string {
  return branch === MAIN_BRANCH ? 'Main timeline' : world.get('branch', branch)?.name ?? 'Main timeline';
}

/** Every branch with how deep it lies (the main timeline first, at 0; each branch under the one it split from, in order of the moment it split). */
export function branchTree(world: World): Array<{ id: string; depth: number; row: BranchRow | null }> {
  const rows = world.all('branch');
  const kids = new Map<string, BranchRow[]>();
  for (const r of rows) {
    const parent = r.parent_id === MAIN_BRANCH || world.get('branch', r.parent_id) ? r.parent_id : MAIN_BRANCH;
    const l = kids.get(parent);
    if (l) l.push(r); else kids.set(parent, [r]);
  }
  for (const l of kids.values()) l.sort((a, b) => a.from_day - b.from_day || a.from_ms - b.from_ms || a.created_seq - b.created_seq);
  const out: Array<{ id: string; depth: number; row: BranchRow | null }> = [{ id: MAIN_BRANCH, depth: 0, row: null }];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    for (const r of kids.get(id) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, depth, row: r });
      walk(r.id, depth + 1);
    }
  };
  walk(MAIN_BRANCH, 1);
  return out;
}

/** A branch and every branch that splits from it, at any depth. */
export function branchAndBelow(world: World, branch: string): Set<string> {
  const out = new Set<string>([branch]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of world.all('branch')) if (!out.has(r.id) && out.has(r.parent_id)) { out.add(r.id); grew = true; }
  }
  return out;
}
