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
