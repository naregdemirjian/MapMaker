// The table of events (D242): what each event holds (drawn or planned, who, its changes in words, the shots over it),
// and the list of events written as a CSV file and read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, add, fromStore } from '../src/core-time/index.ts';
import { defaultShot } from '../src/presentation/sequence.ts';
import { eventFacts, changesText, involvesText, shotsOver, eventsCsv, parseEventsCsv } from '../src/domain/event-table.ts';
import type { AnyRow } from '../src/world-model/schema.ts';

const Y = (year: number, month = 1, day = 1) => gregorian.fromCivil({ year, month, day });

function project() {
  const world = new World();
  cmd.seedProject(world, 'Table');
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Arcadia' }).result;
  const b = cmd.createEntity(world, { type_id: 'polity', name: 'Boreal' }).result;
  const war = cmd.createEvent(world, { name: 'War of the Fords', start: Y(1337, 5, 12), end: Y(1356) }).result;
  const plan = cmd.createEvent(world, { name: 'Sunward annexes the delta', start: Y(1364) }).result;
  return { world, a, b, war, plan };
}

const effect = (world: World, id: string, eventId: string, kind: string, intent: unknown, set: Array<[number[], string]> = []) => world.applyDiffs([{ table: 'effect', before: null, after: {
  id, event_id: eventId, ordinal: 0, kind, space_id: null, layer_id: null, at_day: null, at_ms: null, transition: '', intent: JSON.stringify(intent), resolution: JSON.stringify({ set }), basis_hash: '',
} as unknown as AnyRow }]);

test('what an event holds: its changes by kind and who they involve (land by its new holders, however drawn); an event with none is planned', () => {
  const { world, a, b, war, plan } = project();
  effect(world, 'e1', war, 'assign', { op: 'paint', value: a });
  effect(world, 'e2', war, 'assign', { op: 'shift', of: 'e1', step: 1 }, [[[1, 2], b]]);
  effect(world, 'e3', war, 'rename', { op: 'rename', entity: a, name: 'Arcady' });
  effect(world, 'e4', war, 'annex', { op: 'annex', from: b, to: a });
  const f = eventFacts(world).get(war)!;
  assert.equal(f.drawn, 4);
  assert.deepEqual(new Set(f.involves), new Set([a, b]));
  assert.equal(changesText(f.changes), '2 changes of land, 1 annexation, 1 new name');
  assert.equal(involvesText(world, f.involves), 'Arcadia, Boreal');
  assert.equal(eventFacts(world).get(plan), undefined, 'nothing drawn into it yet');
  assert.equal(eventFacts(world), eventFacts(world), 'kept while nothing changes');
  effect(world, 'e5', plan, 'place', { op: 'place', entity: b });
  assert.equal(eventFacts(world).get(plan)!.drawn, 1, 'worked out again after a change');
  assert.equal(involvesText(world, ['x', a, b, 'y'], 1), 'Arcadia and 1 more');
});

test('the shots over an event: those whose time meets its span or its moment', () => {
  const { world, war, plan } = project();
  const shot = (from: number, to: number) => defaultShot('s', { lon: 0, lat: 0, zoom: 1, rotation: 0, projection: 'equirectangular' }, Y(from), Y(to));
  cmd.createSequence(world, 'Early', shot(1300, 1340));
  cmd.createSequence(world, 'Late', shot(1360, 1400));
  const ev = (id: string) => world.get('event', id)!;
  assert.equal(shotsOver(world, ev(war)), 1);
  assert.equal(shotsOver(world, ev(plan)), 1);
  cmd.createSequence(world, 'All', shot(1300, 1400));
  assert.equal(shotsOver(world, ev(war)), 2);
});

test('the list as a CSV file, written and read back; lines that cannot be read named', () => {
  const { world, war, plan } = project();
  const csv = eventsCsv(world, [world.get('event', war)!, world.get('event', plan)!], gregorian, (id) => (id === war ? ['Wars', 'Fords, the'] : []));
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'Name,Starts,Ends,Type,Groups');
  assert.match(lines[1], /^War of the Fords,12 May 1337,1 January 1356,[^,]*,"Wars; Fords, the"$/);
  const back = parseEventsCsv(csv, gregorian);
  assert.deepEqual(back.errors, []);
  assert.equal(back.events.length, 2);
  assert.equal(back.events[0].name, 'War of the Fords');
  assert.equal(back.events[0].start.day, Y(1337, 5, 12).day);
  assert.equal(back.events[0].end!.day, Y(1356).day);
  assert.deepEqual(back.events[0].groups, ['Wars', 'Fords, the']);
  assert.equal(back.events[1].end, null);
  // Columns in another order, by their names; without names, in the usual order.
  const other = parseEventsCsv('Starts,Name\n1415,Agincourt\n', gregorian);
  assert.equal(other.events[0].name, 'Agincourt');
  assert.equal(other.events[0].precision, 'year');
  assert.equal(parseEventsCsv('"Quote ""this""",1453\n', gregorian).events[0].name, 'Quote "this"');
  const bad = parseEventsCsv('Name,Starts,Ends\n,1400\nNo date,whenever\nBackwards,1500,1400\nFine,1400\n', gregorian);
  assert.equal(bad.events.length, 1);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[1], /Line 3 \(No date\): its start "whenever" is not a date/);
  assert.deepEqual(parseEventsCsv('', gregorian).errors, ['The file is empty.']);
});

