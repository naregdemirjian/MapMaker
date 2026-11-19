// Branches: alternative timelines (Stage 13, D150). A branch splits from the main timeline (or another branch)
// at a moment, inherits everything before it live, and holds its own later events. Tested: what each timeline
// holds before and after the split, early history fixed once for every branch sharing it, edits put in the
// right timeline (events, changes without an event, recordings into events), the moment of the split itself,
// branches of branches split earlier than their parent, alternative versions inside branches, deleting a
// branch with what came from it, undo, saving and reading back, and history followed change by change in a
// branch against history compiled afresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import { branchAt, branchCuts, branchLine, branchTree, eventSeen } from '../src/temporal-engine/branches.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF, type Instant } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { BASE_EVENT_ID, MAIN_BRANCH, baseEventOf, invertDiffs, type RowDiff } from '../src/world-model/schema.ts';
import { ring, square, rng } from './helpers.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });
/** A snapshot with each table's rows in order of their key (rows put back by an undo come back at the end). */
const tidy = (snap: Record<string, unknown[] | undefined>) => Object.fromEntries(Object.entries(snap).map(([t, rows]) => [t, [...(rows ?? [])].map((r) => JSON.stringify(r)).sort()]));

function setup() {
  const world = new World();
  const { result } = cmd.seedProject(world, 'Branches');
  const spaceId = result.spaceId;
  const layerId = world.all('layer').find((l) => l.space_id === spaceId)!.id;
  const main = new Engine(world);
  const engines = new Map<string, Engine>([[MAIN_BRANCH, main]]);
  const engineOf = (b: string) => { let e = engines.get(b); if (!e) engines.set(b, (e = new Engine(world, b))); return e; };
  const ent = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result;
  const event = (name: string, start: Instant, end: Instant | null = null) => cmd.createEvent(world, { name, start, end }).result;
  // Drawing is done in the branch being viewed (world.branch), with its engine, as the interface does.
  const paint = (pts: Array<[number, number]>, value: string | null, eventId: string, at: Instant | null = null) =>
    cmd.paintTerritory(world, engineOf(world.branch), { spaceId, layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'new', eventId, at } });
  const change = (pts: Array<[number, number]>, value: string | null, t: Instant) =>
    cmd.paintTerritory(world, engineOf(world.branch), { spaceId, layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'change', t } });
  const at = (b: string, lon: number, lat: number, t: Instant) => engineOf(b).valueAtPoint(spaceId, layerId, lonLatToVec(lon, lat), t);
  return { world, spaceId, layerId, main, engineOf, ent, event, paint, change, at };
}

