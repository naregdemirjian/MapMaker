// Downloads Natural Earth's rivers (1:50m and 1:10m) and converts them into Map Maker's basemap format
// (data/natural-earth/rivers-<scale>.json), drawn on maps of the Earth (D99). The converted files are
// committed, so the app and the tests never need the network; run this only to update them.
//
//   node scripts/fetch-rivers.mjs [--from <folder with the .geojson files>]
//
// Format "mapmaker-basemap-1" (as fetch-natural-earth.mjs writes), one "lines" layer, `rivers`, and
// beside it `ranks`: each line's Natural Earth scalerank (0 the greatest rivers, 10 the least), which
// sets how wide it is drawn. Lake centre lines are left out (lakes are drawn). At 1:10m long rivers
// are cut into pieces of at most 400 points, so a close-up view only draws what is near it.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v5.1.2';
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/`;
const QUANTUM = 1e-4;
const PIECE = 400;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromIdx = process.argv.indexOf('--from');
const from = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

async function load(name) {
  if (from) return JSON.parse(readFileSync(join(from, `${name}.geojson`), 'utf8'));
  const res = await fetch(`${BASE}${name}.geojson`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
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

for (const scale of ['50m', '10m']) {
  const geo = await load(`ne_${scale}_rivers_lake_centerlines`);
  const items = [], ranks = [];
  let count = 0;
  for (const f of geo.features) {
    const p = f.properties ?? {};
    if (!String(p.featurecla ?? '').startsWith('River')) continue;
    const rank = Number.isFinite(Number(p.scalerank)) ? Math.round(Number(p.scalerank)) : 6;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    count++;
    for (const line of lines) {
      if (line.length < 2) continue;
      const pieces = [];
      if (scale === '10m' && line.length > PIECE) for (let i = 0; i < line.length - 1; i += PIECE - 1) pieces.push(line.slice(i, Math.min(line.length, i + PIECE)));
      else pieces.push(line);
      for (const piece of pieces) { const enc = encode(piece); if (enc.length >= 4) { items.push(enc); ranks.push(rank); } }
    }
  }
  const file = { format: 'mapmaker-basemap-1', dataset: 'natural-earth', version: VERSION, scale, quantum: QUANTUM, layers: { rivers: { kind: 'lines', items, ranks } } };
  const out = join(root, 'data', 'natural-earth', `rivers-${scale}.json`);
  writeFileSync(out, JSON.stringify(file));
  console.log(`wrote ${out}: ${count} rivers, ${items.length} lines`);
}

// The Natural Earth record says what its data is used for.
const datasetsFile = join(root, 'data', 'datasets.json');
if (existsSync(datasetsFile)) {
  const all = JSON.parse(readFileSync(datasetsFile, 'utf8'));
  const ne = all.find((d) => d.id === 'natural-earth');
  if (ne && !/rivers/.test(ne.usedFor)) {
    ne.usedFor = ne.usedFor.replace('Earth basemap: land, lakes, coastlines', 'Earth basemap: land, lakes, rivers (1:50m, 1:10m close up), coastlines');
    writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
    console.log(`updated ${datasetsFile}`);
  }
}
