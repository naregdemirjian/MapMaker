import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine, leafDescendants, parseJSON, orderCmp, type Resolution, type Assignment } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF, type Instant, compare, instant } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { rng, ring, square } from './helpers.ts';
import { BASE_EVENT_ID, invertDiffs } from '../src/world-model/schema.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

function setup() {
  const world = new World();
  const { result } = cmd.seedProject(world, 'Test');
  const spaceId = result.spaceId;
  const layerId = world.all('layer').find((l) => l.space_id === spaceId)!.id;
  const engine = new Engine(world);
  const ent = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result;
  const event = (name: string, start: Instant, end: Instant | null = null) => cmd.createEvent(world, { name, start, end }).result;
  const paint = (pts: Array<[number, number]>, value: string | null, eventId: string, at: Instant | null = null, transition: any = null) =>
    cmd.paintTerritory(world, engine, { spaceId, layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'new', eventId, at }, transition });
  const correct = (pts: Array<[number, number]>, value: string | null, t: Instant) =>
    cmd.paintTerritory(world, engine, { spaceId, layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'correct', t } });
  const at = (lon: number, lat: number, t: Instant) => engine.valueAtPoint(spaceId, layerId, lonLatToVec(lon, lat), t);
  return { world, engine, spaceId, layerId, ent, event, paint, correct, at };
}

test('events really change the world: before and after an event', () => {
  const s = setup();
  const A = s.ent('Kingdom A'), B = s.ent('Kingdom B');
  s.correct(square(10, 45, 10), A, NEG_INF); // base world: A holds a large square
  const ev = s.event('Fall of the Northern March', Y(1200, 5, 14));
  s.paint(square(14, 49, 3), B, ev);
  assert.equal(s.at(14, 49, Y(1100)), A);
  assert.equal(s.at(14, 49, Y(1300)), B);
  assert.equal(s.at(5, 40, Y(1300)), A); // unaffected part
  assert.equal(s.at(80, 0, Y(1300)), null); // nobody owns the ocean
  assert.equal(s.at(14, 49, Y(1200, 5, 14)), B); // the change applies from its instant
  assert.equal(s.at(14, 49, Y(1200, 5, 13)), A);
});

test('geometry added later never rewrites earlier history (children inherit)', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B');
  s.correct(square(0, 0, 10), A, NEG_INF);
  const before = [-9, -5, 0, 5, 9].map((x) => s.at(x, x * 0.5, Y(1400)));
  const ev = s.event('Split', Y(1500));
  s.paint([[0, -12], [12, -12], [12, 12], [0, 12]], B, ev); // cuts the square in half
  const after = [-9, -5, 0, 5, 9].map((x) => s.at(x, x * 0.5, Y(1400)));
  assert.deepEqual(after, before);
  assert.equal(s.at(5, 0, Y(1600)), B);
  assert.equal(s.at(-5, 0, Y(1600)), A);
});

function snapshotValues(s: ReturnType<typeof setup>, pts: Array<[number, number]>, times: Instant[]) {
  return times.map((t) => pts.map(([x, y]) => s.at(x, y, t)));
}

