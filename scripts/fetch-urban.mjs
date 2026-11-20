// Downloads Natural Earth's urban areas (1:10m, built-up land from MODIS) and writes the Middle East's and the
// Caucasus's (data/natural-earth/urban-10m-mideast.json, D175) for the region maps: areas of 3 km² or more,
// outlines simplified to about 300 m (Douglas-Peucker), coordinates in steps of 1e-4 degrees, each ring a flat
// list [x0, y0, dx1, dy1, ...]. The file is committed, so the app and the tests never need the network.
//
//   node scripts/fetch-urban.mjs [--from <ne_10m_urban_areas.geojson>]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_urban_areas.geojson';
export const BOUNDS = { west: 24, south: 10, east: 76, north: 46 };
const MIN_KM2 = 3, TOLERANCE = 0.003, QUANTUM = 1e-4;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = process.argv.indexOf('--from');
const geo = JSON.parse(from > 0 ? readFileSync(process.argv[from + 1], 'utf8') : await (await fetch(URL)).text());

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, at = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len; if (d > far) { far = d; at = i; } }
    if (far > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const q = (v) => Math.round(v / QUANTUM);
const areas = [];
let points = 0;
for (const f of geo.features) {
  const km2 = f.properties.area_sqkm ?? 0;
  if (km2 < MIN_KM2) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const outer = poly[0];
    let x = 0, y = 0;
    for (const p of outer) { x += p[0]; y += p[1]; }
    x /= outer.length; y /= outer.length;
    if (x < BOUNDS.west || x > BOUNDS.east || y < BOUNDS.south || y > BOUNDS.north) continue;
    const rings = [];
    for (const r of poly.slice(0, 1)) {
      const s = simplify(r.slice(0, -1), TOLERANCE);
      if (s.length < 3) continue;
      const flat = [];
      let px = 0, py = 0;
      for (const [lx, ly] of s) { const X = q(lx), Y = q(ly); flat.push(X - px, Y - py); px = X; py = Y; }
      rings.push(flat);
      points += s.length;
    }
    if (rings.length) areas.push({ km2: Math.round(km2 * 10) / 10, rings });
  }
}
const out = join(root, 'data', 'natural-earth', 'urban-10m-mideast.json');
writeFileSync(out, JSON.stringify({ format: 'mapmaker-urban-1', version: 'v5.1.2', quantum: QUANTUM, bounds: BOUNDS, areas }));
console.log(`${areas.length} urban areas, ${points} points -> ${out}`);
