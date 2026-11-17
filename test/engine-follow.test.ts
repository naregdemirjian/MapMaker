// History followed change by change, and each state of the map worked out from the state given
// before it, must equal history compiled afresh and states worked out parcel by parcel: after every
// kind of edit (territory, events moved and deleted, animations, alternatives, names, characters,
// border points, undo) and for moments asked in any order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine, type FaceState, type Assignment } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF, type Instant } from '../src/core-time/index.ts';
import { BASE_EVENT_ID } from '../src/world-model/schema.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import type { RowDiff } from '../src/world-model/schema.ts';
import { rng, ring, square } from './helpers.ts';

const D = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

const brief = (a: Assignment | null | undefined) => (a ? `${a.effectId}#${a.entry}@${a.face}:${a.t.day}.${a.t.ms}-${a.end.day}.${a.end.ms}=${a.value}/${a.precedence}/${a.eventSeq}/${a.ordinal}` : 'none');

function describe(s: FaceState): string {
  const tr = s.transition;
  return `${s.value}|${brief(s.assignment)}|${tr ? `${tr.from}~${tr.progress}~${tr.spec.style}~${tr.spec.maxDist}~${tr.spec.easing}~${brief(tr.prior)}` : ''}`;
}

function run(seed: number, steps: number) {
  const world = new World();
  const space = cmd.seedProject(world, 'Follow').result.spaceId;
  const layers = [world.all('layer')[0].id, cmd.createLayer(world, space, 'Control').result];
  const engine = new Engine(world);
  const r = rng(seed);
  const owners = ['A', 'B', 'C', 'D', 'E'].map((name) => cmd.createEntity(world, { type_id: 'polity', name }).result);
  const hero = cmd.createEntity(world, { type_id: 'character', name: 'Hero' }).result;
  const undo: RowDiff[][] = [];
  const done = (res: { diffs: RowDiff[] }) => { if (res.diffs.length) undo.push(res.diffs); };
  const year = () => 1000 + r.int(0, 300) * 2;
  const events = () => world.all('event').filter((e) => e.id !== BASE_EVENT_ID);
  const assigns = () => world.all('effect').filter((e) => e.kind === 'assign' || e.kind === 'annex');
  const somewhere = () => ring(square(r.float(-25, 25), r.float(-25, 25), r.float(2, 12)));
  const spec = () => r.pick([null, { style: 'fade' as const }, { style: 'border' as const }, { style: 'advance' as const, origin: [r.float(-25, 25), r.float(-25, 25)] as [number, number] }]);
  done(cmd.paintTerritory(world, engine, { spaceId: space, layerId: layers[0], ring: ring(square(0, 0, 30)), value: owners[0], snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } }));
  const kinds = new Map<string, number>();
  let checks = 0;

  const ops: Array<[string, number, () => void]> = [
    ['a stroke in a new event', 6, () => {
      const y = year(), animated = r.bool(0.5);
      const res = cmd.paintWithNewEvent(world, engine, { name: `E${world.all('event').length}`, start: D(y), end: animated ? D(y + r.int(1, 30)) : null },
        { spaceId: space, layerId: r.pick(layers), ring: somewhere(), value: r.pick([...owners, null]), snap: 1e-7, transition: animated ? spec() : null });
      done(res);
    }],
    ['a stroke into an event there is', 3, () => {
      const ev = r.pick(events());
      if (!ev) return;
      done(cmd.paintTerritory(world, engine, { spaceId: space, layerId: r.pick(layers), ring: somewhere(), value: r.pick([...owners, null]), snap: 1e-7, mode: { kind: 'new', eventId: ev.id }, transition: ev.end_day !== null ? spec() : null }));
    }],
    ['a correction or a change without an event', 3, () => {
      const mode = r.pick([{ kind: 'correct' as const, t: NEG_INF }, { kind: 'correct' as const, t: D(year()) }, { kind: 'change' as const, t: D(year()) }]);
      done(cmd.paintTerritory(world, engine, { spaceId: space, layerId: r.pick(layers), ring: somewhere(), value: r.pick([...owners, null]), snap: 1e-7, mode }));
    }],
    ['an event moved in time', 3, () => {
      const ev = r.pick(events());
      if (!ev) return;
      const y = year();
      done(cmd.updateEvent(world, ev.id, { start: D(y), end: r.bool(0.5) ? D(y + r.int(1, 40)) : null, precedence: r.int(0, 3) }));
    }],
    ['an event renamed', 1, () => { const ev = r.pick(events()); if (ev) done(cmd.updateEvent(world, ev.id, { name: `${ev.name}!` })); }],
    ['an event deleted', 2, () => { const ev = r.pick(events()); if (ev) done(cmd.deleteEvent(world, ev.id)); }],
    ['a change deleted', 2, () => { const ef = r.pick(assigns()); if (ef) done(cmd.deleteEffect(world, ef.id)); }],
    ['an animation set or taken away', 2, () => { const ef = r.pick(assigns()); if (ef) done(cmd.setEffectTransition(world, ef.id, spec())); }],
    ['an annexation', 2, () => {
      const ev = r.pick(events());
      if (!ev) return;
      const [from, to] = [r.pick(owners), r.pick(owners)];
      if (from !== to) done(cmd.annex(world, engine, { spaceId: space, layerId: layers[0], eventId: ev.id, from, to, transition: ev.end_day !== null ? spec() : null }));
    }],
    ['an alternative version of an event', 1, () => { const ev = r.pick(events()); if (ev) done(cmd.createVariant(world, ev.id, `${ev.name} (alt)`)); }],
    ['an alternative switched', 1, () => { const ev = r.pick(events().filter((e) => e.variant_group)); if (ev) done(cmd.activateVariant(world, ev.id)); }],
    ['a country made', 1, () => { const res = cmd.createEntity(world, { type_id: 'polity', name: `N${owners.length}` }); owners.push(res.result); done(res); }],
    ['a country deleted', 1, () => { if (owners.length > 3) { const [id] = owners.splice(r.int(1, owners.length - 1), 1); done(cmd.deleteEntities(world, [id])); } }],
    ['a character placed, moved or gone', 2, () => {
      const mode = r.pick([{ kind: 'change' as const, t: D(year()) }, { kind: 'correct' as const, t: NEG_INF }]);
      done(r.bool(0.8) ? cmd.placeCharacter(world, { spaceId: space, entity: hero, lon: r.float(-30, 30), lat: r.float(-30, 30), mode }) : cmd.characterLeaves(world, { spaceId: space, entity: hero, mode }));
    }],
    ['a name from a date on', 1, () => { done(cmd.renameFrom(world, { entity: r.pick(owners), name: `Name ${year()}`, mode: { kind: 'change', t: D(year()) } })); }],
    ['a border point moved', 3, () => {
      const arr = world.arrangement(space);
      const v = r.pick([...arr.vertices.values()]);
      if (v) done(cmd.moveVertex(world, { spaceId: space, vertexId: v.id, to: lonLatToVec(v.lon / 1e7 + r.float(-0.4, 0.4), v.lat / 1e7 + r.float(-0.4, 0.4)), snap: 1e-7 }));
    }],
    ['a border point added', 1, () => {
      const arr = world.arrangement(space);
      const sg = r.pick([...arr.segments.values()]);
      if (!sg) return;
      const a = arr.vertices.get(sg.a)!, b = arr.vertices.get(sg.b)!;
      done(cmd.insertBorderVertex(world, { spaceId: space, segmentId: sg.id, at: lonLatToVec((a.lon + b.lon) / 2e7, (a.lat + b.lat) / 2e7) }));
    }],
    ['an undo', 4, () => {
      const diffs = undo.pop();
      if (diffs) world.applyDiffs([...diffs].reverse().map((d) => ({ table: d.table, before: d.after, after: d.before })));
    }],
  ];
  const bag = ops.flatMap(([name, weight], i) => Array.from({ length: weight }, () => ({ name, i })));

  const check = (what: string) => {
    const fresh = new Engine(world);
    const arr = world.arrangement(space);
    assert.deepEqual(engine.changeInstants(), fresh.changeInstants(), `the instants of change after ${what}`);
    // Moments asked in a scattered order: far apart, next to each other, and the same one twice.
    const base = year();
    const moments = [D(base), D(base + r.int(-200, 200)), D(base, 1, 2), D(base + 5, 6, 1), NEG_INF, D(base)];
    // Around the changes themselves: at one, just before it, at the next, and between changes a few
    // apart (inside animations under way, with other changes beginning and ending in between).
    const at = engine.changeInstants();
    if (at.length) {
      const i = r.int(0, at.length - 1), pick = (k: number) => at[Math.max(0, Math.min(at.length - 1, k))];
      const between = (x: Instant, y: Instant): Instant => ({ day: Math.floor((x.day + y.day) / 2), ms: 0 });
      moments.push(pick(i), { day: pick(i).day - 1, ms: 0 }, pick(i + 1), between(pick(i), pick(i + 1)), between(pick(i + 1), pick(i + 3)), between(pick(i - 2), pick(i)), between(pick(i), pick(i + 2)));
    }
    for (const t of moments) for (const layer of layers) {
      const got = engine.partitionState(space, layer, t), want = fresh.partitionState(space, layer, t);
      assert.equal(got.size, want.size, `as many parcels after ${what}`);
      for (const f of arr.leafFaces()) {
        const g = got.get(f), w = want.get(f)!;
        assert.ok(g, `parcel ${f} has a state after ${what}`);
        if (describe(g) !== describe(w)) assert.fail(`parcel ${f} at ${t.day === -Infinity ? 'the beginning' : gregorian.format(t, 'day')} after ${what} (seed ${seed}):\n  followed ${describe(g)}\n  afresh   ${describe(w)}`);
      }
      assert.deepEqual([...engine.partitionChanging(space, layer, t)].sort((x, y) => x - y), [...fresh.partitionChanging(space, layer, t)].sort((x, y) => x - y), `parcels changing hands after ${what}`);
      checks++;
    }
    for (const ef of world.all('effect')) assert.deepEqual(engine.assignmentsOf(ef.id).map(brief), fresh.assignmentsOf(ef.id).map(brief));
    const t = D(base);
    for (const e of world.all('entity')) assert.equal(engine.nameAt(e.id, t), fresh.nameAt(e.id, t));
    assert.deepEqual(engine.charactersAt(space, t), fresh.charactersAt(space, t));
    assert.deepEqual(engine.characterTrack(space, hero), fresh.characterTrack(space, hero));
    assert.deepEqual(engine.conflicts, fresh.conflicts, `the problems found after ${what}`);
  };

  check('the start');
  for (let step = 0; step < steps; step++) {
    const op = r.pick(bag);
    try {
      ops[op.i][2]();
      kinds.set(op.name, (kinds.get(op.name) ?? 0) + 1);
    } catch (e) {
      // A refused edit (a shape that cannot be drawn, a point that cannot move) changes nothing.
      if (e instanceof assert.AssertionError) throw e;
    }
    check(`step ${step} (${op.name})`);
  }
  return { engine, kinds, checks };
}