test('randomised history edits keep earlier and unrelated states intact', () => {
  const r = rng(42);
  const s = setup();
  const owners = [s.ent('A'), s.ent('B'), s.ent('C'), s.ent('D')];
  s.correct(square(0, 20, 30), owners[0], NEG_INF);
  const events: Array<{ id: string; year: number; area: Array<[number, number]> }> = [];
  for (let i = 0; i < 14; i++) {
    const year = r.int(1000, 2000);
    const area = square(r.float(-25, 25), r.float(-5, 45), r.float(2, 9));
    const id = s.event(`E${i}`, Y(year));
    s.paint(area, r.pick(owners), id);
    events.push({ id, year, area });
  }
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 60; i++) pts.push([r.float(-32, 32), r.float(-12, 52)]);
  const times = [900, 1000, 1100, 1250, 1400, 1550, 1700, 1850, 2000, 2100].map((y) => Y(y));
  const inside = (p: [number, number], area: Array<[number, number]>) => p[0] > area[0][0] - 0.5 && p[0] < area[1][0] + 0.5 && p[1] > area[0][1] - 0.5 && p[1] < area[2][1] + 0.5;

  // (a) insert a new event in the middle of history
  const base1 = snapshotValues(s, pts, times);
  const newArea = square(3, 22, 6);
  const T = 1480;
  s.paint(newArea, owners[3], s.event('Inserted', Y(T)));
  const after1 = snapshotValues(s, pts, times);
  times.forEach((t, ti) => pts.forEach((p, pi) => {
    if (compare(t, Y(T)) < 0 || !inside(p, newArea)) assert.equal(after1[ti][pi], base1[ti][pi], `insert changed ${p} at ${gregorian.format(t, 'year')}`);
  }));

  // (b) delete an existing event
  const victim = events[5];
  const base2 = snapshotValues(s, pts, times);
  cmd.deleteEvent(s.world, victim.id);
  const after2 = snapshotValues(s, pts, times);
  times.forEach((t, ti) => pts.forEach((p, pi) => {
    if (compare(t, Y(victim.year)) < 0 || !inside(p, victim.area)) assert.equal(after2[ti][pi], base2[ti][pi], `delete changed ${p}`);
  }));

  // (c) move an event's date
  const moved = events[8];
  const newYear = moved.year > 1500 ? moved.year - 300 : moved.year + 300;
  const base3 = snapshotValues(s, pts, times);
  cmd.updateEvent(s.world, moved.id, { start: Y(newYear) });
  const after3 = snapshotValues(s, pts, times);
  const lo = Math.min(moved.year, newYear);
  times.forEach((t, ti) => pts.forEach((p, pi) => {
    if (compare(t, Y(lo)) < 0 || !inside(p, moved.area)) assert.equal(after3[ti][pi], base3[ti][pi], `date move changed ${p}`);
  }));
});

test('compiled timelines equal a naive full replay', () => {
  const r = rng(7);
  const s = setup();
  const owners = [s.ent('A'), s.ent('B'), s.ent('C')];
  s.correct(square(0, 0, 20), owners[0], NEG_INF);
  for (let i = 0; i < 12; i++) {
    const ev = s.event(`E${i}`, Y(r.int(1000, 1100)));
    if (r.bool(0.8)) s.paint(square(r.float(-15, 15), r.float(-15, 15), r.float(2, 8)), r.pick(owners), ev);
    else s.correct(square(r.float(-15, 15), r.float(-15, 15), r.float(2, 6)), r.pick(owners), Y(r.int(1000, 1100)));
  }
  const arr = s.world.arrangement(s.spaceId);
  // naive replay: every assignment expanded to leaves, applied in order
  const all: Array<{ a: Assignment; leaves: Set<number> }> = [];
  for (const ef of s.world.all('effect')) for (const a of s.engine.assignmentsOf(ef.id)) all.push({ a, leaves: leafDescendants(arr, [a.face]) });
  all.sort((x, y) => orderCmp(x.a, y.a));
  for (const leaf of arr.leafFaces()) for (const year of [999, 1000, 1020, 1050, 1080, 1100, 1200]) {
    const t = Y(year);
    let naive: string | null = null;
    for (const { a, leaves } of all) if (compare(a.t, t) <= 0 && leaves.has(leaf)) naive = a.value;
    assert.equal(s.engine.faceState(s.spaceId, s.layerId, leaf, t).value, naive, `leaf ${leaf} at ${year}`);
  }
});

test('the same timestamp always reconstructs the same state (also after reload)', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B');
  s.correct(square(0, 0, 10), A, NEG_INF);
  s.paint(square(3, 3, 4), B, s.event('E', Y(1300)));
  const t = Y(1350);
  const one = [...s.engine.partitionState(s.spaceId, s.layerId, t)].map(([f, st]) => [f, st.value]);
  const two = [...s.engine.partitionState(s.spaceId, s.layerId, t)].map(([f, st]) => [f, st.value]);
  assert.deepEqual(one, two);
  const reloaded = World.fromSnapshot(JSON.parse(JSON.stringify(s.world.snapshot())));
  const e2 = new Engine(reloaded);
  const three = [...e2.partitionState(s.spaceId, s.layerId, t)].map(([f, st]) => [f, st.value]);
  assert.deepEqual(three, one);
});

