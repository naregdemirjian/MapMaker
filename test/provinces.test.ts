// Provinces of a generated planet (D179): the same every time; neighbours share their borders point for point (no
// gap or overlap between them); every point of land lies in exactly one province; borders are smoothed (no long
// staircases of the grid's cells).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlanet } from '../src/terrain/planet.ts';
import { heightAt } from '../src/terrain/grid.ts';
import { makeProvinces, type Province } from '../src/examples/provinces.ts';
import { ORRUN } from '../src/examples/fantasy.ts';

type Ring = Array<[number, number]>;
const inside = ([x, y]: [number, number], ring: Ring) => {
  let inn = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
};
const inProvince = (p: [number, number], q: Province) => q.polygons.some((poly) => [0, 360, -360].some((s) => inside([p[0] + s, p[1]], poly[0]) && !poly.slice(1).some((h) => inside([p[0] + s, p[1]], h))));

test('a planet\'s provinces are the same every time, share their borders exactly and cover its land once', () => {
  const grid = generatePlanet(ORRUN, 360, 180);
  const a = makeProvinces(grid, { seed: 7, spacing: 9, seaReach: 1.5, minLand: 2 });
  const b = makeProvinces(grid, { seed: 7, spacing: 9, seaReach: 1.5, minLand: 2 });
  assert.ok(a.length > 60, `${a.length} provinces`);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'the same provinces every time');
  // Every border piece is walked once by each province beside it, the two ways round: never twice the same way.
  const key = ([x0, y0]: [number, number], [x1, y1]: [number, number]) => {
    const n = (v: number) => (Math.round((((v + 180) % 360) + 360) % 360 * 1e6) / 1e6).toFixed(6);
    return `${n(x0)},${y0.toFixed(6)}>${n(x1)},${y1.toFixed(6)}`;
  };
  const seen = new Map<string, number>();
  for (const q of a) for (const poly of q.polygons) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    const k = key(ring[i], ring[(i + 1) % ring.length]);
    if (seen.has(k) && seen.get(k) !== q.id) assert.fail(`two provinces walk ${k} the same way`);
    seen.set(k, q.id);
  }
  let shared = 0;
  for (const [k, id] of seen) {
    const [from, to] = k.split('>');
    const back = seen.get(`${to}>${from}`);
    if (back === undefined) continue;
    assert.notEqual(back, id, 'a province does not border itself');
    shared++;
  }
  assert.ok(shared > 1000, `${shared} pieces of border shared between neighbours`);
  // Points of land (not too near the poles, nor on a cell's edge) lie in one province exactly.
  let tested = 0, missed = 0;
  for (let lat = -69.7; lat < 70; lat += 2.3) for (let lon = -179.3; lon < 180; lon += 2.9) {
    if (heightAt(grid, lon, lat) < 200) continue;
    const n = a.filter((q) => inProvince([lon, lat], q)).length;
    assert.ok(n <= 1, `(${lon.toFixed(1)}, ${lat.toFixed(1)}) in ${n} provinces`);
    if (n === 1) tested++; else missed++;
  }
  assert.ok(tested > 600, `${tested} points of land each in one province`);
  // (Only the smallest islands, left out as provinces of their own, are in none.)
  assert.ok(missed <= 0.01 * tested, `${missed} points of land in no province`);
  // Smoothed: hardly a right-angled corner left (a staircase of the grid's cells would be all of them; what remains
  // is where three provinces meet).
  let corners = 0, points = 0;
  for (const q of a) for (const poly of q.polygons) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    const [p0, p1, p2] = [ring[(i + ring.length - 1) % ring.length], ring[i], ring[(i + 1) % ring.length]];
    const h1 = p0[1] === p1[1], v1 = p0[0] === p1[0], h2 = p1[1] === p2[1], v2 = p1[0] === p2[0];
    if ((h1 && v2) || (v1 && h2)) corners++;
    points++;
  }
  assert.ok(corners < 0.03 * points, `${corners} right-angled corners in ${points} points`);
});
