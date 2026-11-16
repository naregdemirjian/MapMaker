// Downloads the Natural Earth layers used by the Earth basemap and converts them into Map Maker's
// compact basemap format (data/natural-earth/ne-<scale>.json). The converted files are committed,
// so the app and the tests never need the network; run this only to update or add data.
//
//   node scripts/fetch-natural-earth.mjs [--from <folder with the .geojson files>]
//
// Format "mapmaker-basemap-1": coordinates are whole multiples of `quantum` degrees, each ring or
// line stored as a flat list [x0, y0, dx1, dy1, ...] (first point absolute, then differences).
//   polygons layers: [[ring, ring...], ...]   (first ring outer, the others holes)
//   lines layers:    [line, line, ...]
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v5.1.2';
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/`;
const QUANTUM = 1e-4; // degrees, about 11 m: well below the accuracy of the 1:50m data
const SCALES = ['110m', '50m', '10m'];
// The finest scale is cut into tiles of TILE degrees (polygons clipped, lines split into short
// pieces), so a close-up view only projects what is near it. Eurasia alone has 100,000+ points.
const TILED = new Set(['10m']);
const TILE = 10;
const LINE_PIECE = 400; // points per line piece
const LAYERS = [
  { name: 'land', file: 'land', kind: 'polygons' },
  { name: 'lakes', file: 'lakes', kind: 'polygons' },
  { name: 'coastline', file: 'coastline', kind: 'lines' },
  { name: 'borders', file: 'admin_0_boundary_lines_land', kind: 'lines' },
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'natural-earth');
const fromIdx = process.argv.indexOf('--from');
const from = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

async function load(name) {
  if (from) return readFileSync(join(from, `${name}.geojson`), 'utf8');
  const res = await fetch(BASE + `${name}.geojson`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

function encode(coords) {
  const out = [];
  let px = 0, py = 0, first = true;
  for (const [lon, lat] of coords) {
    const x = Math.round(lon / QUANTUM), y = Math.round(lat / QUANTUM);
    if (first) { out.push(x, y); first = false; } else {
      if (x === px && y === py) continue;
      out.push(x - px, y - py);
    }
    px = x; py = y;
  }
  return out;
}

/** Sutherland-Hodgman: the part of a ring inside a lon/lat rectangle (planar, as Natural Earth is). */
function clipRing(ring, x0, y0, x1, y1) {
  let pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const edges = [
    [(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= y0, (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y0]; }],
    [(p) => p[1] <= y1, (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y1]; }],
  ];
  for (const [inside, cut] of edges) {
    if (pts.length === 0) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ia = inside(a), ib = inside(b);
      if (ib) { if (!ia) out.push(cut(a, b)); out.push(b); } else if (ia) out.push(cut(a, b));
    }
    pts = out;
  }
  return pts;
}

const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const bboxOf = (r) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, y] of r) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return b; };

/** A polygon cut into tile pieces (each piece: outer ring and the holes that reach into the tile). */
function tilePolygon(rings) {
  const [ox0, oy0, ox1, oy1] = bboxOf(rings[0]);
  const tx0 = Math.floor(ox0 / TILE), tx1 = Math.floor((ox1 - 1e-9) / TILE), ty0 = Math.floor(oy0 / TILE), ty1 = Math.floor((oy1 - 1e-9) / TILE);
  if (tx0 === tx1 && ty0 === ty1) return [rings];
  const pieces = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    const x0 = tx * TILE, y0 = ty * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
    const outer = clipRing(rings[0], x0, y0, x1, y1);
    if (outer.length < 3 || Math.abs(ringArea(outer)) < 1e-12) continue;
    const piece = [outer];
    for (const h of rings.slice(1)) {
      const c = clipRing(h, x0, y0, x1, y1);
      if (c.length >= 3 && Math.abs(ringArea(c)) >= 1e-12) piece.push(c);
    }
    pieces.push(piece.map((r) => [...r, r[0]]));
  }
  return pieces;
}

function convert(geojson, kind, tiled) {
  const items = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    if (kind === 'polygons') {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const p of polys) {
        for (const piece of tiled ? tilePolygon(p) : [p]) {
          const rings = piece.map(encode).filter((r) => r.length >= 8);
          if (rings.length) items.push(rings);
        }
      }
    } else {
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lines) {
        // Consecutive pieces share their end point, so the line stays continuous.
        const step = tiled ? LINE_PIECE : Infinity;
        for (let i = 0; i < l.length - 1; i += step) {
          const e = encode(l.slice(i, Math.min(l.length, i + step + 1)));
          if (e.length >= 4) items.push(e);
        }
      }
    }
  }
  return items;
}

mkdirSync(outDir, { recursive: true });
const sources = [];
for (const scale of SCALES) {
  const layers = {};
  for (const l of LAYERS) {
    const name = `ne_${scale}_${l.file}`;
    const text = await load(name);
    sources.push({ file: `${name}.geojson`, sha256: createHash('sha256').update(text).digest('hex') });
    layers[l.name] = { kind: l.kind, items: convert(JSON.parse(text), l.kind, TILED.has(scale)) };
    console.log(`${name}: ${layers[l.name].items.length} items`);
  }
  const file = join(outDir, `ne-${scale}.json`);
  writeFileSync(file, JSON.stringify({ format: 'mapmaker-basemap-1', dataset: 'natural-earth', version: VERSION, scale, quantum: QUANTUM, layers }));
  console.log(`wrote ${file}`);
}

// Today's countries (1:50m), for 'Add today's countries': names, codes, continent, whether a nation,
// a map colour group, and their shapes in the same compact encoding.
{
  const text = await load('ne_50m_admin_0_countries');
  sources.push({ file: 'ne_50m_admin_0_countries.geojson', sha256: createHash('sha256').update(text).digest('hex') });
  const flags = existsSync(join(root, 'data', 'flags', 'index.json')) ? new Set(JSON.parse(readFileSync(join(root, 'data', 'flags', 'index.json'), 'utf8')).map((f) => f.code)) : new Set();
  const countries = [];
  for (const f of JSON.parse(text).features) {
    const p = f.properties;
    const nation = p.TYPE === 'Sovereign country' || p.TYPE === 'Sovereignty' || (p.TYPE === 'Country' && p.SOVEREIGNT === p.ADMIN) || ['Israel', 'Kosovo', 'Palestine'].includes(p.NAME);
    const iso2 = String(p.ISO_A2_EH ?? '').toLowerCase();
    const name = p.NAME_EN === "People's Republic of China" ? 'China' : p.NAME_EN === 'East Timor' ? 'Timor-Leste' : p.NAME_EN;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    countries.push({
      name, iso2: /^[a-z]{2}$/.test(iso2) ? iso2 : null, iso3: p.ISO_A3_EH && p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : null,
      continent: p.CONTINENT, subregion: p.SUBREGION, nation, color: p.MAPCOLOR9, flag: flags.has(iso2) ? iso2 : null,
      polygons: polys.map((poly) => poly.map(encode).filter((r) => r.length >= 6)).filter((poly) => poly.length),
    });
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(join(outDir, 'countries-50m.json'), JSON.stringify({ format: 'mapmaker-countries-1', dataset: 'natural-earth', version: VERSION, quantum: QUANTUM, countries }));
  console.log(`countries: ${countries.length} (${countries.filter((c) => c.nation).length} nations)`);
}

const record = {
  id: 'natural-earth',
  name: 'Natural Earth',
  version: VERSION,
  source: 'https://www.naturalearthdata.com/ (files from https://github.com/nvkelso/natural-earth-vector)',
  licence: 'Public domain',
  credit: 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.',
  usedFor: "Earth basemap: land, lakes, coastlines and present-day country borders (reference only) at 1:110m, 1:50m and 1:10m; today's countries (1:50m) to add to a map",
  retrieved: new Date().toISOString().slice(0, 10),
  converted: `Coordinates rounded to ${QUANTUM} degrees; at 1:10m, land and lakes cut into ${TILE}-degree tiles and lines into pieces (for drawing speed); nothing else changed.`,
  sources,
};
const datasetsFile = join(root, 'data', 'datasets.json');
const all = existsSync(datasetsFile) ? JSON.parse(readFileSync(datasetsFile, 'utf8')).filter((d) => d.id !== record.id) : [];
all.push(record);
writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
console.log(`updated ${datasetsFile}`);