test('events moved together by an amount of the calendar: lengths kept, their dated changes with them; one undo step', () => {
  const { world, a, war, plan } = project();
  effect(world, 'e1', war, 'assign', { op: 'set', value: a });
  world.applyDiffs([{ table: 'effect', before: world.get('effect', 'e1')!, after: { ...world.get('effect', 'e1')!, at_day: Y(1340).day, at_ms: 0 } as AnyRow }]);
  const r = cmd.shiftEvents(world, [war, plan, 'gone'], 'year', 10, gregorian);
  assert.match(r.label, /Move 2 events 10 years later/);
  const ev = (id: string) => world.get('event', id)!;
  assert.equal(ev(war).start_day, Y(1347, 5, 12).day);
  assert.equal(ev(war).end_day, Y(1366).day);
  assert.equal(ev(plan).start_day, Y(1374).day);
  assert.equal(ev(plan).end_day, null);
  assert.equal(world.get('effect', 'e1')!.at_day, Y(1350).day, 'a change at its own date goes with its event');
  assert.throws(() => cmd.shiftEvents(world, [war], 'year', 0), /whole number/);
  assert.throws(() => cmd.shiftEvents(world, [], 'day', 3), /Choose the events/);
});

test('events added from a list: types by name, groups by name (made when missing), nothing drawn; one undo step', () => {
  const { world } = project();
  const parsed = parseEventsCsv('Name,Starts,Ends,Type,Groups\nAgincourt,25 October 1415,,Battle,Wars\nTreaty of Troyes,1420,,,Wars; Treaties\n', gregorian);
  const r = cmd.importEvents(world, parsed.events);
  assert.match(r.label, /Add 2 events from a list/);
  const [x, y] = r.result;
  assert.equal(world.get('event', x)!.name, 'Agincourt');
  assert.equal(world.get('event', y)!.precision, 'year');
  assert.deepEqual(world.all('event_group').map((g) => g.name).sort(), ['Treaties', 'Wars']);
  assert.equal(cmd.groupsOfEvent(world, y).length, 2);
  assert.equal(eventFacts(world).get(x), undefined, 'planned: nothing drawn');
  assert.throws(() => cmd.importEvents(world, []), /no events/);
});

test('events retimed together (D245): new dates for each, their dated changes carried or left; one undo step; an end before a start refused', () => {
  const { world, a, war, plan } = project();
  effect(world, 'e1', war, 'assign', { op: 'set', value: a });
  world.applyDiffs([{ table: 'effect', before: world.get('effect', 'e1')!, after: { ...world.get('effect', 'e1')!, at_day: Y(1340).day, at_ms: 0 } as AnyRow }]);
  const ev = (id: string) => world.get('event', id)!;
  // Moved: by the time from its start to where it went, its change carried along.
  const by = cmd.shiftBy(Y(1337, 5, 12), Y(1347, 5, 12));
  const r = cmd.retimeEvents(world, [
    { id: war, start: by(Y(1337, 5, 12)), end: by(Y(1356)), carry: by },
    { id: plan, start: Y(1370), end: Y(1371) },
  ], 'Move two events');
  assert.equal(r.label, 'Move two events');
  assert.equal(ev(war).start_day, Y(1347, 5, 12).day);
  assert.equal(ev(war).end_day, by(Y(1356)).day);
  assert.equal(world.get('effect', 'e1')!.at_day, by(Y(1340)).day, 'carried');
  assert.deepEqual([ev(plan).start_day, ev(plan).end_day], [Y(1370).day, Y(1371).day]);
  // Its end alone, the change left where it is.
  cmd.retimeEvents(world, [{ id: war, start: fromStore(ev(war).start_day, ev(war).start_ms), end: Y(1380) }], 'Longer');
  assert.equal(world.get('effect', 'e1')!.at_day, by(Y(1340)).day, 'not carried');
  assert.throws(() => cmd.retimeEvents(world, [{ id: plan, start: Y(1400), end: Y(1399) }], 'x'), /would end before it starts/);
  assert.throws(() => cmd.retimeEvents(world, [{ id: 'gone', start: Y(1400), end: null }], 'x'), /Choose the events/);
});

test('dates moved exactly, and stretched about a date in proportion, whole days staying whole (D245)', () => {
  const move = cmd.shiftBy(Y(1300), Y(1310, 3, 4));
  assert.deepEqual(move(Y(1301)), add(Y(1301), Y(1310, 3, 4).day - Y(1300).day));
  const half = { ...Y(1300), ms: 43_200_000 };
  assert.deepEqual(cmd.shiftBy(Y(1300), half)(Y(1400)), { day: Y(1400).day, ms: 43_200_000 }, 'to the millisecond');
  // Stretched about 1300 so that 1310 goes to 1330: three times as long from 1300.
  const s = cmd.stretchAbout(Y(1300), Y(1310), Y(1330));
  assert.deepEqual(s(Y(1300)), Y(1300), 'the anchor stays');
  assert.equal(s(Y(1310)).day, Y(1330).day);
  const mid = Y(1305).day - Y(1300).day, k = (Y(1330).day - Y(1300).day) / (Y(1310).day - Y(1300).day);
  assert.deepEqual(s(Y(1305)), add(Y(1300), Math.round(mid * k)), 'in proportion (three times as far, to the day)');
  assert.equal(s(Y(1305)).ms, 0, 'whole days');
  // Shrunk about its end: 1300 goes to 1305, 1310 stays.
  const t = cmd.stretchAbout(Y(1310), Y(1300), Y(1305));
  assert.equal(t(Y(1300)).day, Y(1305).day);
  assert.equal(t(Y(1310)).day, Y(1310).day);
  // A date with a time of day keeps a time of day.
  assert.ok(Number.isInteger(s({ ...Y(1302), ms: 1000 }).ms));
});
