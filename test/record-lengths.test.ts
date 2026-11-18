// How long a change in an event takes (fifth feedback round, D86): over the rest of its event (as
// before), until a date of its own, for a while from its own time, or, as recorded, until the next
// change recorded into the same event; at once when it does not spread.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine, transitionEnd, type TransitionSpec } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, compare, toStore, type Instant } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs, type EventRow } from '../src/world-model/schema.ts';
import { ring, square } from './helpers.ts';

const D = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });
const same = (a: Instant | null | undefined, b: Instant | null | undefined) => (a && b ? compare(a, b) === 0 : a === b);

function setup(end: Instant | null) {
  const world = new World();
  const space = cmd.seedProject(world, 'Lengths').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const owner = cmd.createEntity(world, { type_id: 'polity', name: 'Varn' }).result;
  const ev = cmd.createEvent(world, { name: 'War', start: D(1900), end }).result;
  const paint = (lon: number, at: Instant | null, transition: TransitionSpec | null) =>
    cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(square(lon, 0, 3)), value: owner, snap: 1e-7, mode: { kind: 'new', eventId: ev, at }, transition });
  /** When the change that gave the land at `lon` starts and ends. */
  const span = (lon: number) => {
    const face = world.arrangement(space).locate(lonLatToVec(lon, 0));
    const a = engine.latest(space, layer, face, D(3000));
    assert.ok(a, `land at ${lon}° was given`);
    return { t: a.t, end: a.end, animated: !!a.transition };
  };
  return { world, engine, ev, paint, span };
}

test('a change takes its event\'s length, or until a date of its own, or for a while from its own time', () => {
  const s = setup(D(1910));
  s.paint(0, D(1902), { style: 'fade' });
  s.paint(10, D(1902), { style: 'fade', until: toStore(D(1905)) });
  s.paint(20, D(1902), { style: 'border', for: { n: 18, unit: 'month' } });
  s.paint(30, D(1902), null);
  assert.ok(same(s.span(0).end, D(1910)) && s.span(0).animated, 'until the event ends, as before');
  assert.ok(same(s.span(10).end, D(1905)), 'until a date of its own');
  assert.ok(same(s.span(20).end, D(1903, 7)), 'eighteen months from its own date');
  assert.ok(same(s.span(30).end, D(1902)) && !s.span(30).animated, 'at once');
  // Its own length holds in an event without an end, and even past the event's end.
  const open = setup(null);
  open.paint(0, D(1901), { style: 'fade', for: { n: 30, unit: 'year' } });
  open.paint(10, D(1901), { style: 'fade' });
  assert.ok(same(open.span(0).end, D(1931)) && open.span(0).animated);
  assert.ok(!open.span(10).animated, 'no end and no length of its own: at once');
  // A length that ends before the change begins is no animation.
  const ev = { end_day: null, end_ms: null } as unknown as EventRow;
  assert.equal(transitionEnd({ style: 'fade', until: toStore(D(1800)) }, D(1900), ev)!.day, D(1800).day);
});

test('recorded "until the next change": each lasts until the next one recorded into the event, the last until the event ends; undone together', () => {
  const s = setup(D(1920));
  const next: TransitionSpec = { style: 'border', next: true };
  s.paint(0, D(1901), next);
  assert.ok(same(s.span(0).end, D(1920)), 'nothing after it yet: until the event ends');
  s.paint(10, D(1905), next);
  assert.ok(same(s.span(0).end, D(1905)), 'the first now lasts until the second');
  assert.ok(same(s.span(10).end, D(1920)));
  const third = s.paint(20, D(1912), next);
  assert.ok(same(s.span(10).end, D(1912)) && same(s.span(20).end, D(1920)));
  // One recorded between two others (going back in time): the earlier now ends at it, and it ends at the later one.
  s.paint(30, D(1908), next);
  assert.ok(same(s.span(10).end, D(1908)), 'the one before it ends where it begins');
  assert.ok(same(s.span(30).end, D(1912)), 'it lasts until the one after it');
  // Undo puts back what the second lasted for.
  const last = s.paint(40, D(1915), next);
  assert.ok(same(s.span(20).end, D(1915)));
  s.world.applyDiffs(invertDiffs(last.diffs));
  assert.ok(same(s.span(20).end, D(1920)), 'undone: the third lasts until the event ends again');
  assert.ok(third.diffs.length > 0);
  // Any change recorded next ends it, whatever its own length (here one at once).
  s.paint(50, D(1913), null);
  assert.ok(same(s.span(20).end, D(1913)), 'the next change, at once, ends it');
  assert.ok(!s.span(50).animated);
  // Only the change just before is ended: one earlier, already ended by the one after it, keeps its end.
  s.paint(55, D(1914), next);
  assert.ok(same(s.span(20).end, D(1913)) && same(s.span(55).end, D(1920)));
  // Changes with a length chosen afterwards are taken out of the chain.
  const second = s.world.all('effect').find((f) => f.event_id === s.ev && f.at_day === toStore(D(1905))[0])!;
  cmd.setEffectLength(s.world, second.id, { for: { n: 2, unit: 'year' } });
  assert.ok(same(s.span(10).end, D(1907)));
  s.paint(60, D(1906), next);
  assert.ok(same(s.span(10).end, D(1907)), 'its own length is kept');
  cmd.setEffectLength(s.world, second.id, { until: D(1906, 6) });
  assert.ok(same(s.span(10).end, D(1906, 6)));
  cmd.setEffectLength(s.world, second.id, null);
  assert.ok(same(s.span(10).end, D(1920)), 'back to the event\'s end');
  assert.throws(() => cmd.setEffectLength(s.world, second.id, { for: { n: 0, unit: 'year' } }), /at least/);
});
