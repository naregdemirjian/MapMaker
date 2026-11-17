// Shapes cut into blocks (render-engine/blocks.ts): inside a block, what is kept of a shape fills
// and shows exactly as the whole shape does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, type Sub } from '../src/render-engine/blocks.ts';
import { cleanViewSettings, presetOf, PRESETS, DEFAULT_VIEW_SETTINGS } from '../src/ui/view-settings.ts';

/** A small repeatable random number generator. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** How many times the shapes wind round a point (closed shapes only). */
function winding(subs: Sub[], x: number, y: number): number {
  let w = 0;
  for (const s of subs) {
    if (!s.closed) continue;
    const a = s.pts, n = a.length >> 1;
    for (let i = 0; i < n; i++) {
      const x0 = a[2 * i], y0 = a[2 * i + 1], j = (i + 1) % n, x1 = a[2 * j], y1 = a[2 * j + 1];
      if ((y0 <= y) !== (y1 <= y)) {
        const cross = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y1 > y0 ? cross > 0 : cross < 0) w += y1 > y0 ? 1 : -1;
      }
    }
  }
  return w;
}

/** The distance from a point to the nearest piece of the shapes. */
function nearest(subs: Sub[], x: number, y: number): number {
  let best = Infinity;
  for (const s of subs) {
    const a = s.pts, n = a.length >> 1, m = s.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const x0 = a[2 * i], y0 = a[2 * i + 1], j = (i + 1) % n, x1 = a[2 * j], y1 = a[2 * j + 1];
      const dx = x1 - x0, dy = y1 - y0, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l)) : 0;
      best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
    }
  }
  return best;
}

test('a block keeps what matters inside it: the same fill and the same lines', () => {
  const r = rng(7);
  let dropped = 0, kept = 0;
  for (let round = 0; round < 60; round++) {
    // Wandering shapes (crossing themselves freely), closed and open, over a 1000 x 1000 square.
    const subs: Sub[] = [];
    for (let k = 0; k < 6; k++) {
      const n = 20 + Math.floor(r() * 300);
      const pts = new Float32Array(2 * n);
      let x = r() * 1000, y = r() * 1000;
      const step = 5 + r() * 120;
      for (let i = 0; i < n; i++) { x += (r() - 0.5) * step; y += (r() - 0.5) * step; pts[2 * i] = x; pts[2 * i + 1] = y; }
      subs.push({ pts, closed: k % 3 !== 0 });
    }
    const x0 = r() * 800, y0 = r() * 800, x1 = x0 + 30 + r() * 300, y1 = y0 + 30 + r() * 300;
    const red = reduce(subs, x0, y0, x1, y1);
    const before = subs.reduce((a, s) => a + (s.pts.length >> 1), 0);
    assert.equal(red.n, red.subs.reduce((a, s) => a + (s.pts.length >> 1), 0), 'the number of points is reported');
    assert.ok(red.n <= before);
    dropped += before - red.n; kept += red.n;
    for (let q = 0; q < 200; q++) {
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
      assert.equal(winding(red.subs, x, y), winding(subs, x, y), `the same winding at ${x}, ${y} (round ${round})`);
      // Lines: whatever passes within the block is still there (compared where it shows: up to the block's edge).
      const reach = Math.min(x - x0, x1 - x, y - y0, y1 - y);
      const a = nearest(subs, x, y), b = nearest(red.subs, x, y);
      if (a < reach || b < reach) assert.ok(Math.abs(a - b) < 1e-3, `the same lines near ${x}, ${y}: ${a} vs ${b} (round ${round})`);
    }
  }
  assert.ok(dropped > kept, `most points outside a block are left out (${dropped} dropped, ${kept} kept)`);
});

test('a shape wholly to one side of a block is left out; one around the block stays around it', () => {
  const far: Sub = { pts: Float32Array.from([500, 0, 600, 50, 550, 300, 480, 120]), closed: true };
  assert.equal(reduce([far], 0, 0, 100, 100).subs.length, 0);
  const around: Sub = { pts: Float32Array.from([-500, -500, 0, -520, 600, -500, 620, 50, 600, 600, 40, 640, -500, 600, -520, 30]), closed: true };
  const red = reduce([around], 0, 0, 100, 100);
  assert.equal(winding(red.subs, 50, 50), winding([around], 50, 50));
  assert.notEqual(winding(red.subs, 50, 50), 0);
});

test('working-view settings: stored values are made valid, presets are recognised', () => {
  assert.deepEqual(cleanViewSettings(null), DEFAULT_VIEW_SETTINGS);
  assert.deepEqual(cleanViewSettings({ resolution: 3, detail: 'huge', whileMoving: 'redraw', names: 'hide', coast: 'medium', showSpeed: true }),
    { ...DEFAULT_VIEW_SETTINGS, whileMoving: 'redraw', names: 'hide', coast: 'medium', showSpeed: true });
  assert.equal(presetOf(DEFAULT_VIEW_SETTINGS), 'balanced');
  assert.equal(presetOf({ ...PRESETS.fastest.settings, showSpeed: true }), 'fastest');
  assert.equal(presetOf({ ...PRESETS.best.settings, showSpeed: false, names: 'hide' }), null);
});