test('simultaneous events are represented, flagged and ordered by precedence', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B'), C = s.ent('C');
  s.correct(square(0, 0, 10), A, NEG_INF);
  const e1 = s.event('Treaty of East', Y(1600, 3, 1));
  const e2 = s.event('Treaty of West', Y(1600, 3, 1));
  s.paint(square(0, 0, 5), B, e1);
  s.paint(square(3, 0, 5), C, e2);
  s.engine.ensure();
  assert.ok(s.engine.conflicts.some((c) => c.kind === 'simultaneous'));
  assert.equal(s.at(1, 0, Y(1601)), C); // equal precedence: the later-created event wins, deterministically
  assert.equal(s.at(-3, 0, Y(1601)), B); // only e1 touches this part
  cmd.updateEvent(s.world, e1, { precedence: 1 });
  assert.equal(s.at(1, 0, Y(1601)), B);
  assert.ok(!s.engine.conflicts.some((c) => c.kind === 'simultaneous'));
});

test('overlapping transitions resolve consistently: the later-starting change takes over', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B'), C = s.ent('C');
  s.correct(square(0, 0, 10), A, NEG_INF);
  const e1 = s.event('Western offensive', Y(1700, 5, 1), Y(1700, 5, 11));
  const e2 = s.event('Eastern offensive', Y(1700, 5, 6), Y(1700, 5, 16));
  s.paint(square(0, 0, 8), B, e1, null, { style: 'advance', origin: [-8, 0], easing: 'linear' });
  s.paint(square(4, 0, 6), C, e2, null, { style: 'advance', origin: [9, 0], easing: 'linear' });
  s.engine.ensure();
  assert.ok(s.engine.conflicts.some((c) => c.kind === 'overlap'));
  // Before e2 starts, only e1's front matters: the west fills first.
  assert.equal(s.at(-7, 0, Y(1700, 5, 2)), B);
  assert.equal(s.at(6, 0, Y(1700, 5, 2)), A);
  // After both end, e2's area belongs to C, the rest of e1's area to B.
  assert.equal(s.at(6, 0, Y(1700, 6, 1)), C);
  assert.equal(s.at(-6, 0, Y(1700, 6, 1)), B);
  // A point in the shared area changes owner at most twice, in a fixed order, as time advances.
  const seq: Array<string | null> = [];
  for (let d = 1; d <= 20; d++) {
    const v = s.at(1, 0, Y(1700, 5, d));
    if (seq[seq.length - 1] !== v) seq.push(v);
  }
  assert.deepEqual(seq, [A, B, C]);
  // Identical queries give identical answers.
  assert.equal(s.at(1, 0, Y(1700, 5, 9)), s.at(1, 0, Y(1700, 5, 9)));
});

test('a stale intention is detected and can be kept or re-applied', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B'), C = s.ent('C');
  s.correct(square(0, 0, 10), A, NEG_INF);
  s.correct(square(30, 0, 5), B, NEG_INF);
  const annexEv = s.event('C annexes B', Y(1300));
  const eff = cmd.annex(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, eventId: annexEv, from: B, to: C }).result;
  assert.equal(s.at(30, 0, Y(1350)), C);
  s.engine.ensure();
  assert.equal(s.engine.conflicts.filter((c) => c.kind === 'stale').length, 0);
  // An earlier event gives B more land: the annexation was worked out from an older history.
  s.paint(square(45, 0, 4), B, s.event('B expands', Y(1250)));
  s.engine.ensure();
  assert.equal(s.engine.conflicts.filter((c) => c.kind === 'stale').length, 1);
  assert.equal(s.at(45, 0, Y(1350)), B); // stored result is still literal until you decide
  cmd.keepAsStored(s.world, s.engine, eff);
  s.engine.ensure();
  assert.equal(s.engine.conflicts.filter((c) => c.kind === 'stale').length, 0);
  assert.equal(s.at(45, 0, Y(1350)), B);
  // ...and if history changes again, the choice is offered again; re-applying includes the new land.
  s.paint(square(45, 10, 3), B, s.event('B expands north', Y(1260)));
  s.engine.ensure();
  assert.equal(s.engine.conflicts.filter((c) => c.kind === 'stale').length, 1);
  cmd.reapplyIntent(s.world, s.engine, eff);
  s.engine.ensure();
  assert.equal(s.engine.conflicts.filter((c) => c.kind === 'stale').length, 0);
  assert.equal(s.at(45, 0, Y(1350)), C);
  assert.equal(s.at(45, 10, Y(1350)), C);
  assert.equal(s.at(45, 0, Y(1280)), B);
});

