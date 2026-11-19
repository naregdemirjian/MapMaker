// Tidying a map's parcels (Stage 13 refinement, D151): borders no change tells apart, left by edits since deleted,
// are taken away and their parcels made whole again. Tested: history unchanged everywhere (a grid of places at
// many dates, in the main timeline and a branch), fewer parcels and borders, a valid parcel map, nothing left to
// tidy the second time, parcels some change refers to kept (an inactive alternative version included), undo
// bringing back every row, and random histories with deleted events tidied and compared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF, type Instant } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { ring, rng } from './helpers.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const tidyRows = (snap: Record<string, unknown[] | undefined>) => Object.fromEntries(Object.entries(snap).map(([t, rows]) => [t, [...(rows ?? [])].map((r) => JSON.stringify(r)).sort()]));

function setup() {
  const world = new World();
  const { result } = cmd.seedProject(world, 'Tidy');
  const spaceId = result.spaceId;
  const layerId = world.all('layer').find((l) => l.space_id === spaceId)!.id;
  const engine = new Engine(world);
  const ent = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result;
  const event = (name: string, start: Instant) => cmd.createEvent(world, { name, start }).result;
  const sq = (x: number, y: number, w: number): Array<[number, number]> => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];
  const paint = (pts: Array<[number, number]>, value: string | null, eventId: string) =>
    cmd.paintTerritory(world, engine, { spaceId, layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'new', eventId } });
  const base = (pts: Array<[number, number]>, value: string | null) =>
    cmd.paintTerritory(world, engine, { spaceId, layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const arr = () => world.arrangement(spaceId);
  /** Who holds a grid of places at several dates, in a timeline. */
  const states = (e: Engine) => {
    const out: Array<string | null> = [];
    for (const t of [Y(1800), Y(1900), Y(1925), Y(1950), Y(1975), Y(2000)]) for (let x = -1; x <= 21; x += 0.7) for (let y = 34; y <= 56; y += 0.7) out.push(e.valueAtPoint(spaceId, layerId, lonLatToVec(x, y), t));
    return out;
  };
  return { world, spaceId, layerId, engine, ent, event, sq, paint, base, arr, states };
}

test('borders left by deleted events are taken away; history, a branch and an inactive alternative are untouched; undo brings every row back', () => {
  const s = setup();
  const A = s.ent('A'), B = s.ent('B'), C = s.ent('C');
  s.base(s.sq(0, 35, 20), A);
  const kept = s.event('B takes the middle', Y(1900));
  s.paint(s.sq(5, 40, 10), B, kept);
  // Strokes in events that are then deleted: their borders stay in the parcel map, referred to by nothing.
  for (const [i, [x, y]] of [[2, 37], [12, 46], [8, 50], [15, 38]].entries()) {
    const gone = s.event(`Gone ${i}`, Y(1950 + i));
    s.paint(s.sq(x, y, 3.3), C, gone);
    cmd.deleteEvent(s.world, gone);
  }
  // A branch and an alternative version that refer to parcels of their own: those stay.
  const br = cmd.createBranch(s.world, { name: 'Other', from: Y(1940) }).result;
  s.world.branch = br;
  const branchEngine = new Engine(s.world, br);
  const own = s.event('Branch event', Y(1960));
  cmd.paintTerritory(s.world, branchEngine, { spaceId: s.spaceId, layerId: s.layerId, ring: ring(s.sq(1, 52, 2)), value: C, snap: 1e-7, mode: { kind: 'new', eventId: own } });
  s.world.branch = 'main';
  const alt = s.event('Alternative', Y(1930));
  s.paint(s.sq(17, 52, 2), C, alt);
  const alt2 = cmd.createVariant(s.world, alt, 'Alternative, other version').result;
  for (const ef of s.world.all('effect').filter((f) => f.event_id === alt2)) cmd.deleteEffect(s.world, ef.id);
  assert.equal(s.world.get('event', alt)!.variant_active, 0, 'the first version is the inactive one');

  const before = { main: s.states(s.engine), branch: s.states(branchEngine) };
  const rows = tidyRows(s.world.snapshot());
  const faces = s.arr().leafFaces().length, segments = s.arr().segments.size;
  const r = cmd.tidyParcels(s.world, s.spaceId);
  assert.ok(r.result.parcels >= 4 && r.result.borders >= 16, JSON.stringify(r.result));
  assert.deepEqual(s.arr().validate(), []);
  assert.ok(s.arr().leafFaces().length < faces && s.arr().segments.size < segments, `${faces} -> ${s.arr().leafFaces().length} parcels, ${segments} -> ${s.arr().segments.size} borders`);
  assert.deepEqual(s.states(s.engine), before.main, 'the main timeline is unchanged');
  assert.deepEqual(s.states(branchEngine), before.branch, 'the branch is unchanged');
  // The parcels the branch's event and the inactive version refer to are still there.
  const referenced = s.world.referencedFaces(s.spaceId);
  for (const ef of s.world.all('effect')) for (const [fs] of JSON.parse(ef.resolution).set ?? []) for (const f of fs) assert.ok(s.arr().faces.has(f), `parcel ${f} of a change`);
  assert.ok(referenced(JSON.parse(s.world.all('effect').find((f) => f.event_id === alt)!.resolution).set[0][0][0]));
  // Nothing more to tidy; undo brings every row back.
  assert.deepEqual(cmd.tidyParcels(s.world, s.spaceId).result, { parcels: 0, borders: 0, points: 0 });
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.deepEqual(tidyRows(s.world.snapshot()), rows);
  assert.deepEqual(s.arr().validate(), []);
  assert.deepEqual(s.states(s.engine), before.main);
  assert.deepEqual(s.engine.conflicts, []);
});

test('random histories with events deleted: tidied, history the same at every place and date, followed change by change', () => {
  Engine.verify = true;
  Engine.verifyFailures = [];
  try {
    let tidied = 0;
    for (const seed of [3, 17, 51]) {
      const s = setup();
      const g = rng(seed), r = () => g.next();
      const owners = [s.ent('A'), s.ent('B'), s.ent('C'), null];
      s.base(s.sq(0, 35, 20), owners[0]);
      const events: string[] = [];
      for (let i = 0; i < 14; i++) {
        const e = s.event(`E${i}`, Y(1850 + Math.floor(r() * 150)));
        events.push(e);
        const x = r() * 17, y = 35 + r() * 17, w = 1 + r() * 3;
        try { s.paint(s.sq(x, y, w), owners[Math.floor(r() * owners.length)], e); } catch (err) { if (!/outline|snap|border/i.test((err as Error).message)) throw err; }
      }
      for (const e of events) if (r() < 0.5) cmd.deleteEvent(s.world, e);
      const before = s.states(s.engine);
      const res = cmd.tidyParcels(s.world, s.spaceId).result;
      tidied += res.parcels;
      assert.deepEqual(s.arr().validate(), [], `seed ${seed}`);
      assert.deepEqual(s.states(s.engine), before, `seed ${seed}: history unchanged (${JSON.stringify(res)})`);
      assert.deepEqual(cmd.tidyParcels(s.world, s.spaceId).result.parcels, 0);
      // A fresh engine agrees with the one that followed the tidying.
      assert.deepEqual(s.states(new Engine(s.world)), before);
    }
    assert.deepEqual(Engine.verifyFailures, []);
    assert.ok(tidied >= 10, `parcels made whole: ${tidied}`);
  } finally {
    Engine.verify = false;
  }
});
