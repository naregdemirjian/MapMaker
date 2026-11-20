// The arrow keys step the date viewed (D172).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gregorian } from '../src/core-time/index.ts';
import { arrowStep } from '../src/core-time/steps.ts';

test('the arrow keys step the date viewed (D172): a day, a week with Ctrl, a month with Ctrl+Shift, a year with Ctrl+Shift+Alt', () => {
  const t = gregorian.fromCivil({ year: 2066, month: 4, day: 24 });
  const k = (ctrlKey = false, shiftKey = false, altKey = false) => ({ ctrlKey, shiftKey, altKey, metaKey: false });
  const civil = (x: typeof t) => { const c = gregorian.toCivil(x); return `${c.year}-${c.month}-${c.day}`; };
  assert.equal(civil(arrowStep(t, 1, k())), '2066-4-25');
  assert.equal(civil(arrowStep(t, -1, k(true))), '2066-4-17');
  assert.equal(civil(arrowStep(t, 1, k(true, true))), '2066-5-24');
  assert.equal(civil(arrowStep(t, -1, k(true, true, true))), '2065-4-24');
  assert.equal(civil(arrowStep(t, 1, { ...k(), metaKey: true })), '2066-5-1', 'Cmd as Ctrl');
});