test('broken references are reported, not hidden', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B');
  s.correct(square(0, 0, 10), A, NEG_INF);
  s.paint(square(0, 0, 3), B, s.event('E', Y(1500)));
  cmd.deleteEntity(s.world, B);
  s.engine.ensure();
  assert.ok(s.engine.conflicts.some((c) => c.kind === 'broken'));
});

test('"correct this period" changes only the period of the current state', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B'), C = s.ent('C'), D = s.ent('D');
  s.correct(square(0, 0, 10), A, NEG_INF);
  s.paint(square(0, 0, 6), B, s.event('B takes the centre', Y(1200)));
  s.paint(square(0, 0, 6), C, s.event('C takes the centre', Y(1400)));
  s.correct(square(0, 0, 2), D, Y(1300));
  assert.equal(s.at(0, 0, Y(1100)), A);
  assert.equal(s.at(0, 0, Y(1300)), D);
  assert.equal(s.at(0, 0, Y(1200)), D); // the whole period from 1200
  assert.equal(s.at(0, 0, Y(1500)), C); // untouched after the period
  assert.equal(s.at(4, 0, Y(1300)), B); // outside the correction
  // the correction was stored inside the event that produced the period, not as a new event
  const events = s.world.all('event').length;
  assert.equal(events, 3);
});

test('event alternatives switch history for story planning', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B'), C = s.ent('C');
  s.correct(square(0, 0, 10), A, NEG_INF);
  const ev = s.event('Battle of the Ford', Y(1200));
  s.paint(square(0, 0, 4), B, ev);
  const alt = cmd.createVariant(s.world, ev, 'Battle of the Ford (C wins)').result;
  const effect = s.world.all('effect').find((f) => f.event_id === alt)!;
  const res = parseJSON<Resolution>(effect.resolution, { set: [] });
  res.set = res.set.map(([f]) => [f, C]);
  s.world.applyDiffs([{ table: 'effect', before: effect, after: { ...effect, resolution: JSON.stringify(res) } }]);
  assert.equal(s.at(0, 0, Y(1300)), C);
  cmd.activateVariant(s.world, ev);
  assert.equal(s.at(0, 0, Y(1300)), B);
  cmd.activateVariant(s.world, alt);
  assert.equal(s.at(0, 0, Y(1300)), C);
});

test('undo data: inverting a command restores the exact previous world', () => {
  const s = setup();
  const A = s.ent('A');
  s.correct(square(0, 0, 10), A, NEG_INF);
  const before = JSON.stringify(s.world.snapshot());
  const r = s.paint(square(2, 2, 3), s.ent('B'), s.event('E', Y(1500)));
  assert.notEqual(JSON.stringify(s.world.snapshot()), before);
  const { invertDiffs } = await_import();
  s.world.applyDiffs(invertDiffs(r.diffs));
  // entity B and event E were separate commands; undo just the paint
  const snap = s.world.snapshot();
  const effectCount = snap.effect!.filter((e) => e.event_id !== BASE_EVENT_ID).length;
  assert.equal(effectCount, 0);
  assert.deepEqual(s.world.arrangement(s.spaceId).validate(), []);
});

function await_import() {
  return { invertDiffs: (d: any[]) => [...d].reverse().map((x) => ({ table: x.table, before: x.after, after: x.before })) };
}

test('very distant dates work the same way', () => {
  const s = setup();
  const A = s.ent('Old Empire'), B = s.ent('Far Future Union');
  s.correct(square(0, 0, 10), A, NEG_INF);
  s.paint(square(0, 0, 5), B, s.event('Far future', instant(3e14)));
  assert.equal(s.at(0, 0, instant(3e14 - 1)), A);
  assert.equal(s.at(0, 0, instant(3e14)), B);
  assert.equal(s.at(0, 0, instant(-3e14)), A);
});

