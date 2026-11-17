// Downloads Natural Earth's states and provinces (admin-1, 1:10m) and converts them into Map Maker's
// compact regions file (data/natural-earth/regions-10m.json), used by the region picker (D78). The
// converted file is committed, so the app and the tests never need the network.
//
//   node scripts/fetch-regions.mjs [--from <ne_10m_admin_1_states_provinces.geojson>]
//
// Format "mapmaker-regions-1": like today's countries (countries-50m.json): coordinates are whole
// multiples of `quantum` degrees; each ring a flat list [x0, y0, dx1, dy1, ...]. To keep the file
// small, runs of points that belong to one region only (coasts) are simplified (Douglas-Peucker,
// TOLERANCE degrees), while every point a region shares with another is kept, so neighbouring
// regions still meet exactly along their common border.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v5.1.2';
const URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/ne_10m_admin_1_states_provinces.geojson`;
const QUANTUM = 1e-3; // degrees, about 110 m
const TOLERANCE = 0.008; // degrees, about 900 m, for coasts
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data', 'natural-earth', 'regions-10m.json');

const fromIdx = process.argv.indexOf('--from');
const text = fromIdx > 0 ? readFileSync(process.argv[fromIdx + 1], 'utf8') : await (await fetch(URL)).text();
const geo = JSON.parse(text);

const q = (v) => Math.round(v / QUANTUM);
const key = (p) => `${p[0]},${p[1]}`;
// Quantised rings without repeated points (closing point dropped).
const regions = [];
for (const f of geo.features) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = polys.map((poly) => poly.map((r) => {
    const pts = [];
    for (const c of r) { const p = [q(c[0]), q(c[1])]; const l = pts[pts.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) pts.push(p); }
    while (pts.length > 1 && key(pts[0]) === key(pts[pts.length - 1])) pts.pop();
    return pts;
  }));
  const p = f.properties;
  regions.push({ name: p.name || p.name_en || p.woe_name || '?', country: p.admin, type: p.type_en || p.type || '', iso: p.iso_3166_2 || '', polygons: rings });
}
// How many regions use each point.
const users = new Map();
regions.forEach((r, i) => { for (const poly of r.polygons) for (const ring of poly) for (const p of ring) { const k = key(p); const u = users.get(k); if (u === undefined) users.set(k, i); else if (u !== i) users.set(k, -1); } });
const shared = (p) => users.get(key(p)) === -1;

function dp(pts, tol) {
  // Douglas-Peucker on an open run (first and last kept), in quantum units.
  const t = tol / QUANTUM;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let best = -1, bd = t;
    for (let i = a + 1; i < b; i++) {
      const d = L ? Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyRing(ring) {
  const anchors = [];
  ring.forEach((p, i) => { if (shared(p)) anchors.push(i); });
  if (!anchors.length) {
    // A ring of its own (an island): split in two halves so both ends are kept.
    if (ring.length < 8) return ring;
    const h = ring.length >> 1;
    const s = [...dp(ring.slice(0, h + 1), TOLERANCE).slice(0, -1), ...dp([...ring.slice(h), ring[0]], TOLERANCE).slice(0, -1)];
    return s.length >= 3 ? s : ring.length <= 64 ? ring : [];
  }
  // Runs of private points between shared ones are simplified; shared points are all kept.
  const n = ring.length, outPts = [];
  for (let k = 0; k < anchors.length; k++) {
    const a = anchors[k], b = anchors[(k + 1) % anchors.length];
    const run = [];
    for (let i = a; ; i = (i + 1) % n) { run.push(ring[i]); if (i === b && run.length > 1) break; if (anchors.length === 1 && run.length > n) break; }
    const simple = run.length > 2 ? dp(run, TOLERANCE) : run;
    outPts.push(...simple.slice(0, -1));
  }
  return outPts;
}

let before = 0, after = 0;
const encoded = regions.map((r) => {
  const polygons = [];
  for (const poly of r.polygons) {
    const rings = [];
    poly.forEach((ring, j) => {
      before += ring.length;
      const s = simplifyRing(ring);
      if (s.length < 3) return; // (a speck of an island, or a hole, too small to keep)
      if (j > 0 && !rings.length) return; // a hole without its outline
      after += s.length;
      const flat = [s[0][0], s[0][1]];
      for (let i = 1; i < s.length; i++) flat.push(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      rings.push(flat);
    });
    if (rings.length) polygons.push(rings);
  }
  return { name: r.name, country: r.country, type: r.type, iso: r.iso, polygons };
}).filter((r) => r.polygons.length);
encoded.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify({ format: 'mapmaker-regions-1', version: VERSION, scale: '10m', quantum: QUANTUM, regions: encoded }));
console.log(`${encoded.length} regions; ${before} points to ${after}; ${out}`);
