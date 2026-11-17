// Custom event types (Stage 3, D75): made, copied, renamed, recoloured, given a default way of
// spreading and a default length, deleted (their events become plain events); undone and reloaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import * as types from '../src/domain/event-types.ts';
import { gregorian } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { eventsCSV } from '../src/domain/data-export.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

function setup() {
  const world = new World();
  cmd.seedProject(world, 'Types');
  return world;
}

test('making, copying and changing types; names unique; the built-in ones kept first', () => {
  const w = setup();
  const siege = types.createEventType(w, '  Siege ', { spread: 'border', length: { n: 6, unit: 'month' } }).result;
  const t = w.get('event_type', siege)!;
  assert.equal(t.name, 'Siege');
  assert.equal(t.builtin, 0);
  const st = types.typeSettings(t);
  assert.match(st.color!, /^#[0-9a-f]{6}$/, 'a colour of its own');
  assert.equal(st.spread, 'border');
  assert.deepEqual(st.length, { n: 6, unit: 'month' });
  assert.throws(() => types.createEventType(w, 'siege'), /already a type/);
  assert.throws(() => types.createEventType(w, 'War'), /already a type/, 'nor the name of a built-in one');
  assert.throws(() => types.createEventType(w, ' '), /name/);
  assert.throws(() => types.createEventType(w, 'Odd', { color: 'red' }), /colour/);
  assert.throws(() => types.createEventType(w, 'Odd', { length: { n: -1, unit: 'year' } }), /length/);
  // A copy keeps the settings.
  const copy = types.copyEventType(w, siege).result;
  assert.equal(w.get('event_type', copy)!.name, 'Siege (copy)');
  assert.deepEqual(types.typeSettings(w.get('event_type', copy)), st);
  assert.equal(w.get('event_type', types.copyEventType(w, siege).result)!.name, 'Siege (copy 2)');
  // Renamed, recoloured, the length cleared; a built-in type can be changed too.
  types.updateEventType(w, copy, { name: 'Blockade', color: '#123456', length: null });
  assert.equal(w.get('event_type', copy)!.name, 'Blockade');
  assert.deepEqual(types.typeSettings(w.get('event_type', copy)), { color: '#123456', spread: 'border' });
  types.updateEventType(w, 'war', { color: '#aa0000', length: { n: 4, unit: 'year' } });
  assert.equal(types.typeColor(w, 'war'), '#aa0000');
  types.updateEventType(w, 'war', { color: null });
  assert.equal(types.typeColor(w, 'war'), undefined);
  assert.throws(() => types.updateEventType(w, copy, { name: 'Siege' }), /already a type/);
  // The order offered: built-in first (the starting map's type never), then the user's by name.
  const names = types.eventTypes(w).map((x) => x.name);
  assert.deepEqual(names.slice(0, 2), ['Event', 'Founding']);
  assert.ok(!names.includes('Base world'));
  assert.deepEqual(names.slice(-3), ['Blockade', 'Siege', 'Siege (copy 2)']);
});

test('default lengths: days, months (to the end of a shorter month), years; none', () => {
  const w = setup();
  const t = (length: types.EventLength | null) => types.createEventType(w, `T${Math.random()}`, { length }).result;
  assert.deepEqual(types.defaultEnd(w, t({ n: 10, unit: 'day' }), Y(1700, 12, 25)), Y(1701, 1, 4));
  assert.deepEqual(types.defaultEnd(w, t({ n: 1, unit: 'month' }), Y(1700, 1, 31)), Y(1700, 2, 28));
  assert.deepEqual(types.defaultEnd(w, t({ n: 1, unit: 'month' }), Y(1704, 1, 31)), Y(1704, 2, 29));
  assert.deepEqual(types.defaultEnd(w, t({ n: 13, unit: 'month' }), Y(1700, 12, 15)), Y(1702, 1, 15));
  assert.deepEqual(types.defaultEnd(w, t({ n: 30, unit: 'year' }), Y(1618, 5, 23)), Y(1648, 5, 23));
  assert.deepEqual(types.defaultEnd(w, t({ n: 2, unit: 'year' }), Y(-44, 3, 15)), Y(-42, 3, 15), 'before the year 1');
  assert.equal(types.defaultEnd(w, t(null), Y(1700)), null);
  assert.equal(types.defaultEnd(w, 'general', Y(1700)), null);
});

test('deleting types: their events become plain events; undone; "Event" and the starting map\'s type stay', () => {
  const w = setup();
  const siege = types.createEventType(w, 'Siege').result;
  const ev = cmd.createEvent(w, { name: 'Siege of Vienna', type_id: siege, start: Y(1683, 7, 14), end: Y(1683, 9, 12) }).result;
  const war = cmd.createEvent(w, { name: 'Great War', type_id: 'war', start: Y(1683) }).result;
  assert.equal(types.eventsByType(w).get(siege), 1);
  assert.ok(eventsCSV(w).includes(',Siege of Vienna,Siege,1683-07-14,'), 'the type is in the CSV');
  const r = types.deleteEventTypes(w, [siege, 'war']);
  assert.equal(w.get('event_type', siege), undefined);
  assert.equal(w.get('event', ev)!.type_id, 'general');
  assert.equal(w.get('event', war)!.type_id, 'general');
  assert.throws(() => types.deleteEventTypes(w, ['general']), /cannot be deleted/);
  assert.throws(() => types.deleteEventTypes(w, ['base']), /cannot be deleted/);
  // Undone: the types and the events' types come back.
  w.applyDiffs(invertDiffs(r.diffs));
  assert.equal(w.get('event_type', siege)!.name, 'Siege');
  assert.equal(w.get('event', ev)!.type_id, siege);
  assert.equal(w.get('event', war)!.type_id, 'war');
  // Saved and reloaded with their settings.
  types.updateEventType(w, siege, { spread: 'fade', length: { n: 2, unit: 'month' } });
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
  assert.deepEqual(types.typeSettings(copy.get('event_type', siege)), types.typeSettings(w.get('event_type', siege)));
  assert.equal(types.typeSettings(copy.get('event_type', siege)).spread, 'fade');
});
