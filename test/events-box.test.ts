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

test('current events: an event holding several changes on different dates shows again at each of them', async () => {
  const { Engine } = await import('../src/temporal-engine/engine.ts');
  const { ring, square } = await import('./helpers.ts');
  const world = new World();
  const space = cmd.seedProject(world, 'Box').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const owner = cmd.createEntity(world, { type_id: 'polity', name: 'Varn' }).result;
  const war = cmd.createEvent(world, { name: 'Varn gains territory', start: Y(1900) }).result;
  // Three advances in the one event: 1900, 1920 and 1940.
  for (const [y, x] of [[1900, 0], [1920, 4], [1940, 8]] as const) {
    cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(square(x, 0, 1.5)), value: owner, snap: 1e-7, mode: { kind: 'new', eventId: war, at: y === 1900 ? null : Y(y) } });
  }
  const box = eventsBoxOf({ show: true, linger: 3, fade: 0, maxEvents: 10 });
  const at = (y: number, m = 1) => currentEvents(world, box, Y(y, m), secondsSince(Y(y, m)), () => true).map((e) => e.name);
  assert.deepEqual(at(1901), ['Varn gains territory'], 'at its start');
  assert.deepEqual(at(1910), [], 'gone after lingering');
  assert.deepEqual(at(1921), ['Varn gains territory'], 'again at the second advance');
  assert.deepEqual(at(1930), []);
  assert.deepEqual(at(1941), ['Varn gains territory'], 'and the third');
  // Listed once, never twice at the same moment.
  assert.equal(at(1942).length, 1);
});

test('an events box set to hide while empty (D176) draws nothing between events', async () => {
  const { drawEventsBox } = await import('../src/presentation/events-box.ts');
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : typeof k === 'string' && ['save', 'restore', 'fillText', 'fill', 'fillRect', 'beginPath', 'roundRect', 'stroke', 'moveTo', 'lineTo', 'arc', 'closePath', 'rect', 'clip', 'drawImage', 'arcTo', 'quadraticCurveTo'].includes(k) ? () => { calls.push(k); } : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
  const t = gregorian.fromCivil({ year: 1453, month: 5, day: 29 });
  assert.equal(drawEventsBox(ctx, 1920, 1080, 1, eventsBoxOf({ show: true, hideWhenEmpty: true }), t, []), null);
  assert.equal(calls.length, 0, 'nothing drawn');
  assert.notEqual(drawEventsBox(ctx, 1920, 1080, 1, eventsBoxOf({ show: true }), t, []), null, 'as before when not asked: the date alone');
});

test('an events box kept still (D190): the same size and place with none, one or many events', async () => {
  const { drawEventsBox } = await import('../src/presentation/events-box.ts');
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : typeof k === 'string' && ['save', 'restore', 'fillText', 'fill', 'fillRect', 'beginPath', 'roundRect', 'stroke', 'moveTo', 'lineTo', 'arc', 'closePath', 'rect', 'clip', 'drawImage', 'arcTo', 'quadraticCurveTo', 'translate', 'scale', 'setTransform'].includes(k) ? () => undefined : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
  const t = gregorian.fromCivil({ year: 1453, month: 5, day: 29 });
  const ev = (name: string) => ({ id: name, name, description: '', alpha: 1, typeColor: null } as never);
  const long = 'A very long name of an event that would take three lines or more in the box';
  for (const corner of ['bottom-right', 'top-left'] as const) {
    const still = eventsBoxOf({ show: true, keepSize: true, height: 0, maxEvents: 3, corner });
    const boxes = [[], [ev('One')], [ev('One'), ev(long), ev('Three')]].map((es) => drawEventsBox(ctx, 1920, 1080, 1, still, t, es));
    assert.deepEqual(boxes[1], boxes[0], `${corner}: one event, the same box as none`);
    assert.deepEqual(boxes[2], boxes[0], `${corner}: three, one of them long, the same box`);
  }
  const moving = eventsBoxOf({ show: true, maxEvents: 3, height: 0, keepSize: false });
  assert.notDeepEqual(drawEventsBox(ctx, 1920, 1080, 1, moving, t, [ev('One')]), drawEventsBox(ctx, 1920, 1080, 1, moving, t, []), 'not asked: it grows as before');
});

test('an events box is of a fixed size by default (D230), listing as many events as fit, the most recent first', async () => {
  const { drawEventsBox, DEFAULT_EVENTS_BOX, EVENTS_BOX_SIZES, sizingOf, withSizing } = await import('../src/presentation/events-box.ts');
  const written: string[] = [];
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : k === 'fillText' ? (s: string) => { written.push(s); } : typeof k === 'string' && ['save', 'restore', 'fill', 'fillRect', 'beginPath', 'roundRect', 'stroke', 'moveTo', 'lineTo', 'arc', 'closePath', 'rect', 'clip', 'drawImage', 'arcTo', 'quadraticCurveTo', 'translate', 'scale', 'setTransform'].includes(k) ? () => undefined : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
  const t = gregorian.fromCivil({ year: 1453, month: 5, day: 29 });
  const ev = (name: string) => ({ id: name, name, description: '', alpha: 1 } as never);
  assert.equal(sizingOf(DEFAULT_EVENTS_BOX), 'fixed');
  const box = eventsBoxOf({ show: true, maxEvents: 20 });
  assert.deepEqual([box.width, box.height], [EVENTS_BOX_SIZES[1].width, EVENTS_BOX_SIZES[1].height], 'the medium size');
  const many = Array.from({ length: 12 }, (_, i) => ev(`E${i}`));
  const boxes = [[], [ev('E0')], many].map((es) => drawEventsBox(ctx, 1920, 1080, 1, box, t, es));
  assert.deepEqual(boxes[1], boxes[0]);
  assert.deepEqual(boxes[2], boxes[0], 'the same box with twelve events');
  assert.equal(boxes[0]!.h, 260);
  written.length = 0;
  drawEventsBox(ctx, 1920, 1080, 1, box, t, many);
  const listed = written.filter((x) => /^E\d+$/.test(x));
  assert.ok(listed.length >= 3 && listed.length < 12, `as many as fit (${listed.length})`);
  assert.deepEqual(listed, many.slice(0, listed.length).map((e: any) => e.name), 'the first (most recent) ones');
  // Its own size, then growing again.
  const own = eventsBoxOf({ show: true, width: 700, height: 150 });
  assert.deepEqual([drawEventsBox(ctx, 1920, 1080, 1, own, t, many)!.w, drawEventsBox(ctx, 1920, 1080, 1, own, t, many)!.h], [700, 150]);
  assert.deepEqual(withSizing(own, 'grow'), { height: 0, keepSize: false });
  assert.deepEqual(withSizing(eventsBoxOf({ height: 0 }), 'fixed'), { height: 260, keepSize: true });
  assert.equal(sizingOf(eventsBoxOf({ height: 0, keepSize: true })), 'room');
});
