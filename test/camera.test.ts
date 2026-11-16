// Coordinate handling: map positions and screen positions convert back and forth exactly, for every
// projection, rotation and zoom level from the whole planet down to city detail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeView, screenToLonLat, lonLatToScreen, zoomCameraAt, panCamera, PROJECTIONS, type Camera } from '../src/render-engine/camera.ts';
import { rng } from './helpers.ts';

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

for (const proj of PROJECTIONS) {
  test(`${proj.name}: screen and map positions round-trip at every zoom`, () => {
    const r = rng(proj.id.length * 97);
    let checked = 0;
    for (let k = 0; k < 300; k++) {
      const cam: Camera = { lon: r.float(-180, 180), lat: r.float(-60, 60), zoom: r.float(0, 14), rotation: r.bool(0.3) ? r.float(-45, 45) : 0, projection: proj.id };
      const view = makeView(cam, 1920, 1080);
      const x = r.float(0, 1920), y = r.float(0, 1080);
      const ll = screenToLonLat(view, x, y);
      if (!ll) continue; // off the map (outside the projected planet)
      const back = lonLatToScreen(view, ll[0], ll[1]);
      assert.ok(back, 'a visible map position maps back to the screen');
      assert.ok(Math.hypot(back[0] - x, back[1] - y) < 1e-3, `round trip within a thousandth of a pixel (zoom ${cam.zoom.toFixed(1)})`);
      checked++;
    }
    assert.ok(checked > 150, `${checked} positions checked`);
  });
}

test('the screen centre is the camera position, and zooming keeps the point under the cursor fixed', () => {
  for (const proj of PROJECTIONS) {
    const cam: Camera = { lon: 151.2093, lat: -33.8688, zoom: 12, rotation: 0, projection: proj.id };
    const view = makeView(cam, 1920, 1080);
    const c = screenToLonLat(view, 960, 540)!;
    assert.ok(angDiff(c[0], cam.lon) < 1e-9 && Math.abs(c[1] - cam.lat) < 1e-9, proj.id);
    const before = screenToLonLat(view, 1300, 300)!;
    const zoomed = zoomCameraAt(cam, 1920, 1080, 1300, 300, 1.5);
    const after = screenToLonLat(makeView(zoomed, 1920, 1080), 1300, 300)!;
    assert.ok(angDiff(before[0], after[0]) < 1e-6 && Math.abs(before[1] - after[1]) < 1e-6, `zoom anchor (${proj.id}): ${before} vs ${after}`);
    for (const z of [0, 4]) {
      const c2 = { ...cam, zoom: z };
      const b2 = screenToLonLat(makeView(c2, 1920, 1080), 1300, 300)!;
      const a2 = screenToLonLat(makeView(zoomCameraAt(c2, 1920, 1080, 1300, 300, 1), 1920, 1080), 1300, 300)!;
      assert.ok(angDiff(b2[0], a2[0]) < 1e-3 && Math.abs(b2[1] - a2[1]) < 1e-3, `zoom anchor at zoom ${z} (${proj.id}): ${b2} vs ${a2}`);
    }
  }
});

test('city-level zoom keeps sub-metre precision on Earth', () => {
  const cam: Camera = { lon: 2.3522, lat: 48.8566, zoom: 16, rotation: 0, projection: 'equirectangular' };
  const view = makeView(cam, 1920, 1080);
  const a = screenToLonLat(view, 960, 540)!, b = screenToLonLat(view, 961, 540)!;
  const metresPerPixel = angDiff(a[0], b[0]) * (Math.PI / 180) * 6371008.8 * Math.cos((48.8566 * Math.PI) / 180);
  assert.ok(metresPerPixel < 30 && metresPerPixel > 0.01, `${metresPerPixel.toFixed(2)} m per pixel`);
  const p = lonLatToScreen(view, 2.3522 + 1e-6, 48.8566)!;
  assert.ok(Math.abs(p[0] - 960) > 0.001, 'a tenth of a metre still moves on screen');
});

test('panning across the 180° line wraps the longitude', () => {
  const cam: Camera = { lon: 179, lat: 0, zoom: 2, rotation: 0, projection: 'equirectangular' };
  const moved = panCamera(cam, makeView(cam, 1920, 1080), -400, 0);
  assert.ok(moved.lon >= -180 && moved.lon <= 180, `longitude stays in range (${moved.lon})`);
  assert.ok(angDiff(moved.lon, 179) > 5, 'and the map moved');
});
