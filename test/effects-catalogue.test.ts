// The Effects panel's catalogue (D238): every effect in its folder, what each can be given to, and what giving it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogue, FOLDERS, givesTo, receiversText, withEffect, borderWith, labelWith, filterItems } from '../src/render-engine/effects-catalogue.ts';
import { EFFECT_KINDS, EFFECT_DEFAULTS, layerLookOf, countryLookOf } from '../src/render-engine/country-look.ts';
import { DEFAULT_BORDER } from '../src/render-engine/border-look.ts';
import { GRAPHIC_TEMPLATES } from '../src/presentation/graphic-style.ts';
import { TRANSITION_LOOKS } from '../src/presentation/sequence.ts';

test('every effect the software has, in its folder; looks kept under names in "Saved by you"', () => {
  const items = catalogue([{ id: 'look-1', name: 'Gold edge', look: countryLookOf({ effects: [{ kind: 'stroke' }, { kind: 'bevel' }] })! }]);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'each its own id');
  for (const f of FOLDERS) assert.ok(items.some((i) => i.folder === f.id), `${f.name} has effects`);
  assert.deepEqual(items.filter((i) => i.folder === 'countries').map((i) => (i as { kind: string }).kind), EFFECT_KINDS, 'every kind of a country\'s effect');
  assert.equal(items.filter((i) => i.folder === 'graphics').length, GRAPHIC_TEMPLATES.length);
  assert.equal(items.filter((i) => i.folder === 'transitions').length, TRANSITION_LOOKS.length);
  const saved = items.filter((i) => i.folder === 'saved');
  assert.equal(saved.length, 1);
  assert.match(saved[0].note, /2 effects/);
  assert.equal(catalogue().filter((i) => i.folder === 'saved').length, 0, 'none kept: an empty folder');
  for (const i of items) assert.ok(i.name && i.note, `${i.id} named and explained`);
});

test('what each folder\'s effects are given to', () => {
  const items = catalogue();
  const first = (folder: string) => items.find((i) => i.folder === folder)!;
  assert.ok(givesTo(first('countries'), 'country') && givesTo(first('countries'), 'group') && givesTo(first('countries'), 'layer'));
  assert.ok(!givesTo(first('countries'), 'event') && !givesTo(first('countries'), 'shot'));
  assert.ok(givesTo(first('borders'), 'layer') && givesTo(first('borders'), 'country'), 'a border effect on a country goes to its layer');
  assert.ok(givesTo(first('labels'), 'country') && givesTo(first('labels'), 'group') && !givesTo(first('labels'), 'layer'));
  assert.ok(givesTo(first('graphics'), 'shot') && !givesTo(first('graphics'), 'country'));
  assert.ok(givesTo(first('transitions'), 'event') && givesTo(first('transitions'), 'shot') && !givesTo(first('transitions'), 'group'));
  assert.equal(receiversText(first('borders')), 'a layer');
  assert.equal(receiversText(first('transitions')), 'an event or a shot');
  assert.equal(receiversText(first('countries')), 'a country, a group or a layer');
});

test('giving an effect: added to a look at its defaults (in the map\'s light where it takes one), laid on a border or a label', () => {
  const l = withEffect(null, 'shadow');
  assert.deepEqual(l, { elevation: 0, opacity: 1, effects: [{ ...EFFECT_DEFAULTS.shadow, light: 'map' }] });
  const two = withEffect(l, 'stroke');
  assert.deepEqual(two.effects.map((e) => e.kind), ['shadow', 'stroke'], 'at the end of the stack');
  assert.equal((two.effects[1] as { light?: string }).light, undefined, 'a stroke takes no light');
  const layer = layerLookOf({ blend: 'multiply', effects: [] })!;
  assert.equal((withEffect(layer, 'bevel') as typeof layer).blend, 'multiply', 'a layer\'s blend kept');
  assert.equal(withEffect(countryLookOf({ effects: Array.from({ length: 16 }, () => ({ kind: 'stroke' })) }), 'shadow').effects.length, 16, 'at most sixteen');
  assert.deepEqual(borderWith(null, { dash: 'dotted' }), { ...DEFAULT_BORDER, dash: 'dotted' });
  assert.deepEqual(borderWith({ ...DEFAULT_BORDER, color: '#ff0000', dash: 'dashed' }, { double: 3 }), { ...DEFAULT_BORDER, color: '#ff0000', dash: 'dashed', double: 3 }, 'the rest kept');
  assert.deepEqual(labelWith({ text: 'Arcady', italic: false }, { italic: true, uppercase: true }), { text: 'Arcady', italic: true, uppercase: true });
});

test('effects found by a word of their names', () => {
  const items = catalogue();
  const names = (q: string) => filterItems(items, q).map((i) => i.name);
  assert.deepEqual(names('dash'), ['Dashed', 'Long dashes', 'Dash and dot']);
  assert.ok(names('glow').includes('Outer glow') && names('glow').includes('Inner glow') && names('glow').includes('Glow'));
  assert.deepEqual(names('inner sh'), ['Inner shadow']);
  assert.equal(filterItems(items, '  ').length, items.length);
});
