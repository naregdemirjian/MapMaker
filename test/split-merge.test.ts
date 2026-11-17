// Splitting a country along a drawn line and merging countries (Stage 2, D76): the part clicked
// changes hands, to an existing owner or a new country, from a date, as a correction or in an event;
// one undo step; refused when the line does not divide the country; other countries untouched;
// followed change by change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { lonLatToVec, slerp, dot, type Vec3 } from '../src/geo-kernel/vec.ts';
import { ring, square } from './helpers.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

/** An open line through the points, densified to a degree. */
function line(points: Array<[number, number]>): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = lonLatToVec(...points[i]), b = lonLatToVec(...points[i + 1]);
    const k = Math.max(1, Math.ceil((Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI));
    for (let j = 0; j < k; j++) out.push(slerp(a, b, j / k));
  }
  out.push(lonLatToVec(...points[points.length - 1]));
  return out;
}

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Split').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const country = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result;
  const A = country('Aldmark'), B = country('Bergholt'), C = country('Corvia');
  const start = (owner: string, pts: Array<[number, number]>) => cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts), value: owner, snap: 1e-9, mode: { kind: 'correct', t: NEG_INF } });
  start(A, square(0, 0, 10));
  start(B, square(25, 0, 10));
  start(C, square(0, 30, 8));
  const at = (lon: number, lat: number, t = Y(2000)) => engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), t);
  return { world, engine, space, layer, A, B, C, at };
}

test('a line across a country: the part clicked goes to a new country from a date; undone in one step', () => {
  const s = setup();
  Engine.verify = true;
  Engine.verifyFailures = [];
  try {
    const segs = s.world.arrangement(s.space).segments.size;
    const r = cmd.splitTerritory(s.world, s.engine, {
      spaceId: s.space, layerId: s.layer, line: line([[-15, 1], [15, 1]]), pick: lonLatToVec(0, 6), t: Y(1800), snap: 1e-9,
      to: { name: 'Northmark' }, mode: { kind: 'change', t: Y(1800) },
    });
    const north = r.result.owner;
    assert.equal(s.world.get('entity', north)!.name, 'Northmark');
    assert.equal(s.at(0, 6, Y(1801)), north, 'the part clicked');
    assert.equal(s.at(-9, 9, Y(1801)), north, 'all of it, to the corner');
    assert.equal(s.at(0, -4, Y(1801)), s.A, 'the other side stays');
    assert.equal(s.at(0, 6, Y(1799)), s.A, 'before the date, one country');
    assert.equal(s.at(25, 6, Y(1801)), s.B, 'the line went on through Bergholt: it is untouched');
    // The new border follows the line: just north and just south of it.
    assert.equal(s.at(5, 1.2, Y(1801)), north);
    assert.equal(s.at(5, 0.8, Y(1801)), s.A);
    assert.ok(s.world.arrangement(s.space).segments.size > segs);
    // One step: undone, the country is whole, the new one and the line are gone.
    s.world.applyDiffs(invertDiffs(r.diffs));
    assert.equal(s.world.get('entity', north), undefined);
    assert.equal(s.at(0, 6, Y(1801)), s.A);
    assert.equal(s.world.arrangement(s.space).segments.size, segs);
    assert.deepEqual(Engine.verifyFailures, []);
  } finally {
    Engine.verify = false;
  }
});

