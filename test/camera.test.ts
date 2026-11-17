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

test('a map shaped by its middle meridian can hold it: the camera stays in the middle, moving only shifts the picture, panning follows the map', () => {
  const places: Array<[number, number]> = [[2.35, 48.86], [30.5, 50.45], [-9.14, 38.72], [18.07, 59.33], [37.62, 55.75], [12.5, 41.9]];
  for (const projection of ['equalEarth', 'naturalEarth'] as const) {
    const rest: Camera = { lon: 12, lat: 46, zoom: 3.2, rotation: 0, projection };
    const v0 = makeView(rest, 1100, 640);
    // Holding the camera's own meridian changes nothing.
    const same = makeView({ ...rest, meridian: 12 }, 1100, 640);
    assert.equal(same.key, v0.key);
    for (const [lon, lat] of places) assert.deepEqual(lonLatToScreen(same, lon, lat), lonLatToScreen(v0, lon, lat));

    // The map dragged by whole pixels, the meridian held: every place moves by exactly those pixels.
    let cam: Camera = { ...rest, meridian: 12 };
    let view = v0, dx = 0, dy = 0;
    for (const [mx, my] of [[37, 0], [-5, 23], [120, -61], [-333, 40], [9, -150], [1, 1]]) {
      const next = panCamera(cam, view, mx, my);
      assert.equal(next.meridian, 12, 'the meridian is the view\'s to keep');
      cam = next; view = makeView(cam, 1100, 640); dx += mx; dy += my;
      assert.notEqual(view.key, makeView({ ...cam, meridian: undefined }, 1100, 640).key, 'a held view is another view than the camera\'s own');
      const mid = lonLatToScreen(view, cam.lon, cam.lat)!;
      assert.ok(Math.hypot(mid[0] - 550, mid[1] - 320) < 1e-6, 'the camera is in the middle of the frame');
      for (const [lon, lat] of places) {
        const a = lonLatToScreen(v0, lon, lat)!, b = lonLatToScreen(view, lon, lat)!;
        assert.ok(Math.hypot(b[0] - a[0] - dx, b[1] - a[1] - dy) < 1e-6, `${projection}: ${lon}, ${lat} moved by ${(b[0] - a[0]).toFixed(4)}, ${(b[1] - a[1]).toFixed(4)} for ${dx}, ${dy}`);
      }
    }
    assert.ok(Math.abs(cam.lon - 12) > 5, 'the camera did move east or west');
    // Laid out around the camera again, the same places lie elsewhere (the map has another shape), a little.
    const again = makeView({ ...cam, meridian: undefined }, 1100, 640);
    const shift = Math.max(...places.map(([lon, lat]) => { const a = lonLatToScreen(view, lon, lat)!, b = lonLatToScreen(again, lon, lat)!; return Math.hypot(a[0] - b[0], a[1] - b[1]); }));
    assert.ok(shift > 0.5 && shift < 120, `at rest the picture changes by up to ${shift.toFixed(1)} px`);

    // Zooming at the pointer in a held view keeps the place under the pointer, and the meridian.
    const before = screenToLonLat(view, 800, 200)!;
    const zoomed = zoomCameraAt(cam, 1100, 640, 800, 200, 0.7);
    assert.equal(zoomed.meridian, 12);
    const after = screenToLonLat(makeView(zoomed, 1100, 640), 800, 200)!;
    assert.ok(angDiff(before[0], after[0]) < 1e-4 && Math.abs(before[1] - after[1]) < 1e-4, `zoom anchor in a held view (${projection})`);
  }
  // Maps that only shift when moved east or west hold nothing: a meridian given is ignored.
  for (const projection of ['equirectangular', 'mercator'] as const) {
    const cam: Camera = { lon: 40, lat: 30, zoom: 2, rotation: 0, projection };
    const a = makeView(cam, 1100, 640), b = makeView({ ...cam, meridian: 10 }, 1100, 640);
    assert.equal(a.key, b.key);
    assert.deepEqual(lonLatToScreen(a, 55, 41), lonLatToScreen(b, 55, 41));
  }
});