/** A small history on the main timeline: A holds the land from the start; B takes the east in 1900, C the west in 1950. */
function history() {
  const s = setup();
  const A = s.ent('Arland'), B = s.ent('Boria'), C = s.ent('Cazia'), D = s.ent('Dorn');
  cmd.paintTerritory(s.world, s.main, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(square(10, 45, 10)), value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const e1900 = s.event('Boria takes the east', Y(1900));
  s.paint([[10, 35], [20, 35], [20, 55], [10, 55]], B, e1900);
  const e1950 = s.event('Cazia takes the west', Y(1950));
  s.paint([[0, 35], [10, 35], [10, 55], [0, 55]], C, e1950);
  return { ...s, A, B, C, D, e1900, e1950 };
}

test('a branch holds its parent\'s history up to the split, live, and its own after it; the main timeline never sees the branch', () => {
  const s = history();
  const br = cmd.createBranch(s.world, { name: 'Arland holds', from: Y(1940) }).result;
  assert.equal(s.world.get('branch', br)!.parent_id, MAIN_BRANCH);
  assert.ok(s.world.get('event', baseEventOf(br)), 'a place for its changes without an event');
  // Before the split the two are the same; after it, the branch has none of the main timeline's later changes.
  assert.deepEqual([s.at(br, 15, 45, Y(1920)), s.at(br, 5, 45, Y(1920))], [s.B, s.A]);
  assert.deepEqual([s.at(MAIN_BRANCH, 5, 45, Y(1960)), s.at(br, 5, 45, Y(1960))], [s.C, s.A]);
  // Its own event: in the branch only.
  s.world.branch = br;
  const own = s.event('Dorn rises in the west', Y(1945));
  assert.equal(s.world.get('event', own)!.branch_id, br);
  s.paint([[2, 40], [8, 40], [8, 50], [2, 50]], s.D, own);
  assert.equal(s.at(br, 5, 45, Y(1946)), s.D);
  assert.equal(s.at(MAIN_BRANCH, 5, 45, Y(1946)), s.A);
  assert.equal(s.at(MAIN_BRANCH, 5, 45, Y(1960)), s.C);
  // Early history fixed once is fixed for both: the 1900 event moved to 1910, still before the split.
  s.world.branch = MAIN_BRANCH;
  cmd.updateEvent(s.world, s.e1900, { start: Y(1910) });
  for (const b of [MAIN_BRANCH, br]) assert.deepEqual([s.at(b, 15, 45, Y(1905)), s.at(b, 15, 45, Y(1915))], [s.A, s.B], b);
  // An event added to the main timeline before the split appears in the branch; one after it does not.
  const early = s.event('Arland retakes the north-east', Y(1930));
  s.paint([[15, 50], [20, 50], [20, 55], [15, 55]], s.A, early);
  const late = s.event('Boria falls', Y(1945));
  s.paint([[10, 35], [20, 35], [20, 55], [10, 55]], s.C, late);
  assert.equal(s.at(br, 17, 52, Y(1935)), s.A);
  assert.deepEqual([s.at(MAIN_BRANCH, 15, 40, Y(1946)), s.at(br, 15, 40, Y(1946))], [s.C, s.B]);
  // Events listed in each: the branch's own and those begun by the split.
  const listed = (b: string) => s.world.all('event').filter((e) => s.engineOf(b).lists(e) && e.id !== BASE_EVENT_ID && e.id !== baseEventOf(br)).map((e) => e.name).sort();
  assert.deepEqual(listed(br), ['Arland retakes the north-east', 'Boria takes the east', 'Dorn rises in the west']);
  assert.deepEqual(listed(MAIN_BRANCH), ['Arland retakes the north-east', 'Boria falls', 'Boria takes the east', 'Cazia takes the west']);
  // The engines' revisions differ, so pictures kept for one are never taken for the other's.
  assert.notEqual(s.engineOf(br).revision, s.main.revision);
  assert.deepEqual(s.main.conflicts, []);
  assert.deepEqual(s.engineOf(br).conflicts, []);
});

test('edits made while viewing a branch go where their date belongs: the branch from the split on, the shared history before it', () => {
  const s = history();
  const br = cmd.createBranch(s.world, { name: 'Peace', from: Y(1940) }).result;
  s.world.branch = br;
  // Events: by their start.
  const after = s.event('Treaty of the Branch', Y(1941));
  const before = s.event('A fix to early history', Y(1920));
  assert.equal(s.world.get('event', after)!.branch_id, br);
  assert.equal(s.world.get('event', before)!.branch_id, MAIN_BRANCH);
  // Changes without an event: after the split in the branch's own place for them, before it in the starting map's.
  s.change([[2, 40], [8, 40], [8, 50], [2, 50]], s.D, Y(1942));
  s.change([[16, 50], [19, 50], [19, 54], [16, 54]], s.D, Y(1925));
  assert.equal(s.world.all('effect').filter((f) => f.event_id === baseEventOf(br)).length, 1);
  assert.deepEqual([s.at(br, 5, 45, Y(1943)), s.at(MAIN_BRANCH, 5, 45, Y(1943))], [s.D, s.A]);
  assert.deepEqual([s.at(br, 17, 52, Y(1930)), s.at(MAIN_BRANCH, 17, 52, Y(1930))], [s.D, s.D], 'fixed in both');
  // Recording into an event of the shared history after the split is refused (it would not be in the branch);
  // into the branch's own events, or before the split, it is fine.
  assert.throws(() => s.paint([[12, 40], [14, 40], [14, 42], [12, 42]], s.D, s.e1900, Y(1945)), /shares with Main timeline/);
  s.paint([[12, 40], [14, 40], [14, 42], [12, 42]], s.D, s.e1900, Y(1930));
  s.paint([[12, 44], [14, 44], [14, 46], [12, 46]], s.D, after);
  assert.deepEqual([s.at(br, 13, 41, Y(1931)), s.at(MAIN_BRANCH, 13, 41, Y(1931))], [s.D, s.D]);
  // Viewing the main timeline, the branch's events take no changes.
  s.world.branch = MAIN_BRANCH;
  assert.throws(() => s.paint([[12, 48], [14, 48], [14, 50], [12, 50]], s.D, after), /an event of Peace, not of Main timeline/);
  // Names and relationships (changes of other kinds) follow the same rule.
  s.world.branch = br;
  cmd.renameFrom(s.world, { entity: s.A, name: 'Free Arland', mode: { kind: 'change', t: Y(1944) } });
  assert.equal(s.engineOf(br).nameAt(s.A, Y(1945)), 'Free Arland');
  assert.equal(s.main.nameAt(s.A, Y(1945)), null, 'its own name in the main timeline');
  const war = cmd.relate(s.world, { kind: 'war', a: s.B, b: s.C, mode: { kind: 'change', t: Y(1941) } }).result;
  assert.deepEqual([s.engineOf(br).relationHolds(war, Y(1942)), s.main.relationHolds(war, Y(1942))], [true, false]);
});

test('the moment of the split is shared; a branch of a branch split earlier than its parent shares only the earlier history', () => {
  const s = history();
  // The main timeline's change at exactly 1950 is part of a branch split at 1950; the branch's own change at
  // that moment is its own, and wins.
  const at50 = cmd.createBranch(s.world, { name: 'From 1950', from: Y(1950) }).result;
  assert.equal(s.at(at50, 5, 45, Y(1950)), s.C, 'the parent\'s change at the moment of the split');
  s.world.branch = at50;
  assert.equal(branchAt(s.world, at50, Y(1950)), at50);
  assert.equal(branchAt(s.world, at50, Y(1949, 12, 31)), MAIN_BRANCH);
  s.change([[2, 40], [8, 40], [8, 50], [2, 50]], s.D, Y(1950));
  assert.deepEqual([s.at(at50, 5, 45, Y(1950)), s.at(MAIN_BRANCH, 5, 45, Y(1950))], [s.D, s.C]);
  // A branch of it, split at 1920 (before its parent split from the main timeline at 1950).
  const deep = cmd.createBranch(s.world, { name: 'Earlier still', from: Y(1920) }).result;
  assert.equal(s.world.get('branch', deep)!.parent_id, at50, 'from the branch being viewed');
  assert.deepEqual(branchLine(s.world, deep), [deep, at50, MAIN_BRANCH]);
  const cuts = branchCuts(s.world, deep);
  assert.equal(cuts.get(deep), null);
  assert.deepEqual(cuts.get(at50), Y(1920));
  assert.deepEqual(cuts.get(MAIN_BRANCH), Y(1920));
  assert.deepEqual([s.at(deep, 15, 45, Y(1915)), s.at(deep, 5, 45, Y(1960))], [s.B, s.A]);
  // Something drawn while viewing it at 1910 is shared by all three; at 1930, its own.
  s.world.branch = deep;
  assert.equal(branchAt(s.world, deep, Y(1910)), MAIN_BRANCH);
  assert.equal(branchAt(s.world, deep, Y(1930)), deep);
  // The tree in order, with depth.
  assert.deepEqual(branchTree(s.world).map((x) => `${x.depth}:${x.id === MAIN_BRANCH ? 'main' : s.world.get('branch', x.id)!.name}`), ['0:main', '1:From 1950', '2:Earlier still']);
  // Moving a branch's split moves what it shares, live.
  cmd.updateBranch(s.world, at50, { from: Y(1890) });
  assert.equal(s.at(at50, 15, 45, Y(1960)), s.A, 'the 1900 change is now after the split');
  assert.throws(() => cmd.createBranch(s.world, { name: 'from 1950', from: Y(1800) }), /already a branch/);
  assert.throws(() => cmd.createBranch(s.world, { name: 'Main timeline', from: Y(1800) }), /already a branch/);
  assert.throws(() => cmd.createBranch(s.world, { name: ' ', from: Y(1800) }), /name/);
  assert.throws(() => cmd.createBranch(s.world, { name: 'Never', from: NEG_INF }), /date/);
});

test('alternative versions inside branches; deleting a branch with the branches from it and their events; undo', () => {
  const s = history();
  const br = cmd.createBranch(s.world, { name: 'Alt', from: Y(1940) }).result;
  s.world.branch = br;
  const own = s.event('Dorn rises', Y(1945));
  s.paint([[2, 40], [8, 40], [8, 50], [2, 50]], s.D, own);
  // An alternative version of the branch's own event, chosen within the branch.
  const v2 = cmd.createVariant(s.world, own, 'Dorn rises further').result;
  assert.equal(s.world.get('event', v2)!.branch_id, br);
  assert.equal(s.at(br, 5, 45, Y(1946)), s.D);
  // The main timeline's choice between versions of a shared event holds in the branch too (it is shared history).
  s.world.branch = MAIN_BRANCH;
  const v1900 = cmd.createVariant(s.world, s.e1900, 'Boria takes nothing').result;
  for (const ef of s.world.all('effect').filter((f) => f.event_id === v1900)) cmd.deleteEffect(s.world, ef.id);
  assert.deepEqual([s.at(MAIN_BRANCH, 15, 45, Y(1920)), s.at(br, 15, 45, Y(1920))], [s.A, s.A]);
  cmd.activateVariant(s.world, s.e1900);
  assert.deepEqual([s.at(MAIN_BRANCH, 15, 45, Y(1920)), s.at(br, 15, 45, Y(1920))], [s.B, s.B]);
  // A branch of the branch, then the first deleted with it: their events and changes go, the shared history stays.
  s.world.branch = br;
  const sub = cmd.createBranch(s.world, { name: 'Sub', from: Y(1947) }).result;
  s.world.branch = sub;
  const subEv = s.event('Sub event', Y(1948));
  s.paint([[12, 40], [14, 40], [14, 42], [12, 42]], s.C, subEv);
  s.world.branch = MAIN_BRANCH;
  const before = tidy(s.world.snapshot());
  const del = cmd.deleteBranch(s.world, br);
  assert.equal(del.result, 3, 'three events of its own and its branch\'s');
  assert.match(del.label, /and the 1 branch from it/);
  assert.equal(s.world.all('branch').length, 0);
  assert.ok(!s.world.all('event').some((e) => e.branch_id !== MAIN_BRANCH));
  assert.ok(s.world.get('event', s.e1900) && s.world.get('event', BASE_EVENT_ID));
  assert.equal(s.at(MAIN_BRANCH, 15, 45, Y(1960)), s.B);
  // An engine of a branch that is gone shows the main timeline.
  assert.equal(s.at(sub, 5, 45, Y(1960)), s.C);
  // Undo brings everything back.
  s.world.applyDiffs(invertDiffs(del.diffs));
  assert.deepEqual(tidy(s.world.snapshot()), before);
  assert.deepEqual([s.at(br, 5, 45, Y(1946)), s.at(sub, 13, 41, Y(1949)), s.at(MAIN_BRANCH, 13, 41, Y(1949))], [s.D, s.C, s.B]);
  assert.throws(() => cmd.deleteBranch(s.world, 'br_nothing'), /no longer exists/);
});

test('branches are saved and read back; history followed change by change in a branch equals history compiled afresh', () => {
  const s = history();
  const br = cmd.createBranch(s.world, { name: 'Saved', from: Y(1940), color: '#123456', notes: 'What if' }).result;
  const copy = World.fromSnapshot(s.world.snapshot());
  assert.deepEqual(copy.get('branch', br), s.world.get('branch', br));
  // Random edits in both timelines, with the engines checking every step they follow against a fresh compile.
  Engine.verify = true;
  Engine.verifyFailures = [];
  try {
    const g = rng(150), r = () => g.next();
    const owners = [s.A, s.B, s.C, s.D, null];
    const events: string[] = [s.e1900, s.e1950];
    const log: RowDiff[][] = [];
    for (let i = 0; i < 40; i++) {
      s.world.branch = r() < 0.6 ? br : MAIN_BRANCH;
      const year = 1880 + Math.floor(r() * 120);
      const x = r() * 18, y = 36 + r() * 16, w = 1 + r() * 3;
      const sq: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];
      const value = owners[Math.floor(r() * owners.length)];
      const pick = r();
      try {
        if (pick < 0.3) { const e = s.event(`Event ${i}`, Y(year)); events.push(e); log.push(s.paint(sq, value, e).diffs); }
        else if (pick < 0.55) log.push(s.change(sq, value, Y(year)).diffs);
        else if (pick < 0.75 && events.length) {
          const e = events[Math.floor(r() * events.length)];
          if (s.world.get('event', e)) log.push(cmd.updateEvent(s.world, e, { start: Y(year) }).diffs);
        } else if (pick < 0.85 && log.length) s.world.applyDiffs(invertDiffs(log.pop()!));
        else log.push(cmd.updateBranch(s.world, br, { from: Y(1900 + Math.floor(r() * 80)) }).diffs);
      } catch (e) {
        if (!/shares with|not of/.test((e as Error).message)) throw e;
      }
      for (const b of [MAIN_BRANCH, br]) for (const t of [Y(1890), Y(1930), Y(1960), Y(2000)]) s.at(b, x + w / 2, y + w / 2, t);
    }
    assert.deepEqual(Engine.verifyFailures, []);
    // (The edits were followed, in both timelines, and some were made in the branch.)
    assert.ok(s.main.stats.followed >= 10 && s.engineOf(br).stats.followed >= 10, `${s.main.stats.followed} ${s.engineOf(br).stats.followed}`);
    assert.ok(s.world.all('event').filter((e) => e.branch_id === br).length >= 3);
    // And what each timeline lists is what its engine includes: every event it lists begins in its history.
    const cuts = branchCuts(s.world, br);
    for (const e of s.world.all('event')) assert.equal(s.engineOf(br).lists(e), eventSeen(cuts, e));
  } finally {
    Engine.verify = false;
  }
});