test('splitting to an existing country, in a new event, as a correction; the line must divide the country', () => {
  const s = setup();
  // To Bergholt, in a new event: the event exists and the part moves with it.
  const r = cmd.splitTerritory(s.world, s.engine, {
    spaceId: s.space, layerId: s.layer, line: line([[5, -15], [5, 15]]), pick: lonLatToVec(8, 0), t: Y(1900), snap: 1e-9,
    to: s.B, mode: { kind: 'change', t: Y(1900) }, newEvent: { name: 'Eastern cession', start: Y(1900, 6) },
  });
  assert.equal(r.result.owner, s.B);
  const ev = s.world.all('event').find((e) => e.name === 'Eastern cession')!;
  assert.equal(r.result.eventId, ev.id);
  assert.equal(s.at(8, 0, Y(1900, 7)), s.B);
  assert.equal(s.at(8, 0, Y(1900, 5)), s.A);
  assert.equal(s.at(2, 0, Y(1900, 7)), s.A);
  cmd.updateEvent(s.world, ev.id, { start: Y(1950) });
  assert.equal(s.at(8, 0, Y(1920)), s.A, 'moved with its event');
  // As a correction of the starting map: Corvia's south was always Aldmark's (no event, no date).
  cmd.splitTerritory(s.world, s.engine, {
    spaceId: s.space, layerId: s.layer, line: line([[-12, 27], [12, 27]]), pick: lonLatToVec(0, 24), t: Y(1500), snap: 1e-9,
    to: s.A, mode: { kind: 'correct', t: Y(1500) },
  });
  assert.equal(s.at(0, 24, Y(-1000)), s.A, 'from the beginning');
  assert.equal(s.at(0, 33, Y(-1000)), s.C);
  // A line that stops inside the country divides nothing: refused, and nothing changes.
  const segs = s.world.arrangement(s.space).segments.size, ents = s.world.all('entity').length;
  assert.throws(() => cmd.splitTerritory(s.world, s.engine, {
    spaceId: s.space, layerId: s.layer, line: line([[-15, -5], [-2, -5]]), pick: lonLatToVec(-5, -8), t: Y(2000), snap: 1e-9,
    to: { name: 'Nowhere' }, mode: { kind: 'change', t: Y(2000) },
  }), /does not cut Aldmark in two/);
  assert.equal(s.world.arrangement(s.space).segments.size, segs, 'the line was taken back');
  assert.equal(s.world.all('entity').length, ents);
  // Clicking the sea, or giving a part to its own country, is refused.
  assert.throws(() => cmd.splitTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, line: line([[-15, -5], [15, -5]]), pick: lonLatToVec(-60, -60), t: Y(2000), snap: 1e-9, to: s.B, mode: { kind: 'change', t: Y(2000) } }), /Click the part/);
  assert.throws(() => cmd.splitTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, line: line([[-15, -5], [15, -5]]), pick: lonLatToVec(0, -8), t: Y(2000), snap: 1e-9, to: s.A, mode: { kind: 'change', t: Y(2000) } }), /already belongs/);
  assert.deepEqual(s.engine.conflicts.filter((c) => c.kind === 'broken'), []);
});

test('merging countries: into one of them, or into a new country in an event; the others hold no land after', () => {
  const s = setup();
  const r = cmd.mergeTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ids: [s.A, s.B], into: s.A, t: Y(1800), mode: { kind: 'change', t: Y(1800) } });
  assert.equal(r.result.owner, s.A);
  assert.equal(s.at(25, 0, Y(1801)), s.A);
  assert.equal(s.at(25, 0, Y(1799)), s.B);
  assert.equal(s.at(0, 30, Y(1801)), s.C, 'others untouched');
  // Into a new country, with an event: one step; undone, the new country and the event are gone.
  const u = cmd.mergeTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ids: [s.A, s.C], into: { name: 'United Realm', color: '#336699' }, t: Y(1900), mode: { kind: 'change', t: Y(1900) }, newEvent: { name: 'Act of Union', start: Y(1900) } });
  const realm = u.result.owner;
  assert.equal(s.world.get('entity', realm)!.color, '#336699');
  for (const [lon, lat] of [[0, 0], [25, 0], [0, 30]] as const) assert.equal(s.at(lon, lat, Y(1901)), realm);
  assert.equal(s.at(0, 30, Y(1899)), s.C);
  s.world.applyDiffs(invertDiffs(u.diffs));
  assert.equal(s.world.get('entity', realm), undefined);
  assert.ok(!s.world.all('event').some((e) => e.name === 'Act of Union'));
  assert.equal(s.at(0, 30, Y(1901)), s.C);
  // Refused: nothing to merge, or no land at the date.
  assert.throws(() => cmd.mergeTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ids: [s.A], into: s.A, t: Y(1900), mode: { kind: 'change', t: Y(1900) } }), /at least two/);
  assert.throws(() => cmd.mergeTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ids: [s.B, s.C], into: s.C, t: Y(1850), mode: { kind: 'change', t: Y(1850) } }), /Bergholt holds no land/);
});
