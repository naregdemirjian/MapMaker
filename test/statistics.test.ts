// Statistics (D171): values at dates worked out between them, written as money or counts, filled into texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gregorian } from '../src/core-time/index.ts';
import { statisticAt, formatStatistic, fillStatistics, parseAmount, statKey, cleanStatistics, type Statistic } from '../src/presentation/statistics.ts';
import { overlaysAt, defaultShot, newTextBox } from '../src/presentation/sequence.ts';
import { defaultCamera } from '../src/render-engine/camera.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { statisticsOf } from '../src/world-model/world-settings.ts';

const Y = (y: number, month = 1, day = 1) => gregorian.fromCivil({ year: y, month, day });

test('a statistic between its dates: growing by a steady share, by a steady amount, or at once', () => {
  const gdp: Statistic = { name: 'GDP', format: 'money', ease: 'growth', keys: [statKey(Y(2046), 72e9), statKey(Y(2060), 1.2e12)] };
  assert.equal(statisticAt(gdp, Y(2000)), 72e9, 'the first value before its first date');
  assert.equal(statisticAt(gdp, Y(2100)), 1.2e12, 'the last after its last');
  const mid = statisticAt(gdp, gregorian.fromCivil({ year: 2053, month: 1, day: 1 }))!;
  assert.ok(Math.abs(mid / Math.sqrt(72e9 * 1.2e12) - 1) < 0.01, `half way in time, the geometric mean: ${mid}`);
  assert.ok(Math.abs(statisticAt({ ...gdp, ease: 'linear' }, Y(2053))! / ((72e9 + 1.2e12) / 2) - 1) < 0.01);
  assert.equal(statisticAt({ ...gdp, ease: 'step' }, Y(2059)), 72e9);
  assert.equal(statisticAt({ ...gdp, keys: [] }, Y(2050)), null);
});

test('written as people read them', () => {
  assert.equal(formatStatistic(72e9, 'money'), '$72.0 billion');
  assert.equal(formatStatistic(1.2e12, 'money'), '$1.20 trillion');
  assert.equal(formatStatistic(1.2e15, 'money'), '$1.20 quadrillion');
  assert.equal(formatStatistic(150e9, 'money'), '$150 billion');
  assert.equal(formatStatistic(90000, 'count'), '90,000');
  assert.equal(formatStatistic(6e9, 'count', 0), '6 billion');
  assert.equal(formatStatistic(-3, 'number'), '−3');
  assert.equal(formatStatistic(45, 'percent'), '45 %');
  assert.equal(parseAmount('72 billion'), 72e9);
  assert.equal(parseAmount('$1.2 trillion'), 1.2e12);
  assert.equal(parseAmount('90,000'), 90000);
  assert.equal(parseAmount('300k'), 3e5);
  assert.equal(parseAmount('1.5e9'), 1.5e9);
  assert.equal(parseAmount('lots'), null);
});

test('a map\'s statistics fill the {names} of a shot\'s texts, counting as history goes', () => {
  const stats: Statistic[] = [{ name: 'Dead', format: 'count', ease: 'linear', keys: [statKey(Y(2165), 0), statKey(Y(2166), 1.2e9)] }];
  assert.equal(fillStatistics('{date}: {dead} dead, {nothing}', stats, Y(2166)), '{date}: 1.20 billion dead, {nothing}');
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'Test').result;
  cmd.setMapStatistics(world, spaceId, stats);
  assert.equal(statisticsOf(world.get('map_space', spaceId))[0].name, 'Dead');
  assert.throws(() => cmd.setMapStatistics(world, spaceId, [...stats, { ...stats[0], name: 'DEAD' }]), /Two statistics/);
  const shot = defaultShot(spaceId, defaultCamera(), Y(2165), Y(2166), 24, 10);
  shot.overlays.push({ ...newTextBox(shot, 'Dead: {Dead}'), box: { ...newTextBox(shot, '').box!, timing: { by: 'shot', from: 0, to: null } } });
  const texts = (t: ReturnType<typeof Y>) => overlaysAt(shot, 0, t, gregorian, statisticsOf(world.get('map_space', spaceId))).map((o) => o.text);
  assert.ok(texts(Y(2165, 7, 2)).includes('Dead: 598 million'), texts(Y(2165, 7, 2)).join(' | '));
  assert.deepEqual(cleanStatistics([{ name: '' }, { name: ' X ', keys: [{ at: [5, 0], value: 1 }, { at: [1, 0], value: 2 }] }]).map((x) => [x.name, x.keys[0].value]), [['X', 2]]);
});
