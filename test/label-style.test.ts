// Country label looks: the general style, per-country overrides, and their commands with undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLabelStyle, labelSize, labelFont, labelText, DEFAULT_LABEL_STYLE } from '../src/render-engine/label-style.ts';
import { World } from '../src/world-model/world.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import * as cmd from '../src/domain/commands.ts';

test('label style: defaults, layering (general then country), and broken values fall back', () => {
  assert.deepEqual(resolveLabelStyle(), DEFAULT_LABEL_STYLE);
  const general = { font: 'Georgia', uppercase: true, color: '#112233' };
  const own = { color: '#ff0000', sizeScale: 2 };
  const s = resolveLabelStyle(general, own);
  assert.equal(s.font, 'Georgia');
  assert.equal(s.uppercase, true);
  assert.equal(s.color, '#ff0000', 'the country wins');
  assert.equal(s.sizeScale, 2);
  const broken = resolveLabelStyle({ weight: 5000, opacity: -3, font: '', sizeScale: Number.NaN, minSize: 30, maxSize: 10 } as never);
  assert.equal(broken.weight, 900);
  assert.equal(broken.opacity, 0);
  assert.equal(broken.font, DEFAULT_LABEL_STYLE.font);
  assert.equal(broken.sizeScale, 1);
  assert.equal(broken.maxSize, 30, 'largest is never below smallest');
});

test('label style: size scaling and clamping, font string, text overrides and capitals', () => {
  const s = resolveLabelStyle({ sizeScale: 2, minSize: 12, maxSize: 40 });
  assert.equal(labelSize(s, 10), 20);
  assert.equal(labelSize(s, 3), 12);
  assert.equal(labelSize(s, 100), 40);
  assert.equal(labelFont(resolveLabelStyle({ font: 'Times New Roman', italic: true, weight: 700 }), 20), 'italic 700 20.0px "Times New Roman", "Segoe UI", Arial, sans-serif');
  assert.equal(labelText('Varn', resolveLabelStyle({ uppercase: true })), 'VARN');
  assert.equal(labelText('Varn', resolveLabelStyle(), { text: 'Kingdom of Varn' }), 'Kingdom of Varn');
  assert.equal(labelText('Varn', resolveLabelStyle(), { text: '   ' }), 'Varn', 'blank text means the name');
});

test('label style commands: general style and per-country looks are stored, merged, reset and undone', () => {
  const world = new World();
  cmd.seedProject(world, 'Labels');
  const varn = cmd.createEntity(world, { type_id: 'polity', name: 'Varn' }).result;
  const steps: cmd.CommandResult[] = [];
  const run = (r: cmd.CommandResult) => { steps.push(r); return r; };
  run(cmd.setGeneralLabelStyle(world, { font: 'Georgia', uppercase: true }));
  run(cmd.setGeneralLabelStyle(world, { color: '#00ff00' }));
  assert.deepEqual(cmd.generalLabelStyle(world), { font: 'Georgia', uppercase: true, color: '#00ff00' }, 'fields merge');
  run(cmd.setGeneralLabelStyle(world, { uppercase: null }));
  assert.deepEqual(cmd.generalLabelStyle(world), { font: 'Georgia', color: '#00ff00' }, 'null resets one field');

  run(cmd.setEntityStyle(world, varn, { label: { color: '#ff0000', text: 'Kingdom of Varn' } }));
  assert.deepEqual(cmd.entityStyle(world.get('entity', varn)).label, { color: '#ff0000', text: 'Kingdom of Varn' });
  run(cmd.setEntityStyle(world, varn, { label: { hidden: true, text: undefined, color: '' as never } }));
  assert.deepEqual(cmd.entityStyle(world.get('entity', varn)).label, { hidden: true }, 'empty values are dropped');
  run(cmd.setEntityStyle(world, varn, { label: null }));
  assert.deepEqual(cmd.entityStyle(world.get('entity', varn)), {}, 'back to the general look');
  assert.throws(() => cmd.setEntityStyle(world, 'ent_missing', { label: {} }), /no longer exists/);

  for (const r of steps.reverse()) world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(world.get('meta', 'label_style'), undefined, 'undo removes the general style row');
  assert.equal(world.get('entity', varn)!.style, '{}');
});