for (const seed of [1, 2, 3, 4, 5]) {
  test(`history followed step by step equals history compiled afresh (seed ${seed})`, () => {
    const { engine, kinds, checks } = run(seed, 90);
    assert.ok(checks > 500);
    assert.ok(kinds.size >= 12, `many kinds of edit were made (${[...kinds.keys()].join(', ')})`);
    // The quick ways were really taken, not just the fallbacks.
    assert.ok(engine.stats.followed > 40, `changes were followed (${JSON.stringify(engine.stats)})`);
    assert.ok(engine.stats.statesDerived > 200, `states were worked out from the one before (${JSON.stringify(engine.stats)})`);
  });
}

test('how far an animation reaches follows the land when a border point of it is moved', () => {
  const world = new World();
  const space = cmd.seedProject(world, 'Reach').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'A' }).result;
  cmd.paintWithNewEvent(world, engine, { name: 'Spread', start: D(1500), end: D(1520) },
    { spaceId: space, layerId: layer, ring: ring(square(10, 10, 5), 20), value: a, snap: 1e-7, transition: { style: 'advance', origin: [10, 10] } });
  const arr = world.arrangement(space);
  const reach = (e: Engine) => {
    const st = [...e.partitionState(space, layer, D(1510)).values()].find((s) => s.transition);
    assert.ok(st?.transition, 'the land is changing hands in 1510');
    return st.transition.spec.maxDist;
  };
  const before = reach(engine);
  assert.equal(before, reach(new Engine(world)));
  // The corner furthest east and north goes further out.
  const corner = [...arr.vertices.values()].sort((x, y) => (y.lon + y.lat) - (x.lon + x.lat))[0];
  cmd.moveVertex(world, { spaceId: space, vertexId: corner.id, to: lonLatToVec(corner.lon / 1e7 + 3, corner.lat / 1e7 + 3), snap: 1e-7 });
  const after = reach(engine);
  assert.ok(after > before + 0.01, `the animation reaches further (${before} -> ${after})`);
  assert.equal(after, reach(new Engine(world)), 'as far as when compiled afresh');
  assert.ok(engine.stats.followed >= 1 && engine.stats.compiled <= 2, JSON.stringify(engine.stats));
});
