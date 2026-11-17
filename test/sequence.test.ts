// Shots: screen-time arithmetic used by transitions timed in screen seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultShot, screenSecondsSince, timeAt, shotTransitions, DEFAULT_TRANSITIONS } from '../src/presentation/sequence.ts';
import { gregorian } from '../src/core-time/index.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const cam = { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equirectangular' as const };

test('screen seconds since a historical instant, with even and eased pacing', () => {
  for (const ease of ['linear', 'smooth'] as const) {
    const shot = defaultShot('space', cam, Y(1900), Y(2000), 25, 10); // 250 frames
    shot.time = shot.time.map((k) => ({ ...k, ease }));
    // The frame that shows 1950, and 2 seconds (50 frames) after it.
    let f50 = 0;
    for (let f = 0; f < shot.frames; f++) if (timeAt(shot, f).day <= Y(1950).day) f50 = f;
    const s = screenSecondsSince(shot, f50 + 50, Y(1950));
    assert.ok(Math.abs(s - 2) < 0.05, `${ease}: ${s}`);
    assert.ok(Math.abs(screenSecondsSince(shot, 0, Y(1900))) < 1e-3, 'at the very start');
    assert.equal(screenSecondsSince(shot, 10, Y(1800)), Infinity, 'changes before the shot are over');
    assert.equal(screenSecondsSince(shot, 10, Y(2100)), -Infinity, 'changes after the shot have not begun');
  }
});

test('shot transitions: defaults fill in, saved settings win', () => {
  const shot = defaultShot('space', cam, Y(1900), Y(2000));
  assert.deepEqual(shotTransitions(shot), DEFAULT_TRANSITIONS);
  shot.transitions = { ...DEFAULT_TRANSITIONS, mode: 'instant', front: { ...DEFAULT_TRANSITIONS.front, color: '#ff0000' } };
  assert.equal(shotTransitions(shot).mode, 'instant');
  assert.equal(shotTransitions(shot).front.color, '#ff0000');
  assert.equal(shotTransitions(shot).front.width, DEFAULT_TRANSITIONS.front.width);
});

test('transition styles: the advancing front from the border is the default; old wipes show as it', () => {
  const shot = defaultShot('space', { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equirectangular' }, gregorian.fromCivil({ year: 1900 }), gregorian.fromCivil({ year: 1901 }));
  assert.equal(shotTransitions(shot).style, 'border');
  assert.equal(shotTransitions({ ...shot, transitions: { ...DEFAULT_TRANSITIONS, style: 'wipe', angle: 90 } }).style, 'border', 'a shot saved with the old wipe');
  assert.equal(shotTransitions({ ...shot, transitions: { ...DEFAULT_TRANSITIONS, style: 'advance' } }).style, 'advance', 'the expansion stays');
});
