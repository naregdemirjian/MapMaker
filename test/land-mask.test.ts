// The land mask's "is there any land in this box?" (used to drop the sea from searches for a label's
// place): never "no" where a cell in the box is land, and "yes" only with land in or right beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LandMask } from '../src/render-engine/basemap.ts';
import { rng } from './helpers.ts';

test('land mask: any land in a box, against looking at every cell', () => {
  const r = rng(5);
  const W = 720, H = 360, bits = new Uint8Array(W * H);
  // A few dozen blobs of land of all sizes, some across the line where longitudes start again.
  for (let k = 0; k < 40; k++) {
    const cx = r.int(0, W - 1), cy = r.int(0, H - 1), rx = r.int(1, 40), ry = r.int(1, 25);
    for (let y = Math.max(0, cy - ry); y <= Math.min(H - 1, cy + ry); y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) bits[y * W + ((x % W) + W) % W] = 1;
    }
  }
  const mask = new LandMask(W, H, bits);
  const cell = 360 / W;
  /** Land among the cells that a box reaches into, grown by `grow` cells on every side (looked at one by one). */
  const brute = (w: number, s: number, e: number, n: number, grow: number): boolean => {
    const x0 = Math.floor((w + 180) / cell) - grow, x1 = Math.floor((e + 180) / cell) + grow;
    const y0 = Math.max(0, Math.floor((90 - n) / cell) - grow), y1 = Math.min(H - 1, Math.floor((90 - s) / cell) + grow);
    if (x1 - x0 + 1 >= W) { for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) if (bits[y * W + x]) return true; return false; }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (bits[y * W + ((x % W) + W) % W]) return true;
    return false;
  };
  let yes = 0, no = 0;
  for (let i = 0; i < 6000; i++) {
    const big = i % 3 === 0;
    const w = r.float(-180, 180), s = r.float(-90, 88);
    const e = w + r.float(0, big ? 200 : 6), n = Math.min(90, s + r.float(0, big ? 120 : 6));
    const got = mask.anyLand(w, s, e, n);
    if (got) yes++; else no++;
    if (brute(w, s, e, n, 0)) assert.ok(got, `land in the box [${w}, ${s}, ${e}, ${n}] is seen`);
    if (got) assert.ok(brute(w, s, e, n, 2), `"yes" for [${w}, ${s}, ${e}, ${n}] means land in or right beside the box`);
  }
  assert.ok(yes > 500 && no > 500, `both answers occur (${yes} yes, ${no} no)`);
  // Every longitude at once, and a box across the 180° line.
  assert.equal(mask.anyLand(-180, -90, 180, 90), true);
  assert.equal(mask.anyLand(-500, -90, 500, 90), true);
});
