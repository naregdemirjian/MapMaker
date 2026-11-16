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
const SCALES = ['110m', '50m'];
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

function convert(geojson, kind) {
  const items = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    if (kind === 'polygons') {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const p of polys) {
        const rings = p.map(encode).filter((r) => r.length >= 8);
        if (rings.length) items.push(rings);
      }
    } else {
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lines) { const e = encode(l); if (e.length >= 4) items.push(e); }
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
    layers[l.name] = { kind: l.kind, items: convert(JSON.parse(text), l.kind) };
    console.log(`${name}: ${layers[l.name].items.length} items`);
  }
  const file = join(outDir, `ne-${scale}.json`);
  writeFileSync(file, JSON.stringify({ format: 'mapmaker-basemap-1', dataset: 'natural-earth', version: VERSION, scale, quantum: QUANTUM, layers }));
  console.log(`wrote ${file}`);
}

const record = {
  id: 'natural-earth',
  name: 'Natural Earth',
  version: VERSION,
  source: 'https://www.naturalearthdata.com/ (files from https://github.com/nvkelso/natural-earth-vector)',
  licence: 'Public domain',
  credit: 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.',
  usedFor: 'Earth basemap: land, lakes, coastlines and present-day country borders (reference only) at 1:110m and 1:50m',
  retrieved: new Date().toISOString().slice(0, 10),
  converted: `Coordinates rounded to ${QUANTUM} degrees; nothing else changed.`,
  sources,
};
const datasetsFile = join(root, 'data', 'datasets.json');
const all = existsSync(datasetsFile) ? JSON.parse(readFileSync(datasetsFile, 'utf8')).filter((d) => d.id !== record.id) : [];
all.push(record);
writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
console.log(`updated ${datasetsFile}`);
