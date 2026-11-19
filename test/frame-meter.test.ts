// The frames-a-second readout (D143): counted over the last second, with the longest wait between two frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameMeter } from '../src/ui/frame-meter.ts';

test('a steady screen reads its rate; a hitch shows as the longest wait; a pause starts the count again', () => {
  const m = new FrameMeter();
  assert.equal(m.read(), null);
  m.frame(0);
  assert.equal(m.read(), null, 'one frame: no wait to measure yet');
  let t = 0;
  for (let i = 0; i < 180; i++) m.frame((t += 1000 / 60));
  let r = m.read()!;
  assert.equal(r.perSecond, 60);
  assert.ok(Math.abs(r.longest - 1000 / 60) < 1e-6);
  // A screen of 144 frames a second.
  const fast = new FrameMeter();
  for (let i = 0, x = 0; i < 400; i++) fast.frame((x += 1000 / 144));
  assert.equal(fast.read()!.perSecond, 144);
  // One frame takes 120 ms (seven frames missed): fewer frames that second, and the wait is told.
  m.frame((t += 120));
  for (let i = 0; i < 20; i++) m.frame((t += 1000 / 60));
  r = m.read()!;
  assert.ok(r.perSecond < 58 && r.perSecond > 45, `${r.perSecond} frames a second`);
  assert.ok(Math.abs(r.longest - 120) < 1e-6);
  // A second on, the hitch is out of the count.
  for (let i = 0; i < 70; i++) m.frame((t += 1000 / 60));
  r = m.read()!;
  assert.equal(r.perSecond, 60);
  assert.ok(r.longest < 17);
  // The window hidden for five seconds: counting starts again, the pause is not a hitch.
  m.frame((t += 5000));
  assert.equal(m.read(), null);
  for (let i = 0; i < 30; i++) m.frame((t += 1000 / 60));
  r = m.read()!;
  assert.equal(r.perSecond, 60);
  assert.ok(r.longest < 17);
});
