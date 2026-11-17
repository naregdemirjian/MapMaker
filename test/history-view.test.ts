// A country's changes over time: periods of a day, a month, a year or several years; land gained and
// lost in a period, from and to whom, and the changes that did it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF, compare } from '../src/core-time/index.ts';
import { periodAround, stepPeriod, periodLabel, countryPeriodChanges, type PeriodSpec } from '../src/domain/history-view.ts';
import { ring, square } from './helpers.ts';

const Y = (y: number, m = 1, d = 1, h = 0) => gregorian.fromCivil({ year: y, month: m, day: d, hour: h });

test('periods: a day, a month, a year, several years; stepping back and forth', () => {
  const t = Y(1453, 5, 29, 14);
  const day: PeriodSpec = { unit: 'day', years: 1 }, month: PeriodSpec = { unit: 'month', years: 1 }, year: PeriodSpec = { unit: 'year', years: 1 }, decade: PeriodSpec = { unit: 'years', years: 10 };
  assert.deepEqual(periodAround(t, day), { from: Y(1453, 5, 29), to: Y(1453, 5, 30) });
  assert.deepEqual(periodAround(t, month), { from: Y(1453, 5, 1), to: Y(1453, 6, 1) });
  assert.deepEqual(periodAround(Y(1453, 12, 31), month), { from: Y(1453, 12, 1), to: Y(1454, 1, 1) });
  assert.deepEqual(periodAround(t, year), { from: Y(1453), to: Y(1454) });
  assert.deepEqual(periodAround(t, decade), { from: Y(1450), to: Y(1460) });
  assert.deepEqual(periodAround(Y(-5), decade), { from: Y(-10), to: Y(0) }, 'before year 1 too');
  assert.deepEqual(stepPeriod(t, year, 1), Y(1454));
  assert.deepEqual(stepPeriod(t, year, -1), Y(1452));
  assert.deepEqual(stepPeriod(t, month, -1), Y(1453, 4, 1));
  assert.deepEqual(stepPeriod(Y(1453, 1, 15), month, -1), Y(1452, 12, 1));
  assert.equal(periodLabel(Y(1450), Y(1460), decade), '1450–1459');
  assert.equal(periodLabel(Y(1453), Y(1454), year), '1453');
});

test("a country's gains and losses in a period, and the changes that made them", () => {
  const world = new World();
  const space = cmd.seedProject(world, 'History').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const A = cmd.createEntity(world, { type_id: 'polity', name: 'A' }).result, B = cmd.createEntity(world, { type_id: 'polity', name: 'B' }).result;
  const paint = (pts: Array<[number, number]>, value: string, eventId: string) => cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'new', eventId } });
  cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(square(0, 0, 10)), value: A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const war = cmd.createEvent(world, { name: 'War', start: Y(1450, 6, 1) }).result;
  paint(square(5, 5, 3), B, war); // A loses the north-east corner to B
  const revenge = cmd.createEvent(world, { name: 'Revenge', start: Y(1462) }).result;
  paint(square(-15, 0, 4), A, revenge); // A gains land to the west
  const flip = cmd.createEvent(world, { name: 'Flip', start: Y(1470, 3) }).result;
  paint(square(-5, -5, 2), B, flip);
  const flop = cmd.createEvent(world, { name: 'Flop', start: Y(1470, 9) }).result;
  paint(square(-5, -5, 2), A, flop); // lost and won back within 1470

  const y1450 = countryPeriodChanges(world, engine, space, layer, A, Y(1450), Y(1451));
  assert.ok(y1450.lostArea > 0 && y1450.gainedArea === 0, '1450: lost only');
  assert.equal(y1450.changes.length, 1);
  assert.equal(y1450.changes[0].eventId, war);
  assert.deepEqual(y1450.changes[0].to, [B]);
  assert.equal(compare(y1450.changes[0].t, Y(1450, 6, 1)), 0);
  assert.ok(y1450.held.length > 0 && y1450.lost.length > 0);

  const y1462 = countryPeriodChanges(world, engine, space, layer, A, Y(1462), Y(1463));
  assert.ok(y1462.gainedArea > 0 && y1462.lostArea === 0, '1462: gained only');
  assert.deepEqual(y1462.changes[0].from, [null], 'the land was nobody\'s before');

  const decade = countryPeriodChanges(world, engine, space, layer, A, Y(1450), Y(1460));
  assert.equal(decade.changes.length, 1, '1450s: only the war (1462 is in the next decade)');

  const y1470 = countryPeriodChanges(world, engine, space, layer, A, Y(1470), Y(1471));
  assert.equal(y1470.gained.length + y1470.lost.length, 0, 'lost and won back within the year: no net change');
  assert.equal(y1470.changes.length, 2, 'but both changes are listed');
  const b1470 = countryPeriodChanges(world, engine, space, layer, B, Y(1470), Y(1471));
  assert.equal(b1470.changes.length, 2);

  // The areas add up: what A holds at the end of 1450 is what it held before, less what it lost.
  const area = (faces: number[]) => faces.reduce((s, f) => s + world.arrangement(space).faceArea(f), 0);
  const before1450 = countryPeriodChanges(world, engine, space, layer, A, Y(1449), Y(1450));
  assert.ok(Math.abs(area(before1450.held) - y1450.lostArea - area(y1450.held)) < 1e-12);
});
