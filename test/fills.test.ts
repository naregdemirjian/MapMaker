// Country fills: pictures and videos instead of colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { videoTime } from '../src/render-engine/assets.ts';
import { World } from '../src/world-model/world.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import * as cmd from '../src/domain/commands.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('video time: loops, plays once and holds, speed and start offset', () => {
  assert.equal(videoTime(4, 1, {}), 1);
  assert.equal(videoTime(4, 5, { play: 'loop' }), 1, 'loops');
  assert.equal(videoTime(4, 5, { play: 'once' }), 4 - 0.04, 'holds the last frame');
  assert.equal(videoTime(4, 1, { speed: 2 }), 2);
  assert.equal(videoTime(4, 1, { start: 2.5 }), 3.5);
  assert.equal(videoTime(4, 1, { start: 3.5, play: 'loop' }), 0.5);
  assert.equal(videoTime(0, 3, {}), 0, 'unknown length: first frame');
});

test('fill command: picture and video fills are stored, colour removes them, and it all undoes', () => {
  const world = new World();
  cmd.seedProject(world, 'Fills');
  const varn = cmd.createEntity(world, { type_id: 'polity', name: 'Varn' }).result;
  const steps: cmd.CommandResult[] = [];
  steps.push(cmd.setEntityStyle(world, varn, { fill: { kind: 'image', asset: 'data/flags/fr.svg', fit: 'cover' } }));
  assert.deepEqual(cmd.entityStyle(world.get('entity', varn)).fill, { kind: 'image', asset: 'data/flags/fr.svg', fit: 'cover' });
  steps.push(cmd.setEntityStyle(world, varn, { label: { color: '#ff0000' } }));
  assert.equal(cmd.entityStyle(world.get('entity', varn)).fill?.asset, 'data/flags/fr.svg', 'a label change keeps the fill');
  steps.push(cmd.setEntityStyle(world, varn, { fill: { kind: 'video', asset: 'abc.mp4', play: 'once', speed: 2 } }));
  assert.equal(cmd.entityStyle(world.get('entity', varn)).fill?.kind, 'video');
  assert.throws(() => cmd.setEntityStyle(world, varn, { fill: { kind: 'image' } }), /Choose a picture/);
  steps.push(cmd.setEntityStyle(world, varn, { fill: { kind: 'color' } }));
  assert.equal(cmd.entityStyle(world.get('entity', varn)).fill, undefined);
  for (const r of steps.reverse()) world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(world.get('entity', varn)!.style, '{}');
});

test("flags: today's 197 nations and 40 territories (Greenland…), each with its drawing, and a credit record", () => {
  const list = JSON.parse(readFileSync(join(root, 'data', 'flags', 'index.json'), 'utf8')) as Array<{ code: string; name: string; territory?: boolean; of?: string }>;
  assert.equal(list.filter((f) => !f.territory).length, 197);
  assert.equal(list.filter((f) => f.territory).length, 40);
  for (const n of ['France', 'Japan', 'Brazil', 'Vatican City', 'Palestine', 'Kosovo', 'Taiwan', 'South Sudan', 'China']) assert.ok(list.some((f) => f.name === n && !f.territory), n);
  assert.deepEqual(list.find((f) => f.name === 'Greenland'), { code: 'gl', name: 'Greenland', territory: true, of: 'Denmark' });
  assert.ok(!list.some((f) => f.code === 'eh' || f.code === 'aq'), 'no flag for disputed Western Sahara, nor the unofficial Antarctic design');
  for (const f of list) assert.ok(existsSync(join(root, 'data', 'flags', `${f.code}.svg`)), f.code);
  const rec = (JSON.parse(readFileSync(join(root, 'data', 'datasets.json'), 'utf8')) as Array<{ id: string; licence: string }>).find((d) => d.id === 'flag-icons')!;
  assert.match(rec.licence, /MIT/);
});
