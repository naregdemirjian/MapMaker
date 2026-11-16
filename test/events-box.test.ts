// The current-events box: which events are listed at a moment, with fades and limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, type Instant, diffMs } from '../src/core-time/index.ts';
import { currentEvents, eventsBoxOf } from '../src/presentation/events-box.ts';

const Y = (y: number, m = 1) => gregorian.fromCivil({ year: y, month: m });
// One screen second per historical year, for easy reading.
const secondsSince = (now: Instant) => (t0: Instant) => diffMs(t0, now) / (365.2425 * 864e5);

test('current events: started and not ended; events without an end linger; inactive alternatives and other groups are left out', () => {
  const world = new World();
  cmd.seedProject(world, 'Box');
  const war = cmd.createEvent(world, { name: 'War of the Straits', start: Y(1900), end: Y(1910) }).result;
  const treaty = cmd.createEvent(world, { name: 'Treaty of Sel', start: Y(1905) }).result;
  cmd.createEvent(world, { name: 'Later famine', start: Y(1950) });
  const alt = cmd.createVariant(world, war, 'War (if Varn wins)').result; // now the active version
  void alt;
  const box = eventsBoxOf({ show: true, linger: 3, fade: 0, maxEvents: 10 });
  const at = (y: number, m = 1, groups: Set<string> | null = null) => currentEvents(world, box, Y(y, m), secondsSince(Y(y, m)), (id) => cmd.eventShown(world, id, groups)).map((e) => e.name);
  assert.deepEqual(at(1899), []);
  assert.deepEqual(at(1906), ['Treaty of Sel', 'War (if Varn wins)'], 'newest first; the inactive original is left out');
  assert.deepEqual(at(1909), ['War (if Varn wins)'], 'the treaty (no end) lingered 3 screen seconds only');
  assert.deepEqual(at(1911), [], 'the war has ended');
  const g = cmd.createEventGroup(world, 'Treaties').result;
  cmd.setEventGroups(world, treaty, [g]);
  assert.deepEqual(at(1906, 1, new Set([g])), ['Treaty of Sel'], 'only the chosen groups');
});

test('current events: fade in and out, and at most maxEvents', () => {
  const world = new World();
  cmd.seedProject(world, 'Box');
  for (let i = 0; i < 6; i++) cmd.createEvent(world, { name: `E${i}`, start: Y(1900 + i), end: Y(1950) });
  const box = eventsBoxOf({ show: true, fade: 2, maxEvents: 3 });
  const list = (y: number, m = 1) => currentEvents(world, box, Y(y, m), secondsSince(Y(y, m)), () => true);
  assert.deepEqual(list(1920).map((e) => e.name), ['E5', 'E4', 'E3'], 'the three most recent');
  const fresh = list(1905, 7).find((e) => e.name === 'E5')!;
  assert.ok(fresh.alpha > 0.2 && fresh.alpha < 0.3, `half a year into a 2-second fade: ${fresh.alpha}`);
  const leaving = list(1951);
  assert.ok(leaving.length === 3 && leaving.every((e) => e.alpha > 0.4 && e.alpha < 0.6), 'fading out a year after the end');
  assert.deepEqual(list(1953), [], 'gone after the fade');
});