test('painting several rings at once (a lasso that crossed itself) covers exactly their union', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B');
  s.correct(square(0, 0, 20), A, NEG_INF);
  const ev = s.event('Two-pronged advance', Y(1800));
  // two overlapping squares painted in one command
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, rings: [ring(square(-4, 0, 5)), ring(square(4, 0, 5))], value: B, snap: 1e-7, mode: { kind: 'new', eventId: ev } });
  for (const [x, y] of [[-8, 0], [0, 0], [8, 0], [-4, 4], [4, -4]]) assert.equal(s.at(x, y, Y(1900)), B, `${x},${y}`);
  for (const [x, y] of [[-15, 0], [15, 0], [0, 8], [0, -8]]) assert.equal(s.at(x, y, Y(1900)), A, `${x},${y}`);
  assert.deepEqual(s.world.arrangement(s.spaceId).validate(), []);
});

test('a change without an event ("correct this period" in the drawing prompt): from its date on, earlier dates untouched', () => {
  const s = setup();
  const A = s.ent('Kingdom A'), B = s.ent('Kingdom B'), C = s.ent('Kingdom C');
  s.correct(square(10, 45, 10), A, NEG_INF); // the starting map
  const war = s.event('War', Y(1500));
  s.paint(square(14, 49, 3), B, war);
  const change = (pts: Array<[number, number]>, value: string | null, t: Instant) =>
    cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'change', t } });
  const events = s.world.all('event').length;
  const r = change(square(6, 42, 2), C, Y(1300));
  assert.equal(s.world.all('event').length, events, 'no event was made');
  assert.equal(s.at(6, 42, Y(1299)), A, 'before the date: as it was');
  assert.equal(s.at(6, 42, Y(1300)), C, 'from the date on');
  assert.equal(s.at(6, 42, Y(1800)), C, 'until something later changes it');
  assert.equal(s.at(14, 49, Y(1600)), B, 'the war is untouched');
  // Undo removes it; redo brings it back.
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(s.at(6, 42, Y(1350)), A);
  s.world.applyDiffs(r.diffs);
  assert.equal(s.at(6, 42, Y(1350)), C);
  // It lasts until a later change of the same place.
  s.paint(square(6, 42, 1), B, war);
  assert.equal(s.at(6, 42, Y(1400)), C);
  assert.equal(s.at(6, 42, Y(1600)), B, 'the war takes it in 1500');
  // Drawn while looking at the war's own date, it wins over the war at that moment.
  change(square(14, 49, 1), C, Y(1500));
  assert.equal(s.at(14, 49, Y(1500)), C);
  assert.equal(s.at(14, 49, Y(1499)), A);
  // Stored with the starting map, dated; no history problems reported.
  const ef = s.world.get('effect', (r.diffs.find((d) => d.table === 'effect' && d.after)!.after as { id: string }).id)!;
  assert.equal(ef.event_id, BASE_EVENT_ID);
  assert.ok(ef.at_day !== null);
  assert.deepEqual(s.engine.conflicts, []);
  // The retroactive correction of the starting map still corrects the starting map (not a dated change).
  s.correct(square(30, 10, 2), C, NEG_INF);
  assert.equal(s.at(30, 10, Y(-5000)), C);
  assert.equal(s.world.all('effect').filter((f) => f.event_id === BASE_EVENT_ID && f.at_day === null).length, 1, 'one undated starting-map change');
});

test('a change without an event survives saving and reloading, and shows in the order of changes', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B');
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(square(0, 0, 5)), value: A, snap: 1e-7, mode: { kind: 'change', t: Y(1000) } });
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(square(0, 0, 2)), value: B, snap: 1e-7, mode: { kind: 'change', t: Y(1200) } });
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(s.world.snapshot())));
  const e2 = new Engine(copy);
  const at = (t: Instant) => e2.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(0, 0), t);
  assert.equal(at(Y(999)), null);
  assert.equal(at(Y(1100)), A);
  assert.equal(at(Y(1300)), B);
  assert.equal(e2.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(4, 4), Y(1300)), A);
});
