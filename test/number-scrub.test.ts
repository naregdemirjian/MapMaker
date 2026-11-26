import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubValue } from '../src/ui/number-scrub.ts';

test('a drag moves the number a step at a time, within its limits (D228)', () => {
  assert.equal(scrubValue(2, 3, { step: 0.25 }), 2.75);
  assert.equal(scrubValue(2, -3, { step: 0.25 }), 1.25);
  assert.equal(scrubValue(5, 100, { step: 1, max: 40 }), 40);
  assert.equal(scrubValue(5, -100, { step: 1, min: 0 }), 0);
  // No step given: ones, as the box's own arrows.
  assert.equal(scrubValue(10, 4, {}), 14);
});

test('Shift moves ten times as far, Alt a tenth; no float dust', () => {
  assert.equal(scrubValue(1, 2, { step: 1, fast: true }), 21);
  assert.equal(scrubValue(1, 3, { step: 1, fine: true }), 1.3);
  assert.equal(scrubValue(0.1, 7, { step: 0.1 }), 0.8);
  assert.equal(scrubValue(1.5, 1, { step: 1, min: 0.5 }), 2.5);
});

test('a number between two steps goes first to the next step, as the box\'s own arrows do', () => {
  assert.equal(scrubValue(1.4, 1, { step: 0.25, min: 0 }), 1.5);
  assert.equal(scrubValue(1.4, 5, { step: 0.25, min: 0 }), 2.5);
  assert.equal(scrubValue(1.4, -2, { step: 0.25, min: 0 }), 1);
  assert.equal(scrubValue(1.5, 1, { step: 1 }), 2);
});
