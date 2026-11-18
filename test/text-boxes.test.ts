// Text boxes and callouts in shots (Stage 10, D107): their settings, when they show, how far they have
// come in or are from leaving, wrapping, and where a callout's pointer starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultShot, timeAt, textBoxOf, textBoxState, newTextBox, overlaysAt, wrapText, nearestOnRect, moveOverlay, DEFAULT_TEXT_BOX } from '../src/presentation/sequence.ts';
import { gregorian, toJSONValue } from '../src/core-time/index.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const cam = { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equirectangular' as const };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test('a text box\'s settings: defaults fill in, broken values fall back', () => {
  assert.deepEqual(textBoxOf(null), DEFAULT_TEXT_BOX);
  const b = textBoxOf({ weight: 5000, wrap: -3, enter: 'spin' as never, exit: 'sink', seconds: 2, anchor: [12.5, 41.9], timing: { by: 'history', from: [100, 0], to: null } });
  assert.equal(b.weight, 900);
  assert.equal(b.wrap, 0);
  assert.equal(b.enter, DEFAULT_TEXT_BOX.enter);
  assert.equal(b.exit, 'sink');
  assert.deepEqual(b.anchor, [12.5, 41.9]);
  assert.deepEqual(b.timing, { by: 'history', from: [100, 0], to: null });
  assert.deepEqual(textBoxOf({ timing: { by: 'history', from: 'soon' } as never }).timing, DEFAULT_TEXT_BOX.timing, 'a history timing without a date falls back');
  assert.deepEqual(textBoxOf({ anchor: [1, Number.NaN] as never }).anchor, null);
});

test('timed by the shot: shown from and to its seconds, coming in and going over its own seconds', () => {
  const shot = defaultShot('space', cam, Y(1900), Y(1910), 24, 2); // 48 frames
  const box = textBoxOf({ timing: { by: 'shot', from: 0.5, to: 1.5 }, seconds: 0.25 });
  assert.equal(textBoxState(shot, box, 11, timeAt(shot, 11)), null, 'not yet');
  const at = (f: number) => textBoxState(shot, box, f, timeAt(shot, f))!;
  assert.ok(near(at(12).enter, 0) && near(at(12).exit, 1), 'just come');
  assert.ok(near(at(15).enter, 0.5), 'half way in');
  assert.ok(near(at(24).enter, 1) && near(at(24).exit, 1), 'fully shown');
  assert.ok(near(at(33).exit, 0.5), 'half way out');
  assert.ok(near(at(36).exit, 0), 'gone at its end');
  assert.equal(textBoxState(shot, box, 37, timeAt(shot, 37)), null, 'gone');
  const forever = textBoxOf({ timing: { by: 'shot', from: 0, to: null }, seconds: 0 });
  assert.deepEqual(textBoxState(shot, forever, 47, timeAt(shot, 47)), { enter: 1, exit: 1 }, 'to the end, at once');
});

test('timed by history: shown while history is between its dates, coming in over seconds of the shot', () => {
  const shot = defaultShot('space', cam, Y(1900), Y(1910), 10, 10); // 100 frames, a year a second
  shot.time = shot.time.map((k) => ({ ...k, ease: 'linear' }));
  const box = textBoxOf({ timing: { by: 'history', from: toJSONValue(Y(1903)) as [number, number], to: toJSONValue(Y(1906)) as [number, number] }, seconds: 0.5 });
  const first = (pred: (f: number) => boolean) => { for (let f = 0; f < shot.frames; f++) if (pred(f)) return f; return -1; };
  const f1903 = first((f) => timeAt(shot, f).day >= Y(1903).day);
  assert.equal(textBoxState(shot, box, f1903 - 1, timeAt(shot, f1903 - 1)), null, 'before its first date');
  const s0 = textBoxState(shot, box, f1903, timeAt(shot, f1903))!;
  assert.ok(s0 && s0.enter < 0.25, `just come (${s0.enter})`);
  const s1 = textBoxState(shot, box, f1903 + 5, timeAt(shot, f1903 + 5))!;
  assert.ok(near(s1.enter, 1, 0.21) && s1.exit === 1, `in after half a second (${s1.enter})`);
  const f1906 = first((f) => timeAt(shot, f).day > Y(1906).day);
  const late = textBoxState(shot, box, f1906 - 2, timeAt(shot, f1906 - 2))!;
  assert.ok(late.exit < 0.5, `leaving as history reaches its last date (${late.exit})`);
  assert.equal(textBoxState(shot, box, f1906, timeAt(shot, f1906)), null, 'gone after');
  // From a date before the shot: fully in from the first frame.
  const early = textBoxOf({ timing: { by: 'history', from: toJSONValue(Y(1800)) as [number, number], to: null }, seconds: 1 });
  assert.deepEqual(textBoxState(shot, early, 0, timeAt(shot, 0)), { enter: 1, exit: 1 });
});

test('text boxes among a shot\'s overlays; wrapping by words; a callout\'s pointer starts at the box\'s nearest point', () => {
  const shot = defaultShot('space', cam, Y(1900), Y(1910), 24, 2);
  const a = newTextBox(shot, 'In {date}');
  const c = newTextBox({ ...shot, overlays: [...shot.overlays, a] }, 'Rome', [12.5, 41.9]);
  assert.notEqual(a.id, c.id);
  assert.equal(a.box!.anchor, null);
  assert.deepEqual(c.box!.anchor, [12.5, 41.9]);
  shot.overlays = [...shot.overlays, a, c];
  const drawn = overlaysAt(shot, 30, timeAt(shot, 30));
  const text = drawn.find((d) => d.overlay.id === a.id)!;
  assert.match(text.text, /^In \d+ \w+ 19\d\d$/, 'the date written in');
  assert.equal(text.enter, 1);
  // Moved like the date and the title.
  const moved = moveOverlay(shot, c.id, 0.1, -0.05);
  const mc = moved.overlays.find((o) => o.id === c.id)!;
  assert.ok(near(mc.x, c.x + 0.1) && near(mc.y, c.y - 0.05));
  const measure = (s: string) => s.length * 10;
  assert.deepEqual(wrapText('the quick brown fox', 100, measure), ['the quick', 'brown fox']);
  assert.deepEqual(wrapText('one\ntwo three', 0, measure), ['one', 'two three'], 'only where written');
  assert.deepEqual(wrapText('a extraordinarily b', 50, measure), ['a', 'extraordinarily', 'b'], 'a long word keeps a line');
  const r = { x: 10, y: 10, w: 100, h: 40 };
  assert.deepEqual(nearestOnRect(r, 300, 30), [110, 30]);
  assert.deepEqual(nearestOnRect(r, 0, 0), [10, 10]);
  assert.deepEqual(nearestOnRect(r, 50, 30), [50, 30], 'inside: the point itself');
});
