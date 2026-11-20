// Missile salvos (D171): lines flown along great circles over one event, seen only in flight, and a nuclear
// strike where each arrives (none where one is shot down).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gregorian } from '../src/core-time/index.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';

const T = (h: number, m = 0) => gregorian.fromCivil({ year: 2156, month: 5, day: 1, hour: h, minute: m });

test('a salvo: missiles flying from launch to arrival, strikes where they land, none where shot down', () => {
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'Test').result;
  const salvo = cmd.missileSalvo(world, {
    spaceId, name: 'Retaliation', launch: T(10), arrive: T(10, 30), yieldKt: 500,
    flights: [{ from: [44.5, 40.2], to: [73.0, 33.7] }, { from: [44.5, 40.2], to: [67.0, 24.9], shotDown: 0.5 }],
  });
  const engine = new Engine(world);
  const lines = world.all('layer').find((l) => l.kind === 'line')!;
  assert.match(lines.style, /missile/);
  const ev = world.get('event', salvo.result)!;
  assert.equal(ev.name, 'Retaliation');
  assert.equal(engine.featuresAt(lines.id, T(9, 59)).length, 0, 'not before the launch');
  const mid = engine.featuresAt(lines.id, T(10, 15));
  assert.equal(mid.length, 2);
  assert.ok(mid.every((f) => f.progress! > 0.3 && f.progress! < 0.7 && f.style === 'draw'), 'half way in flight');
  // The flight follows the great circle: its middle place lies north of the straight line on the map.
  const parts = mid[0].parts[0];
  assert.ok(parts.length > 6, 'many places along the arc');
  const done = engine.featuresAt(lines.id, T(11));
  assert.ok(done.every((f) => f.progress === undefined), 'arrived: no longer in flight (a missile is then not drawn)');
  // One strike (blast, firestorm, fallout) where the first arrives; none for the one shot down.
  const fields = world.all('layer').filter((l) => l.kind === 'field');
  assert.equal(fields.length, 3);
  const at = fields.flatMap((l) => engine.featuresAt(l.id, T(10, 31)));
  assert.equal(at.length, 3);
  assert.ok(at.every((f) => Math.abs(f.parts[0][0] - 73) < 1e-6), 'at the target');
  assert.equal(fields.flatMap((l) => engine.featuresAt(l.id, T(10, 29))).length, 0, 'not before it arrives');
  const shotDown = world.all('feature').find((f) => f.name === 'Retaliation 2')!;
  const flown = engine.featuresAt(lines.id, T(10, 29)).find((f) => f.feature === shotDown.id)!.parts[0];
  assert.ok(Math.abs(flown[flown.length - 2] - 67) > 5, 'the one shot down ends short of its target');
  assert.throws(() => cmd.missileSalvo(world, { spaceId, name: 'x', launch: T(10), arrive: T(9), flights: [{ from: [0, 0], to: [1, 1] }] }), /arrive after/);
});

test('a great circle between two places', () => {
  const arc = cmd.greatCircle([-74, 40.7], [37.6, 55.75]);
  const mid = arc[Math.floor(arc.length / 2)];
  assert.ok(mid[1] > 60, `New York to Moscow passes far north: ${mid[1].toFixed(1)}°`);
  assert.deepEqual(arc[0].map((x) => +x.toFixed(6)), [-74, 40.7]);
  assert.ok(Math.abs(arc[arc.length - 1][0] - 37.6) < 1e-6);
});

test('a shot of its own (D176): each missile, or cannonball, arrives at its own moment; a point fades in over a span of its own', () => {
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'Test').result;
  cmd.missileSalvo(world, {
    spaceId, name: 'Bombardment', launch: T(6), arrive: T(20),
    flights: [{ from: [28.92, 41.017], to: [28.924, 41.016], launch: T(7), arrive: T(9) }, { from: [28.92, 41.01], to: [28.923, 41.01], launch: T(12), arrive: T(14) }],
  });
  const engine = new Engine(world);
  const lines = world.all('layer').find((l) => l.kind === 'line')!;
  const at = (t: ReturnType<typeof T>) => engine.featuresAt(lines.id, t);
  assert.equal(at(T(8)).filter((f) => f.progress !== undefined).length, 1, 'the first in flight at 8');
  assert.ok(Math.abs(at(T(8)).find((f) => f.progress !== undefined)!.progress! - 0.5) < 0.2, 'half way: two hours of flight, not the whole day');
  assert.equal(at(T(10)).filter((f) => f.progress !== undefined).length, 0, 'the first has landed by 10, the second not yet fired');
  assert.equal(at(T(13)).filter((f) => f.progress !== undefined).length, 1, 'the second in flight at 1 pm');
  // A point fading in over its own half hour, in an event of a moment (no end).
  const ev = cmd.createEvent(world, { name: 'Flags on the towers', start: T(5, 30), end: null, type_id: 'war', description: '', precision: 'minute' }).result;
  const pts = cmd.createLayer(world, spaceId, 'Fighting', 'point').result;
  cmd.createFeature(world, { layerId: pts, name: 'Flags', parts: [[[28.94, 41.032]]], mode: { kind: 'new', eventId: ev, at: T(5, 30) }, anim: 'fade', animUntil: T(6) });
  const e2 = new Engine(world);
  const f = (t: ReturnType<typeof T>) => e2.featuresAt(pts, t)[0];
  assert.ok(f(T(5, 45)).progress! > 0.3 && f(T(5, 45)).progress! < 0.7, 'half faded in at 5.45');
  assert.equal(f(T(6, 30)).progress, undefined, 'whole from 6');
});
