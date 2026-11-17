// Things kept up to a total weight (render-engine/kept.ts): what was used longest ago goes first,
// and the total never stays above the limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kept } from '../src/render-engine/kept.ts';

test('kept by weight: the oldest go first, a use renews, the newest always stays', () => {
  const k = new Kept<string, number[]>(10, (v) => v.length);
  k.set('a', [1, 2, 3, 4]);
  k.set('b', [1, 2, 3, 4]);
  assert.equal(k.weight, 8);
  assert.deepEqual(k.get('a'), [1, 2, 3, 4], 'a is now the one used last');
  k.set('c', [1, 2, 3, 4]);
  assert.equal(k.has('b'), false, 'b was used longest ago');
  assert.equal(k.has('a') && k.has('c'), true);
  assert.equal(k.weight, 8);

  k.set('a', [1]);
  assert.equal(k.weight, 5, 'a value set again counts once, at its new weight');
  k.set('huge', Array.from({ length: 50 }, () => 0));
  assert.equal(k.size, 1, 'everything else made way');
  assert.equal(k.has('huge'), true, 'the newest stays, however heavy');
  k.set('small', [1]);
  assert.equal(k.has('huge'), false);
  assert.equal(k.weight, 1);

  k.delete('small');
  assert.equal(k.weight, 0);
  assert.equal(k.size, 0);
});

test('kept by weight: the total stays within the limit over a long random run', () => {
  const k = new Kept<number, number>(1000, (v) => v);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 20000; i++) {
    const key = Math.floor(rnd() * 400);
    if (rnd() < 0.5) k.get(key);
    else if (rnd() < 0.05) k.delete(key);
    else k.set(key, 1 + Math.floor(rnd() * 90));
    assert.ok(k.weight <= 1000, `weight ${k.weight} at step ${i}`);
  }
  let sum = 0;
  for (let key = 0; key < 400; key++) if (k.has(key)) sum += k.get(key)!;
  assert.equal(sum, k.weight, 'the weight is the sum of what is held');
});