test('city style (D219): as maps online by default, made whole when broken; importance; fewer cities zoomed out', async () => {
  const { resolveCityStyle, DEFAULT_CITY_STYLE, cityImportance, cityThreshold, cityClass } = await import('../src/render-engine/label-style.ts');
  assert.deepEqual(resolveCityStyle(null), DEFAULT_CITY_STYLE);
  assert.deepEqual(resolveCityStyle('{broken'), DEFAULT_CITY_STYLE);
  const odd = resolveCityStyle(JSON.stringify({ dots: 'no', dotStyle: 'star', dotSize: 99, nameSize: 0, density: -2, fade: false }));
  assert.equal(odd.dots, true);
  assert.equal(odd.dotStyle, 'map');
  assert.equal(odd.dotSize, 4);
  assert.equal(odd.nameSize, 0.3);
  assert.equal(odd.density, 0.2);
  assert.equal(odd.fade, false);
  // A capital of millions ranks above a larger city that is not one, a city of a million above a town; one's own cities have none.
  const ankara = cityImportance({ population: 3_700_000, capital: 'national', economic: 2 })!, istanbul = cityImportance({ population: 11_000_000, capital: null, economic: 3 })!;
  const trabzon = cityImportance({ population: 800_000, capital: null })!, kars = cityImportance({ population: 80_000, capital: null })!;
  assert.ok(ankara > istanbul && istanbul > trabzon && trabzon > kars);
  assert.equal(cityImportance(null), null);
  assert.deepEqual([cityClass(ankara), cityClass(istanbul), cityClass(trabzon), cityClass(kars), cityClass(null), cityClass(6.5)], [0, 0, 2, 2, 1, 1]);
  // Zoomed out only the most important: seen whole (about 4 pixels a degree) Ankara but not Trabzon; a region (60) Trabzon too; close in, Kars.
  assert.ok(ankara >= cityThreshold(4) && trabzon < cityThreshold(4));
  assert.ok(trabzon >= cityThreshold(60) && kars < cityThreshold(60));
  assert.ok(kars >= cityThreshold(400));
  // "How many": twice as many lowers the bar.
  assert.ok(cityThreshold(30, 2) < cityThreshold(30, 1) && cityThreshold(30, 0.5) > cityThreshold(30, 1));
  // Rated: a rating wins over its people, and a city of one's own has one only when rated.
  assert.equal(cityImportance({ population: 80_000, capital: null }, 6.8), 6.8);
  assert.equal(cityImportance(null, 7.6), 7.6);
  assert.equal(cityImportance(null, 99), 9);
});

test('city importance (D219): rated, unrated again, one undo each', () => {
  const world = new World();
  const city = cmd.createEntity(world, { type_id: 'settlement', name: 'Port Aster' }).result;
  const country = cmd.createEntity(world, { type_id: 'polity', name: 'Varn' }).result;
  const rated = cmd.setCityImportance(world, city, 5.2);
  assert.equal(cmd.entityStyle(world.get('entity', city)).importance, 5.2);
  const unrated = cmd.setCityImportance(world, city, null);
  assert.equal(cmd.entityStyle(world.get('entity', city)).importance, undefined);
  assert.throws(() => cmd.setCityImportance(world, country, 6), /no longer exists/);
  world.applyDiffs(invertDiffs(unrated.diffs));
  assert.equal(cmd.entityStyle(world.get('entity', city)).importance, 5.2);
  world.applyDiffs(invertDiffs(rated.diffs));
  assert.equal(world.get('entity', city)!.style, '{}');
});

test('seen far out, no cities; their names smaller than countries\' (D229)', async () => {
  const { citiesShown, cityNameSize, CITIES_FROM, DEFAULT_LABEL_STYLE } = await import('../src/render-engine/label-style.ts');
  // The whole world in a 1920 frame is some 5.3 pixels a degree: none. Fading in past CITIES_FROM; all closer in.
  assert.equal(citiesShown(5.3), 0);
  assert.equal(citiesShown(CITIES_FROM), 0);
  assert.ok(citiesShown(CITIES_FROM + 1.5) > 0 && citiesShown(CITIES_FROM + 1.5) < 1);
  assert.equal(citiesShown(40), 1);
  // Names: 13, 12, 11 closed in, smaller far out; never above a country's smallest label size and a little.
  assert.deepEqual([0, 1, 2].map((c) => cityNameSize(c, 200)), [13, 12, 11]);
  assert.ok(cityNameSize(0, 13) < 13 && cityNameSize(0, 13) >= 13 * 0.85 - 1e-9);
  assert.equal(cityNameSize(0, 200, 0), cityNameSize(2, 200, 0), 'all alike');
  assert.ok(cityNameSize(0, 200) <= DEFAULT_LABEL_STYLE.minSize * 1.3);
});
